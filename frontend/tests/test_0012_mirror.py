"""ADR 0012 — the two-window lockstep "Messenger mirror" behavioral gates.

§3.2 (this file, for now): the `message-added` completion broadcast must fire on the STREAMING
save path (`ChatSession.add_message` → `_persist_message`) — the **dead leg** that previously
bypassed the broadcast living only in `SessionManager.add_message`. With the broadcast moved into
the shared `_persist_message` primitive, EVERY persist path publishes the authoritative `{id, seq}`
exactly once, so two windows reconcile by id instead of drifting until a late poll/reconcile.

Name-agnostic; exercises the real `SessionManager` persist path against the test DB. Roles only.
"""
import pytest

from core.session_manager import SessionManager
from core.models import ChatMessage, set_session_manager
import core.models as core_models


@pytest.fixture
def sm():
    manager = SessionManager()
    prior = getattr(core_models, "_session_manager", None)
    set_session_manager(manager)          # so ChatSession.add_message persists through the manager
    yield manager
    set_session_manager(prior)


def _capture_publish(monkeypatch):
    from src import session_events as se
    events = []
    monkeypatch.setattr(se, "publish", lambda *a, **k: events.append(a))
    return events


def test_streaming_save_path_broadcasts_message_added(sm, monkeypatch):
    # The dead leg: ChatSession.add_message → _persist_message. Before ADR 0012 it persisted but
    # never published message-added (the broadcast lived only in SessionManager.add_message). Now the
    # shared primitive broadcasts, so the streaming save path fires exactly one completion event.
    events = _capture_publish(monkeypatch)
    sid = "adr0012-deadleg"
    sm.create_session(sid, "n", "http://x", "m", owner="u")
    sess = sm.get_session(sid)
    sess.add_message(ChatMessage("assistant", "a streamed reply", metadata={"client_msg_id": "tmp-1"}))

    added = [e for e in events if len(e) >= 2 and e[1] == "message-added"]
    assert len(added) == 1, "the streaming save path must publish exactly one message-added"
    _sid, _etype, payload = added[0]
    assert _sid == sid
    assert payload["role"] == "assistant"
    assert payload["seq"] == 0 and payload["id"], "the broadcast carries the authoritative {id, seq}"
    assert payload["client_msg_id"] == "tmp-1", "the optimistic client id rides along for adoption"
    assert "content" not in payload, "Vault-free / cross-user-safe: never the message body"


def test_manager_add_message_broadcasts_exactly_once(sm, monkeypatch):
    # SessionManager.add_message also persists via _persist_message; it must still broadcast, and
    # exactly once (no double-publish now that the broadcast moved into the shared primitive).
    events = _capture_publish(monkeypatch)
    sid = "adr0012-once"
    sm.create_session(sid, "n", "http://x", "m", owner="u")
    sm.add_message(sid, ChatMessage("user", "hi", metadata={}))
    added = [e for e in events if len(e) >= 2 and e[1] == "message-added"]
    assert len(added) == 1, "exactly one broadcast per persisted message (no double-publish)"


def test_each_message_gets_its_own_broadcast_in_seq_order(sm, monkeypatch):
    # A multi-message turn (user + assistant) yields one broadcast per persist, in seq order.
    events = _capture_publish(monkeypatch)
    sid = "adr0012-multi"
    sm.create_session(sid, "n", "http://x", "m", owner="u")
    sess = sm.get_session(sid)
    sess.add_message(ChatMessage("user", "u", metadata={}))
    sess.add_message(ChatMessage("assistant", "a", metadata={}))
    seqs = [e[2]["seq"] for e in events if len(e) >= 2 and e[1] == "message-added"]
    assert seqs == [0, 1], "one in-order broadcast per persisted message"


# ───────────────────────────────────────────────────────────────────────────────────────────────
# §3.1 — the server keys the framed run on the CANONICAL game session (the split-brain fix)
# ───────────────────────────────────────────────────────────────────────────────────────────────

import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


