"""LANE S2a / S7 — the IN-TURN closed-set OVERCLAIM hard-block (block → re-prompt → replace).

RC2 gap: S2b's fail-closed judge only QUEUES a NEXT-turn re-ground, so the captured msg53 fabrication
("Jasmine wins Head of Household!" narrated in `premiere` with `toolsCalled:[]`) still reached the player
THAT turn — `_narration_claims_outcome` is phase-gated (an HOH crown outside an `hoh` phase reads as
flavor), so nothing intercepted it. The owner's ruling: CORRECT/REALIGN the moment IN-BAND, this turn.

`chat_helpers.enforce_grounded_draft` is that mechanism. Given the finalized draft + the tools the turn
actually called, when the draft asserts a CLOSED-SET outcome the live board does NOT back AND no
progression tool fired, it BLOCKS the draft, re-prompts the model ONCE with a corrective wire, and — if
the regenerated draft is STILL ungrounded (or no re-prompt) — REPLACES it with a deterministic engine-
truth beat. S7 folds the "you've met everyone" overclaim into the same family. These gates pin that the
correction is IN-TURN (regenerated/replaced), never a mere next-turn queue, and that a GROUNDED outcome
is NEVER re-blocked (ADR 0005 principle #1 — the open set is untouched).

Roles only: throwaway proper nouns appear INSIDE narration strings to exercise the regexes realistically
(exactly as the sibling `test_0065_pre_emission_guard.py` does) and never carry test intent.
"""

import asyncio
import importlib

import pytest

chat_helpers = importlib.import_module("routes.chat_helpers")
orwell_engine = importlib.import_module("src.orwell_engine")
agent_loop = importlib.import_module("src.agent_loop")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


_USER = "u-s2a-realign"


@pytest.fixture(autouse=True)
def _clean_state():
    chat_helpers._LAST_BEAT_SIG.pop(_USER, None)
    chat_helpers._DESYNC_REGROUND.pop(_USER, None)
    yield
    chat_helpers._LAST_BEAT_SIG.pop(_USER, None)
    chat_helpers._DESYNC_REGROUND.pop(_USER, None)


# ── board fakes ──────────────────────────────────────────────────────────── #

def _premiere_board(monkeypatch):
    """A live PREMIERE board: no HOH reigns, no nominees, no veto, no one evicted, not finished."""
    async def fake_status(user=None):
        return {"week": 1, "phase": "premiere", "hoh": None, "nominees": [],
                "veto": {"holder": None, "used": False, "players": []}, "pending": None, "beatSeq": 3}

    async def fake_state(user=None, **kw):
        house = [{"id": "player", "status": "active", "name": "Player"},
                 {"id": "npc:1", "status": "active", "name": "Alpha"}]
        return {"week": 1, "phase": "premiere", "finished": False, "house": house, "beatSeq": 3}

    monkeypatch.setattr(orwell_engine, "game_status", fake_status)
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)


def _hoh_committed_board(monkeypatch):
    """A live board where the HOH really committed this turn (phase `hoh`, a holder set)."""
    async def fake_status(user=None):
        return {"week": 1, "phase": "hoh", "hoh": {"id": "npc:1", "name": "Alpha"}, "nominees": [],
                "veto": {"holder": None, "used": False, "players": []}, "pending": None, "beatSeq": 5}

    async def fake_state(user=None, **kw):
        house = [{"id": "player", "status": "active", "name": "Player"},
                 {"id": "npc:1", "status": "active", "name": "Alpha"}]
        return {"week": 1, "phase": "hoh", "finished": False, "house": house,
                "player": {"id": "player"}, "beatSeq": 5}

    monkeypatch.setattr(orwell_engine, "game_status", fake_status)
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)


def _fake_intros(monkeypatch, remaining):
    async def fake_premiere_intros(user=None):
        return {"remaining": remaining}
    monkeypatch.setattr(orwell_engine, "premiere_intros", fake_premiere_intros)


_HOH_FABRICATION = "The lights flash and a houseguest wins the Head of Household competition!"


# ── (a) the msg53 case: premiere HOH claim + toolsCalled:[] → BLOCKED, corrected IN-TURN ─────────── #

