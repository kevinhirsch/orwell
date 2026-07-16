"""Full LLM I/O trace + log retention (the admin-status "everything in/out" tap).

The owner commission: "do we log all reasoning somewhere? like everything in/out
of the llm? add that to the logfile viewer. archive it off after a period — a
universal retention setting on the health page: trim logfiles, a selectable
horizon, and a live total-size readout."

What this captures
------------------
Every model call made through the two public chokepoints in ``src/llm_core.py``
(``stream_llm_with_fallback`` for chat/agent streaming, ``llm_call_async`` for the
non-streaming utility/extraction calls) is recorded as one record carrying the
**full request** (the system prompt + every message + the tool schemas + the
sampling params) and the **full response** (assistant text + reasoning/thinking +
tool calls + token usage, or the error). Two sinks:

  * the in-memory ``log_rings.LLMIO`` ring — the live tail the /admin/status viewer
    follows (a glanceable summary + clipped request/response); and
  * ``data/llm-io.jsonl`` — the durable, full-fidelity archive, one JSON object per
    line, governed by retention (auto-trimmed + the manual "Trim now" button). The
    archive is **LOSSLESS** — the owner directive "preserve ALL I/O — and I mean all":
    an individual record is NEVER content-dropped or clipped; only time-based retention
    governs aggregate size (and it never loses I/O within its horizon).

Boundaries
----------
  * **Vault-free by construction.** The front-end only ever holds Vault-free
    projections from the engine, so the prompt it builds for the LLM carries no
    secret game state. The same admin gate as the rest of the status page applies.
  * **Secrets never cross.** The recorder is never handed the request *headers*, so
    the provider ``Authorization`` / api-key never reaches a trace. As defence in
    depth every serialized string is scrubbed for bearer-token / ``sk-…`` shapes.
  * **Logging must never hurt the app.** Every writer and the trim swallow their own
    errors; a disabled trace (``llm_trace_enabled=false``) is a near-zero passthrough.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ── locations ──────────────────────────────────────────────────────────────────


def _data_dir() -> str:
    return os.environ.get("DATA_DIR") or os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")


def trace_path() -> str:
    """The durable full-fidelity trace — lives at the top of the data dir so the
    existing /admin/status file viewer auto-discovers it (``*.jsonl`` allowlist)."""
    return os.path.join(_data_dir(), "llm-io.jsonl")


def _logs_subdir() -> str:
    return os.path.join(_data_dir(), "logs")


# ── settings gates ─────────────────────────────────────────────────────────────

# Bounds for the retention horizon (days). 0 ⇒ "keep everything" (no auto-trim).
RETENTION_CHOICES = [
    {"days": 1, "label": "1 day"},
    {"days": 7, "label": "7 days"},
    {"days": 30, "label": "30 days"},
    {"days": 90, "label": "90 days"},
    {"days": 0, "label": "Keep everything"},
]
_DEFAULT_RETENTION_DAYS = 7
# Soft observability threshold per persisted record (bytes). The durable archive is
# LOSSLESS — a record is NEVER content-dropped (the owner's "preserve ALL I/O — and I
# mean all" directive). Aggregate size is governed by time-based retention, which never
# loses I/O within its horizon. Crossing this threshold only emits one warning so an
# operator can notice an unusually large call; the record is still written IN FULL.
_MAX_RECORD_BYTES = 8 * 1024 * 1024


def enabled() -> bool:
    try:
        from src.settings import get_setting
        return bool(get_setting("llm_trace_enabled", True))
    except Exception:
        return True


def retention_days() -> int:
    try:
        from src.settings import get_setting
        v = get_setting("log_retention_days", _DEFAULT_RETENTION_DAYS)
        d = int(v)
        return d if d >= 0 else _DEFAULT_RETENTION_DAYS
    except Exception:
        return _DEFAULT_RETENTION_DAYS


# ── redaction (defence in depth — headers are never passed in) ──────────────────

_BEARER_RE = re.compile(r"(Bearer\s+)[A-Za-z0-9._\-]{8,}", re.IGNORECASE)
_APIKEY_RE = re.compile(r"\b(sk-[A-Za-z0-9._\-]{8,}|github_pat_[A-Za-z0-9_]{8,})\b")
_REDACTED = "***REDACTED***"


def _scrub_str(s: str) -> str:
    try:
        s = _BEARER_RE.sub(r"\1" + _REDACTED, s)
        s = _APIKEY_RE.sub(_REDACTED, s)
    except Exception:
        pass
    return s


def _scrub(obj: Any) -> Any:
    if isinstance(obj, str):
        return _scrub_str(obj)
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            # ADR 0010: redact secret-shaped keys (authorization / api-key / a raw bearer
            # `token` / secret) but NEVER the usage COUNT keys, which are all plural
            # `*_tokens` (prompt_tokens, completion_tokens, cached_tokens, reasoning_tokens).
            # The singular-`token` negative lookahead `token(?!s)` is the discriminator:
            # it still catches `token`/`access_token`/`api_token`, but leaves the plural
            # count fields intact so the token economy meter (0069) records real numbers.
            if isinstance(k, str) and re.search(r"authorization|api[-_]?key|token(?!s)|secret", k, re.IGNORECASE):
                out[k] = _REDACTED
            else:
                out[k] = _scrub(v)
        return out
    if isinstance(obj, list):
        return [_scrub(v) for v in obj]
    return obj


# ── streaming accumulator ───────────────────────────────────────────────────────


class StreamAccumulator:
    """Observe the SSE chunks of ``stream_llm_with_fallback`` and reconstruct the
    assistant output (text + reasoning + tool calls + usage + error) for the trace.
    Parsing is best-effort; a chunk it can't read is simply ignored."""

    def __init__(self) -> None:
        self.text_parts: List[str] = []
        self.reasoning_parts: List[str] = []
        self.tool_calls: List[dict] = []
        self.usage: Optional[dict] = None
        self.error: Optional[dict] = None
        self.answered_by: Optional[str] = None
        self.finish_reason: Optional[str] = None

    def observe(self, chunk: str) -> None:
        try:
            is_error = False
            for line in str(chunk).split("\n"):
                line = line.strip()
                if line.startswith("event:"):
                    is_error = "error" in line
                    continue
                if not line.startswith("data:"):
                    continue
                body = line[5:].strip()
                if not body or body == "[DONE]":
                    continue
                try:
                    j = json.loads(body)
                except Exception:
                    continue
                if is_error or ("error" in j and "delta" not in j and j.get("type") is None):
                    self.error = j
                    continue
                t = j.get("type")
                if t == "tool_calls":
                    for c in j.get("calls") or []:
                        self.tool_calls.append(c)
                elif t == "usage":
                    self.usage = j.get("data") or j.get("usage")
                elif t == "finish":
                    # The terminal finish_reason (F-S4-D): "length" = output-cap cutoff, "error" =
                    # a mid-stream provider failure. Captured so the trace records WHY a reply ended
                    # (preserve ALL I/O — the key truncation/cutoff diagnostic).
                    self.finish_reason = j.get("reason")
                elif t == "fallback":
                    self.answered_by = j.get("answered_by")
                elif "delta" in j:
                    if j.get("thinking"):
                        self.reasoning_parts.append(str(j.get("delta") or ""))
                    else:
                        self.text_parts.append(str(j.get("delta") or ""))
        except Exception:
            pass

    def response(self) -> dict:
        return {
            "text": "".join(self.text_parts),
            "reasoning": "".join(self.reasoning_parts),
            "toolCalls": self.tool_calls,
            "usage": self.usage,
            "error": self.error,
            "answeredBy": self.answered_by,
            "finishReason": self.finish_reason,
        }


