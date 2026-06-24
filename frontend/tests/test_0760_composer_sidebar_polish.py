"""#760 — composer & sidebar chrome polish (Liquid Glass), SOURCE-PINS.

Three owner-reported chrome defects, each pinned so a future edit can't silently
re-introduce them:

  A. Stray white-line artifacts under glass.
     - The frosted COMPOSER (.chat-input-bar) inherits the shared chrome-glass
       rule's bright `inset 0 1px 0 rgba(255,255,255,0.65)` top rim, which reads as
       a hard ruled line under the placeholder. A composer-scoped override softens
       that inset rim WELL down (a faint luminous bloom, Apple-correct) at BOTH the
       frosted and full-glass tiers.
     - The SIDEBAR brand/header carry no hard divider, and the sidebar's frosted
       rim is softened in-region.
  B. The default user avatar paints an intentional state when no headshot exists —
     orwellAvatar.js injects an Apple-style monochrome person glyph (or keeps the
     app's initial letter) for BOTH the user-bar and the settings-account circle.
  C. Exactly ONE attach paperclip in the composer: the game build promotes attach
     to the first-class composer paperclip and DROPS the duplicate overflow-tray
     "Attach files" entry (the cascade then hides the now-empty chevron).

Source-pinned (no network/engine). Roles only.
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
AVATAR_JS = _read("static", "js", "orwellAvatar.js")


# ── A. white-line softening ───────────────────────────────────────────────────

def _rim_alpha(block: str):
    """Highest white inset-rim alpha (rgba(255,255,255,A)) in a CSS block, or None."""
    alphas = [float(a) for a in re.findall(r"rgba\(255,\s*255,\s*255,\s*([0-9.]+)\)", block)]
    return max(alphas) if alphas else None


def test_composer_frosted_rim_is_softened_not_a_hard_rule():
    # The #760 composer override must exist and bound the white inset rim well below
    # the shared chrome rule's 0.65 hairline (Apple edges are a soft bloom).
    m = re.search(
        r"body\.theme-frosted\s+\.chat-input-bar\s*\{[^}]*\}",
        CSS[CSS.index("#760 composer edge softening"):],
        re.S,
    )
    assert m, "missing the #760 composer-scoped frosted override"
    alpha = _rim_alpha(m.group(0))
    assert alpha is not None, "composer override should define a (soft) white rim"
    assert alpha <= 0.25, f"composer top rim still reads as a hard line (alpha={alpha})"


def test_composer_full_glass_rim_is_softened_too():
    m = re.search(
        r"body\.glass-full\s+\.chat-input-bar\s*\{[^}]*\}",
        CSS[CSS.index("#760 composer edge softening"):],
        re.S,
    )
    assert m, "missing the #760 composer full-glass override"
    alpha = _rim_alpha(m.group(0))
    assert alpha is not None and alpha <= 0.25, "full-glass composer rim not softened"


def test_sidebar_brand_band_carries_no_hard_divider():
    # belt-and-braces pin: the brand/header explicitly carry no border/box-shadow
    # divider under the glass theme (the line "below Orwell" can't come from here).
    seg = CSS[CSS.index("#760 sidebar brand-band edge softening"):]
    m = re.search(
        r"body\.theme-frosted\s+\.sidebar-header,\s*"
        r"body\.theme-frosted\s+\.sidebar-brand,\s*"
        r"body\.theme-frosted\s+\.sidebar-brand-title\s*\{[^}]*\}",
        seg, re.S,
    )
    assert m, "missing the #760 brand/header divider-removal pin"
    assert "box-shadow: none" in m.group(0) and "border: none" in m.group(0)


def test_sidebar_frosted_rim_is_softened():
    seg = CSS[CSS.index("#760 sidebar brand-band edge softening"):]
    m = re.search(r"body\.theme-frosted\s+#sidebar\s*\{[^}]*\}", seg, re.S)
    assert m, "missing the #760 sidebar-scoped rim override"
    alpha = _rim_alpha(m.group(0))
    assert alpha is not None and alpha <= 0.25, "sidebar rim not softened below a hard line"


# ── B. default avatar glyph ───────────────────────────────────────────────────

def test_avatar_js_defines_a_default_person_glyph():
    # an inline SVG person glyph so an empty circle never reads as a broken image.
    assert "PERSON_GLYPH" in AVATAR_JS
    assert "<svg" in AVATAR_JS and "ow-avatar-glyph" in AVATAR_JS


def test_avatar_js_paints_default_when_no_headshot():
    # the no-headshot branch must paint the default (glyph or kept initial), not a no-op.
    assert "applyDefault" in AVATAR_JS
    # keeps an app-painted initial if present; else injects the glyph.
    assert "hasInitial" in AVATAR_JS
    assert "innerHTML = PERSON_GLYPH" in AVATAR_JS or "innerHTML=PERSON_GLYPH" in AVATAR_JS


def test_avatar_js_covers_both_circles():
    # the user-bar AND the settings-account circle.
    assert "user-bar-avatar" in AVATAR_JS
    assert "settings-account-avatar" in AVATAR_JS


def test_avatar_glyph_hidden_once_a_headshot_loads():
    # a finalized headshot must remove/hide the glyph (no glyph over a real photo).
    assert ".ow-has-avatar .ow-avatar-glyph{display:none}" in AVATAR_JS


# ── C. exactly one attach paperclip ───────────────────────────────────────────

def test_game_build_drops_the_duplicate_tray_attach():
    # applyGameBuildMenuGating must remove #overflow-attach-btn under the game build
    # so the first-class composer paperclip is the ONLY attach entry point.
    gate = APP_JS[APP_JS.index("function applyGameBuildMenuGating"):]
    gate = gate[: gate.index("_g13CascadeMenuTriggers();") + 40]
    assert "overflow-attach-btn" in gate
    assert "remove()" in gate
    assert "data-game-build" in gate


def test_cascade_hides_the_now_empty_chevron():
    # the existing cascade (re-run after the gating pass) hides a launcher whose
    # menu has zero visible items — i.e. the chevron disappears once attach is gone.
    assert "_g13CascadeMenuTriggers" in APP_JS
    cascade = APP_JS[APP_JS.index("function _g13CascadeMenuTriggers"):]
    cascade = cascade[: cascade.index("}\n}") + 3] if "}\n}" in cascade else cascade[:1200]
    assert "overflow-plus-btn" in cascade and "overflow-menu" in cascade


def test_composer_first_class_paperclip_still_wired_to_file_input():
    # the surviving attach control still opens the file picker (attach must not break).
    assert "composer-attach-btn" in APP_JS
    # the wiring block resolves the button, then clicks the hidden file-input.
    assert "_composerAttach" in APP_JS
    seg = APP_JS[APP_JS.index("_composerAttach = el('composer-attach-btn')"):]
    seg = seg[:400]
    assert "file-input" in seg and "click()" in seg


def test_file_input_present_for_attach_and_dragdrop():
    # the hidden <input type=file> the paperclip + drag-drop both feed.
    assert re.search(r'<input[^>]*type="file"[^>]*id="file-input"', INDEX)


def test_only_one_visible_attach_affordance_in_markup():
    # the composer markup still defines exactly one first-class paperclip button id.
    assert INDEX.count('id="composer-attach-btn"') == 1
