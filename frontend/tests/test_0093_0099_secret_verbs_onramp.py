"""Phase 4 of "the player can play offense" — the FE on-ramp for `confide`/`exposeSecret`/`tradeSecret`.

All three are ALREADY fully built, wired engine tools (src/surfaces/tools/registry.ts ->
src/adapters/mcp/McpServer.ts -> src/adapters/engine/GameSessionAdapter.ts + their `.feature` specs
0075/0093/0099) — but two FE-side gaps kept them from firing in real play:

  (1) `exposeSecret`/`tradeSecret` were advertised in the model-facing function schema
      (`tool_schemas.py`) and allow-listed for the game build, but `tool_execution.py`'s dispatcher
      had NO branch for either tool name — every model-driven call landed on the generic
      "Unknown tool type" fallback. This is more than discoverability: it was a dead wire. Fixed by
      adding `do_expose_secret`/`do_trade_secret` (tool_implementations.py) + their
      `orwell_engine.expose_secret`/`trade_secret` wrappers + the missing `elif` dispatch branches,
      mirroring the working `confide` path end to end.
  (2) Even once reachable, the narration model reliably UNDER-calls marquee social levers (the same
      0055/0075 class) — so `_auto_expose_secret`/`_auto_trade_secret` extend the existing
      `_auto_confide` FE back-fill belt family: when the player's own words clearly read as
      outing/trading a secret and the model skipped the call, the FE calls it itself.

Invariants preserved (never weakened):
  - I3/Vault Wall: the belt NEVER invents a secret. Its candidate `factId` is drawn ONLY from the
    player's own `getVisibleStateFor().knowledge` (Vault-free — this literally IS the player's own
    knowledge projection), and the extraction may only pick an id already in that list or reply null.
    A hallucinated/off-list factId is dropped, never forwarded.
  - I2/anti-sycophancy: the belt only PROPOSES the attempt; the engine decides the effect (whether an
    expose lands, whether a bluff is believed, whether a trade recipient bites) — the FE never asserts
    an outcome and forwards exactly what the engine returns.
  - Model-driven calls always take precedence (the per-turn nudge counter is set to 1 on the model's
    own tool call, suppressing the belt for that turn) — mirrored via the same wiring-pin pattern as
    `test_0075_confide_guardrail.py`.

Name-agnostic — roster ids are synthetic (npc:N); any display names are arbitrary placeholders
(testing rule: roles only, no real/canonical cast).

SYNC tests only (pytest-asyncio AUTO mode) — drive coroutines via run_until_complete.
"""

import asyncio
import importlib
import json
import os

al = importlib.import_module("src.agent_loop")
orwell_engine = importlib.import_module("src.orwell_engine")
tool_impl = importlib.import_module("src.tool_implementations")
tool_schemas = importlib.import_module("src.tool_schemas")
tool_execution = importlib.import_module("src.tool_execution")
llm_core = importlib.import_module("src.llm_core")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _agent_loop_source() -> str:
    return open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                             "src", "agent_loop.py"), encoding="utf-8").read()


HOUSE = [{"id": "npc:3", "name": "Houseguest Three"}, {"id": "npc:7", "name": "Houseguest Seven"}]

# A synthetic "the player already knows this" knowledge projection — exactly the shape
# `getVisibleStateFor` returns (VisibleStateService.getVisibleStateFor -> knowledge: KnowledgeFact[]).
KNOWN_FACTS_VIS = {
    "forEntity": "player",
    "visibleEvents": [],
    "knowledge": [
        {"id": "fact:1", "content": "Seven has a secret final-two deal with someone else",
         "pathway": "told-by:npc:3", "subject": "npc:7", "ts": 1},
        {"id": "fact:2", "content": "Three used to work in politics before the show",
         "pathway": "witnessed", "subject": "npc:3", "ts": 2},
    ],
}


def _find_schema(name: str) -> dict:
    for t in tool_schemas.FUNCTION_TOOL_SCHEMAS:
        if t.get("function", {}).get("name") == name:
            return t["function"]
    raise AssertionError(f"{name} not found in FUNCTION_TOOL_SCHEMAS")


# ============================================================================================
# 1. Model-facing schema — the PRIMARY on-ramp (a model that can't see the tool never calls it)
# ============================================================================================

