"""Enrichment runtime policy (owner directive 2026-07-11) — ``soft`` vs ``strict``.

The FE's model-driven ENRICHMENT lanes — cast authoring (0058), cast identity (#544), the cast
pre-warm (0065), the move-in zeitgeist (0062), and off-screen texture (0070) — were historically
FAIL-SOFT: no model / a failed call / garbage output ⇒ a silent skip, and the engine's deterministic
floor stands. That silence has a documented failure class (``recordCastProfile`` and
``recordWorldSnapshot`` silently no-op'd for weeks — the CLAUDE.md four-place write-back story; the
0/15-authored floor season the #1313 gate chased). This module is the ONE policy switch that makes
those runtime failures LOUD:

  * ``soft``   — the legacy behavior, byte-for-byte: enrichment degrades silently and the
    deterministic floor stands (the test lanes + the golden driver pin this).
  * ``strict`` — the shipped DEFAULT: an unconfigured class REFUSES game creation loudly (a clear,
    player-visible error naming the unwired class), a failing call is retried (bounded) and then
    surfaces a loud error, and every failure lands in the admin-visible failure ledger below.

HARD boundaries: the ENGINE's deterministic-floor code is untouched — this is FE runtime policy
only; the narrator call path (already load-bearing/loud) is out of scope.

Resolution order (read per-request — no restart, mirroring the token-policy knobs):
  1. the runtime-editable settings key ``enrichment_policy`` ("soft" | "strict");
  2. the env seed ``ORWELL_ENRICHMENT_POLICY`` (pinned "soft" by the FE test suite's conftest, the
     golden driver, and the smoke/browser/responsive harnesses — the stubbed lanes must keep the
     legacy fail-soft contracts byte-identical);
  3. the code default: ``strict``.
"""
from __future__ import annotations

import os
import time
from typing import Optional

try:  # the structured logger if present; a no-op stand-in keeps this importable in isolation
    from loguru import logger
except Exception:  # pragma: no cover
    class _L:  # minimal fallback
        def info(self, *a, **k): pass
        def warning(self, *a, **k): pass
        def error(self, *a, **k): pass
        def debug(self, *a, **k): pass
    logger = _L()

ENV_VAR = "ORWELL_ENRICHMENT_POLICY"
VALID_POLICIES = ("soft", "strict")
DEFAULT_POLICY = "strict"

#: The enrichment call classes this policy governs — every `_resolve_llm_fn` fail-soft site.
#: (`cast-prewarm` rides the `cast-authoring` resolver; it is listed for its engine pre-seed seam.
#: `cast-genesis` (0116) is the model-authored cast SKELETON — it too rides the cast-authoring
#: narration resolver, and its loud pre-finalize gate reads the strict-failed latch in
#: `orwell_cast_genesis`.)
CALL_CLASSES = ("cast-authoring", "cast-identity", "cast-prewarm", "cast-genesis", "zeitgeist",
                "offscreen-texture")

# ── the loud failure ledger (admin-visible; in-process, bounded) ───────────────────────────
_MAX_FAILURES_PER_USER = 50
_FAILURES: dict = {}  # user_key -> list[{at, callClass, reason, detail}]


def _key(user: Optional[str]) -> str:
    return str(user) if user else "default"


def current_policy() -> str:
    """The resolved enrichment policy: settings key → env seed → the ``strict`` default.
    Defensive throughout — a malformed value at any tier falls through to the next."""
    try:
        from src.settings import get_setting
        v = str(get_setting("enrichment_policy", "") or "").strip().lower()
        if v in VALID_POLICIES:
            return v
    except Exception:
        pass
    v = str(os.environ.get(ENV_VAR, "") or "").strip().lower()
    if v in VALID_POLICIES:
        return v
    return DEFAULT_POLICY


def is_strict() -> bool:
    return current_policy() == "strict"


def record_failure(user: Optional[str], call_class: str, reason: str,
                   detail: Optional[str] = None) -> None:
    """Record one LOUD enrichment failure: an ERROR log line + a bounded, admin-visible ledger
    entry (surfaced on /api/admin/status beside ``castAuthoring``). Never raises. Recording is
    unconditional — callers gate on ``is_strict()`` where soft must stay byte-identical."""
    try:
        entry = {"at": time.time(), "callClass": str(call_class), "reason": str(reason),
                 **({"detail": str(detail)[:500]} if detail else {})}
        lst = _FAILURES.setdefault(_key(user), [])
        lst.append(entry)
        del lst[:-_MAX_FAILURES_PER_USER]
        logger.error(
            f"[enrichment:{call_class}] {reason}"
            + (f" — {str(detail)[:500]}" if detail else "")
            + " (strict enrichment policy: this failure is LOUD, never a silent floor)")
    except Exception:  # pragma: no cover - defensive: the ledger must never break a flow
        pass


def failures(user: Optional[str]) -> list:
    """The recorded enrichment failures for this user (operator visibility — newest last)."""
    return list(_FAILURES.get(_key(user), []))


def clear_failures(user: Optional[str] = None) -> None:
    """Scrub the failure ledger (new-season reset; ``user=None`` clears everyone)."""
    if user is None:
        _FAILURES.clear()
    else:
        _FAILURES.pop(_key(user), None)


async def preflight_unwired(owner: Optional[str]) -> list:
    """The STRICT game-creation pre-flight: which enrichment call classes have NO model wired
    right now? Returns the unwired class names (empty ⇒ every class can run). Two resolvers cover
    the five classes: ``cast-authoring`` (+ the pre-warm that rides it) uses the narration-routed
    authoring resolver; ``cast-identity`` / ``zeitgeist`` / ``offscreen-texture`` share the
    background-utility resolver. Fail-soft on introspection errors (an unexpected resolver crash
    reads as unwired — strict would rather refuse loudly than start silently)."""
    out: list = []
    try:
        from src import orwell_cast_authoring as _ca
    except Exception:
        return list(CALL_CLASSES)
    try:
        authoring_fn = await _ca.resolve_authoring_llm_fn(owner)
    except Exception:
        authoring_fn = None
    if authoring_fn is None:
        # cast-genesis (0116) rides the SAME cast-authoring narration resolver — no authoring model
        # means the cast skeleton cannot be model-authored either (its loud pre-finalize gate).
        out.extend(["cast-authoring", "cast-prewarm", "cast-genesis"])
    try:
        utility_fn = await _ca._resolve_llm_fn(owner)
    except Exception:
        utility_fn = None
    if utility_fn is None:
        out.extend(["cast-identity", "zeitgeist", "offscreen-texture"])
    return out


def creation_refusal_message(unwired: list) -> str:
    """The clear, player-visible game-creation refusal (strict policy, no model for a class)."""
    classes = ", ".join(str(c) for c in unwired) or "enrichment"
    return (
        f"Game creation refused (strict enrichment policy): no language model is wired for the "
        f"{classes} call class(es), so the cast cannot be authored end-to-end. Configure a chat "
        f"model endpoint (Settings → Models), or set enrichment_policy=soft to allow the "
        f"deterministic floor.")