def test_framed_run_keyed_on_canonical_session():
    """(a) A framed /api/chat_stream turn must key agent_runs.start / run-started / subscribe on the
    CANONICAL game session (ctx.canonical_session), NOT the per-tab session — so two windows on one
    game share ONE authoritative run (the Messenger mirror). The live two-window test caught the
    split-brain (A=2 msgs, B=12 — different games) precisely because the run was per-tab keyed."""
    src = _read("routes", "chat_routes.py")
    # run_key resolves to the canonical session for a framed turn, the per-tab session otherwise.
    assert '_framed = bool(getattr(ctx, "framed", False))' in src
    assert 'run_key = (getattr(ctx, "canonical_session", None) or session) if _framed else session' in src
    # all three fan-out keys use run_key (the start, the run-started invitation, the subscribe).
    assert "agent_runs.start(run_key, _safe_stream(), queue=_framed)" in src
    assert 'session_events.publish(run_key, "run-started")' in src
    assert "agent_runs.subscribe(run_key)" in src


def test_ctx_exposes_canonical_session_for_framed_turn():
    """ctx.canonical_session is the first-writer-wins bound session for a framed turn (so the run can
    key on it); the per-tab session for a non-framed turn (byte-identical single-chat behavior)."""
    src = _read("routes", "chat_helpers.py")
    assert "canonical_session: Optional[str] = None" in src
    assert "def _resolve_canonical_session" in src
    assert "orwell_game_session.get_game_session(user) or session_id" in src
    assert "canonical_session=_resolve_canonical_session(user, session_id, framed)" in src


def test_loser_window_gets_a_canonical_session_adopt_signal():
    """§2.4: a window that POSTed under its own per-tab id while the run lives under canonical gets an
    early `canonical_session` SSE event (sender-private — NOT in the shared replay buffer) so it
    adopts the canonical session client-side. Persistence stays on `session` (the SAFE choice), so
    this is the defensive belt for the rare un-converged window."""
    src = _read("routes", "chat_routes.py")
    assert "if run_key != session:" in src
    assert '{"type": "canonical_session", "id": run_key}' in src


def test_message_saved_carries_server_timestamp():
    """§2.2/§3.3: the message_saved completion event carries the SERVER-minted timestamp so every
    window renders the identical time string (the sender no longer keeps its own `new Date()`)."""
    src = _read("routes", "chat_routes.py")
    # both save sites (chat mode + agent mode) emit the server ts on message_saved.
    assert src.count('"type": "message_saved", "id": _saved_id, "ts": _last_message_ts(sess)') == 2
    helpers = _read("routes", "chat_helpers.py")
    assert "def _last_message_ts(sess)" in helpers
    assert 'return _meta.get("timestamp")' in helpers


# ───────────────────────────────────────────────────────────────────────────────────────────────
# §3.4b — the durable run-started invitation: session_events replays its ring on (re)connect
# ───────────────────────────────────────────────────────────────────────────────────────────────

import asyncio
import importlib

session_events = importlib.import_module("src.session_events")


