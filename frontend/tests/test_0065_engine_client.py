"""Feature 0065 (Parts A + B) — the THIN engine-client surface for the sync spine.

The client functions gain optional ``expected_beat_seq`` (compare-and-swap, Part A) and, for the
progression tools, ``idempotency_key`` (at-most-once, Part B). HARD contract: the new fields are
threaded into the request body ONLY when provided — an absent field produces a request byte-identical
to today's (full backward compatibility). The per-turn capture/attach of the token + key is sequenced
separately in the hot FE files; this lane only proves the thin client plumbs them through.

Name-agnostic; httpx is faked so we can capture the exact outgoing JSON body.
"""
import importlib

import httpx
import pytest

orwell_engine = importlib.import_module("src.orwell_engine")


class _CapturingClient:
    """Captures the JSON body of the last POST and returns a canned 200 result."""
    last_json = None

    def __init__(self, *_a, **_k):
        pass

    async def post(self, *_a, **kwargs):
        type(self).last_json = kwargs.get("json")
        req = httpx.Request("POST", orwell_engine.ENGINE_URL.rstrip("/") + "/player/call")
        return httpx.Response(200, json={"result": {"ok": True}}, request=req)

    async def get(self, *_a, **_k):  # pragma: no cover - unused here
        req = httpx.Request("GET", orwell_engine.ENGINE_URL.rstrip("/") + "/health")
        return httpx.Response(200, json={"ok": True}, request=req)


@pytest.fixture(autouse=True)
def _patch_client(monkeypatch):
    _CapturingClient.last_json = None
    monkeypatch.setattr(orwell_engine.httpx, "AsyncClient", lambda *a, **k: _CapturingClient())
    orwell_engine._clear_error()
    yield
    orwell_engine._clear_error()


def _run(coro):
    import asyncio
    return asyncio.get_event_loop().run_until_complete(coro)


def _args():
    """The args dict of the last captured POST body."""
    return (_CapturingClient.last_json or {}).get("args", {})


# --- ABSENT ⇒ byte-identical to today (the backward-compat guard) -----------------------------

def test_advance_game_without_sync_fields_sends_empty_args():
    _run(orwell_engine.advance_game(user="u"))
    assert _CapturingClient.last_json == {"name": "advanceGame", "args": {}}


def test_turn_in_without_sync_fields_sends_empty_args():
    # #1385 / ADR 0006 — turnIn is a mutating progression; absent ⇒ byte-identical to the pre-0065 call.
    _run(orwell_engine.turn_in(user="u"))
    assert _CapturingClient.last_json == {"name": "turnIn", "args": {}}


def test_submit_decision_without_sync_fields_sends_the_bare_decision():
    _run(orwell_engine.submit_decision({"kind": "veto-decision", "use": False}, user="u"))
    assert _CapturingClient.last_json == {"name": "submitDecision", "args": {"kind": "veto-decision", "use": False}}


def test_make_deal_without_sync_field_is_unchanged():
    _run(orwell_engine.make_deal("npc:1", "safety", "t", user="u"))
    assert _args() == {"with": "npc:1", "kind": "safety", "terms": "t"}


def test_move_to_without_sync_field_is_unchanged():
    _run(orwell_engine.move_to("kitchen", user="u"))
    assert _args() == {"room": "kitchen"}


def test_record_interaction_without_sync_field_is_unchanged():
    _run(orwell_engine.record_interaction("chat", with_ids=["npc:1"], user="u"))
    assert "expectedBeatSeq" not in _args()


def test_surface_information_without_sync_field_is_unchanged():
    _run(orwell_engine.surface_information("a fact", "overheard", user="u"))
    assert _args() == {"entity": "player", "fact": {"content": "a fact"}, "pathway": "overheard"}


# --- PRESENT ⇒ threaded into the request --------------------------------------------------------

def test_advance_game_threads_both_sync_fields():
    _run(orwell_engine.advance_game(expected_beat_seq=7, idempotency_key="k-1", user="u"))
    assert _args() == {"expectedBeatSeq": 7, "idempotencyKey": "k-1"}


def test_turn_in_threads_both_sync_fields():
    # #1385 / ADR 0006 — turnIn threads the CAS token + at-most-once key exactly like advanceGame.
    _run(orwell_engine.turn_in(expected_beat_seq=51, idempotency_key="sleep-1", user="u"))
    assert _args() == {"expectedBeatSeq": 51, "idempotencyKey": "sleep-1"}


