"""ADR 0005 — split authority by openness: the generative-consequence path, FE side.

`recordInteraction` now accepts an OPTIONAL, Vault-free `consequence` descriptor: the model PROPOSES
which houseguests' feelings move, in which direction, with what RELATIVE emphasis (the open-set
reading of an uncoded scene), while the engine still owns the MAGNITUDE (anti-sycophancy, mandate #3).
`kind` stays the floor/default; with no descriptor, behavior is byte-identical to today.

These tests cover all four FE seams (roles only — no names asserted as data):
  - the model-facing `tool_schemas.py` schema exposes the descriptor (8 directions / 3 emphases, optional);
  - `orwell_engine.record_interaction` forwards a descriptor and omits it when None (byte-identical req);
  - `do_record_interaction` passes it through and ignores a non-dict descriptor;
  - `_auto_record_scene` (0055 back-fill) requests, validates, and forwards a descriptor, and falls
    back to the kind-only call when none is proposed / nothing valid remains (no 0055 regression).
"""

import asyncio
import importlib

al = importlib.import_module("src.agent_loop")
orwell_engine = importlib.import_module("src.orwell_engine")
tool_impl = importlib.import_module("src.tool_implementations")
tool_schemas = importlib.import_module("src.tool_schemas")
llm_core = importlib.import_module("src.llm_core")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# The canonical closed sets per the shipped engine contract / ADR 0005.
_DIRECTIONS = {"warmer", "cooler", "more-trust", "less-trust",
               "more-threatened", "less-threatened", "more-aligned", "less-aligned"}
_EMPHASES = {"slight", "notable", "strong"}

HOUSE = [{"id": "npc:3", "name": "Houseguest A"}, {"id": "npc:7", "name": "Houseguest B"}]


def _record_tool_schema():
    for t in tool_schemas.FUNCTION_TOOL_SCHEMAS:
        if t.get("function", {}).get("name") == "recordInteraction":
            return t["function"]
    raise AssertionError("recordInteraction not found in FUNCTION_TOOL_SCHEMAS")


# --- 1. the model-facing schema exposes the descriptor --------------------------------------------

def test_schema_exposes_consequence_with_the_8_directions_and_3_emphases():
    fn = _record_tool_schema()
    props = fn["parameters"]["properties"]
    assert "consequence" in props, "recordInteraction must expose the consequence descriptor"
    edges = props["consequence"]["properties"]["edges"]
    edge_props = edges["items"]["properties"]
    # the 8-value direction enum
    assert set(edge_props["direction"]["enum"]) == _DIRECTIONS
    # the 3-value emphasis enum
    assert set(edge_props["emphasis"]["enum"]) == _EMPHASES
    # toward is a string id; rationale is a string; per-edge requires toward+direction, emphasis optional
    assert edge_props["toward"]["type"] == "string"
    assert props["consequence"]["properties"]["rationale"]["type"] == "string"
    assert set(edges["items"]["required"]) == {"toward", "direction"}


def test_schema_consequence_is_not_required():
    fn = _record_tool_schema()
    # the descriptor (and kind) stay optional — only content is required (byte-identical floor).
    assert fn["parameters"]["required"] == ["content"]
    assert "consequence" not in fn["parameters"]["required"]


def test_schema_description_steers_kind_vs_consequence():
    desc = _record_tool_schema()["description"].lower()
    assert "kind" in desc and "consequence" in desc
    # the engine still owns the amount — the description must say so (anti-sycophancy)
    assert "magnitude" in desc


# --- 1b. Phase 1 (player-offense) — the THIRD-PARTY `aboutEdges` sibling ---------------------------

def test_schema_exposes_about_edges_with_holder_about_direction_emphasis():
    fn = _record_tool_schema()
    props = fn["parameters"]["properties"]["consequence"]["properties"]
    assert "aboutEdges" in props, "recordInteraction must expose the third-party aboutEdges shape"
    about = props["aboutEdges"]["items"]["properties"]
    assert about["holder"]["type"] == "string"
    assert about["about"]["type"] == "string"
    assert set(about["direction"]["enum"]) == _DIRECTIONS
    assert set(about["emphasis"]["enum"]) == _EMPHASES
    assert set(props["aboutEdges"]["items"]["required"]) == {"holder", "about", "direction"}


