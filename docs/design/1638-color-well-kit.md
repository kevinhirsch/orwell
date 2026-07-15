# 1638 — `.ow-color-well` kit primitive (Group-1 gap: native `<input type="color">`)

> Build-ready design spec for one of the three NEW kit primitives Workflow-2 of the #1638
> total-kit migration will implement. Companion specs: `1638-theme-swatch-kit.md`,
> `1638-keycap-kit.md`. Source of the mandate: `docs/audits/2026-07-15-total-kit-migration-inventory.md`
> §10 (color well listed ACCEPTED-GAP) — reclassified TODO under the owner ruling
> *"total kit migration — everything migrates."*
>
> **Scope:** the swatch WELL (the circular color chip + its row frame/label/reset) gets a kit-consistent
> frame, sizing, focus ring, tier behavior, and coarse-pointer tap floor. **Out of scope:** the picker
> UI that opens on click — in this app that is the in-house `colorPicker.js` popover (`.cp-popover`,
> a §8 menu/popover surface), NOT the OS color dialog. The accepted constraint from the audit still
> holds verbatim: **the OS `<input type=color>` native picker chrome cannot be restyled** — but here it
> is already bypassed, so the only visible native surface is the swatch, which IS fully styleable.

---

## 1. Consumer inventory

All consumers live in the **Theme window → Customize pane** (`frontend/static/index.html`). A grep of
`settings.js` / `admin.js` / `login.html` for `type="color"` returns **zero** — every color well is in
`index.html`. **20 `input[type="color"]`, all already wrapped in a `.color-row`.**

### 1a. The bespoke markup (representative — `index.html`)

| # | file:line | id | Row shape today |
|---|---|---|---|
| 1 | `index.html:748` | `clr-bg` | `<div class="color-row"><label>Background</label><input type="color" id="clr-bg"><button class="color-reset-btn" …>↺</button></div>` |
| 2 | `index.html:749` | `clr-fg` | label + swatch + reset |
| 3 | `index.html:750` | `clr-panel` | label + swatch + reset |
| 4 | `index.html:751` | `adv-sidebarBg` | label + swatch + reset (`data-reset-adv`) |
| 5 | `index.html:752` | `clr-border` | label + swatch + reset |
| 6 | `index.html:753` | `clr-red` (Accent) | label + swatch + reset |
| 7–17 | `index.html:763,764,765,771,772,778,779,780,781,787,788,794` | `adv-userBubbleBg … adv-toggleActive` | label (one is an inline SVG hamburger glyph, `:772`) + swatch + reset (`data-reset-adv`) |
| 18 | `index.html:810` | `harmony-accent` | `.color-row` (inline `justify-content:flex-start;gap:8px`) + swatch + a hex `<span>` **(no reset)** |
| 19 | `index.html:934` | `theme-bg-effect-color` | `.color-row` (inline `margin:0;padding:0`) + swatch + reset (`data-reset-effect`) — sits under an "Effect color" label group |

(18 wells carry the standard `label + swatch + .color-reset-btn`; `harmony-accent` swaps the reset for a
hex readout; `theme-bg-effect-color` is a compact inline row. **All 20 are `.color-row` today** — the
migration renames the frame class, it does not restructure the DOM.)

`.color-reset-btn` count in `index.html`: **19** (18 adv/basic + `data-reset-effect`).

### 1b. The bespoke CSS (`frontend/static/style.css`, inside the `#theme-tab-customize` block)

```css
/* style.css:7170-7198 */
.color-row { display: flex; align-items: center; gap: 4px; }
.color-row label { font-size: 13px; font-weight: 500; color: var(--fg); opacity: 0.7; flex: 1; }
.color-row input[type="color"],
.color-row input.cp-swatch-input {          /* dual-state: native AND post-swap swatch */
  width: 24px; height: 24px; border: 1px solid var(--border); border-radius: 50%;
  background: none; cursor: pointer; padding: 0; flex-shrink: 0; overflow: hidden;
  -webkit-appearance: none; appearance: none;
}
.color-row input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
.color-row input[type="color"]::-webkit-color-swatch { border: none; border-radius: 50%; }
.color-row input[type="color"]::-moz-color-swatch { border: none; border-radius: 50%; }
.color-row input.cp-swatch-input { color: transparent; text-shadow: none; caret-color: transparent; font-size: 0; user-select: none; }
.color-row input.cp-swatch-input::selection { background: transparent; }
.color-row input.cp-swatch-input:focus { outline: 1px solid var(--red); outline-offset: 1px; }   /* ← accent-hued focus, no tokenized ring */
.color-reset-btn { width: 24px; height: 24px; border: none; background: none; cursor: pointer; color: var(--fg); opacity: 0; font-size: 1.15rem; padding: 0; line-height: 1; transition: opacity .15s, color .15s; flex-shrink: 0; pointer-events: none; }
.color-reset-btn.changed { opacity: 0.4; pointer-events: auto; }
.color-reset-btn.changed:hover { opacity: 1; color: var(--red); }
/* style.css:12123-12127 — hover-highlight on the whole row */
#theme-tab-customize .color-row { … }
#theme-tab-customize .color-row:hover { … }
```

