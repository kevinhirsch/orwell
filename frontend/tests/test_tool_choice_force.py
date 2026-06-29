"""#1154 / ADR 0016 §D — FORCE the engine call (`tool_choice`) at the closed-set beats where a missed
call is catastrophic. Now possible because the OOB narrator is GLM-4.7 (PR #1151), which HONORS
`tool_choice` (DeepSeek-V4 rejected `required` in always-thinking mode — `tool_choice` was therefore
DELIBERATELY never sent before this feature, per the 2026-06-21 conformance audit).

Two layers, both driven for real (the suite STUBS the LLM, so the live "does GLM actually honor the
forced call" check is OWED separately — these pin the WIRE + the gate):

  • llm_core: `tool_choice` reaches the OpenAI-style payload when passed, ALONGSIDE `tools`; and is
    ABSENT BY DEFAULT ⇒ byte-identical to before (the safety contract). Interop with the reasoning
    budget: forcing rides its own payload key and never perturbs `reasoning` (reasoning stays on its own
    channel — never the public bubble).
  • agent_loop: the pure `_forced_tool_choice_for_beat` gate fires at the right ENGINE-OWNED beats
    (comp → "required"; ceremony advance → named advanceGame; previewed-uncommitted → named advanceGame)
    and NOT on ordinary turns, never forces submitDecision, and is suppressed by an open player pending;
    plus the model-rejecter gate (DeepSeek-V4 never gets forced) and the kill-switch default.

Roles only (no names as data).
"""
import asyncio
import json

OR_URL = "https://openrouter.ai/api/v1/chat/completions"
OAI_URL = "https://api.openai.com/v1/chat/completions"

# A minimal OpenAI-style tool schema (the wire only cares that `tools` is non-empty so tool_choice is
# legal); never names a houseguest.
_TOOLS = [{
    "type": "function",
    "function": {"name": "advanceGame", "description": "advance the beat",
                 "parameters": {"type": "object", "properties": {}}},
}]


# ── llm_core capture harness (mirrors test_adr0010_reasoning_budget / test_1002) ────────────────────

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


def _capture_payload(monkeypatch, url, model, **stream_kwargs):
    """Drive stream_llm against a stubbed transport and return the JSON payload that hit the wire."""
    from src import llm_core as lc
    captured: dict = {}
    monkeypatch.setattr(lc, "_get_http_client", lambda: _FakeClient(captured))
    monkeypatch.setattr(lc, "_is_host_dead", lambda u: False)
    monkeypatch.setattr(lc, "note_model_activity", lambda *a, **k: None)
    monkeypatch.setattr(lc, "_clear_host_dead", lambda *a, **k: None)

    async def drive():
        async for _ in lc.stream_llm(url, model, [{"role": "user", "content": "x"}], **stream_kwargs):
            pass

    asyncio.get_event_loop().run_until_complete(drive())
    return captured.get("payload") or {}


# ── (a) tool_choice is plumbed through to the OpenAI-style payload ──────────────────────────────────

def test_tool_choice_required_reaches_the_payload(monkeypatch):
    p = _capture_payload(monkeypatch, OR_URL, "z-ai/glm-4.7", tools=_TOOLS, tool_choice="required")
    assert p.get("tool_choice") == "required", p
    assert p.get("tools") == _TOOLS  # sent ALONGSIDE tools


def test_named_function_tool_choice_reaches_the_payload(monkeypatch):
    choice = {"type": "function", "function": {"name": "advanceGame"}}
    p = _capture_payload(monkeypatch, OR_URL, "z-ai/glm-4.7", tools=_TOOLS, tool_choice=choice)
    assert p.get("tool_choice") == choice, p


def test_tool_choice_is_not_sent_without_tools(monkeypatch):
    # A tool_choice with NO tools 400s on most providers — it is nested under `if tools`, so a
    # tool_choice passed with no tools must be dropped, not sent.
    p = _capture_payload(monkeypatch, OR_URL, "z-ai/glm-4.7", tools=None, tool_choice="required")
    assert "tool_choice" not in p, p
    assert "tools" not in p


# ── (b) absent by default ⇒ byte-identical request (THE safety contract) ────────────────────────────