# ── the recorder ────────────────────────────────────────────────────────────────


def _clip(s: str, cap: int = 2000) -> str:
    s = s or ""
    return s if len(s) <= cap else s[:cap] + f"… [+{len(s) - cap} chars]"


# ── S6a (#1599 item 2): llmIo.ok must mean USABLE CONTENT, not HTTP 200 ──────────────
# A record is a FAILURE — regardless of the ``ok`` the caller passed — when the completion
# carries no usable content (empty text AND no tool/native call AND finish_reason != "length")
# OR when the call errored / timed out. The judge's TimeoutError was logged ok:true with a
# 12001ms duration and empty text precisely because the streaming record keyed ok solely on the
# presence of an ``error`` event; a 200-but-vanished completion slipped through as a success. The
# derived ``failClass`` (timeout | empty | 4xx | 5xx | error) is the machine-readable triage token.
_TIMEOUT_MARKERS = ("timeout", "timed out", "readtimeout", "connecttimeout",
                    "read timed out", "wait_for", "deadline")
# An EMPTY completion that took this long was almost certainly a timeout that returned nothing,
# not a fast empty "stop" — class it as a timeout so the judge's 12001ms empty record reads true.
_SLOW_EMPTY_TIMEOUT_MS = 10000
_STATUS_RE = re.compile(r"\b([45]\d\d)\b")


def _derive_fail_class(*, ok: bool, error: Any, text: str, tool_calls: Any,
                       finish_reason: Any, duration_ms: int,
                       explicit: Optional[str]) -> Optional[str]:
    """Return the failure class for a record, or ``None`` when it is a genuine success.

    Precedence: an explicit class the caller derived (e.g. the timeout it caught) always wins.
    Then an ``error`` payload is classified by shape (timeout / 4xx / 5xx / error). Finally a
    200-but-unusable completion (empty text, no tool/native call, not a length cutoff) is a
    failure — ``timeout`` if it was also slow, else ``empty``. A completion carrying real text,
    a tool call, or a length cutoff is usable ⇒ ``None``."""
    if explicit:
        return str(explicit)
    if error:
        status = None
        if isinstance(error, dict):
            status = error.get("status") or error.get("status_code") or error.get("code")
            msg = str(error.get("message") or error.get("type") or error)
        else:
            msg = str(error)
        low = msg.lower()
        if any(m in low for m in _TIMEOUT_MARKERS):
            return "timeout"
        try:
            s = int(status)
            if 400 <= s < 500:
                return "4xx"
            if 500 <= s < 600:
                return "5xx"
        except (TypeError, ValueError):
            pass
        m = _STATUS_RE.search(low)
        if m:
            return "4xx" if m.group(1)[0] == "4" else "5xx"
        return "error"
    # No error payload, but the caller still reported failure (ok=False) — a failed call must
    # always carry a machine-readable triage class, even with a non-empty / length-limited body.
    if not ok:
        return "error"
    # No error payload — but a vanished completion is NOT a success (the S6a core fix).
    if not (text or "").strip() and not tool_calls and str(finish_reason or "") != "length":
        try:
            slow = int(duration_ms) >= _SLOW_EMPTY_TIMEOUT_MS
        except (TypeError, ValueError):
            slow = False
        return "timeout" if slow else "empty"
    return None