### 1c. The runtime that makes this a WELL, not a native picker (`colorPicker.js`)

`theme.js:1424` calls `initColorPickers(document)`, which runs
`colorPicker.js:447 → root.querySelectorAll('input[type="color"]').forEach(attachColorPicker)`.
`attachColorPicker` (`colorPicker.js:400-444`) **mutates each input**: `type` → `text`, adds
`readOnly`, adds class `cp-swatch-input`, wraps `.value` so any theme write repaints the swatch
background, and binds `mousedown` to open the in-house `.cp-popover`. **Consequence for the CSS
contract:** the well must style **both** the pre-swap `input[type="color"]` state (no-JS / first paint)
**and** the post-swap `input.cp-swatch-input` state — exactly as `.color-row` does today. The kit MUST
keep that dual selector.

---

## 2. Proposed primitive — markup + CSS contract

### 2a. Class API

```
.ow-color-well                     the row frame (label + swatch + trailing action), flex, gap
  > label / .ow-color-well__label  the field label (neutral --fg ink, no accent)
  > input[type="color"]            the swatch, pre-JS-swap  ┐ styled identically
  > input.cp-swatch-input          the swatch, post-JS-swap ┘ (dual selector, one rule)
  > .ow-color-well__reset          OPTIONAL trailing reset/hex slot (maps .color-reset-btn)
.ow-color-well--compact            inline/margin-collapsed variant (theme-bg-effect-color)
.ow-color-well--start              left-aligned variant (harmony-accent; replaces the inline style)
```

The swatch keeps its native element and native picking behavior; the well only frames it. `.ow-color-well`
is a **row primitive** (label + control + action), the color-specific sibling of `.ow-field`.

### 2b. CSS contract (authored in the ELEMENT KIT region of `style.css`, between the `── ELEMENT KIT ──`
and `── END ELEMENT KIT ──` markers so `test_0773_element_kit.py`'s region pins still bound it)

```css
/* ── COLOR WELL: .ow-color-well — kit frame around a native color swatch (#1638) ─── */
.ow-color-well { display: flex; align-items: center; gap: var(--ow-space-1, 4px); }
.ow-color-well--start { justify-content: flex-start; gap: var(--ow-space-2, 8px); }
.ow-color-well--compact { margin: 0; padding: 0; }
.ow-color-well > label,
.ow-color-well .ow-color-well__label {
  font-size: var(--ow-fs-body, 0.8125rem); font-weight: var(--ow-fw-medium, 500);
  color: var(--ow-control-ink, #16191f);      /* neutral ink on glass — NO accent on the label */
  opacity: 0.72; flex: 1;
}
/* the swatch — one rule for BOTH the native input AND colorPicker.js's swapped .cp-swatch-input */
.ow-color-well input[type="color"],
.ow-color-well input.cp-swatch-input {
  width: 24px; height: 24px; flex-shrink: 0; padding: 0; overflow: hidden;
  border-radius: 50%; cursor: pointer; background: none;
  border: 1px solid var(--ow-control-rim);    /* soft tokenized hairline, not var(--border) */
  -webkit-appearance: none; appearance: none;
}
.ow-color-well input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
.ow-color-well input[type="color"]::-webkit-color-swatch { border: none; border-radius: 50%; }
.ow-color-well input[type="color"]::-moz-color-swatch     { border: none; border-radius: 50%; }
.ow-color-well input.cp-swatch-input { color: transparent; text-shadow: none; caret-color: transparent; font-size: 0; user-select: none; }
.ow-color-well input.cp-swatch-input::selection { background: transparent; }
/* tokenized system-blue focus ring (replaces the accent-hued 1px var(--red) outline) */
.ow-color-well input[type="color"]:focus-visible,
.ow-color-well input.cp-swatch-input:focus-visible {
  outline: var(--ow-focus-ring-w, 3px) solid var(--ow-focus-ring, #0a84ff);
  outline-offset: 2px;
}
/* trailing action slot (the reset ↺, or the hex readout) */
.ow-color-well__reset {
  width: 24px; height: 24px; flex-shrink: 0; padding: 0; line-height: 1;
  border: none; background: none; cursor: pointer; font-size: 1.15rem;
  color: var(--ow-control-ink, #16191f); opacity: 0;
  pointer-events: none; transition: opacity .15s, color .15s;
}
.ow-color-well__reset.changed { opacity: 0.4; pointer-events: auto; }
.ow-color-well__reset.changed:hover { opacity: 1; }
/* Full-Glass: the swatch is a genuine glass chip → take the specular rim like other kit controls */
body.glass-full .ow-color-well input[type="color"],
body.glass-full .ow-color-well input.cp-swatch-input {
  box-shadow: inset 0 1px 0 var(--ow-glass-rim, rgba(255,255,255,0.12));
}
```

