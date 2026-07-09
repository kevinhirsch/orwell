"""M2-4 (audit B9) — ONE verb set across the entry journey.

The journey used to speak three unrelated registers — "Start casting" (onboarding),
"Choose Your Character" (casting photo pill — RPG-speak, off-fiction), "Meet the house"
(premiere). The pinned line was: "Enter the house" → "Take your cast photo" → "Meet the
house". #874 (2026-07-09) retired the first step's gating CTA entirely — the healthy
onboarding case now proceeds straight into the interview with no confirm click at all, so
there is no more "Enter the house" button surface to pin. The remaining two verbs still hold.

Source pins hold each surviving surface to its verb AND keep the retired verbs from creeping
back into any journey surface. Copy only — ids/classes (`orwell-choose-character`,
`hs-choose-btn`) stay stable for the structural gates.
"""
from __future__ import annotations

import os

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

#: The surviving journey line — change it HERE and in the surface together, or this gate fails.
VERB_SET = ("Take your cast photo", "Meet the house")
RETIRED = ("Start casting", "Choose Your Character", "Enter the house")


def _read(rel: str) -> str:
    with open(os.path.join(FE, rel), encoding="utf-8") as fh:
        return fh.read()


def test_onboarding_carries_no_gating_cta():
    # #874: the healthy case has no "Enter the house" (or any other) confirm CTA — onboarding
    # proceeds straight into the interview with no gating step at all.
    js = _read("static/js/orwellOnboarding.js")
    assert "function mountSetup" not in js
    assert "Enter the house" not in js


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
