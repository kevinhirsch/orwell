"""Issue #834 — received (assistant) messages inconsistently show a timestamp.

Root cause (verified by trace, chatRenderer.js + chat.js):
  Role + timestamp was gated on the turn's FIRST ROUND (strictly `r === 0`):
    chatRenderer.js  wrap.className = 'msg msg-ai' + (r > 0 ? ' msg-continuation' : '')
                     if (r === 0) roleEl.appendChild(roleTimestamp(...))
    chat.js          the agent_step continuation bubble was ALWAYS `msg-continuation` with no
                     per-round timestamp.
  When round 0 is a HIDDEN tool-call (e.g. getGameState — no visible body), the first VISIBLE
  bubble is a later round, so it rendered as a continuation with NO timestamp.

The fix (BOTH paths, kept consistent):
  Attach role + timestamp to the FIRST VISIBLE bubble of a turn, not strictly round 0.
    - chatRenderer.js (reload): a `renderedFirstVisible` flag; the first rendered bubble owns the
      header (role + timestamp) and is NOT a continuation.
    - chat.js (live): a `turnHeaderShown` flag; when the round-0 header bubble is hidden (pure
      tool-only round), the next continuation bubble is PROMOTED to the header (role + timestamp).

The reload path is an LLM-stub-blind render path (the #822 / #873 lesson), so the runtime gate
drives the REAL chatRenderer.addMessage over a multi-round metadata payload whose round 0 is a
hidden tool-call — it FAILS on pre-fix main (no timestamp, continuation) and PASSES after.

Run: cd frontend && .venv/bin/python -m pytest tests/test_834_first_visible_bubble_timestamp.py
"""

import os
import socket
import subprocess
import sys
import time
import urllib.request

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel):
    with open(os.path.join(FRONTEND, rel), encoding="utf-8") as f:
        return f.read()


# ─────────────────────────────────────────────────────────────────────────────
# Source pins — the fix legs can't silently regress (cheap, no browser).
# ─────────────────────────────────────────────────────────────────────────────

def test_reload_path_uses_first_visible_not_round_zero():
    """#829 TURN COALESCING supersedes the per-round first-visible bookkeeping: the agent
    reconstruction renders ONE turn bubble, and that bubble structurally OWNS the role +
    timestamp header (it can never be a continuation). #834's guarantee — the received
    message shows a timestamp — is now satisfied by construction; the runtime gate below
    still proves it end-to-end against the REAL render."""
    js = _read("static/js/chatRenderer.js")
    # The single turn bubble always carries the header + timestamp.
    assert "roleEl.appendChild(roleTimestamp(metadata?.timestamp));" in js, (
        "#834: the turn bubble must attach the role timestamp."
    )
    # No reconstruction bubble is ever a continuation any more (one bubble per turn).
    assert "(isFirstVisible ? '' : ' msg-continuation')" not in js, (
        "#829: the per-round continuation re-split must not return to the reload path."
    )
    # The old strict-round-zero gate stays gone.
    assert "if (r === 0) roleEl.appendChild(roleTimestamp(" not in js, (
        "#834: the old `r === 0` timestamp gate must not return."
    )


def test_live_path_promotes_first_visible_continuation():
    """#829 TURN COALESCING: the live turn bubble (`holder`) carries the header for the whole
    turn. It hides only while a first tool-only round runs (nothing committed yet) — that hide
    clears `turnHeaderShown` — and the next round's re-show restores it. The ONE surviving
    fresh-bubble path (teacher takeover) still promotes to a header when the turn has no
    visible one (#834)."""
    js = _read("static/js/chat.js")
    assert "turnHeaderShown" in js, (
        "#834: the live path must track whether a visible turn-header was shown."
    )
    # Hiding the (still-empty) turn bubble at the tool_start finalize clears the flag...
    assert "turnHeaderShown = false;" in js, (
        "#834: hiding the header bubble must clear turnHeaderShown."
    )
    # ...and the coalescing re-show at agent_step restores it.
    step = js[js.index("} else if (json.type === 'agent_step') {"):]
    step = step[:step.index("} else if (json.type === 'budget_exceeded') {")]
    assert "roundHolder.style.display = '';" in step
    assert "turnHeaderShown = true;" in step
    # The teacher-takeover fresh bubble still promotes to header (role + timestamp, not a
    # continuation) when the turn has no visible header.
    assert "const _isTurnHeader = !turnHeaderShown;" in js
    assert "(_isTurnHeader ? '' : ' msg-continuation')" in js, (
        "#834: a promoted first-visible bubble must NOT carry msg-continuation."
    )
    assert "newRole.appendChild(chatRenderer.roleTimestamp());" in js, (
        "#834: the promoted header bubble must carry a timestamp (matches the reload path)."
    )


