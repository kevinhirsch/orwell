"""`sandboxHealth` (God Mode, 0016) is wired to the front end for parity with its four admin
siblings. The engine exposes it on the ADMIN channel (B58: Vault-free sandbox health — week/phase,
integrity status, recent faults, circuit state), but it was the one admin tool with NO front-end
path (no client method, no schema, dropped by the game build). This locks in the cross-reference fix.

Roles only — tool/capability names are app capabilities, not people, so naming them is fine.
"""
import asyncio
import importlib

orwell_engine = importlib.import_module("src.orwell_engine")
from src.agent_tools import GAME_TOOL_KEEP, TOOL_TAGS
from src.tool_execution import _ADMIN_TOOLS
from src.tool_schemas import FUNCTION_TOOL_SCHEMAS


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _schema_names():
    return {s["function"]["name"] for s in FUNCTION_TOOL_SCHEMAS if s.get("type") == "function"}


def test_sandbox_health_is_listed_and_admin_gated():
    # Listed + handed to the agent under the game build (TOOL_TAGS ∩ KEEP), AND admin-gated.
    assert "sandboxHealth" in TOOL_TAGS
    assert "sandboxHealth" in GAME_TOOL_KEEP
    assert "sandboxHealth" in _ADMIN_TOOLS  # the gate at tool_execution blocks non-admins on this set


def test_sandbox_health_has_an_agent_schema():
    assert "sandboxHealth" in _schema_names()


def test_sandbox_health_client_uses_the_admin_channel(monkeypatch):
    captured = {}

    async def fake_post(path, name, args=None, user=None, timeout=None):
        captured.update(path=path, name=name, user=user)
        return {"week": 1, "phase": "hoh", "lastIntegrity": "ok"}

    monkeypatch.setattr(orwell_engine, "_post_tool", fake_post)
    res = _run(orwell_engine.sandbox_health(user="u-admin"))
    assert captured["path"] == "/admin/call"   # the E27 admin channel — never /player/call
    assert captured["name"] == "sandboxHealth"
    assert captured["user"] == "u-admin"
    assert res["lastIntegrity"] == "ok"


# ── 2026-07-13 (prod bundle audit): play-clock stamps are LABELED, never wall time ────────
#
# The engine's runtime Clock is a fixed-epoch LogicalClock (one step per committed mutation);
# sandboxHealth's `lastAdvanceAt` / `faults[].when` are PLAY-CLOCK values that merely look like
# epoch-ms. Rendering them as a date ("Jan 2026") is a mislabel — the FE relabels them at the
# one seam every consumer shares (orwell_engine.sandbox_health → label_play_clock).

def test_label_play_clock_relabels_last_advance_and_faults():
    h = {
        "user": "u", "week": 2, "phase": "veto",
        "lastAdvanceAt": 1_767_225_780_000,          # epoch + 3 beats (3 committed mutations)
        "faults": [{"when": 1_767_225_660_000, "kind": "no-daily-event"}],
        "lastIntegrity": "ok",
    }
    out = orwell_engine.label_play_clock(h)
    assert "lastAdvanceAt" in h and "lastAdvanceAt" not in out, \
        "the wall-time-looking key must not survive (input dict untouched)"
    la = out["lastAdvancePlayClock"]
    assert la["beat"] == 3 and la["playClockMs"] == 1_767_225_780_000
    assert la["label"] == "play-clock beat 3"
    fw = out["faults"][0]["whenPlayClock"]
    assert "when" not in out["faults"][0] and fw["beat"] == 1
    legend = out["playClock"]
    assert legend["epochMs"] == orwell_engine.PLAY_CLOCK_EPOCH_MS
    assert "NOT wall time" in legend["note"]
    # The untouched fields ride through.
    assert out["week"] == 2 and out["lastIntegrity"] == "ok"


def test_label_play_clock_passes_through_stampless_payloads():
    for payload in ({"week": 1, "phase": "hoh", "lastIntegrity": "ok"}, {"error": "down"}, None, []):
        assert orwell_engine.label_play_clock(payload) == payload


