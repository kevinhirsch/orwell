"""Feature 0081 — the narration-FAITHFULNESS gate (the overseer's second role).

Where feature 0079/0080's runtime overseer watches the engine<->LLM loop for PACING / gap-repair
failures (the model UNDER-calls a tool — it won't ``advanceGame``, it won't ``recordInteraction``),
this role watches FAITHFULNESS — the model MIS-narrates: prose that contradicts the board, drifts a
houseguest's public persona, leaks hidden machinery or a fact the player has no pathway to know, or
drops a beat it should have advanced.

It rides its OWN dial — deliberately independent of :func:`src.overseer.overseer_mode` (owner ruling
O2, 2026-06-24) — so the riskier role (an LLM judging the LLM, and in ``active`` canonicalizing
open-set slips) can roll out on its own clock. Same three states:

  * ``'off'``    — the judge never runs; the deterministic 0065 floor stands (default).
  * ``'shadow'`` — the judge runs on claim-bearing turns and LOGS verdicts; it does NOT correct.
  * ``'active'`` — the judge's verdict drives a clever, diegetic correction (adopt the open set /
                   reframe the closed set), with the deterministic floor underneath. LIVE-only.

The correction split is governed by ADR 0005 and the owner's "keep the wall" ruling (2026-06-24): an
OPEN-set slip (texture the engine never owned) is ADOPTED canonical; a CLOSED-set slip (an actual
outcome) is REFRAMED in-fiction — a consequential outcome is NEVER bent to match the narration. The
judge is Vault-free BY CONSTRUCTION: it compares the narration only against the player's known,
Vault-free projection, so a leak is caught as "an assertion outside what the player legitimately
knows", never by reading the Vault.

This module is the role's home. **P1 ships only the dial** (zero behavior change); the
``FaithfulnessJudge``, the ``adopt`` / ``reframe`` levers, and the agent-loop hook land in the
following increments. Every public function swallows its own errors and degrades to a safe default —
config must never crash the turn.
"""

from __future__ import annotations

import os

# Feature 0081 — the 3-state faithfulness dial, independent of the 0079/0080 overseer_mode():
#   'off'    — the judge never runs (default).
#   'shadow' — the judge runs on claim-bearing turns and LOGS; it does not correct.
#   'active' — the judge's verdict drives the diegetic correction (adopt/reframe); LIVE-only.
FAITHFULNESS_MODES = ("off", "shadow", "active")


def faithfulness_mode() -> str:
    """Resolve the 3-state faithfulness-gate mode (one of :data:`FAITHFULNESS_MODES`).

    Settings-first, fail-soft, and DELIBERATELY independent of :func:`src.overseer.overseer_mode`
    (owner ruling O2 — its own dial, its own clock). Resolution order (the first that yields a value
    wins):
      1. settings ``faithfulness_mode`` — if it is one of :data:`FAITHFULNESS_MODES`;
      2. else the env ``ORWELL_FAITHFULNESS_MODE`` — if it is one of :data:`FAITHFULNESS_MODES`;
      3. else ``'off'`` (the deterministic 0065 floor stands).

    A brand-new role has NO legacy toggle to honor (unlike ``overseer_mode``), so this is the simpler
    sibling. A broken settings read degrades to the env path and NEVER raises into the loop — config
    must never crash the turn.
    """
    # 1) the settings tier (the admin UI control). A broken read drops to the env path.
    try:
        from src.settings import get_setting
        mode = get_setting("faithfulness_mode", None)
        if isinstance(mode, str) and mode in FAITHFULNESS_MODES:
            return mode
    except Exception:
        pass
    # 2) the headless env knob.
    env_mode = os.getenv("ORWELL_FAITHFULNESS_MODE")
    if env_mode is not None and env_mode.strip().lower() in FAITHFULNESS_MODES:
        return env_mode.strip().lower()
    # 3) the default — the judge never runs.
    return "off"


def faithfulness_enabled() -> bool:
    """OPT-IN, default OFF. ``True`` iff the faithfulness mode is not ``'off'`` (``'shadow'`` or
    ``'active'``). Mirrors :func:`src.overseer.overseer_enabled` for symmetry, so callers can gate
    on a single boolean when they don't care which non-off state is live."""
    return faithfulness_mode() != "off"
