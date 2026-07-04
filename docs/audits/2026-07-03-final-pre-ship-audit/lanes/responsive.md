# RESPONSIVE & CROSS-PLATFORM LENS — Orwell pre-ship audit v2

Judged against the fixed device matrix (desktop 1440x900 pointer vs mobile 390x844 touch DPR2,
with 320px / landscape / keyboard predictions). Every finding is VIEWED in the telemetry at
`scratchpad/audit2/telemetry/` and traced to a CSS/JS mechanism. Standard: functional equivalence
(WCAG 1.4.10 reflow, 2.5.5/2.5.8 target size). A reflow is not a bug; a clipped / overlapped /
unreachable / untappable control is. Mobile is the owner-flagged priority.

## Root cause that generates most of the mobile breakage
The OrwellWindow kit `.ow-window { position: fixed; min-width:180px; max-width: 64vw }`
(`frontend/static/js/orwellWindow.js:181-183`) has **NO `@media (max-width:768px)` width/position
override**. The only narrow-tier `.ow-window` rules are `cursor:default` (js:360-362) and a
coarse-pointer control-size (js:292-294). So on a 390px phone every *floating / modal* kit window
(Theme, Settings, New Season, error "house is dark", onboarding, and undocked gadgets like The Cast
/ The Finale / Your Deals) is capped at ~250px (64vw) and positioned by desktop-centering math —
landing top-left, clipped, or overlapping live chat. The mobile bottom-sheet CSS that *does* exist
(`style.css:7254-7294` `.modal` + `#theme-popup`; `style.css:5133-5153` `.doclib/.gallery`) targets
the **legacy** modal/library nodes, NOT the kit — so after the DWE window migration those rules are
orphaned (they now style inner content nodes whose outer `.ow-window` frame is unstyled for mobile).
This one gap is the mechanism behind RESP-1/2/3/5/6.

## Index

| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| RESP-1 | Blocker | <1day | High | Theme picker unusable on mobile — no swatches visible/selectable | mobile-12 / mobile-12b-f09; style.css:7287, orwellWindow.js:181 |
| RESP-2 | Major | <1day | High | Kit modal windows don't go full-screen/centered on mobile (Settings/NewSeason/Error) | mobile-14/22/25; orwellWindow.js:181, style.css:5133 |
| RESP-3 | Major | <1day | High | Floating gadget windows overlap hero/welcome/composer & stack uncontained on mobile | mobile-04/05/06/07/08; orwellWindow.js:181 |
| RESP-4 | Major | <1hr | High | "Select model" pill overlaps/truncates composer placeholder on mobile | mobile-16/19/23/24; chat composer row |
| RESP-5 | Major | <1day | Med | Finale & Deals gadgets open as empty title-bar-only windows over content on mobile | mobile-04/05/06/08 vs desktop-08 |
| RESP-6 | Major | <1hr | Med | New Season modal is non-scrim, overlaps live chat + dropdown clipped on mobile | mobile-22 vs desktop |
| RESP-7 | Minor | <1day | Med | Welcome card + decision card + toast + diary banner stack at once, bury composer on mobile | mobile-01/09/17/22 |
| RESP-8 | Minor | <1hr | Med | Binding pill forces decision-card title to wrap / near-clip card edge at 360px | mobile-09-nominations / -juror-vote |
| RESP-9 | Minor | <1hr | Low | Comp-intent dumps all 16 names in prose → very tall block on mobile | mobile-09-decision-comp-intent |
| RESP-10 | Minor | <1hr | Med | "Reset window positions" is a dead affordance on mobile | mobile-14; settings appearance |
| RESP-11 | Minor | <1day | Low | macOS traffic-light chrome shown on mobile floating windows (metaphor + only close = 32px dot) | mobile-07/08; orwellWindow.js:264-293 |
| RESP-12 | Minor | <1hr | Low | Cast "Compact pin" button overlaps first portrait card on mobile | mobile-07 |
| RESP-13 | Minor | <1hr | Low | Large dead vertical gap between last message and welcome card (welcome-active) on mobile | mobile-19/24 |
| RESP-14 | Minor | <1hr | Low | Error "The house is dark" duplicated title+heading + hero text bleeds through scrim on mobile | mobile-25 |
| RESP-15 | Minor | <1day | Med | Dual/confusing HUD entry: docked drawer vs undocked floating windows on mobile | mobile-04..08 vs desktop-04 |
| RESP-16 | Polish | <1hr | Low | Onboarding holding card is a top-left ~64vw window over the decision card on mobile | mobile-02 |
| RESP-17 | Polish | <1hr | Low | Diary-mode send glyph flips to "+" while other states show ↑ (inconsistent) on mobile | mobile-24 vs mobile-16 |
| RESP-18 | Latent | <1day | Med | 320px prediction: binding pill + title overflow; cast grid + modals worsen | source + mobile-09 |
| RESP-19 | Latent | <1hr | Low | Landscape (max-height:500px) collapses rail correctly but floating kit windows still 64vw | style.css:2247; orwellWindow.js:181 |
| RESP-20 | Polish | <1hr | Low | Cast portraits are giant gradient letter-placeholders filling the mobile viewport | mobile-07 |
| RESP-21 | Minor | <1hr | Low | Settings kit window on mobile has huge empty white area below content (fixed-size, not sheet) | mobile-14/15 |
| RESP-22 | Polish | <1hr | Low | Streaming/verbose narration equivalence holds on mobile (no overflow) — corroborating null result | mobile-18 vs desktop-18 |
| RESP-23 | Minor | <1hr | Low | Toast/notice stacks below welcome card, competing for the same bottom band on mobile | mobile-17 |
| RESP-24 | Polish | <1hr | Low | "IRREVERSIBLE — BINDING" pill consumes ~half the card width on mobile, crowding the × | mobile-09-nominations |

