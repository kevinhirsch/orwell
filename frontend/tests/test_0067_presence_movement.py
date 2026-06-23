"""Feature 0067 — the NARRATED-DEPARTURES cue (FE half).

Increment #1 (engine) made present company HOLD the player's scene, so a houseguest leaves rarely
and for a reason. This half makes the leaving (and arriving) VISIBLE: the per-turn beat signature
now carries the player's room + who is in it, and `_render_presence_movement` turns the turn-to-turn
diff into an additive cue so the narrator voices the coming/going as a beat — never a silent pop-out.

ADDITIVE + fail-open by construction, and gated on an UNCHANGED player room (a room change is the
player walking, not NPC drift). Roles only — throwaway display names exercise the renderer.
"""
import importlib

chat_helpers = importlib.import_module("routes.chat_helpers")


def _sig(room, present):
    return {"room": room, "present": sorted(present)}


# ── the beat signature now captures the player's room + present company ───────────────────────

def test_beat_signature_captures_room_and_present_from_whereabouts():
    state = {
        "phase": "social",
        "whereabouts": {
            "room": "living-room",
            "present": [{"id": "npc:1", "name": "An Ally"}, {"id": "npc:2", "name": "A Rival"}],
        },
    }
    sig = chat_helpers._beat_signature({}, state)
    assert sig["room"] == "living-room"
    assert sig["present"] == ["A Rival", "An Ally"]  # sorted by name


def test_beat_signature_is_fail_safe_without_whereabouts():
    sig = chat_helpers._beat_signature({}, {"phase": "social"})
    assert sig["room"] is None
    assert sig["present"] == []


# ── the movement cue ──────────────────────────────────────────────────────────────────────────

def test_a_departure_is_voiced():
    prev = _sig("living-room", ["An Ally", "A Rival"])
    cur = _sig("living-room", ["An Ally"])  # the rival left
    line = chat_helpers._render_presence_movement(prev, cur)
    assert line is not None
    assert "A Rival" in line and "left" in line
    assert "living room" in line  # room id is humanized


def test_an_arrival_is_voiced():
    prev = _sig("kitchen", ["An Ally"])
    cur = _sig("kitchen", ["An Ally", "A Newcomer"])
    line = chat_helpers._render_presence_movement(prev, cur)
    assert line is not None
    assert "A Newcomer" in line and "come into" in line


def test_simultaneous_arrival_and_departure_both_voiced():
    prev = _sig("backyard", ["A Leaver"])
    cur = _sig("backyard", ["A Joiner"])
    line = chat_helpers._render_presence_movement(prev, cur)
    assert "A Leaver" in line and "left" in line
    assert "A Joiner" in line and "come into" in line


def test_no_cue_when_company_is_unchanged():
    prev = _sig("living-room", ["An Ally", "A Rival"])
    cur = _sig("living-room", ["A Rival", "An Ally"])  # same set, any order
    assert chat_helpers._render_presence_movement(prev, cur) is None


def test_no_cue_when_the_player_changed_rooms():
    # A room change is the PLAYER walking somewhere — the new room's company is not NPC drift, and the
    # model already knows the player moved. So the cue must stay silent (no false "everyone left!").
    prev = _sig("living-room", ["An Ally", "A Rival"])
    cur = _sig("bedroom-a", ["Someone Else"])
    assert chat_helpers._render_presence_movement(prev, cur) is None


def test_no_cue_without_a_prior_signature():
    assert chat_helpers._render_presence_movement(None, _sig("kitchen", ["An Ally"])) is None
    assert chat_helpers._render_presence_movement({}, {}) is None


def test_cue_never_floods_on_a_mass_change():
    prev = _sig("living-room", [f"HG {i}" for i in range(10)])
    cur = _sig("living-room", [])  # everyone gone
    line = chat_helpers._render_presence_movement(prev, cur)
    # Bounded to a handful of names so the cue can never balloon (ADR 0003 — prefer removing context).
    assert line.count("HG ") <= chat_helpers._PRESENCE_MOVE_MAX_NAMES