def _system_and_last_user(messages: List[Dict]) -> tuple[str, str]:
    sys_txt, last_user = "", ""
    for m in messages or []:
        role, content = m.get("role"), m.get("content")
        if not isinstance(content, str):
            try:
                content = json.dumps(content)
            except Exception:
                content = str(content)
        if role == "system":
            sys_txt += (("\n\n" if sys_txt else "") + content)
        elif role == "user":
            last_user = content
    return sys_txt, last_user


def record_llm_call(
    *,
    kind: str,
    model: str,
    requested_model: Optional[str] = None,
    messages: Optional[List[Dict]] = None,
    tools: Optional[List[Dict]] = None,
    temperature: Any = None,
    max_tokens: Any = None,
    response: Optional[dict] = None,
    ok: bool = True,
    duration_ms: int = 0,
    call_class: Optional[str] = None,
    user: Optional[str] = None,
    fail_class: Optional[str] = None,
) -> None:
    """Persist one full request→response record (ring + on-disk archive).

    2026-07-13 (prod debug-bundle audit): each record also carries TOP-LEVEL ``finishReason``
    and ``callClass`` triage fields — the terminal stop reason used to be buried inside
    ``response`` and the ADR-0010 call class was not recorded at all, so an operator scanning
    the ring/bundle could not spot an empty ``finish_reason=stop`` utility completion without
    digging. ``call_class`` is threaded explicitly by the non-streaming chokepoint; when the
    caller passes none (the streaming path has no class parameter), it falls back to the 0112
    per-turn observability context, and stays ``None`` when genuinely unknown."""
    if not enabled():
        return
    try:
        response = response or {}
        messages = messages or []
        if call_class is None:
            # The 0112 correlation context (set by the agent loop on game turns when
            # observability is enabled) — best-effort; unknown stays None, never guessed.
            try:
                call_class = _current_context().get("call_class")
            except Exception:
                call_class = None
        req = _scrub({
            "model": model,
            "requestedModel": requested_model or model,
            "temperature": temperature,
            "maxTokens": max_tokens,
            "messages": messages,
            "tools": tools or [],
        })
        resp = _scrub({
            "text": response.get("text") or "",
            "reasoning": response.get("reasoning") or "",
            "toolCalls": response.get("toolCalls") or [],
            "usage": response.get("usage"),
            "answeredBy": response.get("answeredBy"),
            "error": response.get("error"),
            "finishReason": response.get("finishReason"),
        })
        # The owning user for #1599 per-user health scoping (explicit arg → always-on call-user
        # context → obs context). None ⇒ userless/system ⇒ the shared "default" rollup bucket.
        eff_user = _resolve_call_user(user)
        ts = int(time.time() * 1000)
        # S6a (#1599 item 2): ``ok`` must mean USABLE CONTENT — derive the true disposition from the
        # response, never from HTTP-200-ness alone. A vanished/empty completion or a timeout flips a
        # caller-passed ok=True to failed, and every failure carries a machine-readable ``failClass``.
        _fail_class = _derive_fail_class(
            ok=bool(ok), error=resp.get("error"), text=resp.get("text") or "",
            tool_calls=resp.get("toolCalls") or [], finish_reason=resp.get("finishReason"),
            duration_ms=int(duration_ms), explicit=fail_class)
        eff_ok = bool(ok) and _fail_class is None
        record = {
            "ts": ts,
            "kind": kind,
            "ok": eff_ok,
            # None on a genuine success; the triage token (timeout|empty|4xx|5xx|error) on a failure.
            "failClass": _fail_class,
            "durationMs": int(duration_ms),
            "model": model,
            # Top-level triage fields (2026-07-13): the terminal stop reason (also inside
            # `response`, kept there for back-compat) and the ADR-0010 call class. None = unknown.
            "finishReason": resp.get("finishReason"),
            "callClass": str(call_class) if call_class else None,
            # #1599 — the owning user, so the health rollup scopes per-class failure rates per user.
            "user": str(eff_user) if eff_user is not None else None,
            "request": req,
            "response": resp,
        }
        _append_trace_file(record)
        _push_ring(record, messages, resp, eff_user)
        _maybe_auto_trim()
    except Exception:
        pass  # logging must never hurt the app


def _push_ring(record: dict, messages: List[Dict], resp: dict, user: Optional[str] = None) -> None:
    try:
        from src import log_rings
        sys_txt, last_user = _system_and_last_user(messages)
        in_chars = sum(len(str(m.get("content") or "")) for m in messages)
        out_chars = len(resp.get("text") or "")
        tcs = resp.get("toolCalls") or []
        tool_suffix = (" · tools: " + ",".join(str(c.get("name") or "?") for c in tcs)) if tcs else ""
        verb = "ok" if record["ok"] else "FAILED"
        reasoning = resp.get("reasoning") or ""
        req_summary = (("sys: " + _clip(sys_txt, 800) + "\n") if sys_txt else "") + ("user: " + _clip(last_user, 1200))
        res_summary = (("[reasoning] " + _clip(reasoning, 800) + "\n") if reasoning else "") + _clip(resp.get("text") or "", 1600)
        if resp.get("error"):
            res_summary = "[error] " + _clip(json.dumps(resp.get("error")), 600)
        # 2026-07-13: surface the call class + terminal stop reason in the glanceable summary line
        # (records that predate the top-level fields simply omit them — .get, never KeyError).
        cls = record.get("callClass")
        kind_label = f"{record['kind']}[{cls}]" if cls else str(record["kind"])
        finish = record.get("finishReason") or resp.get("finishReason")
        finish_suffix = f" · finish={finish}" if finish else ""
        # S6a: surface the failure class in the glanceable line so an operator sees WHY it failed
        # (a 200-but-empty / timeout is no longer an indistinguishable "FAILED").
        fail_class = record.get("failClass")
        fail_suffix = f" · fail={fail_class}" if fail_class else ""
        log_rings.LLMIO.push({
            "ts": record["ts"],
            "level": "INFO" if record["ok"] else "ERROR",
            "logger": "llm-io",
            "msg": f"{kind_label} · {record['model']} {verb} {record['durationMs']}ms · "
                   f"in {in_chars} out {out_chars} chars{finish_suffix}{fail_suffix}{tool_suffix}",
            "args": req_summary,
            # #1599 WI2 — structured triage fields for the per-class health rollup (kept beside the
            # glanceable msg so the rollup never has to parse it): the call class, terminal stop
            # reason, the ok flag, and the owning user (so the rollup scopes per-class failure rates
            # PER USER — a failure in user A's sandbox never alarms user B). Vault-free scalars only.
            "kind": record["kind"],
            "callClass": cls,
            "finishReason": finish,
            "failClass": fail_class,
            "ok": bool(record["ok"]),
            "user": user,
            "result": res_summary,
        })
    except Exception:
        pass


