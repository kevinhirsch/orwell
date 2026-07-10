"""WebSocket Phase-1 — the gamechanged session-race guard (Blocker 2 / the WS turn-on gate).

`orwell:gamechanged` is the ONE g15 dispatcher and it fires on EVERY game mutation — including
MID-TURN (each game-mutating tool result dispatches it). The client's `orwellWs.js` re-issues a
`bind` on that event (§2.3). The race this pins: a rebind must NOT tear down the in-flight `chat`
channel and full-replay from `fromSeq:0` on a SAME-canonical gamechanged. Doing so races the live
stream (a duplicate replay) and — at the casting→started settle, when the bind resolves onto a
DIFFERENT/empty canonical — swaps the subscription off the session carrying the just-streamed reply
and STRIPS it (the #1085/#1086 window-collapse / reply-strip class, now over WS). That is exactly the
regression the two-window parity turn-on cannot ship with.

The contract, pinned here:
  • a SAME-id gamechanged rebind → NO new `chat` subscribe (the live tail is left intact),
    but the state/hud edges ARE re-armed (the HUD push keystone stays live);
  • a CHANGED-id rebind (adoption / season-reset re-resolve) → a `chat` subscribe from `fromSeq:0`
    IS sent (a genuine re-point onto the new session's history).

BEHAVIORAL — the REAL orwellWs.js in Node against a stubbed WebSocket. Plus a STRUCTURAL pin so a
revert to the unconditional `_subscribeChat(0)` fails. Roles only; no names.
"""

import os
import shutil
import subprocess

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(FRONTEND, "static", "js")


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


# ── BEHAVIORAL — the real orwellWs.js, in Node ───────────────────────────────────

