"""#1638 — the password-reveal kit treatment (.ow-pw-field / .ow-pw-reveal), G3.

The in-field eye toggle that flips a secret <input> between type="password" and type="text". It is a
TREATMENT on an .ow-field/.ow-input (a relative .ow-pw-field wrapper + an in-field trailing
.ow-pw-reveal button), NOT a standalone control. This lane standardizes the reveal look, the one eye
glyph pair, the a11y contract, and the shared OrwellPwReveal.attach wiring so a secret field reveals
identically everywhere instead of the login page implementing it and nothing else having a reveal.

OWNER RULING (2026-07-15): Workflow-2 scope standardizes the EXISTING login.html toggle ONLY — the
in-app secret fields (search/endpoint API keys, admin env) KEEP their bare type=password with NO
reveal (no behavior change). The kit primitive + helper exist so a field CAN adopt it later. These
gates pin: the primitive + a11y contract, the login migration (classes + aria-pressed + tabindex
dropped + the old bespoke block gone), the shared helper, the demo/docs, and the login-only ruling
(index.html adds no .ow-pw-field wrapper to any in-app secret field).

Source-pinned (the FE has no DOM runtime in the pytest lane; visual correctness is the rendered demo
+ browser_smoke), mirroring test_1638_compact_icon_kit.py.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*p):
    with open(os.path.join(FRONTEND, *p), encoding="utf-8") as f:
        return f.read()


CSS = _read("static", "style.css")
DEMO = _read("static", "element_kit_demo.html")
INDEX = _read("static", "index.html")
LOGIN = _read("static", "login.html")
HELPER = _read("static", "js", "orwellPwReveal.js")
DOCS = _read("..", "docs", "design", "liquid-glass", "ELEMENT_KIT.md")


def _block(css, selector):
    """The declaration body of `selector {…}` (flat rule, no nested braces)."""
    m = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", css)
    assert m, f"missing CSS rule: `{selector} {{ … }}`"
    return m.group(1)


def _media_blocks(css, header_re):
    """Every `@media (...) { … }` body whose header matches `header_re`, brace-balanced."""
    out = []
    for m in re.finditer(header_re, css):
        open_i = css.index("{", m.start())
        depth, j = 0, open_i
        while j < len(css):
            if css[j] == "{":
                depth += 1
            elif css[j] == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        out.append(css[open_i + 1:j])
    return out


# ── 1. the primitive exists: wrapper + trailing button, with the reserved inset ──────
def test_pw_reveal_primitive_exists():
    assert ".ow-pw-field" in CSS, "the .ow-pw-field wrapper primitive is missing"
    field = _block(CSS, ".ow-pw-field")
    assert "position: relative" in field, ".ow-pw-field must be position:relative"

    # the child field reserves trailing room for the eye.
    assert ".ow-pw-field > .ow-input" in CSS, ".ow-pw-field must reserve inset on its .ow-input"
    assert "padding-inline-end: var(--ow-pw-inset" in CSS, \
        "the .ow-pw-field child must reserve trailing padding (var(--ow-pw-inset)) for the eye"

    body = _block(CSS, ".ow-pw-reveal")
    assert "position: absolute" in body, ".ow-pw-reveal must be absolutely positioned in the field"
    assert "inset-inline-end" in body, ".ow-pw-reveal must be trailing-anchored (inset-inline-end)"
    assert "border: none" in body, ".ow-pw-reveal is a borderless glyph button"
    assert "cursor: pointer" in body, ".ow-pw-reveal must be cursor:pointer"
    glyph = _block(CSS, ".ow-pw-reveal svg")
    assert "18px" in glyph, "the eye glyph should be an 18px block"


# ── 2. the a11y contract: aria-pressed + Show/Hide label swap ────────────────────────
def test_reveal_a11y_contract():
    # the demo shows BOTH the masked (false) and revealed (true) states.
    assert 'aria-pressed="false"' in DEMO, "the demo must show a masked .ow-pw-reveal (aria-pressed=false)"
    assert 'aria-pressed="true"' in DEMO, "the demo must show a revealed .ow-pw-reveal (aria-pressed=true)"
    # the shared helper toggles aria-pressed AND swaps the aria-label Show↔Hide in lockstep.
    assert 'setAttribute("aria-pressed"' in HELPER, "the helper must toggle aria-pressed"
    assert '"Hide password"' in HELPER and '"Show password"' in HELPER, \
        "the helper must swap the aria-label Show↔Hide"
    # the [aria-pressed] CSS state swaps the eye-open/eye-closed glyph pair.
    assert '.ow-pw-reveal[aria-pressed="true"]' in CSS, \
        "the glyph pair must swap via the [aria-pressed] CSS state"


# ── 3. keyboard-reachable by default (the kit fixes the login tabindex=-1 gap) ───────
def test_reveal_is_keyboard_reachable_by_default():
    # the kit demo eye buttons + the helper-built button must NOT be removed from the tab order.
    for pw in re.findall(r'<button[^>]*class="[^"]*ow-pw-reveal[^"]*"[^>]*>', DEMO):
        assert 'tabindex="-1"' not in pw, "the kit .ow-pw-reveal must stay in the tab order (no tabindex=-1)"
    assert 'tabindex="-1"' not in HELPER, "the OrwellPwReveal.attach button must be focusable (no tabindex=-1)"


# ── 4. focus ring is the sanctioned system blue ─────────────────────────────────────
def test_focus_is_system_blue():
    body = _block(CSS, ".ow-pw-reveal:focus-visible")
    assert "--ow-focus-ring" in body or "--ow-ios-blue" in body, \
        ".ow-pw-reveal:focus-visible must use the system-blue focus token"


# ── 5. Edge's native reveal/clear glyph is suppressed (the kit eye is the only one) ──
def test_native_reveal_suppressed():
    assert "::-ms-reveal" in CSS and "::-ms-clear" in CSS, \
        "the treatment must suppress Edge's native ::-ms-reveal / ::-ms-clear"
    assert ".ow-pw-field .ow-input::-ms-reveal" in CSS, \
        "the native-glyph suppression must be scoped to the .ow-pw-field"


# ── 6. no accent hue on the glyph — a NEUTRAL control/adaptive ink only ──────────────
def test_no_accent_hue_on_glyph():
    for sel in ("body.theme-frosted .ow-pw-reveal", "body:not(.theme-frosted) .ow-pw-reveal"):
        body = _block(CSS, sel)
        assert "--accent" not in body and "--ow-accent" not in body, \
            f"{sel} must not ink an accent hue (kit no-accent-on-chrome contract)"
        assert ("--ow-control-ink" in body) or ("--fg" in body), \
            f"{sel} must ink a neutral control / adaptive token"


# ── 7. coarse-pointer 44px tap floor (WCAG 2.5.5) ───────────────────────────────────
def test_coarse_pointer_tap_floor():
    windows = _media_blocks(CSS, r"@media \(pointer: coarse\)\s*\{")
    floor = next((w for w in windows if ".ow-pw-reveal" in w), None)
    assert floor, "no @media (pointer: coarse) block floors the .ow-pw-reveal"
    assert "var(--tap-min" in floor and "44px" in floor, \
        "the coarse-pointer .ow-pw-reveal must reach var(--tap-min, 44px)"


# ── 8. two tiers authored (frosted + flat ink) ──────────────────────────────────────
def test_two_tier_authored():
    assert "body.theme-frosted .ow-pw-reveal" in CSS, "the frosted-tier .ow-pw-reveal ink is missing"
    assert "body:not(.theme-frosted) .ow-pw-reveal" in CSS, "the flat-tier .ow-pw-reveal ink is missing"


# ── 9. the a11y trio ────────────────────────────────────────────────────────────────
def test_honors_a11y_trio():
    rm = _media_blocks(CSS, r"@media \(prefers-reduced-motion: reduce\)\s*\{")
    assert any(".ow-pw-reveal" in w for w in rm), "reduced-motion must drop the .ow-pw-reveal transition"
    ct = _media_blocks(CSS, r"@media \(prefers-contrast: more\)\s*\{")
    assert any(".ow-pw-reveal" in w for w in ct), "increased-contrast must raise the .ow-pw-reveal ink"
    rt = _media_blocks(CSS, r"@media \(prefers-reduced-transparency: reduce\)\s*\{")
    assert any(".ow-pw-reveal" in w for w in rt), "reduced-transparency must solidify the .ow-pw-reveal ink"


# ── 10. the shared helper exists and is loaded ──────────────────────────────────────
def test_shared_helper_exists():
    assert "window.OrwellPwReveal" in HELPER, "OrwellPwReveal must be exposed on window"
    assert re.search(r"attach\s*:", HELPER) or "function attach" in HELPER, \
        "OrwellPwReveal.attach must be defined"
    assert "orwellPwReveal.js" in INDEX, "the helper must be loaded in index.html (so a field can adopt it)"


# ── 11. login adopts the treatment (classes + aria-pressed + tabindex dropped) ──────
def test_login_adopts_the_treatment():
    assert "ow-pw-field" in LOGIN and "ow-pw-reveal" in LOGIN, \
        "login.html must adopt .ow-pw-field / .ow-pw-reveal"
    # the old bespoke standalone .pw-toggle / .pw-wrapper is gone (renamed into the kit classes).
    assert "pw-toggle" not in LOGIN, "the login .pw-toggle bespoke class must be gone (→ .ow-pw-reveal)"
    assert "pw-wrapper" not in LOGIN, "the login .pw-wrapper bespoke class must be gone (→ .ow-pw-field)"
    # wireToggle now toggles aria-pressed alongside the aria-label swap.
    assert "setAttribute('aria-pressed'" in LOGIN, "login wireToggle must toggle aria-pressed"
    assert 'aria-pressed="false"' in LOGIN, "the login toggle buttons must carry an initial aria-pressed"
    # the toggle is keyboard-reachable — tabindex=-1 dropped from the login reveal buttons.
    for btn in re.findall(r'<button[^>]*class="[^"]*ow-pw-reveal[^"]*"[^>]*>', LOGIN):
        assert 'tabindex="-1"' not in btn, "the login .ow-pw-reveal must be focusable (tabindex=-1 dropped)"


# ── 12. the demo shows masked + revealed, and the docs document it ──────────────────
def test_demo_and_docs_reference_the_treatment():
    assert "Password reveal — .ow-pw-field" in DEMO, "the demo needs a labeled pw-reveal section"
    assert DEMO.count("ow-pw-field") >= 2, "the demo must show at least a masked + revealed .ow-pw-field"
    assert 'type="password"' in DEMO and 'type="text"' in DEMO, \
        "the demo must show both the masked and revealed input states"
    assert "`.ow-pw-field`" in DOCS and "`.ow-pw-reveal`" in DOCS, \
        "ELEMENT_KIT.md must document the .ow-pw-field / .ow-pw-reveal treatment"


# ── 13. the OWNER RULING: login-only — no in-app secret field adopts the reveal ─────
def test_login_only_no_inapp_adoption():
    # per the 2026-07-15 ruling the in-app secret fields keep their bare type=password: index.html
    # must NOT wrap any field in .ow-pw-field (the primitive is loaded but adopted by login only).
    # (The loader-comment MENTIONS the class; the pin is on real class-attribute USAGE.)
    assert not re.search(r'class="[^"]*\bow-pw-field\b', INDEX), (
        "OWNER RULING (2026-07-15): this lane is login-only — index.html must add no .ow-pw-field "
        "wrapper to any in-app secret field (they keep their bare type=password)."
    )
    assert not re.search(r'class="[^"]*\bow-pw-reveal\b', INDEX), \
        "OWNER RULING (2026-07-15): no in-app .ow-pw-reveal button — the reveal is login-only."
    # and the in-app secret fields are still present + unchanged (a smoke pin on the ruling).
    assert "set-searchApiKey" in INDEX, "the search API-key field must remain (bare, no reveal)"
