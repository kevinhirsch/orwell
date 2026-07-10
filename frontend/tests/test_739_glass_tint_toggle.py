"""#739 (Liquid Glass epic #738, item #2) — the "Clear vs Tinted" glass toggle.

Apple shipped Settings -> Display & Brightness -> Liquid Glass -> {Clear, Tinted}
in iOS 26.1: a taste/legibility control that raises the OPACITY + contrast of the
glass while KEEPING the material, distinct from the a11y reduce-transparency kill-
switch. This adds the app's equivalent as a THIRD, orthogonal glass state:

  * DEFAULT is Clear (colorless — the #738 colorless-material default).
  * Tinted is strictly OPT-IN and applied via a single body-STATE class
    (body.theme-tinted), NOT a per-element sweep, driven off ONE --ow-glass-opacity
    design token so it flips every kit surface from one place.
  * The picker lives in the existing appearance/theme settings UI, defaults to
    Clear, and PERSISTS in the FE theme store (round-tripped on load + synced via
    /api/prefs/theme like the glass TIER).

Source-pinned, JS/HTML/CSS-as-text like the other FE chrome/settings-wiring gates
(the pytest lane has no DOM runtime; the browser-smoke + responsive matrix cover
the live DOM). We pin: the token mechanism, the body-state class, the picker
markup, the default-Clear behaviour, and the persist + apply-on-load wiring.
"""

import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


# ── CSS: the single --ow-glass-opacity token + the body.theme-tinted state ───────

def test_glass_opacity_token_is_defined_at_the_clear_default():
    css = _read("static", "style.css")
    # The one token the tint mechanism flips, defaulting to the kube 0.60 (Clear).
    assert re.search(r"--ow-glass-opacity:\s*0\.60\s*;", css), (
        "#739: a single --ow-glass-opacity token must default to 0.60 (the Clear, "
        "colorless kube fill) so Tinted is a one-edit flip"
    )


def test_fill_tokens_derive_from_the_single_opacity_token():
    css = _read("static", "style.css")
    # Both fill tokens must READ --ow-glass-opacity so raising it in one place
    # re-flows to every glass surface (no per-element sweep).
    assert re.search(
        r"--ow-glass-light-color:\s*rgba\(255,\s*255,\s*255,\s*var\(--ow-glass-opacity\)\)",
        css,
    ), "#739: --ow-glass-light-color must derive from var(--ow-glass-opacity)"
    assert "calc(var(--ow-glass-opacity) + 0.02)" in css, (
        "#739: --ow-glass-light-fill top stop must derive from var(--ow-glass-opacity)"
    )
    assert "calc(var(--ow-glass-opacity) - 0.08)" in css, (
        "#739: --ow-glass-light-fill bottom stop must derive from var(--ow-glass-opacity)"
    )


def test_tinted_is_a_body_state_class_that_raises_the_opacity_token():
    css = _read("static", "style.css")
    # A body-STATE class (not a per-element rule set) that raises the ONE token.
    m = re.search(r"body\.theme-tinted\s*\{([^}]*)\}", css)
    assert m, "#739: body.theme-tinted must exist as a body-state class"
    body = m.group(1)
    val = re.search(r"--ow-glass-opacity:\s*([0-9.]+)", body)
    assert val, "body.theme-tinted must raise --ow-glass-opacity"
    assert float(val.group(1)) > 0.60, (
        "#739: Tinted must RAISE opacity above the 0.60 Clear default "
        "(a gentle opacity/contrast bump), not lower or match it"
    )


def test_tinted_introduces_no_accent_hue():
    # The control is opacity/neutral-tint ONLY — the tinted block must not set an
    # accent colour / hue or recolour ink (only the neutral --ow-glass-opacity moves).
    css = _read("static", "style.css")
    m = re.search(r"body\.theme-tinted\s*\{([^}]*)\}", css)
    assert m, "#739: body.theme-tinted must exist as a body-state class"
    body = m.group(1)
    for banned in ("--accent", "--fg", "--red", "color:", "hsl(", "background"):
        assert banned not in body, (
            f"#739: Tinted is a neutral opacity control — it must not set {banned!r} "
            "(no accent hue, no ink recolour)"
        )


# ── HTML: the picker lives in the appearance settings UI, default Clear ───────

def test_tint_picker_exists_in_the_appearance_ui():
    html = _read("static", "index.html")
    assert 'id="theme-glass-tint"' in html, (
        "#739: a glass-tint picker (#theme-glass-tint) must exist in the theme "
        "settings UI, next to the existing #theme-glass-tier control"
    )
    # Both options present.
    assert 'data-tint="clear"' in html and 'data-tint="tinted"' in html, (
        "#739: the picker must offer both Clear and Tinted"
    )


