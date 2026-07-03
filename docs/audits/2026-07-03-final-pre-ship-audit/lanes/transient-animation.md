# TRANSIENT & ANIMATED-CORRECTNESS LANE — Exhaustive findings (audit v2)

Lens: motion/lifecycle, not single frames. Every finding cross-checks the filmstrip against the
DOM-mutation log. Telemetry root: `scratchpad/audit2/telemetry/`. Two capture sets: the
deterministic `desktop-*/mobile-*` bursts (+`*.dom.json`) and the `filmstrips/`+`logs/` set.

## INDEX

| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| TRANS-1 | Major | <1day | High | Premiere/welcome card never auto-retracts; persists through live play & streaming | orwellPremiereTutorial.js:192-209 |
| TRANS-2 | Major | <1day | High | Notice-zone stacks up to 3 anchored cards over composer; none auto-dismiss | orwellNotice.js:490-620 / notice-zone |
| TRANS-3 | Major | <1day | High | Setup/empty splash bleeds through behind live game cards (chat empty + game active) | chatRenderer.js:1218-1227 |
| TRANS-4 | Major | <1day | High | Engine-down "house is dark" leaks setup splash + "Orwell Chat" title + doubled H1 | desktop-25-error-engine-down.png |
| TRANS-5 | Major | <1day | High | Player turns render NO reply and NO thinking placeholder (corroborates prior blocker) | seq-chat/seq-gadget-rail filmstrips |
| TRANS-6 | Minor | <1hr | Med | Notices default `autoDismissMs:0` — a "toast" beat never dismisses (16s+) | orwellNotice.js:500 |
| TRANS-7 | Minor | <1day | Med | Composer + anchored card jump vertically during first streaming turn | desktop-18-streaming f00→f02 |
| TRANS-8 | Minor | <1day | Med | Streaming replaces the whole message body node each delta (~50×) | desktop-18-streaming.dom.json |
| TRANS-9 | Minor | <1hr | Med | Scroll-to-bottom unread badge class thrashes 106× during ONE streaming reply | orwellScrollBottom.js:160-206 |
| TRANS-10 | Minor | <1hr | Med | Window title flashes "· refreshing" (no fade, aria-live) on every instant poll | orwellWindow.js:1116-1131 |
| TRANS-11 | Minor | <1day | Med | 1 Hz forever setInterval + continuous inline-style thrash on ~40 hidden workspace nodes | modalManager.js:782 |
| TRANS-12 | Minor | <1day | High | Nomination ceremony uses the generic 220ms notice fade — no set-piece reveal weight | orwellSheet.js:194-196 |
| TRANS-13 | Minor | <1hr | Med | Retrospective window opens overlapping the status gadget + player's own bubble | desktop-23-retrospective.png |
| TRANS-14 | Minor | <1hr | Med | New-season reveal opens as a rail panel overlapping "Where You Are" gadget | desktop-22-new-season.png |
| TRANS-15 | Minor | <1day | Med | Ambient background drifts perpetually even with frozen content (reduced-motion?) | casting f06 vs f20 |
| TRANS-16 | Minor | <1day | High | Mobile: welcome + nomination cards both stack, pushing composer off-screen | mobile-09-decision-nominations.png |
| TRANS-17 | Minor | <1hr | Med | Send-fail reply is workspace-generic "No chat session active / /help" | desktop-27-send-fail-final.png |
| TRANS-18 | Minor | <1hr | Low | Casting: 3 near-identical replies stack; only one accordion shows a "0.3s" label | seq-casting f06 |
| TRANS-19 | Polish | <1hr | Med | Operator/production cue "[stub-echo] (Production cue…)" leaks into visible bubble | seq-casting f06 |
| TRANS-20 | Polish | <1hr | Med | "0 of 15 met" accent counter reads like an unmet-requirement error badge | desktop-08/status gadget |
| TRANS-21 | Polish | <1hr | Low | Theme window opens offset-left, not centered; scrim half-covers gadgets | desktop-12b-theme-open |
| TRANS-22 | Polish | <1hr | Low | Theme-open churns BODY.welcome-ready (remove→add ×2) + rebuilds dock rows | desktop-12b-theme-open.dom.json |
| TRANS-23 | Polish | <1hr | Low | Confirm button only un-greys on select — no enable-emphasis transition | desktop-11-decision-select |
| TRANS-24 | Polish | <1hr | Low | Collapsed gadget rail = two unlabeled icons (clipboard/compass), no tooltip | seq-gadget-rail-collapse f05 |
| TRANS-25 | Latent | <1day | Med | Status HUD (os-week/phase/hoh/noms/veto) re-renders mid-stream — flicker under concurrency | desktop-18-streaming.dom.json t+16272/37308 |
| TRANS-26 | Latent | <1day | Med | Presence panel (opres-here/nearby) rebuilds on each poll during streaming | desktop-18-streaming.dom.json |
| TRANS-27 | Polish | <1hr | Low | "Where You Are" gadget text clipped under retro/new-season windows | desktop-22/23 |
| TRANS-28 | Polish | <1hr | Low | Onboarding-dismiss: welcome card never leaves across the whole "dismiss" strip | desktop-02b-onboarding-dismiss |

