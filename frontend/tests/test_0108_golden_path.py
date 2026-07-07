"""0108 — the golden-path record/replay seam (unit gates; key-free, fixture-free).

These are the PR-lane teeth for the seam itself: key stability vs drift, hard-fail on a
miss, ordered same-key consumption, the fixture leak scan, the byte-identical-off
guarantee, and an in-process record→replay roundtrip through the REAL chokepoint with the
network layer faked. The full walking gate (invariants 1–8 over the committed fixture)
lives in scripts/golden_path_replay.py and the `golden-path` CI job.

Roles only — every string here is generic probe content, never cast material.
"""
from __future__ import annotations

import asyncio
import importlib
import json
import os
import sys

import pytest


@pytest.fixture()
def golden(tmp_path, monkeypatch):
    """A fresh golden_path module bound to a temp fixture, replay mode OFF."""
    monkeypatch.delenv("ORWELL_GOLDEN_RECORD", raising=False)
    monkeypatch.delenv("ORWELL_GOLDEN_REPLAY", raising=False)
    monkeypatch.setenv("ORWELL_GOLDEN_FIXTURE", str(tmp_path / "fixture.jsonl"))
    sys.modules.pop("src.golden_path", None)
    import src.golden_path as gp
    return importlib.reload(gp)


MSGS = [{"role": "system", "content": "the show framing"}, {"role": "user", "content": "hello"}]
TOOLS = [{"type": "function", "function": {"name": "advanceGame", "parameters": {"type": "object"}}}]
PARAMS = {"model": "narrator-model", "temperature": 0.7, "max_tokens": 256}


# ── the stable request key ─────────────────────────────────────────────────────────

def test_key_is_stable_and_ignores_volatile_fields(golden):
    k1 = golden.request_key("stream", MSGS, TOOLS, dict(PARAMS, user="a", session="s1", timeout=5))
    k2 = golden.request_key("stream", MSGS, TOOLS, dict(PARAMS, user="b", session="s2", timeout=99))
    assert k1 == k2, "user/session/timeout must never enter the key"


def test_key_drifts_with_prompt_tools_params_and_model(golden):
    base = golden.request_key("stream", MSGS, TOOLS, PARAMS)
    drifted_msg = [{"role": "system", "content": "the show framing v2"}] + MSGS[1:]
    assert golden.request_key("stream", drifted_msg, TOOLS, PARAMS) != base
    drifted_tools = [{"type": "function", "function": {"name": "advanceGame",
                                                        "parameters": {"type": "object",
                                                                       "properties": {"x": {}}}}}]
    assert golden.request_key("stream", MSGS, drifted_tools, PARAMS) != base
    assert golden.request_key("stream", MSGS, TOOLS, dict(PARAMS, temperature=0.2)) != base
    assert golden.request_key("stream", MSGS, TOOLS, dict(PARAMS, model="other-model")) != base
    assert golden.request_key("call", MSGS, TOOLS, PARAMS) != base, "kind is part of the key"


def test_wall_clock_text_never_drifts_the_key(golden):
    """The FE injects a '## Current date and time' section (minute-resolution, and the
    date line drifts DAILY) — timestamps are volatile and must be neutralized in the
    key, or a fixture recorded yesterday misses today."""
    at_257 = [{"role": "system", "content":
               "## Current date and time\nToday is Tuesday, July 7, 2026 (2026-07-07). "
               "User local time is 2:57 PM (UTC+00:00); current UTC time is 14:57."},
              {"role": "user", "content": "hello"}]
    next_day = [{"role": "system", "content":
                 "## Current date and time\nToday is Wednesday, July 8, 2026 (2026-07-08). "
                 "User local time is 9:03 AM (UTC+00:00); current UTC time is 9:03."},
                {"role": "user", "content": "hello"}]
    assert golden.request_key("stream", at_257, TOOLS, PARAMS) == \
        golden.request_key("stream", next_day, TOOLS, PARAMS)
    # …while REAL prompt drift beside a clock line still misses.
    changed = [{"role": "system", "content":
                "## Current date and time\nToday is Tuesday, July 7, 2026 (2026-07-07). "
                "User local time is 2:57 PM (UTC+00:00); current UTC time is 14:57. NEW RULE."},
               {"role": "user", "content": "hello"}]
    assert golden.request_key("stream", at_257, TOOLS, PARAMS) != \
        golden.request_key("stream", changed, TOOLS, PARAMS)


