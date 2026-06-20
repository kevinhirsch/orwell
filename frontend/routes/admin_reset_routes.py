"""Admin Factory Reset (OOBE) — return the whole app to exact first-run state, KEEP API keys.

The operator's "clear everything and start clean" button. A single admin-gated endpoint
triggers the FIXED deploy reset (``orwell-oobe-reset.sh``) which stops both services, wipes
ALL accounts / chats / sessions / memory / MCP configs / uploads / every user setting and
every engine game sandbox, then restarts at OOBE — PRESERVING only the LLM / image provider
config (the keys an operator should never have to re-enter) and never touching ``data/.env``.

This mirrors ``admin_update_routes.py`` exactly (same privilege model, same flag trigger):

Boundaries / security:
  * Admin-gated by the shared ``require_admin`` contract (a non-admin gets 403), exactly like
    ``admin_update_routes`` / ``admin_health_routes``.
  * The command is FIXED — there is NO user input in the argv. The script PATH is overridable
    by ``ORWELL_OOBE_RESET_SCRIPT`` (default ``/opt/orwell/deploy/orwell-oobe-reset.sh``)
    purely so tests/dev never shell out to a real host path; the web tier never chooses WHAT
    runs, only WHEN.
  * Vault-free: pure operational plumbing — no game state is read or returned.
  * Destructive — the button on the status page demands an explicit type-"RESET" confirmation
    BEFORE it ever posts here; this endpoint additionally re-checks admin on the server.

Privilege model (identical to the update button — see ``admin_update_routes.py``):
  The FE runs inside the E85-hardened ``orwell-frontend.service`` and CANNOT stop services or
  remove ``/opt`` files on its own. Two supported ways, in priority order:

    1. The root-side flag trigger (G19b pattern): the FE drops
       ``data/ops/factory-reset-requested`` and the root ``orwell-ops-factory-reset.path``
       unit runs the reset. Zero privilege held by the web tier; survives the self-restart
       natively. Used automatically when that unit is installed (``data/ops/`` exists) unless
       ``ORWELL_OOBE_RESET_DIRECT=1`` forces the detached Popen path.
    2. A detached, fixed-argv ``Popen`` fallback (optionally ``sudo -n`` wrapped via
       ``ORWELL_OOBE_RESET_SUDO=1``) for dev / non-flag installs.
"""

import datetime as _dt
import logging
import os
import shlex
import subprocess
from datetime import timezone

from fastapi import APIRouter, Request

from core.middleware import require_admin
from src.auth_helpers import effective_user

logger = logging.getLogger(__name__)

# The FIXED reset path — overridable ONLY so tests/dev don't touch a real host path. There is
# never any user input interpolated into the command; this is the single, complete argv source.
DEFAULT_RESET_SCRIPT = "/opt/orwell/deploy/orwell-oobe-reset.sh"
DEFAULT_RESET_LOG = "/opt/orwell/data/ops-factory-reset.log"

# The existence-only flag the root path unit watches (see deploy/systemd/orwell-ops-factory-reset.*).
FLAG_NAME = "factory-reset-requested"


def _reset_script() -> str:
    return os.environ.get("ORWELL_OOBE_RESET_SCRIPT") or DEFAULT_RESET_SCRIPT


def _reset_log() -> str:
    return os.environ.get("ORWELL_OOBE_RESET_LOG") or DEFAULT_RESET_LOG


def _data_dir() -> str:
    return os.environ.get("DATA_DIR") or os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")


def _ops_dir() -> str:
    return os.path.join(_data_dir(), "ops")


def _flag_trigger_installed() -> bool:
    """True when the root-side path unit's flag dir exists — the privilege-safe door."""
    return os.path.isdir(_ops_dir())


def _trigger_via_flag() -> dict:
    """Drop the existence-only flag the root ``orwell-ops-factory-reset.path`` unit watches.
    The content is ignored by the unit; we stamp a timestamp for human log readability only."""
    ops = _ops_dir()
    flag = os.path.join(ops, FLAG_NAME)
    with open(flag, "w", encoding="utf-8") as fh:
        fh.write(_dt.datetime.now(timezone.utc).isoformat() + "\n")
    return {"started": True, "via": "flag-trigger", "log": "ops-factory-reset.log"}


def _run_detached() -> dict:
    """Launch the FIXED reset detached (its own session/process group) so restarting
    ``orwell-frontend`` mid-run does not kill it, streaming output to the reset log. Returns
    immediately — the caller never awaits completion (the restart would kill the request)."""
    script = _reset_script()
    log_path = _reset_log()
    # No user input in argv. The reset runs NON-INTERACTIVELY (--yes): the type-"RESET"
    # confirmation already happened in the browser. Optionally sudo-wrap for non-root dev.
    argv = ["bash", script, "--yes"]
    if os.environ.get("ORWELL_OOBE_RESET_SUDO", "").lower() in ("1", "true", "yes"):
        argv = ["sudo", "-n", *argv]
    try:
        os.makedirs(os.path.dirname(log_path) or ".", exist_ok=True)
    except OSError:
        pass
    log = open(log_path, "ab")
    log.write(
        (f"\n== orwell OOBE reset · {_dt.datetime.now(timezone.utc).isoformat()} "
         f"({' '.join(shlex.quote(a) for a in argv)}) ==\n").encode("utf-8"))
    log.flush()
    subprocess.Popen(  # noqa: S603 — fixed argv, no shell, no user input
        argv, cwd=os.path.dirname(script) or None,
        stdout=log, stderr=log, stdin=subprocess.DEVNULL,
        start_new_session=True, close_fds=True)
    log.close()
    return {"started": True, "via": "detached", "log": os.path.basename(log_path)}


def setup_admin_reset_routes() -> APIRouter:
    router = APIRouter(prefix="/api/admin", tags=["admin_reset"])

    @router.post("/factory-reset")
    async def admin_factory_reset(request: Request):
        """Run the OOBE reset (wipe everything to first-run, KEEP the API-key/LLM config).

        Admin-only. Returns ``{started: true}`` IMMEDIATELY — never blocks on completion (the
        reset restarts this process). Prefers the privilege-safe root flag trigger when
        installed; otherwise launches the fixed script detached (optionally sudo-wrapped).

        Destructive: the status-page button requires a type-"RESET" confirmation before it
        posts here. This endpoint re-checks admin server-side regardless of the UI."""
        require_admin(request)
        who = None
        try:
            who = effective_user(request)
        except Exception:
            pass
        force_direct = os.environ.get("ORWELL_OOBE_RESET_DIRECT", "").lower() in ("1", "true", "yes")
        if _flag_trigger_installed() and not force_direct:
            logger.info("[factory-reset] admin '%s' triggered OOBE reset via the root flag trigger", who)
            try:
                return _trigger_via_flag()
            except OSError as e:
                logger.warning("[factory-reset] flag trigger failed (%s); falling back to detached run", e)
        logger.info("[factory-reset] admin '%s' triggered OOBE reset via detached run of %s",
                    who, _reset_script())
        return _run_detached()

    return router
