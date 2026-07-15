# 1638 — `.ow-resize-handle` kit primitive (G7)

> 📐 **Build-ready design spec** · 2026-07-15 · for **Workflow 2** of the #1638 total-kit migration.
> Closes the **G7** gadget-rail resize-handle ACCEPTED-GAP row in the
> [total-kit inventory](../audits/2026-07-15-total-kit-migration-inventory.md) §10 / §3b.
> **DOC-ONLY** — no source edits ride with this spec.

## 1. What this primitive is

A **resize handle** is the thin, edge-hugging grab affordance that drives a container's width (or
height) by drag **and** by keyboard. It is a *grip*, not a form control — the inventory's own note is
that it is a "drag/keyboard grip, **not** `<input type=range>`", which is precisely why `.ow-slider`
(a track + thumb painting a *value*) is the wrong target. `.ow-resize-handle` gives the grip its own
kit-branded look + affordance contract so it stops being one-off CSS.

Today there is exactly **one** consumer (`.gadget-rail-resize-handle`), so the migration is *literally*
a rename-into-the-kit — but it is worth doing because (a) the total-kit DoD is "everything migrates,"
(b) the window kit's own edge-resize grips are a latent second consumer that should share the language,
and (c) the current affordance carries a hard-won set of decisions (neutral glass rim not accent,
system-blue focus, side-swap mirroring) that deserve to be canonical rather than buried in an app rule.

## 2. Consumer inventory (file:line + current bespoke markup/CSS)

### G7 — Gadget-rail width grip (the sole consumer)

**Markup / wiring** — `orwellGadgetRail.js`:

| Concern | file:line | Current |
|---|---|---|
| Element creation | `:748-761` (`ensureResizeHandle`) | `div.gadget-rail-resize-handle` |
| ARIA role/attrs | `:753-757` | `role="slider"`, `aria-orientation="vertical"`, `aria-label="Resize the control room"`, `aria-valuemin`, `tabindex="0"` |
| Live value sync | `:722-731` (`_syncResizeAria`) | `aria-valuenow` / `aria-valuemax` / `aria-valuetext` kept in lockstep with the applied width |
| Drag wiring | `wireResize():777-811` | `pointerdown`→`setPointerCapture`→`pointermove`/`pointerup`/`pointercancel`; `.grail-resizing` class on the rail during drag |
| **Keyboard wiring** | `:813-822+` | `ArrowLeft`/`ArrowRight` nudge; `Shift` = 32px step, else 12px; sense follows side-swap so "widen" is natural on either side |
| Clamp / persist | `:700-736` | `MIN_W=220`, `maxW()=min(520, 40vw)`, persisted under `orwell-gadget-rail-width`; hidden when collapsed / narrow (`isResizable()`) |

**CSS** — `style.css:1964-1992`:

```css
.gadget-rail-resize-handle {
  position: absolute; top: 0; bottom: 0; left: -3px; width: 8px; z-index: 4;
  cursor: ew-resize; touch-action: none; background: transparent;
  border: none; padding: 0; margin: 0;
}
.gadget-rail-resize-handle::before {                 /* the visible 2px bar */
  content: ""; position: absolute; top: 0; bottom: 0; left: 3px; width: 2px;
  background: transparent; transition: background .12s ease;
}
.gadget-rail-resize-handle:hover::before,
.gadget-rail.grail-resizing .gadget-rail-resize-handle::before {
  background: rgba(255,255,255,0.55);                /* #8/#9: NEUTRAL glass rim, NO accent/red */
}
.gadget-rail-resize-handle:focus-visible::before { background: var(--ow-ios-blue, #0a84ff); }
.gadget-rail-resize-handle:focus-visible { outline: none; }
body[data-gadget-side="left"] .gadget-rail-resize-handle { left: auto; right: -3px; }
body[data-gadget-side="left"] .gadget-rail-resize-handle::before { left: auto; right: 3px; }
.gadget-rail.grail-resizing { transition: none; }
.gadget-rail[data-collapsed="true"] .gadget-rail-resize-handle { display: none; }
```

