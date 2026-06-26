"""Verbose overseer/corrector DEBUG telemetry (opt-in, default OFF — byte-identical when off).

Name-agnostic — roles only. Proves the new ``src.orwell_overseer_debug`` observability slice:
  * the TIER resolver (off | log | force) honors settings-first then ORWELL_OVERSEER_DEBUG, with
    word/numeric spellings; an UNSAVED dial falls through to the env; the default is OFF;
  * OFF ⇒ ``record_turn`` records NOTHING and the ring stays empty (byte-identical: no telemetry,
    no extra work — the cheap ``overseer_debug_enabled()`` gate the loop checks first);
  * Tier 1 ON ⇒ a turn where the model UNDER-calls logs an ``intervened`` verdict naming the
    guardrail + the recordInteraction it injected; a turn where the model called the tool itself
    logs ``model-called-it``;
  * the ring is bounded (Vault-free, capped) and ``get_recent`` answers the tail;
  * the live/casting verdict builders in agent_loop map the per-turn counters to the right verdict;
  * the debug-bundle surface includes the recent entries ONLY when the flag is on.
"""

import importlib
import os

import pytest


@pytest.fixture
def ovd():
    m = importlib.import_module("src.orwell_overseer_debug")
    m.clear()
    yield m
    m.clear()


def _clear_env():
    os.environ.pop("ORWELL_OVERSEER_DEBUG", None)


# ── tier resolution ───────────────────────────────────────────────────────────

def test_tier_default_is_off(ovd):
    _clear_env()
    # No env, no saved setting ⇒ off (byte-identical default).
    assert ovd.overseer_debug_tier() == ovd.TIER_OFF
    assert ovd.overseer_debug_enabled() is False
    assert ovd.overseer_debug_force() is False


def test_tier_env_word_and_numeric_spellings(ovd):
    try:
        for raw, want in [("0", ovd.TIER_OFF), ("off", ovd.TIER_OFF),
                          ("1", ovd.TIER_LOG), ("log", ovd.TIER_LOG),
                          ("2", ovd.TIER_FORCE), ("force", ovd.TIER_FORCE)]:
            os.environ["ORWELL_OVERSEER_DEBUG"] = raw
            assert ovd.overseer_debug_tier() == want, raw
        os.environ["ORWELL_OVERSEER_DEBUG"] = "1"
        assert ovd.overseer_debug_enabled() is True
        assert ovd.overseer_debug_force() is False
        os.environ["ORWELL_OVERSEER_DEBUG"] = "2"
        assert ovd.overseer_debug_force() is True
    finally:
        _clear_env()


# ── OFF ⇒ byte-identical (no telemetry, no work) ──────────────────────────────

def test_off_records_nothing(ovd):
    _clear_env()
    g = ovd.GuardrailVerdict(name="_auto_record_scene", verdict=ovd.V_INTERVENED,
                             injected_tool="recordInteraction",
                             injected_args=["withIds", "kind", "content"])
    # Explicit off tier, AND the default (no env): both must record nothing.
    assert ovd.record_turn("u", tier=ovd.TIER_OFF, guardrails=[g]) is None
    assert ovd.record_turn("u", guardrails=[g]) is None
    assert ovd.get_recent(50) == []


# ── Tier 1 ON ⇒ verdicts recorded ──────────────────────────────────────────────

def test_tier1_intervened_names_guardrail_and_injected_tool(ovd):
    g = ovd.GuardrailVerdict(
        name="_auto_record_scene", verdict=ovd.V_INTERVENED,
        description="back-filled the engaged scene's fold",
        injected_tool="recordInteraction", injected_args=["withIds", "kind", "content"])
    entry = ovd.record_turn("player-role", tier=ovd.TIER_LOG, game_mode="live",
                            phase="hoh", model_tool_calls=[], guardrails=[g])
    assert entry is not None
    assert entry["tier"] == ovd.TIER_LOG
    assert entry["intervenedCount"] == 1
    gv = entry["guardrails"][0]
    assert gv["name"] == "_auto_record_scene"
    assert gv["verdict"] == ovd.V_INTERVENED
    assert gv["injectedTool"] == "recordInteraction"
    assert gv["injectedArgs"] == ["withIds", "kind", "content"]
    # surfaced in the ring tail
    assert ovd.get_recent(10)[-1]["seq"] == entry["seq"]


