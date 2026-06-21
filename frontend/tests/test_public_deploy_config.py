"""Feature 0067 / ADR 0007 — public-deploy config invariants.

Two structural guarantees: the FE unit binds a configurable LOOPBACK host (never 0.0.0.0), and NO
exposure artifact ever names the engine port — the engine stays private by simply never being
routed. These are file-content asserts, so they hold without standing up anything.
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))  # frontend/tests -> repo root
ENGINE_PORT = "8765"


def _read(*parts):
    with open(os.path.join(REPO, *parts), "r", encoding="utf-8") as fh:
        return fh.read()


def test_frontend_unit_binds_configurable_loopback():
    unit = _read("deploy", "systemd", "orwell-frontend.service")
    assert "--host ${ORWELL_BIND_HOST}" in unit
    assert "--host 0.0.0.0" not in unit
    assert "Environment=ORWELL_BIND_HOST=127.0.0.1" in unit
    assert "--proxy-headers" in unit


def test_no_exposure_artifact_names_the_engine_port():
    expose = os.path.join(REPO, "deploy", "expose")
    assert os.path.isdir(expose), "deploy/expose/ kit is missing"
    offenders = []
    for root, _dirs, files in os.walk(expose):
        for fn in files:
            path = os.path.join(root, fn)
            with open(path, "r", encoding="utf-8", errors="ignore") as fh:
                if ENGINE_PORT in fh.read():
                    offenders.append(os.path.relpath(path, REPO))
    assert offenders == [], f"engine port leaked into exposure config: {offenders}"


def test_cloudflared_config_present():
    assert os.path.isfile(os.path.join(REPO, "deploy", "expose", "cloudflared", "config.yml"))