def test_submit_decision_merges_sync_fields_into_the_payload():
    _run(orwell_engine.submit_decision({"kind": "eviction-vote", "vote": "npc:2"},
                                       expected_beat_seq=9, idempotency_key="d-1", user="u"))
    assert _args() == {"kind": "eviction-vote", "vote": "npc:2", "expectedBeatSeq": 9, "idempotencyKey": "d-1"}


def test_make_deal_threads_expected_beat_seq():
    _run(orwell_engine.make_deal("npc:1", "vote", "t", expected_beat_seq=3, user="u"))
    assert _args()["expectedBeatSeq"] == 3


def test_move_to_threads_expected_beat_seq():
    _run(orwell_engine.move_to("backyard", expected_beat_seq=4, user="u"))
    assert _args() == {"room": "backyard", "expectedBeatSeq": 4}


def test_record_interaction_threads_expected_beat_seq():
    _run(orwell_engine.record_interaction("chat", with_ids=["npc:1"], expected_beat_seq=5, user="u"))
    assert _args()["expectedBeatSeq"] == 5


def test_surface_information_threads_expected_beat_seq():
    _run(orwell_engine.surface_information("a fact", "told-by:npc:2", expected_beat_seq=6, user="u"))
    assert _args()["expectedBeatSeq"] == 6


def test_zero_beat_seq_is_threaded_not_dropped():
    # beatSeq 0 is a legitimate token (a brand-new sandbox); `is not None` must keep it.
    _run(orwell_engine.advance_game(expected_beat_seq=0, user="u"))
    assert _args() == {"expectedBeatSeq": 0}


# --- A10 / #591 / R1c — the fold-lever at-most-once key threads through the thin client ---------
# The engine dedups a re-driven fold-bearing lever (makeDeal/confide/exposeSecret/tradeSecret) by a
# caller-minted `idempotencyKey` (#1305, mirroring recordInteraction #1297). These pin the FE half:
# the wrapper actually SENDS the key when provided (the silent-no-op class: engine accepts the field,
# FE never sends it) and stays byte-identical when absent.

def test_make_deal_threads_idempotency_key():
    _run(orwell_engine.make_deal("npc:1", "vote", "t", expected_beat_seq=3,
                                 idempotency_key="fd-1", user="u"))
    assert _args() == {"with": "npc:1", "kind": "vote", "terms": "t",
                       "expectedBeatSeq": 3, "idempotencyKey": "fd-1"}


def test_confide_threads_idempotency_key():
    _run(orwell_engine.confide("npc:2", expected_beat_seq=5, idempotency_key="fc-1", user="u"))
    assert _args() == {"npcId": "npc:2", "expectedBeatSeq": 5, "idempotencyKey": "fc-1"}


def test_confide_without_sync_fields_is_unchanged():
    _run(orwell_engine.confide("npc:2", user="u"))
    assert _args() == {"npcId": "npc:2"}


def test_expose_secret_threads_idempotency_key():
    _run(orwell_engine.expose_secret(fact_id="fact:1", expected_beat_seq=6,
                                     idempotency_key="fe-1", user="u"))
    assert _args() == {"factId": "fact:1", "expectedBeatSeq": 6, "idempotencyKey": "fe-1"}


def test_expose_secret_without_sync_fields_is_unchanged():
    _run(orwell_engine.expose_secret(fact_id="fact:1", user="u"))
    assert _args() == {"factId": "fact:1"}


def test_trade_secret_threads_idempotency_key():
    _run(orwell_engine.trade_secret("npc:3", fact_id="fact:2", ask_kind="a vote",
                                    expected_beat_seq=7, idempotency_key="ft-1", user="u"))
    assert _args() == {"toNpcId": "npc:3", "factId": "fact:2", "askKind": "a vote",
                       "expectedBeatSeq": 7, "idempotencyKey": "ft-1"}


def test_trade_secret_without_sync_fields_is_unchanged():
    _run(orwell_engine.trade_secret("npc:3", fact_id="fact:2", user="u"))
    assert _args() == {"toNpcId": "npc:3", "factId": "fact:2"}
