"""2026-07-16 — the "stuttering narrator" fix: the 0079/0080 ACTIVE OVERSEER's re-prompting levers
(nudge / force-advance / reinject-delta) can fire AFTER a scene has ALREADY streamed to the player
this turn — most commonly ``reinject-delta`` on a desync/stale-409 flagged mid-turn, past the
silent-commit path. #829 turn-coalescing stacks EVERY round of one turn into the SAME message bubble,
so a bare re-prompt made the model re-narrate the whole scene from scratch and the two renditions
landed fused — often mid-line — into one contradictory message
("...What's on your mind?You grab your bag and head toward Bedroom B...").

The fix: whenever a re-prompting lever fires with ``_emitted_visible`` already True, the injected
system directive is prefixed with the CONTINUE-NEVER-REOPEN contract (``_CONTINUE_NEVER_REOPEN``) —
the correction still lands THIS turn (never deferred to a next-turn-only reground the model would
never re-read mid-stream), but the model is told to continue from the scene already shown, never
reopen/restate/re-narrate it. The SAME family of fix is applied to the CASTING finalize-force belt's
re-prompts (the casting->premiere seam), which had the identical unconditional-re-prompt-after-
`_emitted_visible` shape.

This is the TEST lane for that fix:
  * a BEHAVIOR test that drives the REAL ``stream_agent_loop`` with a stubbed model + a stubbed
    engine, reproducing the exact reported shape (round 1 narrates a full visible scene with no
    tool call; a desync gets flagged; the ACTIVE overseer's ``reinject-delta`` fires) and asserts
    the round-2 context the model receives carries the continue-never-reopen contract;
  * a CONTRAST behavior test proving the gate is conditional — when NOTHING has been shown yet,
    the reinject-delta re-prompt is unchanged (no continue-never-reopen wrapper needed);
  * SOURCE-PIN tests (the established convention for this giant, not-independently-unit-testable
    streaming function — see test_npc_approach_nudge.py / test_lane_a_advance_atleastonce.py) that
    the ``nudge`` / ``force-advance`` overseer levers AND the four casting finalize-force re-prompt
    sites carry the SAME gate.

Roles only — no houseguest names.
"""

import asyncio
import importlib
import json
import os

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

al = importlib.import_module("src.agent_loop")
chat_helpers = importlib.import_module("routes.chat_helpers")
orwell_engine = importlib.import_module("src.orwell_engine")
orwell_cast_authoring = importlib.import_module("src.orwell_cast_authoring")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _src() -> str:
    with open(os.path.join(FRONTEND, "src", "agent_loop.py"), encoding="utf-8") as fh:
        return fh.read()


def _isolate_settings(monkeypatch, tmp_path):
    from src import settings as _s
    monkeypatch.setattr(_s, "SETTINGS_FILE", str(tmp_path / "settings.json"))
    monkeypatch.setattr(_s, "_settings_cache", None)


OWNER = "probe-user"


@pytest.fixture(autouse=True)
def _clean_state():
    chat_helpers._LAST_BEAT_SEQ.clear()
    chat_helpers._LAST_BEAT_SIG.clear()
    chat_helpers._DESYNC_REGROUND.clear()
    al._TURNS_SINCE_PROGRESS.clear()
    al._ADVANCE_STALL_LEVEL.clear()
    yield
    chat_helpers._LAST_BEAT_SEQ.clear()
    chat_helpers._LAST_BEAT_SIG.clear()
    chat_helpers._DESYNC_REGROUND.clear()
    al._TURNS_SINCE_PROGRESS.clear()
    al._ADVANCE_STALL_LEVEL.clear()


# ── the behavioral drive: a real turn where a scene already streamed, THEN reinject-delta fires ──

