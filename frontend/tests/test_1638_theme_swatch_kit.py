"""#1638 — the swatch-grid kit primitive (.ow-swatch-grid / .ow-swatch).

A NEW foundational kit primitive: a selectable option-in-a-set (the Theme window's preset +
custom swatch tiles). It replaces the bespoke `.theme-grid` / `.theme-swatch*` block. Source of
the mandate: docs/design/1638-theme-swatch-kit.md.

The non-negotiable contract this gate pins (source-pinned — the FE has no DOM runtime in the
pytest lane; visual correctness is the rendered demo + browser_smoke):
  1. `.ow-swatch` + `.ow-swatch-grid` are DEFINED inside the ELEMENT KIT region;
  2. both host grids (#themeGrid / #themeUserGrid) carry `class="ow-swatch-grid"` + `role="listbox"`
     + an aria-label, and the bespoke `class="theme-grid"` is gone;
  3. the SELECTED state is NEUTRAL (--ow-control-ink ring), never the accent hue (kills the old
     `.theme-swatch.active` var(--red) ring);
  4. a `.ow-swatch:focus-visible` ring exists (the roving-tabindex focus was previously ring-less);
  5. selection is single-sourced on aria-selected — theme.js sets it, the CSS keys off it, and the
     redundant `.active` class is gone;
  6. the render templates emit the migrated classes (no `theme-swatch` strings survive);
  7. the roving-tabindex keyboard nav is retained and re-pointed to `.ow-swatch` / `.ow-swatch-grid`;
  8. a tile is NEVER a glass material (no backdrop-filter — it must show its own preview colors);
  9. the dot keeps its dual-ring (legible on any tile bg — the J1-24 fix must not regress);
 10. a coarse-pointer 44px hit floor on the tile;
 11. the listbox owns ONLY role=option swatches — the `#theme-show-all` reveal button is built
     OUTSIDE the grid (a listbox may own only options; the bespoke `#theme-extra` sub-grid is gone);
 12. the reference demo instantiates an `.ow-swatch-grid` with selectable `.ow-swatch` tiles.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*p):
    with open(os.path.join(FRONTEND, *p), encoding="utf-8") as f:
        return f.read()


CSS = _read("static", "style.css")
KIT = CSS[CSS.index("── ELEMENT KIT ──"):CSS.index("── END ELEMENT KIT ──")]
# the swatch sub-block, bounded to end at the following COLOR WELL block so the slice is exact.
SWATCH = KIT[KIT.index(".ow-swatch-grid {"):KIT.index("── COLOR WELL:")]
SWATCH_NC = re.sub(r"/\*.*?\*/", "", SWATCH, flags=re.S)   # comments blanked (avoid prose hits)
HTML = _read("static", "index.html")
DEMO = _read("static", "element_kit_demo.html")
THEME_JS = _read("static", "js", "theme.js")


def _block(css, selector):
    """The declaration body of `selector {…}` (flat rule, no nested braces)."""
    m = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", css)
    assert m, f"missing CSS rule: `{selector} {{ … }}`"
    return m.group(1)


# ── 1. the primitive is defined in the kit region ────────────────────────────────────
def test_swatch_primitive_exists_in_kit_region():
    assert ".ow-swatch-grid {" in SWATCH, "the .ow-swatch-grid rule must be in the ELEMENT KIT region"
    assert ".ow-swatch {" in SWATCH, "the .ow-swatch rule must be in the ELEMENT KIT region"
    # the grid is an auto-fill tile grid.
    grid = _block(SWATCH, ".ow-swatch-grid")
    assert "grid-template-columns" in grid and "auto-fill" in grid, "the grid must auto-fill tiles"


# ── 2. both host grids are proper listboxes with the migrated class ──────────────────
def test_swatch_grids_are_listboxes():
    assert 'class="theme-grid"' not in HTML, "the bespoke .theme-grid host class must be gone"
    for gid, lbl in (("themeGrid", "Preset themes"), ("themeUserGrid", "Your themes")):
        m = re.search(r'<div\b[^>]*id="' + gid + r'"[^>]*>', HTML)
        assert m, f"#{gid} host div not found"
        tag = m.group(0)
        assert "ow-swatch-grid" in tag, f"#{gid} must carry class=ow-swatch-grid"
        assert 'role="listbox"' in tag, f"#{gid} must carry role=listbox (options were orphaned before)"
        assert "aria-label=" in tag, f"#{gid} must carry an aria-label"


# ── 3. the selected state is NEUTRAL, not the accent hue — aria-selected is the SOLE source ──
def test_swatch_selected_state_is_neutral_not_accent():
    # selection is single-sourced on aria-selected: the CSS keys ONLY off [aria-selected="true"];
    # a redundant `.ow-swatch.is-selected` selector must NOT exist (it would be a second, driftable
    # source of the selected visual).
    sel = _block(SWATCH, '.ow-swatch[aria-selected="true"]')
    assert "--ow-control-ink" in sel, "the selected ring must use the neutral --ow-control-ink"
    assert "var(--red)" not in sel and "--accent" not in sel, (
        "the selected state must NOT use the accent hue (the old .theme-swatch.active var(--red) ring)"
    )
    assert ".ow-swatch.is-selected" not in SWATCH, (
        "the selected state must be single-sourced on aria-selected — no `.ow-swatch.is-selected` selector"
    )


# ── 4. a focus-visible ring exists (new — the roving focus was ring-less) ────────────
def test_swatch_has_focus_visible_ring():
    ring = _block(SWATCH, ".ow-swatch:focus-visible")
    assert "--ow-focus-ring" in ring and "outline" in ring, (
        "a .ow-swatch:focus-visible rule must show the system-blue --ow-focus-ring outline"
    )


# ── 5. selection is aria-driven (single source of truth; no `.active`) ───────────────
def test_swatch_selection_is_aria_driven():
    # the CSS keys the selected visual off [aria-selected="true"].
    assert '.ow-swatch[aria-selected="true"]' in SWATCH, "the selected CSS must key off aria-selected"
    # theme.js sets aria-selected on select and clears it, and no longer toggles a `.active` class
    # on a swatch (the redundant dual source is gone).
    assert "setAttribute('aria-selected', 'true')" in THEME_JS, "theme.js must set aria-selected on select"
    assert "setAttribute('aria-selected', 'false')" in THEME_JS, "theme.js must clear aria-selected"
    assert "sw.classList.add('active')" not in THEME_JS, (
        "the redundant `.active` swatch class must be gone — aria-selected is the single source"
    )
    # the swatch clear-sweeps set aria-selected='false' (not classList.remove('active') on swatches).
    assert "querySelectorAll('.ow-swatch').forEach(s => s.setAttribute('aria-selected', 'false'))" in THEME_JS


# ── 6. the render templates are migrated ─────────────────────────────────────────────
def test_swatch_render_templates_migrated():
    assert "theme-swatch" not in THEME_JS, "no `theme-swatch` class string may survive in the templates"
    for cls in ("ow-swatch ow-swatch--preview", "ow-swatch__dots", 'class="ow-swatch__dot"',
                "ow-swatch ow-swatch--custom", "ow-swatch__name"):
        assert cls in THEME_JS, f"the render templates must emit `{cls}`"


# ── 7. the roving-tabindex keyboard nav is retained + re-pointed ─────────────────────
def test_swatch_roving_tabindex_still_wired():
    assert "function _ensureSwatchTabindex(gridEl)" in THEME_JS
    assert "function _onSwatchKeydown(e)" in THEME_JS
    assert "gridEl.querySelectorAll('.ow-swatch')" in THEME_JS, "roving must select .ow-swatch"
    assert ".closest('.ow-swatch-grid')" in THEME_JS, "keydown must find the .ow-swatch-grid"
    assert "sw.addEventListener('keydown', _onSwatchKeydown)" in THEME_JS


# ── 8. a tile is never a glass material ──────────────────────────────────────────────
def test_swatch_tile_is_not_glass():
    body = _block(SWATCH, ".ow-swatch")
    assert "backdrop-filter" not in body, "a swatch displays colors — it must not blur/glass its bg"


# ── 9. the dot keeps its dual ring (J1-24) ───────────────────────────────────────────
def test_swatch_dot_dual_ring_preserved():
    dot = _block(SWATCH, ".ow-swatch__dot")
    assert "box-shadow" in dot, "the dot needs a background-independent ring (box-shadow)"
    assert "rgba(255, 255, 255" in dot and "rgba(0, 0, 0" in dot, (
        "the dot ring must combine a light inner + dark outer edge so it reads on any tile"
    )


# ── 10. coarse-pointer 44px floor ────────────────────────────────────────────────────
def test_swatch_44px_coarse_floor():
    m = re.search(r"@media \(any-pointer: coarse\)\s*\{[^}]*\.ow-swatch\s*\{([^}]*)\}", SWATCH_NC)
    assert m, "a coarse-pointer floor for .ow-swatch is missing"
    assert re.search(r"min-height:\s*var\(--ow-tap-min", m.group(1)), (
        "the coarse floor must use min-height: var(--ow-tap-min, 44px)"
    )


# ── 11. the listbox owns ONLY options — the reveal button is built OUTSIDE the grid ──
def test_show_all_button_is_outside_the_listbox():
    # the bespoke nested `#theme-extra` sub-grid (a non-option listbox child) is gone.
    assert 'id="theme-extra"' not in THEME_JS, (
        "the nested #theme-extra sub-grid (a non-option child of the listbox) must be gone"
    )
    # the reveal button is created as a real element and inserted OUTSIDE the grid (afterend).
    assert "insertAdjacentElement('afterend'" in THEME_JS, (
        "the #theme-show-all button must be built OUTSIDE the role=listbox (a listbox may own only options)"
    )
    # the extra tiles are collapsed via a class on the grid, not a nested wrapper.
    assert ".ow-swatch-grid.is-collapsed .ow-swatch--extra" in CSS, (
        "the extra tiles must collapse via `.ow-swatch-grid.is-collapsed .ow-swatch--extra`"
    )


def test_delete_btn_renders_as_sibling_outside_the_option():
    # WAI-ARIA: an option's descendants are presentational, so the per-tile delete X must be a
    # SIBLING of the role=option swatch (inside a presentational wrapper cell), NOT nested inside
    # it — otherwise the <button> loses its role and adds a phantom tab stop (#1657 / #1658).
    assert ".theme-delete-btn" in CSS, "the per-tile delete X micro-control CSS is retained"
    assert 'class="theme-delete-btn"' in THEME_JS, "the delete X stays rendered on the custom tile"
    # the custom entry is wrapped in a presentational cell (the grid item), so the listbox still
    # owns only options and the ✕ button is a sibling of — not a descendant of — the option.
    assert 'class="ow-swatch-cell"' in THEME_JS, "each custom entry must be wrapped in an .ow-swatch-cell"
    # structural proof the ✕ is OUTSIDE the option: bound to the custom template, the option's own
    # closing </div> (the first </div> after the name span) must come BEFORE the delete button.
    tmpl = THEME_JS[THEME_JS.index("ow-swatch ow-swatch--custom"):]
    tmpl = tmpl[:tmpl.index(".join('')")]
    name_idx = tmpl.index("ow-swatch__name")
    close_idx = tmpl.index("</div>", name_idx)      # closes the role=option swatch
    btn_idx = tmpl.index("theme-delete-btn")
    assert name_idx < close_idx < btn_idx, (
        "the delete button must render AFTER the option's closing </div> (a sibling, not a child)"
    )


def test_delete_btn_is_not_a_phantom_tab_stop():
    # #1658: the per-tile ✕ was a focusable <button> (implicit tabindex 0) inside the swatch grid, so
    # Tab reached one delete control PER custom tile instead of the roving-tabindex/listbox model's ONE
    # Tab stop per grid. Give the ✕ tabindex="-1", and expose delete as a keyboard action (Delete/
    # Backspace) on the focused custom option — clicking the sibling ✕ so delete stays keyboard-reachable.
    tmpl = THEME_JS[THEME_JS.index("ow-swatch ow-swatch--custom"):]
    tmpl = tmpl[:tmpl.index(".join('')")]
    btn = tmpl[tmpl.index("theme-delete-btn"):]
    btn = btn[:btn.index(">") + 1]                    # the ✕ button's opening tag only
    assert 'tabindex="-1"' in btn, (
        'the per-tile delete ✕ must be tabindex="-1" so it is not a phantom Tab stop in the listbox'
    )
    # the roving-tabindex keydown handler exposes delete on the focused option via Delete/Backspace,
    # clicking the sibling ✕ (reusing its styledConfirm flow) — so delete stays keyboard-reachable
    # without a per-tile tab stop. A built-in preset has no ✕ ⇒ the action is a no-op there.
    kd = THEME_JS[THEME_JS.index("function _onSwatchKeydown"):]
    kd = kd[:kd.index("\nexport ")]
    assert "'Delete'" in kd and "'Backspace'" in kd, (
        "_onSwatchKeydown must handle Delete/Backspace to delete the focused custom theme"
    )
    assert "querySelector('.theme-delete-btn')" in kd and ".click()" in kd, (
        "the keyboard delete action must click the sibling .theme-delete-btn (reusing its confirm flow)"
    )


# ── 12. the reference demo instantiates the primitive ────────────────────────────────
def test_demo_shows_swatch_grid():
    assert "Swatch grid" in DEMO, "the demo needs a labeled swatch-grid section"
    m = re.search(r'<div class="ow-swatch-grid"[^>]*role="listbox"', DEMO)
    assert m, "the demo must instantiate an .ow-swatch-grid with role=listbox"
    assert DEMO.count('class="ow-swatch ow-swatch--preview"') >= 2, "the demo needs a couple of tiles"
    assert 'aria-selected="true"' in DEMO, "the demo must show one selected tile"
    assert "ow-swatch__dots" in DEMO and "ow-swatch__dot" in DEMO, "the demo tiles must show the dot row"