def test_schema_about_edges_is_not_required():
    fn = _record_tool_schema()
    # aboutEdges (like edges/kind) stays optional — only content is required (byte-identical floor).
    assert fn["parameters"]["required"] == ["content"]
    cons = fn["parameters"]["properties"]["consequence"]
    assert cons.get("required") in (None, [])


# --- 2. record_interaction forwards / omits the descriptor in the engine request ------------------

def _capture_req(monkeypatch):
    """Monkeypatch the engine I/O tap (_call) and capture the exact request dict forwarded."""
    seen = {}

    async def fake_call(name, args=None, user=None, timeout=None):
        seen["name"] = name
        seen["args"] = args
        seen["user"] = user
        return {"ok": True}

    monkeypatch.setattr(orwell_engine, "_call", fake_call)
    return seen


def test_record_interaction_forwards_consequence_into_req(monkeypatch):
    seen = _capture_req(monkeypatch)
    cq = {"edges": [{"toward": "npc:3", "direction": "warmer", "emphasis": "slight"},
                    {"toward": "npc:7", "direction": "more-threatened"}],
          "rationale": "warmed one, rattled another"}
    _run(orwell_engine.record_interaction("a scene", with_ids=["npc:3", "npc:7"], kind="strategy",
                                          consequence=cq, user="owner"))
    assert seen["name"] == "recordInteraction"
    assert seen["args"]["consequence"] == cq
    assert seen["args"]["kind"] == "strategy"
    assert "player" in seen["args"]["witnessSet"]


def test_record_interaction_omits_consequence_when_none_is_byte_identical(monkeypatch):
    seen_with = _capture_req(monkeypatch)
    _run(orwell_engine.record_interaction("a scene", with_ids=["npc:3"], kind="bonding", user="owner"))
    req_default = dict(seen_with["args"])

    seen_explicit = _capture_req(monkeypatch)
    _run(orwell_engine.record_interaction("a scene", with_ids=["npc:3"], kind="bonding",
                                          consequence=None, user="owner"))
    # passing consequence=None must produce the EXACT same request as not passing it at all.
    assert seen_explicit["args"] == req_default
    assert "consequence" not in req_default, "no descriptor → no consequence key (kind-only path)"


# --- 3. do_record_interaction passes it through, ignores a non-dict -------------------------------

def _capture_record_interaction(monkeypatch):
    seen = {}

    async def fake_ri(content, with_ids=None, kind=None, consequence=None, felt_minutes=None, user=None):
        seen.update(content=content, with_ids=with_ids, kind=kind, consequence=consequence, felt_minutes=felt_minutes, user=user)
        return {"ok": True}

    monkeypatch.setattr(orwell_engine, "record_interaction", fake_ri)
    return seen


def test_do_record_interaction_passes_consequence_through(monkeypatch):
    seen = _capture_record_interaction(monkeypatch)
    cq = {"edges": [{"toward": "npc:3", "direction": "cooler"}], "rationale": "soured"}
    import json
    res = _run(tool_impl.do_record_interaction(
        json.dumps({"content": "a scene", "withIds": ["npc:3"], "kind": "conflict", "consequence": cq}),
        owner="owner"))
    assert res["exit_code"] == 0
    assert seen["consequence"] == cq
    assert seen["kind"] == "conflict"


def test_do_record_interaction_ignores_a_non_dict_consequence(monkeypatch):
    seen = _capture_record_interaction(monkeypatch)
    import json
    for junk in ("not-a-dict", ["edges"], 42):
        seen.clear()
        res = _run(tool_impl.do_record_interaction(
            json.dumps({"content": "a scene", "withIds": ["npc:3"], "consequence": junk}),
            owner="owner"))
        assert res["exit_code"] == 0
        assert seen["consequence"] is None, f"a non-dict consequence ({junk!r}) must be dropped"


def test_do_record_interaction_with_no_consequence_forwards_none(monkeypatch):
    seen = _capture_record_interaction(monkeypatch)
    import json
    _run(tool_impl.do_record_interaction(
        json.dumps({"content": "a scene", "withIds": ["npc:3"], "kind": "gossip"}), owner="owner"))
    assert seen["consequence"] is None


