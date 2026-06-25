"""P1 regression: an OpenAI-compatible chat POST must target /chat/completions, never a bare base.

The live incident: the player's session stored its endpoint as the raw provider base
(`https://openrouter.ai/api/v1`). The agent loop POSTed that base directly, so OpenRouter
returned its HTML landing page — HTTP 200 with a ~150KB unparseable body — which surfaced
as an empty completion (no content, no usage) and a vanished turn. `resolve_endpoint`
appends the path via `build_chat_url`, but the session-bound `endpoint_url` path did not.

`_ensure_openai_chat_path` is the defensive fix applied at every OpenAI-compatible POST site
in llm_core. These tests pin its contract: a bare base gets `/chat/completions`; an
already-resolved URL is unchanged; non-standard custom paths are left alone.
"""
from src.llm_core import _ensure_openai_chat_path


def test_bare_openrouter_base_gets_chat_completions():
    # The exact live-incident value.
    assert _ensure_openai_chat_path("https://openrouter.ai/api/v1") == (
        "https://openrouter.ai/api/v1/chat/completions"
    )
    # Trailing slash is tolerated.
    assert _ensure_openai_chat_path("https://openrouter.ai/api/v1/") == (
        "https://openrouter.ai/api/v1/chat/completions"
    )


def test_bare_v1_base_gets_chat_completions():
    assert _ensure_openai_chat_path("https://api.openai.com/v1") == (
        "https://api.openai.com/v1/chat/completions"
    )


def test_already_resolved_url_is_unchanged():
    full = "https://openrouter.ai/api/v1/chat/completions"
    assert _ensure_openai_chat_path(full) == full
    # Other known completion paths are left intact too.
    assert _ensure_openai_chat_path("https://x.example/v1/completions") == (
        "https://x.example/v1/completions"
    )
    assert _ensure_openai_chat_path("https://x.example/v1/responses") == (
        "https://x.example/v1/responses"
    )


def test_nonstandard_custom_path_is_left_untouched():
    # A provider with its own path that isn't a bare /v1|/api base must not be rewritten.
    custom = "https://opencode.ai/zen/go"
    assert _ensure_openai_chat_path(custom) == custom


def test_empty_and_none_are_safe():
    assert _ensure_openai_chat_path("") == ""
    assert _ensure_openai_chat_path(None) is None


def test_post_sites_use_the_normalizer():
    """Guard the wiring: every OpenAI-compatible POST target in llm_core must route the URL
    through _ensure_openai_chat_path so a future edit can't reintroduce the bare-base POST."""
    import re
    from pathlib import Path
    src = (Path(__file__).resolve().parents[1] / "src" / "llm_core.py").read_text()
    # No OpenAI-compatible branch may assign the raw url straight to target_url.
    assert "target_url = url\n" not in src, (
        "an OpenAI-compatible POST assigns the bare url to target_url — route it through "
        "_ensure_openai_chat_path() so a base endpoint URL gets /chat/completions"
    )
    assert src.count("target_url = _ensure_openai_chat_path(url)") >= 3
