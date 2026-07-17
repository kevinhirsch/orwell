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


def test_npc_dwell_labels_never_drift_the_key(golden):
    """NPC dwell labels ride the same per-framed-round counter as turnsHere; a legitimate
    ±1 round shifts every label (record #9's replay diverged on exactly this). Neutralized
    key-side; a real presence change (who is co-present) still drifts."""
    a = [{"role": "system", "content":
          "With you: A (lingering, 9 turns), B (just arrived), C (lingering, 22 turns)."},
         {"role": "user", "content": "hello"}]
    b = [{"role": "system", "content":
          "With you: A (lingering, 10 turns), B (a moment), C (lingering, 23 turns)."},
         {"role": "user", "content": "hello"}]
    moved = [{"role": "system", "content":
              "With you: A (lingering, 9 turns), D (just arrived), C (lingering, 22 turns)."},
             {"role": "user", "content": "hello"}]
    assert golden.request_key("stream", a, TOOLS, PARAMS) == \
        golden.request_key("stream", b, TOOLS, PARAMS)
    assert golden.request_key("stream", a, TOOLS, PARAMS) != \
        golden.request_key("stream", moved, TOOLS, PARAMS)


def test_raw_json_turnsHere_in_a_tool_result_never_drifts_the_key(golden):
    """The 2026-07-17 fresh-GLM-recording miss: `createCharacter`'s tool result nests a full
    `whereabouts` snapshot — {"turnsHere": N, "companions": [{"turnsHere": N}, …]} — echoed back
    into the NEXT round's messages as `tool`-role content. That is the SAME per-committed-turn
    presence-tenure counter the "Your room:"/"With you:" prompt-line subs above neutralize, but
    reaching the key through a totally different code path (a raw JSON tool result, not
    `momentPrompts.ts` rendered text) that those line-scoped subs never touch — so a real live
    recording's tenure value (however it landed) could never be reproduced bit-for-bit by a
    deterministic replay reconstruction, and the finalize turn's very next round missed every time.
    Neutralized narrowly by JSON key name; every other field in the same tool result (room
    assignment, roster, ids) still drifts the key on a real change."""
    tool_msgs_0 = [
        {"role": "system", "content": "framing"},
        {"role": "assistant", "content": "Fine. You're cast.",
         "tool_calls": [{"id": "tool-abc", "type": "function",
                         "function": {"name": "createCharacter", "arguments": "{}"}}]},
        {"role": "tool", "tool_call_id": "tool-abc", "content":
         '### createCharacter\n```\n{"whereabouts": {"room": "living-room", "turnsHere": 0, '
         '"companions": [{"id": "npc:6", "name": "Houseguest A", "turnsHere": 0}, '
         '{"id": "npc:9", "name": "Houseguest B", "turnsHere": 0}]}}\n```'},
    ]
    tool_msgs_1 = [
        {"role": "system", "content": "framing"},
        {"role": "assistant", "content": "Fine. You're cast.",
         "tool_calls": [{"id": "tool-abc", "type": "function",
                         "function": {"name": "createCharacter", "arguments": "{}"}}]},
        {"role": "tool", "tool_call_id": "tool-abc", "content":
         '### createCharacter\n```\n{"whereabouts": {"room": "living-room", "turnsHere": 1, '
         '"companions": [{"id": "npc:6", "name": "Houseguest A", "turnsHere": 1}, '
         '{"id": "npc:9", "name": "Houseguest B", "turnsHere": 0}]}}\n```'},
    ]
    assert golden.request_key("stream", tool_msgs_0, TOOLS, PARAMS) == \
        golden.request_key("stream", tool_msgs_1, TOOLS, PARAMS)
    # …but a real change to who is present (not merely their tenure) still drifts the key.
    moved = [
        {"role": "system", "content": "framing"},
        {"role": "assistant", "content": "Fine. You're cast.",
         "tool_calls": [{"id": "tool-abc", "type": "function",
                         "function": {"name": "createCharacter", "arguments": "{}"}}]},
        {"role": "tool", "tool_call_id": "tool-abc", "content":
         '### createCharacter\n```\n{"whereabouts": {"room": "kitchen", "turnsHere": 0, '
         '"companions": [{"id": "npc:6", "name": "Houseguest A", "turnsHere": 0}, '
         '{"id": "npc:9", "name": "Houseguest B", "turnsHere": 0}]}}\n```'},
    ]
    assert golden.request_key("stream", tool_msgs_0, TOOLS, PARAMS) != \
        golden.request_key("stream", moved, TOOLS, PARAMS)


