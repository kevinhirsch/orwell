"""#1127 — the post-HOH fast-forward: source-pinned convention gates for the anti-montage layer.

The bug: when an NPC wins HOH the player (a spectator) was fast-forwarded past (a) the post-HOH
scheming window and (b) the nomination ceremony — landing at "noms already wrapped". The ENGINE is
correct (NPC noms resolve off-screen one beat at a time, by ADR 0005); the defect is two FE-layer
failures — a pacing gap (the social runway did not hold the HOH-crown → nominations gap; covered by
`test_social_runway.py`) and a NARRATION-FRAMING gap (the model montages elapsed time and narrates a
ceremony as already-over).

This file is the SOURCE-PINNED convention half (like the g15 / reasoning-scrub gates): it proves the
anti-montage time-discipline grounding text AND the in-game time-of-day surfacing are present in the
ENGINE's prompt source (`src/engine/momentPrompts.ts`, which the FE fetches verbatim via
`get_moment_prompt`), so a future edit can't silently drop them. The montage itself is invisible to
the stubbed-LLM gates, so these convention checks are the durable guard.

Roles only — no fixture names.
"""

import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(FRONTEND)
MOMENT_PROMPTS_TS = os.path.join(REPO, "src", "engine", "momentPrompts.ts")


def _ts() -> str:
    with open(MOMENT_PROMPTS_TS, encoding="utf-8") as f:
        return f.read()


def _block(ts: str, start_marker: str, end_marker: str) -> str:
    """Slice the prompt source from `start_marker` to the next `end_marker` (for scoping a fragment)."""
    start = ts.index(start_marker)
    end = ts.index(end_marker, start + len(start_marker))
    return ts[start:end]


# ── The anti-montage / time-discipline section in BASE_GAME_MASTER_PROMPT ──────────────────────

def test_base_prompt_has_the_anti_montage_time_discipline_section():
    ts = _ts()
    # the section header + the explicit montage bans the model kept reaching for
    assert "TIME DISCIPLINE — NARRATE ONLY THE LIVE MOMENT" in ts
    assert "a day passes" in ts
    assert "the house resets" in ts
    assert "now it's day three" in ts
    # time only moves when the GAME moves it (never to reach the next ceremony faster)
    assert "Time only moves when the GAME moves it" in ts


def test_base_prompt_forbids_pre_narrating_a_ceremony_as_already_happened():
    ts = _ts()
    assert "may NOT narrate a CEREMONY" in ts
    assert "ALREADY HAVING HAPPENED" in ts
    # the new-HOH case: the lived aftermath at the current hour, not a jump to "nominations are done"
    assert "LIVED AFTERMATH" in ts


def test_base_prompt_honors_the_in_game_time_of_day():
    ts = _ts()
    assert "Honor the" in ts
    assert "IN-GAME TIME OF DAY the GAME CONTEXT reports" in ts


def test_anti_montage_section_never_reintroduces_the_banned_engine_prose():
    # leverManifest invariant: the ONLY literal "the engine" allowed is the banned-words rule itself.
    # The #1127 section must say "the GAME" / "the GAME CONTEXT", never "the engine" as prose.
    section = _block(_ts(), "TIME DISCIPLINE — NARRATE ONLY THE LIVE MOMENT", "PACING IS ENGAGEMENT")
    assert "the engine" not in section.lower(), "the anti-montage section must not name 'the engine'"


# ── The `social` fragment plays the live runway (no fast-forward past scheming) ────────────────

def test_social_fragment_forbids_montage_and_grounds_the_aftermath():
    # Scope to the `social:` fragment so we prove the framing is on THAT beat (the held runway moment).
    social = _block(_ts(), "social:", "\"diary-room\":")
    assert "LIVE, PRESENT-TENSE MOMENT — PLAY IT, DO NOT SKIP IT" in social
    assert "in-game time of day the GAME CONTEXT reports" in social
    # the new-HOH aftermath is lived, and the next ceremony is never narrated as already over
    assert "lived aftermath" in social.lower()
    assert "already wrapped" in social.lower()


# ── The `nominations` fragment frames the ceremony as a witnessed live beat ────────────────────

def test_nominations_fragment_frames_a_witnessed_live_ceremony():
    nominations = _block(_ts(), "nominations:", "\"veto-competition\":")
    assert "PLAY THE CEREMONY AS A LIVE SET-PIECE THE PLAYER WITNESSES" in nominations
    assert "never recap it as already-done" in nominations.lower()
    assert "in-game time of day the GAME CONTEXT reports" in nominations


# ── The GAME CONTEXT surfaces the in-game time of day (so the model can honor it) ──────────────

def test_game_context_surfaces_the_in_game_time_of_day():
    # renderGameContext emits a "Time of day:" line guarded on view.timeOfDay (the 0066 clock). The
    # narrator can only honor the hour if it is in the assembled context — pin that the line + its
    # "engine truth / never narrate a different time of day" grounding exist in the source.
    ts = _ts()
    assert "Time of day: ${view.timeOfDay}" in ts
    assert "never narrate a different time of day than the engine reports" in ts
