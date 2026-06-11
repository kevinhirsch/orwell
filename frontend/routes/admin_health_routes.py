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


def _image_state(user: str | None) -> dict:
    """The image-generation provider state (0051): enabled? model? usable right now?
    Best-effort — a broken resolver reads as available:false, never a 500."""
    state: dict = {"enabled": False, "model": "", "quality": "", "available": False}
    try:
        from src import orwell_portraits
        enabled, model_spec, quality = orwell_portraits._image_settings(user)
        state.update({"enabled": bool(enabled), "model": model_spec or "", "quality": quality or ""})
        state["available"] = bool(orwell_portraits.image_generation_available(user))
    except Exception as e:
        state["error"] = f"{type(e).__name__}: {e}"
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

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "engine": engine,
        "frontend": frontend,
        "tiersAgree": tiers_agree,
        "images": _image_state(user),
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
  a.btn { color: #9cdef2; border: 1px solid #355a66; border-radius: 8px;
          padding: 6px 12px; text-decoration: none; }
  a.btn:hover { background: rgba(255,255,255,.06); }
  #err { color: #e55; margin-top: 10px; }
</style></head>
<body>
<h1>ORWELL · STATUS</h1>
<div class="sub">Self-contained ops page — renders even when the app shell is broken. Polls every 10s. <span id="ts"></span></div>
<div class="grid" id="grid">Loading…</div>
<div class="actions">
  <a class="btn" href="/api/admin/debug-bundle" download>Download debug bundle</a>
  <a class="btn" href="javascript:void(load())">Refresh now</a>
</div>
<div id="failwrap"></div>
<h1 style="margin-top:26px">LIVE LOG</h1>
<div class="sub">Every log stream in the program, selectable. Auto-follows the tail while you are at the bottom; scrolling up pauses the follow — scroll back down to resume.</div>
<div class="actions" style="margin:8px 0">
  <select id="logsrc" style="background:#1b1f27;color:#cfd8e3;border:1px solid #355a66;border-radius:8px;padding:5px 8px;font:inherit"></select>
  <span id="follow" class="sub"></span>
</div>
<div id="logpane" style="height:380px;overflow:auto;border:1px solid #262a33;border-radius:8px;padding:8px 10px;background:#101218;white-space:pre-wrap;word-break:break-word;font-size:12.5px;line-height:1.45"></div>
<div id="err"></div>
<script>
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
    ["Image generation", (img.available ? B(true, "AVAILABLE") : B(false, img.enabled ? "NO USABLE MODEL" : "DISABLED")) + (img.model ? " · " + esc(img.model) : "")],
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
</script>
</body></html>"""


def setup_admin_status_page() -> APIRouter:
    """The self-contained ops page at /admin/status (G1b) — its own router so the
    page lives outside the /api prefix; same require_admin contract."""
    router = APIRouter(tags=["admin_health"])

    @router.get("/admin/status")
    async def admin_status_page(request: Request):
        require_admin(request)
        return Response(content=_STATUS_PAGE, media_type="text/html")

    return router
