"""Feature 0070 (FE lane) — enrich already-recorded off-screen scene prose with model-voiced texture.

The engine records off-screen NPC-to-NPC scenes deterministically (which pair, what nature, seeded
relationship fold, gossip rise, overhear pathways). Their prose ``content`` is a simple template
(``"two houseguests schemed together"``). This module fans out parallel utility-LLM calls — one per
scene skeleton — and writes richer voiced prose back via ``recordOffscreenSceneTexture``.

Hard rules (0070 §Invariants):
- **Content-only.** Cannot create events, change witness sets, flip hidden flags, or carry numbers.
- **Vault-free.** Only public personas + scene nature label reach the model; no hidden attribute, no
  relationship number, no true goal ever crosses.
- **Fail-soft.** No model / no key / LLM error → the deterministic template content simply stands
  (byte-identical); the game advance is unaffected.
- **Budget-capped.** At most ``MAX_TEXTURE_SCENES`` scenes enriched per off-screen tick.
- **Open/closed non-collapse.** The seeded relationship fold is committed BEFORE this module is
  ever called; enrichment changes ONLY prose. ``expressiveNonCollapse`` stays green.

Pattern credit: adopts the parallel isolated-subagent fan-out shape from hermes-agent
``tools/delegate_tool.py`` (MIT © 2025 Nous Research — attribution retained; pattern only, no code
lift). See ``frontend/ACKNOWLEDGMENTS.md``.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Budget cap: at most this many scenes enriched per off-screen tick. Conservative start; tunable.
MAX_TEXTURE_SCENES = 3

# Word budget per scene (the model is asked to keep it short; the engine does not truncate).
_WORD_BUDGET = 100


def _build_prompt(scene: dict) -> list[dict]:
    """Build a minimal, public-persona-only synthesis prompt for ONE off-screen scene.

    ``scene`` carries: ``eventId`` (opaque), ``participants`` (list of public-persona dicts with at
    least ``name``), ``type`` (the nature label: bonding | strategy | conflict | gossip | alliance |
    showmance | betrayal). No hidden attribute, no stat, no relationship number ever appears here.
    """
    names = [p.get("name", "a houseguest") for p in scene.get("participants", [])]
    nature = scene.get("type", "interaction")
    participant_line = " and ".join(names) if len(names) >= 2 else (names[0] if names else "two houseguests")

    # Optional persona flavor (archetype / demeanor) for each participant — public facets only.
    persona_lines: list[str] = []
    for p in scene.get("participants", []):
        bits = []
        if p.get("archetype"):
            bits.append(p["archetype"])
        if p.get("demeanor"):
            bits.append(p["demeanor"])
        if bits and p.get("name"):
            persona_lines.append(f"{p['name']}: {', '.join(bits)}")

    persona_block = ("\n".join(persona_lines) + "\n") if persona_lines else ""

    system = (
        "You are a Big Brother off-screen scene writer. Write a BRIEF, vivid, in-universe "
        "description of what happened in this private moment between houseguests. "
        "Stay under 100 words. Voice the texture — what was said, the mood, a detail — "
        "but do NOT invent alliance names, relationship labels, stats, or game outcomes. "
        "Output prose only; no headers, no quotes, no meta-commentary."
    )
    user = (
        f"{persona_block}"
        f"Scene between {participant_line}.\n"
        f"Nature: {nature}.\n\n"
        f"Write a vivid, under-{_WORD_BUDGET}-word in-universe description of this off-screen moment:"
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


async def _enrich_one(scene: dict, llm_fn, write_fn) -> None:
    """Voice ONE scene and write the texture back. Completely fail-soft: any exception is caught and
    logged; the deterministic template content simply stands. Never raises into the caller."""
    event_id = scene.get("eventId")
    if not event_id:
        return
    try:
        messages = _build_prompt(scene)
        text: str = await llm_fn(messages)
        if not isinstance(text, str) or not text.strip():
            return
        prose = text.strip()
        await write_fn({"eventId": event_id, "content": prose})
    except Exception as e:
        logger.debug("[offscreen-texture] scene %r enrichment failed (fail-soft): %s", event_id, e)


async def enrich_offscreen_scenes(scene_skeletons: list[dict], llm_fn, write_fn) -> None:
    """Fan out parallel LLM calls to voice each off-screen scene skeleton, then write back.

    Args:
        scene_skeletons: list of ``{ eventId, participants: [publicPersona, ...], type }`` — public
            personas only (name, archetype, demeanor, etc.; NO hidden attributes or numbers).
        llm_fn: ``async (messages: list[dict]) -> str`` — the utility LLM completion function.
        write_fn: ``async (req: dict) -> dict`` — the engine write-back function.
            Calls ``recordOffscreenSceneTexture({ eventId, content })``.

    Fail-soft: any per-scene exception is caught and logged; the budget cap is enforced here.
    Never raises; the game advance is unaffected.
    """
    if not scene_skeletons or llm_fn is None:
        return
    capped = scene_skeletons[:MAX_TEXTURE_SCENES]
    tasks = [_enrich_one(s, llm_fn, write_fn) for s in capped]
    # gather with return_exceptions so one failed scene never kills the others.
    results = await asyncio.gather(*tasks, return_exceptions=True)
    for i, r in enumerate(results):
        if isinstance(r, Exception):
            logger.debug("[offscreen-texture] gather exception for scene[%d]: %s", i, r)


# ── live wiring (best-effort, background; graceful no-op when no model) ─────────────

async def run_texture_enrichment(scene_skeletons: list[dict], owner: Optional[str]) -> None:
    """Resolve the live deps and enrich the scene skeletons.  Silent no-op when no model resolves
    or when the scene list is empty — the engine's deterministic floor simply stands."""
    if not scene_skeletons:
        return
    try:
        from src.orwell_cast_authoring import _resolve_llm_fn  # shared background-utility completion
    except Exception:
        logger.debug("[offscreen-texture] could not import _resolve_llm_fn — skipping enrichment")
        return
    llm_fn = await _resolve_llm_fn(owner)
    if llm_fn is None:
        logger.debug("[offscreen-texture] no utility model — keeping deterministic content")
        return

    from src import orwell_engine

    async def _write(req: dict) -> dict:
        return await orwell_engine.record_offscreen_scene_texture(
            req["eventId"], req["content"], user=owner
        )

    await enrich_offscreen_scenes(scene_skeletons, llm_fn, _write)