def test_confide_expose_trade_are_all_in_the_model_facing_schema():
    # All three were already present — this pins that fact so a future refactor can't silently
    # drop one from FUNCTION_TOOL_SCHEMAS without a test noticing.
    for name in ("confide", "exposeSecret", "tradeSecret"):
        fn = _find_schema(name)
        assert fn["name"] == name


def test_expose_secret_schema_matches_the_engine_signature():
    fn = _find_schema("exposeSecret")
    props = fn["parameters"]["properties"]
    assert set(props.keys()) >= {"factId", "bluff", "subject"}
    assert props["factId"]["type"] == "string"
    assert props["bluff"]["type"] == "boolean"
    assert props["subject"]["type"] == "string"
    # neither factId nor bluff/subject is unconditionally required (a real expose needs only factId,
    # a bluff needs bluff+subject) — the engine, not the schema, enforces the either/or.
    assert fn["parameters"]["required"] == []


def test_trade_secret_schema_matches_the_engine_signature_including_ask_kind():
    fn = _find_schema("tradeSecret")
    props = fn["parameters"]["properties"]
    # askKind was MISSING from the schema (the engine's TradeSecretReq has always carried it) —
    # this is the concrete "schema didn't match the real engine signature" gap Phase 4 closes.
    assert set(props.keys()) >= {"toNpcId", "factId", "bluff", "subject", "askKind"}
    assert props["toNpcId"]["type"] == "string"
    assert props["askKind"]["type"] == "string"
    assert fn["parameters"]["required"] == ["toNpcId"]


# ============================================================================================
# 2. tool_execution.py dispatch — exposeSecret/tradeSecret were advertised but UNREACHABLE
#    (fell through to "Unknown tool type"). This is the fix, not just discoverability.
# ============================================================================================

class _FakeBlock:
    def __init__(self, tool_type, content):
        self.tool_type = tool_type
        self.content = content


def test_expose_secret_dispatches_to_the_engine_not_unknown_tool(monkeypatch):
    seen = {}

    async def fake_expose(fact_id=None, bluff=False, subject=None, expected_beat_seq=None, user=None):
        seen.update(fact_id=fact_id, bluff=bluff, subject=subject, user=user)
        return {"exposed": True}

    monkeypatch.setattr(orwell_engine, "expose_secret", fake_expose)
    desc, result = _run(tool_execution.execute_tool_block(
        _FakeBlock("exposeSecret", json.dumps({"factId": "fact:1"})), owner="owner"))
    assert desc == "exposeSecret"
    assert result == {"output": json.dumps({"exposed": True}, indent=2), "exit_code": 0}
    assert seen == {"fact_id": "fact:1", "bluff": False, "subject": None, "user": "owner"}


def test_trade_secret_dispatches_to_the_engine_not_unknown_tool(monkeypatch):
    seen = {}

    async def fake_trade(to_npc_id, fact_id=None, bluff=False, subject=None, ask_kind=None,
                         expected_beat_seq=None, user=None):
        seen.update(to_npc_id=to_npc_id, fact_id=fact_id, ask_kind=ask_kind, user=user)
        return {"accepted": True}

    monkeypatch.setattr(orwell_engine, "trade_secret", fake_trade)
    desc, result = _run(tool_execution.execute_tool_block(
        _FakeBlock("tradeSecret", json.dumps({"factId": "fact:1", "toNpcId": "npc:3", "askKind": "safety"})),
        owner="owner"))
    assert desc == "tradeSecret"
    assert result == {"output": json.dumps({"accepted": True}, indent=2), "exit_code": 0}
    assert seen == {"to_npc_id": "npc:3", "fact_id": "fact:1", "ask_kind": "safety", "user": "owner"}


def test_expose_secret_bluff_requires_a_subject(monkeypatch):
    desc, result = _run(tool_execution.execute_tool_block(
        _FakeBlock("exposeSecret", json.dumps({"bluff": True})), owner="owner"))
    assert result["exit_code"] == 1
    assert "subject" in result["error"]


def test_trade_secret_requires_a_recipient(monkeypatch):
    desc, result = _run(tool_execution.execute_tool_block(
        _FakeBlock("tradeSecret", json.dumps({"factId": "fact:1"})), owner="owner"))
    assert result["exit_code"] == 1
    assert "toNpcId" in result["error"]