_HARNESS = r"""
const fs = require("node:fs");
const src = fs.readFileSync(process.argv[1], "utf8");
function assert(c, m) { if (!c) { throw new Error("ASSERT: " + m); } }
process.on("unhandledRejection", (e) => { console.error(e); process.exit(1); });
const tick = () => new Promise((r) => setImmediate(r));

let lastSock = null;
function boot() {
  global.CustomEvent = function (t, i) { this.type = t; this.detail = i && i.detail; };
  global.WebSocket = function (url) {
    this.url = url; this.readyState = 0; this.sent = [];
    this.send = (s) => this.sent.push(JSON.parse(s));
    this.close = () => { this.readyState = 3; };
    lastSock = this;
  };
  const listeners = {};
  global.window = {
    API_BASE: "", ORWELL_WS_TRANSPORT: true,
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    removeEventListener() {},
    dispatchEvent(e) { (listeners[e.type] || []).forEach((fn) => { try { fn(e); } catch (_) {} }); return true; },
    location: { protocol: "https:", host: "example.test" },
    sessionModule: { getCurrentSessionId() { return "sess_live"; } },
  };
  global.document = { readyState: "complete", body: { dataset: { gameBuild: "1" } }, addEventListener() {} };
  global.window.document = global.document;
  delete global.window.OrwellWs;
  (0, eval)(src);
  return { WS: global.window.OrwellWs, listeners };
}

// Full handshake → ws-active, chat subscribed (fromSeq 0), on canonical `canon`.
async function handshake(canon, beat) {
  lastSock.readyState = 1; lastSock.onopen();
  const hello = lastSock.sent.find((f) => f.t === "hello" || f.t === "bind");
  lastSock.onmessage({ data: JSON.stringify({ t: "ack", cid: hello.cid,
    d: { canonicalId: canon, live: true, beatSeq: beat } }) });
  await tick();
  const sub = lastSock.sent.find((f) => f.t === "subscribe" && f.ch === "chat");
  lastSock.onmessage({ data: JSON.stringify({ t: "ack", ch: "chat", cid: sub.cid,
    d: { fromSeq: 0, headSeq: -1 } }) });
  await tick();
}

function chatSubs(sock) { return sock.sent.filter((f) => f.t === "subscribe" && f.ch === "chat"); }
function edgeSubs(sock) {
  return {
    state: sock.sent.filter((f) => f.t === "subscribe" && f.ch === "state"),
    hud: sock.sent.filter((f) => f.t === "subscribe" && f.ch === "hud"),
  };
}

// Fire a gamechanged and answer the bind with `ackCanon` (same or changed id).
async function gamechangedRebind(ackCanon, beat) {
  global.window.dispatchEvent({ type: "orwell:gamechanged" });
  await tick();
  const bind = lastSock.sent.find((f) => f.t === "bind");
  assert(bind, "orwell:gamechanged should trigger a bind");
  lastSock.onmessage({ data: JSON.stringify({ t: "ack", cid: bind.cid,
    d: { canonicalId: ackCanon, live: true, beatSeq: beat } }) });
  await tick(); await tick();
  return bind;
}

(async function main() {
  // ── scenario 1: a SAME-id, MID-TURN gamechanged must NOT restart the chat channel ──
  {
    const { WS } = boot();
    await handshake("sess_live", 118);
    // Render an in-flight turn tail: seq 0,1 (highestChatSeq → 1).
    lastSock.onmessage({ data: JSON.stringify({ t: "event", ch: "chat", seq: 0, d: { delta: "a" } }) });
    lastSock.onmessage({ data: JSON.stringify({ t: "event", ch: "chat", seq: 1, d: { delta: "b" } }) });
    assert(WS.highestChatSeq() === 1, "rendered tail advances the chat cursor");
    const chatBefore = chatSubs(lastSock).length;      // 1 (the handshake subscribe)
    const edgeBefore = edgeSubs(lastSock);

    // The mutation mid-turn: gamechanged, bind resolves onto the SAME canonical.
    await gamechangedRebind("sess_live", 119);

    // THE RACE GUARD: no NEW chat subscribe — the live tail is untouched.
    assert(chatSubs(lastSock).length === chatBefore,
      "a same-id gamechanged must NOT re-subscribe chat (no full-replay restart mid-turn); got "
      + chatSubs(lastSock).length + " want " + chatBefore);
    assert(WS.isChatSubscribed() === true, "chat stays subscribed across a same-id rebind");
    // ...but the HUD push edges are re-armed (the keystone stays live).
    const edgeAfter = edgeSubs(lastSock);
    assert(edgeAfter.state.length === edgeBefore.state.length + 1, "rebind re-arms the state edge");
    assert(edgeAfter.hud.length === edgeBefore.hud.length + 1, "rebind re-arms the hud edge");
    assert(WS.canonicalId() === "sess_live", "canonical id preserved on a same-id rebind");
  }

  // ── scenario 2: a CHANGED-id rebind (adoption / season-reset) DOES re-point chat ───
  {
    const { WS } = boot();
    await handshake("sess_live", 200);
    const chatBefore = chatSubs(lastSock).length;      // 1
    // The bind resolves onto a DIFFERENT canonical (first-writer-wins adoption / reset).
    await gamechangedRebind("sess_other", 201);
    const after = chatSubs(lastSock);
    assert(after.length === chatBefore + 1,
      "a changed-id rebind MUST re-subscribe chat (a real re-point); got " + after.length);
    // The re-point takes the full history (fromSeq 0) on the new session.
    assert(after[after.length - 1].d.fromSeq === 0,
      "a changed-id re-point subscribes from fromSeq 0 (new session history)");
    assert(WS.canonicalId() === "sess_other", "canonical id adopts the new id");
  }

  // ── scenario 3: overlapping gamechanged rebinds coalesce into ONE bind ─────────────
  {
    const { WS } = boot();
    await handshake("sess_live", 300);
    const bindsBefore = lastSock.sent.filter((f) => f.t === "bind").length;  // 0
    // Two gamechanged before either bind is acked → the second must not stack a bind.
    global.window.dispatchEvent({ type: "orwell:gamechanged" });
    global.window.dispatchEvent({ type: "orwell:gamechanged" });
    await tick();
    const binds = lastSock.sent.filter((f) => f.t === "bind");
    assert(binds.length === bindsBefore + 1,
      "overlapping gamechanged rebinds must coalesce into ONE in-flight bind; got " + binds.length);
    // Answer it; a later gamechanged can rebind again (the guard cleared).
    lastSock.onmessage({ data: JSON.stringify({ t: "ack", cid: binds[0].cid,
      d: { canonicalId: "sess_live", live: true, beatSeq: 301 } }) });
    await tick(); await tick();
    global.window.dispatchEvent({ type: "orwell:gamechanged" });
    await tick();
    assert(lastSock.sent.filter((f) => f.t === "bind").length === 2,
      "a later gamechanged rebinds again once the prior bind settled");
  }

  // ── scenario 4: a re-entrant gamechanged DURING an in-flight rebind must not double-subscribe ──
  // (CodeRabbit Major 1) `_rebinding` is held across the ENTIRE rebind — the bind AND the
  // conditional `_subscribeChat(0)` — so a second gamechanged that arrives before the chat
  // subscribe's ack (while `_chatSubscribed` is still false) cannot fire a SECOND full-history
  // chat subscribe on the same canonical id (the double-replay this PR exists to prevent).
  {
    const { WS } = boot();
    await handshake("sess_live", 400);
    const chatBefore = chatSubs(lastSock).length;                            // 1
    const bindsBefore = lastSock.sent.filter((f) => f.t === "bind").length;  // 0

    // gamechanged #1 → bind sent; ack it with a CHANGED canonical so the rebind fires
    // `_subscribeChat(0)` — but do NOT ack that chat subscribe, so `_chatSubscribed` stays false
    // and the coalescing guard stays HELD across the in-flight subscribe.
    global.window.dispatchEvent({ type: "orwell:gamechanged" });
    await tick();
    const bind1 = lastSock.sent.find((f) => f.t === "bind");
    assert(bind1, "gamechanged should send a bind");
    lastSock.onmessage({ data: JSON.stringify({ t: "ack", cid: bind1.cid,
      d: { canonicalId: "sess_other", live: true, beatSeq: 401 } }) });
    await tick(); await tick();
    assert(chatSubs(lastSock).length === chatBefore + 1, "a changed-id rebind issues ONE chat re-subscribe");
    assert(WS.isChatSubscribed() === false, "chat subscribe not yet acked => still not subscribed");

    // A SECOND gamechanged re-enters WHILE the chat subscribe is in flight. Pre-fix (guard released
    // at the bind ack) this fired another bind + another `_subscribeChat(0)` → double replay.
    global.window.dispatchEvent({ type: "orwell:gamechanged" });
    await tick(); await tick();
    assert(lastSock.sent.filter((f) => f.t === "bind").length === bindsBefore + 1,
      "a re-entrant gamechanged during an in-flight rebind must NOT send a second bind");
    assert(chatSubs(lastSock).length === chatBefore + 1,
      "a re-entrant gamechanged during an in-flight rebind must NOT double-subscribe chat");

    // Ack the chat subscribe → subscribed + guard released; a later same-id gamechanged is quiet.
    const lastChatSub = chatSubs(lastSock)[chatSubs(lastSock).length - 1];
    lastSock.onmessage({ data: JSON.stringify({ t: "ack", ch: "chat", cid: lastChatSub.cid,
      d: { fromSeq: 0, headSeq: -1 } }) });
    await tick(); await tick();
    assert(WS.isChatSubscribed() === true, "chat subscribe ack marks subscribed + releases the guard");
    global.window.dispatchEvent({ type: "orwell:gamechanged" });
    await tick();
    const laterBind = lastSock.sent.filter((f) => f.t === "bind");
    lastSock.onmessage({ data: JSON.stringify({ t: "ack", cid: laterBind[laterBind.length - 1].cid,
      d: { canonicalId: "sess_other", live: true, beatSeq: 402 } }) });
    await tick(); await tick();
    assert(chatSubs(lastSock).length === chatBefore + 1,
      "after settle, a same-id gamechanged still does not re-subscribe chat");
  }

  console.log("OK");
  process.exit(0);
})();
"""