def test_default_unset_is_byte_identical():
    """Proves the default (tool_choice unset) produces a payload byte-identical to one built with the
    arg OMITTED entirely — i.e. the new param adds NOTHING to the wire unless explicitly forced. This
    is the #1154 safety contract: absent ⇒ byte-identical to before this feature."""
    import pytest

    # Two captures: tools present + tool_choice EXPLICITLY None, vs the arg never passed at all. They
    # must serialize identically (and neither may contain a tool_choice key). Separate monkeypatch
    # contexts so the two stubbed transports don't collide.
    with pytest.MonkeyPatch().context() as mp1:
        p_default = _capture_payload(mp1, OR_URL, "z-ai/glm-4.7", tools=_TOOLS, tool_choice=None)
    with pytest.MonkeyPatch().context() as mp2:
        p_omitted = _capture_payload(mp2, OR_URL, "z-ai/glm-4.7", tools=_TOOLS)

    assert "tool_choice" not in p_default, p_default
    assert "tool_choice" not in p_omitted, p_omitted
    # Byte-identical: same keys, same serialized bytes.
    assert json.dumps(p_default, sort_keys=True) == json.dumps(p_omitted, sort_keys=True)


def test_default_unset_no_tools_is_byte_identical():
    # The no-tools turn (ordinary narration with tools filtered to empty) — the most common live shape —
    # must also be byte-identical with the arg defaulted vs omitted.
    import pytest
    with pytest.MonkeyPatch().context() as mp1:
        p_default = _capture_payload(mp1, OR_URL, "z-ai/glm-4.7", tools=None, tool_choice=None)
    with pytest.MonkeyPatch().context() as mp2:
        p_omitted = _capture_payload(mp2, OR_URL, "z-ai/glm-4.7", tools=None)
    assert "tool_choice" not in p_default and "tool_choice" not in p_omitted
    assert json.dumps(p_default, sort_keys=True) == json.dumps(p_omitted, sort_keys=True)


# ── (d) interop with reasoning `low` — reasoning stays on its OWN channel ────────────────────────────

def test_tool_choice_interop_with_reasoning_low(monkeypatch):
    """Forcing rides the `tool_choice` key; the reasoning budget rides `reasoning`. The two are
    independent — a forced call must NOT perturb the reasoning field (and vice-versa). Reasoning stays
    on its own payload channel, never bleeding into the tool directive (or, downstream, the public
    bubble — that split is enforced in chat.js, untouched here)."""
    p = _capture_payload(
        monkeypatch, OR_URL, "z-ai/glm-4.7",
        tools=_TOOLS, tool_choice="required",
        policy={"reasoning": {"effort": "low"}, "max_tokens": 4096},
    )
    # Both present, each on its own key.
    assert p.get("tool_choice") == "required", p
    assert p.get("reasoning") == {"effort": "low"}, p
    # The directives don't bleed into each other.
    assert "reasoning" not in str(p.get("tool_choice"))
    assert "tool_choice" not in json.dumps(p.get("reasoning"))


def test_reasoning_low_without_forcing_has_no_tool_choice(monkeypatch):
    # The mirror: a reasoning-low turn that does NOT force must carry reasoning but NO tool_choice.
    p = _capture_payload(
        monkeypatch, OR_URL, "z-ai/glm-4.7",
        tools=_TOOLS, policy={"reasoning": {"effort": "low"}, "max_tokens": 4096})
    assert p.get("reasoning") == {"effort": "low"}
    assert "tool_choice" not in p


# ── (c) the gate fires at the right beats and NOT on ordinary turns ──────────────────────────────────

def _gate(framed_key, fired, *, pending=False):
    from src.agent_loop import _forced_tool_choice_for_beat
    return _forced_tool_choice_for_beat(framed_key, set(fired), pending_open=pending)


_ADV = {"type": "function", "function": {"name": "advanceGame"}}


def test_comp_phase_forces_required_when_nothing_fired():
    # hoh-competition with no comp tool yet → force SOME engine call (model picks runComp OR advanceGame).
    assert _gate(("w1", "hoh-competition", "hoh-competition"), []) == "required"
    assert _gate(("w2", "veto-competition", "veto-competition"), []) == "required"


def test_comp_phase_previewed_uncommitted_forces_named_advance():
    # runCompetition previewed a winner but never committed → force advanceGame to COMMIT (the #1 desync).
    assert _gate(("w1", "hoh-competition", "x"), ["runCompetition"]) == _ADV


def test_comp_phase_already_advanced_does_not_force():
    # The engine call already happened this turn → the guarantee is met → no forcing.
    assert _gate(("w1", "hoh-competition", "x"), ["advanceGame"]) is None
    assert _gate(("w1", "hoh-competition", "x"), ["runCompetition", "advanceGame"]) is None


