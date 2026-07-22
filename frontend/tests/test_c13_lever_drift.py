"""Queue C13 — close the lever drift: every prompt-advertised lever is agent-callable.

The bug class: the engine's game-master prompt names levers ("• diaryRoom — ...") that the
front-end never exposed, so a prompt-obedient model got "Unknown function call" mid-scene —
the in-chat Diary Room was narrated-but-never-recorded, NPC-initiated scenes were dead, and
deals (0039) couldn't be struck. The DRIFT TEST here parses the prompt's lever manifest and
fails if any named lever is missing from the FE surface — so prompt and front-end can never
silently diverge again.
"""

import importlib
import json
import os
import re

import pytest

orwell_engine = importlib.import_module("src.orwell_engine")
# tool_implementations first: it pulls the agent_tools/tool_schemas chain in a
# cycle-safe order (tool_schemas imports agent_tools at module level).
tool_impl = importlib.import_module("src.tool_implementations")
agent_tools = importlib.import_module("src.agent_tools")
tool_schemas = importlib.import_module("src.tool_schemas")

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(FRONTEND)


def _prompt_levers() -> set[str]:
    """Parse '  • leverName — ...' bullets out of BASE_GAME_MASTER_PROMPT (TS source)."""
    with open(os.path.join(REPO, "src", "engine", "momentPrompts.ts"), encoding="utf-8") as f:
        ts = f.read()
    start = ts.index("BASE_GAME_MASTER_PROMPT")
    end = ts.index('].join("\\n")', start)
    block = ts[start:end]
    levers: set[str] = set()
    for m in re.finditer(r"•\s+([A-Za-z]+(?:\s*/\s*[A-Za-z]+)*)\s+—", block):
        for name in re.split(r"\s*/\s*", m.group(1)):
            levers.add(name.strip())
    return levers


def _fe_schema_names() -> set[str]:
    return {
        t["function"]["name"]
        for t in tool_schemas.FUNCTION_TOOL_SCHEMAS
        if isinstance(t, dict) and t.get("type") == "function"
    }


# --- THE drift test ------------------------------------------------------------------

def test_every_prompt_advertised_lever_is_agent_callable():
    levers = _prompt_levers()
    assert levers, "failed to parse any levers from the prompt — parser or prompt changed shape"
    schemas = _fe_schema_names()
    missing = sorted(
        lever for lever in levers
        if lever not in schemas
        or lever not in tool_schemas.ORWELL_GAME_TOOLS
        or lever not in agent_tools.TOOL_TAGS
        or lever not in agent_tools.GAME_TOOL_KEEP
    )
    assert not missing, (
        f"prompt advertises levers the agent cannot call: {missing} — "
        "add schema + ORWELL_GAME_TOOLS + TOOL_TAGS + GAME_TOOL_KEEP (+ dispatch), "
        "or remove the lever from BASE_GAME_MASTER_PROMPT"
    )


def test_drifted_levers_now_present():
    # The three this item wired; pin them explicitly so a revert is loud.
    for lever in ("socialInitiatives", "diaryRoom", "makeDeal"):
        assert lever in _fe_schema_names(), lever
        assert lever in tool_schemas.ORWELL_GAME_TOOLS, lever
        assert lever not in agent_tools.game_build_disabled_additions([]), lever


def test_prompt_no_longer_advertises_resolveCompetition():
    # B37 made runCompetition the single advertised competition authority.
    assert "resolveCompetition" not in _prompt_levers()


# --- Batch C gate #1 (2026-07-11 prompt audit): the drift scan must reach the MOMENT FRAGMENTS and
# the base PROSE, not only the base `• name —` bullets `_prompt_levers()` parses. The bullet-only
# parser missed two real drift classes the audit found: (a) a fragment that DIRECTS `call <lever>` for
# a lever the FE never exposed (would have caught `peekCompetition`), and (b) a lever named in PROSE
# rather than a bullet (`turnIn`). This scans the imperative call-references in both and requires each
# to be an agent-callable FE tool schema.


def _moment_prompts_ts() -> str:
    with open(os.path.join(REPO, "src", "engine", "momentPrompts.ts"), encoding="utf-8") as f:
        return f.read()


