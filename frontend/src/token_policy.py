"""Token policy resolver (ADR 0010 / feature 0069, slice B).

The single place that maps a *call class* to its LLM spend posture — reasoning
budget, output cap, caching, and context budget. This replaces the scattered
``max_tokens`` constants at the call sites and is the seam through which a
``reasoning`` budget is finally sent per class (the dominant, currently-unmanaged
cost lever on a reasoning model).

Owner-ratified reasoning efforts (2026-06-21, ADR 0010 *Owner rulings* #1):
narration = **medium**, utility-extraction = off/minimal, casting = **medium**,
background-authoring = **low**. The per-class reasoning budget is **admin-editable
at runtime** — the resolver reads an override from a settings dict the caller
passes in. This module stays **pure**: it imports nothing (in particular nothing
from ``settings.py``); the constants here are only the *defaults* the settings
override.

Contract (ADR 0010 §5):
    resolve_token_policy(call_class, settings) ->
        {"reasoning": <dict|None>, "max_tokens": int,
         "caching": bool, "context_budget": int|None}

``reasoning`` is the OpenRouter form ``{"effort": "low"|"medium"|"high"}`` or
``None`` when the effort is ``"off"`` (the field is omitted from the payload).
Pure and side-effect-free.
"""

from __future__ import annotations

# The four call classes the whole FE LLM boundary is partitioned into.
CALL_CLASSES = ("narration", "utility-extraction", "casting", "background-authoring")

# OpenRouter reasoning form is {"effort": "low"|"medium"|"high"} or omitted.
_DEFAULT_EFFORT = {
    "narration": "medium",
    "utility-extraction": "low",
    "casting": "medium",
    "background-authoring": "low",
}
_DEFAULT_MAX_TOKENS = {
    "narration": 4096,
    "utility-extraction": 1500,
    "casting": 2048,
    "background-authoring": 1200,
}
# "off" -> reasoning omitted (None). The full set of admin-acceptable values.
_VALID_EFFORTS = ("off", "low", "medium", "high")

# The class whose defaults stand in for an unknown call class (never crash).
_FALLBACK_CLASS = "narration"


def valid_efforts() -> tuple[str, ...]:
    """The admin-acceptable reasoning-effort values (for the settings UI/tests)."""
    return _VALID_EFFORTS


def _effort_to_reasoning(effort: str) -> dict | None:
    """Map a (validated) effort to the OpenRouter ``reasoning`` map, or None for ``off``."""
    if effort == "off":
        return None
    return {"effort": effort}


def resolve_token_policy(call_class: str, settings: dict | None = None) -> dict:
    """Resolve the token policy for ``call_class``.

    Returns ``{"reasoning": <dict|None>, "max_tokens": int, "caching": bool,
    "context_budget": int|None}``:

    - ``reasoning``: ``{"effort": "low"|"medium"|"high"}`` per the effort, or
      ``None`` when the effort is ``"off"`` (the field is omitted from the payload).
      No class is ever default-by-omission — every class names an explicit posture.
    - ``max_tokens``: the per-class default output cap (no settings override yet).
    - ``caching``: ``True`` for all classes (provider-automatic; the live model caches).
    - ``context_budget``: ``None`` — computed elsewhere by ``context_budget.py``;
      a reserved hook so the contract is stable.

    Admin override: ``settings["reasoning_budget"][call_class]`` (one of
    ``valid_efforts()``) wins over the class default. An unknown/garbage override
    falls back to the class default; an unknown ``call_class`` falls back to the
    ``"narration"`` defaults. Defensive: ``settings`` may be ``None``, may lack
    ``"reasoning_budget"``, or may not be a dict — this never raises.

    Pure and side-effect-free.
    """
    # An unknown call class falls back to the narration defaults (never crash).
    resolved_class = call_class if call_class in _DEFAULT_EFFORT else _FALLBACK_CLASS

    effort = _DEFAULT_EFFORT[resolved_class]
    max_tokens = _DEFAULT_MAX_TOKENS[resolved_class]

    # Admin override, defensively read. Any malformed shape -> keep the default.
    if isinstance(settings, dict):
        overrides = settings.get("reasoning_budget")
        if isinstance(overrides, dict):
            candidate = overrides.get(call_class)
            if candidate in _VALID_EFFORTS:
                effort = candidate

    return {
        "reasoning": _effort_to_reasoning(effort),
        "max_tokens": max_tokens,
        "caching": True,
        "context_budget": None,
    }
