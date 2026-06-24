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


# ── L12 — pin the cast window into the gadget rail as a compact gadget ──────

def test_l12_cast_pin_gadget_registers_in_rail():
    js = _read("static", "js", "orwellCastPin.js")
    # #640: composes the OrwellGadget kit, which mounts it into the 0054 gadget rail body
    assert "OrwellGadgetKit.create(" in js
    # sourced from the cast roster
    assert "/api/orwell/roster" in js
    # two small portraits side by side (the compact gadget)
    assert "ocp-portraits" in js and "ocp-face" in js
    # persisted pinned state (per-user)
    assert "orwell-cast-pinned" in js
    # game-build gated like the rail
    assert "data-game-build" in js
    # exposes the pin/un-pin seam the cast window calls
    assert "OrwellCastPin" in js and "setPinned" in js


def test_l12_pin_affordance_in_cast_window_and_persisted():
    js = _read("static", "js", "orwellCast.js")
    # a pin control + a close seam the gadget uses
    assert "oc-pin" in js
    assert "OrwellCastPin" in js
    assert "_orwellCastClose" in js


def test_l12_pin_gadget_loaded_and_ordered():
    html = _read("static", "index.html")
    assert "orwellCastPin.js" in html
    css = _read("static", "style.css")
    # the docked cast gadget has a canonical stacking order in the rail body
    assert ".gadget-rail-body > #orwell-cast-pin" in css


# ── L13 — drag-reorder the gadgets in the rail; order persists ─────────────

def test_l13_rail_supports_drag_reorder():
    js = _read("static", "js", "orwellGadgetRail.js")
    # Reorder happens in an explicit EDIT mode (iOS-jiggle / HASS-dashboard style), entered by a
    # long-press OR the header's Rearrange button — NOT a persistent hover grip (which overlapped +
    # blocked gadget content). One unified gesture for touch + mouse via Pointer Events.
    assert "data-edit" in js                                # the edit-mode flag on the rail
    assert "gadget-rail-rearrange" in js                    # the discoverable Rearrange/Done toggle
    assert "pointerdown" in js and "pointermove" in js and "pointerup" in js   # touch+mouse drag
    assert "dragstart" not in js and "dragover" not in js   # the old touch-broken HTML5 DnD is gone
    # persisted order, per-user, like the rail's existing persisted layout
    assert "orwell-gadget-order" in js
    # the public reorder seam
    assert "OrwellGadgetRail" in js and "reorder" in js


def test_l13_reorder_keeps_accessibility():
    js = _read("static", "js", "orwellGadgetRail.js")
    # No persistent overlay grip (it covered content). The Rearrange control + gadgets carry labels,
    # and keyboard reorder (↑/↓ on a focused gadget in edit mode) is preserved.
    assert ".grail-drag {" not in js                        # the old absolute overlay-grip button is gone
    assert "aria-label" in js
    assert "ArrowUp" in js and "ArrowDown" in js
    # reduced-motion users get a steady outline instead of the wiggle
    assert "prefers-reduced-motion" in js
    # Escape is NOT handled per-surface (flows through ui.js's arbiter — F3 ratchet)
    assert '"Escape"' not in js and "'Escape'" not in js


# ── L16 — color while active, grayscale once evicted ───────────────────────

def test_l16_cast_portrait_grayscale_keyed_on_status():
    js = _read("static", "js", "orwellCast.js")
    # grayscale is keyed strictly on the EVICTED status (the only monochrome state)
    assert "oc-evicted" in js
    css = js  # the cast CSS lives in the panel's inline <style>
    assert "grayscale(1)" in css
    # a jury / active houseguest is NOT grayscaled — only evicted
    assert ".oc-evicted" in css


def test_l16_pin_gadget_grayscales_evicted_too():
    js = _read("static", "js", "orwellCastPin.js")
    # the compact rail gadget honors the same color/B&W eviction rule
    assert "grayscale(1)" in js
    assert "ocp-evicted" in js
    assert 'status === "evicted"' in js