# Bounded tail read when backfilling the live ring from the durable archive at startup.
_SEED_TAIL_BYTES = 512 * 1024
_ring_seeded = False


def seed_ring_from_file(limit: int = 200) -> int:
    """Backfill the in-memory LLMIO ring from the tail of the durable archive.

    The 'LLM I/O (live)' ring is per-process and in-memory, so it is EMPTY after every restart
    while llm-io.jsonl keeps the full history — which read as a bug (a blank live view beside a
    full file) and made the file a redundant second source. Seeding the ring from the archive's
    tail at startup makes the live view reflect recent history and lets the file be dropped from
    the viewer's source list (no more duplicate stream).

    Idempotent and startup-ordered: it MUST run before any record_llm_call so the seeded (older)
    entries get LOWER seq numbers than subsequent live calls. Best-effort — any failure leaves
    the ring empty rather than disturbing startup."""
    global _ring_seeded
    if _ring_seeded:
        return 0
    _ring_seeded = True
    try:
        path = trace_path()
        if not os.path.isfile(path):
            return 0
        with open(path, "rb") as fh:
            try:
                fh.seek(-_SEED_TAIL_BYTES, os.SEEK_END)
                partial = True
            except OSError:
                fh.seek(0)
                partial = False
            chunk = fh.read()
        lines = chunk.decode("utf-8", "replace").splitlines()
        if partial and len(lines) > 1:
            lines = lines[1:]  # drop the (likely truncated) first line from a mid-file seek
        n = 0
        for ln in lines[-limit:]:
            ln = ln.strip()
            if not ln:
                continue
            try:
                rec = json.loads(ln)
            except Exception:
                continue
            msgs = (rec.get("request") or {}).get("messages") or []
            resp = rec.get("response") or {}
            # Preserve the archived record's #1599 user attribution across a restart-time reseed
            # (records written before the field simply carry None ⇒ the shared "default" bucket).
            _push_ring(rec, msgs, resp, rec.get("user"))
            n += 1
        return n
    except Exception:
        return 0


def _append_trace_file(record: dict) -> None:
    try:
        line = json.dumps(record, ensure_ascii=False)
        if len(line) > _MAX_RECORD_BYTES:
            # LOSSLESS: never truncate/drop — preserve ALL I/O. Note the unusually large
            # record for operator observability, then write it whole.
            logger.warning(
                "llm-io: large trace record (%d bytes, kind=%s model=%s) — writing in full",
                len(line), record.get("kind"), record.get("model"))
        path = trace_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except Exception:
        pass


# ── retention / trim ────────────────────────────────────────────────────────────


def human_bytes(n: int) -> str:
    val = float(max(0, int(n or 0)))
    for unit in ("B", "KB", "MB", "GB"):
        if val < 1024:
            return f"{int(val)} {unit}" if unit == "B" else f"{val:.1f} {unit}"
        val /= 1024.0
    return f"{val:.1f} TB"


def _all_log_paths() -> List[str]:
    """Every on-disk log this surface manages: the top-level data-dir logs
    (``*.log`` / ``*.jsonl``) plus everything under ``data/logs/``."""
    paths: List[str] = []
    try:
        for n in sorted(os.listdir(_data_dir())):
            if n.endswith((".log", ".jsonl")):
                p = os.path.join(_data_dir(), n)
                if os.path.isfile(p):
                    paths.append(p)
    except OSError:
        pass
    try:
        sub = _logs_subdir()
        for n in sorted(os.listdir(sub)):
            p = os.path.join(sub, n)
            if os.path.isfile(p):
                paths.append(p)
    except OSError:
        pass
    return paths


def log_inventory() -> List[dict]:
    out = []
    for p in _all_log_paths():
        try:
            stt = os.stat(p)
            out.append({"name": os.path.basename(p), "bytes": stt.st_size,
                        "mtime": int(stt.st_mtime * 1000)})
        except OSError:
            pass
    return out


def total_log_bytes() -> int:
    total = 0
    for p in _all_log_paths():
        try:
            total += os.path.getsize(p)
        except OSError:
            pass
    return total


def _entry_ts_ms(j: dict) -> Optional[int]:
    ts = j.get("ts")
    if ts is None:
        return None
    try:
        ts = float(ts)
    except (TypeError, ValueError):
        return None
    return int(ts if ts > 1e12 else ts * 1000)  # tolerate seconds-vs-ms


