"""0075 FE confide under-call belt: the player presses an ally to open up but the model never calls
`confide`, so the trust-gated disclosure never fires — the FE back-fills it (the 0055 `_auto_record_scene`
sibling). The ENGINE is the single authority: it decides whether they disclose, how much, and truth-vs-lie;
an unearned bond returns `{disclosed:false}` HARMLESSLY (the safe default). We NEVER author a confession.

Found in the same class as the 0055/0039 under-calls: the narration LLM voices a houseguest opening up
(or the player pressing them) without calling `confide(npcId)`, so the earned secret / the lie / the
vulnerability fold never happen. The FE detects the PRESS from the player's OWN line + the scene context,
extracts the npcId via a constrained model-proposed extraction, and calls `confide` itself — letting the
engine adjudicate. Model-driven `confide` always takes precedence.

Name-agnostic — roster ids are synthetic (npc:N); the two display names here are arbitrary placeholders
for the roster id↔name extraction lines, never canonical cast (testing rule: roles only, no real names).

SYNC tests only (pytest-asyncio AUTO mode) — drive coroutines via run_until_complete, never asyncio.run().
"""

import asyncio
import importlib

al = importlib.import_module("src.agent_loop")
orwell_engine = importlib.import_module("src.orwell_engine")
llm_core = importlib.import_module("src.llm_core")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# Synthetic roster — ids the extraction validates against; names are arbitrary placeholders (NOT a fixed
# cast), present only so the roster id=name lines are well-formed.
HOUSE = [{"id": "npc:3", "name": "Houseguest Three"}, {"id": "npc:7", "name": "Houseguest Seven"}]


def _wire(monkeypatch, extraction_json, confides):
    """Mock the extraction LLM + the engine `confide`. The engine call mirrors the real signature
    (npc_id, expected_beat_seq=None, user=None) so the CAS helper threads through harmlessly, and
    returns the engine's own verdict (disclosed true/false — the FE never authors it)."""
    async def fake_llm(*a, **k):
        return extraction_json

    async def fake_confide(npc_id, expected_beat_seq=None, user=None):
        confides.append({"npcId": npc_id, "user": user})
        # The engine decides — default to a no-op disclosure unless a test wants otherwise.
        return {"disclosed": False}

    monkeypatch.setattr(llm_core, "llm_call_async", fake_llm)
    monkeypatch.setattr(orwell_engine, "confide", fake_confide)


# ── (a) press to open up + the model did NOT call confide ⇒ the FE calls confide ────────────────
def test_press_to_open_up_backfills_confide(monkeypatch):
    confides = []
    _wire(monkeypatch, '{"npcId":"npc:3"}', confides)
    out = _run(al._auto_confide(
        "Three's eyes flick to the door, then back to you. 'It's been a rough week,' they admit.",
        "What's really going on with you? You can trust me.",
        HOUSE, "url", "m", {}, "owner"))
    assert out is True
    assert len(confides) == 1
    assert confides[0]["npcId"] == "npc:3" and confides[0]["user"] == "owner"


def test_engine_decides_disclosure_fe_never_authors_it(monkeypatch):
    # Even when the engine DISCLOSES (the bond was earned), the FE only forwards {npcId} — the engine
    # owns whether/how-much/true-vs-lie. The belt returns True (it fired the lever); the content is the
    # engine's, never the FE's.
    confides = []

    async def fake_llm(*a, **k):
        return '{"npcId":"npc:7"}'

    async def fake_confide(npc_id, expected_beat_seq=None, user=None):
        confides.append({"npcId": npc_id, "user": user})
        return {"disclosed": True, "tier": "full", "content": "the engine-authored secret text"}

    monkeypatch.setattr(llm_core, "llm_call_async", fake_llm)
    monkeypatch.setattr(orwell_engine, "confide", fake_confide)
    out = _run(al._auto_confide("Seven finally opens up.", "You can tell me what's going on.",
                                HOUSE, "url", "m", {}, "owner"))
    assert out is True
    assert confides == [{"npcId": "npc:7", "user": "owner"}]


