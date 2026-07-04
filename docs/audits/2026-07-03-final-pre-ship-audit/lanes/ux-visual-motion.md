# Orwell — Visual & Motion Lens Audit (Agent: VM)

Telemetry reviewed: `scratchpad/audit2/telemetry/` (MANIFEST.md set: 218 PNGs, 14 filmstrips,
14 dom-mutation logs, desktop 1440x900 + mobile 390x844, Week-1-veto live game) AND the
supplementary `INDEX.md` set (stills/ + filmstrips/: login, holding-card, OOBE wizard, casting
send-stream-settle 28-frame filmstrip, goodbye-binding across desktop/mobile/tablet x light/dark,
finale/retrospective, gadgets) — desktop/mobile/tablet x light/dark where available.
Pixel-sampled contrast ratios were computed programmatically (PIL + WCAG relative-luminance),
not eyeballed, where cited.

## Index

| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| VM-1 | Blocker | <1day | High | Season-end modal collides with live chat + Diary banner + composer on mobile | mobile-22-new-season.png |
| VM-2 | Blocker | <1day | High | Theme picker unusable on mobile — clipped to a ~250x70 sliver | mobile-12-theme-window.png, mobile-12b-theme-open.dom.json |
| VM-3 | Blocker | <1day | High | System/error fallback text renders inside the in-fiction "Orwell" narration bubble | desktop-27-send-fail-final.png |
| VM-4 | Blocker | <1day | High | Cast + Finale gadget windows share one slot with no cascade, burying the sidebar nav | desktop-04..08-gadget-*.png |
| VM-5 | Major | <1day | High | Ceremony decision cards (Nominations etc.) hard pop in — zero transition frames | desktop-10-decision-mount-f00..f09.png |
| VM-6 | Major | <1day | Med | Toast notices hard pop in/out — zero transition frames | desktop-17-toast-f00..f11.png, desktop-17-toast.dom.json |
| VM-7 | Major | <1day | High | Finale opening-statement Confirm is enabled with an empty textarea | desktop-09-decision-finale-statement.png |
| VM-8 | Major | <1day | Med | "IRREVERSIBLE — BINDING" badge is inconsistently applied across equally-binding decisions | desktop-09-decision-comp-intent.png vs -nominations.png |
| VM-9 | Major | multi-day | High | The two named peak-end moments (season-end, jury-unsealing) render as small sidebar windows, not a takeover | desktop-22-new-season.png, retro-window-finale__desktop__light.png |
| VM-10 | Major | <1day | Med | Jury vote tally reads as a 9-line bullet dump with no visual score | retro-window-finale__desktop__light.png |
| VM-11 | Major | <1hr | High | Diary Room banner misuses system-red for a non-destructive notice | desktop-16-diary-room.png |
| VM-12 | Major | <1hr | High | Login "Remember me" checkbox fills system-red instead of system-blue | stills/login-page__desktop__dark.png |
| VM-13 | Major | <1hr | Med | Toast overlaps the casting "Pick your season's models" onboarding modal | stills/oobe-setup-wizard__desktop__dark.png |
| VM-14 | Major | <1day | Med | Engine-down state shows 3 conflicting simultaneous explanations | desktop-25-error-engine-down.png |
| VM-15 | Major | <1day | Med | Finale gadget window renders clipped above the viewport top edge | finale-gadget__desktop__light.png |
| VM-16 | Major | <1hr | High | Contrast fail: "IRREVERSIBLE — BINDING" badge ≈2.25:1 | desktop-09-decision-nominations.png (measured) |
| VM-17 | Major | <1hr | High | Contrast fail: disabled "Confirm — this is binding" ≈1.74:1 | desktop-09-decision-comp-intent.png (measured) |
| VM-18 | Major | <1hr | High | "Where You Are" HUD states a full room roster then contradicts it with "No one nearby" | desktop-03-chat-home.png (and all HUD frames) |
| VM-19 | Minor | <1hr | Med | "Select model" pill straddles the message-list/composer border | desktop-03-chat-home.png, mobile-03-chat-home.png |
| VM-20 | Minor | <1hr | Low | "Reset All" looks permanently disabled with no explanation, weaker than the correctly-red "Reset progress" | desktop-15-settings-appearance.png, desktop-15-settings-account.png |
| VM-21 | Minor | <1hr | Low | Ghost "Orwell" watermark bleeds through/duplicates during glass-overlay transitions | desktop-12b-theme-open-f00.png, desktop-16-diary-room.png |
| VM-22 | Minor | <1hr | Med | Comp-round roster duplicated as a 15-name prose wall, twice, no chip grouping | desktop-09-decision-comp-round.png |
| VM-23 | Minor | <1hr | Low | Empty-state hint copy differs (and gets more technical) between desktop and mobile for the same state | desktop-25-error-engine-down.png vs mobile-16-diary-room.png |
| VM-24 | Minor | <1day | Low | Streaming bubble's figure/ground contrast weakens as the message grows | desktop-18-streaming-f00/f05/f14.png |
| VM-25 | Minor | <1hr | Low | One keyboard-shortcut row shows an unexplained lone "reset" icon | desktop-15-settings-shortcuts.png |
| VM-26 | Minor | <1hr | Low | "Keep this houseguest" / "Recast from scratch" carry equal visual weight for a major fork | desktop-22-new-season.png |
| VM-27 | Minor | <1hr | Med | Confirm CTA sits with an orphaned gap from the option pills it depends on | desktop-09-decision-nominations.png (all decision cards) |
| VM-28 | Minor | <1day | Med | Passive info banners and binding ceremony cards share one undifferentiated template | desktop-03/04/09-*.png (stacked cards) |
| VM-29 | Minor | <1day | Low | Casting interview shows 3 consecutive near-duplicate narration bubbles + a leaked template fragment | filmstrips/seq-casting-send-stream-settle-05/27.png |
| VM-30 | Minor | <1hr | Low | Comp-intent vs comp-round binding-copy phrasing drifts between two near-identical mechanics | desktop-09-decision-comp-intent.png vs -comp-round.png |
| VM-31 | Polish | <1hr | Med | No prefers-reduced-motion telemetry exists for this journey — coverage gap before ship | MANIFEST.md (absence) |
| VM-32 | Polish | <1hr | Low | Mobile "Select model" pill overlaps the attachment-icon row | mobile-03-chat-home.png |
| VM-33 | Major | <1day | Med | Theme window's persisted geometry (`slotKey`) isn't viewport-clamped, producing VM-2 | frontend/static/js/theme.js:2407-2411 |

