"""End-to-end: the OOBE reset SCRIPT (deploy/orwell-oobe-reset.sh) actually scrubs.

The playtest bug was that the button NEVER ran the script with privilege, so nothing was deleted.
This test proves the OTHER half: when the script DOES run with permission (here: a self-contained
dev layout under a tmp dir — no /opt paths, no systemd, so the run-as-root guard does not trip and
the current user can scrub), it genuinely:
  * removes ALL accounts (auth.json) + sessions + uploads + every engine game sandbox;
  * PRESERVES the API-key / LLM-provider config (the .app_key / .key / api_keys.json key files and
    the rebuilt app.db carrying ONLY model_endpoints — via the real frontend/scripts/oobe_reset.py);
  * PRESERVES the engine data/.env;
  * writes the ops-progress status file to data/ops/factory-reset-status.json ending ok/done.

Runs the REAL deploy script over a sandboxed layout (APP_DIR/ENGINE/FE dirs overridden by env),
with --no-restart (there are no services to bounce). Name-agnostic: roles only, no houseguests.
"""
import json
import os
import shutil
import sqlite3
import subprocess

import pytest

_REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_SCRIPT = os.path.join(_REPO, "deploy", "orwell-oobe-reset.sh")
_OOBE_HELPER = os.path.join(_REPO, "frontend", "scripts", "oobe_reset.py")


def _seed_app_db(db_path):
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE model_endpoints (id TEXT, name TEXT, base_url TEXT, api_key TEXT, "
                 "model_type TEXT, is_enabled INTEGER)")
    conn.execute("INSERT INTO model_endpoints VALUES (?,?,?,?,?,?)",
                 ("ep1", "Provider", "https://api.example/v1", "enc:KEEPME", "llm", 1))
    # User data that MUST be wiped:
    conn.execute("CREATE TABLE sessions (id TEXT, owner TEXT)")
    conn.execute("INSERT INTO sessions VALUES ('s1', 'someone')")
    conn.commit()
    conn.close()