def test_dwell_neutralization_is_scoped_to_presence_lines(golden):
    """PR #1234 review: the dwell subs are line-scoped — the SAME parenthetical worded
    into unrelated prompt prose is a game fact and must still drift the key; and the
    Your-room tenure clause neutralizes its word forms too (t<=1 renders "just arrived"/
    "a moment", which the old numeric-only pattern missed)."""
    prose_a = [{"role": "system", "content": "She hesitated (a moment) before answering."},
               {"role": "user", "content": "hello"}]
    prose_b = [{"role": "system", "content": "She hesitated (just arrived) before answering."},
               {"role": "user", "content": "hello"}]
    assert golden.request_key("stream", prose_a, TOOLS, PARAMS) != \
        golden.request_key("stream", prose_b, TOOLS, PARAMS)
    word_a = [{"role": "system", "content":
               "Your room: the kitchen (you've been here just arrived).\nWith you: no one."},
              {"role": "user", "content": "hello"}]
    word_b = [{"role": "system", "content":
               "Your room: the kitchen (you've been here a moment).\nWith you: no one."},
              {"role": "user", "content": "hello"}]
    word_c = [{"role": "system", "content":
               "Your room: the kitchen (you've been here 2 turns).\nWith you: no one."},
              {"role": "user", "content": "hello"}]
    assert golden.request_key("stream", word_a, TOOLS, PARAMS) == \
        golden.request_key("stream", word_b, TOOLS, PARAMS)
    assert golden.request_key("stream", word_b, TOOLS, PARAMS) == \
        golden.request_key("stream", word_c, TOOLS, PARAMS)


def test_gossip_drift_hedge_never_drifts_the_key(golden):
    """A surfaced fact carries src/engine/gossip.ts `distort`'s hedge suffix
    " · <phrase>#<0-999>" — a random word + a random id, re-rolled every retelling (and a
    retelling can fire ±1 more time between the slow record and the instant replay). It
    reaches the key verbatim (the adapter's id-only humanize does NOT run tidyPathwaySlugs),
    so it is neutralized key-side; a real change to the fact body still drifts the key."""
    gossip_a = [{"role": "system", "content":
                 "WHAT YOU'VE LEARNED:\n  - word around the house is that A and B are "
                 "plotting something · roughly#742"},
                {"role": "user", "content": "hello"}]
    gossip_b = [{"role": "system", "content":
                 "WHAT YOU'VE LEARNED:\n  - word around the house is that A and B are "
                 "plotting something · supposedly#8"},
                {"role": "user", "content": "hello"}]
    overheard_a = [{"role": "system", "content":
                    "WHAT YOU'VE LEARNED:\n  - (overheard, muffled) they were talking… "
                    "· or so I heard#301"},
                   {"role": "user", "content": "hello"}]
    overheard_b = [{"role": "system", "content":
                    "WHAT YOU'VE LEARNED:\n  - (overheard, muffled) they were talking… "
                    "· more or less#977"},
                   {"role": "user", "content": "hello"}]
    # The hedge id/phrase is invisible to the key…
    assert golden.request_key("stream", gossip_a, TOOLS, PARAMS) == \
        golden.request_key("stream", gossip_b, TOOLS, PARAMS)
    assert golden.request_key("stream", overheard_a, TOOLS, PARAMS) == \
        golden.request_key("stream", overheard_b, TOOLS, PARAMS)
    # …but a real change to WHAT the fact says still misses (coverage isn't gutted).
    changed = [{"role": "system", "content":
                "WHAT YOU'VE LEARNED:\n  - word around the house is that A and C are "
                "plotting something · roughly#742"},
               {"role": "user", "content": "hello"}]
    assert golden.request_key("stream", gossip_a, TOOLS, PARAMS) != \
        golden.request_key("stream", changed, TOOLS, PARAMS)


