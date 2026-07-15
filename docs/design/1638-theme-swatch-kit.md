# 1638 — `.ow-swatch` / `.ow-swatch-grid` kit primitive (Group-2 gap: theme preset grid)

> Build-ready design spec for one of the three NEW kit primitives Workflow-2 of the #1638 total-kit
> migration will implement. Companion specs: `1638-color-well-kit.md`, `1638-keycap-kit.md`. Mandate
> source: `docs/audits/2026-07-15-total-kit-migration-inventory.md` §10 (theme-swatch listed
> ACCEPTED-GAP) — reclassified TODO under the owner ruling *"total kit migration — everything migrates."*
>
> **Scope:** the selectable-swatch-tile grid — the theme preset previews and custom-theme swatches in the
> Theme window. Turn the bespoke `.theme-swatch` / `.theme-grid` into a reusable selectable-tile
> primitive with kit-consistent selected / hover / focus states, keyboard nav, and correct listbox
> semantics. **Not a button primitive** (`.ow-btn`) — a swatch is a *selectable option in a set*, the
> element-kit analog closest to a radio/listbox-option, not a CTA.

---

## 1. Consumer inventory

Two grids in the **Theme window** (`frontend/static/index.html` hosts; `frontend/static/js/theme.js`
renders + wires). This is the only selectable-swatch-grid surface in the game build.

### 1a. Hosts (`index.html`)

| Grid | file:line | Current |
|---|---|---|
| Preset themes | `index.html:735` | `<div class="theme-grid" id="themeGrid"></div>` |
| Custom themes | `index.html:739` | `<div class="theme-grid" id="themeUserGrid"></div>` |

Note: the grid `<div>`s carry **no `role="listbox"`** today (their children carry `role="option"` — an
orphaned-option a11y gap this migration fixes; contrast `index.html:1099` `#session-list role="listbox"`
which does it correctly).

### 1b. Rendered tile markup (`theme.js`)

Preset tile (`theme.js:1557-1571`, `_swatch()`):
```html
<div class="theme-swatch theme-swatch--preview${active?' active':''}" data-theme="${name}"
     style="background:${c.bg};color:${c.fg};border-color:${c.panel};"
     role="option" tabindex="-1" aria-selected="${active}" aria-label="${label} theme">
  <div class="theme-swatch-colors">
    <span style="background:${c.bg}"></span><span style="background:${c.panel}"></span>
    <span style="background:${c.fg}"></span><span style="background:${c.red}"></span>
  </div>
  ${label}
</div>
```
Custom tile (`theme.js:1615-1626`): same shape + `data-custom="1"`, a `<span class="theme-swatch-name">`,
and a `.theme-delete-btn` (an inline X `<button>` — a per-tile delete, out of this primitive's scope;
keep as-is).

### 1c. Keyboard / selection wiring (`theme.js`) — reuse, do not reinvent

- Roving-tabindex listbox helpers `_visibleSwatches` / `_ensureSwatchTabindex` / `_onSwatchKeydown`
  (`theme.js:1376-1414`): exactly-one-`tabindex=0` per grid, Arrow/Home/End move the roving stop,
  Enter/Space activates. **Keyed off `.theme-swatch` + `.closest('.theme-grid')`.**
- Selection: click/keyboard handler (`theme.js:1672-1687`) sets `.active` + `aria-selected="true"` on
  the picked tile and clears the rest (`clearAllActive`, `theme.js:1666-1671`). More `clearActive`
  sweeps at `theme.js:1873,1955,2034,2435`.

### 1d. Bespoke CSS (`frontend/static/style.css:7126-7167,7204-…`)

```css
.theme-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(66px,1fr)); gap: 6px; margin-bottom: 12px; }
.theme-swatch {
  border: 2px solid var(--border); border-radius: 8px; cursor: pointer;
  padding: 5px; text-align: center; font-size: 0.65rem; color: var(--fg);
  transition: border-color .15s, transform .15s;
}
.theme-swatch:hover { transform: scale(1.06); }
.theme-swatch.active { border-color: var(--red);            /* ← accent-hued selected state */
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--red) 33%, transparent); }
.theme-swatch-colors { display: flex; justify-content: center; margin-bottom: 3px; }
.theme-swatch-colors span { width:15px; height:15px; border-radius:50%; margin-left:-5px;
  border:none; box-shadow: inset 0 0 0 1px rgba(255,255,255,.45), 0 0 0 1px rgba(0,0,0,.45); }
.theme-swatch-colors span:first-child { margin-left: 0; }
.theme-swatch[data-custom] { position: relative; overflow: visible; }   /* for the delete X */
```
There is **no `:focus-visible` rule** today — the roving-tabindex `.focus()` lands with no visible ring
(an a11y gap this migration closes). `.theme-extra`/`.theme-show-all` (`:7132-7144`) are the game-build
"show all" reveal — layout siblings, kept.

