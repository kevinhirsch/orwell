"""Regression: the public-deployment / SSL config must SURVIVE every built-in reset.

A box made reachable on the internet via the admin "Connect to the internet" wizard (feature 0068)
keeps its public posture in three places:
  * data/.env            — the public-profile env the wizard applied (ORWELL_PUBLIC, ALLOWED_HOSTS,
                           ALLOWED_ORIGINS, SECURE_COOKIES, AUTH_ENABLED, LOCALHOST_BYPASS, …).
  * data/ops/            — the public-deployment apply record the admin status page reads back
                           (public-deployment.json → the displayed domain; *-status.json → last apply).
  * the OS-level cloudflared tunnel/service — outside the app tree, so no reset touches it.

A reset must NOT knock the box off the web. The factory reset (→ orwell-oobe-reset.sh) and the
new-season game reset both PRESERVE data/.env (already) and data/ops/ (the apply record), in BOTH
data-dir layouts: the modern install (ORWELL_DATA_DIR=<app>/data/saves, a separate save dir) AND a
same-dir install (ORWELL_DATA_DIR=<app>/data == the config dir) where the save-dir scrub and the
config-dir scrub collapse onto one directory.

These run the REAL deploy scripts over a sandboxed tmp layout (no /opt paths, no orwell-* units, so
the run-as-root guard does not trip and the test user can scrub), with --no-restart. Name-agnostic:
pure deploy plumbing — no houseguests, no game state.
"""
import json
import os
import shutil
import subprocess

import pytest

_REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_OOBE_SCRIPT = os.path.join(_REPO, "deploy", "orwell-oobe-reset.sh")
_GAME_SCRIPT = os.path.join(_REPO, "deploy", "orwell-game-reset.sh")
_FACTORY_SCRIPT = os.path.join(_REPO, "deploy", "orwell-factory-reset.sh")
_OOBE_HELPER = os.path.join(_REPO, "frontend", "scripts", "oobe_reset.py")

# The full public-profile env the "Connect to the internet" wizard applies (the 0067 floor). Every
# one of these must still be in data/.env after a reset, or the box silently drops off the web.
_PUBLIC_ENV = {
    "ORWELL_PUBLIC": "1",
    "ALLOWED_HOSTS": "play.example.com",
    "ALLOWED_ORIGINS": "https://play.example.com",
    "SECURE_COOKIES": "true",
    "AUTH_ENABLED": "true",
    "LOCALHOST_BYPASS": "false",
}
# Non-public engine config that also lives in data/.env and must survive (sanity anchor).
_BASE_ENV = {
    "ORWELL_ENGINE_TOKEN": "enginesecret",
    "ORWELL_ENGINE_ADMIN_TOKEN": "adminsecret",
}


def _parse_env(text: str) -> dict:
    out = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip()
    return out


def _write_env(path, extra: dict) -> None:
    lines = ["# --- orwell ---"]
    for k, v in {**_BASE_ENV, **_PUBLIC_ENV, **extra}.items():
        lines.append(f"{k}={v}")
    path.write_text("\n".join(lines) + "\n")


def _seed_ops_record(ops_dir) -> None:
    """The public-deployment apply record the admin page reads back (the wizard's last apply)."""
    ops_dir.mkdir(parents=True, exist_ok=True)
    (ops_dir / "public-deployment.json").write_text(json.dumps({
        "action": "apply",
        "env": dict(_PUBLIC_ENV),
        "domains": ["play.example.com"],
        "hasToken": True,
        "ts": "2026-06-21T00:00:00+00:00",
    }))
    (ops_dir / "public-deployment-status.json").write_text(json.dumps({
        "action": "public-deployment", "ok": True, "running": False,
        "message": "public deployment applied — front-end restarting",
    }))


def _assert_public_config_intact(config_dir, *, expect_domain="play.example.com") -> None:
    """data/.env keeps every public key + the data/ops/ apply record survives intact."""
    env = _parse_env((config_dir / ".env").read_text())
    for k, v in _PUBLIC_ENV.items():
        assert env.get(k) == v, f"data/.env lost/changed the public key {k} (got {env.get(k)!r}, want {v!r})"
    for k, v in _BASE_ENV.items():
        assert env.get(k) == v, f"data/.env lost the engine secret {k}"

    rec_path = config_dir / "ops" / "public-deployment.json"
    assert rec_path.exists(), "the data/ops/ public-deployment apply record must survive the reset"
    rec = json.loads(rec_path.read_text())
    assert rec.get("domains") == [expect_domain], "the applied public domain must survive the reset"
    assert (config_dir / "ops" / "public-deployment-status.json").exists(), \
        "the data/ops/ last-apply status (the admin page's record) must survive the reset"


# ── OOBE / factory reset ───────────────────────────────────────────────────────────────────────

