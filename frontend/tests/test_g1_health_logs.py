"""Lane G1 — admin Health & Logs (UI-based health checking + debug bundle).

Name-agnostic — "admin"/"user" are ACCOUNT ROLES. Proves:
  * both routes are admin-gated (the shared require_admin contract: 403 without
    an admin session under AUTH_ENABLED=true, like test_0053_admin_transcripts);
  * /api/admin/health aggregates the engine self-report (uptime + the G1
    recent-failure ring + embeddings status), the FE tier's view, tier agreement,
    FE store stats, and the image-generation provider state;
  * /api/admin/debug-bundle is one downloadable JSON whose config section REDACTS
    every secret-shaped value (tokens/keys/passwords never leave the box);
  * the surface is read-only;
  * the Settings card exists, is admin-only DOM, and admin.js wires it.
"""

import importlib
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ahr = importlib.import_module("routes.admin_health_routes")
orwell_engine = importlib.import_module("src.orwell_engine")


def _app():
    app = FastAPI()
    app.include_router(ahr.setup_admin_health_routes())
    return app


# A realistic engine /health self-report (the G1 shape) used by the stubbed tier.
ENGINE_RAW = {
    "ok": True,
    "uptimeSeconds": 4242,
    "toolCalls": {"total": 120, "failed": 3},
    "recentFailures": [
        {"ts": 1765400000000, "tool": "advanceGame", "errorClass": "TurnRefusedError", "durationMs": 18},
        {"ts": 1765400100000, "tool": "submitDecision", "errorClass": "EngineRefusal", "durationMs": 4},
    ],
    "embeddings": {"provider": "deterministic", "degraded": True},
}


@pytest.fixture
def stubbed_engine(monkeypatch):
    """Both engine probes answer locally — no network, deterministic shapes."""
    async def fake_detail():
        return {"ok": True, "engineUrl": "http://127.0.0.1:8765"}

    async def fake_raw():
        return ENGINE_RAW, 7

    monkeypatch.setattr(orwell_engine, "engine_health_detail", fake_detail)
    monkeypatch.setattr(ahr, "_engine_raw_health", fake_raw)
    monkeypatch.setattr(ahr, "_store_stats", lambda: {"sessions": 2, "messages": 9})
    monkeypatch.setattr(ahr, "_image_state", lambda user: {
        "enabled": True, "model": "gpt-image-1", "quality": "medium", "available": False,
    })


# ── Admin gating: a non-admin is refused on BOTH routes ────────────────────────

def test_health_is_admin_gated(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "true")  # default posture, no admin session
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get("/api/admin/health")
    assert r.status_code == 403


def test_debug_bundle_is_admin_gated(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "true")
    monkeypatch.setenv("ORWELL_ENGINE_TOKEN", "gate-test-secret-value")
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get("/api/admin/debug-bundle")
    assert r.status_code == 403
    # nothing leaks on the refusal path either
    assert "gate-test-secret-value" not in r.text


# ── /api/admin/health: the aggregated snapshot shape ───────────────────────────

def test_health_aggregates_both_tiers(monkeypatch, stubbed_engine):
    monkeypatch.setenv("AUTH_ENABLED", "false")  # bypasses the gate (smoke posture)
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get("/api/admin/health")
    assert r.status_code == 200
    body = r.json()
    for key in ("generatedAt", "engine", "frontend", "tiersAgree", "images"):
        assert key in body, f"missing aggregate field: {key}"

    eng = body["engine"]
    assert eng["ok"] is True
    assert eng["latencyMs"] == 7
    assert eng["uptimeSeconds"] == 4242
    assert eng["toolCalls"] == {"total": 120, "failed": 3}
    # the G1 ring rides through untouched: tool + sanitized error class + timing only
    assert eng["recentFailures"] == ENGINE_RAW["recentFailures"]
    for entry in eng["recentFailures"]:
        assert set(entry) == {"ts", "tool", "errorClass", "durationMs"}
    # the embeddings degrade flag is visible to the admin
    assert eng["embeddings"] == {"provider": "deterministic", "degraded": True}

    assert body["frontend"]["store"] == {"sessions": 2, "messages": 9}
    assert body["tiersAgree"] is True
    assert body["images"]["available"] is False and body["images"]["enabled"] is True