def _base_prose_block() -> str:
    ts = _moment_prompts_ts()
    s = ts.index("BASE_GAME_MASTER_PROMPT")
    e = ts.index('].join("\\n")', s)
    return ts[s:e]


def _moment_fragments_block() -> str:
    ts = _moment_prompts_ts()
    s = ts.index("export const MOMENT_PROMPTS")
    e = ts.index("/** Map an engine phase", s)
    return ts[s:e]


def _gap_block() -> str:
    """G7 (2026-07-22 gap audit): the module-level span BETWEEN the end of BASE_GAME_MASTER_PROMPT
    and the start of MOMENT_PROMPTS was never scanned by either _base_prose_block() (which stops at
    BASE_GAME_MASTER_PROMPT's own closing `].join("\\n")`) or _moment_fragments_block() (which starts
    at `export const MOMENT_PROMPTS`) — so CASTING_INTERVIEW_PROMPT (real, live prompt text sent to
    the model every casting turn, wired into MOMENT_PROMPTS['character-creation']) sat in a blind spot,
    along with any other module-level const declared in that gap. This closes the gap generically by
    scanning the WHOLE span, not just the one const that happened to trigger the finding."""
    ts = _moment_prompts_ts()
    s = ts.index('].join("\\n")', ts.index("BASE_GAME_MASTER_PROMPT"))
    e = ts.index("export const MOMENT_PROMPTS")
    return ts[s:e]


def _referenced_levers(text: str) -> set[str]:
    """camelCase levers the prompt DIRECTS the model to call — imperative `call X`, a function-call
    `X(`, `with/via/using X`, or a parenthetical prose mention `(X)`. camelCase-only (drops English
    words like 'call the'), and argument tokens are excluded so `createCharacter with
    confirmRestart=true` yields `createCharacter`, never the arg `confirmRestart`."""
    c: set[str] = set()
    c |= set(re.findall(r"\bcall\s+([a-z][A-Za-z]+)", text))
    c |= set(re.findall(r"\b([a-z][A-Za-z]+)\(", text))
    c |= set(re.findall(r"\b(?:with|via|using)\s+([a-z][A-Za-z]+)", text))
    c |= set(re.findall(r"\(([a-z][A-Za-z]+)\)", text))
    c = {t for t in c if re.search(r"[a-z][A-Z]", t)}  # camelCase only (an internal uppercase)
    c = {t for t in c if not re.search(re.escape(t) + r"\s*=", text)}  # drop args (foo=true)
    return c


def test_moment_fragments_reference_only_callable_levers():
    schemas = _fe_schema_names()
    refs = _referenced_levers(_moment_fragments_block())
    assert refs, "extracted no lever references from the moment fragments — parser or prompt shape changed"
    missing = sorted(r for r in refs if r not in schemas)
    assert not missing, (
        f"a moment fragment directs the model to call a lever the FE cannot: {missing} — "
        "wire the tool (schema + dispatch) or stop naming it in the fragment "
        "(this is exactly the class that let `peekCompetition` slip through the bullet-only scan)"
    )


def test_base_prose_references_only_callable_levers():
    # Beyond the `• name —` bullets (covered by test_every_prompt_advertised_lever_is_agent_callable),
    # the base prompt names levers in PROSE too (e.g. "(turnIn)"). Those must be callable as well.
    schemas = _fe_schema_names()
    refs = _referenced_levers(_base_prose_block())
    assert refs, "extracted no lever references from the base prose — parser or prompt shape changed"
    missing = sorted(r for r in refs if r not in schemas)
    assert not missing, f"base prompt PROSE references levers the agent cannot call: {missing}"


def test_prose_referenced_turnIn_is_now_in_scope_and_callable():
    # The audit's `turnIn` exemplar: it is named in the base PROSE ("(turnIn)"), not as a bullet, so
    # the bullet-only scan never checked it. Pin that the extended scan now SEES it AND it is callable.
    assert "turnIn" in _referenced_levers(_base_prose_block())
    assert "turnIn" in _fe_schema_names()


# --- G7 (2026-07-22 gap audit): the SCANNED-RANGE gap between the base prose and the moment
# fragments — CASTING_INTERVIEW_PROMPT and any other module-level const in between — must be
# checked too, not just the two named blocks. -----------------------------------------------

