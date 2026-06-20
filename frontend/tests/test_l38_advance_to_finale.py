"""L38 — the God-Mode "fast-forward to finale (debug)" status-page lever.

POST /api/admin/ops/advance-to-finale (admin-gated, the /admin/status button NEXT TO
regenerate-portraits): drive THIS admin's live season to a crowned winner so the post-season
Vault retrospective (0048) unseals legitimately.

The non-negotiable boundary (mandate #2 / 0016): God Mode reads NO Vault and reveals nothing
hidden. The lever crosses the engine's ADMIN channel (Vault-free by construction) and only makes
the season FINISH — the engine returns ONLY a Vault-free summary (winner NAME, weeks, the player's
placement). This test proves:
  • the route is admin-gated like every /api/admin route;
  • it POSTs the engine's admin advance-to-finale and surfaces the Vault-free summary shape;
  • a not-started / engine-error case refuses gracefully (never a 500, never invented content);
  • the /admin/status page ships the button + its wiring next to the portrait button.

Roles only; the engine call is monkeypatched (no engine process, no network).
"""

import asyncio
import importlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

orwell_engine = importlib.import_module("src.orwell_engine")
admin_health_routes = importlib.import_module("routes.admin_health_routes")


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")  # require_admin's documented bypass
    app = FastAPI()
    app.include_router(admin_health_routes.setup_admin_health_routes())
    app.include_router(admin_health_routes.setup_admin_status_page())
    return TestClient(app, raise_server_exceptions=False)


# A Vault-free engine summary — winner NAME, weeks, the player's placement only. No hidden state.
_SUMMARY = {
    "finished": True,
    "winnerName": "Houseguest Seven",
    "weeks": 12,
    "playerPlacement": "runner-up",
    "started": True,
}


def _stub_engine(monkeypatch, summary=_SUMMARY):
    async def fake_ff(user=None, **k):
        return summary
    monkeypatch.setattr(orwell_engine, "advance_to_finale", fake_ff)


# ── the route: the happy path surfaces the Vault-free summary shape ──────────────

def test_finishes_and_returns_the_vault_free_summary(client, monkeypatch):
    _stub_engine(monkeypatch)
    body = client.post("/api/admin/ops/advance-to-finale").json()
    assert body["finished"] is True
    assert body["winnerName"] == "Houseguest Seven"
    assert body["weeks"] == 12
    assert body["playerPlacement"] == "runner-up"
    # The route surfaces ONLY the public summary fields — it never echoes anything else the engine
    # might add (a Vault leak guard at the FE seam too).
    assert set(body.keys()) == {"finished", "winnerName", "weeks", "playerPlacement"}


def test_passes_through_player_eviction_terminal(client, monkeypatch):
    # The player can legitimately LOSE on the way — the season still finishes for the rest.
    _stub_engine(monkeypatch, {**_SUMMARY, "playerPlacement": "evicted", "winnerName": "Houseguest Two"})
    body = client.post("/api/admin/ops/advance-to-finale").json()
    assert body["finished"] is True
    assert body["playerPlacement"] == "evicted"
    assert body["winnerName"] == "Houseguest Two"


# ── the route: graceful refusals (never a 500, never invented content) ───────────

def test_refuses_pre_game(client, monkeypatch):
    _stub_engine(monkeypatch, {"started": False})
    body = client.post("/api/admin/ops/advance-to-finale").json()
    assert body["finished"] is False
    assert body["reason"] == "no active game"


def test_refuses_when_engine_errors(client, monkeypatch):
    async def boom(user=None, **k):
        raise RuntimeError("engine unreachable")
    monkeypatch.setattr(orwell_engine, "advance_to_finale", boom)
    body = client.post("/api/admin/ops/advance-to-finale").json()
    assert body["finished"] is False
    assert "engine" in body["reason"]


# ── gate + page wiring ──────────────────────────────────────────────────────────

def test_route_is_admin_gated(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "true")
    app = FastAPI()
    app.include_router(admin_health_routes.setup_admin_health_routes())
    c = TestClient(app, raise_server_exceptions=False)
    assert c.post("/api/admin/ops/advance-to-finale").status_code == 403


def test_status_page_ships_the_button_next_to_portraits(client):
    html = client.get("/admin/status").text
    # The button exists, with the regenerate-portraits button alongside it.
    assert 'id="ff-finale"' in html
    assert 'id="regen-portraits"' in html
    # It POSTs the new route and is wired.
    assert "/api/admin/ops/advance-to-finale" in html
    assert "fastForwardFinale" in html
    # The Vault-safe framing is surfaced (God Mode never sees the secrets in advance).
    assert "reads no Vault" in html


def test_engine_client_calls_the_admin_channel(monkeypatch):
    # orwell_engine.advance_to_finale crosses the ADMIN channel (Vault-free by construction), not
    # the player channel — the tool name is advanceToFinale.
    seen = {}

    async def fake_admin_call(name, args=None, user=None):
        seen["name"] = name
        seen["args"] = args
        return _SUMMARY
    monkeypatch.setattr(orwell_engine, "_admin_call", fake_admin_call)
    out = asyncio.get_event_loop().run_until_complete(orwell_engine.advance_to_finale(user="u"))
    assert seen["name"] == "advanceToFinale"
    assert out["winnerName"] == "Houseguest Seven"