def test_ceremony_advance_phase_forces_named_advance():
    for phase in ("nominations", "veto-ceremony", "eviction"):
        assert _gate(("w1", phase, phase), []) == _ADV, phase


def test_ceremony_advance_phase_not_forced_once_advanced():
    assert _gate(("w1", "eviction", "x"), ["advanceGame"]) is None


def test_ordinary_social_phase_never_forces():
    # The common case — a lull / social turn / a non-force phase — must NEVER force.
    assert _gate(("w1", "social", "social"), []) is None
    assert _gate(("w1", "social", "lingering"), ["recordInteraction"]) is None
    # premiere / finale / twist-reveal are deliberately EXCLUDED (their own belts handle them).
    assert _gate(("w1", "premiere", "premiere"), []) is None
    assert _gate(("w1", "finale", "finale"), []) is None
    assert _gate(("w1", "twist-reveal", "twist-reveal"), []) is None


def test_open_player_pending_suppresses_all_forcing():
    # An open player pending ⇒ the engine waits on the PLAYER (a card). The model must surface it, not
    # advance/run a comp past it — and we NEVER force submitDecision (that infers a binding choice).
    assert _gate(("w1", "eviction", "x", "goodbye-message"), [], pending=True) is None
    assert _gate(("w1", "hoh-competition", "x", "comp-intent"), [], pending=True) is None
    assert _gate(("w1", "nominations", "x", "nominations"), [], pending=True) is None


def test_never_forces_submit_decision():
    # Defensive: no input shape may ever yield a submitDecision force (the mandate: engine never speaks
    # for the player). Sweep every force phase + a representative pending.
    from src.agent_loop import _FORCE_COMP_PHASES, _FORCE_ADVANCE_PHASES
    for phase in (_FORCE_COMP_PHASES | _FORCE_ADVANCE_PHASES):
        for fired in ([], ["runCompetition"], ["advanceGame"]):
            for pend in (True, False):
                got = _gate(("w1", phase, phase), fired, pending=pend)
                if isinstance(got, dict):
                    assert got["function"]["name"] != "submitDecision", (phase, fired, pend)


def test_malformed_framed_key_is_safe():
    # Fail-open on a None / too-short / non-tuple framed key — never raise, never force.
    assert _gate(None, []) is None
    assert _gate(("just-week",), []) is None
    assert _gate("not-a-tuple", []) is None


# ── the model-rejecter gate: DeepSeek-V4 (always-thinking) NEVER gets forced; GLM does ──────────────

def test_glm_honors_forcing_deepseek_v4_does_not():
    from src.agent_loop import _model_honors_forced_tool_choice
    assert _model_honors_forced_tool_choice("z-ai/glm-4.7") is True
    assert _model_honors_forced_tool_choice("openai/gpt-4o") is True
    # The documented rejecters (always-thinking DeepSeek) must be excluded.
    assert _model_honors_forced_tool_choice("deepseek/deepseek-v4-pro") is False
    assert _model_honors_forced_tool_choice("deepseek/deepseek-v4-flash") is False
    assert _model_honors_forced_tool_choice("deepseek/deepseek-r1") is False


# ── the runtime kill-switch default ─────────────────────────────────────────────────────────────────

def test_kill_switch_defaults_on():
    from src.settings import DEFAULT_SETTINGS
    assert DEFAULT_SETTINGS.get("force_tool_choice_at_beats") is True


# ── END-TO-END: the agent loop computes the force and passes tool_choice to the wire ────────────────
# Captures the kwargs the loop hands stream_llm_with_fallback (mirrors test_adr0010's policy capture),
# so we prove the WIRING — reading _LAST_FRAMED_BEAT_KEY, the kill-switch + model gates, and passing
# tool_choice through — not just the pure gate above.

