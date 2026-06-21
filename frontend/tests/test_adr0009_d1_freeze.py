"""ADR 0009 (D1) — the per-turn OCCUPANCY FREEZE for the whereabouts gadget.

Root cause #4 of the chat<->board location desync: the gadget polls LIVE presence, but the once-per-
turn off-screen `presenceTick` re-seats the house AFTER the moment prompt was built — so the board
"rearranges" to a newer arrangement right as the player finishes reading a scene grounded in the
PRE-tick occupancy. The freeze pins the gadget to the snapshot THIS turn's prose was grounded in
(captured at framing), re-applies the narrated moves the FE ITSELF issued (the D2 belt) so D2's
visibility is preserved, and holds the off-screen reshuffle back to next turn.

MITIGATION (the PO's overriding constraint — never a houseguest in a WRONG room): the freeze serves
only when the FE is fully confident; ANY uncertainty falls back to LIVE engine truth, and the
reconstruction fails toward OMISSION (a houseguest walking off-screen drops from the view) rather than
a wrong-room placement. These tests pin both halves.

Roles only — no names (the HARD testing rule). Houseguests are "Houseguest One/Two/..." with ids npc:N.
"""

import importlib

chat_helpers = importlib.import_module("routes.chat_helpers")


def _snapshot():
    """A fog-of-war whereabouts: player in the kitchen with one houseguest; two adjacent rooms."""
    return {
        "room": "kitchen",
        "present": [{"id": "npc:1", "name": "Houseguest One"}],
        "nearby": [
            {"room": "living-room", "present": [{"id": "npc:2", "name": "Houseguest Two"}]},
            {"room": "backyard", "present": [{"id": "npc:3", "name": "Houseguest Three"}]},
        ],
        "turnsHere": 2,
        "companions": [{"id": "npc:1", "name": "Houseguest One", "turnsHere": 1}],
    }


def _room_of(view, hid):
    """Where the reconstructed view places houseguest `hid` — None if not in the (fog-of-war) view."""
    for r in (view.get("present") or []):
        if r.get("id") == hid:
            return view.get("room")
    for nb in (view.get("nearby") or []):
        for r in (nb.get("present") or []):
            if r.get("id") == hid:
                return nb.get("room")
    return None


# ── _reconstruct_frozen: apply the FE's narrated moves inside the fog-of-war view ─────────── #

def test_reconstruct_no_moves_is_identity():
    snap = _snapshot()
    out = chat_helpers._reconstruct_frozen(snap, [])
    assert out == snap
    # Must be a COPY — never mutate the stored frozen snapshot.
    out["present"].append({"id": "x", "name": "x"})
    assert len(snap["present"]) == 1


def test_reconstruct_move_present_to_adjacent_room():
    # Houseguest One walks from the player's room out to an adjacent room.
    out = chat_helpers._reconstruct_frozen(_snapshot(), [{"id": "npc:1", "room": "living-room"}])
    assert _room_of(out, "npc:1") == "living-room"
    assert all(r.get("id") != "npc:1" for r in out["present"]), "must leave the player's room"


def test_reconstruct_move_adjacent_into_players_room():
    # Houseguest Two walks from an adjacent room into the player's room.
    out = chat_helpers._reconstruct_frozen(_snapshot(), [{"id": "npc:2", "room": "kitchen"}])
    assert _room_of(out, "npc:2") == "kitchen"
    lr = next(nb for nb in out["nearby"] if nb["room"] == "living-room")
    assert all(r.get("id") != "npc:2" for r in lr["present"]), "must leave the living room"


def test_reconstruct_move_to_distant_room_omits_not_misplaces():
    # THE MITIGATION: a destination OUTSIDE the fog-of-war view drops the houseguest from the gadget
    # (they walked off-screen) — it must NEVER place them in a wrong (in-view) room.
    out = chat_helpers._reconstruct_frozen(_snapshot(), [{"id": "npc:1", "room": "hoh-room"}])
    assert _room_of(out, "npc:1") is None, "off-view destination ⇒ omitted, never misplaced"
    # And nobody got drawn into the wrong room as a side effect.
    rooms = [out["room"]] + [nb["room"] for nb in out["nearby"]]
    assert "hoh-room" not in rooms


