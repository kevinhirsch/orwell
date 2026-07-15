# 1638 — `.ow-kbd` keycap kit primitive (R1 gap: keyboard-shortcut keycaps)

> Build-ready design spec for one of the three NEW kit primitives Workflow-2 of the #1638 total-kit
> migration will implement. Companion specs: `1638-color-well-kit.md`, `1638-theme-swatch-kit.md`.
> Mandate source: `docs/audits/2026-07-15-total-kit-migration-inventory.md` §5e + §10 (`.shortcut-key`
> keycaps listed "ACCEPTED-GAP candidate — no keycap primitive; owner ruling wanted") — the owner ruled
> *"total kit migration — everything migrates,"* so the keycap gets a real primitive.
>
> **Scope:** the little key-CHIP look — the `<kbd>` glyph chip that renders one key of a shortcut combo.
> **Out of scope:** the `.shortcut-key` rebind BUTTON that wraps the chips (an interactive `<button>` →
> `.ow-btn-plain` under audit §5e, a separate concern) and the `.shortcut-action-btn` reset (§5e →
> `.ow-btn`). This primitive is only the chip.

---

## 1. Consumer inventory

The keycap look has **one live producer**: the Settings → Shortcuts panel. A grep of `index.html`,
`login.html`, and `js/*.js` for `<kbd` returns exactly **one** hit.

### 1a. The producer (`frontend/static/js/settings.js`)

```js
// settings.js:2377-2391 — one <kbd> per combo part
function _formatKeyCaps(combo) {
  return combo.split('+').map(p => {
    let label; // 'ctrl'→'Ctrl', 'meta'→'Cmd', 'escape'→'Esc', 'space'→'Space', …
    …
    return `<kbd>${label}</kbd>`;
  }).join('');
}
```
Emitted into the shortcut row (`settings.js:2469-2474`):
```js
const keyContent = combo ? _formatKeyCaps(combo) : '<span class="shortcut-unset">Set</span>';
… <button class="shortcut-key${combo?'':' shortcut-key-unset'}" data-action="${action}"
          title="Click to rebind">${keyContent}</button> …
```
Re-emitted on rebind cancel (`settings.js:2507`) and during `startRebind` (`:2513-2514`, swaps chips for
a "Press keys…" label). So `<kbd>` chips appear **only** inside a `.shortcut-key` button; there are
`.shortcut-key-unset`, `.listening`, and `.shortcut-conflict` row states around them.

### 1b. The bespoke CSS (`frontend/static/style.css:15638-15650`)

```css
.shortcut-key kbd {
  display: inline-block; font-family: inherit; font-size: var(--fs-xs);
  padding: 2px 6px; min-width: 20px; text-align: center;
  /* Highlight kbd chips in the theme accent … */
  background: color-mix(in srgb, var(--accent, var(--red)) 14%, var(--bg));   /* ← accent-hued fill */
  border: 1px solid color-mix(in srgb, var(--accent, var(--red)) 40%, var(--border));  /* ← accent border */
  color: var(--accent, var(--red));                                          /* ← ACCENT-HUED TEXT */
  border-radius: 3px;
  box-shadow: 0 1px 0 color-mix(in srgb, var(--accent, var(--red)) 25%, transparent);
  line-height: 1.4; font-weight: 600;
}
.shortcut-key.listening kbd { border-color: var(--accent, #cc6a3a); }
```

This is the **exact** #726/#773 contract violation the kit exists to fix: the keycap paints its **text**
in the theme accent (`color: var(--accent,var(--red))`), plus an accent fill and border. The migration's
core win is a **neutral, legible, glass-consistent keycap** whose emphasis comes from the raised-chip
shape (a physical key), not a hue on the glyph.

Surrounding (kept, out of scope): `.shortcut-key` button (`:15621-15627`), `.shortcut-key-unset` +
`.shortcut-unset` "Set" placeholder (`:15629-15637`), `.shortcut-key.listening` pulse
(`:15651-15655`), `.shortcut-action-btn` (`:15656-15663`).

---

## 2. Proposed primitive — markup + CSS contract

### 2a. Class API

```
.ow-kbd            a single keycap chip (put it on the <kbd> element; or a <kbd class="ow-kbd">)
.ow-kbd-group      OPTIONAL wrapper for a run of chips in a combo (flex, tight gap) — the visual
                   "Ctrl + Shift + K" cluster (maps the inside of .shortcut-key)
```

Recommended element: keep the semantic `<kbd>` and add the class — `<kbd class="ow-kbd">Ctrl</kbd>`. A
bare-element fallback (`.shortcut-key kbd`) can also be styled so pre-existing markup upgrades without a
class, but the explicit class is the primitive.