def test_premiere_hoh_overclaim_is_regenerated_in_turn(monkeypatch):
    """The re-prompt returns a GROUNDED draft → the fabrication is REPLACED in-turn by the fresh, grounded
    narration (`action="regenerated"`), NOT merely queued for next turn."""
    _premiere_board(monkeypatch)

    async def regen_grounded(directive):
        # A grounded premiere beat — no closed-set claim at all.
        assert "RE-GROUND" in directive and "premiere" in directive
        return "The houseguests mill around the kitchen, sizing each other up before anything is decided."

    res = _run(chat_helpers.enforce_grounded_draft(_USER, _HOH_FABRICATION, [], regenerate=regen_grounded))
    assert res.action == "regenerated"          # corrected IN-TURN, not queued
    assert "wins the Head of Household" not in res.text
    assert res.text != _HOH_FABRICATION
    assert res.directive                         # the corrective wire was built


def test_premiere_hoh_overclaim_is_replaced_when_regen_still_ungrounded(monkeypatch):
    """The one re-prompt comes back STILL fabricating → REPLACE with the deterministic engine-truth beat
    (`action="replaced"`) — the fabrication never becomes the final word this turn."""
    _premiere_board(monkeypatch)

    async def regen_still_bad(directive):
        return "Confetti rains down — Jasmine is crowned the new Head of Household!"

    res = _run(chat_helpers.enforce_grounded_draft(_USER, _HOH_FABRICATION, [], regenerate=regen_still_bad))
    assert res.action == "replaced"              # corrected IN-TURN (engine-truth beat), not queued
    assert "Jasmine" not in res.text
    assert "Head of Household" not in res.text
    assert "week 1" in res.text and "premiere" in res.text   # producer-voice, states the real board


def test_premiere_hoh_overclaim_is_replaced_when_no_regen(monkeypatch):
    """No re-prompt callback available → a blocked draft goes straight to the engine-truth replacement."""
    _premiere_board(monkeypatch)
    res = _run(chat_helpers.enforce_grounded_draft(_USER, _HOH_FABRICATION, []))
    assert res.action == "replaced"
    assert "Head of Household" not in res.text
    # And the next-turn backstop is ALSO stashed (belt-and-suspenders — never the only line).
    assert _USER in chat_helpers._DESYNC_REGROUND


def test_block_is_in_turn_not_only_a_queued_reground(monkeypatch):
    """The distinguishing proof vs S2b: the RETURNED text is changed IN-TURN (the fabrication removed),
    not merely a stashed next-turn directive while the fabrication passes through unchanged."""
    _premiere_board(monkeypatch)
    res = _run(chat_helpers.enforce_grounded_draft(_USER, _HOH_FABRICATION, []))
    assert res.action != "pass"
    assert res.text != _HOH_FABRICATION          # the emitted text this turn no longer carries the lie


# ── (b) a GROUNDED outcome is NEVER re-blocked ──────────────────────────────── #

def test_grounded_hoh_result_passes_when_board_has_the_event(monkeypatch):
    """The engine really committed the crown this turn (phase `hoh`, a holder set that was empty at turn
    start) → the draft PASSES unchanged (ADR 0005 #1 — a grounded outcome is never re-blocked)."""
    chat_helpers._LAST_BEAT_SIG[_USER] = {
        "week": 1, "phase": "hoh", "pending": None, "hoh": None, "hohName": None,
        "noms": [], "nomNames": [], "activeNames": ["Player", "Alpha"],
        "vetoHolder": None, "vetoHolderName": None, "vetoUsed": False,
        "playerIsHoh": None, "playerHasVeto": None, "evicted": 0, "finished": False,
    }
    _hoh_committed_board(monkeypatch)
    res = _run(chat_helpers.enforce_grounded_draft(
        _USER, "The competition ends and a houseguest wins the Head of Household!", []))
    assert res.action == "pass"
    assert res.text == "The competition ends and a houseguest wins the Head of Household!"
    assert _USER not in chat_helpers._DESYNC_REGROUND