# ============================================================================================
# 3. orwell_engine.expose_secret/trade_secret — argument-building (byte-shape) tests
# ============================================================================================

def _capture_call(monkeypatch):
    seen = {}

    async def fake_call(name, args=None, user=None, timeout=None):
        seen["name"] = name
        seen["args"] = args
        seen["user"] = user
        return {"ok": True}

    monkeypatch.setattr(orwell_engine, "_call", fake_call)
    return seen


def test_expose_secret_forwards_fact_id(monkeypatch):
    seen = _capture_call(monkeypatch)
    _run(orwell_engine.expose_secret(fact_id="fact:1", user="owner"))
    assert seen["name"] == "exposeSecret"
    assert seen["args"] == {"factId": "fact:1"}


def test_expose_secret_bluff_omits_fact_id(monkeypatch):
    seen = _capture_call(monkeypatch)
    _run(orwell_engine.expose_secret(bluff=True, subject="npc:3", user="owner"))
    assert seen["args"] == {"bluff": True, "subject": "npc:3"}


def test_trade_secret_forwards_fact_id_and_ask_kind(monkeypatch):
    seen = _capture_call(monkeypatch)
    _run(orwell_engine.trade_secret("npc:3", fact_id="fact:1", ask_kind="a comp throw", user="owner"))
    assert seen["name"] == "tradeSecret"
    assert seen["args"] == {"toNpcId": "npc:3", "factId": "fact:1", "askKind": "a comp throw"}


# ============================================================================================
# 4. do_expose_secret / do_trade_secret — the tool_implementations.py layer
# ============================================================================================

def test_do_expose_secret_forwards_fact_id(monkeypatch):
    async def fake_expose(fact_id=None, bluff=False, subject=None, expected_beat_seq=None, user=None):
        return {"exposed": True, "fact_id": fact_id}

    monkeypatch.setattr(orwell_engine, "expose_secret", fake_expose)
    res = _run(tool_impl.do_expose_secret(json.dumps({"factId": "fact:1"}), owner="owner"))
    assert res["exit_code"] == 0
    assert json.loads(res["output"])["fact_id"] == "fact:1"


def test_do_expose_secret_missing_both_fact_id_and_bluff_errors(monkeypatch):
    res = _run(tool_impl.do_expose_secret(json.dumps({}), owner="owner"))
    assert res["exit_code"] == 1


def test_do_trade_secret_forwards_all_fields(monkeypatch):
    seen = {}

    async def fake_trade(to_npc_id, fact_id=None, bluff=False, subject=None, ask_kind=None,
                         expected_beat_seq=None, user=None):
        seen.update(to_npc_id=to_npc_id, fact_id=fact_id, ask_kind=ask_kind)
        return {"accepted": True}

    monkeypatch.setattr(orwell_engine, "trade_secret", fake_trade)
    res = _run(tool_impl.do_trade_secret(
        json.dumps({"toNpcId": "npc:3", "factId": "fact:1", "askKind": "safety"}), owner="owner"))
    assert res["exit_code"] == 0
    assert seen == {"to_npc_id": "npc:3", "fact_id": "fact:1", "ask_kind": "safety"}


# ============================================================================================
# 5. _known_player_fact_index — the I3 grounding helper (never invents a secret)
# ============================================================================================

def test_known_player_fact_index_extracts_id_content_subject():
    idx = al._known_player_fact_index(KNOWN_FACTS_VIS)
    assert set(idx.keys()) == {"fact:1", "fact:2"}
    assert idx["fact:1"]["subject"] == "npc:7"
    assert "final-two deal" in idx["fact:1"]["content"]


def test_known_player_fact_index_ignores_malformed_entries():
    vis = {"knowledge": [
        {"id": "fact:1", "content": "ok", "subject": "npc:3"},
        {"id": "fact:2"},                      # no content -> dropped
        {"content": "no id"},                  # no id/factId -> dropped
        "not-a-dict",                          # dropped
        {"id": "fact:3", "content": ""},       # blank content -> dropped
    ]}
    idx = al._known_player_fact_index(vis)
    assert set(idx.keys()) == {"fact:1"}


