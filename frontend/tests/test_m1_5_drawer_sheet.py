"""M1-5 (audit A5) — the mobile gadget drawer: one opaque sheet over a scrim.

Glass themes make `--sidebar-bg`/`--panel` translucent; the slide-over drawer became layer
soup (gadget titles double-exposing, chat text bleeding through) with nothing dimming the
page behind it. Source pins: both drawer media blocks force the opaque sheet (rail + cards,
`backdrop-filter: none`), the scrim layer exists just under the drawer's z, and the rail JS
mounts/clears it on open/close with tap-to-close.
"""
from __future__ import annotations

import os
import re

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel: str) -> str:
    with open(os.path.join(FE, rel), encoding="utf-8") as fh:
        return fh.read()


def test_both_drawer_blocks_force_the_opaque_sheet():
    css = _read("static/style.css")
    blocks = re.findall(
        r"@media \((?:max-width: 768px|max-height: 500px)[^{]*\{(.*?)\n    \}",
        css, re.S)
    drawer_blocks = [b for b in blocks if "grail-open" in b]
    assert len(drawer_blocks) >= 2, "expected the narrow + landscape-short drawer blocks"
    for b in drawer_blocks:
        assert re.search(r"\.gadget-rail \{ background: var\(--bg[^}]*backdrop-filter: none", b), \
            "the drawer sheet must be opaque (--bg) with no backdrop blur"
        assert re.search(r"\.gadget-rail \.ow-window \{ background: var\(--panel[^}]*backdrop-filter: none", b), \
            "gadget cards inside the drawer go opaque with the sheet"
        assert ".grail-scrim" in b, "the scrim layer ships in every drawer mode"


def test_scrim_sits_under_the_drawer_z():
    css = _read("static/style.css")
    assert re.search(r"\.grail-scrim \{[^}]*z-index: 59", css)
    assert re.search(r"\.gadget-rail \{[^}]*z-index: 60", css)
    assert re.search(r"\.grail-scrim\.grail-scrim-on \{ opacity: 1; pointer-events: auto; \}", css)


def test_rail_js_mounts_and_clears_the_scrim():
    js = _read("static/js/orwellGadgetRail.js")
    assert re.search(r"function openDrawer\(\) \{.*?_scrim\(\)\.classList\.add\(\"grail-scrim-on\"\)", js, re.S)
    assert re.search(r"function closeDrawer\(\) \{.*?remove\(\"grail-scrim-on\"\)", js, re.S)
    assert 's.addEventListener("click", closeDrawer)' in js, "tap on the scrim closes the drawer"
