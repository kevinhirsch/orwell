"""J5-18 — the retrospective panel surfaces the PLAYER's own result, not only the winner.

The post-season recap headlined only the season winner ("👑 X won (week N)"), never the player's
own placement or the jury margin — the payoff for the most common outcome (a losing player). The
placement + margin are already computed server-side (`_derive_placement` / `_last_finale_margin`,
used by the seasons-as-levels ledger); this pins that the /recap route passes them through and the
panel renders the player's result, while keeping C17's render-only / pinned-substring contract.

Route test mirrors test_c17_retrospective.py's _client()/monkeypatch style.
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


# --- route: /recap passes the player's placement + finale margin through -------------------

def test_recap_surfaces_runner_up_placement_and_margin(monkeypatch):
    # A finished season where the player sat in the Final 2 and lost: status 'active' + a different
    # winner name ⇒ _derive_placement returns "runner-up". The finale margin comes from the tally.
    async def fake_recap(user=None):
        return {"started": True, "finished": True, "winner": {"id": "npc:3", "name": "W"},
                "weeksPlayed": 14, "highlights": ["P wins Head of Household"], "evicted": [], "deals": []}

    async def fake_state(user=None, timeout=None):
        return {"started": True, "finished": True,
                "player": {"id": "player", "name": "P", "status": "active"}}

    monkeypatch.setattr(orwell_engine, "season_recap", fake_recap)
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)
    # _capture_season_outcome runs on a finished recap; stub the outcome record so it no-ops cleanly.
    monkeypatch.setattr(orwell_routes, "_capture_season_outcome", _noop_capture)
    # The finale margin is read from the in-module tally; seed it for THIS (anon) user.
    orwell_routes._LAST_FINALE_TALLY[""] = {"margin": 5, "total": 9}

    r = _client().get("/api/orwell/recap")
    assert r.status_code == 200
    recap = r.json()["recap"]
    assert recap["placement"] == "runner-up"  # player lost the Final 2
    assert recap["margin"] == 5               # the jury margin passed through
    assert recap["winner"]["name"] == "W"     # winner still headlined


def test_recap_surfaces_jury_placement_without_margin(monkeypatch):
    # A juror (not a finalist) has a placement but no finale margin field.
    async def fake_recap(user=None):
        return {"started": True, "finished": True, "winner": {"id": "npc:3", "name": "W"},
                "weeksPlayed": 12, "highlights": []}

    async def fake_state(user=None, timeout=None):
        return {"started": True, "finished": True,
                "player": {"id": "player", "name": "P", "status": "jury"}}

    monkeypatch.setattr(orwell_engine, "season_recap", fake_recap)
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)
    monkeypatch.setattr(orwell_routes, "_capture_season_outcome", _noop_capture)
    orwell_routes._LAST_FINALE_TALLY.pop("", None)  # no finale tally ⇒ margin omitted

    recap = _client().get("/api/orwell/recap").json()["recap"]
    assert recap["placement"] == "jury"
    assert "margin" not in recap


def test_recap_enrichment_is_fail_open(monkeypatch):
    # If the state read for the placement throws, the recap is still returned (winner-only),
    # never a 500 and never a blanked panel.
    async def fake_recap(user=None):
        return {"started": True, "finished": True, "winner": {"id": "npc:3", "name": "W"},
                "weeksPlayed": 10, "highlights": []}

    async def boom_state(user=None, timeout=None):
        raise RuntimeError("state down")

    monkeypatch.setattr(orwell_engine, "season_recap", fake_recap)
    monkeypatch.setattr(orwell_engine, "get_game_state", boom_state)
    monkeypatch.setattr(orwell_routes, "_capture_season_outcome", _noop_capture)

    r = _client().get("/api/orwell/recap")
    assert r.status_code == 200
    recap = r.json()["recap"]
    assert recap["winner"]["name"] == "W"     # the recap survives the enrichment failure
    assert "placement" not in recap            # the field is simply omitted


async def _noop_capture(user=None):
    return False


# --- source: the panel renders the player's placement AND keeps the C17 contract ----------

def test_panel_renders_player_placement_and_keeps_render_only_contract():
    js = open(os.path.join(FRONTEND, "static", "js", "orwellRetrospective.js"), encoding="utf-8").read()

    # J5-18: the player's own result is rendered from the route-provided fields.
    assert "recap.placement" in js
    assert "recap.margin" in js
    assert "runner-up" in js                    # the losing-finalist headline
    assert "Lost the jury vote by" in js        # the margin line

    # C17 render-only contract (must not regress).
    assert "POST" not in js                      # render-only: nothing here progresses the game
    assert "dataset.gameBuild" in js             # game-build gated
    assert "/api/orwell/retrospective" in js and "/api/orwell/recap" in js
    assert "recap.finished" in js                # the affordance exists only post-season

    # C17 per-voter unseal substrings (must not regress).
    assert "How the votes really fell" in js
    assert "v.voter && v.voter.name" in js
    assert "wk.evictee.id" in js
