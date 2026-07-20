"""F1 — the ANTI-STALE narration guard (2026-07-20 live GLM-4.7 playtest).

The forced-advance belt (L39b) can march the engine ARBITRARILY far ahead of a narration that
stays FROZEN on an earlier beat. The playtest saw the chat never leave the premiere champagne
circle while the engine silently completed TWO FULL WEEKS underneath it: `#1154 forcing
tool_choice={advanceGame}` + `committed advanceGame silently (stall L0)` fired **141 times**,
force-advancing the engine but NEVER voicing the resulting ceremony. Engine and chat decoupled
completely with no on-screen signal.

The existing guards catch the OPPOSITE case (narration running AHEAD of the engine — the
anti-forward-fabrication family). This guard sits BESIDE them for the "narration behind a
silently-advancing engine" direction:

  1) on EVERY silent PLAIN-stall force ("stall L…" — the emitted-visible path that breaks the turn
     silently), OBLIGATE the next narration turn to voice the engine's CURRENT moment, by queuing a
     CLOSED-SET re-ground onto the existing BL-004 `_reground_enqueue` queue (drained by
     apply_game_framing into the GM prompt);
  2) past `_SILENT_FORCE_ADVANCE_CAP` consecutive silent stall-forces with no fresh narration
     catching up, STOP advancing the engine any further ahead — hold the beat and force the
     reground (surface the gap) instead of racing on.

Closed-set only (ADR 0005): the reground points the model at engine truth (the moment the engine is
ACTUALLY on) and authors NO prose. The guard is gated ENTIRELY behind the stall/desync condition —
the clean golden path never triggers it, so it does not stale the golden fixture.
"""
import importlib
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[1]
AGENT_SRC = (FE / "src" / "agent_loop.py").read_text(encoding="utf-8")
HELPERS_SRC = (FE / "routes" / "chat_helpers.py").read_text(encoding="utf-8")


# ── 1. The re-ground obligation mechanism (behavioral — the core of the fix) ───────────────────

def _fresh_helpers():
    ch = importlib.import_module("routes.chat_helpers")
    ch._DESYNC_REGROUND.clear()
    return ch


def test_stash_anti_stale_reground_queues_the_directive():
    """The belt's obligation: after a silent forced-advance, the NEXT turn must be pointed at the
    engine's current moment. `stash_anti_stale_reground` enqueues the closed-set directive onto the
    BL-004 queue so apply_game_framing drains it into the GM prompt. (Fails on base main — the
    function does not exist — reproducing 'the belt advances but no reground is queued to voice the
    new moment'.)"""
    ch = _fresh_helpers()
    assert ch.stash_anti_stale_reground("u") is True
    segs = ch._reground_segments(ch._desync_key("u"))
    assert len(segs) == 1
    assert segs[0] == ch._ANTI_STALE_NARRATION_REGROUND


def test_anti_stale_reground_is_a_closed_set_board_reground_not_prose():
    """ADR 0005: the reground points the model at engine truth (read the live state, voice the
    CURRENT moment) and never authors creative prose. It must reference the engine's read tools and
    forbid repeating the frozen beat — and must NOT script any scene."""
    ch = importlib.import_module("routes.chat_helpers")
    d = ch._ANTI_STALE_NARRATION_REGROUND.lower()
    # points at the engine's live state / current moment (closed-set grounding)
    assert "gamestatus" in d or "getgamestate" in d
    assert "current" in d and "moment" in d
    # forbids repeating the earlier / frozen beat (the premiere freeze)
    assert "do not repeat" in d and ("premiere" in d or "prior beat" in d)


def test_anti_stale_reground_dedupes_and_combines_via_bl004_queue():
    """Uses the BL-004 queue contract: an EXACT repeat de-dupes (never stacks the identical nag),
    while a DISTINCT prior correction is preserved (never clobbered)."""
    ch = _fresh_helpers()
    key = ch._desync_key("u")
    ch._reground_enqueue(key, "SOME OTHER DISTINCT CORRECTION.")
    assert ch.stash_anti_stale_reground("u") is True
    assert ch.stash_anti_stale_reground("u") is True  # exact repeat
    segs = ch._reground_segments(key)
    # the distinct prior correction is preserved; the anti-stale one appears EXACTLY once
    assert "SOME OTHER DISTINCT CORRECTION." in segs
    assert segs.count(ch._ANTI_STALE_NARRATION_REGROUND) == 1


def test_anti_stale_reground_is_drained_into_the_prompt_by_the_checkpoint():
    """End-to-end at the queue level: the framing checkpoint POPS the queue into the GM prompt, so a
    queued anti-stale reground is VOICED next turn (obligating the model to narrate the new moment)."""
    ch = _fresh_helpers()
    key = ch._desync_key("u")
    ch.stash_anti_stale_reground("u")
    # apply_game_framing drains via `_DESYNC_REGROUND.pop(_dkey, None)` — simulate that drain.
    drained = ch._DESYNC_REGROUND.pop(key, None)
    assert drained is not None and ch._ANTI_STALE_NARRATION_REGROUND in drained
    assert ch._DESYNC_REGROUND.get(key) is None  # consumed


def test_stash_anti_stale_reground_is_fail_soft():
    """A broken guard must never break a turn — a hostile key path returns False, never raises."""
    ch = importlib.import_module("routes.chat_helpers")
    # An unhashable "user" would blow up key resolution; the helper must swallow it.
    assert ch.stash_anti_stale_reground(["unhashable"]) in (True, False)


