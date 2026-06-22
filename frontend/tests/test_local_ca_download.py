"""Feature 0074 / ADR 0014 — the local-CA root download route.

Proves /orwell-local-ca.crt against a throwaway app (just the router mounted — no auth middleware, so
this mirrors the "unauthenticated by design" contract: a fresh device fetches the PUBLIC root before
it can log in over HTTPS). The path is added to AUTH_EXEMPT_EXACT in app.py (asserted in
test_tls_routes.test_routes_wired_into_app_py).
"""
import importlib

from fastapi import FastAPI
from fastapi.testclient import TestClient

lcr = importlib.import_module("routes.local_ca_routes")


def _client():
    app = FastAPI()
    app.include_router(lcr.setup_local_ca_routes())
    return TestClient(app, raise_server_exceptions=False)


def test_404_when_no_root_exported(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))   # no data/tls/local-ca.crt present
    r = _client().get("/orwell-local-ca.crt")
    assert r.status_code == 404


def test_serves_the_root_when_present(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    tls_dir = tmp_path / "tls"
    tls_dir.mkdir(parents=True)
    # A stand-in PEM body — the route serves the bytes as a CA cert; it is NOT a secret.
    (tls_dir / "local-ca.crt").write_text("-----BEGIN CERTIFICATE-----\nMIIB...stub...\n-----END CERTIFICATE-----\n")

    r = _client().get("/orwell-local-ca.crt")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/x-x509-ca-cert")
    assert "BEGIN CERTIFICATE" in r.text
    # A download, not an inline render.
    assert "orwell-local-ca.crt" in r.headers.get("content-disposition", "")


def test_path_constant_matches_app_exempt():
    assert lcr.CA_DOWNLOAD_PATH == "/orwell-local-ca.crt"
