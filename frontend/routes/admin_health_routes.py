"""Lane G1 — admin Health & Logs (UI-backed health checking + debug bundle).

The user commission: "robust health checking and logging, visible in the admin side
of settings" plus a one-click mechanism to gather debug data (the image pipeline's
silent placeholder failures were the trigger). Two read-only, admin-gated routes
(the same ``require_admin`` contract as ``admin_transcript_routes.py``):

  GET /api/admin/health        — one aggregated snapshot: the engine's /health
                                 (uptime, call counters, the G1 recent-failure ring,
                                 embeddings provider + degrade flag) measured with
                                 round-trip latency, the FE store stats (incl. a
                                 DEGRADED-boot flag when the DB failed to init), the
                                 FE's own view of the engine (lastError), whether the
                                 two tiers AGREE, and the image-generation provider
                                 state. NEVER hard-fails (P1) — it renders what it can.
  GET /api/admin/debug-bundle  — the same snapshot as a downloadable JSON file, BEEFED
                                 UP (owner: "let's beef up that file") with: FE + engine
                                 versions/build, recent app logs + recent errors, the
                                 ops-status files, engine /health + reachability, the
                                 REDACTED settings/provider config, a Vault-free game/
                                 session-state summary (counts/phase/week only), system
                                 info (python/node/disk/memory), feature flags, and
                                 recent chat-session METADATA (never transcripts).

Boundaries:
  * Vault-free by construction — everything here is operational metadata (the engine's
    /health carries tool names + sanitized error classes + timings only; G1 engine side).
    The game-state summary is reduced to scalar counts/phase — no roster, no Vault/soul.
  * READ-ONLY — no mutating verb exists on this surface (the ops POST triggers excepted).
  * Secrets never cross: the bundle redacts by key pattern BEFORE serialization, AND
    every value that crosses is a name/model/url/count — never an api key, token, or .env.
  * P1 resilience: the status page + its health endpoints never refuse to connect or 500;
    a broken DB, a down engine, or partial state degrade into a diagnostic, not a wall.
"""

import inspect
import logging
import os
import platform
import re
import shutil
import sys
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Request, Response

from core.middleware import require_admin
from src import orwell_engine
from src.auth_helpers import effective_user

logger = logging.getLogger(__name__)

from src import log_rings  # the G1b live rings (FE log + Engine I/O tap)


def _data_dir() -> str:
    """The FRONT-END app-data dir (frontend/data): the FE's own logs (portrait-log.jsonl, the
    G19a script-run logs) live here. DATA_DIR overrides (tests/dev)."""
    return os.environ.get("DATA_DIR") or os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")


def _ops_data_dir() -> str:
    """The DEPLOY data dir (e.g. /opt/orwell/data): where the root-side systemd ops path units
    watch data/ops/<flag>, where the installer creates data/ops, and where the ops-*.log run logs
    live. This is a DIFFERENT tree from _data_dir()/frontend/data — one level higher (APP_DIR).
    The maintenance buttons (Update / Factory Reset / Update+Reset) hand off through this tree;
    pointing them at frontend/data was the bug (the FE dropped flags no root watcher ever saw).
    DATA_DIR overrides (tests/dev) so it collapses onto _data_dir() under a single test root."""
    return os.environ.get("DATA_DIR") or os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data")


def _log_dirs() -> list:
    """The trees the admin log viewer tails: the FE app-data dir (its own logs) AND the deploy
    data dir (the root-side ops-*.log the maintenance buttons stream). De-duplicated, FE-dir first
    (so an FE log wins a same-name collision). Under a test DATA_DIR the two collapse to one."""
    out = []
    for d in (_data_dir(), _ops_data_dir()):
        if d and d not in out:
            out.append(d)
    return out


def _log_files() -> list:
    """On-disk log basenames across the viewer's data dirs (allowlist for the file tail)."""
    out: list = []
    seen: set = set()
    for d in _log_dirs():
        try:
            for n in sorted(os.listdir(d)):
                if n in seen:
                    continue
                if n.endswith((".log", ".jsonl")) and os.path.isfile(os.path.join(d, n)):
                    out.append(n)
                    seen.add(n)
        except OSError:
            pass
    return out


def _log_path(name: str) -> str:
    """Resolve an (already allowlisted) log basename to the first data dir that holds it; falls
    back to the FE data dir so a brand-new file still has a stable home. No traversal — callers
    pass only names from _log_files()."""
    for d in _log_dirs():
        p = os.path.join(d, name)
        if os.path.isfile(p):
            return p
    return os.path.join(_data_dir(), name)

# Env keys worth bundling (the deploy-relevant knobs). Values matching _SECRET_RE are redacted.
_ENV_PREFIXES = ("ORWELL_", "BBAI_", "AUTH_")
_SECRET_RE = re.compile(r"token|secret|key|password|passwd|credential|pat\b", re.IGNORECASE)
REDACTED = "***REDACTED***"


def _redact_config(env: dict) -> dict:
    """Every secret-shaped key is replaced with a marker — values never cross."""
    out = {}
    for k in sorted(env):
        if not (k.startswith(_ENV_PREFIXES) or k == "DATABASE_URL"):
            continue
        val = env[k]
        if _SECRET_RE.search(k):
            val = REDACTED
        elif isinstance(val, str):
            # URL-embedded credentials (e.g. postgres://user:pass@host) never cross either.
            val = re.sub(r"//[^/@\s]+:[^/@\s]+@", f"//{REDACTED}@", val)
        out[k] = val
    return out


async def _engine_raw_health() -> tuple[dict | None, int | None]:
    """The engine's own /health body (G1: uptime + counters + failure ring + embeddings)
    plus the measured round-trip latency in ms. (None, None) when unreachable."""
    try:
        client = orwell_engine._shared_client()
        started = time.monotonic()
        r = await client.get(orwell_engine.ENGINE_URL.rstrip("/") + "/health", timeout=5.0)
        latency_ms = int((time.monotonic() - started) * 1000)
        if r.status_code == 200:
            body = r.json()
            return (body if isinstance(body, dict) else None), latency_ms
        return None, latency_ms
    except Exception:
        return None, None


def _store_stats() -> dict:
    """Light FE-store counts (sessions/messages + db size) — best-effort, never raises.

    P1: surfaces the DEGRADED-boot flag when init_db() failed (the operator's signal that
    the store is broken and the app is serving in recovery mode), so the status page can
    say so and the recovery buttons remain the obvious next action."""
    stats: dict = {}
    # The degraded-boot diagnostic comes first — it explains WHY the counts below may be
    # missing (a broken/inaccessible DB the app booted past on purpose, P1).
    try:
        from core.database import db_init_error
        err = db_init_error()
        if err:
            stats["degraded"] = True
            stats["initError"] = err.get("error")
    except Exception:
        pass
    try:
        from core.database import SessionLocal, Session as DbSession, ChatMessage as DbChatMessage
        db = SessionLocal()
        try:
            stats["sessions"] = db.query(DbSession).count()
            stats["messages"] = db.query(DbChatMessage).count()
        finally:
            db.close()
    except Exception as e:
        stats["error"] = f"{type(e).__name__}: {e}"
    try:
        from core.database import get_detailed_stats
        stats["database_size_mb"] = get_detailed_stats().get("database_size_mb")
    except Exception:
        pass
    return stats


async def _image_state(user: str | None) -> dict:
    """The image-generation provider state (0051): enabled? model? usable right now?
    Plus (G20) `portraits: {total, present, missing}` — completeness over the ACTIVE
    cast via the shared roster derivation, or None pre-game / engine down. Best-effort —
    a broken resolver reads as available:false, never a 500."""
    state: dict = {"enabled": False, "model": "", "quality": "", "available": False,
                   "portraits": None}
    try:
        from src import orwell_portraits
        enabled, model_spec, quality = orwell_portraits._image_settings(user)
        state.update({"enabled": bool(enabled), "model": model_spec or "", "quality": quality or ""})
        state["available"] = bool(orwell_portraits.image_generation_available(user))
    except Exception as e:
        state["error"] = f"{type(e).__name__}: {e}"
    try:
        from src import orwell_portraits
        state["portraits"] = await orwell_portraits.portrait_completeness(user)
    except Exception:
        state["portraits"] = None
    return state


# ── Debug-bundle enrichment (owner: "let's beef up that file") ────────────────
# Every helper below is best-effort and Vault-free by construction: it returns ONLY
# operational metadata (versions, counts, names, models, urls, phases, sizes) and
# NEVER an api key, token, .env value, transcript body, roster, or any Vault/soul
# state. A failure reads as an {"error": "..."} string, never a 500 — the bundle is
# the operator's last resort, so it must always assemble.

def _versions() -> dict:
    """FE + engine build/version strings (no secrets) for one-glance triage."""
    out: dict = {}
    try:
        from src.orwell_version import get_display_version, get_build
        out["frontend"] = get_display_version()
        out["build"] = get_build()
    except Exception as e:
        out["frontend"] = f"error: {type(e).__name__}"
    try:
        from core.constants import APP_VERSION
        out["frontendApp"] = APP_VERSION
    except Exception:
        pass
    return out


def _recent_logs(limit: int = 200) -> dict:
    """The tail of the live FE log ring + a recent-ERRORs slice, so a pasted bundle
    carries the in-process log without the operator hunting for files. The ring already
    redacts nothing sensitive (it is the app's own log lines), but we still cap the size."""
    out: dict = {"frontendTail": [], "recentErrors": []}
    try:
        _, lines = log_rings.LIVE.since(0)
        tail = lines[-limit:]
        out["frontendTail"] = [
            {"ts": l.get("ts"), "level": l.get("level"), "logger": l.get("logger"),
             "msg": (l.get("msg") or "")[:1000]}
            for l in tail
        ]
        out["recentErrors"] = [
            e for e in out["frontendTail"]
            if str(e.get("level") or "").upper() in ("ERROR", "CRITICAL", "WARNING")
        ][-60:]
    except Exception as e:
        out["error"] = f"{type(e).__name__}: {e}"
    return out


def _ops_status_files() -> dict:
    """The ops-status files under the data dir: which log basenames exist, their sizes,
    and a short TAIL of each (the most recent maintenance/diagnostic output). These are the
    app's own ops logs — operational, not secret. Sizes are bounded; tails are clipped."""
    out: dict = {"updateTriggerInstalled": False, "logs": []}
    try:
        # The trigger seam lives in the DEPLOY data dir (where the root path units watch), not the
        # FE app-data dir — check there.
        out["updateTriggerInstalled"] = os.path.isdir(os.path.join(_ops_data_dir(), "ops"))
    except Exception:
        pass
    for name in _log_files():
        entry: dict = {"name": name}
        try:
            path = _log_path(name)
            entry["sizeBytes"] = os.path.getsize(path)
            with open(path, "rb") as fh:
                size = entry["sizeBytes"]
                fh.seek(max(0, size - 4096))
                chunk = fh.read(4096)
            entry["tail"] = chunk.decode("utf-8", "replace").splitlines()[-30:]
        except Exception as e:
            entry["error"] = f"{type(e).__name__}: {e}"
        out["logs"].append(entry)
    return out