# ── 2. The cap constant (behavioral) ───────────────────────────────────────────────────────────

def test_silent_force_advance_cap_is_a_small_bound():
    al = importlib.import_module("src.agent_loop")
    assert isinstance(al._SILENT_FORCE_ADVANCE_CAP, int)
    assert 1 <= al._SILENT_FORCE_ADVANCE_CAP <= 3, "the engine is never many beats ahead of narration"
    assert isinstance(al._SILENT_FORCE_ADVANCE_STREAK, dict)


# ── 3. The wiring into the silent-commit funnel (source-pinned — the closure is not unit-drivable) #

def test_streak_increments_and_reground_queued_on_a_plain_stall_force():
    """On a PLAIN-stall silent commit ("stall L…"), the belt must (a) count the consecutive silent
    force and (b) queue the anti-stale reground obligating the next turn to voice the new moment.
    Scoped to "stall L" so the non-emitted L39b "forced stall L…" (which re-prompts IN-TURN) and the
    one-off preview/deliver commits are excluded."""
    # locate the successful-commit block of _commit_advance_silently
    idx = AGENT_SRC.find("committed advanceGame silently")
    assert idx != -1
    window = AGENT_SRC[max(0, idx - 900):idx + 200]
    assert 'if _why and _why.startswith("stall L"):' in window
    assert "_SILENT_FORCE_ADVANCE_STREAK[_belt_key(owner)] = (" in window
    assert "stash_anti_stale_reground(owner)" in window


def test_cap_holds_the_advance_and_forces_a_reground_instead_of_racing_on():
    """Past the cap, the funnel must HOLD (return without committing), set the capped flag, and queue
    the reground — surfacing the decoupling instead of advancing the engine further ahead."""
    idx = AGENT_SRC.find("ANTI-STALE CAP")
    assert idx != -1, "the anti-stale cap block must exist"
    # the CAP block runs from its comment to its guarded early return (a unique, commented return)
    end_marker = "return False  # caller reads _silent_advance_capped"
    end = AGENT_SRC.find(end_marker, idx)
    assert end != -1, "the cap must HOLD via a guarded early return"
    cap_block = AGENT_SRC[idx:end + len(end_marker)]
    # gated on the plain-stall reason AND the streak having reached the cap
    assert '_why.startswith("stall L")' in cap_block
    assert "_SILENT_FORCE_ADVANCE_STREAK.get(_belt_key(owner), 0)" in cap_block
    assert ">= _SILENT_FORCE_ADVANCE_CAP" in cap_block
    # HELD, not committed: the capped flag is set and the funnel returns False WITHOUT an advance_game call
    assert "_silent_advance_capped[0] = True" in cap_block
    assert "stash_anti_stale_reground(owner)" in cap_block
    # the held branch must NOT call the engine advance — it holds instead of racing on
    assert "advance_game(" not in cap_block, "the CAP must NOT advance the engine — it holds"


def test_emitted_visible_caller_ends_the_turn_on_the_cap():
    """A scene was already shown this turn, so on the cap we must NOT re-prompt (a second narration):
    end the turn with the reground queued for next turn."""
    idx = AGENT_SRC.find("_silent_advance_capped[0]:")
    assert idx != -1, "the caller must check the capped flag"
    window = AGENT_SRC[idx:idx + 1000]
    assert "break" in window
    assert "reground queued" in window.lower() or "held the advance" in window.lower()


def test_streak_resets_on_a_genuine_model_advance():
    """A model that voices+advances on its own has caught up — clear the anti-stale streak, beside the
    session stall-flag reset."""
    idx = AGENT_SRC.find("a genuine MODEL advance clears the session stall tally")
    assert idx != -1
    window = AGENT_SRC[idx:idx + 400]
    assert "_SILENT_FORCE_ADVANCE_STREAK.pop(_belt_key(owner), None)" in window


def test_streak_resets_on_a_peer_advance():
    """A peer window that moved the beat means narration/engine are no longer decoupled by OUR
    forcing — clear the streak, beside the session stall-flag reset."""
    idx = AGENT_SRC.find("a peer moved the beat — clear session stall pressure")
    assert idx != -1
    window = AGENT_SRC[idx:idx + 400]
    assert "_SILENT_FORCE_ADVANCE_STREAK.pop(_belt_key(owner), None)" in window


def test_guard_is_gated_behind_the_stall_condition_not_unconditional():
    """The guard must NOT touch the narrator prompt / tool schema / casting unconditionally (which
    would stale the golden fixture) — it fires ONLY inside the silent stall-force funnel. The
    anti-stale directive lives in chat_helpers as a runtime reground constant, never in the base GM
    prompt, and every write is guarded by `_why.startswith("stall L")`."""
    # the directive constant is a runtime reground, not part of the base narrator prompt
    assert "_ANTI_STALE_NARRATION_REGROUND" in HELPERS_SRC
    assert "BASE_GAME_MASTER_PROMPT" not in HELPERS_SRC or \
        "_ANTI_STALE_NARRATION_REGROUND" not in HELPERS_SRC.split("BASE_GAME_MASTER_PROMPT")[0]
    # every streak bump / reground call in the funnel is behind the plain-stall reason gate
    assert AGENT_SRC.count("stash_anti_stale_reground(owner)") >= 2  # post-commit + cap-hold
    # the reground enqueue is never called at import/module scope (only inside the funnel/helper)
    assert "\nstash_anti_stale_reground(" not in AGENT_SRC  # never a bare module-level call