@pytest.mark.skipif(shutil.which("bash") is None, reason="bash required")
@pytest.mark.parametrize("same_dir", [False, True], ids=["save-dir-separate", "save-dir==config-dir"])
def test_oobe_reset_preserves_public_deployment(tmp_path, same_dir):
    """The factory/OOBE reset wipes accounts + sandboxes but KEEPS the public-deployment config —
    in both the modern (separate save dir) and the same-dir (ORWELL_DATA_DIR=<app>/data) layouts."""
    app = tmp_path / "app"
    fe_data = app / "frontend" / "data"
    fe_scripts = app / "frontend" / "scripts"
    config = app / "data"                                  # CONFIG_DIR (.env + data/ops)
    engine_saves = config if same_dir else (app / ".orwell-data")  # ENGINE_SAVE_DIR
    for d in (fe_data, fe_scripts, config, engine_saves):
        d.mkdir(parents=True, exist_ok=True)
    shutil.copy(_OOBE_HELPER, fe_scripts / "oobe_reset.py")

    # Minimal FE store: an account (must be WIPED) + a key file (kept by the script's keep-list).
    (fe_data / "auth.json").write_text(json.dumps({"users": {"admin": {"is_admin": True}}}))
    (fe_data / ".app_key").write_text("APPKEY")
    # The preserved engine config + the public-deployment apply record.
    _write_env(config / ".env", {"ORWELL_DATA_DIR": str(engine_saves)})
    _seed_ops_record(config / "ops")
    # A live game sandbox under the save dir — must be scrubbed (proves the reset really ran).
    (engine_saves / "player-1").mkdir(parents=True, exist_ok=True)
    (engine_saves / "player-1" / "save.json").write_text("{}")

    env = dict(os.environ)
    env.update({
        "APP_DIR": str(app),
        "ORWELL_CONFIG_DIR": str(config),
        "ORWELL_DATA_DIR": str(engine_saves),
        "ORWELL_FE_DIR": str(app / "frontend"),
        "ORWELL_FE_DATA_DIR": str(fe_data),
        "ORWELL_PYTHON": "python3",
    })
    proc = subprocess.run(["bash", _OOBE_SCRIPT, "--yes", "--no-restart"],
                          env=env, capture_output=True, text=True)
    assert proc.returncode == 0, f"reset failed:\nSTDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}"

    # A real OOBE reset: the account + the game sandbox are gone…
    assert not (fe_data / "auth.json").exists(), "accounts must be scrubbed (real OOBE reset)"
    assert not (engine_saves / "player-1").exists(), "the game sandbox must be scrubbed"
    # …but the whole public-deployment posture survives.
    _assert_public_config_intact(config)


@pytest.mark.skipif(shutil.which("bash") is None, reason="bash required")
def test_factory_reset_delegates_and_preserves_public_deployment(tmp_path):
    """orwell-factory-reset.sh is a thin delegator to orwell-oobe-reset.sh — prove the public
    config survives through the front door admins actually use."""
    app = tmp_path / "app"
    fe_data = app / "frontend" / "data"
    fe_scripts = app / "frontend" / "scripts"
    config = app / "data"
    engine_saves = app / ".orwell-data"
    for d in (fe_data, fe_scripts, config, engine_saves):
        d.mkdir(parents=True, exist_ok=True)
    shutil.copy(_OOBE_HELPER, fe_scripts / "oobe_reset.py")
    (fe_data / "auth.json").write_text("{}")
    _write_env(config / ".env", {"ORWELL_DATA_DIR": str(engine_saves)})
    _seed_ops_record(config / "ops")

    env = dict(os.environ)
    env.update({
        "APP_DIR": str(app),
        "ORWELL_CONFIG_DIR": str(config),
        "ORWELL_DATA_DIR": str(engine_saves),
        "ORWELL_FE_DIR": str(app / "frontend"),
        "ORWELL_FE_DATA_DIR": str(fe_data),
        "ORWELL_PYTHON": "python3",
    })
    proc = subprocess.run(["bash", _FACTORY_SCRIPT, "--yes", "--no-restart"],
                          env=env, capture_output=True, text=True)
    assert proc.returncode == 0, f"factory reset failed:\nSTDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}"
    _assert_public_config_intact(config)


# ── game reset (new season) ──────────────────────────────────────────────────────────────────────

@pytest.mark.skipif(shutil.which("bash") is None, reason="bash required")
@pytest.mark.parametrize("same_dir", [False, True], ids=["save-dir-separate", "save-dir==config-dir"])
def test_game_reset_preserves_public_deployment(tmp_path, same_dir):
    """The new-season game reset keeps ALL config (accounts + LLM + public deployment) and only
    drops game progression — so a public box stays public, and its accounts stay logged in."""
    app = tmp_path / "app"
    fe_data = app / "frontend" / "data"
    config = app / "data"
    engine_saves = config if same_dir else (app / ".orwell-data")
    for d in (fe_data, config, engine_saves):
        d.mkdir(parents=True, exist_ok=True)

    (fe_data / "auth.json").write_text(json.dumps({"users": {"admin": {"is_admin": True}}}))
    _write_env(config / ".env", {"ORWELL_DATA_DIR": str(engine_saves)})
    _seed_ops_record(config / "ops")
    (engine_saves / "player-1").mkdir(parents=True, exist_ok=True)
    (engine_saves / "player-1" / "save.json").write_text("{}")

    env = dict(os.environ)
    env.update({
        "APP_DIR": str(app),
        "ORWELL_CONFIG_DIR": str(config),
        "ORWELL_DATA_DIR": str(engine_saves),
        "ORWELL_FE_DATA_DIR": str(fe_data),
    })
    proc = subprocess.run(["bash", _GAME_SCRIPT, "--yes", "--no-restart"],
                          env=env, capture_output=True, text=True)
    assert proc.returncode == 0, f"game reset failed:\nSTDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}"

    # The game sandbox is gone, but accounts (the FE store) and the public config are preserved.
    assert not (engine_saves / "player-1").exists(), "the game sandbox must be scrubbed"
    assert (fe_data / "auth.json").exists(), "game reset must KEEP accounts (it is config-preserving)"
    _assert_public_config_intact(config)
