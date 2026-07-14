# Theme & element-kit visual audit — frosted / glass / flat (master backlog)

**Date:** 2026-07-14 · **Branch:** `claude/theme-visual-audit-vt9ttm` · **Status:** all four
audit lanes landed + nine fixes shipped on this branch; walked-state lane BLOCKED on #1592
(stale golden fixture on main). · **Scope:** the three base material tiers (Frosted = `body.theme-frosted`, the
performant default; Glass = `body.theme-frosted.glass-full`; Flat = neither class), audited
mobile-first (390×844) + desktop (1440×900), against the Apple HIG corpus
(`docs/design/liquid-glass/`) by the APPLE_GENIUS review protocol (`docs/design/APPLE_GENIUS.md`).

**Method.** Live captures of `/static/element_kit_demo.html` + the running app (settings window,
theme window, main chrome) across all 3 tiers × 2 viewports; DOM-measured geometry/computed-style
probes (not eyeballed); the 0114 `theme_consistency.py` machine gate (light/dark token-derivation
over the full walked golden-replay surface inventory); a walked-game-state tier crawl (golden
replay parked at midweek, full window/gadget/notice inventory opened, per-tier captures); and a
four-lane read-only auditor fan-out (frosted kit / glass+flat kit / settings+theme windows /
walked state). Cross-referenced against `docs/audits/2026-07-09-hig-audit.md` (nothing already
filed there is re-filed here) and 0114's documented-intentional list (stoplight traffic lights,
scoped frosted material rules, the onboarding `--bg` card are NOT re-flagged).

**Fixes in flight on this branch:** see §1 (each entry gains its before/after evidence when the
fix lane lands; until then §1 items are IN PROGRESS, not verified-shipped).

---

## 0. The systemic finding (read this first)

The recurring root cause behind most "mixed polarity" sightings is structural, not one-off:

