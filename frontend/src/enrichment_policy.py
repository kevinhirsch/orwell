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
  1. the env seed ``ORWELL_ENRICHMENT_POLICY`` — the HARNESS PIN (set "soft" by the FE test
     suite's conftest, the golden driver, and the smoke/browser/responsive harnesses — the stubbed
     lanes must keep the legacy fail-soft contracts byte-identical);
  2. the runtime-editable settings key ``enrichment_policy`` ("soft" | "strict");
  3. the code default: ``strict``.

The env seed moved ABOVE the settings key on 2026-07-13 (owner ruling, live prod debug-bundle
audit) when the shipped ``DEFAULT_SETTINGS`` seed became an EXPLICIT ``"strict"``: settings.py's
defaults merge into every ``get_setting`` read, so a store that never persisted the key would
otherwise resolve the merged "strict" at the settings tier and silently kill the harness pin
(flipping every stubbed lane strict). Prod deployments never set the env var, so the
runtime-editable settings key remains authoritative there — the env tier is purely the
test/harness seam it always was.
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

# ── S6c (#1599 item): PROVIDER/RUNTIME failure classes the enrichment lanes depend on ──────────
# Three failure classes were happening LIVE but recorded NOWHERE (the debug-bundle audit): a
# search-provider outage feeding zeitgeist/off-screen enrichment ("SearXNG search failed: [Errno 111]
# Connection refused"), a narrator HTTP 4xx ("OpenRouter returned HTTP 400: Provider returned error"),
# and a reasoning-channel misroute (the model routed its whole turn to the reasoning channel, leaving
# the visible reply empty). Each is a genuine class-A fault: `record_runtime_failure` lands them in
# the SAME admin-visible loud ledger + emits a RED-eligible health event, so they show RED on
# /admin/status instead of a swallowed WARN. (The narrator-http / reasoning-misroute classes are also
# caught at the LLMIO tier by the S6a failClass derivation; recording here makes them alarm-eligible on
# the enrichment surface too, and is the ONLY capture point for the non-LLM search-provider outage.)
RUNTIME_CLASSES = ("search-provider", "narrator-http", "reasoning-misroute")

# ── the loud failure ledger (admin-visible; in-process, bounded) ───────────────────────────
_MAX_FAILURES_PER_USER = 50
_FAILURES: dict = {}  # user_key -> list[{at, callClass, reason, detail}]


def _key(user: Optional[str]) -> str:
    return str(user) if user else "default"


def current_policy() -> str:
    """The resolved enrichment policy: env seed (the harness pin) → settings key → the
    ``strict`` default. Defensive throughout — a malformed value at any tier falls through
    to the next. (Env-first since 2026-07-13: the shipped settings seed is an explicit
    "strict" that merges into every ``get_setting`` read, so the settings tier can no longer
    distinguish an operator's choice from the shipped default — the env seed must therefore
    win, or the stubbed lanes' "soft" pin would be silently shadowed. Prod never sets the
    env var, so the runtime-editable settings key stays authoritative there.)"""
    v = str(os.environ.get(ENV_VAR, "") or "").strip().lower()
    if v in VALID_POLICIES:
        return v
    try:
        from src.settings import get_setting
        v = str(get_setting("enrichment_policy", "") or "").strip().lower()
        if v in VALID_POLICIES:
            return v
    except Exception:
        pass
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
    # #1599 — EVERY enrichment failure (a failed LLM call, garbage output, a refused write-back,
    # or a no-model refusal) is a genuine class-A fault: emit a RED-eligible health event so it
    # shows RED on /admin/status, not only an ERROR log line + ledger row. Covers all 6 enrichment
    # driver classes at this one seam (the ERROR log above is the "log first" step; this is the RED
    # record). Fail-safe: the health-event write must never break the flow. (The separate no-model
    # overseer assessment below still runs — it adds the resolvable-now/escalate diagnosis.)
    try:
        from src import log_rings as _lr
        _diag = (f"enrichment {call_class} failed: {reason}"
                 + (f" — {str(detail)[:200]}" if detail else ""))
        _lr.record_overseer("anomaly", f"enrichment:{call_class}", _diag, lever=None, ok=False,
                            user=user)
    except Exception:  # pragma: no cover - defensive
        pass
    # 2026-07-12 — the runtime overseer NOTICES the model-wiring failure class (the ledger IS
    # its signal, same list the admin health payload surfaces): a recorded no-model failure
    # triggers the overseer's assessment, which reports resolvable-now (the resolver's
    # single-endpoint auto-default) or escalates with the operator's one-step fix through the
    # existing overseer log channel. Debounced inside; fail-soft — never breaks the flow.
    try:
        if "no model" in str(reason).lower():
            from src import overseer as _overseer
            _overseer.assess_enrichment_health(user)
    except Exception:  # pragma: no cover - defensive
        pass


def record_runtime_failure(user: Optional[str], call_class: str, reason: str,
                           detail: Optional[str] = None) -> None:
    """S6c: record a PROVIDER/RUNTIME failure (search-provider outage, narrator HTTP 4xx, reasoning
    misroute) into the SAME admin-visible loud ledger + a RED-eligible health event. These were
    happening live but recorded nowhere — a search-provider ``Connection refused`` fell through
    ``orwell_zeitgeist``'s best-effort WARN with no failure row. Unconditional (never gated on
    ``is_strict()`` — a provider outage is always a real fault) and never raises.

    Reuses :func:`record_failure` so a runtime failure shows up on the same ``enrichment.failures``
    surface and under the same rollup guard (``enrichment:<class>``) — the RED alarm keys on the
    provider classes (see the admin alarm route). ``call_class`` is a short RUNTIME_CLASSES token."""
    record_failure(user, call_class, reason, detail)


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
    """The clear, player-visible game-creation refusal (strict policy, no model for a class).
    Operator-actionable by design: it names the unwired class(es) AND the one-step fix."""
    classes = ", ".join(str(c) for c in unwired) or "enrichment"
    return (
        f"Game creation refused (strict enrichment policy): no language model is wired for the "
        f"{classes} call class(es), so the cast cannot be authored end-to-end. One-step fix: set "
        f"a default provider endpoint + chat model (Settings → Models), then retry — or set "
        f"enrichment_policy=soft to allow the deterministic floor.")
