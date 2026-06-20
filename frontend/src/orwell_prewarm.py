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


def _prompt_id(entry) -> Optional[str]:
    """The houseguest id a portrait prompt belongs to (the gating key)."""
    if not isinstance(entry, dict):
        return None
    hid = entry.get("houseguestId") or entry.get("id")
    return str(hid) if hid else None


class _Warm:
    __slots__ = ("seed", "prompts", "author_done", "author_started", "portraits_started",
                 "npc_authored")

    def __init__(self) -> None:
        self.seed = None
        self.prompts: list = []
        self.author_done = asyncio.Event()  # whole-cast done (success OR failure) — the fallback gate
        self.author_started = False
        self.portraits_started = False
        # Per-NPC completion gates (#7): an Event per houseguest id, set the moment THAT NPC's
        # authoring write-back lands, so its portrait shoots as soon as it is authored — never before.
        self.npc_authored: dict[str, asyncio.Event] = {}

    def npc_event(self, hid: str) -> asyncio.Event:
        ev = self.npc_authored.get(hid)
        if ev is None:
            ev = asyncio.Event()
            self.npc_authored[hid] = ev
        return ev


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
    # Pre-create a per-NPC gate for every houseguest that has a portrait prompt (#7), so portrait warm
    # can wait on the SAME Event objects the authoring callback sets — even if authoring is slow to start.
    for entry in st.prompts:
        hid = _prompt_id(entry)
        if hid:
            st.npc_event(hid)

    def _on_authored(hid: str) -> None:
        # THIS NPC's write-back landed → open its gate so its portrait shoots now (never before).
        st.npc_event(str(hid)).set()

    def _on_done() -> None:
        # Whole-cast authoring finished (success OR failure): release the fallback gate AND open any
        # per-NPC gate that never fired (an NPC the model couldn't author) — its face then shoots from
        # the seeded facets at authoring-end rather than waiting out the full timeout.
        st.author_done.set()
        for ev in st.npc_authored.values():
            ev.set()

    # Author the cast in the background; ALWAYS release the gates when done (the seeded floor is still a
    # complete cast), so the gated portrait warm proceeds even if a houseguest couldn't be authored.
    authoring.kickoff_authoring(cast, user, then=_on_done, on_authored=_on_authored)
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

    async def _shoot_one(entry, gate: asyncio.Event) -> None:
        # PER-NPC GATING (#7): hold THIS face until its houseguest is authored, then shoot just it —
        # so portraits stream in as authoring completes, never before a character is authored. The
        # whole-cast `author_done` + the timeout are the fallbacks (a never-authored NPC still shoots).
        try:
            await asyncio.wait_for(gate.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            logger.info(
                "[prewarm] author warm for one houseguest overran %.0fs — shooting its portrait "
                "anyway (re-shoot backstop covers a later store change)", timeout)
        portraits.kickoff_generation([entry], user)

    async def _run() -> None:
        tasks = []
        for entry in st.prompts:
            hid = _prompt_id(entry)
            # A prompt with a known houseguest waits on that NPC's gate; an id-less prompt (no per-NPC
            # signal possible) falls back to the whole-cast gate so it still shoots once authoring ends.
            gate = st.npc_event(hid) if hid else st.author_done
            tasks.append(asyncio.create_task(_shoot_one(entry, gate)))
        if tasks:
            await asyncio.gather(*tasks)

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
