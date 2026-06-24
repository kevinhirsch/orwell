"""#765 — Admin / health / status surfaces reskinned onto the Liquid-Glass kit.

Source-pins, in two layers:
  1. admin.js — the admin-OWNED markup composes the kit primitives: the Login-
     background card's Source/Palette <select>s use `.ow-select` (the dark-on-dark
     fix), its range inputs use `.ow-slider`, and its actions use `.ow-btn` variants.
  2. style.css — the admin glass-reskin block reskins the index.html-driven admin
     controls (the legacy native <select>s pin their option list dark-on-LIGHT so
     they can never paint dark-on-dark; the admin buttons map to the kit variants
     with the Destructive role in system-red; fields ride the kit field look; the
     bright-green range sliders take the kit system-green track).

The live FE/engine can't run in this gate, so the reskin is pinned by reading the
static assets (the same approach as #764 / #773 / #770).
"""
import os

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel):
    with open(os.path.join(FE, rel), encoding="utf-8") as fh:
        return fh.read()


# ─────────────────────────────────────────────────────────────────────────────
# 1. admin.js — the Login-background card composes the kit primitives
# ─────────────────────────────────────────────────────────────────────────────

def test_loginbg_selects_use_ow_select():
    """The Source + Palette dropdowns (the KNOWN dark-on-dark admin <select> bug)
    are migrated to the kit `.ow-select`, which pins its option list legible."""
    js = _read("static/js/admin.js")
    assert 'id="adm-loginbg-source" class="ow-select"' in js, \
        "the Login-bg Source select must use .ow-select (fixes dark-on-dark)"
    assert 'id="adm-loginbg-preset" class="ow-select"' in js, \
        "the Login-bg Palette select must use .ow-select (fixes dark-on-dark)"


def test_loginbg_no_dark_on_dark_select_remains():
    """No login-bg <select> may keep the legacy un-classed chrome (which renders
    dark-on-dark on the light glass)."""
    js = _read("static/js/admin.js")
    # Every <select ... id="adm-loginbg-*"> in the card must carry the kit class.
    import re
    for m in re.finditer(r'<select[^>]*id="adm-loginbg-[^"]*"[^>]*>', js):
        assert "ow-select" in m.group(0), \
            f"login-bg select must use .ow-select: {m.group(0)}"


def test_loginbg_sliders_use_ow_slider():
    """The gradient/particle range inputs take the kit `.ow-slider` (system-green
    track + glass thumb) instead of the bright-green default."""
    js = _read("static/js/admin.js")
    import re
    for m in re.finditer(r'<input[^>]*type="range"[^>]*id="adm-loginbg-[^"]*"[^>]*>', js):
        assert "ow-slider" in m.group(0), \
            f"login-bg range must use .ow-slider: {m.group(0)}"


def test_loginbg_actions_use_kit_buttons():
    js = _read("static/js/admin.js")
    assert 'id="adm-loginbg-save"' in js and 'class="ow-btn ow-btn-prominent"' in js, \
        "the login-bg Save button must be the kit prominent button"
    assert 'id="adm-loginbg-upload-btn"' in js and 'class="ow-btn ow-btn-secondary"' in js, \
        "the login-bg Upload button must be the kit secondary button"
    # The element-kit-demo link must stay intact (functionality preserved).
    assert 'id="adm-loginbg-kitdemo"' in js and "/static/element_kit_demo.html" in js, \
        "the element-kit demo link must stay intact"


# ─────────────────────────────────────────────────────────────────────────────
# 2. style.css — the admin glass-reskin block
# ─────────────────────────────────────────────────────────────────────────────

def test_admin_glass_reskin_block_exists():
    css = _read("static/style.css")
    assert "ADMIN GLASS RESKIN" in css and "(#765)" in css, \
        "the admin glass-reskin block must be present"


def test_legacy_admin_selects_pin_options_dark_on_light():
    """The index.html-driven admin <select>s (Theme/Memory/MCP-tools/local-endpoint)
    that can't be re-classed get their OS-painted option list pinned to the legible
    --select-option tokens — the SAME dark-on-light fix .ow-select carries — so they
    can never render dark-on-dark."""
    css = _read("static/style.css")
    # The reskin re-points the legacy admin selects onto the kit control treatment.
    assert "body.theme-frosted .admin-card select:not(.ow-select)" in css
    assert "select.admin-tools-select" in css
    assert "select.theme-fd-select" in css
    # …and pins the option list legible (dark-on-light), the dark-on-dark fix.
    assert "var(--select-option-bg" in css
    assert "var(--select-option-fg" in css


