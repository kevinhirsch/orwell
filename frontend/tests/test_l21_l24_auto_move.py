"""L21/L24 auto-move belt: a room the player walks to but the model never moveTo's is persisted by the FE.

Whereabouts cohesion — "the single biggest immersion-killer" (ledger L24). The engine grounding shipped
(whereabouts() in the per-turn context; the player is PINNED and only an explicit `moveTo` relocates them).
But the model reliably UNDER-calls `moveTo`: the player says "I head to the kitchen", the narrator voices
the kitchen, but never moves the engine — so next turn whereabouts still reports the OLD room and the
picture snaps back. The FE now back-fills the move via a constrained extraction: only a room the player
clearly walked to is relayed (room:null → nothing happens), so the engine's persisted occupancy agrees
with the narration the player already saw. Vault-free (whereabouts is a Vault-free projection).

SYNC tests only (pytest-asyncio AUTO mode) — drive coroutines via run_until_complete, never asyncio.run().
"""

import asyncio
import importlib

al = importlib.import_module("src.agent_loop")
orwell_engine = importlib.import_module("src.orwell_engine")
llm_core = importlib.import_module("src.llm_core")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _wire(monkeypatch, extraction_json, moves):
    async def fake_llm(*a, **k):
        return extraction_json

    async def fake_move_to(room, expected_beat_seq=None, user=None):
        moves.append({"room": room, "user": user})
        return {"whereabouts": {"room": room, "present": [], "nearby": []}}

    monkeypatch.setattr(llm_core, "llm_call_async", fake_llm)
    monkeypatch.setattr(orwell_engine, "move_to", fake_move_to)


def test_player_walk_is_backfilled(monkeypatch):
    moves = []
    _wire(monkeypatch, '{"room":"kitchen"}', moves)
    out = _run(al._auto_move_player("You drift into the kitchen, where the coffee is brewing.",
                                    "I head to the kitchen", "url", "m", {}, "owner"))
    assert out is True
    assert len(moves) == 1
    assert moves[0]["room"] == "kitchen" and moves[0]["user"] == "owner"


def test_no_move_creates_no_phantom_move(monkeypatch):
    moves = []
    _wire(monkeypatch, '{"room":null}', moves)
    out = _run(al._auto_move_player("You stay on the couch, half-listening.",
                                    "I just sit and watch", "url", "m", {}, "owner"))
    assert out is False
    assert moves == [], "a turn where the player did not move must never relocate them"


def test_unknown_room_is_rejected(monkeypatch):
    moves = []
    _wire(monkeypatch, '{"room":"rooftop-helipad"}', moves)
    out = _run(al._auto_move_player("You climb somewhere off the map.", "x", "url", "m", {}, "owner"))
    assert out is False
    assert moves == [], "only a real house room is ever relayed to the engine"


def test_every_house_room_is_accepted(monkeypatch):
    # The extraction may name any canonical room; each must be relayed verbatim.
    for room in al._HOUSE_ROOMS:
        moves = []
        _wire(monkeypatch, '{"room":"' + room + '"}', moves)
        out = _run(al._auto_move_player("scene", "move", "url", "m", {}, "owner"))
        assert out is True and moves and moves[0]["room"] == room


def test_extraction_after_a_reasoning_block_is_parsed(monkeypatch):
    # Reasoning models emit the answer LAST — the last {"room":...} object wins.
    moves = []
    _wire(monkeypatch,
          'Let me think... the player said "out back" which maps to the yard.\n{"room":"backyard"}',
          moves)
    out = _run(al._auto_move_player("You step out into the night air of the backyard.",
                                    "let's go out back", "url", "m", {}, "owner"))
    assert out is True and moves[0]["room"] == "backyard"


def test_extraction_hiccup_is_fail_closed(monkeypatch):
    moves = []

    async def boom(*a, **k):
        raise RuntimeError("llm down")

    async def fake_move_to(*a, **k):
        moves.append(a)
        return {}

    monkeypatch.setattr(llm_core, "llm_call_async", boom)
    monkeypatch.setattr(orwell_engine, "move_to", fake_move_to)
    out = _run(al._auto_move_player("scene", "I head to the kitchen", "url", "m", {}, "owner"))
    assert out is False and moves == []


def test_unparseable_json_is_a_noop(monkeypatch):
    moves = []
    _wire(monkeypatch, "no json here at all", moves)
    out = _run(al._auto_move_player("scene", "I head to the kitchen", "url", "m", {}, "owner"))
    assert out is False and moves == []


def test_move_signal_regex_targets_movement_language():
    rx = al._MOVE_SIGNAL_RE
    for hit in ["I head to the kitchen", "let's go out back", "I wander into the living room",
                "walk over to the bedroom", "I step into the bathroom", "going to the storage room",
                "I'll head up to the HOH room", "I drift toward the backyard", "I slip into bedroom-a",
                "I stroll to the lounge", "moving to the kitchen"]:
        assert rx.search(hit), hit
    # #536 / ISSUE-8: STATIC in-room presence language (no movement verb) must ALSO trip the belt — a
    # houseguest described sitting/leaning/lounging in a room is invented static presence the NPC-move
    # extraction needs to reconcile against the engine.
    for hit in ["she sits at the kitchen counter", "he leans against the backyard fence",
                "they lounge in the living room", "perched on the bathroom counter",
                "standing in the storage room", "sprawled across the bedroom floor",
                "lingering by the HOH room door"]:
        assert rx.search(hit), hit
    for miss in ["I tell her she looks tired", "what time is it in-game?",
                 "I think Cynthia is lying to me", "who is HOH right now?"]:
        assert not rx.search(miss), miss


def test_auto_move_is_wired_into_the_finishing_block():
    import os
    js = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                           "src", "agent_loop.py"), encoding="utf-8").read()
    assert "async def _auto_move_player" in js
    # 0065: routed through the CAS helper so the back-fill carries the compare-and-swap beatSeq token.
    assert "_backfill_with_cas(owner, _oe.move_to, room, user=owner)" in js
    # gated on: model didn't moveTo + the per-turn cap + the cheap movement pre-filter over the
    # player's OWN last message (deliberately NOT gated on _progressed/_is_lull).
    assert "_moved = bool(_tool_names & _MOVE_TOOLS)" in js
    assert "_want_move = ((not _moved)" in js
    assert "_MOVE_SIGNAL_RE.search(_last_user_for_move)" in js
    # fetch-guard includes the move belt, and the call site fires inside it
    assert "_want_advance or _want_record or _want_deal or _want_move" in js
    assert "await _auto_move_player(_turn_narration, _last_user_for_move" in js
    # model-driven moveTo always wins (_moved short-circuits _want_move)
    assert "_MOVE_TOOLS = {\"moveTo\"}" in js


def test_house_rooms_mirror_the_engine_floor_plan():
    # Keep the FE room list in lockstep with src/domain/house.ts HOUSE_ROOMS — a drift means the
    # extraction would reject a real room (or relay a bogus one the engine no-ops).
    assert set(al._HOUSE_ROOMS) == {
        "kitchen", "living-room", "backyard", "bedroom-a", "bedroom-b",
        "hoh-room", "bathroom", "storage-room", "diary-room",
    }