def test_gap_block_contains_casting_interview_prompt():
    # Sanity: prove the gap scan actually reaches the const the audit named (so this test would have
    # failed to even exercise the fix if the offsets ever drift out from under CASTING_INTERVIEW_PROMPT).
    gap = _gap_block()
    assert "CASTING_INTERVIEW_PROMPT" in gap
    assert "MOMENT — The casting interview" in gap
    # ...and prove the actual PROSE (not just the bare identifier — _moment_fragments_block() DOES
    # contain the `"character-creation": CASTING_INTERVIEW_PROMPT,` object-literal reference, which is
    # not the lever-bearing text) is NOT already covered by the two pre-existing scanned blocks — i.e.
    # this really was a blind spot, not a redundant re-scan.
    assert "MOMENT — The casting interview" not in _base_prose_block()
    assert "MOMENT — The casting interview" not in _moment_fragments_block()


def test_casting_interview_prompt_levers_are_now_scanned_and_callable():
    # The two levers the audit confirmed ARE named inside CASTING_INTERVIEW_PROMPT (updateCasting,
    # createCharacter) must now show up under the gap scan AND be agent-callable — pinning that a
    # renamed/typo'd/removed reference here would be caught even though both already happen to be
    # covered by the base-prose bullets today.
    refs = _referenced_levers(_gap_block())
    assert "updateCasting" in refs
    assert "createCharacter" in refs
    schemas = _fe_schema_names()
    assert "updateCasting" in schemas
    assert "createCharacter" in schemas


def test_gap_block_references_only_callable_levers():
    # THE drift gate for the gap: any lever referenced in the previously-blind span (whether inside
    # CASTING_INTERVIEW_PROMPT or a future module-level const declared there) must be agent-callable.
    schemas = _fe_schema_names()
    refs = _referenced_levers(_gap_block())
    assert refs, "extracted no lever references from the gap block — parser or prompt shape changed"
    # Greptile P2 (#1883): apply the SAME five-place callability bar the main drift test uses
    # (lines 57-63) — a gap-span lever that has a schema but is missing from ORWELL_GAME_TOOLS,
    # TOOL_TAGS, or GAME_TOOL_KEEP would still fail the FE contract, so the gap scan must check
    # all four surfaces, not just _fe_schema_names().
    missing = sorted(
        r for r in refs
        if r not in schemas
        or r not in tool_schemas.ORWELL_GAME_TOOLS
        or r not in agent_tools.TOOL_TAGS
        or r not in agent_tools.GAME_TOOL_KEEP
    )
    assert not missing, (
        f"a lever referenced between BASE_GAME_MASTER_PROMPT and MOMENT_PROMPTS (e.g. inside "
        f"CASTING_INTERVIEW_PROMPT) is not agent-callable: {missing} — this is exactly the G7 blind "
        "spot: wire the tool (schema + ORWELL_GAME_TOOLS + TOOL_TAGS + GAME_TOOL_KEEP + dispatch) "
        "or stop naming it in that span"
    )


def test_fragment_scan_has_teeth_against_a_noncallable_lever():
    # Teeth check with the audit's exemplar `peekCompetition` (an engine-internal surfaced to the model
    # only via `runCompetition`, never an agent tool): a synthetic fragment naming it as a `call` is
    # extracted AND rejected by the callability bar — so a real one would fail the scans above.
    assert "peekCompetition" not in _fe_schema_names()
    assert "peekCompetition" in _referenced_levers("then call peekCompetition() to peek the winner")


# --- the wrappers actually reach the engine ------------------------------------------

def _run(coro):
    import asyncio
    return asyncio.get_event_loop().run_until_complete(coro)


def test_diary_room_turn_records_an_entry(monkeypatch):
    seen = {}

    async def fake(entry, user=None):
        seen["entry"] = entry
        return {"recorded": True}

    monkeypatch.setattr(orwell_engine, "diary_room", fake)
    res = _run(tool_impl.do_diary_room(json.dumps({"entry": "I trust no one this week."}), owner="p"))
    assert res.get("exit_code") == 0
    assert seen["entry"] == "I trust no one this week."