def test_tier1_model_called_it_stands_down(ovd):
    g = ovd.GuardrailVerdict(name="_auto_record_scene", verdict=ovd.V_MODEL,
                             description="model recorded the scene itself")
    entry = ovd.record_turn("u", tier=ovd.TIER_LOG, model_tool_calls=["recordInteraction"],
                            guardrails=[g])
    assert entry["intervenedCount"] == 0
    assert entry["guardrails"][0]["verdict"] == ovd.V_MODEL
    assert entry["modelToolCalls"] == ["recordInteraction"]


def test_ring_is_bounded(ovd):
    for i in range(ovd._CAP + 25):
        ovd.record_turn("u", tier=ovd.TIER_LOG, model_tool_calls=[f"t{i}"])
    recent = ovd.get_recent(10_000)
    assert len(recent) == ovd._CAP  # capped, oldest dropped
    # the tail is the most recent
    assert recent[-1]["modelToolCalls"] == [f"t{ovd._CAP + 24}"]


def test_get_recent_can_filter_by_user(ovd):
    ovd.record_turn("alpha", tier=ovd.TIER_LOG, model_tool_calls=["a"])
    ovd.record_turn("beta", tier=ovd.TIER_LOG, model_tool_calls=["b"])
    only_alpha = ovd.get_recent(50, user="alpha")
    assert all(e["user"] == "alpha" for e in only_alpha)
    assert len(only_alpha) == 1


# ── the agent_loop verdict builders map counters → verdicts ────────────────────

def test_live_verdicts_intervened_vs_model_called():
    al = importlib.import_module("src.agent_loop")
    ovd = importlib.import_module("src.orwell_overseer_debug")
    # Model under-called recordInteraction (not in model_tools) but the FE back-filled it.
    gv = al._overseer_debug_live_verdicts(
        model_tools=set(), advance_nudges=0, record_nudges=1, deal_nudges=0,
        move_nudges=0, npc_move_nudges=0, premiere_marks=0)
    rec = [g for g in gv if g.name == "_auto_record_scene"][0]
    assert rec.verdict == ovd.V_INTERVENED
    assert rec.injected_tool == "recordInteraction"
    assert rec.injected_args == ["withIds", "kind", "content"]
    # Model recorded itself ⇒ the belt stood down (counter is set to 1 by the loop, but the tool IS
    # in model_tools, so the verdict is model-called-it, NOT a phantom intervention).
    gv2 = al._overseer_debug_live_verdicts(
        model_tools={"recordInteraction"}, advance_nudges=0, record_nudges=1, deal_nudges=0,
        move_nudges=0, npc_move_nudges=0, premiere_marks=0)
    rec2 = [g for g in gv2 if g.name == "_auto_record_scene"][0]
    assert rec2.verdict == ovd.V_MODEL


def test_live_verdicts_forced_advance_and_premiere():
    al = importlib.import_module("src.agent_loop")
    ovd = importlib.import_module("src.orwell_overseer_debug")
    gv = al._overseer_debug_live_verdicts(
        model_tools=set(), advance_nudges=3, record_nudges=0, deal_nudges=0,
        move_nudges=0, npc_move_nudges=0, premiere_marks=2)
    stall = [g for g in gv if g.name == "progression-stall-nudge"][0]
    assert stall.verdict == ovd.V_INTERVENED
    assert stall.injected_tool == "advanceGame"
    met = [g for g in gv if g.name == "markHouseguestMet-premiere-belt"][0]
    assert met.verdict == ovd.V_INTERVENED
    assert met.injected_tool == "markHouseguestMet"


def test_casting_verdicts():
    al = importlib.import_module("src.agent_loop")
    ovd = importlib.import_module("src.orwell_overseer_debug")
    gv = al._overseer_debug_casting_verdicts(
        model_tools=set(), record_belt=1, force=1, nudge=2)
    by = {g.name: g for g in gv}
    assert by["_auto_record_casting"].verdict == ovd.V_INTERVENED
    assert by["_auto_record_casting"].injected_tool == "updateCasting"
    assert by["createCharacter-finalize-fallback"].verdict == ovd.V_INTERVENED
    assert by["createCharacter-finalize-fallback"].injected_tool == "createCharacter"
    assert by["casting-substance-steer"].verdict == ovd.V_INTERVENED
    # model called updateCasting itself ⇒ stand down
    gv2 = al._overseer_debug_casting_verdicts(
        model_tools={"updateCasting", "createCharacter"}, record_belt=1, force=0, nudge=0)
    by2 = {g.name: g for g in gv2}
    assert by2["_auto_record_casting"].verdict == ovd.V_MODEL
    assert by2["createCharacter-finalize-fallback"].verdict == ovd.V_MODEL


