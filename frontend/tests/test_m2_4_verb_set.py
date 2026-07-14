"""M2-4 (audit B9) — ONE verb set across the entry journey.

The journey used to speak three unrelated registers — "Start casting" (onboarding),
"Choose Your Character" (casting photo pill — RPG-speak, off-fiction), "Meet the house"
(premiere). #874 (2026-07-09) retired the first step's gating CTA entirely — the healthy
onboarding case now proceeds straight into the interview with no confirm click at all, so
there is no more "Enter the house" button surface to pin.

CHAMPAGNE CIRCLE (feature 0111, owner ruling 2026-07-14): the premiere no longer asks the
player to "meet the house" — the producers convene the whole house for a champagne toast and
everyone is met at once. So the premiere surfaces now speak the move-in / champagne-toast
register (the tutorial's "champagne toast", the panel's "Move-in night"), not "Meet the house".

Source pins hold each surviving surface to its verb AND keep the retired verbs from creeping
back into any journey surface. Copy only — ids/classes (`orwell-choose-character`,
`hs-choose-btn`) stay stable for the structural gates.
"""
from __future__ import annotations

import os

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

#: The surviving journey line — change it HERE and in the surface together, or this gate fails.
VERB_SET = ("Take your cast photo", "champagne toast", "Move-in night")
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


def test_premiere_carries_the_champagne_toast_register():
    # CHAMPAGNE CIRCLE (0111): the premiere surfaces speak the move-in / champagne-toast register, not the
    # retired "Meet the house" checklist framing (the whole house is met at the toast). The retired-verb
    # check is scoped to RENDER sites (textContent/innerHTML) — a comment mentioning "Meet the house" (its
    # own history) must not fail this gate.
    import re
    def renders(rel):
        return "".join(re.findall(r"(?:textContent|innerHTML)\s*[+=]=?\s*[^;]+;", _read(rel)))
    tut = renders("static/js/orwellPremiereTutorial.js")
    panel = renders("static/js/orwellStatusPanel.js")
    assert "champagne toast" in tut          # the tutorial speaks the champagne-toast register
    assert "Move-in night" in panel          # the premiere objective row speaks the same register
    # the retired premiere verb must be gone from what the surfaces actually RENDER (comments may keep it)
    assert "Meet the house" not in tut
    assert "Meet the house" not in panel


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