def test_presence_dwell_counter_never_drifts_the_key(golden):
    """turnsHere ticks per framed model round; round counts vary ±1 with stream timing,
    so the dwell phrase is neutralized in the key — while every other room/roster detail
    in the same prompt section still drifts it."""
    at_3 = [{"role": "system", "content":
             "Your room: the living room (you've been here 3 turns).\nWith you: two houseguests."},
            {"role": "user", "content": "hello"}]
    at_4 = [{"role": "system", "content":
             "Your room: the living room (you've been here 4 turns).\nWith you: two houseguests."},
            {"role": "user", "content": "hello"}]
    moved = [{"role": "system", "content":
              "Your room: the backyard (you've been here 3 turns).\nWith you: two houseguests."},
             {"role": "user", "content": "hello"}]
    assert golden.request_key("stream", at_3, TOOLS, PARAMS) == \
        golden.request_key("stream", at_4, TOOLS, PARAMS)
    assert golden.request_key("stream", at_3, TOOLS, PARAMS) != \
        golden.request_key("stream", moved, TOOLS, PARAMS)


def test_tool_schema_order_does_not_drift_the_key(golden):
    two = TOOLS + [{"type": "function", "function": {"name": "getGameState",
                                                      "parameters": {"type": "object"}}}]
    assert golden.request_key("stream", MSGS, two, PARAMS) == \
        golden.request_key("stream", MSGS, list(reversed(two)), PARAMS)


# ── replay lookup: hard miss, ordered same-key consumption ─────────────────────────

def _write_fixture(path, records):
    with open(path, "w", encoding="utf-8") as fh:
        for r in records:
            fh.write(json.dumps(r) + "\n")


def test_miss_is_a_hard_failure_with_the_regenerate_hint(golden, tmp_path, monkeypatch):
    fix = tmp_path / "fixture.jsonl"
    key = golden.request_key("stream", MSGS, TOOLS, PARAMS)
    _write_fixture(fix, [{"key": key, "kind": "stream", "seq": 0, "model": "narrator-model",
                          "chunks": ["data: {}\n\n"]}])
    monkeypatch.setenv("ORWELL_GOLDEN_REPLAY", str(fix))
    gp = importlib.reload(sys.modules["src.golden_path"])
    with pytest.raises(gp.GoldenReplayMiss) as e:
        gp.replay_call("narrator-model", [{"role": "user", "content": "DRIFTED"}], PARAMS)
    assert gp.MISS_SENTINEL in str(e.value)
    assert "golden_path_record.py" in str(e.value), "the failure must say how to regenerate"


def test_same_key_repeats_consume_in_order_then_stick_on_last(golden, tmp_path, monkeypatch):
    params = dict(PARAMS)
    fixdata = []
    import src.golden_path as gp0
    key = gp0.request_key("call", MSGS, None, params)
    for i, text in enumerate(["first", "second"]):
        fixdata.append({"key": key, "kind": "call", "seq": i, "model": "narrator-model",
                        "response": text, "meta": {}})
    fix = tmp_path / "fixture.jsonl"
    _write_fixture(fix, fixdata)
    monkeypatch.setenv("ORWELL_GOLDEN_REPLAY", str(fix))
    gp = importlib.reload(sys.modules["src.golden_path"])
    assert gp.replay_call("narrator-model", MSGS, params) == "first"
    assert gp.replay_call("narrator-model", MSGS, params) == "second"
    assert gp.replay_call("narrator-model", MSGS, params) == "second", \
        "a benign extra retry sticks on the last recorded entry"