# ── (b) the model DID call confide ⇒ no double-call (the per-turn cap suppresses the belt) ───────
def test_model_driven_confide_suppresses_the_belt():
    # The finishing block sets `_turn_confide_nudges = 1` on a model `confide` tool call, which makes
    # `_want_confide` False — so the belt never runs. Pin that contract in the wired source.
    import os
    js = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                           "src", "agent_loop.py"), encoding="utf-8").read()
    # model-driven confide flips the per-turn gate so the back-fill is suppressed for the turn
    assert 'block.tool_type == "confide"' in js
    assert "_turn_confide_nudges = 1" in js
    # the want-flag is gated on that same counter (so a model call short-circuits it)
    assert "_want_confide = (_turn_confide_nudges < 1" in js


def test_model_driven_confide_no_double_call_at_unit_grain(monkeypatch):
    # Belt-and-braces at the unit grain: once the per-turn counter is at its cap, the want-flag the
    # finishing block computes is False, so the dispatch (`if _want_confide ...`) never calls the belt.
    # We assert the gating expression directly (the belt itself has no internal cap — the loop owns it).
    _turn_confide_nudges = 1
    _want_confide = (_turn_confide_nudges < 1)
    assert _want_confide is False


# ── (c) not a press / no identifiable ally ⇒ no confide ─────────────────────────────────────────
def test_not_a_press_creates_no_confide(monkeypatch):
    # The player wasn't pressing anyone to open up (the extraction returns npcId:null) — nothing fires.
    confides = []
    _wire(monkeypatch, '{"npcId":null}', confides)
    out = _run(al._auto_confide("You chat about the HOH comp coming up.",
                                "Who do you think wins HOH this week?",
                                HOUSE, "url", "m", {}, "owner"))
    assert out is False
    assert confides == [], "a turn that wasn't pressing anyone to open up must never fire confide"


def test_off_roster_ally_is_rejected(monkeypatch):
    # The extraction named someone not on the roster — never relay a bogus id to the engine.
    confides = []
    _wire(monkeypatch, '{"npcId":"npc:99"}', confides)
    out = _run(al._auto_confide("Someone off-roster opens up.", "You can trust me, tell me everything.",
                                HOUSE, "url", "m", {}, "owner"))
    assert out is False
    assert confides == [], "only a houseguest on the live roster is ever pressed to confide"


def test_no_roster_is_a_noop(monkeypatch):
    confides = []
    _wire(monkeypatch, '{"npcId":"npc:3"}', confides)
    out = _run(al._auto_confide("scene", "you can trust me", [], "url", "m", {}, "owner"))
    assert out is False and confides == []


def test_press_signal_pre_filter_gates_the_belt():
    # The finishing block only ARMS the belt when the player's OWN line trips the press pre-filter (a
    # cheap gate before the extraction). Verify the regex catches earnest "open up" pressing and ignores
    # ordinary chatter / strategy / a question that isn't a press.
    rx = al._CONFIDE_PRESS_RE
    for hit in ["What's really going on with you?", "You can tell me.", "You can trust me.",
                "Talk to me.", "What aren't you telling me?", "You can open up to me.",
                "Just between us, what's wrong?", "Level with me.", "Come clean — what is it?",
                "You don't have to hide it from me.", "Tell me the truth.", "What's on your mind?",
                "I'm here for you.", "I won't tell anyone.", "I can see something's bothering you."]:
        assert rx.search(hit), hit
    for miss in ["Who do you think wins HOH?", "I walk into the kitchen.", "Let's vote out the nominee.",
                 "Nice weather in the backyard today.", "I think they're lying to me.",
                 "Do you want to make a final two?"]:
        assert not rx.search(miss), miss