@pytest.mark.skipif(shutil.which("bash") is None, reason="bash required")
def test_reset_script_scrubs_accounts_and_sandboxes_keeps_keys(tmp_path):
    app = tmp_path / "app"
    fe_data = app / "frontend" / "data"
    config = app / "data"               # CONFIG_DIR (holds .env + data/ops)
    engine_saves = app / ".orwell-data"  # ENGINE_SAVE_DIR
    fe_scripts = app / "frontend" / "scripts"
    for d in (fe_data, config, engine_saves, fe_scripts):
        d.mkdir(parents=True, exist_ok=True)
    # Provide the real OOBE helper at the path the script expects (<fe>/scripts/oobe_reset.py).
    shutil.copy(_OOBE_HELPER, fe_scripts / "oobe_reset.py")

    # ── seed: accounts + uploads + a sandbox (WIPE) and the key files + app.db (KEEP) ──
    (fe_data / "auth.json").write_text(json.dumps({"users": {"rhino": {"is_admin": True}}}))
    (fe_data / "uploads").mkdir()
    (fe_data / "uploads" / "pic.png").write_bytes(b"PNG")
    (fe_data / ".app_key").write_text("APPKEY")           # KEEP
    (fe_data / ".key").write_text("KEY")                  # KEEP
    (fe_data / "api_keys.json").write_text("{}")          # KEEP
    _seed_app_db(str(fe_data / "app.db"))
    (fe_data / "settings.json").write_text(json.dumps({"default_endpoint_id": "ep1", "theme": "x"}))
    # an engine game sandbox (per-user dir) under the save dir:
    (engine_saves / "player-1").mkdir()
    (engine_saves / "player-1" / "save.json").write_text("{}")
    # the preserved engine config:
    (config / ".env").write_text("ORWELL_ENGINE_TOKEN=secret\n")
    # the ops trigger dir must survive (it holds the live status file):
    (config / "ops").mkdir()

    env = dict(os.environ)
    env.update({
        "APP_DIR": str(app),
        "ORWELL_CONFIG_DIR": str(config),
        "ORWELL_DATA_DIR": str(engine_saves),
        "ORWELL_FE_DIR": str(app / "frontend"),
        "ORWELL_FE_DATA_DIR": str(fe_data),
        "ORWELL_PYTHON": "python3",
        # point DATABASE_URL/DATA_DIR for the helper subprocess (the script also sets these):
    })
    # Run the real script non-interactively, no restart (no services here).
    proc = subprocess.run(["bash", _SCRIPT, "--yes", "--no-restart"],
                          env=env, capture_output=True, text=True)
    assert proc.returncode == 0, f"reset failed:\nSTDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}"

    # ── accounts + uploads GONE ──
    assert not (fe_data / "auth.json").exists(), "auth.json (accounts) must be scrubbed"
    assert not (fe_data / "uploads").exists(), "uploads must be scrubbed"
    # ── the engine game sandbox GONE ──
    assert not (engine_saves / "player-1").exists(), "the game sandbox must be scrubbed"

    # ── API-key config PRESERVED ──
    assert (fe_data / ".app_key").read_text() == "APPKEY"
    assert (fe_data / ".key").read_text() == "KEY"
    assert (fe_data / "api_keys.json").exists()
    # app.db rebuilt with ONLY the provider table (the helper ran):
    conn = sqlite3.connect(str(fe_data / "app.db"))
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    rows = conn.execute("SELECT id, api_key FROM model_endpoints").fetchall()
    conn.close()
    assert tables == {"model_endpoints"}, f"only the provider table may survive, got {tables}"
    assert rows == [("ep1", "enc:KEEPME")]
    # ── engine config PRESERVED ──
    assert (config / ".env").read_text() == "ORWELL_ENGINE_TOKEN=secret\n"

    # ── ops-progress status file written and terminal-OK ──
    status_path = config / "ops" / "factory-reset-status.json"
    assert status_path.exists(), "the reset must publish ops progress"
    status = json.loads(status_path.read_text())
    assert status["action"] == "factory-reset"
    assert status["ok"] is True and status["running"] is False
    assert "OOBE ready" in status["message"]


@pytest.mark.skipif(shutil.which("bash") is None, reason="bash required")
def test_reset_script_progress_records_failure(tmp_path):
    # If the preserve/rebuild helper is MISSING, the script aborts (keeps keys safe) AND the
    # ops-progress status records a FAILED terminal state instead of going silent.
    app = tmp_path / "app"
    fe_data = app / "frontend" / "data"
    config = app / "data"
    engine_saves = app / ".orwell-data"
    for d in (fe_data, config, engine_saves):
        d.mkdir(parents=True, exist_ok=True)
    (fe_data / "auth.json").write_text("{}")
    (config / "ops").mkdir()

    env = dict(os.environ)
    env.update({
        "APP_DIR": str(app),
        "ORWELL_CONFIG_DIR": str(config),
        "ORWELL_DATA_DIR": str(engine_saves),
        "ORWELL_FE_DIR": str(app / "frontend"),
        "ORWELL_FE_DATA_DIR": str(fe_data),
        # point the helper at a path that does NOT exist → the script aborts before scrubbing.
        "ORWELL_OOBE_HELPER": str(app / "frontend" / "scripts" / "nope.py"),
    })
    proc = subprocess.run(["bash", _SCRIPT, "--yes", "--no-restart"],
                          env=env, capture_output=True, text=True)
    assert proc.returncode != 0, "a missing helper must abort the reset (keys-safe), not succeed"
    # auth.json must STILL be there (nothing scrubbed — keys-safe abort):
    assert (fe_data / "auth.json").exists()
    status = json.loads((config / "ops" / "factory-reset-status.json").read_text())
    assert status["ok"] is False and status["running"] is False
    assert status["message"].startswith("FAILED:")
