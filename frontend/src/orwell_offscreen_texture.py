"""Feature 0070 — off-screen society texture enrichment (FE lane).

The engine records off-screen NPC-to-NPC scenes with a deterministic id-slug template (e.g.
``npc:3 gossiped about the house with npc:7``). This module is the FE-owned model-voiced
prose layer: it fans out in parallel (the hermes subagent pattern), voices each scene's
SKELETON (Vault-free — public participant ids + nature only) as a short, vivid in-character
prose beat, and writes each voiced beat back to the engine (``recordOffscreenSceneTexture``).

Hard rules (0070 §§3-6):
- CONTENT ONLY — the write-back cannot alter the witness set, flip the hidden flag, or carry
  any relationship number. The engine enforces this at the MCP boundary.
- FAIL-SOFT — no model OR no usable output ⇒ the deterministic template content simply stands;
  the game advance is never blocked.
- NOT a model lever — the GM-facing manifest does not list these tools; they are FE/infra only.
- Never surfaces enriched prose directly to the player — the existing overhear/gossip pathways
  remain the only route from a hidden scene to the player's knowledge.
- Budget-capped — at most ``MAX_SCENES_PER_TICK`` scenes voiced per tick; skeletons beyond
  that budget retain their deterministic template.
- Idempotent — writing the same texture twice is harmless; the last write wins.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable, Optional

logger = logging.getLogger(__name__)

# Hard cap: voice at most this many scenes per off-screen tick. Each voicing is one LLM call;
# the parallel fan-out keeps latency low but we bound the total call count per tick.
MAX_SCENES_PER_TICK = 6

LlmFn = Callable[[list], Awaitable[str]]           # messages -> completion text ("" on failure)
GetSkeletonsFn = Callable[[], Awaitable[list]]      # () -> list[OffscreenSceneSkeleton]
WriteFn = Callable[[str, str], Awaitable[dict]]     # (eventId, content) -> { ok: bool }


# ── Prompt helpers ────────────────────────────────────────────────────────────────────────────────

def _voicing_messages(nature: str, participants: list[str], template: str) -> list[dict]:
    """Build a tight LLM prompt to voice one off-screen scene skeleton as vivid in-character prose.
    The prompt is Vault-free: it only receives the PUBLIC nature + participant ids + the existing
    template — no relationship numbers, no hidden attributes, no soul data."""
    part_str = " and ".join(f"houseguest {p}" for p in participants[:2])
    system = (
        "You are voicing a short behind-the-scenes beat from a reality-TV social game. "
        "You are given two houseguests, the nature of their off-screen interaction, and a bare "
        "template phrase. Your job: expand it into ONE vivid, in-character prose sentence (30–70 words) "
        "describing what this scene LOOKED and FELT like — the physical setting, tone, and subtext — "
        "without revealing any hidden intent or relationship number. Stay ambiguous about who 'won' the "
        "exchange. No names: refer to participants only as 'the two houseguests', 'one of them', 'the other'. "
        "Output ONLY the one sentence, no preamble, no quotes."
    )
    user = (
        f"Scene nature: {nature}\n"
        f"Participants: {part_str}\n"
        f"Template: {template}\n\n"
        "Write one vivid prose sentence for this off-screen moment:"
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _sanitize_prose(text: str, max_chars: int = 400) -> str:
    """Collapse whitespace and cap length — the same C8 pattern used throughout the engine seams."""
    import re
    return re.sub(r'\s+', ' ', (text or "")).strip()[:max_chars]


# ── Core orchestrator ─────────────────────────────────────────────────────────────────────────────

async def voice_scene(sk: dict, llm_fn: LlmFn, write_fn: WriteFn) -> bool:
    """Voice one off-screen scene skeleton and write the result back. Returns True if the write-back
    was accepted. Fail-soft: any error returns False (the template content stands)."""
    try:
        msgs = _voicing_messages(
            nature=sk.get("nature", "conversation"),
            participants=sk.get("participants", []),
            template=sk.get("templateContent", ""),
        )
        raw = await llm_fn(msgs)
        prose = _sanitize_prose(raw or "")
        if not prose:
            return False
        result = await write_fn(sk["eventId"], prose)
        return bool(result.get("ok"))
    except Exception as exc:
        logger.debug("[offscreen-texture] voice_scene failed for %s: %s", sk.get("eventId"), exc)
        return False


async def enrich_tick(get_skeletons_fn: GetSkeletonsFn, llm_fn: LlmFn, write_fn: WriteFn) -> dict:
    """Fan out: read skeletons for the current tick, voice each in parallel (budget-capped), write
    them back. Returns a summary dict. Never raises — any failure is logged and skipped."""
    try:
        skeletons = await get_skeletons_fn()
    except Exception as exc:
        logger.warning("[offscreen-texture] getOffscreenSceneSkeletons failed: %s", exc)
        return {"voiced": 0, "total": 0, "error": str(exc)}

    if not isinstance(skeletons, list) or not skeletons:
        return {"voiced": 0, "total": 0}

    # Budget-cap: take the first MAX_SCENES_PER_TICK skeletons only.
    batch = skeletons[:MAX_SCENES_PER_TICK]
    total = len(batch)

    tasks = [voice_scene(sk, llm_fn, write_fn) for sk in batch]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    voiced = sum(1 for r in results if r is True)

    logger.debug("[offscreen-texture] tick voiced %d/%d scenes", voiced, total)
    return {"voiced": voiced, "total": total}


# ── Live wiring (best-effort; graceful no-op when no model) ──────────────────────────────────────

async def run_enrich(owner: Optional[str] = None) -> dict:
    """Resolve the live deps and enrich the current tick's off-screen scenes. Silent no-op (not
    voiced) when no model resolves — the engine's deterministic template content stands.

    Called from the FE after each off-screen tick (e.g. from the agent loop or a background task).
    Best-effort + background — never blocks the game advance."""
    try:
        from src.tool_implementations import _resolve_llm_fn, _mcp_tool_call

        llm_fn = await _resolve_llm_fn(owner)
        if llm_fn is None:
            logger.debug("[offscreen-texture] no model configured — skipping enrichment")
            return {"voiced": 0, "total": 0, "reason": "no-model"}

        async def get_skeletons() -> list:
            result = await _mcp_tool_call("getOffscreenSceneSkeletons", {}, owner=owner)
            return result if isinstance(result, list) else []

        async def write_back(event_id: str, content: str) -> dict:
            result = await _mcp_tool_call(
                "recordOffscreenSceneTexture",
                {"eventId": event_id, "content": content},
                owner=owner,
            )
            return result if isinstance(result, dict) else {"ok": False}

        return await enrich_tick(get_skeletons, llm_fn, write_back)

    except Exception as exc:
        logger.warning("[offscreen-texture] run_enrich failed: %s", exc)
        return {"voiced": 0, "total": 0, "error": str(exc)}