def test_diary_room_requires_an_entry(monkeypatch):
    called = []

    async def fake(entry, user=None):
        called.append(entry)
        return {"recorded": True}

    monkeypatch.setattr(orwell_engine, "diary_room", fake)
    res = _run(tool_impl.do_diary_room("", owner="p"))
    assert res.get("exit_code") == 1 and not called


def test_social_initiatives_passthrough(monkeypatch):
    async def fake(user=None):
        return {"initiatives": [{"houseguest": {"id": "npc:3", "name": "X"}, "pretext": "wants a word"}]}

    monkeypatch.setattr(orwell_engine, "social_initiatives", fake)
    res = _run(tool_impl.do_social_initiatives("", owner="p"))
    assert res.get("exit_code") == 0 and "npc:3" in res["output"]


def test_make_deal_forwards_and_validates(monkeypatch):
    seen = {}

    async def fake(with_id, kind, terms, leverage=None, traded_secret=None, user=None):
        seen.update({"with": with_id, "kind": kind, "terms": terms})
        return {"deal": {"kind": kind}}

    monkeypatch.setattr(orwell_engine, "make_deal", fake)
    ok = _run(tool_impl.do_make_deal(json.dumps({"with": "npc:2", "kind": "final-two", "terms": "to the end"}), owner="p"))
    assert ok.get("exit_code") == 0
    assert seen == {"with": "npc:2", "kind": "final-two", "terms": "to the end"}
    bad = _run(tool_impl.do_make_deal(json.dumps({"with": "npc:2", "kind": "coronation", "terms": "x"}), owner="p"))
    assert bad.get("exit_code") == 1


# --- G2 (2026-07-22 gap audit): makeDeal's leverage/tradedSecret sub-parameters reach the engine ----
#
# The narrator prompt (src/engine/momentPrompts.ts) directs the model to press `makeDeal` with a
# `{ leverage }` (0093, a secret about the deal partner) or `{ tradedSecret }` (0099, a secret about a
# third party) — but the top-level lever-name scans above only ever proved `makeDeal` ITSELF is
# callable, not that these two sub-parameters actually reach the engine. Both fields are fully built
# and engine-tested (SecretLeverDescriptor, src/ports/GameSession.ts) but were dropped silently at
# every FE layer. These tests pin the fix end to end: schema exposes the fields, do_make_deal forwards
# them (shape-checked, never interpreted), and the engine wrapper carries them through.

def test_make_deal_forwards_leverage_opaquely(monkeypatch):
    seen = {}

    async def fake(with_id, kind, terms, leverage=None, traded_secret=None, user=None):
        seen.update({"with": with_id, "kind": kind, "terms": terms, "leverage": leverage,
                     "traded_secret": traded_secret})
        return {"deal": {"kind": kind}}

    monkeypatch.setattr(orwell_engine, "make_deal", fake)
    ok = _run(tool_impl.do_make_deal(json.dumps({
        "with": "npc:2", "kind": "safety", "terms": "keep me off the block",
        "leverage": {"factId": "fact:9"},
    }), owner="p"))
    assert ok.get("exit_code") == 0
    assert seen["leverage"] == {"factId": "fact:9"}
    assert seen["traded_secret"] is None


def test_make_deal_forwards_traded_secret_opaquely(monkeypatch):
    seen = {}

    async def fake(with_id, kind, terms, leverage=None, traded_secret=None, user=None):
        seen.update({"leverage": leverage, "traded_secret": traded_secret})
        return {"deal": {"kind": kind}}

    monkeypatch.setattr(orwell_engine, "make_deal", fake)
    ok = _run(tool_impl.do_make_deal(json.dumps({
        "with": "npc:3", "kind": "vote", "terms": "vote with me this week",
        "tradedSecret": {"factId": "fact:4"},
    }), owner="p"))
    assert ok.get("exit_code") == 0
    assert seen["leverage"] is None
    assert seen["traded_secret"] == {"factId": "fact:4"}


def test_make_deal_forwards_a_bluffed_leverage(monkeypatch):
    seen = {}

    async def fake(with_id, kind, terms, leverage=None, traded_secret=None, user=None):
        seen.update({"leverage": leverage})
        return {"deal": {"kind": kind}}

    monkeypatch.setattr(orwell_engine, "make_deal", fake)
    ok = _run(tool_impl.do_make_deal(json.dumps({
        "with": "npc:2", "kind": "safety", "terms": "safety this week",
        "leverage": {"bluff": True, "subject": "npc:2"},
    }), owner="p"))
    assert ok.get("exit_code") == 0
    assert seen["leverage"] == {"bluff": True, "subject": "npc:2"}