## 1. Visual hierarchy read (key screens)

**Chat home (`desktop-03-chat-home.png`).** 1st: the stacked info/decision cards (largest, highest-contrast off-white blocks against the dark gradient — correct figure/ground). 2nd: the HUD column (Week/HOH/Noms/Veto + "Where You Are") — smaller type but high contrast white panel. 3rd: composer. The "Select model" control competes for attention it shouldn't have (see VM-19) — it is pinned exactly on the seam between two containers, so the eye briefly treats it as a 4th anchor before dismissing it as chrome. Grouping: the two cards (Welcome + Competition) use identical chrome with no severity differentiation (VM-28) — proximity/similarity make them read as one continuous strip rather than "one is a dismissible tip, one is this week's live decision."

**Decision cards (all `*-decision-*.png`).** 1st: the card title (bold, larger). 2nd: the option pills (highest local contrast, blue focus ring on the default-focused pill). 3rd: the Confirm CTA — but it sits in the SAME row as a small italic disabled-reason caption, competing for the same reading line and separated from the pills by a large, ungrouped gap (VM-27). The red IRREVERSIBLE badge, when present, correctly commands top-right first-glance attention — but it's inconsistently present (VM-8) and low-contrast when it is (VM-16).

**HUD sidebar (`orwell-status` + `orwell-presence`, every desktop still).** "Where You Are" visually presents two different claims — a location roster and a proximity fact — with identical type weight and no separator, so they read as one contradicting sentence (VM-18): the single biggest hierarchy defect in the persistent chrome, because it's visible on almost every frame.

**New Season / Retrospective (`desktop-22-new-season.png`, `retro-window-finale`).** On desktop this uses the small gadget-window template (380px column, competing with the HUD) rather than commanding the frame — first glance lands on the HUD panel bleeding through behind it, not on the reveal itself (VM-9). On mobile (`mobile-22-new-season.png`) hierarchy collapses entirely: the reveal, live chat, Diary Room banner, and composer are all simultaneously salient with no dimming/z-order to establish figure vs. ground (VM-1).

**Login (`login-page__desktop__dark.png`).** Clean, correctly centered, single glass card, one primary CTA ("Sign In") — a good screen. The one defect is semantic-color, not hierarchy: the "Remember me" checkbox's red fill draws the eye disproportionately for a non-critical, non-destructive preference (VM-12).

## 2. Motion inventory

| Surface | Trigger | Observed duration/easing | Staging | Lifecycle issues | Reduced-motion |
|---|---|---|---|---|---|
| Theme window open | click theme icon | fade+scale-in, visible low-opacity intermediate frame (f00) before settle (f03) | single-stage materialize | Minor: background watermark bleeds through the low-opacity frame inside the window's own bounds, reads as window content (VM-21) | Not captured — see VM-31 |
| Decision card mount (Nominations etc.) | phase transition / ceremony begins | **0 visible frames of transition** — card absent at f00, fully rendered (text, 6 pills, red badge, disabled CTA) at f01 | none | Hard pop-in; no stagger between title, pills, and badge; the single biggest-stakes reveal in the product gets the least ceremony (VM-5) | Not captured |
| Decision option select (pill tap) | click a nominee pill | outline→filled red across ≥1 frame, Confirm greys→blue in the same window | 2-stage (selection fill, then CTA enable) | Acceptable; no jank observed in the 8 sampled frames | Not captured |
| Toast / notice mount | `OrwellNotice` show | dom-log shows 3 attribute writes inside 67ms then silence for the rest of the ~1s+ capture; all 12 sampled frames are pixel-identical | none observed | Effectively an instant pop within the sampling resolution — no slide/fade discernible (VM-6) | Not captured |
| Onboarding/holding-card dismiss | close holding card | f00 and f04 (and all sampled frames) show identical post-dismiss state — no fade-out captured | none observed | Consistent with the toast/decision-card pattern: exits are as abrupt as entries | Not captured |
| Streaming narration | AI reply streams | token-append growth, ~15 frames sampled f00→f14 | continuous append | Bubble fill/edge contrast shifts over the course of the stream — see VM-24; no jank/flicker otherwise | Not captured |
| Gadget window stacking (Cast+Finale) | open 2nd gadget while 1st is open | no animated cascade — 2nd window renders directly stacked under the 1st at the same anchor, clipped | none | Produces an illegible pile over the sidebar (VM-4); on mobile the same slot logic clips the Finale/Theme windows to a title-bar sliver (VM-2, VM-15) | Not captured |

**Cross-cutting motion finding:** the `.ow-window` kit (Theme, Settings) gets a real materialize transition; the higher-frequency, higher-stakes surfaces — `.on-*` above-composer decision cards and toast notices — get **none**. This directly inverts APPLE_GENIUS.md's own priority (glass "materializes... not by fading opacity," implying deliberate treatment is expected) and the vision brief's mandate that ceremonies "land as an exclusive set-piece event" — the biggest beats (Nominations, Eviction) currently have the *least* motion craft in the product.

## 3. Findings

[VM-1] [Severity: Blocker] [Effort: <1day] [Value: High]
Season-end reveal collides with live chat, Diary Room banner, and composer on mobile
- Where: `mobile-22-new-season.png` (390x844)
- Problem: The "A New Season" modal is not scrimmed/isolated on mobile — it renders on top of the still-visible player/Renee chat bubbles, and simultaneously the Diary Room privacy banner, the Welcome card, and the composer are all visible, overlapping. The season-end portrait picker's avatar swatch literally sits on top of the "Welcome to the house" card's body text. Gestalt figure/ground is fully broken: there is no way to tell what's foreground vs. background. This is the vision brief's peak-end moment #1 rendered illegible on a full third of the device matrix. Differential: this is a layout/z-index and dimming-layer defect, not a content or IA problem — the same modal's content is coherent on desktop (`desktop-22-new-season.png`).
- Confidence: High (directly observed, single still, unambiguous overlap).
- Fix: On narrow viewports, season-end/finale-class modals must force `restackNarrowSheets`-style full-width, full-scrim treatment (matching what Settings already does correctly on mobile, `mobile-14-settings-open.png`) instead of falling through to the generic anchored-window path. Add an explicit "takeover" window class for ceremony modals (New Season, Retrospective) that always renders full-bleed with a ≥60% scrim beneath, on every breakpoint.