### 2b. CSS contract (authored in the ELEMENT KIT region of `style.css`)

```css
/* ── KEYCAP: .ow-kbd — a physical key-chip (#1638) ──────────────────────────────
   Emphasis is the RAISED CHIP SHAPE (a key you press), never an accent hue on the
   glyph (#726/#773 no-accent-on-text). Neutral dark ink on a light glass chip. */
.ow-kbd {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; padding: 2px 6px;
  font-family: var(--ow-ui-font, inherit); font-size: var(--ow-fs-caption, 0.75rem);
  font-weight: var(--ow-fw-semibold, 600); line-height: 1.4;
  color: var(--ow-control-ink, #16191f);                 /* NEUTRAL ink — the fix */
  background: var(--ow-control-fill, color-mix(in srgb, #16191f 10%, transparent));
  border: 1px solid var(--ow-control-rim, color-mix(in srgb, #16191f 22%, transparent));
  border-radius: 4px;                                    /* small chip radius (no --ow-radius-xs token exists; keeps the current 3-4px keycap look — add a token only if a second consumer wants it) */
  /* the "keycap" depth: a soft top rim + a 1px bottom lip (the key's front face) */
  box-shadow: inset 0 1px 0 var(--ow-glass-rim, rgba(255,255,255,.5)),
              0 1px 0 color-mix(in srgb, #16191f 18%, transparent);
}
.ow-kbd-group { display: inline-flex; align-items: center; gap: 2px; }
/* Full Glass: the chip rides the real glass sample like other kit controls */
body.glass-full .ow-kbd {
  -webkit-backdrop-filter: var(--ow-btn-glass, blur(10px) saturate(118%));
  backdrop-filter: var(--ow-btn-glass, blur(10px) saturate(118%));
}
/* a11y trio */
@media (prefers-reduced-transparency: reduce) {
  .ow-kbd { background: var(--panel, var(--bg)); -webkit-backdrop-filter: none; backdrop-filter: none; }
}
@media (prefers-contrast: more) {
  .ow-kbd { border-color: color-mix(in srgb, var(--ow-control-ink, #16191f) 55%, transparent); }
}
```

### 2c. Tier behavior (frosted / glass / flat)

- **Frosted:** neutral translucent chip fill (`--ow-control-fill`) + tokenized rim; dark ink is legible
  on the light glass — the same recipe as every kit control.
- **Full Glass (`body.glass-full`):** the chip takes the shared `--ow-btn-glass` backdrop sample (a real
  glass keycap), consistent with the other primitives that upgrade under Full Glass.
- **Flat / Normal:** the base rule (unscoped) already gives a neutral solid-ish chip via
  `--ow-control-fill`; no accent. (`--ow-control-*` tokens resolve to the neutral chrome ink on every
  tier, so no per-tier authoring is needed beyond the Full-Glass sample and the a11y trio — matching how
  `.ow-check`/`.ow-radio` are scoped.)
- Cross-tier, the keycap **never** shows the theme accent — that is the whole point of the migration.

### 2d. Tap target / a11y

- **Non-interactive by itself.** The `<kbd>` is a passive glyph; the *interactive* element is the
  wrapping `.shortcut-key` button (its own click-to-rebind target). So `.ow-kbd` carries **no** tap-floor
  obligation — the 44px WCAG 2.5.5 floor belongs to `.shortcut-key` (audit §5e: `.shortcut-key` →
  `.ow-btn-plain`, a separate lane). The keycap must not swallow pointer events from its button parent
  (`pointer-events` left default; it is inside the button).
- **Semantics preserved:** keep the `<kbd>` element (screen readers and semantics benefit); the class is
  purely presentational.