def _drive_reinject_after_visible(monkeypatch, tmp_path, *, pre_seed_desync: bool,
                                   round1_emits_visible: bool = True, max_rounds=2):
    """Drive the REAL stream_agent_loop over a live-game turn shaped exactly like the reported bug:
    round 1 narrates a full visible scene with NO tool call (so `_emitted_visible` becomes True
    inside round 1's own processing), the silent advance-commit genuinely fails (a plain engine
    error, not a stale-beat — so the turn falls through past the `if _emitted_visible:` silent path
    into the ACTIVE OVERSEER block), and (when `pre_seed_desync`) a desync is already flagged so the
    heuristic floor's verdict is `reinject-delta` (checked ahead of `nudge` in `_heuristic_verdict`).
    The overseer's judge model is stubbed to RAISE (falls to the deterministic floor — desync=True
    is enough to pin the lever without needing a well-formed model reply).

    `round1_emits_visible=False` reproduces the CONTRAST shape (nothing shown yet — round 1 emits no
    delta text and no tool call at all), so the same reinject-delta lever fires with `_emitted_visible`
    still False and the fix's gate must stay a no-op.

    Returns the list of `messages` snapshots captured on each `fake_stream` invocation (one per
    round actually dispatched to the model)."""
    _isolate_settings(monkeypatch, tmp_path)
    from src.settings import save_settings
    save_settings({"overseer_mode": "active"})   # deterministic — never rides the ambient default

    monkeypatch.delenv("ORWELL_GAME_BUILD", raising=False)
    monkeypatch.setattr(al, "get_setting", lambda key, default=None: default)
    import src.tool_index as ti
    monkeypatch.setattr(ti, "get_tool_index", lambda: None)

    # Force the turn into the "lull past grace" shape so `_want_advance` trips structurally,
    # independent of any narration content.
    monkeypatch.setattr(al, "_player_turn_is_lull", lambda messages: True)
    monkeypatch.setattr(al, "_effective_advance_grace", lambda owner: 0)

    async def fake_state(user=None, **kw):
        return {"phase": "premiere", "moment": "premiere", "week": 1, "finished": False, "house": []}
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)

    async def fake_advance(expected_beat_seq=None, idempotency_key=None, user=None):
        # A GENERIC engine failure (not a stale-beat) — the silent commit must fail cleanly so the
        # turn falls through to the ACTIVE OVERSEER block with `_emitted_visible` already True.
        raise RuntimeError("engine unavailable")
    monkeypatch.setattr(orwell_engine, "advance_game", fake_advance)

    # The overseer's judge model resolves to a callable that RAISES — the active-mode dispatch
    # falls to the deterministic floor, which (desync=True) pins the lever to `reinject-delta`
    # ahead of any other branch in `_heuristic_verdict`.
    async def _fake_resolve_llm_fn(owner, *a, **k):
        def _raise(prompt):
            raise RuntimeError("stub judge model unavailable")
        return _raise
    monkeypatch.setattr(orwell_cast_authoring, "_resolve_llm_fn", _fake_resolve_llm_fn)

    if pre_seed_desync:
        chat_helpers._DESYNC_REGROUND[OWNER] = "RE-GROUND ON THE BOARD — a prior directive."

    round_payloads = (
        [None, "A houseguest offers a small nod from across the room."] if not round1_emits_visible
        else ["The living room settles into a quiet hush as the night winds down.",
              "A houseguest offers a small nod from across the room."]
    )
    _round = {"n": 0}
    captured_messages = []

    async def fake_stream(candidates, messages, **kwargs):
        i = min(_round["n"], len(round_payloads) - 1)
        text = round_payloads[i]
        _round["n"] += 1
        captured_messages.append(list(messages))  # snapshot THIS round's context
        if text:
            yield 'data: ' + json.dumps({"delta": text}) + '\n\n'
        yield 'data: ' + json.dumps({"type": "finish", "reason": "stop"}) + '\n\n'
        yield "data: [DONE]\n\n"

    monkeypatch.setattr(al, "stream_llm_with_fallback", fake_stream)

    async def drive():
        gen = al.stream_agent_loop(
            "https://api.openai.com/v1/chat/completions",
            "deepseek/deepseek-v4-pro",
            [{"role": "system", "content": "You are Big Brother, the narrator."},
             {"role": "user", "content": "I take a slow lap around the house."}],
            max_rounds=max_rounds,
            game_mode="game",
            owner=OWNER,
        )
        async for _chunk in gen:
            pass

    _run(drive())
    return captured_messages


