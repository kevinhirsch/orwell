"""0114 — the theme-surface-consistency probe's JS extraction snippet, proven against a REAL DOM.

Companion to `test_0114_theme_consistency.py` (which tests the pure Python classifier against
synthetic fixtures). This file proves the OTHER half of the boundary: that
`src.theme_probe.THEME_PROBE_JS`, injected into a real (tiny, synthetic, engine-free) page,
actually extracts the raw facts the classifier expects — the active theme's own computed
`--bg`/`--panel` custom properties, and a real ancestor-chain background layer stack.

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

from src.theme_probe import THEME_PROBE_JS, classify_theme_findings  # noqa: E402

# Mirrors the light preset's real tokens (static/js/theme.js THEMES.light).
_HTML = """
<!doctype html><html style="--bg:#f0ebe3; --panel:#faf6f0;"><head><style>
  body { margin: 0; }
  /* correctly token-driven — matches the active theme's own --panel exactly. */
  #good { position: absolute; left: 10px; top: 10px; width: 30px; height: 20px; background: var(--panel); }
  /* the fixed bug shape: a hardcoded dark tile that ignores the active theme entirely. */
  #offender { position: absolute; left: 10px; top: 60px; width: 30px; height: 20px; background: #0d0f14; }
  /* inherits — declares no background of its own anywhere up the (bounded) ancestor chain. */
  #inherited { position: absolute; left: 10px; top: 110px; width: 30px; height: 20px; }
  /* a subtle wash over a themed ancestor — must stay clean. */
  #washparent { position: absolute; left: 10px; top: 160px; width: 60px; height: 40px; background: var(--panel); }
  #washparent #wash { width: 30px; height: 20px; background: rgba(255,255,255,0.05); }
</style></head><body>
  <div id="good">good</div>
  <div id="offender">offender</div>
  <div id="inherited">inherited</div>
  <div id="washparent"><div id="wash">wash</div></div>
</body></html>
"""

_SELECTORS = ["#good", "#offender", "#inherited", "#wash"]


def test_theme_probe_js_extracts_tokens_and_layers_from_a_real_dom():
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 390, "height": 844})
            page.set_content(_HTML)
            raw = page.evaluate(THEME_PROBE_JS, {"selectors": _SELECTORS, "maxLayers": 6})
        finally:
            browser.close()

    tokens = raw["tokens"]
    assert tokens["bg"] == "#f0ebe3"
    assert tokens["panel"] == "#faf6f0"

    by_selector = {r["selector"]: r for r in raw["elements"]}
    assert set(by_selector) == set(_SELECTORS)

    # #good's own computed background-color is the RESOLVED --panel value, normalized to rgb().
    assert by_selector["#good"]["layers"][0] == "rgb(250, 246, 240)"
    # #offender's own layer is the literal hardcoded color, un-derived from the token.
    assert by_selector["#offender"]["layers"][0] == "rgb(13, 15, 20)"
    # #inherited declares nothing of its own — its first layer is transparent.
    assert by_selector["#inherited"]["layers"][0] in ("rgba(0, 0, 0, 0)", "transparent")

    findings = classify_theme_findings(raw["elements"], tokens)
    by_kind_selector = {f["selector"]: f["kind"] for f in findings}
    assert by_kind_selector.get("#offender") == "foreign-polarity"
    assert "#good" not in by_kind_selector
    assert "#inherited" not in by_kind_selector
    assert "#wash" not in by_kind_selector  # a subtle wash over the themed parent stays clean


def test_theme_probe_js_ignores_display_none_and_hidden_elements():
    html = """
    <!doctype html><html style="--bg:#000; --panel:#111;"><body>
      <div id="hidden1" style="display:none; width:50px; height:50px; background:#fff;">a</div>
      <div id="hidden2" style="visibility:hidden; width:50px; height:50px; background:#fff;">b</div>
      <div id="visible" style="width:50px; height:50px; background:#fff;">c</div>
    </body></html>
    """
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 390, "height": 844})
            page.set_content(html)
            raw = page.evaluate(
                THEME_PROBE_JS, {"selectors": ["#hidden1", "#hidden2", "#visible"], "maxLayers": 6})
        finally:
            browser.close()
    selectors_seen = {r["selector"] for r in raw["elements"]}
    assert selectors_seen == {"#visible"}
