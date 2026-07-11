"""#829 — turn coalescing: one GROWING chat bubble per player turn (redo of the reverted #822).

A player turn fans out into N agent ROUNDS. The pre-#829 render gave EACH round its own
msg-continuation bubble (mount → hide-when-empty → jump); the redo renders every round into ONE
turn bubble: chat.js freezes each finished round in place at `agent_step`
(`_freezeRoundIntoTurnBubble` renames the round's live containers to inert `.committed-round` /
`.committed-reply` blocks) and streams the next round below it in the SAME body, while
chatRenderer.addMessage's agent reconstruction renders the SAME single-bubble form on reload —
so live, mirror and reload converge and softReloadHistory's orphan oracle
(`_expectedVisibleBubbleCount`) reads 1 bubble per persisted agent message.

Why the redo is shaped this way (#822 post-mortem, PR #825): #822 rewired the same three seams
but re-armed the round spinner INSIDE the renderer-owned `.stream-content` and left live-only
state (`turnHasCommittedReply` + hide/re-show interplay) no stubbed gate could exercise; on the
first real multi-round turn the first message hung/disappeared and the whole change was reverted.
The redo (a) makes the post-freeze body STRUCTURALLY IDENTICAL to a fresh bubble's body (the
downstream seams keep their exact input shape; the spinner is a direct `.body` child, exactly
like the initial holder), and (b) lands WITH its live-LLM driver
(`frontend/scripts/_verify_coalesce_live.py`, run by the nightly `coalesce-live` leg AND by the
overseer before merge) — the acceptance gate the issue rules ("not just the stubbed
browser_smoke").

This file is the DETERMINISTIC gate: source pins for the render contract, plus a stubbed-stream
browser test that drives the REAL chat.js streaming loop (route-intercepted SSE, no LLM) through:
  1. a MULTI-ROUND tool turn  → exactly ONE visible assistant bubble; both rounds' narration in
     order inside it; reasoning in the accordion, never the public body; merged dataset.raw
     intact; the reconcile ADOPTS the live bubble with zero churn (no rebuild re-split);
  2. a SINGLE-ROUND turn      → the classic render, no committed blocks (no behavior change);
  3. the #825 breakage shape  → round 1 is a PURE tool round (no narration): the turn must
     settle, the bubble must be visible with round-2 narration, and the send button must return
     to idle (no first-message hang / disappear).

Run: cd frontend && .venv/bin/python -m pytest tests/test_829_turn_coalesce.py
"""

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


# ─────────────────────────────────────────────────────────────────────────────
# Source pins — the coalescing contract can't silently regress (cheap, no browser).
# ─────────────────────────────────────────────────────────────────────────────

def test_agent_step_freezes_instead_of_spawning_bubbles():
    js = _read("static", "js", "chat.js")
    step = js[js.index("} else if (json.type === 'agent_step') {"):]
    step = step[:step.index("} else if (json.type === 'budget_exceeded') {")]
    assert "_freezeRoundIntoTurnBubble();" in step, (
        "#829: agent_step must freeze the finished round into the ONE turn bubble"
    )
    # The spinner re-arms as a DIRECT .body child (the initial holder's shape) — NEVER inside the
    # renderer-owned .stream-content (where #822 mounted it and corrupted the incremental renderer).
    assert "roundHolder.querySelector('.body').appendChild(spinner.createElement());" in step
    assert "_ensureStreamLayout(_spinBody)" not in step, (
        "#822 failure class: never mount the round spinner inside the stream-content"
    )
    # Only the teacher takeover (roundHolder === null) still creates a fresh bubble.
    assert "if (roundHolder) {" in step and "roundHolder = newWrap;" in step


def test_finalize_never_wholebody_wipes_a_committed_turn():
    js = _read("static", "js", "chat.js")
    fin = js[js.index("var _hasCommitted4 ="):]
    fin = fin[:fin.index("if (window.hljs) {")]
    # With committed blocks the final render goes ONLY into the live container...
    assert "} else if (_hasCommitted4) {" in fin
    assert "_liveSc4.innerHTML =" in fin
    # ...and the sources-only whole-body replace is fenced off a committed turn too.
    assert "} else if (_sourcesHtml && !_hasCommitted4) {" in fin
    # The single-round whole-body render survives (byte-identical single-round turns).
    assert "_body4.innerHTML = (_sourcesData ? _buildSourcesBox(_sourcesData, _sourcesType, _wasExpanded) : '')" in fin


