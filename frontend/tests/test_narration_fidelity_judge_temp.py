"""Regressions for two mandate-#1 (behavioral-fidelity) narration bugs found in a live prod bundle.

BUG 1 — the Feature-0081 narration-FAITHFULNESS judge failed 100% (13/13) with OpenRouter
HTTP 400 "Input required: specify prompt or messages". Root cause: the resolved completion fn
(`orwell_cast_authoring._resolve_llm_fn._fn`) expects a chat `list[dict]`, but the judge (and the
0079/0080 overseer) call it with a single prompt STRING (`_llm(judge.build_prompt(...))`). A raw
string flowed straight to `stream_llm_with_fallback` → `_sanitize_llm_messages`, which iterated it
CHAR-BY-CHAR (no char is a dict) and produced an EMPTY messages array → the provider 400. The fix
normalizes a bare string into a single `{"role":"user","content":...}` message, so the judge (and
overseer) actually reach the wire. These tests pin: a string input yields a NON-EMPTY, well-formed
messages payload; a `list[dict]` input is unchanged.

BUG 2 — the game-master narration ran at the app-wide DEFAULT_TEMPERATURE (1.0), reading as
canonically incoherent. The fix adds the owner-tunable `narration_temperature` (default 0.7),
applied ONLY on the game/casting narration path. These tests pin the resolver (default/override/
clamp) and that the agent loop reassigns the narration temperature under game_mode.

Roles only — every string is a generic probe, never cast material.
"""
import importlib
import inspect

import pytest

ca = importlib.import_module("src.orwell_cast_authoring")


# ── BUG 1: the resolved judge/overseer fn must reach the wire with a real messages array ──

def _wire_capture(monkeypatch):
    """Stub the faithfulness endpoint resolver + capture the messages the stream call receives."""
    import src.endpoint_resolver as er
    import src.llm_core as lc

    def fake_resolve(prefix, owner=None, **k):
        # faithfulness resolves faithfulness -> (empty) -> default; give default a real chat model.
        if prefix in ("faithfulness", "default"):
            return ("https://x/judge", "judge-model", {})
        return (None, None, None)
    monkeypatch.setattr(er, "resolve_endpoint", fake_resolve)
    monkeypatch.setattr(er, "resolve_utility_fallback_candidates", lambda owner=None: [])
    monkeypatch.setattr(er, "_resolve_fallback_candidates", lambda key, owner=None: [])

    captured = {}

    async def fake_stream(candidates, messages, **kwargs):
        captured["messages"] = messages
        captured["kwargs"] = kwargs
        yield {"delta": '{"dimension":"none","classification":"none","lever":"none","rationale":""}'}
    monkeypatch.setattr(lc, "stream_llm_with_fallback", fake_stream)
    return captured


def test_string_prompt_reaches_the_wire_as_a_nonempty_messages_array(monkeypatch, run):
    """The judge calls `_llm(<prompt string>)`. The resolved fn must turn that into a non-empty
    list[dict] messages payload — never the empty-messages array that 400'd 13/13 in prod."""
    captured = _wire_capture(monkeypatch)

    fn = run(ca._resolve_llm_fn("u", prefix="faithfulness", fallbacks_key="faithfulness"))
    assert fn is not None

    prompt = "You are the NARRATION-FAITHFULNESS judge. NARRATION:\nfoo\nPROJECTION:\n{}"
    run(fn(prompt))

    msgs = captured.get("messages")
    assert isinstance(msgs, list) and len(msgs) >= 1, \
        "a string prompt must become a NON-EMPTY messages list (the empty-array 400 regression)"
    assert all(isinstance(m, dict) for m in msgs), "every message must be a dict, not a bare char"
    assert msgs[-1].get("role") == "user"
    assert prompt in (msgs[-1].get("content") or ""), "the prompt text must survive to the wire"
    # The classic bug: passing the string straight through so it is iterated char-by-char.
    assert msgs != list(prompt)


def test_list_of_messages_is_passed_through_unchanged(monkeypatch, run):
    """The cast-authoring caller passes a proper list[dict]; normalization must be a no-op for it."""
    captured = _wire_capture(monkeypatch)

    fn = run(ca._resolve_llm_fn("u", prefix="faithfulness", fallbacks_key="faithfulness"))
    msgs_in = [{"role": "system", "content": "sys"}, {"role": "user", "content": "hi"}]
    run(fn(msgs_in))
    assert captured.get("messages") == msgs_in


