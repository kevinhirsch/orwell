# UX-IA — Wayfinding, structure & labeling audit (Orwell pre-ship v2)

Lens: structure, navigation, labeling, findability, and the player's mental model ("where am I,
where can I go, how do I get back"). Grounded in VISION_BRIEF I1-I10/C1-C6 + CHARTER.

**Evidence base:** `scratchpad/audit2/telemetry/` (MANIFEST.md + 218 PNGs/filmstrips/DOM logs,
desktop 1440x900 + mobile 390x844, game seeded to Week-1 veto phase); source cross-checks in
`frontend/static/index.html`, `frontend/static/js/{orwellGadgetRail,orwellCast,orwellDeals,
orwellStatusPanel,orwellElements,settings,app,keyboard-shortcuts}.js`, `frontend/static/style.css`.
Prior v1 findings (~41, indexed in CHARTER) are not re-reported.

**Not re-reported (v1):** workspace machinery visible (model pill/msg counter/nav — corroborated
below with NEW specifics, so flagged distinctly), non-binding comp-round buttons, stale welcome
card, roster empty-flash, "N of 15 met" counter.

---

## Index

| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| IA-1 | Major | <1day | High | Left nav mixes workspace verbs (New Chat/Search) with game nouns (Diary Room/Cast), unstyled and undifferentiated | index.html:926-937 |
| IA-2 | Major | <1hr | High | Settings > Shortcuts lists raw chat-app shortcuts (New chat/Favorite chat/Delete chat/Search chats) with zero game framing | desktop-15-settings-shortcuts.png; index.html Shortcuts tab |
| IA-3 | Major | <1day | High | "Select model" pill is a permanent fixture directly above the composer/primary decision CTA on every turn | desktop-09-decision-*.png (all 11) |
| IA-4 | Blocker(if real)/Major(fixture) | <1day | High | Decision card claims conflict with the persistent status HUD about who holds power (nominations card: "As Head of Household…" vs HUD "HOH: Vincent Campos") | desktop-09-decision-nominations.png vs desktop-06 HUD |
| IA-5 | Major | <1day | High | Floating windows spawn directly over the persistent right-rail HUD, occluding HOH/noms/veto/where-you-are | desktop-04/07/08/22/23-*.png |
| IA-6 | Major | multi-day | High | Mobile: the entire game-state HUD (HOH/noms/veto/where-you-are) has no persistent visible entry point — only a 0.5-opacity unlabeled icon and an undemonstrated edge-swipe | mobile-03/04-*.png; style.css:2209-2233; index.html:1193-1210 tips |
| IA-7 | Minor | <1hr | Med | Accessible names for the HUD rail say "the control room" while the visible label says "The House" (systemic, all 3 header buttons) | index.html:1452,1459,1460 |
| IA-8 | Minor | <1hr | Low | Onboarding tip says the House icon is "at the top of the sidebar"; it actually lives top-right, outside the nav sidebar | index.html:1193 |
| IA-9 | Major | <1day | High | 2-3 dismissable/actionable cards stack vertically above the composer with identical visual styling — no way to scan which needs action | desktop-03 (2 stacked); desktop-17-toast-f05 (3 stacked) |
| IA-10 | Minor | <1hr | Med | Toast "The house stirs" carries no body text/subject — zero information scent | desktop-17-toast-f05.png |
| IA-11 | Major | <1hr | High | "Your Deals" gadget can silently degrade every row to the generic label "A houseguest" with no error affordance | desktop-05-gadget-deals.png; orwellDeals.js:115 |
| IA-12 | Minor | <1day | Med | No dedicated "Alliances" surface exists for the player — only "Your Deals"; an "Alliances" gadget exists solely in the internal demo kit | orwellElements.js:207 vs orwellGadgetRail.js REGISTRY |
| IA-13 | Minor | <1hr | Low | Retrospective/Season-Recap gadget has 3 different names depending on where you look ("Season Recap" strip tooltip, "orwell-retro" id, "The Season, Watched Back" window title) | orwellGadgetRail.js:51; desktop-23-retrospective.png |
| IA-14 | Minor | <1hr | Med | "Week 1" top-center pill is a free-text, user-renameable chat-session title masquerading as authoritative game HUD | app.js:298-409; desktop-03-chat-home.png |
| IA-15 | Minor | <1hr | Low | "Cast" (sidebar), "The Cast" (window/gadget), "Pinned Cast" (compact mode) — three near-identical labels for overlapping surfaces | index.html sidebar; orwellGadgetRail.js REGISTRY |
| IA-16 | Minor | <1hr | Low | "Compact pin" button label doesn't say what it does or what state results | desktop-04-gadget-rail-docked.png |
| IA-17 | Major | <1day | Med | Settings modal shows no active-tab indicator visible on mobile in any capture — tab rail is off-screen/scrolled-past | mobile-14/15-*.png (all 3) |
| IA-18 | Minor | <1hr | Low | "Peek" button (Settings/window titlebars) has no tooltip/label explaining its effect (transparency toggle) | desktop-14-settings-open.png; settings.js:23,129-160 |
| IA-19 | Minor | <1hr | Low | "Reset window positions" vs the adjacent disabled "Reset All" — scope of each is unstated (windows only? everything?) | desktop-14-settings-open.png |
| IA-20 | Minor | <1hr | Med | Settings > Account shows account identity as "Unknown / User" with a "?" avatar | desktop-15-settings-account.png |
| IA-21 | Minor | <1hr | Low | Sidebar nav items (New Chat/Search/Diary Room/Cast) show no active/current-state styling — the nav can't answer "where am I" | desktop-03/16 (Diary Room active, no highlight in nav) |
| IA-22 | Major | <1day | Med | Error-state copy mixes diegetic and technical registers within the same view (banner: "Big Brother engine unavailable"/"game service" vs card: "The house is dark") | desktop-25-error-engine-down.png |
| IA-23 | Major | <1hr | High | Mid-turn send failure reverts window title to "Orwell Chat" and shows a raw CLI-style system message ("No chat session active… Use /help") | desktop-27-send-fail-final.png |
| IA-24 | Minor | <1hr | Low | "Go in anyway" button on the engine-down card has no stated consequence | desktop-25-error-engine-down.png |
| IA-25 | Minor | <1hr | Low | Empty-state placeholder ("Type /setup…Production needs a feed source") appears to bleed through / coexist with an active mid-game state on mobile | mobile-03-chat-home.png (MANIFEST anomaly note) |
| IA-26 | Minor | <1day | Med | Diary Room mode has an entry banner but no visible dedicated exit control distinct from the generic dismiss "×" | desktop-16-diary-room.png; mobile-14-settings-open.png |
| IA-27 | Minor | <1hr | Low | Cast window pagination uses unlabeled dots only (no "1 of 4", no jump-to-name, no search) | desktop-04/mobile-07-gadget-cast |
| IA-28 | Minor | <1hr | Low | Theme picker exists as BOTH a standalone "Theme" window (16 swatches) and a same-named toggle inside Settings > Appearance > Sidebar, with no cross-reference between them | desktop-12-theme-window.png; desktop-14-settings-open.png |
| IA-29 | Polish | <1hr | Low | "Show all themes (16)" has no categorization/search for 16 unlabeled swatches beyond a name + 3-dot color chip | desktop-12-theme-window.png |
| IA-30 | Minor | <1hr | Med | Status HUD's "Week 1 Veto Competition ▼" dropdown affordance (expand-for-history?) is unexplored/unlabeled in every capture | desktop-06-gadget-status.png |
| IA-31 | Minor | <1hr | Low | "The House · 16/16" tally has no visible legend (is this alive/total houseguests? Includes player?) | desktop-06/orwellStatusPanel.js:452 |
| IA-32 | Minor | <1day | Med | Window-stacking has no z-order/focus cue — two "The Finale"/"The Cast" windows overlap with identical chrome, unclear which is frontmost/interactive | desktop-07/08-gadget-*.png |
| IA-33 | Minor | <1hr | Low | Gadget-rail "rearrange" icon (6-dot grid) reads as a generic app-launcher glyph, not "drag to reorder" | index.html:1459 |
| IA-34 | Polish | <1hr | Low | Mobile top title pill truncates the week/session label to "W…" while still appending "· 3 msgs" | mobile-24-full-app.png |