### 2c. Tier behavior (frosted / glass / flat)

- The swatch **shows the picked color** — its fill is the value itself, so unlike `.ow-btn`/`.ow-field`
  it is NOT a glass material and must NOT take a `backdrop-filter` (that would muddy the color it exists
  to display). This is why the block is authored mostly **tier-agnostic** (unscoped), with only the
  **rim** upgraded under `body.glass-full`. This matches how the app already renders it (the current
  `.color-row` rules are unscoped and work on every tier).
- Frosted / Flat: the tokenized hairline `--ow-control-rim` + the neutral label ink read correctly on
  both (both tokens resolve to the neutral chrome ink, never the theme accent).
- The **focus ring** is the fixed system-blue `--ow-focus-ring` on every tier (the current
  `outline: 1px solid var(--red)` is an accent-hued, non-token ring — the migration's one real visual
  change, and a legibility/contract win).

### 2d. Tap target / a11y

- **Coarse-pointer floor (WCAG 2.5.5):** add a coarse-pointer `@media` rule (owned in `style.css`,
  mirroring the `.oc-pin` 44px precedent at `style.css` RESP block) that lifts the swatch's *hit area*
  to `--ow-tap-min` (44px) without growing the 24px visual chip — expand the tap box with
  `padding`+negative `margin` or a `::before` overlay, keeping the compact grid layout. The trailing
  `.ow-color-well__reset` gets the same 44px coarse floor.
- **Keyboard/AT:** the native input is natively focusable and labelled by its adjacent `<label>` (keep
  the label association — several rows use an implicit wrapping `<label>` or a text `<label>` adjacent;
  where the label is an SVG-only glyph, `index.html:772`, keep its `title`/add `aria-label`). The
  `.cp-swatch-input` swap sets `readOnly` but stays a focusable `<input>`, so the ring applies.
