"""The first-message double-render (SSE self-echo) — a true fail-before / pass-after browser gate.

The reported bug: on first open after a full factory/OOBE reset, the VERY FIRST message appears
TWICE and then dedupes — a visible flicker on a fresh, empty session.

Root cause (verified by MutationObserver trace against the real FE + real engine, SSE transport):
`session_events` is at-least-once, so a window receives its OWN `run-started` echo (and the replay
ring re-delivers it on a late connect) while its foreground POST is STILL rendering that very run.
sessionSync.js could not tell its own echo from a genuine PEER run, so — while its own stream was in
flight — it DEFERRED a peer-resume of its OWN run (ADR 0012 GAP-1), and at stream end
`flushPendingPeerResume` → `resumeStream` re-attached to the just-finished run (still in the evict
grace), replaying the SAME narration into a SECOND bubble beside the one the POST already rendered.
softReloadHistory's orphan check then collapsed the duplicate — the "appears twice then dedupes"
flicker. It is worst (most visible) on the first message of a fresh session, where nothing else is on
screen. This is the SSE/poll fallback path — the transport casting/pre-game uses (WS falls back
`pregame-not-live`), so the gate pins it with ORWELL_WS_TRANSPORT=0.

The fix (#1087 SSE parity): `session_events` stamps the current run id onto the `run-started` edge (the
WS `state` edge already carried it); `chat.js` learns THIS window's own run id from its self-echo and
`sessionSync.js` NEVER (defer-)resumes its own run — only a genuine PEER run (a different runId) still
resumes/defers, so the live two-window mirror is preserved.

This gate drives the REAL browser first turn and polls the DOM every frame across the WHOLE settle
window (a MutationObserver + a tight poll), asserting the visible NARRATION bubble count never exceeds
the expected at ANY frame — not merely "dedupes fast." The transient `.agent-thinking-dots` spinner
(chatStreamLoop.js) is a "Thinking" indicator, not a message, so it is excluded from the narration
count. Every automated gate stubs the LLM (the #822 lesson); a scripted OpenAI-compatible stub streams
the narration here. Roles only — the player label is a generic probe; the cast is engine-seeded.
"""
from __future__ import annotations

import contextlib
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(FRONTEND)


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


# ── scripted OpenAI-compatible stub ─────────────────────────────────────────────────
# A streaming reply of SENTENCE-terminated deltas (the game-build leak scrub buffers the visible
# stream to sentence boundaries before emitting), slow enough that the run is still live when the
# self-echo `run-started` arrives — the exact window the deferred peer-resume fired in.

_STUB_DELTAS = [
    "The house is unervingly quiet tonight. ",
    "Every camera in the room has found you. ",
    "Somewhere, an alliance is already forming without you. ",
    "Make your first move, houseguest. ",
]