**Two design decisions already baked in and worth canonicalizing:**
- **No accent hue** (#8/#9): hover + active-drag show a **neutral luminous white bar** (the glass-rim
  language, `rgba(255,255,255,.55)`), never `--accent`/`--red`. This matches the colorless-glass-chrome
  contract the whole kit follows.
- **Focus = the one sanctioned system-blue** (`--ow-ios-blue`), matching the kit focus-ring contract.

### Latent second consumer (not in this lane, but the reason to generalize)

The window kit (`orwellWindow.js`) supports resizable windows. Grep confirms edge/corner resize logic
there; whatever grip it paints should share `.ow-resize-handle` in a **later** lane. This spec defines
the primitive so that future adoption is a class swap, but **scopes the migration to G7 only**.

## 3. Proposed markup + CSS contract

### 3.1 Structure

```html
<!-- vertical edge grip (drives width) -->
<div class="ow-resize-handle" role="slider"
     aria-orientation="vertical" aria-label="Resize the control room"
     aria-valuemin="220" aria-valuenow="300" aria-valuemax="520"
     aria-valuetext="300 pixels" tabindex="0"></div>
```

The primitive is presentation + affordance only; the **drag/keyboard/clamp/persist logic stays in the
consumer** (`orwellGadgetRail.js`) — the kit does not own width state. This mirrors how `.ow-slider`
is styling-only and the value logic lives in the consumer.

### 3.2 Selectors, tokens, states

| Selector | Role | Declarations |
|---|---|---|
| `.ow-resize-handle` | the hit strip | `position:absolute; inset-block:0; width: var(--ow-resize-thickness, 8px); touch-action:none; background:transparent; border:none; padding:0; margin:0; cursor: var(--ow-resize-cursor, ew-resize); z-index: var(--ow-resize-z, 4)` — **`inset-block:0`** (the old `top:0; bottom:0`) is authored in the kit so the strip is full-height; the *horizontal* edge anchor (old `left:-3px` / side-swapped `right:-3px`) is the consumer's via `[data-edge]` below |
| `.ow-resize-handle::before` | the visible bar | `content:""; position:absolute; inset-block:0; width: var(--ow-resize-bar, 2px); background:transparent; border-radius: var(--ow-radius-pill); transition: background .12s ease` |
| `.ow-resize-handle:hover::before`, `.ow-resize-handle.is-active::before` | hover / drag | `background: var(--ow-glass-rim-strong, rgba(255,255,255,.55))` — neutral luminous rim, **no accent** |
| `.ow-resize-handle:focus-visible::before` | keyboard focus | `background: var(--ow-focus-ring, var(--ow-ios-blue))` |
| `.ow-resize-handle:focus-visible` | focus | `outline: none` (the bar *is* the focus signal) |
| `.ow-resize-handle[aria-orientation="horizontal"]` | height grip variant | swaps axis: `inset-inline:0; height: var(--ow-resize-thickness); cursor: ns-resize`; bar becomes a horizontal line |
| `.ow-resize-handle[data-edge="start"]` / `[data-edge="end"]` | edge side | positions the strip + bar on the leading/trailing edge (generalizes the `data-gadget-side` mirroring), preserving the exact offsets: `[data-edge="start"] { inset-inline-start:-3px }` + its `::before { inset-inline-start:3px }`, `[data-edge="end"]` mirrored to `inset-inline-end`. **Do not drop these** — without the edge offset the strip detaches from the rail, and without the `::before` inset the 2px bar collapses onto the wrong edge |