def test_admin_selects_have_no_accent_hover_edge():
    """The reskinned selects must NOT keep the legacy red hover/focus border on the
    closed control — only the system-blue focus ring (no accent hue)."""
    css = _read("static/style.css")
    block = css.split("ADMIN GLASS RESKIN", 1)[1].split("END ADMIN GLASS RESKIN", 1)[0]
    # The focus uses the system-blue focus ring, not the theme accent / red.
    assert "var(--ow-focus-ring" in block
    assert "var(--red)" not in block, \
        "admin glass reskin must not introduce the theme red on controls (no accent hue)"


def test_admin_destructive_buttons_are_system_red():
    """.admin-btn-delete (and the Danger-Zone wipes) map to the HIG Destructive role:
    a system-red FILL with a legible on-red label — a SYSTEM semantic, not the theme
    accent. They must be scoped to win over the generic in-window glass-chip rule."""
    css = _read("static/style.css")
    block = css.split("ADMIN GLASS RESKIN", 1)[1].split("END ADMIN GLASS RESKIN", 1)[0]
    assert ".ow-window .ow-body .admin-card .admin-btn-delete" in block, \
        "destructive admin buttons must be scoped through .ow-window .ow-body to win the cascade"
    assert "var(--ow-danger" in block, "destructive buttons must use the system-red --ow-danger fill"
    assert "var(--ow-on-danger" in block, "destructive buttons need the legible on-red label"


def test_admin_prominent_buttons_are_neutral_glass_not_accent():
    """.admin-btn-add maps to the kit PROMINENT (luminous neutral glass + dark ink) —
    emphasis is luminosity + weight, never an accent fill/label (owner ruling; glass
    is colorless)."""
    css = _read("static/style.css")
    block = css.split("ADMIN GLASS RESKIN", 1)[1].split("END ADMIN GLASS RESKIN", 1)[0]
    assert ".ow-window .ow-body .admin-card .admin-btn-add" in block
    # dark ink on the light glass material (#726 chrome ink), no accent fill on text.
    assert "#16191f" in block


def test_admin_danger_heading_is_legible_ink_not_red():
    """The 'Danger Zone' heading drops the hard red HUE on TEXT (HIG Color: apply
    color to the background, not to text) — the destructive intent reads from the
    red-rimmed card + the red wipe buttons."""
    css = _read("static/style.css")
    block = css.split("ADMIN GLASS RESKIN", 1)[1].split("END ADMIN GLASS RESKIN", 1)[0]
    assert ".admin-card.admin-danger-card h2" in block


def test_admin_sliders_take_kit_system_green_track():
    css = _read("static/style.css")
    block = css.split("ADMIN GLASS RESKIN", 1)[1].split("END ADMIN GLASS RESKIN", 1)[0]
    assert 'input[type="range"]:not(.ow-slider)' in block
    assert "var(--ow-ios-green" in block, "legacy admin sliders take the kit system-green track"


def test_admin_reskin_honours_a11y_trio():
    """Reduced-transparency → solid fills; increased-contrast → contrasting border —
    glass is never load-bearing for legibility (HIG Accessibility)."""
    css = _read("static/style.css")
    block = css.split("ADMIN GLASS RESKIN", 1)[1].split("END ADMIN GLASS RESKIN", 1)[0]
    assert "prefers-reduced-transparency: reduce" in block
    assert "prefers-contrast: more" in block


def test_admin_reskin_is_frosted_scoped():
    """Every reskin rule is scoped to body.theme-frosted so the Normal tier is
    untouched (same convention as the kit). Checked per rule block: each selector
    group that opens a `{ ... }` and targets an admin control must name
    body.theme-frosted (comments are stripped first)."""
    import re
    css = _read("static/style.css")
    block = css.split("ADMIN GLASS RESKIN", 1)[1].split("END ADMIN GLASS RESKIN", 1)[0]
    assert "body.theme-frosted" in block
    # Strip /* … */ comments so prose like ".admin-btn-add → PROMINENT" can't match.
    nocomments = re.sub(r"/\*.*?\*/", "", block, flags=re.S)
    # Each declaration block: capture the selector group preceding every "{".
    for sel in re.findall(r"([^{}]+)\{", nocomments):
        sel = sel.strip()
        if not sel or sel.startswith("@"):
            continue  # at-rules (media queries) carry their selectors on the inner blocks
        if (".admin-" in sel) or ("select.admin" in sel) or (".admin-card" in sel):
            assert "body.theme-frosted" in sel, \
                f"un-frosted admin-control selector escaped the theme scope: {sel!r}"
