"""Verbose DEBUG telemetry for the overseer/corrector guardrails (OPT-IN, default OFF).

The FE agent loop (``src/agent_loop.py``) carries a family of *corrector* guardrails that step in
when the narration model UNDER-CALLS the engine tools — they error-correct the model's OMISSION,
never author content (ADR 0003). This module is their **observability** slice: one structured,
Vault-free record PER TURN of

  * **which engine tools the model called ITSELF this turn** (advanceGame / recordInteraction /
    markHouseguestMet / createCharacter / updateCasting / …) — "the engine called it";
  * **each guardrail's verdict** — ``model-called-it`` (the corrector stood down), ``intervened``
    (the corrector fired), or ``n-a`` (not applicable this turn);
  * **what intervention was made** — which guardrail fired, a concise description, and the args it
    injected (e.g. ``_auto_record_scene`` → ``recordInteraction{withIds, kind, content}``; a forced
    ``advanceGame``).

It emits one structured ``[overseer-debug]`` log line per turn (picked up by the #406
``log_rings.LIVE`` root-logger ring for the admin viewer) AND accumulates the last N entries in a
bounded in-process ring buffer so the debug bundle can surface them.

Relationship to siblings
------------------------
  * ``src/overseer.py`` (0079/0080) is the runtime overseer's *diagnosis + correction*; this module
    only OBSERVES/LOGS the corrector's behavior — it never pulls a lever or changes what a guardrail
    does (except Tier 2's READ-ONLY force-evaluation, which logs a *would-have* verdict and NEVER
    fires the intervention).
  * ``src/orwell_sync_ledger.py`` (0065 Part D) is the per-turn closed-set sync ledger; this is its
    corrector-focused cousin. Both are Vault-free and body-free by construction.

Gating — two cost tiers, off by default (``overseer_debug_tier()``)::

    off / "0"     — NO telemetry, NO extra work, behavior BYTE-IDENTICAL (the critical default).
    log / "1"     — Tier 1: cheap, log-only. Record what NATURALLY happened. NO extra LLM calls.
    force / "2"   — Tier 2: ALSO force-EVALUATE the corrector checks on turns they'd normally skip,
                    logging a "would-have-intervened" verdict. EXPENSIVE (may run a read-only
                    extraction). Tier 2 NEVER changes game state and NEVER fires the intervention.

Boundaries
----------
  * **Vault-free by construction.** Every recorded field is a tool/guardrail NAME, a verdict token,
    a small count, or an injected-arg SHAPE (key names / ids, already player-side) — NEVER a
    narration body, casting answer, or engine secret. ``record_turn`` clips/coerces everything.
  * **Bounded.** The ring keeps at most :data:`_CAP` entries (drop oldest).
  * **Logging must never hurt the app.** Every writer swallows its own errors. When the tier is
    ``off``, the cheap :func:`overseer_debug_enabled` short-circuit means the loop does NO extra work.
"""

from __future__ import annotations

import collections
import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ── tiers ────────────────────────────────────────────────────────────────────────

# The canonical tier tokens + the spellings that resolve to each (so the env var / settings can use
# either the word or the numeric level).
TIER_OFF = "off"
TIER_LOG = "log"      # Tier 1 — cheap, log-only
TIER_FORCE = "force"  # Tier 2 — expensive, force-evaluate (read-only)
TIERS = (TIER_OFF, TIER_LOG, TIER_FORCE)

_TIER_SPELLINGS = {
    "off": TIER_OFF, "0": TIER_OFF, "false": TIER_OFF, "no": TIER_OFF, "": TIER_OFF,
    "log": TIER_LOG, "1": TIER_LOG, "true": TIER_LOG, "yes": TIER_LOG, "on": TIER_LOG,
    "force": TIER_FORCE, "2": TIER_FORCE, "expensive": TIER_FORCE,
}

# verdict tokens for each guardrail this turn
V_MODEL = "model-called-it"   # the corrector stood down — the model did the call itself
V_INTERVENED = "intervened"   # the corrector fired (or, Tier 2, WOULD have)
V_NA = "n-a"                  # not applicable this turn (no symptom / not in this game mode)
VERDICTS = (V_MODEL, V_INTERVENED, V_NA)