---

## 2. Proposed primitive — markup + CSS contract

### 2a. Class API

```text
.ow-swatch-grid            the grid container (role="listbox"); auto-fill minmax tiles
.ow-swatch                 a selectable tile (role="option"); hover / focus-visible / [aria-selected]
  .ow-swatch__dots         the color-preview dot row (was .theme-swatch-colors)
  .ow-swatch__dot          one preview dot (was .theme-swatch-colors span)
  .ow-swatch__name         the tile label (was .theme-swatch-name)
.ow-swatch--preview        the "paint the tile in the theme's own bg/fg" preview variant
.ow-swatch[aria-selected="true"]  selected state — the SOLE selection source (kit neutral ring, no accent hue)
```

Selected state is driven **solely** by **`[aria-selected="true"]`** (the source of truth the
roving-tabindex code already sets). The CSS never matches a bare `.is-selected`, so a stale or omitted
ARIA attribute can never leave a tile rendered-selected. If a `.is-selected` co-flag is kept, it MUST
be gated by the attribute (`.is-selected[aria-selected="true"]`) and never style on its own.
(Preferred over the current bespoke `.active` class, which duplicates `aria-selected`.)

### 2b. CSS contract (authored in the ELEMENT KIT region of `style.css`)

```css
/* ── SWATCH GRID: .ow-swatch-grid / .ow-swatch — selectable tile set (#1638) ────── */
.ow-swatch-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(66px, 1fr));
  gap: var(--ow-space-2, 8px);
}
.ow-swatch {
  border: 2px solid var(--ow-control-rim); border-radius: var(--ow-radius-inner, 12px);
  padding: var(--ow-space-1, 5px); text-align: center; cursor: pointer;
  font-size: var(--ow-fs-caption, 0.65rem); color: var(--ow-control-ink, #16191f);
  transition: border-color .15s ease, transform .15s ease, box-shadow .15s ease;
}
.ow-swatch:hover { transform: scale(1.06); }
/* SELECTED — a NEUTRAL luminous ring (emphasis = luminosity + weight, NOT accent hue).
   Keyed SOLELY off aria-selected so the visual can never diverge from the AT state. We do NOT
   match a bare `.is-selected` (a stale/omitted attribute must never render a tile as selected);
   if a class co-flag is wanted, gate it: `.ow-swatch.is-selected[aria-selected="true"]`. */
.ow-swatch[aria-selected="true"] {
  border-color: color-mix(in srgb, var(--ow-control-ink, #16191f) 55%, transparent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ow-control-ink, #16191f) 22%, transparent);
}
/* FOCUS — the fixed system-blue ring (new; the roving-tabindex focus had none) */
.ow-swatch:focus-visible {
  outline: var(--ow-focus-ring-w, 3px) solid var(--ow-focus-ring, #0a84ff); outline-offset: 2px;
}
.ow-swatch__dots { display: flex; justify-content: center; margin-bottom: 3px; }
.ow-swatch__dot {
  width: 15px; height: 15px; border-radius: 50%; margin-left: -5px; border: none;
  /* dual ring so a dot reads on any tile bg (a dot IS the theme's own color) */
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.45), 0 0 0 1px rgba(0,0,0,.45);
}
.ow-swatch__dot:first-child { margin-left: 0; }
.ow-swatch--custom { position: relative; overflow: visible; }
@media (prefers-reduced-motion: reduce) { .ow-swatch:hover { transform: none; } }
```

### 2c. Tier behavior (frosted / glass / flat)

- Like the color well, a swatch **displays colors** (its own bg/fg on the `--preview` variant, plus the
  dot colors), so the tile is **not a glass material** and takes **no `backdrop-filter`** — authored
  tier-agnostically (the current `.theme-swatch` is unscoped and correct on every tier).
- The one deliberate cross-tier change is the **selected/focus color**: from accent-hued `var(--red)` to
  the neutral `--ow-control-ink` ring + system-blue focus. This satisfies the #726/#773 no-accent
  contract and reads on all three tiers (the neutral ink token resolves identically on frosted/glass/flat).
- The `--preview` tile keeps its per-tile inline `background`/`color`/`border-color` from `theme.js`
  (that IS the preview) — the kit rule must not override those inline styles for the preview variant
  (inline wins over the class `border-color` by specificity, except selected/focus which use
  `box-shadow`/`outline` so they layer on top without fighting the inline border).