def test_movement_in_the_room_cue_never_drifts_the_key(golden):
    """The FE's MOVEMENT IN THE ROOM cue (routes/chat_helpers.py _render_presence_movement)
    names the per-turn presence diff — who came/went — which varies ±1 with tick timing. The
    who/where between the em-dash and the fixed ". Voice it as a natural beat" is neutralized;
    the stable instruction around it, and any OTHER prompt change, still drifts the key."""
    tail = (". Voice it as a natural beat — show them heading out or arriving — never let a "
            "houseguest simply vanish from or appear in the scene without a beat. (The engine "
            "moves the houseguests; you only narrate it.)")
    left = [{"role": "system", "content":
             "MOVEMENT IN THE ROOM (engine truth) — A has left the kitchen" + tail},
            {"role": "user", "content": "hello"}]
    came = [{"role": "system", "content":
             "MOVEMENT IN THE ROOM (engine truth) — B and C have come into the kitchen" + tail},
            {"role": "user", "content": "hello"}]
    assert golden.request_key("stream", left, TOOLS, PARAMS) == \
        golden.request_key("stream", came, TOOLS, PARAMS)
    # A change to the STABLE framing (not the volatile who/where) still misses.
    changed = [{"role": "system", "content":
                "MOVEMENT IN THE ROOM (engine truth) — A has left the kitchen" + tail + " NEW."},
               {"role": "user", "content": "hello"}]
    assert golden.request_key("stream", left, TOOLS, PARAMS) != \
        golden.request_key("stream", changed, TOOLS, PARAMS)


def test_offscreen_neutralization_is_scoped(golden):
    """Both subs are narrow: the gossip-hedge shape ` · <phrase>#<n>` and the anchored
    MOVEMENT line only. Unrelated prompt prose that merely resembles a fragment still keys."""
    # A bare "#<n>" without the " · <phrase>" hedge shape is ordinary content — must still drift.
    hash_a = [{"role": "system", "content": "The vote was 5#1 in the diary room."},
              {"role": "user", "content": "hello"}]
    hash_b = [{"role": "system", "content": "The vote was 5#2 in the diary room."},
              {"role": "user", "content": "hello"}]
    assert golden.request_key("stream", hash_a, TOOLS, PARAMS) != \
        golden.request_key("stream", hash_b, TOOLS, PARAMS)
    # "movement" prose that is NOT the anchored cue line must still drift on its content.
    prose_a = [{"role": "system", "content": "There was movement in the room as A walked past."},
               {"role": "user", "content": "hello"}]
    prose_b = [{"role": "system", "content": "There was movement in the room as B walked past."},
               {"role": "user", "content": "hello"}]
    assert golden.request_key("stream", prose_a, TOOLS, PARAMS) != \
        golden.request_key("stream", prose_b, TOOLS, PARAMS)


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


def test_leak_scan_allows_authoring_direction_but_flags_engine_vault_fields(golden, tmp_path):
    """The cast-authoring write-back AUTHORS hidden profile content in flight TO the engine
    (record #11's identity stream carried "hiddenLifeStakes" and false-failed) — sanctioned.
    Engine Vault FIELD NAMES echoed back (hiddenTarget/hiddenAgenda) still fail."""
    ok = tmp_path / "authoring.jsonl"
    _write_fixture(ok, [{"key": "k", "kind": "stream", "seq": 0,
                         "chunks": ['data: {"delta": "\\"hiddenLifeStakes\\": \\"debt\\""}\n\n']}])
    assert golden.fixture_leak_scan(str(ok)) == []
    bad = tmp_path / "vaultfield.jsonl"
    _write_fixture(bad, [{"key": "k", "kind": "call", "seq": 0,
                          "response": '{"hiddenTarget": "npc:2"}', "meta": {}}])
    assert any("vault-key" in v for v in golden.fixture_leak_scan(str(bad)))


def test_leak_scan_passes_a_clean_fixture(golden, tmp_path):
    clean = tmp_path / "clean.jsonl"
    _write_fixture(clean, [{"key": "k", "kind": "stream", "seq": 0,
                            "chunks": ["data: {\"delta\": \"The room goes quiet.\"}\n\n"],
                            "meta": {"finish_reason": "stop"}}])
    assert golden.fixture_leak_scan(str(clean)) == []


