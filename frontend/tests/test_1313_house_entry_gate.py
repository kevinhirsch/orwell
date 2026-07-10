"""#1313 (P0) — the house-entry authoring gate: the game must NEVER start on the deterministic
FLOOR cast (0/15 authored).

`do_create_character` must HOLD house entry until the cast is authored to a threshold (>= 13/15),
but ONLY when authoring can actually run — a real utility model resolves — and the operator has not
set the `ORWELL_ALLOW_FLOOR_START=1` escape hatch. With no model (the whole LLM-stubbed test suite)
the gate is OFF and start is instant, byte-identical to before.

Roles only — every string is a generic probe, never cast material.
"""
import asyncio
import importlib
import json

import pytest

ti = importlib.import_module("src.tool_implementations")
oe = importlib.import_module("src.orwell_engine")
ca = importlib.import_module("src.orwell_cast_authoring")
cid = importlib.import_module("src.orwell_cast_identity")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _started_res():
    """A started-season engine result with a full 15-NPC house + portrait prompts."""
    house = [{"id": "player", "name": "The Player"}]
    prompts = [{"houseguestId": "player", "name": "The Player", "prompt": "headshot"}]
    for i in range(1, 16):
        house.append({"id": f"npc:{i}", "name": f"Houseguest {i}"})
        prompts.append({"houseguestId": f"npc:{i}", "name": f"Houseguest {i}", "prompt": "headshot"})
    return {"started": True, "house": house, "portraitPrompts": prompts}


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    """Stub the engine create + the identity/portrait kickoffs so the test drives only the gate."""
    async def fake_create(*a, **k):
        return _started_res()
    monkeypatch.setattr(oe, "create_character", fake_create)

    # Neutralise the early restart-probe engine read (no live engine in-process).
    async def fake_state(*a, **k):
        return {"started": False}
    monkeypatch.setattr(oe, "get_game_state", fake_state)

    # The identity seed chains authoring in the fallback branch — stub it to a no-op so no background
    # authoring tasks are scheduled (the gate itself is what we exercise, via await_house_ready stubs).
    monkeypatch.setattr(cid, "kickoff_identity", lambda *a, **k: None)
    yield


def _make_ready(*, ready, authored, total=15):
    async def _fn(owner, **k):
        return {"ready": ready, "authored": authored, "total": total,
                "missing": max(0, total - authored)}
    return _fn


async def _async_true(owner):
    return True


# ── (a) the runtime gate ─────────────────────────────────────────────────────────────

def test_gate_holds_start_when_cast_underauthored(monkeypatch):
    """Gate ON + authoring below the threshold ⇒ NOT started + a visible casting-in-progress state."""
    monkeypatch.delenv("ORWELL_ALLOW_FLOOR_START", raising=False)
    monkeypatch.setattr(ca, "house_entry_gate_active", _async_true)
    monkeypatch.setattr(ca, "await_house_ready", _make_ready(ready=False, authored=3))

    res = _run(ti.do_create_character('{"playerName":"P"}', owner="bob"))
    assert res["exit_code"] == 0
    out = json.loads(res["output"])
    assert out.get("started") is False, "the game must NOT start on an under-authored floor cast"
    ch = out.get("castingHouse") or {}
    assert ch.get("state") == "authoring"
    assert ch.get("authored") == 3 and ch.get("total") == 15
    assert isinstance(out.get("message"), str) and out["message"], "a player-visible pending message"
    # a LOUD health marker was recorded (never a silent floor start)
    marker = ca.house_entry_gate_status("bob")
    assert marker is not None and marker.get("authored") == 3


def test_gate_allows_start_when_cast_authored(monkeypatch):
    """Gate ON + authoring at/above the threshold ⇒ the game STARTS (normal started result)."""
    monkeypatch.delenv("ORWELL_ALLOW_FLOOR_START", raising=False)
    ca.clear_house_entry_gate_block("carol")
    monkeypatch.setattr(ca, "house_entry_gate_active", _async_true)
    monkeypatch.setattr(ca, "await_house_ready", _make_ready(ready=True, authored=14))

    res = _run(ti.do_create_character('{"playerName":"P"}', owner="carol"))
    assert res["exit_code"] == 0
    out = json.loads(res["output"])
    assert out.get("started") is True, "an authored cast lets the game start"
    assert ca.house_entry_gate_status("carol") is None, "a clean start leaves no block marker"


