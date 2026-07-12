"""S2-1 — a STRUCTURAL 'Enter the house' affordance when casting is finalizable.

When the engine's casting intake reports `finalizable` (a genuine interview: name + backstory +
motivation + a persona/strategy answer) and no season has started yet, the `/state` projection must
carry a Vault-free, renderable `enterHouse` affordance so the FE can offer the player their own
structural door into the house — not a line of prompt text the narration model may under-call
(the createCharacter under-call the belts already fight). This pins the server/structural half:
the overlay's gating + pass-through, its Vault-freeness, and that `/state` composes through it.

Roles only — no houseguest names appear here (they can't; the affordance is pre-game).
"""
import importlib
import re

import pathlib

orwell_routes = importlib.import_module("routes.orwell_routes")
_overlay = orwell_routes._casting_finalize_overlay


def _read(rel: str) -> str:
    return pathlib.Path(rel).read_text(encoding="utf-8", errors="ignore")


# ── the affordance appears exactly when the engine says casting is finalizable ─────────


def test_finalizable_pregame_gets_the_enter_house_affordance():
    st = {"started": False, "casting": {"ready": True, "finalizable": True, "known": {}}}
    out = _overlay(st)
    aff = out.get("enterHouse")
    assert isinstance(aff, dict), "a finalizable pre-game interview must surface enterHouse"
    assert aff.get("available") is True
    assert aff.get("label") == "Enter the house"
    assert aff.get("reason") == "casting-finalizable"


def test_affordance_is_additive_not_a_mutation_of_the_input():
    st = {"started": False, "casting": {"finalizable": True}}
    out = _overlay(st)
    assert out is not st, "the applied overlay returns a COPY, never mutates the engine read"
    assert "enterHouse" not in st, "the original state dict is left untouched"


# ── pass-through (byte-identical) in every non-applicable case ──────────────────────────


def test_not_finalizable_is_pass_through_byte_identical():
    # name-only `ready` is NOT enough — the affordance needs a genuine interview (`finalizable`).
    st = {"started": False, "casting": {"ready": True, "finalizable": False}}
    out = _overlay(st)
    assert out is st, "not finalizable ⇒ same object, no enterHouse"
    assert "enterHouse" not in out


def test_started_game_never_offers_entry():
    st = {"started": True, "casting": {"finalizable": True}}
    out = _overlay(st)
    assert out is st
    assert "enterHouse" not in out


def test_refused_casting_never_offers_entry():
    # A season already exists (in-progress/over) — a stale finalizable interview view must not
    # re-open the door.
    for refused in ("in-progress", "over"):
        st = {"started": False, "casting": {"finalizable": True, "refused": refused}}
        out = _overlay(st)
        assert out is st, f"refused={refused} ⇒ pass-through"
        assert "enterHouse" not in out


def test_no_casting_key_is_pass_through():
    st = {"started": False}
    out = _overlay(st)
    assert out is st
    assert "enterHouse" not in out


def test_malformed_input_fails_open():
    assert _overlay(None) is None
    assert _overlay("nope") == "nope"
    assert _overlay({"started": False, "casting": "weird"}) == {"started": False, "casting": "weird"}


# ── Vault-freeness: the affordance is pure UI metadata, no game state ───────────────────


def test_affordance_carries_no_game_state():
    st = {"started": False, "casting": {"finalizable": True}}
    aff = _overlay(st)["enterHouse"]
    blob = repr(aff).lower()
    for banned in ("vault", "secret", "hidden", "trust", "threat", "affinity", "vote", "winner"):
        assert banned not in blob, f"the enterHouse affordance must not leak {banned}"


# ── source pin: /state composes the raw engine truth through the casting-finalize overlay ─


def test_state_route_routes_through_the_casting_finalize_overlay():
    src = _read("routes/orwell_routes.py")
    # The affordance is applied on the RAW engine read, then wrapped by the house-entry latch.
    assert "_casting_finalize_overlay(st)" in src, (
        "/state must compose the raw engine truth through _casting_finalize_overlay so the "
        "'Enter the house' affordance renders on finalizable"
    )
    # …and it stays wrapped by the existing latch (never bypasses it — #1336 invariant holds).
    assert re.search(r"_house_entry_overlay\(\s*_current_user\(request\),\s*_casting_finalize_overlay\(st\)\s*\)", src), (
        "the casting-finalize overlay must be wrapped by _house_entry_overlay, not bypass it"
    )