def test_leak_scan_allows_narration_words_but_flags_the_engine_key(golden, tmp_path):
    """The Vault field names are all common English words the narrator legitimately voices. A bare
    narration VALUE that equals such a word — e.g. "untrustworthy" streamed as tokens ["un","trust",
    "worthy"] serializes a delta chunk `{"delta": "trust"}` — is NOT a Vault leak and must NOT trip
    the gate (matching a KEY requires the trailing colon). The engine FIELD echo (`{"trust": 0.7}`,
    where the secret number rides) still fails. Guards the key-position anchor from silently
    regressing back to a bare-word substring match (which false-fails almost every re-record)."""
    prose = tmp_path / "prose.jsonl"
    _write_fixture(prose, [{"key": "k", "kind": "stream", "seq": 0, "chunks": [
        'data: {"delta": "him un"}\n\n', 'data: {"delta": "trust"}\n\n',
        'data: {"delta": "worthy — a real threat"}\n\n', 'data: {"delta": " to my soul."}\n\n']}])
    assert golden.fixture_leak_scan(str(prose)) == [], "narration words must not trip the Vault gate"
    leak = tmp_path / "leak.jsonl"
    _write_fixture(leak, [{"key": "k", "kind": "call", "seq": 0,
                           "response": '{"trust": 0.7, "threat": 0.3}'}])
    assert any("vault-key" in v for v in golden.fixture_leak_scan(str(leak))), (
        "an engine Vault field echo (key + numeric value) must still be caught")


def test_record_scrubs_secret_shapes_before_write(golden, tmp_path, monkeypatch):
    monkeypatch.setenv("ORWELL_GOLDEN_RECORD", "1")
    gp = importlib.reload(sys.modules["src.golden_path"])
    gp.record_call("narrator-model",
                   [{"role": "user", "content": "my key is sk-abcdefgh12345678 ok?"}],
                   {"temperature": 0}, "noted")
    assert gp.fixture_leak_scan() == [], "the 0107 scrub must run before the fixture write"


# ── byte-identical when off + in-process roundtrip through the REAL chokepoint ─────

def test_finishless_clean_stream_is_persisted_as_replayable(tmp_path, monkeypatch):
    """GLM-4.7 sometimes ends a live stream empty-handed — no finish chunk, no [DONE], no
    error. The FE's refire belts handle that live, so replay must re-emit the same stream
    to walk the same belt path. The old finish-marker requirement silently dropped these
    and made the take unreplayable (the 2026-07-17 finalize-turn replay miss)."""
    fix = tmp_path / "fixture.jsonl"
    monkeypatch.setenv("ORWELL_GOLDEN_RECORD", "1")
    monkeypatch.setenv("ORWELL_GOLDEN_FIXTURE", str(fix))
    monkeypatch.delenv("ORWELL_GOLDEN_REPLAY", raising=False)
    sys.modules.pop("src.golden_path", None)
    import src.golden_path as gp
    gp.record_stream("narrator-model", MSGS, {"temperature": 0.7}, [])
    recs = [json.loads(l) for l in fix.read_text().splitlines() if l.strip()]
    streams = [r for r in recs if r.get("kind") == "stream"]
    assert len(streams) == 1, "a clean finish-less (even empty) stream must be persisted"
    assert streams[0]["meta"]["completed_normally"] is False
    assert not os.path.exists(gp.dropped_sidecar_path(str(fix))), \
        "a persisted stream is not a drop"