def _provider_config() -> dict:
    """The configured LLM/image providers — REDACTED: names, models, and base-urls only,
    NEVER the api key. Pulled from the model_endpoints table (the key column is dropped here,
    not just redacted). Best-effort; an unreadable store reads as an error string."""
    out: dict = {"endpoints": []}
    try:
        from core.database import SessionLocal, ModelEndpoint
        db = SessionLocal()
        try:
            for ep in db.query(ModelEndpoint).all():
                # Whitelist of non-secret fields ONLY — api_key is never read.
                out["endpoints"].append({
                    "name": getattr(ep, "name", None),
                    "baseUrl": getattr(ep, "base_url", None),
                    "modelType": getattr(ep, "model_type", None),
                    "endpointKind": getattr(ep, "endpoint_kind", None),
                    "isEnabled": bool(getattr(ep, "is_enabled", False)),
                    "supportsTools": getattr(ep, "supports_tools", None),
                    "hasApiKey": bool(getattr(ep, "api_key", None)),  # presence only, never the value
                })
        finally:
            db.close()
    except Exception as e:
        out["error"] = f"{type(e).__name__}: {e}"
    return out


async def _game_state_summary(user: str | None) -> dict:
    """A Vault-free, SCALAR-ONLY game/session summary: started?, phase, week, whose-turn,
    cast/jury counts, the player's status/placement. Reduced from the engine's public
    ceremony projection (gameStatus / getGameState) — NO roster names, NO Vault/soul/secret
    state. Pre-game and engine-down both read as a clean status, never a 500."""
    out: dict = {"available": False}
    try:
        st = await orwell_engine.game_status(user=user)
        if isinstance(st, dict):
            if st.get("started") is False:
                return {"available": True, "started": False}
            out["available"] = True
            out["started"] = bool(st.get("started", True))
            for k in ("week", "phase", "day"):
                if k in st:
                    out[k] = st[k]
            # Whose-turn / pending decision SHAPE only — a key/kind, never content.
            pend = st.get("pending")
            if isinstance(pend, dict):
                out["pendingKind"] = pend.get("kind") or pend.get("type")
            elif pend is not None:
                out["pendingKind"] = str(pend)[:60]
    except Exception as e:
        out["error"] = f"{type(e).__name__}: {e}"
    # Counts come from getGameState (still Vault-free) but reduced to integers only.
    try:
        gs = await orwell_engine.get_game_state(user=user)
        if isinstance(gs, dict) and gs.get("started") is not False:
            roster = gs.get("houseguests") or gs.get("cast") or gs.get("roster")
            if isinstance(roster, list):
                out["castCount"] = len(roster)
                out["activeCount"] = sum(
                    1 for h in roster
                    if isinstance(h, dict) and (h.get("status") or "active") == "active"
                )
            jury = gs.get("jury")
            if isinstance(jury, list):
                out["juryCount"] = len(jury)
            player = gs.get("player")
            if isinstance(player, dict):
                out["playerStatus"] = player.get("status")
    except Exception:
        # The scalar summary above is enough; a counts failure is not worth surfacing twice.
        pass
    return out


def _system_info() -> dict:
    """Host/runtime info: python + node versions, platform, disk + memory headroom. All
    operational — no secrets. Memory comes from /proc/meminfo (Linux) when psutil is absent."""
    out: dict = {
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "pid": os.getpid(),
    }
    try:
        import subprocess
        node = subprocess.run(["node", "--version"], capture_output=True, text=True, timeout=3)
        out["node"] = (node.stdout or "").strip() or (node.stderr or "").strip()[:40]
    except Exception:
        out["node"] = None
    try:
        du = shutil.disk_usage(_data_dir())
        out["disk"] = {"totalMb": du.total // (1024 * 1024),
                       "freeMb": du.free // (1024 * 1024),
                       "usedPct": round(100 * du.used / du.total, 1) if du.total else None}
    except Exception:
        pass
    try:
        # Linux /proc/meminfo — kB. Avoids a hard psutil dependency.
        meminfo: dict = {}
        with open("/proc/meminfo", "r", encoding="utf-8") as fh:
            for line in fh:
                key, _, rest = line.partition(":")
                kb = rest.strip().split(" ")[0]
                if kb.isdigit() and key in ("MemTotal", "MemAvailable", "SwapTotal"):
                    meminfo[key] = int(kb)
        if meminfo:
            out["memory"] = {"totalMb": meminfo.get("MemTotal", 0) // 1024,
                             "availableMb": meminfo.get("MemAvailable", 0) // 1024,
                             "swapTotalMb": meminfo.get("SwapTotal", 0) // 1024}
    except Exception:
        pass
    return out


def _feature_flags() -> dict:
    """The build/feature posture: game-build on?, auth on?, embeddings provider, localhost
    bypass. Pure booleans/labels — never a secret value."""
    out: dict = {}
    try:
        from src.settings import game_build_enabled
        out["gameBuild"] = bool(game_build_enabled())
    except Exception:
        out["gameBuild"] = None
    out["authEnabled"] = os.getenv("AUTH_ENABLED", "true").lower() != "false"
    out["localhostBypass"] = os.getenv("LOCALHOST_BYPASS", "false").lower() == "true"
    out["embeddings"] = os.getenv("ORWELL_EMBEDDINGS") or "fake"
    out["multiuser"] = bool(os.getenv("ORWELL_ENGINE_MULTIUSER"))
    return out


def _session_metadata(limit: int = 25) -> dict:
    """Recent chat-session METADATA — id, name, owner, model, message count, timestamps —
    so a playtest report carries which sessions exist WITHOUT shipping a single transcript
    line. Strictly counts/labels: no message content ever leaves the box. Best-effort."""
    out: dict = {"recent": []}
    try:
        from core.database import SessionLocal, Session as DbSession
        db = SessionLocal()
        try:
            rows = (db.query(DbSession)
                      .order_by(DbSession.last_accessed.desc())
                      .limit(limit).all())
            for s in rows:
                out["recent"].append({
                    "id": getattr(s, "id", None),
                    "name": getattr(s, "name", None),  # a user-chosen title, not transcript content
                    "owner": getattr(s, "owner", None),
                    "model": getattr(s, "model", None),
                    "messageCount": getattr(s, "message_count", None),
                    "mode": getattr(s, "mode", None),
                    "createdAt": s.created_at.isoformat() if getattr(s, "created_at", None) else None,
                    "lastAccessed": s.last_accessed.isoformat() if getattr(s, "last_accessed", None) else None,
                })
        finally:
            db.close()
    except Exception as e:
        out["error"] = f"{type(e).__name__}: {e}"
    return out


def _token_economy(user: str | None) -> dict:
    """ADR 0010 / feature 0069 — the admin token-economy view for one user.

    Vault-free / body-free BY CONSTRUCTION: the ledger stores ONLY numbers, short ids,
    and one known call-class token (no message body, narration, prompt, or engine secret
    can land in it — enforced in orwell_token_ledger). This helper reads that store and
    derives a small summary; it never touches the Vault or any transcript.

    Returns the recent ledger entries, a per-session cost total + whether the soft alert
    (against the admin-set ``token_spend_alert_usd``) is tripped, and an aggregate summary
    (summed token counts by kind, total cost, latest context-percent). Best-effort — a
    missing/corrupt store reads as empty numbers, never a 500."""
    from src import orwell_token_ledger
    from src.settings import get_setting

    out: dict = {"user": user or "default"}
    try:
        threshold = float(get_setting("token_spend_alert_usd", 0.0) or 0.0)
    except (TypeError, ValueError):
        threshold = 0.0
    out["spendAlertThresholdUsd"] = threshold

    entries: list = []
    try:
        entries = orwell_token_ledger.get_recent(user, limit=200)
    except Exception as e:
        out["error"] = f"{type(e).__name__}: {e}"
        entries = []
    out["entries"] = entries

    # Per-session cost totals + per-session soft-alert state (strictly-over the threshold).
    sessions: dict = {}
    for e in entries:
        sid = e.get("session") or ""
        if sid and sid not in sessions:
            try:
                total = orwell_token_ledger.game_cost_total(user, sid)
            except Exception:
                total = 0.0
            try:
                alert = orwell_token_ledger.check_soft_alert(user, sid, threshold)
            except Exception:
                alert = False
            sessions[sid] = {"costTotal": total, "softAlert": bool(alert)}
    out["sessions"] = sessions
    out["softAlert"] = any(s.get("softAlert") for s in sessions.values())

    # Aggregate summary — summed token counts by kind, total cost, latest context-percent.
    summary = {
        "inputTokens": 0, "cachedTokens": 0, "reasoningTokens": 0, "outputTokens": 0,
        "totalCost": 0.0, "latestContextPercent": None, "turns": len(entries),
    }
    for e in entries:
        for k in ("inputTokens", "cachedTokens", "reasoningTokens", "outputTokens"):
            try:
                summary[k] += int(e.get(k) or 0)
            except (TypeError, ValueError):
                pass
        try:
            summary["totalCost"] += float(e.get("cost") or 0.0)
        except (TypeError, ValueError):
            pass
    if entries:
        summary["latestContextPercent"] = entries[-1].get("contextPercent")
    out["summary"] = summary
    return out


async def _bundle_extras(user: str | None) -> dict:
    """Assemble the BEEFED-UP sections of the debug bundle. Each is best-effort and
    Vault-free; the whole assembly is wrapped so the bundle always serializes."""
    extras: dict = {}
    extras["versions"] = _versions()
    extras["systemInfo"] = _system_info()
    extras["featureFlags"] = _feature_flags()
    extras["logs"] = _recent_logs()
    extras["opsStatus"] = _ops_status_files()
    extras["providerConfig"] = _provider_config()
    extras["sessions"] = _session_metadata()
    try:
        extras["gameState"] = await _game_state_summary(user)
    except Exception as e:
        extras["gameState"] = {"error": f"{type(e).__name__}: {e}"}
    return extras


async def _health_snapshot(user: str | None) -> dict:
    """The aggregated health view both routes share."""
    detail = await orwell_engine.engine_health_detail()  # FE's view: ok + error + lastError
    raw, latency_ms = await _engine_raw_health()         # engine's self-report (G1 ring etc.)

    engine: dict = {
        "ok": bool(detail.get("ok")),
        "engineUrl": detail.get("engineUrl"),
        "latencyMs": latency_ms,
    }
    if detail.get("error"):
        engine["error"] = detail["error"]
    if raw:
        engine["uptimeSeconds"] = raw.get("uptimeSeconds")
        engine["toolCalls"] = raw.get("toolCalls")
        engine["recentFailures"] = raw.get("recentFailures") or []
        engine["embeddings"] = raw.get("embeddings")

    fe_last = detail.get("lastError")  # the FE's recent view of engine trouble (recency-gated)
    frontend = {"lastError": fe_last, "store": _store_stats()}

    # Tiers AGREE when the engine self-reports healthy AND the FE's recent experience of it
    # concurs (no fresh transport failure on record). A disagreement is itself the signal —
    # e.g. the engine answers /health but every tool call times out at the FE tier.
    tiers_agree = bool(engine["ok"]) and raw is not None and not (
        isinstance(fe_last, dict) and fe_last.get("kind") == "unreachable"
    )

    # G20 made _image_state async (it awaits the engine's cast projection for the
    # portrait completeness counter). isawaitable-tolerant on purpose: existing tests
    # (and any future stub) may monkeypatch it with a plain sync callable.
    images = _image_state(user)
    if inspect.isawaitable(images):
        images = await images

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "engine": engine,
        "frontend": frontend,
        "tiersAgree": tiers_agree,
        "images": images,
        # Build + version (PR) for one-glance triage on the status page. version is the
        # PR-derived "vX.XX"; build is the deployed checkout's short commit SHA.
        "versions": _versions(),
    }


