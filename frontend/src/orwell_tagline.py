"""AI-generated player tagline (C33 / feature 0033).

The engine's `playerTagline` is a curated, state-aware line — never model-written (no
narrator is wired engine-side by design; ADR 0003: the engine supplies Vault-free facts,
the FRONT-END LLM voices). This module generates the hero line with the configured
utility/default model, from the public ceremony projection only, with the engine's curated
line as the style anchor and the fail-open chain:

    FE LLM line  →  engine curated line  →  "The house is waiting."

Cached per (user, week, phase, standing) so it regenerates when the MOMENT advances, not
per page load. Vault-free by construction: the prompt carries only public ceremony facts
(week / phase / the player's own HOH / on-the-block / veto badge — what the memory wall
shows), never hidden votes, targeting, souls, or off-screen content.
"""
import asyncio
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# moment-key -> generated line. Bounded: one entry per user per moment; a season produces
# a few dozen keys per user, and the dict is process-local (a restart just regenerates).
_CACHE: dict = {}

_MAX_LEN = 120
_LLM_TIMEOUT = 12  # the homepage hero must never wait long; fail open to the curated line

_INSTRUCTION = (
    "Write ONE short, snarky Big Brother hero line (under 100 characters) addressed to the player "
    "about where they stand right now. Dry, knowing, reality-TV host energy. ANTI-SYCOPHANCY: if "
    "their standing is weak (on the block, powerless), rib them — never flatter, never reassure. "
    "No quotes, no emoji, no preamble: reply with only the line."
)


def _standing(status: dict, player_id: Optional[str]) -> str:
    """The player's public ceremony standing — memory-wall facts only (0020/H3)."""
    if not player_id:
        return "in-the-middle"
    hoh = (status.get("hoh") or {}).get("id") if isinstance(status.get("hoh"), dict) else status.get("hoh")
    if hoh == player_id:
        return "head-of-household"
    nominees = status.get("nominees") or []
    nominee_ids = {(n.get("id") if isinstance(n, dict) else n) for n in nominees}
    if player_id in nominee_ids:
        return "on-the-block"
    veto = status.get("veto") or {}
    holder = (veto.get("holder") or {}).get("id") if isinstance(veto.get("holder"), dict) else veto.get("holder")
    if holder == player_id:
        return "holding-the-veto"
    return "in-the-middle"


def _sanitize(line: str) -> str:
    line = (line or "").strip().splitlines()[0].strip().strip('"“”\'')
    return line[:_MAX_LEN].strip()


async def _generate(standing: str, week, phase, anchor: str, user: Optional[str]) -> Optional[str]:
    """One bounded utility-LLM call; None on any failure (caller falls open)."""
    try:
        from src.endpoint_resolver import resolve_endpoint
        from src.llm_core import llm_call_async
        from src.text_helpers import strip_think

        url, model, headers = resolve_endpoint("utility", owner=user)
        if not model:
            url, model, headers = resolve_endpoint("default", owner=user)
        if not model:
            return None
        raw = await asyncio.wait_for(
            llm_call_async(
                url, model,
                [
                    {"role": "system", "content": _INSTRUCTION},
                    {
                        "role": "user",
                        "content": (
                            f"The player is {standing}, week {week}, phase: {phase}. "
                            f"In the spirit of (but not copying): \"{anchor}\""
                        ),
                    },
                ],
                temperature=0.9,
                max_tokens=2048,  # headroom for reasoning models; strip_think trims
                headers=headers,
                timeout=_LLM_TIMEOUT,
            ),
            timeout=_LLM_TIMEOUT + 2,
        )
        line = _sanitize(strip_think(raw or "", prose=True))
        return line or None
    except Exception as e:
        logger.debug("[orwell] tagline generation fell open to the curated line: %s", e)
        return None


async def get_tagline(user: Optional[str] = None) -> dict:
    """The hero line. Raises only if the ENGINE is unreachable (the route's fail-open
    to the static line handles that); LLM trouble falls open to the curated line here."""
    from src import orwell_engine

    curated = (await orwell_engine.player_tagline(user=user)).get("text") or "The house is waiting."

    # Pre-game (or unreadable state): nothing to be snarky about yet — curated line as-is.
    try:
        state = await orwell_engine.get_game_state(user=user)
        if not (isinstance(state, dict) and state.get("started")):
            return {"text": curated}
        player_id = ((state.get("player") or {}).get("id"))
        status = await orwell_engine.game_status(user=user)
    except Exception:
        return {"text": curated}

    week = status.get("week")
    phase = status.get("phase")
    standing = _standing(status, player_id)
    key = (user or "", week, phase, standing)
    cached = _CACHE.get(key)
    if cached:
        return {"text": cached}

    line = await _generate(standing, week, phase, curated, user)
    text = line or curated
    _CACHE[key] = text
    return {"text": text}
