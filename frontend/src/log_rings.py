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

OVERSEER = Ring()
# OVERSEER — feature 0079: the runtime loop overseer's diagnostic log. One entry per wake
# or correction — the trigger symptom, a one-line diagnosis, the lever pulled, and the 0065
# beatSeq before->after. It is the INTERPRETATION layer over the raw LIVE/IO/LLMIO rings
# (those say WHAT happened; this says what it MEANT and whether it was a problem) and the
# overseer's own audit trail. Surfaced as the "Overseer (live)" admin log source. Vault-free
# by construction — the FE only ever holds Vault-free projections, and record_overseer
# coerces/clips every field, so no narration body, casting answer, or engine secret can land.
_OVERSEER_LEVELS = ("observation", "action", "anomaly", "escalation")


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


def record_overseer(level, kind, diagnosis, *, lever=None,
                    beat_before=None, beat_after=None, ok=True, user=None) -> None:
    """Feature 0079 — one runtime-overseer diagnostic entry: what woke it, what it concluded,
    what it did. Vault-free BY CONSTRUCTION — callers pass only ids / kinds / counts / a short
    diagnosis built from them (never a narration body, casting answer, or engine secret); the
    free-text diagnosis is clipped. Swallows its own errors (logging must never hurt the app).

      level     observation | action | anomaly | escalation  (anything else -> observation)
      kind      the trigger symptom or correction class (a short token)
      diagnosis one short human line (clipped)
      lever     the action taken (hold | nudge | force-advance | propose-record |
                reinject-delta | escalate | a guardrail name) or None
      beat_*    the 0065 beatSeq around the action (coerced to int | None)
      ok        did the lever apply cleanly (drives the display severity)
    """
    try:
        import time as _t
        lvl = level if level in _OVERSEER_LEVELS else "observation"
        # Display severity for the viewer's colouring; the semantic class stays in overseerLevel.
        severity = "ERROR" if (not ok or lvl == "escalation") else ("WARNING" if lvl == "anomaly" else "INFO")

        def _beat(v):
            try:
                return int(v)
            except (TypeError, ValueError):
                return None

        OVERSEER.push({
            "ts": int(_t.time() * 1000),
            "level": severity,
            "logger": "overseer",
            "msg": f"[{lvl}] {_clip(kind)}: {_clip(diagnosis)}",
            "overseerLevel": lvl,
            "kind": _clip(kind),
            "diagnosis": _clip(diagnosis),
            "lever": _clip(lever) if lever is not None else None,
            "beatBefore": _beat(beat_before),
            "beatAfter": _beat(beat_after),
            "ok": bool(ok),
            "user": _clip(user) if user is not None else None,
        })
    except Exception:
        pass


# The disposition marker the health rollup / RED-alarm builder keys on to tell an
# auto-corrected soft failure from an uncorrected one. Kept as a literal so both the
# recorder and the reader (routes/admin_health_routes.py) agree by construction.
SOFT_FAIL_AUTOCORRECTED = "auto-corrected"
SOFT_FAIL_UNCORRECTED = "uncorrected"

_soft_fail_logger = logging.getLogger("orwell.softfail")


def record_soft_failure(anomaly_class, exc, *, corrected=None, **ctx) -> None:
    """#1599 — the ONE no-silent-fail-soft recorder. Promotes the reference pattern
    (``faithfulness._record_faith_guard_down``) to a shared seam every class-A swallow wires
    through BEFORE it falls to its deterministic floor / hold:

      1. WARN-log the genuine failure FIRST — class + error (+ correction + any context) — so
         even a telemetry-write failure below can never make the diagnosis fully invisible.
      2. Record a RED-eligible health event via :func:`record_overseer` with ``ok=False`` — RED on
         /admin/status. The disposition is annotated: ``auto-corrected by <corrected>`` when a
         belt/lever/floor corrected it, else ``uncorrected``. **A correction is NOT a cloak** — an
         auto-corrected fault is still RED (owner ruling 2026-07-14, issue #1599).
      3. If step 2's write itself fails, demote it to DEBUG AFTER the WARN — never raise.

    Fail-safe by construction (logging must never hurt a turn): every step is best-effort and this
    function never propagates an exception.

      anomaly_class  the failure class token (namespaced, e.g. ``overseer:judge-call-failed`` /
                     ``faith:gate-error`` / ``enrichment:cast-authoring``).
      exc            the caught exception (or a short reason string) — formatted into the diagnosis.
      corrected      the belt/lever/floor that auto-corrected the fault (drives the disposition +
                     the ``lever`` field), or None ⇒ ``uncorrected``.
      ctx            extra Vault-free scalars folded into the diagnosis (pass ``user=`` to key the
                     overseer entry to a user).
    """
    try:
        if isinstance(exc, BaseException):
            err_txt = f"{type(exc).__name__}: {exc}"
        else:
            err_txt = str(exc)
    except Exception:
        err_txt = "<unrepresentable error>"
    disposition = (f"{SOFT_FAIL_AUTOCORRECTED} by {corrected}"
                   if corrected else SOFT_FAIL_UNCORRECTED)
    user = ctx.pop("user", None) if ctx else None
    ctx_txt = ""
    if ctx:
        try:
            ctx_txt = " " + " ".join(f"{k}={v}" for k, v in ctx.items())
        except Exception:
            ctx_txt = ""
    diagnosis = f"{anomaly_class} — {err_txt} [{disposition}]{ctx_txt}"

    warned = False
    try:
        _soft_fail_logger.warning("[orwell] soft-fail %s", diagnosis)
        warned = True
    except Exception:
        # The logger itself is unavailable — nowhere left to write. Terminal (this guards the
        # LOGGING path, per "logging must never hurt the app"), not a swallowed business error.
        pass
    try:
        record_overseer("anomaly", anomaly_class, diagnosis,
                        lever=corrected, ok=False, user=user)
    except Exception as _rec_err:
        # The RED health-event write failed — but the WARN above already surfaced the diagnosis,
        # so this is NOT the silent-fail #1599 bans. Note the telemetry-write failure at DEBUG.
        if warned:
            try:
                _soft_fail_logger.debug(
                    "[orwell] soft-fail health-event write failed: %s", _rec_err)
            except Exception:
                pass


ensure_live_handler()
