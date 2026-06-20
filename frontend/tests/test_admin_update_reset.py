"""Admin Update + Reset — pull+rebuild THEN reset to OOBE, KEEP the API-key/LLM config.

The combined middle tier of the three maintenance controls (Update · Update + Reset · Reset).

Proves:
  * the endpoint is admin-gated (403 without an admin session under AUTH_ENABLED=true, the shared
    require_admin contract — like test_admin_update / test_admin_factory_reset);
  * an admin call launches the FIXED combined script DETACHED (start_new_session=True, no shell,
    fixed argv incl. --yes) and returns {started: true} IMMEDIATELY — never blocking on completion;
  * with the G19b flag dir present it prefers the privilege-safe flag trigger (no subprocess) and
    writes the EXISTENCE-only flag `update-reset-requested`;
  * the command carries NO user input (fixed path, env-overridable only for tests/dev);
  * the destructive "Update + Reset" button renders on the admin-gated status page, sits between
    the existing "Update Orwell" and "Factory Reset (OOBE)" buttons, and the page demands a
    type-"RESET" confirmation before posting to /api/admin/update-reset.

Name-agnostic: "admin"/"user" are ACCOUNT ROLES, never houseguests.
"""
import importlib
import os

from fastapi import FastAPI
from fastapi.testclient import TestClient

aurr = importlib.import_module("routes.admin_update_reset_routes")
ahr = importlib.import_module("routes.admin_health_routes")


def _app():
    app = FastAPI()
    app.include_router(aurr.setup_admin_update_reset_routes())
    app.include_router(ahr.setup_admin_status_page())
    return app


def test_update_reset_is_admin_gated(monkeypatch):
    # AUTH_ENABLED=true with no admin session → 403 (a non-admin cannot trigger an update+reset).
    monkeypatch.setenv("AUTH_ENABLED", "true")
    client = TestClient(_app(), raise_server_exceptions=False)
    assert client.post("/api/admin/update-reset").status_code == 403


def test_update_reset_runs_detached_and_returns_started(monkeypatch, tmp_path):
    # No real host path is touched: the script path is overridden and Popen is captured.
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))                 # no data/ops → the detached path
    monkeypatch.delenv("ORWELL_UPDATE_RESET_SUDO", raising=False)
    stub = tmp_path / "fake-update-reset.sh"
    stub.write_text("#!/bin/bash\necho updating-then-resetting\n")
    monkeypatch.setenv("ORWELL_UPDATE_RESET_SCRIPT", str(stub))
    monkeypatch.setenv("ORWELL_UPDATE_RESET_LOG", str(tmp_path / "ops-update-reset.log"))

    captured = {}

    class _FakeProc:
        pass

    def _fake_popen(argv, **kwargs):
        captured["argv"] = argv
        captured["kwargs"] = kwargs
        return _FakeProc()

    monkeypatch.setattr(aurr.subprocess, "Popen", _fake_popen)

    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.post("/api/admin/update-reset")
    assert r.status_code == 200
    body = r.json()
    assert body["started"] is True
    assert body["via"] == "detached"

    # Fixed argv WITH --yes (the browser already confirmed RESET), no shell, no user input;
    # detached into its own session so the self-restart cannot kill it; output to the log file.
    assert captured["argv"] == ["bash", str(stub), "--yes"]
    assert captured["kwargs"].get("start_new_session") is True
    assert captured["kwargs"].get("shell") in (None, False)  # never shell=True
    assert (tmp_path / "ops-update-reset.log").exists()


