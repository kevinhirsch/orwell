"""2026-07-17 — the casting-finalize HANG fix (live golden-record forensics, fe.log evidence:
/tmp/golden-path-g_jirrlk/fe.log).

Observed live (twice, real GLM-4.7 via OpenRouter): a casting turn forces `createCharacter` on the
wire (gap #3), the tool executes and the season goes live, and the VERY NEXT round comes back
EMPTY (0 chars, 0 native calls, 0 tool blocks — a known GLM/OpenRouter empty-completion class). Before
this fix that empty round fell straight through the "no tools — done" `break` at the bottom of
`_stream_agent_loop_impl`'s `if not tool_blocks:` branch: `game_mode == "casting"`, so the reactive
finalize-fallback ladder ran, but every branch of it is gated on `not _created_this_turn` — which is
already False (createCharacter just succeeded THIS turn) — so nothing in that ladder ever fires for
the round immediately after a finalize. The turn ended with `full_response == ""`, and because
`tool_events` was non-empty (createCharacter), `_empty_response_fallback`'s own true-empty recovery
line ALSO never engaged (its early-return guard is `if full_response.strip() or tool_events: return
...`). The result: a turn that persists nothing, streams no retry affordance, and — per the live
evidence — never even reaches the terminal `[DONE]` (the SSE generator hangs until an external
process kills the whole app; see the fe.log timestamps 01:29:05 -> 01:34:01 with zero further
`agent_loop` lines and no `POST /api/chat_stream 200 OK`).

The fix is two-part, both server-side (the existing FE-only fix, chat.js's `_orwellFinalizingActive`
auto-refire from the 2026-07-16 audit, never reaches a headless/API client — the golden-path driver
chief among them):

  1. TERMINATION GUARANTEE — `_premiere_opener_refire_used` bounds the new refire to exactly ONE
     extra round; whether or not that round produces content, the turn falls through to the
     unconditional `break` immediately after, so this mechanism can never itself loop.
  2. THE PREMIERE-OPENER REFIRE — when casting finalized this turn (`_casting_finalized_this_turn`,
     set at both the model-driven tool-dispatch site and the FE-forced fallback site) and no
     narration has streamed SINCE that point (`_visible_chars_at_finalize` vs. the current
     `full_response`, both `.strip()`-compared so the inter-round "\n\n" separator never counts), one
     bounded `_PREMIERE_OPENER_REFIRE` re-prompt is injected and the loop takes one more round. If
     THAT round is also empty, a terminal safety net (mirroring the F2 #1017 true-empty recovery)
     surfaces the same in-character `_EMPTY_PRODUCER_LINE` + retry affordance instead of leaving the
     turn silently blank.

Behavioral: drives the REAL `stream_agent_loop` with a scripted stub model (mirrors
`tests/test_castingloop_fix.py` / `tests/test_reinject_continue_never_reopen.py`). Roles only — no
houseguest names.
"""
import asyncio
import json

import pytest

from src import agent_loop as al


def _run(coro, timeout=10):
    """Drive a coroutine to completion under a hard wall-clock bound — this IS the termination
    assertion: a regression that reintroduces the hang makes this raise `asyncio.TimeoutError`
    instead of the test failing on a content assertion, which is the right failure mode for a
    hang bug (a clear signal, not a silent multi-minute CI wedge)."""
    return asyncio.get_event_loop().run_until_complete(asyncio.wait_for(coro, timeout=timeout))


OWNER = None  # matches the live repro exactly (AUTH_ENABLED=false / single-tenant: owner is None)