def _resolve_tier_str(raw: Any) -> Optional[str]:
    """Map a raw value to a canonical tier, or ``None`` if it is not a recognized spelling."""
    if raw is None:
        return None
    try:
        s = str(raw).strip().lower()
    except Exception:
        return None
    return _TIER_SPELLINGS.get(s)


def overseer_debug_tier() -> str:
    """Resolve the verbose-debug tier (one of :data:`TIERS`). Settings-first, fail-soft.

    Resolution order (first that yields a recognized value wins):
      1. settings ``overseer_debug`` — only when EXPLICITLY saved (``is_setting_overridden``), so the
         ``off`` default in DEFAULT_SETTINGS never shadows the env fallback;
      2. env ``ORWELL_OVERSEER_DEBUG`` — ``off``/``0`` … ``log``/``1`` … ``force``/``2``;
      3. else ``off``.

    A broken settings read degrades to the env path and NEVER raises into the loop."""
    # 1) settings tier (admin UI control) — honor only an explicitly-saved value.
    try:
        from src.settings import get_setting, is_setting_overridden
        if is_setting_overridden("overseer_debug"):
            t = _resolve_tier_str(get_setting("overseer_debug", None))
            if t is not None:
                return t
    except Exception:
        pass
    # 2) env knob.
    import os
    t = _resolve_tier_str(os.getenv("ORWELL_OVERSEER_DEBUG"))
    if t is not None:
        return t
    # 3) default — off (byte-identical, no extra work).
    return TIER_OFF


def overseer_debug_enabled() -> bool:
    """True iff the tier is not ``off`` — the cheap short-circuit the loop checks BEFORE doing any
    telemetry work, so the default ``off`` path stays byte-identical and free."""
    return overseer_debug_tier() != TIER_OFF


def overseer_debug_force() -> bool:
    """True iff the EXPENSIVE Tier 2 (force-evaluate) is selected."""
    return overseer_debug_tier() == TIER_FORCE


# ── the bounded ring buffer (Vault-free) ─────────────────────────────────────────

_CAP = 200            # keep the last N turn entries (drop oldest)
_DESC_CAP = 240       # clip any free-text description (defence in depth — names/shapes only)
_MAX_NAMES = 64
_MAX_NAME_LEN = 80

_RING: "collections.deque[dict]" = collections.deque(maxlen=_CAP)
_SEQ = 0
_LOCK = threading.Lock()


def _clip(v: Any, cap: int = _DESC_CAP) -> str:
    """Clip a free-text field with a visible truncation marker (for the description line)."""
    try:
        s = v if isinstance(v, str) else str(v)
    except Exception:
        return ""
    return s if len(s) <= cap else s[:cap] + f"… [+{len(s) - cap}]"


def _name(v: Any, cap: int = _MAX_NAME_LEN) -> str:
    """Hard-truncate a NAME/id field to ``cap`` chars (no marker) — the result never exceeds the
    cap, so the Vault-free name guarantee is exact, not best-effort."""
    if v is None:
        return ""
    try:
        s = str(v)
    except Exception:
        return ""
    return s[:cap]


def _clean_names(v: Any) -> list[str]:
    """A list of tool/guardrail/arg NAMES — short tokens only, bounded. A single string is a
    one-element list; anything unusable ⇒ []."""
    if v is None:
        return []
    if isinstance(v, str):
        items: Any = [v]
    elif isinstance(v, (list, tuple, set)):
        items = list(v)
    else:
        return []
    out: list[str] = []
    for item in items:
        if len(out) >= _MAX_NAMES:
            break
        try:
            s = str(item).strip()
        except Exception:
            continue
        if s:
            out.append(s[:_MAX_NAME_LEN])
    return out


@dataclass
class GuardrailVerdict:
    """One corrector guardrail's verdict for a turn. Vault-free tokens/shapes only."""

    name: str                       # the guardrail name (e.g. "_auto_record_scene")
    verdict: str                    # one of VERDICTS
    description: str = ""            # one concise line (clipped; no body)
    injected_tool: Optional[str] = None   # the engine tool the intervention injected, if any
    injected_args: list[str] = field(default_factory=list)  # the arg KEY shape it injected (no values)
    forced: bool = False            # Tier 2: this is a "would-have" force-eval verdict, not a real fire

    def as_dict(self) -> dict:
        return {
            "name": _name(self.name),
            "verdict": self.verdict if self.verdict in VERDICTS else V_NA,
            "description": _clip(self.description),
            "injectedTool": _name(self.injected_tool) if self.injected_tool else None,
            "injectedArgs": _clean_names(self.injected_args),
            "forced": bool(self.forced),
        }


