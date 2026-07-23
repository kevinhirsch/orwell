"""#1867: reasoning vault wall — server-side structural gating of thinking deltas.

ADR-0019 Layer 2 means the MODEL receives Vault/hidden state (presentKnowledge in
narration prompts). The Vault Wall mandate says enforcement is in CODE at the
port/tool boundary, never by prompt/rendering convention.

R-VLT-2: when game_mode is truthy (live season or casting), the `if data.get("thinking"):`
block in `_stream_agent_loop_impl` must NOT yield the raw SSE chunk to the frontend.
In debug builds (game_mode=False), thinking deltas pass through normally.

All strings are generic probes — not Vault material, not production data.
"""
import json
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest


# ── Mock SSE chunks containing Vault-looking thinking deltas ─────────────────

MOCK_VAULT_DELTAS = [
    'data: {"thinking": true, "delta": "presentKnowledge: NPC_Alice knows secret"}\n\n',
    'data: {"thinking": true, "delta": "Bo knows things"}\n\n',
    'data: {"thinking": true, "delta": " presentKnowledge: faction alliance"}\n\n',
    'data: {"delta": "Narrator text"}\n\n',
]

DONE_CHUNK = 'data: [DONE]\n\n'


async def _mock_stream(*args, **kwargs):
    """Mock stream_llm_with_fallback that yields thinking + content deltas."""
    for c in MOCK_VAULT_DELTAS:
        yield c
    yield DONE_CHUNK


async def _mock_empty_stream(*args, **kwargs):
    """Mock stream that only yields DONE."""
    yield DONE_CHUNK


# ── Async helpers ───────────────────────────────────────────────────────────

async def _collect_yields(game_mode):
    """Run _stream_agent_loop_impl with mocked stream and return all yielded chunks."""
    from src.agent_loop import _stream_agent_loop_impl
    import src.agent_loop as al

    orig = al.stream_llm_with_fallback
    al.stream_llm_with_fallback = _mock_stream
    try:
        collected = []
        async for chunk in _stream_agent_loop_impl(
            endpoint_url="http://fake:8000/v1/chat/completions",
            model="test-model",
            messages=[{"role": "user", "content": "test"}],
            game_mode=game_mode,
            max_rounds=1,
        ):
            collected.append(chunk)
            if '[DONE]' in chunk:
                break
        return collected
    finally:
        al.stream_llm_with_fallback = orig


# ── Tests ───────────────────────────────────────────────────────────────────

class TestReasoningVaultWall:
    """#1867: server-side gating of thinking deltas by game_mode."""

    @pytest.mark.asyncio
    async def test_game_build_walls_thinking_deltas(self):
        """game_mode=True must NOT yield any chunk containing thinking=true."""
        collected = await _collect_yields(game_mode=True)
        vault_lines = [
            c for c in collected
            if '"thinking": true' in c or '"thinking":true' in c
        ]
        vault_content = [
            c for c in collected
            if 'presentKnowledge' in c
        ]
        assert len(vault_lines) == 0, (
            f"Expected 0 thinking deltas in game build, got {len(vault_lines)}: {vault_lines}"
        )
        assert len(vault_content) == 0, (
            f"Game build leaked Vault content: {vault_content}"
        )

    @pytest.mark.asyncio
    async def test_debug_build_passes_thinking_deltas(self):
        """game_mode=False must yield thinking deltas normally (regression check)."""
        collected = await _collect_yields(game_mode=False)
        vault_lines = [
            c for c in collected
            if '"thinking": true' in c or '"thinking":true' in c
        ]
        assert len(vault_lines) > 0, (
            f"Expected at least 1 thinking delta in debug build, got 0"
        )

    @pytest.mark.asyncio
    async def test_casting_build_walls_thinking_deltas(self):
        """game_mode='casting' must also wall thinking deltas."""
        collected = await _collect_yields(game_mode="casting")
        vault_lines = [
            c for c in collected
            if '"thinking": true' in c or '"thinking":true' in c
        ]
        assert len(vault_lines) == 0, (
            f"Expected 0 thinking deltas in casting build, got {len(vault_lines)}: {vault_lines}"
        )

    @pytest.mark.asyncio
    async def test_non_thinking_content_still_passes(self):
        """Non-thinking content deltas must pass through in game build."""
        collected = await _collect_yields(game_mode=True)
        content_lines = [
            c for c in collected
            if '"delta": "Narrator' in c
        ]
        assert len(content_lines) > 0, (
            "Non-thinking content delta should pass through in game build"
        )