def _run(coro):
    """Reused-loop runner (the repo async-test idiom — never asyncio.run, which poisons get_event_loop
    for later tests)."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


async def _drain_subscribe(sid, *, max_events=12, timeout=0.5):
    """Open a session_events subscription, collect what it yields (the connected hello + any ring
    replay), and stop once it goes quiet — so a late-connecting window's replayed invitation is
    observable without hanging on the live keepalive loop."""
    out = []
    agen = session_events.subscribe(sid)
    try:
        while len(out) < max_events:
            try:
                ev = await asyncio.wait_for(agen.__anext__(), timeout=timeout)
            except (asyncio.TimeoutError, StopAsyncIteration):
                break
            if ev.startswith(": keepalive"):  # reached the idle heartbeat — nothing more to replay
                break
            out.append(ev)
    finally:
        await agen.aclose()
    return out


def test_subscribe_replays_a_run_started_published_before_connect():
    """(b) §3.4b: publish is at-most-once (`if not subs: return`). A run-started fired in the gap
    between a window selecting the session and its SSE connecting was dropped, so an idle peer missed
    the invitation to attach to the shared run. The per-session replay ring fixes it: a window that
    subscribes AFTER the publish still receives the run-started on connect."""
    async def main():
        sid = "adr0012-ring-late"
        # No subscribers yet — the publish would historically be lost.
        session_events.publish(sid, "run-started")
        # A window connects AFTER the publish; it must still see the invitation replayed.
        return await _drain_subscribe(sid)

    out = _run(main())
    assert any("event: connected" in ev for ev in out), "the connected hello is always first"
    assert any("event: run-started" in ev for ev in out), \
        "the run-started published before connect must be REPLAYED on subscribe (the §3.4b ring)"


def test_ring_replays_recent_invitations_but_not_unbounded():
    """The ring is bounded and only carries invitation-class events (run-started / message-added) —
    not every event type, and not an unbounded log."""
    async def main():
        sid = "adr0012-ring-bounded"
        # A non-invitation event must NOT be ringed (it's not an attach signal).
        session_events.publish(sid, "game-updated")
        session_events.publish(sid, "message-added", {"id": "x", "seq": 0})
        return await _drain_subscribe(sid)

    out = _run(main())
    replayed = [ev for ev in out if ev.startswith("event:") and "connected" not in ev]
    assert any("message-added" in ev for ev in replayed), "an invitation event is replayed"
    assert not any("game-updated" in ev for ev in replayed), \
        "a non-invitation event must NOT be ringed (avoid reconnect noise)"


def test_ring_dropped_when_last_viewer_leaves():
    """When the last viewer disconnects the ring is dropped, so a window reconnecting much later
    isn't handed a stale invitation to a long-finished run."""
    async def main():
        sid = "adr0012-ring-drop"
        session_events.publish(sid, "run-started")
        # First subscriber connects and immediately leaves (drain returns once quiet, then aclose()).
        await _drain_subscribe(sid)
        return session_events._ring_snapshot(sid)

    snapshot = _run(main())
    assert snapshot == [], "the ring is cleared once no viewers remain"


# ───────────────────────────────────────────────────────────────────────────────────────────────
# (c) — two windows' history is identical after a framed turn (no persistence split)
# ───────────────────────────────────────────────────────────────────────────────────────────────

def test_two_windows_share_one_history_under_the_canonical_session(sm):
    """(c) Both windows on one game read the SAME history because the turn persists under ONE
    canonical session id (client convergence makes `session == run_key`, so the user + assistant
    turns land on the canonical chat). Two reads of the canonical session — the two windows — see an
    identical message log; nothing is split across two ids."""
    canonical = "adr0012-canon"
    sm.create_session(canonical, "n", "http://x", "m", owner="u")
    sess = sm.get_session(canonical)
    sess.add_message(ChatMessage("user", "a player line", metadata={"client_msg_id": "tmp-A"}))
    sess.add_message(ChatMessage("assistant", "the house replies", metadata={}))

    # "Window A" and "window B" each read the canonical session's settled history.
    win_a = [(m.role, m.content, m.metadata.get("_seq")) for m in sm.get_session(canonical).history]
    win_b = [(m.role, m.content, m.metadata.get("_seq")) for m in sm.get_session(canonical).history]
    assert win_a == win_b, "two windows on the canonical session read an identical history (no split)"
    assert [r for r, _, _ in win_a] == ["user", "assistant"]
    assert [s for _, _, s in win_a] == [0, 1], "the canonical log carries one monotonic seq order"


def test_persistence_is_not_split_route_keeps_save_on_the_run_session():
    """Drift pin for the SAFE choice in §3.1's persistence-split risk row: the route keeps the turn's
    persistence on `session` (NOT a second canonical id) — client convergence makes session == run_key
    on a normal in-game load, and the loser window adopts via the canonical_session event. So the save
    sites still write to `session`, never a divergent id."""
    src = _read("routes", "chat_routes.py")
    # the saves pass `session` (the per-tab id, which == canonical once converged), not run_key. The
    # save call's positional args are `sess, session_manager, session, ...` — whitespace-insensitive.
    import re
    saves = re.findall(r"save_assistant_response\(\s*sess,\s*session_manager,\s*(\w+),", src)
    assert saves and all(arg == "session" for arg in saves), \
        f"the save sites must persist under `session` (not run_key) — found {saves}"
    # and the run key is the canonical-aware run_key, distinct from the persist key.
    assert "agent_runs.start(run_key," in src


# ───────────────────────────────────────────────────────────────────────────────────────────────
# §3.3 — client: ONE render path (shared canonical renderer + server timestamps), canonical ladder
# ───────────────────────────────────────────────────────────────────────────────────────────────

