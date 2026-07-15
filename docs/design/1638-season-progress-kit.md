# 1638 — `.ow-progress` kit adoption for the season-progress overlays (G8)

> 📐 **Build-ready design spec** · 2026-07-15 · for **Workflow 2** of the #1638 total-kit migration.
> Closes the **G8** season-progress ACCEPTED-GAP row in the
> [total-kit inventory](../audits/2026-07-15-total-kit-migration-inventory.md) §10.
> **DOC-ONLY** — no source edits ride with this spec.

## 1. What this is (and why it's the mildest lane)

The season-progress surfaces are **two display-only overlays**, both `pointer-events: none`, injected
by `orwellSeasonProgress.js`:

- a **progress bar** pinned to the bottom edge (`#orwell-season-progress`), fill = season completion %;
- a **season chip** pinned top-right (`#orwell-season-chip`), text = "Season N".

Because they are **non-interactive** the inventory correctly parked them as an ACCEPTED-GAP against the
*element* kit (there is no button/field to migrate). But the total-kit DoD is "everything migrates,"
and the real, honest gap here is **visual consistency**: both overlays hand-roll their own bespoke fill
colors, radii, and token fallbacks that drift from the rest of the product — e.g. the chip uses a
`--mono, monospace` face and a raw `--panel 78%` glass fill nobody else uses, and the bar mixes
`--accent` with an `--accent-primary` fallback in a way no kit surface does.

So G8 is **not** "make them interactive." It is: give the bar a **`.ow-progress`** structure (a kit
progressbar primitive) and give the chip an **`.on-chip`** notice-family treatment, so both compose
kit tokens and read as part of the same system — while staying strictly display-only.

## 2. Consumer inventory (file:line + current bespoke CSS/markup)

### G8a — Season progress bar — `orwellSeasonProgress.js`

| Concern | file:line | Current bespoke |
|---|---|---|
| Bar shell | `:84-89` | `#orwell-season-progress { position:fixed; left:0; right:0; bottom:0; z-index:60; height:4px; pointer-events:none; display:none; background: color-mix(in srgb, var(--accent, var(--accent-primary, #6d4aff)) 16%, transparent) }` |
| Fill | `:90-95` | `> .osp-fill { height:100%; width:0%; background: var(--accent, var(--accent-primary, #6d4aff)); transition: width .5s ease-out; will-change: width }` |
| Reduced-motion | `:96-98` | freezes the width transition |
| Markup | `:101-118` | `<div id role="progressbar" aria-label="Season progress" aria-valuemin=0 aria-valuemax=100 aria-describedby=…><div class="osp-fill"></div><span …sr-only>Advances as houseguests are evicted</span></div>` |
| Value paint | `paint():127-134` | sets `display:block`, `aria-valuenow`, `.osp-fill` width % |

Already has a **correct ARIA `progressbar`** (`role`, `aria-valuemin/max/now`, `aria-describedby` +
visually-hidden description) — that stays; only the *look* migrates.

### G8b — Season chip — `orwellSeasonProgress.js`

| Concern | file:line | Current bespoke |
|---|---|---|
| Chip shell | `:177-187` | `#orwell-season-chip { position:fixed; top:8px; right:10px; z-index:58; display:none; pointer-events:none; padding:2px 9px; border-radius:999px; font-family: var(--mono, monospace); font-size:11px; font-weight:600; letter-spacing:.04em; color: color-mix(--accent 88%, --fg); background: color-mix(--panel 78%, transparent); border: 1px solid color-mix(--accent 38%, transparent); opacity:.82 }` |
| Markup | `:189-192` | `<div id aria-label="Season number">Season N</div>` |
| Reposition | `positionChip():201-…` | fixed-position collision avoidance vs the top bar / rail (stays) |

The chip is a **pill-shaped status label**. Its bespoke `--mono`/`--accent`-heavy styling is exactly
the kind of drift the notice-chip family (`.on-*`) exists to normalize.

## 3. Proposed markup + CSS contract

### 3.1 The bar → `.ow-progress` (a kit progressbar primitive)

A small display-only progress primitive in the ELEMENT KIT region (there is currently **no** progress
primitive — this adds a genuinely reusable one; future callers: portrait-backfill progress, image-gen
budget, upload progress):

```html
<div class="ow-progress ow-progress--edge" id="orwell-season-progress"
     role="progressbar" aria-label="Season progress"
     aria-valuemin="0" aria-valuemax="100" aria-valuenow="…"
     aria-describedby="orwell-season-progress-desc">
  <div class="ow-progress-fill osp-fill"></div>
  <span id="orwell-season-progress-desc" class="ow-sr-only">Advances as houseguests are evicted</span>
</div>
```

