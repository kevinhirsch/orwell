"""BL-006 / BL-002 — the pre-emission fail-CLOSED scene breaker must catch a fabricated PLAYER
REMOVAL / EXPULSION that has NO corresponding engine beat, EVEN when the turn carries no BEFORE
baseline (a fresh process / framing hiccup).

Context (2026-07-16 full playtest audit, ranked backlog BL-001/BL-002/BL-003/BL-006):
    "the deterministic core held; the narration layer ran away from it." The narrator fabricated a
    first-HOH win (BL-001) and a season-terminal PLAYER REMOVAL (BL-002) as if they were engine-decided
    facts, while the engine sat frozen at `premiere`. BL-006 is the guard-side hole that let the whole
    fabricated-future class slip through: the pre-emission/faithfulness guard corrected claims that
    *contradict decided* state but had no clause for events that never ran at all.

The #1659 R2 fix (`_narration_claims_outcome` branch 7) verifies a player-removal DIRECTLY against
`playerStatus` — but that branch is only reached in `screen_streamed_scene_break` AFTER the
`if not before: return None` early-return, and the phase-scoped `_unbacked_outcome_absent` (which DOES
run ahead of that return, for the HOH/nom/veto/eviction/winner classes) had no player-removal clause.
So a fabricated expulsion narrated with no baseline this turn slipped past the fail-CLOSED breaker.

This file pins that the fail-CLOSED scene breaker now cuts a no-baseline phantom removal — WITHOUT
touching creative/social prose (ADR 0005 principle #1 — the open set is constitutionally protected):
the check is closed-set only (`_CLAIM_PLAYER_EXPULSION_RE` + a direct `playerStatus`/`finished` read),
stands down on a real removal (`playerStatus != "active"`) and on an unknown player identity, and never
reads the board for prose that carries no closed-set claim.

Roles only: throwaway proper nouns appear INSIDE narration strings to exercise the regexes
realistically (exactly as the sibling spine tests do) and never carry test intent.
"""

import asyncio
import importlib

import pytest

chat_helpers = importlib.import_module("routes.chat_helpers")
orwell_engine = importlib.import_module("src.orwell_engine")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


_USER = "u-bl006-fabricated-event"


@pytest.fixture(autouse=True)
def _clean_state():
    # Every case here deliberately runs with NO per-turn BEFORE baseline — the whole point is the
    # no-baseline path. Scrub both maps around each test so a stale entry can never mask the gap.
    chat_helpers._LAST_BEAT_SIG.pop(_USER, None)
    chat_helpers._DESYNC_REGROUND.pop(_USER, None)
    yield
    chat_helpers._LAST_BEAT_SIG.pop(_USER, None)
    chat_helpers._DESYNC_REGROUND.pop(_USER, None)


def _board(monkeypatch, *, phase="premiere", finished=False, player_status="active",
           hoh=None, evicted=0):
    """A live board with a RESOLVED player identity (top-level `player` dict) so the removal guard can
    read `playerStatus`. `player_status=None` models an unknown identity (the guard must stand down)."""
    house = [{"id": "player", "status": player_status or "active", "name": "Player"},
             {"id": "npc:1", "status": "active", "name": "Alpha"}]
    for i in range(evicted):
        house.append({"id": f"npc:{100 + i}", "status": "evicted", "name": f"Out{i}"})

    async def fake_status(user=None):
        return {"week": 1, "phase": phase, "hoh": ({"id": hoh} if hoh else None),
                "nominees": [], "veto": {"holder": None, "used": False, "players": []},
                "pending": None, "beatSeq": 3}

    async def fake_state(user=None, **kw):
        state = {"week": 1, "phase": phase, "finished": finished, "house": house, "beatSeq": 3}
        if player_status is not None:
            state["player"] = {"id": "player", "status": player_status}
        return state

    monkeypatch.setattr(orwell_engine, "game_status", fake_status)
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)


_PHANTOM_REMOVAL = ("The control room voice cuts through the house. \"You're being removed from the "
                    "game.\" The other houseguests fall silent as you gather your things. You're done here.")


# ── the core gap: a no-baseline phantom removal is CUT by the fail-CLOSED breaker ─────────────── #

def test_no_baseline_phantom_player_removal_is_cut(monkeypatch):
    """The exact BL-002 shape: a committed player expulsion narrated while the board shows the player
    STILL ACTIVE and the season not finished — with NO per-turn BEFORE baseline. The fail-CLOSED scene
    breaker must cut the whole scene and stash the next-turn re-ground."""
    _board(monkeypatch, phase="premiere", player_status="active", finished=False)
    assert _USER not in chat_helpers._LAST_BEAT_SIG  # no baseline this turn
    directive = _run(chat_helpers.screen_streamed_scene_break(_USER, _PHANTOM_REMOVAL))
    assert directive, "a no-baseline phantom player removal must be cut by the fail-closed breaker"
    assert "REMOVAL" in directive or "EXPULSION" in directive
    assert _USER in chat_helpers._DESYNC_REGROUND


def test_no_baseline_phantom_removal_survives_a_non_premiere_phase(monkeypatch):
    """A player expulsion has NO legitimate phase (unlike HOH/nom/veto/eviction, which are phase-scoped),
    so the breaker cuts a no-baseline phantom removal even mid-season (phase=`social`)."""
    _board(monkeypatch, phase="social", player_status="active", finished=False, hoh="npc:1", evicted=3)
    directive = _run(chat_helpers.screen_streamed_scene_break(_USER, _PHANTOM_REMOVAL))
    assert directive
    assert _USER in chat_helpers._DESYNC_REGROUND


