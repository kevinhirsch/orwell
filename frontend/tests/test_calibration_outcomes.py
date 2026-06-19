"""Calibration instrumentation — the per-season outcome log + its admin read.

Covers the store (`orwell_outcomes.py`), the capture helpers wired into the orwell routes, and
the admin-gated read route. Name-agnostic; the engine + stores are monkeypatched (no running
engine, no real files). Vault-free by construction: every logged field is a public, post-finale,
player-known outcome fact.

pytest-asyncio is in AUTO mode — these are SYNC tests; async route handlers run via the FastAPI
TestClient, and the one async capture helper is driven with run_until_complete (never asyncio.run,
which would close the loop and break later tests).
"""

import asyncio
import importlib

from fastapi import FastAPI
from fastapi.testclient import TestClient

orwell_engine = importlib.import_module("src.orwell_engine")
orwell_routes = importlib.import_module("routes.orwell_routes")
orwell_outcomes = importlib.import_module("src.orwell_outcomes")
orwell_seasons = importlib.import_module("src.orwell_seasons")
admin_calibration_routes = importlib.import_module("routes.admin_calibration_routes")


def _run(coro):
    """Drive an async helper synchronously without closing the shared loop (asyncio AUTO mode)."""
    return asyncio.get_event_loop().run_until_complete(coro)


# ── the store ──────────────────────────────────────────────────────────────────────────────────

def test_record_outcome_appends_and_is_idempotent(tmp_path, monkeypatch):
    monkeypatch.setattr(orwell_outcomes, "OUTCOMES_PATH", tmp_path / "o.json")
    new = orwell_outcomes.record_outcome(
        "u", season=1, placement="runner-up", social_scenes=4,
        competition_wins=2, jury_margin=3, winner_name="Some One", weeks_played=11,
    )
    assert new is True
    # The exact same finished season must NOT double-log (a poll re-observing it).
    again = orwell_outcomes.record_outcome(
        "u", season=1, placement="runner-up", social_scenes=4,
        competition_wins=2, jury_margin=3, winner_name="Some One", weeks_played=11,
    )
    assert again is False
    rows = orwell_outcomes.outcomes_for("u")
    assert len(rows) == 1
    r = rows[0]
    assert r["placement"] == "runner-up" and r["socialScenes"] == 4
    assert r["competitionWins"] == 2 and r["juryMargin"] == 3
    assert r["winnerName"] == "Some One" and r["weeksPlayed"] == 11


def test_record_outcome_is_per_user_isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(orwell_outcomes, "OUTCOMES_PATH", tmp_path / "o.json")
    orwell_outcomes.record_outcome("a", season=1, placement="jury", social_scenes=0,
                                   competition_wins=0, jury_margin=None)
    assert len(orwell_outcomes.outcomes_for("a")) == 1
    assert orwell_outcomes.outcomes_for("b") == []  # another user's log is untouched


def test_record_outcome_distinct_seasons_both_logged(tmp_path, monkeypatch):
    monkeypatch.setattr(orwell_outcomes, "OUTCOMES_PATH", tmp_path / "o.json")
    orwell_outcomes.record_outcome("u", season=1, placement="evicted", social_scenes=0,
                                   competition_wins=0, jury_margin=None)
    orwell_outcomes.record_outcome("u", season=2, placement="winner", social_scenes=9,
                                   competition_wins=3, jury_margin=5, winner_name="The Player")
    rows = orwell_outcomes.outcomes_for("u")
    assert [r["season"] for r in rows] == [1, 2]


def test_store_survives_corruption(tmp_path, monkeypatch):
    p = tmp_path / "o.json"
    p.write_text("{ not json", encoding="utf-8")
    monkeypatch.setattr(orwell_outcomes, "OUTCOMES_PATH", p)
    assert orwell_outcomes.outcomes_for("u") == []  # a corrupt store never breaks the game
    # And a write still lands (overwriting the corrupt file).
    assert orwell_outcomes.record_outcome("u", season=1, placement="jury", social_scenes=1,
                                          competition_wins=0, jury_margin=None) is True