def _baseline_premiere():
    """A turn-start baseline captured while the board was still in premiere (no HOH yet)."""
    return {
        "week": 1, "phase": "premiere", "pending": None, "hoh": None, "hohName": None,
        "noms": [], "nomNames": [], "activeNames": ["Player", "Alpha"],
        "vetoHolder": None, "vetoHolderName": None, "vetoUsed": False,
        "playerIsHoh": None, "playerHasVeto": None, "evicted": 0, "finished": False,
    }


def test_progression_tool_committed_grounded_outcome_passes(monkeypatch):
    """Findings 3+4: a progression tool fired AND the board actually COMMITTED the outcome (a fresh crown:
    baseline had no HOH, the live board now does) → the grounded HOH claim PASSES. A progression tool is
    not a blanket pass, but a board-backed outcome must never be re-blocked (ADR 0005 #1)."""
    chat_helpers._LAST_BEAT_SIG[_USER] = _baseline_premiere()
    _hoh_committed_board(monkeypatch)  # phase moved premiere→hoh, a holder is now set
    res = _run(chat_helpers.enforce_grounded_draft(
        _USER, "The competition ends and a houseguest wins the Head of Household!", ["advanceGame"]))
    assert res.action == "pass"
    assert _USER not in chat_helpers._DESYNC_REGROUND


def test_progression_tool_does_not_license_an_ungrounded_sibling_claim(monkeypatch):
    """Finding 3: a committed HOH crown (advanceGame fired, board moved) does NOT let an ungrounded
    EVICTION claim in the SAME text pass — the per-claim verification still catches the sibling
    fabrication even though a progression tool ran."""
    chat_helpers._LAST_BEAT_SIG[_USER] = _baseline_premiere()
    _hoh_committed_board(monkeypatch)  # a crown really committed; NO eviction did (evicted stays 0)
    text = ("A houseguest wins the Head of Household — and moments later the house votes to evict "
            "another player, who is now out of the game.")
    res = _run(chat_helpers.enforce_grounded_draft(_USER, text, ["advanceGame"]))
    assert res.action != "pass"                 # the ungrounded eviction sibling is caught
    assert res.text != text


def test_creative_prose_passes_untouched_open_set(monkeypatch):
    """ADR 0005 #1: a draft with NO closed-set claim is never policed, even on a premiere board."""
    _premiere_board(monkeypatch)
    prose = ("The player drapes a bedsheet over their shoulders and narrates the house as a doomed ocean "
             "liner; everyone is laughing too hard to remember it is a competition.")
    res = _run(chat_helpers.enforce_grounded_draft(_USER, prose, []))
    assert res.action == "pass"
    assert res.text == prose
    assert _USER not in chat_helpers._DESYNC_REGROUND


# ── (c) S7 — the "you've met everyone" closed-set overclaim ─────────────────── #

def test_met_everyone_with_unmet_remaining_is_blocked(monkeypatch):
    """'you've met everyone' while the engine's meet-set still has 2 houseguests to introduce → BLOCKED
    and REPLACED in-turn (same guard family)."""
    _premiere_board(monkeypatch)
    _fake_intros(monkeypatch, [{"houseguest": {"id": "npc:9", "name": "Iris"}},
                               {"houseguest": {"id": "npc:10", "name": "Jax"}}])
    res = _run(chat_helpers.enforce_grounded_draft(
        _USER, "Great — that's the whole cast; you've met everyone in the house now.", []))
    assert res.action == "replaced"
    assert "met everyone" not in res.text
    assert _USER in chat_helpers._DESYNC_REGROUND


def test_met_everyone_passes_when_meet_set_is_complete(monkeypatch):
    """When the meet-set is genuinely complete (`remaining` empty) the claim is grounded → PASS."""
    _premiere_board(monkeypatch)
    _fake_intros(monkeypatch, [])
    res = _run(chat_helpers.enforce_grounded_draft(
        _USER, "You've met everyone in the house now — the whole cast is accounted for.", []))
    assert res.action == "pass"
    assert _USER not in chat_helpers._DESYNC_REGROUND


# ── mid-stream: the premiere HOH fabrication is CUT before it fully streams ─── #