def test_stall_watchdog_stays_deleted():
    # The removed stall watchdog must not ride back in with this change (CLAUDE.md convention).
    js = _read("static", "js", "chat.js")
    assert "_startStallWatchdog = function" not in js
    assert "function _startStallWatchdog(" not in js


def test_reload_oracle_counts_one_bubble_per_agent_message():
    js = _read("static", "js", "chat.js")
    fn = js[js.index("export function _expectedVisibleBubbleCount("):]
    fn = fn[:fn.index("export async function softReloadHistory(")]
    # ONE bubble per narrated agent message; a beats-only message renders no bubble at all.
    assert "n += hasText ? 1 : 0;" in fn
    assert "Math.max(1, textRounds)" not in fn, (
        "#829: the per-round bubble multiplication must not return — live and reload both render "
        "ONE bubble per agent message now"
    )


def test_wiring_the_g15_dispatcher_untouched():
    # Coalescing is render-only: no new orwell:gamechanged dispatch may have snuck in.
    js = _read("static", "js", "chat.js")
    assert "new CustomEvent('orwell:gamechanged')" not in js


# ─────────────────────────────────────────────────────────────────────────────
# Runtime — drive the REAL streaming loop in headless chromium with a scripted
# multi-round SSE stream (route-intercepted; no LLM, no engine).
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
        stdout=open(f"/tmp/fe-829-{port}.log", "w"), stderr=subprocess.STDOUT,
    )
    base = f"http://127.0.0.1:{port}"
    for _ in range(120):
        if proc.poll() is not None:
            raise RuntimeError(f"uvicorn exited early; see /tmp/fe-829-{port}.log")
        try:
            urllib.request.urlopen(base + "/openapi.json", timeout=2)
            return proc, base
        except Exception:
            time.sleep(1)
    proc.terminate()
    raise RuntimeError("server never became ready")


@pytest.fixture(scope="module")
def _app():
    try:
        from playwright.sync_api import sync_playwright  # noqa: F401
    except Exception:
        pytest.skip("playwright not installed")
    env = dict(
        os.environ,
        # Non-game build: the streaming/coalescing machinery is build-agnostic, and this keeps the
        # runtime gate clear of the game-only send gates (OOBE image gate / casting seams).
        ORWELL_GAME_BUILD="0",
        AUTH_ENABLED="false",
        LOCALHOST_BYPASS="true",
        PLAYWRIGHT_BROWSERS_PATH=os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers"),
        DATABASE_URL="sqlite:///" + os.path.join(tempfile.mkdtemp(prefix="orwell-829-"), "app.db"),
    )
    port = _free_port()
    try:
        proc, base = _boot(env, port)
    except RuntimeError as e:
        pytest.skip(str(e))
    yield base
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except Exception:
        proc.kill()