- **The frosted/glass material is a LIGHT surface regardless of theme, while the theme tokens
  (`--bg`/`--panel`/`--fg`) stay DARK (default theme).** Any element inside a glass window that
  paints itself with theme tokens (`var(--bg)`, `var(--panel)`) renders as a dark slab on light
  glass; any element that inherits the page `--fg` (light ink) goes light-on-light. The kit
  handles this by REDEFINING `--fg` to the dark chrome ink on glass surfaces and giving kit
  controls their own fills — so every NON-kit control inside a glass surface is a latent
  wrong-polarity bug. This is why kit migration (#775/#660) is not cosmetic: it is the polarity
  fix.
- Corollary (verified live): token-composited state styles break the same way — e.g. the decision
  card's selected pill computes `color-mix(var(--fg) 96%)` under the REDEFINED dark `--fg`,
  producing a near-black plate with `var(--bg)` ink (dark-on-dark) instead of the intended
  "bright plate, dark ink". State fills that must read the same over any glass need FIXED colors
  (the pattern the VM-17 disabled fix already established at `style.css` ~21393).
- **Flat has no kit expression at all.** Every `.ow-*` kit rule is `body.theme-frosted`-scoped;
  on Flat, kit-composed surfaces fall back to UA defaults/legacy rules. Flat needs a deliberate
  token-driven solid expression (same geometry/typography/focus, `--panel`/`--fg`/`--border`
  fills, no blur) — inventoried in §3.

## 1. Fixed on this branch (landed, measured before/after)

1. **Decision-card CSS rescoped `#orwell-decision-card` → `.odec` root class**
   (`orwellDecision.js`; element keeps its id; `window.OrwellDecisionKit.ensureStyles` exposed
   for the demo; the newer #651/#1375-a/WCAG-2.1.1 rules preserved through the rescope) — the
   demo now composes the REAL card (both variants) through the real styles.
2. **Frosted selected-pill dark-on-dark fixed** — before: `color-mix(var(--fg) 96%)` computed
   `rgba(22,25,31,.96)` plate with `rgb(40,44,52)` ink (measured). After: fixed
   `rgba(255,255,255,.96)` plate + `#16191f` ink + the blue ring (backdrop-independent, same
   pattern as the VM-17 disabled fix). Flat tier untouched (s6_4 accent contract).
3. **Banner dismiss × centered** — before cyOff **+5.39px** below the 38px band's midline;
   after **−0.5px** at 1440+390 on all three tiers; 44px hit box preserved; stacked notice
   cards unchanged (banner-scoped rule in `orwellNotice.js`).
4. **Demo tier switcher** (Frosted default / Glass / Flat, `#tier=` deep links) with
   theme-correct FLAT scaffolding (dark preset tokens + dark backdrop) — flat now renders as
   it truly does in-app; switcher lives in `orwellElements.js` (the demo is served under CSP
   `script-src 'self'` — inline scripts are dead).
5. **Demo decision kind mislabel fixed** — the non-risk example is now a comp-intent; the
   eviction vote (a high-stakes kind) is the `.odec-risk` example, as live.
6. **KIT-F-01 container-cascade fix** — `:not([class*="ow-btn"])` guards on the generic
   `.ow-window .ow-body button` / `.on-card button` / `.og-card button` vibrant-fill + state
   rules (style.css ~20883-20965), so nested kit variants keep their variant chrome (the
   1.43:1 nested-Destructive and the flattened live prominent CTAs in
   `orwellNewSeason.js`/`orwellRetrospective.js` are restored). Verified no app class
   false-matches the substring guard.
7. **KIT-F-05 demo stylesheet parity** — the demo now loads `css/responsive-tokens.css` before
   `style.css` (as `index.html` does), so touch floors are verifiable on the reference page.

8. **SET-01 Change-Password fields → `.ow-field`** — before: ≈1.02:1 (measured
   rgb(21,23,28) box, rgb(22,25,31) ink on frosted/glass); after: the kit field chrome
   (translucent ink veil + dark ink, verified computed + screenshot); flat unchanged.
9. **SET-02 `.admin-card h2/h5` no-wrap + ellipsis** — headers truncate instead of wrapping
   at the 320px window floor (mirrors the `.settings-nav-item` treatment).

10. **Code-review pass (8-angle) refinements:** SET-02 truncation scoped away from the inline
    `display:flex` headers (it clipped their trailing toggles — e.g. the Vision header's
    switch — and text-overflow is a no-op on flex anyway; verified: flex headers normal/visible
    + toggle intact, block headers nowrap/ellipsis); the KIT-F-01 guard tightened from the
    `[class*="ow-btn"]` substring to exact-class `:not(.ow-btn)` (every kit button carries the
    base class; a future `window-btn` can never be silently excluded); banner × centering moved
    to size-independent auto-margin tied to `--tap-min`; the style.css `.odec` twin merged into
    the pinned selector list (one source of truth for the concentric math — the ID form stays
    last so the pinned regex still matches); orwellDecision.js boot side-effects (roster fetch +
    backstop interval) gated on the app shell so the demo page loads styles only; tripwire
    sync comments on the demo's copied dark-preset tokens.

    Review verdicts on the rest: the demo's default-tier change (glass→frosted) is intended
    (owner: frosted is the default; no harness pinned the old default); the flat `--accent`
    omission is FAITHFUL (theme.js never sets `--accent` — it falls back to `--red` in-app
    too); the ID→class cascade flip on chip/confirm font-weight lands ON the style.css frosted
    block's own documented intent (Apple Medium/Semibold on text buttons) — noted, not a
    regression; the flat password fields ride the global input reset (style.css ~1870) with
    ~1px padding drift vs the old inline styles — accepted.

Before/after renders: PR #1589 (48 PNGs across frosted/glass/flat × 1440/390, plus the fix
lane's measured computed-style evidence).

## 2. Element kit — Frosted (default tier) findings

**Lane report landed (apple-genius auditor, measured via Playwright DOM geometry + pixel
sampling; full detail in the PR discussion + lane file). Ranked:**

- **KIT-F-01 · P0 · nested kit buttons lose their variant tint (LIVE bug, not demo-only).**
  `style.css:20871-20882` — `body.theme-frosted .ow-window .ow-body button, .on-card button,
  .og-card button, .og-card .og-act { background-color: color-mix(in srgb, var(--fg) 12%, …) }`
  has specificity (0,3,2) and beats EVERY kit variant (`.ow-btn-destructive` 21722,
  `.ow-btn-prominent` 21079, `.ow-btn-secondary` 21056 — all (0,2,1)). Measured: an
  `.ow-btn-destructive` "Evict" inside a kit window renders fill rgb(222,214,215) with a
  near-white label — **1.43:1** contrast. Live consumers already degraded:
  `orwellNewSeason.js:117,216` + `orwellRetrospective.js:104,270` prominent CTAs render the
  generic 12% fill instead of the prominent tint. Fix: scope the generic container rule with
  `:not([class*="ow-btn-"])` or `:where()`, + a regression test pinning nested variant computed
  backgrounds.
- **KIT-F-02 · P1 · Prominent ≈ Secondary (hierarchy failure).** Rendered fills differ by ~1%
  luminance (237 vs 235); Prominent's rim (.34 alpha) is WEAKER than Secondary's shared rim
  (.5 alpha) and its border weaker (6% vs 12% ink); on real hover Secondary changes more than
  Prominent. WWDC25 310 tintProminence requires the primary to read first. Fix: widen the
  luminosity gap (primary tint ≈ .46-.50 alpha) + make Prominent's rim the strongest.
- **KIT-F-03 · P1 · checkbox/radio coarse-pointer floor is 24px, not 44px (explicit in source).**
  `css/responsive-tokens.css:74-77` gives `input[type=checkbox/radio]` a 1.5rem floor while
  siblings get `--tap-min` 44px (lines 66-72). Precision: 24px meets the WCAG 2.2 **AA** floor
  (2.5.8 Target Size Minimum); the 44px bar is WCAG 2.5.5 Target Size **Enhanced (AAA)** and
  the Apple HIG's own 44×44pt guidance — which is the standard this codebase's `--tap-min`
  convention already applies to every sibling control, so check/radio are the one inconsistent
  exception rather than a baseline-AA failure. Fix: 44px hit region via invisible `::after`
  (pattern at style.css:21267), visible box stays 20px.
- **KIT-F-04 · P1 (demo-only) · House Status gadget garbled** ("HOHYou", "NomsTwo houseguests"):
  `orwellStatusPanel.js:193-195` scopes its injected row CSS to the literal `#orwell-status`,
  but the demo mounts `id="ek-g-status"` (`orwellElements.js:157-167`) — same root-cause class
  as the Decision mis-composition. Fix: mount the demo gadget as `orwell-status` or rescope the
  injected CSS to a class/data-attribute.
- **KIT-F-05 · P2 (demo) · demo never loads `css/responsive-tokens.css`** (index.html loads it
  before style.css; the demo links style.css only) — the reference page cannot verify ANY
  touch-floor behavior; masks KIT-F-03. Fix: add the link in load order.
- **KIT-F-06 · P2 · Destructive red is legacy `#c0392b`, not Apple system red.** ELEMENT_KIT.md
  promises system red; `--ow-danger → var(--color-danger)` resolves to `#c0392b`
  (style.css:136) app-wide, so the kit's `#ff453a` fallback is dead code. Decision needed:
  repoint `--color-danger` app-wide vs scope an ELEMENT-KIT-block override.
- **KIT-F-07 · P2 (demo) · traffic-light swatch fidelity:** the "hover/focus" swatch forces
  button opacity but the glyph reveal rides an ANCESTOR `.ow-titlebar:hover` rule
  (style.css:21224-27) so glyphs never show; 2 of 3 demo windows are permanently unfocused
  (grey lights). Real hover/focus verified working — demo simulation wrong.
- **KIT-F-08 · P3 · field placeholder ≈ 3.3:1** (sampled 98,99,97 on 198,191,177) vs the CSS
  comment's claimed legibility floor. Fix: mix `::placeholder` toward ~65-70% control ink.
- **KIT-F-09 · P3/low-confidence (demo) · top banner permanently overlays scrolled demo
  content** — the demo page's scroll-layout override; confirm the real shell reserves space
  (it does via `--on-banner-inset`, but see APP-OV-1: the sidebar does NOT consume it).

Overseer-verified (pre-lane measurements):

- **KIT-OV-1 · P1 · top system banner · both viewports.** The dismiss `×` (`.on-dismiss`, a
  44px-tall button) sits at `cyOff +5.4px` below the 38px band's centerline (measured
  getBoundingClientRect). The left `.on-icon` is box-centered (−0.5px) but optically low-weight.
  Fix: center the × visually while keeping the ≥44px hit region. (`orwellNotice.js` injected
  banner CSS.) — IN FIX THIS BRANCH.
- **KIT-OV-2 · P1 · disabled-state philosophy split · frosted + glass (the tiers with kit rules;
  Flat has no kit expression — see §0).** Kit `.ow-btn:disabled` uses
  0.42 opacity (ELEMENT_KIT.md contract), while `.send-btn`/`.odec-*`/`.ow-window .ow-body
  button:disabled` were deliberately moved to an OPAQUE fixed-color treatment (`#d6d6d9`/`#57575c`,
  style.css ~21383-21399) precisely because opacity-only disabling fails over glass (measured
  1.74:1 in the VM-17 audit). Two philosophies in one system; the opaque one is the measured,
  HIG-correct one. Backlog: unify `.ow-btn:disabled` onto the opaque treatment (and update
  ELEMENT_KIT.md).
- **KIT-OV-3 · P2 · demo Decision section misrepresents the live kit.** Demo lacked
  `orwellDecision.js` injected CSS + the `ow-btn ow-btn-prominent` composition; also labeled an
  eviction vote (a high-stakes RISK kind live) as the non-risk example. — IN FIX THIS BRANCH.

## 3. Element kit — Glass tier / Flat tier findings

**Lane report landed (measured: computed-style cascade walks, liquidGlass cap instrumentation,
same-run A/B pixel diffs, pixel-sampled contrast). Ranked:**

### Flat (Normal) tier — the kit does not exist here

- **KIT-N-01 · P0 · all five `.ow-btn` variants collapse to ONE generic grey box.** Every kit
  rule is `body.theme-frosted`-scoped (style.css:21028, 21594-22168 — zero unscoped kit rules);
  on Normal only the app-wide reset (`button{height:32px}` + `background:var(--bg)`) matches.
  Prominent/Secondary/Plain/Destructive/Icon render pixel-identical (bg rgb(40,44,52), 4px
  radius). The HIG **role** system (destructive = system red) is absent, not just plainer.
  Fix: author a Normal expression per primitive — solid token fills (`--panel`/`--fg`/
  `--border`/`--red`), same geometry/size-ladder/focus/tap rules, no blur.
- **KIT-N-02 · P0 · `.ow-switch` structurally collapses on Normal** — a bare 13×13px native
  checkbox beside an invisible zero-width track span (style.css:22012-22045 all
  frosted-scoped). Not a plainer switch; no toggle affordance at all.
- **KIT-N-03 · P1 · measured contrast on Normal: 1.26-1.27:1** on every `.ow-btn*`/`.ow-field`/
  `.odec-*`; `.on-card` title **1.07:1** (dark ink on dark bg). Exposed today by the demo
  scaffold bug, but the root gap (no Normal kit CSS) is structural.
- **KIT-N-04/05 · P2 · `.ow-select` on Normal is a bare native select again** (the exact
  dark-on-dark admin bug the class exists to fix), legible only by a UA quirk that colors
  selects but not buttons from the same reset — an accident, not a guarantee.
- **KIT-N-06 · P2 · check/radio fall to 13×13px native widgets** on Normal (kit spec: 20×20,
  neutral rim, blue only when checked).
- **KIT-N-07 · P2 · slider is Chromium default BLUE on Normal** (`accent-color:auto`) vs the
  kit's system green — all three green rules frosted-scoped (style.css:21467,22087,22372).
  Minimum fix: unscoped `accent-color: var(--ow-ios-green)`.
- **KIT-N-08 · P2 · traffic lights fall back to 24×32px rectangles with literal "–"/"×" glyphs**
  on Normal (style.css:21114-21243 frosted-scoped) — no window-control identity. (Visual
  identity angle; the touch-target half is already F-TOUCH-1 in the 2026-07-09 audit.)
- **KIT-N-09 · P2 · `.ow-btn-group` loses the grouping semantic on Normal** — no capsule, each
  member keeps its own 4px radius; N unrelated buttons.
- **KIT-N-10 · P3 · surface radii split on Normal** *(lane-reported as KIT-G-06; renumbered —
  it is a Normal-tier finding)*: windows/gadgets/notices share 26px on
  glass/frosted but fall back to 10/10/12px legacy radii on Normal — one family becomes three.
- **The template that already works:** the OLDER `.og-card` gadget family
  (style.css:2082-2091) ships coherently cross-tier (solid `color-mix(--panel)` fill, no
  frosted gate, no blur). The Normal pass for the atomic kit is a fill/color/blur gap, not a
  re-architecture — mirror `.og-card`'s pattern.

### Glass (Full) tier

- **KIT-G-01 · P1 · the refraction cap starves buttons on desktop.** `liquidGlass.js`
  `MAX_LIVE_SURFACES=20` (line 179; SELECTORS priority 214-248): on the demo, windows+cards
  consume 14 slots; measured 6/8 prominent, **0/13 secondary, 0/2 icon, 0/2 groups** refracted —
  two siblings in ONE row render different materials purely from cap order.
- **KIT-G-02 · P1 · on phone (`MAX_LIVE_SURFACES_MOBILE=8`) ZERO buttons and zero notice cards
  refract** — the tier's defining optic is absent below the window/gadget layer on mobile.
  Consider raising caps where headroom allows or reordering priorities.
- **KIT-G-03 · P1/M · glass vs frosted is visually indistinguishable on the demo wallpaper**
  (A/B pixel diffs: max Δ≤14/255 everywhere except the modal's faint correct tint) — the
  backdrop is too smooth to bend. The demo needs a busier/realistic backdrop before any
  "looks the same" conclusion is trusted (also the corpus's own guidance: judge over a
  realistic backdrop).
- **KIT-G-04 · P2 (demo) · the demo's `.ek-card` wrapper is glass-on-glass by construction**
  (own `backdrop-filter` around independently-sampling kit controls) — models the exact
  anti-pattern the corpus forbids (§1 "never glass on glass") in the page meant to teach it.
  Fix: solid demo section cards.
- **KIT-G-05 · P2/M · production-shaped glass-on-glass latent:** style.css:20709-20729
  pre-computes concentric radii for `.og-card`/`.on-card` nested inside `.ow-window > .ow-body`
  — two independent samples by construction if that composition goes live; the demo never
  exercises it. Add a demo example + decide the sanctioned pattern.
- **Measured contrast candidates (glass/frosted):** `.ow-btn-destructive` white-on-red-tint
  **3.28:1**, `.odec-confirm` white-on-`#0a84ff` **3.65:1** (both match Apple's own pairs —
  candidates, not certain fails), placeholder 3.49:1, disabled field 2.87:1 (AA-exempt by
  convention).
- **KIT-REF-01 · P3 (demo) · same responsive-tokens.css gap as KIT-F-05** — confirmed the
  coarse-pointer floor never applies on the demo, so Normal buttons measure 32px under touch
  emulation there.

## 4. Settings window — every panel

**Lane report landed (apple-genius auditor; live-driven all 3 tiers × desktop/phone; full
detail in the lane file + PR). Ranked:**

- **SET-01 · P0 · Change Password fields ≈ 1.02:1 (unreadable) on frosted + glass; fine on
  flat.** Root cause is TWO colliding mechanisms: the inputs are inline-styled
  `background:var(--bg); color:var(--fg)` (index.html:2220-2222) AND the frosted admin reskin
  redefines `--fg` locally to dark ink (style.css:23385-23401) with **no matching local
  `--bg`** — so the box keeps the page-dark background while the ink goes dark too. Fix:
  drop the inline styles, compose `.ow-field` (the existing reskin already handles it). —
  FIXED ON THIS BRANCH.
- **MOB-01 · P0 · the top system banner fully covers the hamburger on phone** (62px banner;
  `#hamburger-btn` at y:11 h:44 inside it; `elementFromPoint` returns the banner) — while a
  holding/reconnect banner shows, Settings and Theme are UNREACHABLE on mobile. Fix: reserve
  the banner inset for the nav trigger (the `--on-banner-inset` seam exists — the sidebar/
  hamburger must consume it; same family as APP-OV-1).
- **SET-02 · P2 · header wrap (owner report) reproduces only at the window's 320px resize
  floor** ("Utility Model (Recommended: Local Endpoint)" wraps at ≤360→320px; the ~420px
  report did not reproduce). Root: `.admin-card h2` lacks the nowrap/ellipsis treatment
  `.settings-nav-item` already has (style.css:15738-15742). Fix: same ellipsis + title
  attribute. — FIXED ON THIS BRANCH.
- **SET-03 · P1 · Agent Tools: 22 of 66 live game tools render as raw camelCase ids in an
  "Other 22/22" bucket** (no TOOL_META entries; all are real feature levers). Fix: author the
  22 entries under cat "Game".
- **SET-04/05/06 · P3 · TOOL_META hygiene:** duplicate `manage_endpoints`/`manage_mcp` keys
  (first defs dead); 2 fully-dead entries (`second_opinion`, `manage_rag`); 10 game-build-
  dropped workspace entries — prune/comment.
- **SET-07 · P2 · Flat only: nav-rail ACTIVE label is `color: var(--red)`** — accent hue on
  text (style.css:15563-66); frosted/glass got the system-blue capsule fix (21527-33), flat
  never did. Invisible today only because the default theme's `--red` is desaturated.
- **SET-08 · P2 · Flat only: every legacy toggle family's ON track is `var(--red)`**
  (`.vis-switch` 6465-67; `.admin-switch` 12291-92) — patched to system blue only under
  frosted (21484-89). Extend to flat.
- **SET-09 · P3 ·** pw/2FA cards are display:none under auth-off — why SET-01 shipped
  invisibly; add a forced-visible shot to the visual harness.
- **SET-10/11/12 · P3 · kit migration:** `.admin-btn-add`/`.admin-btn-delete` → `.ow-btn`
  variants; `.vis-switch` is a parallel reimplementation of `.ow-switch` (the structural
  cause of SET-08); Shortcuts' bespoke keycap buttons (low-pri).

Overseer-verified (pre-lane):

- **SET-OV-1 · P1 · Change Password inputs are non-kit, wrong polarity (owner-reported,
  confirmed).** `index.html:2220-2222` — inline-styled `background:var(--bg); color:var(--fg)`
  password inputs render as dark slabs with light ink on the light frosted panel. Fix: compose
  `.ow-field` (kit) and drop the inline styles. Same card: `#settings-pw-save` is legacy
  `.admin-btn-add`, not a kit button.
- **SET-OV-2 · P1 · Account tab: headshot placeholder tile is a dark `--panel` slab on light
  glass** (`app_frosted_desktop_settings_narrow420.png`) — the §0 systemic class (token-driven
  inset element on light material).
- **SET-OV-3 · P2 · Narrow width: the settings nav tab strip clips the ACTIVE tab pill mid-label
  with no scroll affordance** (420px repro shot). Needs scrollable tab strip with fade/chevron
  affordance, or priority+overflow behavior.
- **SET-OV-4 · P2 · Agent Tools panel content is stale + under-mapped (owner-reported, source-
  verified).** `admin.js` TOOL_META: **12 stale entries** for trimmed workspace verticals
  (`ask_teacher, create_document, edit_document, manage_documents, manage_memory, manage_rag,
  manage_skills, manage_tasks, manage_webhooks, second_opinion, suggest_document,
  update_document`), **2 duplicate keys** (`manage_endpoints`, `manage_mcp` each defined twice —
  first definitions dead), and **22 live game tools with NO entry** (`accuseTie, confide,
  confront, dailyRecap, diaryRoom, exposeSecret, formAlliance, joinAlliance, makeDeal,
  markHouseguestMet, moveTo, npcVoice, premiereIntros, requestSelfEviction, sandboxHealth,
  seasonRecap, seasonRetrospective, socialInitiatives, tradeSecret, turnIn, updateCasting,
  whereabouts`) — those render in an "Other" bucket as raw camelCase ids with empty descriptions.
  Fix: prune the 12 + dedupe the 2 + author names/descriptions/categories for the 22. No wiring
  changes.

## 5. Theme window — Browse + Customize

**Lane report landed. Ranked:**

- **THM-01 · P1 · the Theme window is visually broken on EVERY phone open, every tier:** the
  kit sheet-mode positions the window (y:405-844) but the promoted `#theme-popup` content
  keeps a PRE-KIT `@media(max-width:768px)` rule (`position:fixed !important; height:65vh
  !important`, style.css:7396-7419) that floats it OVER its own titlebar with ~400px dead
  space. Settings' analogous legacy rule uses height:auto (why Settings is fine). Fix:
  delete/neutralize the legacy `#theme-popup` mobile block — sheet mode owns phone
  presentation now.
- **THM-02 · P2 · Customize never reflows ≤600px:** the Colors 2-col grid (7168) and the
  4-across Font & Layout flex row (7275, no flex-wrap/min-width:0) overflow to a horizontal
  scrollbar at the 320px floor (matches the overseer's "Gla…" clip shot). Fix: flex-wrap +
  min-width:0 + container-query collapse.
- **THM-03 · verified NOT a defect:** the #1316 Browse quick picker and the Customize ladder
  hold perfect lockstep (live-driven) — no desync.
- **THM-04 · P3/low ·** possible momentary "Full" picker state before `glass-full` engages on
  cold load (seen once; benign PE race).
- **THM-05/06 · P3 · kit migration:** the whole Customize tab is pre-kit (only the two
  `.theme-seg` controls are on-kit); native `<input type=color>` is an accepted gap (no Apple
  analog — do not invent); consolidate `theme-io-btn`/`harmony-generate-btn` onto
  `.ow-btn-secondary`.

Overseer-verified (pre-lane):

- **THM-OV-1 · P1 · The Themes/Customize tab pills render dark-on-dark on frosted**
  (`app_frosted_desktop_theme_customize.png`) — legacy `.admin-tab` styling inside the light kit
  window (§0 class).
- **THM-OV-2 · P2 · The Font & Layout "Glass" segmented row overflows/clips at the default window
  width** (segment "Gla…" cut at the right edge, desktop 1440 shot).
- **THM-OV-3 · P2 · Tier-control label inconsistency:** Customize ladder says
  **Full / Frosted / Off** while the Browse quick control (#1316) says
  **Glass / Frosted / Flat** for the same three tiers. One vocabulary (owner's: Glass/Frosted/
  Flat) should win everywhere.

## 6. App chrome (sidebar, banner, composer, holding card)

Self-verified so far:

- **APP-OV-1 · P1 · The top banner occludes the sidebar header on desktop** — the
  `--on-banner-inset` top reservation is not consumed by the sidebar, so the wordmark/header sit
  underneath the banner (`app_frosted_desktop_main.png`).
- **APP-OV-2 · P2 · Banner renders as a double layer** (bright inner title capsule over a lighter
  full-width wash) — reads as a glitch, not a design.
- **APP-OV-3 · P2 · Sidebar user bar is a dark capsule on the light frosted sidebar** (§0 class).
- **APP-OV-4 · P2 · Holding-card helper text ("Production needs a feed source…") is muted grey
  over the dark teal wallpaper** — the F-CONTRAST-1 (2026-07-09 audit) class; extend the contrast
  floor here.
- **APP-OV-5 · P3 · Engine-status strings still say "Big Brother"** ("Reconnecting to Big
  Brother…") — KNOWN/HELD owner question (chrome rename); listed for completeness, not re-opened.

## 7. Walked-game-state findings (decision card, slates, rail, cast/dossier/memory)

**BLOCKED — the golden fixture is stale on main (issue #1592).** Since the #1582 engine-perf
merge, every replay lane (golden-path, visual-regression 0-3, theme-consistency) fails at the
first casting turn with a replay miss — on main itself, on this PR, and locally on a pristine
checkout. The walked-state tier crawl and the 0114 light/dark token gate both ride that replay
and cannot run until the fixture is re-recorded (live-key owner action) or the engine-side
digest shift is reverted/fixed. The crawl script is ready
(session scratchpad `tier_crawl.py`, composing `ThemeSweep`); re-run it the moment #1592
closes. Also noteworthy: `ci-gate` resolved green while those lanes were red (both on main and
on this PR) — the "stale fixture blocks merge" protection is not currently engaging; flagged
in #1592 for an owner ruling.

**Harness note (pre-existing, reproduced on clean main twice):** `scripts/browser_smoke.py`
fails one check locally — `F3: the finale sheet stays full-width ({'f': {'top':0,'bottom':0,
'w':0}})`: `#orwell-finale` measures 0×0 after `_orwellFinaleEnsure()` on the mobile-viewport
leg. Not caused by this branch (byte-identical result on unmodified files); likely a
mount/timing window in the smoke. Filed here so it isn't mistaken for a regression of this
campaign; CI is the authority.

**Demo nit (this branch, follow-up):** the fixed tier-switcher pill overlaps the decision
card's Confirm row at 390×844 — move it or give the page bottom padding at phone widths.

## 8. Kit-coverage table (per settings/theme panel)

| Panel / surface | Coverage | Non-kit controls (file:line) |
|---|---|---|
| Settings window chrome | **full kit** | — (OrwellWindowKit) |
| Settings nav rail | kit-consistent bespoke | `.settings-nav-item` (own frosted styling, correct container-query ladder) |
| Account: user row / logout | partial | `#settings-logout-btn` inline-styled (index.html:2207) |
| Account: Change Password | **legacy → FIXED here** | was inline-styled inputs + `.admin-btn-add` save |
| Account: 2FA / Danger Zone / headshot | legacy (frosted-reskinned) | `.admin-danger-card`, `.admin-btn-delete` |
| Appearance (Sidebar/Chat toggles) | legacy reskinned | `.vis-row`/`.vis-switch` — parallel switch impl (SET-11) |
| Shortcuts | legacy | `.shortcut-key`/`.shortcut-action-btn` |
| Tools (admin) | legacy | `.admin-tool-row`, `.admin-switch`/`.admin-slider` |
| Theme window chrome | **full kit** | — (sheet-mode content bug = THM-01) |
| Theme Browse | mixed | swatch grid bespoke (no Apple analog — fine); #1316 quick picker on the shared `.theme-seg` |
| Theme Customize | legacy | `.theme-fd-select/-range`, `.theme-io-btn`, harmony btn; native color inputs (accepted gap) |

**The pattern:** window chrome + the two tier segments are on-kit; nearly everything inside
both windows is pre-kit markup individually retrofitted under `body.theme-frosted`
(style.css:22185-22437), which is exactly why Flat regressions (SET-07/08) and reskin gaps
(SET-01) keep appearing. The durable fix is #775-style migration to kit primitives, not more
reskin rules.

## 9. Genuinely good — do not break (merged from all lanes)

- **Checkbox/radio/switch checked-state discipline** (frosted/glass): neutral at rest,
  system-blue fill + white glyph only when checked; slider correctly system-green.
- **Size ladder + shape-follows-size measures exactly to spec** (44/44/52/62px; sm/md
  rounded-rect, lg/xl capsule) — real hierarchy.
- **Concentric-radius math verified correct** in every sampled case (24−10=14).
- **Accent-tint primary variant**: 11.6:1 label contrast, tint on background never label.
- **Frosted CSS baseline carries the quality** — a standalone window diffs ≤5/255 from full
  glass; refraction is genuinely a bonus, never load-bearing.
- **Notice icon family**: coherent monochrome set, consistent stroke/size/alignment.
- **Kit loading sliver + empty states** (per the 2026-07-09 audit's positive note).
- **Settings sidebar container-query ladder** (full rail → compressed → stacked fade-mask) —
  Apple-plausible and well executed; only `.settings-nav-item` carries it, keep it.
- **Settings scroll architecture**: one scroll region, pinned rail, no double scrollbars.
- **Theme #1316 quick picker ↔ Customize ladder lockstep** — live-verified, no desync.
- **Window-chrome consistency** across both windows/all tiers (44px titlebar, traffic-light
  cluster + Peek accessory placement).
- **Traffic-light hover mechanism** (glyph reveal, focus ring, 44px invisible hit region) —
  correct; only the demo's static simulation of it was wrong.

## 10. Suggested build order for the backlog (owner sequencing: frosted → glass → flat)

1. **Ship-now class (small, high-severity):** MOB-01 banner-vs-hamburger; THM-01 legacy
   `#theme-popup` mobile block removal; KIT-F-02 prominent/secondary hierarchy retune;
   KIT-F-03 check/radio 44px hit regions; SET-03 the 22 TOOL_META entries (+ SET-04/05/06
   hygiene); THM-02 Customize reflow.
2. **Frosted/glass polish:** KIT-F-06 danger-red token decision; KIT-F-08 placeholder floor;
   KIT-OV-2 disabled-state unification; APP-OV-1/2/3 banner+sidebar chrome; the glass
   refraction-cap tuning (KIT-G-01/02) + a realistic demo backdrop (KIT-G-03); KIT-G-04/05
   glass-on-glass demo + nesting ruling.
3. **The flat kit lane (biggest single item):** author the Normal-tier expression for every
   kit primitive mirroring `.og-card`'s cross-tier pattern (KIT-N-01..10), then fix the
   flat-only accent leaks (SET-07/08) as part of it.
4. **Kit migration (the durable polarity fix):** change-password done here; continue
   #775/#660 through the settings/theme panels per the §8 coverage table.
5. **Blocked:** walked-state findings + the 0114 light/dark machine sweep resume when the
   golden fixture is re-recorded (#1592).