class _StubHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def log_message(self, *a):  # quiet
        pass

    def do_GET(self):  # model-list / health probes
        body = json.dumps({"object": "list", "data": [{"id": "stub-narrator"}]}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        n = int(self.headers.get("content-length") or 0)
        try:
            req = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            req = {}
        if not bool(req.get("stream")):
            body = json.dumps({
                "id": "stub", "object": "chat.completion", "model": "stub-narrator",
                "choices": [{"index": 0, "finish_reason": "stop",
                             "message": {"role": "assistant", "content": "ok"}}],
            }).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.send_header("cache-control", "no-cache")
        self.end_headers()

        def emit(delta, finish=None):
            chunk = {"id": "stub", "object": "chat.completion.chunk", "model": "stub-narrator",
                     "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}
            self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
            self.wfile.flush()

        emit({"role": "assistant"})
        for piece in _STUB_DELTAS:
            emit({"content": piece})
            time.sleep(0.45)
        emit({}, finish="stop")
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()


# ── boot helpers ─────────────────────────────────────────────────────────────────────

def _wait_http(url, proc, what, budget=120):
    for _ in range(budget):
        if proc is not None and proc.poll() is not None:
            raise RuntimeError(f"{what} exited early")
        try:
            urllib.request.urlopen(url, timeout=2)
            return
        except Exception:
            time.sleep(1)
    raise RuntimeError(f"{what} never became ready")


def _post_form(base, path, form, timeout=30):
    data = urllib.parse.urlencode(form).encode()
    req = urllib.request.Request(base + path, data=data, method="POST",
                                 headers={"content-type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b"{}")


def _stop_proc(p: "subprocess.Popen") -> None:
    """Terminate a child process and WAIT for it — escalate to kill+wait if it lingers, so no
    orphaned engine/uvicorn survives the fixture (the kill path also waits, never leaks a zombie)."""
    if p is None:
        return
    p.terminate()
    try:
        p.wait(timeout=10)
    except Exception:
        p.kill()
        try:
            p.wait(timeout=10)
        except Exception:
            pass


def _restore_settings(path: str, existed: bool, original: "bytes | None") -> None:
    """Restore the SHARED, tracked `data/settings.json` to EXACTLY its pre-test state: rewrite its
    original bytes if it existed, else DELETE the file the test created — so the working tree is clean
    afterwards. Errors are NOT swallowed (a restore failure must surface as a teardown error)."""
    if existed:
        with open(path, "wb") as fh:
            fh.write(original or b"")
    else:
        with contextlib.suppress(FileNotFoundError):
            os.remove(path)


@pytest.fixture(scope="module")
def _stack():
    try:
        from playwright.sync_api import sync_playwright  # noqa: F401
    except Exception:
        pytest.skip("playwright not installed")
    dist = os.path.join(REPO, "dist", "main.js")
    if not os.path.isfile(dist):
        pytest.skip("engine bundle missing — run `npm run build` at the repo root")

    # The canonical-binding store is SHARED frontend/data state (first-writer-wins) — scrub a stale
    # binding so it can't win this boot's bind (the #1085/#1086 lesson the golden driver scrubs too).
    for stale in ("orwell_game_session.json", "orwell_layout.json"):
        with contextlib.suppress(FileNotFoundError):
            os.remove(os.path.join(FRONTEND, "data", stale))

    # ONE cleanup scope: every server / process / tempdir / log handle registers its teardown the
    # instant it exists, so a FAILED later launch (engine or FE never comes up) still tears down
    # everything already created — no leaked ports, processes, or temp dirs (CodeRabbit stability).
    # ExitStack unwinds LIFO, so the order below means: FE+engine stopped (and waited) FIRST, then the
    # stub server, then log handles closed, then the tempdirs removed, then settings restored — the
    # SHARED tracked `data/settings.json` last (after nothing can rewrite it).
    with contextlib.ExitStack() as stack:
        # Snapshot the SHARED, tracked settings file BEFORE we touch it; restore-or-delete on teardown
        # so the working tree is byte-clean afterwards (a file that did NOT exist is DELETED, not left
        # as `{}`). Registered first ⇒ restored last.
        sfile = os.path.join(FRONTEND, "data", "settings.json")
        _settings_existed = os.path.exists(sfile)
        _settings_original = None
        if _settings_existed:
            with open(sfile, "rb") as fh:
                _settings_original = fh.read()
        stack.callback(_restore_settings, sfile, _settings_existed, _settings_original)

        engine_data = tempfile.mkdtemp(prefix="orwell-fmdr-engine-")
        stack.callback(shutil.rmtree, engine_data, ignore_errors=True)
        fe_db_dir = tempfile.mkdtemp(prefix="orwell-fmdr-fe-")
        stack.callback(shutil.rmtree, fe_db_dir, ignore_errors=True)
        fe_data = tempfile.mkdtemp(prefix="orwell-fmdr-data-")
        stack.callback(shutil.rmtree, fe_data, ignore_errors=True)

        eng_log = open("/tmp/fmdr-engine.log", "w")
        stack.callback(eng_log.close)
        fe_log = open("/tmp/fmdr-fe.log", "w")
        stack.callback(fe_log.close)

        stub_port = _free_port()
        stub = ThreadingHTTPServer(("127.0.0.1", stub_port), _StubHandler)
        stack.callback(stub.shutdown)
        threading.Thread(target=stub.serve_forever, daemon=True).start()

        engine_port = _free_port()
        engine_env = dict(os.environ, ORWELL_DATA_DIR=engine_data,
                          ORWELL_ENGINE_PORT=str(engine_port))
        engine = subprocess.Popen(["node", dist], cwd=REPO, env=engine_env,
                                  stdout=eng_log, stderr=subprocess.STDOUT)
        stack.callback(_stop_proc, engine)
        ebase = f"http://127.0.0.1:{engine_port}"

        fe_port = _free_port()
        fe_env = dict(
            os.environ,
            ORWELL_GAME_BUILD="1", AUTH_ENABLED="false", LOCALHOST_BYPASS="true",
            # The SSE/poll fallback is the transport casting/pre-game uses (WS falls back
            # `pregame-not-live`) — and it is where the self-echo double lived. Pin it.
            ORWELL_WS_TRANSPORT="0",
            ORWELL_ENGINE_MCP_URL=ebase,
            PLAYWRIGHT_BROWSERS_PATH=os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers"),
            DATABASE_URL="sqlite:///" + os.path.join(fe_db_dir, "app.db"),
            ORWELL_DATA_DIR_FE=fe_data,
        )
        fe = subprocess.Popen([sys.executable, "-m", "uvicorn", "app:app",
                               "--host", "127.0.0.1", "--port", str(fe_port)],
                              cwd=FRONTEND, env=fe_env,
                              stdout=fe_log, stderr=subprocess.STDOUT)
        stack.callback(_stop_proc, fe)
        fbase = f"http://127.0.0.1:{fe_port}"

        _wait_http(ebase + "/player/tools", engine, "engine", 60)
        _wait_http(fbase + "/openapi.json", fe, "front-end", 120)

        ep = _post_form(fbase, "/api/model-endpoints", {
            "name": "fmdr-stub", "base_url": f"http://127.0.0.1:{stub_port}/v1",
            "api_key": "stub-key", "skip_probe": "true", "endpoint_kind": "openai",
        })
        cur = {}
        if os.path.exists(sfile):
            with open(sfile, encoding="utf-8") as fh:
                cur = json.load(fh)
        cur.update({"default_model": "stub-narrator", "default_endpoint_id": ep["id"]})
        tmp = sfile + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(cur, fh, indent=2)
        os.replace(tmp, sfile)
        deadline = time.time() + 15
        resolved = {}
        while time.time() < deadline:
            try:
                resolved = json.loads(urllib.request.urlopen(
                    fbase + "/api/default-chat", timeout=5).read() or b"{}")
            except Exception:
                resolved = {}
            if resolved.get("model") == "stub-narrator":
                break
            time.sleep(1.0)
        if resolved.get("model") != "stub-narrator":
            raise RuntimeError(f"default-chat never resolved the stub model: {resolved}")

        yield {"fe": fbase, "endpoint_id": ep["id"]}


# Installed once in the page: a MutationObserver + a tight poll that record, at EVERY frame, the
# visible NARRATION bubble counts. `.agent-thinking-dots` (the transient "Thinking" spinner) is NOT a
# message — exclude it so the gate targets the real duplicate, not the legit indicator.
_OBSERVE_JS = r"""
() => {
  const box = document.getElementById('chat-history');
  if (!box) return false;
  window.__peakUser = 0;
  window.__peakNarr = 0;
  window.__narrFrames = [];   // frames where narration bubbles >= 2 (for diagnosis)
  const visUser = () => Array.from(box.querySelectorAll('.msg.msg-user'))
      .filter(e => !(e.style && e.style.display === 'none')).length;
  const narr = () => Array.from(box.querySelectorAll('.msg.msg-ai, .msg.msg-assistant'))
      .filter(e => !(e.style && e.style.display === 'none') && !e.classList.contains('agent-thinking-dots'));
  window.__sample = () => {
    const u = visUser();
    const a = narr();
    if (u > window.__peakUser) window.__peakUser = u;
    if (a.length > window.__peakNarr) window.__peakNarr = a.length;
    if (a.length >= 2) {
      window.__narrFrames.push(a.map(e =>
        (e.dataset.dbId || '-') + ':"' + (e.textContent || '').trim().slice(0, 18) + '"'));
    }
  };
  new MutationObserver(() => window.__sample()).observe(box, {childList: true, subtree: true, attributes: true});
  window.__pollTimer = setInterval(() => window.__sample(), 30);
  window.__sample();
  return true;
}
"""


def _send_first_message(page, text):
    # Type char-by-char so the composer `input` event fires (the .send-btn leaves newchat-mode), then
    # submit the chat form directly (Enter can be intercepted by composer handlers).
    page.click("#message")
    page.type("#message", text, delay=8)
    page.wait_for_timeout(150)
    page.evaluate(
        "() => { const f = document.getElementById('chat-form');"
        " if (f) { f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit', {cancelable:true, bubbles:true})); } }"
    )


def test_first_message_renders_exactly_once_no_transient_double(_stack):
    """Drive a FRESH session's first message and assert the visible narration bubble count NEVER
    exceeds 1 at ANY frame across the whole settle window — no transient second bubble, EVER (not
    'dedupes fast'). RED on pre-fix main (the self-echo peer-resume paints a duplicate), GREEN after.
    """
    from playwright.sync_api import sync_playwright

    fbase = _stack["fe"]

    # A brand-new, EMPTY FE chat-session row bound to the stub endpoint — the "fresh session, empty
    # store, brand-new session row" the report describes (a real row so the SSE mirror/resume attach;
    # a non-row id 404s them, #1085's lesson).
    sess = _post_form(fbase, "/api/session", {
        "name": "fmdr-fresh", "model": "stub-narrator", "skip_validation": "true",
        "endpoint_id": _stack["endpoint_id"],
    }).get("id")
    assert sess, "could not create the fresh FE chat session"

    with sync_playwright() as pw:
        try:
            browser = pw.chromium.launch()
        except Exception as e:
            pytest.skip(f"chromium unavailable: {e}")
        page = browser.new_page()
        page.goto(fbase + "/", wait_until="load", timeout=30000)
        # Wait for sessionModule before selecting — a bare `&&`-guarded evaluate is a silent NO-OP if the
        # module graph hasn't loaded yet, which would let the test observe the WRONG session and
        # FALSE-PASS (defeating the gate). The API-created row is not in the CLIENT's session list until
        # a loadSessions(), so selectSession would no-op against an unknown id — load first.
        page.wait_for_function(
            "() => !!(window.sessionModule && window.sessionModule.loadSessions"
            " && window.sessionModule.selectSession && window.sessionModule.getCurrentSessionId)",
            timeout=15000)
        page.evaluate("async () => { try { await window.sessionModule.loadSessions(); } catch (_) {} }")
        # Select, then hard-ASSERT the switch landed. SELF-HEALING: (re-)invoke selectSession every poll
        # until getCurrentSessionId is `sess`, so a call that lands before the list finished loading
        # simply retries (robust against a slow boot) instead of timing out for an unrelated reason.
        page.wait_for_function(
            "(sid) => {"
            "  const sm = window.sessionModule;"
            "  if (!sm || !sm.getCurrentSessionId || !sm.selectSession) return false;"
            "  if (sm.getCurrentSessionId() === sid) return true;"
            "  try { sm.selectSession(sid); } catch (_) {}"
            "  return false;"
            "}",
            arg=sess, timeout=25000)
        active = page.evaluate("() => window.sessionModule.getCurrentSessionId()")
        assert active == sess, (
            f"failed to switch to the fresh session — active is {active!r}, expected {sess!r}; "
            "the gate would observe the wrong session and FALSE-PASS")
        # Let the module graph, the sessionSync SSE subscription, and init fully settle so the
        # first send races the SSE exactly as a real first-open does.
        page.wait_for_timeout(3800)
        assert page.evaluate(_OBSERVE_JS), "could not install the DOM observer (no #chat-history)"

        _send_first_message(page, "This is my first message on a fresh session.")
        # Cover the entire first-turn lifecycle: stream (~2s) → settle reconcile → the stream-end
        # peer-resume flush (the window the duplicate historically painted in).
        page.wait_for_timeout(9000)

        res = page.evaluate("""() => ({
          peakUser: window.__peakUser,
          peakNarr: window.__peakNarr,
          narrFrames: window.__narrFrames.slice(0, 8),
          finalNarr: Array.from(document.querySelectorAll('#chat-history .msg.msg-ai, #chat-history .msg.msg-assistant'))
              .filter(e => !(e.style && e.style.display === 'none') && !e.classList.contains('agent-thinking-dots')).length,
          finalUser: Array.from(document.querySelectorAll('#chat-history .msg.msg-user'))
              .filter(e => !(e.style && e.style.display === 'none')).length,
          wsActive: !!(window.OrwellWs && window.OrwellWs.isActive && window.OrwellWs.isActive()),
        })""")
        browser.close()

    # This gate pins the SSE fallback (the casting/pre-game transport) — WS must be inactive.
    assert res["wsActive"] is False, "expected the SSE fallback transport (ORWELL_WS_TRANSPORT=0)"

    # The turn must actually have produced a reply (guard against a silent no-op that would make the
    # peak assertion vacuously pass).
    assert res["finalNarr"] == 1, (
        f"expected exactly ONE settled narration bubble, got {res['finalNarr']}")
    assert res["finalUser"] == 1, (
        f"expected exactly ONE settled user bubble, got {res['finalUser']}")

    # THE GATE: no transient second NARRATION bubble at ANY frame of the whole settle window.
    assert res["peakNarr"] <= 1, (
        "the first message rendered TWICE (a transient duplicate narration bubble) before dedupe — "
        f"peak visible narration bubbles = {res['peakNarr']} (>1). Duplicate frames: "
        f"{res['narrFrames']!r}")
    # And the user bubble is never duplicated either.
    assert res["peakUser"] <= 1, (
        f"the first user message rendered more than once — peak visible user bubbles = {res['peakUser']}")