def test_faithfulness_judge_assess_reaches_a_verdict_over_the_resolved_fn(monkeypatch, run):
    """End-to-end at the seam that broke: FaithfulnessJudge(_llm).assess(...) — where `_llm` is the
    resolved fn — must produce a real verdict, not silently fail to the deterministic floor because
    the underlying call 400'd. (The judge builds a string prompt; the fn must accept it.)"""
    from src.faithfulness import FaithfulnessJudge

    async def fake_stream(candidates, messages, **kwargs):
        # Only reachable if `messages` is a valid non-empty list[dict] (else the real provider 400s).
        assert isinstance(messages, list) and messages and isinstance(messages[0], dict)
        yield {"delta": '{"dimension":"board","classification":"closed","lever":"reground",'
                        '"rationale":"contradicts the HOH on the board"}'}

    import src.endpoint_resolver as er
    import src.llm_core as lc
    monkeypatch.setattr(er, "resolve_endpoint",
                        lambda prefix, owner=None, **k: ("https://x/judge", "judge-model", {}))
    monkeypatch.setattr(er, "resolve_utility_fallback_candidates", lambda owner=None: [])
    monkeypatch.setattr(er, "_resolve_fallback_candidates", lambda key, owner=None: [])
    monkeypatch.setattr(lc, "stream_llm_with_fallback", fake_stream)

    _llm = run(ca._resolve_llm_fn("u", prefix="faithfulness", fallbacks_key="faithfulness"))
    assert _llm is not None
    judge = FaithfulnessJudge(_llm)
    # judge.assess builds a string prompt and calls _llm(prompt); the fn returns a coroutine.
    raw = run(_llm(judge.build_prompt("the narration", {"board": {}}, "in-game")))
    verdict = judge.verdict_from_reply(raw, "the narration", {"board": {}})
    assert verdict is not None and verdict.is_slip, \
        "a well-formed judge reply must yield a real verdict — the 400 path never got here"
    assert verdict.dimension == "board" and verdict.lever == "reground"


# ── BUG 2: the game-master narration temperature knob ──────────────────────────────────

def _pin(monkeypatch, key, value):
    import src.settings as settings_mod
    real = settings_mod.get_setting

    def fake(k, default=None):
        return value if k == key else real(k, default)
    monkeypatch.setattr(settings_mod, "get_setting", fake)


def test_narration_temperature_default_is_grounded_not_one():
    import src.settings as settings_mod
    # A truly-unset knob resolves to the grounded default (NOT the 1.0 that read as incoherent).
    settings_mod._invalidate_caches()
    v = settings_mod.narration_temperature()
    assert v == pytest.approx(0.7)
    assert v != pytest.approx(1.0)


def test_narration_temperature_default_present_in_settings():
    import src.settings as settings_mod
    assert settings_mod.DEFAULT_SETTINGS.get("narration_temperature") == pytest.approx(0.7), \
        "the knob must be in DEFAULT_SETTINGS so the admin settings allowlist can persist it"


def test_narration_temperature_is_runtime_editable(monkeypatch):
    import src.settings as settings_mod
    _pin(monkeypatch, "narration_temperature", 0.6)
    assert settings_mod.narration_temperature() == pytest.approx(0.6)


def test_narration_temperature_is_clamped_and_garbage_safe(monkeypatch):
    import src.settings as settings_mod
    _pin(monkeypatch, "narration_temperature", 40)      # fat-finger
    assert settings_mod.narration_temperature() == pytest.approx(2.0)
    _pin(monkeypatch, "narration_temperature", -3)
    assert settings_mod.narration_temperature() == pytest.approx(0.0)
    _pin(monkeypatch, "narration_temperature", "nonsense")
    assert settings_mod.narration_temperature() == pytest.approx(0.7)  # default on garbage


def test_narration_temperature_untouched_lanes_stay_hot_and_cold():
    """Scoping guard: the narration knob must not disturb the cast-authoring (1.1) temperature."""
    import src.settings as settings_mod
    settings_mod._invalidate_caches()
    # cast authoring keeps its own hot default, independent of the narration knob.
    assert ca.cast_authoring_temperature() == pytest.approx(1.1)


def test_faith_check_call_failure_is_loud_not_silent(monkeypatch, run):
    """Ruling #1599: the judge failing is 'the guard is down' — it must record a RED-eligible health
    event (record_overseer ok=False), never fail 13/13 silently as it did in prod."""
    import src.agent_loop as al
    import src.faithfulness as fa
    import src.orwell_cast_authoring as caa
    import src.log_rings as lr

    monkeypatch.setattr(fa, "faithfulness_mode", lambda: "active")

    def _boom_llm(_prompt):
        raise RuntimeError("HTTP 400: Input required: specify prompt or messages")

    async def _fake_resolve(owner, **k):
        return _boom_llm
    monkeypatch.setattr(caa, "_resolve_llm_fn", _fake_resolve)

    events = []
    monkeypatch.setattr(lr, "record_overseer",
                        lambda level, kind, diagnosis, **kw: events.append((level, kind, kw)))

    # projection passed so no engine round-trip is needed; claim_bearing wakes the judge.
    run(al._faith_check("some narration", claim_bearing=True, engaged_scene=False,
                        owner="u", beat_before=3, projection={"board": {}}))

    red = [e for e in events if e[1] == "faith:call-failed" and e[2].get("ok") is False]
    assert red, "a failed judge call must record a RED-eligible faith:call-failed health event"


def test_agent_loop_applies_narration_temperature_under_game_mode():
    """Source pin: the game/casting narration path REASSIGNS the sampling temperature to
    `narration_temperature()` — so the player-facing narration can never ride the 1.0 default."""
    src = inspect.getsource(importlib.import_module("src.agent_loop")._stream_agent_loop_impl)
    assert "narration_temperature" in src, \
        "the game_mode path must override temperature with the narration_temperature knob"
    # the reassignment binds the loop's `temperature` used by the stream call.
    assert "temperature = _narr_temp()" in src