def _drive_finalize_turn(monkeypatch, *, rounds, create_character_result=None):
    """Drive the REAL stream_agent_loop over a casting turn whose model produces exactly `rounds`.
    Each item is one of:
      * a plain string  — a narration-only round (a text delta, no tool call);
      * "__CREATE__"    — the model calls createCharacter as a native tool call this round (standing
        in for either the gap #3 wire-forced call or an organic model-initiated one — the fix's gate,
        `_casting_finalized_this_turn`, fires identically either way);
      * ("__TEXT_TOOL__", text, tool_name) — a round that emits VISIBLE narration text AND a native
        tool call in the same round (real models do this — a short preamble before acting). Used to
        set `_emitted_visible=True` in the SAME turn a tool fires, without depending on the owner-
        gated reactive casting ladder (which the live repro's `owner=None` never reaches) to bridge
        two separate rounds — the exact shape needed to test the continue-never-reopen prefix.

    Returns (chunks, messages_snapshots, tool_calls): `messages_snapshots` is the round-by-round
    message list handed to the model (so a test can inspect exactly what directive text a later round
    received) and `tool_calls` records each round's dispatched tool name(s)."""
    monkeypatch.delenv("ORWELL_GAME_BUILD", raising=False)
    monkeypatch.setattr(al, "get_setting", lambda key, default=None: default)
    import src.tool_index as ti
    monkeypatch.setattr(ti, "get_tool_index", lambda: None)

    import src.orwell_engine as oe

    async def fake_state(user=None):
        return {"started": True, "moment": "premiere",
                "casting": {"ready": True, "finalizable": True}}
    monkeypatch.setattr(oe, "get_game_state", fake_state)

    async def fake_update_casting(fields, user=None):
        return {}
    monkeypatch.setattr(oe, "update_casting", fake_update_casting)

    import src.tool_implementations as timpl

    async def create_spy(content, owner=None, progress_cb=None):
        return create_character_result or {"output": json.dumps({"started": True}), "exit_code": 0}
    monkeypatch.setattr(timpl, "do_create_character", create_spy)

    _round = {"n": 0}
    messages_snapshots = []
    tool_calls = []

    async def fake_stream(candidates, messages, **kwargs):
        i = min(_round["n"], len(rounds) - 1)
        item = rounds[i]
        _round["n"] += 1
        messages_snapshots.append(list(messages))
        if isinstance(item, tuple) and item[0] == "__TEXT_TOOL__":
            _, text, tool_name = item
            yield 'data: ' + json.dumps({"delta": text}) + '\n\n'
            tool_calls.append(tool_name)
            yield 'data: ' + json.dumps({"type": "tool_calls", "calls": [
                {"id": f"c{i}", "name": tool_name, "arguments": "{}"}]}) + '\n\n'
        elif item == "__CREATE__":
            tool_calls.append("createCharacter")
            yield 'data: ' + json.dumps({"type": "tool_calls", "calls": [
                {"id": f"c{i}", "name": "createCharacter", "arguments": "{}"}]}) + '\n\n'
        elif item:
            yield 'data: ' + json.dumps({"delta": item}) + '\n\n'
        yield "data: [DONE]\n\n"
    monkeypatch.setattr(al, "stream_llm_with_fallback", fake_stream)

    chunks = []

    async def drive():
        gen = al.stream_agent_loop(
            "https://openrouter.ai/api/v1/chat/completions", "z-ai/glm-4.7",
            [{"role": "system", "content": "You are the casting producer."},
             {"role": "user", "content": "let's start the game"}],
            owner=OWNER, game_mode="casting", max_rounds=8)
        async for chunk in gen:
            chunks.append(chunk)

    _run(drive())
    return chunks, messages_snapshots, tool_calls


def _persisted_text(chunks) -> str:
    """Reassemble the player-visible body exactly like the FE does: concatenate every `delta`."""
    out = []
    for c in chunks:
        if not c.startswith("data: "):
            continue
        try:
            payload = json.loads(c[6:].strip())
        except Exception:
            continue
        if isinstance(payload, dict) and "delta" in payload:
            out.append(payload["delta"])
    return "".join(out)


def _saw_done(chunks) -> bool:
    return any(c == "data: [DONE]\n\n" for c in chunks)


# ── the core repro: refusal (visible) -> forced createCharacter -> EMPTY follow-up -> opener ────

def test_premiere_opener_refire_terminates_and_carries_the_opener(monkeypatch):
    """The exact live shape: a visible round, then the forced createCharacter call, then an EMPTY
    follow-up (the bug), then — thanks to the refire — an opener round that actually narrates the
    move-in. Must (a) terminate (the `_run` wall-clock bound would otherwise raise TimeoutError),
    (b) fire exactly one refire re-prompt with the expected framing, (c) persist the opener text."""
    chunks, msg_snapshots, tool_calls = _drive_finalize_turn(
        monkeypatch,
        rounds=[
            # round 1: visible narration ALONGSIDE a tool call (real models often preamble before
            # acting) — sets `_emitted_visible=True` this turn without needing the owner-gated
            # reactive ladder (the live repro's `owner=None` never reaches it) to bridge two rounds.
            ("__TEXT_TOOL__", "Not quite. You gave me the what, not the how.", "updateCasting"),
            "__CREATE__",   # round 2: forced createCharacter (gap #3 — the wire tool_choice force)
            "",             # round 3: EMPTY follow-up (the bug — a known GLM/OpenRouter empty class)
            "You step through the front door into the roar of the house.",  # round 4: the refire lands
        ],
    )

    # (a) termination — reaching here at all proves it (the 10s wall-clock bound in `_run` would
    # have raised TimeoutError on a hang); also assert the stream actually closed cleanly.
    assert _saw_done(chunks), "the turn must end with a terminal [DONE], never hang mid-stream"

    # exactly one createCharacter dispatch — the refire must never re-finalize.
    assert tool_calls == ["updateCasting", "createCharacter"]

    # exactly 4 rounds were dispatched to the model — the refire fired exactly ONCE (not zero, not
    # spinning past round 4 looking for more content).
    assert len(msg_snapshots) == 4, (
        f"expected exactly 4 rounds (refusal, force, empty, refire-landed) — got {len(msg_snapshots)}; "
        "a regression here means either the refire never fired (3 rounds) or it didn't bound to one "
        "retry (5+ rounds)"
    )

    # (b) the refire re-prompt carries the expected framing, injected ahead of round 4. Because a
    # scene already streamed this turn (round 1's refusal), it must carry the continue-never-reopen
    # contract as its prefix (the task's explicit requirement — never read as "narrate again").
    round4_messages = msg_snapshots[3]
    injected = [m for m in round4_messages if m.get("role") == "system"
                and "The game has started" in str(m.get("content", ""))]
    assert injected, "the premiere-opener refire directive must be injected ahead of round 4"
    combined = injected[-1]["content"]
    assert "narrate the player's entry into the house" in combined.lower()
    assert "already been shown to the player" in combined.lower()
    assert combined.startswith(al._CONTINUE_NEVER_REOPEN), (
        "round 1 already streamed a visible scene this turn, so the refire must be prefixed with "
        "the continue-never-reopen contract, exactly like every other mid-turn re-prompt sharing "
        "this shape"
    )

    # (c) the final persisted content includes the opener the refire actually landed (round 1's own
    # text legitimately rides along too — turns naturally accumulate every round's narration; that is
    # NOT the "stuttering narrator" class, which is a SINGLE beat re-narrated twice. The refire's own
    # directive text — asserted above — is what proves the model was told to continue, not restate).
    persisted = _persisted_text(chunks)
    assert "front door" in persisted, (
        f"the opener narration from the refire round must reach the player — got {persisted!r}"
    )
    # round 1's refusal appears exactly once — never duplicated by the refire re-prompting it.
    assert persisted.count("You gave me the what") == 1