---

## RESP-1 [Blocker] [Effort:<1day] [Value:High] — Theme picker completely unusable on mobile
- **Where:** mobile-12-theme-window.png, mobile-12b-theme-open-f09.png (vs desktop-12-theme-window.png). CSS: `style.css:7287-7294` (`#theme-popup` mobile bottom-sheet) + `orwellWindow.js:181-183` (`.ow-window max-width:64vw`, no mobile rule); the kit-migration note at `style.css:7003-7010`.
- **Problem:** On desktop the Theme window is a full tabbed grid (glass / the feed / telescreen / room 101 / memory wall / sequester + "Show all themes (16)"). On mobile it opens as a ~230px-wide window pinned to the TOP-LEFT with its titlebar clipped ABOVE the viewport top, and **zero theme swatches render** — the entire theme grid is off-frame/collapsed. The 5 house themes + frosted are a named core feature; a phone player cannot see or select any theme. **Mechanism (traced):** the theme frame is now the kit `.ow-window#theme-modal` (modal:true), capped at `max-width:64vw` with desktop centering; the *old* mobile bottom-sheet rule `#theme-popup{position:fixed;bottom:0;height:65vh}` (7287) now targets only the INNER content node, which detaches from the mis-sized/mis-placed kit frame → content paints nowhere visible. **Differential:** not a legitimate reflow (a reflow would still show swatches in a column) and not empty-state (desktop shows 6+ swatches for the same engine state) — it is a clip/detach defect.
- **Confidence:** High. Falsifier: if a swatch grid is actually present but below the fold and reachable by scroll on a real device, downgrade to Major. Two frames (still + filmstrip end) show the same empty ~100px window.
- **Prediction:** at 320px and landscape it stays broken (same rule); DPR2 doesn't help. Keyboard-open irrelevant (no input).
- **Fix:** add `@media (max-width:768px){ .ow-window#theme-modal{ left:0!important; right:0!important; top:auto!important; bottom:0!important; max-width:100vw!important; width:100vw!important; max-height:85dvh; } }` (a proper bottom sheet at the FRAME level) and retire/rescope the orphaned `#theme-popup` mobile rule so it no longer fights the kit frame. Altitude: component CSS (kit-scoped), not inline.