def _trim_jsonl(path: str, cutoff_ms: int) -> None:
    """Rewrite a JSONL log keeping only entries newer than the cutoff. Lines with
    no parseable ``ts`` are kept (conservative — never destroy unknown data)."""
    kept: List[str] = []
    changed = False
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            s = line.rstrip("\n")
            if not s.strip():
                continue
            try:
                j = json.loads(s)
                tsm = _entry_ts_ms(j) if isinstance(j, dict) else None
            except Exception:
                tsm = None
            if tsm is not None and tsm < cutoff_ms:
                changed = True
                continue
            kept.append(s)
    if not changed:
        return
    tmp = path + ".trim.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        if kept:
            fh.write("\n".join(kept) + "\n")
    os.replace(tmp, path)


def trim_logs(days: Optional[int] = None) -> dict:
    """Trim all managed logs to the given horizon (defaults to the configured
    retention). ``days <= 0`` ⇒ keep everything (a no-op that still reports size).

    JSONL logs are trimmed per-entry by timestamp; plain ``.log`` files whose whole
    file is older than the horizon (nothing written within it) are truncated."""
    horizon = retention_days() if days is None else int(days)
    before = total_log_bytes()
    if horizon and horizon > 0:
        cutoff_ms = int((time.time() - horizon * 86400) * 1000)
        for p in _all_log_paths():
            try:
                if p.endswith(".jsonl"):
                    _trim_jsonl(p, cutoff_ms)
                elif p.endswith(".log"):
                    if os.path.getmtime(p) * 1000 < cutoff_ms and os.path.getsize(p) > 0:
                        open(p, "w").close()  # stale whole file → truncate
            except OSError:
                pass
    after = total_log_bytes()
    return {
        "horizonDays": horizon,
        "beforeBytes": before,
        "afterBytes": after,
        "removedBytes": max(0, before - after),
        "totalBytes": after,
        "totalHuman": human_bytes(after),
        "files": log_inventory(),
    }


# Opportunistic auto-trim: no separate scheduler — piggyback on the write path,
# throttled so the rewrite cost is amortized to roughly once an hour.
_auto_lock = threading.Lock()
_auto_count = 0
_auto_last = 0.0
_AUTO_EVERY = 100        # records
_AUTO_MIN_INTERVAL = 1800.0  # seconds


def _maybe_auto_trim() -> None:
    global _auto_count, _auto_last
    try:
        with _auto_lock:
            _auto_count += 1
            now = time.monotonic()
            due = _auto_count % _AUTO_EVERY == 0 and (now - _auto_last) >= _AUTO_MIN_INTERVAL
            if not due:
                return
            _auto_last = now
        if retention_days() > 0:
            threading.Thread(target=lambda: trim_logs(None), daemon=True).start()
    except Exception:
        pass


# ══════════════════════════════════════════════════════════════════════════════════
# Feature 0112 — LLM-call observability (Vault-free trace tagging + opt-in forwarding)
# ══════════════════════════════════════════════════════════════════════════════════
#
# The *external, queryable* counterpart to the in-process I/O trace above and 0079's
# internal diagnostic log. Every LLM call can emit a **Vault-free** ``TraceRecord`` — the
# existing token-ledger facts (0069) PLUS the 0065 correlation keys (``beatSeq``/``phase``/
# ``moment``/``call_class``/``session``/``user``) — and, when enabled, tags the OpenRouter
# request with those same keys so **OpenRouter Broadcast** (or an opt-in OTLP/Langfuse sink)
# forwards correlatable traces off-box.
#
# Everything here is **opt-in, fail-soft, and byte-identical when unconfigured**:
#   * ``observability_enabled`` defaults **false** ⇒ no request ``metadata``, the no-op sink.
#   * The record builder reads NEITHER the Vault store NOR the soul provider — the FE has no
#     Vault handle at all, and every field is a closed-set / projection scalar. A structural
#     test asserts the serialized record (and the request metadata) match no Vault key.
#   * ``privacy_mode`` defaults ``metrics-only`` ⇒ NO prompt/completion content is forwarded.
#   * The sink (``src/trace_sink.py``) swallows every error/timeout — telemetry never touches
#     the turn.
#
# See docs/features/0112-llm-call-observability.{md,feature}.

import contextvars
import hashlib

# The Vault/soul key denylist — the SAME class of guard as the engine ``secrets.test.ts`` and
# the FE redaction gates. A serialized ``TraceRecord`` / request ``metadata`` object must match
# none of these as a (case-insensitive) key. These are engine-internal hidden-layer names that
# a Vault-free projection can never legitimately carry.
_VAULT_KEYS = (
    "soul", "trust", "threat", "affinity", "hidden", "target",
    "relationship", "grudge", "scheme", "confession",
)

# The privacy modes. ``metrics-only`` (the default) strips prompt/completion content; ``full`` is
# an explicit operator opt-in that additionally carries the (already Vault-free) prompt/completion.
_PRIVACY_METRICS_ONLY = "metrics-only"
_PRIVACY_FULL = "full"
_VALID_PRIVACY_MODES = (_PRIVACY_METRICS_ONLY, _PRIVACY_FULL)