| Selector | Role | Declarations |
|---|---|---|
| `.ow-progress` | track | `overflow:hidden; border-radius: var(--ow-progress-radius, var(--ow-radius-pill)); height: var(--ow-progress-h, 6px); background: var(--ow-progress-track, color-mix(in srgb, var(--fg) 12%, transparent))` |
| `.ow-progress-fill` | fill | `height:100%; width:0%; background: var(--ow-progress-fill-color, var(--accent, var(--accent-primary))); transition: width .5s ease-out; will-change: width` |
| `.ow-progress--edge` | fixed bottom-edge variant | `position:fixed; left:0; right:0; bottom:0; z-index: var(--ow-progress-z, 60); height: var(--ow-progress-edge-h, 4px); pointer-events:none; border-radius:0` |
| `@media (prefers-reduced-motion: reduce)` | | `.ow-progress-fill { transition:none }` |

The season bar becomes `.ow-progress.ow-progress--edge` and keeps `#orwell-season-progress` for the
positioning + the JS hooks; `.osp-fill` stays dual-classed with `.ow-progress-fill` so `paint()`'s
`querySelector('.osp-fill')` is untouched. **Behavior is identical**; the only change is the track/fill
now derive from `.ow-progress` tokens instead of the inline `color-mix(--accent 16%)`.

### 3.2 The chip → `.on-chip` (notice-family pill) or `.ow-badge`

The chip is a status pill, which is squarely the **notice** family's territory (`.on-*`,
`OrwellNoticeKit`). Give it a display-only `.on-chip` treatment (a static labelled pill), keeping the
`#orwell-season-chip` id for positioning + JS:

```html
<div class="on-chip on-chip--season" id="orwell-season-chip" aria-label="Season number">Season N</div>
```

| Selector | Role | Declarations |
|---|---|---|
| `.on-chip` | pill | `display:inline-flex; align-items:center; padding: 2px 9px; border-radius: var(--ow-radius-pill); font: 600 var(--fs-2xs)/1 var(--ow-ui-font); letter-spacing:.04em; color: var(--fg); background: var(--on-chip-bg, color-mix(in srgb, var(--panel) 82%, transparent)); border: 1px solid var(--ow-glass-rim-border)` |
| `.on-chip--season` | placement | `position:fixed; top:8px; right:10px; z-index:58; pointer-events:none; opacity:.9` |

