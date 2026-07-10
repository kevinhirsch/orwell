"""Feature 0112 follow-up — the agent loop POPULATES the observability correlation context.

0112 (#1295) shipped the ``llm_trace.set_observability_context`` seam + the emit point that pulls
the current beat's correlation keys from it, but nothing set the context — so the live
``phase``/``moment``/``call_class``/``session``/``beatSeq`` keys were absent from every trace. This
suite proves ``src.agent_loop`` now wires the per-turn context (from the state the loop already
holds) and RESETS it at turn end so keys never leak across turns.

HARD: roles only, no names; Vault-free keys only (a test asserts the populated context is Vault-free);
byte-identical / cheap no-op when observability is disabled (0112's guarantee is preserved).

Async note: the coroutine-driving ``run`` fixture (conftest) is used — never ``async def test`` — to
avoid poisoning the suite's shared event loop (the established FE LLM-test convention).
"""

from __future__ import annotations

import json

from src import agent_loop
from src import llm_trace


# ── settings + framing harness ──────────────────────────────────────────────────────

_VAULT_KEYS = ("soul", "trust", "threat", "affinity", "hidden", "target",
               "relationship", "grudge", "scheme", "confession")


def _patch_settings(monkeypatch, **overrides):
    """Patch ``src.settings.get_setting`` (the seam ``observability_enabled`` reads through)."""
    def fake_get_setting(key, default=None):
        return overrides.get(key, default)
    monkeypatch.setattr("src.settings.get_setting", fake_get_setting)


def _set_framing(monkeypatch, owner, *, beat_key, beat_seq, canonical):
    """Stand in for what ``apply_game_framing`` (route) stashes PRE-loop: the framed beat key and the
    last-seen 0065 beatSeq, plus the 0064 canonical game session the loop resolves."""
    from routes import chat_helpers as ch
    monkeypatch.setitem(ch._LAST_FRAMED_BEAT_KEY, owner or "default", beat_key)
    monkeypatch.setattr(ch, "last_beat_seq", lambda u: beat_seq)
    monkeypatch.setattr("src.orwell_game_session.get_game_session", lambda u: canonical)


def _assert_no_vault_key(obj):
    assert llm_trace.record_is_vault_free(obj), f"context carries a Vault key: {json.dumps(obj)}"
    for k in _iter_keys(obj):
        assert not any(vk in k.lower() for vk in _VAULT_KEYS), f"Vault key present: {k}"


def _iter_keys(obj):
    out = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            out.append(k)
            out.extend(_iter_keys(v))
    elif isinstance(obj, list):
        for v in obj:
            out.extend(_iter_keys(v))
    return out


# ── 1. the context is populated from the turn's framing state ────────────────────────


def test_context_populated_from_framing(monkeypatch):
    _patch_settings(monkeypatch, observability_enabled=True)
    _set_framing(monkeypatch, "player-role",
                 beat_key=(3, "nominations", "nomination-ceremony"),
                 beat_seq=42, canonical="canon-sess")
    token = agent_loop._set_turn_observability_context("player-role", "chat-sess", "game")
    assert token is not None
    try:
        ctx = llm_trace._current_context()
        assert ctx["user"] == "player-role"
        assert ctx["call_class"] == "narration"
        assert ctx["session"] == "canon-sess"       # the CANONICAL game session, not the chat id
        assert ctx["phase"] == "nominations"
        assert ctx["moment"] == "nomination-ceremony"
        assert ctx["beat_seq"] == 42
    finally:
        agent_loop._reset_turn_observability_context(token)
    assert llm_trace._current_context() == {}        # reset restores the default


def test_casting_turn_classes_as_casting(monkeypatch):
    _patch_settings(monkeypatch, observability_enabled=True)
    _set_framing(monkeypatch, "player-role",
                 beat_key=(0, "casting", "casting-interview"),
                 beat_seq=1, canonical="canon-sess")
    token = agent_loop._set_turn_observability_context("player-role", "chat-sess", "casting")
    try:
        assert llm_trace._current_context()["call_class"] == "casting"
    finally:
        agent_loop._reset_turn_observability_context(token)


def test_beat_key_without_moment_is_tolerated(monkeypatch):
    # A framed beat key may be a 2-tuple (week, phase) with no moment yet — no crash, no moment key.
    _patch_settings(monkeypatch, observability_enabled=True)
    _set_framing(monkeypatch, "player-role", beat_key=(2, "veto-competition"),
                 beat_seq=9, canonical="canon-sess")
    token = agent_loop._set_turn_observability_context("player-role", "chat-sess", "game")
    try:
        ctx = llm_trace._current_context()
        assert ctx["phase"] == "veto-competition"
        assert "moment" not in ctx
        assert ctx["beat_seq"] == 9
    finally:
        agent_loop._reset_turn_observability_context(token)


# ── 2. the populated context is Vault-free ───────────────────────────────────────────