def test_escape_hatch_forces_immediate_start(monkeypatch):
    """ORWELL_ALLOW_FLOOR_START=1 ⇒ gate OFF: the game starts immediately, authoring never awaited."""
    monkeypatch.setenv("ORWELL_ALLOW_FLOOR_START", "1")
    called = {"n": 0}

    async def _must_not_wait(owner, **k):
        called["n"] += 1
        return {"ready": False, "authored": 0, "total": 15, "missing": 15}
    monkeypatch.setattr(ca, "await_house_ready", _must_not_wait)

    res = _run(ti.do_create_character('{"playerName":"P"}', owner="dave"))
    assert res["exit_code"] == 0
    out = json.loads(res["output"])
    assert out.get("started") is True, "the escape hatch must start immediately"
    assert called["n"] == 0, "the readiness poll must never run when the gate is off"


def test_no_model_means_gate_off(monkeypatch):
    """No utility model resolves ⇒ authoring can't run ⇒ gate OFF (instant start, never a deadlock)."""
    monkeypatch.delenv("ORWELL_ALLOW_FLOOR_START", raising=False)

    async def _no_model(owner):
        return None
    monkeypatch.setattr(ca, "_resolve_llm_fn", _no_model)
    called = {"n": 0}

    async def _spy(owner, **k):
        called["n"] += 1
        return {"ready": False, "authored": 0, "total": 15, "missing": 15}
    monkeypatch.setattr(ca, "await_house_ready", _spy)

    res = _run(ti.do_create_character('{"playerName":"P"}', owner="erin"))
    out = json.loads(res["output"])
    assert out.get("started") is True
    assert called["n"] == 0, "with no model the gate is off — no readiness wait"


# ── the gate-active decision ─────────────────────────────────────────────────────────

def test_house_entry_gate_active_decision(monkeypatch):
    """ON iff a real utility model resolves AND the escape hatch is unset."""
    monkeypatch.delenv("ORWELL_ALLOW_FLOOR_START", raising=False)

    async def _model(owner):
        return lambda messages: "{}"
    monkeypatch.setattr(ca, "_resolve_llm_fn", _model)
    assert _run(ca.house_entry_gate_active("u")) is True

    # escape hatch forces OFF even with a model
    monkeypatch.setenv("ORWELL_ALLOW_FLOOR_START", "1")
    assert _run(ca.house_entry_gate_active("u")) is False

    # no model ⇒ OFF
    monkeypatch.delenv("ORWELL_ALLOW_FLOOR_START", raising=False)

    async def _none(owner):
        return None
    monkeypatch.setattr(ca, "_resolve_llm_fn", _none)
    assert _run(ca.house_entry_gate_active("u")) is False


# ── await_house_ready poll semantics ─────────────────────────────────────────────────

def test_await_house_ready_returns_on_threshold(monkeypatch):
    """Polls completeness and returns ready the moment authored crosses the threshold."""
    seq = iter([{"authored": 5, "total": 15, "missing": 10},
                {"authored": 13, "total": 15, "missing": 2}])

    async def _comp(owner):
        try:
            return next(seq)
        except StopIteration:
            return {"authored": 13, "total": 15, "missing": 2}
    monkeypatch.setattr(ca, "authoring_completeness_for", _comp)
    monkeypatch.setattr(ca, "_kick_backfill_for_stragglers", lambda owner: _noop())

    out = _run(ca.await_house_ready("u", timeout=5, poll_interval=0.01))
    assert out["ready"] is True and out["authored"] == 13


def test_await_house_ready_times_out_below_threshold(monkeypatch):
    """A cast that never reaches the threshold returns not-ready after the (tiny) timeout — no hang."""
    async def _comp(owner):
        return {"authored": 2, "total": 15, "missing": 13}
    monkeypatch.setattr(ca, "authoring_completeness_for", _comp)
    monkeypatch.setattr(ca, "_kick_backfill_for_stragglers", lambda owner: _noop())

    out = _run(ca.await_house_ready("u", timeout=0.05, poll_interval=0.01))
    assert out["ready"] is False and out["authored"] == 2


async def _noop():
    return None