# The per-turn correlation context. A caller (the agent loop / chat route, or a test/harness) MAY
# set the current beat's keys here; llm_core reads them at the single emit point. Unset ⇒ empty
# ⇒ the record carries only what llm_core already knows (model/usage/session) and no metadata is
# attached (still byte-identical, since the enable gate defaults off). A ``ContextVar`` is
# task-local, so concurrent turns never cross their correlation keys.
_OBS_CONTEXT: "contextvars.ContextVar[dict]" = contextvars.ContextVar("orwell_obs_context", default={})


# ── settings (read per-request; no restart — mirrors the token_policy / _resolve_llm_fn seam) ──


def observability_enabled() -> bool:
    """The master gate — default **false**. Off ⇒ no request metadata, the no-op sink."""
    try:
        from src.settings import get_setting
        return bool(get_setting("observability_enabled", False))
    except Exception:
        return False


def observability_privacy_mode() -> str:
    """``metrics-only`` (default; strips content) or ``full`` (explicit opt-in). An
    unrecognized value falls back to the safe default (never accidentally forward content)."""
    try:
        from src.settings import get_setting
        v = get_setting("observability_privacy_mode", _PRIVACY_METRICS_ONLY)
        return v if v in _VALID_PRIVACY_MODES else _PRIVACY_METRICS_ONLY
    except Exception:
        return _PRIVACY_METRICS_ONLY


def observability_sampling() -> float:
    """The sampling rate in [0.0, 1.0] (default 1.0). Out-of-band / unusable ⇒ 1.0."""
    try:
        from src.settings import get_setting
        v = float(get_setting("observability_sampling", 1.0))
        if not (0.0 <= v <= 1.0):
            return 1.0
        return v
    except Exception:
        return 1.0


# ── correlation context ──────────────────────────────────────────────────────────


def set_observability_context(**keys: Any) -> "contextvars.Token":
    """Set the current beat's correlation keys (``beat_seq``/``phase``/``moment``/``call_class``/
    ``session``/``user``) for the trace built at the emit point. Returns the reset token. Callers
    that set this SHOULD ``reset_observability_context(token)`` when the turn ends. All keys are
    Vault-free closed-set/projection facts by contract; a caller cannot smuggle a Vault field
    through — the record builder only reads the known scalar keys below."""
    ctx = {k: v for k, v in keys.items() if v is not None}
    return _OBS_CONTEXT.set(ctx)


def reset_observability_context(token: "contextvars.Token") -> None:
    try:
        _OBS_CONTEXT.reset(token)
    except Exception:
        pass


def _current_context() -> dict:
    try:
        c = _OBS_CONTEXT.get()
        return dict(c) if isinstance(c, dict) else {}
    except Exception:
        return {}


# ── always-on call-user attribution (independent of the observability gate) ──────────
# The 0112 observability context above is only populated when observability is ENABLED
# (default off). But the LLMIO ring is ALWAYS written, and the #1599 health rollup scopes
# its per-class failure rates (and the narration-failure RED alarm) PER USER — so a call's
# owning user must be attributable even with observability off. This dedicated ContextVar
# is set by the agent-loop turn wrapper for every game turn (regardless of the obs gate) and
# read at the single record point, so a narration failure in user A's sandbox can never raise
# a RED alarm in user B's /api/admin/health (cross-user isolation). Task-local ⇒ concurrent
# turns never cross users. Unset/system call ⇒ None ⇒ the shared "default" bucket, which never
# leaks to a NAMED user.
_CALL_USER: "contextvars.ContextVar[Optional[str]]" = contextvars.ContextVar(
    "orwell_llm_call_user", default=None)


def set_call_user(user: Optional[str]) -> "contextvars.Token":
    """Bind the current turn's owning user for LLM-call attribution. Returns the reset token."""
    return _CALL_USER.set(user)


def reset_call_user(token: "contextvars.Token") -> None:
    try:
        _CALL_USER.reset(token)
    except Exception:
        pass


def _resolve_call_user(explicit: Optional[str]) -> Optional[str]:
    """The owning user for an LLM-call record: an explicit arg wins, else the always-on
    call-user context, else the 0112 obs context (when enabled). None ⇒ userless/system."""
    if explicit is not None:
        return explicit
    try:
        u = _CALL_USER.get()
        if u is not None:
            return u
    except Exception:
        pass
    try:
        return _current_context().get("user")
    except Exception:
        return None


# ── sampling (deterministic by session) ────────────────────────────────────────────


def session_sampled(session: Any, rate: float) -> bool:
    """Whether ``session`` is sampled — a **deterministic** function of its id, so a given game is
    consistently in or out of the sample (never a per-call coin-flip). ``rate>=1`` ⇒ always;
    ``rate<=0`` ⇒ never. Mirrors the same discipline as the 0065 idempotency keying."""
    try:
        if rate >= 1.0:
            return True
        if rate <= 0.0:
            return False
        h = hashlib.sha256(str(session or "").encode("utf-8")).hexdigest()
        # First 8 hex digits → a stable [0,1) fraction; sampled iff below the rate.
        frac = int(h[:8], 16) / 0xFFFFFFFF
        return frac < rate
    except Exception:
        return False


# ── the Vault-free record + request metadata ───────────────────────────────────────


