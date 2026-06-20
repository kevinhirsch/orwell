"""Admin one-click Update — pull → rebuild → refresh FE deps → restart both.

Proves:
  * the endpoint is admin-gated (403 without an admin session under AUTH_ENABLED=true, the shared
    require_admin contract — like test_g1_health_logs / test_0053_admin_transcripts);
  * an admin call launches the FIXED script DETACHED (start_new_session=True, no shell, fixed
    argv) and returns {started: true} IMMEDIATELY — never blocking on completion;
  * with the G19b flag dir present it prefers the privilege-safe flag trigger (no subprocess);
  * the command carries NO user input (fixed path, env-overridable only for tests/dev);
  * the Update button renders on the admin-gated status page (admin-only DOM by construction).

Name-agnostic: "admin"/"user" are ACCOUNT ROLES, never houseguests.
"""
import importlib
import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

aur = importlib.import_module("routes.admin_update_routes")
ahr = importlib.import_module("routes.admin_health_routes")


def _app():
    app = FastAPI()
    app.include_router(aur.setup_admin_update_routes())
    app.include_router(ahr.setup_admin_status_page())
    return app


def test_update_is_admin_gated(monkeypatch):
    # AUTH_ENABLED=true with no admin session → 403 (a non-admin cannot trigger an update).
    monkeypatch.setenv("AUTH_ENABLED", "true")
    client = TestClient(_app(), raise_server_exceptions=False)
    assert client.post("/api/admin/update").status_code == 403


def test_admin_update_runs_detached_and_returns_started(monkeypatch, tmp_path):
    # No real host path is touched: the script path is overridden and Popen is captured.
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))                 # no data/ops → the detached path
    monkeypatch.delenv("ORWELL_UPDATE_SUDO", raising=False)
    stub = tmp_path / "fake-update.sh"
    stub.write_text("#!/bin/bash\necho updating\n")
    monkeypatch.setenv("ORWELL_UPDATE_SCRIPT", str(stub))
    monkeypatch.setenv("ORWELL_UPDATE_LOG", str(tmp_path / "update.log"))

    captured = {}

    class _FakeProc:
        pass

    def _fake_popen(argv, **kwargs):
        captured["argv"] = argv
        captured["kwargs"] = kwargs
        return _FakeProc()

    monkeypatch.setattr(aur.subprocess, "Popen", _fake_popen)

    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.post("/api/admin/update")
    assert r.status_code == 200
    body = r.json()
    assert body["started"] is True
    assert body["via"] == "detached"

    # Fixed argv, no shell, no user input; detached into its own session so the self-restart
    # cannot kill it; output redirected to the log file.
    assert captured["argv"] == ["bash", str(stub)]
    assert captured["kwargs"].get("start_new_session") is True
    assert captured["kwargs"].get("shell") in (None, False)  # never shell=True
    # The run log got a timestamped header (we did not block on completion).
    assert (tmp_path / "update.log").exists()


def test_admin_update_sudo_wraps_argv(monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("ORWELL_UPDATE_SUDO", "1")
    stub = tmp_path / "fake-update.sh"
    stub.write_text("#!/bin/bash\n")
    monkeypatch.setenv("ORWELL_UPDATE_SCRIPT", str(stub))
    monkeypatch.setenv("ORWELL_UPDATE_LOG", str(tmp_path / "update.log"))

    captured = {}
    monkeypatch.setattr(aur.subprocess, "Popen",
                        lambda argv, **kw: captured.update(argv=argv) or object())
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.post("/api/admin/update")
    assert r.status_code == 200 and r.json()["started"] is True
    assert captured["argv"] == ["sudo", "-n", "bash", str(stub)]


def test_admin_update_prefers_flag_trigger_when_installed(monkeypatch, tmp_path):
    # With the G19b flag dir present, the privilege-safe trigger is used — NO subprocess spawns.
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.delenv("ORWELL_UPDATE_DIRECT", raising=False)
    (tmp_path / "ops").mkdir()

    def _boom(*a, **k):  # the detached path must NOT be taken here
        raise AssertionError("subprocess.Popen must not run when the flag trigger is installed")

    monkeypatch.setattr(aur.subprocess, "Popen", _boom)
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.post("/api/admin/update")
    assert r.status_code == 200
    body = r.json()
    assert body["started"] is True and body["via"] == "flag-trigger"
    assert (tmp_path / "ops" / "update-requested").exists()


def test_admin_update_force_direct_overrides_flag(monkeypatch, tmp_path):
    # ORWELL_UPDATE_DIRECT=1 forces the detached path even when the flag dir exists.
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("ORWELL_UPDATE_DIRECT", "1")
    monkeypatch.delenv("ORWELL_UPDATE_SUDO", raising=False)
    (tmp_path / "ops").mkdir()
    stub = tmp_path / "fake-update.sh"
    stub.write_text("#!/bin/bash\n")
    monkeypatch.setenv("ORWELL_UPDATE_SCRIPT", str(stub))
    monkeypatch.setenv("ORWELL_UPDATE_LOG", str(tmp_path / "update.log"))

    captured = {}
    monkeypatch.setattr(aur.subprocess, "Popen",
                        lambda argv, **kw: captured.update(argv=argv, kw=kw) or object())
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.post("/api/admin/update")
    assert r.json()["via"] == "detached"
    assert captured["argv"] == ["bash", str(stub)]
    assert not (tmp_path / "ops" / "update-requested").exists()


def test_default_script_path_is_fixed():
    # The default is the fixed deploy path; overridable only via env for tests/dev.
    assert aur.DEFAULT_UPDATE_SCRIPT == "/opt/orwell/deploy/orwell-update.sh"
    assert aur.DEFAULT_UPDATE_LOG == "/opt/orwell/data/update.log"


def test_status_page_carries_the_update_button(monkeypatch):
    # The button renders on the admin-gated status page; non-admin can't reach the page at all.
    monkeypatch.setenv("AUTH_ENABLED", "true")
    gated = TestClient(_app(), raise_server_exceptions=False)
    assert gated.get("/admin/status").status_code == 403

    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_app(), raise_server_exceptions=False)
    body = client.get("/admin/status").text
    assert 'id="update-orwell"' in body
    assert "Update Orwell (pull + rebuild + restart)" in body
    assert "/api/admin/update" in body


def test_routes_wired_into_app_py():
    # The router is registered in app.py (the surface is actually mounted, not just defined).
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    app_py = open(os.path.join(base, "app.py"), encoding="utf-8").read()
    assert "setup_admin_update_routes" in app_py
