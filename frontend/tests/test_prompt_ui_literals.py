"""Batch C gate #3 (2026-07-11 narrator-prompt audit) — PROMPT ↔ UI-LITERAL pin.

The narrator prompt quotes on-screen control labels VERBATIM and tells the player to use them by
name — 'Take your cast photo' (the casting headshot button), the "New season" surface. Nothing tied
those quoted literals to the FE source that renders them, so a button rename would silently leave the
prompt telling the player to tap a control that no longer exists by that name (an immersion break the
player hits, invisible to every existing gate).

This pins each quoted UI literal in the prompt to the FE source that renders it, so a rename fails
HERE — at rename time — forcing the prompt (and its golden fixture) to be updated in lockstep.

Reads source as text (like test_c13_lever_drift.py) — no import of the TS/JS.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(FRONTEND)


def _prompt_text() -> str:
    with open(os.path.join(REPO, "src", "engine", "momentPrompts.ts"), encoding="utf-8") as f:
        return f.read()


def _fe_source(*relparts: str) -> str:
    with open(os.path.join(FRONTEND, *relparts), encoding="utf-8") as f:
        return f.read()


# Each row: (the literal quoted in the prompt, the FE file that renders it, the needle expected in
# that FE file, case_insensitive). The prompt literal must appear in the prompt AND the needle must
# appear in the FE source — either side drifting fails the gate.
_UI_LITERALS = [
    # The casting headshot button — the prompt names it by its EXACT on-screen text; the FE renders
    # that exact text as the button's textContent. This is an exact, two-way pin.
    ("Take your cast photo", ("static", "js", "orwellHeadshot.js"), "Take your cast photo", False),
    # The post-season "New season" hand-off surface — the prompt tells the player to press the "New
    # season" button; the FE surface (feature 0057) is titled "A New Season". Case-insensitive so the
    # article/casing of the FE title is allowed, but a real rename (e.g. "Play again") still fails.
    ("New season", ("static", "js", "orwellNewSeason.js"), "New Season", True),
]


def test_prompt_ui_literals_are_pinned_to_fe_source():
    prompt = _prompt_text()
    failures = []
    for prompt_literal, fe_rel, fe_needle, ci in _UI_LITERALS:
        if prompt_literal not in prompt:
            failures.append(f"prompt no longer quotes {prompt_literal!r} — update this pin")
            continue
        src = _fe_source(*fe_rel)
        found = (fe_needle.lower() in src.lower()) if ci else (fe_needle in src)
        if not found:
            failures.append(
                f"prompt quotes {prompt_literal!r} but {'/'.join(fe_rel)} no longer renders "
                f"{fe_needle!r} — a UI rename drifted from the prompt (update BOTH; re-record golden)"
            )
    assert not failures, "; ".join(failures)


def test_take_your_cast_photo_is_the_exact_button_text():
    # The strongest pin: the prompt's exact quote IS the button's textContent literal.
    assert "Take your cast photo" in _prompt_text()
    src = _fe_source("static", "js", "orwellHeadshot.js")
    assert re.search(r'textContent\s*=\s*"Take your cast photo"', src), (
        "orwellHeadshot.js no longer sets the button textContent to 'Take your cast photo' — "
        "the prompt's casting-headshot instruction is now stale"
    )
