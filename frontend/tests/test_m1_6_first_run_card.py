"""M1-6 (audit A6) — first-run card: own stacking context, docked toast, honest gated CTA.

Source pins: (1) the onboarding window is one opaque surface in its own stacking context
(no wordmark/splash ghosting through glass); (2) the corner toast docks below the card's
titlebar band while onboarding is up (never over the ×); (3) the gated Start CTA carries a
visible why-disabled cue with a bounded re-probe poll (the models-changed event can race a
settings write) that is torn down on dismiss — the gate itself stays honest (no narrator
feed ⇒ no game), it explains instead of failing open.
"""
from __future__ import annotations

import os
import re

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel: str) -> str:
    with open(os.path.join(FE, rel), encoding="utf-8") as fh:
        return fh.read()


def test_onboarding_window_is_opaque_and_isolated():
    css = _read("static/css/game-trim.css")
    m = re.search(r"body\.ow-onboarding \.ow-window:has\(\[data-ob-setup\]\) \{(.*?)\}", css, re.S)
    assert m, "the opaque-surface rule targets ONLY the onboarding window"
    body = m.group(1)
    assert "background: var(--bg" in body
    assert "backdrop-filter: none" in body
    assert "isolation: isolate" in body


def test_toast_docks_below_the_card_while_onboarding():
    css = _read("static/css/game-trim.css")
    assert re.search(r"body\.ow-onboarding #orwell-notice-toast \{ top: \d+px; \}", css), \
        "the corner toast must clear the onboarding card's titlebar/× band"


def test_start_cta_carries_a_cue_and_a_bounded_reprobe():
    js = _read("static/js/orwellOnboarding.js")
    assert '_startHint' in js and 'ob-start-hint' in js
    assert re.search(r"Start unlocks once a narrator feed connects", js), "the cue names WHY"
    assert re.search(r"_startPoll = setInterval\(refresh, 2500\)", js), "a poll re-probes past the event race"
    assert re.search(r"const dismiss = \(\) => \{\s*\n\s*if \(_down\) return; _down = true;\s*\n\s*_stopStartPoll\(\)", js), \
        "dismiss tears the poll down (never leaks past the card)"
    assert re.search(r"if \(hasFeed\) \{\s*\n\s*_startHint\.hidden = true;\s*\n\s*_stopStartPoll\(\)", js), \
        "a connected feed clears both the cue and the poll"
