"""ADR 0010 / feature 0069 — Slice B (the reasoning budget, the dominant cost lever).

Two legs, both driven for real:
  • the llm_core payload builder actually puts a `reasoning` budget on the wire — and crucially it
    FIRES for the live model (DeepSeek-V4 via OpenRouter), which `_supports_thinking` does NOT match;
  • the agent loop resolves the per-call-class policy and passes it down (admin-overridable; off→omit;
    non-game chat carries no policy ⇒ byte-identical).

Roles only.
"""
import asyncio
import json

OR_URL = "https://openrouter.ai/api/v1/chat/completions"
OAI_URL = "https://api.openai.com/v1/chat/completions"


# ── llm_core builder: a `reasoning` budget reaches the payload (provider-aware) ────

class _FakeResp:
    status_code = 200

    async def aiter_lines(self):
        for ln in ['data: {"choices":[{"delta":{"content":"hi"}}]}', "data: [DONE]"]:
            yield ln

    async def aread(self):
        return b""


class _FakeStreamCM:
    def __init__(self, captured, payload):
        captured["payload"] = payload

    async def __aenter__(self):
        return _FakeResp()

    async def __aexit__(self, *a):
        return False


class _FakeClient:
    def __init__(self, captured):
        self._captured = captured

    def stream(self, method, url, json=None, headers=None, timeout=None):
        return _FakeStreamCM(self._captured, json)


def _capture_payload(monkeypatch, url, model, *, policy):
    from src import llm_core as lc
    captured: dict = {}
    monkeypatch.setattr(lc, "_get_http_client", lambda: _FakeClient(captured))
    monkeypatch.setattr(lc, "_is_host_dead", lambda u: False)
    monkeypatch.setattr(lc, "note_model_activity", lambda *a, **k: None)
    monkeypatch.setattr(lc, "_clear_host_dead", lambda *a, **k: None)

    async def drive():
        async for _ in lc.stream_llm(url, model, [{"role": "user", "content": "x"}], policy=policy):
            pass

    asyncio.get_event_loop().run_until_complete(drive())
    return captured.get("payload") or {}


def test_reasoning_fires_for_the_live_model_via_openrouter(monkeypatch):
    # The whole point: DeepSeek-V4 is a reasoning model but `_supports_thinking` doesn't match it,
    # so the budget MUST still reach the wire through the OpenRouter unified-param path.
    p = _capture_payload(monkeypatch, OR_URL, "deepseek/deepseek-v4-pro",
                         policy={"reasoning": {"effort": "medium"}, "max_tokens": 4096})
    assert p.get("reasoning") == {"effort": "medium"}


def test_reasoning_off_is_a_genuine_disable_on_openrouter(monkeypatch):
    # "off" (policy reasoning is None) must ACTIVELY disable reasoning on a reasoning model —
    # OMITTING the field would leave the provider default (often ON), so "off" would not be a
    # cost floor. OpenRouter unified form: reasoning:{"enabled": false}.
    p = _capture_payload(monkeypatch, OR_URL, "deepseek/deepseek-v4-pro", policy={"reasoning": None})
    assert p.get("reasoning") == {"enabled": False}


def test_reasoning_off_left_untouched_for_openai_o_series(monkeypatch):
    # o-series reasoning is intrinsic and cannot be disabled — we leave the default (no field).
    p = _capture_payload(monkeypatch, OAI_URL, "o3-mini", policy={"reasoning": None})
    assert "reasoning" not in p and "reasoning_effort" not in p


def test_no_policy_is_byte_identical_no_reasoning(monkeypatch):
    p = _capture_payload(monkeypatch, OR_URL, "deepseek/deepseek-v4-pro", policy=None)
    assert "reasoning" not in p and "reasoning_effort" not in p


def test_openai_o_series_uses_reasoning_effort(monkeypatch):
    p = _capture_payload(monkeypatch, OAI_URL, "o3-mini", policy={"reasoning": {"effort": "low"}})
    assert p.get("reasoning_effort") == "low"
    assert "reasoning" not in p


def test_plain_openai_model_gets_no_reasoning_field(monkeypatch):
    # A non-reasoning OpenAI model must NOT receive `reasoning`/`reasoning_effort` (would 400).
    p = _capture_payload(monkeypatch, OAI_URL, "gpt-4o-mini", policy={"reasoning": {"effort": "medium"}})
    assert "reasoning" not in p and "reasoning_effort" not in p


# ── agent_loop: resolve the per-call-class policy and pass it down ────────────────

def _drive_loop_capture_policy(monkeypatch, *, game_mode, reasoning_budget=None):
    from src import agent_loop as al

    monkeypatch.delenv("ORWELL_GAME_BUILD", raising=False)

    def fake_get_setting(key, default=None):
        if key == "reasoning_budget":
            return reasoning_budget if reasoning_budget is not None else (default or {})
        return default

    monkeypatch.setattr(al, "get_setting", fake_get_setting)
    import src.tool_index as ti
    monkeypatch.setattr(ti, "get_tool_index", lambda: None)

    cap: dict = {}

    async def fake_stream(candidates, messages, **kwargs):
        cap.update(kwargs)
        yield 'data: {"delta": "hi"}\n\n'
        yield "data: [DONE]\n\n"

    monkeypatch.setattr(al, "stream_llm_with_fallback", fake_stream)

    async def drive():
        async for _ in al.stream_agent_loop(
            OR_URL, "deepseek/deepseek-v4-pro",
            [{"role": "system", "content": "narrator"}, {"role": "user", "content": "lap"}],
            max_rounds=1, game_mode=game_mode, owner="tester",
        ):
            pass

    asyncio.get_event_loop().run_until_complete(drive())
    return cap


def test_loop_resolves_and_passes_narration_policy(monkeypatch):
    cap = _drive_loop_capture_policy(monkeypatch, game_mode="game")
    assert cap.get("policy") is not None
    assert cap["policy"].get("reasoning") == {"effort": "medium"}  # ratified narration default


def test_loop_admin_override_off_omits_reasoning(monkeypatch):
    cap = _drive_loop_capture_policy(monkeypatch, game_mode="game", reasoning_budget={"narration": "off"})
    assert cap.get("policy") is not None
    assert cap["policy"].get("reasoning") is None  # admin set narration -> off


def test_loop_non_game_chat_passes_no_policy(monkeypatch):
    cap = _drive_loop_capture_policy(monkeypatch, game_mode=None)
    assert cap.get("policy") is None  # platform chat is unchanged (no reasoning override)
