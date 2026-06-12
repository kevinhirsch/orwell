"""Lane G25 — the status-page debug lever: discard + regenerate all cast portraits.

POST /api/admin/ops/regenerate-portraits (admin-gated, the /admin/status button): discard the
stored portraits for THIS admin's game and force-kick a full regeneration through the
standard pipeline — so a prompt/model change (e.g. G24) can be seen on the current cast
without a season restart.

The contract under test:
  • refuse-before-discard — engine down / no game / no provider ⇒ NOTHING is deleted;
  • the discard is SELECTIVE — active houseguests only (the backfill never regenerates a
    departed houseguest, so jury/evicted photos must survive the lever);
  • the kick is force=True (bypasses the auto-poll debounce) over the full active set;
  • admin-gated like every /api/admin route; the page ships the button + its wiring.

Roles only; engine + provider monkeypatched (no network, no image API).
"""

import asyncio
import importlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

orwell_portraits = importlib.import_module("src.orwell_portraits")
orwell_engine = importlib.import_module("src.orwell_engine")
admin_health_routes = importlib.import_module("routes.admin_health_routes")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


@pytest.fixture
def tmp_portraits(tmp_path, monkeypatch):
    monkeypatch.setattr(orwell_portraits, "PORTRAITS_DIR", tmp_path / "portraits")
    monkeypatch.setattr(orwell_portraits, "PORTRAIT_LOG_PATH", tmp_path / "portrait-log.jsonl")
    monkeypatch.setattr(orwell_portraits, "RECONCILE_STATE_PATH", tmp_path / "portrait-reconcile.json")
    monkeypatch.setattr(orwell_portraits, "_LAST_BACKFILL_AT", {})
    return tmp_path / "portraits"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")  # require_admin's documented bypass
    app = FastAPI()
    app.include_router(admin_health_routes.setup_admin_health_routes())
    app.include_router(admin_health_routes.setup_admin_status_page())
    return TestClient(app, raise_server_exceptions=False)


_STATE = {
    "started": True,
    "player": {"id": "player", "name": "The Player", "status": "active"},
    "house": [
        {"id": "npc:1", "name": "Houseguest One", "status": "active"},
        {"id": "npc:2", "name": "Houseguest Two", "status": "jury"},
        {"id": "npc:3", "name": "Houseguest Three", "status": "active"},
        {"id": "npc:4", "name": "Houseguest Four", "status": "evicted"},
    ],
}


def _stub_state(monkeypatch, state=_STATE):
    async def fake_state(user=None, **k):
        return state
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)


def _stub_provider(monkeypatch, available=True):
    monkeypatch.setattr(orwell_portraits, "image_generation_available", lambda user: available)


def _store(user, hid):
    orwell_portraits._write_portrait(user, hid, b"\x89PNG-fake", "stored")


# ── the discard helper: selective, gate-clearing ───────────────────────────────

def test_discard_portraits_removes_only_the_named_ids(tmp_portraits):
    for hid in ("player", "npc:1", "npc:2"):
        _store("u", hid)
    removed = orwell_portraits.discard_portraits("u", ["player", "npc:1"])
    assert removed == 2
    assert orwell_portraits.portrait_file("u", "player") is None
    assert orwell_portraits.portrait_file("u", "npc:1") is None
    # the un-named one (a departed houseguest in route terms) survives
    assert orwell_portraits.portrait_file("u", "npc:2") is not None
    # manifest agrees with disk
    assert set(orwell_portraits.load_manifest("u").keys()) == {"npc_2"}


def test_discard_clears_the_debounce_so_regeneration_runs_now(tmp_portraits):
    _store("u", "npc:1")
    orwell_portraits._LAST_BACKFILL_AT[orwell_portraits._safe_user("u")] = 1e18  # window held
    orwell_portraits.discard_portraits("u", ["npc:1"])
    assert orwell_portraits.backfill_allowed("u") is True


# ── the route: refuse-before-discard ───────────────────────────────────────────

def test_refuses_when_engine_down_and_discards_nothing(tmp_portraits, client, monkeypatch):
    _store("default", "npc:1")

    async def down(user=None, **k):
        raise RuntimeError("engine unreachable")
    monkeypatch.setattr(orwell_engine, "get_game_state", down)
    _stub_provider(monkeypatch, True)

    body = client.post("/api/admin/ops/regenerate-portraits").json()
    assert body["regenerated"] is False and "engine" in body["reason"]
    assert orwell_portraits.portrait_file("default", "npc:1") is not None  # untouched


def test_refuses_pre_game_and_discards_nothing(tmp_portraits, client, monkeypatch):
    _store("default", "npc:1")
    _stub_state(monkeypatch, {"started": False})
    _stub_provider(monkeypatch, True)
    body = client.post("/api/admin/ops/regenerate-portraits").json()
    assert body["regenerated"] is False and body["reason"] == "no active game"
    assert orwell_portraits.portrait_file("default", "npc:1") is not None


def test_refuses_without_a_provider_and_discards_nothing(tmp_portraits, client, monkeypatch):
    _store("default", "npc:1")
    _stub_state(monkeypatch)
    _stub_provider(monkeypatch, False)
    body = client.post("/api/admin/ops/regenerate-portraits").json()
    assert body["regenerated"] is False and "image model" in body["reason"]
    assert orwell_portraits.portrait_file("default", "npc:1") is not None


# ── the route: the happy path ──────────────────────────────────────────────────

def test_discards_active_set_and_force_kicks_full_regeneration(tmp_portraits, client, monkeypatch):
    # Stored: two actives + one juror. The lever must discard the actives, keep the juror,
    # and force-kick exactly the active set (all of it now missing).
    for hid in ("player", "npc:1", "npc:2"):
        _store("default", hid)
    _stub_state(monkeypatch)
    _stub_provider(monkeypatch, True)

    seen = {}

    def fake_kick(missing, user, force=False):
        seen["missing"] = list(missing)
        seen["force"] = force
        return True
    monkeypatch.setattr(orwell_portraits, "kickoff_backfill", fake_kick)

    body = client.post("/api/admin/ops/regenerate-portraits").json()
    assert body["regenerated"] is True
    assert body["discarded"] == 2                       # the two stored ACTIVES
    assert body["kicked"] is True
    assert body["log"] == "portrait-log.jsonl"          # the viewer can follow it
    assert seen["force"] is True
    assert seen["missing"] == ["player", "npc:1", "npc:3"]  # every active, juror excluded
    assert body["queued"] == 3
    # the juror's photo survived
    assert orwell_portraits.portrait_file("default", "npc:2") is not None


# ── gate + page wiring ─────────────────────────────────────────────────────────

def test_route_is_admin_gated(tmp_portraits, monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "true")
    app = FastAPI()
    app.include_router(admin_health_routes.setup_admin_health_routes())
    c = TestClient(app, raise_server_exceptions=False)
    assert c.post("/api/admin/ops/regenerate-portraits").status_code == 403


def test_status_page_ships_the_button_and_wiring(client):
    html = client.get("/admin/status").text
    assert 'id="regen-portraits"' in html
    assert "/api/admin/ops/regenerate-portraits" in html
    # the confirm guard + honest refusal copy + log follow are wired
    assert "Discard EVERY stored cast portrait" in html
    assert "nothing was discarded" in html
    assert "regenPortraits" in html
