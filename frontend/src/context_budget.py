"""Adaptive input-token budget for the agent loop (#1170).

The agent soft-trims its input context to ``agent_input_token_budget`` (default
6000). The old computation was ``min(context_length or budget, budget)``, which
made the 6000 default a hard ceiling for *every* model — so a 128K or 1M context
model was silently capped at 6000 input tokens even though it can hold far more.

This derives the effective budget from the model's discovered context window when
the user has NOT set an explicit budget, while still honouring an explicit setting
exactly (clamped to the window). Pure and side-effect free so it is unit-testable.

A subtle but high-impact trap (the live-game memory-loss / NPC-inconsistency bug):
the settings file commonly persists the *whole* merged DEFAULT_SETTINGS to disk
(settings-repair / an admin save), so ``agent_input_token_budget`` is *present* in
the file at its DEFAULT value of 6000. ``is_setting_overridden`` then reports it as
an explicit user choice, and the explicit branch clamped a 128K model back down to
6000 — re-introducing exactly the cap #1170 set out to remove (the model never sees
the conversation, so it re-improvises NPC names/cities turn to turn). So a configured
value equal to the default sentinel is treated as NON-explicit here and scales to the
window like the unset case; only a value the user genuinely changed away from the
default is honoured as explicit.
"""

# Cost-bounded ceiling for the *auto-derived* budget. Sized so the narrative
# conversation actually fits (long-context models are no longer capped at 6000)
# while keeping the per-turn prompt — and thus the bill — bounded. A 128K model
# lands here; a 1M model is held to this cap. Tunable via
# ``agent_input_token_hard_max``.
DEFAULT_HARD_MAX = 48_000
DEFAULT_BUDGET = 6000
# Target a sane large fraction of the model window so the full conversation is
# visible to the model (the root cause of NPC re-improvisation was a context the
# model never actually received). 0.6 leaves comfortable response + tool headroom.
DEFAULT_HEADROOM = 0.60


def compute_input_token_budget(
    configured: int,
    context_length: int,
    explicit: bool,
    *,
    default: int = DEFAULT_BUDGET,
    headroom: float = DEFAULT_HEADROOM,
    hard_max: int = DEFAULT_HARD_MAX,
) -> int:
    """Return the effective soft input-token budget.

    Args:
        configured: the value read from settings (may be the default).
        context_length: the model's discovered context window (0/unknown if none).
        explicit: True if the user explicitly set ``agent_input_token_budget``.

    Rules:
        - An explicit user budget that genuinely differs from the default sentinel
          is honoured exactly, only clamped to the model's window when that window
          is known (never send more than the model holds).
        - A "configured" value equal to the default (or no explicit override) scales
          to ``headroom`` of the context window, capped at ``hard_max`` — so
          long-context models use their capacity instead of being pinned at 6000.
        - When the window is unknown, fall back to the configured/default value
          (preserving the previous behaviour) so small/local models still trim sanely.
    """
    configured = int(configured or 0)
    context_length = int(context_length or 0)

    # A persisted-but-default value is NOT a real user override (the settings file
    # routinely carries the full default set). Only treat it as explicit when the
    # user moved it OFF the default sentinel.
    real_override = explicit and configured > 0 and configured != int(default)

    if real_override:
        return min(configured, context_length) if context_length > 0 else configured

    if context_length > 0:
        scaled = int(context_length * headroom)
        return max(1, min(scaled, hard_max))

    return configured if configured > 0 else default