def test_tint_picker_defaults_to_clear():
    html = _read("static", "index.html")
    ctrl_m = re.search(r'id="theme-glass-tint"[^>]*>', html)
    assert ctrl_m, "#739: #theme-glass-tint control not found"
    ctrl = ctrl_m.group(0)
    assert 'data-value="clear"' in ctrl, (
        "#739: the picker must DEFAULT to Clear (data-value='clear')"
    )
    # The Clear button is the pressed one out of the box.
    clear_m = re.search(r'data-tint="clear"[^>]*>', html)
    assert clear_m, "#739: Clear button not found"
    clear_btn = clear_m.group(0)
    assert 'aria-pressed="true"' in clear_btn, (
        "#739: Clear must be the pressed default button"
    )
    tinted_m = re.search(r'data-tint="tinted"[^>]*>', html)
    assert tinted_m, "#739: Tinted button not found"
    tinted_btn = tinted_m.group(0)
    assert 'aria-pressed="false"' in tinted_btn, (
        "#739: Tinted must NOT be pressed by default"
    )


# ── JS: apply-on-load, default Clear, persistence, and the reset path ─────────

def test_apply_glass_tint_toggles_the_body_state_class():
    js = _read("static", "js", "theme.js")
    assert "export function applyGlassTint(tint)" in js, (
        "#739: an applyGlassTint(tint) entry point must exist"
    )
    # It must flip the body-STATE class (not touch per-element styles).
    assert re.search(
        r"classList\.toggle\(\s*['\"]theme-tinted['\"]\s*,\s*tint === ['\"]tinted['\"]\s*\)",
        js,
    ), "#739: applyGlassTint must toggle body.theme-tinted on tint === 'tinted'"


def test_tint_resolves_to_clear_by_default():
    js = _read("static", "js", "theme.js")
    assert "function resolveGlassTint(rec)" in js, (
        "#739: a resolveGlassTint(rec) helper must resolve the saved preference"
    )
    # Only an explicit saved tinted:true yields 'tinted'; everything else Clear.
    assert re.search(
        r"rec\.tinted === true\s*\)\s*\?\s*['\"]tinted['\"]\s*:\s*['\"]clear['\"]",
        js,
    ), "#739: resolveGlassTint must default to 'clear' unless rec.tinted === true"


def test_tint_is_applied_on_load():
    js = _read("static", "js", "theme.js")
    # The boot/restore path resolves the saved tint and applies it (mirrors the
    # glass-tier apply-on-load right beside it).
    assert "const _initTint = resolveGlassTint(saved)" in js, (
        "#739: init must resolve the saved tint"
    )
    assert "applyGlassTint(_initTint)" in js, (
        "#739: init must apply the resolved tint on load (survives reload)"
    )


def test_tint_is_persisted_to_the_theme_store():
    js = _read("static", "js", "theme.js")
    # Persisted only when opted-in (Clear is the omitted default), and read back
    # out of the tint control by _getOpts — the same store the tier persists to,
    # which _syncToServer PUTs to /api/prefs/theme (0064 cross-device).
    assert "if (opts.tinted) obj.tinted = true;" in js, (
        "#739: the tinted preference must persist into the theme record "
        "(omitted when Clear, the default)"
    )
    assert "getElementById('theme-glass-tint')" in js, (
        "#739: _getOpts / the control handler must read #theme-glass-tint"
    )
    assert re.search(r"opts\.tinted = \(gtint\.dataset\.value === ['\"]tinted['\"]\)", js), (
        "#739: _getOpts must derive opts.tinted from the control's value"
    )


def test_preset_swatch_apply_preserves_the_active_tint():
    """Applying a preset theme swatch while Tinted is active must NOT drop the tint from the
    persisted record (else the next reload / cross-device sync silently reverts to Clear). The
    swatch handler leaves the tint control untouched, so its save() must carry the live tint."""
    js = _read("static", "js", "theme.js")
    assert "tinted: _getOpts().tinted" in js, (
        "#739: the preset-swatch apply save() must carry the current tint "
        "(tinted: _getOpts().tinted), else selecting a swatch while Tinted drops it on reload"
    )


def test_tint_control_is_bound_and_syncs():
    js = _read("static", "js", "theme.js")
    assert "function _syncGlassTintControl(tint)" in js, (
        "#739: a _syncGlassTintControl must mirror the active tint onto the control"
    )
    # The click handler applies + syncs + persists (via _saveFull), like the tier.
    m = re.search(r"glassTintCtrl\.addEventListener\('click'.*?\}\);", js, re.S)
    assert m, "#739: the tint control must have a bound click handler"
    handler = m.group(0)
    assert "applyGlassTint(tint)" in handler
    assert "_syncGlassTintControl(tint)" in handler
    assert "_saveFull(s.name, s.colors)" in handler, (
        "#739: choosing a tint must persist through the theme store"
    )


def test_reset_returns_to_clear():
    js = _read("static", "js", "theme.js")
    assert "applyGlassTint('clear')" in js, (
        "#739: the theme reset must return the glass to the Clear default"
    )
    assert "_syncGlassTintControl('clear')" in js, (
        "#739: reset must also sync the picker back to Clear"
    )


def test_tint_is_exported_from_the_theme_module():
    js = _read("static", "js", "theme.js")
    m = re.search(r"const themeModule = \{(.*?)\};", js, re.S)
    assert m and "applyGlassTint" in m.group(1), (
        "#739: applyGlassTint must be exported on the theme module"
    )
