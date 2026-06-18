"""C17 — the 0048 front-end: the recap surface + the post-season unsealing.

The Wall stays ABSOLUTE pre-finale: the /retrospective route must 404 while the season is live
(the engine's terminal-state gate surfaces as a missing affordance), and everything renders only
the route payloads (the record, never chat memory). Also pins the C18 gap fixes.
"""

import importlib
import os

from fastapi import FastAPI
from fastapi.testclient import TestClient

orwell_engine = importlib.import_module("src.orwell_engine")
orwell_routes = importlib.import_module("routes.orwell_routes")

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _client():
    app = FastAPI()
    app.include_router(orwell_routes.setup_orwell_routes())
    return TestClient(app)


def test_recap_route_passes_the_record_through(monkeypatch):
    async def fake(user=None):
        return {"started": True, "finished": True, "winner": {"id": "npc:3", "name": "W"},
                "weeksPlayed": 14, "highlights": ["X wins Head of Household"], "evicted": [], "deals": []}

    monkeypatch.setattr(orwell_engine, "season_recap", fake)
    r = _client().get("/api/orwell/recap")
    assert r.status_code == 200
    assert r.json()["recap"]["winner"]["name"] == "W"


def test_recap_fails_open(monkeypatch):
    async def boom(user=None):
        raise RuntimeError("down")

    monkeypatch.setattr(orwell_engine, "season_recap", boom)
    assert _client().get("/api/orwell/recap").json() == {"recap": None}


def test_retrospective_404s_while_the_season_is_live(monkeypatch):
    async def live(user=None):
        return None  # the engine's terminal-state gate: no finished season, no unsealing

    monkeypatch.setattr(orwell_engine, "season_retrospective", live)
    r = _client().get("/api/orwell/retrospective")
    assert r.status_code == 404
    assert "still live" in r.json()["error"]


def test_retrospective_returns_the_unsealed_story_post_season(monkeypatch):
    async def done(user=None):
        return {"winner": {"id": "npc:3", "name": "W"},
                "hiddenStory": [{"type": "confessional", "content": "the real read"}],
                "twists": [{"kind": "double-eviction", "firedWeek": None}]}

    monkeypatch.setattr(orwell_engine, "season_retrospective", done)
    r = _client().get("/api/orwell/retrospective")
    assert r.status_code == 200
    body = r.json()["retrospective"]
    assert body["hiddenStory"][0]["type"] == "confessional"
    assert body["twists"][0]["firedWeek"] is None  # the twist that never fired is named


def test_panel_is_mounted_render_only_and_gated():
    html = open(os.path.join(FRONTEND, "static", "index.html"), encoding="utf-8").read()
    assert "orwellRetrospective.js" in html
    js = open(os.path.join(FRONTEND, "static", "js", "orwellRetrospective.js"), encoding="utf-8").read()
    assert "dataset.gameBuild" in js          # game-build gated
    assert "POST" not in js                    # render-only: nothing here progresses the game
    assert "/api/orwell/retrospective" in js and "/api/orwell/recap" in js
    assert "recap.finished" in js              # the affordance exists only post-season


def test_panel_unseals_per_voter_eviction_attribution_by_name():
    # E12 (play-through gap, 2026-06-18): the eviction ballots were anonymous all season; the
    # retrospective is the ONE place per-voter attribution unseals — the "who really voted against
    # you" payoff. The data was present but the panel never rendered it. Render NAMES, never raw ids.
    js = open(os.path.join(FRONTEND, "static", "js", "orwellRetrospective.js"), encoding="utf-8").read()
    assert "unsealed.evictionVotes" in js
    assert "How the votes really fell" in js
    assert "v.voter && v.voter.name" in js     # voter NAME, not id
    assert "wk.evictee.id" in js               # matched against the evictee by id internally (not shown)


# --- the C18 gap fixes, pinned -----------------------------------------------------------

def test_framing_calls_use_a_short_timeout():
    # The per-turn framing reads (state + moment prompt) default to the short framing timeout
    # inside the engine client, so a hung engine fails the frame fast on EVERY caller.
    src = open(os.path.join(FRONTEND, "src", "orwell_engine.py"), encoding="utf-8").read()
    assert "_FRAMING_TIMEOUT" in src
    assert src.count("_FRAMING_TIMEOUT)") >= 2  # getGameState + getMomentPrompt


def test_engine_client_shares_one_async_client():
    src = open(os.path.join(FRONTEND, "src", "orwell_engine.py"), encoding="utf-8").read()
    assert "_shared_client" in src
    assert "async with httpx.AsyncClient" not in src  # no per-call client churn


def test_game_trim_css_is_stripped_when_the_build_is_off():
    src = open(os.path.join(FRONTEND, "app.py"), encoding="utf-8").read()
    assert "game-trim" in src and "else:" in src.split("data-game-build")[1][:400]