# ── the fixture leak scan (Vault wall + secrets) ───────────────────────────────────

def test_leak_scan_flags_vault_keys_and_secrets(golden, tmp_path):
    dirty = tmp_path / "dirty.jsonl"
    _write_fixture(dirty, [
        {"key": "k1", "kind": "call", "seq": 0, "response": "fine",
         "request_digest": {"params": {"trust": 0.9}}},
        {"key": "k2", "kind": "call", "seq": 1, "response": "Bearer abcdefgh12345678"},
    ])
    violations = golden.fixture_leak_scan(str(dirty))
    assert any("vault-key" in v for v in violations)
    assert any("secret-shaped" in v for v in violations)


def test_leak_scan_passes_a_clean_fixture(golden, tmp_path):
    clean = tmp_path / "clean.jsonl"
    _write_fixture(clean, [{"key": "k", "kind": "stream", "seq": 0,
                            "chunks": ["data: {\"delta\": \"The room goes quiet.\"}\n\n"],
                            "meta": {"finish_reason": "stop"}}])
    assert golden.fixture_leak_scan(str(clean)) == []


def test_record_scrubs_secret_shapes_before_write(golden, tmp_path, monkeypatch):
    monkeypatch.setenv("ORWELL_GOLDEN_RECORD", "1")
    gp = importlib.reload(sys.modules["src.golden_path"])
    gp.record_call("narrator-model",
                   [{"role": "user", "content": "my key is sk-abcdefgh12345678 ok?"}],
                   {"temperature": 0}, "noted")
    assert gp.fixture_leak_scan() == [], "the 0107 scrub must run before the fixture write"


# ── byte-identical when off + in-process roundtrip through the REAL chokepoint ─────

def test_chokepoint_never_imports_golden_when_disabled(monkeypatch):
    monkeypatch.delenv("ORWELL_GOLDEN_RECORD", raising=False)
    monkeypatch.delenv("ORWELL_GOLDEN_REPLAY", raising=False)
    sys.modules.pop("src.golden_path", None)
    from src import llm_core

    async def fake_traced(candidates, messages, **kwargs):
        yield "data: {\"delta\": \"ok\"}\n\n"
        yield "data: [DONE]\n\n"

    monkeypatch.setattr(llm_core, "_stream_llm_with_fallback_traced", fake_traced)

    async def drive():
        return [c async for c in llm_core.stream_llm_with_fallback(
            [("http://127.0.0.1:9/x", "narrator-model", {})],
            [{"role": "user", "content": "probe"}])]

    chunks = asyncio.get_event_loop().run_until_complete(drive())
    assert chunks == ["data: {\"delta\": \"ok\"}\n\n", "data: [DONE]\n\n"]
    assert "src.golden_path" not in sys.modules, \
        "disabled path must not even import the golden module (byte-identical-off)"