def _drive_loop_capture_tool_choice(monkeypatch, *, model, framed_key, pending=None,
                                    force_setting=True, game_mode="game"):
    from src import agent_loop as al
    from routes import chat_helpers as ch
    from src import orwell_engine as oe

    monkeypatch.delenv("ORWELL_GAME_BUILD", raising=False)

    _real_get_setting = al.get_setting

    def fake_get_setting(key, default=None):
        if key == "force_tool_choice_at_beats":
            return force_setting
        # keep real reasoning/policy resolution intact for the interop legs
        return _real_get_setting(key, default)

    monkeypatch.setattr(al, "get_setting", fake_get_setting)
    import src.tool_index as ti
    monkeypatch.setattr(ti, "get_tool_index", lambda: None)

    # The framed beat the model is grounded on this turn (what apply_game_framing would have stashed).
    if framed_key is None:
        ch._LAST_FRAMED_BEAT_KEY.pop("tester", None)
    else:
        ch._LAST_FRAMED_BEAT_KEY["tester"] = framed_key

    # The engine's open-pending check the force consults (None ⇒ no pending ⇒ forcing allowed).
    async def fake_status(user=None):
        return {"pending": pending} if pending is not None else {"pending": None}
    monkeypatch.setattr(oe, "game_status", fake_status)

    cap: dict = {}

    async def fake_stream(candidates, messages, **kwargs):
        # Capture the FIRST round's kwargs only (the force is computed per round).
        if "tool_choice" not in cap:
            cap.update(kwargs)
        yield 'data: {"delta": "hi"}\n\n'
        yield "data: [DONE]\n\n"

    monkeypatch.setattr(al, "stream_llm_with_fallback", fake_stream)

    async def drive():
        async for _ in al.stream_agent_loop(
            OR_URL, model,
            [{"role": "system", "content": "narrator"}, {"role": "user", "content": "what happens"}],
            max_rounds=1, game_mode=game_mode, owner="tester",
        ):
            pass

    try:
        asyncio.get_event_loop().run_until_complete(drive())
    finally:
        ch._LAST_FRAMED_BEAT_KEY.pop("tester", None)
    return cap


def test_loop_forces_required_at_a_comp_beat(monkeypatch):
    cap = _drive_loop_capture_tool_choice(
        monkeypatch, model="z-ai/glm-4.7", framed_key=("w1", "hoh-competition", "hoh-competition"))
    assert cap.get("tools"), "tools must be on the wire for forcing to be legal"
    assert cap.get("tool_choice") == "required", cap.get("tool_choice")


def test_loop_forces_named_advance_at_a_ceremony_beat(monkeypatch):
    cap = _drive_loop_capture_tool_choice(
        monkeypatch, model="z-ai/glm-4.7", framed_key=("w1", "eviction", "eviction"))
    assert cap.get("tool_choice") == {"type": "function", "function": {"name": "advanceGame"}}, cap.get("tool_choice")


def test_loop_does_not_force_on_an_ordinary_social_turn(monkeypatch):
    # The default live turn (a social/lingering moment) must pass tool_choice=None ⇒ byte-identical wire.
    cap = _drive_loop_capture_tool_choice(
        monkeypatch, model="z-ai/glm-4.7", framed_key=("w1", "social", "lingering"))
    assert cap.get("tool_choice") is None, cap.get("tool_choice")


def test_loop_does_not_force_when_pending_is_open(monkeypatch):
    # A force-candidate phase but an OPEN player pending ⇒ no forcing (the player owns the card).
    cap = _drive_loop_capture_tool_choice(
        monkeypatch, model="z-ai/glm-4.7", framed_key=("w1", "eviction", "eviction", "goodbye-message"),
        pending={"kind": "goodbye-message"})
    assert cap.get("tool_choice") is None, cap.get("tool_choice")


def test_loop_does_not_force_for_a_rejecter_model(monkeypatch):
    # DeepSeek-V4 400s on tool_choice — even at a force-candidate beat, the loop must NOT send it.
    cap = _drive_loop_capture_tool_choice(
        monkeypatch, model="deepseek/deepseek-v4-pro", framed_key=("w1", "eviction", "eviction"))
    assert cap.get("tool_choice") is None, cap.get("tool_choice")


def test_loop_kill_switch_off_disables_forcing(monkeypatch):
    # The runtime kill-switch OFF ⇒ no forcing even at a force-candidate beat (no redeploy needed).
    cap = _drive_loop_capture_tool_choice(
        monkeypatch, model="z-ai/glm-4.7", framed_key=("w1", "hoh-competition", "hoh-competition"),
        force_setting=False)
    assert cap.get("tool_choice") is None, cap.get("tool_choice")


def test_loop_non_game_chat_never_forces(monkeypatch):
    # Platform (non-game) chat is unchanged — _is_live_game False ⇒ no forcing path at all.
    cap = _drive_loop_capture_tool_choice(
        monkeypatch, model="z-ai/glm-4.7", framed_key=("w1", "hoh-competition", "hoh-competition"),
        game_mode=None)
    assert cap.get("tool_choice") is None, cap.get("tool_choice")
