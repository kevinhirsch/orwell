"""M1-6 (audit A6) → #874 (2026-07-09) — first-run surfaces stay honest without a gating modal.

M1-6 originally hardened the setup-wizard's "why is Start disabled" cue + opaque stacking
context. #874 removed that wizard entirely for the healthy case: a resolved feed proceeds
straight into the interview with no gated CTA to explain. The M1-6 PRINCIPLE carries forward
onto the surface that replaced it — the #874 no-feed notice — which still (1) never fails open
silently (no feed ⇒ the composer visibly disables, with a notice that says why) and (2) still
re-probes past a settings-write race instead of going stale.

Source pins: (1) the dead wizard-only CSS (`[data-ob-setup]` opaque surface, `.ob-start-hint`,
`.ob-prod-settings-link`) is gone; (2) the no-feed notice disables the composer + explains why +
re-probes on a bounded interval, torn down the instant a feed connects.
"""
from __future__ import annotations

import os
import re

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel: str) -> str:
    with open(os.path.join(FE, rel), encoding="utf-8") as fh:
        return fh.read()


def test_dead_wizard_only_css_is_gone():
    css = _read("static/css/game-trim.css")
    assert "[data-ob-setup]" not in css
    assert ".ob-start-hint" not in css
    assert ".ob-prod-settings-link" not in css


def test_no_feed_notice_carries_a_visible_why_disabled_cue():
    js = _read("static/js/orwellOnboarding.js")
    assert "async function showNoFeedNotice" in js
    seg = js[js.index("async function showNoFeedNotice"):]
    seg = seg[: seg.index("\n  function openSettings")]
    assert "No feed connected yet" in seg
    assert "can't speak until a feed is live" in seg


def test_no_feed_notice_reprobes_on_a_bounded_interval_and_tears_down():
    js = _read("static/js/orwellOnboarding.js")
    seg = js[js.index("async function showNoFeedNotice"):]
    seg = seg[: seg.index("\n  function openSettings")]
    assert re.search(r"_noFeedTimer = setInterval\(async \(\) => \{", seg)
    assert "5000" in seg
    assert "anyModelConfigured()" in seg
    # a connected feed clears both the notice and the composer disable, and torn down cleanly
    hide_fn = js[js.index("function hideNoFeedNotice"):]
    hide_fn = hide_fn[: hide_fn.index("\n  }")]
    assert "clearInterval(_noFeedTimer)" in hide_fn
    assert "_setComposerDisabledForNoFeed(false)" in hide_fn
