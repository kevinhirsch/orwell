"""End-to-end: the FACTORY-reset SCRIPT (deploy/orwell-factory-reset.sh) keeps the LLM config.

Per the product decision (issue #860), "factory reset" returns the box to first-run OOBE while
preserving ONLY the operator's LLM CREDENTIALS — the API keys + the provider endpoint(s) — and
RESETS the selected models to the OOB defaults (glm-4.7 narrator, gemini-3.1-flash-image
portraits). Everything else is wiped (accounts, sessions, uploads, AND every cast portrait /
avatar / headshot, presets, …). The host script delegates to orwell-oobe-reset.sh so the two can
never drift; this test runs the REAL factory-reset script over a sandboxed dev layout (no /opt, no
systemd, --no-restart) and proves the delegation + the keep/reset/wipe split end to end.

Name-agnostic: roles only, no houseguests.
"""
import json
import os
import shutil
import sqlite3
import subprocess

import pytest

_REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_SCRIPT = os.path.join(_REPO, "deploy", "orwell-factory-reset.sh")
_OOBE_HELPER = os.path.join(_REPO, "frontend", "scripts", "oobe_reset.py")


def _seed_app_db(db_path):
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE model_endpoints (id TEXT, name TEXT, base_url TEXT, api_key TEXT, "
                 "model_type TEXT, is_enabled INTEGER)")
    conn.execute("INSERT INTO model_endpoints VALUES (?,?,?,?,?,?)",
                 ("ep1", "Provider", "https://api.example/v1", "enc:KEEPME", "llm", 1))
    # account/session data that MUST be wiped:
    conn.execute("CREATE TABLE sessions (id TEXT, owner TEXT)")
    conn.execute("INSERT INTO sessions VALUES ('s1', 'someone')")
    conn.commit()
    conn.close()


@pytest.mark.skipif(shutil.which("bash") is None, reason="bash required")
def test_factory_reset_keeps_keys_resets_models_wipes_the_rest(tmp_path):
    app = tmp_path / "app"
    fe_data = app / "frontend" / "data"
    config = app / "data"               # CONFIG_DIR (holds .env + data/ops)
    engine_saves = app / ".orwell-data"  # ENGINE_SAVE_DIR
    fe_scripts = app / "frontend" / "scripts"
    for d in (fe_data, config, engine_saves, fe_scripts):
        d.mkdir(parents=True, exist_ok=True)
    shutil.copy(_OOBE_HELPER, fe_scripts / "oobe_reset.py")

    # ── KEEP: the API-key / LLM config (key files + the provider table + operational flags). The
    # model SELECTIONS (incl. a stale sakana/fugu-ultra) RESET to defaults (#860) and must NOT ride.
    (fe_data / ".app_key").write_text("APPKEY")
    (fe_data / ".key").write_text("KEY")
    (fe_data / "api_keys.json").write_text("{}")
    _seed_app_db(str(fe_data / "app.db"))
    (fe_data / "settings.json").write_text(json.dumps({
        "default_endpoint_id": "ep1", "default_model": "sakana/fugu-ultra", "image_model": "img",
        "image_quality": "high", "theme": "midnight",  # theme is NOT an LLM key → dropped
    }))

    # ── WIPE: accounts + uploads + every account-level image + presets + an engine sandbox ──
    (fe_data / "auth.json").write_text(json.dumps({"users": {"rhino": {"is_admin": True}}}))
    (fe_data / "uploads").mkdir()
    (fe_data / "uploads" / "pic.png").write_bytes(b"PNG")
    (fe_data / "presets.json").write_text("{}")
    for sub in ("portraits", "avatars", "headshots"):
        (fe_data / sub).mkdir()
        (fe_data / sub / "leftover.png").write_bytes(b"OLD-FACE")
    (engine_saves / "player-1").mkdir()
    (engine_saves / "player-1" / "save.json").write_text("{}")
    (config / ".env").write_text("ORWELL_ENGINE_TOKEN=secret\n")
    (config / "ops").mkdir()

    env = dict(os.environ)
    env.update({
        "APP_DIR": str(app),
        "ORWELL_CONFIG_DIR": str(config),
        "ORWELL_DATA_DIR": str(engine_saves),
        "ORWELL_FE_DIR": str(app / "frontend"),
        "ORWELL_FE_DATA_DIR": str(fe_data),
        "ORWELL_PYTHON": "python3",
    })
    proc = subprocess.run(["bash", _SCRIPT, "--yes", "--no-restart"],
                          env=env, capture_output=True, text=True)
    assert proc.returncode == 0, f"reset failed:\nSTDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}"

    # ── EVERYTHING ELSE wiped (incl. account-level images — the literal "wipe those too") ──
    assert not (fe_data / "auth.json").exists()
    assert not (fe_data / "uploads").exists()
    assert not (fe_data / "presets.json").exists()
    assert not (fe_data / "portraits").exists()
    assert not (fe_data / "avatars").exists()
    assert not (fe_data / "headshots").exists()
    assert not (engine_saves / "player-1").exists()

    # ── KEEP: the API keys + the provider table + ONLY the operational flags ──
    assert (fe_data / ".app_key").read_text() == "APPKEY"
    assert (fe_data / ".key").read_text() == "KEY"
    assert (fe_data / "api_keys.json").exists()
    conn = sqlite3.connect(str(fe_data / "app.db"))
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    rows = conn.execute("SELECT id, api_key FROM model_endpoints").fetchall()
    conn.close()
    assert tables == {"model_endpoints"} and rows == [("ep1", "enc:KEEPME")]
    settings = json.loads((fe_data / "settings.json").read_text())
    # Model SELECTIONS reset to default (NOT preserved) — the stale fugu pick never rides (#860).
    assert "default_endpoint_id" not in settings
    assert "default_model" not in settings
    assert "image_model" not in settings
    assert "sakana/fugu-ultra" not in (fe_data / "settings.json").read_text()
    assert settings.get("image_quality") == "high"        # operational flag kept
    assert "theme" not in settings                        # non-LLM setting dropped to OOBE default

    # ── engine config PRESERVED ──
    assert (config / ".env").read_text() == "ORWELL_ENGINE_TOKEN=secret\n"


@pytest.mark.skipif(shutil.which("bash") is None, reason="bash required")
def test_factory_reset_help_describes_keeping_the_llm_config(tmp_path):
    """--help is answered by the script itself (not forwarded), and states the keep-the-3 contract."""
    proc = subprocess.run(["bash", _SCRIPT, "--help"], capture_output=True, text=True)
    assert proc.returncode == 0
    out = proc.stdout.lower()
    assert "api key" in out and "model" in out and "preserv" in out
