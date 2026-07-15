# Real-browser rendered HIG + WCAG-contrast audit (every surface × tier × viewport)

**Date:** 2026-07-15 · **Base audited:** `main` @ `c9fd186d` (post-#1639 + #1641) · **Type:**
READ-ONLY audit — no product source changed; the only file added is this doc · **Method:** real
headless Chromium, deterministic key-free engine + FE, **rendered-pixel** background sampling (not
parsed CSS).

**Owner mandate this serves:** *"all text everywhere standardized, no random unreadable spots"* +
*"every window/gadget/element on the shared kit, looking good in the real world."*

This is the **rendered-pixel companion** to the source-level audits on `main`:
- **#1644 — `2026-07-15-text-standardization-audit.md`** (every *source* of text color, classified
  standard / bespoke / polarity-risky, + gate design). This audit **verifies which predicted risks
  actually render below AA in a real browser**, and adds spots the source scan did not name.
- **#1638 / #1640 — `2026-07-15-total-kit-migration-inventory.md`** (every window/gadget/element that
  must migrate onto the shared kit). The HIG / kit findings cross-reference it.
- **#1639 — `fix(theme): sweep frosted light-surface text-polarity inversions`** merged as `c9fd186d`
  **during this audit**. This run therefore covers the *post-merge* state and **verifies #1639's fix
  live** (before/after below).

> **A note on the moving base.** The audit began against `75a6a344` (pre-#1639). While it ran, #1639
> merged (`c9fd186d`), and the whole matrix was **re-run against current `main`**. The two sidebar
> blockers #1639 targets are now **fixed and re-verified** here (they were **1.25 / 1.47:1** before,
> **≥6:1** after — see §2.1); everything else in this doc is measured on `c9fd186d`. The pre-#1639
> renders are retained in the audit scratch as `shots_baseline_75a6a344/` for the before/after.

---

## 1. Methodology

### Boot (deterministic, key-free)
- **Engine:** `npm run build && node dist/main.js` (HTTP MCP :8765) — `DeterministicNarrator`/`Echo`,
  no OpenRouter key. Full 16-houseguest house staged via `POST /api/orwell/new-game`.
- **FE:** `uvicorn app:app` :7000, `ORWELL_GAME_BUILD=1` (the **shipped** game surface),
  `AUTH_ENABLED=false`, `LOCALHOST_BYPASS=true`, `ORWELL_ENRICHMENT_POLICY=soft`, pointed at the
  engine — the same flag set `browser_smoke.py`/`responsive_matrix.py` use. Surfaces opened through
  the app's own globals (`themeModule`, `settings.js open()`, `_orwellCastEnsure`,
  `OrwellHeadshotStudio`, the `orwell:pending` dispatch, `chatRenderer.addMessage`,
  `markdown.processWithThinking`) — the same render chokepoints the smoke drives.

### The two lenses
1. **Rendered WCAG contrast (measured).** For every visible text node: read the *computed* `color`
   (authoritative), then sample the **real rendered background** — screenshot the element, take the
   dominant non-ink pixel cluster (PIL histogram) — so translucent glass, gradients and the
   adaptive-glass scrim are measured **as painted**, not guessed. Contrast is WCAG 2.x; the floor is
   **4.5:1** normal / **3:1** large-bold (≥24px, or ≥18.66px & ≥700). A candidate is kept only if its
   *pixel-verified* ratio is below its floor. (A first computed-composite pass finds candidates; the
   pixel pass is the authority — it correctly discards e.g. the keyboard-shortcut chips, whose dark
   pill a CSS-composite mis-reads as light.)
