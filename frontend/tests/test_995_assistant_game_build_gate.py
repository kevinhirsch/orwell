"""#995 (#4) — the inherited-workspace "Assistant" crew singleton must NOT seed under the
game build.

`ensure_assistant_defaults` seeds an "Assistant" CrewMember + a pinned "Assistant" session for
every owner. That is an inherited-workspace artifact, NOT part of the Big Brother game — under
ORWELL_GAME_BUILD=1 it leaves a stray "Assistant" session in the bundle. Gate it on
game_build_enabled().

Fail-before / pass-after; roles only (player/admin). Real SessionManager + TaskScheduler against
the test DB.

Note: the coroutine is driven via the codebase's `get_event_loop().run_until_complete` pattern
(mirrors test_g32_persist_candidates.py) rather than an `async def` test — an `async def` test
under pytest-asyncio's auto mode closes the default event loop, which breaks downstream suite
tests that still call the deprecated `asyncio.get_event_loop()`.
"""
import asyncio

import pytest

from core.session_manager import SessionManager
from src.task_scheduler import TaskScheduler
from core import database as db


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _assistant_session_count(owner):
    s = db.SessionLocal()
    try:
        return s.query(db.Session).filter(
            db.Session.owner == owner,
            db.Session.name == "Assistant",
        ).count()
    finally:
        s.close()


@pytest.fixture
def scheduler():
    return TaskScheduler(SessionManager())


def test_assistant_does_not_seed_under_game_build(scheduler, monkeypatch):
    """ORWELL_GAME_BUILD=1 (the product default): no "Assistant" session is seeded."""
    monkeypatch.setenv("ORWELL_GAME_BUILD", "1")
    owner = "player-gamebuild"
    _run(scheduler.ensure_assistant_defaults(owner))
    assert _assistant_session_count(owner) == 0, (
        "the inherited 'Assistant' session must NOT seed under the game build"
    )


def test_assistant_seeds_with_game_build_off(scheduler, monkeypatch):
    """ORWELL_GAME_BUILD=0 (full workspace): the inherited behaviour is preserved."""
    monkeypatch.setenv("ORWELL_GAME_BUILD", "0")
    owner = "player-fullworkspace"
    _run(scheduler.ensure_assistant_defaults(owner))
    assert _assistant_session_count(owner) == 1, (
        "with the game build off, the 'Assistant' singleton must still seed (no regression)"
    )
