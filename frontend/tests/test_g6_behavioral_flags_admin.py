"""G6 (gap-audit #1840) — the B2 "living house" behavioral-fidelity runtime dial had no consumer.

`setBehavioralFlags`/`getBehavioralFlags` were fully wired at the engine/MCP boundary
(registry.ts, McpServer.ts requireShape + dispatch, AdminPort, GameSessionAdapter) but NOTHING
in the front-end ever called them: no `orwell_engine.py` wrapper (unlike every other admin tool —
`set_time_of_day`, `advance_to_finale`, `producer_vault`, …), no admin route, no settings control.
The documented "no engine restart, the FE settings switch flips it here" admin dial for the
campaigns/trajectories/triggers/secretPacing/juryHouse/seededTieSurfacing/mythMaking/showrunner
layers did not exist in practice.

This test proves the consumer now exists, mirroring the sibling `setTimeOfDay`/`advance_to_finale`
test patterns (`test_l38_advance_to_finale.py`):
  * `orwell_engine.get_behavioral_flags` / `set_behavioral_flags` cross the engine's ADMIN
    channel (`getBehavioralFlags` / `setBehavioralFlags`), Vault-free, per-user.
  * `set_behavioral_flags` only forwards recognized boolean fields — an unrecognized key or a
    non-boolean present value is dropped rather than sent blind (the engine's `requireShape`
    guard would otherwise refuse the whole call for ANY malformed field).
  * `GET /api/admin/ops/behavioral-flags` and `POST /api/admin/ops/behavioral-flags` are real,
    admin-gated routes that reach the engine and fail soft (never a 500) on an engine error.

Roles only; the engine call is monkeypatched (no engine process, no network).
"""

import asyncio
import importlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

orwell_engine = importlib.import_module("src.orwell_engine")
admin_health_routes = importlib.import_module("routes.admin_health_routes")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")  # require_admin's documented bypass
    app = FastAPI()
    app.include_router(admin_health_routes.setup_admin_health_routes())
    return TestClient(app, raise_server_exceptions=False)


# ── orwell_engine.py wrappers: the FE now HAS a caller ────────────────────────────

def test_get_behavioral_flags_crosses_the_admin_channel(monkeypatch):
    seen = {}

    async def fake_admin_call(name, args=None, user=None):
        seen["name"] = name
        seen["args"] = args
        seen["user"] = user
        return {"campaigns": True, "trajectories": False, "triggers": True,
                "secretPacing": False, "juryHouse": False, "seededTieSurfacing": False,
                "mythMaking": True, "showrunner": False}

    monkeypatch.setattr(orwell_engine, "_admin_call", fake_admin_call)
    out = _run(orwell_engine.get_behavioral_flags(user="u"))
    assert seen["name"] == "getBehavioralFlags"
    assert seen["user"] == "u"
    assert out["campaigns"] is True and out["trajectories"] is False


def test_set_behavioral_flags_crosses_the_admin_channel_with_sanitized_payload(monkeypatch):
    seen = {}

    async def fake_admin_call(name, args=None, user=None):
        seen["name"] = name
        seen["args"] = args
        return {}

    monkeypatch.setattr(orwell_engine, "_admin_call", fake_admin_call)
    _run(orwell_engine.set_behavioral_flags(
        {"campaigns": True, "juryHouse": False, "notARealFlag": True, "mythMaking": "yes"},
        user="u",
    ))
    assert seen["name"] == "setBehavioralFlags"
    # Only recognized boolean fields cross — the unrecognized key and the non-boolean value are
    # dropped rather than forwarded blind (never trips the engine's requireShape refusal).
    assert seen["args"] == {"campaigns": True, "juryHouse": False}


def test_set_behavioral_flags_absent_fields_omitted_not_forced_false(monkeypatch):
    seen = {}

    async def fake_admin_call(name, args=None, user=None):
        seen["args"] = args
        return {}

    monkeypatch.setattr(orwell_engine, "_admin_call", fake_admin_call)
    _run(orwell_engine.set_behavioral_flags({"triggers": True}, user="u"))
    assert seen["args"] == {"triggers": True}, "an absent field must not be coerced to False"


# ── the admin routes: real, gated, fail-soft ──────────────────────────────────────

def test_get_route_returns_every_flag_resolved(client, monkeypatch):
    async def fake_get(user=None):
        return {"campaigns": True, "mythMaking": True}  # a partial engine response is plausible

    monkeypatch.setattr(orwell_engine, "get_behavioral_flags", fake_get)
    body = client.get("/api/admin/ops/behavioral-flags").json()
    assert set(body.keys()) == set(orwell_engine.BEHAVIORAL_FLAG_FIELDS)
    assert body["campaigns"] is True
    assert body["mythMaking"] is True
    assert body["trajectories"] is False  # unresolved field defaults False, never omitted


def test_get_route_fails_soft_on_engine_error(client, monkeypatch):
    async def boom(user=None):
        raise RuntimeError("engine unreachable")

    monkeypatch.setattr(orwell_engine, "get_behavioral_flags", boom)
    r = client.get("/api/admin/ops/behavioral-flags")
    assert r.status_code == 200, "never a 500 — the dial degrades to all-false, not a page break"
    body = r.json()
    assert all(body[f] is False for f in orwell_engine.BEHAVIORAL_FLAG_FIELDS)


def test_post_route_forwards_body_to_the_engine(client, monkeypatch):
    seen = {}

    async def fake_set(flags, user=None):
        seen["flags"] = flags
        return {"ok": True}

    monkeypatch.setattr(orwell_engine, "set_behavioral_flags", fake_set)
    r = client.post("/api/admin/ops/behavioral-flags", json={"campaigns": True, "juryHouse": True})
    assert r.status_code == 200
    assert r.json() == {"ok": True}
    assert seen["flags"] == {"campaigns": True, "juryHouse": True}


def test_post_route_fails_soft_on_engine_error(client, monkeypatch):
    async def boom(flags, user=None):
        raise RuntimeError("engine unreachable")

    monkeypatch.setattr(orwell_engine, "set_behavioral_flags", boom)
    r = client.post("/api/admin/ops/behavioral-flags", json={"campaigns": True})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False
    assert "engine" in body["reason"]


def test_routes_are_admin_gated(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "true")
    app = FastAPI()
    app.include_router(admin_health_routes.setup_admin_health_routes())
    c = TestClient(app, raise_server_exceptions=False)
    assert c.get("/api/admin/ops/behavioral-flags").status_code == 403
    assert c.post("/api/admin/ops/behavioral-flags", json={"campaigns": True}).status_code == 403