def test_errored_stream_is_dropped_to_the_sidecar(tmp_path, monkeypatch):
    """An errored stream stays unpersisted (the FE's live retry/fallback reaction cannot be
    reproduced from a poisoned record) — but it must land in the dropped-stream sidecar so
    the record script fails the take loudly instead of printing RECORD OK over a fixture
    replay cannot walk."""
    fix = tmp_path / "fixture.jsonl"
    monkeypatch.setenv("ORWELL_GOLDEN_RECORD", "1")
    monkeypatch.setenv("ORWELL_GOLDEN_FIXTURE", str(fix))
    monkeypatch.delenv("ORWELL_GOLDEN_REPLAY", raising=False)
    sys.modules.pop("src.golden_path", None)
    import src.golden_path as gp
    gp.record_stream("narrator-model", MSGS, {"temperature": 0.7},
                     ['data: {"error": {"message": "provider 502"}}\n\n'])
    assert not fix.exists() or not any(
        json.loads(l).get("kind") == "stream"
        for l in fix.read_text().splitlines() if l.strip()), \
        "an errored stream must never be persisted as replayable"
    side = gp.dropped_sidecar_path(str(fix))
    assert os.path.exists(side) and os.path.getsize(side) > 0
    entry = json.loads(open(side).read().splitlines()[0])
    assert entry["reason"] == "error-chunk"
    # The sidecar entry carries the request KEY so the record script can tell a benign
    # drop (a same-key retry succeeded and was persisted — replay consumes the success)
    # from a poisoned take (no persisted twin — replay hard-misses there).
    assert entry["key"] == gp.request_key(
        "stream", MSGS, None, {"temperature": 0.7, "model": "narrator-model"})
    # Triage primitive: once a successful same-key retry lands in the fixture,
    # fixture_keys() contains the dropped key — the drop is benign.
    assert entry["key"] not in gp.fixture_keys(str(fix))
    gp.record_stream("narrator-model", MSGS, {"temperature": 0.7},
                     ['data: {"delta": "recovered"}\n\n', "data: [DONE]\n\n"])
    assert entry["key"] in gp.fixture_keys(str(fix))


def test_vetoed_stream_is_dropped_to_the_sidecar(tmp_path, monkeypatch):
    fix = tmp_path / "fixture.jsonl"
    monkeypatch.setenv("ORWELL_GOLDEN_RECORD", "1")
    monkeypatch.setenv("ORWELL_GOLDEN_FIXTURE", str(fix))
    monkeypatch.delenv("ORWELL_GOLDEN_REPLAY", raising=False)
    sys.modules.pop("src.golden_path", None)
    import src.golden_path as gp
    gp.record_stream("narrator-model", MSGS, {"temperature": 0.7},
                     ['data: {"delta": "half a"}\n\n'], completed=False)
    assert not fix.exists() or not any(
        json.loads(l).get("kind") == "stream"
        for l in fix.read_text().splitlines() if l.strip())
    side = gp.dropped_sidecar_path(str(fix))
    assert os.path.exists(side) and os.path.getsize(side) > 0
    assert json.loads(open(side).read().splitlines()[0])["reason"] == "vetoed"


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
    # 2 lines: the self-written meta line (format 2) + the one recorded stream.
    assert fix.exists() and sum(1 for _ in open(fix)) == 2

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


def test_records_carry_the_writer_stamp_and_meta_is_self_written(golden, tmp_path, monkeypatch):
    """The FIRST record initializes the fixture with its meta line — written by the SAME
    process (meta writer == record writer, the integrity scan's initialized-vs-populated
    rule holds by construction; attempt #5's perfect walk was rejected solely because the
    record SCRIPT had stamped meta from its own pid)."""
    monkeypatch.setenv("ORWELL_GOLDEN_RECORD", "1")
    gp = importlib.reload(sys.modules["src.golden_path"])
    gp.record_call("narrator-model", MSGS, {"temperature": 0}, "noted")
    lines = [json.loads(l) for l in open(gp.fixture_path()) if l.strip()]
    assert lines[0]["kind"] == "meta" and lines[1]["kind"] == "call"
    assert lines[0]["writer"] == lines[1]["writer"] == gp._WRITER_ID
    # no declared-tier envs in this bare unit record ⇒ the record's own model stands in
    assert lines[0]["narration_model"] == "narrator-model"
    assert gp.fixture_integrity_scan(gp.fixture_path()) == []