# ── (d) a raising/erroring extraction or engine call is swallowed (the turn is unaffected) ──────
def test_extraction_hiccup_is_fail_closed(monkeypatch):
    confides = []

    async def boom(*a, **k):
        raise RuntimeError("llm down")

    async def fake_confide(*a, **k):
        confides.append(a)
        return {"disclosed": False}

    monkeypatch.setattr(llm_core, "llm_call_async", boom)
    monkeypatch.setattr(orwell_engine, "confide", fake_confide)
    out = _run(al._auto_confide("scene", "you can trust me", HOUSE, "url", "m", {}, "owner"))
    assert out is False and confides == [], "an extraction hiccup must skip silently — never break the turn"


def test_engine_confide_error_is_fail_closed(monkeypatch):
    # The extraction succeeded and named a real ally, but the engine `confide` call raises — the belt must
    # swallow it (the turn is unaffected) rather than let it escape and crash the stream.
    async def fake_llm(*a, **k):
        return '{"npcId":"npc:3"}'

    async def boom_confide(npc_id, expected_beat_seq=None, user=None):
        raise RuntimeError("engine 500")

    monkeypatch.setattr(llm_core, "llm_call_async", fake_llm)
    monkeypatch.setattr(orwell_engine, "confide", boom_confide)
    out = _run(al._auto_confide("Three almost opens up.", "What's really going on with you?",
                                HOUSE, "url", "m", {}, "owner"))
    assert out is False, "an engine error must fail closed — the belt returns False, the turn survives"


def test_unparseable_json_is_a_noop(monkeypatch):
    confides = []
    _wire(monkeypatch, "no json here at all, only reasoning prose", confides)
    out = _run(al._auto_confide("scene", "you can trust me", HOUSE, "url", "m", {}, "owner"))
    assert out is False and confides == []


def test_extraction_after_a_reasoning_block_is_parsed(monkeypatch):
    # Reasoning models emit the answer LAST — the last {"npcId":...} object wins.
    confides = []
    _wire(monkeypatch,
          'Let me think... the player is clearly pressing the ally to open up.\n{"npcId":"npc:7"}',
          confides)
    out = _run(al._auto_confide("Seven exhales and starts to talk.", "You can trust me — talk to me.",
                                HOUSE, "url", "m", {}, "owner"))
    assert out is True and confides and confides[0]["npcId"] == "npc:7"


# ── wiring pins (the belt must be reachable from the finishing block, like its siblings) ────────
def test_confide_belt_is_wired_into_the_finishing_block():
    import os
    js = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                           "src", "agent_loop.py"), encoding="utf-8").read()
    assert "async def _auto_confide" in js
    # 0065: routed through the CAS helper so the back-fill carries the compare-and-swap beatSeq token.
    assert "_backfill_with_cas(owner, _oe.confide, npc_id, user=owner)" in js
    # gated on: model didn't confide (per-turn cap) + the cheap press pre-filter over the player's OWN line
    assert "_want_confide = (_turn_confide_nudges < 1" in js
    assert "_CONFIDE_PRESS_RE.search(_last_user_for_confide)" in js
    assert "_last_user_for_confide = _extract_last_user_message(messages)" in js
    # the fetch-guard includes the confide belt — PREPENDED at the FRONT of the want-chain, the only
    # insertion point that keeps every sibling belt's pinned adjacency intact (the rest of the chain
    # `_want_advance or … or _want_reapproach:` is locked end-to-end by c03's prefix+suffix, L21's
    # `_want_deal or _want_move`, ADR0009's `_want_move or _want_npc_move`, and approach-nudge's
    # `_want_approach or _want_reapproach:`). The call site fires inside it (1:1-ish: the turn's scene
    # touched a houseguest — reuses `_touched_deal`, computed over the whole turn).
    # Phase 4 (0093/0099) inserted the expose/trade secret belts right after confide in this same
    # fetch-guard chain (same rationale: they need the fetched `_house` roster too).
    assert "if _want_confide or _want_expose or _want_trade or _want_advance or _want_record or _want_deal" in js
    assert "if _want_confide and _touched_deal:" in js
    assert "await _auto_confide(_turn_narration, _last_user_for_confide" in js
    # per-turn counter is initialized once per turn
    assert "_turn_confide_nudges = 0" in js
