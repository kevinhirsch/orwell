"""Lane B (RC3/RC4/RC5) — cast-genesis starvation & identity coherence, FE tier.

Pins the three FE fixes on top of the existing 2026-07-13 cap/retry/salvage seams:

  S3a — the genesis sketch output floor clears the 15-NPC skeleton estimate with headroom (no
        finish_reason=length starvation);
  S3b — a reasoning-channel MISROUTE (glm-4.7 emits the JSON answer as `thinking` deltas with an
        EMPTY visible body, even with reasoning:{enabled:false} sent) is RECOVERED, counted a success,
        and recorded as a RED-eligible health event (never a silent discard of paid-for content);
  S3c — the roster is sketched in CHUNKS (3×5), a failed chunk is retried ALONE, and the per-chunk
        proposals combine into ONE atomic write-back.

All LLM calls are mocked. Roles only — no names ingested as data.
"""
import asyncio
import json

import src.endpoint_resolver as er
from src import llm_core as lc
from src import orwell_cast_authoring as A
from src import orwell_cast_genesis as G
from src import token_policy as tp


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


_ROSTER = [{"id": f"npc:{i}"} for i in range(1, 16)]
_VALID_IDS = {n["id"] for n in _ROSTER}
_OR_URL = "https://openrouter.ai/api/v1/chat/completions"


def _npc(i: int) -> dict:
    return {
        "id": f"npc:{i}",
        "name": f"Casey Slot{i:02d}on",
        "identity": f"a distinct houseguest, slot {i}",
        "archetype": ["comp-beast", "floater", "mastermind", "social-butterfly"][i % 4],
        "vocation": "court reporter",
        "hometown": "Tulsa, OK",
        "biography": "Grew up on a farm. Moved to the city for work.",
        "age": 25 + (i % 30),
        "stats": {"physical": 0.3 + (i % 5) * 0.1, "mental": 0.8 - (i % 4) * 0.1,
                  "social": 0.4 + (i % 4) * 0.1},
        "hiddenElements": [
            {"kind": "secret-motive", "detail": f"secretly playing for someone back home, slot {i}"},
            {"kind": "divergent-persona", "detail": f"sweet in public, ruthless in private, slot {i}"},
        ],
    }


def _full_json() -> str:
    return json.dumps({"npcs": [_npc(i) for i in range(1, 16)], "ties": []})


def _delta(text: str) -> str:
    return "data: " + json.dumps({"delta": text}) + "\n\n"


def _thinking(text: str) -> str:
    return "data: " + json.dumps({"delta": text, "thinking": True}) + "\n\n"


def _finish(reason: str) -> str:
    return "data: " + json.dumps({"type": "finish", "reason": reason}) + "\n\n"


def _pin_endpoints(monkeypatch) -> None:
    monkeypatch.setattr(er, "resolve_endpoint",
                        lambda prefix, owner=None: (_OR_URL, "stub-chat-model", {}))
    monkeypatch.setattr(er, "resolve_utility_fallback_candidates", lambda owner=None: [])
    monkeypatch.setattr(er, "_resolve_fallback_candidates", lambda key, owner=None: [])


def _install_stream_fake(monkeypatch, scripts: list, calls: list) -> None:
    async def _fake(candidates, messages, temperature=None, policy=None,
                    max_tokens=0, response_format=None, **kw):
        idx = min(len(calls), len(scripts) - 1)
        calls.append({"max_tokens": max_tokens, "messages": list(messages), "policy": policy})
        for chunk in scripts[idx]:
            yield chunk

    monkeypatch.setattr(lc, "stream_llm_with_fallback", _fake)


# ── S3a: the sketch floor clears the skeleton estimate ───────────────────────────────────────────────

def test_genesis_floor_clears_the_skeleton_estimate():
    assert tp.GENESIS_SKETCH_MIN_OUTPUT_TOKENS >= tp.GENESIS_SKELETON_TOKEN_ESTIMATE
    assert tp.GENESIS_SKETCH_MIN_OUTPUT_TOKENS >= 8192


def test_genesis_resolver_applies_the_floor(monkeypatch):
    _pin_endpoints(monkeypatch)
    calls: list = []
    _install_stream_fake(monkeypatch, [[_delta("{}"), _finish("stop")]], calls)
    fn = _run(G._resolve_llm_fn("u-floor"))
    assert fn is not None
    _run(fn([{"role": "user", "content": "sketch"}]))
    assert calls[0]["max_tokens"] >= tp.GENESIS_SKELETON_TOKEN_ESTIMATE


# ── S3b: reasoning-channel misroute recovery ─────────────────────────────────────────────────────────

def test_recover_reasoning_channel_json_extracts_the_payload():
    reasoning = "Let me think... " + json.dumps({"npcs": [_npc(1)], "ties": []}) + " done."
    recovered = G.recover_reasoning_channel_json(reasoning)
    assert recovered is not None
    obj = json.loads(recovered)
    assert obj["npcs"][0]["id"] == "npc:1"


def test_recover_reasoning_channel_json_none_on_prose():
    assert G.recover_reasoning_channel_json("just some thinking, no json") is None
    assert G.recover_reasoning_channel_json("") is None


def test_genesis_parser_accepts_a_recovered_reasoning_payload():
    """The genesis PARSER consumes the recovered reasoning-channel JSON exactly like a normal reply."""
    recovered = G.recover_reasoning_channel_json(json.dumps({"npcs": [_npc(3)], "ties": []}))
    proposal = G.parse_genesis_proposal(recovered, _VALID_IDS)
    assert [n["id"] for n in proposal["npcs"]] == ["npc:3"]


