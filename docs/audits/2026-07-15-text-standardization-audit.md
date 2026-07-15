# Text-standardization & legibility audit + gate design (#1644)

**Date:** 2026-07-15 · **Scope:** front-end (`frontend/`) player + admin tier · **Type:** READ-ONLY
audit + gate design (no code changes in this PR) · **Owner mandate (#1644):** *"All text everywhere
standardized. Standard kit everything… I worry about moments where text in random spots is unreadable
and we haven't migrated its style to something standard."*

This audit enumerates **every** source of text color in the front-end, classifies each as **standard /
bespoke / polarity-risky**, flags every spot that can render below WCAG AA on the surface it lands on
across themes, and designs a **deterministic structural gate** so the failure class cannot recur. It
generalizes the frosted-polarity sweep (**#1639**, still open at time of writing — `mergeable_state:
blocked`, based on current `main`) from the `theme-frosted` light-surface class to **all text × all
themes**.

> **Trust the code over this prose — line numbers are from `main` @ `dbd94d78` and drift.** The
> reproduction scripts in the Appendix regenerate every count.

---

## 0. TL;DR

**The failure class.** Text inked from a **non-standard source that resolves to the wrong polarity for
the surface it lands on**. The canonical example (#1639): `--fg` (dark-theme `:root` default `#9cdef2`,
a light cyan built for a dark background) was used to ink the sidebar brand-title / "New Chat" label on
the **light** frosted sidebar glass → **~1.3:1**. The frosted theme paints chrome/bubbles as a fixed
**light near-white glass material regardless of the theme tokens**, but a subset of rules still colored
**text** from cool theme tokens (`--fg` / `--color-accent` / `--bg`) that stay light in the default dark
theme → **light-on-light**. There was **no gate**.

**Counts** (see §2 for the full tables; reproduced by `scripts` in the Appendix):

| Source | Total text-color declarations |
|---|---|
| `style.css` (`color:` + `-webkit-text-fill-color:`) | **867** (863 + 4) |
| `index.html` inline `style="…color:…"` | **22** |
| `login.html` inline | **1** |
| JS `.style.color = …` / `setProperty('color', …)` | **143** |
| JS template-literal `style="color:…"` (rendered HTML) | **~36** (7 files) |

| Classification | Count (style.css) | Notes |
|---|---|---|
| **STANDARD** | **~130** | `#16191f` chrome-ink literal (27 `color:` + 3 `-webkit-text-fill`), `var(--ow-control-ink/--ow-on-*)` (12), `inherit`/`currentColor` (22), on-fill `#fff` (11), `#eef1f4` light-ink-on-dark (1), `@media print` `#000/#333` (7), syntax-highlight `--hl-*` (49) |
| **BESPOKE** | **34 hex + 5 rgba/hsl** | 7 are `@media print`, 11 are on-fill `#fff`, 1 is `#eef1f4` — value-correct; **~15 genuinely bespoke** + the index.html/JS bespoke reds |
| **POLARITY-RISKY** | **~590** | `--fg`-derived (~360: 269 `var(--fg/-muted)` + ~90 `color-mix(--fg N%)`), accent (101), red/danger (119), `var(--bg)` (13) — risky **only on frosted light-glass surfaces that do not remap `--fg`**; the large majority are mitigated by container `--fg` remaps + the global accent/red remap + ~28 per-surface `#16191f` patches |

**Top unreadable-risk spots** (residual, excluding #1639's two — see §2.5):
1. **JS status inks** — `settings.js`/`admin.js` set `.style.color='var(--fg)'` / `'var(--red)'` on
   "Saved / Failed to save" messages; light-on-light on frosted **wherever the element is not inside a
   `--fg`-remapped container**. `settings.js:1084` uses `var(--danger, #c0392b)` — **`--danger` is an
   undefined token**, so it paints the **retired legacy alizarin brick `#c0392b`** (banned by #1605).
2. **`index.html:1532`** — a dashed "add" button: `color:var(--fg); background:none; opacity:0.6` →
   inherits the surface; light-cyan-on-light-glass on frosted.
3. **`index.html:1273 / 2328`** — inline `color:var(--accent,var(--red))` links on `background:none`
   (the exact #1639 accent-on-light-glass class; caught by the frosted `[style*="color:var(--accent)"]`
   remap **only** when it does not land in a bubble/container that fails to redefine `--fg`).
4. **`index.html:1719–2009`** (10 sites) — empty-state hints `color:color-mix(--fg 45%,transparent)` on
   `background:none` → muted light-on-light on frosted outside a remap.
5. **Bespoke error reds** — `index.html:2248/2653` `#e55`, `2566` `#f0a6a6` (~3.4:1 on light surfaces);
   `.compare-parallel-toggle` `#e0a050/#5b8def` (`style.css:7808/7812`).

**Recommended gate (§3):** a **source-pinned, deterministic, BLOCKING `fe-unit` test**
(`test_1644_text_ink_polarity.py`) reusing the effective-cascade WCAG parser already proven in
`test_1601_chat_light_glass.py` / `test_appov_frosted_polarity_sweep.py`. For a registry of
`(selector, surface-polarity)` pairs it asserts the effective text ink resolves to the **dark-ink
standard on light surfaces** (and light ink on dark), recomputing WCAG ≥ 4.5, and forbids raw cool theme
tokens on registered light surfaces. This is the guarantee. The rendered sweeps (`theme-consistency`
0114 / `a11y-matrix` #1375) are **advisory only** (deliberately non-gating — see §3.3) and 0114 checks
**surface-background** polarity, **not** text-ink contrast, so they **cannot** be the guarantee for this
class.

**Durable standardization (§3.4):** promote the magic literal `#16191f` to a named token
(`--ow-ink-chrome`) and, ideally, remap `body.theme-frosted { --fg / --fg-muted }` to dark ink **at
root** so text inherits the correct polarity by default and only the handful of genuinely-dark surfaces
re-lighten — this converts ~360 per-surface risks into ~a-dozen enumerable exceptions.

**Waves (§4):** W0 = #1639 (done, pending merge — not re-listed) · **W1 = build the gate (blocking,
test-only)** · W2 = token-promote `#16191f` → `--ow-ink-chrome` · W3 = `body.theme-frosted` root `--fg`
remap (durable fix, high blast radius, gated by W1) · W4 = JS status-ink helper + fix the `#c0392b`
undefined-token bug · W5 = index.html inline migration · W6 = bespoke status hexes. **style.css ↔
index.html/JS serialize** (the `[style*="color:var(--accent)"]` remaps key off the exact inline
literals).

---

## 1. The standard ink-token set

The kit already carries a coherent ink standard; it is under-tokenized (a key value is a repeated magic
literal) and **not applied by default on the frosted light surfaces** — the two structural gaps below.

### 1.1 The canonical ink tokens (from `frontend/static/style.css`)

| Token / value | Defined | Role | Polarity |
|---|---|---|---|
| `--fg` | `:root` L101 `#9cdef2` (dark) · `:root.light` L203 `#2b2b2b` · redefined `#16191f` on frosted chrome containers (L3851, L24043) · `#eef1f4` on the opaque headshot window (L24185) | Theme body ink | **moves with the theme** — this is exactly what makes it risky on a surface whose material polarity is fixed independent of the theme |
| `--fg-muted` | frosted L24798/24801 `#2f323a` | Secondary/muted ink | dark on frosted |
| `--color-muted` | `:root` L159 `#9aa0a8` · `:root.light` L228 `#667080` | Timestamps/meta (AA-tuned per polarity) | moves with theme |
| **`#16191f`** (chrome dark ink) | `--ow-control-ink` L21819; also `adaptiveGlass.js` `HERO_INK_DARK=[22,25,31]` | **The canonical dark ink for light-glass chrome** | fixed dark |
| `#eef1f4` (light chrome ink) | kit `--fg:#eef1f4` on dark windows L24185; `adaptiveGlass.js` `HERO_INK_LIGHT=[238,241,244]` | Light ink for genuinely-dark surfaces | fixed light |
| `--on-accent` / `--ow-on-accent` | L111 `#10151b` (first-paint) / L97 `var(--on-accent,#fff)`; recomputed per-accent by `onAccentColor()` in `js/color/hex.js` | Ink on an **accent-fill** background (CTAs) | luminance-aware |
| `--ow-on-danger` | L21838 `#fff` | Ink on a **danger-fill** background | fixed white |
| `--color-danger-strong` / `--ow-danger-strong` | L152 / L21841 (`color-mix(danger 76%, #000)`) | The AA-safe **solid** danger plate behind white body text (raw danger is ~3.9:1) | fixed |
| `.msg-ai` adaptive ink | `color:` set directly on the element; `adaptiveGlass.js` flips it per-wallpaper (`[data-adaptive-ink]`), CSS default `#16191f` + light halo | Received chat bubble over the wallpaper | **adaptive** |
| `--hl-*` (syntax) | `:root` L120-129 · `:root.light` L206-215 | Code syntax tokens | per-polarity, **accepted exception** |

### 1.2 The intended standard, per surface polarity

| Surface | Material polarity | Correct ink |
|---|---|---|
| Dark-theme chrome; opaque dark windows (`#orwell-headshot`) | dark | **light** — `--fg` (dark-theme value) / `#eef1f4` |
| **Frosted / glass-full light-glass chrome** (sidebar, titlebars, dropdowns, popovers, gadget cards, settings) | **light** (fixed, theme-independent) | **`#16191f`** (dark ink) — via container `--fg` remap or explicit |
| Flat `:root.light` surfaces | light | `--fg` (`#2b2b2b`) — moves with the theme, consistent |
| Accent / CTA **fills** (`.send-btn`, `.msg-user`, active nav/tab pills) | colored | `--ow-on-accent` / `--on-accent` (`#fff` / luminance-aware) |
| Danger **fills** (solid, e.g. `.confirm-btn-danger`) | red | `--ow-on-danger` `#fff` on `--*-danger-strong` |
| Received bubble `.msg-ai`; wallpaper-floating text (welcome hero, gadget-rail head) | variable wallpaper | **adaptive** per-wallpaper ink (adaptiveGlass), default `#16191f` + light halo |
| Muted / secondary text | same as its surface | `--color-muted` / `color-mix(--fg N%)` **at the surface's own polarity** |

### 1.3 Gaps in the standard (where no standard token exists / it isn't applied)

- **GAP A — `#16191f` has no semantic name.** It is the value of `--ow-control-ink`, but it is
  **hardcoded as a bare literal in 27 `color:` + 3 `-webkit-text-fill-color` declarations** and inside
  `--ow-control-fill/-hover/-rim` mixes. There is no `--ow-ink-chrome` / `--ow-on-glass-light` semantic
  token that light-surface text can point at. A future repoint is a 30-site find-replace, and a gate
  cannot say "resolves to *the* chrome-ink token" because there isn't one. **Promote it (W2).**
- **GAP B — frosted never remaps `--fg` at root.** `body.theme-frosted` keeps the dark-theme
  `--fg:#9cdef2` and only redefines `--fg:#16191f` on an **enumerated container list** (`.ow-body`,
  `.modal-content`, `.dropdown`, `.overflow-menu`, `.cp-popover`, … L24030-24044) plus ~28 per-surface
  `#16191f !important` patches. **Any light-glass surface outside that set, coloring from `var(--fg)`,
  is light-on-light** — this is the structural root of the recurring leak, and the reason the fix
  history reads as whack-a-mole (#725, #742, #759, #761, #763, #770, #1601, #1639…). **Consider a root
  remap (W3).**
- **GAP C — two dark-ink values.** Chrome/hero use `#16191f`; `adaptiveGlass.js` `INK_DARK` is
  `#11151c` (L158). Both are "dark ink," near-identical, but the divergence means "the dark ink" isn't a
  single source of truth. Fold into one token in W2.
- **GAP D — muted-on-frosted is thin.** `--fg-muted:#2f323a` is only set on frosted **inside a media
  query** (L24798/24801); frosted secondary text via `color-mix(--fg 45%)` outside it keys off the
  **light** `--fg` → washed-out light-on-light. The gate's registry must include muted selectors.

---

## 2. App-wide text-color inventory

Method: comments stripped line-preserving; property-position `color:` (word-boundary, excludes
`background-color`/`border-color`/…) and `-webkit-text-fill-color:` extracted with value + nearest
selector; classified by value pattern and (for polarity) by target surface. Full scripts in the
Appendix.

### 2.1 `style.css` — 867 text-color declarations, by value bucket

| Count | Bucket | Class |
|---|---|---|
| 269 | `var(--fg / --fg-muted / --text / --muted)` | POLARITY-RISKY on frosted-light unless container-remapped |
| ~90 | `color-mix(in srgb, var(--fg) N%, …)` (muted `--fg`) | POLARITY-RISKY (same) |
| 119 | `var(--red / --color-danger / --color-error / --color-recording)` | POLARITY-RISKY (accent hue on glass) / semantic |
| 101 | `var(--accent / --color-accent / link)` | POLARITY-RISKY (the #1639 class) |
| 49 | `var(--hl-*)` syntax | STANDARD (accepted exception) |
| 34 | bare literal hex | see §2.4 — mixed |
| 28 | `var(--color-success/green/warn/agent-active/…)` | status — POLARITY-RISKY / semantic |
| 27 | **`#16191f`** literal | STANDARD (but un-tokenized — GAP A) |
| 27 | `var(--color-muted*)` | mostly STANDARD (AA-tuned per polarity) |
| 22 | `inherit` / `currentColor` / keyword | STANDARD (follows surface) |
| 13 | `var(--bg)` | POLARITY-RISKY (inverted pairs; light on frosted) |
| 12 | `var(--ow-control-ink / --ow-on-danger / --ow-on-accent / --ow-danger)` | **STANDARD (kit ink tokens)** |
| 5 | `rgba(...)` literal | see §2.4 (all dark-ink-alpha — standard-equivalent) |
| 4 | `-webkit-text-fill-color` | 1 `transparent` (gradient text), 3 `#16191f`/`inherit` (STANDARD) |

### 2.2 The polarity-risk model (why most of the ~590 are safe, and which aren't)

A `var(--fg)`/accent/red text declaration is only unreadable when **all** hold: (a) the frosted (or
`glass-full`) light-glass theme is active; (b) the element sits on the **fixed light-glass material**;
(c) it is **not** inside a container that redefines `--fg:#16191f`; (d) it is **not** caught by the
global remaps. The mitigations already in place:

- **Container `--fg` remap** (L24030-24044): every `.ow-body` / `.modal-content` / dropdown / popover
  child that inks from `var(--fg)` resolves dark. Covers the bulk of windows/menus.
- **Global no-accent-on-text remap** (L23384 `body.theme-frosted a,…` and L23526-23530
  `[style*="color:var(--accent)"]` / `var(--red)` → `var(--fg) !important`). Covers links + inline
  accent/red **as long as the landing `--fg` is the dark one** — the #1639 trap was that inside
  `.msg-ai`, `--fg` is *not* redefined (the bubble drives ink via `color:` for adaptiveGlass), so
  `var(--fg)` there stayed light cyan.
- **~28 per-surface `#16191f !important` patches** for stragglers outside the container set (titlebars
  L24161, thinking accordion L23446-23520, model picker L24126, chat-meta L24117, gadget rows, …).

**Residual risk = any frosted light-glass surface not covered by the three above** — which is precisely
the set a gate must pin, because there is no structural guarantee, only an accreting patch list.

### 2.3 `index.html` (22) / `login.html` (1) / JS (143 + ~36) inline & set colors

- **`index.html` risky inline sites:** `1532` (`var(--fg)`+`background:none`+`opacity:0.6` dashed-add) ·
  `1273`, `2328` (`var(--accent,var(--red))` links on `background:none`) · `1719,1736,1759,1776,1789,
  1838,1853,1936,1955,2009,2343` (`color-mix(--fg 45/55%)` empty-state hints on `background:none`) ·
  `2248`, `2653` (`#e55`), `2566` (`#f0a6a6`) bespoke reds · `400` (`var(--brand-color,var(--red))`
  low-opacity monospace watermark — decorative). **Consistent token pairs (lower risk):** `647`, `1149`
  (`background:var(--bg/--panel); color:var(--fg)`), `1593` (`background:var(--fg); color:var(--bg)`
  inverted CTA), `1070` (`color:inherit`). `login.html:714` is a consistent `var(--bg)`/`var(--fg)`
  code input.
- **JS `.style.color` (143):** dominated by `settings.js` (105) + `admin.js` (15) status messages —
  `'var(--fg)'` (neutral/success), `'var(--red)'` (error), `'var(--green)'` (ok). These are inline
  styles, so the frosted `[style*="color:var(--red)"]` remap catches the red ones, and inside the
  settings/admin `.ow-window .ow-body` the `var(--fg)` ones resolve dark — **mitigated where they live
  today**, risky if reused on a non-remapped surface (login/OOBE, toasts). **Two concrete bugs:**
  `settings.js:1084` `'var(--danger, #c0392b)'` — `--danger` is undefined → paints the **retired
  `#c0392b` brick**; `settings.js:997` `'var(--amber, var(--fg))'` — `--amber` undefined → falls to
  `--fg` (light on frosted-light). `adaptiveGlass.js` (4) computes ink **for** contrast (correct by
  construction). Swatch/preview sets in `colorPicker.js`/theme previews are **data-color** (the color
  *is* the content) — not a legibility concern.
- **JS template-literal `style="color:…"` (~36):** `settings.js` 17, `admin.js` 7, `chatRenderer.js` 4,
  `slashCommands.js` 5, `assistant.js`/`theme.js`/`group.js` 1 each — same token families; same
  mitigation/risk profile.

### 2.4 Bespoke literal-hex text colors (34) — the genuinely-bespoke backlog

| Class | Sites | Verdict |
|---|---|---|
| `@media print` `#000`/`#333` on white paper (L7905-7924) | 7 | **Accepted** (print) |
| On-fill `#fff` (`.confirm-btn-danger`, `.send-btn`, active nav/tab, `.msg-user`, `.theme-seg` active, delete-btn hover, …) | 11 | **Value-correct** (on-accent/on-danger) — tokenize to `--ow-on-accent`/`--ow-on-danger` (W6, cosmetic) |
| `#eef1f4` light ink on the opaque `#orwell-headshot` window (L24199) | 1 | **Value-correct** light ink — tokenize (W2) |
| Disabled ink `#57575c` (`.send-btn:disabled`, `.ow-btn:disabled`) | 2 | **Accepted** — WCAG 1.4.3 exempts disabled controls |
| **Genuinely bespoke status/accent hexes** | ~13 | **Backlog (W6)** — `#e0a050`/`#5b8def` compare-toggle (L7808/7812), `#3fb950` diff-add (L11918, *diff family — accepted*), `#4ade80` gpu-free (L14976), `#b48a4a` notes-archive (L18265), `#000` chevron (L23935); + `index.html` `#e55`(×2)/`#f0a6a6`; + `settings.js:1084` `#c0392b` |

`rgba()` literals (5): all are `rgba(22,25,31,α)` (= `#16191f` at reduced alpha, muted dark ink on light
glass) or `rgba(0,0,0,α)` control glyphs — **standard-equivalent**, fold into the muted-ink token in W2.

### 2.5 Fixed by #1639 (Wave 0 — do not re-list)

The sidebar wordmark `.sidebar-brand-title` + `#sidebar-new-chat-btn .grow` (APP-OV-5), and
`.msg-ai a` + inline cast-photo/accent cues inside the received bubble (APP-OV-4). #1639 also
**verified-correct-and-left-alone** 45 further token-driven candidates (titlebars, `option` lists,
`.ow-field`, theme-bg inputs, `.ow-sheet` cross-fade, blue CTAs, danger buttons, reduced-transparency
fallbacks). That verified list is the **seed** for the gate's registry (§3.2). **#1639 must merge** for
Wave 0 to land on `main`.

---

## 3. The gate design

### 3.1 Requirement

A gate that is **deterministic** (no browser/model/network), **BLOCKING** (in `ci-gate.needs`), **cheap**
(runs in the fast parallel `fe-unit` lane), and catches **the exact class**: text inked from a token that
resolves to the wrong polarity for its surface. The two existing gates for this class
(`test_1601_chat_light_glass.py`, `test_appov_frosted_polarity_sweep.py`) already prove the pattern —
**source-pinned, effective-cascade WCAG recomputation** — but each pins only its own two/one selectors.
Generalize them into one registry-driven gate.

### 3.2 Recommended: `frontend/tests/test_1644_text_ink_polarity.py` (BLOCKING, `fe-unit`)

Reuse verbatim the `_rule_blocks` / `_effective_decls` / WCAG (`_hx`/`_lum`/`_ratio`/`_over`) helpers
from `test_1601_chat_light_glass.py`. Drive them from a **registry of `(selector, surface)` pairs**:

```
SURFACES = {
  "frosted-light-glass": {"fill": (255,255,255), "alpha": 0.60, "ink_polarity": "dark"},
  "opaque-dark-window":  {"fill": (29,32,38),    "alpha": 1.0,  "ink_polarity": "light"},
  "accent-fill":         {...on-accent white...},
  "danger-fill":         {...on-danger white on --*-danger-strong...},
}
LIGHT_SURFACE_SELECTORS = [  # seeded from the ~28 #16191f-override selectors + #1639's verified list
  "body.theme-frosted .ow-titlebar", "body.theme-frosted .thinking-content", ...,
  "body.theme-frosted .sidebar-brand-title", ...  # post-#1639
]
```

For each registered light-surface selector, assert:
1. the effective `color` **and** `-webkit-text-fill-color` resolve to a **dark** value (a literal
   `#16191f` / `--ow-ink-chrome` / `--ow-control-ink`, or `#16191f`-alpha rgba, or `inherit`/
   `currentColor` where the parent is pinned dark) — and recompute **worst-case WCAG ≥ 4.5** on the
   light-glass fill composited over pure black (the `GLASS_OVER_BLACK` worst case #1639 already uses);
2. it is **NOT** a raw cool theme token — reuse #1639's `_no_cool_token()` blocklist
   (`var(--fg`, `var(--bg`, `var(--accent`, `var(--color-accent`, `var(--red`, `#9cdef2`, `#eef1f4`,
   `#00aaff`). This single assertion is the **cheap catch of the New-Chat class** and needs no WCAG math.

Symmetrically for dark-surface selectors (light ink, WCAG ≥ 4.5 on the dark fill) and accent/danger
fills (on-accent/on-danger, WCAG ≥ 4.5). Add a **ratchet**: **no bare literal hex text color outside the
accepted allowlist** (`#16191f`, `#eef1f4`, on-fill `#fff`, disabled `#57575c`, `@media print`,
`--hl-*`), so a new bespoke ink can't be added without an explicit allowlist entry (mirrors the
`a11y-matrix` XFAIL-ratchet discipline). Extend the same registry idea to `index.html`/JS by asserting
inline `color:var(--fg)`/`var(--accent)` on `background:none` elements carry a class the CSS pins — or,
after W5, that those inline literals are gone.

**Why this is the guarantee:** deterministic, blocking, covers surfaces the golden play-through never
renders, and fails **loudly at the source** the instant an ink drifts back to a cool token — exactly the
signal #1644 asks for.

### 3.3 Complementary (defense-in-depth, NOT the guarantee): the rendered sweeps

`theme-consistency` (0114), `visual-regression` (0113), and `a11y-matrix` (#1375) run headless browser
sweeps. **They cannot be the guarantee for this class:**

- **All three are DELIBERATELY NON-GATING** — they are **absent from `ci-gate.needs`** (`ci.yml`
  L870-877): they replay the heavy golden fixture end-to-end and **flake intermittently on slow
  gh-runners** (per-turn request-key drift under load → fixture miss). The owner ruling (2026-07-12)
  removed them from the merge lane; they "run but don't gate." This is the `#1592`-class flakiness the
  issue names.
- **0114's `theme_probe.py` checks the wrong axis for this bug** — it classifies **surface-background**
  polarity (does a surface's rendered `background` derive from the active theme's `--bg/--panel`), **not
  text-ink-vs-surface contrast**. The New-Chat failure has a *correct* light-glass background and *wrong*
  ink — 0114 passes it.
- **`a11y-matrix`** (vendored axe-core) *does* catch text contrast at render time, but only on the
  **surfaces the golden play-through renders** (partial coverage) and is advisory/flaky.

**Recommendation:** build §3.2 as the blocking guarantee **now**. Separately, once the fixture-replay
determinism is hardened (the fold-back condition in `ci.yml` L875-877), **add a text-ink-contrast pass
to `theme_probe.py`** (it already composites layers and has APCA/WCAG math — extend it to sample each
registered element's `color` against its composited background) and fold the rendered sweeps back into
`ci-gate`. That is complementary breadth; §3.2 is the deterministic floor.

### 3.4 The durable standardization that shrinks the gate's surface

The gate pins the symptom; two structural moves shrink the risk surface it must cover:

- **W2 — promote `#16191f` → `--ow-ink-chrome`** (and `#eef1f4` → `--ow-ink-chrome-inverse`). One-line
  future repoint; the gate can assert "resolves to `--ow-ink-chrome`," not "equals a magic literal."
- **W3 — `body.theme-frosted { --fg: var(--ow-ink-chrome); --fg-muted: … }` at root.** Flips the default
  from *light ink everywhere, patch each light surface* to *dark ink everywhere, re-lighten the few dark
  surfaces*. The exceptions become **enumerable and small** — the opaque `#orwell-headshot` window
  (already restated L24183-24200) and any genuinely-dark bubble — instead of ~360 latent per-surface
  risks. This is higher blast-radius (must not regress the dark surfaces), so it lands **after** W1's
  gate exists to catch a regression, and is well-timed with the in-flight glass-tier refactor
  (`claude/collapse-glass-tier`, which is already collapsing frosted → "Glass or Flat").

---

## 4. Wave plan

Grouped into migration-only lanes. **Serialization constraint:** `style.css` carries
`[style*="color:var(--accent)"]` / `var(--red)` attribute-selector remaps (L23526-23530) that **key off
the exact inline literals** in `index.html`/JS — so any wave rewriting those inline literals must land
**with** the matching `style.css` remap change. style.css-touching waves (W2, W3) serialize against each
other and against W5.

| Wave | Scope | Files | Parallel? |
|---|---|---|---|
| **W0** (done, pending merge) | #1639 frosted sidebar brand/New-Chat + `.msg-ai` links/cast-photo | — | — (not re-listed) |
| **W1 — build the gate** | `test_1644_text_ink_polarity.py` (§3.2) + accepted-exception allowlist; seed registry from the ~28 `#16191f`-override selectors + #1639's verified 45 | `frontend/tests/` only | **Do first** — foundation & regression net for W2/W3 |
| **W2 — token-promote** | `--ow-ink-chrome`/`-inverse`; migrate 27 `color:#16191f` + 3 `-webkit-text-fill` + `#eef1f4` + the 5 `rgba(22,25,31)` muted sites | `style.css` | Serialize before W3 |
| **W3 — frosted root `--fg` remap** (durable) | `body.theme-frosted { --fg / --fg-muted }` → dark; restate the enumerated dark surfaces; delete now-redundant per-surface `#16191f` patches | `style.css` | After W2 + W1 gate; high blast radius |
| **W4 — JS status inks** | route `.style.color` status messages through one surface-aware helper (or data-attr + CSS); **fix `settings.js:1084` `--danger`/`#c0392b`** and `997` `--amber` undefined tokens | `settings.js`, `admin.js`, +5 files | Parallel with W2/W3 (JS-only) |
| **W5 — index.html inline** | migrate the ~13 risky inline sites (1532 dashed-add; 1273/2328 accent links; 1719-2009 hint mixes; 2248/2566/2653 bespoke reds) to classes/tokens; update the paired `style.css` `[style*=…]` remaps in lockstep | `index.html` (+ `style.css`) | **Serialize** after W2/W3 (shared attribute-selector dependency) |
| **W6 — bespoke status hexes** | tokenize `#e0a050`/`#5b8def` compare-toggle, `#b48a4a` notes, `#4ade80` gpu; tokenize on-fill `#fff` → `--ow-on-accent/-danger` | `style.css` | Low priority; parallel |

---

## 5. Accepted exceptions (contrast holds / semantically correct)

- **`@media print`** `#000`/`#333` on white paper (`style.css:7905-7924`).
- **Syntax-highlight `--hl-*` tokens** (per-polarity, defined for both themes) — code coloring is
  semantic, not body ink.
- **On-fill `#fff`** (danger buttons, `.send-btn`, active nav/tab pills, `.msg-user`, `.theme-seg`
  active) — the surface is a colored/accent **fill**; white is the correct on-accent/on-danger ink. Only
  the **tokenization** is owed (W6), not the value.
- **`#eef1f4`** light ink on the deliberately-opaque `#orwell-headshot` dark window — value-correct light
  ink (tokenize in W2).
- **Disabled ink `#57575c`** — WCAG 1.4.3 exempts inactive/disabled controls.
- **Deliberately-colored status/brand where contrast holds** — diff greens (`#3fb950`), the rose
  Diary-Room **edge** (border only, not a fill), the low-opacity monospace brand watermark
  (`index.html:400`). These are diegetic/status accents on backgrounds where they clear their floor;
  they stay, but the gate's ratchet requires an explicit allowlist entry for each.

---

## Appendix — reproduction

```bash
# style.css text-color declarations, classified by value bucket:
python3 - <<'PY'  # (full script: see the audit session scratchpad inv.py)
# strip comments line-preserving; extract property-position color: + -webkit-text-fill-color:
# bucket by value pattern (var(--fg)/accent/red/#16191f/bespoke-hex/inherit/…)
PY

# bespoke-hex + rgba/hsl text-color sites with line + nearest selector: inv2.py

# HTML/JS inline & set colors:
grep -noE 'style="[^"]*"' frontend/static/index.html | grep -iE '[^-]color:'
grep -rE "style\.(color|webkitTextFillColor)\s*=|setProperty\(\s*['\"]color['\"]" frontend/static/js/
```

Counts in §0/§2 are from `main` @ `dbd94d78`. The two existing source-pinned gates
(`frontend/tests/test_1601_chat_light_glass.py`, `test_appov_frosted_polarity_sweep.py` on
`claude/frosted-polarity-sweep`) are the templates the recommended gate (§3.2) generalizes.