def test_meta_models_come_from_the_driver_envs(golden, tmp_path, monkeypatch):
    monkeypatch.setenv("ORWELL_GOLDEN_RECORD", "1")
    monkeypatch.setenv("ORWELL_GOLDEN_NARRATION_MODEL", "narrator-model")
    monkeypatch.setenv("ORWELL_GOLDEN_UTILITY_MODEL", "cheap-model")
    monkeypatch.setenv("ORWELL_GOLDEN_SEED", "108108")
    gp = importlib.reload(sys.modules["src.golden_path"])
    gp.record_call("cheap-model", MSGS, {"temperature": 0, "call_class": "utility"}, "{}")
    meta = gp.fixture_meta(gp.fixture_path())
    assert meta and meta["narration_model"] == "narrator-model"
    assert meta["utility_model"] == "cheap-model" and meta["seed"] == 108108
    assert gp.fixture_integrity_scan(
        gp.fixture_path(), narration_model="narrator-model", utility_model="cheap-model") == []


def test_integrity_scan_passes_a_clean_two_tier_fixture(golden, tmp_path):
    fix = tmp_path / "clean.jsonl"
    golden.write_meta(str(fix), narration_model="narrator-model", utility_model="cheap-model")
    # Records may carry any writer — the meta is written by the recorder process while
    # records come from the FE subprocess (a different PID → different _WRITER_ID).
    # The only enforcement is that all records share ONE writer (no concurrent writers).
    with open(fix, "a", encoding="utf-8") as fh:
        for i, m in enumerate(["narrator-model", "cheap-model", "narrator-model"]):
            fh.write(json.dumps({"key": f"k{i}", "kind": "stream", "seq": i, "model": m,
                                 "writer": "subprocess.abc123", "chunks": []}) + "\n")
    assert golden.fixture_integrity_scan(str(fix)) == []
    assert golden.fixture_model_census(str(fix)) == {"narrator-model": 2, "cheap-model": 1}


def test_integrity_scan_fails_two_concurrent_record_writers(golden, tmp_path):
    # Two distinct record-writer IDs in one fixture means two processes appended
    # concurrently — the multi-writer check must catch it regardless of the meta writer.
    fix = tmp_path / "multiwriter.jsonl"
    golden.write_meta(str(fix), narration_model="narrator-model", utility_model="narrator-model")
    with open(fix, "a", encoding="utf-8") as fh:
        fh.write(json.dumps({"key": "k0", "kind": "call", "seq": 0, "model": "narrator-model",
                             "writer": "pid1.aaa", "response": ""}) + "\n")
        fh.write(json.dumps({"key": "k1", "kind": "call", "seq": 1, "model": "narrator-model",
                             "writer": "pid2.bbb", "response": ""}) + "\n")
    violations = golden.fixture_integrity_scan(str(fix))
    assert any("multiple record writers" in v for v in violations)


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


def test_fixture_models_prefers_the_meta_declaration(golden, tmp_path, monkeypatch):
    """The format-1 heuristic mis-derives two-tier fixtures (identity calls stream on the
    utility tier but default to call_class narration) — meta wins when present."""
    # Scoped + auto-reverted: don't leak a process-wide sys.path change into later tests.
    monkeypatch.syspath_prepend(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
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


def test_portrait_reconciler_is_quiesced_under_golden(monkeypatch):
    """The G20 reconciler is a WALL-CLOCK background sweep (5-min interval) that generates
    portraits through `backfill_missing` → `generate_and_store` and records image-shown
    beats. A record run outlives the interval; a replay run doesn't (and its provider is a
    dead end) — so a mid-record sweep bakes record-only `evt:image:*` events into the
    fixture and every later event id / beatSeq shifts one (the r3 replay miss, 2026-07-08).
    Under golden the reconciler must never start; the turn-driven portrait seams are
    already covered by the kickoff_generation / kickoff_backfill guards."""
    from conftest import _run

    from src import orwell_portraits

    monkeypatch.setenv("ORWELL_GOLDEN_RECORD", "1")
    # Isolate the module global: the guard returns BEFORE touching _RECONCILER_TASK, so
    # without this the final assertion would ride whatever a prior test left behind.
    monkeypatch.setattr(orwell_portraits, "_RECONCILER_TASK", None)

    async def run():
        return orwell_portraits.ensure_reconciler_started()

    assert _run(run()) is False
    assert orwell_portraits._RECONCILER_TASK is None
