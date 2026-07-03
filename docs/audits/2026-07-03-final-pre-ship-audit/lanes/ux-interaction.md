# ORWELL — Interaction, Feedback & Cognitive-Load Audit (Lens: UX-INTERACTION)

Scope: composer (send/streaming/queued/offline), decision cards (all 11 kinds), gadget rail
(deals/cast/status/presence/finale), settings (appearance/account/shortcuts), model picker,
diary room, theme window, toast/notice, thinking accordion, new-season + retrospective,
engine-down/reconnect/degraded flow, mobile (390×844) vs desktop (1440×900).

Evidence base: `telemetry/MANIFEST.md`, all desktop/mobile stills (218 PNGs), the 7 filmstrip
sequences (desktop+mobile, 14 total) + their `.dom.json` MutationObserver logs, `transcript.txt`
(rendered decision-prompt truth), `_error_notes.json`/`_supplemental_notes.json`, and targeted
reads of `frontend/static/js/{chat,app,orwellDecision,orwellDeals,orwellHeadshot,orwellNewSeason,
orwellEngineStatus,orwellOnboarding,chatRenderer}.js` + `frontend/static/index.html` to confirm
root cause behind each visual observation (never guessing from pixels alone).

---

## INDEX

| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| INT-1 | Blocker | <1hr | High | Empty-composer Send button silently becomes "start a new chat" — no confirm | `app.js:3730-3844`, composer, all turns |
| INT-2 | Major | <1day | High | "Go in anyway" dead-ends in a raw workspace error, not a game-voiced one | `chat.js:734-738`, engine-down flow |
| INT-3 | Major | <1day | Med | Thinking-accordion reasoning stream is unscrubbed — leaks tool/mechanism names | `desktop-21-thinking-expanded.png`, chat.js reasoning split |
| INT-4 | Major | <1hr | High | Deals gadget shows "A houseguest" for every entry — deal-holder identity lost | `orwellDeals.js:112-116`, `desktop-05-gadget-deals.png` |
| INT-5 | Major | <1hr | High | Disabled headshot-studio buttons give no reason why (2 surfaces) | `orwellHeadshot.js:404-405`, New Season + Settings>Account |
| INT-6 | Minor | <1hr | Med | Enabled vs. disabled buttons in headshot studio nearly indistinguishable (opacity-only) | `orwellHeadshot.js:66` |
| INT-7 | Minor | <1day | Med | Veto-decision & comp-intent lack the risk badge nominations/replacement carry | `orwellDecision.js:49-59` |
| INT-8 | Major | <1day | High | Welcome-card / decision-card z-index bleed-through — background text visible through cards | `desktop/mobile-03-chat-home.png` |
| INT-9 | Minor | <1hr | Med | Ambient notice "The house stirs" renders with a title and zero body content | `desktop-17-toast-f04..11.png` |
| INT-10 | Polish | <1hr | Low | Retrospective window shows no visible body / no loading state in capture | `desktop-23-retrospective.png` |
| INT-11 | Polish | <1hr | Low | Model-picker click shows no visible dropdown in either viewport capture | `desktop/mobile-13-model-picker.png` |
| INT-12 | Minor | <1hr | Med | Settings > Account shows "Unknown / User" + "?" avatar with no context | `desktop-15-settings-account.png` |
| INT-13 | Major | <1day | High | Multiple undismissed cards stack over the composer, worst on mobile | `desktop/mobile-03,09,17`, mobile viewport |
| INT-14 | Minor | <1day | Med | Secondary window ("The Finale") docks flush over the mobile header/title bar | `mobile-04/07/08-gadget-*.png` |
| INT-15 | Minor | <1hr | Med | Failed-send message appears twice (bubble + composer) with no explicit "retry" cue | `desktop/mobile-27-send-fail-final.png`, `chat.js:717-733` |
| INT-16 | Minor | <1hr | Low | Game build strips ALL action buttons from sent bubbles, incl. resend, on a failed send | `chatRenderer.js:1546-1552` |
| INT-17 | Polish | <1hr | Low | Engine-status banner polls every 15s — recovery can read as still-down for up to 15s | `orwellEngineStatus.js:20,129` |
| INT-18 | Minor | <1hr | Med | Deal-kind labels (FINAL-2/PROTECTION/INFORMATION) explain themselves only via a hover-only title tip | `orwellDeals.js:131,137` |
| INT-19 | Low | <1hr | Low | Streaming filmstrip shows "+New" idle icon while narration text is still mid-reveal (needs live re-check) | `desktop-18-streaming-f01.png`, `chat.js:352-390` |
| INT-20 | Polish | <1hr | Low | Mobile Diary Room: "Select model" pill overlaps/truncates the composer placeholder | `mobile-16-diary-room.png` |
| INT-21 | Polish | <1hr | Low | Mobile degraded-state chat title truncates to bare "O…" | `mobile-27-send-fail-final.png` |
| INT-22 | Minor | <1hr | Med | "Reset All" sits permanently disabled beside "Reset window positions" with no explanation | `desktop-14-settings-open.png` |
| INT-23 | Minor | <1day | Med | First game screen presents 6+ simultaneous information surfaces with no sequencing | `desktop-03-chat-home.png` (cognitive load) |
| INT-24 | Minor | <1day | Low | "Where You Are" presence list is a dense name-run with no avatars/grouping | `desktop-03,06-*.png` |
| INT-25 | Minor | <1day | Low | Cast roster avatars are solid-color initial blocks — weak person recognition | `desktop-07-gadget-cast.png` |
| INT-26 | Minor | <1hr | Med | Comp-round "no stakes" round still visually presents 3 fully-live option chips | `desktop-09-decision-comp-round.png` *(corroborates prior v1 finding — new angle: chip is NOT visually inert)* |
| INT-27 | Polish | <1hr | Low | "Compact pin"/pagination dots on Cast window carry no visible focus ring evidence captured | `desktop-04-gadget-rail-docked.png` (coverage gap, flagged not asserted) |
| INT-28 | Minor | <1day | Med | No client-side "still working / this is taking a while" fallback if server-side stall detection is late | `chat.js` stall-watchdog note (CLAUDE.md), architecture-level |
| INT-29 | Polish | <1hr | Low | Goodbye-message tone chips ("warm/respectful/cold") show no distinct visual treatment per tone (all neutral pills) | `desktop-09-decision-goodbye-message.png` |
| INT-30 | Minor | <1hr | Med | New-Season "Recast from scratch" ghost button and "Keep this houseguest" primary button sit at equal visual weight for a materially unequal-stakes choice (mitigated by a confirm dialog, but first glance doesn't signal asymmetry) | `desktop-22-new-season.png` |

**Positive/steelman notes (not findings, for calibration):** the binding decision-card submit flow
(`orwellDecision.js:653-712`) is genuinely well-built — immediate disable + "Locking in…" label,
role="alert" error region, differentiated 409/400/network copy, auto-heal messaging, and a
4s-lingering "✓ Locked in." success state before removal. The dismiss (×) path is explicitly
reversible ("Dismiss — you can decide in conversation instead"), never silently drops the pending
decision. Nomination multi-select gives clear per-chip red-outline → red-fill progression before
enabling Confirm. These are the bar the flagged inconsistencies (INT-5, INT-7, INT-22) should be
raised to.

---

## FINDINGS (full schema)

### [INT-1] [Severity: Blocker] [Effort: <1hr] [Value: High]
Empty-composer Send button silently becomes "start a new chat" — no confirmation, no visual warning
- **Where:** `frontend/static/app.js:3730-3844` (`_updateSendBtnIcon` / the `sendBtn` click handler
  and the Enter-key handler at `chat.js`-adjacent `messageInput` keydown, lines 3865-3892). Directly
  observed: `desktop-21-thinking-expanded.png` shows the primary composer button rendering a "+"
  (new-chat) glyph instead of the "↑" send arrow used everywhere else (confirmed by pixel-diffing
  the same control across `desktop-09-decision-comp-round.png` [↑] vs `desktop-21-thinking-
  expanded.png` [+], identical screen position, identical 1440×900 viewport).
- **Problem:** Whenever the composer is empty on an already-materialized (non-fresh) session — i.e.
  the DEFAULT resting state after literally every AI turn — the single most-used control in the
  entire app (the always-visible send button) silently reassigns itself to `sessionModule
  .createDirectChat(...)`. One click, or one accidental Enter keypress on an empty box (line 3885:
  `if (sendBtn.dataset.mode === 'newchat') { railNew.click(); return; }`), immediately spins up a
  brand-new chat session with **zero confirmation dialog** — in a product whose entire premise is
  "the conversation IS the game" (ADR 0003) and where "one active game per user" is a stated
  invariant. The only visible difference from "send" is a small icon swap (arrow → plus) that is
  easy to miss mid-conversation, especially in a fast, tense moment (right before an eviction vote,
  the player clears the composer to think, and taps the button reflexively). This is precisely the
  class of bug CLAUDE.md itself warns about for the canonical-session binding (#1085/#1086 —
  session-switch-derived state loss / stripped replies): a "new chat" click that does not obviously
  map onto the same canonical game session risks stranding the player on an empty, non-game welcome
  screen mid-turn with no visible path back to "their" game.
- **Fix:** In the game build (`data-game-build` attribute is already used elsewhere, e.g. `app.js:
  142,161,4116`, to strip workspace-only affordances), gate the entire `newchat`-mode branch of
  `_updateSendBtnIcon`/the click handler/the Enter handler behind `!document.body.hasAttribute
  ('data-game-build')`. An empty composer in the game build should just show a muted/disabled send
  affordance (the existing `isEmptySession` branch at line 3756-3764 already does exactly this for
  the fresh-welcome case — extend that branch to cover ALL game-build sessions, not just the empty
  one).

### [INT-2] [Severity: Major] [Effort: <1day] [Value: High]
"Go in anyway" on the engine-down holding card dead-ends in a raw workspace error, breaking the entire in-fiction recovery the holding card promised
- **Where:** `frontend/static/js/orwellOnboarding.js:210,424` (the in-fiction "Go in anyway"
  dismiss) → `frontend/static/js/chat.js:734-738` (`_NO_SESSION_NOTE`). Directly observed:
  `desktop-27-send-fail-final.png` / `mobile-27-send-fail-final.png`, `desktop-26-send-fail-f00..11
  .png` filmstrip.
- **Problem:** The team clearly invested real design work in NOT breaking immersion during an
  outage — "The house is dark," "Production is building the house…," "Reconnecting to Big
  Brother…" are all in-fiction (`orwellEngineStatus.js:89-97`), and the dismiss button is explicitly
  labeled "Go in anyway" (an in-fiction escape hatch, per the code comment "CONT-1: in-fiction
  dismiss (was the OOC 'Continue anyway')"). But the moment the player actually acts on that
  invitation and sends a message while the engine is genuinely still down, the very next thing they
  see is a fully out-of-character system message: *"No chat session active. You can: — Open the
  model picker in the chat box and pick a model — Use the `+` button in the model picker to add a
  model endpoint — Use `/help` to see all available commands."* This is delivered as an "Orwell"
  chat bubble (i.e., attributed to the game's own narrator persona), instantly undoing all the
  in-fiction work above and handing a confused first-timer a wall of workspace jargon (slash
  commands, "endpoint," "model picker") they have no context for. Differential: this is squarely an
  interaction/status-visibility gap, not a copy-only issue — the actual FAILURE MODE (send attempted
  with no live session) needs its own in-fiction branch, distinct from the "no model configured"
  case this copy was written for.
- **Fix:** Branch `_NO_SESSION_NOTE` on WHY there's no session: if `/api/orwell/health` reports the
  engine down (the same signal `orwellEngineStatus.js` already polls), show the in-fiction line the
  holding card already uses ("Big Brother will return...") instead of the generic OOC session note;
  reserve the current `/help`-laden text for the genuinely-no-model-configured case it was written
  for.

### [INT-3] [Severity: Major] [Effort: <1day] [Value: Med]
Thinking-accordion reasoning stream is architecturally unscrubbed — will leak tool/mechanism names to a curious first-timer
- **Where:** `desktop-21-thinking-expanded.png` (captured content: *"The player is fishing for a
  veto commitment. I should not commit — keep Renee cagey, protect the alliance read, and stall a
  beat. Call socialRead on the player, then narrate."*); architecture confirmed via CLAUDE.md's own
  description of the split-buffer streaming model (`roundReplyText` vs `roundReasoningText` in
  `chat.js`) — "the reply body ... scrubs operator-aside / raw `npc:<id>` leaks," but the reasoning
  accordion is explicitly rendered "by construction" from the raw reasoning buffer with no
  equivalent scrub step named anywhere in the docs or in `orwellDecision.js`/`chatRenderer.js`.
- **Problem:** This exact sample was captured on the **deterministic, key-free stub narrator**
  (`transcript.txt` header: "No live LLM: narration seams are stubbed"), so this specific string is
  not proof a real DeepSeek/GLM model will phrase it identically — confidence is Medium, not High,
  on the exact wording. But the underlying risk is real and architecture-level: real reasoning
  traces from tool-using LLMs routinely narrate their own tool-call intent in plain language ("I
  should call X now"), and the reply body has a documented scrub pass the reasoning stream does not.
  Settings already expose "Thinking Process — Show `<think>` collapsible bars" as an opt-in-visible,
  collapsed-by-default feature — so this is reachable by exactly the curious first-timer this
  product is trying to keep immersed, and a phrase like "Call socialRead on the player" announces an
  internal engine/tool name that has zero place in a Big Brother contestant's inner monologue.
- **Fix:** Route `roundReasoningText` through the same (or an equivalently narrow) scrub pass
  applied to the reply body before rendering it into the accordion — at minimum, strip/replace
  known tool-name tokens and `npc:<id>`-style identifiers. Verify against a REAL model run (not just
  the deterministic stub) before closing, since this specific string's exact phrasing is stub-
  generated.

### [INT-4] [Severity: Major] [Effort: <1hr] [Value: High]
Deals gadget renders "A houseguest" for every entry — the player cannot identify who they have deals with
- **Where:** `frontend/static/js/orwellDeals.js:112-116` (`otherParty()` falls back to the literal
  string `"A houseguest"` whenever `them.name` is falsy). Directly observed: `desktop-05-gadget-
  deals.png` / `mobile-05-gadget-deals.png` — all three live rows ("FINAL-2 · ACTIVE," "ACTIVE
  PROTECTION," "ACTIVE INFORMATION") render the generic fallback, and the `terms` line is also
  empty for all three.
- **Problem:** This is the single UI surface whose entire job is helping the player track who they
  have live promises with (a real, load-bearing memory aid for a 16-person social game — Recognition
  over recall, Nielsen H6). With the fallback active on 100% of visible rows, the gadget shows THREE
  active deals and identifies NONE of them — worse than showing nothing, since it signals "you have
  commitments" without saying to whom, forcing the player back into chat scrollback to reconstruct
  what the gadget exists to avoid. Differential: could be a seeded-test-data gap (the deterministic
  capture's relationship "parties" array may simply not carry populated `name` fields) rather than a
  live-data bug — flagging with Medium confidence pending a live-LLM playthrough check — but the
  reachable failure mode is real regardless of root cause: any deal whose `parties[].name` isn't
  populated at write time renders unusable in this gadget.
- **Fix:** (1) Verify the write path always populates `parties[].name` at deal-creation time,
  independent of any lazy roster lookup; (2) as a defensive floor, have `otherParty()` resolve the
  id against the roster/cast list already available to the FE (the same list powering the Cast
  gadget) before falling back to the generic string, so a missing `name` field doesn't silently
  degrade to unusable.

### [INT-5] [Severity: Major] [Effort: <1hr] [Value: High]
Disabled headshot-studio action buttons give no reason why — same principle already fixed for decision cards, missed here (2 independent occurrences)
- **Where:** `frontend/static/js/orwellHeadshot.js:401-408` — the `#hs-studio` ("Make AI studio
  portraits") and `#hs-exact` ("Use photo as-is") buttons render `disabled` whenever `st.file` is
  unset, with no adjacent explanatory text. Observed live in TWO independent surfaces that both
  mount this same shared component: `desktop-22-new-season.png` (the season-transition portrait
  step) and `desktop-15-settings-account.png` (Settings → Account → Profile picture) — both show the
  identical disabled pair with no hint.
- **Problem:** `orwellDecision.js` has an entire named pattern for exactly this problem — J4-20:
  *"a disabled Confirm previously gave no hint about WHY it was disabled or WHAT to do. Add a hint
  that says what's still needed"* (`disabledHintFor()`, lines 330-334, 465-479) — explicitly citing
  WCAG 3.3.2 (instructions on a disabled control). The headshot studio, mounted in two different
  flows, does not apply this already-solved pattern: a first-timer sees two prominent pill buttons
  that simply don't respond, with the only clue being the unlabeled "Choose a photo of yourself"
  control above them (itself a `<label for="hs-file">`, i.e. a native file-input trigger with no
  visual differentiation from the disabled pair beyond opacity — see INT-6). Two independent
  hits on the same component raises this from a one-off to a real gap in this product's disabled-
  state design language.
- **Fix:** Reuse `disabledHintFor`'s pattern (or a shared helper) in `orwellHeadshot.js`: render a
  quiet, `aria-describedby`-linked line — "Choose a photo above to enable these" — beside the two
  disabled buttons, hidden once a file is chosen.

### [INT-6] [Severity: Minor] [Effort: <1hr] [Value: Med]
Enabled vs. disabled buttons in the headshot studio are visually near-identical — opacity is the only cue
- **Where:** `frontend/static/js/orwellHeadshot.js:66` (`.ow-headshot-studio .hs-btn[disabled] {
  opacity: .5; cursor: default; }`). Same screenshots as INT-5.
- **Problem:** Compounds INT-5: even a player who DOES notice something is different between
  "Choose a photo of yourself" (enabled) and "Make AI studio portraits"/"Use photo as-is" (disabled)
  has only a 50%-opacity dimming to go on — all three are the same pill shape, same corner radius,
  similar gray fill on the light theme card background (verified by direct pixel crop: the three
  buttons in `desktop-22-new-season.png` differ only in text-color luminance, not in shape, fill
  hue, or border). This is a low-contrast affordance signal for a genuinely blocking state.
- **Fix:** Give the disabled state a second, non-opacity cue already used elsewhere in this design
  system (the decision cards use `cursor: not-allowed` at full opacity plus the hint text) — e.g.
  drop the fill entirely for disabled buttons rather than just dimming it, so shape recognition
  alone can distinguish "not yet available" from "available."

### [INT-7] [Severity: Minor] [Effort: <1day] [Value: Med]
Veto-decision and comp-intent don't carry the "IRREVERSIBLE — BINDING" risk badge that nominations/replacement/eviction-vote/final-eviction carry
- **Where:** `frontend/static/js/orwellDecision.js:49-59` (`HIGH_STAKES_KINDS` excludes
  `"veto-decision"` and `"comp-intent"`). Observed: `desktop-09-decision-veto-decision.png` (no
  badge) vs. `desktop-09-decision-replacement.png` / `desktop-09-decision-nominations.png` (red
  "⚠ Irreversible — binding" badge, top-right).
- **Problem:** Steelmanned first: the omission is at least partly principled — the code comment
  explains the badge is reserved for kinds that "end a houseguest's game just like [eviction]"
  outright, and choosing not to use the veto or setting a comp approach doesn't, by itself, end
  anyone's game (the actual fate-sealing step is the subsequent `replacement` or `eviction-vote`
  card, which DOES carry the badge). That said, the veto decision is still the single highest-
  leverage, irrevocable choice of the entire week for a first-time HOH or veto-holder — "Don't use
  the veto" locks the current two nominees in place with no walk-back — and the card's own body
  copy ("Once you confirm, it's locked in and plays out") already signals bindingness without the
  matching visual weight nominations gets. A first-timer skimming visual hierarchy (not reading
  every line) could reasonably read the lack of a red badge as "this one's lower-stakes than
  nominations," when in the moment it doesn't feel that way.
- **Fix:** Either extend `HIGH_STAKES_KINDS` to include `"veto-decision"` (its consequence is a
  precondition for every high-stakes kind downstream), or, if the design intent is to keep the
  badge reserved for outcome-ending kinds, strengthen the veto-decision card's non-badge signal to
  match (e.g. the same accent-color border treatment used for the badge kinds, without the literal
  text).

### [INT-8] [Severity: Major] [Effort: <1day] [Value: High]
Welcome-card / decision-card rendering shows a z-index/opacity bleed-through — background text is visible through the modal cards on both viewports
- **Where:** `desktop-03-chat-home.png`, `desktop-09-decision-comp-round.png`, `desktop-16-diary-
  room.png`, `mobile-03-chat-home.png`. Corroborated explicitly by the manifest's own capture-time
  anomaly notes ("the 'Welcome to the house' card OVERLAPS the composer placeholder... bleeds
  through behind it"; "Two decision surfaces can stack at once").
- **Problem:** This is distinct from the already-known "stale welcome card" issue (prior finding):
  the NEW observation here is that the composer's own placeholder text ("Type /setup to get
  started.") and the secondary tagline ("Production needs a feed source…") remain visibly legible
  THROUGH/behind the "Welcome to the house" card and the comp-round decision card even while those
  cards are the topmost, ostensibly opaque layer — visible again in `desktop-16-diary-room.png`
  where a faint duplicated "Orwell" wordmark ghosts through the card body. This reads as a genuine
  rendering defect (insufficient backdrop opacity/blur, or a stacking-context gap) rather than mere
  staleness, and it actively hurts legibility of the decision text sitting on top of it (competing
  contrast). For a first-timer, a UI element that looks semi-transparent/glitchy in the very first
  seconds of the app reduces trust that the rest of the interface is under control — directly
  relevant to a chat-centric product whose credibility rests on the illusion of a stable "broadcast."
- **Fix:** Audit the card's backdrop (likely a `backdrop-filter`/opacity combination) for the
  specific stacking context these two elements (composer placeholder, decision/welcome card) share;
  ensure the card's own background is fully opaque against its actual rendered layer, not just
  against the immediately-prior sibling.

### [INT-9] [Severity: Minor] [Effort: <1hr] [Value: Med]
Ambient notice card "The house stirs" renders with a title and literally zero body content
- **Where:** `desktop-17-toast-f04.png` through `-f11.png` (the notice persists across at least 8
  consecutive filmstrip frames with only the bold title "The house stirs" and a dismiss ×, no body
  line).
- **Problem:** Confidence Medium on production-string origin: this exact toast is not a synthetic
  telemetry-harness string (the harness's own synthetic notices are separately labeled `notice-*`
  per `capture.py:696-719` and use the placeholder title "Telemetry capture notice (…)" — this is a
  distinctly different string, consistent with a real in-game ambient/house-event ping). If real,
  this is a status message that announces "something happened" without saying what — worse than
  silence for Nielsen H1 (visibility of system status), since it consumes a full card's worth of
  attention and vertical space (a genuine cost on the mobile viewport, see INT-13) while conveying
  zero actionable information, and once dismissed the "stirring" is not otherwise logged anywhere
  the player can recover it.
- **Fix:** Either give this notice kind a body line (what actually happened / where / who) or drop
  it to a much lower-weight ambient indicator (e.g. a small dot on the "Where You Are" panel) rather
  than a full dismissable card sized identically to a decision or onboarding card.

### [INT-10] [Severity: Polish] [Effort: <1hr] [Value: Low]
Retrospective window shows no visible body content and no loading indicator in the captured still
- **Where:** `desktop-23-retrospective.png` — "The Season, Watched Back" window renders only its
  title bar; the HUD panel underneath ("You / HOH / Noms…") remains fully visible where the
  retrospective's own body content should be.
- **Problem:** Low confidence this is a real defect vs. a single-frame capture-timing artifact (a
  still, not a filmstrip, so there's no way to confirm whether content painted a moment later). If
  real, it means the retrospective — a payoff moment at the end of a full season — opens with no
  loading state and no content, which would be a Nielsen H1 violation at exactly the wrong moment
  (the reward screen for finishing a season). Flagged for live re-verification rather than asserted.
- **Fix:** Re-capture with a short settle delay or a filmstrip; if content is genuinely late-
  arriving, add a loading skeleton inside the window body rather than an empty pane.

### [INT-11] [Severity: Polish] [Effort: <1hr] [Value: Low]
Model-picker click shows no visible dropdown in either desktop or mobile capture
- **Where:** `desktop-13-model-picker.png`, `mobile-13-model-picker.png` — both show the diary-
  room/persona icon highlighted in the bottom bar but no visible menu/list anywhere in frame, and
  the "Select model" pill itself is unchanged from its resting state.
- **Problem:** Low confidence — could be a harness click-target/timing miss (the manifest's own
  notes call out at least one other timing-sensitive capture, "toast requires an explicit id or it
  throws"). If the model picker genuinely fails to open on click, that's a Blocker (players can
  never change their narrator model), so this needs a live re-check before triage, not a dismissal.
- **Fix:** Re-capture with an explicit post-click settle wait; if reproducible live, escalate
  immediately.

### [INT-12] [Severity: Minor] [Effort: <1hr] [Value: Med]
Settings > Account shows "Unknown / User" identity with a bare "?" avatar and no context
- **Where:** `desktop-15-settings-account.png` — the Account section's identity row reads "Unknown"
  (bold) / "User" (subtitle) beside a generic "?" glyph avatar, with a build version "v11.62" to its
  right.
- **Problem:** Medium confidence this reflects the seeded test account rather than a live-account
  resolution bug, but as captured it is a clean example of a status-visibility gap: whatever field
  is meant to populate here (display name/email) silently fell back to a placeholder with no
  indication of WHY (not logged in fully? a fetch failed? this account genuinely has no name set?).
  A player who lands here looking to confirm "is this my account" gets no confirming signal either
  way.
- **Fix:** Distinguish "no name set yet" (show the email/id instead) from "identity fetch failed"
  (show an inline error) — "Unknown" alone collapses both into an indistinguishable, unexplained
  state.

### [INT-13] [Severity: Major] [Effort: <1day] [Value: High]
Multiple undismissed cards stack simultaneously over the composer — a mobile-viewport cognitive-load and usable-space crisis
- **Where:** `desktop-03-chat-home.png` (Welcome card + comp-round decision card both mounted at
  once), `mobile-03-chat-home.png` / `mobile-04-gadget-rail-docked.png` (same stack, now competing
  with a docked secondary window for a 390×844 viewport).
- **Problem:** On mobile, a first-time player's very first screen after the premiere narration
  contains, top to bottom: a nav/title bar, an optional docked window title strip ("The Finale"),
  the full "Welcome to the house" onboarding card (title + 3 lines of body + an icon-emoji pipeline
  summary + a CTA button), and only then the composer — leaving perhaps 15-20% of the 844px-tall
  viewport for the actual conversation, which is the entire game. Any additional pending decision or
  ambient notice (INT-9) stacks on top of this, pushing the composer further down or off-screen
  entirely on first paint. This is a concrete instance of extraneous cognitive load (Sweller): the
  player must scroll and mentally triage multiple simultaneous non-dismissed prompts before they can
  even see where to type.
- **Fix:** Cap simultaneous non-decision cards to one visible at a time (queue the rest, surface via
  a small "+1 more" affordance) — decision cards should always win the stacking order since they are
  time-sensitive and binding; ambient/onboarding cards should defer behind them, not stack above
  the composer simultaneously.

### [INT-14] [Severity: Minor] [Effort: <1day] [Value: Med]
Secondary window ("The Finale") docks flush against the mobile header/title-bar zone
- **Where:** `mobile-04-gadget-rail-docked.png`, `mobile-07-gadget-cast.png`, `mobile-08-gadget-
  finale.png` — a second floating window's title strip renders directly under the "Week 1" nav bar,
  visually fused with it (no gap, shared edge), with its own traffic-light dots at roughly the same
  vertical position as the hamburger menu icon.
- **Problem:** On desktop this same window happily floats independently lower on screen; on mobile
  it collapses to the very top, competing for the same 44-48px band as primary navigation. This
  reads as a responsive-breakpoint gap in the window-management system (windows don't appear to
  re-flow to a mobile-appropriate stacking/minimized state, they just compress toward the top edge).
- **Fix:** On narrow viewports, dock secondary windows to a bottom sheet or a collapsed rail entry
  rather than letting them float and collide with the primary nav bar.

### [INT-15] [Severity: Minor] [Effort: <1hr] [Value: Med]
A failed send shows the same text twice (as a "NOT SENT" bubble and again live in the composer) with no explicit retry affordance
- **Where:** `desktop-27-send-fail-final.png` / `mobile-27-send-fail-final.png`;
  `frontend/static/js/chat.js:712-733` (`_abortSendKeepMessage`).
- **Problem:** The underlying mechanic is actually good design — the composer text is deliberately
  restored so the player never loses their words (line 726-729) and the bubble is tagged with a
  "NOT SENT" pill. But the PRESENTATION is confusing: the exact same sentence appears simultaneously
  as a faded blue "sent" bubble above and as live, editable text in the composer below, with nothing
  connecting the two states for a first-timer (no line like "restored to the composer" or arrow
  pointing down). At a glance this reads as a duplicate-message glitch rather than a clear "this
  didn't go through, your words are safe below, just hit send again" signal.
- **Fix:** Add a one-line connective caption under the NOT SENT bubble ("restored below — try
  again") or visually de-emphasize/collapse the failed bubble once its text is confirmed to be back
  in the composer, so there is one source of truth on screen at a time.

### [INT-16] [Severity: Minor] [Effort: <1hr] [Value: Low]
Sent (player) bubbles carry zero action buttons in the game build — including on a failed send, no explicit Resend
- **Where:** `frontend/static/js/chatRenderer.js:1546-1552` (`userPool = document.body.hasAttribute
  ('data-game-build') ? [] : allActions` — deliberately strips edit/delete/resend from the player's
  own messages in the game build).
- **Problem:** This is a deliberate, documented owner ruling (glass-theme legibility + "the played-
  record model already strips record-altering actions") and is reasonable for a SENT message in the
  normal case. But it means the one moment a resend action would be most useful — right after a
  failed send (INT-15) — is exactly when it's unavailable; the only path to retry is noticing the
  composer already has the text back and pressing send again, which is not obvious to someone who
  doesn't already know how the recovery mechanic works.
- **Fix:** Carve a narrow exception: a bubble in the `msg-unsent`/`NOT SENT` state may show a single
  "Resend" action even in the game build, since it isn't altering a "played record" — it never
  played.

### [INT-17] [Severity: Polish] [Effort: <1hr] [Value: Low]
Engine-status banner polls every 15 seconds — recovery can visibly lag the real state by up to 15s
- **Where:** `frontend/static/js/orwellEngineStatus.js:20` (`POLL_MS = 15000`), `:126-130` (`start`/
  `setInterval`).
- **Problem:** Not a Doherty-threshold violation in the strict <400ms sense (this is a background
  status poll, not an interaction response), but it does mean a player who fixes the underlying
  problem (e.g. an admin restarts the engine) can stare at a red "Big Brother engine unavailable"
  banner for up to 15 more seconds after the fix lands, with no way to force a re-check other than
  waiting or reloading. `window.orwellRefreshEngineStatus` exists as a manual seam (line 132) but is
  not exposed anywhere in the player-facing UI as a "try again now" button.
- **Fix:** Surface a small "Recheck now" affordance on the banner itself, wired to the existing
  `window.orwellRefreshEngineStatus()` seam — near-zero engineering cost since the function already
  exists.

### [INT-18] [Severity: Minor] [Effort: <1hr] [Value: Med]
Deal-kind labels (FINAL-2 / PROTECTION / INFORMATION) are explained only via a hover-only native tooltip
- **Where:** `frontend/static/js/orwellDeals.js:131` (`row.title = meta.hint`), `:137` (`KIND_LABEL
  [d.kind]`).
- **Problem:** Even once INT-4's name-resolution bug is fixed, these three-letter-acronym-adjacent
  status chips ("FINAL-2," "PROTECTION," "INFORMATION," plus the color-coded left border for open/
  kept/broken) are meaningful game mechanics a first-timer has had zero prior exposure to (no
  onboarding card mentions deals at all — the only onboarding card captured, "Welcome to the house,"
  covers only HOH→Noms→Veto→Eviction). Their only explanation is a native `title` attribute, which
  requires an un-signaled long-hover on desktop and is entirely unreachable on the touch-only mobile
  build. This is a clean Recognition-over-recall gap: the labels assume vocabulary the game never
  taught.
- **Fix:** Add a small persistent legend/info affordance to the gadget header ("What's a deal?") or
  at minimum an `(i)` glyph per row that opens the same hint text on tap, so mobile players have
  parity with the desktop hover.

### [INT-19] [Severity: Low] [Effort: <1hr] [Value: Low]
Streaming filmstrip shows the composer in "+New" idle mode while narration text is still mid-reveal
- **Where:** `desktop-18-streaming-f01.png` (partial text "Renee leans against the counter, lowering
  her voice. 'Look, I hear you —" visible, composer button already showing "+"); cf. `chat.js:352-
  390` (`_syncSubmitButtonState`/`_foregroundStreamLive`, which is explicitly documented as having
  had at least one historical desync bug class, "#971").
- **Problem:** Low confidence this is a live bug rather than a capture-replay artifact — the
  deterministic capture stack may reveal canned text with a client-side typewriter effect for
  screenshot purposes without engaging the real `isStreaming`/`currentAbort` state machine, which
  would make this a capture-fidelity limitation, not a product defect. If it IS real, it means a
  genuinely long real-model response (the brief's own callout: "DeepSeek verbosity as a wall of
  text") would stream with no visible "Stop generating" control, denying the player any way to
  interrupt a runaway reply.
- **Fix:** Live-verify against a real streaming provider (not the deterministic stub) with a
  deliberately verbose prompt; if the Stop icon is genuinely absent mid-stream, treat as a
  regression of the documented `_foregroundStreamLive` contract.

### [INT-20] [Severity: Polish] [Effort: <1hr] [Value: Low]
Mobile Diary Room: the "Select model" pill overlaps/truncates the composer placeholder text
- **Where:** `mobile-16-diary-room.png` — placeholder reads "Tell the producers what you're really
  thi…" with the remaining characters obscured directly behind the "Select model" pill, which sits
  inline over the same text line.
- **Problem:** Cosmetic on a placeholder (no real content lost, since a placeholder disappears the
  moment the player types), but it is a legibility defect a first-timer sees before they've typed
  anything, and it's specific to the Diary Room's longer placeholder string colliding with a
  control that fits fine over the shorter default "Say or do something…" placeholder elsewhere.
- **Fix:** Right-pad the placeholder text (or left-inset the model-picker pill) enough to clear the
  longest placeholder string used by any composer mode, not just the default one.

### [INT-21] [Severity: Polish] [Effort: <1hr] [Value: Low]
Mobile degraded-state chat title truncates to a bare "O…"
- **Where:** `mobile-27-send-fail-final.png` — the session-title pill reads "O… · 2 msgs" where
  desktop shows "Orwell Chat · 2 msgs."
- **Problem:** Compounds the already-known "workspace machinery visible" issue specifically on
  mobile: not only is the title workspace-voiced rather than game-framed, on the 390px viewport it
  additionally truncates into unreadable noise ("O…"), which looks like a rendering bug independent
  of the wording problem.
- **Fix:** Once the title copy itself is fixed for the game build (tracked separately), verify the
  chosen string also fits the mobile title-pill's available width without truncation.

### [INT-22] [Severity: Minor] [Effort: <1hr] [Value: Med]
"Reset All" sits permanently disabled beside "Reset window positions" with no explanation
- **Where:** `desktop-14-settings-open.png` — Settings > Appearance > Chat Area section: "Reset
  window positions" (enabled, outlined) sits directly beside "Reset All" (visibly grayed/disabled),
  no adjacent copy for either.
- **Problem:** A third instance of the same family as INT-5/INT-6 (a disabled control with no
  stated reason) — worth flagging as a pattern rather than a one-off, since it's now been observed
  in three independent surfaces of this build (headshot studio ×2, this settings row). A first-timer
  has no way to know whether "Reset All" is disabled because there's nothing to reset yet, because
  it requires a different tab's context, or because of a bug.
- **Fix:** Apply the same disabled-hint convention (INT-5's fix) here: state the condition ("Reset
  All" enables once any setting differs from default, or similar) inline.

### [INT-23] [Severity: Minor] [Effort: <1day] [Value: Med]
First game screen presents 6+ simultaneous information surfaces with no sequencing — extraneous load for a first-timer
- **Where:** `desktop-03-chat-home.png` / `desktop-04-gadget-rail-docked.png` composite view.
- **Problem:** On a single first paint, a brand-new player is simultaneously shown: (1) the Welcome
  onboarding card, (2) a live decision card (comp-round, in this captured state), (3) the right-rail
  HUD table (Week/HOH/Noms/Veto), (4) the "Where You Are" presence panel (13 names in a comma run,
  see INT-24), (5) the gadget-rail entry points (Cast/Deals/Status), and (6) the composer itself —
  none visually de-emphasized relative to the others, no single "look here first" affordance beyond
  card z-order. Per Sweller, this is extraneous load stacked on top of the game's already-high
  intrinsic load (16-person social deduction is complex by design) — a first-timer's limited working
  memory is spent parsing UI chrome before they've made a single meaningful choice.
- **Fix:** For the premiere-week first paint specifically, consider dimming/collapsing the HUD and
  gadget rail until the player dismisses the Welcome card (progressive disclosure — reveal the
  control-room surfaces only once the player has engaged with the core loop once).

### [INT-24] [Severity: Minor] [Effort: <1day] [Value: Low]
"Where You Are" presence list is a dense, unbroken name-run with no visual grouping or avatars
- **Where:** `desktop-03-chat-home.png`, `desktop-06-gadget-status.png` — "Living Room — Lola,
  Michelle, Karl, Vincent, Courtney, Ethan, Hassan, Wade, Mia, Jada, Eliana, Trey, Fabian, Victoria,
  Asher" (13 names, one continuous line, no line breaks, no avatars, no bolding of anyone
  significant like the current HOH).
- **Problem:** Recognition-over-recall (Nielsen H6): a first-timer who has just met 15 strangers has
  no visual anchor (color, initial-avatar, or bold-for-HOH/nominee) to parse who's who at a glance —
  they must read and recall names purely from this plain-text list, every single time they check
  presence.
- **Fix:** Reuse the same colored-initial avatar chips already built for the Cast gadget
  (`desktop-07-gadget-cast.png`) as small inline glyphs before each name in the presence list, and
  bold/badge the current HOH and nominees inline (their game-relevant role is already known state).

### [INT-25] [Severity: Minor] [Effort: <1day] [Value: Low]
Cast roster avatars are flat colored-initial blocks — weak person recognition support
- **Where:** `desktop-07-gadget-cast.png` — "P" (brown), "M" (purple), "L" (green), "K" (maroon)
  single-letter tiles for Player/Michelle/Lola/Karl.
- **Problem:** In this captured game state no cast portraits have been generated/backfilled, so the
  fallback is a same-shape colored block distinguished only by a single initial and a background
  hue. With up to 15 houseguests, initials collide often (multiple can share a first letter), and
  color alone is a weak, non-semantic recognition channel this early in a season. The gadget itself
  does surface a "Generate cast portraits" backfill action (`orwellCast.js:324`) — so the capability
  exists but wasn't exercised for this capture. Confidence Medium this reflects a real "many players
  never trigger backfill" steady state vs. a capture-only gap.
- **Fix:** If backfill isn't automatic, consider prompting for it proactively at premiere (once)
  rather than leaving it as a rail button players must discover; short of that, fall back to
  first+last initial (not just first) to reduce collisions.

### [INT-26] [Severity: Minor] [Effort: <1hr] [Value: Med]
Comp-round "no stakes" flavor round still presents 3 fully-interactive, visually-live option chips
- **Where:** `desktop-09-decision-comp-round.png`; `frontend/static/js/orwellDecision.js:487-508`
  (the `addChip` click handler applies the same `aria-pressed` toggle to comp-round chips regardless
  of the round's `binding` flag).
- **Problem:** *(Corroborates the prior v1 finding "non-binding comp-round buttons" — new angle,
  not a re-file of the same observation.)* The prior finding flagged the buttons' existence on a
  non-binding round; the specific mechanism worth adding here is that clicking a DIFFERENT chip
  (e.g. tapping "throw" when "compete" is the round-1-locked approach) visibly MOVES the selection
  ring to "throw" — the control changes its displayed state exactly as if a new binding choice were
  being made, even though CLAUDE.md confirms this is by design ("later rounds are non-binding
  flavor... the binding flag... drives the FE to render them as color, not a fresh decision," owner
  ruling 2026-06-20). The body copy correctly discloses this ("this is just color"), but the pill's
  own visual state-change contradicts that disclosure at a glance — the control's affordance says
  "you just changed your approach," which isn't true.
- **Fix:** For a `binding: false` comp-round, either lock the pre-selected chip visually (disable
  the OTHER two rather than leaving all three freely toggleable) or use a visually distinct,
  lower-emphasis chip style for non-binding rounds so the interaction affordance matches the
  disclosed reality.

### [INT-27] [Severity: Polish] [Effort: <1hr] [Value: Low]
Coverage gap: no hover/focus-state evidence was captured for any control in this telemetry batch
- **Where:** N/A — `MANIFEST.md`'s captured kinds are all `still`/`filmstrip` at rest, mount, or
  click-settled states; no `:hover`/`:focus-visible` variant stills exist for buttons, chips,
  gadget-rail icons, or window traffic lights.
- **Problem:** I cannot confirm or deny hover/focus states exist and are legible (a stated requirement
  of this lens — "does every control show hover/active/focus/disabled/loading?") from this evidence
  set alone; I did confirm disabled states extensively (INT-5/6/7/22) and hover-only content
  discoverability (INT-18), but true `:hover`/`:focus-visible` treatment on interactive chips,
  gadget-rail glyphs, and window chrome remains unverified. Flagging as an explicit gap rather than
  silently skipping it.
- **Fix:** A follow-up capture pass with `:hover`-forced and keyboard-tab-focus stills per control
  family (decision chips, gadget-rail icons, composer buttons, window traffic lights) would close
  this gap; note prior audit did flag "focus-ring contrast" as a v1 finding, suggesting focus states
  were checked, so hover specifically is the narrower remaining unknown.

### [INT-28] [Severity: Minor] [Effort: <1day] [Value: Med]
No client-side "still working" fallback if server-side stall detection is late or misses
- **Where:** Architecture-level, per CLAUDE.md's own front-end conventions section: *"The stall
  watchdog (`_startStallWatchdog`) is deliberately DISABLED — the server-side stall detector +
  auto-continue loop-breaker supersede the old 'still working?' banner."*
- **Problem:** This is a documented, deliberate trade — removing a client-side timeout banner in
  favor of trusting server-side recovery. From this lens (system-status visibility under latency),
  the risk is specifically the GAP case: if the server-side detector is itself delayed, mis-
  triggers, or the network path between client and server is the actual point of failure (not the
  LLM call itself), the player is left staring at a stream that has visibly stopped producing tokens
  with absolutely no client-side reassurance, countdown, or manual "nudge" affordance — only silence
  until the server eventually acts (or doesn't). This directly touches the brief's callout that "a
  desync reads as a glitch... high latency as lag." I cannot verify from static telemetry whether
  this gap is ever actually hit in practice (no stalled-stream capture exists in this batch) —
  confidence Medium, architecture-inferred rather than directly observed.
- **Fix:** Confirm the server-side detector's own worst-case latency bound (how long can a genuine
  stall go undetected server-side?) and, if that bound exceeds a few seconds, reintroduce a light,
  non-intrusive client-side "still working…" indicator that never claims to KNOW the state (unlike
  the old banner, which the team removed for a documented reason) — purely a "the wait is normal, not
  frozen" signal past some threshold.

### [INT-29] [Severity: Polish] [Effort: <1hr] [Value: Low]
Goodbye-message tone chips (warm/respectful/cold) carry no distinct visual treatment per tone
- **Where:** `desktop-09-decision-goodbye-message.png` — all three tone chips ("warm," "respectful,"
  "cold") render as identical neutral-gray pills, differentiated only by their text label.
- **Problem:** A small, low-cost missed opportunity rather than a defect: tone is an emotionally
  loaded choice (this message goes to a real, evicted "person" in the fiction), and every other
  color-coded status signal in this product (deal open/kept/broken, HIGH_STAKES risk badges) uses
  color purposefully. Leaving tone chips uniformly neutral is a minor consistency gap, not a
  functional problem — the player can still read the labels fine.
- **Fix:** Optional: a subtle warm/neutral/cool color hint per chip (e.g. amber/gray/blue) purely as
  reinforcing color-coding, matching the product's existing pattern of using color for status
  meaning elsewhere.

### [INT-30] [Severity: Minor] [Effort: <1hr] [Value: Med]
New-Season "Keep this houseguest" and "Recast from scratch" sit at near-equal visual weight for a materially unequal-stakes choice
- **Where:** `desktop-22-new-season.png` — "Keep this houseguest" (`ow-btn-prominent`, filled) and
  "Recast from scratch" (`ow-btn-secondary`, ghost/outlined) — `frontend/static/js/orwellNewSeason
  .js:117-118,148-158`.
- **Problem:** Steelmanned first: "Recast" IS correctly gated behind a `styledConfirm` danger dialog
  before it commits (verified in source, lines 152-157: *"This discards your current houseguest
  entirely... This can't be undone,"* `danger: true`) — so the actual error-PREVENTION mechanic is
  already solid and this is not a safety gap. The remaining, smaller point is presentation only: the
  two buttons are the standard primary/secondary pairing used throughout this design system for
  ordinary (non-destructive) either/or choices, giving no FIRST-GLANCE visual signal that one path
  is irreversible-identity-destroying and the other is a routine continue. A player relying on
  visual hierarchy alone (before the confirm dialog intervenes) doesn't get a hint of the asymmetry
  from the initial card.
- **Fix:** Low-priority polish: consider the same danger/ghost-with-warning-tint treatment already
  used for the Settings "Reset" button (`desktop-15-settings-account.png`'s red "Reset" pill) for
  "Recast from scratch," so the visual weight matches the consequence even before the confirm dialog
  appears.

---

## 3. CONSEQUENTIAL-ACT SAFETY

Audit of every binding/irreversible act reachable in this telemetry:

| Act | Confirmation | Undo | Clear status | Notes |
|---|---|---|---|---|
| Nominations | Yes — red "IRREVERSIBLE — BINDING" badge + explicit copy + disabled Confirm until legal | No (by design — real BB mechanic) | Yes — "✓ Locked in." + prefill cue | Solid. |
| Veto decision | Partial — copy only ("locked in, plays out"), no top badge | No | Yes | See INT-7: badge inconsistency undersells stakes vs. nominations. |
| Replacement nominee | Yes — badge + copy | No | Yes | Solid. |
| Eviction vote | Yes — badge + copy | No | Yes | Solid; secret-ballot design (per CLAUDE.md) means no per-voter attribution shown, consistent. |
| Final eviction (sole vote) | Yes — badge + copy | No | Yes | Solid. |
| Juror vote | Not directly captured as a still in this batch's full-schema detail beyond the transcript prompt line — assume parity with eviction-vote (same `HIGH_STAKES_KINDS` set); not independently re-verified visually. | No | Assumed Yes | Coverage gap: no dedicated juror-vote still with badge visible was independently pixel-checked. |
| Goodbye-message tone | No badge (reasonable — tone alone doesn't end a game state), copy clarifies "the tone is what binds" | No | Yes | Fine — see INT-29 for a polish-only note. |
| Recast from scratch (new season) | Yes — `styledConfirm` danger dialog, explicit "This can't be undone" copy | No (by design) | Assumed Yes (not captured post-click) | Solid; see INT-30 for a presentation-only nit. |
| **"New chat" via empty-composer Send/Enter** | **NONE** | Unclear — depends on whether it re-binds the canonical game session or orphans it | **NONE** — no toast, no dialog, silent state change | **INT-1 — the one real gap in this table.** Everything else in this product treats a consequential act with real ceremony; this one control, sitting on the single most-used button in the whole app, has none. |
| Reset progress (Settings > Account, "Danger Zone") | Presumed gated behind the same `styledConfirm` family used for `Reset progress`/season resets elsewhere (not independently re-verified by clicking through in this static-telemetry pass) | No (by design) | Not captured post-click | Coverage gap — flagged, not asserted as unsafe. |

**Bottom line:** this product's decision-card and destructive-settings machinery is unusually
disciplined about confirmation/undo/status for a two-week build — nomination through eviction is
genuinely well-guarded. The one real, serious gap is INT-1, precisely because it doesn't look like
a "consequential act" surface at all — it's dressed as the ordinary send button.

---

## 4. COGNITIVE-LOAD HOTSPOTS (first-timer, Sweller intrinsic vs. extraneous)

- **First paint of an active game (INT-23):** 6+ simultaneous surfaces (onboarding card, decision
  card, HUD table, presence list, gadget rail, composer) compete for attention with no sequencing —
  extraneous load stacked on top of the game's already-high intrinsic complexity (16-person social
  deduction).
- **Mobile viewport specifically (INT-13/14):** the same stacking problem loses most of its
  available vertical real estate, compounding load with an added navigation problem (where did my
  composer go?).
- **Vocabulary debt (INT-18):** deal mechanics (FINAL-2/PROTECTION/INFORMATION) are used before
  they're ever explained, and their only explanation is a hover-only tooltip unreachable on touch.
- **Reasoning leakage (INT-3):** the opt-in "Thinking" accordion, meant to be a transparency feature,
  risks handing curious first-timers literal internal tool/mechanism vocabulary that recontextualizes
  the "houseguests" as a program calling functions — the single fastest way to collapse the fantasy
  this product is built on.
- **Identity-recognition load (INT-4/24/25):** three independent surfaces (deals, presence list,
  cast avatars) all currently under-support recognition-over-recall for a cast of 15 strangers,
  forcing the player to hold names in working memory rather than recognize them visually.
- **Error-state vocabulary collapse (INT-2):** the one place cognitive load should be LOWEST (a
  confused player who just hit a wall) is exactly where the product currently hands over the densest
  workspace jargon of the whole app (slash commands, "endpoint," "model picker").

---

## 5. TOP 3 LAUNCH-BLOCKING (this journey)

1. **INT-1** — the empty-composer Send/Enter → silent "new chat" behavior. This sits on the single
   most-clicked control in the entire product, fires with zero confirmation, and its blast radius
   (does it orphan the canonical game session? per CLAUDE.md's own #1085/#1086 precedents, plausibly
   yes) is exactly the class of bug this team has already been burned by once. Fix is a one-line
   gate behind the existing `data-game-build` attribute.
2. **INT-2** — the engine-down recovery path ends in a raw workspace error message ("No chat session
   active... /help") delivered as if spoken by the game itself. This is the worst possible moment for
   an immersion break (the player is already frustrated/confused by an outage) and directly
   contradicts the substantial in-fiction work already done for every OTHER state of the same flow
   (holding card, banner, reconnecting copy).
3. **INT-4** — the Deals gadget's 100%-unidentified rows. If this reproduces on a live game (not just
   this seeded capture — flagged Medium confidence), it makes an entire tracked-mechanic gadget
   actively useless at the exact moment (mid-week social play) it's supposed to reduce the player's
   memory burden, which is the opposite of what a first-timer needs from this system.
