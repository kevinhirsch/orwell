# CASTING / FIRST-10-MINUTES — deep-lane findings

Territory: the entire first-run experience end to end — OOBE/model-gate, the setup wizard, the
casting interview (`src/engine/castingIntake.ts`, `CASTING_INTERVIEW_PROMPT` in
`src/engine/momentPrompts.ts`), the headshot studio (`orwellHeadshot.js`), the casting→premiere
framing seam (`frontend/routes/chat_helpers.py::apply_game_framing`), the premiere prompt
fragment + the meet-everyone gate (`#380`), the finalize handshake
(`_CASTING_NUDGES`/`_CASTING_STALL_LEVEL` in `frontend/src/agent_loop.py`), and the first HOH
ramp (comp-intent decision card). Read against `VISION_BRIEF.md`'s core fantasy ("casting
interview that feels like being *cast*, not configured → premiere where 15 strangers become
distinct people") and I1–I10/C1–C6.

Primary evidence sources: source reading (as above) + a REAL-MODEL playthrough transcript
(`scratchpad/audit2/j2-transcript.jsonl`, 21 turns, casting → premiere → first HOH) + the
telemetry stills/filmstrips in `scratchpad/audit2/telemetry/` (noting: that capture rig seeds the
engine directly to a mid-week-1 state and force-mounts onboarding overlays via a JS seam for
screenshot purposes — several onboarding+decision-card *combinations* in those stills are capture
artifacts, not reachable game states; I verified each stacking claim below against the actual
gating code before treating it as real).

## Index

| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| CAST-1 | Blocker | <1day | High | Off-screen knowledge fabricated on premiere night — an NPC "reads" a secret she was never given a pathway to | real transcript turn 12; `momentPrompts.ts:1058-1060` |
| CAST-2 | Blocker→Major | <1day | High | All 15 premiere introductions fire in ONE uninterruptible turn — no per-turn cap exists | real transcript turn 4; `agent_loop.py:2231-2292`; `momentPrompts.ts:582-595` |
| CAST-3 | Major | <1day | High | The premiere's 4 designed beats collapse into 2 total turns before any real player agency | real transcript turns 4-5; `momentPrompts.ts:602-631` |
| CAST-4 | Major | <1day | High | The casting interview finalizes on field-coverage, not depth — a real playthrough is "cast" in 3 exchanges | real transcript turns 1-3; `castingIntake.ts:249-272`; `agent_loop.py:1650-1704` |
| CAST-5 | Major | <1hr | Med | "THE TELLS" — the richest named interview theme — is the only theme gated by nothing, so it's the one most likely skipped entirely | `momentPrompts.ts:505-513` vs `castingIntake.ts:249-260` |
| CAST-6 | Major | <1hr | High | The "orient the first-timer" tutorial-cadence instruction lives ONLY in the premiere fragment and vanishes before the beats it's meant to cover ever fire | `momentPrompts.ts:620-623,632,639-654` |
| CAST-7 | Major | <1day | High | The game never teaches its own core verbs (confide/ally/deal) to the player — `/help` under the game build lists zero gameplay | `slashCommands.js:5420-5461,5903-5911`; `momentPrompts.ts:349-400` |
| CAST-8 | Major | <1hr | High | The first HOH comp-intent card presents "compete / throw / play-safe" with zero explanation, anywhere upstream, of what they mean | `orwellDecision.js:41,307,538-544`; screenshot `desktop-09-decision-comp-intent.png` |
| CAST-9 | Major | <1day | Med | On mobile, the premiere guide card + the first decision card share an uncapped stacking zone and crush the composer | `orwellNotice.js:62,458-468`; `style.css:2114-2119`; screenshot `mobile-09-decision-comp-intent.png` (real combo, not synthetic) |
| CAST-10 | Major | <1hr | Med | The pre-game setup wizard is the very FIRST screen and frames the game as picking a "Narrator model" / "Portrait model" before any casting fiction begins | `orwellOnboarding.js:257-404` |
| CAST-11 | Minor | <1hr | Med | "Auto-detect (Gemini)" names a real third-party AI brand on the first screen of the game | `orwellOnboarding.js:282,324` |
| CAST-12 | Minor→Major | <1day | Med | Photo-first ordering: the producer's literal opening ask is "let's see the face," before even a name | `castingIntake.ts:56-63`; `momentPrompts.ts:535-547`; real transcript turn 0 |
| CAST-13 | Polish | <1hr | Low | "Choose Your Character" reads like a video-game avatar-select CTA, clashing with the "being cast" register everywhere else | `orwellHeadshot.js:137-156,625-627` |
| CAST-14 | Minor | <1hr | Low | `CASTING STATUS` "NEXT STEP" can surface a producer-internal-only field (archetype/strategyStyle mapping) phrased as if it were a question for the player | `castingIntake.ts:71-72,212-235`; `momentPrompts.ts:855` |
| CAST-15 | Minor | <1hr | Med | The J4 "No feed connected yet" holding card's "Go in anyway" leads a non-admin into a chat that cannot function, with no in-fiction explanation (unlike the engine-down case) | `orwellOnboarding.js:858-869`,`chat_helpers.py:124-143` |
| CAST-16 | Minor | <1day | Med | The finalize-fallback belt is asymmetric: it aggressively forces speed once the floor is met, with no symmetric belt defending interview depth | `agent_loop.py:1650-1704` |
| CAST-17 | Minor | <1hr | Low | The producer's own seeded interrogation "quirk" (circle back / repeat a loaded word / track contradictions) is asserted in the prompt but never actually exercised once the floor is met | `producerPersona.ts:74-82`; real transcript |
| CAST-18 | Polish | <1hr | Low | Premiere's 15 introductions are cookie-cutter identical in structure (name → city → job → visible scar/detail → one quip → room reaction) despite varied content | real transcript turn 4 |
| CAST-19 | Minor | <1hr | Low | The welcome/tutorial card's "cross paths with all fifteen" copy describes an experience the engine's own scripted producer-led roll call never actually delivers | `momentPrompts.ts:582-595`; `orwellPremiereTutorial.js:158-166` |
| CAST-20 | Polish | <1hr | Low | The "Choose Your Character" / cast-photo producer line is the one moment the in-fiction producer voice names a literal on-screen UI control ("that button below this message") | `momentPrompts.ts:535-547` |
| CAST-21 | Minor | <1day | Med | Truncation-risk is compounded by the same uncapped-intros root cause: a smaller-budget model doing the same 15-in-one-turn dump risks cutting off mid-introduction and soft-locking the meet-everyone gate | cross-ref prior finding J-11/PROMPT-2; `agent_loop.py:2231-2292` |
| CAST-22 | Minor | <1hr | Low | `castingFinalizable`'s ANY-OF-1 gate means a player who answers only "how they'll come across" (persona) can finalize having said NOTHING about actual strategy or private plans | `castingIntake.ts:256-271` |
| CAST-23 | Minor | <1hr | Low | The interview ends unilaterally the instant the floor is met — the player is never asked "anything else before we lock this in?" | `momentPrompts.ts:549-553`; real transcript turn 3 |
| CAST-24 | Polish | <1hr | Low | The setup wizard's copy ("Pick your season's models... then we'll roll") mixes TV-producer voice with literal AI-model-picker UI in the same sentence | `orwellOnboarding.js:301-303` |

