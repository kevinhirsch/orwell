# Theme & element-kit visual audit — frosted / glass / flat (master backlog)

**Date:** 2026-07-14 · **Branch:** `claude/theme-visual-audit-vt9ttm` · **Status:** IN PROGRESS —
lanes landing. · **Scope:** the three base material tiers (Frosted = `body.theme-frosted`, the
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

**Fixed in this branch (verified, before/after in PR):** see §1.

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

## 1. Fixed in this branch

*(populated as the fix lane lands — demo decision-section fidelity, `.odec` style scoping +
selected-pill fix, banner dismiss-× centering, demo tier switcher with theme-correct flat
scaffolding.)*

## 2. Element kit — Frosted (default tier) findings

*(lane landing)*

Self-verified so far (overseer measurements):

- **KIT-OV-1 · P1 · top system banner · both viewports.** The dismiss `×` (`.on-dismiss`, a
  44px-tall button) sits at `cyOff +5.4px` below the 38px band's centerline (measured
  getBoundingClientRect). The left `.on-icon` is box-centered (−0.5px) but optically low-weight.
  Fix: center the × visually while keeping the ≥44px hit region. (`orwellNotice.js` injected
  banner CSS.) — IN FIX THIS BRANCH.
- **KIT-OV-2 · P1 · disabled-state philosophy split · all tiers.** Kit `.ow-btn:disabled` uses
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

*(lane landing)*

## 4. Settings window — every panel

*(lane landing)*

Self-verified so far:

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

*(lane landing)*

Self-verified so far:

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

*(tier crawl + 0114 gate landing)*

## 8. Kit-coverage table (per settings/theme panel)

*(lane landing)*

## 9. Genuinely good — do not break

*(merged from lanes)*
