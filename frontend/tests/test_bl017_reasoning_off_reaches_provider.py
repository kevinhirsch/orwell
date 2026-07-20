"""BL-017 — the reasoning-OFF signal reaches the provider for live reasoning models.

A call class resolving to reasoning "off" carries ``reasoning is None`` into
``_apply_reasoning_budget``, which sends ``reasoning:{"enabled":false}`` — the strongest OpenRouter
disable. On the live openrouter path it was already sent; the gap was a reasoning model behind a
generic OpenAI-compatible host, where the older ``_supports_thinking`` list (no glm / deepseek-v /
thinkingmachines) let it fall through and reason by default (~40% of output billed as reasoning).

Golden-neutral: the openrouter branch is byte-identical (it always sent the disable), and the
streaming ``<think>``-tag handling (which keys on ``_THINKING_MODEL_PATTERNS``) is untouched.
"""
from src import llm_core as L


def _off_payload(provider, model):
    payload = {}
    L._apply_reasoning_budget(payload, provider, model, {"reasoning": None})
    return payload.get("reasoning")


# ── the live openrouter path is unchanged (golden-neutral) ──────────────────────────

def test_openrouter_reasoning_off_unchanged():
    assert _off_payload("openrouter", "z-ai/glm-4.7") == {"enabled": False}
    assert _off_payload("openrouter", "qwen/qwen3.6-flash") == {"enabled": False}


# ── the fix: reasoning models behind a generic OpenAI-compatible host now get the disable ──

def test_reasoning_off_reaches_non_openrouter_reasoning_models():
    assert _off_payload("openai", "z-ai/glm-4.7") == {"enabled": False}
    assert _off_payload("openai", "deepseek/deepseek-v4-pro") == {"enabled": False}
    assert _off_payload("openai", "thinkingmachines/inkling") == {"enabled": False}


def test_plain_chat_model_stays_byte_identical():
    # a non-reasoning model on a strict OpenAI-compatible host must not gain an unknown `reasoning`
    # field (it could 400) — no disable is sent.
    assert _off_payload("openai", "gpt-4o") is None


def test_thinking_tag_streaming_behavior_for_glm_unchanged():
    # _supports_thinking gates the streaming <think>-prepend; adding glm to the reasoning-off set must
    # NOT flip that (it lives in a separate list), or the narration stream behavior would change.
    assert L._supports_thinking("z-ai/glm-4.7") is False