def test_all_outcomes_and_reset(tmp_path, monkeypatch):
    monkeypatch.setattr(orwell_outcomes, "OUTCOMES_PATH", tmp_path / "o.json")
    orwell_outcomes.record_outcome("a", season=1, placement="jury", social_scenes=2,
                                   competition_wins=1, jury_margin=None)
    orwell_outcomes.record_outcome("b", season=1, placement="evicted", social_scenes=0,
                                   competition_wins=0, jury_margin=None)
    everyone = orwell_outcomes.all_outcomes()
    assert set(everyone.keys()) == {"a", "b"}
    orwell_outcomes.reset_outcomes("a")
    assert orwell_outcomes.outcomes_for("a") == []
    assert len(orwell_outcomes.outcomes_for("b")) == 1  # reset is scoped to one user


# ── the capture helpers (pure, name-agnostic) ────────────────────────────────────────────────────

def test_comp_win_counter_only_player_comp_lines():
    highlights = [
        "The Player wins Head of Household",
        "Someone Else wins the Power of Veto",
        "The Player wins the Power of Veto",
        "The Player wins the final Head of Household",
        "The Player makes a deal with Someone",   # not a comp — must NOT count
        "The Player is nominated",                 # not a win
    ]
    assert orwell_routes._count_player_comp_wins(highlights, "The Player") == 3
    assert orwell_routes._count_player_comp_wins(highlights, None) == 0


def test_derive_placement_from_public_facts():
    # Player still 'active' at a finished season + IS the winner ⇒ winner.
    won = orwell_routes._derive_placement(
        {"player": {"status": "active", "name": "The Player"}},
        {"winner": {"name": "The Player"}}, "The Player")
    assert won == "winner"
    # Player active at finish but NOT the winner ⇒ runner-up (the Final 2 loser).
    runner = orwell_routes._derive_placement(
        {"player": {"status": "active", "name": "The Player"}},
        {"winner": {"name": "Some One"}}, "The Player")
    assert runner == "runner-up"
    # Jury seat ⇒ jury; pre-jury eviction ⇒ evicted.
    assert orwell_routes._derive_placement({"player": {"status": "jury"}}, {}, "X") == "jury"
    assert orwell_routes._derive_placement({"player": {"status": "evicted"}}, {}, "X") == "evicted"


def test_remember_finale_tally_caches_full_margin():
    orwell_routes._LAST_FINALE_TALLY.clear()
    finale = {
        "finalists": [{"id": "a", "name": "Ay"}, {"id": "b", "name": "Bee"}],
        "reveals": [
            {"votedFor": {"name": "Ay"}},
            {"votedFor": {"name": "Ay"}},
            {"votedFor": {"name": "Bee"}},
        ],
    }
    orwell_routes._remember_finale_tally("u", finale)
    assert orwell_routes._last_finale_margin("u") == 1  # 2 vs 1
    # No reveals yet ⇒ nothing cached for a fresh user.
    assert orwell_routes._last_finale_margin("never") is None


# ── the async capture helper, wired to a fake engine (Vault-free public projections only) ─────────

def _fake_finished_engine(monkeypatch, *, status="runner-up_active", winner="The Player",
                          highlights=None, social_events=None, weeks=11):
    """Monkeypatch the engine client to a FINISHED season with public projections only."""
    player_status = {"runner-up_active": "active", "winner_active": "active",
                     "jury": "jury", "evicted": "evicted"}.get(status, "active")

    async def fake_state(user=None, timeout=None):
        return {"started": True, "finished": True,
                "player": {"name": "The Player", "status": player_status}}

    async def fake_recap(user=None):
        return {"started": True, "finished": True,
                "winner": ({"name": winner} if winner else None),
                "weeksPlayed": weeks,
                "highlights": highlights if highlights is not None else []}

    async def fake_visible(user=None):
        return {"visibleEvents": social_events if social_events is not None else []}

    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)
    monkeypatch.setattr(orwell_engine, "season_recap", fake_recap)
    monkeypatch.setattr(orwell_engine, "get_visible_state", fake_visible)


