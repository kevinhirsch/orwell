"""Token policy resolver (ADR 0010 / feature 0069, slice B).

The single place that maps a *call class* to its LLM spend posture — reasoning
budget, output cap, caching, and context budget. This replaces the scattered
``max_tokens`` constants at the call sites and is the seam through which a
``reasoning`` budget is finally sent per class (the dominant, currently-unmanaged
cost lever on a reasoning model).

Owner-ratified reasoning efforts (2026-06-21, ADR 0010 *Owner rulings* #1):
narration = **medium**, utility-extraction = off/minimal, casting = **medium**,
background-authoring = **low**. BOTH the per-class reasoning budget AND the
per-class ``max_tokens`` output cap are **admin-editable at runtime** — the
resolver reads overrides from a settings dict the caller passes in
(``reasoning_budget`` and ``max_tokens_budget``, each a ``{call_class: value}``
map). This module stays **pure**: it imports nothing (in particular nothing from
``settings.py``); the constants here are only the *defaults* the settings override.

Contract (ADR 0010 §5):
    resolve_token_policy(call_class, settings) ->
        {"reasoning": <dict|None>, "max_tokens": int|None,
         "caching": bool, "context_budget": int|None}

``max_tokens`` is ``None`` for a class whose default is "use the model-aware cap" (narration,
casting) when there is NO in-band admin override — the call site substitutes a model-sized
default (full reasoning+answer headroom). An explicit, in-band ``max_tokens_budget`` override
yields a positive int and always wins.

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
    "utility-extraction": "off",  # off (not low): pure extraction/classification (moves/deals/scene);
                                  # the prompts forbid thinking and the 2026-06-21 I/O trace showed it wasted.
    "casting": "medium",
    "background-authoring": "low",
}
# The per-class default output cap. ``None`` means "use the caller's model-aware default" — the
# resolver leaves ``max_tokens`` as ``None`` so the call site (which knows the concrete model)
# substitutes ``llm_core._model_max_output_tokens(model)`` (a generous, model-sized cap). A flat
# constant here re-introduced the #835 truncation vector for reasoning models (deepseek-v4-pro
# counts reasoning+visible against ``max_tokens``, so a flat 4096 truncated narration mid-reply —
# the #620 NARR-5 warning). ``narration``/``casting`` therefore default to ``None`` (full model
# headroom for reasoning + answer); the short, non-reasoning utility/background classes keep their
# tight literal caps. An EXPLICIT, in-band admin override (``max_tokens_budget[class]``) still wins
# for ANY class — that is the point of ADR 0010 #1 — and the resolved value is recorded in the
# ledger's ``appliedMaxTokens``.
_DEFAULT_MAX_TOKENS = {
    "narration": None,  # ⇒ model-aware default at the call site (full reasoning+answer headroom)
    "utility-extraction": 1500,
    "casting": None,    # ⇒ model-aware default (same reasoning-truncation applies; turns are short)
    "background-authoring": 1200,
}
# "off" -> reasoning omitted (None). The full set of admin-acceptable values.
_VALID_EFFORTS = ("off", "low", "medium", "high")

# Admin-acceptable bounds for a per-class ``max_tokens`` override. An override outside this
# inclusive band (or a non-int / non-positive value) is rejected and the class default stands —
# a fat-fingered 0 / negative / 10_000_000 can never become the live output cap.
_MIN_MAX_TOKENS = 256
_MAX_MAX_TOKENS = 200_000

# The class whose defaults stand in for an unknown call class (never crash).
_FALLBACK_CLASS = "narration"


def valid_efforts() -> tuple[str, ...]:
    """The admin-acceptable reasoning-effort values (for the settings UI/tests)."""
    return _VALID_EFFORTS


def max_tokens_bounds() -> tuple[int, int]:
    """The admin-acceptable ``max_tokens`` override band (inclusive) — for the settings UI/tests."""
    return (_MIN_MAX_TOKENS, _MAX_MAX_TOKENS)


def _valid_max_tokens(v) -> bool:
    """True iff ``v`` is an in-band positive integer admissible as a ``max_tokens`` override.
    ``bool`` is rejected (a stray ``True``/``False`` is never a token count)."""
    if isinstance(v, bool) or not isinstance(v, int):
        return False
    return _MIN_MAX_TOKENS <= v <= _MAX_MAX_TOKENS


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
    - ``max_tokens``: the per-class output cap — admin-editable at runtime (see below). It is
      ``None`` when the class default is "use the caller's model-aware cap" (narration, casting)
      and there is no in-band override — the call site fills in a model-sized default so a
      reasoning model has room to think AND answer (the alternative, a flat literal, truncated
      reasoning-model narration mid-reply — #835/#620 NARR-5). An in-band override is a positive int.
    - ``caching``: ``True`` for all classes (provider-automatic; the live model caches).
    - ``context_budget``: ``None`` — computed elsewhere by ``context_budget.py``;
      a reserved hook so the contract is stable.

    Admin overrides (both per-class, both defensively read, both wins-over-default):
    - ``settings["reasoning_budget"][call_class]`` — one of ``valid_efforts()``.
    - ``settings["max_tokens_budget"][call_class]`` — an in-band positive int
      (``max_tokens_bounds()``); out-of-band / non-int / non-positive ⇒ class default
      (which, for narration/casting, is ``None`` ⇒ the call site's model-aware cap).

    An unknown/garbage override falls back to the class default; an unknown
    ``call_class`` falls back to the ``"narration"`` defaults. Defensive: ``settings``
    may be ``None``, may lack either key, or may not be a dict — this never raises.

    Pure and side-effect-free.
    """
    # An unknown call class falls back to the narration defaults (never crash).
    resolved_class = call_class if call_class in _DEFAULT_EFFORT else _FALLBACK_CLASS

    effort = _DEFAULT_EFFORT[resolved_class]
    max_tokens = _DEFAULT_MAX_TOKENS[resolved_class]

    # Admin overrides, defensively read. Any malformed shape -> keep the default.
    if isinstance(settings, dict):
        overrides = settings.get("reasoning_budget")
        if isinstance(overrides, dict):
            candidate = overrides.get(call_class)
            if candidate in _VALID_EFFORTS:
                effort = candidate
        mt_overrides = settings.get("max_tokens_budget")
        if isinstance(mt_overrides, dict):
            mt_candidate = mt_overrides.get(call_class)
            if _valid_max_tokens(mt_candidate):
                max_tokens = mt_candidate

    return {
        "reasoning": _effort_to_reasoning(effort),
        "max_tokens": max_tokens,
        "caching": True,
        "context_budget": None,
    }