---

## FINDINGS (full schema)

### [TRANS-1] [Major] [Effort:<1day] [Value:High]
Premiere "Welcome to the house" card never auto-retracts and floats through live play
- Where: `orwellPremiereTutorial.js:192-209` (`removeTutorial` only fires when the game is NOT in the premiere window); notice-zone anchor above `.chat-input-bar`.
- Problem: In every non-error capture (chat-home, streaming f00-f27, decision-mount, toast, new-season, retro) the "Welcome to the house — premiere week" card stays fully mounted — even mid-scene while Renee is streaming (desktop-18-streaming f02/f05), and even in the season-end/new-season capture (desktop-22). The content-gate treats Week-1 Veto as still "premiere," so it never retires; it just sits anchored above the composer, consuming a third of the chat column and pushing the composer down. Hurts: player (persistent clutter; the marquee first scene shares the screen with an onboarding card), vision (I3 immersion — a tutorial card over a live dramatic beat). Corroborates prior "stale welcome card" but adds the *persist-through-streaming-and-season-end* lifecycle.
- Fix: retire the premiere card the moment the first real player↔houseguest scene renders (or when phase advances past premiere/meet-the-house), not only on a full non-premiere check; animate it out (`ow-sheet-anchored` has no `-out` on this path).

### [TRANS-2] [Major] [Effort:<1day] [Value:High]
Notice-zone accumulates up to three anchored cards over the composer; none auto-dismiss
- Where: `#orwell-notice-zone`; `orwellNotice.js:490-620`; desktop-17-toast f00→f11.
- Problem: The toast capture shows THREE stacked cards simultaneously anchored above the composer — "Competition round — keep pushing" (comp-round decision) + "Welcome to the house" (tutorial) + "The house stirs" (notice). All three remain across the full 16 s strip (dom log: `#tel-toast` class set t+21 & t+1031, no removal through 15960 ms). The zone has no cap and no auto-dismiss, so cards pile up and progressively shrink the chat area / bury the conversation. Hurts: player (cognitive-load spike, composer pushed down), vision (the conversation-is-the-game surface becomes a card graveyard).
- Fix: cap the notice-zone to one card of each kind; give ephemeral beats (`house stirs`) an `autoDismissMs`; collapse the decision + tutorial into a single anchored slot; never let a decision card and a guide card co-anchor.

### [TRANS-3] [Major] [Effort:<1day] [Value:High]
Setup/empty splash ("Type /setup … Production needs a feed source") bleeds through behind live game cards
- Where: `chatRenderer.js:1218-1227` (`hideWelcomeScreen` adds `.hidden` only when a message renders); `#welcome-screen`. Seen in desktop-03, desktop-10 f00, mobile-03, and behind every stacked card.
- Problem: When a game is active (Week-1 Veto) but `#chat-history` holds no bubbles yet, `#welcome-screen` is never hidden, so "⊙ Orwell / Type /setup to get started / Production needs a feed source — connect a model in Settings" renders centered and bleeds through *behind* the welcome + decision cards (visible ghost text at y≈343 in desktop-03/02b/17). Mechanism: the splash is gated on message-render, not on game-active. Hurts: vision hard — a live BB game shows an onboarding "connect a model" placeholder as its backdrop (I3 immersion, C-workspace-leak).
- Fix: when the engine reports a started game, hide `#welcome-screen` regardless of message count (or render a game-framed empty state), not only inside `hideWelcomeScreen` on first bubble.