def test_reconstruct_one_place_at_a_time():
    # A houseguest moved is never shown in two rooms.
    out = chat_helpers._reconstruct_frozen(_snapshot(), [{"id": "npc:2", "room": "kitchen"}])
    seen = [r.get("id") for r in out["present"]]
    for nb in out["nearby"]:
        seen += [r.get("id") for r in nb["present"]]
    assert seen.count("npc:2") == 1


def test_reconstruct_walk_into_view_keeps_name():
    # A houseguest not in the frozen view walks in; the recorded `name` labels them (not the raw id).
    out = chat_helpers._reconstruct_frozen(
        _snapshot(), [{"id": "npc:9", "room": "kitchen", "name": "Houseguest Nine"}])
    hit = next((r for r in out["present"] if r.get("id") == "npc:9"), None)
    assert hit and hit.get("name") == "Houseguest Nine"


def test_reconstruct_walk_into_view_without_name_falls_back_to_id():
    out = chat_helpers._reconstruct_frozen(_snapshot(), [{"id": "npc:9", "room": "kitchen"}])
    hit = next((r for r in out["present"] if r.get("id") == "npc:9"), None)
    assert hit and hit.get("name") == "npc:9"


# ── freeze_view: serve the freeze only when fully confident; else live ────────────────────── #

def _reset(user="u1"):
    chat_helpers._TURN_WHEREABOUTS.pop(user, None)
    chat_helpers._TURN_NPC_MOVES.pop(user, None)
    chat_helpers._TURN_FREEZE_OK.pop(user, None)


def test_freeze_view_no_frozen_returns_live():
    _reset()
    live = _snapshot()
    assert chat_helpers.freeze_view("u1", live) is live  # fail-open: never framed ⇒ live


def test_freeze_view_happy_path_hides_reshuffle_shows_narrated_move():
    _reset()
    # Framing pins the prose's snapshot; the belt records one narrated move.
    chat_helpers.freeze_capture_whereabouts("u1", _snapshot())
    chat_helpers.freeze_record_npc_move("u1", "npc:1", "living-room", "Houseguest One")
    # LIVE has been reshuffled off-screen (Houseguest Three drifted into the kitchen) — the freeze must
    # NOT show that, but MUST show the narrated move (npc:1 → living-room).
    live = _snapshot()
    live["present"].append({"id": "npc:3", "name": "Houseguest Three"})  # the off-screen reshuffle
    out = chat_helpers.freeze_view("u1", live)
    assert out is not live, "must serve the frozen view, not live"
    assert _room_of(out, "npc:1") == "living-room", "the narrated move is shown (D2 preserved)"
    assert all(r.get("id") != "npc:3" for r in out["present"]), "the off-screen reshuffle is hidden"


def test_freeze_view_model_moved_falls_back_to_live():
    _reset()
    chat_helpers.freeze_capture_whereabouts("u1", _snapshot())
    chat_helpers.freeze_mark_model_moved("u1")  # the model moved a houseguest the FE couldn't capture
    live = _snapshot()
    assert chat_helpers.freeze_view("u1", live) is live


def test_freeze_view_player_recenter_falls_back_to_live():
    _reset()
    chat_helpers.freeze_capture_whereabouts("u1", _snapshot())  # frozen room = kitchen
    live = _snapshot()
    live["room"] = "bedroom-a"  # the player walked to a new room ⇒ the view re-centered
    assert chat_helpers.freeze_view("u1", live) is live


def test_freeze_capture_clears_on_empty_snapshot():
    _reset()
    chat_helpers.freeze_capture_whereabouts("u1", _snapshot())
    chat_helpers.freeze_capture_whereabouts("u1", None)  # pre-game / out of house
    live = _snapshot()
    assert chat_helpers.freeze_view("u1", live) is live  # cleared ⇒ live


def test_freeze_capture_resets_prior_turn_state():
    _reset()
    chat_helpers.freeze_capture_whereabouts("u1", _snapshot())
    chat_helpers.freeze_record_npc_move("u1", "npc:1", "living-room")
    chat_helpers.freeze_mark_model_moved("u1")
    # A new turn's framing must wipe the prior move log + confidence flag.
    chat_helpers.freeze_capture_whereabouts("u1", _snapshot())
    assert chat_helpers._TURN_NPC_MOVES.get("u1") == []
    assert chat_helpers._TURN_FREEZE_OK.get("u1") is True