def test_capture_logs_a_finished_season(tmp_path, monkeypatch):
    monkeypatch.setattr(orwell_outcomes, "OUTCOMES_PATH", tmp_path / "o.json")
    monkeypatch.setattr(orwell_seasons, "SEASONS_PATH", tmp_path / "s.json")
    orwell_routes._LAST_FINALE_TALLY.clear()
    orwell_routes._remember_finale_tally("u", {
        "finalists": [{"name": "The Player"}, {"name": "Rival"}],
        "reveals": [{"votedFor": {"name": "The Player"}}] * 5 + [{"votedFor": {"name": "Rival"}}] * 2,
    })
    _fake_finished_engine(
        monkeypatch, status="winner_active", winner="The Player",
        highlights=["The Player wins Head of Household", "The Player wins the Power of Veto"],
        social_events=[{"type": "conversation"}, {"type": "conversation"},
                       {"type": "competition"}],  # 2 social scenes, the comp doesn't count
    )
    new = _run(orwell_routes._capture_season_outcome("u"))
    assert new is True
    rows = orwell_outcomes.outcomes_for("u")
    assert len(rows) == 1
    r = rows[0]
    assert r["placement"] == "winner"
    assert r["socialScenes"] == 2
    assert r["competitionWins"] == 2
    assert r["juryMargin"] == 3            # 5 vs 2
    assert r["winnerName"] == "The Player"
    # Idempotent: a second capture of the same finished season is a no-op.
    assert _run(orwell_routes._capture_season_outcome("u")) is False


def test_capture_skips_a_live_season(tmp_path, monkeypatch):
    monkeypatch.setattr(orwell_outcomes, "OUTCOMES_PATH", tmp_path / "o.json")
    monkeypatch.setattr(orwell_seasons, "SEASONS_PATH", tmp_path / "s.json")

    async def fake_state(user=None, timeout=None):
        return {"started": True, "finished": False, "player": {"status": "active"}}
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)

    assert _run(orwell_routes._capture_season_outcome("u")) is False
    assert orwell_outcomes.outcomes_for("u") == []  # nothing logged pre-reveal


def test_capture_skips_when_no_game(tmp_path, monkeypatch):
    monkeypatch.setattr(orwell_outcomes, "OUTCOMES_PATH", tmp_path / "o.json")

    async def fake_state(user=None, timeout=None):
        return {"started": False}
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)

    assert _run(orwell_routes._capture_season_outcome("u")) is False


# ── the admin read route ─────────────────────────────────────────────────────────────────────────

def _admin_app():
    app = FastAPI()
    app.include_router(admin_calibration_routes.setup_admin_calibration_routes())
    return app


def test_admin_outcomes_requires_admin(tmp_path, monkeypatch):
    monkeypatch.setattr(orwell_outcomes, "OUTCOMES_PATH", tmp_path / "o.json")

    def deny(request):
        from fastapi import HTTPException
        raise HTTPException(403, "admin only")
    monkeypatch.setattr(admin_calibration_routes, "require_admin", deny)

    client = TestClient(_admin_app(), raise_server_exceptions=False)
    assert client.get("/api/admin/calibration/outcomes").status_code == 403


def test_admin_outcomes_lists_and_filters(tmp_path, monkeypatch):
    monkeypatch.setattr(orwell_outcomes, "OUTCOMES_PATH", tmp_path / "o.json")
    monkeypatch.setattr(admin_calibration_routes, "require_admin", lambda request: None)
    orwell_outcomes.record_outcome("a", season=1, placement="jury", social_scenes=3,
                                   competition_wins=1, jury_margin=None)
    orwell_outcomes.record_outcome("b", season=1, placement="evicted", social_scenes=0,
                                   competition_wins=0, jury_margin=None)

    client = TestClient(_admin_app(), raise_server_exceptions=False)
    full = client.get("/api/admin/calibration/outcomes")
    assert full.status_code == 200
    body = full.json()
    assert set(body["outcomes"].keys()) == {"a", "b"}
    assert body["summary"]["a"]["placements"] == {"jury": 1}

    one = client.get("/api/admin/calibration/outcomes?user=a")
    assert one.status_code == 200
    ob = one.json()
    assert ob["user"] == "a" and len(ob["outcomes"]) == 1
    assert ob["summary"]["avgSocialScenes"] == 3.0


def test_admin_outcomes_read_only_no_mutating_verbs():
    """The surface is read-only: no POST/PUT/PATCH/DELETE route exists (E93 — applies to admins too)."""
    router = admin_calibration_routes.setup_admin_calibration_routes()
    methods = set()
    for r in router.routes:
        methods |= set(getattr(r, "methods", set()) or set())
    assert methods <= {"GET", "HEAD"}, f"unexpected mutating verb on the calibration surface: {methods}"
