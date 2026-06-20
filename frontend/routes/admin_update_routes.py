"""Admin one-click Update — pull latest → rebuild engine → refresh FE deps → restart both.

The operator's deploy-merged-fixes button. A single admin-gated endpoint runs the FIXED
deploy updater (``orwell-update.sh``) DETACHED and returns immediately — the script restarts
``orwell-frontend`` (this very process) and ``orwell-engine`` mid-flight, so the request would
be killed if it blocked. The button on the admin status page (``/admin/status`` OPS section)
posts here, then polls ``/api/admin/health`` and reloads once the box is back.

Boundaries / security:
  * Admin-gated by the shared ``require_admin`` contract (a non-admin gets 403), exactly like
    ``admin_health_routes`` / ``admin_transcript_routes``.
  * The command is FIXED — there is no user input in the argv. The script PATH is overridable
    by ``ORWELL_UPDATE_SCRIPT`` (default ``/opt/orwell/deploy/orwell-update.sh``) purely so
    tests/dev never shell out to a real host path; the web tier never chooses WHAT runs.
  * Vault-free: this is pure operational plumbing — no game state is read or returned.

Privilege model (see the PR notes + ``deploy/sudoers/orwell-update``):
  The FE runs inside the E85-hardened ``orwell-frontend.service`` (``User=orwell``,
  ``NoNewPrivileges=yes``, empty ``CapabilityBoundingSet=``, ``ProtectSystem=strict``). That
  user CANNOT ``git pull`` into ``/opt/orwell``, write ``/etc/systemd``, or ``systemctl
  restart`` on its own — so a bare ``bash orwell-update.sh`` would EPERM partway through. Two
  supported ways to grant exactly the needed privilege, in priority order:

    1. The root-side flag trigger (G19b): the FE drops ``data/ops/update-requested`` and the
       root ``orwell-ops-update.path`` unit runs the script. Zero privilege held by the web
       tier; survives the self-restart natively. Used automatically when that unit is
       installed (``data/ops/`` exists) unless ``ORWELL_UPDATE_DIRECT=1`` forces the Popen path.
    2. A tightly-scoped sudoers drop-in (``deploy/sudoers/orwell-update``) granting the
       ``orwell`` user NOPASSWD for EXACTLY ``orwell-update.sh`` and nothing else; the detached
       run is then ``sudo -n bash <script>``. Enabled by ``ORWELL_UPDATE_SUDO=1``.

  Either way the button never silently 403s on ``systemctl``: it prefers the flag trigger when
  present, falls back to the (optionally sudo-wrapped) detached Popen otherwise.
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

# The FIXED updater path — overridable ONLY so tests/dev don't touch a real host path. There is
# never any user input interpolated into the command; this is the single, complete argv source.
DEFAULT_UPDATE_SCRIPT = "/opt/orwell/deploy/orwell-update.sh"
DEFAULT_UPDATE_LOG = "/opt/orwell/data/update.log"


def _update_script() -> str:
    return os.environ.get("ORWELL_UPDATE_SCRIPT") or DEFAULT_UPDATE_SCRIPT


def _update_log() -> str:
    return os.environ.get("ORWELL_UPDATE_LOG") or DEFAULT_UPDATE_LOG


def _data_dir() -> str:
    return os.environ.get("DATA_DIR") or os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")


def _ops_dir() -> str:
    return os.path.join(_data_dir(), "ops")


def _flag_trigger_installed() -> bool:
    """True when the root-side G19b path unit's flag dir exists — the privilege-safe door."""
    return os.path.isdir(_ops_dir())


def _trigger_via_flag() -> dict:
    """Drop the existence-only flag the root ``orwell-ops-update.path`` unit watches (G19b).
    The content is ignored by the unit; we stamp a timestamp for human log readability only."""
    ops = _ops_dir()
    flag = os.path.join(ops, "update-requested")
    with open(flag, "w", encoding="utf-8") as fh:
        fh.write(_dt.datetime.now(timezone.utc).isoformat() + "\n")
    return {"started": True, "via": "flag-trigger", "log": "ops-update.log"}


def _run_detached() -> dict:
    """Launch the FIXED updater detached (its own session/process group) so restarting
    ``orwell-frontend`` mid-run does not kill it, streaming output to the update log. Returns
    immediately — the caller never awaits completion (the restart would kill the request)."""
    script = _update_script()
    log_path = _update_log()
    # No user input in argv. Optionally wrap in `sudo -n` so the sandboxed FE user can clear the
    # privileged steps via the tightly-scoped sudoers drop-in (deploy/sudoers/orwell-update).
    argv = ["bash", script]
    if os.environ.get("ORWELL_UPDATE_SUDO", "").lower() in ("1", "true", "yes"):
        argv = ["sudo", "-n", *argv]
    try:
        os.makedirs(os.path.dirname(log_path) or ".", exist_ok=True)
    except OSError:
        pass
    # Append (never truncate) so the run history survives across updates; the status-page log
    # viewer can tail it. "ab" + a timestamped header per run keeps runs separable.
    log = open(log_path, "ab")
    log.write(
        (f"\n== orwell update · {_dt.datetime.now(timezone.utc).isoformat()} "
         f"({' '.join(shlex.quote(a) for a in argv)}) ==\n").encode("utf-8"))
    log.flush()
    # start_new_session=True detaches into a new session+process-group: when the script
    # `systemctl restart orwell-frontend` kills THIS process, the updater is not in our group
    # and keeps running (it is reparented to init). Fire-and-forget: we do not wait().
    subprocess.Popen(  # noqa: S603 — fixed argv, no shell, no user input
        argv, cwd=os.path.dirname(script) or None,
        stdout=log, stderr=log, stdin=subprocess.DEVNULL,
        start_new_session=True, close_fds=True)
    # The child holds its own dup'd fd; close our handle so we don't leak it across the restart.
    log.close()
    return {"started": True, "via": "detached", "log": os.path.basename(log_path)}


def setup_admin_update_routes() -> APIRouter:
    router = APIRouter(prefix="/api/admin", tags=["admin_update"])

    @router.post("/update")
    async def admin_update(request: Request):
        """Run the deploy updater (pull → rebuild engine → refresh FE deps → restart both).

        Admin-only. Returns ``{started: true}`` IMMEDIATELY — never blocks on completion (the
        update restarts this process). Prefers the privilege-safe root flag trigger when
        installed; otherwise launches the fixed script detached (optionally sudo-wrapped)."""
        require_admin(request)
        who = None
        try:
            who = effective_user(request)
        except Exception:
            pass
        force_direct = os.environ.get("ORWELL_UPDATE_DIRECT", "").lower() in ("1", "true", "yes")
        if _flag_trigger_installed() and not force_direct:
            logger.info("[update] admin '%s' triggered update via the root flag trigger (G19b)", who)
            try:
                return _trigger_via_flag()
            except OSError as e:
                logger.warning("[update] flag trigger failed (%s); falling back to detached run", e)
        logger.info("[update] admin '%s' triggered update via detached run of %s",
                    who, _update_script())
        return _run_detached()

    return router
