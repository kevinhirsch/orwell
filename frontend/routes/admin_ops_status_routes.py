"""Admin ops-status — the read side of the ops-progress lane.

Every privileged ops button (Update, Factory Reset (OOBE), and any future Update+Reset) has its
script publish step-by-step progress to ``data/ops/<action>-status.json`` via the sourced shell
helper ``deploy/orwell-ops-progress.sh``. The status page polls THIS endpoint to render a live
timeline (stopping → preserving keys → wiping → scrubbing → rebuilding → restarting → done / FAILED)
that survives the services restart — so the old "logged 'triggered' then went silent" failure can
never recur: a stalled or failed run shows its error instead of a blank page.

This is a NEW file (the ops-progress lane owns it outright) so the shared ``admin_health_routes``
status-page edits stay confined to one small, clearly-commented region for clean merge ordering.

Boundaries / security:
  * Admin-gated by the shared ``require_admin`` contract (a non-admin gets 403), exactly like
    ``admin_health_routes`` / ``admin_update_routes`` / ``admin_reset_routes``.
  * READ-ONLY and Vault-free — it returns only operational progress metadata (action / step /
    message / timestamps), never game state. The status files are written by the deploy scripts.
  * Robust by construction: a missing / half-written / malformed status file degrades to a null
    entry, never an exception — the page must render even mid-restart.
"""

import json
import os

from fastapi import APIRouter, Request

from core.middleware import require_admin

# The fixed set of ops actions whose progress files we surface. The web tier picks from this
# allowlist — it never reads an arbitrary path. Each maps to data/ops/<action>-status.json and the
# matching live log basename the status page already tails (G1b).
_OPS_ACTIONS = {
    "update": "ops-update.log",
    "factory-reset": "ops-factory-reset.log",
    "update-reset": "ops-update-reset.log",   # the future Update+Reset combo (file may not exist)
}


def _data_dir() -> str:
    # The DEPLOY data dir (e.g. /opt/orwell/data): where the ops scripts publish
    # data/ops/<action>-status.json (and where the root-side path units watch the trigger flags).
    # It is the deploy tree — NOT the front-end app-data dir (frontend/data), a DIFFERENT tree only
    # two levels up from here. Resolving to frontend/data was the bug: the page polled a status dir
    # the ops scripts never wrote to. Three dirnames up (frontend/routes/<file> -> APP_DIR) + /data.
    # DATA_DIR overrides (tests/dev).
    return os.environ.get("DATA_DIR") or os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data")


def _ops_dir() -> str:
    return os.path.join(_data_dir(), "ops")


def _read_status(action: str) -> dict | None:
    """Read data/ops/<action>-status.json, tolerating absence / partial writes / bad JSON.

    Returns a normalized dict (the keys the page renders, with safe defaults) or None when there
    is no readable status for that action. Never raises — a poll mid-restart must not 500."""
    path = os.path.join(_ops_dir(), f"{action}-status.json")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            raw = json.load(fh)
    except (OSError, ValueError):
        return None
    if not isinstance(raw, dict):
        return None
    # Normalize: never trust the file's exact shape (a half-written file or an older schema).
    def _int(v, d=0):
        try:
            return int(v)
        except (TypeError, ValueError):
            return d
    return {
        "action": str(raw.get("action") or action),
        "step": _int(raw.get("step")),
        "total": _int(raw.get("total")),
        "message": str(raw.get("message") or ""),
        "running": bool(raw.get("running")),
        "ok": bool(raw.get("ok")),
        "error": str(raw.get("error") or ""),
        "ts": str(raw.get("ts") or ""),
        "log": _OPS_ACTIONS.get(action),
    }


def setup_admin_ops_status_routes() -> APIRouter:
    router = APIRouter(prefix="/api/admin", tags=["admin_ops_status"])

    @router.get("/ops-status")
    async def admin_ops_status(request: Request):
        """Latest progress for every known ops action, plus a pointer to the running one (if any).

        Admin-only, read-only, Vault-free. Shape:
            {
              "opsDir": bool,                      # is data/ops/ present (the watcher seam wired)
              "actions": { "<action>": {…} | null },
              "running": "<action>" | null,        # the action currently in flight, if any
              "latest":  "<action>" | null,        # the most-recently-stamped action (running or not)
            }
        Every entry tolerates a missing or half-written file — a poll during the restart must not
        error; the timeline simply keeps its last known state until the file reappears."""
        require_admin(request)
        actions = {a: _read_status(a) for a in _OPS_ACTIONS}
        running = next((a for a, s in actions.items() if s and s.get("running")), None)
        # "latest" = the action with the newest ts (running ones win ties via the running pass above).
        latest = running
        if latest is None:
            stamped = [(s.get("ts", ""), a) for a, s in actions.items() if s]
            latest = max(stamped)[1] if stamped else None
        return {
            "opsDir": os.path.isdir(_ops_dir()),
            "actions": actions,
            "running": running,
            "latest": latest,
        }

    return router
