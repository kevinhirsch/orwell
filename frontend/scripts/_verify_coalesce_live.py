#!/usr/bin/env python3
"""#829 — turn-coalescing (send-while-streaming) LIVE verification driver.

The owed live-only acceptance for the #829 redo. #822 coalesced a turn into one
growing bubble but broke live streaming and was reverted (#825); the redo must be
proven against a REAL model, not just the stubbed browser_smoke (the exact gap that
let #822 ship broken — issue #829). This driver is the standing live evidence run:
it is the leg-(3) auto-arm target of `.github/workflows/live-harness-nightly.yml`.

WHAT IT ASSERTS (the FIXED behavior).
  A send WHILE a reply is streaming must ENQUEUE, never STOP-and-drop (#891 F-A2):
    send A (begins streaming) → WHILE A streams, send B →
      • A's reply completes UNINTERRUPTED (never aborted/truncated), and
      • B then dispatches and lands its own reply,
      • both in order, neither aborted nor dropped.
  Driven through the REAL composer (a genuine, non-headless user Send that flips the
  live `isStreaming` flag and exercises the send-while-streaming enqueue seam), against
  a real OpenRouter model wired into the FE — the only path that reproduces the
  live-streaming class of failure the stubbed gates can't see.

THE SELF-SKIP CONTRACT (why this can land BEFORE the feature).
  The #829 coalescing change lives in the fenced `frontend/static/js/chat.js` and is
  owned by another overseer; it is NOT shipped yet. Landing this driver early must NOT
  fire the live path prematurely or spam a nightly warning. So BEFORE any live model
  call the driver probes the SERVED chat.js for the #829 feature sentinel and, when it
  is ABSENT (the pre-feature state), self-SKIPS: it makes ZERO live calls, writes a skip
  verdict, prints the SKIP line, and exits 0. Only once the feature (its sentinel) is
  present does the live path run and assert coalescing.

  The presence sentinel is the codebase's ironclad issue-tag convention: the #829 redo
  will carry the literal `#829` tag in chat.js (every other messaging-resilience change
  does — `#985`, `#830`, `#891`, `#993`, `#992`). `#829` is absent from the served
  chat.js today, which is exactly the "feature absent → self-skip" signal. A few explicit
  alternates (`coalesceRounds` / `oneBubblePerTurn` / "growing bubble"), all likewise
  absent today, are accepted so the leg still arms if the implementer tags it another way.
  Any read failure is treated as ABSENT (fail-safe: never a false "present").

USAGE (the other overseer, keyed):
    cd frontend && OPENROUTER_API_KEY=sk-... python3 scripts/_verify_coalesce_live.py

Writes evidence (verdict.json + screenshots) under frontend/data/_coalesce_live/.
Roles only — the player name is a generic label; the cast is engine-seeded.
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(FRONTEND)
OUT = os.path.join(FRONTEND, "data", "_coalesce_live")
os.makedirs(OUT, exist_ok=True)

NARRATION = os.environ.get("COALESCE_NARRATION_MODEL", "z-ai/glm-5.2")
UTILITY = os.environ.get("COALESCE_UTILITY_MODEL", "qwen/qwen3.6-flash")
BASE_URL = os.environ.get("COALESCE_BASE_URL", "https://openrouter.ai/api/v1")
SEED = int(os.environ.get("COALESCE_SEED", "82982"))

# ── feature-presence probe (the self-skip gate) ─────────────────────────────────────────
# The SERVED player-tier chat.js IS the on-disk static file (FastAPI serves static/js/*.js
# verbatim — no JS build step), so a source read of it is exactly "the served chat.js" and
# is boot-free + deterministic + un-hangable — the right shape for the critical keyless skip.
CHAT_JS = os.path.join(FRONTEND, "static", "js", "chat.js")
# All confirmed ABSENT from the served chat.js on main today (the pre-feature state).
_FEATURE_SENTINELS = ("#829", "coalescerounds", "onebubbleperturn", "growing bubble")

# Distinctive send markers so the transcript walk can identify A's and B's user bubbles
# unambiguously (the model's narration replies never echo them).
MARK_A = "ZULU-A17-COALESCE"
MARK_B = "ZULU-B42-COALESCE"
MSG_A = f"[{MARK_A}] I slip into the kitchen and start reading the room out loud, slow and deliberate."
MSG_B = f"[{MARK_B}] Before you answer — I also want to pull someone aside about the vote later tonight."


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def _get(base, path, timeout=20):
    with urllib.request.urlopen(base + path, timeout=timeout) as r:
        return json.loads(r.read() or b"{}")


def _post_json(base, path, body, timeout=60):
    req = urllib.request.Request(base + path, data=json.dumps(body).encode(), method="POST",
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b"{}")


def _post_form(base, path, form, timeout=30):
    req = urllib.request.Request(base + path, data=urllib.parse.urlencode(form).encode(),
                                 method="POST",
                                 headers={"content-type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b"{}")


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


def _coalescing_feature_present() -> tuple[bool, str]:
    """Probe the served chat.js for the #829 feature sentinel. Fail-safe: any read error
    ⇒ ABSENT (never a false 'present', so the key is never spent pre-feature)."""
    try:
        with open(CHAT_JS, encoding="utf-8") as fh:
            low = fh.read().lower()
    except Exception as e:  # unreadable served file ⇒ treat as absent (skip)
        return (False, f"could not read served chat.js ({type(e).__name__}) — treated as ABSENT")
    hits = [s for s in _FEATURE_SENTINELS if s in low]
    if hits:
        return (True, f"#829 coalescing sentinel present in served chat.js: {hits}")
    return (False, "no #829 round-coalescing sentinel in served chat.js (pre-feature state)")


def _write_verdict(payload: dict) -> None:
    with open(os.path.join(OUT, "verdict.json"), "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1)


# Ordered transcript of visible chat bubbles (role + text), oldest → newest.
_TRANSCRIPT_JS = """
() => {
  const box = document.getElementById('chat-history');
  if (!box) return { ready: false, items: [] };
  const nodes = Array.from(box.querySelectorAll('.msg'))
    .filter(el => !(el.style && el.style.display === 'none'));
  const items = nodes.map(el => {
    const role = el.classList.contains('msg-user') ? 'user'
               : el.classList.contains('msg-ai') ? 'ai' : 'other';
    const text = (el.textContent || '').trim();
    // 'torn off' = the app's engine-interrupt apology took the place of a real reply. Keyed
    // on that app-specific sentinel (NOT generic English) so narration prose can never
    // false-positive an abort.
    return { role, text, stopped: /technical interlude/i.test(text) };
  });
  return { ready: true, items };
}
"""

# Genuine, NON-headless user send: set the composer value + dispatch a real Enter keydown,
# which routes through the app's messageInput keydown handler → handleSubmit → handleChatSubmit
# with overrideMsg=null (_headless=false, reads el('message').value). This is the ONLY path that
# flips the live `isStreaming` flag and hits the send-while-streaming enqueue branch — a
# programmatic handleChatSubmit(null, text) would set _headless=true and bypass it.
_SEND_JS = """
(txt) => {
  const ta = document.getElementById('message');
  if (!ta) return false;
  ta.value = txt;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.focus();
  ta.dispatchEvent(new KeyboardEvent('keydown',
    { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
  return true;
}
"""

_IS_STREAMING_JS = "() => !!(window.chatModule && window.chatModule._isStreaming && window.chatModule._isStreaming())"


def main() -> int:
    # ── STEP 1 (before ANYTHING live): feature-absence self-skip ──────────────────────────
    present, why = _coalescing_feature_present()
    if not present:
        _write_verdict({"skipped": True, "reason": why, "feature_present": False, "checks": []})
        print(f"SKIP: #829 coalescing feature not present — driver self-skipped (no live calls) — {why}",
              flush=True)
        return 0

    # ── STEP 2: key gate (only AFTER we know the feature is here) ──────────────────────────
    key = os.environ.get("OPENROUTER_API_KEY") or ""
    if not key:
        _write_verdict({"skipped": False, "reason": "OPENROUTER_API_KEY required (live run)",
                        "feature_present": True, "checks": []})
        print("FAIL: OPENROUTER_API_KEY required (live run)", flush=True)
        return 2

    print(f"ARMED: {why} — running the live coalescing verify.", flush=True)
    from playwright.sync_api import sync_playwright

    # Scrub the shared canonical-binding store (#1085/#1086 hygiene — a stale binding wins the
    # warm turn's bind, the resolve route unbinds it as dead, and the window never subscribes).
    for stale in ("orwell_game_session.json", "orwell_layout.json"):
        try:
            os.remove(os.path.join(FRONTEND, "data", stale))
        except FileNotFoundError:
            pass

    engine_port, fe_port = _free_port(), _free_port()
    engine = subprocess.Popen(
        ["node", os.path.join(REPO, "dist", "main.js")], cwd=REPO,
        env=dict(os.environ, ORWELL_DATA_DIR=tempfile.mkdtemp(prefix="coalesce-live-engine-"),
                 ORWELL_ENGINE_PORT=str(engine_port)),
        stdout=open(os.path.join(OUT, "engine.log"), "w"), stderr=subprocess.STDOUT)
    ebase = f"http://127.0.0.1:{engine_port}"
    fe = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app:app", "--host", "127.0.0.1",
         "--port", str(fe_port)], cwd=FRONTEND,
        env=dict(os.environ, ORWELL_GAME_BUILD="1", AUTH_ENABLED="false",
                 LOCALHOST_BYPASS="true", ORWELL_ENGINE_MCP_URL=ebase,
                 PLAYWRIGHT_BROWSERS_PATH=os.environ.get("PLAYWRIGHT_BROWSERS_PATH",
                                                         "/opt/pw-browsers"),
                 DATABASE_URL="sqlite:///" + os.path.join(
                     tempfile.mkdtemp(prefix="coalesce-live-fe-"), "app.db")),
        stdout=open(os.path.join(OUT, "fe.log"), "w"), stderr=subprocess.STDOUT)
    fbase = f"http://127.0.0.1:{fe_port}"

    verdicts: list[tuple[str, bool, str]] = []

    def _flush() -> None:
        _write_verdict({"skipped": False, "feature_present": True, "reason": why,
                        "checks": [{"check": c, "ok": ok, "detail": d} for c, ok, d in verdicts]})

    def _check(label: str, ok: bool, detail: str) -> None:
        verdicts.append((label, bool(ok), detail))
        _flush()
        print(f"  [{'PASS' if ok else 'FAIL'}] {label} — {detail}", flush=True)

    try:
        _wait_http(ebase + "/player/tools", engine, "engine", 60)
        _wait_http(fbase + "/openapi.json", fe, "front-end", 120)

        # Wire the real OpenRouter endpoint + default models (mirrors the two-window sibling).
        ep = _post_form(fbase, "/api/model-endpoints", {
            "name": "coalesce-live", "base_url": BASE_URL, "api_key": key,
            "skip_probe": "true", "endpoint_kind": "openai"})
        sfile = os.path.join(FRONTEND, "data", "settings.json")
        cur = {}
        if os.path.exists(sfile):
            with open(sfile, encoding="utf-8") as fh:
                cur = json.load(fh)
        cur.update({"default_model": NARRATION, "default_endpoint_id": ep["id"],
                    "utility_model": UTILITY})
        tmp = sfile + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(cur, fh, indent=2)
        os.replace(tmp, sfile)
        deadline = time.time() + 15
        while time.time() < deadline:
            try:
                if _get(fbase, "/api/default-chat").get("model") == NARRATION:
                    break
            except Exception:
                pass
            time.sleep(1)

        # A seeded, STARTED game (engine-direct) so composer sends are game turns, not casting.
        r = _post_json(ebase, "/player/call",
                       {"name": "createCharacter", "args": {"playerName": "Sam", "seed": SEED}})
        if "result" not in r:
            raise RuntimeError(f"createCharacter failed: {r}")

        # A real FE chat-session row carrying the endpoint (the stream path resolves the
        # session's own endpoint; a session without one 503s every round).
        sess = _post_form(fbase, "/api/session", {
            "name": "coalesce-live", "model": NARRATION, "skip_validation": "true",
            "endpoint_id": ep["id"]}).get("id")
        if not sess:
            raise RuntimeError("could not create the FE chat session")

        # One warm turn over REST binds the canonical session + proves the model resolves,
        # so the timed A/B sequence below fails on the coalescing behavior, not on plumbing.
        def _rest_turn(text: str, timeout=600) -> None:
            body = json.dumps({"message": text, "session": sess}).encode()
            req = urllib.request.Request(f"{fbase}/api/chat_stream", data=body, method="POST",
                                         headers={"content-type": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    while resp.read(65536):
                        pass
            except Exception as e:
                # Server-detached run: a client read-drop degrades to "poll for settle".
                print(f"  warm-turn reader dropped ({type(e).__name__}) — waiting for settle",
                      flush=True)
                dl = time.time() + 300
                while time.time() < dl:
                    try:
                        if _get(fbase, f"/api/chat/stream_status/{sess}",
                                timeout=10).get("status") != "streaming":
                            break
                    except Exception:
                        pass
                    time.sleep(5)

        _rest_turn("I take a slow breath and get my bearings in the house.")

        with sync_playwright() as pw:
            try:
                browser = pw.chromium.launch()
            except Exception as e:
                _check("browser-launch", False, f"chromium unavailable: {e}")
                return _finish(verdicts)
            page = browser.new_context().new_page()
            page.goto(fbase + "/", wait_until="load", timeout=30000)
            page.wait_for_timeout(3000)

            # Land the window on the started game's session (deterministic — don't rely on
            # whichever session the boot happened to select).
            try:
                page.evaluate("(sid) => window.sessionModule && window.sessionModule.selectSession(sid)", sess)
            except Exception:
                pass
            dl = time.time() + 20
            on_sess = False
            while time.time() < dl:
                try:
                    cur_sid = page.evaluate(
                        "() => window.sessionModule && window.sessionModule.getCurrentSessionId "
                        "&& window.sessionModule.getCurrentSessionId()")
                except Exception:
                    cur_sid = None
                if cur_sid == sess:
                    on_sess = True
                    break
                page.wait_for_timeout(500)
            _check("window-on-started-session", on_sess,
                   f"current session id == started game session ({'yes' if on_sess else 'no'})")
            page.wait_for_timeout(1500)
            page.screenshot(path=os.path.join(OUT, "01_before_send.png"))

            # ── SEND A: a genuine user send that begins streaming ────────────────────────
            sent_a = page.evaluate(_SEND_JS, MSG_A)
            _check("send-A-dispatched", bool(sent_a), "composer Enter-send for message A dispatched")

            # Wait until A is actively streaming (isStreaming true AND a partial AI bubble).
            a_streaming = False
            partial_a_len = 0
            dl = time.time() + 90
            while time.time() < dl:
                streaming = False
                try:
                    streaming = bool(page.evaluate(_IS_STREAMING_JS))
                except Exception:
                    streaming = False
                snap = page.evaluate(_TRANSCRIPT_JS)
                ai = [it for it in snap.get("items", []) if it["role"] == "ai" and it["text"]]
                if streaming and ai:
                    a_streaming = True
                    partial_a_len = len(ai[-1]["text"])
                    break
                page.wait_for_timeout(300)
            _check("A-began-streaming", a_streaming,
                   f"isStreaming=true with a partial AI bubble ({partial_a_len} chars)")
            page.screenshot(path=os.path.join(OUT, "02_A_streaming.png"))

            # ── SEND B while A is mid-stream: must ENQUEUE, not Stop-and-drop ─────────────
            still_streaming = False
            try:
                still_streaming = bool(page.evaluate(_IS_STREAMING_JS))
            except Exception:
                still_streaming = False
            sent_b = page.evaluate(_SEND_JS, MSG_B)
            _check("send-B-while-A-streaming", bool(sent_b) and still_streaming,
                   f"message B dispatched while A still streaming (isStreaming={still_streaming})")

            # A must NOT have been aborted by B's send — it should still be streaming or have
            # settled with real content shortly after (never a torn-off/stopped A bubble).
            page.wait_for_timeout(1500)
            snap = page.evaluate(_TRANSCRIPT_JS)
            b_user = [it for it in snap.get("items", []) if it["role"] == "user" and MARK_B in it["text"]]
            _check("B-not-dropped-immediately", bool(b_user),
                   f"B's user bubble present right after send ({len(b_user)} found)")
            page.screenshot(path=os.path.join(OUT, "03_B_enqueued.png"))

            # ── Settle: A completes, then B flushes + completes. Wait for a stable idle. ──
            stable_since = None
            settled = False
            dl = time.time() + 300
            while time.time() < dl:
                try:
                    streaming = bool(page.evaluate(_IS_STREAMING_JS))
                except Exception:
                    streaming = True
                snap = page.evaluate(_TRANSCRIPT_JS)
                items = snap.get("items", [])
                has_a = any(it["role"] == "user" and MARK_A in it["text"] for it in items)
                has_b = any(it["role"] == "user" and MARK_B in it["text"] for it in items)
                ai_nonempty = [it for it in items if it["role"] == "ai" and it["text"]]
                if (not streaming) and has_a and has_b and len(ai_nonempty) >= 2:
                    if stable_since is None:
                        stable_since = time.time()
                    elif time.time() - stable_since >= 4.0:  # 4s of continuous idle
                        settled = True
                        break
                else:
                    stable_since = None
                page.wait_for_timeout(700)
            page.screenshot(path=os.path.join(OUT, "04_settled.png"))

            snap = page.evaluate(_TRANSCRIPT_JS)
            items = snap.get("items", [])
            with open(os.path.join(OUT, "transcript.json"), "w", encoding="utf-8") as fh:
                json.dump(items, fh, indent=1)

            def _uidx(mark: str):
                for i, it in enumerate(items):
                    if it["role"] == "user" and mark in it["text"]:
                        return i
                return -1

            ia, ib = _uidx(MARK_A), _uidx(MARK_B)

            # (1) Both user messages present, in order — B was neither dropped nor reordered.
            _check("both-sends-present-in-order", ia >= 0 and ib >= 0 and ia < ib,
                   f"A user idx={ia}, B user idx={ib}")

            # (2) A's reply completed BEFORE B — a non-empty AI bubble sits between A and B
            #     (A ran to completion uninterrupted; the send of B did not abort it).
            a_reply = [it for k, it in enumerate(items)
                       if it["role"] == "ai" and it["text"] and ia < k < ib] if (ia >= 0 and ib > ia) else []
            _check("A-reply-completed-before-B", bool(a_reply),
                   f"{len(a_reply)} non-empty AI reply(ies) between A and B; A-reply len="
                   f"{len(a_reply[-1]['text']) if a_reply else 0}")

            # (3) B then landed its own reply — a non-empty AI bubble after B.
            b_reply = [it for k, it in enumerate(items)
                       if it["role"] == "ai" and it["text"] and k > ib] if ib >= 0 else []
            _check("B-reply-landed-after", bool(b_reply),
                   f"{len(b_reply)} non-empty AI reply(ies) after B; B-reply len="
                   f"{len(b_reply[-1]['text']) if b_reply else 0}")

            # (4) Neither turn shows an abort/stopped marker (no torn-off reply).
            aborted = [it for it in items if it["role"] == "ai" and it["text"] and it.get("stopped")]
            _check("no-aborted-reply", not aborted,
                   f"{len(aborted)} AI bubble(s) carry a stop/interrupt marker")

            # (5) Overall settle reached within budget.
            _check("settled-within-budget", settled,
                   "both turns reached a stable idle" if settled else "timed out before stable idle")

            browser.close()

        return _finish(verdicts)
    except Exception as e:  # any unexpected failure is a real FAIL with evidence, never a hang
        _check("driver-exception", False, f"{type(e).__name__}: {e}")
        return _finish(verdicts)
    finally:
        for p in (fe, engine):
            try:
                p.terminate()
                p.wait(timeout=10)
            except Exception:
                try:
                    p.kill()
                except Exception:
                    pass


def _finish(verdicts) -> int:
    _write_verdict({"skipped": False, "feature_present": True,
                    "checks": [{"check": c, "ok": ok, "detail": d} for c, ok, d in verdicts]})
    failed = [v for v in verdicts if not v[1]]
    ok = bool(verdicts) and not failed
    print(f"\n{'VERIFY OK' if ok else 'VERIFY FAIL'} — "
          f"{len(verdicts) - len(failed)}/{len(verdicts)} checks passed; evidence in {OUT}",
          flush=True)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