def test_empty_visible_but_reasoning_holds_json_is_recovered_and_flagged(monkeypatch):
    """End-to-end: the resolved fn returns the reasoning-channel JSON when the visible body is empty,
    and records a RED-eligible reasoning-channel-misroute (never a silent discard)."""
    _pin_endpoints(monkeypatch)
    from src import enrichment_policy as ep
    recorded: list = []
    monkeypatch.setattr(ep, "record_failure",
                        lambda user, call_class, reason, detail=None: recorded.append((call_class, reason)))
    payload = _full_json()
    calls: list = []
    # Empty visible body; the JSON streams ONLY as reasoning/thinking deltas, then a clean finish.
    _install_stream_fake(monkeypatch, [[_thinking(payload), _finish("stop")]], calls)
    fn = _run(A._resolve_llm_fn("u-misroute"))
    text = _run(fn([{"role": "user", "content": "sketch"}]))
    assert text == payload, "the misrouted reasoning JSON must be recovered as the reply"
    assert any(r == "reasoning-channel-misroute" for (_c, r) in recorded), recorded


def test_visible_body_wins_over_reasoning(monkeypatch):
    """When the visible body is present, reasoning is IGNORED (no misroute, byte-identical to before)."""
    _pin_endpoints(monkeypatch)
    from src import enrichment_policy as ep
    recorded: list = []
    monkeypatch.setattr(ep, "record_failure",
                        lambda *a, **k: recorded.append(a))
    calls: list = []
    _install_stream_fake(monkeypatch, [[_thinking("noise"), _delta("{\"ok\": true}"), _finish("stop")]], calls)
    fn = _run(A._resolve_llm_fn("u-visible"))
    text = _run(fn([{"role": "user", "content": "x"}]))
    assert text == '{"ok": true}'
    assert recorded == []


# ── S3c: chunked gather → one atomic write-back; failed chunk retried alone ───────────────────────────

def test_chunked_gather_commits_the_full_cast_in_one_write():
    """A per-chunk model (each call returns only the chunk's slice) yields a combined 15-NPC proposal
    written back ONCE."""
    async def llm(messages):
        # Echo whatever chunk ids are named in the user message with a valid per-npc object.
        user = " ".join(str(m.get("content", "")) for m in messages)
        ids = [i for i in range(1, 16) if f'"npc:{i}"' in user]
        return json.dumps({"npcs": [_npc(i) for i in ids], "ties": []})

    writes: list = []

    async def write(proposal):
        writes.append(len(proposal.get("npcs") or []))
        return {"accepted": True, "committed": len(proposal["npcs"]), "violations": [], "varianceOk": True}

    res = _run(G.seed_cast_genesis(_ROSTER, 7, llm, write, chunk_size=5))
    assert res["accepted"] is True and res["committed"] == 15
    assert len(writes) == 1 and writes[0] == 15, "the chunks combine into ONE atomic write-back"


def test_failed_npc_call_is_retried_alone_not_the_whole_cast():
    """A per-NPC call that returns nothing on the first try is retried ONCE alone; others are untouched."""
    state = {"calls": 0, "npc6_first": True}

    async def llm(messages):
        state["calls"] += 1
        user = " ".join(str(m.get("content", "")) for m in messages)
        ids = [i for i in range(1, 16) if f'"npc:{i}"' in user]
        # The npc:6 call fails its FIRST attempt, succeeds on the lone retry.
        if ids == [6] and state["npc6_first"]:
            state["npc6_first"] = False
            return "no json this pass"
        return json.dumps({"npcs": [_npc(i) for i in ids], "ties": []})

    async def write(proposal):
        return {"accepted": True, "committed": len(proposal["npcs"]), "violations": [], "varianceOk": True}

    res = _run(G.seed_cast_genesis(_ROSTER, 7, llm, write, chunk_size=5))
    assert res["committed"] == 15
    # 15 per-NPC calls + 1 lone retry for the failed npc:6 = 16 calls (never a whole-cast re-grind).
    assert state["calls"] == 16, state["calls"]


def test_chunked_dedupes_names_across_chunks():
    """A name that repeats across chunks is dropped from the later entry (the engine floors it)."""
    async def llm(messages):
        user = " ".join(str(m.get("content", "")) for m in messages)
        ids = [i for i in range(1, 16) if f'"npc:{i}"' in user]
        # Every chunk proposes the SAME surname on its first slot → cross-chunk collision.
        npcs = []
        for j, i in enumerate(ids):
            n = _npc(i)
            if j == 0:
                n["name"] = "Casey Sharedsurname"
            npcs.append(n)
        return json.dumps({"npcs": npcs, "ties": []})

    seen: dict = {}

    async def write(proposal):
        seen["proposal"] = proposal
        return {"accepted": True, "committed": len(proposal["npcs"]), "violations": [], "varianceOk": True}

    _run(G.seed_cast_genesis(_ROSTER, 7, llm, write, chunk_size=5))
    named = [n for n in seen["proposal"]["npcs"] if n.get("name") == "Casey Sharedsurname"]
    assert len(named) == 1, "the repeated name survives on exactly ONE entry; the rest are floored"


def test_seed_cast_genesis_default_is_single_call():
    """Byte-identical default: without chunk_size the whole cast rides ONE call (existing contract)."""
    calls = {"n": 0}

    async def llm(_messages):
        calls["n"] += 1
        return _full_json()

    async def write(proposal):
        return {"accepted": True, "committed": len(proposal["npcs"]), "violations": [], "varianceOk": True}

    res = _run(G.seed_cast_genesis(_ROSTER, 7, llm, write))
    assert res["committed"] == 15 and calls["n"] == 1