def kickoff_texture_enrichment(scene_skeletons: list[dict], owner: Optional[str]) -> None:
    """Fire-and-forget the texture enrichment in the background after an off-screen tick.
    Never blocks the game advance; never raises into the caller. Graceful no-op when the list is
    empty or no model is configured."""
    if not scene_skeletons:
        return

    async def _runner():
        try:
            await run_texture_enrichment(scene_skeletons, owner)
        except Exception as e:  # pragma: no cover - defensive
            logger.warning("[offscreen-texture] background enrichment failed: %s", e)

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_runner())
    except RuntimeError:
        # No running loop (a sync caller / test) — run to completion synchronously.
        try:
            asyncio.run(_runner())
        except Exception:
            pass


def kickoff_texture_enrichment_after_advance(owner: Optional[str], since_beat_seq: Optional[int] = None) -> None:
    """Fetch scene skeletons from the engine and fire-and-forget the texture enrichment.
    Called after an ``advanceGame`` tick to voice newly-recorded off-screen scenes.
    Never blocks the game advance; never raises into the caller. Graceful no-op when no
    scenes exist or no model is configured."""

    async def _runner():
        try:
            from src import orwell_engine
            skeletons = await orwell_engine.get_offscreen_scene_skeletons(
                user=owner, since_beat_seq=since_beat_seq
            )
            if not skeletons:
                return
            await run_texture_enrichment(skeletons, owner)
        except Exception as e:
            logger.debug("[offscreen-texture] post-advance enrichment skipped: %s", e)

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_runner())
    except RuntimeError:
        # No running loop (a sync caller / test) — run to completion synchronously.
        try:
            asyncio.run(_runner())
        except Exception:
            pass