2. **Apple HIG (judged).** Each surface judged against the repo's own authoritative reference
   `docs/design/liquid-glass/LIQUID_GLASS_REFERENCE.md` (verbatim Apple HIG/WWDC): one glass plane /
   no glass-on-glass, controls on a system material, **adaptive-tint polarity flip** (*"text… becomes
   darker when the underlying content is light, and lighter when it's dark"*), tint sparingly
   (*"when every element is tinted, nothing stands out"*), concentricity, ≤3 toolbar groups,
   touch ≥44px, and the a11y fallbacks (reduce-transparency / increase-contrast / reduce-motion).

### Matrix
Per #1642 the user choice is **Glass** (`theme-frosted` + `glass-full`) or **Flat** (no tier class);
**`frosted`** (`theme-frosted`, no refraction) survives only as the auto-downgrade on constrained
devices — so mobile-Glass renders frosted.

| # | Theme (polarity) | Tier | Viewport |
|---|---|---|---|
| 1 | glass (dark) | glass (full) | desktop 1440×900 |
| 2 | glass (dark) | frosted | desktop |
| 3 | glass (dark) | flat | desktop |
| 4 | light | glass (full) | desktop |
| 5 | light | flat | desktop |
| 6 | the-feed (house/dark) | glass (full) | desktop |
| 7 | glass (dark) | glass→**frosted clamp** | mobile 390×844 |
| 8 | glass (dark) | flat | mobile *(did not finish — see below)* |
| 9 | light | flat | mobile *(did not finish — see below)* |
| P1–P4 | `element_kit_demo.html` (`#tier=glass/frosted/flat`, busy backdrop) | 3 tiers | desktop + mobile |
| P5–P6 | `/admin/status` | (own theme) | desktop + mobile |

~19 in-app surfaces per pass: chat transcript (user + AI bubbles, OOC aside, thinking accordion,
tool-beat), composer, sidebar, decision card, gadget rail + status/presence/deals/cast gadgets,
cast-photo upload window, cast wall, Settings Account/Appearance/Shortcuts + forced-admin System/Users
(with the auth-hidden password/2FA cards force-unhidden per #1607), theme window, model-picker menu,
retrospective, new-season studio.

### Honest limitations
- **`applyColors` does not repaint the wallpaper layer** — the light-theme passes are light
  tokens/bubbles over the retained glass-mesh backdrop (a useful *mixed-polarity* stress; the pixel
  sampler reads the real backdrop regardless). The default glass theme (passes 1–3, 7) has its true
  wallpaper.
- **Tight inline spans occasionally return no background sample** (all pixels near ink) → marked
  `~approx`, falling back to the computed ratio; each was visually confirmed.
- **The mobile gadget-rail pass force-opens the drawer** to measure its cards; a resulting top-bar
  label overlap is flagged as *possible* (harness-induced), not confirmed.
- **`model-picker menu` / `gadget-deals` were empty** (no model wired / no deals yet) — no text to
  measure, not a pass/fail.
- **Passes 8–9 (both *flat-mobile*) did not finish** within the harness's 800 s budget — the mobile
  sheet transitions make each mobile pass slow, and passes 1–7 consumed it. These are the **cleanest**
  tiers (flat follows theme polarity with no glass inversion); flat-dark chrome was fully measured at
  **desktop** (pass 3) and the mobile *glass→frosted* pass (7) completed, so mobile coverage is real —
  only the two lowest-risk mobile combinations are un-measured. Reported findings therefore span **7 of
  9 in-app passes + all 6 page passes**; the missing passes would only raise `×N` on existing rows.

---

## 2. Contrast findings (rendered, pixel-verified)

Severity: **blocker** = pixel ratio < 2.0 (effectively illegible) · **major** = 2.0–3.4 (clearly
sub-AA) · **minor** = 3.5–4.49 normal / large-text 3.0–4.4 / disabled-only. `×N` = distinct
tier/viewport passes the same element failed in. Ratios pixel-verified unless `~approx`.

### 2.1 Verified FIXED by #1639 (before → after, this run)
| Surface | Element | Before (`75a6a344`) | After (`c9fd186d`) |
|---|---|---|---|
| sidebar (glass tier) | brand wordmark "Orwell" | **1.47:1** light-on-light | dark `#16191f` ink, **≥6:1** — PASS |
| sidebar (glass tier) | "New Chat" label + icon | **1.25:1** light-on-light | dark ink, **≥6:1** — PASS |
| chat `.msg-ai` | inline link / cast-photo cue | 1.37:1 | `color:inherit` (adaptive), PASS |

### 2.2 Open findings on current `main` (`c9fd186d`)

**Totals (raw pixel-ratio): 9 blocker · 31 major · 2 minor** distinct defects across 248 measured
sub-AA text nodes, from 7 of 9 in-app passes (all desktop tiers/themes + mobile-glass) + all page
passes. Reclassifying the two **hover-only** window-control glyphs (last table row) to minor leaves
**~8 substantive blocker + ~29 major** defect families. Near-identical rows (the same defect on
several tabs/windows/passes) are **grouped** below; the raw per-row list is in the audit scratch
`defects.json`.

| Sev | Ratio (thr 4.5) | ×passes | Surface | Element / text | ink → bg | Suggested standard fix |
|---|---|---|---|---|---|---|
| **blocker** | **1.0–2.4** `~approx` | 3+ | Chat — AI bubble | bolded houseguest-name accent (`strong` name-highlight, e.g. "Keith") | teal accent → light bubble | resolve to the bubble's **adaptive ink** — extend #1639's `.msg-ai` `color:inherit` to the name accent (it fixed links, not the name) |
| **blocker** | **1.30** | 6 | Settings ▸ Admin (System) | danger link "Download debug bundle + Producer's Vault (SPOILERS)" (`#adm-health-bundle-vault`) | salmon `#f0a6a6` → white | danger token that clears AA on white (dark-red ink, or red as background) |
| **blocker** | **1.32** | 5 | Decision card | disabled hint "Select N houseguests to enable Confirm" (`#orwell-decision-card-hint`) | light/white → light glass | dark-ink-on-glass `#16191f` |
| **blocker** | **1.57** | 7 | Theme window | **selected** segmented-control label ("Glass") (`.theme-seg-btn.active`) | white → light selected pill | dark ink on the light selected pill |
| **blocker** | **1.54 / 1.88** | 1 (light theme) | Gadget rail head | "The House" title + "›" chevron (`.gadget-rail-title` / `.grail-chevron`) | dark ink → dark content behind the **transparent** rail | adaptive-tint to the **content** polarity (rail is transparent-over-content), not the theme token — the *opposite* inversion from #1639's |
| major | 2.38 | 6 | Settings nav (every **light-nav** tier) | inactive tab labels (Appearance/Shortcuts/Account/Add Models/Users…) | muted grey `#9aa0a8` → near-white nav | AA-tuned inactive-tab ink (floored `--fg-muted`). **NB:** passes in flat-dark; fails only where the nav is light glass / light theme |
| major | 2.13 | 5 | Settings ▸ Admin (System) | status badges "REACHABLE/YES/OK" + "portraits 0/15" (`.admin-badge`) | green/red text → light-tint fill | put the status color on the **background**, ink dark (HIG: color on background not text) |
| major | 2.13 / 2.49 | 7 | Chat — AI bubble | timestamps (`.role-timestamp`) + copy/retry icons (`.msg-action-btn`) | grey `#6b7280` → light bubble | floored muted ink on the bubble |
| major | 2.72 | 1 | Decision card | "⚠ Irreversible — binding" badge (`.odec-risk-badge`) | red `#ff4444` → light-red fill | dark ink / darker red on the badge |
| major | 2.43 | 2 (light theme) | Settings ▸ Shortcuts | kbd chips (Ctrl/K…) (`.kbd`) | orange `#c47d5a` → cream | kit chip ink per polarity (the dark/glass chips are fine) |
| major | 2.55 | 1 | New-season studio | headshot-library delete "×" (`.hs-libdel`, always-visible) | white → grey `#a1a2a4` | darker control fill or dark ink |
| major | 2.66–3.03 | 1 ea | Chat "Production notes" label · cast-wall "Compact pin" · theme "Themes" active tab · **light-flat** sidebar brand "Orwell" · new-season "Recast from scratch" | orange / dark-on-grey | route through the kit ink (the light-flat brand is a #1639-untouched **non-frosted** case) |
| minor | 1.49–2.64 *(hover-only)* | many | **Window traffic-light glyphs** "×"/"–" (`.ow-close` close on red, `.ow-min` minimize on amber) | dark/light glyph → red/amber control | the probe measured these (opacity > 0) but the glyphs are conventionally **hover-revealed** (macOS) and are **not visibly rendered at rest** in the shots — confirm at-rest visibility; if shown, raise glyph contrast. *(Excluded from the blocker/major counts for this reason.)* |
| minor | 3.41 | 1 | Element kit `.ow-btn-destructive` (kit demo) | white → destructive red `#ff453a` | known white-on-red AA gap — darken red or apply `--on-accent` |
| minor | 3.65 | 4 | **element_kit_demo** tier/backdrop switcher (`.ek-tier-on`) | white → iOS blue | **demo-harness chrome, not shipped app UI** — noted for completeness |

---

## 3. Clean surfaces verified (coverage evidence)

Rendered **at or above AA** on the surface they land on, across the passes noted — the kit and the
adaptive-glass machinery work where applied:

- **Chat bubbles — body copy** (user blue + AI light-glass): the `OrwellAdaptiveGlass` APCA escalation
  holds; body text clears the floor over the mesh backdrop on every tier/viewport. *(Only the bolded
  houseguest-name accent inside the AI bubble fails — §2.2.)*
- **Sidebar (post-#1639)** — brand, New Chat, nav items, user bar all pass on the **glass** tiers and
  flat-dark. *(Exception: the **light-flat** brand "Orwell" measures 3.03 — a non-frosted case #1639
  explicitly did not touch; §2.2.)*
- **Gadget kit cards** (`#orwell-status`, `#orwell-presence`, `#orwell-deals`, cast pin): dark ink on
  light-glass card, labels + muted sub-labels pass — the `.og-card` kit is clean, desktop + mobile.
- **Settings panel *body*** (section headers, row titles, muted descriptions): the `--fg-muted` APCA
  floor (F-CONTRAST-1) works; only the **inactive nav tab labels** fail (§2.2).
- **Decision card** — prompt, option pills (monogram + name), binding body copy clean; only the
  disabled-state hint fails.
- **Theme window** — swatch tiles, headers, "Show all themes", Customize tab pass; only the *selected*
  segmented-control label fails.
- **Flat tier, both polarities** — sidebar/top bar/chrome follow theme polarity correctly; **no**
  inversion in Flat. (The residual glass inversions are glass-tier-specific.)
- **Mobile sheet presentation** — Settings presents as a bottom sheet with grabber + more-opaque fill
  (HIG-correct); toggles/tab pills ≥44px.
- **Cast wall / monogram tiles** — white initials on colored tiles read on every tier.
- **`/admin/status` standalone page** — **0 contrast fails**, desktop + mobile (82 / 41 text nodes
  measured). The self-contained dark page keeps its light ink over dark panels above AA throughout.
- **`element_kit_demo.html`** — the kit primitives pass on glass/frosted; the only sub-AA text is the
  `.ow-btn-destructive` white-on-red (a known accent gap) and the demo's *own* switcher buttons (not
  shipped UI).

---

## 4. HIG (Liquid-Glass) findings

| Sev | Surface (tier) | HIG principle | Observed | Fix |
|---|---|---|---|---|
| major | Settings **inactive nav tab** labels (all tiers, desktop + mobile) | Controls must stay legible on the system material | muted grey ink ≈2.5:1 on the near-white settings nav — the active tab reads, the inactive ones recede below AA | AA-tuned inactive-tab ink (floored `--fg-muted`) |
| major | Admin **status badges** + danger-red spoiler link (glass, both polarities) | Color/emphasis must clear contrast; *"apply color to the background rather than to symbols or text"* | green "REACHABLE/YES/OK" as green *text* on a light-green fill (≈2.2:1); danger-red link ≈1.9:1 on white | put the status color on the **background**, ink dark; danger token that clears AA on white |
| minor | House themes (`the-feed`) — sidebar nav icons (glass) | *"Avoid tinting all your elements. When every element is tinted, nothing stands out."* | every sidebar nav icon carries the theme `--red` tint | reserve tint for one emphasis element |
| minor | Simultaneous glass surfaces — glass windows (Settings/Theme) floating over the glass sidebar + glass gadget cards | *"always avoid glass on glass"* / one floating glass plane, content on standard materials | the app leans on glass across chrome **and** stacked windows/cards at once | consolidate toward one glass plane; content/cards on standard material (tracked under #1638; the glass-on-glass gate #1604/#1605 already covers part) |
| minor | Disabled controls over glass — decision-card "Confirm — this is binding" (disabled), new-season studio buttons | disabled-over-glass legibility (`test_hig_fstate1_disabled_over_glass`) | disabled labels render very faint on the light glass | kit disabled-over-glass ink |
| minor *(possible)* | Mobile top bar with the gadget rail open | *"avoid intersections between content and Liquid Glass"* in steady state | "The House" (rail head) overlaps the "Week 1" chat title — **but the rail was force-opened by the harness**; confirm in the real drawer gesture before treating as a defect | verify; if real, inset the rail head clear of the top-bar title |

**HIG positives.** The build honors much of the reference: the mobile sheet lifecycle (grabber →
opaque-up), a single adaptive nav/gadget material with an APCA legibility floor, monogram/concentric
pill geometry on decision cards, genuine SVG refraction on the Full tier, and a `reduce-transparency`
fallback (#1639 scoped its sidebar fix to `no-preference` and falls back to solid). The residual HIG
debt is (a) the **adaptive-tint polarity flip** not reaching a few chrome labels (same root as the
§2.2 spots), (b) **tint economy** on the house themes, and (c) the count of simultaneous glass
surfaces vs. the "one glass plane" rule — tracked under #1638.

---

## 5. Cross-reference & recommended fixes

- **Contrast (ink) → #1644.** #1639 closed the two sidebar blockers (verified §2.1). The **remaining**
  rendered spots — inactive settings tab labels, green admin status badges, the decision-card disabled
  hint, the *selected* segmented-control label, the accent houseguest-name in AI bubbles, and the
  admin danger-red spoiler link — are **not** individually named in the #1644 source scan and should
  join its residual list. Each wants a **standard token**: dark-ink-on-light-glass
  `#16191f` / `--ow-control-ink` for the light-chrome labels, an AA-tuned inactive-tab ink, a
  darker-on-light status-badge ink, a danger token that clears AA on white, and the bubble accent-name
  resolving to the bubble's adaptive ink (the same `color:inherit` move #1639 used for `.msg-ai`
  links — extended to the name accent).
- **HIG / kit → #1638.** The adaptive-tint misses and the disabled-over-glass faintness map onto the
  kit-migration inventory; route these labels/controls through the element kit's polarity-correct ink
  and the `test_hig_fstate1_disabled_over_glass` contract.

---

## Appendix — reproduction

Throwaway harness (uncommitted, audit scratch): `probe.js` (in-page contrast sweep that tags
candidates), `audit.py` (9-pass matrix + PIL pixel verification, incremental dump), `audit_pages.py`
(kit-demo + `/admin/status`), `aggregate.py` (dedup + severity). Boot = the two-process pattern in
`frontend/INTEGRATION.md` / `deploy/smoke.sh`. Screenshots captured to scratch (incl.
`shots_baseline_75a6a344/` for the #1639 before/after) and **not** committed — the doc is the
deliverable.
