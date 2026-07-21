"""Casting director must ASK the player's name — never INVENT one — and must know the headshot is on file.

Two live prod bugs (debug bundle de91f7d5, 2026-07-21), both surfacing in the same casting interview:

  1. The casting director addressed the player by a name the player NEVER gave ("Devon Hale"), and then
     resisted the player's correction ("I see it on file"). Root cause: the casting auto-record extraction
     (`_auto_record_casting`) ran on a hidden PRODUCTION CUE (the post-photo "continue the interview" cue —
     NOT the player speaking) and echoed the extraction prompt's own hardcoded EXAMPLE name back as
     `playerName`. That phantom name was recorded via updateCasting, poisoning the intake, so every later
     framing told the narrator the name was on file and the narrator used it. Two fixes:
       (a) the extraction prompt carries NO hardcoded sample name (ruling #1: no hardcoded persona), and
       (b) `_auto_record_casting` SKIPS production cues (the player isn't talking on a cue → nothing to record).

  2. The director re-asked for a photo the player had already uploaded. The framing note that tells the
     model the headshot is on file (`CASTING_HEADSHOT_ON_FILE_NOTE`) must be present, wired into the casting
     framing, and GATED on the real portrait/headshot state (claim on-file only when a headshot truly exists).

These are framing/prompt facts-to-voice, never a script. An on-file claim in the framing must reflect the
ACTUAL engine/intake state: name on file ⇒ don't re-ask; not on file ⇒ ask; headshot on file ⇒ don't re-ask.
"""

import asyncio
import importlib
import os
import re

al = importlib.import_module("src.agent_loop")
orwell_engine = importlib.import_module("src.orwell_engine")
llm_core = importlib.import_module("src.llm_core")

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _auto_record_casting_source() -> str:
    """The body of `_auto_record_casting` ONLY — so the source-pins judge the prompt the model receives,
    not unrelated code or comments elsewhere in the module."""
    src = open(os.path.join(_ROOT, "src", "agent_loop.py"), encoding="utf-8").read()
    m = re.search(r"async def _auto_record_casting\(.*?\n(?=\n\n# |\nasync def |\ndef )", src, re.S)
    assert m, "could not locate _auto_record_casting in agent_loop.py"
    return m.group(0)


# ─────────────────────────── Bug 1: never invent a name ───────────────────────────

def test_production_cue_never_records_a_casting_field(monkeypatch):
    """A hidden production cue is engine/FE text, not the player — the extractor must not even RUN on it
    (this is the exact turn where the phantom 'Devon Hale' got recorded in the bundle)."""
    rec = []
    called = {"llm": False}

    async def fake_llm(*a, **k):
        called["llm"] = True
        # If the extractor were (wrongly) called, this is exactly the phantom-name failure mode.
        return '{"fields":{"playerName":"Devon Hale"}}'

    async def fake_update_casting(fields=None, user=None):
        rec.append({"fields": fields, "user": user})
        return {"known": fields, "missing": [], "ready": True}

    monkeypatch.setattr(llm_core, "llm_call_async", fake_llm)
    monkeypatch.setattr(orwell_engine, "update_casting", fake_update_casting)

    cue = "(Production cue — the cast photo step is done; acknowledge it briefly, in character as the " \
          "producers, and continue the casting interview.)"
    out = _run(al._auto_record_casting(cue, "Got the photo. What should we call you?",
                                       "url", "m", {}, "owner"))
    assert out is False, "a production cue must record nothing"
    assert rec == [], "no casting field may be recorded from a production cue"
    assert called["llm"] is False, "the extractor must not even be invoked on a production cue"


def test_real_player_name_is_still_recorded(monkeypatch):
    """The belt still works for a genuine player answer — the fix narrows it to real player speech only."""
    rec = []

    async def fake_llm(*a, **k):
        return '{"fields":{"playerName":"Ryne O\'Donnell"}}'

    async def fake_update_casting(fields=None, user=None):
        rec.append({"fields": fields, "user": user})
        return {"known": fields, "missing": [], "ready": True}

    monkeypatch.setattr(llm_core, "llm_call_async", fake_llm)
    monkeypatch.setattr(orwell_engine, "update_casting", fake_update_casting)

    out = _run(al._auto_record_casting("I'm Ryne O'Donnell.", "What's your name?", "url", "m", {}, "owner"))
    assert out is True and len(rec) == 1
    assert rec[0]["fields"]["playerName"] == "Ryne O'Donnell"


