"""Feature 0079 increment 5 — the admin Settings toggle for the runtime overseer.

Proves the overseer is controllable from the admin UI (no longer env-only):
  * overseer_enabled() honors the settings toggle — settings WINS when explicitly set, the
    ORWELL_OVERSEER env var is the headless fallback, and a broken settings read degrades to the
    env (fail-soft, never raises into the loop);
  * GET /api/admin/logs/retention reports overseerEnabled; POST persists it; both admin-gated;
  * the status page renders the toggle control in its own section and wires it to the route.

Name-agnostic — "admin" is an ACCOUNT ROLE. Settings writes are isolated to a tmp file so the
test never touches the real store.
"""

import importlib

from fastapi import FastAPI
from fastapi.testclient import TestClient

ahr = importlib.import_module("routes.admin_health_routes")


def _app():
    app = FastAPI()
    app.include_router(ahr.setup_admin_health_routes())
    app.include_router(ahr.setup_admin_status_page())
    return app


def _isolate_settings(monkeypatch, tmp_path):
    """Point the settings store at a tmp file and drop the TTL cache, so a toggle write never
    touches the real settings.json and reads/writes are immediate."""
    from src import settings as _s
    monkeypatch.setattr(_s, "SETTINGS_FILE", str(tmp_path / "settings.json"))
    monkeypatch.setattr(_s, "_settings_cache", None)


# ── overseer_enabled() precedence: settings wins, env is the fallback, fail-soft ──

def test_settings_toggle_overrides_env(monkeypatch, tmp_path):
    from src import overseer
    from src.settings import save_settings
    _isolate_settings(monkeypatch, tmp_path)
    monkeypatch.setenv("ORWELL_OVERSEER", "1")          # env says ON…
    save_settings({"overseer_enabled": False})          # …the UI toggle says OFF and wins
    assert overseer.overseer_enabled() is False
    save_settings({"overseer_enabled": True})
    monkeypatch.delenv("ORWELL_OVERSEER", raising=False)
    assert overseer.overseer_enabled() is True          # ON with no env at all


def test_env_is_the_fallback_when_toggle_unset(monkeypatch, tmp_path):
    from src import overseer
    from src.settings import save_settings
    _isolate_settings(monkeypatch, tmp_path)
    save_settings({})                                   # no overseer_enabled key -> env decides
    monkeypatch.setenv("ORWELL_OVERSEER", "on")
    assert overseer.overseer_enabled() is True
    monkeypatch.delenv("ORWELL_OVERSEER", raising=False)
    assert overseer.overseer_enabled() is False         # default OFF everywhere


def test_overseer_enabled_is_failsoft(monkeypatch):
    from src import overseer
    from src import settings as _s

    def _boom(*a, **k):
        raise RuntimeError("settings unreadable")

    monkeypatch.setattr(_s, "get_setting", _boom)
    monkeypatch.setenv("ORWELL_OVERSEER", "1")
    assert overseer.overseer_enabled() is True          # degrades to env, never raises
    monkeypatch.delenv("ORWELL_OVERSEER", raising=False)
    assert overseer.overseer_enabled() is False


# ── the admin route reports + persists the toggle (admin-gated) ──────────────────

def test_get_reports_overseer_enabled(monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    _isolate_settings(monkeypatch, tmp_path)
    client = TestClient(_app(), raise_server_exceptions=False)
    body = client.get("/api/admin/logs/retention").json()
    assert "overseerEnabled" in body


def test_post_persists_the_toggle(monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.delenv("ORWELL_OVERSEER", raising=False)
    _isolate_settings(monkeypatch, tmp_path)
    client = TestClient(_app(), raise_server_exceptions=False)
    on = client.post("/api/admin/logs/retention", json={"overseerEnabled": True}).json()
    assert on["overseerEnabled"] is True
    assert client.get("/api/admin/logs/retention").json()["overseerEnabled"] is True
    off = client.post("/api/admin/logs/retention", json={"overseerEnabled": False}).json()
    assert off["overseerEnabled"] is False


def test_retention_route_is_admin_gated(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "true")           # default posture, no admin session
    client = TestClient(_app(), raise_server_exceptions=False)
    assert client.get("/api/admin/logs/retention").status_code == 403
    assert client.post("/api/admin/logs/retention", json={"overseerEnabled": True}).status_code == 403


# ── the status page renders + wires the toggle ──────────────────────────────────

def test_status_page_has_no_orphaned_overseer_config_section(monkeypatch):
    """The overseer/faithfulness dials moved to Settings → AI (feature 0081 relocation). /admin/status
    no longer shows a control-LESS 'RUNTIME OVERSEER' config header — that read as a broken, empty
    section — but the live diagnostics still stream to the 'Overseer (live)' panel."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_app(), raise_server_exceptions=False)
    body = client.get("/admin/status").text
    assert "RUNTIME OVERSEER" not in body               # the orphaned (control-less) config header is gone
    assert 'id="overseer-toggle"' not in body           # the dial lives in Settings, never here
    assert 'id="set-overseerMode"' not in body          # nor any overseer dial — those are Settings-only
    assert "LOG RETENTION" in body                      # the rest of the status page renders intact