def test_chat_client_uses_server_timestamp_not_client_new_date():
    """§2.2/§3.3: the live bubble's role-timestamp is RE-STAMPED from the server-minted time (carried
    on message_saved), and the settled render (resumeStream finalize + history reload) uses the same
    server timestamp — so every window renders the identical time string instead of each minting its
    own `new Date()` at a different instant."""
    chat = _read("static", "js", "chat.js")
    # the shared server-timestamp helper exists and both paths use it.
    assert "function _applyServerTimestamp(holderEl, iso)" in chat
    # primary loop: message_saved carries `ts` and re-stamps the bubble.
    assert "if (json.ts && currentHolder) _applyServerTimestamp(currentHolder, json.ts);" in chat
    # resumeStream: captures the server ts off the replayed message_saved and carries it into finalize.
    assert "if (json.ts) { serverTs = json.ts; _applyServerTimestamp(holder, serverTs); }" in chat
    assert "if (serverTs) meta_.timestamp = serverTs;" in chat


def test_chat_client_shared_canonical_render_shape():
    """ADR 0012 §1/§3.3: both the sender (POST) and the observer (resume) render reasoning through the
    SAME channel-split shape into the SAME renderer (processWithThinking), and finalize the settled
    message through the SAME canonical builder (chatRenderer.addMessage). The reasoning channel split
    is sacred — reasoning lives ONLY in the closed <think> accordion, never the public bubble."""
    chat = _read("static", "js", "chat.js")
    # the observer's canonical combined source: reasoning in a CLOSED think block, then the clean reply.
    assert "'<think>' + reasoningText + '</think>\\n\\n' + reply" in chat
    # both live paths route through processWithThinking (the single canonical renderer).
    assert chat.count("markdownModule.processWithThinking(") >= 2
    # the settled message is finalized through the one canonical bubble builder.
    assert "chatRenderer.addMessage('assistant', _combined(), model, meta_);" in chat


def test_chat_client_adopts_canonical_session_after_stream():
    """§2.4 client half: a loser window records the server's canonical_session id and converges onto
    it AFTER the stream settles (never a mid-stream history reload that would yank the live bubble)."""
    chat = _read("static", "js", "chat.js")
    assert "if (json.id) _adoptCanonicalAfterStream = json.id;" in chat
    assert "sessionModule.selectSession(_adoptCanonicalAfterStream" in chat


def test_sessions_ladder_has_a_canonical_game_step():
    """§1.4/§2.1/§3.3: the in-game session-resolution ladder gains a HIGHEST-priority canonical step —
    when a season is bound, force-select the bound game chat so a window opened fresh mid-game JOINS
    the shared game instead of forking a parallel one. Game-build gated, fail-open, and only when the
    bound id is a real session in the list (a cleared/dead binding no-ops)."""
    src = _read("static", "js", "sessions.js")
    assert "async function _resolveCanonicalGameSession()" in src
    assert "/api/orwell/game-session" in src
    # the canonical id is resolved at the TOP of the ladder and wins over hash/lastSessionId/pending.
    assert "if (_canonicalGameId) {" in src
    # the "must exist in the active list" guard so a stale id can't hijack onto a phantom.
    assert "!activeSessions.some(s => s.id === _canonicalGameId)" in src
    # the cache is invalidated on a game change (e.g. a next-season unbind) — listen only, never dispatch.
    assert "window.addEventListener('orwell:gamechanged'" in src


def test_onboarding_generalizes_canonical_convergence_to_in_game():
    """§3.3: the casting-only convergence is generalized — route() converges onto the canonical game
    chat on the STARTED-season branch too, so a fresh mid-game window joins the shared game."""
    src = _read("static", "js", "orwellOnboarding.js")
    assert "async function _convergeOnCanonicalGame()" in src
    # called from BOTH the casting open AND the started-season branch of route().
    assert src.count("_convergeOnCanonicalGame()") >= 2


