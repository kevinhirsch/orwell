"""Server-side reasoning/censor chokepoint for the multi-platform gateway (feature 0072).

Pattern modeled on hermes-agent stream_dispatch.py (MIT © 2025 Nous Research —
see frontend/ACKNOWLEDGMENTS.md).

The browser chat splits live-stream events by channel: reasoning deltas go into a
"Thinking" accordion and never appear in the public message bubble.  A messaging
platform has no accordion — so this module is the equivalent safety net: it filters
the FINAL assembled reply before delivery to any platform adapter.

The chokepoint must fire regardless of which prompt produced the content and
regardless of which platform is receiving it.  There is no opt-out.
"""

import re

# ── patterns ──────────────────────────────────────────────────────────────────

# <think>…</think> blocks (reasoning tokens emitted by some models)
_REASONING_RE = re.compile(r"<think>.*?</think>", re.DOTALL)

# [OPERATOR: …] operator-aside markers (internal production notes)
_OPERATOR_ASIDE_RE = re.compile(r"\[OPERATOR:.*?\]", re.DOTALL)

# Raw npc:<id> references that must never reach the player
_NPC_ID_RE = re.compile(r"\bnpc:[a-zA-Z0-9_-]+\b")


# ── public API ────────────────────────────────────────────────────────────────

def scrub_for_platform(text: str) -> str:
    """Strip reasoning blocks, operator-asides, and raw npc: IDs from outbound text.

    This is the server-side safety chokepoint for the accordion-less transport.
    Must fire for every platform delivery regardless of which prompt produced
    the content.  Returns the scrubbed text, stripped of leading/trailing
    whitespace.
    """
    if not text:
        return ""
    text = _REASONING_RE.sub("", text)
    text = _OPERATOR_ASIDE_RE.sub("", text)
    text = _NPC_ID_RE.sub("[houseguest]", text)
    return text.strip()