def test_populated_context_is_vault_free(monkeypatch):
    _patch_settings(monkeypatch, observability_enabled=True)
    _set_framing(monkeypatch, "player-role",
                 beat_key=(3, "nominations", "nomination-ceremony"),
                 beat_seq=42, canonical="canon-sess")
    token = agent_loop._set_turn_observability_context("player-role", "chat-sess", "game")
    try:
        ctx = llm_trace._current_context()
        _assert_no_vault_key(ctx)
        # And a record built from those context values carries no Vault key either.
        rec = llm_trace.build_trace_record(
            user=ctx.get("user"), session=ctx.get("session"), call_class=ctx.get("call_class"),
            beat_seq=ctx.get("beat_seq"), phase=ctx.get("phase"), moment=ctx.get("moment"),
            model="m", usage={"output_tokens": 1})
        _assert_no_vault_key(rec)
    finally:
        agent_loop._reset_turn_observability_context(token)


# ── 3. the wired context reaches the emit point (end-to-end correlation) ──────────────


class _Capturing:
    def __init__(self):
        self.records = []

    async def emit(self, record):
        self.records.append(record)


def test_emit_point_pulls_the_wired_context(monkeypatch, run):
    _patch_settings(monkeypatch, observability_enabled=True, observability_sampling=1.0,
                    observability_privacy_mode="metrics-only")
    _set_framing(monkeypatch, "player-role",
                 beat_key=(4, "eviction", "eviction-vote"),
                 beat_seq=77, canonical="canon-sess")
    cap = _Capturing()
    monkeypatch.setattr("src.trace_sink.resolve_trace_sink", lambda settings=None: cap)
    token = agent_loop._set_turn_observability_context("player-role", "chat-sess", "game")
    try:
        # emit_trace is handed ONLY model+usage — everything else must come from the wired context.
        run(llm_trace.emit_trace(model="m", usage={"output_tokens": 2}))
    finally:
        agent_loop._reset_turn_observability_context(token)
    assert len(cap.records) == 1
    rec = cap.records[0]
    assert rec["phase"] == "eviction"
    assert rec["moment"] == "eviction-vote"
    assert rec["beatSeq"] == 77
    assert rec["session"] == "canon-sess"
    assert rec["call_class"] == "narration"
    assert rec["user"] == "player-role"


# ── 4. opt-in: disabled ⇒ no-op, nothing set (byte-identical guarantee preserved) ─────


def test_disabled_is_a_noop(monkeypatch):
    _patch_settings(monkeypatch, observability_enabled=False)
    _set_framing(monkeypatch, "player-role",
                 beat_key=(3, "nominations", "nomination-ceremony"),
                 beat_seq=42, canonical="canon-sess")
    token = agent_loop._set_turn_observability_context("player-role", "chat-sess", "game")
    assert token is None                     # nothing to reset
    assert llm_trace._current_context() == {}  # no keys set when observability is off
    agent_loop._reset_turn_observability_context(token)  # None token is a safe no-op


# ── 5. the public wrapper sets during the turn and RESETS at turn end (no leak) ───────


def test_wrapper_sets_during_turn_and_resets_after(monkeypatch, run):
    _patch_settings(monkeypatch, observability_enabled=True)
    _set_framing(monkeypatch, "player-role",
                 beat_key=(1, "hoh-competition", "hoh-comp"),
                 beat_seq=7, canonical="canon-2")

    captured = {}

    async def fake_impl(*args, **kwargs):
        captured.update(llm_trace._current_context())  # visible while the turn runs
        yield "data: hi\n\n"

    monkeypatch.setattr(agent_loop, "_stream_agent_loop_impl", fake_impl)

    async def drive():
        out = []
        async for ev in agent_loop.stream_agent_loop(
                "url", "model", [], owner="player-role", session_id="chat-2", game_mode="game"):
            out.append(ev)
        # After the generator is exhausted the wrapper's `finally` has reset the context.
        return out, dict(llm_trace._current_context())

    events, leaked_after = run(drive())
    assert events == ["data: hi\n\n"]
    # Populated during the turn…
    assert captured.get("call_class") == "narration"
    assert captured.get("phase") == "hoh-competition"
    assert captured.get("beat_seq") == 7
    assert captured.get("session") == "canon-2"
    # …and cleared at turn end so nothing bleeds into the next turn.
    assert leaked_after == {}


def test_wrapper_resets_even_when_impl_raises(monkeypatch, run):
    _patch_settings(monkeypatch, observability_enabled=True)
    _set_framing(monkeypatch, "player-role",
                 beat_key=(1, "hoh-competition", "hoh-comp"),
                 beat_seq=7, canonical="canon-2")

    async def boom_impl(*args, **kwargs):
        if False:
            yield ""  # make it an async generator
        raise RuntimeError("mid-turn failure")

    monkeypatch.setattr(agent_loop, "_stream_agent_loop_impl", boom_impl)

    async def drive():
        raised = False
        try:
            async for _ in agent_loop.stream_agent_loop(
                    "url", "model", [], owner="player-role", session_id="chat-2", game_mode="game"):
                pass
        except RuntimeError:
            raised = True
        return raised, dict(llm_trace._current_context())

    raised, leaked_after = run(drive())
    assert raised                    # the error propagates unchanged
    assert leaked_after == {}         # the finally still reset the context


