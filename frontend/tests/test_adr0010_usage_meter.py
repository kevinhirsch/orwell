"""ADR 0010 / feature 0069 — Slice A (the metered boundary).

The token economy is unmanaged because the usage envelope OpenRouter already returns is mostly
discarded. Slice A captures it: the streaming parse surfaces cached/reasoning/cost, the trace stops
redacting the count keys, and the agent loop records ONE Vault-free token/cost entry per live turn.

Roles only. The agent-loop leg is driven for real (fake LLM stream → real generator); the llm_core
streaming hot path is source-pinned (the same split test_fs4d_truncation.py uses — it isn't
hermetically unit-drivable end to end here).
"""
import asyncio
import json
import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


# ── llm_trace._scrub: keep the count keys, still redact real secrets ──────────────

def test_scrub_preserves_token_counts_but_redacts_secrets():
    from src.llm_trace import _scrub
    obj = {
        "usage": {
            "prompt_tokens": 565, "completion_tokens": 2400, "total_tokens": 2965,
            "cached_tokens": 512, "reasoning_tokens": 1800,
        },
        "authorization": "Bearer sk-secret", "api_key": "k-secret",
        "token": "raw-bearer-secret", "secret": "s",
        "model": "deepseek/deepseek-v4-pro",
    }
    out = _scrub(obj)
    # The COUNT keys (all plural *_tokens) survive — the whole point of the meter.
    assert out["usage"]["prompt_tokens"] == 565
    assert out["usage"]["completion_tokens"] == 2400
    assert out["usage"]["total_tokens"] == 2965
    assert out["usage"]["cached_tokens"] == 512
    assert out["usage"]["reasoning_tokens"] == 1800
    # Real secrets are STILL redacted (singular `token`, authorization, api_key, secret).
    assert out["authorization"] != "Bearer sk-secret"
    assert out["api_key"] != "k-secret"
    assert out["token"] != "raw-bearer-secret"
    assert out["secret"] != "s"
    # A non-secret field is untouched.
    assert out["model"] == "deepseek/deepseek-v4-pro"


# ── llm_core streaming parse: the envelope fields are read off `usage` ─────────────

def test_llm_core_parse_reads_the_full_envelope():
    src = _read("src", "llm_core.py")
    assert 'u.get("prompt_tokens_details")' in src, "must read cached-prompt details"
    assert '_usage_data["cached_tokens"]' in src, "must surface cached_tokens"
    assert '_usage_data["reasoning_tokens"]' in src, "must surface reasoning_tokens"
    assert '_usage_data["cost"] = u.get("cost")' in src, "must surface the per-request cost"
    assert '_usage_data["provider"] = provider' in src, "must surface which provider served"


def test_llm_core_requests_openrouter_usage_accounting():
    src = _read("src", "llm_core.py")
    # OpenRouter only emits usage.cost when usage accounting is requested via its own flag.
    assert 'payload["usage"] = {"include": True}' in src, \
        "the OpenRouter streaming builder must request usage accounting so cost is returned"


# ── agent_loop: one Vault-free token/cost record per live-game turn ───────────────

def _drive_meter(monkeypatch, *, usage_data: dict, game_mode="game", owner="tester"):
    """Drive the REAL stream_agent_loop with a fake one-round stream carrying a `usage` event;
    capture the kwargs handed to orwell_token_ledger.record_turn."""
    from src import agent_loop as al
    from src import orwell_token_ledger as tl

    monkeypatch.delenv("ORWELL_GAME_BUILD", raising=False)
    monkeypatch.setattr(al, "get_setting", lambda key, default=None: default)
    import src.tool_index as ti
    monkeypatch.setattr(ti, "get_tool_index", lambda: None)

    captured: dict = {}

    def fake_record_turn(user, **kw):
        captured["user"] = user
        captured.update(kw)

    monkeypatch.setattr(tl, "record_turn", fake_record_turn)

    async def fake_stream(candidates, messages, **kwargs):
        yield 'data: {"delta": "The houseguests gather in the living room."}\n\n'
        yield 'data: ' + json.dumps({"type": "usage", "data": usage_data}) + '\n\n'
        yield "data: [DONE]\n\n"

    monkeypatch.setattr(al, "stream_llm_with_fallback", fake_stream)

    async def drive():
        gen = al.stream_agent_loop(
            "https://openrouter.ai/api/v1/chat/completions",
            "deepseek/deepseek-v4-pro",
            [{"role": "system", "content": "You are the narrator."},
             {"role": "user", "content": "Take a slow lap around the house."}],
            max_rounds=2, game_mode=game_mode, owner=owner,
        )
        async for _chunk in gen:
            pass

    asyncio.get_event_loop().run_until_complete(drive())
    return captured


def test_meter_records_full_envelope_for_a_live_turn(monkeypatch):
    cap = _drive_meter(monkeypatch, usage_data={
        "input_tokens": 565, "output_tokens": 2400,
        "cached_tokens": 512, "reasoning_tokens": 1800,
        "cost": 0.0033, "provider": "openrouter",
        "model": "deepseek/deepseek-v4-pro",
    })
    assert cap.get("user") == "tester"
    assert cap.get("call_class") == "narration"
    assert cap.get("input_tokens") == 565
    assert cap.get("output_tokens") == 2400
    assert cap.get("cached_tokens") == 512
    assert cap.get("reasoning_tokens") == 1800
    assert abs(float(cap.get("cost")) - 0.0033) < 1e-9
    assert cap.get("provider") == "openrouter"
    # context_percent is always passed (a Vault-free projection); numeric, never None.
    assert cap.get("context_percent") is not None


def test_meter_is_silent_for_a_non_live_turn(monkeypatch):
    # A non-game (platform chat) turn must NOT write a game token-ledger entry.
    cap = _drive_meter(monkeypatch, game_mode=None, owner="tester", usage_data={
        "input_tokens": 100, "output_tokens": 50,
    })
    assert cap == {}, "the token ledger records only live-game turns"