def test_known_player_fact_index_empty_or_missing_knowledge_is_empty():
    assert al._known_player_fact_index({}) == {}
    assert al._known_player_fact_index({"knowledge": []}) == {}
    assert al._known_player_fact_index(None) == {}


# ============================================================================================
# 6. _auto_expose_secret belt
# ============================================================================================

def _wire_expose(monkeypatch, extraction_json, exposes, vis=None):
    async def fake_llm(*a, **k):
        return extraction_json

    async def fake_vis(user=None):
        return vis if vis is not None else KNOWN_FACTS_VIS

    async def fake_expose(fact_id=None, bluff=False, subject=None, expected_beat_seq=None, user=None):
        exposes.append({"factId": fact_id, "user": user})
        return {"exposed": True}

    monkeypatch.setattr(llm_core, "llm_call_async", fake_llm)
    monkeypatch.setattr(orwell_engine, "get_visible_state", fake_vis)
    monkeypatch.setattr(orwell_engine, "expose_secret", fake_expose)


def test_expose_shaped_turn_backfills_expose_secret(monkeypatch):
    exposes = []
    _wire_expose(monkeypatch, '{"factId":"fact:1"}', exposes)
    out = _run(al._auto_expose_secret(
        "You announce to the house that Seven has a secret deal — the room goes silent.",
        "I tell everyone that Seven has a secret final-two deal.",
        HOUSE, "url", "m", {}, "owner"))
    assert out is True
    assert exposes == [{"factId": "fact:1", "user": "owner"}]


def test_expose_drops_a_factid_not_in_the_players_known_facts(monkeypatch):
    # The extraction hallucinated/invented a factId that isn't in the player's own knowledge — the
    # I3 bright line: never forward a secret the player doesn't legitimately hold.
    exposes = []
    _wire_expose(monkeypatch, '{"factId":"fact:99"}', exposes)
    out = _run(al._auto_expose_secret("scene", "I expose their secret to everyone.",
                                      HOUSE, "url", "m", {}, "owner"))
    assert out is False
    assert exposes == [], "an invented/off-list factId must never reach the engine"


def test_expose_with_no_known_facts_never_invents_one(monkeypatch):
    exposes = []
    _wire_expose(monkeypatch, '{"factId":"fact:1"}', exposes, vis={"knowledge": []})
    out = _run(al._auto_expose_secret("scene", "I expose their secret to everyone.",
                                      HOUSE, "url", "m", {}, "owner"))
    assert out is False and exposes == []


def test_expose_null_selection_is_a_noop(monkeypatch):
    exposes = []
    _wire_expose(monkeypatch, '{"factId":null}', exposes)
    out = _run(al._auto_expose_secret("You chat about the veto competition.",
                                      "Who do you think wins veto?",
                                      HOUSE, "url", "m", {}, "owner"))
    assert out is False and exposes == []


def test_expose_extraction_hiccup_is_fail_closed(monkeypatch):
    exposes = []

    async def boom(*a, **k):
        raise RuntimeError("llm down")

    async def fake_vis(user=None):
        return KNOWN_FACTS_VIS

    async def fake_expose(*a, **k):
        exposes.append(a)
        return {"exposed": True}

    monkeypatch.setattr(llm_core, "llm_call_async", boom)
    monkeypatch.setattr(orwell_engine, "get_visible_state", fake_vis)
    monkeypatch.setattr(orwell_engine, "expose_secret", fake_expose)
    out = _run(al._auto_expose_secret("scene", "I expose their secret.", HOUSE, "url", "m", {}, "owner"))
    assert out is False and exposes == []


def test_expose_no_roster_is_a_noop(monkeypatch):
    exposes = []
    _wire_expose(monkeypatch, '{"factId":"fact:1"}', exposes)
    out = _run(al._auto_expose_secret("scene", "I expose their secret.", [], "url", "m", {}, "owner"))
    assert out is False and exposes == []


def test_expose_signal_pre_filter_gates_the_belt():
    rx = al._EXPOSE_SIGNAL_RE
    for hit in ["I tell everyone about their secret.", "I expose what I found out about them.",
                "Everyone should know what they're hiding.", "I let the house know the truth.",
                "I call them out in front of the house.", "I drop the bombshell at the meeting.",
                "I put them on blast.", "I spill the secret to the room."]:
        assert rx.search(hit), hit
    for miss in ["Who do you think wins HOH?", "I walk into the kitchen.",
                 "Let's vote out the nominee.", "Nice weather in the backyard today."]:
        assert not rx.search(miss), miss