def test_do_record_interaction_forwards_felt_minutes(monkeypatch):
    # Phase 2 (duration-based clock): a positive feltMinutes forwards; a missing / non-positive one is None.
    seen = _capture_record_interaction(monkeypatch)
    import json
    _run(tool_impl.do_record_interaction(
        json.dumps({"content": "a long summit", "withIds": ["npc:3"], "kind": "strategy", "feltMinutes": 120}),
        owner="owner"))
    assert seen["felt_minutes"] == 120
    for junk in (0, -5, "soon", None):
        seen.clear()
        _run(tool_impl.do_record_interaction(
            json.dumps({"content": "a scene", "withIds": ["npc:3"], "feltMinutes": junk}), owner="owner"))
        assert seen["felt_minutes"] is None, f"a non-positive feltMinutes ({junk!r}) must be dropped"


# --- 4a. the _validate_consequence helper (the targeting/direction/emphasis gate) -----------------

def test_validate_consequence_drops_bad_toward_and_direction():
    roster = {"npc:3", "npc:7"}
    raw = {"edges": [
        {"toward": "npc:3", "direction": "warmer", "emphasis": "strong"},   # valid, keeps emphasis
        {"toward": "npc:99", "direction": "cooler"},                         # off-roster → drop
        {"toward": "npc:7", "direction": "not-a-direction"},                 # bad direction → drop
        {"toward": "npc:7", "direction": "more-trust", "emphasis": "loud"},  # valid, drops bad emphasis
    ], "rationale": "mixed scene"}
    out = al._validate_consequence(raw, roster)
    assert out is not None
    towards = {(e["toward"], e["direction"]) for e in out["edges"]}
    assert towards == {("npc:3", "warmer"), ("npc:7", "more-trust")}
    by_toward = {e["toward"]: e for e in out["edges"]}
    assert by_toward["npc:3"].get("emphasis") == "strong"      # valid emphasis carried
    assert "emphasis" not in by_toward["npc:7"]                # invalid emphasis dropped, edge kept
    assert out["rationale"] == "mixed scene"


def test_validate_consequence_returns_none_when_nothing_valid_remains():
    roster = {"npc:3"}
    assert al._validate_consequence(None, roster) is None
    assert al._validate_consequence("x", roster) is None
    assert al._validate_consequence({}, roster) is None
    assert al._validate_consequence({"edges": [{"toward": "npc:99", "direction": "warmer"}]}, roster) is None
    assert al._validate_consequence({"edges": [{"toward": "npc:3", "direction": "nope"}]}, roster) is None


# --- 4c. _validate_consequence — the THIRD-PARTY aboutEdges gate (Phase 1, player-offense) ---------

def test_validate_consequence_keeps_a_valid_third_party_pitch():
    roster = {"npc:3", "npc:7"}
    raw = {"aboutEdges": [{"holder": "npc:3", "about": "npc:7", "direction": "more-threatened", "emphasis": "strong"}]}
    out = al._validate_consequence(raw, roster)
    assert out is not None
    assert out["aboutEdges"] == [{"holder": "npc:3", "about": "npc:7", "direction": "more-threatened", "emphasis": "strong"}]
    assert "edges" not in out  # none proposed — only the third-party key is present


def test_validate_consequence_drops_self_pitch_and_off_roster_holder_or_about():
    roster = {"npc:3", "npc:7"}
    raw = {"aboutEdges": [
        {"holder": "npc:3", "about": "npc:3", "direction": "warmer"},        # holder == about → drop
        {"holder": "npc:99", "about": "npc:7", "direction": "warmer"},       # off-roster holder → drop
        {"holder": "npc:3", "about": "npc:99", "direction": "warmer"},       # off-roster about → drop
        {"holder": "npc:3", "about": "npc:7", "direction": "not-a-direction"},  # bad direction → drop
        {"holder": "npc:7", "about": "npc:3", "direction": "less-trust"},    # the one valid entry
    ]}
    out = al._validate_consequence(raw, roster)
    assert out is not None
    assert out["aboutEdges"] == [{"holder": "npc:7", "about": "npc:3", "direction": "less-trust"}]


