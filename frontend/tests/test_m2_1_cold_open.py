"""M2-1 (audit B1) → #874 (2026-07-09) — the cold open leads with the show, never the plumbing.

M2-1 originally put the "lead with the show fantasy" principle on the setup wizard's first
screen. #874 removed that wizard modal entirely for the healthy case (a feed already resolves
OOB per #860): there is no gate, no h1, no CTA — the cold open now IS the producers reaching
out in-chat, with zero intervening surface. The principle carries forward onto the one UI that
DOES render pre-game now — the #874 no-feed notice for the genuinely-missing-feed case — which
still must never leak a raw provider/model id to the player.

Source pins: (1) the old wizard (mountSetup, its h1/CTA, humanizeModelId) is gone; (2) the
healthy case proceeds with no gating surface at all; (3) the no-feed notice never renders a raw
model id and points at the real Settings model controls.
"""
from __future__ import annotations

import os
import re

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel: str) -> str:
    with open(os.path.join(FE, rel), encoding="utf-8") as fh:
        return fh.read()


def _no_feed_seg(js: str) -> str:
    seg = js[js.index("async function showNoFeedNotice"):]
    return seg[: seg.index("\n  function openSettings")]


def test_wizard_and_its_model_humanizer_are_gone():
    js = _read("static/js/orwellOnboarding.js")
    assert "function mountSetup" not in js
    assert "function humanizeModelId" not in js
    assert "Welcome to the Big Brother house" not in js


def test_healthy_case_has_no_intervening_screen():
    # #874: once a feed resolves, route() proceeds directly — no h1, no CTA, no wizard segment to
    # even slice out anymore. The healthy path goes straight from the model-gate check to opening
    # the interview session.
    js = _read("static/js/orwellOnboarding.js")
    route = js[js.index("async function route"):]
    assert re.search(r"anyModelConfigured\(\)\)\)\s*\{", route)
    assert "openFreshInterviewSession" in route
    assert "_orwellOpenGameAfterCasting" in route


def test_no_feed_notice_never_renders_a_raw_model_id():
    js = _read("static/js/orwellOnboarding.js")
    seg = _no_feed_seg(js)
    # no slash-form provider/model id (e.g. "z-ai/glm-5.2", "deepseek/deepseek-v4-pro") anywhere
    # in the notice's own literal strings
    literal_strings = "".join(re.findall(r'"[^"]*"', seg))
    assert not re.search(r"\b[\w.]+/[\w.-]+-[\w.]+\b", literal_strings)
    # and it never even attempts to read/display a model id — the notice explains the ABSENCE of
    # a feed, it doesn't summarize what would run
    assert "/api/default-chat" not in seg
    assert "image_model" not in seg


def test_no_feed_notice_points_at_the_real_settings_model_controls():
    js = _read("static/js/orwellOnboarding.js")
    seg = _no_feed_seg(js)
    assert "openSettings" in seg
    assert '"Open Settings"' in seg