---

## Full findings

**[IA-1] [Severity: Major] [Effort: <1day] [Value: High]**
Left nav mixes workspace verbs with game nouns, unstyled and undifferentiated
- Where: `frontend/static/index.html:926-937` (sidebar: "New Chat", "Search" / "Diary Room", "Cast"); `desktop-03-chat-home.png` left rail.
- Problem: **Principle — labeling/match-to-real-world + navigation consistency.** The player's single persistent list of "places I can go" contains two items with zero meaning in the Big Brother fiction ("New Chat", "Search") sitting in the identical visual style as two items that are core game surfaces ("Diary Room", "Cast"). **Consequence:** a first-time player scanning "where can I go" cannot tell, from the nav alone, that "New Chat" starts a brand-new season (a Danger-Zone-tier, semi-destructive action) rather than opening a fresh conversation thread — the label carries the wrong affordance for its true weight. This is I9 (machinery invisible) and C2 (workspace's clothes) made concrete in the ONE surface a lost player would check first.
- Differential: not a flow or copy bug in isolation — it's structural: the vendored nav was never re-scoped for the game build, so this is squarely an IA/navigation-taxonomy gap, not visual polish.
- Confidence: H (source-confirmed via index.html + two independent screenshots).
- Fix: Either fold "New Chat"/"Search" into a clearly-separated "Account/App" sub-group visually distinct from the game-surfaces group ("Diary Room"/"Cast"), or rename/reframe "New Chat" in-fiction (e.g. "New Season") to match its real consequence, consistent with how "Cast" and "Diary Room" are already framed.

**[IA-2] [Severity: Major] [Effort: <1hr] [Value: High]**
Settings > Shortcuts exposes raw chat-app command vocabulary
- Where: Settings modal, Shortcuts tab, "CHATS" section — "New chat" (Ctrl+Alt+N), "Favorite chat" (Ctrl+Alt+F), "Delete chat" (Ctrl+Alt+D), "Search chats" (Ctrl+K). `desktop-15-settings-shortcuts.png`; markup at `index.html` settings-nav-item `shortcuts`.
- Problem: **Principle — consistency + I9 (the machinery is invisible).** The SAME Settings modal's Account tab is carefully game-framed ("Make your houseguest's portrait — and your profile pic — from a photo of yourself"), but one tab over, the Shortcuts list reverts entirely to workspace vocabulary the player has never otherwise seen named this way ("chats", "favorite"). **Consequence:** this is the single most concentrated workspace-vocabulary leak found in this lens — a player who opens Settings to learn shortcuts is told the product is a chat app with favoritable/deletable chats, directly contradicting the immersive frame established one click away.
- Differential: this is IA/labeling, not a feature gap — the shortcuts *themselves* may be legitimately useful (delete/favorite a season save); it's the naming that breaks the fiction.
- Confidence: H.
- Fix: Reframe entries in the season's vocabulary ("Delete chat" → "Abandon this season" or similar; "Favorite chat" → drop if seasons aren't meant to be favorited) consistent with the Danger Zone copy already used in Account.

**[IA-3] [Severity: Major] [Effort: <1day] [Value: High]**
"Select model" pill is a permanent fixture beside every decision CTA
- Where: every decision-card capture — `desktop-09-decision-{comp-intent,comp-round,nominations,veto-decision,replacement,eviction-vote,final-eviction,goodbye-message,juror-vote,finale-statement,juror-question}.png` (11/11 show it, unchanged, top-right of composer).
- Problem: **Principle — information scent / signal-to-noise, C2.** At the exact moment the game asks the player to make an irreversible, binding, in-fiction decision ("IRREVERSIBLE — BINDING" nominations/eviction cards), a piece of AI-plumbing chrome ("Select model") sits pinned inches away, on every single turn, with no dismiss/collapse. **Consequence:** the single most persistent visible non-diegetic control in the whole product occupies prime real estate next to the highest-stakes moments in the game, undermining the "you are a houseguest" frame at precisely the moments immersion matters most.
- Differential: this is IA/visual-hierarchy, not a missing-feature issue — the model picker's existence is fine (admin/multi-model support), its ALWAYS-VISIBLE placement is the problem.
- Confidence: H.
- Fix: Move model selection into Settings (or a collapsed/rail-docked affordance) and surface it near the composer only when no model is configured (as the OOBE/holding-card state already does).