def test_update_reset_sudo_wraps_argv(monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("ORWELL_UPDATE_RESET_SUDO", "1")
    stub = tmp_path / "fake-update-reset.sh"
    stub.write_text("#!/bin/bash\n")
    monkeypatch.setenv("ORWELL_UPDATE_RESET_SCRIPT", str(stub))
    monkeypatch.setenv("ORWELL_UPDATE_RESET_LOG", str(tmp_path / "ops-update-reset.log"))

    captured = {}
    monkeypatch.setattr(aurr.subprocess, "Popen",
                        lambda argv, **kw: captured.update(argv=argv) or object())
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.post("/api/admin/update-reset")
    assert r.status_code == 200 and r.json()["started"] is True
    assert captured["argv"] == ["sudo", "-n", "bash", str(stub), "--yes"]


def test_update_reset_prefers_flag_trigger_when_installed(monkeypatch, tmp_path):
    # With the flag dir present, the privilege-safe trigger is used — NO subprocess spawns —
    # and the EXISTENCE-only `update-reset-requested` flag is written.
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.delenv("ORWELL_UPDATE_RESET_DIRECT", raising=False)
    (tmp_path / "ops").mkdir()

    def _boom(*a, **k):  # the detached path must NOT be taken here
        raise AssertionError("subprocess.Popen must not run when the flag trigger is installed")

    monkeypatch.setattr(aurr.subprocess, "Popen", _boom)
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.post("/api/admin/update-reset")
    assert r.status_code == 200
    body = r.json()
    assert body["started"] is True and body["via"] == "flag-trigger"
    assert (tmp_path / "ops" / "update-reset-requested").exists()


def test_update_reset_force_direct_overrides_flag(monkeypatch, tmp_path):
    # ORWELL_UPDATE_RESET_DIRECT=1 forces the detached path even when the flag dir exists.
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("ORWELL_UPDATE_RESET_DIRECT", "1")
    monkeypatch.delenv("ORWELL_UPDATE_RESET_SUDO", raising=False)
    (tmp_path / "ops").mkdir()
    stub = tmp_path / "fake-update-reset.sh"
    stub.write_text("#!/bin/bash\n")
    monkeypatch.setenv("ORWELL_UPDATE_RESET_SCRIPT", str(stub))
    monkeypatch.setenv("ORWELL_UPDATE_RESET_LOG", str(tmp_path / "ops-update-reset.log"))

    captured = {}
    monkeypatch.setattr(aurr.subprocess, "Popen",
                        lambda argv, **kw: captured.update(argv=argv, kw=kw) or object())
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.post("/api/admin/update-reset")
    assert r.json()["via"] == "detached"
    assert captured["argv"] == ["bash", str(stub), "--yes"]
    assert not (tmp_path / "ops" / "update-reset-requested").exists()


def test_default_script_path_is_fixed():
    # The default is the fixed deploy path; overridable only via env for tests/dev.
    assert aurr.DEFAULT_UPDATE_RESET_SCRIPT == "/opt/orwell/deploy/orwell-update-reset.sh"
    assert aurr.DEFAULT_UPDATE_RESET_LOG == "/opt/orwell/data/ops-update-reset.log"
    assert aurr.FLAG_NAME == "update-reset-requested"


def test_status_page_carries_the_update_reset_button(monkeypatch):
    # The button renders on the admin-gated status page; non-admin can't reach the page at all.
    monkeypatch.setenv("AUTH_ENABLED", "true")
    gated = TestClient(_app(), raise_server_exceptions=False)
    assert gated.get("/admin/status").status_code == 403

    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_app(), raise_server_exceptions=False)
    body = client.get("/admin/status").text
    assert 'id="update-reset"' in body
    assert "Update + Reset" in body
    assert "/api/admin/update-reset" in body
    # Destructive: the page demands a typed RESET (not a bare OK) before posting.
    assert "Type RESET to confirm" in body
    # The self-contained lane markers exist and are unique (the merge-coordination region).
    assert "BEGIN update-reset-combo lane button" in body
    assert "BEGIN update-reset-combo lane:" in body


def test_update_reset_button_sits_between_update_and_factory_reset(monkeypatch):
    # The three controls read as a set: Update Orwell · Update + Reset · Factory Reset (OOBE).
    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_app(), raise_server_exceptions=False)
    body = client.get("/admin/status").text
    i_update = body.index('id="update-orwell"')
    i_combo = body.index('id="update-reset"')
    i_factory = body.index('id="factory-reset"')
    assert i_update < i_combo < i_factory


def test_routes_wired_into_app_py():
    # The router is registered in app.py (the surface is actually mounted, not just defined).
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    app_py = open(os.path.join(base, "app.py"), encoding="utf-8").read()
    assert "setup_admin_update_reset_routes" in app_py