def test_stream_record_then_replay_is_byte_identical(tmp_path, monkeypatch):
    fix = tmp_path / "fixture.jsonl"
    monkeypatch.setenv("ORWELL_GOLDEN_RECORD", "1")
    monkeypatch.setenv("ORWELL_GOLDEN_FIXTURE", str(fix))
    monkeypatch.delenv("ORWELL_GOLDEN_REPLAY", raising=False)
    sys.modules.pop("src.golden_path", None)  # fresh module state (seq counter, replay cache)
    from src import llm_core
    import src.golden_path  # noqa: F401 — bind the fresh module before the chokepoint uses it

    live_chunks = [
        "data: {\"delta\": \"The kitchen \"}\n\n",
        "data: {\"delta\": \"holds its breath.\"}\n\n",
        "data: {\"type\": \"finish\", \"reason\": \"stop\"}\n\n",
        "data: [DONE]\n\n",
    ]

    async def fake_traced(candidates, messages, **kwargs):
        for c in live_chunks:
            yield c

    monkeypatch.setattr(llm_core, "_stream_llm_with_fallback_traced", fake_traced)
    cand = [("http://127.0.0.1:9/x", "narrator-model", {})]
    msgs = [{"role": "user", "content": "one line please"}]

    async def drive():
        return [c async for c in llm_core.stream_llm_with_fallback(cand, msgs, temperature=0.5)]

    recorded = asyncio.get_event_loop().run_until_complete(drive())
    assert recorded == live_chunks, "record mode must forward the live bytes unchanged"
    assert fix.exists() and sum(1 for _ in open(fix)) == 1

    # flip to replay with the network layer REMOVED — the recorded bytes must come back.
    monkeypatch.delenv("ORWELL_GOLDEN_RECORD", raising=False)
    monkeypatch.setenv("ORWELL_GOLDEN_REPLAY", str(fix))
    sys.modules.pop("src.golden_path", None)  # drop record-mode state; replay loads fresh
    import src.golden_path  # noqa: F401

    async def exploding_traced(candidates, messages, **kwargs):
        raise AssertionError("replay must never reach the network layer")
        yield  # pragma: no cover

    monkeypatch.setattr(llm_core, "_stream_llm_with_fallback_traced", exploding_traced)
    replayed = asyncio.get_event_loop().run_until_complete(drive())
    assert replayed == live_chunks, "replay must re-emit the recorded chunks byte-for-byte"


# ── fixture self-description + the integrity gate (format 2) ────────────────────────
#
# Scar tissue: the first GLM recording was silently contaminated when the walk's model
# resolution flipped to a stale stub endpoint mid-run (90/251 records off-model), and the
# old first-stream/-call model derivation mis-read two-tier fixtures. The meta line +
# writer stamps + integrity scan make both failure classes structural, loud failures.

def test_meta_roundtrip_and_replay_skips_the_meta_line(golden, tmp_path, monkeypatch):
    fix = tmp_path / "meta.jsonl"
    golden.write_meta(str(fix), narration_model="narrator-model",
                      utility_model="cheap-model", seed=42)
    meta = golden.fixture_meta(str(fix))
    assert meta and meta["narration_model"] == "narrator-model"
    assert meta["utility_model"] == "cheap-model" and meta["seed"] == 42
    # a replayable record after the meta line still resolves — the loader skips meta
    key = golden.request_key("call", MSGS, None, PARAMS)
    with open(fix, "a", encoding="utf-8") as fh:
        fh.write(json.dumps({"key": key, "kind": "call", "seq": 0,
                             "model": "narrator-model", "response": "ok", "meta": {}}) + "\n")
    monkeypatch.setenv("ORWELL_GOLDEN_REPLAY", str(fix))
    gp = importlib.reload(sys.modules["src.golden_path"])
    assert gp.replay_call("narrator-model", MSGS, PARAMS) == "ok"


def test_records_carry_the_writer_stamp(golden, tmp_path, monkeypatch):
    monkeypatch.setenv("ORWELL_GOLDEN_RECORD", "1")
    gp = importlib.reload(sys.modules["src.golden_path"])
    gp.record_call("narrator-model", MSGS, {"temperature": 0}, "noted")
    rec = json.loads(open(gp.fixture_path()).read().strip())
    assert rec.get("writer") == gp._WRITER_ID and "." in rec["writer"]


def test_integrity_scan_passes_a_clean_two_tier_fixture(golden, tmp_path):
    fix = tmp_path / "clean.jsonl"
    golden.write_meta(str(fix), narration_model="narrator-model", utility_model="cheap-model")
    with open(fix, "a", encoding="utf-8") as fh:
        for i, m in enumerate(["narrator-model", "cheap-model", "narrator-model"]):
            fh.write(json.dumps({"key": f"k{i}", "kind": "stream", "seq": i, "model": m,
                                 "writer": "1.aaa", "chunks": []}) + "\n")
    assert golden.fixture_integrity_scan(str(fix)) == []
    assert golden.fixture_model_census(str(fix)) == {"narrator-model": 2, "cheap-model": 1}