def setup_admin_health_routes() -> APIRouter:
    router = APIRouter(prefix="/api/admin", tags=["admin_health"])

    @router.get("/health")
    async def admin_health(request: Request):
        require_admin(request)
        user = None
        try:
            user = effective_user(request)
        except Exception:
            pass
        # P1: the status page polls this every 10s and depends on it NEVER hard-failing —
        # the recovery surface must stay reachable when the engine/DB is broken. The
        # snapshot helpers are already best-effort; this is the final belt-and-braces so
        # an unexpected error returns a 200 diagnostic, not a 500 that blanks the page.
        try:
            return await _health_snapshot(user)
        except Exception as e:
            logger.warning("admin health snapshot failed (degraded): %s", e)
            return {
                "generatedAt": datetime.now(timezone.utc).isoformat(),
                "engine": {"ok": False, "error": f"{type(e).__name__}: {e}"},
                "frontend": {"lastError": None, "store": {}},
                "tiersAgree": False,
                "images": {"available": False},
                "error": "health snapshot degraded — recovery actions remain available",
            }

    @router.get("/token-economy")
    async def admin_token_economy(request: Request, user: str | None = None):
        """ADR 0010 / feature 0069 — read-only token/cost view for a user (admin-gated).

        Query param ``user`` selects whose ledger to read (default: the current admin /
        "default"). Vault-free by construction — the ledger holds only numbers/ids; no
        message body, transcript, or engine secret can be returned. NOT exposed on any
        player route."""
        require_admin(request)
        target = user
        if not target:
            try:
                target = effective_user(request)
            except Exception:
                target = None
        return _token_economy(target)

    @router.get("/logs/sources")
    async def admin_log_sources(request: Request):
        """G1b: every selectable log stream — the two live rings + on-disk logs."""
        require_admin(request)
        sources = [
            {"id": "live", "label": "Front-end (live)"},
            {"id": "io", "label": "Engine I/O (live) — every tool call in/out"},
            {"id": "llmio", "label": "LLM I/O (live) — full prompt + response + reasoning"},
        ]
        for name in _log_files():
            sources.append({"id": f"file:{name}", "label": f"{name} (file)"})
        return {"sources": sources}

    @router.get("/logs")
    async def admin_logs(request: Request, source: str = "live", since: int = 0):
        """G1b: tail one source. Live rings use a seq cursor; files a byte offset."""
        require_admin(request)
        if source == "live":
            nxt, lines = log_rings.LIVE.since(since)
            return {"source": source, "next": nxt, "lines": lines}
        if source == "io":
            nxt, lines = log_rings.IO.since(since)
            return {"source": source, "next": nxt, "lines": lines}
        if source == "llmio":
            nxt, lines = log_rings.LLMIO.since(since)
            return {"source": source, "next": nxt, "lines": lines}
        if source.startswith("file:"):
            name = source[5:]
            if name not in _log_files():  # strict allowlist — no traversal, ever
                return Response(status_code=404)
            path = _log_path(name)         # FE app-data dir OR the deploy ops-*.log tree
            try:
                size = os.path.getsize(path)
                start = max(int(since), max(0, size - 65536) if since == 0 else 0)
                with open(path, "rb") as f:
                    f.seek(start)
                    chunk = f.read(min(65536, max(0, size - start)))
                text = chunk.decode("utf-8", "replace")
                lines = [{"seq": start + i, "ts": None, "level": "", "logger": name, "msg": l}
                         for i, l in enumerate(text.splitlines())]
                return {"source": source, "next": size, "lines": lines[-500:]}
            except OSError:
                return Response(status_code=404)
        return Response(status_code=400)

    @router.get("/logs/retention")
    async def admin_logs_retention(request: Request):
        """The LLM I/O trace toggle + log-retention horizon + the live total-size
        readout (the universal logging setting on the status page). Best-effort."""
        require_admin(request)
        from src import llm_trace
        from src.settings import get_setting
        total = llm_trace.total_log_bytes()
        return {
            "traceEnabled": bool(get_setting("llm_trace_enabled", True)),
            "retentionDays": llm_trace.retention_days(),
            "choices": llm_trace.RETENTION_CHOICES,
            "totalBytes": total,
            "totalHuman": llm_trace.human_bytes(total),
            "files": llm_trace.log_inventory(),
        }

    @router.post("/logs/retention")
    async def admin_logs_retention_set(request: Request):
        """Persist the trace toggle and/or retention horizon. Lowering the horizon
        trims immediately so the freed space shows up at once."""
        require_admin(request)
        from src import llm_trace
        from src.settings import load_settings, save_settings
        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}
        settings = load_settings()
        changed = False
        if "traceEnabled" in body:
            settings["llm_trace_enabled"] = bool(body["traceEnabled"])
            changed = True
        if "retentionDays" in body:
            try:
                d = int(body["retentionDays"])
                if d >= 0:
                    settings["log_retention_days"] = d
                    changed = True
            except (TypeError, ValueError):
                pass
        if changed:
            save_settings(settings)
        # Apply the (possibly new) horizon now so the size readout reflects it.
        result = llm_trace.trim_logs(None)
        return {
            "traceEnabled": bool(settings.get("llm_trace_enabled", True)),
            "retentionDays": llm_trace.retention_days(),
            "totalBytes": result["totalBytes"],
            "totalHuman": result["totalHuman"],
            "files": result["files"],
        }

    @router.post("/logs/trim")
    async def admin_logs_trim(request: Request):
        """Trim every managed logfile to the selected horizon NOW (the "Trim now"
        button). Body may carry {"days": N} to override the configured horizon for
        this run; absent ⇒ the configured retention."""
        require_admin(request)
        from src import llm_trace
        try:
            body = await request.json()
        except Exception:
            body = {}
        days = None
        if isinstance(body, dict) and "days" in body:
            try:
                days = int(body["days"])
            except (TypeError, ValueError):
                days = None
        result = llm_trace.trim_logs(days)
        result["removedHuman"] = llm_trace.human_bytes(result["removedBytes"])
        return result

    @router.get("/ops")
    async def admin_ops(request: Request):
        """G19a: the runnable allowlist + whether the update trigger is installed."""
        require_admin(request)
        return {
            "scripts": [{"id": k, "label": v[0], "log": v[3]} for k, v in _OPS_SCRIPTS.items()],
            "updateTrigger": {"installed": os.path.isdir(os.path.join(_ops_data_dir(), "ops")),
                              "log": "ops-update.log"},
        }

    @router.post("/ops/run/{sid}")
    async def admin_ops_run(sid: str, request: Request):
        require_admin(request)
        if sid not in _OPS_SCRIPTS:   # fixed allowlist — the web tier picks an id, never a command
            return Response(status_code=404)
        return await _run_ops_script(sid)

    @router.post("/ops/trigger-update")
    async def admin_ops_update(request: Request):
        """G19a: write the flag the root-side path unit (G19b) watches. Content ignored."""
        require_admin(request)
        # The trigger flag must land in the DEPLOY data dir where the root-side path unit watches
        # (frontend/data is a different tree the watcher never sees — that was the silent-no-op bug).
        ops_dir = os.path.join(_ops_data_dir(), "ops")
        if not os.path.isdir(ops_dir):
            return {"triggered": False, "installed": False,
                    "note": "update trigger not installed — run the deploy updater once to enable"}
        import datetime as _dt
        flag = os.path.join(ops_dir, "update-requested")
        with open(flag, "w", encoding="utf-8") as fh:
            fh.write(_dt.datetime.now(timezone.utc).isoformat() + "\n")
        logger.info("[ops] admin triggered the updater (flag written)")
        return {"triggered": True, "installed": True, "log": "ops-update.log"}

    @router.post("/ops/regenerate-portraits")
    async def admin_portraits_regenerate(request: Request):
        """G25 debug lever (the status-page button): discard EVERY stored cast portrait for
        THIS admin's game and regenerate the full active set through the standard pipeline —
        so a prompt/model change can be seen on the current cast without a season restart.

        Refuse-before-discard: the engine, an active game, and a usable image model are all
        verified FIRST — a refusal discards nothing (placeholders forever would be worse than
        stale photos). The kick is force=True (an explicit act, like the cast-window lever)
        and generation follows in portrait-log.jsonl, which this page's viewer can tail."""
        require_admin(request)
        user = None
        try:
            user = effective_user(request)
        except Exception:
            pass
        from src import orwell_engine, orwell_portraits
        from routes.orwell_routes import _roster_cards
        try:
            state = await orwell_engine.get_game_state(user=user)
        except Exception as e:
            return {"regenerated": False, "reason": f"engine unreachable: {e}"}
        if not isinstance(state, dict) or state.get("started") is False:
            return {"regenerated": False, "reason": "no active game"}
        try:
            available = orwell_portraits.image_generation_available(user)
        except Exception:
            available = False
        if not available:
            return {"regenerated": False, "reason": "no usable image model configured"}
        cards = _roster_cards(state, user)
        # Discard the ACTIVE set only (same filter as missing_portrait_ids): the backfill
        # never regenerates departed houseguests, so their photos must survive.
        active_ids = [c.get("id") for c in cards
                      if isinstance(c, dict) and (c.get("status") or "active") == "active" and c.get("id")]
        discarded = orwell_portraits.discard_portraits(user, active_ids)
        missing = orwell_portraits.missing_portrait_ids(user, cards)
        kicked = orwell_portraits.kickoff_backfill(missing, user, force=True)
        logger.info("[ops] admin portrait regeneration: discarded=%d queued=%d kicked=%s",
                    discarded, len(missing), kicked)
        return {"regenerated": True, "discarded": discarded, "queued": len(missing),
                "kicked": bool(kicked), "log": "portrait-log.jsonl"}

    @router.post("/ops/advance-to-finale")
    async def admin_advance_to_finale(request: Request):
        """L38 debug lever (the status-page button, NEXT TO regenerate-portraits): fast-forward THIS
        admin's live season to a crowned winner so the post-season Vault retrospective (0048) unseals
        legitimately.

        The non-negotiable boundary (mandate #2 / 0016): God Mode reads NO Vault and reveals nothing
        hidden. This crosses the engine's ADMIN channel, which is Vault-free BY CONSTRUCTION — it only
        DRIVES the deterministic loop to the finished terminal state (auto-resolving the player's
        pendings with legal defaults). The engine returns ONLY a Vault-free summary (winner NAME, weeks
        played, the player's final placement); the retrospective still opens through its own gate. The
        season genuinely finishes — integrity is preserved (it is not a Vault bypass)."""
        require_admin(request)
        user = None
        try:
            user = effective_user(request)
        except Exception:
            pass
        from src import orwell_engine
        try:
            summary = await orwell_engine.advance_to_finale(user=user)
        except Exception as e:
            return {"finished": False, "reason": f"engine error: {e}"}
        if not isinstance(summary, dict):
            return {"finished": False, "reason": "engine returned no summary"}
        if summary.get("started") is False:
            return {"finished": False, "reason": "no active game"}
        logger.info("[ops] admin fast-forward to finale: finished=%s winner=%s weeks=%s placement=%s",
                    summary.get("finished"), summary.get("winnerName"),
                    summary.get("weeks"), summary.get("playerPlacement"))
        # Pass through only the Vault-free public summary fields (never anything else the engine adds).
        return {
            "finished": bool(summary.get("finished")),
            "winnerName": summary.get("winnerName"),
            "weeks": summary.get("weeks"),
            "playerPlacement": summary.get("playerPlacement"),
        }

    @router.post("/ops/producer-vault")
    async def admin_producer_vault(request: Request):
        """DEBUG — the owner-ruled OVERRIDE of mandate #2 (the status-page "Producer's Vault" unseal).

        UNSEALS THIS admin's LIVE hidden Vault layer for operator debugging. UNLIKE every other admin
        route, this one DELIBERATELY returns Vault content — it is the one sanctioned LIVE reveal,
        crossing the engine's out-of-band ``producerVault`` admin capability. It is gated three ways:
        ``require_admin`` here, the engine's separate admin token, and the explicit FE "unseal" the
        button demands. It NEVER touches a live game's integrity — it only READS the hidden layer."""
        require_admin(request)
        user = None
        try:
            user = effective_user(request)
        except Exception:
            pass
        from src import orwell_engine
        try:
            dump = await orwell_engine.producer_vault(user=user)
        except Exception as e:
            return {"ok": False, "reason": f"engine error: {e}"}
        if not isinstance(dump, dict):
            return {"ok": False, "reason": "no active game to unseal"}
        logger.info("[ops] admin UNSEALED the producer's vault (debug override of mandate #2)")
        # Pass the unsealed view straight through — this is the deliberate, sanctioned Vault reveal.
        return {"ok": True, "vault": dump}

    @router.get("/debug-bundle")
    async def debug_bundle(request: Request):
        require_admin(request)
        user = None
        try:
            user = effective_user(request)
        except Exception:
            pass
        # P1: the bundle is the operator's last-resort diagnostic, so it must ALWAYS
        # assemble — never 500. Each section is best-effort; the snapshot/extras calls
        # are guarded so a single broken probe degrades to an error string, not a wall.
        try:
            snapshot = await _health_snapshot(user)
        except Exception as e:
            snapshot = {"generatedAt": datetime.now(timezone.utc).isoformat(),
                        "error": f"health snapshot failed: {type(e).__name__}: {e}"}
        try:
            extras = await _bundle_extras(user)
        except Exception as e:
            extras = {"error": f"bundle extras failed: {type(e).__name__}: {e}"}
        bundle = {
            "bundle": "orwell-debug",
            "schema": 2,  # bumped: the beefed-up bundle (versions/logs/ops/system/sessions/gameState)
            "generatedAt": snapshot.get("generatedAt") or datetime.now(timezone.utc).isoformat(),
            "health": snapshot,
            # The engine's recent-failure ring, hoisted for one-glance triage
            # (tool name + sanitized error class + timing only — G1 engine side).
            "recentFailures": (snapshot.get("engine") or {}).get("recentFailures", []),
            "config": _redact_config(dict(os.environ)),
            # ── BEEFED-UP sections (owner) — all Vault-free + secret-free by construction ──
            "versions": extras.get("versions"),
            "systemInfo": extras.get("systemInfo"),
            "featureFlags": extras.get("featureFlags"),
            "logs": extras.get("logs"),
            "opsStatus": extras.get("opsStatus"),
            "providerConfig": extras.get("providerConfig"),
            "gameState": extras.get("gameState"),
            "sessions": extras.get("sessions"),
        }
        import json as _json
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        return Response(
            content=_json.dumps(bundle, indent=2, ensure_ascii=False, default=str),
            media_type="application/json",
            headers={
                "Content-Disposition": f'attachment; filename="orwell-debug-bundle-{stamp}.json"',
                "Cache-Control": "no-store",
            },
        )

    return router


