"""2026-07-16 live-playthrough audit — fix 1: rename the canonical session at the STARTED edge.

A game-build chat mints as "Casting interview" (sessions.js) and, for the FIRST season, was NEVER
renamed: `needs_auto_name()` (routes/chat_helpers.py) deliberately only recognizes the generic
"Chat:"/timestamp placeholder patterns, not the diegetic casting title, and the only existing rename
seam was the RESTART-gated M1-7 client poll (`orwellOnboarding.js` `_orwellFreshSession`), which never
fires for the initial onboarding (P1: it's one continuous conversation, not a restart) — so a
first-time player's sidebar/tab title stayed "Casting interview" forever.

The fix adds `chat_helpers.rename_canonical_session_for_season_start`, fired from
`do_create_character`'s STARTED success path, reusing M1-7's exact naming semantics ("Season {N}"
from the same `orwell_seasons.get_season` counter GET /api/orwell/season reads) — idempotent: it only
renames a session whose current name is still literally "Casting interview".

Behavioral: drives the real SessionManager + the real orwell_game_session/orwell_seasons stores
(both redirected to a tmp path). Roles only; no names.
"""
from __future__ import annotations

import asyncio
import importlib

import pytest

ch = importlib.import_module("routes.chat_helpers")
ogs = importlib.import_module("src.orwell_game_session")
oseasons = importlib.import_module("src.orwell_seasons")
core_models = importlib.import_module("core.models")
ti = importlib.import_module("src.tool_implementations")

from core.session_manager import SessionManager


@pytest.fixture(autouse=True)
def _tmp_game_session_store(tmp_path, monkeypatch):
    monkeypatch.setattr(ogs, "GAME_SESSION_PATH", tmp_path / "orwell_game_session.json")


@pytest.fixture(autouse=True)
def _tmp_seasons_store(tmp_path, monkeypatch):
    monkeypatch.setattr(oseasons, "SEASONS_PATH", tmp_path / "orwell_seasons.json")


@pytest.fixture
def sm(monkeypatch):
    manager = SessionManager()
    monkeypatch.setattr(core_models, "_session_manager", manager)
    return manager


# ── the rename helper itself ──────────────────────────────────────────────────────────────

def test_rename_renames_casting_interview_to_season_n(sm):
    owner = "role-player-a"
    sid = "i0716-rename-a"
    sm.create_session(sid, "Casting interview", "http://x", "m", owner=owner)
    ogs.bind_game_session(owner, sid)

    ch.rename_canonical_session_for_season_start(owner)

    assert sm.sessions[sid].name == "Season 1"


def test_rename_reads_the_live_per_user_season_number(sm):
    owner = "role-player-b"
    sid = "i0716-rename-b"
    sm.create_session(sid, "Casting interview", "http://x", "m", owner=owner)
    ogs.bind_game_session(owner, sid)
    oseasons.increment_season(owner)  # now season 2

    ch.rename_canonical_session_for_season_start(owner)

    assert sm.sessions[sid].name == "Season 2"


def test_rename_is_case_insensitive_on_the_default_title(sm):
    owner = "role-player-c"
    sid = "i0716-rename-c"
    sm.create_session(sid, "casting INTERVIEW", "http://x", "m", owner=owner)
    ogs.bind_game_session(owner, sid)

    ch.rename_canonical_session_for_season_start(owner)

    assert sm.sessions[sid].name == "Season 1"


def test_rename_never_clobbers_a_player_customized_title(sm):
    """Idempotency: only rename FROM 'Casting interview' — a player who already renamed their
    chat keeps their own title."""
    owner = "role-player-d"
    sid = "i0716-rename-d"
    sm.create_session(sid, "My Favorite Chat", "http://x", "m", owner=owner)
    ogs.bind_game_session(owner, sid)

    ch.rename_canonical_session_for_season_start(owner)

    assert sm.sessions[sid].name == "My Favorite Chat"


def test_rename_is_idempotent_across_repeated_calls(sm):
    owner = "role-player-e"
    sid = "i0716-rename-e"
    sm.create_session(sid, "Casting interview", "http://x", "m", owner=owner)
    ogs.bind_game_session(owner, sid)

    ch.rename_canonical_session_for_season_start(owner)
    assert sm.sessions[sid].name == "Season 1"

    oseasons.increment_season(owner)  # a later call must NOT re-rename an already-renamed session
    ch.rename_canonical_session_for_season_start(owner)
    assert sm.sessions[sid].name == "Season 1"


def test_rename_noop_when_nothing_bound_yet(sm):
    owner = "role-player-f"
    sid = "i0716-rename-f"
    sm.create_session(sid, "Casting interview", "http://x", "m", owner=owner)
    # deliberately no ogs.bind_game_session call

    ch.rename_canonical_session_for_season_start(owner)

    assert sm.sessions[sid].name == "Casting interview"


def test_rename_noop_when_session_manager_unavailable(monkeypatch):
    monkeypatch.setattr(core_models, "_session_manager", None)
    owner = "role-player-g"
    ogs.bind_game_session(owner, "i0716-rename-g")

    # must not raise even with no session manager instance
    ch.rename_canonical_session_for_season_start(owner)


# ── the do_create_character success-path hook (the STARTED edge) ─────────────────────────

def test_do_create_character_invokes_rename_on_started_success(monkeypatch):
    owner = "role-player-h"
    oe = importlib.import_module("src.orwell_engine")

    async def _create(*a, **k):
        return {"started": True, "beatSeq": 1, "house": [], "portraitPrompts": []}

    monkeypatch.setattr(oe, "create_character", _create)
    monkeypatch.setattr(oe, "remember_pending", lambda *a, **k: None)

    calls = []
    monkeypatch.setattr(ch, "rename_canonical_session_for_season_start", lambda u: calls.append(u))

    asyncio.get_event_loop().run_until_complete(
        ti.do_create_character('{"playerName": "role-player-h"}', owner=owner))

    assert calls == [owner], "a started createCharacter must invoke the rename exactly once"


def test_do_create_character_skips_rename_on_a_refused_create(monkeypatch):
    owner = "role-player-i"
    oe = importlib.import_module("src.orwell_engine")

    async def _create(*a, **k):
        return {"started": True, "createRefused": True}

    monkeypatch.setattr(oe, "create_character", _create)
    monkeypatch.setattr(oe, "remember_pending", lambda *a, **k: None)

    calls = []
    monkeypatch.setattr(ch, "rename_canonical_session_for_season_start", lambda u: calls.append(u))

    asyncio.get_event_loop().run_until_complete(
        ti.do_create_character('{"playerName": "role-player-i"}', owner=owner))

    assert calls == [], "a refused/no-op create must never rename the session"


def test_do_create_character_skips_rename_when_not_started(monkeypatch):
    owner = "role-player-j"
    oe = importlib.import_module("src.orwell_engine")

    async def _create(*a, **k):
        return {"started": False}

    monkeypatch.setattr(oe, "create_character", _create)
    monkeypatch.setattr(oe, "remember_pending", lambda *a, **k: None)

    calls = []
    monkeypatch.setattr(ch, "rename_canonical_session_for_season_start", lambda u: calls.append(u))

    asyncio.get_event_loop().run_until_complete(
        ti.do_create_character('{"playerName": "role-player-j"}', owner=owner))

    assert calls == []
