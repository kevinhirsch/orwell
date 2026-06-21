"""Feature 0067 / ADR 0007 — Host-header pin via TrustedHostMiddleware.

Builds a throwaway app with just the middleware (no app.py boot) and proves a Host outside the
allow-list is rejected while the configured domain is accepted; the default ["*"] accepts any Host.
"""
import pytest

from core.middleware import allowed_hosts_from_env

pytest.importorskip("fastapi")
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from starlette.middleware.trustedhost import TrustedHostMiddleware  # noqa: E402


def _app(env):
    app = FastAPI()
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts_from_env(env))

    @app.get("/")
    def root():
        return {"ok": True}

    return app


def test_rejects_host_outside_allowlist():
    client = TestClient(_app({"ALLOWED_HOSTS": "hiorwell.com"}), base_url="http://hiorwell.com")
    r = client.get("/", headers={"host": "evil.example"})
    assert r.status_code == 400


def test_accepts_configured_host():
    client = TestClient(_app({"ALLOWED_HOSTS": "hiorwell.com"}), base_url="http://hiorwell.com")
    assert client.get("/").status_code == 200


def test_wildcard_default_accepts_any_host():
    client = TestClient(_app({}))  # default ["*"]
    assert client.get("/", headers={"host": "anything.example"}).status_code == 200