### 2d. Tap target / a11y

- **Listbox semantics (the real fix):** `.ow-swatch-grid` MUST carry `role="listbox"` (+ an
  `aria-label`, e.g. "Preset themes" / "Custom themes"); the current grids omit it, leaving
  `role="option"` children orphaned. Add it in the host markup (or have `theme.js` set it). Keep the
  existing roving-tabindex + Enter/Space activation (already compliant with WCAG 2.1.1).
- **A listbox holds ONLY `role="option"` swatches — move the non-option controls out.** A
  `role="listbox"` must not contain interactive descendants other than its options. Two current
  offenders (verified in source) MUST move **outside** the listbox as part of this migration:
  - **`#theme-show-all`** — today `theme.js:1591` injects the "show all" `<button>` (and its
    `#theme-extra` overflow group) **inside `#themeGrid`**. Render it as a **sibling of** the grid
    (before/after the `.ow-swatch-grid`), not a child, so the listbox contains only swatches.
  - **`.theme-delete-btn`** — today `theme.js:1625` nests the per-tile delete `<button>` **inside**
    each custom swatch (the `role="option"` element, `:1617`). Move it to be a **sibling of** the
    swatch inside a small per-tile wrapper (option + delete side-by-side), so the option is not an
    interactive-nesting violation. Its own click handler + 44px coarse floor are unchanged.
- **Focus ring:** newly added (system-blue) — the roving `.focus()` was previously invisible.
- **Selected announcement:** `aria-selected` already toggled by the handlers; binding the *visual* to
  `[aria-selected="true"]` removes the `.active`/`aria-selected` dual-source drift risk.
- **Tap target:** tiles are ≥66×~52px (grid `minmax(66px)` + dot row + label) — already ≥44px in the
  smaller axis is borderline; add a coarse-pointer `min-height: var(--ow-tap-min,44px)` guard on
  `.ow-swatch` to guarantee 2.5.5 on phones (owned in `style.css`, mirror the `.oc-pin` floor). The
  per-tile `.theme-delete-btn` X keeps its own existing coarse floor.

---

## 3. Migration mapping (migration-only)

| Consumer | Change | Kind |
|---|---|---|
| `index.html:735,739` | `class="theme-grid"` → `class="ow-swatch-grid"` **+ add `role="listbox" aria-label="…"`** | class swap + a11y attr add |
| `theme.js:1560` (`_swatch` preset) | `theme-swatch theme-swatch--preview` → `ow-swatch ow-swatch--preview`; `theme-swatch-colors` → `ow-swatch__dots`; the `<span>` dots → `class="ow-swatch__dot"` (they are currently class-less children — add the class or keep the `.ow-swatch__dots > span` descendant selector) | render-template class swap |
| `theme.js:1616` (custom tile) | `theme-swatch` → `ow-swatch ow-swatch--custom`; `theme-swatch-name` → `ow-swatch__name`; dots as above | render-template class swap |
| `theme.js:1376-1414` (roving helpers) | selectors `.theme-swatch` → `.ow-swatch`, `.closest('.theme-grid')` → `.closest('.ow-swatch-grid')` | JS selector swap |
| `theme.js:1666-1687,1873,1955,2034,2435` (select/clear) | replace `.classList.add/remove('active')` with `.setAttribute('aria-selected', …)` as the single source (drop `.active`), and re-point `.querySelectorAll('.theme-swatch')` → `.ow-swatch` | JS state-source consolidation |
| `theme.js:1560,1562,1616,1617` `aria-selected` | already present — keep; the CSS now consumes it | none |
| `style.css:7126-7167,7204` | DELETE `.theme-grid` / `.theme-swatch*` bespoke rules; behavior moves to the kit region. `.theme-show-all`/`.theme-extra` (`:7132-7144`) — keep the CSS, but **re-parent `#theme-show-all`/`#theme-extra` OUTSIDE `#themeGrid`** (`theme.js:1591`) so the `role="listbox"` grid holds only `role="option"` swatches (§2d) | CSS retire + re-point + markup re-parent |
| `.theme-swatch[data-custom]` (`:7204`) | → `.ow-swatch--custom` | CSS + template |
| `.theme-delete-btn` (`:7208`) | CSS **unchanged** (out of primitive scope), but its **markup moves OUT of the `role="option"` swatch** (`theme.js:1625` currently nests it inside the tile) — render it as a sibling of the swatch in a per-tile wrapper, so the listbox has no interactive nesting (§2d) | markup re-parent (JS template) |

The `.active`→`aria-selected` consolidation is the only non-mechanical step; if the owner prefers a pure
class swap, keep `.active` as a co-class (`.ow-swatch.active`) and add `.ow-swatch.active` to the
selected CSS rule — see §5.

