"""L32 / L33 / L34 — theme + frosted defaults and the frosted title bar.

Source-pinned, JS/HTML/CSS-as-text like the other FE chrome tests (the FE has no
DOM runtime in the pytest lane — the browser-smoke + responsive-matrix gates cover
the live DOM; here we pin the defaults and the CSS structure that drive them).

L32 — `telescreen` is the DEFAULT theme out of the box. A brand-new player, an
      unset preference, or a factory-reset / no-stored-theme session all resolve
      to `telescreen` (the on-brand 1984 surveillance look). An explicit SAVED
      choice still wins (getSaved() short-circuits the fallback).

L33 — `frosted` is ON by default on EVERY theme. An unset frosted preference
      resolves to ENABLED for all themes; an explicit toggle-off persists + wins.

L34 — the frosted TITLE BAR is translucent (not a solid fill), cohesively glass
      across EVERY window — fixed at the kit / shared-CSS level so all Lane-F
      (.ow-*) windows inherit it. A6 [frosted-top fix]: the non-sticky kit
      titlebar rides the .ow-window ROOT's single backdrop-filter (it carries
      none of its own) so the whole window frosts as one continuous surface and
      the frost no longer "breaks" into a mismatched band at the top edge.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


# ── L32: telescreen is the default theme ──────────────────────────────────────

def test_l32_default_theme_is_glass():
    js = _read("static", "js", "theme.js")
    assert re.search(r"const DEFAULT_THEME\s*=\s*'glass'\s*;", js), \
        "DEFAULT_THEME must be 'glass' (the color-agnostic Liquid Glass theme is the default)"
    # No stray re-assignment back to an older default.
    assert "const DEFAULT_THEME = 'telescreen'" not in js
    assert "const DEFAULT_THEME = 'dark'" not in js


def test_l32_telescreen_is_a_real_house_preset():
    js = _read("static", "js", "theme.js")
    body = re.search(r"export const THEMES = \{(.*?)\n\};", js, re.S).group(1)
    assert re.search(r"'telescreen':\s*\{[^}]*house:\s*true", body), \
        "telescreen must remain a defined house preset"


def test_l32_unset_preference_resolves_to_default_theme():
    # The boot/restore path picks DEFAULT_THEME when there is no saved theme.
    js = _read("static", "js", "theme.js")
    assert "const activeName = saved ? saved.name : DEFAULT_THEME;" in js
    assert "saved ? saved.colors : THEMES[DEFAULT_THEME];" in js
    # An explicit saved choice still wins (getSaved() returns it; the ternary
    # short-circuits on the saved branch).
    assert "const saved = getSaved();" in js


def test_l32_first_paint_head_script_defaults_to_glass():
    # The early head-script must synthesize the GLASS palette when nothing is
    # stored so the first frame is already the default theme (no flash to :root).
    html = _read("static", "index.html")
    assert "if (!t || !t.colors) {" in html, \
        "head-script must fall back to a default theme when none is stored"
    m = re.search(r"if \(!t \|\| !t\.colors\) \{(.*?)\}\s*\n\s*if \(t && t\.colors\)", html, re.S)
    assert m, "could not locate the head-script default-theme fallback block"
    block = m.group(1)
    assert "name: 'glass'" in block
    assert "#15171c" in block and "#eef1f4" in block, \
        "the head-script default must carry the glass palette"
    # And it ships at the Full Glass tier.
    assert "glassTier: 'full'" in block


# ── L33: frosted is ON by default on every theme ──────────────────────────────

def test_l33_glass_tier_resolver_defaults_to_frosted():
    # The 3-tier model (Full Glass ▸ Frosted ▸ Normal) replaces the frosted bool.
    # defaultGlassTierFor: the glass theme → 'full'; an explicit normal → 'normal';
    # every other theme → 'frosted' (keeps the glass material, drops the heavy
    # Chromium refraction).
    js = _read("static", "js", "theme.js")
    assert "function defaultGlassTierFor(" in js, \
        "the glass tier default must be resolved through defaultGlassTierFor()"
    m = re.search(r"function defaultGlassTierFor\([^)]*\)\s*\{(.*?)\n\}", js, re.S)
    assert m, "defaultGlassTierFor body not found"
    body = m.group(1)
    assert "name === 'glass'" in body and "'full'" in body
    assert "'normal'" in body and "return 'frosted'" in body, \
        "defaultGlassTierFor must default to 'frosted' for any non-glass theme"
    # The old frosted-bool resolver + opt-out map must be gone.
    assert "function defaultFrostedFor(" not in js
    assert "THEME_DEFAULT_FROSTED_OFF" not in js and "THEME_DEFAULT_FROSTED[" not in js


def test_l33_glass_is_first_and_only_full_by_default():
    # glass leads the picker (default + first); every OTHER preset defaults to the
    # 'frosted' tier (none ship 'normal'); only glass declares 'full'.
    js = _read("static", "js", "theme.js")
    body = re.search(r"export const THEMES = \{(.*?)\n\};", js, re.S).group(1)
    themes = re.findall(r"^\s*'?([a-zA-Z0-9-]+)'?:\s*\{", body, re.M)
    assert themes and themes[0] == "glass", "glass must be the FIRST theme (default + first in picker)"
    assert "telescreen" in themes and len(themes) >= 6
    # No preset ships flat (Normal) by default; exactly one ENTRY declares Full (glass).
    assert "glassTier: 'normal'" not in body and "glassTier:'normal'" not in body
    # match theme ENTRY lines only (a comment may also mention glassTier:'full').
    entry_full = re.findall(r"^\s*'?[a-zA-Z0-9-]+'?:\s*\{[^\n]*glassTier:\s*'full'", body, re.M)
    assert len(entry_full) == 1, f"only glass should default to Full Glass, got {entry_full}"


def test_l33_boot_and_swatch_paths_use_the_tier_resolver():
    js = _read("static", "js", "theme.js")
    # Boot/restore resolves the tier from the saved record (back-compat aware).
    assert "resolveGlassTier(saved, saved ? saved.name : DEFAULT_THEME)" in js
    # Swatch-click resolves the tier per selected theme.
    assert "resolveGlassTier(ct, name)" in js


def test_l33_glass_tier_is_persisted_with_backcompat():
    # The chosen tier persists as a string so it wins over the per-theme default on
    # reload; the legacy `frosted` bool is still READ (resolveGlassTier) for
    # back-compat but no longer WRITTEN.
    js = _read("static", "js", "theme.js")
    assert "if (opts.glassTier !== undefined) obj.glassTier = opts.glassTier;" in js, \
        "save() must persist the glass tier string"
    assert "if (opts.glassTier !== undefined) entry.glassTier = opts.glassTier;" in js, \
        "the custom-theme serializer must persist the glass tier"
    assert "function resolveGlassTier(" in js, "a back-compat tier reader must exist"
    # The old frosted-bool write must be gone.
    assert "if (opts.frosted !== undefined) obj.frosted = !!opts.frosted;" not in js


def test_l33_head_script_resolves_tier_and_adds_classes():
    # The first-paint head-script resolves the tier (saved glassTier → legacy
    # frosted → per-theme default) and applies the body classes before paint:
    # theme-frosted for full+frosted, glass-full for full only.
    html = _read("static", "index.html")
    assert "t.glassTier === 'full'" in html and "t.glassTier === 'frosted'" in html
    assert "t.frosted ? 'frosted' : 'normal'" in html  # legacy back-compat branch
    assert "document.body.classList.add('theme-frosted')" in html
    assert "document.body.classList.add('glass-full')" in html


# ── L34: the frosted title bar is glass, not a solid block, on every window ────

def test_l34_kit_window_frosts_under_theme_frosted():
    css = _read("static", "style.css")
    block = _frosted_bg_block(css)
    # The .ow-window kit frame frosts identically to the modal family — without
    # this the kit window keeps its solid --win-bg and reads as an opaque block.
    assert "body.theme-frosted .ow-window" in block
    # It uses the translucent + blur treatment, not a solid fill.
    assert "color-mix(in srgb, var(--panel" in block
    # Liquid-glass pass (2026-06-24): blur deepened for the refractive, content-obfuscating look.
    assert "backdrop-filter: blur(44px)" in block


def test_l34_a6_kit_titlebar_rides_the_root_frost_no_own_filter():
    css = _read("static", "style.css")
    # A6 [frosted-top fix]: the non-sticky kit titlebar must NOT carry its own
    # backdrop-filter. A child filter re-blurs the .ow-window root's already-
    # frosted glass and composites the top strip to a mismatched shade — the
    # visible "frost breaks at the top" band. The titlebar is transparent with
    # NO filter, so the single root backdrop-filter renders the whole window —
    # header included — as one cohesive glass surface.
    m = re.search(
        r"body\.theme-frosted \.ow-titlebar\s*\{([^}]*)\}", css, re.S)
    assert m, "the .ow-titlebar frosted rule must exist"
    rule = m.group(1)
    # Translucent — NOT a solid panel/win-bg fill.
    assert "background-color: transparent !important;" in rule
    assert "background-image: none !important;" in rule
    # A6: no OWN backdrop-filter — it rides the .ow-window root's single filter.
    assert "backdrop-filter: none !important;" in rule
    assert "-webkit-backdrop-filter: none !important;" in rule
    # Guard: the titlebar must NOT carry a solid var(--panel)/--win-bg fill, and
    # must NOT re-introduce its own blur (the A6 regression).
    assert "var(--panel)" not in rule and "var(--win-bg)" not in rule
    assert "blur(" not in rule


def test_frosted_game_build_modal_header_drops_own_filter():
    css = _read("static", "style.css")
    # UX audit ("gray bar behind the Peek button"): same failure as A6, but on the
    # modal family. body.theme-frosted .modal-header keeps its own backdrop-filter
    # (the full-workspace tool modals scroll under a sticky header and want the
    # masking), which re-blurs the modal-content root's already-frosted glass into a
    # mismatched band across the title strip. In the GAME BUILD the only frosted
    # headers are Settings + Theme (no scrolling tool modals), so the header must
    # drop its own filter and ride the single .modal-content root backdrop.
    m = re.search(
        r"body\[data-game-build\]\.theme-frosted \.modal-header\s*\{([^}]*)\}", css, re.S)
    assert m, "the game-build frosted .modal-header rule must exist"
    rule = m.group(1)
    assert "backdrop-filter: none !important;" in rule
    assert "-webkit-backdrop-filter: none !important;" in rule
    assert "blur(" not in rule, "the game-build header must NOT re-introduce its own blur"
    # The base (non-game) rule still carries the blur for the tool modals.
    base = re.search(r"body\.theme-frosted \.modal-header\s*\{([^}]*)\}", css, re.S)
    assert base and "backdrop-filter: blur(24px) !important;" in base.group(1), (
        "the base frosted modal-header keeps its blur — only the game build drops it."
    )


def test_l34_gadget_rail_is_not_glass_under_the_cards():
    # Apple layering rule (HIG Materials): Liquid Glass is ONE functional layer over
    # content — "glass cannot properly sample other glass." The control-room rail must
    # therefore NOT be its own glass panel UNDER the glass cards (that was glass-on-glass);
    # the rail is a transparent structural container and the CARDS are the single glass
    # tiles over the chat behind. (Was: the rail shared the .ow-window frost — double layer.)
    css = _read("static", "style.css")
    block = _frosted_bg_block(css)
    assert "body.theme-frosted .gadget-rail," not in block, \
        "the gadget rail must NOT share the frosted-glass panel rule (no glass-on-glass under the cards)"
    m = re.search(r"body\.theme-frosted \.gadget-rail\s*\{([^}]*)\}", css, re.S)
    assert m, "the gadget rail must have an explicit (transparent, non-glass) rule"
    rule = m.group(1)
    assert "background-color: transparent !important;" in rule
    assert "backdrop-filter: none !important;" in rule
    assert "-webkit-backdrop-filter: none !important;" in rule


def test_liquid_glass_gadget_cards_frost():
    # Liquid-glass pass (2026-06-24): each OrwellGadget kit card (.og-card) is its
    # own frosted pane under the frosted theme — translucent tint + its own blur +
    # a bright rim — so the control-room rail reads as stacked glass, not opaque tiles.
    css = _read("static", "style.css")
    m = re.search(r"body\.theme-frosted \.og-card\s*\{([^}]*)\}", css, re.S)
    assert m, "the .og-card must have a frosted-glass rule"
    rule = m.group(1)
    assert "color-mix(in srgb, var(--panel" in rule, "card must use a translucent tint, not a solid fill"
    assert "backdrop-filter: blur(" in rule, "card must carry its own backdrop blur (glass pane)"
    assert "inset 0 1px 0" in rule, "card must have the bright top rim (liquid-glass edge)"


def test_l34_kit_titlebar_has_no_solid_background_in_the_kit_css():
    # At the kit level the titlebar carries no background of its own (it rides
    # the window frame). So frosting the frame + neutralizing the header band is
    # all that's needed for a cohesive glass header — pin that the kit didn't
    # regress a solid titlebar fill.
    kit = _read("static", "js", "orwellWindow.js")
    bar = re.search(r"\.ow-titlebar\s*\{([^}]*)\}", kit).group(1)
    assert "background" not in bar, \
        "the kit .ow-titlebar must stay background-less (rides the frame)"


# ── helpers ───────────────────────────────────────────────────────────────────

def _frosted_bg_block(css):
    """The body of the main `body.theme-frosted ... { ... }` frosted-background
    rule (the multi-selector list that tints + blurs panels/modals/windows)."""
    start = css.index("body.theme-frosted #sidebar")
    end = css.index("}", css.index("background-color", start))
    return css[start:end + 1]
