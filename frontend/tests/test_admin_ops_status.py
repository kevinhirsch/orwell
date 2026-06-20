"""Ops-progress lane — the read endpoint + the status-page progress panel.

Proves:
  * GET /api/admin/ops-status is admin-gated (403 without an admin session under AUTH_ENABLED=true);
  * it returns the latest status per action, tolerating a missing / half-written / malformed file
    (a poll mid-restart must never 500);
  * it points at the running action when one is in flight, else the most-recently-stamped one;
  * the status page carries the ONE clearly-marked ops-progress region (HTML markers + the JS that
    polls /api/admin/ops-status), confined for clean merge ordering.

Name-agnostic: "admin"/"user" are ACCOUNT ROLES, never houseguests.
"""
import importlib
import json
import os

from fastapi import FastAPI
from fastapi.testclient import TestClient

aos = importlib.import_module("routes.admin_ops_status_routes")
ahr = importlib.import_module("routes.admin_health_routes")


def _app():
    app = FastAPI()
    app.include_router(aos.setup_admin_ops_status_routes())
    app.include_router(ahr.setup_admin_status_page())
    return app


def _write_status(ops_dir, action, **fields):
    os.makedirs(ops_dir, exist_ok=True)
    payload = {"action": action, "step": 0, "total": 0, "message": "", "running": False,
               "ok": False, "error": "", "ts": "2026-06-20T00:00:00Z"}
    payload.update(fields)
    with open(os.path.join(ops_dir, f"{action}-status.json"), "w", encoding="utf-8") as fh:
        json.dump(payload, fh)


def test_ops_status_is_admin_gated(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "true")
    client = TestClient(_app(), raise_server_exceptions=False)
    assert client.get("/api/admin/ops-status").status_code == 403


def test_ops_status_absent_is_null_not_error(monkeypatch, tmp_path):
    # No data/ops at all: a clean, non-erroring shape with every action null.
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get("/api/admin/ops-status")
    assert r.status_code == 200
    d = r.json()
    assert d["opsDir"] is False
    assert d["running"] is None and d["latest"] is None
    assert all(v is None for v in d["actions"].values())


def test_ops_status_reports_running_action(monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    ops = tmp_path / "ops"
    # A running factory-reset mid-scrub + a finished update earlier.
    _write_status(ops, "factory-reset", step=4, total=6, running=True,
                  message="scrubbing game sandboxes (saves, souls, Vault layer)",
                  ts="2026-06-20T01:00:00Z")
    _write_status(ops, "update", step=5, total=5, ok=True, running=False,
                  message="updated — services restarting", ts="2026-06-20T00:30:00Z")
    client = TestClient(_app(), raise_server_exceptions=False)
    d = client.get("/api/admin/ops-status").json()
    assert d["opsDir"] is True
    assert d["running"] == "factory-reset"
    assert d["latest"] == "factory-reset"
    fr = d["actions"]["factory-reset"]
    assert fr["step"] == 4 and fr["total"] == 6 and fr["running"] is True
    assert fr["log"] == "ops-factory-reset.log"
    assert d["actions"]["update"]["ok"] is True


def test_ops_status_reports_failure(monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    ops = tmp_path / "ops"
    _write_status(ops, "factory-reset", step=2, total=6, running=False, ok=False,
                  message="FAILED: the OOBE helper failed", error="the OOBE helper failed")
    client = TestClient(_app(), raise_server_exceptions=False)
    d = client.get("/api/admin/ops-status").json()
    fr = d["actions"]["factory-reset"]
    assert fr["ok"] is False and fr["running"] is False
    assert fr["error"] == "the OOBE helper failed"
    assert d["latest"] == "factory-reset"


def test_ops_status_tolerates_malformed_file(monkeypatch, tmp_path):
    # A half-written / non-JSON file must degrade to null, never 500.
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    ops = tmp_path / "ops"
    ops.mkdir()
    (ops / "update-status.json").write_text("{ not valid json")
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get("/api/admin/ops-status")
    assert r.status_code == 200
    assert r.json()["actions"]["update"] is None


def test_status_page_carries_the_ops_progress_region(monkeypatch):
    # The ONE clearly-marked region exists (HTML + JS markers) and polls the new endpoint.
    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_app(), raise_server_exceptions=False)
    body = client.get("/admin/status").text
    assert "<!-- BEGIN ops-progress lane" in body and "<!-- END ops-progress lane -->" in body
    assert "// ── BEGIN ops-progress lane ──" in body
    assert "// ── END ops-progress lane ──" in body
    assert 'id="ops-progress"' in body
    assert "/api/admin/ops-status" in body
    assert "pollOpsProgress" in body


def test_routes_wired_into_app_py():
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    app_py = open(os.path.join(base, "app.py"), encoding="utf-8").read()
    assert "setup_admin_ops_status_routes" in app_py