---

## 4. Test plan — `frontend/tests/test_1638_theme_swatch_kit.py`

Source-pinned checks mirroring `test_1638_compact_icon_kit.py` / `test_0771_compact_pin_kit.py`.

```python
CSS   = _read("static", "style.css")
KIT   = CSS[CSS.index("── ELEMENT KIT ──"):CSS.index("── END ELEMENT KIT ──")]
HTML  = _read("static", "index.html")
THEME = _read("static", "js", "theme.js")
```

1. `test_swatch_primitive_exists_in_kit_region` — `.ow-swatch` and `.ow-swatch-grid` present **inside
   `KIT`**.
2. `test_swatch_grids_are_listboxes` — `index.html` `#themeGrid`/`#themeUserGrid` carry
   `class="ow-swatch-grid"` **and** `role="listbox"` + an `aria-label`; assert `class="theme-grid"` gone.
   Also assert the listbox holds only options: `theme.js` no longer emits `#theme-show-all` **inside**
   the grid, and `.theme-delete-btn` is rendered as a **sibling** of (not nested inside) the
   `role="option"` swatch.
3. `test_swatch_selected_state_is_neutral_not_accent` — the `[aria-selected="true"]` selected rule
   uses `--ow-control-ink`; assert **no** `var(--red)`/`--accent` in the selected rule (kills the old
   accent ring), **and** that no rule styles a bare `.ow-swatch.is-selected` without the
   `[aria-selected="true"]` attribute (selection stays ARIA-driven, never class-only).
4. `test_swatch_has_focus_visible_ring` — a `.ow-swatch:focus-visible` rule using `--ow-focus-ring`
   exists (the roving-tabindex focus was previously ring-less).
5. `test_swatch_selection_is_aria_driven` — `theme.js` sets `aria-selected` on select and the CSS keys
   the selected visual off `[aria-selected="true"]` (single source of truth). *(If §5 keeps `.active`,
   assert `.ow-swatch.active` is also in the selected rule.)*
6. `test_swatch_render_templates_migrated` — `theme.js` `_swatch()` + custom-tile template emit
   `class="ow-swatch"` / `ow-swatch--preview` / `ow-swatch__dots`; assert `theme-swatch` class strings
   gone from the templates.
7. `test_swatch_roving_tabindex_still_wired` — `_ensureSwatchTabindex`/`_onSwatchKeydown` retained and
   now select `.ow-swatch` / `.ow-swatch-grid` (keyboard nav not regressed).
8. `test_swatch_tile_is_not_glass` — no `backdrop-filter` on the `.ow-swatch` rule (a tile displays
   colors; blurring would defeat the preview).
9. `test_swatch_dot_dual_ring_preserved` — `.ow-swatch__dot` keeps the inset-white + outer-black dual
   ring (legible on any tile bg — the J1-24 fix must not regress).
10. `test_swatch_44px_coarse_floor` — coarse-pointer `min-height: --ow-tap-min/44px` guard on
    `.ow-swatch`.
11. `test_demo_shows_swatch_grid` — `element_kit_demo.html` renders an `.ow-swatch-grid` with a couple
    selectable `.ow-swatch` tiles (one selected) in the atomic-elements section.

---

## 5. Owner decisions needed

1. **Selected-state source: `aria-selected` vs. keep `.active`.** This spec recommends binding the
   visual to `[aria-selected="true"]` and dropping the redundant `.active` class (removes the
   visual/AT drift risk). The alternative is a pure class swap that keeps `.active` (smaller JS diff,
   two sources of truth for "selected"). **Recommendation: consolidate on `aria-selected`** — it is a
   real a11y correctness win, and the `theme.js` sweeps that toggle `.active` also already toggle
   `aria-selected` right beside it (`theme.js:1667-1670,1685-1686`), so the diff is mechanical.
2. **Where does `role="listbox"` get set — HTML host or `theme.js`?** The hosts are static in
   `index.html`; adding the attribute there is simplest. Confirm (vs. having the render function set it,
   which also covers any dynamically-created grid).
3. **Is `.ow-swatch` a general primitive or theme-only?** Only the Theme window uses selectable swatch
   tiles today. Spec it as a **general** element-kit primitive (it belongs beside `.ow-radio` as
   "selectable option in a set") so future preset/pack pickers reuse it — but confirm the owner wants it
   generalized now vs. scoped to `#theme` (the class names are theme-neutral either way).
4. **`.theme-delete-btn`** (per-custom-tile X) stays out of scope (own micro-control) — confirm.
