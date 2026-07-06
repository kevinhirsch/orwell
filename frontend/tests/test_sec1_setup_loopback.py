"""SEC-1 — `/api/auth/setup` must be restricted to a direct loopback caller.

`/api/auth/setup` is necessarily auth-EXEMPT (it creates the very first admin, before any account
exists), and `AuthManager.setup()`'s `_setup_lock` only prevents a concurrent DOUBLE-win — it does
nothing to stop a remote attacker beating the legitimate operator to the punch during the window
between the process becoming network-reachable and the operator actually visiting the setup page.
The fix mirrors `require_user`'s own unconfigured-mode fallback (auth_helpers.py), which already
restricts every OTHER pre-setup route to loopback callers: reject a non-loopback (or
proxy/tunnel-forwarded) caller with 403 before ever touching `AuthManager.setup`.

Roles only; no real names. Uses Starlette's TestClient `client=(host, port)` override to simulate
the caller's source address — the default `("testclient", 50000)` is itself non-loopback, which is
exactly the "remote caller" case this gate must refuse.
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


def test_remote_caller_is_refused(auth):
    # Default TestClient source address ("testclient") is NOT loopback — the exact shape of an
    # attacker who reached the port before the operator did.
    client = TestClient(_app(auth), raise_server_exceptions=False)
    resp = client.post("/api/auth/setup", json={"username": "attacker", "password": "hunter2hunter"})
    assert resp.status_code == 403
    assert auth.is_configured is False  # no account was created


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


def test_tunnel_forwarded_loopback_caller_is_refused(auth):
    # A visitor proxied through cloudflared/nginx connects to the app FROM 127.0.0.1 too — the
    # forwarded-for-style header is what distinguishes a genuine direct operator from a remote
    # visitor riding the tunnel. Must still be refused (mirrors app.py's own _is_trusted_loopback).
    client = TestClient(_app(auth), raise_server_exceptions=False, client=("127.0.0.1", 51000))
    resp = client.post(
        "/api/auth/setup",
        json={"username": "attacker", "password": "hunter2hunter"},
        headers={"x-forwarded-for": "203.0.113.7"},
    )
    assert resp.status_code == 403
    assert auth.is_configured is False


def test_once_configured_still_400s_regardless_of_caller(auth):
    assert auth.setup("first-admin", "correct-horse-battery") is True
    client = TestClient(_app(auth), raise_server_exceptions=False, client=("127.0.0.1", 51000))
    resp = client.post("/api/auth/setup", json={"username": "second-admin", "password": "another-pass"})
    assert resp.status_code == 400
