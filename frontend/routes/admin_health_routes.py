"""Lane G1 — admin Health & Logs (UI-backed health checking + debug bundle).

The user commission: "robust health checking and logging, visible in the admin side
of settings" plus a one-click mechanism to gather debug data (the image pipeline's
silent placeholder failures were the trigger). Two read-only, admin-gated routes
(the same ``require_admin`` contract as ``admin_transcript_routes.py``):

  GET /api/admin/health        — one aggregated snapshot: the engine's /health
                                 (uptime, call counters, the G1 recent-failure ring,
                                 embeddings provider + degrade flag) measured with
                                 round-trip latency, the FE store stats, the FE's own
                                 view of the engine (lastError), whether the two
                                 tiers AGREE, and the image-generation provider state.
  GET /api/admin/debug-bundle  — the same snapshot as a downloadable JSON file plus
                                 a config section with every secret-shaped value
                                 REDACTED (tokens/keys/passwords never leave the box).

Boundaries:
  * Vault-free by construction — everything here is operational metadata (the engine's
    /health carries tool names + sanitized error classes + timings only; G1 engine side).
  * READ-ONLY — no mutating verb exists on this surface.
  * Secrets never cross: the bundle redacts by key pattern BEFORE serialization.
"""

import inspect
import logging
import os
import re
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Request, Response

from core.middleware import require_admin
from src import orwell_engine
from src.auth_helpers import effective_user

logger = logging.getLogger(__name__)

from src import log_rings  # the G1b live rings (FE log + Engine I/O tap)


def _data_dir() -> str:
    return os.environ.get("DATA_DIR") or os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")