**[IA-4] [Severity: Major, would be Blocker if reproducible in live play] [Effort: <1day to verify] [Value: High]**
Decision card claims conflict with the persistent status HUD about who holds power
- Where: `desktop-09-decision-nominations.png` ("Nomination ceremony — your nominations… As Head of Household, name two houseguests for eviction") vs. the simultaneously-visible right-rail HUD in the same capture and in `desktop-06-gadget-status.png` ("HOH: Vincent Campos"). Also: the nominee/candidate names shown in the nominations/veto/eviction-vote cards (Natalia Matthews, Mariana Dunlap, Myra Reyes, Sean Haynes, Ezra Johns, Brooke Kramer) never overlap with the roster the HUD shows present ("Where You Are: Lola, Michelle, Karl, Vincent, Courtney, Ethan, Hassan, Wade, Mia, Jada, Eliana, Trey, Fabian, Victoria, Asher").
- Problem: **Principle — legible power state (the vision brief's explicit bar) + I2/I10.** The one thing the player must always be able to trust is "who currently holds power." Here, one on-screen surface says the player is HOH; the persistent HUD says a named NPC is HOH. **Consequence: if this occurs in live play, the player has no way to resolve the contradiction** — there is no "current phase" cross-check, no timestamp, nothing that tells them which surface is stale. Given CLAUDE.md's own documented risk here (the `beatSeq`/stale-409 sync spine exists specifically to prevent this class of divergence, and "A-S3, a stale-409 that can drop a scene's only consequence fold" is a named open item), this is a plausible real failure mode, not a fanciful one.
- Differential: **most likely explanation is a capture-harness artifact** — the telemetry script probably injects each decision-card TYPE via an independent fixture/seed to economically screenshot all 11 card kinds against one running session, rather than genuinely progressing the game to each phase. That would make the roster/HOH mismatch a byproduct of capture methodology, not a shipped bug. I cannot rule out a live desync without re-driving an actual game to each phase.
- Confidence: M (the specific instance is likely a fixture artifact; the underlying structural risk — no in-card cross-check against the HUD's declared power-holder — is source-confirmed and independently plausible).
- Fix: (1) Re-verify by driving a live game through actual nominations/veto/eviction phases and confirming the HUD and decision-card agree at each step (this is the ship-gate's job, but worth a targeted re-run). (2) Regardless of (1), harden the decision card to assert its own actor context inline in a way that's programmatically drawn from the same state as the HUD (e.g. nominations card should say "As Head of Household [You / Name], name two...", which would make any future desync visibly self-contradictory within one string instead of requiring the player to cross-reference two panels).

**[IA-5] [Severity: Major] [Effort: <1day] [Value: High]**
Floating windows spawn directly over the persistent right-rail HUD
- Where: `desktop-04-gadget-rail-docked.png` (Cast window covers the composer's "Select model" AND partially obscures; below it "The Finale" window peeks with titlebar only, cut off at viewport bottom); `desktop-07/08-gadget-*.png` (identical — Finale content never visible, only its titlebar, in ANY of the 3 "gadget" captures meant to show it); `desktop-22-new-season.png` (the "A New Season" modal covers half of "Where You Are"); `desktop-23-retrospective.png` ("The Season, Watched Back" window covers "Week 1 Veto Competition" HUD entirely, leaving only fragments of "You / HOH… / Noms… / Veto —" visible underneath).
- Problem: **Principle — legible power state + spatial consistency (recognition over recall).** The vision brief calls for the player to read HOH/noms/veto "at a glance." Every one of 5 independent captures that opens a secondary window shows it defaulting to a position that occludes the primary HUD it's supposed to coexist with. **Consequence:** the player cannot glance at "who's HOH" while also consulting the Cast roster or the Finale/Retrospective — they must close one to see the other, defeating the "glanceable power state" goal exactly when the player is most likely to want both (e.g., checking the Cast roster to plan a veto decision while the HOH/noms/veto HUD is also relevant).
- Differential: this is a window-manager default-position problem (IA/layout), not a rendering bug — the windows render correctly, they're just placed to collide with the fixed HUD by default.
- Confidence: H (5 independent captures, consistent pattern).
- Fix: Give floating windows a default spawn offset that respects the right-rail HUD's bounding box (spawn left-of or below it, not on top), or auto-collapse the rail to its icon strip while any window with `order <= 5` HUD-adjacent content is open, restoring on close.

**[IA-6] [Severity: Major] [Effort: multi-day] [Value: High]**
Mobile: the entire game-state HUD has no discoverable persistent entry point
- Where: `mobile-03/04/06-*.png` (no HOH/noms/veto/where-you-are visible anywhere on first paint or after "opening" status/deals gadgets — captures 03, 04, and 06 are pixel-identical, suggesting the capture script itself couldn't reach these panels on mobile); `style.css:2209-2233` (`.gadget-rail-open` on mobile: 30x30px, `opacity: 0.5`, icon-only, no text label, positioned top-right); `index.html:1209` ("Tip: Swipe from the edge to open The House panel.").
- Problem: **Principle — findability + discoverability of a mode-changing gesture.** On mobile the ONLY ways to reach the entire HOH/nominee/veto/location HUD are (a) a 30x30px, 50%-opacity, unlabeled icon competing visually with the hamburger menu for the exact same visual weight, or (b) an edge-swipe gesture that the onboarding tip mentions in passing but the UI never demonstrates (no visible handle, no peek-edge affordance, no animation hint). **Consequence:** new mobile players — the majority of a "chat app" audience — are structurally unlikely to discover that a HUD exists at all; they will play blind to HOH/noms/veto status, which is precisely the "legible power state" the vision brief calls a bar to clear, failing hardest on the platform most players will actually use.
- Differential: could be dismissed as "just needs a design pass," but the underlying issue is architectural: the primary game-state surface has NO onboarding-taught, persistently-visible, adequately-sized affordance on the smaller viewport — that's a wayfinding gap, not a visual-polish nit.
- Confidence: H for the affordance weakness (source-confirmed sizing/opacity); M for "totally undiscoverable" (an edge-swipe might be more discoverable in actual touch use than a static screenshot can show).
- Fix: Add a persistent, labeled (even if icon+micro-text) "The House" affordance sized to a normal tap target (44x44 minimum) at full opacity for at least the first N sessions, or show a one-time coach-mark demonstrating the swipe on first game start (parallel to the existing "Meet the house" premiere tutorial pattern already in the product).

**[IA-7] [Severity: Minor] [Effort: <1hr] [Value: Med]**
Accessible names for the HUD rail contradict its visible label
- Where: `index.html:1452` (`title="Collapse the control room" aria-label="Collapse the control room"`), `:1459` ("Rearrange gadgets"), `:1460` ("Swap the control room to the other side") — all three buttons live directly under a `<span class="gadget-rail-title">The House</span>` (`index.html:1455`); also confirmed on the mobile opener's `aria-label="Open the control room"`.
- Problem: **Principle — labeling consistency across modalities.** Sighted players see the surface called "The House" everywhere (rail header, docked gadget titles, the finale/retro gadgets). Screen-reader users hear every control on that same surface called "the control room" — a completely different, more clinical/production-side name never shown visually anywhere the sighted player can see. **Consequence:** a screen-reader user builds a different, workspace-adjacent mental model of this surface than a sighted player does, and cannot correlate a friend's/streamer's description of "The House panel" with what their AT announces.
- Differential: pure labeling/a11y-IA issue — not a visual bug (sighted users never see "control room" text).
- Confidence: H (source-grepped, appears on all 4 rail control buttons + the mobile opener).
- Fix: Rename every `aria-label`/`title` on the gadget-rail controls from "the control room" to "The House panel" to match the visible header.

**[IA-8] [Severity: Minor] [Effort: <1hr] [Value: Low]**
Onboarding tip misdirects to the wrong location for The House panel
- Where: `index.html:1193` — `'Tip: Tap the House icon at the top of the sidebar to open The House panel.'`
- Problem: **Principle — instructional accuracy / findability.** The House icon does not live in the left nav sidebar (which holds New Chat/Search/Diary Room/Cast) — it lives in the top-right header, outside the sidebar entirely, per every desktop capture (`desktop-03-chat-home.png` etc., "› The House" top right). **Consequence:** a player who reads this tip and looks at "the top of the sidebar" (top-left) will look in the wrong screen region entirely and may conclude the feature doesn't exist.
- Differential: pure copy/IA-accuracy bug — the feature and its real location are both fine; only the tip's spatial description is wrong. Possible it refers to a legacy left-side layout still reachable via the swap control (`gadget-rail-swap`), which would make the tip conditionally true only after a manual side-swap — but that's not the default state shown in any capture.
- Confidence: M (confirmed against default-layout captures only; can't rule out this tip is accurate post-swap).
- Fix: Correct the tip copy to say "top-right of the chat" (or make it dynamically reflect the rail's current side via the same state `syncRailSide` already tracks).

**[IA-9] [Severity: Major] [Effort: <1day] [Value: High]**
Stacked cards above the composer are visually undifferentiated by type
- Where: `desktop-03-chat-home.png` (comp-round decision card + "Welcome to the house" tutorial card, both mounted, identical rounded-rectangle gray style, composer placeholder bleeding through behind); `desktop-17-toast-f05.png` (three cards stacked: comp-round decision, welcome tutorial, "The house stirs" toast).
- Problem: **Principle — visual hierarchy as an IA concern (progressive disclosure / task differentiation).** Three fundamentally different card TYPES — a binding decision requiring action, a one-time onboarding tutorial, and an ambient toast notification — render in the identical visual "chrome" (same card shape, same gray fill, same dismiss "×"). **Consequence:** the player cannot tell, at a glance, which of the stacked cards is blocking/actionable versus safely dismissable/ambient — this is exactly the "where do I need to act right now" wayfinding question the lens is charged to test, and the UI gives no visual answer.
- Differential: this could be read as a visual-design/motion issue, but the core failure is structural — there is no card-kind taxonomy expressed in the UI (no color-coding, iconography, or z-order convention distinguishing "decision" from "toast" from "tutorial"), which is an IA/labeling problem, not just aesthetics.
- Confidence: H (2 independent captures, 2 and 3 simultaneous cards respectively).
- Fix: Give each card kind (decision / toast / tutorial) a distinct visual treatment (e.g. decision cards get a colored left-rail accent + a persistent "action needed" icon; toasts auto-dismiss and sit visually "lighter"/smaller; tutorials get a distinct icon already partly present via emoji headers) and cap simultaneous stacking (queue toasts behind decisions).

**[IA-10] [Severity: Minor] [Effort: <1hr] [Value: Med]**
Toast "The house stirs" has no information content
- Where: `desktop-17-toast-f05.png` (and full filmstrip `desktop-17-toast-f00..f11`).
- Problem: **Principle — information scent.** A toast exists to tell the player something changed; this one carries a title only, no houseguest name, no location, no reason. **Consequence:** the player learns "something happened" with zero actionable content, which trains them to ignore future toasts (habituation) — undermining the entire notification channel for real events later.
- Differential: could be a capture artifact (subtitle text failed to load in this specific run) rather than the shipped copy; the toast may normally carry a body line the filmstrip's timing missed.
- Confidence: L-M (single toast instance observed; not cross-checked against toast source for body-text logic).
- Fix: Verify `orwellNotice.js`/toast call-sites always pass a concrete body (who/where/what); if "The house stirs" is a genuine catch-all fallback, replace it with something the player can act on or suppress the toast when no specific content is available.

**[IA-11] [Severity: Major] [Effort: <1hr] [Value: High]**
"Your Deals" gadget can silently degrade to indistinguishable generic labels
- Where: `desktop-05-gadget-deals.png` / `mobile-05-gadget-deals.png` — three rows all read "A houseguest" ("A houseguest · FINAL-2 · ACTIVE", "A houseguest · ACTIVE PROTECTION", "A houseguest · ACTIVE INFORMATION"); confirmed fallback in `frontend/static/js/orwellDeals.js:115`: `return (them && them.name) || "A houseguest";`.
- Problem: **Principle — labeling/identifiability, tied directly to the vision brief's explicit ask ("alliances/deals" must be findable and legible).** The Deals gadget is the ONE surface whose entire purpose is "who do I have deals with" — and its data model has a silent fallback path that replaces every houseguest's name with the same generic string when `them.name` is absent, with no visual distinction from a correctly-populated row. **Consequence:** if this fallback ever fires in live play (malformed/partial deal record, a not-yet-hydrated NPC reference, a race on load), the player sees three "deals" they cannot tell apart or act on, and nothing in the UI signals that data is missing — it reads as a legitimate, if oddly worded, deal list.
- Differential: the specific capture is very likely a fixture/seed issue (deals synthesized for the screenshot without attached name data) rather than a live bug — but the fallback's silent, no-error-affordance nature is a genuine, source-confirmed design gap independent of whether this exact capture reflects live play.
- Confidence: M (fixture artifact likely for THIS capture; the underlying fallback design gap is H-confidence, source-verified).
- Fix: Treat a missing `them.name` as an error/loading state (e.g. a skeleton row or a "(unknown — refreshing)" label distinct from a normal deal row) rather than silently rendering plausible-looking placeholder text.

**[IA-12] [Severity: Minor] [Effort: <1day] [Value: Med]**
No dedicated "Alliances" surface — only "Your Deals" exists for the player
- Where: `frontend/static/js/orwellElements.js:207` (`{ id: "ek-g-alliances", title: "Alliances", collapsible: true }` — found ONLY in the internal element-kit demo page, `element_kit_demo.html`); the live `REGISTRY` in `orwellGadgetRail.js:43-52` has no `orwell-alliances` entry, only `orwell-deals` ("Your Deals").
- Problem: **Principle — findability against the vision brief's own vocabulary.** The lens brief and vision brief both name "alliances/deals" as a single concept the player needs to find; in the shipped product only "Deals" exists as a real, dockable gadget — "Alliances" is demo-kit vocabulary that never became a player-facing surface (and per orwellElements.js's own comment describing the demo kit, the REAL gadgets are "House Status · Your Deals · Where You Are · Nightfall · Cast" — Alliances is not in that list). **Consequence:** if the game's social-play model tracks anything alliance-shaped beyond bilateral deals (blocs, per CLAUDE.md's `src/engine/blocs.ts`), the player may have no dedicated place to see it, forcing them to infer alliance structure purely from chat scrollback — which may be intentional (I8: "the feelings are yours") but is worth an explicit product call, not a silent gap.
- Differential: this borders product-gaps territory (a missing surface) rather than pure IA, but it's included here because the ASK was specifically "is findability of alliances/deals" satisfied — and the answer is "only partially, under a different name."
- Confidence: M (source-confirmed the naming/registry gap; not confirmed whether blocs data has ANY player-facing surface at all — that's the product-gaps lens's territory).
- Fix: If blocs/alliance data is meant to stay purely inferential (a legitimate design choice under I8), rename any remaining "Alliances" references in dev-facing docs/demo kit to avoid implying a shipped surface that doesn't exist; if it's meant to be visible, promote "Your Deals" to also show grouped/bloc context or add the gadget for real.

**[IA-13] [Severity: Minor] [Effort: <1hr] [Value: Low]**
Retrospective/Season-Recap gadget has 3 different display names
- Where: `orwellGadgetRail.js:51` (`{ id: "orwell-retro", ... title: "Season Recap", order: 8 }` — this is the collapsed-strip tooltip/aria-label); the docked gadget's internal id is `orwell-retro`; the actual opened window in `desktop-23-retrospective.png` is titled **"The Season, Watched Back."**
- Problem: **Principle — recognition over recall / naming consistency.** A player who collapses the rail to its icon strip and later wants to reopen the retrospective must recognize "Season Recap" (the tooltip they'd hover) as the same feature that, once opened, calls itself "The Season, Watched Back" — two names sharing no words in common. **Consequence:** minor but real recall friction — the player learns the feature under one name and must re-learn it under another the moment they open it.
- Differential: pure labeling inconsistency; the feature itself functions correctly.
- Confidence: H (source + screenshot both confirmed).
- Fix: Pick one name (the more evocative "The Season, Watched Back" is the better in-fiction choice) and use it consistently in the registry title / tooltip / aria-label as well as the window title.

**[IA-14] [Severity: Minor] [Effort: <1hr] [Value: Med]**
The top-center "Week 1" pill is a free-text, renameable chat title, not live HUD state
- Where: `frontend/static/app.js:298-409` (`_renameCurrentConversation`, wired to the pencil icon `#topbar-rename-btn` AND a click on the title text itself, `#current-meta`); visually: `desktop-03-chat-home.png` top-center pill "Week 1 [pencil icon]".
- Problem: **Principle — affordance-matches-function (don't let a control look like state if it's actually input).** The single most prominent, top-and-center label in the whole app — the one a player would naturally treat as "which week am I in" — is architecturally the workspace's generic conversation-title field, complete with an inline-rename affordance (pencil + click-to-edit). **Consequence:** a player can rename "Week 1" to anything (or it could silently fail to auto-resync after being manually edited, depending on implementation details not visible in these captures), turning the app's most visible orientation cue into an unreliable, user-mutable label rather than a guaranteed live readout — undermining trust in the ONE thing at the top of the screen.
- Differential: mitigated by redundancy — the right-rail HUD ALSO shows "Week 1 · Veto Competition" independently, so a renamed title pill wouldn't strand the player entirely. The severity is about affordance-mismatch (a HUD-looking element that's actually a text field), not total information loss.
- Confidence: H for the mechanism (source-confirmed rename wiring on this exact element); M for whether a user-rename would ever desync from the true week (not tested live).
- Fix: Either stop rendering the live week number inside the renameable title field (move "Week N" to a read-only badge beside it) or re-derive/overwrite the title from game state every time the week advances regardless of prior manual edits, and communicate that on rename ("renaming won't affect week tracking").

**[IA-15] [Severity: Minor] [Effort: <1hr] [Value: Low]**
Three near-identical labels for cast-roster surfaces
- Where: sidebar nav "Cast" (`index.html`), gadget/window title "The Cast" (`orwellGadgetRail.js` REGISTRY id `orwell-cast`), compact mode "Pinned Cast" (`orwell-cast-pin`).
- Problem: **Principle — naming distinctiveness.** "Cast," "The Cast," and "Pinned Cast" are similar enough that a player skimming the WINDOWS dock or sidebar can't immediately tell whether they're the same surface in different states or three different surfaces.
- Differential: lower severity than IA-13 because at least "Pinned" clearly signals a variant; this is a minor recognition tax, not a functional dead-end.
- Confidence: M.
- Fix: Consider "Cast" (nav entry) → "The Cast" (full window) → "Cast (compact)" for the pinned mode, making the relationship explicit in the label itself.

**[IA-16] [Severity: Minor] [Effort: <1hr] [Value: Low]**
"Compact pin" button doesn't describe its action or resulting state
- Where: `desktop-04-gadget-rail-docked.png` — "📌 Compact pin" button top-right of "The Cast" window.
- Problem: **Principle — label = verb + object clarity.** "Compact pin" reads as a noun phrase, not an action; a first-time player can't predict what clicking it does (collapse this window into the rail as a smaller gadget) versus, say, pinning the current view.
- Differential: minor copy nit, not structural.
- Confidence: M.
- Fix: Relabel to a clear verb phrase, e.g. "Dock as compact" or "Pin to rail (compact)."

**[IA-17] [Severity: Major] [Effort: <1day] [Value: Med]**
Settings modal shows no visible tab indicator on mobile
- Where: `mobile-14-settings-open.png`, `mobile-15-settings-appearance.png`, `mobile-15-settings-account.png`, `mobile-15-settings-shortcuts.png` — none of the 4 mobile settings captures show the Appearance/Shortcuts/Account tab rail visible on-screen; each shows only body content, cropped at the top edge mid-section (e.g. "...Show <think> collapsible bars" cut off at the very top in the Appearance capture).
- Problem: **Principle — "where am I" within a sub-navigation.** Desktop shows a persistent left-hand tab list inside Settings (`desktop-14/15-*.png`) that disappears from view entirely on mobile in every capture taken. **Consequence:** a mobile player cannot see which Settings section they're in, nor discover the other two sections exist, without first scrolling in a direction that happens to reveal the tab control (if it exists at all in the mobile layout — unconfirmed).
- Differential: could be a capture-timing artifact (the screenshot was taken mid-scroll after tapping a tab, with the tab rail scrolled out of the viewport above), rather than the tab rail being genuinely absent from the mobile layout. Needs a live mobile pass scrolled to the top of the Settings modal to confirm whether the tab rail exists at all pre-scroll.
- Confidence: M (consistent absence across 4 independent captures raises real suspicion, but scroll-position artifacts can't be ruled out from stills alone).
- Fix: Verify live; if the tab rail is genuinely mobile-hidden or scrolls away, add a persistent (sticky) mobile tab strip or a compact segmented control fixed under the "Settings" titlebar.

**[IA-18] [Severity: Minor] [Effort: <1hr] [Value: Low]**
"Peek" control has no explanatory label
- Where: `desktop-14-settings-open.png` (titlebar, top-right, next to Settings' close dot); `frontend/static/js/settings.js:23,129-160` (code comments confirm Peek sets window opacity to 55% — "Peek is NOT a window control — it has no macOS traffic-light analog").
- Problem: **Principle — information scent.** "Peek" alone, with no icon differentiation beyond a small eye glyph and no tooltip captured, doesn't communicate "make this window translucent so you can see the chat behind it" — a genuinely useful feature (letting the player glance at ongoing chat while Settings is open, honoring "the conversation is the game") that's undiscoverable by its label alone.
- Differential: minor, and the feature's INTENT (respecting the chat-primacy principle) is actually well-aligned with the vision — this is purely a labeling/affordance clarity gap, not a design-intent problem.
- Confidence: M (comment-confirmed function; tooltip text on hover not captured in stills).
- Fix: Add a tooltip ("Peek at the house behind this window") or a slightly more descriptive label/icon pairing.

**[IA-19] [Severity: Minor] [Effort: <1hr] [Value: Low]**
"Reset window positions" vs. disabled "Reset All" — scope unstated
- Where: `desktop-14-settings-open.png`, Appearance tab, "Reset window positions" (active) beside a grayed-out "Reset All".
- Problem: **Principle — label completeness.** Neither button states its scope: does "Reset All" reset all settings, all window positions, or everything including theme/account? Since it's disabled with no visible explanation of when it becomes enabled, the player has no way to build a correct model of what these two controls do relative to each other.
- Differential: minor — likely just needs a tooltip/subtext, not a structural change.
- Confidence: M.
- Fix: Add one-line subtext under the pair (e.g., "Reset All restores every Appearance setting to default") and/or a disabled-state tooltip explaining why it's inactive.

**[IA-20] [Severity: Minor] [Effort: <1hr] [Value: Med]**
Settings > Account shows the player's identity as "Unknown / User"
- Where: `desktop-15-settings-account.png` — Account section shows a "?" avatar, "Unknown", "User", and a version string "v11.62".
- Problem: **Principle — the system should reflect the player's own established identity.** By the time a player reaches mid-game (Week 1, Veto phase, an active houseguest persona already exists per the HUD), Settings > Account still shows a generic "Unknown/User" placeholder rather than the player's chosen in-house identity or account handle. **Consequence:** this reads as a broken/half-configured account, seeding doubt about whether progress is actually being saved to "them" — a trust concern at exactly the surface (Account) meant to reassure the player their save is theirs.
- Differential: could be an artifact of the deterministic/guest test account used for telemetry capture (no real login name set) rather than a genuine defect for a real logged-in user.
- Confidence: L-M (plausible test-fixture artifact; worth a live check with a named account).
- Fix: Verify with a real registered account; if "Unknown/User" can appear for genuine players (e.g., guest mode), give it fiction-appropriate copy ("Guest producer" or similar) rather than a bare placeholder.

**[IA-21] [Severity: Minor] [Effort: <1hr] [Value: Low]**
Sidebar nav shows no active/current-state styling
- Where: `desktop-16-diary-room.png` — the player is actively in Diary Room mode (banner visible, composer placeholder changed to "Tell the producers what you're really thinking..."), yet the "Diary Room" sidebar nav item shows no highlighted/active/selected visual state distinguishing it from "New Chat"/"Search"/"Cast".
- Problem: **Principle — "where am I" via navigation state.** A well-formed nav answers "where am I" by highlighting the current location; here it never does, for any of the 4 nav items, across any capture. **Consequence:** minor, since the Diary Room banner itself already communicates the mode — but it means the nav can never be trusted as a location indicator, forcing reliance solely on transient banners/cards.
- Differential: consistency/visual-state gap, not a functional bug.
- Confidence: H (absence confirmed across every capture where Diary Room is active).
- Fix: Add an active-state style (background tint / left-accent bar) to whichever nav item corresponds to the current mode.

**[IA-22] [Severity: Major] [Effort: <1day] [Value: High]**
Error-state copy mixes diegetic and technical registers in the same view
- Where: `desktop-25-error-engine-down.png` — top banner: "Big Brother engine unavailable. / The app couldn't reach the game service. The show can't load until it's back." directly above a card reading "The house is dark / Big Brother will return. The game engine isn't reachable right now — this screen will clear the moment the feeds come back."
- Problem: **Principle — tonal consistency (I9, "no engine/tool/app/system talk in anything the player sees").** In a single screen, the word "engine" appears twice, "game service" once, alongside deliberately in-fiction phrasing ("The house is dark," "Big Brother will return," "the feeds come back"). **Consequence:** exactly the moment a player is most anxious (something's broken) is also the moment the product breaks its own fictional frame hardest and least consistently — half the copy commits to the bit, half doesn't, which reads as more jarring than either a fully technical OR fully in-fiction message would.
- Differential: this reads as an intentional design choice (banner = system-level "for real," card = softened in-fiction restatement) but the execution keeps reusing the same broken words ("engine," "game service") in BOTH registers, defeating the separation's purpose.
- Confidence: H (both strings directly quoted from the same screenshot).
- Fix: Fully commit the top banner to production-adjacent in-fiction language too (e.g. "Production lost the feed. / We're working to get the cameras back — the house isn't going anywhere.") so there is no register-switching within one screen; reserve raw technical wording for a collapsed "details" affordance only, if needed for support purposes.

**[IA-23] [Severity: Major] [Effort: <1hr] [Value: High]**
Mid-turn send failure reverts to raw CLI framing
- Where: `desktop-27-send-fail-final.png` — window title reads "Orwell Chat · 2 msgs" (not "Week 1" or any game framing); system message: "No chat session active. You can: • Use `/help` to see all available commands."
- Problem: **Principle — consistency across error paths + I9.** The boot-time engine-down state (IA-22) at least ATTEMPTS in-fiction framing; this mid-session failure path abandons it completely — "chat session," "/help," "available commands" is unfiltered developer/CLI vocabulary presented as the game's own voice, at the single most fragile moment (an in-flight message that failed to send, tagged "NOT SENT").
- Differential: distinct from IA-22 — different error path (mid-turn send failure vs. boot-time engine-down), and notably WORSE in fidelity, showing these two error surfaces were not built to a shared standard.
- Confidence: H.
- Fix: Route this failure state through the same in-fiction copy system used for the engine-down card (e.g. "Production lost that one — try again" + a retry affordance on the failed bubble itself), and never surface "/help ... commands" language to the player.

**[IA-24] [Severity: Minor] [Effort: <1hr] [Value: Low]**
"Go in anyway" has no stated consequence
- Where: `desktop-25-error-engine-down.png` — the "Go in anyway" button beside "The house is dark" card.
- Problem: **Principle — predictability of action outcome.** The player can't tell what "in anyway" means when the engine is confirmed unreachable — will the composer accept input that's silently dropped? Does it just dismiss the card cosmetically?
- Differential: minor — likely a deliberate escape hatch for a stuck state, but its result is unexplained.
- Confidence: L (no follow-up capture shows the result of clicking it).
- Fix: Add one line of consequence copy ("You can look around, but nothing will happen until the feeds return") or remove the option if it truly does nothing useful.

**[IA-25] [Severity: Minor] [Effort: <1day] [Value: Med]**
Empty-state placeholder appears to coexist with mid-game state on mobile
- Where: `mobile-03-chat-home.png` — shows "Type /setup to get started" + "Production needs a feed source — connect a model in Settings and the house comes alive" as background/watermark text, in the SAME capture session where the desktop equivalent (`desktop-03-chat-home.png`) shows an active Week-1 Veto-phase game with real messages and a decision card. MANIFEST's own anomaly notes flag this overlap independently.
- Problem: **Principle — state truthfulness.** If a player ever sees "Production needs a feed source" while their own status HUD (once found, per IA-6) shows an active HOH/noms/veto week, that is a direct contradiction about whether the game/model is configured at all — a severe mental-model risk if genuine.
- Differential: most likely a capture-timing issue (mobile chat history/messages hadn't finished loading/rendering at the moment of screenshot, so the static HTML fallback placeholder was still visible underneath), not a structural bug — this is the same root cause as the MANIFEST's noted "Welcome card overlaps composer placeholder" issue on desktop, just more visible on the narrower mobile layout.
- Confidence: L-M (plausible race/timing artifact; cannot confirm without a live re-drive with explicit wait-for-messages-loaded).
- Fix: Ensure the empty-state placeholder is hidden (not just visually behind) the moment ANY chat history exists for the session, and verify this race doesn't occur on slower mobile connections in live use.

**[IA-26] [Severity: Minor] [Effort: <1day] [Value: Med]**
Diary Room has no dedicated exit control
- Where: `desktop-16-diary-room.png`, `mobile-14-settings-open.png` (Diary Room banner visible behind the Settings modal) — the Diary Room mode banner ("📔 Diary Room — private & out-of-character; the house never hears this.") has only a generic "×" dismiss, identical in style to the dismiss on the unrelated "Welcome to the house" tutorial card.
- Problem: **Principle — reversibility/"how do I get back."** Entering Diary Room changes the composer's placeholder and target channel (a genuine MODE change, per CLAUDE.md's OOC/player-level channel model); exiting it uses the exact same generic "×" glyph as dismissing an unrelated onboarding tip, giving the player no distinct signal that clicking it will change WHERE their next message goes (back to in-character chat) versus just clearing a notice.
- Differential: a functional exit likely exists (the "×" probably does work) — this is a labeling/distinctiveness issue, not a dead end.
- Confidence: M (inferred from visual consistency of the "×" glyph across unrelated card types; not confirmed whether a different, explicit "Exit Diary Room" affordance exists elsewhere e.g. re-clicking the sidebar "Diary Room" item).
- Fix: Give the Diary Room banner's dismiss a distinct label/verb ("Leave the Diary Room") rather than a bare "×", so leaving a channel-changing mode reads differently than dismissing a tip.

**[IA-27] [Severity: Minor] [Effort: <1hr] [Value: Low]**
Cast window pagination is unlabeled dots only
- Where: `desktop-04-gadget-rail-docked.png`, `mobile-07-gadget-cast.png` — "○ ○ ○ ○" beneath the 2x2 portrait grid, no page numbers, no jump-to-letter/name, no search.
- Problem: **Principle — findability at scale.** With 16 houseguests (per HUD "16/16") split across what these dots imply are 4 pages of 4, a player trying to find one specific person (e.g. to check "who am I nominating") must page through blindly with no name-based shortcut.
- Differential: minor at 16 entries; would become a bigger issue if cast size ever grows, but is already a real "how do I find X" friction today.
- Confidence: M (dot count inferred from 4 visible dots in the capture, consistent with 16÷4=4 pages of 4).
- Fix: Add a lightweight search/filter or at least numbered pagination ("1 / 4") so the player can orient within the roster.

**[IA-28] [Severity: Minor] [Effort: <1hr] [Value: Low]**
Theme picker is fragmented across two disconnected surfaces
- Where: standalone "Theme" window (`desktop-12-theme-window.png`, with its own "Themes"/"Customize" tabs and 16-swatch grid) vs. Settings > Appearance > Sidebar > "Theme" toggle (`desktop-14-settings-open.png`, a simple on/off switch).
- Problem: **Principle — single source of truth for a given setting.** A player who wants to change their theme has two same-named entry points that do different things (one is an on/off switch of unclear scope — "Theme" toggle, presumably showing/hiding a theme element in the sidebar — the other is the actual theme-swapping UI), with no link or cross-reference between them.
- Differential: could be legitimate (the Settings toggle governs "show theme swatches in the sidebar" as a distinct, smaller feature from the full Theme window) — but nothing in the UI clarifies that distinction, so the ambiguity itself is the finding regardless of the toggle's true purpose.
- Confidence: M (both surfaces source/screenshot-confirmed; their exact functional relationship inferred, not verified interactively).
- Fix: Add a "Customize theme →" link from the Settings toggle's row into the standalone Theme window (or vice versa), and label the toggle to clarify it's not itself the theme picker.

**[IA-29] [Severity: Polish] [Effort: <1hr] [Value: Low]**
16 themes with no categorization or search
- Where: `desktop-12-theme-window.png` — "Show all themes (16)" expands to presumably 16 unlabeled-by-category swatches beyond the 6 defaults shown (glass, the feed, telescreen, room 101, memory wall, sequester).
- Problem: **Principle — findability at moderate list length.** 16 is past the point where a flat list without search/filter/grouping stays easy to scan, especially with only a 3-dot color chip + name to differentiate each.
- Differential: cosmetic-adjacent; genuinely low stakes since theme choice is non-blocking and reversible.
- Confidence: L (didn't observe the full 16-theme expanded view; the 6-default row IS well-organized and in-fiction-named, which is a positive).
- Fix: Optional — add a simple text filter if 16 becomes noticeably more with future themes.

**[IA-30] [Severity: Minor] [Effort: <1hr] [Value: Med]**
Status HUD's expand affordance ("Week 1 Veto Competition ▼") is never explored in any capture
- Where: `desktop-06-gadget-status.png` and every other HUD-visible capture — the "▼" chevron beside "Week 1 Veto Competition" never appears in an expanded state in any of the 218 captured artifacts.
- Problem: **Principle — discoverable affordance / information scent.** A visible chevron implies "there's more here" (e.g. a week-by-week history, or expanded ceremony detail) but nothing in the telemetry set shows what it reveals, meaning either (a) it's a genuinely useful piece of history/detail nobody happened to click during capture, or (b) it's a decorative/non-functional chevron that misleads the player into expecting expandable content that isn't there.
- Differential: cannot be resolved from stills alone — needs a live click-through.
- Confidence: L (absence of evidence, not evidence of absence).
- Fix: Verify live; if it opens a genuinely useful past-weeks history, that's good design worth confirming works well; if it's inert, remove the chevron (a false affordance is worse than no affordance).

**[IA-31] [Severity: Minor] [Effort: <1hr] [Value: Low]**
"The House · 16/16" tally has no legend
- Where: `desktop-06-gadget-status.png`; source `orwellStatusPanel.js:452` (`headEl.textContent = "The House · " + activeCount + "/" + total;`).
- Problem: **Principle — label completeness.** "16/16" alone doesn't say whether this counts active-vs-evicted houseguests, includes the player, or something else — a new player has to infer the meaning from context (Week 1, nobody evicted yet) rather than the label stating it.
- Differential: low-severity since context (Week 1, full house) makes the correct inference easy on THIS specific screen; would matter more mid-season when the ratio changes and needs to be unambiguous.
- Confidence: M.
- Fix: A hover tooltip or adjacent microcopy ("16 still in the house, out of 16 total") would remove any inference burden, especially important once the denominator starts shrinking after evictions.

**[IA-32] [Severity: Minor] [Effort: <1day] [Value: Med]**
Overlapping windows show no focus/z-order cue
- Where: `desktop-07-gadget-cast.png` / `desktop-08-gadget-finale.png` — "The Cast" (frontmost, red/yellow/green traffic lights) fully overlaps "The Finale" (only its titlebar visible, gray/hollow traffic lights) with no drop-shadow separation, dimming, or other depth cue beyond the traffic-light color difference (which is easy to miss).
- Problem: **Principle — spatial/z-order legibility.** In a multi-window system, the player needs to know at a glance which window is "on top"/active. Here the only cue is a subtle traffic-light color state, which is a weak, easy-to-miss signal compared to a shadow or dim-out of the background window.
- Differential: minor — the ordering IS technically legible via the traffic lights on close inspection, this is about strength of signal, not absence.
- Confidence: M.
- Fix: Add a stronger visual weight difference (drop shadow on the focused window, slight opacity reduction on background windows) beyond the traffic-light color change.

**[IA-33] [Severity: Minor] [Effort: <1hr] [Value: Low]**
Gadget-rail "rearrange" icon reads as a generic grid/launcher glyph
- Where: `index.html:1459` — 6-dot grid icon (2 columns x 3 rows), `aria-label="Rearrange gadgets"`.
- Problem: **Principle — icon-language match.** A 6-dot grid is a very common "app launcher/more apps" icon in other products (e.g. Google's "waffle" menu); here it means "drag to reorder" — a different, less common convention (usually shown as a vertical 6-dot "grip" in a single column, or explicit up/down arrows).
- Differential: minor, mitigated by the text `title`/`aria-label` being correct — a sighted mouse-hovering user will get the tooltip; the risk is purely for at-a-glance icon scanning without hovering.
- Confidence: L.
- Fix: Consider a more conventional "drag handle" glyph (vertical dots in a column, or a hamburger-style grip) if user testing shows confusion.

**[IA-34] [Severity: Polish] [Effort: <1hr] [Value: Low]**
Mobile top title truncates to unreadable "W…"
- Where: `mobile-24-full-app.png` — top-center pill reads "W…  · 3 msgs" instead of "Week 1 · 3 msgs".
- Problem: **Principle — legibility of the primary orientation cue on the smallest viewport.** The one thing this pill exists to communicate (which week) is the first thing truncated away when space is tight, while the secondary "· 3 msgs" (itself workspace vocabulary, not game-relevant) survives intact.
- Differential: straightforward responsive-truncation-order bug — not a deeper IA issue, but it inverts priority (secondary info survives, primary info truncates).
- Confidence: H (directly visible in the capture).
- Fix: Truncate/drop "· N msgs" before ever truncating "Week N" — reorder the priority so the game-relevant label is the last thing to be cut, or drop the message-count suffix entirely on narrow viewports (it's workspace vocabulary with no game meaning regardless).

---

## Mental-model risks (cross-cutting)

- **Who holds power right now?** IA-4 + IA-14 compound: the one place the player should always be able to trust ("HOH: Vincent Campos") sits beside decision-card copy that can claim the opposite ("As Head of Household, [you]...") and beside a renameable title pill that LOOKS like it's tracking the week live but is architecturally a text field. If any of these three ever drift, the player has no tiebreaker.
- **Is the game even configured?** IA-25: the empty-state "connect a model in Settings" copy and an active mid-game HUD have been observed (likely via capture timing) to coexist on mobile in the same session — if this ever happens live even briefly, a player would reasonably conclude their game isn't running at all.
- **Where do I go to change things about MY game vs. the app?** IA-1/IA-2/IA-3: "New Chat"/"Search" in the nav, "Select model" pinned by the composer, and workspace shortcuts in Settings all suggest this is a general chat tool the player is configuring, rather than a season of Big Brother they're playing — undermining "the conversation is the game" at the exact structural layer (navigation + settings) meant to stay invisible per I9.
- **What's hidden vs. known (the Vault Wall's legibility)?** Not directly tested by this lens's evidence set (no capture shows a "you sense something's off" cue), but worth flagging: none of the 218 captures show any UI treatment that helps the player distinguish "things I've directly witnessed" from "rumors/suspicions" — the chat stream renders all narration in one visual register. This is plausibly by design (I8: "the feelings are yours," inference should be the player's own work) — flagged here as a risk to confirm with the product-spirit/social-game lenses rather than a definitive IA defect.

## Top 3 launch-blocking (if confirmed live)

1. **IA-4** — decision-card vs. HUD power-holder contradiction, IF reproducible outside the capture harness (would be a Blocker: breaks I2/I10's core promise that the engine's state is singular and trustworthy).
2. **IA-6** — mobile HUD has no adequately discoverable entry point (would fail the ship-gate's mobile-parity bar for the single most-used HUD surface on the platform most players will use).
3. **IA-23** — mid-turn send failure reverts to raw CLI/"chat session"/"/help" language (a concrete, reproducible I9 violation at a real, expected failure path — not an edge case).
