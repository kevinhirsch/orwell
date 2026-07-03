"""SEC-2 — gateway webhook impersonation is blocked at the ROUTE (feature 0072 hardening).

The multi-platform gateway webhook (`POST /gateway/webhook/{platform_id}`) is unauthenticated by
default and treats the client-supplied platform identity as its only credential. When a webhook
secret is configured it MUST verify a signature/secret tied to the platform BEFORE trusting that
identity — otherwise an attacker POSTs a payload claiming any (paired) identity and impersonates the
platform. Two transport gates cover this, both fail-closed when configured:
  * ORWELL_GATEWAY_WEBHOOK_SECRET — a gateway-wide shared secret (X-Orwell-Gateway-Secret).
  * TELEGRAM_WEBHOOK_SECRET — the per-platform secret Telegram echoes.

Unit-level fail-closed behavior of the helpers is covered elsewhere; this is the end-to-end ROUTE
proof that a missing/wrong secret yields 403 and the payload never reaches identity parsing / the
engine. Roles only; no real names.
"""

import importlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

gateway_routes = importlib.import_module("routes.gateway_routes")


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(gateway_routes.setup_gateway_routes())  # registers the telegram adapter
    return TestClient(app, raise_server_exceptions=False)


# A payload that, if it reached parsing, would claim to be a specific platform identity.
_IMPERSONATION_PAYLOAD = {
    "message": {"chat": {"id": 424242}, "from": {"id": 424242}, "text": "/pair"}
}


def test_gatewaywide_secret_missing_header_rejected(client, monkeypatch):
    monkeypatch.setenv("ORWELL_GATEWAY_WEBHOOK_SECRET", "gw-shared-secret")
    monkeypatch.delenv("TELEGRAM_WEBHOOK_SECRET", raising=False)
    r = client.post("/gateway/webhook/telegram", json=_IMPERSONATION_PAYLOAD)  # no secret header
    assert r.status_code == 403


def test_gatewaywide_secret_wrong_header_rejected(client, monkeypatch):
    monkeypatch.setenv("ORWELL_GATEWAY_WEBHOOK_SECRET", "gw-shared-secret")
    monkeypatch.delenv("TELEGRAM_WEBHOOK_SECRET", raising=False)
    r = client.post(
        "/gateway/webhook/telegram",
        json=_IMPERSONATION_PAYLOAD,
        headers={"X-Orwell-Gateway-Secret": "not-it"},
    )
    assert r.status_code == 403


def test_perplatform_secret_missing_signature_rejected(client, monkeypatch):
    # No gateway-wide secret, but a per-platform Telegram secret IS configured: an inbound webhook
    # lacking the platform's signature header must be refused (impersonation blocked).
    monkeypatch.delenv("ORWELL_GATEWAY_WEBHOOK_SECRET", raising=False)
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", "tg-secret-token")
    r = client.post("/gateway/webhook/telegram", json=_IMPERSONATION_PAYLOAD)  # no signature header
    assert r.status_code == 403


def test_unknown_platform_is_404_not_processed(client, monkeypatch):
    monkeypatch.delenv("ORWELL_GATEWAY_WEBHOOK_SECRET", raising=False)
    r = client.post("/gateway/webhook/nonexistent-platform", json=_IMPERSONATION_PAYLOAD)
    assert r.status_code == 404
