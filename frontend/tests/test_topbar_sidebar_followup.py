"""Follow-up cleanup: chat-top-bar + sidebar/icon-rail coherence (#795, #796, #800).

Source-pinned guards so a future edit can't silently re-introduce the three
owner-reported defects. No network/engine; roles only.

  #795 — the top-center conversation "More" caret DROPDOWN is gone; the only
         conversation affordance is a single PENCIL that renames the CURRENT
         conversation inline (the existing rename flow, one shared implementation).

  #796 — the collapsed icon-rail mirrors the EXPANDED sidebar's available SET,
         not just the same glyphs: syncRailIcons gates each rail button's
         visibility to its source row's (collapse-aware), so a row hidden in the
         expanded sidebar is hidden in the rail and vice-versa.

  #800 — on mobile both sidebars behave as real drawers AND their two expand
         icons (the nav hamburger + the gadget/control-room opener) FOLD INTO the
         conversation title bar as consistent kit line icons, vertically centered
         on the title row.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


CSS = _read("static", "style.css")
INDEX = _read("static", "index.html")
APP_JS = _read("static", "app.js")
LAYOUT_JS = _read("static", "js", "sidebar-layout.js")


def _chat_meta_overlay():
    """The .chat-meta-overlay span in the chat-top-bar (the top-center element)."""
    m = re.search(r'<div class="chat-meta-overlay">.*?</div>', INDEX, re.S)
    assert m, "the chat-meta-overlay is missing from index.html"
    return m.group(0)


# ── #795: pencil replaces the caret dropdown ─────────────────────────────────

def test_topbar_has_no_conversation_dropdown_switcher():
    overlay = _chat_meta_overlay()
    # The caret "More" dropdown and its menu must be gone from the top-center element.
    assert 'id="export-dl-btn"' not in overlay, (
        "#795: the top-center caret 'More' dropdown trigger (#export-dl-btn) must be "
        "removed — no dropdown switcher in the conversation title bar."
    )
    assert 'id="export-dropdown-menu"' not in overlay, (
        "#795: the top-center dropdown menu (#export-dropdown-menu) must be removed."
    )
    assert 'export-dropdown-wrap' not in overlay, (
        "#795: the dropdown wrapper must be removed from the title bar."
    )


def test_topbar_has_a_rename_pencil():
    overlay = _chat_meta_overlay()
    assert 'id="topbar-rename-btn"' in overlay, (
        "#795: the title bar must carry a single pencil affordance (#topbar-rename-btn)."
    )
    # The pencil is a kit line icon (currentColor stroke, no fill).
    btn = re.search(r'<button[^>]*id="topbar-rename-btn".*?</button>', overlay, re.S).group(0)
    assert 'stroke="currentColor"' in btn, "the pencil must be a currentColor line icon."
    assert 'fill="none"' in btn, "the pencil must be a line icon (fill=none)."
    assert "<svg" in btn, "the pencil must render an inline svg glyph."


def test_pencil_triggers_the_shared_inline_rename():
    # One shared implementation, exposed as a seam, wired to the pencil + the title text.
    assert "_renameCurrentConversation" in APP_JS, (
        "#795: the inline rename must be a single shared function (_renameCurrentConversation)."
    )
    assert "window._renameCurrentConversation" in APP_JS, "the rename seam must be exposed."
    assert re.search(
        r"el\('topbar-rename-btn'\)", APP_JS
    ), "#795: app.js must wire #topbar-rename-btn."
    # It reuses the existing rename flow (PATCH the current session's name).
    rename = APP_JS[APP_JS.index("function _renameCurrentConversation"):]
    rename = rename[: rename.index("window._renameCurrentConversation")]
    assert "session-rename-input" in rename, "rename reuses the existing inline-rename input class."
    assert "getCurrentSessionId" in rename, "rename targets the CURRENT conversation."
    assert "method: 'PATCH'" in rename, "rename persists via the session PATCH endpoint."


# ── #796: the rail mirrors the expanded sidebar's set ────────────────────────

def test_sync_gates_static_rail_buttons_to_their_row_visibility():
    sync = LAYOUT_JS[LAYOUT_JS.index("export function syncRailIcons"):]
    sync = sync[: sync.index("function _initRailIconSource")]
    assert "_rowVisible" in sync, (
        "#796: syncRailIcons must consult a row-visibility check so the rail shows the "
        "SAME SET the expanded sidebar shows (not just the same glyphs)."
    )
    # Pass 1 (static buttons) sets display from the row's visibility.
    assert re.search(r"btn\.style\.display\s*=\s*_rowVisible\(src\)\s*\?\s*''\s*:\s*'none'", sync), (
        "#796: each static rail button mirrors its source row's visibility."
    )


def test_row_visibility_is_collapse_aware():
    assert "function _rowVisible" in LAYOUT_JS
    fn = LAYOUT_JS[LAYOUT_JS.index("function _rowVisible"):]
    fn = fn[: fn.index("\n}") + 2]
    # The rail is shown precisely WHEN the sidebar is collapsed; the check must not read
    # the collapse as a genuine hide — it lifts .hidden for the measurement and restores it.
    assert "classList.remove('hidden')" in fn and "classList.add('hidden')" in fn, (
        "#796: _rowVisible must measure independently of the sidebar's own collapse "
        "(lift .hidden, measure, restore) so collapse-cascaded display:none isn't "
        "mistaken for a genuinely hidden row."
    )
    # Walks ancestors up to the .sidebar root checking display/visibility.
    assert "getComputedStyle" in fn and "display" in fn


def test_feature_gate_resyncs_the_rail():
    # The admin feature-flag pass may hide/show rows after first sync; it must re-sync the
    # rail so the collapsed rail can't drift out of step with the expanded sidebar.
    feat = APP_JS[APP_JS.index("Feature visibility"):]
    feat = feat[: feat.index(".catch(() => {});")]
    assert "_railIconsSync" in feat, (
        "#796: after the feature pass re-applies UI visibility, the rail must be re-synced "
        "so it mirrors the final expanded-sidebar set."
    )


# ── #800: mobile title-bar expand icons + real sidebars ──────────────────────

def _mobile_block_with(*needles):
    """Return True iff some @media(max-width:768px) block contains all needles."""
    for m in re.finditer(r"@media \(max-width:\s*768px\)\s*\{", CSS):
        start = m.end()
        depth = 1
        i = start
        while i < len(CSS) and depth:
            if CSS[i] == "{":
                depth += 1
            elif CSS[i] == "}":
                depth -= 1
            i += 1
        block = CSS[start:i]
        if all(n in block for n in needles):
            return True
    return False


def test_mobile_expand_icons_share_a_titlebar_anchor():
    # Both the nav hamburger and the gadget opener are anchored to the same title-bar row.
    assert "--ow-titlebar-top" in CSS, (
        "#800: a shared title-bar anchor (--ow-titlebar-top) must position both expand icons."
    )
    assert _mobile_block_with(".hamburger-btn", "gadget-rail-open", "--ow-titlebar-top"), (
        "#800: on mobile both #hamburger-btn and .gadget-rail-open must use the shared "
        "title-bar anchor so they fold INTO the conversation title bar, aligned to each "
        "other and to the centered title."
    )


def test_mobile_expand_icons_are_consistent_line_icons():
    # Same visual language: both render currentColor line-icon svgs at a shared size.
    assert _mobile_block_with(".hamburger-btn svg", ".gadget-rail-open svg", "stroke: currentColor"), (
        "#800: the two expand icons must share one kit line-icon language (currentColor svg)."
    )


def test_mobile_titlebar_reserves_corner_gutters():
    # The bar gives itself a real title-bar height and reserves the corner-control gutters
    # so the folded icons read as part of the bar, not free-floating FABs.
    assert "--ow-titlebar-h" in CSS, "#800: the mobile title bar declares a defined height."
    assert _mobile_block_with(".chat-top-bar", "--ow-titlebar-h"), (
        "#800: the mobile .chat-top-bar must adopt the title-bar height."
    )


def test_mobile_sidebars_are_real_slide_in_drawers():
    # Nav sidebar: a fixed slide-over with a translateX toggle + a backdrop.
    assert _mobile_block_with(".sidebar", "position: fixed", "transform: translateX(-100%)"), (
        "#800: the nav sidebar must be a real mobile slide-in drawer (fixed + translateX)."
    )
    assert _mobile_block_with("#sidebar-backdrop", "position: fixed"), (
        "#800: the nav sidebar drawer must have a dimming backdrop on mobile."
    )
    # Gadget rail: a fixed right-edge slide-over drawer toggled by .grail-open.
    assert _mobile_block_with(".gadget-rail", "position: fixed", "grail-open"), (
        "#800: the gadget/control-room rail must be a real mobile slide-over drawer."
    )


# ── APP-OV-3: the DESKTOP frosted top bar floats (rounded all corners, off the top edge) ─────
#
# Owner report (frosted theme, live game, desktop): the centered session-title bar rendered as an
# OVERSIZED rounded capsule whose SQUARE top edge sat flush against the very top of the viewport —
# the big bottom-only glass radius (0 0 26px 26px) on the ~30px-tall full-width strip made it look
# like a pill sliced off at the top / bleeding above the fold. The fix (style.css) is a desktop-only
# (@media min-width:769px) frosted rule that lifts the bar a few px off the container top (positive
# margin-top → the rounded top corners clear the overflow-hidden chat container, no longer clipped)
# and rounds ALL FOUR corners at a moderate, correctly-sized radius so it floats like every other
# frosted chrome surface. Mobile keeps its own -31px corner-control geometry + flush app-bar radius.

def _desktop_block_with(*needles):
    """Return the FIRST @media(min-width:769px) block body that contains all needles, else None."""
    for m in re.finditer(r"@media \(min-width:\s*769px\)\s*\{", CSS):
        start = m.end()
        depth, i = 1, start
        while i < len(CSS) and depth:
            if CSS[i] == "{":
                depth += 1
            elif CSS[i] == "}":
                depth -= 1
            i += 1
        block = CSS[start:i]
        if all(n in block for n in needles):
            return block
    return None


def test_desktop_frosted_topbar_floats_rounded_off_the_top_edge():
    block = _desktop_block_with("body.theme-frosted .chat-top-bar", "margin-top", "border-radius")
    assert block, (
        "APP-OV-3: expected a DESKTOP (@media min-width:769px) `body.theme-frosted .chat-top-bar` "
        "rule setting both margin-top and border-radius (the floating-bar fix)."
    )
    rule = re.search(
        r"body\.theme-frosted \.chat-top-bar\s*\{([^{}]*)\}", block
    ).group(1)
    # A positive top gap — the bar sits BELOW the viewport top (never flush / clipped / above-fold),
    # and never the mobile -31px pull-up.
    mt = re.search(r"margin-top:\s*([\-\d.]+)px", rule)
    assert mt and float(mt.group(1)) > 0, (
        "APP-OV-3: the desktop frosted top bar must have a POSITIVE margin-top so its rounded top "
        "clears the top edge and it doesn't read as clipped / bleeding above the fold."
    )
    # ALL four corners rounded — NOT the chopped bottom-only `0 0 X X` capsule.
    br = re.search(r"border-radius:\s*([^;]+);", rule).group(1).strip()
    assert not br.startswith("0 0"), (
        "APP-OV-3: the desktop frosted top bar must round ALL corners — a bottom-only `0 0 X X` "
        "radius on the flush strip is exactly the oversized-capsule-clipped-at-top look."
    )


def test_desktop_frosted_topbar_fix_does_not_touch_mobile():
    # The geometry override is desktop-scoped: the mobile (≤768px) bar keeps its -31px corner-control
    # pull-up and its own flush app-bar radius — the fix must NOT appear in a max-width:768px block.
    assert not _mobile_block_with("body.theme-frosted .chat-top-bar", "border-radius: var(--ow-radius-inner"), (
        "APP-OV-3: the floating-bar radius override must stay DESKTOP-only — the narrow bar keeps "
        "its own corner-control geometry."
    )