# ── Vault-free: a body cannot be stored (structural, not careful-caller) ───────

def test_recorded_fields_are_clipped_names_only(ovd):
    body = "SECRET off-screen scheme: " + ("x" * 5000)
    g = ovd.GuardrailVerdict(name=body, verdict=ovd.V_INTERVENED, description=body,
                             injected_tool=body, injected_args=[body, body])
    entry = ovd.record_turn(body, tier=ovd.TIER_LOG, session=body, model_tool_calls=[body],
                            guardrails=[g])
    # Every string field is clipped to a short token cap — no 5000-char body survives anywhere.
    assert len(entry["user"]) <= ovd._MAX_NAME_LEN
    assert len(entry["session"]) <= ovd._MAX_NAME_LEN
    assert all(len(t) <= ovd._MAX_NAME_LEN for t in entry["modelToolCalls"])
    gv = entry["guardrails"][0]
    assert len(gv["name"]) <= ovd._MAX_NAME_LEN
    assert len(gv["description"]) <= ovd._DESC_CAP + 16  # clip marker slack
    assert all(len(a) <= ovd._MAX_NAME_LEN for a in gv["injectedArgs"])


# ── Tier 2 (force) READ-ONLY would-have-intervened verdict ─────────────────────

def test_tier2_force_eval_is_read_only_would_have(monkeypatch):
    import asyncio
    al = importlib.import_module("src.agent_loop")
    ovd = importlib.import_module("src.orwell_overseer_debug")

    # Stub a read-only roster (an active houseguest); the narration names them ⇒ engaged scene.
    async def _fake_gs(owner):
        return {"house": [{"id": "hg1", "name": "Rowan", "status": "active"}]}

    eng = importlib.import_module("src.orwell_engine")
    monkeypatch.setattr(eng, "get_game_state", _fake_gs)

    out = asyncio.get_event_loop().run_until_complete(
        al._overseer_debug_live_force_evals(
            narration="Rowan leans in and whispers a plan.",
            messages=[{"role": "user", "content": "I talk to Rowan"}],
            model_recorded=True,           # the model recorded ⇒ Tier 1 belt skipped
            already_intervened=False,
            owner="u"))
    fe = [g for g in out if g.name == "_auto_record_scene"][0]
    assert fe.forced is True                 # marked as a would-have, not a real fire
    assert fe.verdict == ovd.V_INTERVENED    # the scene touched a houseguest ⇒ would have acted
    assert fe.injected_tool == "recordInteraction"


def test_tier2_force_eval_skips_when_already_intervened():
    import asyncio
    al = importlib.import_module("src.agent_loop")
    out = asyncio.get_event_loop().run_until_complete(
        al._overseer_debug_live_force_evals(
            narration="x", messages=[], model_recorded=False,
            already_intervened=True, owner="u"))
    assert out == []  # Tier 1 already logged the real verdict — no double-count


# ── debug-bundle surface: only when enabled ───────────────────────────────────

def test_debug_bundle_includes_overseer_debug_only_when_enabled(ovd):
    import asyncio
    ahr = importlib.import_module("routes.admin_health_routes")
    _clear_env()
    # OFF: the section is omitted entirely (byte-unchanged bundle).
    extras_off = asyncio.get_event_loop().run_until_complete(ahr._bundle_extras(None))
    assert "overseerDebug" not in extras_off
    # ON (Tier 1): the recent ring entries surface under the new key.
    os.environ["ORWELL_OVERSEER_DEBUG"] = "1"
    try:
        ovd.record_turn("u", model_tool_calls=["advanceGame"],
                        guardrails=[ovd.GuardrailVerdict(
                            name="progression-stall-nudge", verdict=ovd.V_MODEL)])
        extras_on = asyncio.get_event_loop().run_until_complete(ahr._bundle_extras(None))
        assert "overseerDebug" in extras_on
        sec = extras_on["overseerDebug"]
        assert sec.get("tier") == ovd.TIER_LOG
        assert isinstance(sec.get("recent"), list) and sec["recent"]
        assert sec["recent"][-1]["modelToolCalls"] == ["advanceGame"]
    finally:
        _clear_env()
