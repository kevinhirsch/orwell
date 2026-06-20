"""G1b — the in-process log rings behind the /admin/status live viewer.

Three observable streams, all capped, all read-only at the surface:

  LIVE   — the front-end tier's own logging (a root-logger handler; includes the
           0051 portrait lines that used to vanish into the console).
  IO     — the Engine I/O tap: every tool call the front end makes to the game
           engine — name, args, outcome (ok / error class), duration, and a
           truncated result/error payload. Admin-gated at the route like the
           0053 transcripts (ruling #14: tool-call nodes are an accepted
           operator capability); the PLAYER channel is Vault-free by
           construction, so nothing hidden can transit this tap.
  FILES  — on-disk logs under the data dir (portrait-log.jsonl, install.log,
           any *.log/*.jsonl), tailed by byte offset with a strict
           basename allowlist (no traversal).

Logging must never hurt the app: every writer swallows its own errors.
"""

import collections
import logging
import threading

_CAP = 2000
_PAYLOAD_CAP = 2048


class Ring:
    def __init__(self):
        self.buf = collections.deque(maxlen=_CAP)
        self.seq = 0
        self.lock = threading.Lock()

    def push(self, entry: dict) -> None:
        try:
            with self.lock:
                self.seq += 1
                entry["seq"] = self.seq
                self.buf.append(entry)
        except Exception:
            pass

    def since(self, cursor: int, limit: int = 500):
        with self.lock:
            return self.seq, [e for e in self.buf if e["seq"] > cursor][-limit:]


LIVE = Ring()
IO = Ring()
# LLMIO — the full LLM I/O trace tap (src/llm_trace.py): one entry per model call,
# carrying a glanceable summary in `msg` + the (clipped) request/response in
# args/result for the live viewer. The full-fidelity record is persisted to
# data/llm-io.jsonl (durable, retention-governed); this ring is the live tail.
# Vault-free by construction — the FE only ever holds visible projections, and the
# recorder never receives auth headers / api keys.
LLMIO = Ring()


class _RingHandler(logging.Handler):
    def emit(self, record):
        try:
            LIVE.push({
                "ts": int(record.created * 1000),
                "level": record.levelname,
                "logger": record.name,
                "msg": self.format(record),
            })
        except Exception:
            pass


def ensure_live_handler() -> None:
    root = logging.getLogger()
    if any(isinstance(h, _RingHandler) for h in root.handlers):
        return
    h = _RingHandler()
    h.setFormatter(logging.Formatter("%(message)s"))
    h.setLevel(logging.INFO)
    root.addHandler(h)
    # The commission is "watch what is written": INFO is where the program
    # narrates itself (the portrait pipeline, route notes). A default-WARNING
    # root would drop those before any handler sees them.
    if root.getEffectiveLevel() > logging.INFO:
        root.setLevel(logging.INFO)


def _clip(v) -> str:
    try:
        s = v if isinstance(v, str) else repr(v)
    except Exception:
        return "<unrepresentable>"
    return s if len(s) <= _PAYLOAD_CAP else s[:_PAYLOAD_CAP] + f"… [+{len(s) - _PAYLOAD_CAP} chars]"


def record_io(tool: str, args, ok: bool, duration_ms: int, payload) -> None:
    """One Engine I/O entry per tool call — what was written, what came back."""
    import time as _t
    IO.push({
        "ts": int(_t.time() * 1000),
        "level": "INFO" if ok else "ERROR",
        "logger": "engine-io",
        "msg": f"{tool} {'ok' if ok else 'FAILED'} {duration_ms}ms",
        "tool": tool,
        "ok": ok,
        "durationMs": duration_ms,
        "args": _clip(args),
        "result": _clip(payload),
    })


ensure_live_handler()