[VM-2] [Severity: Blocker] [Effort: <1day] [Value: High]
Theme picker is completely inaccessible on mobile — clipped to a ~250×70px sliver
- Where: `mobile-12-theme-window.png`; corroborating `mobile-12b-theme-open.dom.json`
- Problem: On mobile, opening the Theme window renders only a fragment of its title/tab bar in the top-left corner; none of the "Default Themes" grid is visible. The player cannot pick a theme on mobile at all as captured. Root cause (see VM-33): `theme.js` persists window geometry via `slotKey: 'theme'` across sessions with `minWidth/minHeight: 320`, but the DOM log shows the modal (`#theme-modal.ow-window.orwell-slotted`) receiving many rapid `style` writes with no corresponding size we can verify was clamped to the 390px mobile viewport — consistent with a desktop-sized/positioned geometry being restored verbatim and only its top-left corner intersecting the small viewport.
- Differential: Not a settings-plumbing bug (the settings window's own mobile layout is fine, `mobile-14-settings-open.png`) — isolated to the modal/geometry-persistence path specific to `theme.js`.
- Confidence: High (screenshot + source citation + dom log corroborate).
- Fix: Clamp restored `slotKey` geometry to the current viewport on every open (not just on resize), or route ceremony/utility modals with `modal: true` through the same `restackNarrowSheets` full-width path Settings uses below the mobile breakpoint. Add a regression test that opens the Theme window on a 390px viewport after seeding a desktop-sized `orwell-slot-offset` and asserts full visibility.

[VM-3] [Severity: Blocker] [Effort: <1day] [Value: High]
A raw system/error message renders inside the in-fiction "Orwell" narration bubble
- Where: `desktop-27-send-fail-final.png`
- Problem: After a failed send ("NOT SENT" badge, correctly styled), the very next bubble is attributed to "Orwell" — the game's narrator persona — and reads: "No chat session active. You can: • Use /help to see all available commands." This is pure workspace/CLI boilerplate voiced in the exact same chrome as in-fiction narration (avatar, name, timestamp, copy/retry icons). Per I9, no engine/tool/app/system talk may appear in anything the player sees, and this is the worst form of it: it is not merely visible, it is *attributed to the narrator*, so the player cannot tell it apart from the game world talking. Differential: distinct from the charter's prior "empty-narration on marquee social turn" (a missing-beat blocker) and "OOC-aside mis-record" (a minor mis-tagging) — this is a system fallback impersonating the narrator's voice.
- Confidence: High (verbatim text visible in a single still).
- Fix: Route all session/connectivity fallback copy through a visually distinct system-notice component (the `.on-*` banner kit already used for Diary Room/notices) with no "Orwell" attribution, name, or avatar — never through the narration-bubble renderer.

[VM-4] [Severity: Blocker] [Effort: <1day] [Value: High]
Cast + Finale gadget windows share one anchor slot with no cascade, burying the sidebar nav
- Where: `desktop-04-gadget-rail-docked.png` through `desktop-08-gadget-finale.png` (all five identical); source: `frontend/static/js/orwellCast.js:332` and `frontend/static/js/orwellFinale.js:144` both declare `slot: "top-left"`
- Problem: Opening the Cast window then the Finale window (or vice versa) stacks both at the same left-hand slot with no offset/cascade. The result: a ~373px-wide, near-full-height "Cast" panel directly on top of the ENTIRE primary sidebar (New Chat / Search / Diary Room / Cast nav items are fully obscured), with "Finale" squeezed into a ~77px sliver below it showing only its title bar. The player loses access to primary navigation while two gadgets are open, and the second window is functionally invisible. Differential: this is a stacking/layout defect in the anchor-slot engine, not a content bug — both windows render correctly in isolation (compare `desktop-09-decision-*.png`, captured after they were minimized to the "WINDOWS" dock, where they behave fine).
- Confidence: High (5 corroborating stills, source-grounded).
- Fix: Either (a) give Cast and Finale distinct default slots (e.g., `top-left` / `top-right`) since they're conceptually independent panels, or (b) when two panels share a slot, cascade with a visible x/y offset (per the window kit's own "stack by measured height" comment in `orwellSlots.js`) instead of collapsing the second into a sub-200px sliver, and never let a top-left slot render with `left: 0` when the docked sidebar is present (the code comment in `orwellSlots.js:81-95` states left-anchored slots should inset past the sidebar's live right edge — verify why that guard isn't firing here).