# ── G1b: the standalone status page ─────────────────────────────────────────
# "Can we offload the health and logs to a different status page" — yes, and an
# ops status page must be SELF-CONTAINED: zero dependency on the main app shell
# or its JS bundle, so it still renders when the front-end proper is broken.
# One inline document polling /api/admin/health every 10s. Admin-gated like
# everything else on this surface; the Settings card keeps a live summary and
# links here.
_STATUS_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Orwell — status</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 24px; background: #15171c; color: #cfd8e3;
         font: 14px/1.5 ui-monospace, 'Fira Code', monospace; }
  h1 { font-size: 16px; letter-spacing: .04em; margin: 0 0 4px; }
  .sub { opacity: .55; font-size: 12px; margin-bottom: 18px; }
  .grid { display: grid; grid-template-columns: max-content 1fr; gap: 6px 18px;
          max-width: 760px; margin-bottom: 22px; }
  .k { opacity: .65; }
  .ok { color: #3cb46e; } .bad { color: #e55; } .warn { color: #e0a500; }
  table { border-collapse: collapse; width: 100%; max-width: 980px; font-size: 13px; }
  th, td { text-align: left; padding: 4px 14px 4px 0; border-bottom: 1px solid #262a33; }
  th { opacity: .55; font-weight: 600; }
  td.num { text-align: right; padding-right: 0; }
  /* wrap so the maintenance-button row (and the log-source / retention rows) reflow on a phone
     instead of forcing the layout viewport wider than the screen — this page is the recovery
     surface an operator may open on mobile when the app shell is broken. */
  .actions { margin: 18px 0; display: flex; gap: 12px; flex-wrap: wrap; }
  /* the log-source <select> has long option text ("LLM I/O (live) — full prompt + …"); cap it to
     the row so a wide native control can't push the page past the viewport on a phone. */
  .actions select { max-width: 100%; }
  .btn { color: #9cdef2; border: 1px solid #355a66; border-radius: 8px;
         padding: 6px 12px; text-decoration: none; cursor: pointer;
         background: transparent; font: inherit; display: inline-block; }
  .btn:hover { background: rgba(255,255,255,.06); }
  #err { color: #e55; margin-top: 10px; }
</style></head>
<body>
<h1>ORWELL · STATUS</h1>
<div class="sub">Self-contained ops page — renders even when the app shell is broken. Polls every 10s. <span id="ts"></span></div>
<!-- P1: the DEGRADED-boot banner. Shown only when the FE booted past a broken/inaccessible
     data store (init_db failed) — the operator's cue that the recovery actions below are the
     next step. Hidden when the store is healthy. -->
<div id="degraded" style="display:none;margin:0 0 14px;border:1px solid #7a3b3b;border-radius:8px;padding:10px 12px;background:#231414;max-width:760px;color:#f0a6a6"></div>
<div class="grid" id="grid">Loading…</div>
<div class="actions">
  <a class="btn" href="/api/admin/debug-bundle" download>Download debug bundle</a>
  <button type="button" class="btn" id="refresh-now">Refresh now</button>
  <button type="button" class="btn" id="update-orwell" title="Pull latest, rebuild the engine, refresh front-end deps, and restart both services. The app briefly goes down (~30–60s) and reconnects automatically.">Update Orwell (pull + rebuild + restart)</button>
  <button type="button" class="btn" id="regen-portraits" title="Discard every stored cast portrait for your game and regenerate the full set (debug)">Regenerate cast portraits (debug)</button>
  <button type="button" class="btn" id="ff-finale" title="Drive your live season to a crowned winner so the post-season retrospective unseals (debug; reads no Vault)">Fast-forward to finale (debug)</button>
  <button type="button" class="btn" id="producer-vault" style="border-color:#7a3b3b;color:#f0a6a6" title="DEBUG — UNSEAL the LIVE hidden Vault: off-screen scheming, NPC confessionals, secret ties, the sealed twists, and the real eviction votes. SPOILERS — this deliberately reveals your in-progress game's secrets (owner override of mandate #2). Hidden until you unseal.">Producer's Vault — Unseal (debug · SPOILERS)</button>
  <!-- BEGIN update-reset-combo lane button (self-contained; endpoint + logic live in routes/admin_update_reset_routes.py) -->
  <button type="button" class="btn" id="update-reset" style="border-color:#7a3b3b;color:#f0a6a6" title="DESTRUCTIVE — pulls latest, rebuilds, THEN resets to first-run OOBE: wipes ALL accounts, chats, memory, MCP configs, uploads, and every game. Keeps your API keys / LLM config so you don't re-enter them. Requires typing RESET.">Update + Reset (OOBE, keep API keys)</button>
  <!-- END update-reset-combo lane button -->
  <!-- BEGIN factory-oobe-reset lane button (self-contained; endpoint + logic live in routes/admin_reset_routes.py) -->
  <button type="button" class="btn" id="factory-reset" style="border-color:#7a3b3b;color:#f0a6a6" title="DESTRUCTIVE — wipe ALL accounts, chats, memory, MCP configs, uploads, and every game; return to first-run OOBE. Keeps your API-key/LLM config so you don't re-enter it. Requires typing RESET.">Factory Reset (OOBE)</button>
  <!-- END factory-oobe-reset lane button -->
</div>
<!-- DEBUG · owner override of mandate #2: the Producer's Vault unseal panel. HIDDEN by default
     (display:none) — the live hidden layer appears here ONLY after an explicit "unseal" click +
     spoiler confirm. This is the one place the admin surface deliberately shows Vault content. -->
<div id="pv-panel" style="display:none;margin-top:14px;border:1px solid #7a3b3b;border-radius:8px;padding:12px;background:rgba(122,59,59,.08)">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
    <strong style="color:#f0a6a6">PRODUCER'S VAULT — live secrets (debug)</strong>
    <button type="button" class="btn" id="pv-reseal" title="Hide the unsealed secrets again">Re-seal / hide</button>
  </div>
  <div id="pv-body" style="font-size:13px;line-height:1.5;white-space:pre-wrap"></div>
</div>
<div id="update-msg" class="sub" style="margin:-6px 0 8px"></div>
<!-- BEGIN ops-progress lane: live step-by-step timeline for the running ops action (Update / -->
<!-- Factory Reset (OOBE) / Update+Reset). Hidden until an action is running or recently done; -->
<!-- the JS region below polls /api/admin/ops-status and survives the services restart. -->
<div id="ops-progress" style="display:none;margin:6px 0 14px;border:1px solid #2d3340;border-radius:8px;padding:10px 12px;background:#101218;max-width:760px">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
    <span id="ops-progress-spinner" style="display:inline-block;width:12px;height:12px;border:2px solid #355a66;border-top-color:#9cdef2;border-radius:50%;animation:opsspin 0.9s linear infinite"></span>
    <strong id="ops-progress-title" style="letter-spacing:.03em">Ops</strong>
    <span id="ops-progress-count" class="sub"></span>
  </div>
  <div id="ops-progress-bar-wrap" style="height:5px;background:#1b1f27;border-radius:3px;overflow:hidden;margin:6px 0 8px">
    <div id="ops-progress-bar" style="height:100%;width:0%;background:#3cb46e;transition:width .4s ease"></div>
  </div>
  <ol id="ops-progress-steps" style="list-style:none;margin:0;padding:0;font-size:12.5px;line-height:1.7"></ol>
  <div id="ops-progress-msg" class="sub" style="margin-top:6px"></div>
</div>
<style>@keyframes opsspin { to { transform: rotate(360deg); } }</style>
<!-- END ops-progress lane -->
<div id="failwrap"></div>
<h1 style="margin-top:26px">LIVE LOG</h1>
<div class="sub">Every log stream in the program, selectable. Auto-follows the tail while you are at the bottom; scrolling up pauses the follow — scroll back down to resume.</div>
<div class="actions" style="margin:8px 0">
  <select id="logsrc" style="background:#1b1f27;color:#cfd8e3;border:1px solid #355a66;border-radius:8px;padding:5px 8px;font:inherit"></select>
  <span id="follow" class="sub"></span>
</div>
<div id="logpane" style="height:380px;overflow:auto;border:1px solid #262a33;border-radius:8px;padding:8px 10px;background:#101218;white-space:pre-wrap;word-break:break-word;font-size:12.5px;line-height:1.45"></div>
<h1 style="margin-top:26px">OPS</h1>
<div class="sub">Run a maintenance script and watch it in the viewer above. Read-only scripts run in-process; the update goes through the root-side trigger (G19b) so the hardened web tier never holds privilege — the viewer follows <code>ops-update.log</code> live, across the restart. The destructive Factory Reset (OOBE) lives in the controls at the top and likewise goes through its own root-side trigger.</div>
<div class="actions" id="opsrow">Loading ops…</div>
<div id="opsmsg" class="sub"></div>
<h1 style="margin-top:26px">LOG RETENTION</h1>
<div class="sub">Full LLM I/O — system prompt + every message + the response, reasoning, tool calls and token usage — is captured to the <strong>LLM I/O (live)</strong> stream above and archived to <code>llm-io.jsonl</code> (also selectable above). Trim every logfile to a horizon to save disk — applied automatically and on demand. Secrets (auth headers / API keys) are never captured.</div>
<div class="grid" id="retgrid" style="margin:10px 0">Loading…</div>
<div class="actions" style="margin:8px 0;align-items:center;flex-wrap:wrap">
  <label class="sub" style="display:flex;align-items:center;gap:6px;cursor:pointer">
    <input type="checkbox" id="trace-toggle"> capture full LLM I/O trace
  </label>
  <label class="sub" style="display:flex;align-items:center;gap:6px">trim logs older than
    <select id="ret-days" style="background:#1b1f27;color:#cfd8e3;border:1px solid #355a66;border-radius:8px;padding:5px 8px;font:inherit"></select>
  </label>
  <button type="button" class="btn" id="trim-now" title="Trim every managed logfile to the selected horizon right now">Trim now</button>
  <span id="retmsg" class="sub"></span>
</div>
<div id="err"></div>
<script nonce="{{CSP_NONCE}}">
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const up = s => { s = Math.max(0, +s || 0); const d = (s/86400)|0, h = ((s%86400)/3600)|0, m = ((s%3600)/60)|0;
  return d ? d+"d "+h+"h" : h ? h+"h "+m+"m" : m ? m+"m" : (s|0)+"s"; };
const B = (ok, t) => '<span class="' + (ok ? "ok" : "bad") + '">' + esc(t) + "</span>";
function render(d) {
  const eng = d.engine || {}, emb = eng.embeddings || null, img = d.images || {},
        st = (d.frontend || {}).store || {}, tc = eng.toolCalls || {};
  const rows = [
    ["Engine", B(!!eng.ok, eng.ok ? "REACHABLE" : "DOWN") + (eng.latencyMs != null ? " · " + esc(eng.latencyMs) + " ms" : "") + (eng.uptimeSeconds != null ? " · up " + esc(up(eng.uptimeSeconds)) : "") + (eng.error ? " · " + esc(eng.error) : "")],
    ["Tiers agree", B(!!d.tiersAgree, d.tiersAgree ? "YES" : "NO")],
    ["Embeddings", emb ? esc(emb.provider || "?") + " " + B(!emb.degraded, emb.degraded ? "DEGRADED" : "OK") : B(false, "UNKNOWN")],
    ["Image generation", (img.available ? B(true, "AVAILABLE") : B(false, img.enabled ? "NO USABLE MODEL" : "DISABLED")) + (img.model ? " · " + esc(img.model) : "") + (img.portraits && img.portraits.total ? " · portraits " + (img.portraits.missing ? '<span class="warn">' : '<span class="ok">') + esc(img.portraits.present) + "/" + esc(img.portraits.total) + "</span>" : "")],
    ["Tool calls", esc(tc.total ?? 0) + " total · " + esc(tc.failed ?? 0) + " failed"],
    ["Front-end store", (st.degraded ? B(false, "DEGRADED") + " · " : "") + esc(st.sessions ?? "?") + " session(s) · " + esc(st.messages ?? "?") + " message(s)" + (st.database_size_mb != null ? " · " + esc(st.database_size_mb) + " MB" : "")],
  ];
  document.getElementById("grid").innerHTML = rows.map(r => '<div class="k">' + esc(r[0]) + "</div><div>" + r[1] + "</div>").join("");
  // P1: surface a clear DEGRADED-boot banner when the data store failed to initialize.
  // The app booted past it on purpose so this page stays reachable — point the operator at
  // the recovery actions above.
  const deg = document.getElementById("degraded");
  if (st.degraded) {
    deg.style.display = "";
    deg.innerHTML = "<strong>Data store DEGRADED.</strong> The front-end booted in recovery mode because the database could not be initialized" +
      (st.initError ? " — <code>" + esc(st.initError) + "</code>" : "") +
      ". The app is serving so you can act: use <strong>Update</strong> (if a fix is merged) or <strong>Factory Reset (OOBE)</strong> below to recover. Your API-key / LLM config is preserved by the reset.";
  } else {
    deg.style.display = "none";
  }
  const fails = (eng.recentFailures || []).slice().reverse();
  const feLast = (d.frontend || {}).lastError;
  const fmt = ms => { try { return new Date(ms).toISOString().slice(0, 19).replace("T", " "); } catch { return ""; } };
  document.getElementById("failwrap").innerHTML =
    "<table><thead><tr><th>Time (UTC)</th><th>Tool</th><th>Error</th><th style='text-align:right'>Duration</th></tr></thead><tbody>" +
    (fails.map(f => "<tr><td>" + esc(fmt(f.ts)) + "</td><td>" + esc(f.tool) + "</td><td>" + esc(f.errorClass) + "</td><td class='num'>" + esc(f.durationMs) + " ms</td></tr>").join("") ||
     "<tr><td colspan=4>No recent failures on record.</td></tr>") + "</tbody></table>" +
    (feLast ? "<div class='sub' style='margin-top:8px'>Front-end tier: " + esc(feLast.tool || "?") + " — " + esc(feLast.kind || "") + " — " + esc(feLast.error || "") + "</div>" : "");
}
// ── update-awareness that SURVIVES the restart (localStorage) ──
// The Update button restarts BOTH tiers, including this page's own host. An in-memory reconnect
// loop dies if the page reloads mid-restart (browser auto-reload, or the admin refreshes) — and
// the regular health poll would then show a HARD "Health check failed" red during a perfectly
// normal ~60s bounce. A persisted flag (set when an update/restart begins, cleared when the tiers
// answer healthy) lets a fresh page load RESUME the soft "reconnecting…" state and recover quietly.
const UPDATING_KEY = "orwell-admin-updating";
const UPDATING_TTL_MS = 5 * 60 * 1000; // a stale flag (a crash mid-update) auto-expires after 5 min
// `const updMsg` is declared lower in this script; load() runs before it, so reach the node lazily
// (avoid a temporal-dead-zone ReferenceError on the resume-on-reload path).
const updMsgEl = () => document.getElementById("update-msg");
function markUpdating() { try { localStorage.setItem(UPDATING_KEY, String(Date.now())); } catch (e) {} }
function clearUpdating() { try { localStorage.removeItem(UPDATING_KEY); } catch (e) {} }
function isUpdating() {
  try {
    const v = localStorage.getItem(UPDATING_KEY);
    if (!v) return false;
    if (Date.now() - Number(v) > UPDATING_TTL_MS) { clearUpdating(); return false; }
    return true;
  } catch (e) { return false; }
}
async function load() {
  try {
    const r = await fetch("/api/admin/health", { credentials: "same-origin", cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    render(d);
    document.getElementById("err").textContent = "";
    document.getElementById("ts").textContent = "Last check: " + new Date().toLocaleTimeString();
    // The tiers answered healthy → any in-progress update/restart has landed; drop the soft state.
    if (d && d.engine && d.engine.ok && isUpdating()) { clearUpdating(); const m = updMsgEl(); if (m) m.textContent = ""; }
  } catch (e) {
    // During a known update/restart a failed probe is EXPECTED — show the soft "reconnecting" line,
    // not a hard red outage. Outside an update it is a genuine failure and reads as one.
    if (isUpdating()) {
      document.getElementById("err").textContent = "";
      const m = updMsgEl(); if (m) m.textContent = "Updating… the app is restarting, reconnecting…";
    } else {
      document.getElementById("err").textContent = "Health check failed: " + e.message;
    }
  }
}
load();
setInterval(load, 10000);
document.getElementById("refresh-now").addEventListener("click", load);
// On a fresh page load DURING a restart (the page's own host bounced and reloaded), resume the
// reconnecting loop instead of stranding the admin on a stale/error view.
if (isUpdating()) { const m = updMsgEl(); if (m) m.textContent = "Updating… reconnecting after the restart…"; waitForBack(); }

// ── the sticky-tail multi-source log viewer (G1b) ──
const pane = document.getElementById("logpane"), pill = document.getElementById("follow"),
      sel = document.getElementById("logsrc");
let logSrc = "live", cursor = 0, following = true, fresh = 0;
const atBottom = () => pane.scrollHeight - pane.scrollTop - pane.clientHeight < 8;
function updPill() {
  pill.innerHTML = following ? '<span class="ok">following</span>'
    : '<span class="warn">paused</span>' + (fresh ? " · " + fresh + " new — scroll down to resume" : "");
}
pane.addEventListener("scroll", () => {
  const b = atBottom();
  if (b && !following) { following = true; fresh = 0; }
  else if (!b) following = false;
  updPill();
});
const LV = { ERROR: "bad", WARNING: "warn", WARN: "warn", INFO: "", DEBUG: "" };
function lineHtml(l) {
  const t = l.ts ? new Date(l.ts).toISOString().slice(11, 19) + " " : "";
  let h = '<div><span class="sub">' + esc(t) + "</span>" +
    (l.level ? '<span class="' + (LV[l.level] ?? "") + '">' + esc(l.level) + "</span> " : "") +
    esc(l.msg);
  if (l.args !== undefined) h += '<div class="sub" style="margin-left:14px">→ ' + esc(l.args) +
    "</div><div class='sub' style='margin-left:14px'>← " + esc(l.result) + "</div>";
  return h + "</div>";
}
async function pollLogs() {
  try {
    const r = await fetch("/api/admin/logs?source=" + encodeURIComponent(logSrc) + "&since=" + cursor,
                          { credentials: "same-origin" });
    if (!r.ok) return;
    const d = await r.json();
    cursor = d.next;
    if (!d.lines.length) return;
    const stick = following || atBottom();
    pane.insertAdjacentHTML("beforeend", d.lines.map(lineHtml).join(""));
    while (pane.children.length > 2500) pane.removeChild(pane.firstChild);
    if (stick) { pane.scrollTop = pane.scrollHeight; following = true; fresh = 0; }
    else fresh += d.lines.length;
    updPill();
  } catch (e) { /* transient — the next poll retries */ }
}
async function loadSources() {
  try {
    const r = await fetch("/api/admin/logs/sources", { credentials: "same-origin" });
    const d = await r.json();
    sel.innerHTML = (d.sources || []).map(s => '<option value="' + esc(s.id) + '">' + esc(s.label) + "</option>").join("");
    sel.value = logSrc;
  } catch (e) {}
}
sel.addEventListener("change", () => {
  logSrc = sel.value; cursor = 0; following = true; fresh = 0;
  pane.innerHTML = ""; updPill(); pollLogs();
});
loadSources();
updPill();
pollLogs();
setInterval(pollLogs, 2000);

// ── G19a: ops buttons — run, then watch the matching log in the viewer ──
const opsRow = document.getElementById("opsrow"), opsMsg = document.getElementById("opsmsg");
async function watchLog(name) {
  await loadSources();                       // a fresh run may have created the file
  const id = "file:" + name;
  if ([...sel.options].some(o => o.value === id)) {
    sel.value = id; sel.dispatchEvent(new Event("change"));
  }
}
async function runOps(sid) {
  opsMsg.textContent = "Starting " + sid + "…";
  try {
    const r = await fetch("/api/admin/ops/run/" + encodeURIComponent(sid), { method: "POST", credentials: "same-origin" });
    const d = await r.json();
    if (d.started) { opsMsg.textContent = sid + " running — following its log."; setTimeout(() => watchLog(d.log), 600); }
    else opsMsg.textContent = sid + ": " + (d.error || "could not start");
  } catch (e) { opsMsg.textContent = "Request failed: " + e.message; }
}
async function triggerUpdate() {
  if (!confirm("Run the updater on this box now? The services will restart; this page keeps following the log.")) return;
  opsMsg.textContent = "Triggering the updater…";
  try {
    const r = await fetch("/api/admin/ops/trigger-update", { method: "POST", credentials: "same-origin" });
    const d = await r.json();
    opsMsg.textContent = d.triggered ? "Update triggered — following ops-update.log (the page rides through the restart)."
                                     : (d.note || "trigger not installed");
    if (d.triggered) setTimeout(() => watchLog(d.log), 1500);
  } catch (e) { opsMsg.textContent = "Request failed: " + e.message; }
}
// ── G25: the debug regenerate lever — discard + regenerate every cast portrait ──
async function regenPortraits() {
  if (!confirm("Discard EVERY stored cast portrait for your game and regenerate the full set now? (Refused safely if the engine or image model is unavailable.)")) return;
  opsMsg.textContent = "Discarding portraits and queueing regeneration…";
  try {
    const r = await fetch("/api/admin/ops/regenerate-portraits", { method: "POST", credentials: "same-origin" });
    const d = await r.json();
    opsMsg.textContent = d.regenerated
      ? "Discarded " + d.discarded + " — regenerating " + d.queued + " in the background; following portrait-log.jsonl."
      : "Refused: " + (d.reason || "unknown") + " — nothing was discarded.";
    if (d.regenerated) setTimeout(() => watchLog(d.log), 1200);
  } catch (e) { opsMsg.textContent = "Request failed: " + e.message; }
}
document.getElementById("regen-portraits").addEventListener("click", regenPortraits);
// ── L38: the fast-forward lever — finish the season so the retrospective unseals (reads no Vault) ──
async function fastForwardFinale() {
  if (!confirm("Fast-forward your live season to a crowned winner now? This finishes the season (the player may lose) so the post-season Vault retrospective unseals. It reads no Vault — God Mode never sees the secrets in advance.")) return;
  opsMsg.textContent = "Driving the season to its finale…";
  try {
    const r = await fetch("/api/admin/ops/advance-to-finale", { method: "POST", credentials: "same-origin" });
    const d = await r.json();
    opsMsg.textContent = d.finished
      ? "Season finished — " + esc(d.winnerName || "the winner") + " crowned after " + esc(d.weeks) + " week(s); you placed " + esc(d.playerPlacement) + ". The retrospective is now reachable."
      : "Could not finish: " + esc(d.reason || "unknown") + ".";
  } catch (e) { opsMsg.textContent = "Request failed: " + e.message; }
}
document.getElementById("ff-finale").addEventListener("click", fastForwardFinale);
// ── DEBUG · owner override of mandate #2: the Producer's Vault unseal ─────────────────────────────
// HIDDEN by default. An explicit click + spoiler confirm UNSEALS the LIVE hidden layer into #pv-panel
// — the one place the admin surface deliberately shows Vault content. Re-seal hides it again.
function renderVault(v) {
  if (!v) return "No active game to unseal.";
  var out = [];
  if (v.winner) out.push("WINNER (so far): " + esc(v.winner.name || ""));
  var story = Array.isArray(v.hiddenStory) ? v.hiddenStory : [];
  out.push("\\nHIDDEN LAYER (" + story.length + " entr" + (story.length === 1 ? "y" : "ies") + "):");
  for (var i = 0; i < story.length; i++) out.push("  • [" + esc(story[i].type || "") + "] " + esc(story[i].content || ""));
  var tw = Array.isArray(v.twists) ? v.twists : [];
  if (tw.length) {
    out.push("\\nSEALED TWISTS:");
    for (var j = 0; j < tw.length; j++) out.push("  • " + esc(tw[j].kind || "") + (tw[j].firedWeek != null ? " — fired week " + esc(tw[j].firedWeek) : " — not fired"));
  }
  var ev = Array.isArray(v.evictionVotes) ? v.evictionVotes : [];
  if (ev.length) {
    out.push("\\nTRUE EVICTION VOTES:");
    for (var k = 0; k < ev.length; k++) {
      var w = ev[k];
      var lines = (w.votes || []).map(function (x) { return esc((x.voter && x.voter.name) || "") + "→" + esc((x.votedFor && x.votedFor.name) || ""); });
      out.push("  • Week " + esc(w.week) + " (out: " + esc((w.evictee && w.evictee.name) || "") + "): " + lines.join(", "));
    }
  }
  return out.join("\\n");
}
async function unsealProducerVault() {
  if (!confirm("UNSEAL THE PRODUCER'S VAULT?\\n\\nThis deliberately reveals your LIVE game's SECRETS — off-screen scheming, NPC confessionals, hidden ties, the sealed twists, and the real eviction votes. It overrides the God-Mode Vault wall (mandate #2) for debugging.\\n\\nThis WILL spoil your in-progress game. Continue?")) return;
  var body = document.getElementById("pv-body");
  var panel = document.getElementById("pv-panel");
  body.textContent = "Unsealing…";
  panel.style.display = "block";
  try {
    const r = await fetch("/api/admin/ops/producer-vault", { method: "POST", credentials: "same-origin" });
    const d = await r.json();
    body.textContent = d.ok ? renderVault(d.vault) : ("Could not unseal: " + esc((d && d.reason) || "unknown") + ".");
  } catch (e) { body.textContent = "Request failed: " + e.message; }
}
document.getElementById("producer-vault").addEventListener("click", unsealProducerVault);
document.getElementById("pv-reseal").addEventListener("click", function () {
  document.getElementById("pv-body").textContent = "";
  document.getElementById("pv-panel").style.display = "none";
});
// ── BEGIN update-reset-combo lane: destructive Update + Reset (pull+rebuild THEN OOBE; type RESET) ──
// Pulls latest + rebuilds, THEN wipes everything to first-run OOBE — keeping the API-key/LLM config.
// Demands an explicit typed "RESET" (not just an OK), then posts to the admin-gated endpoint in
// routes/admin_update_reset_routes.py and rides the restart back to OOBE via waitForBack().
async function updateReset() {
  const typed = prompt(
    "UPDATE + RESET (OOBE)\\n\\n" +
    "First UPDATES: pulls latest, rebuilds the engine, refreshes front-end deps.\\n" +
    "Then RESETS to OOBE: PERMANENTLY deletes ALL accounts, chats, memory, MCP server configs, " +
    "uploads, every user setting, and every game — returning the app to first-run onboarding.\\n\\n" +
    "PRESERVED: your API keys / LLM provider configuration (so you don't re-enter them).\\n" +
    "If the update fails, the reset does NOT run and nothing is wiped.\\n\\n" +
    "Type RESET to confirm:");
  if (typed === null) return;                 // cancelled
  if (typed.trim() !== "RESET") { updMsg.innerHTML = '<span class="warn">Update + Reset cancelled — you must type RESET exactly.</span>'; return; }
  updMsg.textContent = "Starting update + reset…";
  try {
    const r = await fetch("/api/admin/update-reset", { method: "POST", credentials: "same-origin" });
    const d = await r.json();
    if (d && d.started) {
      updMsg.innerHTML = '<span class="warn">Updating + resetting… returning to OOBE. The app is restarting, reconnecting…</span>';
      waitForBack();
    } else {
      updMsg.innerHTML = '<span class="bad">Could not start the update + reset.</span>';
    }
  } catch (e) {
    // A dropped connection here can simply mean the restart already began — start reconnecting.
    updMsg.innerHTML = '<span class="warn">Update + reset requested (connection dropped — likely already restarting); reconnecting to OOBE…</span>';
    waitForBack();
  }
}
document.getElementById("update-reset").addEventListener("click", updateReset);
// ── END update-reset-combo lane ──
// ── BEGIN factory-oobe-reset lane: destructive OOBE reset (type RESET to confirm) ──
// Wipes ALL accounts/chats/memory/MCP/settings + every game; keeps the API-key/LLM config.
// Demands an explicit typed "RESET" (not just an OK), then posts to the admin-gated endpoint
// in routes/admin_reset_routes.py and rides the restart back to OOBE via waitForBack().
async function factoryReset() {
  const typed = prompt(
    "FACTORY RESET (OOBE)\\n\\n" +
    "This PERMANENTLY deletes ALL accounts, chats, memory, MCP server configs, uploads, every " +
    "user setting, and every game — returning the app to first-run onboarding.\\n\\n" +
    "PRESERVED: your API-key / LLM provider configuration (so you don't re-enter it).\\n\\n" +
    "Type RESET to confirm:");
  if (typed === null) return;                 // cancelled
  if (typed.trim() !== "RESET") { updMsg.innerHTML = '<span class="warn">Reset cancelled — you must type RESET exactly.</span>'; return; }
  updMsg.textContent = "Starting factory reset…";
  try {
    const r = await fetch("/api/admin/factory-reset", { method: "POST", credentials: "same-origin" });
    const d = await r.json();
    if (d && d.started) {
      updMsg.innerHTML = '<span class="warn">Resetting… returning to OOBE. The app is restarting, reconnecting…</span>';
      waitForBack();
    } else {
      updMsg.innerHTML = '<span class="bad">Could not start the reset.</span>';
    }
  } catch (e) {
    // A dropped connection here can simply mean the restart already began — start reconnecting.
    updMsg.innerHTML = '<span class="warn">Reset requested (connection dropped — likely already restarting); reconnecting to OOBE…</span>';
    waitForBack();
  }
}
document.getElementById("factory-reset").addEventListener("click", factoryReset);
// ── END factory-oobe-reset lane ──
// ── one-click Update: pull → rebuild → refresh FE deps → restart both, then reconnect ──
const updMsg = document.getElementById("update-msg");
function waitForBack() {
  // The services restart (this page's host included). Poll /api/admin/health until the engine
  // answers again, then reload. Generous attempts (~3 min) cover a cold npm ci + rebuild.
  let tries = 0;
  const tick = async () => {
    tries++;
    try {
      const r = await fetch("/api/admin/health", { credentials: "same-origin", cache: "no-store" });
      if (r.ok) {
        const d = await r.json();
        if (d && d.engine && d.engine.ok) {
          clearUpdating(); // the bounce landed — the persisted soft state has served its purpose
          updMsg.innerHTML = '<span class="ok">Back online — reloading…</span>';
          setTimeout(() => location.reload(), 800);
          return;
        }
      }
    } catch (e) { /* still down — keep polling */ }
    updMsg.textContent = "Updating… the app is restarting, reconnecting (" + tries + ")";
    if (tries < 90) setTimeout(tick, 2000);
    else updMsg.innerHTML = '<span class="warn">Still reconnecting — refresh the page manually in a moment.</span>';
  };
  setTimeout(tick, 4000); // give the restart a head start before the first probe
}
async function updateOrwell() {
  if (!confirm("Update Orwell now?\\n\\nThis pulls latest, rebuilds the engine, refreshes front-end deps, and restarts both services — the app will briefly go down (~30–60s) and reconnect automatically.")) return;
  // Persist the "updating" awareness BEFORE the restart can drop this page — so a reload mid-bounce
  // resumes the reconnecting state instead of showing a false hard outage.
  markUpdating();
  updMsg.textContent = "Starting the update…";
  try {
    const r = await fetch("/api/admin/update", { method: "POST", credentials: "same-origin" });
    const d = await r.json();
    if (d && d.started) {
      updMsg.textContent = "Update started — the app will restart, reconnecting…";
      waitForBack();
    } else {
      clearUpdating(); // the update never actually started — don't strand the page in soft state
      updMsg.innerHTML = '<span class="bad">Could not start the update.</span>';
    }
  } catch (e) {
    // A connection drop here can simply mean the restart already began — start reconnecting.
    updMsg.textContent = "Update requested (connection dropped — likely already restarting); reconnecting…";
    waitForBack();
  }
}
document.getElementById("update-orwell").addEventListener("click", updateOrwell);
// ── BEGIN ops-progress lane ──
// Poll /api/admin/ops-status and render a live timeline for whichever ops action is running
// (Update / Factory Reset (OOBE) / Update+Reset). Survives the services restart: the action being
// watched is persisted to localStorage and resumed after waitForBack() reloads the page; on
// completion it shows "done / updated / OOBE ready", on failure the error — so the old silent
// "triggered then nothing" can never recur.
const OPS_PROGRESS_KEY = "orwell.ops.watching";          // localStorage: the action we're tracking
const OPS_STEP_LABELS = {
  // The human phase names per action — index = step number (the script emits 1..total). These
  // mirror the ops_progress_step() calls in the deploy scripts; a message from the server always
  // wins for the CURRENT step, so a label drift never lies, it just pre-fills the upcoming rows.
  "update": ["fetching latest code", "rebuilding engine", "refreshing front-end deps", "restarting services", "updated"],
  "factory-reset": ["stopping services", "preserving API keys / LLM config", "wiping front-end store", "scrubbing game sandboxes", "restarting services", "OOBE ready"],
  "update-reset": ["fetching latest code", "rebuilding engine", "stopping services", "wiping front-end store", "scrubbing game sandboxes", "restarting services", "OOBE ready"],
};
const OPS_TITLES = { "update": "Updating Orwell", "factory-reset": "Factory Reset (OOBE)", "update-reset": "Update + Reset" };
// This panel tracks ONLY the three top-of-page maintenance actions. public-deployment / tls also
// publish ops-status entries, but they have their OWN inline progress areas — surfacing them here
// would render a titleless, label-less panel ("extraneous data"). Restrict to what this panel owns.
const OPS_PANEL_ACTIONS = ["update", "factory-reset", "update-reset"];
// A finished/failed run is only "now" for a short window. After it lapses the panel hides instead
// of resurrecting a stale completion banner on every later page-load (the old d.latest behavior).
const OPS_FRESH_MS = 120000;
function opsFresh(s) { if (!s || !s.ts) return false; const t = Date.parse(s.ts); return isFinite(t) && (Date.now() - t) < OPS_FRESH_MS; }
function opsMarkWatching(action) { try { localStorage.setItem(OPS_PROGRESS_KEY, action); } catch (e) {} }
function opsClearWatching() { try { localStorage.removeItem(OPS_PROGRESS_KEY); } catch (e) {} }
function opsGetWatching() { try { return localStorage.getItem(OPS_PROGRESS_KEY); } catch (e) { return null; } }
const opsPanel = document.getElementById("ops-progress");
function renderOpsProgress(s) {
  // s = a normalized status object from /api/admin/ops-status (or null). Hide the panel when
  // there's nothing to show.
  if (!s) { opsPanel.style.display = "none"; return; }
  const action = s.action || "ops";
  const labels = OPS_STEP_LABELS[action] || [];
  const total = s.total || labels.length || 0;
  const step = Math.max(0, Math.min(s.step || 0, total || (s.step || 0)));
  opsPanel.style.display = "block";
  document.getElementById("ops-progress-title").textContent = OPS_TITLES[action] || action;
  document.getElementById("ops-progress-count").textContent = total ? ("step " + step + " / " + total) : "";
  // Bar reflects steps actually COMPLETED so it never runs ahead of the ✓ rows: a step that is only
  // in flight (●) is not done yet. completed = step-1 while a step runs (or after a failure on it),
  // and all of them on success. (The old step/total read 60% the instant step 3 of 5 began.)
  const completed = s.ok ? total : Math.max(0, step - 1);
  const pct = total ? Math.round(completed / total * 100) : (s.ok ? 100 : 0);
  const bar = document.getElementById("ops-progress-bar");
  bar.style.width = pct + "%";
  bar.style.background = s.error ? "#e55" : (s.ok ? "#3cb46e" : "#9cdef2");
  const spinner = document.getElementById("ops-progress-spinner");
  spinner.style.display = s.running ? "inline-block" : "none";
  // Build the step rows from the STABLE phase labels: done (✓), current (●), pending (○), failed (✗).
  // The live server message is NOT echoed into a row — it lives in the single message line below, so
  // the same text can never appear twice (the "● refreshing front-end deps" + duplicate-line bug).
  const rows = [];
  const n = Math.max(total, labels.length, step);
  for (let i = 1; i <= n; i++) {
    const label = labels[i - 1] || ("step " + i);
    let mark, cls;
    if (s.error && i === step) { mark = "✗"; cls = "bad"; }
    else if (i < step || (s.ok && i <= total)) { mark = "✓"; cls = "ok"; }
    else if (i === step && s.running) { mark = "●"; cls = ""; }
    else { mark = "○"; cls = "sub"; }
    const labelCls = (cls === "sub") ? "sub" : "";
    rows.push("<li><span class=\\"" + cls + "\\">" + mark + "</span> <span class=\\"" + labelCls + "\\">" + esc(label) + "</span></li>");
  }
  document.getElementById("ops-progress-steps").innerHTML = rows.join("");
  // Single message line. Suppress it whenever it would merely repeat the current step's label —
  // the deploy helper emits the phase name as the step message, so echoing it here was pure noise.
  const msgEl = document.getElementById("ops-progress-msg");
  const curLabel = (labels[step - 1] || "").trim();
  const cleanMsg = (s.message || "").replace(/^FAILED:\\s*/, "").trim();
  if (s.error) {
    msgEl.innerHTML = '<span class="bad">' + esc(s.message || ("FAILED: " + s.error)) + " — see " + esc(s.log || "the ops log") + "</span>";
  } else if (s.ok) {
    msgEl.innerHTML = (cleanMsg && cleanMsg !== curLabel) ? '<span class="ok">' + esc(cleanMsg) + "</span>" : "";
  } else if (s.running) {
    msgEl.innerHTML = (cleanMsg && cleanMsg !== curLabel) ? '<span class="sub">' + esc(cleanMsg) + "</span>" : "";
  } else {
    msgEl.textContent = "";
  }
}
async function pollOpsProgress() {
  try {
    const r = await fetch("/api/admin/ops-status", { credentials: "same-origin", cache: "no-store" });
    if (!r.ok) return;
    const d = await r.json();
    const acts = d.actions || {};
    const inPanel = a => OPS_PANEL_ACTIONS.indexOf(a) !== -1;
    const watching = opsGetWatching();
    // Decide what (if anything) is live RIGHT NOW, in priority order:
    //   1. a running panel action,
    //   2. the action we were told to watch (so a deliberate restart resumes its timeline),
    //   3. the freshest terminal panel action — but ONLY while still fresh.
    // Anything else (an old completed/failed run, or a tls/public-deployment entry) is NOT "now",
    // so the panel hides rather than resurrecting a stale banner.
    let action = (d.running && inPanel(d.running)) ? d.running : null;
    let fromWatch = false;
    if (!action && watching && inPanel(watching) && acts[watching]) { action = watching; fromWatch = true; }
    if (!action) {
      let best = null, bestTs = "";
      for (const a of OPS_PANEL_ACTIONS) { const st = acts[a]; if (st && st.ts && st.ts > bestTs) { bestTs = st.ts; best = a; } }
      if (best && opsFresh(acts[best])) action = best;
    }
    const s = action ? acts[action] : null;
    // A terminal state surfaced only via the freshness fallback must actually be fresh; a watched or
    // running action always shows (the watched terminal covers the post-restart reload, then clears).
    if (!s || (!s.running && !fromWatch && !opsFresh(s))) { renderOpsProgress(null); return; }
    renderOpsProgress(s);
    if (s.running) opsMarkWatching(action);          // keep tracking this one across the reload
    else if (fromWatch && (s.ok || s.error)) opsClearWatching();  // shown once post-restart; stop re-asserting
  } catch (e) { /* transient (likely the restart) — the next poll retries */ }
}
// Mark which action to track the moment its button is clicked, so the timeline resumes after the
// restart-triggered reload. Non-invasive: we ADD listeners to the existing buttons (their own
// lanes own the click→POST flow); these only set the localStorage breadcrumb the poller reads.
(function () {
  const u = document.getElementById("update-orwell");
  if (u) u.addEventListener("click", () => opsMarkWatching("update"));
  const ur = document.getElementById("update-reset");
  if (ur) ur.addEventListener("click", () => opsMarkWatching("update-reset"));
  const fr = document.getElementById("factory-reset");
  if (fr) fr.addEventListener("click", () => opsMarkWatching("factory-reset"));
})();
pollOpsProgress();
setInterval(pollOpsProgress, 2000);
// ── END ops-progress lane ──
async function loadOps() {
  try {
    const r = await fetch("/api/admin/ops", { credentials: "same-origin" });
    const d = await r.json();
    let h = (d.scripts || []).map(s => '<button type="button" class="btn" data-ops="' + esc(s.id) + '">' + esc(s.label) + "</button>").join("");
    const t = d.updateTrigger || {};
    h += t.installed
      ? '<button type="button" class="btn" id="ops-update">Run update (root trigger)</button>'
      : '<span class="sub">update trigger not installed — run the deploy updater once to enable</span>';
    opsRow.innerHTML = h;
    opsRow.querySelectorAll("[data-ops]").forEach(b => b.addEventListener("click", () => runOps(b.dataset.ops)));
    const u = document.getElementById("ops-update");
    if (u) u.addEventListener("click", triggerUpdate);
  } catch (e) { opsRow.textContent = "ops unavailable"; }
}
loadOps();
// ── log retention + LLM I/O trace controls ──
const retGrid = document.getElementById("retgrid"), retDays = document.getElementById("ret-days"),
      traceToggle = document.getElementById("trace-toggle"), retMsg = document.getElementById("retmsg");
function retBytes(n) { n = Math.max(0, +n || 0); const u = ["B","KB","MB","GB"]; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return (i ? n.toFixed(1) : (n|0)) + " " + u[i]; }
function renderRetention(d) {
  const files = (d.files || []).slice().sort((a, b) => b.bytes - a.bytes);
  const rows = [
    ["Total log size", '<strong>' + esc(d.totalHuman || "0 B") + "</strong>"],
    ["LLM I/O trace", d.traceEnabled ? B(true, "ON") : B(false, "OFF")],
    ["Retention", d.retentionDays ? esc(d.retentionDays) + " day(s)" : "keep everything"],
  ];
  retGrid.innerHTML = rows.map(r => '<div class="k">' + esc(r[0]) + "</div><div>" + r[1] + "</div>").join("") +
    (files.length ? '<div class="k">Files</div><div class="sub">' +
      files.map(f => esc(f.name) + " — " + esc(retBytes(f.bytes))).join("<br>") + "</div>" : "");
}
async function loadRetention() {
  try {
    const r = await fetch("/api/admin/logs/retention", { credentials: "same-origin", cache: "no-store" });
    if (!r.ok) return;
    const d = await r.json();
    retDays.innerHTML = (d.choices || []).map(c => '<option value="' + esc(c.days) + '">' + esc(c.label) + "</option>").join("");
    retDays.value = String(d.retentionDays);
    traceToggle.checked = !!d.traceEnabled;
    renderRetention(d);
  } catch (e) {}
}
async function saveRetention(body, note) {
  retMsg.textContent = note || "saving…";
  try {
    const r = await fetch("/api/admin/logs/retention", { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    renderRetention(d);
    retMsg.textContent = "";
  } catch (e) { retMsg.innerHTML = '<span class="bad">save failed</span>'; }
}
traceToggle.addEventListener("change", () => saveRetention({ traceEnabled: traceToggle.checked }));
retDays.addEventListener("change", () => saveRetention({ retentionDays: +retDays.value }, "applying horizon…"));
document.getElementById("trim-now").addEventListener("click", async () => {
  retMsg.textContent = "trimming…";
  try {
    const r = await fetch("/api/admin/logs/trim", { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days: +retDays.value }) });
    const d = await r.json();
    renderRetention(d);
    retMsg.innerHTML = '<span class="ok">freed ' + esc(d.removedHuman || "0 B") + " — now " + esc(d.totalHuman) + "</span>";
  } catch (e) { retMsg.innerHTML = '<span class="bad">trim failed</span>'; }
});
loadRetention();
setInterval(loadRetention, 15000);
</script>
</body></html>"""


# ── G19a: ops from the status page ──────────────────────────────────────────
# Allowlisted, read-only-by-construction script runs + the update TRIGGER.
# The web tier never chooses what executes: fixed ids → fixed argv. The update
# is not run here at all — the FE is the E85-hardened unit (no privileges, and
# a self-update would kill its own parent mid-run); it writes a flag file that
# a root-side systemd path unit (deploy/systemd/orwell-ops-update.*, G19b)
# watches, running the real updater and teeing to data/ops-update.log — which
# the viewer above tails live, ACROSS the restart (the page is self-contained).
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_OPS_SCRIPTS = {
    # id → (label, script, argv, log basename) — READ-ONLY modes only.
    "panel": ("Health panel (read-only)", "orwell-login-panel.sh", [], "ops-panel.log"),
    "doctor-status": ("Doctor — status only (read-only)", "orwell-doctor.sh", ["--status"], "ops-doctor.log"),
}
_OPS_RUNNING = {}

# L37 — size-cap the on-disk ops logs. Each run opens the file with "w" (so it never APPENDS across
# runs), but a single run can still capture an unbounded journal/diagnostic tail (the 2026-06-19
# incident, where an engine-down firehose ballooned the captured journal). After the run we cap the
# file to its last `_OPS_LOG_CAP_BYTES`, keeping the most-recent (most-useful) tail and prefixing a
# truncation marker — so the file the /admin/status viewer tails can never grow without bound.
_OPS_LOG_CAP_BYTES = 256 * 1024  # 256 KB — generous for a health/diagnostic tail, bounded for the disk


def _cap_log_file(path: str, cap: int = _OPS_LOG_CAP_BYTES) -> None:
    """Truncate `path` IN PLACE to AT MOST `cap` bytes total when it exceeds the cap, keeping the
    freshest tail and a one-line truncation marker (the marker counts toward the cap, so the result
    is genuinely bounded AND a second pass is a true no-op). Best-effort: any error is swallowed so a
    capping failure never breaks the reaper. A file already at/under the cap is left byte-identical."""
    try:
        if not os.path.isfile(path):
            return
        size = os.path.getsize(path)
        if size <= cap:
            return
        marker = (
            f"[ops] log truncated to the last {cap} bytes "
            f"(older output dropped to keep the on-disk log bounded)\n"
        ).encode("utf-8")
        tail_bytes = max(0, cap - len(marker))
        with open(path, "rb") as fh:
            fh.seek(size - tail_bytes)
            tail = fh.read()
        with open(path, "wb") as fh:
            fh.write(marker)
            fh.write(tail)
    except Exception:
        pass


def _ops_script_path(script: str) -> str:
    return os.path.join(_REPO_ROOT, "deploy", script)


async def _run_ops_script(sid: str) -> dict:
    label, script, argv, log_name = _OPS_SCRIPTS[sid]
    path = _ops_script_path(script)
    if not os.path.isfile(path):
        return {"started": False, "error": "script-missing"}
    if _OPS_RUNNING.get(sid):
        return {"started": False, "error": "already-running", "log": log_name}
    log_path = os.path.join(_data_dir(), log_name)
    os.makedirs(_data_dir(), exist_ok=True)
    logger.info("[ops] admin run: %s (%s)", sid, script)
    import datetime as _dt
    import subprocess
    import threading
    f = open(log_path, "w", encoding="utf-8")
    f.write(f"==== {label} · {_dt.datetime.now(timezone.utc).isoformat()} ====\n")
    f.flush()
    # A plain Popen + daemon-thread reaper, NOT an asyncio task: a task created
    # on the request loop dies with that loop (TestClient tears it down per
    # request, and uvicorn workers can recycle), which orphaned the exit marker
    # and leaked _OPS_RUNNING=True. The thread outlives any loop.
    proc = subprocess.Popen(["bash", path, *argv], cwd=_REPO_ROOT, stdout=f, stderr=f)
    _OPS_RUNNING[sid] = True

    def _reap():
        try:
            code = proc.wait()
            f.write(f"\n[ops] exit {code}\n")
        finally:
            f.close()
            _OPS_RUNNING[sid] = False
            _cap_log_file(log_path)  # L37: keep the on-disk log bounded (tail only)
    threading.Thread(target=_reap, name=f"ops-reap-{sid}", daemon=True).start()
    return {"started": True, "log": log_name}


def setup_admin_status_page() -> APIRouter:
    """The self-contained ops page at /admin/status (G1b) — its own router so the
    page lives outside the /api prefix; same require_admin contract."""
    router = APIRouter(tags=["admin_health"])

    @router.get("/admin/status")
    async def admin_status_page(request: Request):
        require_admin(request)
        # The page's inline <script> needs the per-request CSP nonce, exactly like
        # index.html's {{CSP_NONCE}} templating (core/middleware.py sets the strict
        # script-src 'nonce-…'); without it the poller is CSP-blocked and the page
        # sits at "Loading…" forever (regression fix).
        nonce = getattr(request.state, "csp_nonce", "")
        html = _STATUS_PAGE.replace("{{CSP_NONCE}}", nonce)
        return Response(content=html, media_type="text/html")

    return router