def _log_files() -> list:
    """On-disk log basenames under the data dir (allowlist for the file tail)."""
    out = []
    try:
        for n in sorted(os.listdir(_data_dir())):
            if n.endswith((".log", ".jsonl")) and os.path.isfile(os.path.join(_data_dir(), n)):
                out.append(n)
    except OSError:
        pass
    return out

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
    """Light FE-store counts (sessions/messages + db size) — best-effort, never raises."""
    stats: dict = {}
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
        return await _health_snapshot(user)

    @router.get("/logs/sources")
    async def admin_log_sources(request: Request):
        """G1b: every selectable log stream — the two live rings + on-disk logs."""
        require_admin(request)
        sources = [
            {"id": "live", "label": "Front-end (live)"},
            {"id": "io", "label": "Engine I/O (live) — every tool call in/out"},
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
        if source.startswith("file:"):
            name = source[5:]
            if name not in _log_files():  # strict allowlist — no traversal, ever
                return Response(status_code=404)
            path = os.path.join(_data_dir(), name)
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

    @router.get("/ops")
    async def admin_ops(request: Request):
        """G19a: the runnable allowlist + whether the update trigger is installed."""
        require_admin(request)
        return {
            "scripts": [{"id": k, "label": v[0], "log": v[3]} for k, v in _OPS_SCRIPTS.items()],
            "updateTrigger": {"installed": os.path.isdir(os.path.join(_data_dir(), "ops")),
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
        ops_dir = os.path.join(_data_dir(), "ops")
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

    @router.get("/debug-bundle")
    async def debug_bundle(request: Request):
        require_admin(request)
        user = None
        try:
            user = effective_user(request)
        except Exception:
            pass
        snapshot = await _health_snapshot(user)
        bundle = {
            "bundle": "orwell-debug",
            "generatedAt": snapshot["generatedAt"],
            "health": snapshot,
            # The engine's recent-failure ring, hoisted for one-glance triage
            # (tool name + sanitized error class + timing only — G1 engine side).
            "recentFailures": (snapshot.get("engine") or {}).get("recentFailures", []),
            "config": _redact_config(dict(os.environ)),
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
  .actions { margin: 18px 0; display: flex; gap: 12px; }
  .btn { color: #9cdef2; border: 1px solid #355a66; border-radius: 8px;
         padding: 6px 12px; text-decoration: none; cursor: pointer;
         background: transparent; font: inherit; display: inline-block; }
  .btn:hover { background: rgba(255,255,255,.06); }
  #err { color: #e55; margin-top: 10px; }
</style></head>
<body>
<h1>ORWELL · STATUS</h1>
<div class="sub">Self-contained ops page — renders even when the app shell is broken. Polls every 10s. <span id="ts"></span></div>
<div class="grid" id="grid">Loading…</div>
<div class="actions">
  <a class="btn" href="/api/admin/debug-bundle" download>Download debug bundle</a>
  <button type="button" class="btn" id="refresh-now">Refresh now</button>
  <button type="button" class="btn" id="regen-portraits" title="Discard every stored cast portrait for your game and regenerate the full set (debug)">Regenerate cast portraits (debug)</button>
  <button type="button" class="btn" id="ff-finale" title="Drive your live season to a crowned winner so the post-season retrospective unseals (debug; reads no Vault)">Fast-forward to finale (debug)</button>
</div>
<div id="failwrap"></div>
<h1 style="margin-top:26px">LIVE LOG</h1>
<div class="sub">Every log stream in the program, selectable. Auto-follows the tail while you are at the bottom; scrolling up pauses the follow — scroll back down to resume.</div>
<div class="actions" style="margin:8px 0">
  <select id="logsrc" style="background:#1b1f27;color:#cfd8e3;border:1px solid #355a66;border-radius:8px;padding:5px 8px;font:inherit"></select>
  <span id="follow" class="sub"></span>
</div>
<div id="logpane" style="height:380px;overflow:auto;border:1px solid #262a33;border-radius:8px;padding:8px 10px;background:#101218;white-space:pre-wrap;word-break:break-word;font-size:12.5px;line-height:1.45"></div>
<h1 style="margin-top:26px">OPS</h1>
<div class="sub">Run a maintenance script and watch it in the viewer above. Read-only scripts run in-process; the update goes through the root-side trigger (G19b) so the hardened web tier never holds privilege — the viewer follows <code>ops-update.log</code> live, across the restart. Factory reset is deliberately not here.</div>
<div class="actions" id="opsrow">Loading ops…</div>
<div id="opsmsg" class="sub"></div>
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
    ["Front-end store", esc(st.sessions ?? "?") + " session(s) · " + esc(st.messages ?? "?") + " message(s)" + (st.database_size_mb != null ? " · " + esc(st.database_size_mb) + " MB" : "")],
  ];
  document.getElementById("grid").innerHTML = rows.map(r => '<div class="k">' + esc(r[0]) + "</div><div>" + r[1] + "</div>").join("");
  const fails = (eng.recentFailures || []).slice().reverse();
  const feLast = (d.frontend || {}).lastError;
  const fmt = ms => { try { return new Date(ms).toISOString().slice(0, 19).replace("T", " "); } catch { return ""; } };
  document.getElementById("failwrap").innerHTML =
    "<table><thead><tr><th>Time (UTC)</th><th>Tool</th><th>Error</th><th style='text-align:right'>Duration</th></tr></thead><tbody>" +
    (fails.map(f => "<tr><td>" + esc(fmt(f.ts)) + "</td><td>" + esc(f.tool) + "</td><td>" + esc(f.errorClass) + "</td><td class='num'>" + esc(f.durationMs) + " ms</td></tr>").join("") ||
     "<tr><td colspan=4>No recent failures on record.</td></tr>") + "</tbody></table>" +
    (feLast ? "<div class='sub' style='margin-top:8px'>Front-end tier: " + esc(feLast.tool || "?") + " — " + esc(feLast.kind || "") + " — " + esc(feLast.error || "") + "</div>" : "");
}
async function load() {
  try {
    const r = await fetch("/api/admin/health", { credentials: "same-origin" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    render(await r.json());
    document.getElementById("err").textContent = "";
    document.getElementById("ts").textContent = "Last check: " + new Date().toLocaleTimeString();
  } catch (e) { document.getElementById("err").textContent = "Health check failed: " + e.message; }
}
load();
setInterval(load, 10000);
document.getElementById("refresh-now").addEventListener("click", load);

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