[VM-5] [Severity: Major] [Effort: <1day] [Value: High]
Ceremony decision cards (Nominations, Eviction, Veto…) hard pop into existence with zero transition frames
- Where: `desktop-10-decision-mount-f00.png` (card absent) → `f01.png` (card 100% rendered: title, body, 6 pills, red badge, disabled CTA, all present) — identical through `f09.png`
- Problem: Per the vision brief, ceremonies should "land as an exclusive set-piece event." Instead, the single biggest-stakes UI moment in the game (naming two houseguests for eviction) appears as an instantaneous swap between two adjacent captured frames — no fade, no scale, no stagger of the red warning badge, nothing. There is no anticipation beat and no "materialize via lensing" (per APPLE_GENIUS.md's motion-restraint rule, glass should materialize by modulating lensing, never a hard cut). Differential: this is a motion/staging defect, not a functional one — the card's content and gating logic are correct.
- Confidence: High (two adjacent, otherwise-fixed-camera frames with a hard content delta).
- Fix: Add a deliberate mount transition to the `.on-*` decision-card kit — at minimum a 150–250ms scale+opacity materialize with the badge/CTA staggered in ~80ms after the body, gated by `prefers-reduced-motion` (fall back to the current instant swap only when reduced motion is requested).

[VM-6] [Severity: Major] [Effort: <1day] [Value: Med]
Toast notices hard pop in/out — zero transition frames across the full sampled lifecycle
- Where: `desktop-17-toast-f00.png` through `-f11.png` (pixel-identical toast state across all 12 frames); `desktop-17-toast.dom.json` (3 attribute writes inside 67ms, then no further mutation on `#tel-toast` for the rest of the capture)
- Problem: The "The house stirs" toast is fully sized/positioned/opaque in the very first captured frame and never changes across 12 frames spanning >1s of DOM activity — consistent with either no CSS transition on mount or one so brief it's invisible at this sampling rate. Either way it registers as an unweighted pop, the exact "elements that pop without transition" failure this audit was asked to hunt for. Differential: not a data/timing bug (the toast's content is correct and stable) — purely a materialization-craft gap.
- Confidence: Medium (absence-of-motion evidence from a fixed sampling interval can't fully rule out a sub-frame transition, but the dom log corroborates no ongoing style animation).
- Fix: Give the `.on-*` toast kit an explicit enter/exit transition (slide+fade, ~180ms, matching the Theme window's already-correct materialize) and confirm via a slower-interval filmstrip capture that a real transition is now visible frame-over-frame.

[VM-7] [Severity: Major] [Effort: <1day] [Value: High]
Finale opening-statement Confirm button is enabled with an empty textarea
- Where: `desktop-09-decision-finale-statement.png`
- Problem: Every pill-based decision card in the set (comp-intent, nominations, veto, eviction-vote, replacement, final-eviction, juror-vote) correctly renders "Confirm — this is binding" disabled/greyed until a valid selection is made. The Final-2 opening-statement card is a freeform-text equivalent of the same binding mechanic ("type your statement to the jury, then Confirm") but its Confirm button is rendered fully enabled/blue from the very first frame, with the textarea empty. Compare the sibling juror-question card (`desktop-09-decision-juror-question.png`), which explicitly says "Leave it blank to pass" — a legitimate reason to pre-enable; the finale-statement card carries no such allowance in its copy, yet has the same enabled state. Differential: could be an intentional "optional statement" design, but the copy doesn't say so, and the visual affordance (solid blue, indistinguishable from a validated state) actively invites submitting a blank Final-2 statement — the single highest-stakes freeform input in the game.
- Confidence: Medium-High (visual state is unambiguous; intent is inferred from copy mismatch — recommend the game/UX lens confirm whether blank Final-2 statements are permitted by design).
- Fix: Gate the finale-statement Confirm on non-empty text (matching the pill-card pattern), or, if blank is intentionally allowed, add explicit "optional" copy identical to the juror-question card's "leave it blank to pass" so the enabled button doesn't read as a mistake.

[VM-8] [Severity: Major] [Effort: <1day] [Value: Med]
"IRREVERSIBLE — BINDING" badge is applied inconsistently across equally-binding decisions
- Where: Present on `desktop-09-decision-nominations.png`, `-eviction-vote.png`, `-replacement.png` (veto ceremony replacement), `-final-eviction.png`, `-juror-vote.png`; ABSENT on `-comp-intent.png`, `-comp-round.png`, `-veto-decision.png`, `-goodbye-message.png`, `-finale-statement.png`, `-juror-question.png` — even though several of those also carry "this is binding" text in the body copy.
- Problem: The red badge is the app's one loud, unambiguous "this really matters" signal (per HIG, red = destructive-role emphasis). Applying it to some binding choices and not others of comparable weight (e.g., Veto decision — arguably as consequential as Nominations — gets no badge; Goodbye Message, the game's emotional send-off beat, gets no badge) trains the player to under-weight the badge's absence rather than reliably reading stakes from it.
- Confidence: High (directly comparable screenshots, consistent pattern across all 11 decision-card stills).
- Fix: Apply the badge on a single binary rule (e.g., "any decision the copy calls binding gets the badge") rather than per-decision-type judgment calls, or replace the badge with a graded severity token (e.g., outline for "binding," filled for "binding + game-altering") so the distinction is deliberate rather than accidental.

[VM-9] [Severity: Major] [Effort: multi-day] [Value: High]
The two named peak-end moments (season-end fork, jury-vote unsealing) render as small sidebar windows, not a ceremonial takeover
- Where: `desktop-22-new-season.png`, `retro-window-finale__desktop__light.png`
- Problem: The vision brief names two specific peak moments the whole architecture exists to produce: being blindsided and later learning it was real (the retrospective "unsealing"), and pulling off your own blindside (season/finale resolution). Both are rendered using the same ~380px gadget-window template as "Your Deals" or "Where You Are" — competing for space with, and partially obscured by, the persistent HUD behind them (`desktop-23-retrospective.png` shows the HUD's "Living Room — Lola, Michelle…" text visibly bleeding through the retrospective window's own translucent header). Differential: this is a hierarchy/staging problem, not a content problem — the actual copy and data (jury vote breakdown, "Isabel Fischer wins the season") are present and correct once opened (`retro-window-finale`, `retro-untold-story` stills); they're just not given the visual command the moment calls for.
- Confidence: Medium-High (visual comparison is direct; "correct" treatment is inferred from the vision brief's own stated intent, not a hard spec).
- Fix: Add a distinct "ceremony takeover" presentation tier (full-bleed, centered, ≥60% scrim, its own entrance choreography) reserved for season-end and retrospective-unsealing, separate from the everyday floating-gadget kit.

[VM-10] [Severity: Major] [Effort: <1day] [Value: Med]
Jury vote tally reads as an undifferentiated 9-line bullet dump, no visual score
- Where: `retro-window-finale__desktop__light.png`
- Problem: The finale's vote reveal — arguably the single most climactic data point in the entire season — is presented as nine near-identical lines ("Trent Frye votes for Isabel Fischer," "Carlos Steele votes for Isabel Fischer," …) with no running tally, no grouped columns by recipient, and no final score emphasized. The player must manually count bullets to learn the margin was 8–1. Differential: not a data-completeness issue (all votes are present and individually attributed, which correctly matches the ADR 0048 unsealing design) — purely a presentation/hierarchy gap on top of correct data.
- Confidence: High (content directly visible and countable in the still).
- Fix: Render the tally as a grouped scoreboard (finalist name + vote count, ordered) above the individual voter list, with the winning total visually emphasized (larger type/weight), matching how eviction-night reveals are typically staged in the source material (Big Brother's own vote-reveal graphic is exactly this pattern).

[VM-11] [Severity: Major] [Effort: <1hr] [Value: High]
Diary Room privacy banner misuses system-red for a non-destructive, informational notice
- Where: `desktop-16-diary-room.png` ("🔒 Diary Room — private & out-of-character; the house never hears this.")
- Problem: Per APPLE_GENIUS.md, red is reserved for the Destructive role. This banner is purely informational (nothing is being destroyed or risked), yet it's rendered in a red/pink-tinted pill — the same hue family as the app's "IRREVERSIBLE — BINDING" badges and the correctly-red "Reset progress" button (`desktop-15-settings-account.png`). Using red here dilutes its meaning everywhere else it appears: by the time the player reaches an actually-binding eviction vote, red has already been spent on a routine mode-switch notice. Differential: a genuine color-semantics violation, not a contrast issue (the banner itself is legible) — confirmed by comparing against the correct uses of red elsewhere in the same product (`desktop-15-settings-account.png`'s "Reset" button, the selected-nominee pills in `desktop-11-decision-select-f03.png`).
- Confidence: High.
- Fix: Restyle the Diary Room banner with a neutral/informational token (e.g., the same treatment as the "Welcome to the house" info card) — reserve red exclusively for destructive/irreversible actions and warnings.

[VM-12] [Severity: Major] [Effort: <1hr] [Value: High]
Login "Remember me" checkbox fills system-red instead of system-blue
- Where: `stills/login-page__desktop__dark.png`
- Problem: The checked "Remember me" checkbox renders with a solid red fill and red-tinted checkmark. Per APPLE_GENIUS.md, checked/on states for toggles and checkboxes must use system blue; red is destructive-only. A benign sign-in preference rendered in the app's most alarming color is a first-impression violation of the HIG color contract, before the player has even reached the game.
- Confidence: High (unambiguous color visible in the still, directly measurable against the documented rule).
- Fix: Recolor the checkbox's checked-state fill to system blue (`#0a84ff` family, matching the focus-ring token already defined elsewhere in the codebase) and audit any other checkbox/toggle instances for the same mistake.

[VM-13] [Severity: Major] [Effort: <1hr] [Value: Med]
A toast overlaps the casting "Pick your season's models" onboarding modal
- Where: `stills/oobe-setup-wizard__desktop__dark.png`
- Problem: The "ℹ Producers are getting the house ready… (15 houseguests)" toast is positioned top-right and its bottom-left corner overlaps the top-right corner of the "Pick your season's models" modal directly beneath it, partially obscuring the modal's top border during a moment the player is meant to be reading/acting on ("Choose models" / "Start casting"). Differential: a z-index/positioning collision, not a race condition in when the toast fires (the toast's content and timing are appropriate for a background cast-prewarm event).
- Confidence: High (direct visual overlap in a single still).
- Fix: Reserve a top-right toast lane that never overlaps an open modal's bounding box, or suppress/queue toasts while a blocking onboarding modal is open.

[VM-14] [Severity: Major] [Effort: <1day] [Value: Med]
Engine-down state shows three simultaneous, conflicting explanations for why the game won't load
- Where: `desktop-25-error-engine-down.png`
- Problem: Three separate copy blocks are visible at once and disagree on root cause: the top banner says "Big Brother engine unavailable... couldn't reach the game service"; the modal repeats "the game engine isn't reachable right now"; but the greyed background placeholder underneath both says "Production needs a feed source — connect a model in Settings and the house comes alive" — implying the real problem is a missing LLM/provider configuration, a materially different (and more player-actionable) cause than "the backend is down." A player or support-facing screenshot of this state is actively misleading about what to fix. Differential: a messaging-consistency defect, not a detection bug — likely two different gating conditions (engine unreachable vs. no model configured) sharing the same visual template without reconciling their copy.
- Confidence: Medium-High (the contradiction is directly visible; whether both conditions are literally true simultaneously in this capture is inferred, not confirmed via logs).
- Fix: Make the holding-card/error template branch on the actual detected cause and show exactly one explanation + one matching action, rather than layering a generic engine-down banner over a model-not-configured empty state.

[VM-15] [Severity: Major] [Effort: <1day] [Value: Med]
Finale gadget window renders clipped above the viewport top edge
- Where: `stills/finale-gadget__desktop__light.png`
- Problem: "The Finale" window's title bar shows only 2 of the expected 3 traffic-light controls (yellow/green, missing red), and the "Jury questions" section header is truncated/overlapped at its very top — consistent with the window's top-left origin sitting above/at the viewport boundary so its leftmost chrome (the red close control) and top margin are cropped. This is the same anchor/clamp family of bug as VM-2 and VM-4, observed a third time in a different window (Finale) and a different capture set, strengthening confidence that the window-kit's position clamping is unreliable whenever a window is opened in a stacked/rail-adjacent context.
- Confidence: Medium (inferred clipping from a single still; not confirmed via a dom/style dump for this specific capture).
- Fix: Same remediation family as VM-2/VM-4 — clamp every `.ow-window` open/restore to the current viewport bounds (including accounting for chrome that extends left/above the panel's own `top-left` reference point) before paint.

[VM-16] [Severity: Major] [Effort: <1hr] [Value: High]
Contrast failure: "IRREVERSIBLE — BINDING" badge text ≈2.25:1
- Where: `desktop-09-decision-nominations.png`, badge region (~x848-1040,y262-278)
- Problem: Programmatically sampled colors — badge text `rgb(255,68,68)` on badge fill `rgb(222,206,209)` — compute to a WCAG contrast ratio of **2.25:1**, well under the 4.5:1 floor for small text (and under 3:1 even by the more lenient large/UI-text bar). This is the app's single loudest warning label, on its most consequential surfaces (Nominations, Eviction, Final-3 eviction, Jury vote), and it is the one most likely to be skimmed/mis-read in a hurry.
- Confidence: High (measured, not estimated).
- Fix: Darken the badge fill or brighten/darken the text to hit ≥4.5:1 (e.g., white text on a solid `--red` fill, matching the correctly-executed "Reset progress" button in Settings, rather than a pastel-on-pastel treatment).

[VM-17] [Severity: Major] [Effort: <1hr] [Value: High]
Contrast failure: disabled "Confirm — this is binding" label ≈1.74:1
- Where: `desktop-09-decision-comp-intent.png`, button region (~x850-1030,y425-450)
- Problem: Sampled label `rgb(239,243,244)` on button fill `rgb(156,190,222)` computes to **1.74:1** — far below any WCAG text threshold. This affects every disabled Confirm button across the entire decision-card family (11 of the surveyed cards use this exact state). While disabled controls are sometimes exempted from contrast requirements, this button's own copy is the player's only clue for *why* it's inert ("this is binding") — if it can't be read, the disabled-state messaging fails on its own terms.
- Confidence: High (measured).
- Fix: Raise disabled-state contrast to at least 3:1 (UI-component floor) — darken the disabled label or lighten/desaturate the fill so the text remains legible while still reading as visually inert relative to the enabled blue state.

[VM-18] [Severity: Major] [Effort: <1hr] [Value: High]
"Where You Are" HUD states a full room roster, then contradicts it with "No one nearby"
- Where: `desktop-03-chat-home.png` and every subsequent frame carrying the HUD (e.g. `desktop-04..09`, `desktop-14` etc.)
- Problem: The panel reads "Living Room — Lola, Michelle, Karl, Vincent, Courtney, Ethan, Hassan, Wade, Mia, Jada, Eliana, Trey, Fabian, Victoria, Asher" immediately followed, in the same visual block with identical type weight, by the italic line "No one nearby." These two lines use no separator, no subheading, and no typographic distinction to signal that they answer two different questions (who's in this room at all vs. who's close enough to interact with) — as written, it reads as a flat self-contradiction ("here are the 15 people in your room" / "no one is near you"). Differential: this could be a genuine data bug (a live-game state issue outside this lens) or purely a presentation failure of two legitimately-different facts; from the visual lens alone I cannot rule out either, but even in the best case (both facts are true and just poorly separated) the current typographic treatment actively creates a false-contradiction reading for the player, which is a Gestalt/grouping failure regardless of root cause.
- Confidence: Medium (functional truth of the two facts is outside this lens's evidence; the display-level contradiction is directly observed and reproducible across every captured HUD frame).
- Fix: Visually separate "who's in the room" (roster) from "who's within conversational range" (proximity) with distinct subheadings/weight, or, if "No one nearby" is stale/leftover copy from before the roster populated, ensure it's suppressed once a roster is present.

[VM-19] [Severity: Minor] [Effort: <1hr] [Value: Med]
"Select model" pill straddles the message-list/composer border
- Where: `desktop-03-chat-home.png` (and consistently on every chat-home-adjacent still)
- Problem: The pill sits with its vertical center almost exactly on the divider between the scrollable message pane and the composer box, so it visually belongs to neither container — it reads as a mis-positioned/absolute-positioned element rather than a deliberately placed control, independent of the separate, larger question (flagged in the prior audit pass) of whether this control should be player-visible at all.
- Confidence: Medium (position is clearly visible; whether this is "intentional straddle" vs. a CSS bug can't be fully confirmed from a still alone).
- Fix: Move the control fully inside the composer's own chrome (e.g., as a composer-toolbar accessory) so it doesn't visually bisect two surfaces.

[VM-20] [Severity: Minor] [Effort: <1hr] [Value: Low]
"Reset All" looks permanently disabled with no explanation, weaker than the correctly-red "Reset progress"
- Where: `desktop-15-settings-appearance.png` ("Reset window positions" ⟷ "Reset All"), contrast with `desktop-15-settings-account.png` ("Reset progress" — correctly red)
- Problem: "Reset All" (presumably resets every Appearance toggle) sits directly beside the enabled "Reset window positions" link but renders as a flat grey pill with no copy anywhere explaining what would enable it or what it does. Since it's a broader, more consequential reset than the single-purpose one beside it, and the product elsewhere correctly reserves red for exactly this kind of action ("Reset progress"), its muted, unexplained treatment undersells its own stakes.
- Confidence: Medium (can't confirm from a still whether "disabled" is the true state or just a lighter enabled style).
- Fix: Either enable it with a clear affordance + confirmation step, or add adjacent copy stating why it's inert; if destructive, style consistently with the Danger Zone red convention.

[VM-21] [Severity: Minor] [Effort: <1hr] [Value: Low]
Ghost "Orwell" watermark bleeds through/duplicates during glass-overlay transitions
- Where: `desktop-12b-theme-open-f00.png` (watermark appears positioned inside the opening Theme window's bounds); `desktop-16-diary-room.png` (watermark appears doubled/offset behind the Diary Room banner)
- Problem: The empty-chat-state watermark logo is a background-layer element, but during low-opacity transition frames it becomes visible through foreground glass and, by coincidental positioning, reads as if it belongs to the foreground surface (the Theme window) rather than the layer behind it. Differential: cosmetic/transient only — visible for at most one transition frame, not a persistent state.
- Confidence: Low-Medium (based on a single transition frame each; could be resolved by the time a real user perceives it given a properly-timed transition, see VM-31 caveat about unverified reduced-motion/real-speed behavior).
- Fix: Ensure the empty-state watermark is hidden (not merely low-opacity) whenever a modal/window with its own scrim is active, so it can't bleed through during any transition frame.

[VM-22] [Severity: Minor] [Effort: <1hr] [Value: Med]
Comp-round roster duplicated as a 15-name prose wall, twice, with no chip/column grouping
- Where: `desktop-09-decision-comp-round.png`
- Problem: The card's body paragraph lists all 15 remaining competitors as a comma-separated sentence, and the very next line ("Round 1 — Still in:") repeats the identical 15 names verbatim. This is a "list masquerading as prose" antipattern (no Gestalt grouping via chips/columns) forcing the player to read a full paragraph twice to find their own name, and wastes significant vertical space compared to a wrapped-chip roster.
- Confidence: High (directly visible, duplication is verbatim).
- Fix: State the roster once, as wrapped pill/chip elements (reusing the `.ow-btn`/pill visual language already used for the compete/throw/play-safe options), and drop the redundant sentence.

[VM-23] [Severity: Minor] [Effort: <1hr] [Value: Low]
Empty-state hint copy differs (and gets more technical) between desktop and mobile for the identical no-model-configured state
- Where: `desktop-25-error-engine-down.png` ("Production needs a feed source — connect a model in Settings and the house comes alive.") vs `mobile-16-diary-room.png` ("Type /setup, then choose Local models or API.")
- Problem: For what appears to be the same underlying condition, mobile surfaces bare technical vocabulary ("API", "/setup") that desktop's copy for the analogous state avoids — a regression in in-fiction framing specifically on the smaller/more casual-use surface.
- Confidence: Medium (captured from two different flows/times; can't rule out these are genuinely different states without live interaction).
- Fix: Use one canonical, in-fiction-toned empty-state string sourced from a single copy constant, rendered identically regardless of viewport.

[VM-24] [Severity: Minor] [Effort: <1day] [Value: Low]
Streaming bubble's figure/ground contrast weakens as the message grows
- Where: `desktop-18-streaming-f00.png` (opaque, high-contrast bubble edge) vs `-f05.png`/`-f14.png` (edge nearly blends into the page gradient)
- Problem: The Renee reply bubble is clearly demarcated from the background at the first frame but by full-length its background fill reads almost seamlessly into the surrounding gradient — consistent with an adaptive/translucent fill that samples the page background and grows less distinct as the bubble's aspect changes. Legibility of the white text itself isn't at risk, but the bubble's own boundary (useful for distinguishing where one speaker's turn ends) weakens over a single stream.
- Confidence: Low-Medium (could be an intentional adaptive-glass effect responding to bubble size/position; only 3 frames sampled).
- Fix: Verify the bubble fill/opacity doesn't fall below a minimum edge-contrast threshold regardless of message length or scroll position; if this is the adaptive-legibility system reacting to backdrop luminance, cap how far it can desaturate/lighten a chat bubble specifically (chat bubbles are content, not chrome, and per the material model shouldn't behave like an adaptive glass surface at all).

[VM-25] [Severity: Minor] [Effort: <1hr] [Value: Low]
One keyboard-shortcut row shows an unexplained lone "reset" icon
- Where: `desktop-15-settings-shortcuts.png` ("Toggle sidebar" row)
- Problem: Of the 7 listed shortcuts, only "Toggle sidebar" carries a small reset-to-default icon beside its keycap chips; the header row also carries one (a reasonable "reset all" affordance), but the mid-list appearance on a single row has no companion visual (color, badge, "modified" label) to explain why that row specifically differs from the other 6.
- Confidence: Low (plausible this indicates "this binding was customized," a legitimate and useful signal, just under-communicated).
- Fix: If the icon means "this shortcut differs from default," add a small "Modified" label or accent so the meaning doesn't rely on noticing a lone icon.

[VM-26] [Severity: Minor] [Effort: <1hr] [Value: Low]
"Keep this houseguest" / "Recast from scratch" carry equal visual weight for a major, irreversible fork
- Where: `desktop-22-new-season.png`
- Problem: Both options are rendered as identical white/outline pills with no primary/secondary emphasis, hover/selected state, or default recommendation, despite representing a major branch point (continue as the same character vs. restart the casting interview entirely).
- Confidence: Low (equal-weight presentation may be a deliberate "no thumb on the scale" choice for such a personal decision).
- Fix: If a default/recommended path exists, apply the single-tinted-primary-CTA convention to it; if genuinely neutral by design, at minimum add a distinguishing hover/focus treatment so the choice doesn't feel inert.

[VM-27] [Severity: Minor] [Effort: <1hr] [Value: Med]
Confirm CTA sits with an orphaned gap from the option pills it depends on
- Where: `desktop-09-decision-nominations.png` (representative of all 11 decision cards)
- Problem: The option pills occupy the card's left/center; "Confirm — this is binding" sits far right, vertically aligned with the italic disabled-reason caption rather than with the pills above — a proximity violation that visually disconnects the action from its inputs. On mobile this is naturally fixed (the CTA becomes a full-width bar below the pills, `mobile-09-decision-nominations.png`), which only highlights that the desktop layout is the outlier.
- Confidence: Medium.
- Fix: On desktop, either place Confirm directly beneath the pill row (matching the mobile pattern) or move the disabled-reason caption to sit directly beneath Confirm so the two related texts don't visually merge with unrelated ones.

[VM-28] [Severity: Minor] [Effort: <1day] [Value: Med]
Passive info banners and binding ceremony cards share one undifferentiated visual template
- Where: `desktop-03/04/09-*.png` — the "Welcome to the house" info card and e.g. the "Nomination ceremony" decision card use identical chrome (rounded rect, off-white fill, thin border, same corner radius/spacing)
- Problem: Beyond the inconsistently-applied red badge (VM-8), there is no structural visual distinction (color, elevation, border weight) between a dismissible tip banner and a binding, irreversible ceremony decision. Stacked together (as they are on nearly every screen), they read as one continuous, low-differentiated pile rather than "one of these is decorative, one of these needs my decision now."
- Confidence: Medium.
- Fix: Give binding decision cards a distinct elevation/border treatment (e.g., a slightly heavier border or subtle glow in the destructive/binding color family) independent of the badge, so severity is legible even before reading copy.

[VM-29] [Severity: Minor] [Effort: <1day] [Value: Low]
Casting interview shows 3 consecutive near-duplicate narration bubbles and a leaked template fragment
- Where: `filmstrips/seq-casting-send-stream-settle-05__desktop__light.png` and `-27__desktop__light.png`
- Problem: After a single player turn ("I grew up loving reality TV and I'm ready to play my game."), three consecutive "Orwell" bubbles render, each opening with the near-identical stem "The house settles for a moment. [stub-echo]..." — one of which contains an unterminated bracket/parenthetical fragment ("[stub-echo] (Production cue — begin the casting interview now. Reach out"). Differential: this capture uses the deterministic/echo test narrator per the audit logistics, so the specific leaked text is likely a test-harness artifact rather than something a production LLM would say verbatim — but the UI provides no de-duplication of consecutive near-identical beats and no defensive truncation/sanitization of an unterminated bracket, so if a real (especially smaller/cheaper) model ever echoes a system-prompt fragment, nothing in the rendering pipeline would catch it before it reaches the player.
- Confidence: Low-Medium on this being reproducible with a real model; Medium-High on the underlying gap (no consecutive-duplicate collapsing, no bracket-fragment guard) being real regardless.
- Fix: (1) Collapse/suppress consecutive narration bubbles that are near-identical repeats of the immediately-prior beat. (2) Add a defensive filter that strips or hides bubbles containing obvious scaffolding markers (`[stub-`, unterminated `(` without a matching `)`) before they reach the player-facing renderer, as a last-resort backstop alongside the reasoning-channel split already in place for `<think>` content.

[VM-30] [Severity: Minor] [Effort: <1hr] [Value: Low]
Comp-intent vs comp-round binding-copy phrasing drifts between two near-identical mechanics
- Where: `desktop-09-decision-comp-intent.png` ("Your choice here is what counts — make it with the buttons.") vs `desktop-09-decision-comp-round.png` ("This sets how you play the comp. Your selection only — never read from prose.")
- Problem: Both cards gate the same underlying mechanic (lock in compete/throw/play-safe) with the same disabled-Confirm pattern, but use two differently-worded explanations of why buttons (not chat text) are what count. Minor, but it's one more small inconsistency contributing to the overall "template drift" pattern also seen in VM-8.
- Confidence: Low (stylistic, not a hard rule violation).
- Fix: Standardize on one canonical explanatory string for "your button choice, not your prose, is what's recorded," reused verbatim across every card that shares the mechanic.

[VM-31] [Severity: Polish] [Effort: <1hr] [Value: Med]
No prefers-reduced-motion telemetry exists for this journey — a coverage gap, not a confirmed defect
- Where: `MANIFEST.md` (the capture inventory has no reduced-motion pass; contrast with the charter/brief's explicit requirement to review "normal AND reduced-motion" passes)
- Problem: APPLE_GENIUS.md treats the reduced-motion path as a hard, always-on requirement (kill elastic/specular animation) and this lens's own brief calls for reviewing it explicitly. None of the 218 stills/filmstrips in this capture run represent a `prefers-reduced-motion: reduce` pass, so none of the motion findings above (VM-5, VM-6, VM-9) can be verified as degrading gracefully — they might currently rely entirely on the (already-broken) default transition, meaning reduced-motion users get the exact same instant pops, which would at least be *consistent*, but this cannot be confirmed either way from available evidence.
- Confidence: High (this is an evidence-availability statement, not a behavioral claim).
- Fix: Before ship, capture a matching reduced-motion filmstrip set for at least the decision-card mount, toast, and window-open sequences, and confirm each degrades to (or already is) an instant, un-elastic state with no residual transform/opacity animation.

[VM-32] [Severity: Polish] [Effort: <1hr] [Value: Low]
Mobile "Select model" pill overlaps the attachment-icon row
- Where: `mobile-03-chat-home.png`
- Problem: On the 390px viewport, the "Select model ⌃" pill sits close enough to the paperclip/attachment icon that its left edge nearly touches the icon's tap target, with no visible gap token between them — a tighter, more collision-prone version of VM-19 specific to the narrow breakpoint.
- Confidence: Low (proximity is visible; whether tap targets actually overlap needs interaction testing, not just a still).
- Fix: Verify ≥8px clear gap and no overlapping hit-areas between the model pill and the attachment control at the 390px breakpoint.

[VM-33] [Severity: Major] [Effort: <1day] [Value: Med]
Theme window's persisted geometry is not viewport-clamped, producing VM-2
- Where: `frontend/static/js/theme.js:2404-2414` (`initThemeKitWindow`, `slotKey: 'theme'`, `minWidth: 320, minHeight: 320`); evidenced by `mobile-12-theme-window.png` + `mobile-12b-theme-open.dom.json`
- Problem: The Theme modal persists its geometry per the F5 "persisted geometry across sessions" comment in the source, but nothing in the reviewed capture confirms that restored geometry is re-clamped to a *new, smaller* viewport (e.g., first mobile open after any desktop session, or a live desktop→mobile resize). The dom log shows repeated `style` attribute writes on the modal in the same 62ms tick immediately after mount — consistent with a clamp routine firing but not converging to a visible size, or firing on the wrong reference frame. This is the most likely root cause of VM-2.
- Confidence: Medium (source-grounded inference; would need a live reproduction with devtools to fully confirm the exact failing code path).
- Fix: Add an explicit `clampPos`-equivalent call (the pattern already exists in `orwellSlots.js` for slot-anchored panels) to the modal window path specifically on every `open()`, not only on `resize`, and add a regression test seeding a desktop-sized offset then opening on a 390px viewport.

## 4. Contrast/legibility candidates

- **"IRREVERSIBLE — BINDING" badge** — measured **2.25:1** (text `#FF4444` on `#DECED1`-family fill). Fails 4.5:1 text floor. See VM-16.
- **Disabled "Confirm — this is binding" label** — measured **1.74:1** (`#EFF3F4` on `#9CBEDE`-family fill). Fails even the lenient 3:1 UI floor. See VM-17.
- **Diary Room / red-tinted banners generally** — not independently measured for contrast (legible in the still), but flagged for color-*role* misuse rather than contrast; worth a follow-up contrast pass once recolored per VM-11.
- **Italic disabled-reason captions** ("Select 2 houseguests to enable Confirm.") — measured **≈4.88:1**, passes; included here only to confirm it is NOT part of the contrast problem (isolating the failure to the badge + CTA specifically).

## 5. Top 3 launch-blocking

1. **VM-1 — Season-end reveal is illegible on mobile** (chat/banner/composer/modal all collide). This is one of the two named "peak-end" moments in the entire vision brief, broken on a full class of devices.
2. **VM-2 / VM-33 — Theme picker is completely non-functional on mobile.** A shipped, documented feature (house themes, 0052) is inaccessible on ~half the device matrix.
3. **VM-3 — A raw system error ("No chat session active... /help") is voiced by the "Orwell" narrator persona.** This is a structural I9 violation of exactly the kind the product's own mandate calls a failure state — the machinery is not just visible, it's in-character.

(Runner-up, very close behind: VM-4, the Cast+Finale window stack that blocks the primary sidebar nav — not "peak-moment" but a core, high-frequency interaction broken in the everyday chat surface.)

## Coverage / where I looked

Reviewed: landing, onboarding holding-card (+ dismiss filmstrip), chat home, gadget rail docked + all 4 gadgets (status/deals/cast/finale), all 11 decision-card types (desktop + mobile stills, + mount/select filmstrips), theme window (still + open filmstrip, desktop + mobile), model picker, settings (Appearance/Shortcuts/Account tabs, desktop + mobile), diary room, toast filmstrip + dom log, streaming narration filmstrip + stream-complete, thinking accordion (collapsed/expanded), new-season modal (desktop + mobile), retrospective + untold-story unseal, full-app shell, engine-down error (+ mobile), mid-turn send-fail filmstrip + final state (+ mobile); supplementary set: login page (desktop/mobile/tablet, light/dark — sampled dark), holding-card (dark), OOBE model-setup wizard (dark), casting send→stream→settle 28-frame filmstrip (sampled f00/f05/f27), goodbye-message decision card (tablet/dark), finale gadget + jury-question decision card, retro-window-finale + retro-untold-story.

Not covered / recommend follow-up: (1) reduced-motion pass (VM-31 — none exists in this capture); (2) live interaction/hover/focus states beyond what a still or DOM-mutation log can infer (e.g., whether VM-7's finale-statement Confirm is actually submittable when empty, vs. only *looking* enabled); (3) the remaining 10 of 16 "Show all themes" grid entries (only the 6-item default grid was captured); (4) tablet breakpoint beyond the single goodbye-message card sampled; (5) light-theme variants of the supplementary set's dark-only captures (login/holding-card/OOBE were sampled in dark only per available files). I did not re-verify or re-report any of the ~41 prior-pass findings listed in the charter, including the model-pill/workspace-vocab family (VM-19/23/32 build on but do not duplicate that finding — they add new, specific placement/copy defects not previously called out).
