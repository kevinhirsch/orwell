# ORWELL — TASK FLOWS & JOURNEYS LENS (audit2 / exhaustive pass)

Builds on the prior journey pass (`scratchpad/audit/journey.md`, J-1..J-13, all in
`RANKED_MASTER.md`). Every finding below is NEW ground: either a different surface/flow, or a
materially deeper root-cause on a surface J-1..J-13 only glanced at (flagged explicitly where
that's the case). Evidence: `telemetry/` stills + filmstrips + MANIFEST/INDEX anomaly notes,
`j2-transcript.jsonl` / `transcript.jsonl` (two independent real-GLM-4.7 casting→premiere runs),
`journey-raw.txt`, and source in `frontend/static/js/*`, `frontend/src/agent_loop.py`,
`src/engine/momentPrompts.ts`, `src/surfaces/tools/registry.ts`.

## Index

| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| FLOW-1 | Major | <1hr | High | Engine-down "Go in anyway" → send produces a raw vendored-chatbot fallback ("Use `/help`...") inside an Orwell-narrator bubble | chat.js:734-738 |
| FLOW-2 | Major | <1day | High | Retrospective window can grow tall enough to collide with the persistent New-Season window at the season's climactic payoff | orwellRetrospective.js:70-78 / orwellNewSeason.js |
| FLOW-3 | Major | <1hr | High | "IRREVERSIBLE — BINDING" badge inconsistently applied across the same decision-card family | decision-card family (veto-decision, comp-intent, goodbye-message vs. nominations/eviction-vote/replacement) |
| FLOW-4 | Major | multi-day | High | The premiere meet-everyone gate has no check that an introduction actually happened — a real playthrough batch-satisfied all 15 in one no-op burst | src/surfaces/tools/registry.ts:31-32; j2-transcript.jsonl turn 4 |
| FLOW-5 | Major | <1hr | High | Premiere "Welcome to the house" card shows FACTUALLY WRONG copy through nominations/veto/eviction because its gate is `week===1`, not the premiere moment | orwellPremiereTutorial.js:84-92 |
| FLOW-6 | Major | <1day | Med-High | Non-admin/guest hits a true dead end at "No feed connected yet" — no actionable remedy, only button leads into FLOW-1 | orwellOnboarding.js:858-869 |
| FLOW-7 | Minor | <1hr | Medium | Decision card shows the literal string "Player" instead of the player's houseguest name in the comp-round roster line | comp-round decision card (`desktop-03-chat-home.png`) |
| FLOW-8 | Minor | <1day | Medium | "Your Deals" HUD falls back to a generic "A houseguest" label when a party name isn't resolved — all 3 rows hit this simultaneously in the captured state | orwellDeals.js:111-116 |
| FLOW-9 | Minor | <1hr | Medium | "Where You Are" HUD overloads "nearby": head = current room, body's "No one nearby" = adjacent rooms only — reads as self-contradictory | orwellPresence.js:14-18 |
| FLOW-10 | Minor | <1day | Medium | Mobile "A New Season" window covers ~75% of viewport with a translucent background the stale welcome card bleeds through | mobile-22-new-season.png |
| FLOW-11 | Minor | <1day | Low-Med | Mobile theme picker is functionally broken: unreachable trigger + mispositioned/clipped popup when force-opened | mobile-12-theme-window.png vs desktop-12-theme-window.png |
| FLOW-12 | Minor | <1day | Medium | No aggregate progress signal during tool-call-heavy turns (127s observed) — capped repeated identical beat chips, no "X of 15"/elapsed cue | orwellToolBeats.js:47-48,94 |
| FLOW-13 | Minor | <1hr | Medium | Two irreversible actions (recast-from-scratch, evicted fast-forward) skip confirmation silently if `window.styledConfirm` is ever absent | orwellNewSeason.js:152-158,231-237 |
| FLOW-14 | Minor | <1day | Low-Med | Room-occupant HUD list is an undifferentiated flat comma list (up to 14 names) with no grouping/prioritization | orwellPresence.js |
| FLOW-15 | Minor | <1day | Low | First production-cue call 404s before an identical retry succeeds on turn 1 — possible session-materialization race on the very first request | transcript.jsonl turn 0; adv2-fe.log:145 |
| FLOW-16 | Polish | <1day | Low | Idle "◉ Orwell / Type /setup" placeholder branding bleeds through behind mounted cards on ≥3 surfaces (chat home, engine-down landing, Diary Room entry) | desktop-03/16/25 stills |
| FLOW-17 | Polish | <1hr | Low | Nomination/replacement ceremony copy repeats a generic "only a legal move counts" disclaimer with no referent (candidates shown are already pre-filtered to legal) | nominations/replacement decision cards |
| FLOW-18 | Minor | <1hr | Low-Med | Settings window: "Shortcuts" tab shows active/highlighted while the "Account" panel is what's rendered | desktop-15-settings-account.png |

---

## Findings (full schema)

### [FLOW-1] [Severity: Major, arguably Blocker-tier] [Effort: <1hr] [Value: High]
Engine-down "Go in anyway" leads straight into a raw vendored-chatbot fallback message rendered as the narrator
- **Where:** `frontend/static/js/chat.js:734-738` (`_NO_SESSION_NOTE`); repro path: engine down or no
  model configured → holding card "The house is dark" / "No feed connected yet" → player clicks the
  app's own offered "Go in anyway" button → types a message → send aborts → the reply bubble
  (attributed to "Orwell", styled exactly like every other narrator reply) reads: *"No chat session
  active. You can:\n\n- Open the model picker in the chat box and pick a model\n- Use the `+` button
  in the model picker to add a model endpoint\n- Use `/help` to see all available commands"*.
  Evidence: `telemetry/desktop-27-send-fail-final.png`, `mobile-27-send-fail-final.png`,
  `desktop-26-send-fail-fNN.png` filmstrip.
  Corroborating anomaly note (MANIFEST.md): "Toast (OrwellNotice) requires an explicit id or it
  throws — surfaced as an ACTION-ERR before the id fix" — same family of raw-engineering-text-to-player
  failures around this error path.
- **Problem:** This is a guaranteed, deterministic reproduction (not model-dependent, unlike J-2/J-3) of
  exactly the failure class I9 forbids ("no engine/tool/app/system talk in anything the player sees").
  It fires at the single worst possible moment: right after the fiction has already told the player
  something is wrong ("Big Brother will return... this screen will clear the moment the feeds come
  back") and offered them a button to proceed anyway — the app's OWN affordance walks the player
  straight into a second, worse break. A first-timer who clicks "Go in anyway" (a completely reasonable
  thing to try) is taught, in their first minutes, that this "narrator" is actually a generic chatbot
  with a `/help` menu and a "model picker" — the single most damaging possible immersion break, because
  it retroactively recolors every subsequent narrator line as "just an AI chat app."
- **Differential:** Not a wording/prompt issue (no narration LLM is even involved in this path — it's a
  hard-coded FE string), not a rendering bug, not model-dependent. Purely a missed `ORWELL_GAME_BUILD`
  gate on one static string.
- **Confidence:** High (source-confirmed, screenshot-confirmed).
- **Fix:** Gate `_NO_SESSION_NOTE` behind `ORWELL_GAME_BUILD` with an in-fiction equivalent ("The house
  feed is still down — wait for the lights to come back, or ask your administrator to reconnect it.");
  never mention `/help`, "model picker", or "+ button" while the game build is active.

### [FLOW-2] [Severity: Major] [Effort: <1day] [Value: High]
The retrospective's "Untold Story" payoff window can visually collide with the persistent New-Season window
- **Where:** `frontend/static/js/orwellRetrospective.js:70-78` (slot `top-right`), `orwellNewSeason.js`
  (slot `bottom-right`); evidence `telemetry/stills/retro-untold-story__desktop__light.png` — the retro
  window's per-week vote-breakdown list ("Kiara Zavala votes for Isabel Fischer") visibly overlaps the
  New Season window's "Keep this houseguest / Recast from scratch... the casting interview runs again"
  copy directly beneath it, both legible-but-fighting in the same screen region.
- **Problem:** The code comment at orwellRetrospective.js:74-77 documents a PRIOR fix for exactly this
  class of bug ("the retrospective must NOT share a slot with the post-season New season window...
  stacking two windows in one corner shoved the second off-screen. Distinct slots ⇒ no shared stack").
  That fix addresses two windows in the SAME corner, but does not cap the retro window's height — a
  season with many weeks of votes/reveals renders a very tall top-right window that extends down far
  enough to overlap the separately-anchored bottom-right New Season window along the shared right edge.
  This is the vision brief's own headline moment: "(1) being genuinely blindsided by a plot you never
  saw — and later learning it was real, recorded, and fair all along" — the exact content that pays that
  off (the Untold Story reveal, the per-vote breakdown) is legibility-degraded by a second window's text
  bleeding through it.
- **Differential:** Not the same bug the code comment already fixed (that was same-corner stacking); this
  is cross-corner overlap from unbounded content height — a different, still-open root cause.
- **Confidence:** Medium-High (visually unambiguous in the still; root-cause inference — unbounded height,
  not re-triggering the fixed same-corner case — is well-supported by the fix comment's own scope, but
  not independently re-run live to isolate the exact trigger threshold).
- **Fix:** Cap the retrospective window body at a `max-height` with internal scroll (most OrwellWindow
  instances likely already do this — verify/apply), and/or have the window-kit's slot placement account
  for a currently-occupied window in the OPPOSITE corner if their bounding boxes would intersect at
  current viewport height, not just same-slot occupancy.

### [FLOW-3] [Severity: Major] [Effort: <1hr] [Value: High]
"IRREVERSIBLE — BINDING" badge is inconsistently applied across the decision-card family
- **Where:** Compare `telemetry/desktop-09-decision-nominations.png`, `-eviction-vote.png`,
  `-replacement.png` (all show the red "⚠ IRREVERSIBLE — BINDING" badge) against
  `-veto-decision.png`, `-comp-intent.png`, `-goodbye-message.png` (none show it), all same session/build.
- **Problem:** CLAUDE.md is explicit that the comp-intent declaration "cannot change retroactively," and
  the veto decision is equally final (use-it-or-not locks the field). Yet the ONE visual signal the
  product uses to say "this can't be undone" — a distinct red badge — appears on 3 of the 6 binding cards
  and not the other 3, with no principled distinction visible to the player (the goodbye-message card's
  own body text says "Pick a tone — that's what binds," i.e. it self-describes as binding, but doesn't
  get the badge). This is a Jakob's-Law / internal-consistency violation with a real consequence: a
  player who has learned "no badge = I can reconsider" from the veto/comp-intent/goodbye cards will carry
  that false expectation into moments that matter (declaring "throw" on a comp they didn't mean to throw,
  or picking a "cold" goodbye tone) and be caught off guard when it locks in exactly like a badged card would.
- **Differential:** Not a wording issue — the "Confirm — this is binding" button label and the "once you
  confirm it's locked in" body copy DO appear on all 6 cards; only the top-right badge chip is missing on
  3. Points to a single component-level prop (`irreversible: true`) not being set on those 3 card builders,
  not a design intent to differentiate stakes.
- **Confidence:** High (directly, repeatedly observed across 6 independent screenshots of the same card family).
- **Fix:** Set the same `irreversible`/badge flag on the veto-decision, comp-intent, and goodbye-message
  card builders as the other three; if there IS an intentional stakes tier (e.g., "the veto ceremony's
  replacement pick is worse than the veto decision itself"), make that tiering visible instead of binary
  present/absent.

### [FLOW-4] [Severity: Major] [Effort: multi-day] [Value: High]
The premiere's "meet everyone" gate has no check that an introduction actually happened
- **Where:** `src/surfaces/tools/registry.ts:31-32` (`premiereIntros`/`markHouseguestMet` descriptions —
  "mark a houseguest met the instant they have introduced their public self," enforced only by prompt
  wording); `frontend/src/agent_loop.py:2231-2292` (`_auto_mark_premiere_intros` — the FE belt that
  guards under-calling by name-matching narration text, but has no analog guarding OVER-calling).
  Live evidence: `j2-transcript.jsonl` turn 4 — immediately on `createCharacter`'s narrated walk through
  the front door, the model calls `premiereIntros` once, then `markHouseguestMet` for `npc:1` through
  `npc:15` sequentially, ALL in the same turn, while the accompanying narration only describes one
  general "living room is alive" scene (no per-person introductions for the 15 in that text).
- **Problem:** The whole point of the meet-everyone gate (feature #380, per CLAUDE.md and the vision's
  "15 strangers become distinct people") is to ensure the player has actually crossed paths with the
  cast before the game accelerates into competition. Nothing on the engine or FE side verifies that a
  `markHouseguestMet(id)` call corresponds to a real narrated introduction for that id — the FE belt at
  agent_loop.py:2231 only compensates for the model UNDER-calling (narrating but not marking); there is
  no symmetric guard against the model marking someone met who was never mentioned. In this real run the
  entire cast was marked "met" in one tool-call burst on the very first premiere turn, so the HUD (see
  `desktop-04`/`desktop-06`, "The House · 16/16") reports full completion while the actual social-runway
  pacing the mechanic exists to guarantee never happened for most of the 15. This directly undercuts I6
  ("15 strangers become distinct people") and the "unhurried social runway... lingering is play" fantasy:
  the mechanic that's supposed to GUARANTEE unhurried pacing can be, and was, defeated in one shot.
- **Differential:** Distinct from J-12 (which only critiqued the counter's WORDING as "gamey") — this is
  about the gate's INTEGRITY being bypassable, a materially deeper and more consequential problem: J-12's
  fix (softer copy) does nothing for FLOW-4, since the gate would still complete instantly regardless of
  phrasing. Also distinct from the other-run evidence (`transcript.jsonl`), where the same model called
  `premiereIntros` and `markHouseguestMet` more incrementally alongside real per-NPC `npcVoice` calls —
  confirming this is model-behavior-dependent (turn-budget/temperature sensitive) rather than guaranteed
  every game, but the failure mode is real and was captured on a real GLM-4.7 run.
- **Confidence:** High that the bypass occurred in this run (direct tool-call sequence in the transcript);
  Medium on how often it recurs across seeds/models (only 2 independent runs available, one hit it, one
  did not).
- **Fix:** Cross-check `markHouseguestMet(id)` against the current turn's (or a short rolling window's)
  narration/tool history for evidence of an actual interaction with that id (a `npcVoice` call, a
  name-match in narration, or a `recordInteraction` witnessing them) before accepting it — mirroring the
  FE's existing name-match logic in `_auto_mark_premiere_intros`, but as a REJECTION gate on the model's
  own calls rather than only a fallback for omissions. At minimum, cap how many houseguests can be
  marked met in a single turn (e.g., 1-3), since no real premiere beat introduces 15 people in one breath.

### [FLOW-5] [Severity: Major] [Effort: <1hr] [Value: High]
Premiere welcome card shows factually wrong copy for most of Week 1, not just "stale" — because its gate is the wrong signal
- **Where:** `frontend/static/js/orwellPremiereTutorial.js:84-92` (`isPremiereWeek` — returns true for
  ANY moment as long as `week === 1`, including nominations/veto-competition/veto-ceremony/eviction).
  Evidence: the card ("You'll need to cross paths with all fifteen houseguests before Production calls
  the first HOH competition") is shown, unmodified, stacked with a LIVE comp-round-2 card
  (`desktop-03-chat-home.png`), a nominations card (`desktop-09-decision-nominations.png`), a
  veto-decision card (`-veto-decision.png`), a replacement card (`-replacement.png`), and an
  eviction-vote card (`-eviction-vote.png`) — five independent decision states, all still Week 1, all
  still showing this card claiming the HOH competition hasn't happened yet.
- **Problem:** This is a corroborating-but-materially-deeper finding vs. the prior pass's J-6 ("stale card
  persists after 16/16 met" / RANKED_MASTER B-5), which only evidenced ONE later state (implicitly, a
  live HOH comp already running) and characterized the problem as staleness. The source shows this isn't
  a narrow edge case: the card is DESIGNED to survive the entire rest of Week 1 by a `week===1` check that
  has no relationship to whether the meet-everyone/premiere moment is actually still active. Its own
  code comment (`J5-16 (J4-27)`) proves the team already fixed one version of this exact defect class
  ("mounted — never removed... kept rendering... all the way to the finale") but the fix's gate
  (`week===1`) is too coarse — it correctly removes the card at Week 2, but leaves it actively WRONG (not
  just present) through 4-5 major beats of Week 1 (HOH comp, noms, veto comp, veto ceremony, eviction),
  each of which directly contradicts the card's own claim.
- **Differential:** Confirmed via source, not inference — `isPremiereWeek` literally does not read
  `moment` (except to exclude `post-season`) or the meet-everyone completion flag; it is a raw week
  number check. Rules out a rendering/z-order issue (this is a logic gate, not a stacking-context bug).
- **Confidence:** High (source-read, cross-corroborated by 5 independent screenshots).
- **Fix:** Tie `isPremiereWeek`'s truthiness to `moment === "premiere"` (or the meet-everyone `complete`
  flag from `premiereIntros`), not raw `week === 1` — the card should disappear the instant the first HOH
  competition begins, matching its own claimed condition.

### [FLOW-6] [Severity: Major] [Effort: <1day] [Value: Med-High]
Non-admin/guest hits a genuine dead end with zero actionable remedy
- **Where:** `frontend/static/js/orwellOnboarding.js:858-869`; evidence
  `telemetry/stills/holding-card__desktop__light.png` (account shown: "guest01").
- **Problem:** When no chat model is configured, an admin sees a card with a working "Open Settings"
  button (`admin ? [{label:"Open Settings", primary:true, onClick: openSettings}] : []`). A non-admin
  gets ONLY the text "Ask your administrator to connect a model" and the single button that exists on
  every holding card regardless of role: "Go in anyway." There is no in-app path for a guest to know
  WHO their administrator is, no contact affordance, and no way to self-serve — and the one thing they
  CAN click leads directly into FLOW-1's broken chatbot-fallback experience. For a product whose
  architecture explicitly supports "unlimited users concurrently, each fully isolated," a non-admin
  player's only recourse for the single most basic prerequisite (a working feed) is to leave the app
  and find a human out-of-band.
- **Differential:** This is a genuine information/affordance gap, not a technical bug — the underlying
  cause (LLM config is admin/global, not per-user) may be an intentional architecture choice for a
  typically single-operator self-host. The finding is about the UI not reflecting that reality honestly
  (no "this app requires an administrator to have already set it up — check back later" framing that
  doesn't imply the player themselves has a next action they can't actually take).
- **Confidence:** High (source-confirmed asymmetry between admin/non-admin branches).
- **Fix:** Either surface a real contact/notify-admin affordance (e.g., a mailto or an in-app "notify
  admin" ping) for non-admins, or — simpler — make the copy honest that there is no player-side action
  ("Casting starts as soon as the house is wired up — nothing to do here yet") rather than an instruction
  ("ask your administrator") the player often cannot act on themselves (multi-tenant deploys, family/friend
  invites, etc.).

### [FLOW-7] [Severity: Minor] [Effort: <1hr] [Value: Medium]
Decision card displays the literal string "Player" instead of the player's own houseguest name
- **Where:** comp-round decision card, `telemetry/desktop-03-chat-home.png`: body text correctly reads
  "Still in with you: Vincent Campos, Wade Shea, Asher Manning, Ethan Fitzgerald" but the roster line
  directly below reads "Round 2 — Still in: Vincent Campos, Wade Shea, Asher Manning, **Player**, Ethan
  Fitzgerald" — the literal token "Player" where the player's own cast name belongs.
- **Problem:** Two different formatting code paths for the same underlying roster (prose sentence vs. the
  compact "Still in:" line) disagree on how to render the player's own entry — one substitutes "you," the
  other doesn't substitute at all. This is a direct, visible machinery leak (an internal placeholder
  string surfacing in player-facing copy) in the exact card where the player is being asked to make (or
  re-confirm) a real competitive choice — a small but real dent in "the machinery is invisible" (I9) at a
  moment of engagement.
- **Differential:** Template/formatting bug, not a data bug — the correct name IS available (used one line
  above in the same card).
- **Confidence:** High (directly visible, unambiguous).
- **Fix:** Route the roster-line renderer through the same name-resolution helper the prose sentence uses
  (substitute the player's own houseguest name, or "You," consistently in every roster/list rendering).

### [FLOW-8] [Severity: Minor] [Effort: <1day] [Value: Medium]
"Your Deals" HUD can render every entry as the generic "A houseguest" placeholder
- **Where:** `frontend/static/js/orwellDeals.js:111-116` (`otherParty` — falls back to the literal string
  `"A houseguest"` when `them.name` is falsy); evidence `telemetry/desktop-04-gadget-rail-docked.png` /
  `desktop-05-gadget-deals.png` — all three listed deals ("FINAL-2," "PROTECTION," "INFORMATION") show
  "A houseguest" instead of a name.
- **Problem:** The Deals panel's entire reason to exist is answering "who do I have a pact with, and
  what kind" at a glance — exactly the kind of task-support tool Tesler's Law says should absorb
  complexity FROM the player (tracking scheme state across a long, socially complex game) rather than
  push it back onto them. A panel that can silently show "A houseguest" for every row (with no error,
  loading, or "resolving..." state) is worse than no panel: it looks populated and authoritative while
  providing zero actionable information, and a player who trusts it at a glance could act on a
  misremembered deal partner from chat scrollback instead.
- **Differential:** This is a code-confirmed fallback path, but whether it's reachable in normal live
  play (vs. only this synthetic/seeded telemetry capture, where deal-party name data may not have been
  seeded) is uncertain — I could not confirm via the real-model transcripts (neither `journey.md` nor
  `j2/transcript.jsonl` opened the Deals gadget). Flagging at Medium confidence pending a live-play check.
- **Confidence:** Medium (code path confirmed; live-reachability not independently verified).
- **Fix:** Investigate when `deal.parties[].name` can be absent in live play (a race before the roster/name
  cache warms? a deal recorded before a name resolves?) and either block-render the deal until the name
  resolves, or surface an explicit "resolving…" state instead of the misleading placeholder.

### [FLOW-9] [Severity: Minor] [Effort: <1hr] [Value: Medium]
"Where You Are" HUD overloads the word "nearby" with two different meanings three lines apart
- **Where:** `frontend/static/js/orwellPresence.js:14-18` (design comment: HEAD = current room + who's
  with you; BODY = ADJACENT rooms, "No one nearby." when nothing adjacent has anyone). Evidence:
  `telemetry/desktop-03-chat-home.png` sidebar — "Living Room — Lola, Michelle, Karl, Vincent, Courtney,
  Ethan, Hassan, Wade, Mia, Jada, Eliana, Trey, Fabian, Victoria, Asher" immediately followed by, in the
  same small card, "*No one nearby.*"
- **Problem:** By design these are two different scopes (current room vs. adjacent rooms), which is a
  reasonable underlying model — but the copy gives a first-time reader zero signal that "nearby" in line
  2 means something narrower/different than the 14-person room list one line above it. Read as plain
  English, "here are 14 people in your room" followed by "no one nearby" is a direct contradiction. This
  is a recognition-over-recall failure: the player must already know the app's internal room-adjacency
  model to parse a card whose entire job is to be glanceable.
- **Differential:** Not a bug in the underlying logic (the two numbers ARE both individually correct per
  their own definitions) — purely a labeling/wording gap.
- **Confidence:** High (directly evidenced; the source comment confirms the intended semantic split).
- **Fix:** Relabel the body line's scope explicitly — e.g. "Nearby rooms: none occupied" or "Next door:
  quiet" — so the word "nearby" is never used to mean two different things in the same small card.

### [FLOW-10] [Severity: Minor] [Effort: <1day] [Value: Medium]
Mobile "A New Season" window: legibility and prominence mismatched to its stakes
- **Where:** `frontend/static/js/orwellNewSeason.js` (slot `bottom-right`, `closable:false`); evidence
  `telemetry/mobile-22-new-season.png`.
- **Problem:** On a 390×844 viewport this non-closable, must-eventually-resolve window occupies roughly
  three-quarters of the vertical viewport, its body rendered over a translucent background through which
  the stale "Welcome to the house" card's text ("Talk to anyone, wander any room...") is legible directly
  behind the "This season's portrait" section — a genuine legibility collision on the smallest screen
  where there's no room to spare. The Diary Room banner and composer are compressed into a thin strip at
  the very bottom. This is the single most consequential meta-decision in the product (an irreversible
  choice between keeping vs. discarding the player's entire houseguest identity, confirmed via its own
  `styledConfirm` dialog per FLOW-13) getting the LEAST legible presentation of any surface reviewed on
  mobile.
- **Differential:** Distinct from the general "idle branding bleeds through" pattern (FLOW-16) in that
  this is a specific, high-stakes, non-dismissible gate rather than an ambient placeholder — worth its
  own severity given the decision's weight.
- **Confidence:** Medium-High (visually clear; exact opacity/z-index root cause not independently isolated
  in devtools).
- **Fix:** On narrow viewports, present this window as a full-bleed sheet with an opaque (not translucent)
  background, and/or add a scrim behind it so background chat content cannot bleed through visually while
  it's the active gate.

### [FLOW-11] [Severity: Minor] [Effort: <1day] [Value: Low-Medium]
Mobile theme picker: an incompletable task
- **Where:** `telemetry/mobile-12-theme-window.png` / `mobile-12b-theme-open-f00.png` vs.
  `telemetry/desktop-12-theme-window.png` (a full, well-designed theme grid: "glass," "the feed,"
  "telescreen," "room 101," "memory wall," "sequester"). MANIFEST.md anomaly note: "Mobile: #tool-theme-btn
  not directly clickable (sidebar collapsed); reachable only via JS seam — verify the mobile theme entry
  affordance."
- **Problem:** Two compounding failures: (1) the natural trigger for opening the theme picker isn't
  reachable on mobile without the sidebar open (itself a nonstandard/hidden path for a first-timer), and
  (2) when force-opened via the JS seam for capture, the resulting popup renders as a small, mispositioned,
  content-clipped box in the top-left corner overlapping the header — none of the desktop's theme grid is
  visible. A mobile player cannot complete "change the app's look" as a task at all right now.
- **Differential:** Cross-territory with mobile/responsive and visual-hierarchy lenses — flagging here
  because the CONSEQUENCE is a task-completion dead end (Value low for the core game loop, since theming
  is cosmetic, but real for anyone who tries).
- **Confidence:** Medium (corroborated by an independent capture-time anomaly note plus my own screenshot
  comparison; did not independently debug the exact CSS/positioning cause).
- **Fix:** Give the theme window a mobile-specific full-width sheet layout (matching the pattern other
  windows already use, per `mobile-08-gadget-finale.png`'s pinned-cast pagination), and surface its
  trigger somewhere reachable without first opening the sidebar.

### [FLOW-12] [Severity: Minor] [Effort: <1day] [Value: Medium]
No aggregate progress signal during long tool-call-heavy turns (Doherty's Law)
- **Where:** `frontend/static/js/orwellToolBeats.js:47-48` (`premiereIntros` → "👋 Meeting the house",
  `markHouseguestMet` → "🤝 First impressions"), `:94` (`ORWELL_MAX_VISIBLE_BEATS = 10`). Real-play timing:
  `j2-transcript.jsonl` turn 4 (the premiere-entry turn, 15× `markHouseguestMet`) took **127.4 seconds**;
  the prior pass's J-2 separately measured a 77s turn.
- **Problem:** During a turn like this, the player's only feedback is a capped stack of up to 10 repeated,
  visually-identical "🤝 First impressions" chips — no count ("3 of 15"), no elapsed-time indicator, and
  (per the beat-cap comment) older chips silently drop off once the cap is hit, so the rail can't even be
  read as a literal log of what happened. For a first-time player, this is their second-ever turn (right
  after character creation) sitting in 2+ minutes of ambiguous, seemingly-stalled activity — a serious
  drop-off risk exactly at the point the game most needs to hook them, and a canonical Doherty's-Law
  violation (system response feedback should scale with wait length; here it doesn't scale at all past
  10 near-identical chips).
- **Differential:** Distinct from J-2 (empty non-narration after a stall) — this is about turns that DO
  eventually complete successfully but with poor-quality progress feedback throughout a long wait.
- **Confidence:** Medium-High (timing directly measured in two independent real-model runs; the beat-chip
  behavior is source-confirmed, though I did not capture a screenshot of the beat rail mid-flood).
- **Fix:** For repeated identical beats in one turn, collapse them into a single chip with a live counter
  ("🤝 First impressions ×7") rather than up to 10 stacked duplicates; consider a soft elapsed-time cue
  ("still talking to the house…") once a turn exceeds a few seconds, consistent with how the "Thinking"
  accordion is already surfaced for reasoning.

### [FLOW-13] [Severity: Minor] [Effort: <1hr] [Value: Medium]
Two irreversible actions silently skip confirmation if a global helper is missing
- **Where:** `frontend/static/js/orwellNewSeason.js:152-158` ("Recast from scratch") and `:231-237`
  ("See how it ends" / evicted fast-forward) — both guarded by `if (window.styledConfirm) { ... }`, with
  no `else` branch; if `styledConfirm` is undefined/fails to load, `startNextSeason(keep=false, ...)` (or
  `conclude-season`) fires immediately with no confirmation at all.
- **Problem:** Both actions are explicitly, permanently destructive per their own confirm copy ("This
  discards your current houseguest entirely... This can't be undone" / "You can't return to play them
  out. This can't be undone.") — exactly the class of action a confirm-gate exists to protect. A missing
  or late-loading global (script-load-order regression, ad-blocker/CSP edge case, etc.) silently removes
  the safety net rather than blocking the action or falling back to a native `confirm()`.
- **Differential:** A robustness/fail-safe design gap, not something observed to have actually fired in
  the captured telemetry (both confirm dialogs appear to load fine in a normal boot).
- **Confidence:** Medium (code-clear; not observed live).
- **Fix:** Fail closed, not open — if `window.styledConfirm` is unavailable, fall back to the browser's
  native `confirm()` rather than skipping confirmation outright.

### [FLOW-14] [Severity: Minor] [Effort: <1day] [Value: Low-Medium]
Room-occupant HUD is an undifferentiated flat list at exactly the point the player needs to prioritize
- **Where:** `frontend/static/js/orwellPresence.js`; evidence `desktop-03-chat-home.png` — "Living Room —
  Lola, Michelle, Karl, Vincent, Courtney, Ethan, Hassan, Wade, Mia, Jada, Eliana, Trey, Fabian, Victoria,
  Asher" (14 names, one flat comma list, no grouping).
- **Problem:** A first-timer scanning a crowded room for "who's worth approaching" (an unmet houseguest?
  a recent scene partner? an ally?) faces an undifferentiated 14-way choice with zero prioritization
  cues — a Hick's-Law cost spike at exactly the moment lingering/social-runway play is supposed to feel
  inviting rather than overwhelming.
- **Differential:** A design-completeness gap rather than a bug — the underlying data (who's met, who has
  an active deal, etc.) exists elsewhere in the HUD (Deals gadget, Cast gadget) but isn't cross-referenced
  here.
- **Confidence:** Medium (a design judgment, not a code-confirmed defect).
- **Fix:** Consider a light visual distinction for not-yet-met houseguests within the room list (the
  premiere-specific case where it matters most), without exposing anything hidden (Vault-free — this is
  public roster + already-tracked meet-status only).

### [FLOW-15] [Severity: Minor] [Effort: <1day] [Value: Low]
First production-cue send 404s before an identical retry succeeds
- **Where:** `transcript.jsonl` turn 0 (`{"error": "HTTP 404"}` on the very first
  `chat_stream` POST) vs. turn 1 (identical `msg`, succeeds, 10.6s). Corroborating log:
  `adv2-fe.log:145` — `"POST /api/chat_stream HTTP/1.1" 404 Not Found`.
- **Problem:** If reachable by a real client (not just this test harness), a brand-new player's very
  FIRST request to the app could 404 with no automatic client-side retry, landing them on either a
  visible error or, worse, silence with no visible cause — the single worst place in the whole journey
  for a failed request (turn zero, before any trust has been built).
- **Differential:** Plausibly a harness artifact — the driver script may have posted to `/api/chat_stream`
  before completing the normal session-bootstrap sequence the real UI performs (e.g., before a session id
  materializes), which a real browser client wouldn't do. I could not confirm from the available logs
  whether the real chat.js client has a code path that could hit this same race (e.g., a double-submit,
  or a page that finished its onboarding JS before the session endpoint responded).
- **Confidence:** Low-Medium (real, reproduced once; harness-vs-product ambiguity not resolved).
- **Fix:** Low-cost regardless of root cause: wrap the first `chat_stream` POST per session in one
  automatic retry-on-404, and/or confirm (via a live client trace, not this harness) whether the FE ever
  issues a chat POST before its own session-creation call has resolved.

### [FLOW-16] [Severity: Polish] [Effort: <1day] [Value: Low]
Idle placeholder branding bleeds through behind mounted cards on multiple surfaces
- **Where:** `telemetry/desktop-03-chat-home.png` (welcome card over "Type /setup to get started");
  `desktop-16-diary-room.png` (a faint duplicated "◉ Orwell" watermark visible through/behind the welcome
  card while in Diary Room mode); `desktop-25-error-engine-down.png` ("Type /setup to get started" /
  "Production needs a feed source" visible faintly through the dark-house scrim). Also independently
  called out in MANIFEST.md's own anomaly notes for the chat-home and error-landing instances.
- **Problem:** Not a single bug but a recurring pattern across at least 3 distinct surfaces: the
  empty-conversation idle branding doesn't fully clear/hide once cards are mounted over it, so
  supposedly-populated, sometimes high-stakes screens (Diary Room entry, an engine-outage holding
  screen) show a faint ghost layer underneath. The journey consequence is a repeated, low-grade "is this
  screen actually in the state it claims to be?" flicker of doubt at moments (entering Diary Room, an
  error state) where the product most needs to read as stable and intentional.
- **Differential:** Likely a shared z-index/visibility root cause (the idle-state component not being torn
  down/hidden when a card mounts) rather than three unrelated bugs — cross-flagging to the visual-hierarchy
  lens, since the pixel-level fix is theirs, but noting it here because the JOURNEY cost (confidence in
  screen state) is real.
- **Confidence:** Medium (visually evidenced on 3 surfaces; not traced to one shared component in source).
- **Fix:** Audit the idle/empty-state branding component for a single teardown hook that fires whenever
  any card/window mounts over the conversation area, rather than relying on each card's own z-index.

### [FLOW-17] [Severity: Polish] [Effort: <1hr] [Value: Low]
Gratuitous "only a legal move counts" disclaimer with no referent
- **Where:** nomination ceremony card ("Select 2 — only a legal move counts. Once you confirm, it's
  locked in and plays out — there's no taking it back.") and the veto-ceremony replacement card (same
  phrasing pattern); `desktop-09-decision-nominations.png` / `-replacement.png`.
- **Problem:** The candidate buttons shown are already pre-filtered to legal choices (the HOH, veto
  winner, etc. are excluded), so "only a legal move counts" has nothing for the player to map it to —
  it reads as boilerplate rather than useful guidance, adding a small reading-cost tax to an already
  text-dense, high-stakes card without adding information.
- **Differential:** Copy/microcopy nit, not a functional issue — low value, included for completeness at
  the exhaustive-pass mandate's request.
- **Confidence:** Medium (a judgment call on copy usefulness, not a defect).
- **Fix:** Drop the "only a legal move counts" clause (the pre-filtered button list already guarantees it)
  and keep only the binding/irreversibility sentence.

### [FLOW-18] [Severity: Minor] [Effort: <1hr] [Value: Low-Medium]
Settings window: active tab highlight doesn't match rendered content
- **Where:** `telemetry/desktop-15-settings-account.png` — left nav shows "Shortcuts" highlighted/active
  (blue underline) while the main panel renders "Account" content (Account / Profile picture / Danger
  Zone).
- **Problem:** If this reflects real behavior (vs. a capture-timing artifact — see confidence note), it's
  a direct violation of visibility-of-system-status: the player has no reliable way to tell which settings
  section they're actually looking at, which matters most in exactly the section shown (Danger
  Zone → "Reset progress... Irreversible") where being sure of context before clicking a destructive
  button matters.
- **Differential:** Possible false positive — the capture script may have clicked "Account" immediately
  after "Shortcuts" and screenshotted mid-transition before the highlight updated. I did not independently
  reproduce this live.
- **Confidence:** Low-Medium (single static capture, plausible capture-timing artifact; flagging for
  verification rather than as a certain defect).
- **Fix:** Verify live whether clicking "Account" updates the left-nav highlight synchronously; if there's
  a lag or a stuck-highlight bug, fix the tab-active-state binding.

---

## Cross-territory flags
- **FLOW-1, FLOW-6:** overlaps prompt/immersion + backend lenses (an FE-only, non-LLM-dependent I9 break —
  worth flagging as a guaranteed-repro item, unlike most narration-seam findings which are model-dependent).
- **FLOW-2:** overlaps visual-hierarchy/windowing lens (OrwellWindow slot-collision system).
- **FLOW-4:** overlaps prompt/behavioral-fidelity + backend lenses (a structural gate-integrity gap in the
  MCP tool surface, `src/surfaces/tools/registry.ts`).
- **FLOW-8, FLOW-13:** overlaps backend/data-integrity lens (name-resolution race; confirm-dialog dependency).
- **FLOW-10, FLOW-11, FLOW-16:** overlaps mobile/responsive + visual-hierarchy lenses (legibility/z-index/
  viewport-adaptation root causes; I've framed the journey CONSEQUENCE, not the pixel fix).
- **FLOW-12:** overlaps a11y/perf lens (latency measurement corroborates J-2's timing data point from the
  prior pass with a second, independent 127s sample).

## Coverage
**Looked at:** OOBE/holding-card gate (admin + non-admin), model-setup wizard, casting interview (two
independent real-GLM-4.7 transcripts), premiere entry + meet-everyone gate (source + live tool-call
sequences), full decision-card family (comp-intent, comp-round, nominations, veto-decision, replacement,
eviction-vote, goodbye-message, juror-vote, juror-question, finale-statement, final-eviction) on both
desktop and mobile, the gadget rail (status/deals/presence/cast/finale) and its HUD copy, Diary Room entry,
theme picker (desktop + mobile), settings tabs, new-season/keep-recast flow (source-level), evicted-player
fast-forward flow (source-level), retrospective/untold-story window, engine-down and mid-turn-send-failure
error states (desktop + mobile, plus filmstrips), toast lifecycle, streaming/thinking-accordion states, and
the beat-chip/tool-progress feedback system.

**Did NOT cover / lower confidence:** live-reload/resume mid-decision-card (no telemetry captured for this
specific case); the two-window realtime-mirror journey under a real model (out of scope — the ship-gate's
own prior F1-F5 pass covers it); the FLOW-8/FLOW-15/FLOW-18 items are flagged at Medium/Low confidence
specifically because I could not independently re-drive them live to rule out capture-harness artifacts —
each says so explicitly and should be spot-checked before being treated as launch-blocking. Did not open
the "gadget-deals"/"gadget-status" dedicated captures (both returned the same DOM state as "gadget-cast" —
likely a capture-script failure on those two steps, not a product finding) — the Deals HUD content was
instead sourced from the `gadget-rail-docked` still.
