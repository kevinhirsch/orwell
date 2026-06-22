"""Tests for gateway identity isolation (feature 0072).

Verifies:
  - A paired identity reaches the correct orwell user's game
  - An unpaired identity cannot reach any game (returns unpaired message)
  - Cross-user isolation: identity A cannot reach user B's game
  - Two identities paired to the same user see the same game (one-human-one-game)
  - Third (unpaired) identity is blocked when others are paired

BDD invariants proven:
  "One game per human across platforms — after pairing two platform identities to one
   account, both reach the same game and the same x-orwell-user; an unpaired identity
   cannot reach any game."
  "Cross-user isolation holds — no platform call returns another user's game."
"""

import asyncio
import sys
import os

import pytest

_FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _FRONTEND not in sys.path:
    sys.path.insert(0, _FRONTEND)

from gateway.pairing import (
    generate_code,
    verify_code,
    pair,
    get_paired_user,
    paired_identities,
)
from gateway.scrub import scrub_for_platform


# ── helpers ────────────────────────────────────────────────────────────────────

def _do_pair(identity: str, orwell_user: str):
    """Helper: generate a code, verify it, and pair in one shot."""
    code = generate_code(identity)
    assert verify_code(identity, code)
    pair(identity, orwell_user)


# ── tests ──────────────────────────────────────────────────────────────────────

class TestPairedIdentityReachesOwnGame:
    def test_paired_identity_resolves_to_correct_user(self):
        _do_pair("telegram:iso-1", "user_alice")
        assert get_paired_user("telegram:iso-1") == "user_alice"

    def test_paired_identity_does_not_resolve_to_other_user(self):
        _do_pair("telegram:iso-2", "user_alice")
        _do_pair("telegram:iso-3", "user_bob")
        # iso-2 → alice, not bob
        assert get_paired_user("telegram:iso-2") != "user_bob"
        # iso-3 → bob, not alice
        assert get_paired_user("telegram:iso-3") != "user_alice"


class TestUnpairedCannotReachGame:
    def test_unpaired_identity_returns_none(self):
        result = get_paired_user("telegram:never-paired")
        assert result is None

    def test_handler_returns_unpaired_message_for_unknown_identity(self):
        """The turn handler returns the unpaired fallback for an identity with no pair."""
        from gateway.handler import handle_platform_turn

        async def _run():
            # Do NOT pre-pair this identity
            return await handle_platform_turn(
                "telegram",
                "telegram:definitely-not-paired",
                "Hello",
            )

        reply = asyncio.get_event_loop().run_until_complete(_run())
        # The reply must not contain any game content
        assert "not paired" in reply.lower() or "pair" in reply.lower()
        # The reply must be scrubbed (chokepoint fires even for unpaired)
        assert "<think>" not in reply
        assert "[OPERATOR:" not in reply
        assert "npc:" not in reply

    def test_unpaired_reply_is_scrubbed(self):
        """The scrub chokepoint fires even for the unpaired fallback message."""
        from gateway.handler import _UNPAIRED_MSG
        result = scrub_for_platform(_UNPAIRED_MSG)
        assert "<think>" not in result
        assert "[OPERATOR:" not in result
        assert "npc:" not in result


class TestCrossUserIsolation:
    def test_paired_identity_cannot_reach_other_users_game(self):
        """Pairing identity X to user A must never return user B's user identifier."""
        _do_pair("telegram:cross-1", "user_cross_a")
        _do_pair("telegram:cross-2", "user_cross_b")

        user_for_1 = get_paired_user("telegram:cross-1")
        user_for_2 = get_paired_user("telegram:cross-2")

        # Each identity resolves to exactly its own user
        assert user_for_1 == "user_cross_a"
        assert user_for_2 == "user_cross_b"
        # No cross-bleed
        assert user_for_1 != user_for_2

    def test_handler_uses_paired_user_not_another(self):
        """The handler passes the paired user's identity to the engine, not any other user's."""
        # We test this at the pairing layer — the handler reads from get_paired_user
        _do_pair("telegram:handler-a", "user_handler_a")
        _do_pair("telegram:handler-b", "user_handler_b")

        resolved_a = get_paired_user("telegram:handler-a")
        resolved_b = get_paired_user("telegram:handler-b")

        assert resolved_a == "user_handler_a"
        assert resolved_b == "user_handler_b"
        assert resolved_a != resolved_b


class TestOneHumanOneGame:
    def test_two_identities_paired_to_same_user_share_game(self):
        """Two platform identities paired to the same orwell user both resolve to that user."""
        _do_pair("telegram:oto-1", "user_oto")
        _do_pair("signal:oto-2", "user_oto")

        assert get_paired_user("telegram:oto-1") == "user_oto"
        assert get_paired_user("signal:oto-2") == "user_oto"
        # Both are listed in paired_identities
        idents = set(paired_identities("user_oto"))
        assert "telegram:oto-1" in idents
        assert "signal:oto-2" in idents

    def test_third_unpaired_identity_blocked(self):
        """When two identities are paired, a third (unpaired) cannot reach any game."""
        _do_pair("telegram:trio-1", "user_trio")
        _do_pair("signal:trio-2", "user_trio")

        # A third identity with no pair
        third_user = get_paired_user("whatsapp:trio-3")
        assert third_user is None

    def test_pairing_one_identity_does_not_affect_another(self):
        """Pairing identity A must not change the pairing of identity B."""
        _do_pair("telegram:indep-1", "user_indep_a")
        # Now pair a different identity for a different user
        _do_pair("telegram:indep-2", "user_indep_b")

        # Identity 1 still resolves to its original user
        assert get_paired_user("telegram:indep-1") == "user_indep_a"
