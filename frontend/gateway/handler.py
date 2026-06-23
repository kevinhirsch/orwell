"""Gateway turn handler for the multi-platform gateway (feature 0072).

Routes an inbound platform message to the player's game over the existing Vault-free
MCP player channel (src.orwell_engine), then scrubs the reply before delivery.

The game-build flag is always ON for the gateway — platform players reach only the
keep-set game tools; inherited-workspace tools (the drop-set) are unavailable by
construction (the engine player channel never exposes them).

Architecture note: this module calls :mod:`src.orwell_engine` directly, the same
thin async HTTP client the web FE uses.  It does NOT import any TS port or Vault
adapter — Vault-safe by inheritance.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

from .pairing import get_paired_user
from .scrub import scrub_for_platform

logger = logging.getLogger(__name__)

# The game build is structurally ON for gateway turns: no inherited-workspace tools.
# This sentinel is used in tests; the real enforcement is the engine player channel
# only exposing keep-set tools.
GATEWAY_GAME_BUILD = True

_UNPAIRED_MSG = (
    "You are not paired to an Orwell account. "
    "Send /pair in this chat to get a pairing code, then enter it in the Orwell settings."
)
_ENGINE_ERROR_MSG = (
    "The game engine is unavailable right now. Please try again in a moment."
)


async def handle_platform_turn(
    platform_id: str,
    platform_identity: str,
    message_text: str,
    *,
    orwell_user: Optional[str] = None,
) -> str:
    """Route an inbound platform message to the player's game and return the scrubbed reply.

    Parameters
    ----------
    platform_id:
        The adapter's ``platform_id`` (e.g. ``"telegram"``).  Used only for logging.
    platform_identity:
        The fully-qualified platform identity (e.g. ``"telegram:123456"``).
    message_text:
        The player's raw message text from the messaging platform.
    orwell_user:
        Optional override: if supplied the pairing lookup is skipped (used in tests
        that inject a user directly without a full pairing store).

    Returns the scrubbed reply string ready for delivery to the messaging platform.
    The scrub chokepoint (:func:`.scrub.scrub_for_platform`) fires unconditionally.
    """
    # 1. Resolve the orwell user via the pairing store (or the test override)
    user = orwell_user or get_paired_user(platform_identity)
    if user is None:
        logger.info(
            "gateway: unpaired identity %s on platform %s", platform_identity, platform_id
        )
        # Scrub even the unpaired message (invariant: chokepoint always fires)
        return scrub_for_platform(_UNPAIRED_MSG)

    # 2. Call the engine via the player channel with x-orwell-user = user.
    #    Reuse the same Vault-free orwell_engine client the web FE uses — no new HTTP
    #    client, no Vault import, no special plumbing.
    reply = await _call_player_turn(user, message_text)

    # 3. Scrub before delivery — the chokepoint must fire regardless of reply source.
    return scrub_for_platform(reply)


async def _call_player_turn(user: str, message_text: str) -> str:
    """Drive one player turn over the MCP player channel.

    For the gateway's first wave (Telegram), we use a lightweight single-call path:
    ``getMomentPrompt`` to get the current game context, then a simple narration call.
    This avoids importing the full streaming agent loop (which is optimised for the
    browser's SSE/streaming path) while still going through the correct Vault-free
    player channel.

    The gateway does NOT stream partial deltas — it waits for the full reply, scrubs
    it, and delivers it as a single message.  Streaming per-platform is a follow-on.
    """
    try:
        from src import orwell_engine
    except ImportError as exc:
        logger.error("gateway: cannot import orwell_engine: %s", exc)
        return _ENGINE_ERROR_MSG

    # Get the current game state (Vault-free visible projection)
    try:
        game_state = await orwell_engine.get_game_state(user=user)
    except orwell_engine.EngineToolError as exc:
        if exc.no_game:
            return scrub_for_platform(
                "No active game found for your account. "
                "Start a new game at the Orwell web interface first."
            )
        logger.warning("gateway: get_game_state failed for user %s: %s", user, exc)
        return _ENGINE_ERROR_MSG
    except Exception as exc:
        logger.warning("gateway: engine unreachable for user %s: %s", user, exc)
        return _ENGINE_ERROR_MSG

    # Get the moment prompt (the game master's framing for the current beat)
    try:
        moment_data = await orwell_engine.get_moment_prompt(
            moment=None, user=user
        )
        moment_prompt = (
            moment_data.get("systemPrompt", "")
            if isinstance(moment_data, dict)
            else str(moment_data or "")
        )
    except Exception as exc:
        logger.warning("gateway: get_moment_prompt failed for user %s: %s", user, exc)
        moment_prompt = ""

    # Build a concise system prompt for the gateway turn.
    # The gateway does not run the full agent loop — it makes a single narration call
    # using the moment prompt as context.  This is intentionally lightweight.
    system_prompt = _build_gateway_system_prompt(moment_prompt, game_state)

    # Make the narration call via the configured LLM endpoint.
    # The gateway shares the app-level LLM configuration (default model/endpoint).
    try:
        reply = await _narrate_gateway_turn(
            system_prompt=system_prompt,
            user_message=message_text,
            user=user,
        )
    except Exception as exc:
        logger.warning("gateway: narration failed for user %s: %s", user, exc)
        return _ENGINE_ERROR_MSG

    return reply or _ENGINE_ERROR_MSG


def _build_gateway_system_prompt(moment_prompt: str, game_state: dict) -> str:
    """Build a concise system prompt for a gateway (messaging platform) turn.

    The messaging platform has no accordion, no decision cards, no streaming UI —
    so the prompt tells the model to deliver a single self-contained reply in plain
    text (no Markdown tables, minimal formatting) that works in a chat message.
    """
    parts = []
    if moment_prompt:
        parts.append(moment_prompt)
    parts.append(
        "\n\n[GATEWAY MODE: you are responding via a messaging platform. "
        "Deliver a single, self-contained reply in plain text. "
        "No markdown tables or complex formatting. "
        "If there is a pending decision, present the options as a numbered list. "
        "Never reveal reasoning, operator notes, or internal tool IDs.]"
    )
    return "\n".join(parts)


async def _narrate_gateway_turn(
    system_prompt: str,
    user_message: str,
    user: str,
) -> str:
    """Make a single LLM narration call for a gateway turn.

    Uses the app-level model configuration (same as the web chat).  Returns the
    assistant's reply text, or raises on failure.
    """
    # NARR-1 (#620): `_resolve_llm_fn` lives in `orwell_cast_authoring`, NOT `agent_loop` — the old
    # import raised ImportError every turn, so the gateway ALWAYS returned the "not configured"
    # placeholder and never actually narrated. It is ALSO an async resolver keyed by `owner` that
    # returns an `LlmFn` taking a `messages: list[dict]` and returning a string (no `system=`/`stream=`
    # kwargs). Use the real contract: resolve over the user's model, then pass a system + user message
    # pair (the resolver hands the whole list to the completion).
    llm_fn = None
    try:
        from src.orwell_cast_authoring import _resolve_llm_fn  # type: ignore[attr-defined]
        llm_fn = await _resolve_llm_fn(user)
    except Exception as exc:
        logger.warning("gateway _narrate_gateway_turn: model resolve failed: %s", exc)
        llm_fn = None

    if llm_fn is None:
        # No LLM configured — return a helpful placeholder
        return (
            "The narration model is not configured. "
            "Set a default model in Orwell settings to enable messaging-platform play."
        )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message},
    ]
    try:
        result = await llm_fn(messages)
        # The resolver's LlmFn returns the assembled assistant text; tolerate a dict shape too.
        if isinstance(result, str):
            return result
        if isinstance(result, dict):
            return result.get("content") or result.get("text") or str(result)
        return str(result)
    except Exception as exc:
        logger.warning("gateway _narrate_gateway_turn: LLM call failed: %s", exc)
        raise
