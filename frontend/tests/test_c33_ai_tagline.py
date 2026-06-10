"""Queue C33 — the hero tagline is genuinely AI-generated when a game is live.

Fail-open chain: FE LLM line → engine curated line → "The house is waiting." (route).
Cached per (user, week, phase, standing) so it regenerates when the moment advances,
not per page load. Vault-free: the prompt carries public ceremony facts only.
"""

import asyncio
import importlib
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

orwell_engine = importlib.import_module("src.orwell_engine")
orwell_tagline = importlib.import_module("src.orwell_tagline")
orwell_routes = importlib.import_module("routes.orwell_routes")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


@pytest.fixture(autouse=True)
def _fresh_cache():
    orwell_tagline._CACHE.clear()
    yield
    orwell_tagline._CACHE.clear()


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(orwell_routes.setup_orwell_routes())
    return TestClient(app)


def _wire_engine(monkeypatch, *, started=True, curated="Curated zinger.", week=3,
                 phase="nominations", hoh=None, nominees=()):
    async def fake_tagline(user=None):
        return {"text": curated}

    async def fake_state(user=None):
        return {"started": started, "player": {"id": "player", "name": "P"}}

    async def fake_status(user=None):
        return {"week": week, "phase": phase, "hoh": hoh,
                "nominees": [{"id": n} for n in nominees], "veto": {}}

    monkeypatch.setattr(orwell_engine, "player_tagline", fake_tagline)
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)
    monkeypatch.setattr(orwell_engine, "game_status", fake_status)


def _wire_llm(monkeypatch, reply):
    calls = []

    async def fake_generate(standing, week, phase, anchor, user):
        calls.append({"standing": standing, "week": week, "phase": phase, "anchor": anchor})
        return reply

    monkeypatch.setattr(orwell_tagline, "_generate", fake_generate)
    return calls


# --- the generation chain -------------------------------------------------------------

def test_live_game_returns_the_model_line(monkeypatch):
    _wire_engine(monkeypatch)
    calls = _wire_llm(monkeypatch, "Week three and still nobody's pawn. Suspicious.")
    res = _run(orwell_tagline.get_tagline(user="u"))
    assert res["text"] == "Week three and still nobody's pawn. Suspicious."
    # the curated engine line rides along as the style anchor
    assert calls[0]["anchor"] == "Curated zinger."


def test_llm_failure_falls_open_to_curated(monkeypatch):
    _wire_engine(monkeypatch)
    _wire_llm(monkeypatch, None)  # generation failed
    res = _run(orwell_tagline.get_tagline(user="u"))
    assert res["text"] == "Curated zinger."


def test_pre_game_uses_curated_without_llm(monkeypatch):
    _wire_engine(monkeypatch, started=False)
    calls = _wire_llm(monkeypatch, "should never be called")
    res = _run(orwell_tagline.get_tagline(user="u"))
    assert res["text"] == "Curated zinger."
    assert not calls


def test_route_falls_open_to_static_when_engine_down(client, monkeypatch):
    async def boom(*a, **k):
        raise RuntimeError("engine unreachable")

    monkeypatch.setattr(orwell_engine, "player_tagline", boom)
    r = client.get("/api/orwell/tagline")
    assert r.status_code == 200
    assert r.json()["text"] == "The house is waiting."


# --- caching: per moment, not per load --------------------------------------------------

def test_same_moment_is_cached_one_llm_call(monkeypatch):
    _wire_engine(monkeypatch)
    calls = _wire_llm(monkeypatch, "One and only.")
    _run(orwell_tagline.get_tagline(user="u"))
    _run(orwell_tagline.get_tagline(user="u"))
    assert len(calls) == 1


def test_standing_change_regenerates(monkeypatch):
    _wire_engine(monkeypatch)
    calls = _wire_llm(monkeypatch, "Line.")
    _run(orwell_tagline.get_tagline(user="u"))
    _wire_engine(monkeypatch, nominees=("player",))  # the player goes on the block
    _run(orwell_tagline.get_tagline(user="u"))
    assert len(calls) == 2
    assert calls[1]["standing"] == "on-the-block"


def test_users_do_not_share_cache(monkeypatch):
    _wire_engine(monkeypatch)
    calls = _wire_llm(monkeypatch, "Line.")
    _run(orwell_tagline.get_tagline(user="a"))
    _run(orwell_tagline.get_tagline(user="b"))
    assert len(calls) == 2


# --- standing derivation: public ceremony facts only ------------------------------------

def test_standing_facets():
    f = orwell_tagline._standing
    assert f({"hoh": {"id": "player"}}, "player") == "head-of-household"
    assert f({"nominees": [{"id": "player"}]}, "player") == "on-the-block"
    assert f({"veto": {"holder": {"id": "player"}}}, "player") == "holding-the-veto"
    assert f({"hoh": {"id": "npc:1"}, "nominees": [{"id": "npc:2"}]}, "player") == "in-the-middle"


def test_sanitize_bounds_one_line():
    s = orwell_tagline._sanitize('"Two\nlines and quotes"')
    assert s == "Two"
    assert len(orwell_tagline._sanitize("x" * 500)) <= orwell_tagline._MAX_LEN


def test_instruction_is_anti_sycophantic():
    text = orwell_tagline._INSTRUCTION
    assert "never flatter" in text
    assert "ANTI-SYCOPHANCY" in text
