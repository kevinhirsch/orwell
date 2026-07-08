"""M1-7 (audit t-3) — season reset: overlay banner + season-titled fresh chat.

Source pins: (1) the notice kit honors `reflow: false` — a no-reflow banner overlays and
the host only reserves body padding while a reflow-participating card is up; (2) the
engine-status degraded slab opts in (it used to reflow the whole app on every show/hide);
(3) the restart fresh-session seam renames the new chat "Season N" off the live season
number (form-encoded PATCH — the route takes Form data), so the sidebar stops reading
"Casting interview" forever; the auto-namer skips custom-named sessions so it sticks.
The fresh-session-per-season choice itself is the E65 seam, already gated elsewhere.
"""
from __future__ import annotations

import os
import re

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel: str) -> str:
    with open(os.path.join(FE, rel), encoding="utf-8") as fh:
        return fh.read()


def test_notice_kit_honors_no_reflow_banners():
    js = _read("static/js/orwellNotice.js")
    assert re.search(r'if \(this\.o\.reflow === false\) el\.setAttribute\("data-on-noreflow", ""\)', js)
    assert re.search(
        r'!host\.querySelector\("\.on-card:not\(\[data-on-noreflow\]\)"\)[^}]*clearBannerInset\(\)',
        js, re.S), "a host holding only no-reflow cards must release the body inset"


def test_engine_status_banner_overlays_without_reflow():
    js = _read("static/js/orwellEngineStatus.js")
    assert re.search(r"reflow: false,", js), \
        "the degraded-engine banner must overlay, never push the app down (audit t-3)"


def test_fresh_season_chat_is_titled_by_season():
    js = _read("static/js/orwellOnboarding.js")
    assert '"/api/orwell/season"' in js
    assert re.search(r'name: "Season " \+ season', js)
    assert "application/x-www-form-urlencoded" in js, \
        "the session rename route takes Form data, not JSON"
    assert re.search(r"catch \(_\) \{ /\* best-effort — the auto-namer remains the fallback \*/ \}", js)