def test_wrapper_resets_on_consumer_abandonment(monkeypatch, run):
    # A consumer that stops early (`aclose()` mid-stream) must still trigger the wrapper's `finally`
    # so the context is reset — otherwise an abandoned turn leaks its keys.
    _patch_settings(monkeypatch, observability_enabled=True)
    _set_framing(monkeypatch, "player-role",
                 beat_key=(1, "hoh-competition", "hoh-comp"),
                 beat_seq=7, canonical="canon-2")

    async def many_events_impl(*args, **kwargs):
        for i in range(10):
            yield f"data: {i}\n\n"

    monkeypatch.setattr(agent_loop, "_stream_agent_loop_impl", many_events_impl)

    async def drive():
        gen = agent_loop.stream_agent_loop(
            "url", "model", [], owner="player-role", session_id="chat-2", game_mode="game")
        first = await gen.__anext__()          # consume ONE event, then abandon
        set_mid = dict(llm_trace._current_context())
        await gen.aclose()                     # early close → GeneratorExit → the wrapper's finally
        return first, set_mid, dict(llm_trace._current_context())

    first, set_mid, leaked_after = run(drive())
    assert first == "data: 0\n\n"
    assert set_mid.get("session") == "canon-2"   # set while the turn was live
    assert leaked_after == {}                     # reset even though the consumer bailed early


# ── 6. non-game framing bleed guard: a plain chat turn inherits NO game framing ───────


def test_non_game_turn_sets_nothing_despite_stale_framing(monkeypatch):
    # Stale game framing sits in the belt (a prior game turn left it), but THIS turn is a plain
    # non-game workspace chat (game_mode=False). It must inherit none of it.
    _patch_settings(monkeypatch, observability_enabled=True)
    _set_framing(monkeypatch, "player-role",
                 beat_key=(3, "nominations", "nomination-ceremony"),
                 beat_seq=42, canonical="canon-sess")
    token = agent_loop._set_turn_observability_context("player-role", "chat-sess", False)
    assert token is None                          # nothing set for a non-game turn
    assert llm_trace._current_context() == {}     # no phase/moment/beat_seq/session bleed
    agent_loop._reset_turn_observability_context(token)  # None token is a safe no-op


def test_non_game_emit_keeps_session_id_and_omits_game_fields(monkeypatch, run):
    # With no context set (non-game turn), the emit point keeps its own session_id and carries NO
    # game correlation fields — byte-identical to pre-wire behavior.
    _patch_settings(monkeypatch, observability_enabled=True, observability_sampling=1.0,
                    observability_privacy_mode="metrics-only")
    _set_framing(monkeypatch, "player-role",
                 beat_key=(3, "nominations", "nomination-ceremony"),
                 beat_seq=42, canonical="canon-sess")
    agent_loop._set_turn_observability_context("player-role", "chat-sess", False)  # sets nothing
    cap = _Capturing()
    monkeypatch.setattr("src.trace_sink.resolve_trace_sink", lambda settings=None: cap)
    run(llm_trace.emit_trace(session="fe-chat-id", model="m", usage={"output_tokens": 1}))
    rec = cap.records[0]
    assert rec["session"] == "fe-chat-id"         # the emit caller's own session is retained
    assert rec["phase"] == ""                      # no game framing bled in
    assert rec["moment"] == ""
    assert rec["beatSeq"] is None


# ── 7. fix #1 — the canonical (context) session WINS over the emit caller's explicit arg ──


def test_context_session_wins_over_explicit_emit_arg(monkeypatch, run):
    # The regression: llm_core calls emit_trace(session=<FE chat id>); the context holds the 0064
    # canonical session for the game turn. The canonical MUST win so cross-device turns correlate.
    _patch_settings(monkeypatch, observability_enabled=True, observability_sampling=1.0)
    _set_framing(monkeypatch, "player-role",
                 beat_key=(3, "nominations", "nomination-ceremony"),
                 beat_seq=42, canonical="canon-sess")
    cap = _Capturing()
    monkeypatch.setattr("src.trace_sink.resolve_trace_sink", lambda settings=None: cap)
    token = agent_loop._set_turn_observability_context("player-role", "chat-sess", "game")
    try:
        # Different device → different explicit FE chat id; the canonical context session wins.
        run(llm_trace.emit_trace(session="other-device-chat-id", model="m",
                                 usage={"output_tokens": 1}))
    finally:
        agent_loop._reset_turn_observability_context(token)
    assert cap.records[0]["session"] == "canon-sess"


def test_request_metadata_context_session_wins(monkeypatch):
    # The outbound OpenRouter metadata tags the canonical session too (same precedence as the record).
    _patch_settings(monkeypatch, observability_enabled=True)
    _set_framing(monkeypatch, "player-role",
                 beat_key=(3, "nominations", "nomination-ceremony"),
                 beat_seq=42, canonical="canon-sess")
    token = agent_loop._set_turn_observability_context("player-role", "chat-sess", "game")
    try:
        md = llm_trace.maybe_request_metadata(session="fe-chat-id")
    finally:
        agent_loop._reset_turn_observability_context(token)
    assert md is not None
    assert md["orwell_session"] == "canon-sess"