- **No-accent-on-text contract (#726/#773):** label and reset ink are `--ow-control-ink`, never
  `--accent`/`--red`. The reset's hover color drops the `var(--red)` it uses today.

---

## 3. Migration mapping (migration-only)

| Consumer | Change | Kind |
|---|---|---|
| `index.html:748-794` (18 basic/advanced rows) | `class="color-row"` → `class="ow-color-well"`; `class="color-reset-btn"` → `class="ow-color-well__reset"` | pure class swap |
| `index.html:810` `harmony-accent` | `class="color-row" style="justify-content:flex-start;gap:8px;"` → `class="ow-color-well ow-color-well--start"` (drop inline style) | class swap + inline-style removal |
| `index.html:934` `theme-bg-effect-color` | `class="color-row" style="margin:0;padding:0;"` → `class="ow-color-well ow-color-well--compact"`; reset → `ow-color-well__reset` | class swap + inline-style removal |
| `style.css:7170-7198` | DELETE the `.color-row` / `.color-reset-btn` block; its behavior moves into the kit region | CSS retire |
| `style.css:12123-12127` | re-point `#theme-tab-customize .color-row` hover-highlight → `.ow-color-well` (or delete if folded into the kit rule) | CSS re-point |
| `colorPicker.js` | **no change** — it already targets `input[type="color"]` / adds `.cp-swatch-input`; the kit dual selector matches | none |
| `theme.js` (`.color-reset-btn.changed` toggles, `data-reset*` handlers) | JS toggles the `.changed` class and reads `data-reset*` attrs — **keep both**; only the base class name changes. Verify `querySelector('.color-reset-btn')` call sites are renamed to `.ow-color-well__reset` | JS class-name swap (grep `color-reset-btn` in `theme.js`) |

**JS class-name references to update** (grep `color-reset-btn` across `js/`): the change/reset wiring in
`theme.js` selects `.color-reset-btn` to toggle `.changed`. Rename those selectors in the same PR, or
(safer, smaller-diff option) **keep `.color-reset-btn` as a second class on the element**
(`class="ow-color-well__reset color-reset-btn"`) so the JS selectors keep working and only the CSS
moves — an owner-decision (see §5).

---

## 4. Test plan — `frontend/tests/test_1638_color_well_kit.py`

Source-pinned convention checks (the FE pytest lane has no DOM runtime), mirroring
`test_1638_compact_icon_kit.py` / `test_0771_compact_pin_kit.py` / `test_0773_element_kit.py`. Bind to
the KIT region + the consumer HTML.

```python
CSS  = _read("static", "style.css")
KIT  = CSS[CSS.index("── ELEMENT KIT ──"):CSS.index("── END ELEMENT KIT ──")]
HTML = _read("static", "index.html")
```

1. `test_color_well_primitive_exists_in_kit_region` — `.ow-color-well` selector present **inside `KIT`**
   (not stray app CSS).
2. `test_color_well_styles_both_native_and_swapped_swatch` — the swatch rule targets **both**
   `input[type="color"]` **and** `input.cp-swatch-input` (colorPicker.js swap coverage); asserts the
   `::-webkit-color-swatch` / `::-moz-color-swatch` pseudo-rules exist.
3. `test_color_well_focus_ring_is_system_blue_not_accent` — the `:focus-visible` rule uses
   `--ow-focus-ring`; assert `--accent`/`--red` **absent** from the focus rule (kills the old
   `outline: 1px solid var(--red)`).
4. `test_color_well_label_and_reset_ink_carry_no_accent_hue` — every `color:` in the `.ow-color-well`
   block resolves to `--ow-control-ink`/neutral; assert no `--accent`/`--ow-accent`/`var(--red`.
5. `test_color_well_hairline_is_tokenized` — swatch `border` uses `--ow-control-rim`, not
   `var(--border)`.
6. `test_color_well_has_44px_coarse_pointer_floor` — a coarse-pointer `@media` block in `style.css`
   raises the swatch + reset hit area to `--ow-tap-min`/`44px` (mirror the `.oc-pin` floor test).
7. `test_index_color_wells_migrated` — `index.html` has **0** `class="color-row"` occurrences and
   **20** `input[type="color"]` each inside an `.ow-color-well`; the two inline-styled rows
   (`harmony-accent`, `theme-bg-effect-color`) carry `--start` / `--compact` and no residual inline
   `justify-content`/`margin`.
8. `test_bespoke_color_row_css_retired` — `.color-row {` base rule is gone from `style.css` (folded into
   the kit) *(skip/relax if the owner picks the dual-class option in §5)*.
9. `test_demo_shows_color_well` — `element_kit_demo.html` renders an `.ow-color-well` example in the
   atomic-elements section (add a demo row: a labelled swatch + reset).
10. `test_flat_tier_swatch_is_not_glass` — no `backdrop-filter` on the `.ow-color-well` swatch rule (the
    chip must show its value, never blur it).

---

## 5. Owner decisions needed

1. **Reset-button class strategy (diff size vs. cleanliness).** Either (a) rename `.color-reset-btn` →
   `.ow-color-well__reset` in HTML **and** the `theme.js` selectors (cleaner, larger diff, one grep to
   get right), or (b) keep `.color-reset-btn` as a co-class so JS is untouched and only CSS moves
   (smaller/safer diff, one extra legacy class lingers). **Recommendation: (a)** — total-kit-migration
   DoD is "everything migrates," and the JS selectors are few and local to `theme.js`.
2. **Is the trailing reset in-scope, or does `.color-reset-btn` become `.ow-btn-plain`?** The audit §5e
   lists `.color-reset-btn` as "→ `.ow-btn-plain` **or** ACCEPTED-GAP (tiny per-row reset)". This spec
   folds it into `.ow-color-well__reset` (a well sub-part) rather than a standalone `.ow-btn-plain`,
   because it is a 24px opacity-in-on-change affordance, not a labelled button. **Confirm** the well
   owns its reset slot vs. forcing `.ow-btn-plain` (which would fight the 0-opacity-until-changed
   behavior).
3. **`harmony-accent` hex readout.** It uses a hex `<span>` instead of a reset. Keep it as free-form
   content in the trailing slot (no primitive needed), confirmed.