# ── stand-downs: the guard must NOT fire on legitimate cases ───────────────────────────────────── #

def test_no_baseline_real_player_removal_stands_down(monkeypatch):
    """A player who is LEGITIMATELY out (`playerStatus != "active"`) is not a fabrication — the breaker
    stands down and does NOT cut (a real player eviction must narrate normally)."""
    _board(monkeypatch, phase="eviction", player_status="evicted", finished=False, evicted=1)
    directive = _run(chat_helpers.screen_streamed_scene_break(_USER, _PHANTOM_REMOVAL))
    assert directive is None
    assert _USER not in chat_helpers._DESYNC_REGROUND


def test_no_baseline_unknown_identity_stands_down(monkeypatch):
    """No resolvable player identity (`playerStatus` None) → the guard cannot prove a fabrication, so it
    stands down (mirrors the self-HOH branch's unknown-identity posture)."""
    _board(monkeypatch, phase="premiere", player_status=None, finished=False)
    directive = _run(chat_helpers.screen_streamed_scene_break(_USER, _PHANTOM_REMOVAL))
    assert directive is None
    assert _USER not in chat_helpers._DESYNC_REGROUND


def test_no_baseline_conditional_removal_is_flavor(monkeypatch):
    """A conditional / hypothetical removal ("if you were ever removed from the game…") is flavor, not a
    committed outcome — the breaker stands down (ADR 0005 #1: never rail-correct the open set)."""
    _board(monkeypatch, phase="premiere", player_status="active", finished=False)
    text = ("You lean back and wonder aloud: if you were ever removed from the game, who would even "
            "notice? The others just laugh it off.")
    directive = _run(chat_helpers.screen_streamed_scene_break(_USER, text))
    assert directive is None
    assert _USER not in chat_helpers._DESYNC_REGROUND


def test_no_baseline_creative_prose_is_never_cut_and_never_reads_board(monkeypatch):
    """ADR 0005 principle #1: creative/social prose with no closed-set claim is NEVER cut, and the cheap
    pre-filter short-circuits BEFORE any engine read — asserted by making the board reads raise."""
    async def boom(user=None):
        raise AssertionError("the scene breaker read the board for pure creative prose (ADR 0005 #1)")

    monkeypatch.setattr(orwell_engine, "game_status", boom)
    monkeypatch.setattr(orwell_engine, "get_game_state", boom)
    text = ("You drape a bedsheet over your shoulders and narrate the house as a doomed ocean liner. "
            "Everyone is laughing too hard to remember it is a competition. Someone removes the last "
            "slice of pizza from the counter and the room erupts.")
    directive = _run(chat_helpers.screen_streamed_scene_break(_USER, text))
    assert directive is None


# ── BL-001 regression: the sibling phantom-HOH class stays cut with no baseline ────────────────── #

def test_no_baseline_phantom_hoh_win_still_cut(monkeypatch):
    """Regression for BL-001: a fabricated HOH crown in a premiere-class phase with NO baseline is still
    cut by the (pre-existing) `_unbacked_outcome_absent` premiere-absence path — pinned here so the new
    player-removal branch never regresses its sibling."""
    _board(monkeypatch, phase="premiere", player_status="active", finished=False)
    directive = _run(chat_helpers.screen_streamed_scene_break(
        _USER, "Confetti rains down as a houseguest wins the Head of Household competition!"))
    assert directive
    assert "HEAD OF HOUSEHOLD" in directive
    assert _USER in chat_helpers._DESYNC_REGROUND


# ── the extracted helper: closed-set only, phase-independent, board-direct ─────────────────────── #

def test_unbacked_player_removal_helper_is_closed_set_only():
    live_active = {"phase": "premiere", "playerStatus": "active", "finished": False}
    # A committed expulsion while the player is active → a label.
    assert chat_helpers._unbacked_player_removal(
        "You're being removed from the game.", live_active)
    # Creative/social prose → None (never a label, no board contradiction).
    assert chat_helpers._unbacked_player_removal(
        "They linger by the pool trading quiet reads.", live_active) is None
    # A real removal (status not active) → None (stand down).
    assert chat_helpers._unbacked_player_removal(
        "You're being removed from the game.",
        {"phase": "eviction", "playerStatus": "evicted", "finished": False}) is None
    # Unknown identity → None (stand down).
    assert chat_helpers._unbacked_player_removal(
        "You're being removed from the game.",
        {"phase": "premiere", "playerStatus": None, "finished": False}) is None
    # Season finished → None (a finale removal is legitimate).
    assert chat_helpers._unbacked_player_removal(
        "You're being removed from the game.",
        {"phase": "finale", "playerStatus": "active", "finished": True}) is None


# ── source pin: the fail-CLOSED breaker reaches the removal check ahead of the baseline return ─── #

def _read_chat_helpers():
    import os
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(base, "routes", "chat_helpers.py"), encoding="utf-8") as fh:
        return fh.read()


def test_scene_breaker_wires_the_player_removal_absence_check():
    src = _read_chat_helpers()
    assert "def _unbacked_player_removal(" in src
    # It is consulted inside the scene breaker (so a no-baseline removal is reachable there).
    assert "_unbacked_player_removal(text, live)" in src