def test_make_deal_leverage_absent_is_byte_identical():
    """An ordinary deal (no leverage/tradedSecret) must forward NEITHER field — a lever-free deal is
    unchanged from the pre-0093/0099 wire shape."""
    assert tool_impl._parse_secret_lever(None) is None
    assert tool_impl._parse_secret_lever({}) is None
    assert tool_impl._parse_secret_lever("not a dict") is None


def test_engine_wrapper_make_deal_only_includes_lever_fields_when_present(monkeypatch):
    seen = {}

    async def fake_call(tool, args, user=None):
        seen["args"] = args
        return {}

    monkeypatch.setattr(orwell_engine, "_call", fake_call)
    _run(orwell_engine.make_deal("npc:2", "safety", "terms", user="p"))
    assert "leverage" not in seen["args"] and "tradedSecret" not in seen["args"]

    _run(orwell_engine.make_deal("npc:2", "safety", "terms", leverage={"factId": "fact:1"}, user="p"))
    assert seen["args"]["leverage"] == {"factId": "fact:1"}
    assert "tradedSecret" not in seen["args"]

    _run(orwell_engine.make_deal("npc:2", "safety", "terms", traded_secret={"factId": "fact:2"}, user="p"))
    assert seen["args"]["tradedSecret"] == {"factId": "fact:2"}
    assert "leverage" not in seen["args"]


def test_w6_every_keep_set_tool_has_a_diegetic_beat_label():
    """D5/W6: a keep-set tool with no _orwellToolBeats entry renders its raw
    camelCase name in the transcript — the C14/C19 immersion bleed. The drift
    test iterates the REAL keep-set so a new tool can't ship unlabeled."""
    import re
    from pathlib import Path
    fe = Path(__file__).resolve().parents[1]
    # The map now lives in the single-source module ./orwellToolBeats.js (shared by the
    # live + reload render paths). Iterate it so a new keep-set tool can't ship unlabeled.
    beats = (fe / "static" / "js" / "orwellToolBeats.js").read_text(encoding="utf-8")
    m = re.search(r"ORWELL_TOOL_BEATS = \{(.*?)\};", beats, re.S)
    assert m, "ORWELL_TOOL_BEATS map missing from orwellToolBeats.js"
    labeled = set(re.findall(r"'([A-Za-z_]+)':", m.group(1)))
    from src.agent_tools import GAME_TOOL_KEEP
    missing = sorted(set(GAME_TOOL_KEEP) - labeled)
    assert not missing, f"keep-set tools with no diegetic beat label (D5/W6): {missing}"


# --- #1385: turnIn — the ADR 0006 bedtime lever — is now agent-callable ---------------

def test_turn_in_is_agent_callable():
    # #1385: turnIn (the player's bedtime lever + the 0102 daily-recap trigger) was engine-wired but
    # had NO FE surface, so the model could never call it — the sleep-economy player half was dead.
    # Pin all four FE surfaces the drift gate checks so a revert is loud.
    assert "turnIn" in _fe_schema_names()
    assert "turnIn" in tool_schemas.ORWELL_GAME_TOOLS
    assert "turnIn" in agent_tools.TOOL_TAGS
    assert "turnIn" in agent_tools.GAME_TOOL_KEEP


def test_turn_in_forwards_and_surfaces_daily_recap(monkeypatch):
    # Boundary test: the FE only SURFACES turnIn — the ENGINE owns the night-roll AND the hidden rest
    # penalty (the FE never authors the sleep effect). Prove the wrapper reaches the engine and returns
    # the AdvanceView (incl. the Vault-free dailyRecap 0102) verbatim so the narrator can voice it.
    seen = {}

    # #1385 guard: turnIn is a mutating progression, so do_turn_in threads the 0065 sync-spine fields
    # (expected_beat_seq CAS + at-most-once idempotency_key) — the mock must accept them like the engine tool.
    async def fake(expected_beat_seq=None, idempotency_key=None, user=None):
        seen["called"] = True
        return {"event": None, "dailyRecap": {"day": 1, "highlights": ["a quiet day"], "surfaced": []}}

    monkeypatch.setattr(orwell_engine, "turn_in", fake)
    res = _run(tool_impl.do_turn_in("", owner="p"))
    assert res.get("exit_code") == 0 and seen.get("called")
    assert "dailyRecap" in res["output"] and "a quiet day" in res["output"]