def test_reinject_delta_after_visible_scene_carries_continue_never_reopen(monkeypatch, tmp_path):
    """The core repro: round 1 narrates a full scene (no tools) and a desync is already flagged, so
    the ACTIVE overseer's `reinject-delta` fires mid-turn AFTER `_emitted_visible` is True. The
    round-2 context the model receives must carry BOTH the reground directive AND the
    continue-never-reopen contract — the correction lands this turn without inviting a second,
    contradictory narration of the same scene."""
    captured = _drive_reinject_after_visible(monkeypatch, tmp_path, pre_seed_desync=True)
    assert len(captured) >= 2, "reinject-delta must have re-prompted a second round"

    round2_messages = captured[1]
    injected = [m for m in round2_messages if m.get("role") == "system"
                and "RE-GROUND ON THE BOARD" in str(m.get("content", ""))]
    assert injected, "the reground directive must be injected into round 2's context"
    combined = injected[-1]["content"]
    assert "CONTINUE" in combined and "DO NOT REOPEN" in combined, (
        "a reinject-delta firing AFTER a scene already streamed must carry the continue-never-reopen "
        "contract — otherwise the re-prompt reads as 'narrate again' and the player sees two "
        "contradictory takes of the same moment fused together"
    )
    assert "already been shown to the player" in combined.lower()
    assert "do not re-narrate" in combined.lower()


def test_reinject_delta_before_any_visible_scene_is_unchanged(monkeypatch, tmp_path):
    """Contrast case: the gate is CONDITIONAL on `_emitted_visible`. When round 1 shows the player
    NOTHING (no narration, no tools — the pure-stall shape), a desync-triggered reinject-delta still
    fires (the lever's correction power is preserved), but it must NOT wrap its message in the
    continue-never-reopen contract — there is no risk of a second narration colliding with a first,
    so the original (pre-fix) shape stands: only the `_DESYNC_REGROUND` stash, no `messages.append`.
    This proves the fix targets the duplication specifically, not the lever's ordinary path."""
    captured = _drive_reinject_after_visible(
        monkeypatch, tmp_path, pre_seed_desync=True, round1_emits_visible=False,
    )
    assert len(captured) >= 2, "reinject-delta must still fire and re-prompt even with nothing shown"

    round2_messages = captured[1]
    reground_msgs = [m for m in round2_messages if m.get("role") == "system"
                     and "RE-GROUND ON THE BOARD" in str(m.get("content", ""))]
    assert not reground_msgs, (
        "when nothing has been shown yet, reinject-delta must not inject an in-turn system message "
        "at all (unchanged from the pre-fix behavior) — it only stashes the next-turn "
        "_DESYNC_REGROUND backstop"
    )
    assert not any("CONTINUE" in str(m.get("content", "")) and "DO NOT REOPEN" in str(m.get("content", ""))
                   for m in round2_messages if m.get("role") == "system"), (
        "the continue-never-reopen contract must only apply when a scene already streamed this turn"
    )


# ── source-pin: the SAME contract on the sibling overseer levers (nudge / force-advance) ─────────