def test_g15_single_dispatcher_not_violated_by_canonical_step():
    """The canonical-step cache invalidation must only LISTEN for orwell:gamechanged, never DISPATCH a
    new CustomEvent('orwell:gamechanged') (the g15 single-dispatcher invariant lives in platform.js)."""
    src = _read("static", "js", "sessions.js")
    assert "new CustomEvent('orwell:gamechanged'" not in src
    assert "new CustomEvent(\"orwell:gamechanged\"" not in src


# ───────────────────────────────────────────────────────────────────────────────────────────────
# ADR 0012 late-attach — a peer must be able to RESUME a run that just FINISHED (replay its buffer)
# ───────────────────────────────────────────────────────────────────────────────────────────────

import src.agent_runs as _agent_runs


def test_finished_run_is_still_resumable_within_grace():
    """A short turn FINISHES before a peer's run-started→resume arrives. `is_active` is already
    False, but `has_run` stays True while the run is buffered (evict grace) so the peer can RESUME
    and REPLAY the turn's tokens (subscribe() replays the buffer then ends). Gating resume on
    is_active 404'd the mirroring window and forced a reload (the cross-tab 'render on reload, not
    live' gap the live two-window test caught)."""
    async def main():
        async def quick():
            yield 'data: {"delta": "hi"}\n\n'
            yield "data: [DONE]\n\n"
        sid = "adr0012-finished-resumable"
        _agent_runs._RUNS.pop(sid, None)
        run = _agent_runs.start(sid, quick())
        await run.task  # drain to completion
        # subscribe must still replay the finished run's buffer for a late peer.
        replayed = []
        agen = _agent_runs.subscribe(sid)
        try:
            async for ev in agen:
                replayed.append(ev)
        finally:
            await agen.aclose()
        return _agent_runs.is_active(sid), _agent_runs.has_run(sid), "".join(replayed)
    active, exists, replay = _run(main())
    assert active is False, "a finished run is no longer 'active'"
    assert exists is True, "but it is still buffered (has_run) so a late peer can resume+replay it"
    assert '"delta": "hi"' in replay, "resume of a finished run REPLAYS its buffered tokens"


def test_chat_resume_gate_uses_has_run_not_is_active():
    """Source-pin: the resume route must gate on has_run (run exists, running OR buffered), not the
    stricter is_active — otherwise a just-finished run 404s the mirroring window."""
    src = _read("routes", "chat_routes.py")
    assert "if not agent_runs.has_run(session_id):" in src


# ───────────────────────────────────────────────────────────────────────────────────────────────
# GAP 1 — the ±1 cross-tab live-attach lag: a peer's run-started must RELIABLY attach, even when
# OUR own concurrent POST stream is in flight (so the `!hasActiveStream` guard would suppress it).
# Fix: defer the peer-resume and RE-ATTEMPT it the moment our own stream settles (perfect lock-step).
# ───────────────────────────────────────────────────────────────────────────────────────────────

def test_session_sync_defers_peer_resume_when_own_stream_active():
    """sessionSync's run-started handler: when WE are mid-stream for the same (canonical) session, it
    must NOT resume immediately (that double-renders our own run) — it DEFERS the attach instead of
    dropping it. Dropping it was the root cause of the transient one-window-behind ±1 (the observer
    only caught up on a later poll). The idle fast path (resume now) is preserved."""
    src = _read("static", "js", "sessionSync.js")
    # idle → resume immediately; busy (our own stream live) → defer (don't drop).
    assert "if (cm.hasActiveStream && cm.hasActiveStream(id)) {" in src
    assert "if (cm.deferPeerResume) cm.deferPeerResume(id);" in src
    assert "cm.resumeStream(id);" in src, "the idle fast path still attaches live immediately"


def test_chat_stream_end_reattempts_the_deferred_peer_resume():
    """chat.js: the stream-end finally must RE-ATTEMPT the deferred peer-resume once our own stream
    settles (_streamSessionId cleared ⇒ hasActiveStream false), so we mirror the peer's turn LIVE
    instead of waiting on a later reconcile. The peer run is durable (chained as the current
    _RUNS[canonical], resumable within the evict grace), so the deferred attach replays then tails."""
    src = _read("static", "js", "chat.js")
    assert "export function deferPeerResume(sessionId)" in src
    assert "export function flushPendingPeerResume(sessionId)" in src
    # the finally re-attempts the deferred peer-resume (sequenced AFTER the reconcile flush).
    assert "flushPendingPeerResume(streamSessionId)" in src
    # and the deferred-resume seam is exported on chatModule so sessionSync can reach it.
    assert "deferPeerResume," in src and "flushPendingPeerResume," in src