Key drift-fixes folded in: drop the `--mono, monospace` face for the canonical `--ow-ui-font` (the
kit "no stray monospace chrome" rule the cast-pin fix #771 established); drop the accent-tinted ink
for legible `--fg`; use `--ow-glass-rim-border` for the hairline instead of `--accent 38%`.

### 3.3 Two-tier + a11y

- **Frosted / Flat:** `.ow-progress` track and `.on-chip` fill are token-driven (`--fg`/`--panel`/
  `--ow-glass-rim-border`) with no blur, so they read coherently on both tiers with a single author
  (the `.og-card` cross-tier idiom); no `body.theme-frosted` gate needed for these (they never stack a
  backdrop sample). Author them where the other display primitives live.
- **a11y trio:** reduced-motion freezes the fill transition (already true for the bar; add for the
  primitive); contrast strengthens the track/fill delta and the chip border; reduced-transparency
  solidifies the chip fill (`--panel` opaque). The bar's `role="progressbar"` + description and the
  chip's `aria-label` are **preserved verbatim** — both are already correct.
- **Non-interactive is preserved:** both keep `pointer-events: none`; neither is a tab stop; the
  primitive must not add `:hover`/`:focus`/`cursor` (they are display overlays, not controls).

## 4. Migration mapping per consumer

| Current | → Target |
|---|---|
| `#orwell-season-progress` inline shell CSS (`:84-89`) | `.ow-progress.ow-progress--edge`; keep the id for JS + z/placement overrides |
| `.osp-fill` inline fill CSS (`:90-95`) | `.ow-progress-fill.osp-fill` (dual-class; `paint()` selector unchanged) |
| bar `color-mix(--accent 16%)` track + `--accent` fill | `--ow-progress-track` / `--ow-progress-fill-color` tokens (season bar sets fill-color to `--accent`, so the *look* is preserved while the structure is shared) |
| bar reduced-motion rule (`:96-98`) | inherits `.ow-progress` reduced-motion (delete the local dup) |
| `#orwell-season-chip` inline shell CSS (`:177-187`) | `.on-chip.on-chip--season`; keep the id for `positionChip()` |
| chip `--mono` face + `--accent` ink/border | `--ow-ui-font` + `--fg` + `--ow-glass-rim-border` (drift-fix) |
| ARIA on bar + chip (`role`, `aria-*`) | **unchanged** |
| `paint()`, `positionChip()`, show/hide logic | **unchanged** |

Net: two CSS blocks become kit-token compositions + a class addition on each element. No JS behavior
change, no ARIA change, both stay `pointer-events:none`.

## 5. Test plan (`frontend/tests/test_1638_season_progress_kit.py`)

Source-pinned, mirroring `test_1638_compact_icon_kit.py`.

1. **`test_progress_primitive_exists`** — `.ow-progress` + `.ow-progress-fill` are authored in the
   kit with a token-driven track (`--ow-progress-track`) and fill (`--ow-progress-fill-color`), and an
   `.ow-progress--edge` fixed-bottom variant.
2. **`test_progress_is_display_only`** — no `:hover`/`:focus`/`cursor:pointer` on `.ow-progress`; the
   `--edge` variant carries `pointer-events: none`.
3. **`test_progress_reduced_motion`** — `@media (prefers-reduced-motion: reduce)` freezes
   `.ow-progress-fill` width transition.
4. **`test_chip_treatment_exists`** — `.on-chip` (+ `.on-chip--season`) authored; uses `--ow-ui-font`
   (not `--mono`/monospace), `--fg` ink (not `--accent`), and `--ow-radius-pill`.
5. **`test_no_accent_ink_on_chip`** — the chip's `color:` is `--fg`/neutral, never `--accent`/
   `--ow-accent` (the "no accent on chrome text" contract — the specific drift this lane fixes).
6. **`test_season_bar_adopts_primitive`** — `orwellSeasonProgress.js` bar markup carries
   `ow-progress` + `ow-progress--edge`, the fill carries `ow-progress-fill osp-fill` (dual-class so
   `paint()`'s `.osp-fill` selector survives), and the local `#orwell-season-progress { … }` shell
   CSS block is reduced to placement/z overrides only.
7. **`test_season_chip_adopts_treatment`** — the chip markup carries `on-chip`/`on-chip--season`, and
   its bespoke `font-family: var(--mono …)` / `--accent`-tinted CSS is gone.
8. **`test_aria_preserved`** — the bar still emits `role="progressbar"` + `aria-valuemin/max/now` +
   `aria-describedby`, and the chip still emits `aria-label` (no ARIA regression through the restyle).
9. **`test_pointer_events_none_preserved`** — both overlays keep `pointer-events: none` (they must
   never intercept clicks meant for chat/composer beneath them).
10. **`test_demo_and_docs_reference_the_primitive`** — `element_kit_demo.html` shows an `.ow-progress`
    (e.g. 60%) and an `.on-chip`; `ELEMENT_KIT.md` documents both, noting they are display-only.

## 6. Owner decision needed

1. **Chip family: notice-chip (`.on-chip`) vs a new `.ow-badge`.** The chip is a static labelled pill.
   It fits the **notice** family (`.on-*`) conceptually (a passive status marker), but `OrwellNoticeKit`
   today mints *interactive/dismissible* notices — a purely-decorative fixed pill is a slightly
   different animal. **Decision:** add `.on-chip` as a display-only member of the notice family
   (recommended — reuses the notice tokens and keeps the family count down), **or** mint a tiny generic
   `.ow-badge` primitive in the element kit for any static label pill (also fine; slightly more
   surface). Either keeps the season chip non-interactive.
2. **Keep `--accent` as the bar *fill* color?** The season bar's fill is intentionally the theme accent
   (it's a branded progress cue, not chrome). `.ow-progress-fill-color` defaults to `--accent`, so the
   season bar's look is preserved. Confirm that's the intended default for the shared primitive
   (recommended: yes — a progress *fill* is a legitimate accent use, unlike chrome *text*, so this does
   not violate the "no accent on chrome ink" rule the chip fix enforces).
3. **Scope.** G8 is display-only and low-risk; confirm it rides as its own small lane (recommended) or
   folds into the settings/chrome CSS-cleanup chain — since it touches only `orwellSeasonProgress.js` +
   `style.css`, it can land independently of the settings lanes.