# ─────────────────────────────────────────────────────────────────────────────
# Runtime — drive the REAL chatRenderer.addMessage reload path in headless chromium.
# ─────────────────────────────────────────────────────────────────────────────

def _free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def _boot(env, port):
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", str(port)],
        cwd=FRONTEND, env=env,
        stdout=open(f"/tmp/fe-834-{port}.log", "w"), stderr=subprocess.STDOUT,
    )
    base = f"http://127.0.0.1:{port}"
    for _ in range(120):
        if proc.poll() is not None:
            raise RuntimeError(f"uvicorn exited early; see /tmp/fe-834-{port}.log")
        try:
            urllib.request.urlopen(base + "/openapi.json", timeout=2)
            return proc, base
        except Exception:
            time.sleep(1)
    proc.terminate()
    raise RuntimeError("server never became ready")


# An assistant turn whose ROUND 0 is a hidden tool-call (empty round text, a tool event on round 1)
# and whose first VISIBLE narration lands on round 2. addMessage renders the multi-round timeline.
_HARNESS = r"""
async () => {
  const chat = window.chatModule;
  if (!chat || !chat.addMessage) return { error: 'chatModule.addMessage missing' };
  const box = document.getElementById('chat-history');
  if (!box) return { error: 'no #chat-history' };
  box.innerHTML = '';

  // round_texts: [r0 EMPTY (hidden tool-call), r1 the first VISIBLE narration]
  const metadata = {
    timestamp: '2026-06-27T15:30:00.000Z',
    round_texts: ['', 'The houseguests gather in the living room.'],
    tool_events: [{ round: 1, tool: 'getGameState', command: 'getGameState', output: '{}' }],
  };
  chat.addMessage('assistant', '', 'test-model', metadata);

  // The first VISIBLE assistant bubble (skip display:none rows).
  const aiEls = Array.from(box.querySelectorAll('.msg.msg-ai'))
    .filter(el => !(el.style && el.style.display === 'none'))
    .filter(el => (el.querySelector('.body')?.textContent || '').trim().length > 0);
  if (!aiEls.length) return { error: 'no visible assistant bubble rendered' };
  const first = aiEls[0];
  return {
    firstHasTimestamp: !!first.querySelector('.role .role-timestamp'),
    firstIsContinuation: first.classList.contains('msg-continuation'),
    visibleBubbles: aiEls.length,
  };
}
"""


def test_first_visible_bubble_gets_timestamp_when_round0_is_hidden_toolcall():
    try:
        from playwright.sync_api import sync_playwright  # noqa: F401
    except Exception:
        pytest.skip("playwright not installed")

    env = dict(os.environ)
    env.setdefault("AUTH_ENABLED", "false")
    env.setdefault("ORWELL_GAME_BUILD", "1")
    port = _free_port()
    proc = None
    try:
        proc, base = _boot(env, port)
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            try:
                browser = pw.chromium.launch()
            except Exception as e:
                pytest.skip(f"chromium unavailable: {e}")
            page = browser.new_page()
            page.goto(base + "/", wait_until="load", timeout=30000)
            page.wait_for_timeout(3500)  # module graph + async init
            result = page.evaluate(_HARNESS)
            browser.close()
    finally:
        if proc is not None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except Exception:
                proc.kill()

    assert not result.get("error"), result.get("error")
    assert result["visibleBubbles"] >= 1
    assert result["firstHasTimestamp"], (
        "#834: the first VISIBLE bubble must carry a .role-timestamp even when round 0 "
        "was a hidden tool-call."
    )
    assert not result["firstIsContinuation"], (
        "#834: the first VISIBLE bubble must NOT be a msg-continuation."
    )