def test_integrity_scan_fails_a_foreign_model_record(golden, tmp_path):
    fix = tmp_path / "flipped.jsonl"
    golden.write_meta(str(fix), narration_model="narrator-model", utility_model="cheap-model")
    with open(fix, "a", encoding="utf-8") as fh:
        fh.write(json.dumps({"key": "k0", "kind": "stream", "seq": 0,
                             "model": "narrator-model", "writer": "1.aaa", "chunks": []}) + "\n")
        fh.write(json.dumps({"key": "k1", "kind": "stream", "seq": 1,
                             "model": "stale-stub-model", "writer": "1.aaa", "chunks": []}) + "\n")
    violations = golden.fixture_integrity_scan(str(fix))
    assert any("foreign model" in v and "stale-stub-model" in v for v in violations)


def test_integrity_scan_fails_multiple_writers(golden, tmp_path):
    fix = tmp_path / "twowriters.jsonl"
    golden.write_meta(str(fix), narration_model="narrator-model", utility_model="narrator-model")
    with open(fix, "a", encoding="utf-8") as fh:
        fh.write(json.dumps({"key": "k0", "kind": "call", "seq": 0, "model": "narrator-model",
                             "writer": "100.aaa", "response": ""}) + "\n")
        fh.write(json.dumps({"key": "k1", "kind": "call", "seq": 0, "model": "narrator-model",
                             "writer": "200.bbb", "response": ""}) + "\n")
    violations = golden.fixture_integrity_scan(str(fix))
    assert any("multiple record writers" in v for v in violations)


def test_integrity_scan_fails_meta_missing_or_not_first(golden, tmp_path):
    bare = tmp_path / "bare.jsonl"
    _write_fixture(bare, [{"key": "k", "kind": "call", "seq": 0,
                           "model": "narrator-model", "writer": "1.a", "response": ""}])
    assert any("no meta line" in v for v in golden.fixture_integrity_scan(str(bare)))
    appended = tmp_path / "appended.jsonl"
    _write_fixture(appended, [{"key": "k", "kind": "call", "seq": 0,
                               "model": "narrator-model", "writer": "1.a", "response": ""}])
    with open(appended, "a", encoding="utf-8") as fh:
        fh.write(json.dumps({"kind": "meta", "narration_model": "narrator-model",
                             "utility_model": "narrator-model"}) + "\n")
    assert any("not first" in v for v in golden.fixture_integrity_scan(str(appended)))


def test_fixture_models_prefers_the_meta_declaration(golden, tmp_path):
    """The format-1 heuristic mis-derives two-tier fixtures (identity calls stream on the
    utility tier but default to call_class narration) — meta wins when present."""
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from scripts._golden_driver import fixture_models
    fix = tmp_path / "twotier.jsonl"
    golden.write_meta(str(fix), narration_model="narrator-model", utility_model="cheap-model")
    with open(fix, "a", encoding="utf-8") as fh:
        # first STREAM record is a cast-identity call on the CHEAP tier — the old
        # heuristic would have called this the narration model.
        fh.write(json.dumps({"key": "k0", "kind": "stream", "seq": 0,
                             "model": "cheap-model", "writer": "1.a", "chunks": []}) + "\n")
        fh.write(json.dumps({"key": "k1", "kind": "stream", "seq": 1,
                             "model": "narrator-model", "writer": "1.a", "chunks": []}) + "\n")
    assert fixture_models(str(fix)) == ("narrator-model", "cheap-model")
    # format-1 fixtures (no meta) still derive by the old heuristic
    bare = tmp_path / "old.jsonl"
    _write_fixture(bare, [
        {"key": "k0", "kind": "stream", "seq": 0, "model": "narrator-model", "chunks": []},
        {"key": "k1", "kind": "call", "seq": 1, "model": "cheap-model", "response": ""},
    ])
    assert fixture_models(str(bare)) == ("narrator-model", "cheap-model")
