"""M2-4 (audit B9) — ONE verb set across the entry journey.

The journey used to speak three unrelated registers — "Start casting" (onboarding),
"Choose Your Character" (casting photo pill — RPG-speak, off-fiction), "Meet the house"
(premiere). The pinned line is now one diegetic, house-centric register:

    Enter the house  →  Take your cast photo  →  Meet the house

Source pins hold each surface to its verb AND keep the retired verbs from creeping back
into any of the three surfaces. Copy only — ids/classes (`data-ob-setup-start`,
`orwell-choose-character`, `hs-choose-btn`) stay stable for the structural gates.
"""
from __future__ import annotations

import os

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

#: The one journey line — change it HERE and in every surface together, or this gate fails.
VERB_SET = ("Enter the house", "Take your cast photo", "Meet the house")
RETIRED = ("Start casting", "Choose Your Character")


def _read(rel: str) -> str:
    with open(os.path.join(FE, rel), encoding="utf-8") as fh:
        return fh.read()


def test_onboarding_carries_enter_the_house():
    js = _read("static/js/orwellOnboarding.js")
    seg = js[js.index("function mountSetup"):]
    assert 'go.textContent = "Enter the house"' in seg


def test_casting_pill_carries_take_your_cast_photo():
    js = _read("static/js/orwellHeadshot.js")
    assert 'btn.textContent = "Take your cast photo"' in js
    assert "orwell-choose-character" in js  # the structural id stays


def test_premiere_carries_meet_the_house():
    tut = _read("static/js/orwellPremiereTutorial.js")
    assert "Meet the house" in tut
    panel = _read("static/js/orwellStatusPanel.js")
    assert "Meet the house" in panel  # the objective row speaks the same verb


def test_retired_verbs_never_render_on_the_journey_surfaces():
    """The retired registers must not be RENDERABLE strings on any journey surface —
    comments may mention them (history), so pin the render sites (textContent/innerHTML
    string literals), not the whole file."""
    import re
    for rel in ("static/js/orwellOnboarding.js", "static/js/orwellHeadshot.js",
                "static/js/orwellPremiereTutorial.js"):
        js = _read(rel)
        renders = "".join(re.findall(r"(?:textContent|innerHTML)\s*[+=]=?\s*[^;]+;", js))
        for verb in RETIRED:
            assert verb not in renders, f"{rel} still renders the retired verb {verb!r}"