def test_validate_consequence_drops_bad_emphasis_but_keeps_the_about_edge():
    roster = {"npc:3", "npc:7"}
    raw = {"aboutEdges": [{"holder": "npc:3", "about": "npc:7", "direction": "warmer", "emphasis": "deafening"}]}
    out = al._validate_consequence(raw, roster)
    assert out is not None
    edge = out["aboutEdges"][0]
    assert edge["holder"] == "npc:3" and edge["about"] == "npc:7"
    assert "emphasis" not in edge


def test_validate_consequence_combines_edges_and_about_edges():
    roster = {"npc:3", "npc:7"}
    raw = {"edges": [{"toward": "npc:3", "direction": "warmer"}],
           "aboutEdges": [{"holder": "npc:3", "about": "npc:7", "direction": "more-threatened"}],
           "rationale": "a pitch while also warming to the holder"}
    out = al._validate_consequence(raw, roster)
    assert out["edges"] == [{"toward": "npc:3", "direction": "warmer"}]
    assert out["aboutEdges"] == [{"holder": "npc:3", "about": "npc:7", "direction": "more-threatened"}]
    assert out["rationale"] == "a pitch while also warming to the holder"


def test_validate_consequence_all_about_edges_invalid_falls_back_to_none():
    roster = {"npc:3"}
    raw = {"aboutEdges": [{"holder": "npc:3", "about": "npc:3", "direction": "warmer"}]}
    assert al._validate_consequence(raw, roster) is None


# --- 4b. _auto_record_scene requests, validates, forwards — and falls back kind-only --------------

def _wire_scene(monkeypatch, extraction_json, recorded):
    async def fake_llm(*a, **k):
        return extraction_json

    async def fake_record(content, with_ids=None, kind=None, consequence=None,
                          expected_beat_seq=None, idempotency_key=None, user=None):
        recorded.append({"content": content, "with_ids": with_ids, "kind": kind,
                         "consequence": consequence, "user": user})
        return {"ok": True}

    monkeypatch.setattr(llm_core, "llm_call_async", fake_llm)
    monkeypatch.setattr(orwell_engine, "record_interaction", fake_record)


def test_auto_record_scene_validates_and_forwards_a_descriptor(monkeypatch):
    recorded = []
    extraction = (
        '{"withIds":["npc:3","npc:7"],"kind":"strategy",'
        '"content":"The player split the room.",'
        '"consequence":{"edges":['
        '{"toward":"npc:3","direction":"warmer","emphasis":"notable"},'
        '{"toward":"npc:99","direction":"cooler"},'            # off-roster → dropped
        '{"toward":"npc:7","direction":"bogus"},'              # bad direction → dropped
        '{"toward":"npc:7","direction":"more-threatened"}],'
        '"rationale":"warmed one, threatened the other"}}'
    )
    _wire_scene(monkeypatch, extraction, recorded)
    out = _run(al._auto_record_scene("the player worked both sides", "talk", HOUSE, "url", "m", {}, "owner"))
    assert out is True
    assert len(recorded) == 1
    cq = recorded[0]["consequence"]
    assert cq is not None
    pairs = {(e["toward"], e["direction"]) for e in cq["edges"]}
    assert pairs == {("npc:3", "warmer"), ("npc:7", "more-threatened")}, "bad/off-roster edges dropped"
    assert recorded[0]["kind"] == "strategy"
    assert recorded[0]["with_ids"] == ["npc:3", "npc:7"]


def test_auto_record_scene_proposes_an_about_edges_third_party_pitch(monkeypatch):
    """Phase 1 (player-offense): a scene reading as 'player pitches holder about a third party'
    proposes aboutEdges — the extraction's `_validate_consequence` call already validates it, so this
    just proves the FULL round trip (extraction JSON → validation → the forwarded engine call)."""
    recorded = []
    extraction = (
        '{"withIds":["npc:3"],"kind":"strategy",'
        '"content":"The player told npc:3 that npc:7 is the real threat.",'
        '"consequence":{"aboutEdges":['
        '{"holder":"npc:3","about":"npc:7","direction":"more-threatened","emphasis":"notable"},'
        '{"holder":"npc:3","about":"npc:3","direction":"warmer"},'     # self-pitch → dropped
        '{"holder":"npc:99","about":"npc:7","direction":"warmer"}],'   # off-roster holder → dropped
        '"rationale":"floated npc:7 as the bigger threat"}}'
    )
    _wire_scene(monkeypatch, extraction, recorded)
    out = _run(al._auto_record_scene("I told npc:3 that npc:7 is the real threat", "talk", HOUSE, "url", "m", {}, "owner"))
    assert out is True
    assert len(recorded) == 1
    cq = recorded[0]["consequence"]
    assert cq is not None
    assert cq["aboutEdges"] == [{"holder": "npc:3", "about": "npc:7", "direction": "more-threatened", "emphasis": "notable"}]
    assert "edges" not in cq  # none proposed in this scene
    assert recorded[0]["kind"] == "strategy"