def test_source_pin_overseer_nudge_and_force_advance_carry_the_same_gate():
    src = _src()
    assert "_CONTINUE_NEVER_REOPEN = (" in src
    assert "CONTINUE — DO NOT REOPEN" in src
    # `_ov_nudge` — the graduated stall nudge:
    nudge_start = src.index("def _ov_nudge() -> bool:")
    nudge_end = src.index("def _ov_reinject_delta() -> bool:", nudge_start)
    nudge_block = src[nudge_start:nudge_end]
    assert "if _emitted_visible:" in nudge_block
    assert "_CONTINUE_NEVER_REOPEN" in nudge_block

    # `_ov_do_force_advance` — the forced-advance re-prompt:
    fa_start = src.index("async def _ov_do_force_advance() -> bool:")
    fa_end = src.index("def _ov_nudge() -> bool:", fa_start)
    fa_block = src[fa_start:fa_end]
    assert "if _emitted_visible:" in fa_block
    assert "_CONTINUE_NEVER_REOPEN" in fa_block

    # `_ov_reinject_delta` — the lever this bug report named directly:
    ri_start = src.index("def _ov_reinject_delta() -> bool:")
    ri_end = src.index("def _ov_escalate() -> bool:", ri_start)
    ri_block = src[ri_start:ri_end]
    assert "if _emitted_visible:" in ri_block
    assert "_CONTINUE_NEVER_REOPEN" in ri_block


# ── source-pin: the SAME family fix in the CASTING finalize-force belt (the msg-5-class seam) ────

def test_source_pin_casting_finalize_force_reprompts_carry_the_same_gate():
    """The casting->premiere finalize-force belt has the IDENTICAL shape as the overseer levers: it
    only ever runs once `_emitted_visible` is (almost always) already True — `_turn_was_cancelled =
    (not _emitted_visible) and not _turn_had_error`, and the whole block requires `not
    _turn_was_cancelled` to fire — yet its `continue` re-prompts (no-model-wired steer, the forced
    finalize->premiere note, the casting-incomplete refusal steer, and the generic finalize nudge)
    previously injected their directive bare. Each now carries the same continue-never-reopen gate."""
    src = _src()
    casting_start = src.index('elif game_mode == "casting":')
    casting_end = src.index("break  # no tools — done", casting_start)
    casting_block = src[casting_start:casting_end]

    # All four re-prompt directives built in this block are now conditionally wrapped.
    assert casting_block.count("_CONTINUE_NEVER_REOPEN") == 4, (
        "expected exactly the four casting finalize-force re-prompt sites to carry the "
        "continue-never-reopen gate (no-model-wired / forced-finalize->premiere / "
        "casting-incomplete refusal / the generic finalize nudge)"
    )
    assert casting_block.count("if _emitted_visible:") >= 4

    # The forced finalize->premiere transition specifically — the msg-5-class seam (interview reply
    # glued to the premiere walk-in) — must be one of the wrapped sites.
    forced_note_idx = casting_block.index("_cfn_txt = _CASTING_FORCED_NOTE")
    nearby_end = casting_block.index('messages.append({"role": "system", "content": _cfn_txt})',
                                      forced_note_idx)
    nearby = casting_block[forced_note_idx:nearby_end]
    assert "_CONTINUE_NEVER_REOPEN" in nearby

    # The one EXISTING guard in this family (the `_ready` substance branch) stays a `break`, never a
    # `continue` — it was already fixed for the "prod bug v5.01" and must not regress.
    assert 'elif _ready:' in casting_block
    ready_start = casting_block.index("elif _ready:")
    ready_end = casting_block.index("elif owner is not None:", ready_start)
    ready_block = casting_block[ready_start:ready_end]
    assert "break  # yield to the player to answer" in ready_block


def test_continue_never_reopen_constant_is_explicit_about_the_contract():
    """Source-pin the constant's content directly — it must name the concrete failure mode (a
    second, contradictory narration of an already-shown scene), not just say "be careful"."""
    assert "ALREADY been shown to the player" in al._CONTINUE_NEVER_REOPEN
    assert "re-narrate" in al._CONTINUE_NEVER_REOPEN.lower()
    assert "CONTINUE" in al._CONTINUE_NEVER_REOPEN
    assert "DO NOT REOPEN" in al._CONTINUE_NEVER_REOPEN
