"""F3 (concurrent-session consistency) — a transport close AFTER server-confirmed completion must
NOT trigger drop-recovery, and must never duplicate.

Root cause: `_tryAutoRecover` keyed on a channel CLOSE, not on a COMPLETION event. When the SSE
reader ended (or the reader's own `if (!_streamSawDone) throw` fired) AFTER the full reply had
streamed and the server had persisted it (`message_saved`) but before/without a trailing `[DONE]`,
`_isRecoverableStreamErr` matched `closed|stream|eof|…` and auto-continue re-narrated already-produced
content → a DUPLICATE reply + a player-visible "The stream dropped before you finished…" machinery
leak. (Confirmed against a live glm-4.7 bundle: finishReason:stop, ok:true, full text present, yet
recovery fired.)

The fix gates auto-recover on server-confirmed completion — a `[DONE]` sentinel (`_streamSawDone`), a
persisted `message_saved` (`_sawMessageSaved`), or a db id already on the holder = authoritative
completion → skip recovery AND the generic error surface.

This gate drives a REAL browser turn against a stub, then TRUNCATES the SSE response in-page exactly at
the F3 boundary — right after `message_saved`, before `[DONE]` — so the reader throws "Stream closed
before completion". It asserts:
  * NO second (recovery) streaming request reaches the model — the stub's streaming-POST count stays 1;
  * NO transient/settled DUPLICATE narration bubble at ANY frame;
  * the "stream dropped" machinery prompt NEVER appears in the chat;
  * the reply content is preserved (the turn stands).

Pins the SSE/fetch reader path (where the "Stream closed before completion" throw lives — the WS leg
reroutes replies through `_onWsChatFrame` and has no such throw), so it runs with ORWELL_WS_TRANSPORT=0.
Roles only; the LLM is stubbed (the #822 lesson).
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


# ── scripted OpenAI-compatible stub that COUNTS streaming completions ─────────────────
_STREAM_POSTS = {"n": 0}
_STREAM_LOCK = threading.Lock()

_STUB_DELTAS = [
    "The house lights dim as you step inside. ",
    "Every camera swings to find you. ",
    "Somewhere a whispered alliance is already forming. ",
]


class _StubHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def log_message(self, *a):  # quiet
        pass

    def do_GET(self):
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
        with _STREAM_LOCK:
            _STREAM_POSTS["n"] += 1
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
            time.sleep(0.15)
        emit({}, finish="stop")
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()


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


def _stop_proc(p) -> None:
    if p is None:
        return
    p.terminate()
    try:
        p.wait(timeout=10)
    except Exception:
        p.kill()
        with contextlib.suppress(Exception):
            p.wait(timeout=10)


def _restore_settings(path, existed, original) -> None:
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

    for stale in ("orwell_game_session.json", "orwell_layout.json"):
        with contextlib.suppress(FileNotFoundError):
            os.remove(os.path.join(FRONTEND, "data", stale))

    with contextlib.ExitStack() as stack:
        sfile = os.path.join(FRONTEND, "data", "settings.json")
        _existed = os.path.exists(sfile)
        _orig = None
        if _existed:
            with open(sfile, "rb") as fh:
                _orig = fh.read()
        stack.callback(_restore_settings, sfile, _existed, _orig)

        engine_data = tempfile.mkdtemp(prefix="orwell-f3-engine-")
        stack.callback(shutil.rmtree, engine_data, ignore_errors=True)
        fe_db_dir = tempfile.mkdtemp(prefix="orwell-f3-fe-")
        stack.callback(shutil.rmtree, fe_db_dir, ignore_errors=True)
        fe_data = tempfile.mkdtemp(prefix="orwell-f3-data-")
        stack.callback(shutil.rmtree, fe_data, ignore_errors=True)

        eng_log = open("/tmp/f3-engine.log", "w"); stack.callback(eng_log.close)
        fe_log = open("/tmp/f3-fe.log", "w"); stack.callback(fe_log.close)

        stub_port = _free_port()
        stub = ThreadingHTTPServer(("127.0.0.1", stub_port), _StubHandler)
        stack.callback(stub.shutdown)
        threading.Thread(target=stub.serve_forever, daemon=True).start()

        engine_port = _free_port()
        engine = subprocess.Popen(
            ["node", dist], cwd=REPO,
            env=dict(os.environ, ORWELL_DATA_DIR=engine_data, ORWELL_ENGINE_PORT=str(engine_port)),
            stdout=eng_log, stderr=subprocess.STDOUT)
        stack.callback(_stop_proc, engine)
        ebase = f"http://127.0.0.1:{engine_port}"

        fe_port = _free_port()
        fe = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", str(fe_port)],
            cwd=FRONTEND,
            env=dict(
                os.environ,
                ORWELL_GAME_BUILD="1", AUTH_ENABLED="false", LOCALHOST_BYPASS="true",
                ORWELL_WS_TRANSPORT="0",  # F3's throw lives on the SSE/fetch reader path
                ORWELL_ENGINE_MCP_URL=ebase,
                PLAYWRIGHT_BROWSERS_PATH=os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers"),
                DATABASE_URL="sqlite:///" + os.path.join(fe_db_dir, "app.db"),
                ORWELL_DATA_DIR_FE=fe_data,
            ),
            stdout=fe_log, stderr=subprocess.STDOUT)
        stack.callback(_stop_proc, fe)
        fbase = f"http://127.0.0.1:{fe_port}"

        _wait_http(ebase + "/player/tools", engine, "engine", 60)
        _wait_http(fbase + "/openapi.json", fe, "front-end", 120)

        ep = _post_form(fbase, "/api/model-endpoints", {
            "name": "f3-stub", "base_url": f"http://127.0.0.1:{stub_port}/v1",
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
                resolved = json.loads(urllib.request.urlopen(fbase + "/api/default-chat", timeout=5).read() or b"{}")
            except Exception:
                resolved = {}
            if resolved.get("model") == "stub-narrator":
                break
            time.sleep(1.0)
        if resolved.get("model") != "stub-narrator":
            raise RuntimeError(f"default-chat never resolved the stub model: {resolved}")

        yield {"fe": fbase, "endpoint_id": ep["id"]}


# In-page: (1) truncate the /api/chat_stream SSE at the F3 boundary — right after `message_saved`,
# before `[DONE]`; (2) install a MutationObserver sampling the peak narration bubble count every frame.
_INSTALL_JS = r"""
() => {
  const box = document.getElementById('chat-history');
  if (!box) return false;
  window.__peakNarr = 0;
  window.__sawDropPrompt = false;
  const narr = () => Array.from(box.querySelectorAll('.msg.msg-ai, .msg.msg-assistant'))
      .filter(e => !(e.style && e.style.display === 'none') && !e.classList.contains('agent-thinking-dots'));
  window.__sample = () => {
    const a = narr();
    if (a.length > window.__peakNarr) window.__peakNarr = a.length;
    // The machinery leak we must NEVER show: the auto-continue "stream dropped" prompt or a generic
    // "Error:" surface for a turn that actually completed.
    const t = box.textContent || '';
    if (t.indexOf('stream dropped') !== -1 || t.indexOf('Connection dropped') !== -1) window.__sawDropPrompt = true;
  };
  new MutationObserver(() => window.__sample()).observe(box, {childList: true, subtree: true, attributes: true});
  window.__poll = setInterval(() => window.__sample(), 30);
  window.__sample();

  // Truncate the chat_stream SSE at the F3 boundary. Forward every SSE event up to and INCLUDING the
  // `message_saved` event, then CLOSE the stream — never forwarding `[DONE]`. That reproduces the exact
  // "reply produced + persisted, then the channel closed without [DONE]" shape.
  const _origFetch = window.fetch.bind(window);
  window.fetch = async (url, opts) => {
    const u = typeof url === 'string' ? url : (url && url.url) || '';
    if (u.indexOf('/api/chat_stream') === -1) return _origFetch(url, opts);
    const res = await _origFetch(url, opts);
    if (!res.body) return res;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    const enc = new TextEncoder();
    let buffered = '';
    const stream = new ReadableStream({
      async pull(controller) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { controller.close(); return; }
          buffered += dec.decode(value, { stream: true });
          const parts = buffered.split('\n\n');
          buffered = parts.pop();
          for (const part of parts) {
            controller.enqueue(enc.encode(part + '\n\n'));
            if (part.indexOf('message_saved') !== -1) {
              // Cut here — do NOT forward [DONE] or anything after. The reader sees `done` next.
              try { await reader.cancel(); } catch (_) {}
              controller.close();
              return;
            }
          }
        }
      }
    });
    return new Response(stream, { status: res.status, headers: res.headers });
  };
  return true;
}
"""


def _send_first_message(page, text):
    page.click("#message")
    page.type("#message", text, delay=8)
    page.wait_for_timeout(150)
    page.evaluate(
        "() => { const f = document.getElementById('chat-form');"
        " if (f) { f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit', {cancelable:true, bubbles:true})); } }"
    )


def test_completed_turn_close_before_done_never_recovers_or_duplicates(_stack):
    from playwright.sync_api import sync_playwright

    fbase = _stack["fe"]
    sess = _post_form(fbase, "/api/session", {
        "name": "f3-fresh", "model": "stub-narrator", "skip_validation": "true",
        "endpoint_id": _stack["endpoint_id"],
    }).get("id")
    assert sess, "could not create the fresh FE chat session"

    with _STREAM_LOCK:
        _STREAM_POSTS["n"] = 0

    with sync_playwright() as pw:
        try:
            browser = pw.chromium.launch()
        except Exception as e:
            pytest.skip(f"chromium unavailable: {e}")
        page = browser.new_page()
        page.goto(fbase + "/", wait_until="load", timeout=30000)
        page.wait_for_function(
            "() => !!(window.sessionModule && window.sessionModule.loadSessions"
            " && window.sessionModule.selectSession && window.sessionModule.getCurrentSessionId)",
            timeout=15000)
        page.evaluate("async () => { try { await window.sessionModule.loadSessions(); } catch (_) {} }")
        page.wait_for_function(
            "(sid) => { const sm = window.sessionModule;"
            " if (!sm || !sm.getCurrentSessionId || !sm.selectSession) return false;"
            " if (sm.getCurrentSessionId() === sid) return true;"
            " try { sm.selectSession(sid); } catch (_) {} return false; }",
            arg=sess, timeout=25000)
        page.wait_for_timeout(2500)
        assert page.evaluate(_INSTALL_JS), "could not install the truncation + observer (no #chat-history)"

        _send_first_message(page, "I step into the house for the first time.")
        # Cover the whole lifecycle: truncated stream throws → catch → (must NOT) recover → settle
        # reconcile → the stream-end peer-resume flush window. If recovery WERE to fire, a second
        # streaming POST + a duplicate bubble would appear within this window.
        page.wait_for_timeout(9000)

        res = page.evaluate("""() => ({
          peakNarr: window.__peakNarr,
          sawDropPrompt: window.__sawDropPrompt,
          finalNarr: Array.from(document.querySelectorAll('#chat-history .msg.msg-ai, #chat-history .msg.msg-assistant'))
              .filter(e => !(e.style && e.style.display === 'none') && !e.classList.contains('agent-thinking-dots')).length,
          bodyText: (document.getElementById('chat-history') || {}).textContent || '',
          wsActive: !!(window.OrwellWs && window.OrwellWs.isActive && window.OrwellWs.isActive()),
        })""")
        browser.close()

    with _STREAM_LOCK:
        stream_posts = _STREAM_POSTS["n"]

    assert res["wsActive"] is False, "expected the SSE/fetch reader path (ORWELL_WS_TRANSPORT=0)"
    # The turn genuinely produced + persisted a reply (guard against a vacuous pass).
    assert res["finalNarr"] == 1, f"expected exactly ONE settled narration bubble, got {res['finalNarr']}"
    assert "lights dim" in res["bodyText"], "the produced reply must be preserved after the close"
    # THE GATE 1: no drop-recovery re-narration — exactly ONE streaming completion reached the stub.
    assert stream_posts == 1, (
        f"drop-recovery fired on a COMPLETED turn — the stub saw {stream_posts} streaming requests "
        "(expected 1). A close after message_saved must NOT auto-continue.")
    # THE GATE 2: no transient OR settled duplicate narration bubble at any frame.
    assert res["peakNarr"] <= 1, f"a duplicate narration bubble appeared (peak={res['peakNarr']})"
    # THE GATE 3: the "stream dropped" machinery prompt never surfaced in the player chat.
    assert res["sawDropPrompt"] is False, "the 'stream dropped' machinery prompt leaked into the chat"