def test_auto_record_scene_falls_back_when_only_about_edges_are_all_invalid(monkeypatch):
    recorded = []
    # the only aboutEdges entry is a self-pitch → dropped → nothing valid remains → consequence=None.
    _wire_scene(monkeypatch,
                '{"withIds":["npc:3"],"kind":"gossip","content":"x",'
                '"consequence":{"aboutEdges":[{"holder":"npc:3","about":"npc:3","direction":"warmer"}]}}',
                recorded)
    out = _run(al._auto_record_scene("x", "talk", HOUSE, "url", "m", {}, "owner"))
    assert out is True
    assert recorded[0]["consequence"] is None, "no valid aboutEdges entry → kind-only path preserved"
    assert recorded[0]["kind"] == "gossip"


def test_auto_record_scene_falls_back_to_kind_only_when_no_descriptor(monkeypatch):
    recorded = []
    _wire_scene(monkeypatch,
                '{"withIds":["npc:3"],"kind":"bonding","content":"a quiet bond"}', recorded)
    out = _run(al._auto_record_scene("a quiet bond", "talk", HOUSE, "url", "m", {}, "owner"))
    assert out is True
    # NO descriptor proposed → forward consequence=None → exactly today's kind-only behavior.
    assert recorded[0]["consequence"] is None
    assert recorded[0]["kind"] == "bonding"


def test_auto_record_scene_falls_back_when_descriptor_all_invalid(monkeypatch):
    recorded = []
    # every edge is off-roster or bad-direction → validated descriptor is None → kind-only.
    _wire_scene(monkeypatch,
                '{"withIds":["npc:3"],"kind":"gossip","content":"x",'
                '"consequence":{"edges":[{"toward":"npc:99","direction":"warmer"},'
                '{"toward":"npc:3","direction":"sideways"}]}}', recorded)
    out = _run(al._auto_record_scene("x", "talk", HOUSE, "url", "m", {}, "owner"))
    assert out is True
    assert recorded[0]["consequence"] is None, "no valid edge → no descriptor, kind-only preserved"
    assert recorded[0]["kind"] == "gossip"


def test_auto_record_scene_solo_beat_records_nothing(monkeypatch):
    recorded = []
    _wire_scene(monkeypatch, '{"withIds":[]}', recorded)
    out = _run(al._auto_record_scene("the player paced alone", "think", HOUSE, "url", "m", {}, "owner"))
    assert out is False and recorded == [], "a solo/internal beat folds nothing (0055 unchanged)"


def test_auto_record_scene_extraction_hiccup_is_fail_closed(monkeypatch):
    recorded = []

    async def boom(*a, **k):
        raise RuntimeError("llm down")

    async def fake_record(*a, **k):
        recorded.append(a)
        return {}

    monkeypatch.setattr(llm_core, "llm_call_async", boom)
    monkeypatch.setattr(orwell_engine, "record_interaction", fake_record)
    out = _run(al._auto_record_scene("x", "talk", HOUSE, "url", "m", {}, "owner"))
    assert out is False and recorded == []


def test_auto_record_scene_never_lets_the_model_propose_a_number():
    """The extraction prompt asks for direction/emphasis only — magnitude stays engine-owned."""
    import os
    js = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                           "src", "agent_loop.py"), encoding="utf-8").read()
    # the closed sets are pinned, and the descriptor is validated before forwarding
    assert al._CONSEQUENCE_DIRECTIONS == _DIRECTIONS
    assert al._CONSEQUENCE_EMPHASES == _EMPHASES
    assert "_validate_consequence(obj.get(\"consequence\")" in js
    # the prompt explicitly forbids a number/magnitude in the proposal
    assert "NEVER any" in js and "magnitude" in js.lower()