## RESP-2 [Major] [Effort:<1day] [Value:High] — Kit modal windows never go full-screen/centered on mobile
- **Where:** mobile-14-settings-open.png, mobile-22-new-season.png, mobile-25-error-engine-down.png (vs desktop-14). `orwellWindow.js:181-183`; no game-kit counterpart to `style.css:5133-5153`/`7254-7267`.
- **Problem:** Settings, New Season, and the engine-down "house is dark" modal all render as ~250-360px windows anchored to the TOP-LEFT quadrant on a 390px phone, leaving large empty scrim/whitespace and (for non-scrim ones) overlapping live chat. Desktop centers them; mobile has no fullscreen/bottom-sheet rule for `.ow-window`. **Mechanism:** same 64vw cap + desktop-centering math as RESP-1; the existing mobile fullscreen rules are scoped to `.doclib-modal-content/.gallery-modal-content` and legacy `.modal`, none of which the kit windows carry. **Differential:** legitimate reflow would re-flow to a centered/full-width sheet; here the window keeps a desktop footprint mis-anchored — a positioning defect, not reflow.
- **Confidence:** High. Falsifier: a device-specific per-window `!important` I didn't see would flip this; grep found none for `#settings-modal`/new-season at ≤768.
- **Prediction:** 320px worsens (window becomes a larger fraction of viewport, more overlap); landscape short-height clips the bottom controls.
- **Fix:** one shared kit rule — `@media (max-width:768px){ .ow-window:not(.ow-docked)[data-modal]{ inset:auto 0 0 0; width:100vw; max-width:100vw; max-height:90dvh; border-radius:14px 14px 0 0 } }` — so every modal kit window is a bottom sheet on phones. Altitude: shared component CSS.

## RESP-3 [Major] [Effort:<1day] [Value:High] — Floating gadget windows overlap hero/welcome/composer and stack uncontained on mobile
- **Where:** mobile-04-gadget-rail-docked.png, mobile-05-gadget-deals.png, mobile-06-gadget-status.png, mobile-07-gadget-cast.png, mobile-08-gadget-finale.png. `orwellWindow.js:181`; slot sheet path `orwellSlots.js:179-193`.
- **Problem:** Opening a gadget as an undocked window on mobile floats it over the chat: "The Cast" covers the Orwell hero; a bare "The Finale" bar sits over the welcome card ("Meet the house" peeks through behind it, mobile-07 y~690). Multiple windows are live at once with no containment or scrim, so the game's own content is occluded. **Mechanism:** undocked kit windows are viewport-fixed and either slot-sheeted (left:0/right:0) or 64vw-capped; either way they paint on TOP of the chat column with no backdrop, and nothing collapses siblings. **Differential:** the *docked* rail-drawer path (style.css:2166-2246) is the correct mobile design and works; this is specifically the undocked-window escape hatch being unadapted — a real overlap defect, not the intended drawer reflow.
- **Confidence:** High (5 frames). Falsifier: if undocking is desktop-only and unreachable on touch, this becomes latent — but the capture reached it, so it's live.
- **Prediction:** 320px: more overlap; landscape: windows cover the composer entirely.
- **Fix:** on the narrow tier force-dock any opened gadget into the rail drawer (route `open()` through the docked path when `isNarrow()`), OR give undocked kit windows the RESP-2 bottom-sheet treatment + a scrim so only one is foreground. Altitude: JS open-path + shared CSS.