def test_scene_break_cuts_premiere_hoh_absence(monkeypatch):
    """`screen_streamed_scene_break` now HOLDS a premiere-class board-absence fabrication mid-stream (no
    BEFORE baseline needed) — the phase + absence is the impossibility, so msg53 never fully streams."""
    _premiere_board(monkeypatch)  # no _LAST_BEAT_SIG set — the absence cut needs no baseline
    directive = _run(chat_helpers.screen_streamed_scene_break(
        _USER, "Confetti falls as a houseguest wins the Head of Household competition!"))
    assert directive
    assert "HEAD OF HOUSEHOLD" in directive
    assert _USER in chat_helpers._DESYNC_REGROUND


def test_scene_break_leaves_premiere_creative_prose_alone(monkeypatch):
    """A premiere board + pure creative prose is NEVER cut (the cheap closed-set pre-filter short-circuits
    before any board read)."""
    async def boom(user=None):
        raise AssertionError("the scene-break read the board for pure creative prose (ADR 0005 #1)")

    monkeypatch.setattr(orwell_engine, "game_status", boom)
    monkeypatch.setattr(orwell_engine, "get_game_state", boom)
    directive = _run(chat_helpers.screen_streamed_scene_break(
        _USER, "The houseguests trade nervous jokes by the pool while the sun goes down."))
    assert directive is None


def test_screen_streamed_met_everyone_holds_when_unmet(monkeypatch):
    """The mid-stream S7 sentence guard HOLDS 'you've met everyone' while unmet houseguests remain."""
    _premiere_board(monkeypatch)
    _fake_intros(monkeypatch, [{"houseguest": {"id": "npc:9", "name": "Iris"}}])
    emit = _run(chat_helpers.screen_streamed_met_everyone(_USER, "And now you've met everyone!"))
    assert emit is False


def test_screen_streamed_met_everyone_emits_when_complete(monkeypatch):
    """It EMITS when the meet-set is complete (or a non-met sentence)."""
    _premiere_board(monkeypatch)
    _fake_intros(monkeypatch, [])
    assert _run(chat_helpers.screen_streamed_met_everyone(_USER, "And now you've met everyone!")) is True
    assert _run(chat_helpers.screen_streamed_met_everyone(_USER, "They chat quietly by the pool.")) is True


# ── source-pins + parity ───────────────────────────────────────────────────── #

def _read(rel):
    import os
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(base, rel), encoding="utf-8") as fh:
        return fh.read()


def test_progression_tools_parity_with_agent_loop():
    """`chat_helpers._S2A_PROGRESSION_TOOLS` stays in lock-step with `agent_loop._PROGRESSION_TOOLS`."""
    assert set(chat_helpers._S2A_PROGRESSION_TOOLS) == set(agent_loop._PROGRESSION_TOOLS)


def test_agent_loop_wires_the_in_turn_realignment_belt():
    src = _read("src/agent_loop.py")
    # The round-end belt calls the mechanism and, on a replaced draft, emits a `realign_body` CONTROL
    # event carrying only the engine-truth beat (finding 1 / #1664) — the route EXCISES the phantom
    # from the persisted body, never appends a correction after the fabrication.
    assert "enforce_grounded_draft as _enforce_grounded" in src
    assert '_s2a.action == "replaced"' in src
    assert 'json.dumps({"type": "realign_body", "beat": _s2a.text})' in src
    # The mid-stream S7 guard is wired into the pre-emission sentence loop.
    assert "screen_streamed_met_everyone" in src


def test_chat_route_excises_the_phantom_from_the_persisted_body():
    """Finding 1 (#1664): the agent-mode route branch runs `strip_ungrounded_closed_set` on its OWN
    accumulated `full_response` (the persisted buffer), appends the engine-truth beat, and re-streams the
    corrected text — it does NOT merely append a correction after the fabrication."""
    src = _read("routes/chat_routes.py")
    assert 'data.get("type") == "realign_body"' in src
    assert "strip_ungrounded_closed_set" in src
    # The excision runs on the route's persisted buffer (full_response), then the corrected body is
    # re-streamed to the client as a `text` field.
    assert "strip_ungrounded_closed_set(" in src
    assert '"type": "realign_body", "text": full_response' in src
    # The append is GATED on the excision flag — the beat is never appended to an unstripped body.
    assert "_did_excise" in src


