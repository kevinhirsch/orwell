"""Admin Factory Reset (OOBE) — wipe everything to first-run, KEEP the API-key/LLM config.

Proves:
  * the endpoint is admin-gated (403 without an admin session under AUTH_ENABLED=true, the shared
    require_admin contract — like test_admin_update / test_g1_health_logs);
  * an admin call launches the FIXED reset DETACHED (start_new_session=True, no shell, fixed argv
    incl. --yes) and returns {started: true} IMMEDIATELY — never blocking on completion;
  * with the G19b flag dir present it prefers the privilege-safe flag trigger (no subprocess) and
    writes the EXISTENCE-only flag `factory-reset-requested`;
  * the command carries NO user input (fixed path, env-overridable only for tests/dev);
  * the destructive "Factory Reset (OOBE)" button renders on the admin-gated status page and the
    page demands a type-"RESET" confirmation before posting to /api/admin/factory-reset.

Name-agnostic: "admin"/"user" are ACCOUNT ROLES, never houseguests.
"""
import importlib
import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

arr = importlib.import_module("routes.admin_reset_routes")
ahr = importlib.import_module("routes.admin_health_routes")


def _app():
    app = FastAPI()
    app.include_router(arr.setup_admin_reset_routes())
    app.include_router(ahr.setup_admin_status_page())
    return app


def test_factory_reset_is_admin_gated(monkeypatch):
    # AUTH_ENABLED=true with no admin session → 403 (a non-admin cannot trigger a reset).
    monkeypatch.setenv("AUTH_ENABLED", "true")
    client = TestClient(_app(), raise_server_exceptions=False)
    assert client.post("/api/admin/factory-reset").status_code == 403


def test_factory_reset_runs_detached_and_returns_started(monkeypatch, tmp_path):
    # No real host path is touched: the script path is overridden and Popen is captured.
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))                 # no data/ops → the detached path
    monkeypatch.delenv("ORWELL_OOBE_RESET_SUDO", raising=False)
    stub = tmp_path / "fake-reset.sh"
    stub.write_text("#!/bin/bash\necho resetting\n")
    monkeypatch.setenv("ORWELL_OOBE_RESET_SCRIPT", str(stub))
    monkeypatch.setenv("ORWELL_OOBE_RESET_LOG", str(tmp_path / "ops-factory-reset.log"))

    captured = {}

    class _FakeProc:
        pass

    def _fake_popen(argv, **kwargs):
        captured["argv"] = argv
        captured["kwargs"] = kwargs
        return _FakeProc()

    monkeypatch.setattr(arr.subprocess, "Popen", _fake_popen)

    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.post("/api/admin/factory-reset")
    assert r.status_code == 200
    body = r.json()
    assert body["started"] is True
    assert body["via"] == "detached"

    # Fixed argv WITH --yes (the browser already confirmed RESET), no shell, no user input;
    # detached into its own session so the self-restart cannot kill it; output to the log file.
    assert captured["argv"] == ["bash", str(stub), "--yes"]
    assert captured["kwargs"].get("start_new_session") is True
    assert captured["kwargs"].get("shell") in (None, False)  # never shell=True
    assert (tmp_path / "ops-factory-reset.log").exists()


def test_factory_reset_sudo_wraps_argv(monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("ORWELL_OOBE_RESET_SUDO", "1")
    stub = tmp_path / "fake-reset.sh"
    stub.write_text("#!/bin/bash\n")
    monkeypatch.setenv("ORWELL_OOBE_RESET_SCRIPT", str(stub))
    monkeypatch.setenv("ORWELL_OOBE_RESET_LOG", str(tmp_path / "ops-factory-reset.log"))

    captured = {}
    monkeypatch.setattr(arr.subprocess, "Popen",
                        lambda argv, **kw: captured.update(argv=argv) or object())
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.post("/api/admin/factory-reset")
    assert r.status_code == 200 and r.json()["started"] is True
    assert captured["argv"] == ["sudo", "-n", "bash", str(stub), "--yes"]


def test_factory_reset_prefers_flag_trigger_when_installed(monkeypatch, tmp_path):
    # With the flag dir present, the privilege-safe trigger is used — NO subprocess spawns —
    # and the EXISTENCE-only `factory-reset-requested` flag is written.
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.delenv("ORWELL_OOBE_RESET_DIRECT", raising=False)
    (tmp_path / "ops").mkdir()

    def _boom(*a, **k):  # the detached path must NOT be taken here
        raise AssertionError("subprocess.Popen must not run when the flag trigger is installed")

    monkeypatch.setattr(arr.subprocess, "Popen", _boom)
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.post("/api/admin/factory-reset")
    assert r.status_code == 200
    body = r.json()
    assert body["started"] is True and body["via"] == "flag-trigger"
    assert (tmp_path / "ops" / "factory-reset-requested").exists()


def test_factory_reset_force_direct_overrides_flag(monkeypatch, tmp_path):
    # ORWELL_OOBE_RESET_DIRECT=1 forces the detached path even when the flag dir exists.
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("ORWELL_OOBE_RESET_DIRECT", "1")
    monkeypatch.delenv("ORWELL_OOBE_RESET_SUDO", raising=False)
    (tmp_path / "ops").mkdir()
    stub = tmp_path / "fake-reset.sh"
    stub.write_text("#!/bin/bash\n")
    monkeypatch.setenv("ORWELL_OOBE_RESET_SCRIPT", str(stub))
    monkeypatch.setenv("ORWELL_OOBE_RESET_LOG", str(tmp_path / "ops-factory-reset.log"))

    captured = {}
    monkeypatch.setattr(arr.subprocess, "Popen",
                        lambda argv, **kw: captured.update(argv=argv, kw=kw) or object())
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.post("/api/admin/factory-reset")
    assert r.json()["via"] == "detached"
    assert captured["argv"] == ["bash", str(stub), "--yes"]
    assert not (tmp_path / "ops" / "factory-reset-requested").exists()


def test_default_script_path_is_fixed():
    # The default is the fixed deploy path; overridable only via env for tests/dev.
    assert arr.DEFAULT_RESET_SCRIPT == "/opt/orwell/deploy/orwell-oobe-reset.sh"
    assert arr.DEFAULT_RESET_LOG == "/opt/orwell/data/ops-factory-reset.log"
    assert arr.FLAG_NAME == "factory-reset-requested"


def test_status_page_carries_the_factory_reset_button(monkeypatch):
    # The button renders on the admin-gated status page; non-admin can't reach the page at all.
    monkeypatch.setenv("AUTH_ENABLED", "true")
    gated = TestClient(_app(), raise_server_exceptions=False)
    assert gated.get("/admin/status").status_code == 403

    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_app(), raise_server_exceptions=False)
    body = client.get("/admin/status").text
    assert 'id="factory-reset"' in body
    assert "Factory Reset (OOBE)" in body
    assert "/api/admin/factory-reset" in body
    # Destructive: the page demands a typed RESET (not a bare OK) before posting.
    assert 'typed.trim() !== "RESET"' in body
    assert "Type RESET to confirm" in body


def test_routes_wired_into_app_py():
    # The router is registered in app.py (the surface is actually mounted, not just defined).
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    app_py = open(os.path.join(base, "app.py"), encoding="utf-8").read()
    assert "setup_admin_reset_routes" in app_py