def _usage_counts(usage: Optional[dict]) -> dict:
    """Extract the Vault-free token counts + cost + provider from a usage envelope (the same
    shape the token ledger consumes). Absent/garbage ⇒ zeros."""
    u = usage if isinstance(usage, dict) else {}
    # Support both the streamed {input_tokens,...} shape and the raw OpenAI {prompt_tokens,...}.
    ptd = u.get("prompt_tokens_details") or {}
    ctd = u.get("completion_tokens_details") or {}
    def _i(*keys):
        for k in keys:
            v = u.get(k)
            if isinstance(v, (int, float)):
                return int(v)
        return 0
    return {
        "input_tokens": _i("input_tokens", "prompt_tokens"),
        "cached_tokens": (u.get("cached_tokens") if isinstance(u.get("cached_tokens"), (int, float))
                          else ptd.get("cached_tokens", 0)) or 0,
        "output_tokens": _i("output_tokens", "completion_tokens"),
        "reasoning_tokens": (u.get("reasoning_tokens") if isinstance(u.get("reasoning_tokens"), (int, float))
                             else ctd.get("reasoning_tokens", 0)) or 0,
        "cost": float(u.get("cost") or 0.0),
        "provider": u.get("provider"),
    }


def build_trace_record(
    *,
    user: Any = None,
    session: Any = None,
    call_class: Any = None,
    model: Any = None,
    beat_seq: Any = None,
    phase: Any = None,
    moment: Any = None,
    usage: Optional[dict] = None,
    applied_max_tokens: Any = None,
    finish_reason: Any = None,
    tool_call_seen: bool = False,
    latency_ms: Any = 0,
    status: str = "ok",
    privacy_mode: Optional[str] = None,
    prompt: Any = None,
    completion: Any = None,
) -> dict:
    """Build ONE Vault-free ``TraceRecord`` from facts llm_core already holds.

    Every field is a closed-set / projection scalar (token counts, cost, ids, the 0065
    correlation keys). The builder reads NEITHER ``VaultStore`` NOR ``SoulProvider`` (the FE
    holds no Vault handle) — the guarantee is structural, not by wording. ``prompt``/``completion``
    are included ONLY in ``full`` privacy mode (default ``metrics-only`` ⇒ no content)."""
    mode = privacy_mode if privacy_mode in _VALID_PRIVACY_MODES else _PRIVACY_METRICS_ONLY
    counts = _usage_counts(usage)
    record = {
        "ts": int(time.time() * 1000),
        "user": _obs_id(user),
        "session": _obs_id(session),
        "call_class": _obs_id(call_class),
        "model": _obs_id(model),
        # 0065 correlation keys — the engine already issues these; the FE forwards them.
        "beatSeq": _obs_int_or_none(beat_seq),
        "phase": _obs_id(phase),
        "moment": _obs_id(moment),
        # token-ledger facts (0069)
        "input_tokens": _obs_int(counts["input_tokens"]),
        "cached_tokens": _obs_int(counts["cached_tokens"]),
        "output_tokens": _obs_int(counts["output_tokens"]),
        "reasoning_tokens": _obs_int(counts["reasoning_tokens"]),
        "applied_max_tokens": _obs_int_or_none(applied_max_tokens),
        "cost": _obs_float(counts["cost"]),
        "finish_reason": _obs_id(finish_reason),
        "tool_call_seen": bool(tool_call_seen),
        "latency_ms": _obs_int(latency_ms),
        "status": _obs_id(status) or "ok",
    }
    if mode == _PRIVACY_FULL:
        # Content is already Vault-free (the narrator only ever receives Vault-free projections),
        # but it is the player's private game text — carried ONLY on the explicit ``full`` opt-in.
        # Scrubbed for secret-shaped tokens as defence in depth (same as the I/O trace).
        record["prompt"] = _scrub_str(str(prompt or ""))
        record["completion"] = _scrub_str(str(completion or ""))
    return record


def request_metadata(*, session: Any = None, beat_seq: Any = None, phase: Any = None,
                     call_class: Any = None) -> dict:
    """The Vault-free ``metadata`` object attached to the OpenRouter (OpenAI-compatible) payload
    when tagging is enabled — the correlation keys OpenRouter Broadcast forwards. Absent ⇒ the
    payload is byte-identical to today (the caller only attaches this when observability is on)."""
    return {
        "orwell_session": _obs_id(session),
        "beatSeq": _obs_int_or_none(beat_seq),
        "phase": _obs_id(phase),
        "call_class": _obs_id(call_class),
    }


def maybe_request_metadata(*, session: Any = None, call_class: Any = None,
                           beat_seq: Any = None, phase: Any = None) -> Optional[dict]:
    """Return the request ``metadata`` object IFF observability is enabled, else ``None`` (so the
    caller omits the key entirely ⇒ byte-identical payload). Missing correlation keys are pulled
    from the per-turn context set by the caller. Fail-open: any error ⇒ ``None`` (no metadata).

    ``session`` precedence: the per-turn CONTEXT session wins when set. The agent loop stashes the
    0064 canonical game session there; a caller (llm_core) may pass its own FE chat session_id, but on
    a game turn the canonical must win so every device on one game correlates (distinct chat ids, one
    canonical id). With no context session set, the explicit arg is used (byte-identical when off/idle)."""
    try:
        if not observability_enabled():
            return None
        ctx = _current_context()
        _ctx_session = ctx.get("session")
        return request_metadata(
            session=_ctx_session if _ctx_session not in (None, "") else session,
            beat_seq=beat_seq if beat_seq is not None else ctx.get("beat_seq"),
            phase=phase if phase is not None else ctx.get("phase"),
            call_class=call_class if call_class is not None else ctx.get("call_class"),
        )
    except Exception:
        return None


# ── coercion helpers (the Vault-free floor, mirroring orwell_token_ledger) ──────────

_OBS_MAX_ID_LEN = 120


def _obs_id(v: Any) -> str:
    if v is None:
        return ""
    try:
        return str(v)[:_OBS_MAX_ID_LEN]
    except Exception:
        return ""


