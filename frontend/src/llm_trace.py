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
    line, governed by retention (auto-trimmed + the manual "Trim now" button).

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
# Safety ceiling per persisted record (the full system prompt is large; retention
# governs aggregate size, this only stops one pathological call from exploding).
_MAX_RECORD_BYTES = 512 * 1024


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
        }


# ── the recorder ────────────────────────────────────────────────────────────────


def _clip(s: str, cap: int = 2000) -> str:
    s = s or ""
    return s if len(s) <= cap else s[:cap] + f"… [+{len(s) - cap} chars]"


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
) -> None:
    """Persist one full request→response record (ring + on-disk archive)."""
    if not enabled():
        return
    try:
        response = response or {}
        messages = messages or []
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
        })
        ts = int(time.time() * 1000)
        record = {
            "ts": ts,
            "kind": kind,
            "ok": bool(ok),
            "durationMs": int(duration_ms),
            "model": model,
            "request": req,
            "response": resp,
        }
        _append_trace_file(record)
        _push_ring(record, messages, resp)
        _maybe_auto_trim()
    except Exception:
        pass  # logging must never hurt the app


def _push_ring(record: dict, messages: List[Dict], resp: dict) -> None:
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
        log_rings.LLMIO.push({
            "ts": record["ts"],
            "level": "INFO" if record["ok"] else "ERROR",
            "logger": "llm-io",
            "msg": f"{record['kind']} · {record['model']} {verb} {record['durationMs']}ms · "
                   f"in {in_chars} out {out_chars} chars{tool_suffix}",
            "args": req_summary,
            "result": res_summary,
        })
    except Exception:
        pass


def _append_trace_file(record: dict) -> None:
    try:
        line = json.dumps(record, ensure_ascii=False)
        if len(line) > _MAX_RECORD_BYTES:
            # Trim the heaviest fields rather than drop the record entirely.
            record = dict(record)
            record["request"] = {"truncated": True, "model": record.get("model")}
            record["response"] = {"truncated": True}
            line = json.dumps(record, ensure_ascii=False)
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