---

## CAST-1 — [Blocker] [Effort: <1day] [Value: High]
Off-screen knowledge fabricated on premiere night — an NPC "reads" a secret she was never given a pathway to
- **Where:** real playthrough `scratchpad/audit2/j2-transcript.jsonl` turns 7, 12, 13 (a fresh
  GLM/DeepSeek-class run, not a stub); the rule it violates is stated in
  `src/engine/momentPrompts.ts:1056-1062` ("a houseguest knows only their OWN line plus whatever
  an in-game pathway has taught them about others... on premiere/day 1, essentially nothing yet").
- **Problem:** At turn 7 the player confides a very specific private secret to houseguest
  "Violet" alone, in a closed-door bedroom scene (`recordInteraction` fires with
  `withIds: ["npc:9"]` — Violet only). Five turns later, completely unprompted, houseguest
  "Carmen" (who was never a witness, never in that scene, and has no gossip/pathway tool call
  anywhere in the transcript establishing she was told) opens her "read" on the player with: *"You
  drop the twenty-two-grand story on Violet like you've known her twenty minutes"* — reciting the
  exact private detail. When the player calls this out, the model has Carmen improvise an excuse
  ("word moves fast in this house... I didn't hear it from Violet... I'm hearing things too")
  rather than retract the impossible knowledge. No tool exists that could have grounded this (there
  is no player-facing "what does NPC X know" or gossip-status query at all — see CAST-1 note
  below), so this is pure model invention of a knowledge-pathway violation, not merely an omitted
  tool call. This happens in the first ten minutes of the game, on the exact mechanic
  (I3/pathway-gated knowledge) the whole "paranoia braided with intimacy" fantasy is built on: if
  secrets can just "get around" without a recorded, traceable event, the player can never trust
  that a later blindside was "real, recorded, and fair all along" (the retrospective's entire
  payoff, feature 0048). This is the single highest-value bug in this lane — it strikes the
  invariant the whole vision brief calls the point of the game, and it fires in the first act.
- **Fix:** Add a hard belt (mirroring `_pending_barrier_directive` / the whereabouts barrier
  pattern in `chat_helpers.py`) that, whenever the model is about to voice an NPC referencing a
  fact about another houseguest, requires the NPC's own recorded knowledge state to actually
  contain it — at minimum, add an explicit `knowledgeOf(npcId, aboutId)` or "what has this NPC been
  told" read tool the model can call before attributing knowledge, and strengthen the always-on
  base prompt (`BASE_GAME_MASTER_PROMPT`, not just the day-1-specific line at 1058-1060) with an
  unambiguous, testable rule: an NPC may never reference a specific detail from a scene it did not
  witness and was not told about, full stop — "word gets around" is banned as an explanation absent
  an actual gossip-diffusion event. Consider a structural post-hoc scan (like the Vault sentinel)
  that flags an NPC utterance containing player-authored private content the NPC has no recorded
  pathway to.

## CAST-2 — [Blocker→Major] [Effort: <1day] [Value: High]
All 15 premiere introductions fire in ONE uninterruptible turn — no per-turn cap exists
- **Where:** real transcript turn 4 (`j2-transcript.jsonl`); the premiere prompt fragment
  `momentPrompts.ts:582-595` ("Go a few at a time so it breathes; let the player jump in..."); the
  always-on base prompt's own general rule `momentPrompts.ts:173-183` ("WANDERING THE HOUSE — ONE
  GROUPING AT A TIME... NEVER narrate all the rooms in a single turn"); the existing under-call
  belt `agent_loop.py:2231-2292` (`_auto_mark_premiere_intros`, feature #380).
- **Problem:** The single turn where the player says "I take a breath... and walk through the
  front door" produces ONE reply that introduces all 15 houseguests back-to-back (name → hometown →
  job → visible detail/scar → one quip → room reaction, repeated 15 times) and calls
  `markHouseguestMet` 15 times in a row within that same turn, before the player ever gets to say
  anything. This is the exact opposite of the design: the moment prompt explicitly says "go a few
  at a time... let the player jump in," and the ALWAYS-PRESENT base prompt is even more emphatic —
  "NEVER narrate all the rooms in a single turn" — yet both are violated in the single highest-
  stakes scene in the game ("15 strangers become distinct people," per the vision brief). The
  existing engineering effort here (`_auto_mark_premiere_intros`, #380) only defends the OPPOSITE
  failure mode (the model under-calling `markHouseguestMet` over 6+ turns, per its own code
  comment) — there is no analogous cap on the upper bound, unlike the comp-staging system which
  deliberately batches drops to `STAGED_TARGET_ROUNDS` (~4-8) per `liveSeason.ts`. A stronger model
  simply blasts through the entire gate in one shot, which is arguably worse for the fantasy than
  the under-call it replaced: the player has zero agency, zero ability to react to any one
  introduction, and the "premiere where 15 strangers become distinct people" collapses into a wall
  of text to skim.
- **Fix:** Add the missing upper-bound belt: after N (e.g. 3-4) `markHouseguestMet` calls within a
  single turn, or after the model's own turn produces content, force an end-of-turn (or refuse
  further `markHouseguestMet` calls until the next player turn) so introductions are structurally
  paced across multiple turns — the same "binding first round, non-binding flavor after" pattern
  already proven out for staged competitions. This is a template that should generalize to any
  moment-prompt instruction that says "a few at a time" without engine-side enforcement.

## CAST-3 — [Major] [Effort: <1day] [Value: High]
The premiere's 4 designed beats collapse into 2 total turns before any real player agency
- **Where:** real transcript turns 4-5; the beat list in `momentPrompts.ts:602-631`
  ("(1) INTRODUCTIONS... (2) THE TOAST... (3) PICK A BEDROOM... (4) GETTING SETTLED").
- **Problem:** Turn 4 alone (see CAST-2) completes beat (1) entirely. Turn 5 — which is nominally
  just the PLAYER's own self-introduction reply — completes beat (2) (the champagne toast), throws
  in several vignette snippets that belong to beat (4) ("Marcus and Mateo talking shop...", "Carmen
  standing near the edge..."), and then jumps straight to beat (3) ("time to settle in... which
  bedroom do you head to?"). So of the 4 explicitly staged, "breathe between each" beats, the
  player's FIRST decision point (a bedroom) arrives after only 2 total assistant turns, with zero
  chance to react to anyone individually along the way. This is a distinct root cause from prior
  finding A3/A4 (which were about forced `tool_choice` and ceremony-boundary chaining) — no tool
  forcing is involved here at all; this is pure narration-length/pacing collapse, i.e. the model
  choosing to write one very long reply covering multiple structural beats rather than trusting the
  conversational medium. It is the SAME failure class (montaging past lived time / "nothing force-
  marches the week") but manifests inside the premiere's own internal beats, before the game's
  first real HOH.
- **Fix:** Same remedy family as CAST-2 — an engine-side or belt-side cap that ends the model's
  turn after one beat's worth of content (or a firm token/paragraph budget per moment-beat with an
  instruction to STOP and wait), plus explicit language in the premiere fragment: "after each
  beat, END YOUR TURN and wait for the player — do not narrate the next beat in the same reply."

## CAST-4 — [Major] [Effort: <1day] [Value: High]
The casting interview finalizes on field-coverage, not depth — a real playthrough is "cast" in 3 exchanges
- **Where:** real transcript turns 1-3; `castingIntake.ts:242-272` (`CASTING_FINALIZE_FLOOR` /
  `CASTING_FINALIZE_ANY_OF` / `castingFinalizable`); `momentPrompts.ts:501-519` ("go DEEP, not
  wide... chase the most revealing thread with a sharper follow-up"); the finalize-fallback belt
  `agent_loop.py:1650-1704`.
- **Problem:** The engine's finalize floor is `playerName + backstory + motivation` plus ANY ONE
  of `personaArchetype / personaStrategyStyle / privateStrategy`. In the real playthrough the
  player answered exactly 3 substantive messages (name+bio, motivation, then one long paragraph
  covering persona+strategy+private-plan all at once) before the model called `createCharacter`.
  The producer never asked about "THE TELLS" (handling pressure, relationship to lying, a grudge
  they'd carry — the prompt's own words for "the gold"), never circled back to probe a
  contradiction, never pushed past a first answer. The interview reads as a form autofilled from
  one long player paragraph, not a "real casting conversation that probes... chases the most
  revealing thread." This directly undercuts the vision brief's #1 differentiator for the whole
  session ("Casting interview that feels like being cast, not configured"). It is compounded by
  `agent_loop.py`'s finalize-fallback belt, whose EXPLICIT job (once the floor is hit and the
  player signals readiness) is to escalate the model toward calling `createCharacter` immediately
  — there is no symmetric belt anywhere defending interview DEPTH; the entire belt architecture
  here is asymmetric (engineered hard against "the game never starts," with nothing against
  "the game starts too shallow").
- **Fix:** Raise `CASTING_FINALIZE_ANY_OF` to require at least 2-of-3 (not 1-of-3), and/or add an
  explicit turn-count floor (e.g. require ≥4-5 player answers before `finalizable` can be true,
  independent of field coverage) so a single mega-paragraph can't skip the conversation. Add a
  "THE TELLS" field to `CASTING_COVERAGE`/the finalize gate specifically, since it's currently the
  only one of the prompt's 4 named theme areas with no engine-side floor at all (see CAST-5).
  Consider having the finalize-fallback belt check a minimum exchange count, not just field
  presence, before it starts pushing toward `createCharacter`.

## CAST-5 — [Major] [Effort: <1hr] [Value: Med]
"THE TELLS" — the richest named interview theme — is the only theme gated by nothing, so it's the one most likely skipped entirely
- **Where:** `momentPrompts.ts:505-513` lists 4 theme areas (STRATEGY, WHAT THEY WANT, WHO THEY
  THINK THEY ARE, THE TELLS — "how they handle pressure, their relationship to lying, the grudge
  they'd carry, the line they won't cross... that is the gold"); `castingIntake.ts:249-260` shows
  the actual field-backed coverage (`playerName, backstory, motivation, personaArchetype,
  personaStrategyStyle, privateStrategy, interviewNotes, archetype, strategyStyle`) has no field
  that specifically corresponds to "the tells."
- **Problem:** STRATEGY maps to `privateStrategy`/`personaStrategyStyle`; WHAT THEY WANT maps to
  `motivation`; WHO THEY THINK THEY ARE maps to `personaArchetype`. THE TELLS has no corresponding
  field at all — it can only surface via free-text `interviewNotes`, which nothing requires. In the
  real transcript, it never came up. Since `castingStatusOf`'s "missing"/"next" queue is entirely
  field-driven, the one theme explicitly called "the gold" is structurally the LEAST likely of the
  four to ever be asked, because there is no engine-visible gap for it.
- **Fix:** Either add a `tells`/`pressureRead` field to `CASTING_COVERAGE` (even if optional, so it
  appears in "missing" and gets asked), or explicitly instruct the model that a genuinely deep
  interview must touch all 4 named themes before `createCharacter`, independent of what the engine
  floor requires.

## CAST-6 — [Major] [Effort: <1hr] [Value: High]
The "orient the first-timer" tutorial-cadence instruction lives ONLY in the premiere fragment and vanishes before the beats it's meant to cover ever fire
- **Where:** `momentPrompts.ts:620-623` (the "TUTORIAL CADENCE" line, embedded inside the
  `premiere:` fragment starting at line 568); the later per-moment fragments it names —
  `hoh-competition` (line 632), `nominations` (line 639), `veto-competition` (line 655),
  `eviction` (line 676) — contain NO onboarding/orientation content of their own; `buildSystemPrompt`
  (line 1111-1127) sends exactly ONE moment fragment per turn (`momentFragment(moment)`), never a
  history of prior-moment instructions.
- **Problem:** The premiere fragment tells the model: *"TUTORIAL CADENCE — this first week, be a
  touch more guiding than mid-season: as each new beat arrives (the first HOH, then nominations,
  then the veto, then eviction), briefly orient the player to what it is and what's at stake the
  FIRST time."* This is a completely reasonable, well-intentioned onboarding design. But the
  system prompt is rebuilt from scratch every turn using ONLY the current moment's fragment
  (`MOMENT_PROMPTS[moment]`) — once the game's `moment` flips from `"premiere"` to
  `"hoh-competition"`, the premiere fragment (and the tutorial-cadence line inside it) is gone from
  context entirely. The `hoh-competition` fragment itself is a terse, purely mechanical paragraph
  ("Build the tension, then call advanceGame to RESOLVE it...") with zero orientation content, and
  the same is true of `nominations`/`veto-competition`/`eviction`. So the ONE instruction telling
  the model to orient a first-timer to "what it is and what's at stake" for their first HOH,
  first noms, first veto, and first eviction is placed in a fragment that is structurally
  guaranteed to be absent from context by the time any of those beats occur. This is a clean,
  source-verifiable prompt-engineering placement bug, not a model-behavior question — it doesn't
  depend on any specific playthrough to prove.
- **Fix:** Either (a) duplicate/append a short "(this is their first time — briefly orient them,
  without lecturing)" clause directly into the `hoh-competition`/`nominations`/`veto-competition`/
  `eviction` fragments, gated on `view.week === 1` (cheapest fix), or (b) thread a persistent
  `firstTimeSeen: Set<beat>` flag through `GameStateView` so each ceremony fragment can render its
  own one-line "first time" cue exactly once, the same pattern other first-occurrence gating in
  this codebase already uses.

## CAST-7 — [Major] [Effort: <1day] [Value: High]
The game never teaches its own core verbs (confide/ally/deal) to the player
- **Where:** `src/engine/momentPrompts.ts:349-400` documents `makeDeal`, `formAlliance`,
  `joinAlliance`, and `confide` purely as MODEL-facing tool guidance; `frontend/static/js/
  slashCommands.js:5903-5911` (`GAME_SLASH_KEEP`) and `:5420-5461` (`_cmdHelp`) show that under
  the game build, `/help` lists only workspace-meta commands (`chats, theme, settings, help,
  shortcuts, find`, plus pure client-side easter eggs) — zero Big Brother gameplay content; the
  `/tour-*` family (`_cmdTourSettings`, `_cmdTourGallery`, `_cmdTourBrain`, etc.) is entirely about
  the underlying chat-workspace features and is dropped from the game build anyway.
- **Problem:** The vision brief states plainly: "Your only instrument is conversation... whether
  you can read a living social world... and move it with words." The engine has real, meaningful
  social mechanics beyond small talk — striking a deal (`makeDeal`), naming an alliance
  (`formAlliance`), accepting an NPC's alliance pitch (`joinAlliance`), pressing an ally to open up
  (`confide`) — but NONE of these are ever surfaced to the PLAYER as discoverable verbs anywhere:
  not in the welcome/tutorial card (which only teaches the ceremony LOOP: HOH → Noms → Veto →
  Eviction), not in the premiere framing, and not in `/help`, which is the one command explicitly
  kept alive under the game build for exactly this purpose and currently teaches nothing about the
  game itself. A first-time player unfamiliar with reality-TV strategy tropes has no way to learn
  that alliances, deals, or confidences are things they can actively pursue — they would have to
  organically stumble into phrasing the model happens to recognize. The engine teaches WHEN things
  happen; it never teaches HOW to actively play the one instrument the whole game is built around.
- **Fix:** Extend the welcome/premiere-tutorial card (`orwellPremiereTutorial.js`) or `/help`'s
  game-build content with a short, diegetic (never "here is a tool called X") explanation of the
  social moves available — "you can ask people to work together, propose an alliance, or press
  someone you trust to open up" — surfaced once, early, the same way the ceremony rhythm already
  is. Given `/help` is explicitly the ONE command kept for this purpose under the game build, it
  should not currently return literally nothing about the actual game.

## CAST-8 — [Major] [Effort: <1hr] [Value: High]
The first HOH comp-intent card presents "compete / throw / play-safe" with zero explanation anywhere upstream of what they mean
- **Where:** `frontend/static/js/orwellDecision.js:41` (`COMP_INTENTS`), `:307` (title: "Competition
  — set your approach"), `:538-544` (chip rendering — plain `addChip(i, i)`, no title/tooltip/
  subtext); confirmed via `scratchpad/audit2/telemetry/desktop-09-decision-comp-intent.png`: the
  ENTIRE card body reads *"The Head of Household competition is about to begin. Set your approach:
  compete, throw, or play it safe."* — followed by three single-word buttons.
- **Problem:** This is the FIRST mechanical decision of the entire game (the player's approach to
  the first HOH). "Throw" is genuine reality-TV strategy jargon (deliberately underperforming to
  avoid the spotlight/target that comes with power) that a non-BB-fan will not know; "play-safe" vs
  "compete" is ambiguous without explanation (try hard but avoid risk of injury/exposure? hold
  back slightly?). Nothing anywhere upstream — not the casting interview, not the premiere
  producer voice, not the welcome/tutorial card, not the card itself — ever defines these terms as
  game concepts before asking the player to commit to one, permanently, on a card explicitly
  labeled "this is binding." This is the single clearest, most concrete instance of "the game
  never onboards its own loop": the FIRST decision anyone makes offers zero teaching, and the
  choice is irreversible.
- **Fix:** Add one line of explanatory subtext under the three chips (even a compact tooltip/
  `title` attribute would help keyboard/hover users, but a persistent one-line explanation is
  needed for touch): e.g. "Compete to try to win. Throw to deliberately lose — a common way to
  stay under the radar. Play it safe to try, without over-exposing yourself." This is a same-file,
  <1hr fix (`addChip` already accepts a label; add a sibling description row).

## CAST-9 — [Major] [Effort: <1day] [Value: Med]
On mobile, the premiere guide card + the first decision card share an uncapped stacking zone and crush the composer
- **Where:** `frontend/static/js/orwellNotice.js:62` (`KIND_ORDER = { guide: 10, ...,
  decision: 40, ... }`, confirming "guide" and "decision" notices share one deterministic stack),
  `:458-468` (`insertByOrder` — a plain ordered insert, no viewport-height awareness or
  mutual-exclusion), `frontend/static/style.css:2114-2119` (`#orwell-notice-zone { display: flex;
  flex-direction: column; ... }` — no `max-height`/`overflow-y` anywhere on the zone);
  `orwellPremiereTutorial.js:83-92,202-211` (`refresh()`/`isPremiereWeek` — the guide card is
  gated ONLY on week===1, with no awareness of whether a decision is concurrently pending).
- **Problem:** The premiere guide card ("Welcome to the house — premiere week") and the FIRST HOH
  comp-intent decision card are BOTH gated to week 1 — they are not just theoretically stackable,
  they are the two cards a brand-new player is most likely to see together, because the premiere's
  own destination IS the first HOH comp (per `momentPrompts.ts:624-631`). I confirmed this
  combination is real (not a capture artifact) by checking the gating code: the guide only
  dismisses on explicit player action or `week !== 1`/`moment === "post-season"`, and nothing in
  either surface's mount logic checks for the other. The mobile screenshot
  `mobile-09-decision-comp-intent.png` shows the actual result: the two stacked cards consume
  roughly 700 of 844px of viewport height, and the composer is reduced to an unlabeled ~55px sliver
  with no visible placeholder text — on the exact device class and exact game moment (first
  decision of the game) most likely to matter for a first impression.
- **Fix:** Either (a) auto-dismiss/collapse the "guide" kind the instant a "decision" kind mounts
  in the same zone (the decision is definitionally higher-priority — CLAUDE.md calls decision
  cards "HARD STOPS"), or (b) give `#orwell-notice-zone` a `max-height` with internal scroll on
  narrow viewports so the composer is always guaranteed a minimum visible height. (a) is simpler
  and matches the existing `KIND_ORDER` precedent (decision already outranks guide numerically) —
  it just isn't enforced as a mount-time exclusion yet.

## CAST-10 — [Major] [Effort: <1hr] [Value: High]
The pre-game setup wizard is the very FIRST screen and frames the game as picking a "Narrator model" / "Portrait model" before any casting fiction begins
- **Where:** `frontend/static/js/orwellOnboarding.js:257-404` (`mountSetup`) — the wizard shown "on
  EVERY fresh game/season," titled "Big Brother production setup" / "Pick your season's models,"
  with body copy: *"Narrator model: **…**"* / *"Portrait model: **…**"* and a "Choose models"
  button that opens Settings' raw model/endpoint picker.
- **Problem:** This is literally the first interactive screen a brand-new player sees after
  logging in and clearing the model-configuration gate (assuming one is already configured) — it
  precedes the casting interview, the producer's opening line, everything. Its content is
  unambiguous AI-infrastructure language: "Narrator model," "Portrait model," a live readout of a
  literal model id (e.g. "deepseek-v4-pro"), and a door into raw provider/endpoint/API-key
  settings. This is contradiction C2 ("an immersive game wearing a workspace's clothes") realized
  at the worst possible moment — the very first touchpoint, before "you are being cast" has been
  established even once. I9 explicitly bans "no engine/tool/app/system talk in anything the player
  sees," and while SOME model-config screen is an unavoidable practical necessity (the app can't
  speak without a key), the copy here doesn't need to be this technical: "Narrator" and "Portrait"
  could be relabeled in-fiction ("Who tells your story" / "Your look"), and the live model-id
  readout (which serves the admin, not the player) could be demoted behind an expandable "advanced"
  disclosure rather than being the wizard's headline content.
- **Fix:** Soften the wizard's copy to diegetic labels and move the raw model-id readout out of the
  primary view (an expandable "technical details" toggle, defaulting collapsed). Keep "Choose
  models" for admins who need it, but the DEFAULT first-screen experience for a returning/typical
  player should read less like a model picker and more like "production is getting your feed
  ready."

## CAST-11 — [Minor] [Effort: <1hr] [Value: Med]
"Auto-detect (Gemini)" names a real third-party AI brand on the first screen of the game
- **Where:** `frontend/static/js/orwellOnboarding.js:282` (fetches `image_model` from
  `/api/auth/settings`), `:324` (`imgEl.textContent = image || "Auto-detect (Gemini)"`).
- **Problem:** Distinct from CAST-10's broader framing concern, this is a specific, cheap,
  concrete instance: the DEFAULT-state fallback label for the portrait-model row literally
  says "Gemini" — a real, named, third-party AI product — in the setup wizard shown before the
  player has even met their producer. This is a harder I9/C2 violation than a generic "AI model"
  label would be, and it's a one-line fix.
- **Fix:** Change the fallback string to a neutral in-fiction label, e.g. "Auto-detect" (drop the
  parenthetical brand name) or "Assigned automatically."

## CAST-12 — [Minor→Major] [Effort: <1day] [Value: Med]
Photo-first ordering: the producer's literal opening ask is "let's see the face," before even a name
- **Where:** `castingIntake.ts:56-63` (`CASTING_COVERAGE` — `castPhoto` is deliberately FIRST in
  ask-order, "the photo-first OOBE re-sequence"); `momentPrompts.ts:535-547` ("THIS IS WHERE YOU
  OPEN. Before any other question, producers ask what the cast looks like"); confirmed live in the
  real transcript turn 0: the producer's entire opening turn is scene-setting ("I'm Janelle... this
  is the quiet part") immediately followed by "First things first — let's see the face... Go
  ahead — let's see you," with no name, no "who are you," nothing else asked.
- **Problem:** This is an explicit, deliberate design choice (well-documented in code comments as
  an intentional re-sequence), and it IS correctly optional/non-blocking (a real strength — the
  player skipped it instantly and the interview flowed on without friction, per the transcript).
  But from a pure "does this feel like being cast" standpoint, opening a casting interview by
  asking a total stranger to "see their face" before asking their name is backwards from how an
  actual casting conversation works (a producer gets to know you first; a photo, if anything, comes
  near the end or is handled separately/administratively). It reads more like a photo-booth kiosk
  prompt than the opening beat of "the sit-down that decides who gets cast." The charter explicitly
  calls this exact ordering out as a known area to extend.
- **Fix:** Re-order `CASTING_COVERAGE` so `playerName` (and ideally one rapport-building question)
  precedes `castPhoto`, and adjust the prompt's "THIS IS WHERE YOU OPEN" language to open on the
  player's name/identity instead, offering the photo naturally once some rapport exists (e.g. after
  the first real answer lands) rather than as the literal first thing said to a stranger.

## CAST-13 — [Polish] [Effort: <1hr] [Value: Low]
"Choose Your Character" reads like a video-game avatar-select CTA, clashing with the "being cast" register
- **Where:** `frontend/static/js/orwellHeadshot.js:137-156` (CSS comments explicitly call it "a
  competition-style CTA"), `:625-627` (`btn.textContent = "Choose Your Character"`).
- **Problem:** Every other surface in the casting flow is carefully de-gamified — the producer
  never says "select an option," never uses game-UI vocabulary. "Choose Your Character" is
  unmistakably RPG/game-select language ("choose your class," "choose your character" is a
  decades-old genre convention for picking an avatar from a roster) — it is the one CTA label in
  the whole flow that breaks the "you are being cast in a TV show, not building a game character"
  illusion the rest of the copy works hard to maintain.
- **Fix:** Rename to something in-register, e.g. "Add Your Photo" or "Your Cast Photo" (which is
  literally the window's own title one line later, per `orwellHeadshot.js:483`: `title: "Your Cast
  Photo"` — the button and the window it opens don't even use consistent language).

## CAST-14 — [Minor] [Effort: <1hr] [Value: Low]
`CASTING STATUS` "NEXT STEP" can surface a producer-internal-only field phrased as if it were a question for the player
- **Where:** `castingIntake.ts:71-72` (`archetype`/`strategyStyle` ask text: "your canonical
  casting-sheet mapping of who they are" / "...how they'll play" — written in second person
  addressing the MODEL/producer, not the player); `:212-235` (`castingStatusOf` — these two fields
  participate in `missing`/`next` exactly like every player-facing field); `momentPrompts.ts:855`
  (`NEXT STEP: ${c.next}` — rendered verbatim into the model's context).
- **Problem:** `archetype`/`strategyStyle` are the PRODUCER's own casting-sheet categorization (per
  the interview prompt: "YOUR mapping... pick the closest") — never something the player answers
  directly. But because they're ordinary `CASTING_COVERAGE` entries, if everything else is
  captured except these two, the engine will report `NEXT STEP: your canonical casting-sheet
  mapping of who they are` — a line that makes sense as a note-to-self for the model but is
  nonsensical if read as "the next thing to ask the player." `ready`/`finalizable` already
  correctly ignore these two fields (per the code comment at `castingIntake.ts:246-247`) — only the
  informational `missing`/`next` surfacing doesn't distinguish them from real player-facing asks.
- **Fix:** Exclude `archetype`/`strategyStyle` from `missing`/`next` display purposes (they can
  still be tracked/captured, just not surfaced as "the next question"), since the actual finalize
  gate already treats them as non-blocking.

## CAST-15 — [Minor] [Effort: <1hr] [Value: Med]
The J4 "No feed connected yet" holding card's "Go in anyway" leads a non-admin into a dead chat with no in-fiction explanation
- **Where:** `orwellOnboarding.js:858-869` (the J4 branch — non-admin gets no remedy button, only
  the generic "Go in anyway" dismiss); `chat_helpers.py:124-143` shows `FEED_DOWN_PROMPT` exists
  as a proper in-fiction message for the ENGINE-DOWN case (F5), but there is no equivalent
  "production note" framing for the NO-MODEL-CONFIGURED case (J4) once the holding card is
  dismissed.
- **Problem:** For the engine-down case, dismissing the holding card still leaves the player in a
  coherent in-fiction experience ("Big Brother will return... the feeds are down"). For the
  no-model-configured case, a non-admin who clicks "Go in anyway" (the only exit offered them) is
  dropped into a chat where every send will fail against a backend with no configured model — and
  unlike the engine-down path, there's no dedicated framing message telling them why, in-voice.
  This mostly matters for multi-user/hosted deployments where a guest genuinely isn't the admin.
- **Fix:** Give the no-model-configured state its own fail-closed, in-fiction framing message
  (parallel to `FEED_DOWN_PROMPT`) for when a turn is attempted with no model resolvable, so a
  non-admin who dismisses the card at least gets a coherent in-universe response instead of a raw
  send failure.

## CAST-16 — [Minor] [Effort: <1day] [Value: Med]
The finalize-fallback belt is asymmetric: it aggressively forces speed once the floor is met, with no symmetric belt defending interview depth
- **Where:** `frontend/src/agent_loop.py:1650-1704` — `_CASTING_NUDGES` ("Do not keep interviewing
  or wait on a photo: your very next action is the createCharacter function call"), escalating to
  `_CASTING_FORCE_LEVEL` which calls `createCharacter` on the model's behalf.
- **Problem:** This belt exists to fix a real, documented bug class (the model never finalizing
  even when ready and the player asked to start — a genuine game-breaking stall). But its existence
  compounds CAST-4: once the engine's minimal floor is hit and the player signals readiness in any
  way, this is an active, escalating FE mechanism pushing the model to stop interviewing
  immediately. There is no mirror-image belt anywhere checking "has this interview actually gone
  deep" before allowing the nudge ladder to engage — the system defends only against the game never
  starting, never against the game starting too shallow, even though both are named failure modes
  in the spirit of the product (I7 "behavioral fidelity is priority #1").
- **Fix:** Gate the nudge ladder's first rung on a minimum exchange count (not just field
  presence) — e.g. require at least 4-5 player turns in the casting session before the "stop
  interviewing" nudges are allowed to fire, even if the engine's floor is technically met sooner.

## CAST-17 — [Minor] [Effort: <1hr] [Value: Low]
The producer's own seeded interrogation "quirk" is asserted in the prompt but never exercised
- **Where:** `src/engine/producerPersona.ts:74-82` (`PRODUCER_QUIRKS` — e.g. "circles back to a
  thing they said three answers ago, to see if the story holds," "repeats the player's own loaded
  word back to them as a single-word question," "keeps a running tally out loud of the
  contradictions"); `renderProducerVoice` (line 131-144) injects this into every casting turn as
  "A tell of your own: you {quirk}."
- **Problem:** These quirks are explicitly multi-turn, probing behaviors — the entire POINT of a
  quirk like "circles back to something said three answers ago" requires there to have BEEN three
  answers ago to circle back to. Given CAST-4's finding (the interview finalizes after ~3
  exchanges), the producer's own seeded personality mechanic has essentially no room to ever
  manifest — it's asserted in every prompt but structurally starved of the turn count it needs to
  pay off. This is a nice, well-designed piece of characterization machinery that the interview's
  actual pacing never lets breathe.
- **Fix:** A natural side-effect of fixing CAST-4/CAST-16 (raising the effective minimum exchange
  count) — flagging separately because it's good evidence that the intended interview depth was
  meant to be much greater than what currently ships.

## CAST-18 — [Polish] [Effort: <1hr] [Value: Low]
Premiere's 15 introductions are cookie-cutter identical in structure
- **Where:** real transcript turn 4 full text — every single one of the 15 introductions follows
  the EXACT same template: name → hometown → job → a visible physical detail (usually a scar) →
  one "fun fact" quip → a beat of room reaction (laughter/nervous chuckle/silence).
- **Problem:** The mandate calls for "~16 DISTINCT voices" (I6) and behavioral fidelity as
  priority #1 (I7). While the CONTENT of each introduction is genuinely varied (different jobs,
  different quirks), the FORM is identical for all 15 in a row — it reads as an assembly-line
  template applied 15 times rather than 15 people with their own way of introducing themselves
  (some should ramble, some should be terse, some should deflect with humor, some should be visibly
  nervous and undersell themselves, one might make it weird). This is compounded by CAST-2 (all 15
  in one turn leaves no room for variety to register anyway) but is a distinct, content-level
  observation: the TEMPLATE itself needs explicit instruction to vary, not just the pacing.
- **Fix:** Add an explicit instruction to the premiere fragment: introductions should vary in
  LENGTH and FORM per person's archetype/demeanor (a shy houseguest undersells themselves in one
  line; a showman monologues; someone deflects with a joke instead of answering straight) — not
  just vary in content while keeping an identical rhythmic template.

## CAST-19 — [Minor] [Effort: <1hr] [Value: Low]
The welcome/tutorial card's "cross paths with all fifteen" copy describes an experience the game never actually delivers
- **Where:** `orwellPremiereTutorial.js:158-160` ("Talk to anyone, wander any room... You'll need
  to cross paths with all fifteen houseguests before Production calls the first HOH competition.");
  contrast with the ACTUAL mechanism, `momentPrompts.ts:582-595` — a single producer-run,
  scripted roll-call introduction, not the player organically wandering and bumping into people.
- **Problem:** The copy sets an expectation of active, player-driven exploration ("wander any
  room... cross paths with...") but the designed (and, per CAST-2, actually-observed) mechanism is
  a passive, producer-narrated roll call where the player does nothing but watch 15 introductions
  scroll by. This is a minor copy-accuracy mismatch, not a functional bug, but it's worth fixing
  alongside CAST-2/CAST-3 since a genuine fix to those (spacing introductions across several
  player turns, letting the player actually choose who to approach next) would make this copy
  literally true instead of aspirational.
- **Fix:** Either make the copy match the current scripted mechanism ("Production will introduce
  you to the house") or — better — implement CAST-2/CAST-3's fix so the copy becomes accurate.

## CAST-20 — [Polish] [Effort: <1hr] [Value: Low]
The cast-photo producer line is the one moment the in-fiction voice names a literal on-screen UI control
- **Where:** `momentPrompts.ts:535-547` ("tell them to TAP IT to add their cast photo... the only
  control is a 'Choose Your Character' button that appears in the chat right below your message").
- **Problem:** I9 bans "no engine/tool/app/system talk in anything the player sees" everywhere
  else in the product, but the casting interview's photo ask is a deliberate, necessary exception
  (there's no other way to prompt an app-level upload) — the producer voice explicitly says "tap
  that button below this message." This is the one moment in the entire game where the in-fiction
  voice unambiguously acknowledges being inside an app UI. It's clearly a considered trade-off
  (the surrounding instructions are very careful: "NEVER invent on-screen directions... refer to it
  by that exact name and nothing else"), so this is filed as Polish/spirit-gap rather than a bug —
  but it's worth naming as a standing tension the team should be aware is there, in case a future
  pass wants to soften it (e.g. "there's a button below this message" reads slightly less
  app-like than "tap it").
- **Fix:** Optional softening only — e.g. "there's a way to do that right below this message" vs.
  "tap that button." Low priority; flagging for awareness given I9's otherwise-strict enforcement
  everywhere else.

## CAST-21 — [Minor] [Effort: <1day] [Value: Med]
Truncation-risk is compounded by the same uncapped-intros root cause
- **Where:** cross-reference to the prior dedup'd finding J-11/PROMPT-2 (`max_tokens_budget`
  reasoning-truncation on casting turns with GLM-4.7); `agent_loop.py:2231-2292`.
- **Problem:** This is a cross-territory flag, not a new independent finding: CAST-2's discovery
  that the model can pack all 15 premiere introductions into one turn means that turn is
  necessarily very long (the real transcript's turn-4 reply is ~1,900 words). A model with a
  smaller `max_tokens` budget (exactly the scenario the prior audit's J-11/PROMPT-2 finding
  documents for the casting interview itself) attempting the same single-turn 15-intro dump risks
  truncating mid-introduction — which would leave some houseguests never named, `markHouseguestMet`
  never called for them, and the meet-everyone gate permanently stuck (since nothing retries a
  truncated introduction). The two failure modes (pacing collapse and truncation) share one root
  cause — no per-turn cap on how much premiere content one reply may contain — so CAST-2's fix
  would incidentally close this risk too.
- **Fix:** Same as CAST-2. Flagging for the narration-fidelity/prompt-engineering lanes as a
  shared root cause worth fixing once.

## CAST-22 — [Minor] [Effort: <1hr] [Value: Low]
`castingFinalizable`'s ANY-OF-1 gate allows an interview that says nothing about actual strategy
- **Where:** `castingIntake.ts:256-271` (`CASTING_FINALIZE_ANY_OF` — satisfied by ANY ONE of
  `personaArchetype | personaStrategyStyle | privateStrategy`).
- **Problem:** A player could satisfy the whole finalize gate having only ever answered "how they
  think they'll come across" (`personaArchetype`) — i.e., their surface persona — while never once
  describing an actual strategic plan (`personaStrategyStyle`/`privateStrategy`). Since strategy is
  explicitly called out as the FIRST and richest of the prompt's 4 theme areas ("how do they
  actually intend to WIN? Who do they cut, who do they keep, and when?"), an interview that
  finalizes without ever touching it feels like a materially thinner "casting" than one that does.
- **Fix:** Related to CAST-4/CAST-5's fix — consider requiring `personaStrategyStyle` or
  `privateStrategy` specifically (not `personaArchetype` alone) to count toward the ANY-OF gate,
  since persona-only is the shallowest of the three.

## CAST-23 — [Minor] [Effort: <1hr] [Value: Low]
The interview ends unilaterally the instant the floor is met
- **Where:** `momentPrompts.ts:549-553` ("Once it says READY TO START, don't drag it out: call
  createCharacter to finalize"); real transcript turn 3 — the model calls `createCharacter`
  immediately after recording the third answer, without ever asking the player something like
  "anything else you want production to know before we lock this in?"
- **Problem:** The player never gets an explicit moment of agency over WHEN their own interview
  ends — the model (correctly, per its instructions) treats "enough fields are captured" as
  license to end the conversation on its own initiative. For a beat that's supposed to feel like
  "being cast," having someone else unilaterally decide you're done talking, the moment they have
  what they minimally need, undercuts the sense that the player is being genuinely gotten to know.
- **Fix:** Add one closing beat to the prompt: once `finalizable` is true, ask "anything else
  before we wrap?" and let the player's own "let's go"/"I'm ready" (or a beat of silence) be the
  actual trigger for `createCharacter`, rather than the engine-floor crossing alone.

## CAST-24 — [Polish] [Effort: <1hr] [Value: Low]
The setup wizard's copy mixes TV-producer voice with literal AI-model-picker UI in one sentence
- **Where:** `orwellOnboarding.js:301-303`: *"Choose the narrator and portrait models that will run
  your season, then we'll roll. The producers reach out the moment you're ready — they go first."*
- **Problem:** The second sentence is nicely in-fiction ("the producers reach out... they go
  first"). The first sentence, one line above it in the same card, says "models that will run your
  season" — literal AI-infra vocabulary sitting directly beside in-fiction language. The tonal
  whiplash within a two-sentence paragraph is a small but real symptom of C2 (the immersive game
  wearing a workspace's clothes) — most of the product manages to fully commit to one register per
  surface; this card doesn't.
- **Fix:** Same remedy as CAST-10 — soften "models that will run your season" to something less
  technical, consistent with the second sentence's register.

---

## Coverage note

Reviewed: `src/engine/castingIntake.ts` (full), `src/engine/producerPersona.ts` (full), the
casting/premiere/hoh-competition/nominations/veto/eviction fragments + `BASE_GAME_MASTER_PROMPT`
+ `renderGameContext`/`buildSystemPrompt` in `src/engine/momentPrompts.ts` (full read of all
casting/premiere-relevant sections, ~500 of 1128 lines), `frontend/routes/chat_helpers.py`'s
`apply_game_framing` + the casting-specific framing constants (full), `frontend/static/js/
orwellOnboarding.js` (full), `frontend/static/js/orwellHeadshot.js` (full), `frontend/static/js/
orwellPremiereTutorial.js` (full), `frontend/static/js/orwellNotice.js` + its `style.css` rules
(targeted), `frontend/static/js/orwellDecision.js` (targeted, comp-intent path), `frontend/static/
js/slashCommands.js` (targeted, `/help`+game-build keep-set), `frontend/src/agent_loop.py`
(targeted: `_auto_mark_premiere_intros` #380, the casting finalize-fallback belt). Cross-checked
every finding against a REAL-MODEL playthrough transcript (21 turns, casting → premiere → first
HOH) rather than relying on prompt text alone, and verified every screenshot-based claim against
the actual gating code before treating a card-stacking combination as reachable (several
telemetry stills are synthetic seeded-state combinations from the capture rig and were explicitly
excluded once I found the engine was seeded directly to a mid-week-1 state with the OOBE overlay
forced on top via a JS test seam — I did not report those as real bugs).

Not covered / out of scope for this pass: the finale/jury flow, mid-season weeks 2+, the
post-season retrospective (0048), account-level auth/login screens beyond the model-gate, and
deep a11y/contrast audits of the surfaces touched here (left to the dedicated a11y lane) — flagged
only where directly relevant to a casting-flow finding.
