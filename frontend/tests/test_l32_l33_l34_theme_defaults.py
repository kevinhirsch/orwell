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

L34 — the frosted TITLE BAR uses the SAME translucent + backdrop-blur treatment
      as the frosted body (not a solid fill), cohesively across EVERY window —
      fixed at the kit / shared-CSS level so all Lane-F (.ow-*) windows inherit it.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


# ── L32: telescreen is the default theme ──────────────────────────────────────

def test_l32_default_theme_is_telescreen():
    js = _read("static", "js", "theme.js")
    assert re.search(r"const DEFAULT_THEME\s*=\s*'telescreen'\s*;", js), \
        "DEFAULT_THEME must be 'telescreen' (the unset-preference fallback)"
    # No stray re-assignment back to the old 'dark' default.
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


def test_l32_first_paint_head_script_defaults_to_telescreen():
    # The early head-script must synthesize the telescreen palette when nothing
    # is stored so the first frame is already on-brand (no flash to :root).
    html = _read("static", "index.html")
    assert "if (!t || !t.colors) {" in html, \
        "head-script must fall back to a default theme when none is stored"
    m = re.search(r"if \(!t \|\| !t\.colors\) \{(.*?)\}\s*\n\s*if \(t && t\.colors\)", html, re.S)
    assert m, "could not locate the head-script default-theme fallback block"
    block = m.group(1)
    assert "name: 'telescreen'" in block
    assert "#101418" in block and "#d7e9ee" in block, \
        "the head-script default must carry the telescreen palette"
    # And it ships frosted ON.
    assert "frosted: true" in block


# ── L33: frosted is ON by default on every theme ──────────────────────────────

def test_l33_default_frosted_resolver_defaults_on():
    js = _read("static", "js", "theme.js")
    assert "function defaultFrostedFor(" in js, \
        "frosted default must be resolved through defaultFrostedFor()"
    m = re.search(r"function defaultFrostedFor\([^)]*\)\s*\{(.*?)\}", js, re.S)
    assert m, "defaultFrostedFor body not found"
    body = m.group(1)
    # Returns true unless the theme is explicitly in the opt-out map.
    assert "!== true" in body, \
        "defaultFrostedFor must default to ON (true) for any theme not opted out"
    # The old false-default lookup (only `lavender` was ON) must be gone.
    assert "THEME_DEFAULT_FROSTED[" not in js, \
        "the old false-by-default frosted map must be removed"


def test_l33_every_theme_resolves_frosted_on_by_default():
    # Simulate defaultFrostedFor() for each preset: with an empty opt-out map,
    # every theme resolves ON. This pins the *behavior*, not just the source.
    js = _read("static", "js", "theme.js")
    off_map = re.search(r"const THEME_DEFAULT_FROSTED_OFF\s*=\s*\{([^}]*)\}", js).group(1)
    opted_out = set(re.findall(r"(\w+)\s*:\s*true", off_map))
    assert opted_out == set(), \
        "no theme should ship frosted-OFF by default for L33 (opt-out map must be empty)"
    body = re.search(r"export const THEMES = \{(.*?)\n\};", js, re.S).group(1)
    themes = re.findall(r"^\s*'?([a-zA-Z0-9-]+)'?:\s*\{", body, re.M)
    assert "telescreen" in themes and len(themes) >= 5
    for name in themes:
        # defaultFrostedFor(name) === (off_map[name] !== true) === True here.
        assert name not in opted_out, f"{name} unexpectedly defaults frosted-off"


def test_l33_boot_and_swatch_paths_use_the_resolver():
    js = _read("static", "js", "theme.js")
    # Boot/restore fallback.
    assert "defaultFrostedFor(saved ? saved.name : DEFAULT_THEME)" in js
    # Swatch-click fallback.
    assert ": defaultFrostedFor(name);" in js


def test_l33_explicit_toggle_off_is_persisted():
    # With frosted default ON, an explicit OFF must be written as `frosted:false`
    # so the opt-out wins on reload (otherwise the default-on fallback re-enables).
    js = _read("static", "js", "theme.js")
    assert "if (opts.frosted !== undefined) obj.frosted = !!opts.frosted;" in js, \
        "save() must persist the explicit frosted boolean (incl. false)"
    # The old write-only-on-true serialization must be gone.
    assert "if (opts.frosted) obj.frosted = true;" not in js
    # The custom-theme serializer already records the explicit boolean.
    assert "if (opts.frosted !== undefined) entry.frosted = !!opts.frosted;" in js


def test_l33_head_script_defaults_frosted_on_for_any_theme():
    html = _read("static", "index.html")
    assert "var _frosted = (t.frosted !== undefined) ? !!t.frosted : true;" in html, \
        "the first-paint frosted default must be ON when unset"
    assert "document.body.classList.add('theme-frosted');" in html


# ── L34: the frosted title bar is glass, not a solid block, on every window ────

def test_l34_kit_window_frosts_under_theme_frosted():
    css = _read("static", "style.css")
    block = _frosted_bg_block(css)
    # The .ow-window kit frame frosts identically to the modal family — without
    # this the kit window keeps its solid --win-bg and reads as an opaque block.
    assert "body.theme-frosted .ow-window" in block
    # It uses the translucent + blur treatment, not a solid fill.
    assert "color-mix(in srgb, var(--panel" in block
    assert "backdrop-filter: blur(24px)" in block


def test_l34_kit_titlebar_uses_the_frosted_treatment_not_a_solid_fill():
    css = _read("static", "style.css")
    # The header-neutralization rule (shared by .modal-header) must also cover
    # the kit titlebar so the header is glass (translucent + blur), not opaque.
    m = re.search(
        r"(body\.theme-frosted \.modal-header,[^{]*body\.theme-frosted \.ow-titlebar\s*\{[^}]*\})",
        css, re.S)
    assert m, ".ow-titlebar must share the .modal-header frosted-header rule"
    rule = m.group(1)
    # Translucent — NOT a solid panel/win-bg fill — plus the body's blur.
    assert "background-color: transparent !important;" in rule
    assert "background-image: none !important;" in rule
    assert "backdrop-filter: blur(24px) !important;" in rule
    # Guard: the titlebar must NOT carry a solid var(--panel)/--win-bg fill.
    assert "var(--panel)" not in rule and "var(--win-bg)" not in rule


def test_l34_gadget_rail_frosts_too():
    css = _read("static", "style.css")
    block = _frosted_bg_block(css)
    assert "body.theme-frosted .gadget-rail" in block, \
        "the control-room gadget rail must frost with the rest of the chrome (L34)"


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