def test_extraction_prompt_has_no_hardcoded_sample_name():
    """Ruling #1: no hardcoded persona name in the casting prompt. A concrete example bare-name ('Devon
    Hale') in the extraction instructions primed the model to emit exactly that when uncertain."""
    body = _auto_record_casting_source()
    assert "Devon" not in body, "the casting extraction prompt must not hardcode the sample name 'Devon'"
    assert "Hale" not in body, "the casting extraction prompt must not hardcode the sample name 'Hale'"
    # It must still positively instruct: only a name the player actually stated, never a placeholder/example.
    assert "playerName" in body
    assert re.search(r"never a placeholder, an example, or a name from", body), \
        "the prompt must forbid inventing a name from an example / the instructions themselves"


def test_production_cue_guard_is_wired_before_the_extraction_call():
    """Source-pin: the guard sits before the llm extraction so the cue never reaches the model."""
    body = _auto_record_casting_source()
    assert "if _is_production_cue(last_user):" in body
    # the guard must precede the extraction call site
    assert body.index("if _is_production_cue(last_user):") < body.index("llm_call_async(")


# ─────────────────────────── Bug 2: know the headshot is on file ───────────────────────────

def test_headshot_on_file_note_present_wired_and_gated():
    ch = importlib.import_module("routes.chat_helpers")
    # (a) present — a real production note telling the model the photo is handled.
    note = getattr(ch, "CASTING_HEADSHOT_ON_FILE_NOTE", "")
    assert isinstance(note, str) and note.strip(), "CASTING_HEADSHOT_ON_FILE_NOTE must exist"
    low = note.lower()
    assert "on file" in low and ("headshot" in low or "photo" in low)
    assert "do not ask" in low or "stop" in low or "not for the player" in low

    src = open(os.path.join(_ROOT, "routes", "chat_helpers.py"), encoding="utf-8").read()
    # (b) wired — the note is actually appended onto the casting framing prompt.
    assert "pre_prompt = pre_prompt + \"\\n\\n\" + CASTING_HEADSHOT_ON_FILE_NOTE" in src, \
        "CASTING_HEADSHOT_ON_FILE_NOTE must be appended to the casting framing"
    # (c) gated on the REAL portrait/headshot state — only claimed on-file when a headshot truly exists.
    gate = src[src.index("A/C fix (2026-06-20): once the cast headshot is on file"):
               src.index("CASTING_HEADSHOT_ON_FILE_NOTE\n", src.index("A/C fix (2026-06-20)")) + 40]
    assert "orwell_portraits" in gate and "intake_status" in gate, \
        "the on-file claim must read the real portrait intake state"
    assert "if _has_photo:" in gate, "the note must only append when a headshot is actually present"


def test_casting_framing_asks_for_the_name_and_never_hardcodes_one():
    """The FE casting steer instructs the model to GET the player's name — and never bakes in a specific
    name-on-file claim itself (the only legitimate 'name on file' source is the engine's real intake state,
    surfaced through the engine casting-status moment prompt)."""
    ch = importlib.import_module("routes.chat_helpers")
    pre = getattr(ch, "PRE_GAME_PROMPT", "")
    assert isinstance(pre, str) and pre.strip()
    assert "name" in pre.lower(), "the pre-game casting steer must tell the model to get the player's name"
    # No hardcoded persona name leaks into the FE casting framing constants.
    for const in ("PRE_GAME_PROMPT", "CASTING_REGISTER_NOTE", "CASTING_HEADSHOT_ON_FILE_NOTE"):
        val = getattr(ch, const, "")
        assert "Devon" not in val and "Hale" not in val, f"{const} must not hardcode a sample persona name"