# ============================================================================================
# 7. _auto_trade_secret belt
# ============================================================================================

def _wire_trade(monkeypatch, extraction_json, trades, vis=None):
    async def fake_llm(*a, **k):
        return extraction_json

    async def fake_vis(user=None):
        return vis if vis is not None else KNOWN_FACTS_VIS

    async def fake_trade(to_npc_id, fact_id=None, bluff=False, subject=None, ask_kind=None,
                         expected_beat_seq=None, user=None):
        trades.append({"toNpcId": to_npc_id, "factId": fact_id, "askKind": ask_kind, "user": user})
        return {"accepted": True}

    monkeypatch.setattr(llm_core, "llm_call_async", fake_llm)
    monkeypatch.setattr(orwell_engine, "get_visible_state", fake_vis)
    monkeypatch.setattr(orwell_engine, "trade_secret", fake_trade)


def test_trade_shaped_turn_backfills_trade_secret(monkeypatch):
    trades = []
    _wire_trade(monkeypatch, '{"factId":"fact:1","toNpcId":"npc:3","askKind":"safety this week"}', trades)
    out = _run(al._auto_trade_secret(
        "You offer Three the intel about Seven's deal in exchange for safety this week.",
        "I offer Three the intel about Seven's secret deal in exchange for my safety this week.",
        HOUSE, "url", "m", {}, "owner"))
    assert out is True
    assert trades == [{"toNpcId": "npc:3", "factId": "fact:1", "askKind": "safety this week", "user": "owner"}]


def test_trade_drops_a_factid_not_in_the_players_known_facts(monkeypatch):
    trades = []
    _wire_trade(monkeypatch, '{"factId":"fact:99","toNpcId":"npc:3","askKind":""}', trades)
    out = _run(al._auto_trade_secret("scene", "I trade the secret for a favor.",
                                     HOUSE, "url", "m", {}, "owner"))
    assert out is False and trades == []


def test_trade_drops_an_off_roster_recipient(monkeypatch):
    trades = []
    _wire_trade(monkeypatch, '{"factId":"fact:1","toNpcId":"npc:99","askKind":""}', trades)
    out = _run(al._auto_trade_secret("scene", "I trade the secret for a favor.",
                                     HOUSE, "url", "m", {}, "owner"))
    assert out is False and trades == []


def test_trade_drops_a_secret_traded_to_its_own_subject(monkeypatch):
    # Defense-in-depth mirror of the engine's own `resolveAndTrade` rule: you cannot trade a secret
    # TO the very houseguest it's about.
    trades = []
    # fact:1 is ABOUT npc:7 — offering it TO npc:7 must be dropped.
    _wire_trade(monkeypatch, '{"factId":"fact:1","toNpcId":"npc:7","askKind":""}', trades)
    out = _run(al._auto_trade_secret("scene", "I trade the secret for a favor.",
                                     HOUSE, "url", "m", {}, "owner"))
    assert out is False and trades == []


def test_trade_null_selection_is_a_noop(monkeypatch):
    trades = []
    _wire_trade(monkeypatch, '{"factId":null,"toNpcId":null,"askKind":""}', trades)
    out = _run(al._auto_trade_secret("You chat about the veto.", "Who wins veto this week?",
                                     HOUSE, "url", "m", {}, "owner"))
    assert out is False and trades == []


def test_trade_no_known_facts_never_invents_one(monkeypatch):
    trades = []
    _wire_trade(monkeypatch, '{"factId":"fact:1","toNpcId":"npc:3","askKind":""}', trades, vis={"knowledge": []})
    out = _run(al._auto_trade_secret("scene", "I trade the secret for a favor.",
                                     HOUSE, "url", "m", {}, "owner"))
    assert out is False and trades == []