def record_turn(
    user: Optional[str],
    *,
    tier: Optional[str] = None,
    session: Any = None,
    game_mode: Any = None,
    phase: Any = None,
    model_tool_calls: Any = None,
    guardrails: Optional[list[GuardrailVerdict]] = None,
) -> Optional[dict]:
    """Append one Vault-free overseer-debug entry and emit one ``[overseer-debug]`` log line.

    ``model_tool_calls`` — the NAMES of the engine tools the model called itself this turn.
    ``guardrails`` — a list of :class:`GuardrailVerdict`, one per corrector decision point.

    Returns the stored entry (handy for tests) or ``None`` if the tier is off / nothing recorded.
    Fail-soft: any error is swallowed (telemetry must never hurt a turn)."""
    global _SEQ
    try:
        _tier = tier or overseer_debug_tier()
        if _tier == TIER_OFF:
            return None
        gverdicts = [g.as_dict() for g in (guardrails or []) if isinstance(g, GuardrailVerdict)]
        intervened = [g for g in gverdicts if g["verdict"] == V_INTERVENED and not g["forced"]]
        would_have = [g for g in gverdicts if g["verdict"] == V_INTERVENED and g["forced"]]
        entry = {
            "ts": int(time.time() * 1000),
            "tier": _tier,
            "user": _name(user) if user else None,
            "session": _name(session) if session else None,
            "gameMode": _name(game_mode) if game_mode else None,
            "phase": _name(phase) if phase else None,
            "modelToolCalls": _clean_names(model_tool_calls),
            "guardrails": gverdicts,
            "intervenedCount": len(intervened),
            "wouldHaveCount": len(would_have),
        }
        with _LOCK:
            _SEQ += 1
            entry["seq"] = _SEQ
            _RING.append(entry)
        _log_line(entry)
        return entry
    except Exception as e:  # pragma: no cover — defence in depth
        try:
            logger.debug("[overseer-debug] record failed: %s", e)
        except Exception:
            pass
        return None


def get_recent(limit: int = 50, *, user: Optional[str] = None) -> list[dict]:
    """The most-recent ring entries (newest last), capped at ``limit``. Optionally filtered to one
    user. A never-populated ring (tier off) answers ``[]``."""
    try:
        n = int(limit)
    except (TypeError, ValueError):
        n = 50
    if n <= 0:
        return []
    with _LOCK:
        items = list(_RING)
    if user is not None:
        u = _name(user)
        items = [e for e in items if e.get("user") == u]
    return items[-n:]


def clear() -> None:
    """Drop the ring (used by tests / a reset). Process-global, Vault-free."""
    global _SEQ
    with _LOCK:
        _RING.clear()
        _SEQ = 0


def _log_line(entry: dict) -> None:
    """One structured ``[overseer-debug]`` line per turn — names/verdicts/counts/shapes only."""
    try:
        tools = ",".join(entry.get("modelToolCalls") or []) or "-"
        fired = [g for g in (entry.get("guardrails") or [])
                 if g.get("verdict") == V_INTERVENED and not g.get("forced")]
        wouldha = [g for g in (entry.get("guardrails") or [])
                   if g.get("verdict") == V_INTERVENED and g.get("forced")]

        def _fmt(g: dict) -> str:
            arg = ("{" + ",".join(g.get("injectedArgs") or []) + "}") if g.get("injectedArgs") else ""
            tool = g.get("injectedTool") or ""
            inj = (f" → {tool}{arg}") if tool else ""
            return f"{g.get('name')}{inj}"

        fired_s = "; ".join(_fmt(g) for g in fired) or "-"
        would_s = "; ".join(_fmt(g) for g in wouldha) or "-"
        logger.info(
            "[overseer-debug] tier=%s user=%s mode=%s phase=%s model-called=[%s] "
            "intervened=[%s] would-have=[%s]",
            entry.get("tier"),
            entry.get("user") or "-",
            entry.get("gameMode") or "-",
            entry.get("phase") or "-",
            tools,
            fired_s,
            would_s,
        )
    except Exception:  # pragma: no cover
        pass
