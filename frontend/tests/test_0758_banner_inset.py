"""#758 — a top system-banner must RESERVE space and COMPRESS the app below it, never overlay it.

The banner host (orwellNotice.js, the #orwell-notice-banner) is position:fixed; top:0; the only
compensation used to be `body padding-top` + the `--on-banner-inset` CSS var. But `body padding-top`
re-flows ONLY in-flow content (the chat column + the relative-flow desktop sidebar/rail) — it cannot
move position:fixed chrome. So before this fix every consumer of `--on-banner-inset` was absent: a
top-slotted OrwellWindow, the mobile rail/sidebar drawers, and the top-corner controls all rendered
UNDERNEATH the banner.

Desired (owner): "A window should never be under a notification. The notification pushes everything
that's on top of the bg down and compresses it vertically." → the whole fixed-chrome layer consumes
the inset for BOTH its top-offset AND its height, so it sits below the banner and compresses into the
remaining viewport (never clipped / shifted off the bottom).

These are SOURCE-PIN convention checks (the render proof is in scripts/responsive_matrix.py): the
window kit + the slot engine + the gadget rail must READ the inset, and orwellNotice.js must SET it
and BROADCAST a change signal so the fixed layer can re-place on banner show/hide.
"""
import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS_DIR = os.path.join(FRONTEND, "static", "js")
CSS = os.path.join(FRONTEND, "static", "style.css")

INSET_VAR = "--on-banner-inset"
INSET_EVENT = "orwell:banner-inset"


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


# ── orwellNotice.js: SETS the inset AND broadcasts the change signal ──────────────────────────
def test_notice_sets_inset_and_broadcasts_change():
    js = _read("static", "js", "orwellNotice.js")
    # it still reserves the height (the in-flow path) on set, releases on clear
    assert "setBannerInset" in js and "clearBannerInset" in js
    assert INSET_VAR in js
    assert "paddingTop" in js
    # #758: a CSS-var change fires no event, so the banner must broadcast a window signal on
    # set/clear so the FIXED-chrome layer (windows, slot engine, rail) can re-place.
    assert INSET_EVENT in js, (
        "orwellNotice.js must dispatch the '%s' window event when the banner inset changes — "
        "otherwise the fixed-chrome layer can't re-place on banner show/hide (#758)." % INSET_EVENT
    )
    # the broadcast must be wired into BOTH set and clear (show / hide-or-copy-change paths).
    set_i = js.index("function setBannerInset")
    clear_i = js.index("function clearBannerInset")
    emit_i = js.index("function _emitBannerInset")
    # set + clear each reference the emitter, and it dispatches a CustomEvent of the inset event.
    assert "_emitBannerInset" in js[set_i:clear_i], "setBannerInset must emit the inset-change signal."
    assert "_emitBannerInset" in js[clear_i:emit_i], "clearBannerInset must emit the inset-change signal."
    assert "dispatchEvent" in js[emit_i:] and INSET_EVENT in js[emit_i:]


# ── orwellWindow.js: the kit CONSUMES the inset (offset + height) and re-places on the signal ──
def test_window_kit_consumes_inset_for_top_and_height():
    js = _read("static", "js", "orwellWindow.js")
    # it reads the inset live from the CSS var (default 0)
    assert INSET_VAR in js, "orwellWindow.js must read %s." % INSET_VAR
    assert "getComputedStyle" in js and "getPropertyValue" in js
    assert "bannerInset" in js, "orwellWindow.js must define a bannerInset() reader (#758)."
    # the clamp top floor starts BELOW the banner (margin + inset), not bare margin
    assert "topFloor" in js, "the clamp/reclamp top floor must include the banner inset (#758)."
    # the shrink-to-fit (reclamp) subtracts the inset from the available height → windows COMPRESS
    assert "window.innerHeight - inset" in js, (
        "the reclamp max-height must subtract the banner inset so a tall window compresses "
        "rather than overrunning the bottom (#758)."
    )
    # it re-places every open window when the banner inset changes
    assert INSET_EVENT in js, (
        "orwellWindow.js must listen for '%s' and re-clamp open windows on banner show/hide (#758)." % INSET_EVENT
    )


# ── orwellSlots.js: the slot engine (the true top-base authority) consumes the inset ──────────
def test_slot_engine_consumes_inset_for_top_base_and_clamp():
    js = _read("static", "js", "orwellSlots.js")
    assert INSET_VAR in js and "bannerInset" in js, (
        "orwellSlots.js must read the banner inset — it owns the slot TOP_BASE + clamp where a "
        "top-slotted window's position is actually computed (#758)."
    )
    # the top anchor base + the clamp top floor both include the inset
    assert "TOP_BASE + bannerInset()" in js, "the slot top base must start below the banner (#758)."
    assert "topFloor" in js, "the slot clampPos top floor must include the banner inset (#758)."
    # re-stacks on the banner-inset change signal (and already on resize)
    assert INSET_EVENT in js, (
        "orwellSlots.js must re-stack on '%s' (banner show/hide shifts every top anchor) (#758)." % INSET_EVENT
    )


# ── the gadget rail drawer + the desktop hamburger consume the inset (CSS) ────────────────────
def test_gadget_rail_and_top_chrome_consume_inset_in_css():
    css = _read("static", "style.css")
    # the mobile rail slide-over drawer docks below the banner AND shrinks its height by the inset
    assert "calc(100dvh - var(--on-banner-inset, 0px))" in css or \
           "calc(100dvh - var(--on-banner-inset,0px))" in css, (
        "the mobile gadget-rail drawer must subtract the banner inset from its height so it docks "
        "below the banner and compresses (#758)."
    )
    # at least one fixed top-corner control (the hamburger) clears the banner via the inset
    assert "calc(12px + var(--on-banner-inset, 0px))" in css or \
           "calc(12px + var(--on-banner-inset,0px))" in css, (
        "fixed top-corner controls (hamburger / new-chat / incognito) must offset their top by the "
        "banner inset so they never hide under the banner (#758)."
    )
    # the mobile sidebar slide-over drawer also docks below the banner (top = inset)
    assert "top: var(--on-banner-inset, 0px)" in css or "top: var(--on-banner-inset,0px)" in css, (
        "the mobile sidebar / icon-rail drawers must dock below the banner (top = the inset) (#758)."
    )