### [TRANS-4] [Major] [Effort:<1day] [Value:High]
Engine-down state leaks the setup splash, "Orwell Chat" title and a doubled heading through the scrim
- Where: desktop-25-error-engine-down.png / mobile-25.
- Problem: The "The house is dark" holding card is correct copy, but (a) the setup splash "Type /setup … Production needs a feed source" bleeds through *below* it, (b) the chat title reads "Orwell Chat · N msgs" (workspace vocab, not game-framed), (c) the card renders "The house is dark" twice — a small label at y≈145 and the big H1 at y≈200. So the most fragile moment (engine unreachable) is where the most workspace machinery leaks. Hurts: vision/immersion + trust.
- Fix: in the degraded state, hard-hide `#welcome-screen`, set a game-framed document title, and drop the duplicate small heading.

### [TRANS-5] [Major] [Effort:multi-day] [Value:High] (corroborates prior blocker)
Player turns render with no reply AND no thinking placeholder
- Where: `seq-chat-send-stream-settle-02/08/24/27`, `seq-gadget-rail-collapse-00`.
- Problem: Across the chat and gadget-rail sequences the player sends 1-3 messages ("Hey everyone…", "What's everyone's read…", "I'm going to go check out the backyard.") and the reply area stays completely blank through the settle frame — and no "Thinking ▅▄▃" placeholder ever appears during the wait (frame 02/08 are blank, not a spinner). So the empty-narration blocker presents with *no* transient feedback either — the player cannot tell the turn is processing vs dead. Corroborates prior "empty-narration on marquee social turn"; adds: the thinking placeholder is also absent, so there is zero motion covering the gap.
- Fix: (owned by the narration blocker) — but from this lens, guarantee a Thinking placeholder mounts on send and only clears on a real completion footer, so an empty completion is at least visible as a failed beat rather than silence.

### [TRANS-6] [Minor] [Effort:<1hr] [Value:Med]
Notices default to no auto-dismiss, so an ambient beat toast lingers forever
- Where: `orwellNotice.js:500` (`autoDismissMs: 0` default → `_scheduleAutoDismiss` no-ops at :615).
- Problem: "The house stirs" (a transient ambience beat) is created without `autoDismissMs`, so it never self-dismisses (dom: no removal in 16 s). A beat-style toast that reads as an event should fade; a persistent notice with an × should not sit in the composer-anchored zone indefinitely.
- Fix: pass `autoDismissMs` (~4-6 s) for ephemeral house-beat toasts; reserve persistent cards for actionable state.

### [TRANS-7] [Minor] [Effort:<1day] [Value:Med]
Composer + its anchored card jump vertically during the first streaming turn
- Where: desktop-18-streaming f00 (composer y≈550) → f02 (composer y≈810), welcome card drops with it; dom log shows repeated `DIV.chat-input-bar [style]` + `#orwell-scroll-bottom [style]` writes.
- Problem: As Renee's reply streams and the layout settles, the input bar and its anchored welcome card slide ~260 px down the viewport within the first ~500 ms — a visible reflow jerk at the exact moment the player is reading the opening scene. Mechanism: the sheet/notice anchor writes inline styles to `.chat-input-bar` as content height changes.
- Fix: reserve the composer's final anchored geometry before the first stream (measure once), or pin the input bar and let only the scroll region grow.

### [TRANS-8] [Minor] [Effort:<1day] [Value:Med]
Streaming replaces the entire message body node on every delta
- Where: desktop-18-streaming.dom.json — `DIV.body +1 -1` fires ~50× (t+313…t+7015), once per streamed chunk.
- Problem: Each delta tears down and rebuilds the message body child rather than appending, so the full markdown re-parses every frame. Consequences: any in-progress text selection is lost each chunk, long replies get more expensive as they grow, and mid-stream sub-elements (links, spans) never keep identity for a transition. Differential: this is genuine per-delta re-render (add+remove paired at the same ts), not a capture artifact — the pairs are 1:1 with streamed chunks. LATENT because it isn't visibly broken with short deterministic replies, but predicts jank under a long xhigh-latency real-model reply.
- Fix: append/patch the rendered fragment instead of replacing the body node each delta.

