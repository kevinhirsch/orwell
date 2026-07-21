"""#1752 — the terminal HARD-CONSTRAINTS stash/pop must be keyed by SESSION, not user, so two
overlapping same-user turns (distinct sessions per ADR 0008/0012) never steal each other's block."""
from routes import chat_helpers as ch


def _clear():
    ch._LAST_FRAMED_HARD_CONSTRAINTS.clear()


def test_two_sessions_same_user_do_not_collide():
    _clear()
    ch._stash_hard_constraints("sess-A", {"hardConstraints": "PIN-A"})
    ch._stash_hard_constraints("sess-B", {"hardConstraints": "PIN-B"})
    # Each session pops its OWN block regardless of interleaving order.
    assert ch.pop_framed_hard_constraints("sess-B") == "PIN-B"
    assert ch.pop_framed_hard_constraints("sess-A") == "PIN-A"
    # One-shot: a second pop yields nothing.
    assert ch.pop_framed_hard_constraints("sess-A") is None
    assert ch.pop_framed_hard_constraints("sess-B") is None


def test_blank_or_missing_clears_only_that_session():
    _clear()
    ch._stash_hard_constraints("sess-A", {"hardConstraints": "PIN-A"})
    ch._stash_hard_constraints("sess-B", {"hardConstraints": "PIN-B"})
    # A later framing for sess-A with no/blank constraints CLEARS only sess-A, never sess-B.
    ch._stash_hard_constraints("sess-A", {"hardConstraints": "   "})
    ch._stash_hard_constraints("sess-B-other", {})  # non-mapping-ish / missing field
    assert ch.pop_framed_hard_constraints("sess-A") is None
    assert ch.pop_framed_hard_constraints("sess-B") == "PIN-B"


def test_none_session_falls_back_to_default_key_isolated():
    _clear()
    ch._stash_hard_constraints(None, {"hardConstraints": "PIN-DEFAULT"})
    ch._stash_hard_constraints("sess-A", {"hardConstraints": "PIN-A"})
    assert ch.pop_framed_hard_constraints("sess-A") == "PIN-A"
    assert ch.pop_framed_hard_constraints(None) == "PIN-DEFAULT"