def _obs_int(v: Any) -> int:
    try:
        n = int(v)
    except (TypeError, ValueError):
        return 0
    return n if n >= 0 else 0


def _obs_int_or_none(v: Any) -> Optional[int]:
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _obs_float(v: Any) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0.0
    return f if f >= 0.0 else 0.0


def record_is_vault_free(record: Any) -> bool:
    """Structural gate: True iff the serialized record/metadata matches NO Vault key (as a JSON
    object key). The same class of assertion as the engine ``secrets.test.ts`` — used by the 0112
    Vault-free test and safe to call defensively anywhere. Checks KEYS recursively (values are
    closed-set scalars / already-Vault-free content)."""
    try:
        return not _has_vault_key(record)
    except Exception:
        return True


def _has_vault_key(obj: Any) -> bool:
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(k, str):
                kl = k.lower()
                if any(vk in kl for vk in _VAULT_KEYS):
                    return True
            if _has_vault_key(v):
                return True
        return False
    if isinstance(obj, list):
        return any(_has_vault_key(v) for v in obj)
    return False


# ── divergence detection (the F16 reach — expressible from the record alone) ────────

# Eviction-result phrasings a narration might assert. The point (0112 scenario 7) is that with the
# ``phase`` correlation key in the record, "the narration claims an eviction while the engine is at
# phase:veto-competition" becomes a QUERY over stored records — not something only a live drive finds.
_EVICTION_ASSERTION_RE = re.compile(
    r"\b(has been evicted|is evicted|evicted from the (house|big brother)|"
    r"eviction (is )?(complete|final)|the votes are in|by a vote of)\b",
    re.IGNORECASE,
)
_EVICTION_PHASES = ("eviction", "eviction-vote", "eviction-results", "live-eviction")


def record_asserts_eviction(record: dict) -> bool:
    """True iff the record's ``completion`` asserts an eviction result (full privacy mode only —
    metrics-only carries no completion, so this is vacuously False there)."""
    try:
        completion = (record or {}).get("completion") or ""
        return bool(_EVICTION_ASSERTION_RE.search(str(completion)))
    except Exception:
        return False


def record_is_eviction_phase(record: dict) -> bool:
    try:
        phase = str((record or {}).get("phase") or "").lower()
        return any(p in phase for p in _EVICTION_PHASES)
    except Exception:
        return False


def record_shows_divergence(record: dict) -> bool:
    """True iff the record shows a model-vs-engine divergence detectable from its OWN fields: the
    completion asserts an eviction result while the engine ``phase`` is NOT an eviction phase. This
    is the F16-class alert made queryable by the correlation metadata."""
    return record_asserts_eviction(record) and not record_is_eviction_phase(record)


# ── the emit point (fail-soft, best-effort, sampled) ────────────────────────────────


async def emit_trace(
    *,
    user: Any = None,
    session: Any = None,
    call_class: Any = None,
    model: Any = None,
    usage: Optional[dict] = None,
    applied_max_tokens: Any = None,
    finish_reason: Any = None,
    tool_call_seen: bool = False,
    latency_ms: Any = 0,
    status: str = "ok",
    beat_seq: Any = None,
    phase: Any = None,
    moment: Any = None,
    prompt: Any = None,
    completion: Any = None,
) -> None:
    """The single 0112 emit point (called from ``src/llm_core.py``'s traced chokepoints).

    Fail-soft, best-effort, and byte-identical when unconfigured:
      * ``observability_enabled`` off (the default) ⇒ instant return, nothing built or shipped.
      * Sampling (deterministic by session) is applied BEFORE building the record.
      * The record is built Vault-free; ``privacy_mode`` gates content.
      * The resolved sink emits it; ANY error/timeout in the sink is swallowed (a failing sink
        never harms the turn — 0112 scenario "a failing sink never harms the turn").

    Missing correlation keys are pulled from the per-turn context; ``beat_seq`` additionally falls
    back to the FE's last-seen 0065 beatSeq for the session's owner (best-effort).

    ``session`` precedence: the per-turn CONTEXT session wins when set (the agent loop stashes the 0064
    canonical game session there), so a game turn correlates to the canonical id even though the emit
    caller passes its own FE chat session_id. With no context session, the explicit arg is used."""
    try:
        if not observability_enabled():
            return
        ctx = _current_context()
        _ctx_session = ctx.get("session")
        _session = _ctx_session if _ctx_session not in (None, "") else session
        rate = observability_sampling()
        if not session_sampled(_session, rate):
            return
        mode = observability_privacy_mode()
        record = build_trace_record(
            user=user if user is not None else ctx.get("user"),
            session=_session,
            call_class=call_class if call_class is not None else ctx.get("call_class"),
            model=model,
            beat_seq=beat_seq if beat_seq is not None else ctx.get("beat_seq"),
            phase=phase if phase is not None else ctx.get("phase"),
            moment=moment if moment is not None else ctx.get("moment"),
            usage=usage,
            applied_max_tokens=applied_max_tokens,
            finish_reason=finish_reason,
            tool_call_seen=tool_call_seen,
            latency_ms=latency_ms,
            status=status,
            privacy_mode=mode,
            prompt=prompt if mode == _PRIVACY_FULL else None,
            completion=completion if mode == _PRIVACY_FULL else None,
        )
        from src.trace_sink import resolve_trace_sink
        sink = resolve_trace_sink()
        await sink.emit(record)
    except Exception:
        # Observability must NEVER hurt the app — swallow everything (incl. a throwing sink).
        return None