- **Contrast:** neutral dark ink (`--ow-control-ink` #16191f) on the light chip clears AA comfortably —
  a strict improvement over `color: var(--accent)` (a mid-tone accent on a tinted-accent fill, often
  sub-AA).

---

## 3. Migration mapping (migration-only)

| Consumer | Change | Kind |
|---|---|---|
| `settings.js:2389` `_formatKeyCaps` | `return \`<kbd>${label}</kbd>\`` → `return \`<kbd class="ow-kbd">${label}</kbd>\`` (optionally wrap the `.join('')` in `<span class="ow-kbd-group">…</span>`) | render-template class add |
| `settings.js:2507` (rebind-cancel re-render) | same — calls `_formatKeyCaps`, so it inherits the class automatically | none (covered by above) |
| `style.css:15638-15650` `.shortcut-key kbd` | DELETE the accent-hued keycap block; behavior moves to `.ow-kbd` in the kit region. (Or, transitional, re-point `.shortcut-key kbd` → compose `.ow-kbd`.) | CSS retire |
| `style.css:15655` `.shortcut-key.listening kbd` | drop or re-point (the `.listening` chip no longer needs an accent border; the "Press keys…" label replaces chips during listening anyway) | CSS retire/re-point |
| `.shortcut-key` button (`style.css:15621`) | **out of scope** here — audit §5e migrates it to `.ow-btn-plain` in the settings lane (W6). Keep functional | none (separate lane) |
| `.shortcut-action-btn` (`style.css:15656`) | **out of scope** — §5e → `.ow-btn` | none (separate lane) |

This is the cleanest of the three: **one render-line class add + one CSS block move**. No behavior, no
DOM structure, no JS logic changes — the chips already render through a single helper.

Because `<kbd>` occurs **only** here, the migration is complete after the single `_formatKeyCaps`
change; there is no scattered consumer sweep.

---

## 4. Test plan — `frontend/tests/test_1638_keycap_kit.py`

Source-pinned checks mirroring `test_1638_compact_icon_kit.py` / `test_0771_compact_pin_kit.py`.

```python
CSS      = _read("static", "style.css")
KIT      = CSS[CSS.index("── ELEMENT KIT ──"):CSS.index("── END ELEMENT KIT ──")]
SETTINGS = _read("static", "js", "settings.js")
```

1. `test_keycap_primitive_exists_in_kit_region` — `.ow-kbd` selector present **inside `KIT`**.
2. `test_keycap_ink_is_neutral_not_accent` — the `.ow-kbd` rule's `color:` is `--ow-control-ink`
   (or the `#16191f` literal); assert **no** `--accent`/`var(--red)`/`--ow-accent` anywhere in the
   `.ow-kbd` block (this is the headline contract fix — the primary regression guard).
3. `test_keycap_fill_and_border_are_neutral_tokens` — `background`/`border` use `--ow-control-fill` /
   `--ow-control-rim`; assert no `var(--accent`/`var(--red` fill or border.
4. `test_keycap_has_chip_depth` — a `box-shadow` giving the raised-key look (inset top rim + a bottom
   lip) is present (emphasis-by-shape, not hue).
5. `test_keycap_full_glass_takes_the_shared_sample` — `body.glass-full .ow-kbd` composes
   `--ow-btn-glass` backdrop-filter (tier consistency).
6. `test_keycap_honors_a11y_trio_subset` — `.ow-kbd` has a reduced-transparency solid fallback and a
   `prefers-contrast: more` border bump.
7. `test_settings_emits_kit_keycap` — `settings.js` `_formatKeyCaps` emits `<kbd class="ow-kbd">`;
   assert a bare `<kbd>` (no class) no longer appears in `settings.js`.
8. `test_bespoke_shortcut_key_kbd_css_retired` — the accent-hued `.shortcut-key kbd { … color:
   var(--accent …) }` block is gone from `style.css` (folded into `.ow-kbd`).
9. `test_keycap_is_not_interactive_floor` — `.ow-kbd` sets no `min-height: 44px` / tap floor of its own
   (the floor is the `.shortcut-key` button's job); a light guard that the primitive stays a passive
   glyph.
10. `test_demo_shows_keycap` — `element_kit_demo.html` renders an `.ow-kbd` example (e.g. a
    `Ctrl + Shift + K` cluster) in the atomic-elements section.

---

## 5. Owner decisions needed

1. **Class-on-`<kbd>` vs. bare-element upgrade.** Recommended: put `.ow-kbd` on the `<kbd>` explicitly
   (one-line render change; the primitive is a real class other surfaces can reuse). Alternative: style
   the bare element via a `.ow-kbd, kbd` selector so any future `<kbd>` upgrades automatically — but
   that risks styling stray inherited-workspace `<kbd>` if `ORWELL_GAME_BUILD=0`. **Recommendation:
   explicit class** (game-build-safe, reusable). Confirm.
2. **`.ow-kbd-group` wrapper — ship it or not?** The combo currently renders as adjacent `<kbd>` with no
   wrapper (`.shortcut-key` flex gaps them). A `.ow-kbd-group` makes the cluster reusable outside the
   shortcut row (tooltips, command-palette hints). Low cost; confirm whether to include now or defer
   until a second consumer appears.
3. **Interaction with the `.shortcut-key` button migration (§5e / W6).** `.shortcut-key` →
   `.ow-btn-plain` is a separate audit item in the settings lane. Decide whether `.ow-kbd` lands **with**
   that button migration (one Shortcuts-panel PR) or as its own micro-lane. **Recommendation: its own
   micro-lane** — `.ow-kbd` is one helper line + one CSS move and is independently verifiable; coupling
   it to the button swap enlarges the diff for no dependency reason.