## RESP-4 [Major] [Effort:<1hr] [Value:High] — "Select model" pill overlaps/truncates the composer placeholder on mobile
- **Where:** mobile-16-diary-room.png, mobile-19-stream-complete.png, mobile-23/24. Composer row (`.chat-input-bar` + model pill).
- **Problem:** The placeholder "Tell the producers what you're really thi…" is visibly cut off where the "Select model" pill floats over the right of the input; the same crowding hits "Say or do something…". **Mechanism:** the model pill is positioned over the single-line input's right edge; at 390px the input's usable width underruns the pill, so placeholder text renders beneath it (an overlap, corroborated by the truncation being exactly at the pill's left edge across 4 frames). **Differential:** not a legitimate ellipsis (the text is under the pill, not padded away from it) — a z-overlap defect.
- **Confidence:** High. Falsifier: if the pill has an opaque background that fully hides (not overlaps) text and the input padding reserves its width on desktop only, it's still a mobile overlap.
- **Prediction:** 320px worse; keyboard-open unaffected (composer uses dvh).
- **Fix:** reserve the pill's width in the input's `padding-right` on the narrow tier (or move the pill above the input into its own row on ≤480px). Altitude: component CSS.

## RESP-5 [Major] [Effort:<1day] [Value:Med] — Finale & Deals gadgets open as empty title-bar-only windows over content
- **Where:** mobile-04/05/06/08 all show a bare "The Finale" titlebar (no body); desktop-08 shows the same empty "The Finale". mobile-05 labeled deals also shows only "The Finale".
- **Problem:** Opening the Finale (and, in the deals capture, no "Your Deals" body appears) yields a chrome-only window with a title bar and traffic lights but zero content, floating over the hero/welcome. It reads as broken. **Mechanism:** the gadget has no content at Week-1 game state, but the kit still mounts a full window frame; on mobile that empty frame overlaps live content (RESP-3). **Differential:** legitimate empty-state would show an "in-house / nothing yet" body; here the body is absent entirely — a rendering/empty-state gap, amplified on mobile by overlap.
- **Confidence:** Med (empty may be correct data, but the chrome-only presentation is a defect on both platforms; mobile overlap is the responsive part).
- **Prediction:** persists at all widths.
- **Fix:** suppress opening (or render an explicit empty-state body) for gadgets with no content; on narrow, never float an empty frame over chat. Cross-territory with the HUD/game-design lens.

## RESP-6 [Major] [Effort:<1hr] [Value:Med] — New Season modal is non-scrim, overlaps live chat; portrait dropdown clipped
- **Where:** mobile-22-new-season.png.
- **Problem:** The "A New Season" window (Keep/Recast, portrait picker, "Make AI studio portraits") floats top-left with NO backdrop, so the live "You/Renee" bubbles, welcome card and diary banner bleed through on the right; the portrait-select `▼` dropdown is clipped behind the window's right edge. **Mechanism:** same unstyled kit frame on mobile (RESP-2) but this instance has no modal scrim, so background chat stays visible and interactive underneath. **Differential:** not reflow — a season-transition dialog must be a hard stop; leaking the live board behind it is a defect (and brushes I9 machinery/immersion).
- **Confidence:** High.
- **Prediction:** 320px: dropdown fully clipped/unusable.
- **Fix:** RESP-2 bottom-sheet + a scrim; ensure the portrait `<select>`/dropdown opens within the sheet width. Altitude: CSS + open-options.

## RESP-7 [Minor] [Effort:<1day] [Value:Med] — Multiple cards stack simultaneously and bury the composer on mobile
- **Where:** mobile-01-landing.png (comp-round + welcome), mobile-09-nominations (welcome + nomination), mobile-22 (new-season + welcome + diary), mobile-17 (welcome + toast).
- **Problem:** Premiere welcome card + an active decision card + a toast + the diary banner can all be mounted at once; on a 390x844 phone they consume the whole viewport and there is visible z-overlap between the welcome card's bottom shadow and the decision card's top (mobile-01 y~285, mobile-09-nominations y~285). The player must scroll through stacked cards to reach the composer. **Mechanism:** the narrow sheet stacker (orwellSlots.js:179-193) lays top-slot panels in one column by measured height, but it does not dismiss the stale welcome card when a hard-stop decision card mounts, so two+ full-height sheets co-exist. **Differential:** a single reflowed sheet is fine; the defect is co-mounting a stale info card with a hard-stop decision card (also a game-state issue — corroborates the prior "stale welcome card" finding).
- **Confidence:** Med.
- **Prediction:** 320px: even taller stacks, composer further below the fold.
- **Fix:** auto-dismiss the premiere welcome card when a decision card (hard stop) mounts; cap concurrent top-slot sheets on narrow.

## RESP-8 [Minor] [Effort:<1hr] [Value:Med] — Binding pill forces decision-card title to wrap / crowd the × at 360px
- **Where:** mobile-09-nominations.png ("Nomination ceremony — your nominations" wraps around the pill), mobile-09-juror-vote.png ("Your jury vote — crown / a winner").
- **Problem:** The "⚠ IRREVERSIBLE — BINDING" pill (~180px) sits top-right on a ~360px card, leaving ~150px for the title, which wraps to two lines that run under/beside the pill; the × sits just below, crowded. **Mechanism:** title + pill share one flex row with the pill flex-fixed; at narrow width the title's min-content forces a wrap. **Differential:** a legitimate reflow would move the pill to its own row below the title; here it stays inline and squeezes the title — a layout defect at this width.
- **Confidence:** High.
- **Prediction:** 320px: pill nearly full-width, title crushed to ~120px, likely 3-line wrap.
- **Fix:** on ≤480px drop the binding pill to a full-width row under the title (or shorten to "BINDING"). Component CSS.

## RESP-9 [Minor] [Effort:<1hr] [Value:Low] — Comp-intent dumps all 16 names in prose → very tall block on mobile
- **Where:** mobile-09-decision-comp-intent.png.
- **Problem:** The comp-intent card lists every houseguest inline ("Still in with you: Natalia … Hazel Tyson") twice (prose + "Round 1 — Still in"), producing ~12 lines before the compete/throw/play-safe buttons on mobile. Cognitive load + scroll. **Mechanism:** verbose model/engine text with no narrow-tier truncation; Flash-style verbosity overflows the narrow container worse than desktop (lens 4). **Differential:** legitimate content, but the duplicate full roster is redundant and the narrow container has no clamp.
- **Confidence:** Med.
- **Prediction:** 320px worse.
- **Fix:** collapse the roster to a count + expandable list on narrow; de-duplicate the two roster restatements. Cross-territory (narration/Frontier-AI lens).

## RESP-10 [Minor] [Effort:<1hr] [Value:Med] — "Reset window positions" is a dead affordance on mobile
- **Where:** mobile-14/15-settings-appearance.png ("Reset window positions" button + "Reset All").
- **Problem:** On mobile, kit windows are drawers/sheets with no draggable geometry, so "Reset window positions" does nothing meaningful — a control that lies. **Mechanism:** desktop-only feature exposed unconditionally in Settings; no `isNarrow()` gate. **Differential:** not reflow — a workspace power-control surfaced where it has no referent (C2 workspace bleed).
- **Confidence:** High.
- **Fix:** hide "Reset window positions" on the narrow tier (or when no undocked windows exist). JS/CSS gate.

## RESP-11 [Minor] [Effort:<1day] [Value:Low] — macOS traffic-light chrome on mobile floating windows
- **Where:** mobile-07/08 (red/yellow/green dots on "The Cast"/"The Finale"). `orwellWindow.js:264-293`.
- **Problem:** The desktop window metaphor (traffic-light close/minimize dots) is presented on touch; the only close affordance is a 32px dot (js:293 sets coarse min 32px). 32px meets WCAG 2.5.8 (AA, 24px) but is below 2.5.5 (AAA, 44px) and the metaphor is desktop-alien on a phone. **Mechanism:** the kit renders the same titlebar chrome on all tiers. **Differential:** deliberate 32px owner ruling (js:283-291) — so not a hard target-size fail, but a metaphor/affordance mismatch on touch.
- **Confidence:** Med. Falsifier: if mobile uses the drawer (docked) path, these windows don't appear — but the capture shows them.
- **Fix:** on narrow, replace traffic lights with a single ≥44px close/"done" affordance on the sheet. Component CSS.

## RESP-12 [Minor] [Effort:<1hr] [Value:Low] — Cast "Compact pin" button overlaps first portrait card on mobile
- **Where:** mobile-07-gadget-cast.png (the "⊤ Compact pin" pill at top-right sits over the top edge of the "P/Player" portrait tile).
- **Problem:** The pin control (positioned top-right of the window body) overlaps the first grid card rather than sitting in the titlebar/toolbar. **Mechanism:** absolute/inline-positioned control with no narrow reflow into the header. **Differential:** overlap, not reflow.
- **Confidence:** Med.
- **Fix:** move the pin toggle into the titlebar accessory row on narrow, or add top padding to the grid. Component CSS.

## RESP-13 [Minor] [Effort:<1hr] [Value:Low] — Dead vertical gap between last message and welcome card (welcome-active) on mobile
- **Where:** mobile-19-stream-complete.png, mobile-24-full-app.png (Renee's message ends ~y270; welcome card starts ~y450 — ~180px empty).
- **Problem:** The `.welcome-active` composer/hero centering leaves a large empty band between the last real message and the bottom-anchored welcome card, reading as a layout gap. **Mechanism:** welcome-active positions the composer/welcome in available space above the input bar (style.css ~2294), but with real messages present the top-anchored history + bottom-anchored welcome leave a hole. **Differential:** not reflow — the welcome-active state should have been cleared once the conversation has messages.
- **Confidence:** Med.
- **Fix:** drop `.welcome-active` once ≥1 real message exists; let history fill. Cross-territory (game-state) + CSS.

## RESP-14 [Minor] [Effort:<1hr] [Value:Low] — Error "The house is dark" duplicated + hero bleeds through scrim on mobile
- **Where:** mobile-25-error-engine-down.png.
- **Problem:** The engine-down modal shows "The house is dark" TWICE (titlebar + heading), and the background hero ("Type /setup", "Production needs a feed source") bleeds through the scrim behind it; the modal sits top-left under the banner rather than centered. **Mechanism:** RESP-2 unstyled mobile frame + a scrim that doesn't fully occlude the hero. **Differential:** duplicate title is a content dup; bleed-through is an opacity/scrim defect (corroborates prior "faint background text bleeds through" note).
- **Confidence:** High.
- **Fix:** drop the redundant heading; ensure the scrim is opaque enough to hide the hero; RESP-2 centering.

## RESP-15 [Minor] [Effort:<1day] [Value:Med] — Dual/confusing HUD entry on mobile (drawer vs floating windows)
- **Where:** mobile-04..08 (floating windows) vs desktop-04 (docked right rail "The House"). style.css:2166-2246 (drawer); orwellWindow.js:181 (windows).
- **Problem:** On desktop the HUD (status / where-you-are / deals) lives in the docked right rail. On mobile that rail becomes a top-right drawer FAB — but the SAME gadgets can also open as floating windows (RESP-3), so there are two competing, inconsistent ways to view the same HUD info, and the floating path is the broken one. Power-state legibility (lens 2) suffers: the phone player may never find the clean drawer. **Mechanism:** two open-paths (rail-dock vs undock-window) both reachable on touch. **Differential:** the drawer is correct; the finding is the un-consolidated second path.
- **Confidence:** Med.
- **Fix:** on narrow, make the drawer the ONLY HUD surface (disable undock); ensure status/deals/where-you-are are all inside it.

## RESP-16 [Polish] [Effort:<1hr] [Value:Low] — Onboarding holding card is a top-left ~64vw window over the decision card
- **Where:** mobile-02-onboarding-holding.png (renders "The house is dark" holding window over the comp-round card).
- **Problem:** Same top-left ~250px kit-modal placement (RESP-2), here overlapping an active decision card. **Fix:** RESP-2 bottom-sheet.

## RESP-17 [Polish] [Effort:<1hr] [Value:Low] — Send glyph inconsistency on mobile (↑ vs +)
- **Where:** mobile-24 shows a "+" in the blue send circle; mobile-16/01 show "↑".
- **Problem:** The primary send/compose glyph flips between an up-arrow and a plus across states, weakening the affordance's learnability on touch. **Differential:** may be attach vs send mode — verify; if it's the same button changing meaning, it's a defect.
- **Fix:** keep a stable send glyph; use a distinct icon/position for attach.

## RESP-18 [Latent] [Effort:<1day] [Value:Med] — 320px prediction: binding pill + title overflow, modals worsen
- **Where:** predicted from mobile-09 cards + RESP-1/2/8 mechanisms.
- **Problem:** At ~320px (small Android) the binding pill (~180px fixed) leaves ~120px for titles (3-line wrap / clip), and 64vw modals become an even larger mis-anchored fraction. WCAG 1.4.10 requires reflow to 320px without loss. **Fix:** the RESP-1/2/8 fixes (bottom sheets + pill-to-own-row) resolve this; add a 320px matrix case to `frontend/scripts/responsive_matrix.py`.

## RESP-19 [Latent] [Effort:<1hr] [Value:Low] — Landscape rail collapses correctly but floating windows stay 64vw
- **Where:** style.css:2247-2274 (max-height:500px drawer) works; orwellWindow.js:181 unaffected.
- **Problem:** In short-landscape the rail becomes a drawer (good), but undocked kit windows keep the desktop 64vw footprint and can cover the composer. **Fix:** apply the RESP-3 narrow-tier window rule to `@media (max-height:500px)` too.

## RESP-20 [Polish] [Effort:<1hr] [Value:Low] — Cast portraits are giant gradient letter-placeholders on mobile
- **Where:** mobile-07-gadget-cast.png (each ~245px tall colored square with a single letter).
- **Problem:** With no generated headshots (deterministic build), the cast grid shows huge single-letter gradient blocks that fill the viewport — visually crude and space-hungry on mobile. **Differential:** placeholder state, not a DPR/sharpness bug (they're CSS gradients, resolution-independent). **Fix:** smaller portrait tiles + initials on narrow; reserve large tiles for real images.

## RESP-21 [Minor] [Effort:<1hr] [Value:Low] — Settings kit window has large empty area below content on mobile
- **Where:** mobile-14/15-settings-*.png (content ends mid-window; white space to y~680).
- **Problem:** The fixed-size kit window doesn't shrink to content nor expand to a full sheet, so a big empty panel sits below the last setting. **Mechanism:** RESP-2 (no mobile sheet sizing). **Fix:** RESP-2 bottom-sheet with content-driven height.

## RESP-22 [Polish] [Effort:<1hr] [Value:Low] — Streaming/verbose narration equivalence HOLDS on mobile (null result)
- **Where:** mobile-18-streaming-f*.png vs desktop-18-*.
- **Problem:** None — reported as a steelman/negative control. Renee's multi-sentence narration reflows cleanly in the mobile bubble with no horizontal scroll or clip; the "View thinking process" accordion works. The Flash-verbosity-overflow hypothesis (lens 4) is NOT confirmed for chat bubbles (it IS confirmed for decision cards — RESP-9). Keep as evidence that the bubble layer is equivalent.

## RESP-23 [Minor] [Effort:<1hr] [Value:Low] — Toast competes with welcome card for the bottom band on mobile
- **Where:** mobile-17-toast-f06.png ("The house stirs" toast directly above the welcome card, both above composer).
- **Problem:** The notice stacks in the same narrow top/bottom sheet column as the welcome card, so the player sees welcome + toast + composer crammed together. **Mechanism:** narrow sheet stacker places both. **Fix:** give transient toasts a distinct short-lived overlay band, not the sheet stack. Minor.

## RESP-24 [Polish] [Effort:<1hr] [Value:Low] — Binding pill consumes ~half the card width, crowding the ×
- **Where:** mobile-09-nominations.png.
- **Problem:** The pill + × share the top-right; at 360px the pill's right edge nearly touches the card border and the × is pushed under it. Sub-case of RESP-8. **Fix:** folded into RESP-8.

---

## Coverage / where I looked
Compared BOTH viewports for: landing, onboarding-holding, chat-home, gadget-rail-docked, gadgets
(status/cast/deals/finale), all 12 decision cards (spot-read comp-intent/comp-round/nominations/
juror-vote/eviction-vote/select filmstrip), theme window (+filmstrip), model picker, settings
(open/account/appearance/shortcuts), diary room, streaming filmstrip + stream-complete, thinking
collapsed/expanded, new-season, retrospective, full-app, toast filmstrip, error engine-down, send-fail
final. Cross-checked mechanisms in responsive-tokens.css, style.css (drawer 2166-2274, welcome-active,
theme 7254-7294, doclib/gallery 5133-5153, settings 22151+), orwellWindow.js (kit CSS 176-388),
orwellSlots.js (narrow sheet stacker). Did NOT: open the mobile sidebar drawer state (no capture),
real-device keyboard-open (dvh confirmed in source, not visually), tablet/768px boundary (no capture),
DPR2 image sharpness of real portraits (deterministic build has none). NOT a null lane — mobile is
broken as the owner flagged.