def _post_form(base, path, form):
    req = urllib.request.Request(base + path, data=urllib.parse.urlencode(form).encode(),
                                 method="POST",
                                 headers={"content-type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or b"{}")


def _sse(events):
    out = []
    for ev in events:
        out.append("data: " + (ev if isinstance(ev, str) else json.dumps(ev)) + "\n\n")
    return "".join(out)


_R1 = "Round one narration lands in the bubble."
_R2A = "Round two grows the very same bubble "
_R2B = "instead of mounting a fresh one."
_REASONING = ("secret plan: this reasoning channel text must stay inside the collapsed "
              "thinking accordion and never reach the public reply body.")

# Multi-round tool turn: narration → tool → agent_step → (reasoning + narration) → saved → done.
# The reasoning arrives over SEVERAL thinking deltas, as a real stream delivers it (the live
# accordion's inner fills on the deltas that follow its creation; a lone thinking delta is
# dropped from the live DOM as trivial — pre-existing behavior, reasoning kept in the raw cache).
_MULTI_ROUND = _sse([
    {"delta": _R1},
    {"type": "tool_start", "tool": "web_search", "command": "look around"},
    {"type": "tool_output", "tool": "web_search", "output": "ok", "exit_code": 0},
    {"type": "agent_step", "round": 2},
    {"delta": _REASONING[:20], "thinking": True},
    {"delta": _REASONING[20:60], "thinking": True},
    {"delta": _REASONING[60:], "thinking": True},
    {"delta": _R2A},
    {"delta": _R2B},
    {"type": "message_saved", "id": "m-829-multi"},
    "[DONE]",
])

_SINGLE_ROUND = _sse([
    {"delta": "A plain single-round reply renders exactly as before."},
    {"type": "message_saved", "id": "m-829-single"},
    "[DONE]",
])

# The #825 breakage shape: round 1 is a PURE tool round (no narration at all), round 2 narrates.
_TOOL_FIRST = _sse([
    {"type": "tool_start", "tool": "web_search", "command": "silent context pull"},
    {"type": "tool_output", "tool": "web_search", "output": "ok", "exit_code": 0},
    {"type": "agent_step", "round": 2},
    {"delta": "The first visible narration arrives in round two and must not vanish."},
    {"type": "message_saved", "id": "m-829-toolfirst"},
    "[DONE]",
])

# The DOM observer: snapshots the visible assistant-bubble population on every mutation batch so a
# transient second bubble / a vanish of committed narration is caught even if it never survives to
# the settled state.
_OBSERVER = r"""
() => {
  // Observe document.body (subtree) and re-query #chat-history per probe: some init paths
  // re-mount the chat log node after load, which would silently orphan an observer bound to
  // the original element (batches would stay 0 and every invariant would pass vacuously).
  window.__c829 = { maxAi: 0, narrationVanished: false, sawNarration: false, batches: 0, trail: [] };
  const probe = () => {
    const box = document.getElementById('chat-history');
    if (!box) return;
    const ai = Array.from(box.querySelectorAll('.msg.msg-ai'))
      .filter(el => !el.classList.contains('agent-thinking-dots') &&
                    !(el.style && el.style.display === 'none'));
    window.__c829.maxAi = Math.max(window.__c829.maxAi, ai.length);
    // Public narration = body text minus spinners + thinking accordions.
    let narration = '';
    for (const el of ai) {
      const b = el.querySelector('.body');
      if (!b) continue;
      const c = b.cloneNode(true);
      c.querySelectorAll('.thinking-section,.spinner,.wave-spinner,[class*="spinner"]').forEach(n => n.remove());
      narration += (c.textContent || '').trim();
    }
    if (window.__c829.sawNarration && !narration) window.__c829.narrationVanished = true;
    if (narration.length > 10) window.__c829.sawNarration = true;
    window.__c829.batches += 1;
    window.__c829.trail = window.__c829.trail || [];
    window.__c829.trail.push({
      think: box.querySelectorAll('.thinking-section').length,
      live: box.querySelectorAll('.live-reply-content').length,
      sc: box.querySelectorAll('.stream-content').length,
      cr: box.querySelectorAll('.committed-round').length,
    });
  };
  const obs = new MutationObserver(probe);
  obs.observe(document.body, { childList: true, subtree: true, characterData: true,
                               attributes: true, attributeFilter: ['style', 'class'] });
}
"""

_SETTLED = r"""
() => {
  const box = document.getElementById('chat-history');
  const ai = Array.from(box.querySelectorAll('.msg.msg-ai'))
    .filter(el => !el.classList.contains('agent-thinking-dots') &&
                  !(el.style && el.style.display === 'none'));
  const last = ai[ai.length - 1] || null;
  const body = last && last.querySelector('.body');
  const pub = body ? (() => { const c = body.cloneNode(true);
    c.querySelectorAll('.thinking-section,[class*="spinner"]').forEach(n => n.remove());
    return (c.textContent || '').trim(); })() : '';
  const think = body ? Array.from(body.querySelectorAll('.thinking-content'))
    .map(n => (n.textContent || '').trim()).join(' ') : '';
  const btn = document.querySelector('.send-btn');
  return {
    aiCount: ai.length,
    continuations: box.querySelectorAll('.msg.msg-ai.msg-continuation').length,
    committed: body ? body.querySelectorAll('.committed-round').length : -1,
    pub, think,
    raw: (last && last.dataset && last.dataset.raw) || '',
    fromHistory: (last && last.dataset && last.dataset.fromHistory) || '',
    hasFooter: !!(last && last.querySelector('.msg-footer')),
    btnMode: (btn && (btn.dataset.mode || btn.getAttribute('data-mode'))) || '',
    inputDisabled: !!(document.getElementById('message') || {}).disabled,
    witness: !!(last && last._c829witness),
    html: body ? body.innerHTML : '',
  };
}
"""


def _open_session(page, base, name):
    sid = _post_form(base, "/api/session", {
        "name": name, "model": "test-model", "skip_validation": "true"})["id"]
    page.evaluate("(id) => window.sessionModule.selectSession(id)", sid)
    page.wait_for_timeout(1200)
    return sid


def _route_stream(page, sse_body, capture=None):
    """Fulfill /api/chat_stream with the scripted SSE. When ``capture`` (a dict) is given, stash
    the send's `client_msg_id` form field so the history fixture can echo it back — the server
    persists it in production, and the post-turn reconcile ADOPTS the optimistic user bubble by
    that id (without it the visible-count oracle reads a divergence and force-rebuilds)."""
    import re as _re

    def _handler(route):
        try:
            if capture is not None:
                pd = route.request.post_data or ""
                m = _re.search(r'name="client_msg_id"\r?\n\r?\n([^\r\n]+)', pd)
                if m:
                    capture["client_msg_id"] = m.group(1).strip()
        except Exception:
            pass  # capture is best-effort; the stream must fulfill regardless
        route.fulfill(status=200, content_type="text/event-stream", body=sse_body)

    page.route("**/api/chat_stream", _handler)


def _route_history(page, sid, history, capture=None):
    """Fulfill /api/history/{sid}. Built lazily at fetch time so the user row can carry the
    just-captured client_msg_id (the reconcile runs after the stream settles)."""

    def _handler(route):
        rows = []
        for m in history:
            row = dict(m)
            if capture and row.get("role") == "user" and capture.get("client_msg_id"):
                md = dict(row.get("metadata") or {})
                md["client_msg_id"] = capture["client_msg_id"]
                row["metadata"] = md
            rows.append(row)
        route.fulfill(status=200, content_type="application/json",
                      body=json.dumps({"history": rows, "model": "test-model"}))

    page.route(f"**/api/history/{sid}", _handler)


def _send(page, text):
    page.fill("#message", text)
    page.wait_for_timeout(150)
    page.evaluate("() => document.querySelector('.send-btn')?.click()")


def _wait_settled(page, timeout_ms=30000):
    page.wait_for_function(
        "() => { const b = document.querySelector('.send-btn');"
        "  return b && (b.dataset.mode || '') !== 'streaming' &&"
        "         !(document.getElementById('message') || {}).disabled; }",
        timeout=timeout_ms)
    page.wait_for_timeout(400)


def test_multi_round_turn_renders_one_growing_bubble(_app):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page()
        page.goto(_app + "/", wait_until="load", timeout=30000)
        page.wait_for_timeout(3500)
        sid = _open_session(page, _app, "coalesce-multi")

        user_turn = "walk me through the house"
        cap = {}
        _route_history(page, sid, capture=cap, history=[
            {"role": "user", "content": user_turn, "id": "u-829-multi", "seq": 1, "metadata": {}},
            {"role": "assistant", "content": _R1 + "\n\n" + _R2A + _R2B,
             "id": "m-829-multi", "seq": 2, "metadata": {
                "_db_id": "m-829-multi", "_seq": 2,
                "tool_events": [{"tool": "web_search", "round": 1, "command": "look around",
                                 "output": "ok", "exit_code": 0}],
                "round_texts": [_R1, _R2A + _R2B],
            }},
        ])
        _route_stream(page, _MULTI_ROUND, capture=cap)
        page.evaluate(_OBSERVER)
        _send(page, user_turn)
        _wait_settled(page)

        s = page.evaluate(_SETTLED)
        obs = page.evaluate("() => window.__c829")
        # Mark the settled node, let the post-turn reconcile run, then prove zero-churn adoption.
        page.evaluate("() => { const ai = document.querySelectorAll('#chat-history .msg.msg-ai');"
                      " const el = ai[ai.length - 1]; if (el) el._c829witness = true; }")
        page.wait_for_timeout(2500)
        s2 = page.evaluate(_SETTLED)
        browser.close()

    # ONE assistant bubble — settled AND at every observed mutation batch (no per-round mounts).
    assert s["aiCount"] == 1, f"expected ONE turn bubble, got {s['aiCount']}: {s}"
    assert obs["maxAi"] <= 1, f"a second assistant bubble appeared mid-turn: {obs}"
    assert s["continuations"] == 0, "no msg-continuation bubbles may exist under coalescing"
    # It GREW: round 1 froze as a committed block, round 2 flattened into another.
    assert s["committed"] >= 2, f"expected >=2 committed round blocks, got {s['committed']}"
    i1, i2 = s["pub"].find(_R1), s["pub"].find(_R2A)
    assert i1 != -1 and i2 != -1 and i1 < i2, f"both rounds' narration, in order, expected: {s['pub']!r}"
    # The observer must have actually recorded the stream (a zero-batch run is a vacuous pass).
    assert obs["batches"] > 0, f"the DOM observer never fired — vacuous run: {obs}"
    # No vanish once narration was visible (the #825 'first message disappears' class).
    assert obs["sawNarration"] and not obs["narrationVanished"], f"narration vanished mid-turn: {obs}"
    # Reply/reasoning split: reasoning in the accordion only, never the public body.
    assert _REASONING not in s["pub"], "reasoning leaked into the public bubble"
    assert "secret plan" in s["think"], (
        "reasoning must live in the thinking accordion: " + repr(s["html"][:2500]))
    # Merged-buffer consumers see the full turn (persistence/copy/TTS cache).
    assert _R1 in s["raw"] and _R2B in s["raw"], f"dataset.raw must carry the merged turn: {s['raw']!r}"
    assert "secret plan" in s["raw"], "dataset.raw is the MERGED buffer (reply + <think> reasoning)"
    assert s["hasFooter"], "the settled turn bubble must carry the message footer"
    # The post-turn reconcile ADOPTED the live bubble (no rebuild): same node, still 1 bubble,
    # and it never became a from-history re-render.
    assert s2["aiCount"] == 1 and s2["witness"] and s2["fromHistory"] == "", (
        f"reconcile must adopt the coalesced live bubble with zero churn, not rebuild it: {s2}"
    )


def test_single_round_turn_renders_the_classic_form(_app):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page()
        page.goto(_app + "/", wait_until="load", timeout=30000)
        page.wait_for_timeout(3500)
        sid = _open_session(page, _app, "coalesce-single")
        cap = {}
        _route_history(page, sid, capture=cap, history=[
            {"role": "user", "content": "hello", "id": "u-829-single", "seq": 1, "metadata": {}},
            {"role": "assistant", "content": "A plain single-round reply renders exactly as before.",
             "id": "m-829-single", "seq": 2, "metadata": {"_db_id": "m-829-single", "_seq": 2}},
        ])
        _route_stream(page, _SINGLE_ROUND, capture=cap)
        _send(page, "hello")
        _wait_settled(page)
        s = page.evaluate(_SETTLED)
        browser.close()

    assert s["aiCount"] == 1
    # Single-round: NO committed blocks — the classic whole-body render (no behavior change).
    assert s["committed"] == 0, f"a single-round turn must not grow committed blocks: {s}"
    assert "renders exactly as before" in s["pub"]
    assert s["continuations"] == 0


def test_tool_first_turn_settles_visible_no_hang(_app):
    """The exact #825 breakage shape: round 1 pure tool (no narration) → the bubble hides while
    the tool runs, re-shows for round 2, and the turn SETTLES with the narration visible and the
    send button back to idle — no first-message hang, no disappeared message."""
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page()
        page.goto(_app + "/", wait_until="load", timeout=30000)
        page.wait_for_timeout(3500)
        sid = _open_session(page, _app, "coalesce-toolfirst")
        cap = {}
        _route_history(page, sid, capture=cap, history=[
            {"role": "user", "content": "first message", "id": "u-829-tf", "seq": 1, "metadata": {}},
            {"role": "assistant",
             "content": "The first visible narration arrives in round two and must not vanish.",
             "id": "m-829-toolfirst", "seq": 2, "metadata": {
                 "_db_id": "m-829-toolfirst", "_seq": 2,
                 "tool_events": [{"tool": "web_search", "round": 1,
                                  "command": "silent context pull", "output": "ok", "exit_code": 0}],
                 "round_texts": ["", "The first visible narration arrives in round two and must not vanish."],
             }},
        ])
        _route_stream(page, _TOOL_FIRST, capture=cap)
        _send(page, "first message")
        _wait_settled(page)   # would time out on the #825 hang
        s = page.evaluate(_SETTLED)
        browser.close()

    assert s["aiCount"] == 1, f"the turn bubble must be visible after settle: {s}"
    assert "must not vanish" in s["pub"], f"round-2 narration missing (disappeared message): {s}"
    assert s["btnMode"] != "streaming" and not s["inputDisabled"], (
        f"send button/composer stuck streaming (the #825 hang): {s}"
    )
    # The turn bubble owns the header — role + timestamp — even though round 1 was tool-only (#834).
    # (The header is the initial holder's; it was hidden during round 1 and re-shown, never lost.)


def test_reload_form_matches_live_form(_app):
    """chatRenderer.addMessage renders a multi-round agent message as the SAME single-bubble form
    the live stream leaves, and the reconcile oracle counts it as ONE bubble (0 for beats-only)."""
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page()
        page.goto(_app + "/", wait_until="load", timeout=30000)
        page.wait_for_timeout(3500)
        out = page.evaluate(r"""
() => {
  const meta = {
    tool_events: [{ tool: 'web_search', round: 1, command: 'x', output: 'ok', exit_code: 0 },
                  { tool: 'web_search', round: 2, command: 'y', output: 'ok', exit_code: 0 }],
    round_texts: ['First round narration.', '', 'Third round narration.'],
    _db_id: 'm-reload-829', timestamp: Date.now() / 1000,
  };
  const box = document.getElementById('chat-history');
  const before = box.querySelectorAll('.msg.msg-ai').length;
  window.chatModule.addMessage('assistant', 'First round narration.\n\nThird round narration.',
                               'test-model', meta);
  const ai = Array.from(box.querySelectorAll('.msg.msg-ai')).slice(before);
  const bubble = ai[ai.length - 1];
  const body = bubble && bubble.querySelector('.body');
  const oracle = window.chatModule._expectedVisibleBubbleCount;
  return {
    added: ai.length,
    continuations: ai.filter(el => el.classList.contains('msg-continuation')).length,
    committed: body ? body.querySelectorAll('.committed-round').length : -1,
    text: body ? (body.textContent || '').trim() : '',
    hasTimestamp: !!(bubble && bubble.querySelector('.role .role-timestamp')),
    rails: box.querySelectorAll('.agent-thread').length,
    oracleMulti: oracle([{ role: 'assistant', content: 'x', metadata: meta }]),
    oracleBeatsOnly: oracle([{ role: 'assistant', content: '',
      metadata: { tool_events: [{ tool: 't', round: 1 }], round_texts: [''] } }]),
    oraclePlain: oracle([{ role: 'assistant', content: 'hi', metadata: {} }]),
  };
}
""")
        browser.close()

    assert out["added"] == 1, f"reload must render ONE bubble per agent message: {out}"
    assert out["continuations"] == 0
    assert out["committed"] == 2, f"one committed block per non-empty round: {out}"
    i1, i2 = out["text"].find("First round"), out["text"].find("Third round")
    assert i1 != -1 and i2 != -1 and i1 < i2, f"every narration round, in order: {out['text']!r}"
    assert out["hasTimestamp"], "#834: the turn bubble carries the role timestamp"
    assert out["rails"] >= 1, "the production rail renders below the bubble"
    assert out["oracleMulti"] == 1 and out["oracleBeatsOnly"] == 0 and out["oraclePlain"] == 1, (
        f"the reconcile oracle must count 1 per narrated agent message / 0 beats-only: {out}"
    )