def test_label_play_clock_handles_null_last_advance():
    out = orwell_engine.label_play_clock({"lastAdvanceAt": None, "faults": []})
    assert out["lastAdvancePlayClock"] is None and "lastAdvanceAt" not in out


def test_sandbox_health_applies_the_play_clock_labels(monkeypatch):
    async def fake_post(path, name, args=None, user=None, timeout=None):
        return {"week": 1, "phase": "hoh", "lastAdvanceAt": 1_767_225_720_000, "faults": []}

    monkeypatch.setattr(orwell_engine, "_post_tool", fake_post)
    res = _run(orwell_engine.sandbox_health(user="u-admin"))
    assert "lastAdvanceAt" not in res, \
        "the shared client seam must relabel play-clock stamps for every consumer " \
        "(admin tool result, health page, debug bundle)"
    assert res["lastAdvancePlayClock"]["beat"] == 2


# ── CodeRabbit P1-fix hardening (2026-07-13): the raw `when` key must NEVER survive ─────────

def test_fault_with_non_numeric_when_never_retains_the_raw_key():
    """A fault whose `when` is NON-numeric (a date-like string, or None) must still have the raw
    `when` popped — otherwise a wall-clock-looking value survives, defeating the whole invariant.
    `whenPlayClock` is None (not labelable), but the raw key is gone."""
    for bad_when in ("2026-01-01T00:00:00Z", None, "yesterday", {"nested": 1}):
        h = {"faults": [{"when": bad_when, "kind": "degradation"}]}
        out = orwell_engine.label_play_clock(h)
        fault = out["faults"][0]
        assert "when" not in fault, f"raw `when` ({bad_when!r}) must never survive"
        assert fault["whenPlayClock"] is None
        assert fault["kind"] == "degradation"  # sibling fields ride through
        # A relabel happened ⇒ the playClock legend rides along.
        assert "playClock" in out


def test_fault_without_a_when_key_is_untouched():
    h = {"faults": [{"kind": "vault-leak"}]}
    out = orwell_engine.label_play_clock(h)
    assert out["faults"][0] == {"kind": "vault-leak"}


def test_non_dict_faults_pass_through_unchanged():
    h = {"faults": ["oops", 42, None, {"when": 1_767_225_660_000, "kind": "no-daily-event"}]}
    out = orwell_engine.label_play_clock(h)
    assert out["faults"][0] == "oops" and out["faults"][1] == 42 and out["faults"][2] is None
    assert "when" not in out["faults"][3] and out["faults"][3]["whenPlayClock"]["beat"] == 1


def test_play_clock_beat_is_fail_soft_on_non_finite_and_junk():
    """`_play_clock_beat` is documented fail-soft: `float('inf')`/`nan` (which raise OverflowError/
    ValueError inside `int()`) and junk return None, never crash (the helper must never raise)."""
    for junk in (float("inf"), float("-inf"), float("nan"), "not-a-number", None, [1], True, False):
        assert orwell_engine._play_clock_beat(junk) is None, junk
    # a real numeric stamp still resolves.
    assert orwell_engine._play_clock_beat(orwell_engine.PLAY_CLOCK_EPOCH_MS + 2 * 60_000) == 2


def test_label_play_clock_survives_an_inf_stamp():
    """The end-to-end guard: an `inf` lastAdvanceAt / fault `when` must relabel to a None-beat
    play-clock entry, never raise (label_play_clock is 'purely presentational and fail-soft')."""
    out = orwell_engine.label_play_clock(
        {"lastAdvanceAt": float("inf"), "faults": [{"when": float("nan"), "kind": "degradation"}]})
    assert out["lastAdvancePlayClock"] is not None
    assert out["lastAdvancePlayClock"]["beat"] is None
    assert "when" not in out["faults"][0] and out["faults"][0]["whenPlayClock"]["beat"] is None