# --- G2 hardening: a SUB-PARAMETER drift gate ----------------------------------------------------
#
# The top-level scans above (`_prompt_levers`, `_referenced_levers`) only ever prove a NAMED TOOL is
# agent-callable — they are structurally blind to a directive naming a FIELD of an already-recognized
# tool ("use makeDeal with { leverage }"), which is exactly how 0093/0099's leverage/tradedSecret went
# unreachable while `makeDeal` itself passed every existing gate. This closes that blind spot two ways:
# a general call-form scan (`call toolName({ a, b })` directives, which every OTHER lever already uses)
# and an explicit pin for the prose-only makeDeal case the call-form scan cannot parse.

def _schema_properties() -> dict[str, set[str]]:
    return {
        t["function"]["name"]: set(t["function"].get("parameters", {}).get("properties", {}) or {})
        for t in tool_schemas.FUNCTION_TOOL_SCHEMAS
        if isinstance(t, dict) and t.get("type") == "function"
    }


def _call_form_subparams(text: str) -> list[tuple[str, list[str]]]:
    """Extract direct call-form sub-parameter lists: `call toolName({ a, b })` (spaces around the
    braces optional). Returns (toolName, [fields]) pairs — the fields the prompt literally directs
    the model to pass as that tool's argument object."""
    out: list[tuple[str, list[str]]] = []
    for m in re.finditer(r"\bcall\s+([a-zA-Z]+)\(\{\s*([^}]*?)\s*\}\)", text):
        tool = m.group(1)
        fields = [f.strip() for f in m.group(2).split(",") if f.strip()]
        if fields:
            out.append((tool, fields))
    return out


def test_call_form_subparameters_are_schema_fields():
    """Sub-parameter drift check: every `call toolName({ field, ... })` directive in the prompt (base
    prose + moment fragments) names fields that must be REAL properties on that tool's FE schema — or
    the model is directed to build an argument shape the FE silently drops."""
    schemas = _schema_properties()
    text = _base_prose_block() + "\n" + _moment_fragments_block()
    pairs = _call_form_subparams(text)
    assert pairs, "failed to parse any call-form sub-parameter directives — parser or prompt shape changed"
    missing = []
    for tool, fields in pairs:
        props = schemas.get(tool)
        if props is None:
            missing.append(f"{tool} (tool itself missing from FE schemas)")
            continue
        for field in fields:
            if field not in props:
                missing.append(f"{tool}.{field}")
    assert not missing, f"prompt directs a call-form sub-parameter the FE schema doesn't accept: {missing}"


def test_makeDeal_leverage_and_tradedSecret_are_schema_fields():
    """G2 pin (2026-07-22 gap audit): the prose directive 'use makeDeal with { leverage } ... or
    { tradedSecret }' (0093/0099) is a sub-parameter directive that is NOT a `call X({...})` form, so
    the general scan above cannot see it either — pin it explicitly so this specific drift (fully
    engine-built + engine-tested, but silently dropped at every FE layer) can never silently return."""
    text = _base_prose_block()
    assert re.search(r"makeDeal\s+with\s+\{\s*leverage\s*\}", text), (
        "the prompt no longer directs 'makeDeal with { leverage }' — update this pin if the prose changed"
    )
    assert re.search(r"\{\s*tradedSecret\s*\}", text), (
        "the prompt no longer names '{ tradedSecret }' — update this pin if the prose changed"
    )
    make_deal_props = _schema_properties().get("makeDeal", set())
    assert "leverage" in make_deal_props, (
        "makeDeal's FE schema is missing 'leverage' — the prompt directs the model to use it (0093)"
    )
    assert "tradedSecret" in make_deal_props, (
        "makeDeal's FE schema is missing 'tradedSecret' — the prompt directs the model to use it (0099)"
    )
