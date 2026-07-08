"""0113 — the visual-regression harness's JS extraction snippet, proven against a REAL DOM.

Companion to `test_0113_visual_harness.py` (which tests the pure Python classifier against
synthetic fixtures). This file proves the OTHER half of the boundary: that
`src.visual_geometry.GEOMETRY_PROBE_JS`, injected into a real (tiny, synthetic, engine-free)
page, actually extracts the raw facts the classifier expects — off-viewport placement, a real
`overflow:hidden` ancestor, and a real `elementFromPoint` covering probe.

Uses `sync_playwright` directly, so `conftest.py`'s structural scan auto-marks every test in
this file `browser` (the serial `fe-browser-tests` CI lane, not the parallel `fe-unit` one).
No FE app boot needed — a static HTML string is enough to exercise the extraction pass.
"""
from __future__ import annotations

import os
import sys

from playwright.sync_api import sync_playwright

FRONTEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if FRONTEND_DIR not in sys.path:
    sys.path.insert(0, FRONTEND_DIR)

from src.visual_geometry import GEOMETRY_PROBE_JS, classify_shot_geometry  # noqa: E402

_HTML = """
<!doctype html><html><head><style>
  body { margin: 0; }
  /* deliberately clear of every other fixture element's box (right=40, well left of
     #scroller's left=50) so its own elementFromPoint probe can't accidentally land on a
     sibling — this element exists purely as the "nothing wrong here" control case. */
  #clean { position: absolute; left: 10px; top: 10px; width: 30px; height: 20px; background: #333; }
  #zero { position: absolute; left: 10px; top: 60px; width: 0; height: 0; }
  #offscreen { position: absolute; left: -500px; top: 10px; width: 80px; height: 40px; }
  #scroller { position: absolute; left: 50px; top: 10px; width: 100px; height: 60px; overflow: hidden; }
  /* left/width are relative to #scroller (its containing block, since it's positioned): the
     child's absolute box is (50+80, 10+10)-(50+80+150, 10+10+30) = (130,20)-(280,50) — it
     visibly escapes the scroller's (50,10)-(150,70) box on the right, while staying well
     inside the 390px viewport (so this is a CLIP finding, not an off-viewport one). */
  #clipped { position: absolute; left: 80px; top: 10px; width: 150px; height: 30px; background: #555; }
  #under { position: absolute; left: 10px; top: 200px; width: 80px; height: 40px; background: green; }
  #scrim { position: absolute; left: 0px; top: 190px; width: 300px; height: 60px; background: rgba(0,0,0,0.5); }
</style></head><body>
  <div id="clean">clean</div>
  <div id="zero">zero</div>
  <div id="offscreen">off</div>
  <div id="scroller"><div id="clipped">clipped content that escapes the scroller</div></div>
  <div id="under">under</div>
  <div id="scrim">scrim on top</div>
</body></html>
"""

_SELECTORS = ["#clean", "#zero", "#offscreen", "#clipped", "#under", "#scrim"]
VIEWPORT = {"width": 390, "height": 844}


def test_geometry_probe_js_extracts_expected_findings_from_a_real_dom():
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 390, "height": 844})
            page.set_content(_HTML)
            raw = page.evaluate(GEOMETRY_PROBE_JS, {"selectors": _SELECTORS, "overlays": []})
            # the SAME page, but with #scrim declared a deliberate overlay layer — the
            # covering probe must stamp coveredByOverlay so the classifier skips it.
            raw_overlay = page.evaluate(
                GEOMETRY_PROBE_JS, {"selectors": _SELECTORS, "overlays": ["#scrim"]})
        finally:
            browser.close()

    by_selector = {r["selector"]: r for r in raw}
    assert set(by_selector) == set(_SELECTORS)

    # zero-size: extracted rect really is 0x0.
    assert by_selector["#zero"]["rect"]["width"] == 0
    assert by_selector["#zero"]["rect"]["height"] == 0

    # off-viewport: extracted rect really sits outside [0, viewport].
    assert by_selector["#offscreen"]["rect"]["right"] <= 0

    # clipped-by-ancestor: the real overflow:hidden ancestor was found, with a real rect.
    clip = by_selector["#clipped"]["clippingAncestor"]
    assert clip is not None
    assert clip["label"].startswith("div#scroller")
    assert clip["rect"]["width"] > 0

    # covered: elementFromPoint at #under's own center resolves to #scrim, not #under itself.
    assert by_selector["#under"]["coveredBySelfOrDescendant"] is False
    assert "scrim" in (by_selector["#under"]["coveredBy"] or "")

    # #clean has none of the above — self-covered, no clip, on-screen, non-zero.
    assert by_selector["#clean"]["coveredBySelfOrDescendant"] is True
    assert by_selector["#clean"]["clippingAncestor"] is None

    findings = classify_shot_geometry(raw, VIEWPORT)
    kinds_by_selector = {}
    for f in findings:
        kinds_by_selector.setdefault(f["selector"], set()).add(f["kind"])

    assert kinds_by_selector.get("#zero") == {"zero-size"}
    assert kinds_by_selector.get("#offscreen") == {"off-viewport"}
    assert kinds_by_selector.get("#clipped") == {"clipped-by-ancestor"}
    assert kinds_by_selector.get("#under") == {"covered"}
    assert "#clean" not in kinds_by_selector
    assert "#scrim" not in kinds_by_selector  # the scrim itself is legitimately on top

    # with #scrim declared an overlay layer: the probe stamps coveredByOverlay on the real
    # DOM, and the classifier no longer reports #under as covered — a deliberate overlay
    # dimming background content is the layering system working, not a finding.
    under_overlay = {r["selector"]: r for r in raw_overlay}["#under"]
    assert under_overlay["coveredByOverlay"] is True
    overlay_findings = classify_shot_geometry(raw_overlay, VIEWPORT)
    assert all(not (f["selector"] == "#under" and f["kind"] == "covered")
               for f in overlay_findings)


def test_geometry_probe_js_ignores_display_none_and_hidden_elements():
    html = """
    <!doctype html><html><body>
      <div id="hidden1" style="display:none; width:50px; height:50px;">a</div>
      <div id="hidden2" style="visibility:hidden; width:50px; height:50px;">b</div>
      <div id="visible" style="width:50px; height:50px;">c</div>
    </body></html>
    """
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 390, "height": 844})
            page.set_content(html)
            raw = page.evaluate(GEOMETRY_PROBE_JS,
                                {"selectors": ["#hidden1", "#hidden2", "#visible"], "overlays": []})
        finally:
            browser.close()
    selectors_seen = {r["selector"] for r in raw}
    assert selectors_seen == {"#visible"}