def test_tiers_disagree_when_fe_recently_could_not_reach_the_engine(monkeypatch, stubbed_engine):
    monkeypatch.setenv("AUTH_ENABLED", "false")

    async def detail_with_fe_trouble():
        # the engine answers /health, but the FE's recent tool call could not get through
        return {"ok": True, "engineUrl": "http://127.0.0.1:8765",
                "lastError": {"tool": "advanceGame", "kind": "unreachable",
                              "error": "ReadTimeout: timed out", "ageSeconds": 5}}

    monkeypatch.setattr(orwell_engine, "engine_health_detail", detail_with_fe_trouble)
    client = TestClient(_app(), raise_server_exceptions=False)
    body = client.get("/api/admin/health").json()
    assert body["tiersAgree"] is False
    assert body["frontend"]["lastError"]["kind"] == "unreachable"


def test_health_survives_a_down_engine(monkeypatch, stubbed_engine):
    monkeypatch.setenv("AUTH_ENABLED", "false")

    async def down_detail():
        return {"ok": False, "engineUrl": "http://127.0.0.1:9", "error": "ConnectError: refused"}

    async def down_raw():
        return None, None

    monkeypatch.setattr(orwell_engine, "engine_health_detail", down_detail)
    monkeypatch.setattr(ahr, "_engine_raw_health", down_raw)
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get("/api/admin/health")
    assert r.status_code == 200  # the health surface NEVER 500s on an outage — that IS the report
    body = r.json()
    assert body["engine"]["ok"] is False
    assert body["tiersAgree"] is False
    assert "error" in body["engine"]


# ── /api/admin/debug-bundle: one JSON download, secrets REDACTED ───────────────

def test_debug_bundle_shape_and_download_headers(monkeypatch, stubbed_engine):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get("/api/admin/debug-bundle")
    assert r.status_code == 200
    assert "application/json" in r.headers.get("content-type", "")
    assert "attachment" in r.headers.get("content-disposition", "")
    assert "orwell-debug-bundle-" in r.headers.get("content-disposition", "")

    bundle = json.loads(r.content)
    for key in ("bundle", "generatedAt", "health", "recentFailures", "config"):
        assert key in bundle, f"missing bundle field: {key}"
    assert bundle["bundle"] == "orwell-debug"
    # the failure ring is hoisted for one-glance triage
    assert bundle["recentFailures"] == ENGINE_RAW["recentFailures"]
    # and the full health snapshot rides inside
    assert bundle["health"]["engine"]["embeddings"]["degraded"] is True


def test_debug_bundle_redacts_secrets(monkeypatch, stubbed_engine):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    secret = "sk-VERY-SECRET-bearer-0123456789"
    monkeypatch.setenv("ORWELL_ENGINE_TOKEN", secret)
    monkeypatch.setenv("ORWELL_ENGINE_ADMIN_TOKEN", secret + "-admin")
    monkeypatch.setenv("ORWELL_DATA_DIR", "/tmp/orwell-data-dir")  # non-secret ops value crosses
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get("/api/admin/debug-bundle")
    text = r.text
    assert secret not in text, "a configured secret crossed into the bundle"
    bundle = json.loads(r.content)
    cfg = bundle["config"]
    assert cfg.get("ORWELL_ENGINE_TOKEN") == ahr.REDACTED
    assert cfg.get("ORWELL_ENGINE_ADMIN_TOKEN") == ahr.REDACTED
    assert cfg.get("ORWELL_DATA_DIR") == "/tmp/orwell-data-dir"