def _run_node(harness, modpath):
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available for the behavioral gamechanged-race check")
    proc = subprocess.run(
        [node, "-e", harness, modpath],
        capture_output=True, text=True, timeout=30,
    )
    assert proc.returncode == 0, f"node failed: {proc.stdout}\n{proc.stderr}"
    return proc.stdout


def test_same_id_gamechanged_does_not_restart_chat():
    out = _run_node(_HARNESS, os.path.join(STATIC, "orwellWs.js"))
    assert "OK" in out


# ── STRUCTURAL — pin the conditional so a revert to unconditional _subscribeChat(0) fails ─

WS = _read("static", "js", "orwellWs.js")


def test_rebind_gates_the_chat_resubscribe_on_a_canonical_change():
    # The rebind body must gate its `_subscribeChat(` on a canonical-id change — NOT call it
    # unconditionally (the pre-fix bug that restarted the chat stream on every gamechanged).
    body = WS.split("function rebind")[1].split("\n  function ")[0]
    assert "_subscribeChat(" in body, "rebind still re-points chat on a genuine change"
    assert "prevCanonical" in body, "rebind must capture the prior canonical id to compare"
    assert "_canonicalId !== prevCanonical" in body, \
        "rebind must guard the chat re-subscribe on an actual canonical change"
    # Edges are still re-armed every rebind (the HUD push keystone).
    assert "_subscribeEdges()" in body, "rebind must still re-arm the state/hud edges"


def test_rebind_coalesces_overlapping_binds():
    body = WS.split("function rebind")[1].split("\n  function ")[0]
    assert "_rebinding" in body, "rebind must coalesce overlapping gamechanged rebinds"
    # The in-flight guard is cleared on teardown so a drop mid-bind never wedges future rebinds.
    assert WS.count("_rebinding = null") >= 3, \
        "_rebinding must be cleared on settle AND on onclose/_goFallback teardown"


def test_rebind_guard_is_held_across_the_whole_operation_not_just_the_bind():
    # CodeRabbit Major 1: the guard must be released only after the WHOLE chain settles (the bind
    # AND the conditional _subscribeChat), never at the bind ack. The conditional branch RETURNS the
    # subscribe promise (so `_rebinding` stays held until the chat ack), and the release is a
    # post-settle handler guarded so a fresh rebind isn't clobbered.
    body = WS.split("function rebind")[1].split("\n  function ")[0]
    assert "return _subscribeChat(0)" in body, \
        "the chat re-point must RETURN its subscribe promise so the guard is held until it settles"
    assert "_rebinding === settled" in body, \
        "the guard release must be gated so a stale settle can't clobber a fresh rebind"
    # And it must NOT clear the guard synchronously inside the bind-ack .then (the pre-fix bug).
    then_head = body.split(".then(function (ack)")[1].split("return")[0] if ".then(function (ack)" in body else ""
    assert "_rebinding = null" not in then_head, \
        "the guard must not be released at the bind ack (before the chat subscribe settles)"
