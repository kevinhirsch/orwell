"""Regression: the maintenance buttons must drop their trigger flag where the root watcher looks.

The bug (reported on a real box): ``orwell-oobe-reset.sh --yes`` works when run by hand, but the
admin/health-panel buttons — Update, Update + Reset, Factory Reset (OOBE) — do nothing.

Root cause: the front-end resolved the ops/flag dir to the FRONT-END app-data tree
(``frontend/data``) while the root-side systemd path units (``orwell-ops-*.path``), the installer,
``orwell-ops-progress.sh``, and the hard-coded ``ops-*.log`` paths all live in the DEPLOY data tree
(``/opt/orwell/data``). So the FE dropped ``data/ops/<flag>`` where no watcher ever saw it; the
button reported ``started: true`` and nothing ran. Every prior test set ``DATA_DIR`` explicitly, so
both sides collapsed onto one temp root and the production divergence was invisible.

These tests run with ``DATA_DIR`` UNSET — the production posture (the systemd unit sets neither
``DATA_DIR`` nor a ``data/.env`` ``DATA_DIR`` line) — and prove the FE resolves the ops/flag dir to
the DEPLOY tree the units actually watch.

Name-agnostic: this is pure deploy plumbing — no houseguests, no game state.
"""
import importlib
import os
import re

import pytest


def _dirs_for(module) -> tuple:
    """(repo_root/data, frontend/data) derived from a routes module's own file location.
    module.__file__ == <repo>/frontend/routes/<name>.py, so frontend == two up, repo == three up."""
    routes_dir = os.path.dirname(os.path.abspath(module.__file__))
    frontend_dir = os.path.dirname(routes_dir)
    repo_root = os.path.dirname(frontend_dir)
    return os.path.join(repo_root, "data"), os.path.join(frontend_dir, "data")


# (module, the flag the matching root path unit watches, the unit file basename)
_OPS_MODULES = [
    ("routes.admin_reset_routes", "factory-reset-requested", "orwell-ops-factory-reset.path"),
    ("routes.admin_update_routes", "update-requested", "orwell-ops-update.path"),
    ("routes.admin_update_reset_routes", "update-reset-requested", "orwell-ops-update-reset.path"),
    ("routes.admin_ops_status_routes", None, None),  # reads data/ops/<action>-status.json
]


@pytest.mark.parametrize("mod_name,flag,unit", _OPS_MODULES)
def test_ops_routes_resolve_to_the_deploy_data_dir(monkeypatch, mod_name, flag, unit):
    monkeypatch.delenv("DATA_DIR", raising=False)
    mod = importlib.import_module(mod_name)
    deploy_data, fe_data = _dirs_for(mod)
    # The fix: the ops/flag dir is the DEPLOY tree (repo/data), NOT the FE app-data tree.
    assert mod._data_dir() == deploy_data, (
        f"{mod_name} ops dir must be the deploy data tree {deploy_data}, got {mod._data_dir()}")
    assert mod._data_dir() != fe_data, (
        f"{mod_name} must NOT resolve to the FE app-data tree {fe_data} (the silent-no-op bug)")
    # _ops_dir() (where the flag/status lands) sits under that deploy tree.
    assert mod._ops_dir() == os.path.join(deploy_data, "ops")


def test_health_route_separates_fe_logs_from_the_ops_seam(monkeypatch):
    monkeypatch.delenv("DATA_DIR", raising=False)
    ahr = importlib.import_module("routes.admin_health_routes")
    deploy_data, fe_data = _dirs_for(ahr)
    # FE-written logs (portrait-log.jsonl, the script-run logs) stay in the FE app-data tree…
    assert ahr._data_dir() == fe_data
    # …while the maintenance-trigger seam targets the DEPLOY tree the root units watch.
    assert ahr._ops_data_dir() == deploy_data
    assert ahr._data_dir() != ahr._ops_data_dir()
    # The viewer tails BOTH trees so the deploy ops-*.log run logs are followable from the panel.
    assert deploy_data in ahr._log_dirs() and fe_data in ahr._log_dirs()


def test_fe_flag_subtree_matches_the_systemd_units(monkeypatch):
    """Cross-check: the absolute path each ``.path`` unit watches ends in the same ``data/ops/<flag>``
    subtree the FE now writes to. The absolute prefix (``/opt/orwell``) is just where the deploy tree
    lives in production; what must agree is the ``data/ops/<flag>`` tail."""
    monkeypatch.delenv("DATA_DIR", raising=False)
    for mod_name, flag, unit in _OPS_MODULES:
        if not flag:
            continue
        mod = importlib.import_module(mod_name)
        deploy_data, _ = _dirs_for(mod)
        repo_root = os.path.dirname(deploy_data)
        unit_path = os.path.join(repo_root, "deploy", "systemd", unit)
        text = open(unit_path, encoding="utf-8").read()
        m = re.search(r"^PathExists=(.+)$", text, re.MULTILINE)
        assert m, f"{unit} has no PathExists="
        watched = m.group(1).strip()
        # The unit watches <abs>/data/ops/<flag>; the FE writes <deploy_data>/ops/<flag>. Both tails
        # are data/ops/<flag>, so basename(deploy_data) must be 'data' and the flag name must agree.
        assert watched.endswith(f"/data/ops/{flag}"), watched
        assert os.path.basename(deploy_data) == "data"
        fe_flag = os.path.join(mod._ops_dir(), flag)
        assert fe_flag.endswith(f"/data/ops/{flag}"), fe_flag