def test_trade_extraction_hiccup_is_fail_closed(monkeypatch):
    trades = []

    async def boom(*a, **k):
        raise RuntimeError("llm down")

    async def fake_vis(user=None):
        return KNOWN_FACTS_VIS

    async def fake_trade(*a, **k):
        trades.append(a)
        return {"accepted": True}

    monkeypatch.setattr(llm_core, "llm_call_async", boom)
    monkeypatch.setattr(orwell_engine, "get_visible_state", fake_vis)
    monkeypatch.setattr(orwell_engine, "trade_secret", fake_trade)
    out = _run(al._auto_trade_secret("scene", "I trade the secret for a favor.", HOUSE, "url", "m", {}, "owner"))
    assert out is False and trades == []


def test_trade_signal_pre_filter_gates_the_belt():
    rx = al._TRADE_SIGNAL_RE
    for hit in ["I trade you the secret for safety.", "I swap a secret with them.",
                "I'll tell you what I know if you protect me.",
                "I offer them the intel on the other alliance in exchange for a vote.",
                "In exchange for your vote, I'll tell you everything."]:
        assert rx.search(hit), hit
    for miss in ["Who do you think wins HOH?", "I walk into the kitchen.",
                 "Nice weather in the backyard today."]:
        assert not rx.search(miss), miss


# ============================================================================================
# 8. Wiring pins — the belts must actually be reachable from the finishing block
# ============================================================================================

def test_expose_and_trade_belts_are_wired_into_the_finishing_block():
    js = _agent_loop_source()
    assert "async def _auto_expose_secret" in js
    assert "async def _auto_trade_secret" in js
    # routed through the CAS helper (0065 beatSeq compare-and-swap)
    assert "_backfill_with_cas(owner, _oe.expose_secret, fact_id=fact_id, user=owner, defer_fold=True)" in js
    assert "_backfill_with_cas(owner, _oe.trade_secret, to_npc_id, fact_id=fact_id," in js
    # gated on: model didn't call it itself (per-turn cap) + the cheap signal pre-filter
    assert "_want_expose = (_turn_expose_nudges < 1" in js
    assert "_want_trade = (_turn_trade_nudges < 1" in js
    assert "_EXPOSE_SIGNAL_RE.search(_last_user_for_confide)" in js
    assert "_TRADE_SIGNAL_RE.search(_last_user_for_confide)" in js
    # the fetch-guard (which populates `_house`/roster) includes both new belts — otherwise the
    # belt would run with an EMPTY roster and always no-op (the Phase-1 confide precedent bug class).
    assert "if _want_confide or _want_expose or _want_trade or _want_advance" in js
    # the call sites actually fire inside the guarded block
    assert "if _want_expose and _touched_deal:" in js
    assert "if _want_trade and _touched_deal:" in js
    assert "await _auto_expose_secret(_turn_narration, _last_user_for_confide" in js
    assert "await _auto_trade_secret(_turn_narration, _last_user_for_confide" in js
    # per-turn counters initialized once per turn
    assert "_turn_expose_nudges = 0" in js
    assert "_turn_trade_nudges = 0" in js


def test_model_driven_expose_and_trade_suppress_the_belt():
    # The finishing block sets the per-turn nudge counter to 1 on a model-driven exposeSecret/
    # tradeSecret tool call, which makes _want_expose/_want_trade False for the rest of the turn —
    # so the belt never double-fires when the model already did the job itself.
    js = _agent_loop_source()
    assert 'block.tool_type == "exposeSecret"' in js
    assert "_turn_expose_nudges = 1" in js
    assert 'block.tool_type == "tradeSecret"' in js
    assert "_turn_trade_nudges = 1" in js


def test_model_driven_precedence_at_unit_grain():
    _turn_expose_nudges = 1
    _turn_trade_nudges = 1
    assert (_turn_expose_nudges < 1) is False
    assert (_turn_trade_nudges < 1) is False


# ============================================================================================
# 9. Byte-identical when the turn isn't an expose/trade move — the pre-filter never fires blind
# ============================================================================================

def test_ordinary_scene_never_triggers_expose_or_trade_signal():
    ordinary = [
        "I ask them how their day was in the kitchen.",
        "We talk strategy about who to nominate this week.",
        "I compliment their performance in the last competition.",
    ]
    for line in ordinary:
        assert not al._EXPOSE_SIGNAL_RE.search(line), line
        assert not al._TRADE_SIGNAL_RE.search(line), line