def test_flush_peer_resume_guards_against_double_render_and_wrong_session():
    """flushPendingPeerResume must only attach when we're still on the session AND nothing else is
    already rendering it live (hasActiveStream) — resumeStream's own guards make it idempotent, but
    the flush also short-circuits so a newer own-stream that took over keeps ownership of the render."""
    src = _read("static", "js", "chat.js")
    body = src.split("export function flushPendingPeerResume", 1)[1].split("export function", 1)[0]
    assert "_pendingPeerResume.has(id)" in body, "no-op unless a peer resume was actually deferred"
    assert "hasActiveStream(id)" in body, "don't attach if a newer stream already owns the live render"
    assert "resumeStream(id)" in body


# ───────────────────────────────────────────────────────────────────────────────────────────────
# GAP 2 — error-path consistency: on a model error the live SENDER shows the raw error ("Error 503")
# while the agent loop persists a FRIENDLY fallback (a peer/reload shows that). Two windows, different
# text. Fix: after the live error settles, the sender FORCE-reconciles its bubble to the persisted
# message so live + persisted + peer all converge to ONE string (live feedback kept; only SETTLED
# state reconciled).
# ───────────────────────────────────────────────────────────────────────────────────────────────

def test_error_path_forces_reconcile_to_persisted_message():
    """chat.js: an SSE error marks the turn so the stream-end finally FORCES a content rebuild (not
    just the id-adopt) of the sender's bubble to the persisted fallback — otherwise the error bubble
    keeps the raw 'Error 503' while a peer/reload shows the friendly message (two windows diverge)."""
    src = _read("static", "js", "chat.js")
    # the error handler still gives immediate live feedback AND marks the turn.
    assert "typewriterInto(roundHolder.querySelector('.body'), errMsg);" in src
    assert "_streamHadError = true;" in src
    # the finally arms the one-shot forced rebuild for this session.
    assert "if (_streamHadError) _forceRebuild.add(streamSessionId);" in src


def test_force_rebuild_is_honored_and_self_guarded_in_soft_reload():
    """softReloadHistory must (a) bypass the 'converged' short-circuit when forced (the error bubble
    may already carry the persisted {id, seq} but show the wrong CONTENT), and (b) SELF-GUARD so a
    hard fail that persisted NOTHING (server has fewer messages than rendered) keeps its live error
    bubble rather than the rebuild erasing it. The force is one-shot (consumed per reload)."""
    src = _read("static", "js", "chat.js")
    assert "let _forced = _forceRebuild.delete(sessionId);" in src, "one-shot consume of the force flag"
    assert "if (_forced && visible.length < renderedCount) _forced = false;" in src, \
        "self-guard: don't force-erase a live error bubble with no server replacement"
    assert "if (converged && !_forced)" in src, "forced reload bypasses the converged short-circuit"
    # if a live stream forces us to defer, the one-shot force must be RE-ARMED for the deferred flush.
    assert "if (_forced) _forceRebuild.add(sessionId);" in src


def test_pre_stream_provider_error_persists_friendly_fallback_not_raw_error():
    """The reconcile TARGET: confirm what the agent loop persists on a model error. The pre-stream
    503 (and the empty-response case) yield a FRIENDLY fallback — NOT the raw 'Error 503' — and that
    is the single string both windows must converge to. _empty_response_fallback is the source."""
    from src.agent_loop import _empty_response_fallback
    # empty content + no tools → the friendly fallback (yielded AND persisted as full_response).
    final, chunk = _empty_response_fallback("", "", [])
    assert "empty response" in final.lower(), "the persisted/peer text is the friendly fallback"
    assert "Error 503" not in final, "the raw provider error is NEVER the persisted text"
    assert chunk and "delta" in chunk, "the fallback is also streamed as a delta (so a fresh window sees it)"
    # real content is untouched (no fallback) — the error path is the ONLY divergence source here.
    final2, chunk2 = _empty_response_fallback("real narration", "", [])
    assert final2 == "real narration" and chunk2 is None