def test_strip_ungrounded_closed_set_removes_only_the_phantom_sentence(monkeypatch):
    """The excision DROPS the fabricated closed-set sentence(s) and KEEPS creative/social prose
    byte-identical (ADR 0005 #1). On a premiere board an HOH-win sentence is a fabrication by
    construction; the surrounding open-set prose survives unchanged. Returns (cleaned, excised=True)."""
    _premiere_board(monkeypatch)
    body = ("The houseguests trade nervous jokes by the pool. "
            "A houseguest wins the Head of Household competition! "
            "The player drifts toward the kitchen to scheme.")
    out, excised = _run(chat_helpers.strip_ungrounded_closed_set(_USER, body, []))
    assert excised is True                           # a sentence was actually dropped
    assert "Head of Household" not in out            # the phantom closed-set sentence was excised
    assert "trade nervous jokes by the pool" in out  # open-set prose survives byte-identical
    assert "drifts toward the kitchen to scheme" in out


def test_strip_ungrounded_closed_set_stands_down_on_progression_tool(monkeypatch):
    """When a progression tool committed the outcome (board moved off the turn-start baseline) the
    excision removes nothing — a grounded outcome is never stripped: (body, False)."""
    chat_helpers._LAST_BEAT_SIG[_USER] = {
        "week": 1, "phase": "premiere", "pending": None, "hoh": None, "hohName": None,
        "noms": [], "nomNames": [], "activeNames": ["Player", "Alpha"],
        "vetoHolder": None, "vetoHolderName": None, "vetoUsed": False,
        "playerIsHoh": None, "playerHasVeto": None, "evicted": 0, "finished": False,
    }
    _hoh_committed_board(monkeypatch)  # phase moved premiere→hoh, a holder is now set
    body = "The competition ends and a houseguest wins the Head of Household!"
    out, excised = _run(chat_helpers.strip_ungrounded_closed_set(_USER, body, ["advanceGame"]))
    assert out == body and excised is False  # progression tool + moved board ⇒ grounded ⇒ nothing excised


def test_strip_ungrounded_closed_set_is_fail_open_on_pure_prose(monkeypatch):
    """Pure open-set prose never reaches the board read and is returned byte-identical: (prose, False)."""
    async def boom(user=None):
        raise AssertionError("read the board for pure creative prose (ADR 0005 #1)")

    monkeypatch.setattr(orwell_engine, "game_status", boom)
    monkeypatch.setattr(orwell_engine, "get_game_state", boom)
    prose = "The player narrates the house as a doomed ocean liner and everyone laughs too hard."
    out, excised = _run(chat_helpers.strip_ungrounded_closed_set(_USER, prose, []))
    assert out == prose and excised is False


def test_strip_fail_open_board_error_reports_not_excised(monkeypatch):
    """Finding 1 follow-up (#1664): when the board read HICCUPS mid-excision the helper is fail-open and
    returns (body_UNCHANGED, False) — so the caller declines to append the beat and never persists the
    fabrication followed by a correction. The body carries a closed-set claim (passes the pre-filter),
    but the board read raises, so no sentence can be verified/dropped."""
    async def boom_status(user=None):
        raise RuntimeError("engine unreachable mid-turn")

    # get_game_state raising makes `_capture_beat_signature` return None → `_detect_ungrounded_overclaim`
    # emits (conservatism), so no sentence is dropped → excised is False, body unchanged.
    monkeypatch.setattr(orwell_engine, "game_status", boom_status)
    monkeypatch.setattr(orwell_engine, "get_game_state", boom_status)
    body = "A houseguest wins the Head of Household competition! The house erupts in cheers."
    out, excised = _run(chat_helpers.strip_ungrounded_closed_set(_USER, body, []))
    assert excised is False           # nothing confirmed excised on the board-read hiccup
    assert out == body                # body returned UNCHANGED (fail-open) — caller must NOT append


def test_chat_helpers_holds_the_mechanism():
    src = _read("routes/chat_helpers.py")
    assert "async def enforce_grounded_draft(" in src
    assert "def _unbacked_outcome_absent(" in src
    assert "def _engine_truth_beat(" in src
    # The scene-break gained the pre-ceremony board-absence cut.
    assert "_unbacked_outcome_absent(text, live)" in src