**Consumer keeps its own edge placement** (`left:-3px` vs side-swap `right:-3px`) via the `data-edge`
attribute or a thin consumer override — the primitive provides the *look*, the consumer the *anchor*.
The active-drag class becomes `.is-active` on the handle (the consumer currently keys off
`.grail-resizing` on the *rail*; either works — recommend the handle owns `.is-active` so the primitive
rule is self-contained, with the rail's `.grail-resizing` kept only for its `transition:none`).
**`.is-active` lifecycle:** the consumer adds `.is-active` on `pointerdown` (drag start) and removes it
on `pointerup`, `pointercancel`, **and** any aborted drag — mirroring the existing `grail-resizing`
add/remove (`orwellGadgetRail.js:805` add on `pointerdown`; `:792` remove inside `endDrag`, bound to
`pointerup`/`pointercancel` at `:808-809`). So a released or cancelled drag always drops the active
bar paint back to the hover/rest state.

### 3.3 Two-tier + a11y

- **Frosted / Flat**: the grip is transparent by default and only paints its 2px bar on
  hover/drag/focus, so there is little tier divergence — but author it inside the ELEMENT KIT region
  so `--ow-glass-rim-strong` resolves per tier (a slightly softer rim on Flat if the wallpaper is dark).
- **a11y trio**: `@media (prefers-reduced-motion: reduce)` drops the `.12s` bar transition;
  `@media (prefers-contrast: more)` thickens the bar (`--ow-resize-bar: 3px`) and darkens/strengthens
  the rim so the grip is unmistakable; `@media (prefers-reduced-transparency: reduce)` gives the
  hover/drag bar a solid neutral fill instead of the translucent rim.
- **Tap target (see owner decision):** the visible bar is 2px and the hit strip 8px — far below the
  44px coarse-pointer floor. Today the handle is **desktop-only** (`isResizable()` returns false on
  narrow / touch, `orwellGadgetRail.js:764-768`), so there is no touch tap-target obligation. The
  primitive must **preserve** that: `.ow-resize-handle` is a pointer-fine affordance, and on
  `@media (pointer: coarse)` the consumer hides it (mobile uses the full-drawer, not a width grip).

## 4. Migration mapping (G7)

| Current | → Target |
|---|---|
| `.gadget-rail-resize-handle` (CSS `style.css:1964-1992`) | delete; author `.ow-resize-handle` in the ELEMENT KIT region |
| `resizeHandle.className = "gadget-rail-resize-handle"` (`:749`) | `"ow-resize-handle gadget-rail-resize-handle"` (dual-class: kit look + the consumer's edge-position/`display:none`-when-collapsed overrides) |
| hover/drag `rgba(255,255,255,.55)` bar | `--ow-glass-rim-strong` token (same value, now shared) |
| `:focus-visible::before { --ow-ios-blue }` | `--ow-focus-ring` (same value, shared) |
| `body[data-gadget-side="left"]` edge mirror + the strip `left:-3px` / `::before left:3px` offsets | keep as the consumer override (edge anchor is consumer-owned) OR move to `[data-edge]` on the handle — **the horizontal edge offsets MUST survive the move** (the kit only supplies `inset-block:0` + width; the leading/trailing `-3px`/`3px` anchoring is consumer/`[data-edge]`-owned, §3.2), or the strip detaches from the rail |
| `.grail-resizing` drag class | keep on the rail for `transition:none`; add `.is-active` on the handle for the bar paint — added on `pointerdown` (`:805`), removed on `pointerup`/`pointercancel`/aborted drag inside `endDrag` (`:792`,`:808-809`) |
| `role="slider"` + full `aria-value*` set + arrow-key nudge (`:753-822`) | **unchanged** — the consumer keeps all a11y/keyboard/clamp/persist logic |

Net: one CSS block moves into the kit + a class dual-classing on one line. **No behavior change**, no
ARIA change, no wiring change.

## 5. Test plan (`frontend/tests/test_1638_resize_handle_kit.py`)

Source-pinned, mirroring `test_1638_compact_icon_kit.py`. Bind the ELEMENT KIT region for the CSS
pins and the consumer JS for the adoption pins.

1. **`test_resize_handle_primitive_exists`** — `.ow-resize-handle` and `.ow-resize-handle::before`
   are authored in KIT; the strip is `background: transparent` + `touch-action: none`, carries
   `inset-block:0` (the full-height extent from the old `top:0; bottom:0`), and the bar is
   token-driven (`--ow-resize-bar`); the `[data-edge]` variants keep the `-3px`/`3px` edge offsets so
   the strip stays anchored to the rail.
2. **`test_hover_and_drag_rim_is_neutral_not_accent`** — the hover / `.is-active` bar uses the neutral
   glass-rim token, and the primitive's resize rules contain **no** `--accent`/`var(--red`/`#f` red —
   the #8/#9 "no red on the resize affordance" contract, pinned in the kit now.
3. **`test_focus_is_system_blue`** — `:focus-visible::before` uses `--ow-focus-ring`/`--ow-ios-blue`
   and `:focus-visible { outline: none }` (the bar is the focus signal).
4. **`test_orientation_variants`** — a `[aria-orientation="horizontal"]` (or `--ow-resize` axis)
   variant exists so the primitive isn't width-only.
5. **`test_honors_a11y_trio`** — reduced-motion drops the bar transition; contrast thickens the bar;
   reduced-transparency solidifies the hover fill.
6. **`test_gadget_rail_adopts_the_primitive`** —
   - `orwellGadgetRail.js` sets `className` containing `ow-resize-handle` (adoption landed);
   - the handle **still** sets `role="slider"`, `tabindex="0"`, `aria-valuemin/now/max/text`, and the
     `ArrowLeft`/`ArrowRight` keydown branch survives (the keyboard-a11y regression guard — see §6);
   - `style.css` no longer contains a standalone `.gadget-rail-resize-handle { … cursor: ew-resize`
     appearance block (moved to the kit), keeping only the consumer's edge/`display:none` overrides;
   - the handle's `.is-active` (bar-paint) class is added on `pointerdown` and removed on
     `pointerup`/`pointercancel` (mirrors the `grail-resizing` add/remove) so a released/cancelled
     drag drops the active bar back to rest.
7. **`test_desktop_only_no_coarse_pointer_obligation`** — assert the consumer still gates the handle
   behind `isResizable()`/`_isNarrow()` (the handle must not appear on touch, so the sub-44px grip is
   never a tap-target violation).
8. **`test_demo_and_docs_reference_the_primitive`** — `element_kit_demo.html` shows a
   `.ow-resize-handle` (rest / hover / focus) and `ELEMENT_KIT.md` documents it, explicitly noting
   *why it is a grip and not `.ow-slider`*.

## 6. Owner decision needed (the keyboard-a11y question)

**The task frames G7 as "drag-only today — spec a keyboard-resizable fallback or document the accepted
gap." The premise is already resolved: the handle is NOT drag-only.** `orwellGadgetRail.js:813-822`
implements `ArrowLeft`/`ArrowRight` width nudges (12px, or 32px with Shift), the element is
`role="slider"` + `tabindex="0"` with a live `aria-value*` set (`_syncResizeAria`, `:722-731`), and it
takes focus. So there is **no keyboard gap to close** — the correct action is to **preserve** the
existing keyboard support through the migration and pin it (test §6 above).

The genuine, narrower owner decisions are:

1. **Generalize now, or G7-only?** Recommend defining `.ow-resize-handle` as a reusable primitive
   (orientation + edge variants) but migrating **only G7** in this lane; the window-kit edge grips
   adopt it in a later lane. (Cheap to define both variants now; avoids a churny second refactor.)
2. **`Home`/`End` + `PageUp`/`PageDown` keys.** ARIA's slider pattern recommends `Home`/`End` (jump to
   `MIN_W`/`maxW()`) and `Page*` (large step). The current handle implements only arrows. **Decision:**
   add the full slider key-set to `orwellGadgetRail.js` as part of the lane (a small, safe a11y
   improvement — recommended), or accept arrows-only as sufficient and document it. Either way this is
   a *consumer* change, not a primitive change.
3. **Active-drag class location.** `.grail-resizing` currently lives on the *rail*; the kit rule wants
   `.is-active` on the *handle* for a self-contained primitive. Confirm the handle may own `.is-active`
   (recommend yes; keep `.grail-resizing` on the rail only for its `transition:none`).
