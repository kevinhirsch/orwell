"""Feature 0065 — cast pre-warm orchestration (FE side).

The owner ruling: the player must start the actual game with a FULLY WARMED AUTHORSHIP before any
portrait is ever generated.

* **Author warm** fires at the earliest opportunity (a model is selectable, before the season begins):
  the engine pre-seeds the player-INDEPENDENT cast and the FE deeply authors it in the background,
  writing each profile back to the engine (``recordCastProfile``).
* **Portrait warm** is HELD until the first interview turn and, when it runs, WAITS for author warm to
  fully finish before generating any face — so portraits always read a finished, deeply authored store.

Both are idempotent per user and best-effort: with no model configured, author warm no-ops and portrait
warm declines (``createCharacter``'s own fallback then owns portraits). The author-done gate is released
on authoring completion *whether it succeeded or failed*, so portrait warm can never hang.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Portrait warm waits at most this long for author warm before shooting anyway. The seeded floor is still
# a complete cast, and a later store change is caught by the portrait re-shoot backstop — so an authoring
# run that overruns the budget never strands the player without faces. Generous: 15 sequential authoring
# LLM calls can take minutes, and the casting interview usually outlasts them.
_AUTHOR_WARM_TIMEOUT = 15 * 60.0


class _Warm:
    __slots__ = ("seed", "prompts", "author_done", "author_started", "portraits_started")

    def __init__(self) -> None:
        self.seed = None
        self.prompts: list = []
        self.author_done = asyncio.Event()
        self.author_started = False
        self.portraits_started = False


_STATE: dict[str, _Warm] = {}


def _key(user: Optional[str]) -> str:
    return user or "default"


def _state(user: Optional[str]) -> _Warm:
    k = _key(user)
    st = _STATE.get(k)
    if st is None:
        st = _Warm()
        _STATE[k] = st
    return st


def reset(user: Optional[str] = None) -> None:
    """Drop a user's warm state (a new game / season / factory reset) so the next OOBE warms afresh.
    ``user=None`` clears everyone (a global reset)."""
    if user is None:
        _STATE.clear()
    else:
        _STATE.pop(_key(user), None)


async def prewarm_cast(user: Optional[str] = None, *, engine=None, authoring=None) -> dict:
    """AUTHOR WARM (earliest): pre-seed the cast in the engine, then deeply author it in the background.

    Idempotent per user (a second call is a no-op that reports the in-flight warm). Releases the
    author-done gate when authoring finishes — success OR failure — so portrait warm never hangs.
    Returns ``{warmed, count, alreadyWarmed?, refused?}``.
    """
    if engine is None:
        from src import orwell_engine as engine
    if authoring is None:
        from src import orwell_cast_authoring as authoring
    # Always poll the engine (the pre-seed is idempotent + cheap when already warmed) so the warm
    # state self-resets across seasons: a NEW season mints a NEW seed, and a seed change here triggers a
    # fresh author warm with a fresh gate — no per-route reset plumbing needed.
    try:
        res = await engine.pre_seed_cast(user=user)
    except Exception as e:  # best-effort: a pre-seed failure must never block onboarding
        logger.info("[prewarm] pre_seed_cast failed: %s", e)
        return {"warmed": False, "count": 0}
    if not isinstance(res, dict) or not res.get("warmed"):
        return {"warmed": False, "count": 0, "refused": (res or {}).get("refused")}
    seed = res.get("seed")
    st = _state(user)
    if st.author_started and st.seed == seed:
        return {"warmed": True, "alreadyWarmed": True, "count": len(st.prompts)}
    if st.author_started and st.seed != seed:
        reset(user)  # a fresh cast (new season): drop the stale gate + prompts and re-warm
        st = _state(user)
    st.seed = seed
    st.prompts = res.get("portraitPrompts") or []
    cast = res.get("house") or []
    st.author_started = True
    # Author the cast in the background; ALWAYS release the gate when done (the seeded floor is still a
    # complete cast), so the gated portrait warm proceeds even if a houseguest couldn't be authored.
    authoring.kickoff_authoring(cast, user, then=lambda: st.author_done.set())
    return {"warmed": True, "count": len(st.prompts)}


async def warm_portraits(user: Optional[str] = None, *, portraits=None,
                         timeout: float = _AUTHOR_WARM_TIMEOUT) -> dict:
    """PORTRAIT WARM (held until the first interview turn): generate the cast portraits in the background
    — but ONLY after author warm has fully finished. A fully warmed authorship before any photo, ever.

    Idempotent per user. If no author warm ran (no model at casting open), declines so it never shoots
    from a thin store — ``createCharacter``'s fallback owns portraits in that case. Returns ``{started}``.
    """
    st = _state(user)
    if st.portraits_started:
        return {"started": True, "alreadyStarted": True}
    if not st.author_started:
        return {"started": False, "reason": "author-warm-not-started"}
    if portraits is None:
        from src import orwell_portraits as portraits
    st.portraits_started = True

    async def _run() -> None:
        try:
            await asyncio.wait_for(st.author_done.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            logger.info(
                "[prewarm] author warm overran %.0fs — shooting portraits anyway "
                "(re-shoot backstop covers a later store change)", timeout)
        portraits.kickoff_generation(st.prompts, user)

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_run())
    except RuntimeError:  # pragma: no cover - non-async callers (tests await _run via the loop)
        asyncio.run(_run())
    return {"started": True}


def warm_state(user: Optional[str] = None) -> dict:
    """Vault-free introspection for tests / health: whether author + portrait warm have started and
    whether authoring has finished. No cast content crosses — counts and flags only."""
    st = _STATE.get(_key(user))
    if st is None:
        return {"authorStarted": False, "portraitsStarted": False, "authorDone": False, "promptCount": 0}
    return {
        "authorStarted": st.author_started,
        "portraitsStarted": st.portraits_started,
        "authorDone": st.author_done.is_set(),
        "promptCount": len(st.prompts),
    }