def test_premiere_opener_refire_still_empty_falls_back_cleanly(monkeypatch):
    """If the ONE bounded refire ALSO comes back empty, the turn must still terminate cleanly with
    the established in-character recovery line + retry affordance — never a silent blank turn, and
    never a second refire (bounded is bounded)."""
    chunks, msg_snapshots, tool_calls = _drive_finalize_turn(
        monkeypatch,
        rounds=[
            "__CREATE__",   # round 1: forced createCharacter (no prior visible round this time)
            "",             # round 2: EMPTY follow-up
            "",             # round 3: the refire ALSO comes back empty
        ],
    )
    assert _saw_done(chunks), "must still terminate cleanly, never hang, on a double-empty finalize"
    assert tool_calls == ["createCharacter"]
    # exactly 3 rounds — the refire fired once (round 2 -> round 3), then bounded, no round 4.
    assert len(msg_snapshots) == 3

    persisted = _persisted_text(chunks)
    assert persisted.strip(), "the player must see SOMETHING, never a wholly blank bubble"
    assert persisted == al._EMPTY_PRODUCER_LINE, (
        "a double-empty finalize must fall back to the established F2 (#1017) in-character recovery "
        "line, not fabricate new narration"
    )
    # the retry affordance (the existing `truncated` Continue-button event) must ride along.
    assert any(
        c.startswith("data: ") and json.loads(c[6:].strip()).get("type") == "truncated"
        for c in chunks if c.startswith("data: {")
    ), "a true-empty finalize turn must pair the recovery line with a retry affordance"


# ── the negative: a non-empty follow-up must NEVER trigger a refire ──────────────────────────────

def test_no_refire_when_followup_already_has_content(monkeypatch):
    """Contrast case: the round right after createCharacter finalizes narrates fine on the first
    try. The refire must be a complete no-op — no extra round, no injected directive."""
    chunks, msg_snapshots, tool_calls = _drive_finalize_turn(
        monkeypatch,
        rounds=[
            "__CREATE__",
            "You step through the front door into the roar of the house.",
        ],
    )
    assert _saw_done(chunks)
    assert tool_calls == ["createCharacter"]
    # only 2 rounds dispatched — no refire round was ever added.
    assert len(msg_snapshots) == 2, (
        f"a follow-up that already narrates must NOT trigger the refire — got {len(msg_snapshots)} rounds"
    )
    persisted = _persisted_text(chunks)
    assert "front door" in persisted
    assert persisted != al._EMPTY_PRODUCER_LINE


def test_premiere_opener_refire_directive_constant_shape():
    """Source pin: the refire directive names the concrete framing the task specifies (production
    note, narrate the house entry now, continue from what's already been shown) so a future edit
    can't silently drop the substance while leaving the mechanism wired."""
    txt = al._PREMIERE_OPENER_REFIRE
    assert "the game has started" in txt.lower()
    assert "narrate the player's entry into the house" in txt.lower()
    assert "already been shown to the player" in txt.lower()
    assert "continue from it" in txt.lower()


def test_premiere_opener_refire_is_bounded_once_per_turn_flag_exists():
    """Source pin: the bounding flag is initialized False per turn (not a module-level/cross-turn
    latch) — grep the initializer sits alongside the other per-turn casting flags."""
    with open(al.__file__, encoding="utf-8") as fh:
        src = fh.read()
    assert "_premiere_opener_refire_used = False" in src
    assert "_visible_chars_at_finalize = None" in src
