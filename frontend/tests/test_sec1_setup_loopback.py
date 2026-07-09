"""SEC-1 — `/api/auth/setup` caller-origin policy.

`/api/auth/setup` is necessarily auth-EXEMPT (it creates the very first admin, before any account
exists). An earlier SEC-1 pre-ship fix restricted the route to a direct, unproxied loopback caller
so that a remote party who reached the port before the operator could not claim the sole permanent
admin account during the window between the process becoming network-reachable and the operator
visiting the setup page.

**That restriction was intentionally removed in #1246** ("Remove first-run loopback restriction
from `/api/auth/setup`"): a remote/tunnel-forwarded caller may now complete first-run setup, so a
headless LAN/remote operator is no longer locked out of claiming the first admin without an SSH
tunnel or console. This file is reconciled to that decision.

**Accepted risk (owner decision, 2026-07-09):** on a network-reachable but not-yet-configured
instance, the first caller to reach `/api/auth/setup` — remote or local — becomes the permanent
admin (`AuthManager._setup_lock` still prevents a concurrent double-win; it does not decide *who*
wins the race). **Mitigation:** do not expose the app's port to an untrusted network before
completing first-run setup (finish setup on the LAN/behind the tunnel first, or bring the port up
only once configured). Once configured, the route hard-400s for every caller regardless of origin.

Roles only; no real names. Uses Starlette's TestClient `client=(host, port)` override to simulate
the caller's source address — the default `("testclient", 50000)` is itself non-loopback, i.e. the
"remote caller" case.
"""

import importlib
import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

auth_mod = importlib.import_module("core.auth")
auth_routes = importlib.import_module("routes.auth_routes")
AuthManager = auth_mod.AuthManager


@pytest.fixture
def auth(tmp_path):
    return AuthManager(auth_path=os.path.join(str(tmp_path), "auth.json"))


def _app(auth_mgr):
    app = FastAPI()
    app.include_router(auth_routes.setup_auth_routes(auth_mgr))
    return app


def test_remote_caller_is_allowed_since_1246(auth):
    # Default TestClient source address ("testclient") is NOT loopback. Pre-#1246 this was refused
    # (403); #1246 removed the loopback restriction, so a remote caller now completes setup. See the
    # module docstring's accepted-risk note.
    client = TestClient(_app(auth), raise_server_exceptions=False)
    resp = client.post("/api/auth/setup", json={"username": "operator", "password": "hunter2hunter"})
    assert resp.status_code == 200
    assert auth.is_configured is True


def test_direct_loopback_caller_is_allowed(auth):
    client = TestClient(_app(auth), raise_server_exceptions=False, client=("127.0.0.1", 51000))
    resp = client.post("/api/auth/setup", json={"username": "operator", "password": "hunter2hunter"})
    assert resp.status_code == 200
    assert auth.is_configured is True


def test_ipv6_loopback_caller_is_allowed(auth):
    client = TestClient(_app(auth), raise_server_exceptions=False, client=("::1", 51000))
    resp = client.post("/api/auth/setup", json={"username": "operator", "password": "hunter2hunter"})
    assert resp.status_code == 200
    assert auth.is_configured is True


def test_tunnel_forwarded_caller_is_allowed_since_1246(auth):
    # A visitor proxied through cloudflared/nginx connects FROM 127.0.0.1 with a forwarded-for
    # header. Pre-#1246 this was refused (403); #1246 removed the restriction, so it now completes
    # setup like any other caller. See the module docstring's accepted-risk note + mitigation.
    client = TestClient(_app(auth), raise_server_exceptions=False, client=("127.0.0.1", 51000))
    resp = client.post(
        "/api/auth/setup",
        json={"username": "operator", "password": "hunter2hunter"},
        headers={"x-forwarded-for": "203.0.113.7"},
    )
    assert resp.status_code == 200
    assert auth.is_configured is True


def test_once_configured_still_400s_regardless_of_caller(auth):
    assert auth.setup("first-admin", "correct-horse-battery") is True
    client = TestClient(_app(auth), raise_server_exceptions=False, client=("127.0.0.1", 51000))
    resp = client.post("/api/auth/setup", json={"username": "second-admin", "password": "another-pass"})
    assert resp.status_code == 400
