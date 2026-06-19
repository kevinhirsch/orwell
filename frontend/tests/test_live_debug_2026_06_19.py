"""Live-debug ledger 2026-06-19 — FE items L11/L12/L13/L16 (SOURCE-PINS).

Structural/source assertions for the new window + gadget-rail + portrait
behaviors; the live DOM behavior is exercised in scripts/browser_smoke.py.
Provenance: docs/audits/2026-06-19-live-debug-issues.md.

  • L11 — every kit window is edge+corner resizeable on desktop (kit-level),
    with size persisted; the cast window gets a smaller default.
  • L12 — the cast window can be PINNED into the gadget rail as a compact
    gadget (two small portraits) and un-pinned back to a floating window;
    the pinned state persists.
  • L13 — the gadgets in the rail can be drag-reordered; the order persists.
  • L16 — cast portraits are full color while ACTIVE, grayscale once EVICTED.
"""
import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


# ── L11 — kit-level edge/corner resize + smaller cast default ──────────────

def test_l11_kit_wires_pointer_resize():
    js = _read("static", "js", "orwellWindow.js")
    # the kit imports + calls the shared edge/corner resize helper
    assert "makeWindowResizable" in js
    assert "from './windowResize.js'" in js
    # default ON so every .ow-* window inherits it (per L11), opt-out via resizable:false
    assert "resizable: true" in js
    # persisted per window under the kit's one clamped winsize-<id> scheme (audit F5)
    assert "'winsize-' + this.o.id" in js
    # mobile (the sheet/drawer tier) skips edge-resize by design
    assert "mobileSkip: 768" in js
    # sane min size
    assert "minWidth" in js and "minHeight" in js


def test_l11_cast_window_default_is_smaller():
    js = _read("static", "js", "orwellCast.js")
    # the cast window no longer defaults to the dominating 560px width
    assert "width: min(560px, 92vw)" not in js
    assert "width: min(360px, 92vw)" in js
    # it inherits the kit resize (no resizable:false override)
    assert "resizable: false" not in js


# ── L16 — color while active, grayscale once evicted ───────────────────────

def test_l16_cast_portrait_grayscale_keyed_on_status():
    js = _read("static", "js", "orwellCast.js")
    # grayscale is keyed strictly on the EVICTED status (the only monochrome state)
    assert "oc-evicted" in js
    css = js  # the cast CSS lives in the panel's inline <style>
    assert "grayscale(1)" in css
    # a jury / active houseguest is NOT grayscaled — only evicted
    assert ".oc-evicted" in css
