"""#529 (launch-blocker, FE half): the createCharacter finalize fallback must REFUSE-AND-SURFACE.

The engine no longer fabricates canon about the human player (no name-hash appearance, no
DEFAULT_ARCHETYPE, no placeholder background): a required casting field absent ⇒ createCharacter is
refused (`createRefused: casting-incomplete`). The FE finalize fallback must NOT loop the model on a
generic "finalize" nudge (that re-issues the same refused call) — it must surface the GAP so the model
asks the player for it, and must never let blanks be invented.

These pin the FE-side seam: the `_casting_incomplete_steer` helper and its wiring.
"""
import importlib
import os

agent_loop = importlib.import_module("src.agent_loop")


def test_steer_names_the_missing_fields_in_player_terms():
    steer = agent_loop._casting_incomplete_steer(["archetype", "strategy"])
    low = steer.lower()
    # player-facing labels for the engine field ids
    assert "archetype" in low
    assert "strategy" in low
    # it must steer the model to ASK and file with updateCasting, never fabricate or re-call create
    assert "updatecasting" in low
    assert "never make up" in low or "never invent" in low
    assert "ask" in low
    assert "do not call createcharacter" in low


def test_steer_handles_name_and_unknown_field():
    steer = agent_loop._casting_incomplete_steer(["name", "someNewField"])
    assert "their name" in steer.lower()
    # an unknown field id falls through to its raw label (never fabricated content)
    assert "someNewField" in steer


def test_steer_handles_empty_missing_list():
    steer = agent_loop._casting_incomplete_steer([])
    assert "casting is incomplete" in steer.lower()
    assert "required casting detail" in steer.lower()


def test_label_join_oxford_comma():
    assert agent_loop._join_casting_labels(["a"]) == "a"
    assert agent_loop._join_casting_labels(["a", "b"]) == "a and b"
    assert agent_loop._join_casting_labels(["a", "b", "c"]) == "a, b, and c"


def test_refuse_and_surface_is_wired_into_the_finalize_fallback():
    src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "src", "agent_loop.py"), encoding="utf-8").read()
    # the forced-createCharacter path branches on the engine's createRefused and surfaces the gap
    assert 'if _eng.get("createRefused"):' in src
    assert "_casting_incomplete_steer(_missing)" in src
    # and it does NOT march the stall counter further on a refusal (it isn't the model stalling)
    assert "undo this turn's bump" in src
