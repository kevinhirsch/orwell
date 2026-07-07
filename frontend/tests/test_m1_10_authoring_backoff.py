"""M1-10 (audit A11) — cast-authoring retry backoff + the per-season give-up cap.

Against a permanently-failing utility provider the authoring seams (createCharacter kick,
roster lazy backfill, manual/admin levers) used to re-burst identical same-second calls on
every re-kick, forever. These gates prove: (1) the TOTAL provider calls per houseguest per
season are bounded by the cap across any number of re-kicks; (2) the give-up is loud —
surfaced through ``giveups()`` / ``authoring_completeness()["givenUp"]``, the /admin/status
feed; (3) in-run retries back off exponentially, not same-second; (4) the new-season scrub
resets the ledger so a fresh cast authors from zero.

Roles only — generic ids, no cast material.
"""
from __future__ import annotations

import asyncio

import pytest

from src import orwell_cast_authoring as ca


@pytest.fixture(autouse=True)
def _fresh_ledger():
    ca._attempt_ledger.clear()
    ca._gaveup_logged.clear()
    yield
    ca._attempt_ledger.clear()
    ca._gaveup_logged.clear()


def _failing_llm(counter: dict):
    """A permanently-failing provider: always an EMPTY visible body (the burst-truncation
    shape), so every run exhausts its in-run retries."""
    async def llm(messages):
        counter["calls"] = counter.get("calls", 0) + 1
        return ""
    return llm


async def _never_write(profile):  # pragma: no cover — nothing ever parses
    raise AssertionError("write_fn must not be reached when no profile parses")


CAST = [{"id": "npc:1"}]


def test_give_up_cap_bounds_total_calls_across_rekicks():
    counter: dict = {}
    llm = _failing_llm(counter)
    for _ in range(5):  # five re-kicks — the audit's same-second burst pattern
        written = asyncio.get_event_loop().run_until_complete(
            ca.author_cast(CAST, llm, _never_write, user=None))
        assert written == 0
    assert counter["calls"] == ca._ATTEMPT_CAP, (
        "a permanently-failing provider must cost exactly the cap, no matter how many "
        f"times authoring is re-kicked (spent {counter['calls']})")
    assert ca.giveups(None) == ["npc:1"], "the give-up must be visible, not silent"


def test_give_up_is_surfaced_on_the_admin_completeness_block():
    counter: dict = {}
    llm = _failing_llm(counter)
    for _ in range(3):
        asyncio.get_event_loop().run_until_complete(
            ca.author_cast(CAST, llm, _never_write, user=None))
    cards = [{"id": "npc:1", "status": "active", "authored": False}]
    comp = ca.authoring_completeness(None, cards)
    assert comp["givenUp"] == ["npc:1"], (
        "/admin/status castAuthoring must carry the given-up ids (G11 visibility)")


def test_in_run_retries_back_off_exponentially(monkeypatch):
    sleeps: list = []

    async def fake_sleep(s):
        sleeps.append(s)

    monkeypatch.setattr(ca.asyncio, "sleep", fake_sleep)
    counter: dict = {}
    asyncio.get_event_loop().run_until_complete(
        ca.author_cast(CAST, _failing_llm(counter), _never_write, user=None))
    retry_sleeps = [s for s in sleeps if s]
    assert len(retry_sleeps) == ca._EMPTY_TRUNCATED_RETRIES
    assert all(b > a for a, b in zip(retry_sleeps, retry_sleeps[1:])), (
        f"backoff must grow between attempts, got {retry_sleeps}")
    assert retry_sleeps[0] == ca._RETRY_BACKOFF_SECONDS
    assert retry_sleeps[1] == ca._RETRY_BACKOFF_SECONDS * 2


def test_new_season_reset_clears_the_ledger():
    counter: dict = {}
    llm = _failing_llm(counter)
    for _ in range(3):
        asyncio.get_event_loop().run_until_complete(
            ca.author_cast(CAST, llm, _never_write, user=None))
    assert counter["calls"] == ca._ATTEMPT_CAP and ca.giveups(None) == ["npc:1"]
    ca.reset_attempts(None)
    assert ca.giveups(None) == []
    asyncio.get_event_loop().run_until_complete(
        ca.author_cast(CAST, llm, _never_write, user=None))
    assert counter["calls"] > ca._ATTEMPT_CAP, "a new season must author from zero again"


def test_ledger_is_per_user_scoped():
    counter: dict = {}
    llm = _failing_llm(counter)
    for _ in range(3):
        asyncio.get_event_loop().run_until_complete(
            ca.author_cast(CAST, llm, _never_write, user="user-a"))
    assert ca.giveups("user-a") == ["npc:1"]
    assert ca.giveups("user-b") == [], "one player's give-up must never gate another's cast"