### [TRANS-9] [Minor] [Effort:<1hr] [Value:Med]
Scroll-to-bottom unread badge class thrashes 106× during a single streaming reply
- Where: `orwellScrollBottom.js:160-206` (`setBadge` toggles `.osb-has`; a MutationObserver calls `update()` on every chat mutation at :218); desktop-18-streaming.dom.json — `SPAN.osb-badge [class]` ×106.
- Problem: Because `update()` runs on every streamed body mutation, the unread badge's class flips on/off ~106 times across one reply. Even if visually near-stable, it's a per-frame class thrash on a decorative element (the scroll pill's "new messages" dot) — wasted work and a flicker risk if the reader is scrolled up mid-stream.
- Fix: debounce `update()`/`setBadge` (rAF-coalesce) so the badge settles once per animation frame, not once per token.

### [TRANS-10] [Minor] [Effort:<1hr] [Value:Med]
Window titles flash "· refreshing" on every instant poll refresh (sub-frame + SR spam)
- Where: `orwellWindow.js:1116-1131` (`setLoading` appends `.ow-load-hint` "· refreshing", `aria-live=polite`, opacity .55 with NO transition at style :380); dom logs show `SPAN.ow-title +1` then `-1` 17-43 ms later (streaming t+29433/29476, t+31293/31310; decision-select t+10111/10119, t+13310/13324).
- Problem: On the deterministic/local engine the /state refresh completes in ~20-40 ms, so the "· refreshing" hint mounts at full opacity and is removed a frame later — a visible micro-flash in the gadget/window titlebar on every poll cycle. Because it's `aria-live=polite`, each poll also queues "· refreshing" to screen readers → repeated announcements. Differential: real DOM churn (add/remove pair in the log), not a capture gap.
- Fix: only show the hint if the refresh exceeds a threshold (e.g. debounce 150 ms before appending); drop `aria-live` on a decorative refresh hint or make it `off`.

### [TRANS-11] [Minor] [Effort:<1day] [Value:Med]
1 Hz forever-scan + continuous inline-style thrash on ~40 hidden workspace nodes during idle gameplay
- Where: `modalManager.js:782` `const _scanTimer = setInterval(_scanAndWire, 1000)` (never cleared); dom logs across ALL captures show synchronized ~1 s bursts of `INPUT [style]` (×16 per burst, 24 bursts / 16 s) + `#memory-*` / `#skills-*` / `#new-skill-*` `[style]` (×~24 each).
- Problem: During plain gameplay (no interaction) the app runs a 1 Hz DOM scan and re-writes inline styles on ~40 inherited workspace panels (memory search, skills inputs) that aren't part of the game. That is continuous main-thread work + layout thrash for the life of the tab — battery drain on mobile, and a symptom that the full inherited workspace is live behind the game build. Corroborates prior "setInterval leaks×5" with a specific new offender and its observable style-write cadence.
- Fix: clear/park `_scanTimer` when no auto-wire modal is present; gate the memory/skills panel restyle behind visibility; in the game build, don't mount those panels at all.

### [TRANS-12] [Minor] [Effort:<1day] [Value:High]
The nomination ceremony reveals with the generic 220 ms notice fade — no earned set-piece weight
- Where: `orwellSheet.js:194-196` (`ow-sheet-anchored-in .22s` opacity+8px rise — the same entrance every routine notice uses); desktop-10-decision-mount f00→f01 (empty → full card).
- Problem: The "Nomination ceremony — your nominations / IRREVERSIBLE — BINDING" card — a marquee BB set-piece — mounts with the identical gentle 220 ms fade used for any anchored card. There is no gavel/reveal choreography, no staged emphasis; the most consequential binding decision of the week arrives like a form. Differential: reduced-motion IS handled (:198), and the sheet DOES animate (not a silent swap) — so the defect is *insufficient* ceremony, not a missing transition. Vision: reveals must carry earned weight (I-reveal), not pass as a routine card.
- Fix: give ceremony-class decisions a distinct staged reveal (header sting, chip cascade) separate from the routine `ow-sheet-anchored-in`.

### [TRANS-13] [Minor] [Effort:<1hr] [Value:Med]
Retrospective window opens overlapping the status gadget and the player's own bubble
- Where: desktop-23-retrospective.png — "The Season, Watched Back" titlebar (traffic-light dots) sits at y≈75 directly over the "You 02:18 AM" message and the "You / HOH / Noms" status gadget.
- Problem: The post-season retro — a reflective closing beat — opens at a fixed top position that collides with the live chat bubble and the right-rail status panel (z-index stacking, no repositioning to clear them). Reads as a stray window, not a curtain-call.
- Fix: open the retro as a centered, focus-stealing surface (dim the board) rather than a floating window that lands on existing content.

### [TRANS-14] [Minor] [Effort:<1hr] [Value:Med]
New-season reveal opens as a rail-docked panel overlapping the "Where You Are" gadget
- Where: desktop-22-new-season.png — "A New Season" panel renders in the right-rail column at y≈337, overlapping/pushing "Where You Are".
- Problem: Season-end → recast is a headline moment, but it surfaces as a small panel wedged into the gadget rail, overlapping another gadget, while the welcome card and an expanded thinking accordion still occupy the chat. No set-piece framing, and a visible z-collision with the status gadget.
- Fix: present season transition as a dedicated modal/curtain, not a rail gadget; ensure it clears the existing gadgets.

### [TRANS-15] [Minor] [Effort:<1day] [Value:Med]
Ambient background drifts perpetually even when content is frozen — verify reduced-motion
- Where: seq-casting f06 vs f20 (identical chat content, background cycles dark-blue → teal/green → purple); same drift visible across onboarding-dismiss f00-f07 and decision-select f00 (purple wash) vs f03 (blue). Driver: `liquidGlass.js`/`adaptiveGlass.js` continuous re-tint (dom logs show repeated `data-liquid-glass` attribute writes).
- Problem: The full-app "liquid glass" backdrop animates continuously behind a text-reading surface even when nothing in the game changes. Over a 28-frame frozen-content capture the background cycles hues. This is persistent motion behind reading content (fatigue/distraction) and a battery cost; unverified whether it honors `prefers-reduced-motion` (the JS-driven tint sits outside the CSS `@media` guards that cover the discrete animations). Differential: not a capture artifact — two byte-frozen-content frames differ only in backdrop.
- Fix: freeze/dampen the ambient tint when content is idle; ensure the JS glass loop checks `prefers-reduced-motion` and stops (it currently only guards discrete CSS keyframes).

### [TRANS-16] [Minor] [Effort:<1day] [Value:High]
Mobile: welcome + nomination cards both stack, pushing the composer off-screen
- Where: mobile-09-decision-nominations.png (390×844): welcome card fills the top third, the "Nomination ceremony / IRREVERSIBLE — BINDING" card fills the rest, composer at the very bottom edge.
- Problem: On a phone the player must scroll past the whole tutorial card to reach the binding nomination card, and the "Confirm — this is binding" CTA sits near the fold. Two co-anchored cards on 390 px is a severe cognitive-load + reachability problem for the single most important action. Ties to TRANS-2 (stacking) but is materially worse on mobile.
- Fix: on narrow viewports, suppress the tutorial card whenever a binding decision is present; show one card at a time.

### [TRANS-17] [Minor] [Effort:<1hr] [Value:Med]
Send-fail AI response is workspace-generic, breaking game framing
- Where: desktop-27-send-fail-final.png — after a failed send the reply reads "No chat session active. You can: Use `/help` to see all available commands."
- Problem: The player-facing failure text is inherited workspace copy (`/help`, "No chat session active"), not a game-framed message. The "NOT SENT" badge on the player bubble is good; the AImessage is off-world. Immersion break at an error moment.
- Fix: game-frame the no-session/failure reply (e.g. "The feed dropped — production is reconnecting…") and drop `/help`.

### [TRANS-18] [Minor] [Effort:<1hr] [Value:Low]
Casting: three near-identical replies stack; only one thinking accordion shows a timing label
- Where: seq-casting f06/f20 — three "Orwell 02:21 AM" bubbles, each with a "View thinking process" accordion; the middle one shows "0.3s", the others don't.
- Problem: Inconsistent thinking-accordion metadata (a duration chip on one bubble, absent on siblings) reads as a rendering glitch. (The triple-echo is stub-narrator behavior; flagged only for the label inconsistency, which is real regardless of model.)
- Fix: render the accordion's duration chip consistently (always or never) across bubbles.

### [TRANS-19] [Polish] [Effort:<1hr] [Value:Med]
Operator/production cue leaks into the visible casting bubble
- Where: seq-casting f06 — visible body text: "The house settles for a moment. [stub-echo] (Production cue — begin the casting interview now. Reach out…".
- Problem: A production/system cue and the `[stub-echo]` marker appear in the player-facing bubble. This is the deterministic narrator's echo, so it may be stub-only — but it proves the reasoning/aside scrub (markdown.js `processWithThinking`) is NOT catching this shape in the casting path. Verify the real-model scrub covers `(Production cue …)` and bracketed operator asides.
- Fix: confirm the game-build scrub strips operator-cue/`[stub-*]` fragments in casting turns, not only in-game turns.

### [TRANS-20] [Polish] [Effort:<1hr] [Value:Med]
"0 of 15 met" accent counter reads like an unmet-requirement error
- Where: status gadget "Meet the house  0 of 15 met" (desktop-08/22/seq-chat f27), rendered in the accent/link color.
- Problem: The colored "0 of 15 met" looks like a validation/error badge rather than gentle progress, especially at zero. Corroborates prior "N of 15 met" note; the transient angle is that it never animates as the count changes (a silent number swap for a progress beat).
- Fix: neutral styling at zero; a small count-up/tick animation when a houseguest is met.

### [TRANS-21] [Polish] [Effort:<1hr] [Value:Low]
Theme window opens offset-left, not centered; scrim only half-covers the board
- Where: desktop-12b-theme-open f00-f09 — window spans x≈265-790, right edge mid-screen; gadgets remain visible (dimmed) to its right.
- Problem: The theme modal isn't centered and its scrim leaves the right rail exposed, so the "modal" doesn't read as focused. The open animation (fade/scale) itself is fine.
- Fix: center the window and use a full-viewport scrim.

### [TRANS-22] [Polish] [Effort:<1hr] [Value:Low]
Opening the theme window churns body classes and rebuilds the dock rows
- Where: desktop-12b-theme-open.dom.json — `BODY.welcome-ready` removed then re-added twice (t+246 −1, t+288 +1 ×2), `DIV.minimized-dock-rows` removed+re-added, `#orwell-notice-zone` removed.
- Problem: A modal open shouldn't strip/re-add `welcome-ready` on `<body>` (that class gates welcome entrance animations — re-adding it can re-trigger them) or tear down the notice-zone. Unnecessary global churn on a local action.
- Fix: scope the modal-open side effects; don't toggle body-level readiness classes to open a window.

### [TRANS-23] [Polish] [Effort:<1hr] [Value:Low]
Confirm button only un-greys on selection — no enable-emphasis
- Where: desktop-11-decision-select f00→f03; dom log toggles `disabled`/`aria-pressed` on the chips and CTA.
- Problem: Chip select animates nicely (outline → filled red), but "Confirm — this is binding" simply switches from grey to blue with no transition/emphasis at the moment it becomes actionable — the state change that matters most (you can now commit) is the least animated.
- Fix: add a brief enable pulse/scale on the Confirm CTA when the selection becomes legal.

### [TRANS-24] [Polish] [Effort:<1hr] [Value:Low]
Collapsed gadget rail reduces rich panels to two unlabeled icons
- Where: seq-gadget-rail-collapse f05 — rail collapses to a clipboard + compass icon strip, no labels/tooltips.
- Problem: The collapse animation is clean, but the collapsed affordance (two ambiguous glyphs) gives no hint that they are Status / Where-You-Are. Wayfinding loss.
- Fix: tooltips/labels on the collapsed icons.

### [TRANS-25] [Latent] [Effort:<1day] [Value:Med]
Status HUD values re-render mid-stream — flicker risk under concurrent updates
- Where: desktop-18-streaming.dom.json — `#os-week`, `#os-phase`, `#os-hoh`, `#os-noms`, `#os-veto`, `#os-roster-h` all `+1 -1` at t+16272 and again t+37308 (mid/after stream).
- Problem: The HUD text nodes are wholesale replaced on each poll while narration streams. On a deterministic engine the values are stable so it's invisible, but the mechanism (replace-all each poll, unsynchronized with the stream) predicts a visible number flicker/latch if a value changes mid-narration under a real model / concurrent beat — a consistency symptom.
- Fix: diff-patch HUD fields; only mutate a node when its value actually changes.

### [TRANS-26] [Latent] [Effort:<1day] [Value:Med]
Presence panel rebuilds on every poll during streaming
- Where: desktop-18-streaming.dom.json — `DIV.opres-here` / `DIV.opres-nearby` `+1 -1` at t+3229 and t+28994 (also in decision-select t+528, theme-open t+4072).
- Problem: "Where You Are" rebuilds its here/nearby lists as full node swaps on each refresh; same replace-all pattern as TRANS-25, so the roster list can flicker/reflow on every poll independent of whether presence changed.
- Fix: reconcile the presence list in place.

### [TRANS-27] [Polish] [Effort:<1hr] [Value:Low]
"Where You Are" gadget text clipped under retro/new-season windows
- Where: desktop-22 / desktop-23 — the gadget's roster line ("Hassan, Wade, Mia…") is partially occluded where the retro/new-season window overlaps it.
- Problem: Overlapping windows clip live gadget text with no reflow, leaving half-words visible under the window edge.
- Fix: see TRANS-13/14 (reposition/scrim the reveal windows so they don't land on gadgets).

### [TRANS-28] [Polish] [Effort:<1hr] [Value:Low]
Onboarding "dismiss" strip shows the welcome card never actually leaving
- Where: desktop-02b-onboarding-dismiss f00-f07 + .dom.json (only two `BODY` child removals at t+44/t+49; no removal of `#orwell-premiere-tutorial`).
- Problem: The capture named "onboarding dismiss motion" shows the welcome card fully present in all 8 frames and the dom log records no card removal — so either the dismiss didn't trigger or the card has no exit animation on this path (removeTutorial just `.remove()`s at :198 with no `-out`). Differential: could be that the dismiss action targeted the wrong control; but combined with TRANS-1 (card never retires) the likelier read is the card resists dismissal / removes without an exit transition. Confidence: medium (needs a targeted re-capture of a click on the ×).
- Fix: verify the × dismiss path fires; add an exit animation (mirror `ow-sheet-anchored-in`) so dismissal reads as motion, not a pop-out.

---

## Coverage / where I looked
- DOM-mutation logs parsed for mount/unmount + attr-thrash: toast, streaming, decision-mount,
  decision-select, onboarding-dismiss, theme-open, send-fail (+ casting-kickoff mutations log).
- Filmstrips read frame-by-frame: onboarding-dismiss (8), decision-mount (10 sampled),
  decision-select (8), toast (12), streaming (15), theme-open (10), plus the `filmstrips/` set:
  seq-casting-send-stream-settle (28), seq-chat-send-stream-settle (28), seq-gadget-rail-collapse (12).
- Stills: chat-home, error-engine-down, send-fail, new-season, retrospective, mobile chat-home,
  mobile nominations, thinking-expanded.
- Source traced for each mechanism: orwellSheet.js, orwellNotice.js, orwellWindow.js,
  orwellPremiereTutorial.js, chatRenderer.js, orwellScrollBottom.js, modalManager.js.

## NOT covered / needs a targeted re-capture
- Real-model (GLM) streaming: the "Thinking ▅▄▃"→completion-footer transition and beat separation
  under xhigh latency (all captures used echo/deterministic; TRANS-5/8/25 are the predictions).
- Tool-beat chips (`orwellToolBeats`/`orwellBeatOutcome`) mount/animate — no isolated burst captured.
- Ceremony reveals for HOH crown / veto / staged eviction secret-ballot — only nomination was captured.
- Diary-room open/close motion; gadget dock↔undock (only rail collapse captured, not per-window dock).
- Reduced-motion + prefers-reduced-transparency actual runtime pass for the JS glass loop (TRANS-15).