def test_redaction_helper_covers_secret_shapes_and_url_credentials():
    cfg = ahr._redact_config({
        "ORWELL_ENGINE_TOKEN": "t0p",
        "BBAI_ENGINE_TOKEN": "legacy",
        "ORWELL_API_KEY": "k",
        "ORWELL_DB_PASSWORD": "p",
        "ORWELL_ENGINE_PORT": "8765",
        "DATABASE_URL": "postgresql://app:hunter2@db.internal/app",
        "UNRELATED_VAR": "never-bundled",
    })
    assert cfg["ORWELL_ENGINE_TOKEN"] == ahr.REDACTED
    assert cfg["BBAI_ENGINE_TOKEN"] == ahr.REDACTED
    assert cfg["ORWELL_API_KEY"] == ahr.REDACTED
    assert cfg["ORWELL_DB_PASSWORD"] == ahr.REDACTED
    assert cfg["ORWELL_ENGINE_PORT"] == "8765"  # non-secret ops values cross intact
    assert "hunter2" not in json.dumps(cfg)  # URL-embedded credentials scrubbed
    assert "UNRELATED_VAR" not in cfg  # only the deploy-relevant namespaces are bundled


# ── Read-only: no mutating verb exists on the surface ─────────────────────────

def test_surface_is_read_only(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_app(), raise_server_exceptions=False)
    for verb in (client.post, client.delete, client.put, client.patch):
        assert verb("/api/admin/health").status_code in (404, 405)
        assert verb("/api/admin/debug-bundle").status_code in (404, 405)
    import os
    src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "routes", "admin_health_routes.py"), encoding="utf-8").read()
    assert ".post(" not in src and ".delete(" not in src and ".put(" not in src and ".patch(" not in src


# ── UI: one admin-only Health & Logs card in the System panel ──────────────────

import os as _os

_FE = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
_INDEX = open(_os.path.join(_FE, "static", "index.html"), encoding="utf-8").read()
_ADMIN_JS = open(_os.path.join(_FE, "static", "js", "admin.js"), encoding="utf-8").read()
_SETTINGS_JS = open(_os.path.join(_FE, "static", "js", "settings.js"), encoding="utf-8").read()
_APP_PY = open(_os.path.join(_FE, "app.py"), encoding="utf-8").read()


def test_health_card_is_admin_only():
    import re
    m = re.search(r'id="adm-health-card"[^>]*class="([^"]*)"|'
                  r'class="([^"]*)"[^>]*id="adm-health-card"', _INDEX)
    assert m, "the Health & Logs card must exist in Settings"
    classes = (m.group(1) or m.group(2) or "")
    assert "admin-only" in classes, "the Health & Logs card must be admin-only DOM"
    # settings.js is what hides every .admin-only node for a non-admin
    assert ".admin-only" in _SETTINGS_JS
    assert "isAdmin ? '' : 'none'" in _SETTINGS_JS


def test_health_card_lives_in_the_system_panel_not_player_chrome():
    # inside the System panel region (after the panel marker, before the modal ends)
    system_panel = _INDEX.split('data-settings-panel="system"')[1]
    assert 'id="adm-health-card"' in system_panel
    # exactly one card — nothing duplicated into player chrome
    assert _INDEX.count('id="adm-health-card"') == 1
    # no new nav surface — the only entry is the System-panel card
    assert 'data-settings-tab="health"' not in _INDEX


def test_health_card_has_live_rows_failure_log_and_bundle_button():
    card = _INDEX.split('id="adm-health-card"')[1].split("admin-danger-card")[0]
    assert 'id="adm-health-rows"' in card        # live health rows
    assert 'id="adm-health-failures"' in card    # the failure log table mount
    assert 'id="adm-health-bundle"' in card      # the download button
    assert "/api/admin/debug-bundle" in card
    assert 'id="adm-health-refresh"' in card


def test_admin_js_wires_the_health_panel():
    assert "initHealthLogs" in _ADMIN_JS
    assert "/api/admin/health" in _ADMIN_JS
    assert "recentFailures" in _ADMIN_JS  # renders the engine failure ring
    assert "embeddings" in _ADMIN_JS      # provider + degrade badge
    # registered in the init list like initTranscripts
    assert "initTranscripts, initHealthLogs" in _ADMIN_JS


def test_routes_are_registered_in_app():
    assert "admin_health_routes" in _APP_PY
    assert "setup_admin_health_routes" in _APP_PY
