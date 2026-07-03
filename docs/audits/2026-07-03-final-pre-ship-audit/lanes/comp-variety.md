# COMPETITION & HOUSE-EVENT VARIETY — AUDIT LANE FINDINGS

Lane: over an 11-week season, repetition is an immersion-killer superfans will notice.
Territory: `src/engine/competitionLibrary.ts`, `src/domain/competitionOutcome.ts`, the staged-comp
presentation grammar in `src/engine/liveSeason.ts`, `src/engine/houseEvents.ts`, `src/engine/triggers.ts`
(0091 eruptions), `src/engine/schedule.ts`, `src/engine/momentPrompts.ts` (comp/house-event fragments),
`src/composition/orchestrator.ts` / `src/composition/registry.ts` (event recording + witness sets),
`docs/features/0042-competition-library.md`, `docs/features/0106-exclusive-house-events.md`.

## INDEX

| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| COMP-1 | Major | <1day | High | Ceremony/comp witnessSet = participants only, contradicting 0106's "whole house gathers" | `src/composition/registry.ts:304-312`, `src/engine/liveSeason.ts` (all beat `participants`), `docs/features/0106-exclusive-house-events.md` |
| COMP-2 | Major | <1hr | High | Ambient house-event flavor (`nextHouseEvent`, E58) is dead code in live play | `src/composition/orchestrator.ts:716-727,370`, `src/composition/gameWatcher.ts:60,70` |
| COMP-3 | Major | multi-day | High | All comps narrated with one elimination-drop grammar; `CompetitionFormat` field defined but never read | `src/engine/competitionLibrary.ts:17,37`, `src/engine/liveSeason.ts` (`advanceCompetition`/`crownCompetition`), `src/engine/momentPrompts.ts` |
| COMP-4 | Major | multi-day | High | Competition library too shallow for an 11-week season (6+6 defs, no-repeat-window of 1) | `src/engine/competitionLibrary.ts:41-176` |
| COMP-5 | Major | <1hr–<1day | Med-High | Curated library skews governing aptitude 3:2:1 (mental:physical:social) in BOTH pools | `src/engine/competitionLibrary.ts:41-152` |
| COMP-6 | Major | <1hr | Med | House-event / eruption witness-set-of-2 bug: content implies whole-house, `witnessSet` hardcodes 2 ids | `src/composition/orchestrator.ts:716-727`, `src/adapters/engine/GameSessionAdapter.ts:~5128-5165` |
| COMP-7 | Minor | <1day | Med | Ambient house-event pool (12 lines) far too shallow for real call frequency, even once wired | `src/engine/houseEvents.ts:41-54` |
| COMP-8 | Major | (=COMP-2 fix) | High | Shipped default config produces ZERO ambient (non-ceremony) house texture all season | `src/composition/orchestrator.ts:716-727` (dead), `src/engine/triggers.ts` (opt-in off) |
| COMP-9 | Major | multi-day | High | Have-Nots is pure flavor with zero mechanic; no Luxury Competition category exists at all | `src/domain/house.ts:266-267`, `src/engine/houseEvents.ts:43`, `src/engine/competitionLibrary.ts:16` |
| COMP-10 | Minor | multi-day | Med | NPCs never throw/play-safe a competition — "for now they always compete" | `src/engine/liveSeason.ts:760-771` |
| COMP-11 | Minor | multi-day | Med | Final HOH (Final 3) is an ordinary single-roll draw, not BB's iconic 3-part format | `src/engine/liveSeason.ts:426-430,634-637` |
| COMP-12 | Minor | multi-day | Med | Missing iconic BB comp archetypes: no OTEV-style true/false tree, no Before/After, no 1v1 bracket faceoff | `src/engine/competitionLibrary.ts:41-152` |
| COMP-13 | Minor | <1hr | Med | Engine-authored beat content never carries the drawn def's `name` | `src/engine/liveSeason.ts:640,649,659-690` |
| COMP-14 | Minor | <1hr | Low-Med | No `momentPrompts.ts` guidance keyed to the `comp-elimination` beat | `src/engine/momentPrompts.ts` (absent) |
| COMP-15 | Minor | <1hr | Low | `narrative.beats` (3 canned phrases) exposed only once, never per staged reveal round | `src/engine/liveSeason.ts:582-623` |
| COMP-16 | Polish | <1hr | Low | `src/engine/schedule.ts` is completely orphaned — a second, unwired day-cadence model | `src/engine/schedule.ts` |

Severity counts: **Major 8, Minor 7, Polish 1, Blocker 0.** Total: **16 findings.**

---

## FULL FINDINGS

```
[COMP-1] [Severity: Major] [Effort: <1day] [Value: High]
Ceremony/competition witnessSet = participants only — contradicts 0106's "whole house gathers"
- Where: `src/composition/registry.ts:304-312` (`session.setOnEvent`), every ceremony/comp `BeatEvent`
  in `src/engine/liveSeason.ts` (e.g. `crownCompetition` L638-649, `resolveVetoDraw` L676-689,
  nominations L1510/1690, veto-ceremony L1538/1580/1596/1706/1711/1751, eviction L1271/1291). Cross-ref
  `docs/features/0106-exclusive-house-events.md` (BUILT, 2026-06-26): "Non-competitors are SPECTATORS
  — present, watching" and "This applies to any whole-house event — competitions AND the nomination /
  veto / eviction ceremonies… largely the same."
- Problem: 0106 (shipped) makes `whereabouts.present` report the WHOLE HOUSE gathered for every
  competition and every ceremony. But the actual recorded `GameEvent` for each of those beats carries
  `participants` = only the directly-involved houseguests (the HOH comp winner alone; the veto's 6
  drawn players; the HOH + 2 nominees for nominations; the veto holder + saved + replacement for the
  ceremony; the evictee alone for eviction). `setOnEvent` turns `participants` directly into
  `witnessSet` (plus the player, always). So per the engine's OWN event/visibility model (I3), an NPC
  who is a "spectator" per 0106 — present and watching per the narrator's own framing — never actually
  witnessed the beat. Concretely: `selectRecentForConfessional` (`src/engine/confessionals.ts:297-300`)
  filters strictly on `ev.witnessSet.includes(npc)` — so a non-competing NPC can NEVER confess about a
  competition or ceremony they merely watched, only ones they personally starred in. This spans every
  week (5+ ceremony beats/week × 11 weeks ≈ 55-60 beats) and is a direct contradiction between a
  recently-shipped feature's stated design and the underlying event model it was built on top of — 0106
  even flags spectator OPINION folds as "out of scope, deferred," but never noticed the witnessSet gap
  underneath it.
- Fix: at the single choke point (`registry.ts`'s `setOnEvent`), detect whole-house beat kinds (the same
  set 0106's `houseEventInSession` already enumerates: hoh-competition/veto-competition/nominations/
  veto-ceremony/eviction*) and widen `witnessSet` to the full living/awake roster for those beats, not
  just `ev.participants`. This also unlocks richer NPC confessional variety (COMP‑7/COMP-9 territory)
  for free.

[COMP-2] [Severity: Major] [Effort: <1hr] [Value: High]
Ambient house-event flavor (`nextHouseEvent`, feature E58) is dead code in live play
- Where: `src/composition/orchestrator.ts:716-727` — the record is gated on `trigger === "player-turn"`.
  But in production, `advance()` (the function that calls `defaultApply`, which contains this gate) is
  NEVER invoked with `"player-turn"`: `src/composition/gameWatcher.ts:60` calls
  `orchestrator.advance(user, "offscreen-tick")`, `gameWatcher.ts:70` calls
  `orchestrator.advance(user, "audit")`, and the per-turn debounced tick at
  `src/composition/orchestrator.ts:370` (`maybeTurnDrivenTick`) calls
  `this.advance(user, "offscreen-tick", { baseline: candidate, supplementary: true })`. Grepping the
  whole repo, the ONLY call sites that ever pass `"player-turn"` to `.advance()` are two test-harness
  calls (`tests/unit/opsHardening.test.ts:144`, `features/step_definitions/game_orchestrator.steps.ts:227`)
  — neither reachable from real gameplay.
- Problem: the entire curated 12-line ambient house-event pool (`HOUSE_EVENT_POOL` in
  `src/engine/houseEvents.ts`) — the feature explicitly built (audit E58) to stop the daily-event
  invariant being satisfied by "one verbatim filler line… repeated forever" — never fires for a real
  player, in either of the game's two supported runtime modes (pure turn-driven default, or the
  wall-clock watcher). It is exercised only by tests calling the internal function directly with a
  trigger value the real commit path no longer produces — almost certainly rotted when the turn-driven/
  debounce refactor (R5/E57) renamed the calling convention to `"offscreen-tick"` without updating this
  gate. This is exactly the class of "half-wired flag/stub" the vision brief's C6 calls out to probe.
  It does NOT break the hard daily-event invariant (ceremony beats — HOH win, nominations, etc. — also
  record as `type: "house-event"` and satisfy that), but it does mean 100% of the "kitchen argument /
  slop week / lockdown / prank war" texture this module was built to add never reaches a player.
- Fix: change the condition to match how the rest of `defaultApply` distinguishes a real tick from an
  audit (`trigger !== "audit"`), or add a check on `sandbox.session` state directly — either way, ONE
  line. Then immediately hit COMP-7's shallow-pool problem, since it's never been load-tested at real
  call frequency.

[COMP-3] [Severity: Major] [Effort: multi-day] [Value: High]
All comps are narrated with ONE elimination-drop grammar; `CompetitionFormat` is defined but dead
- Where: `src/engine/competitionLibrary.ts:17` (`export type CompetitionFormat = "endurance" | "puzzle"
  | "quiz" | "skill" | "crapshoot" | "social"`) and `:37` (`format: CompetitionFormat` on every def).
  Grepping the entire `src/` tree for `.format` or `CompetitionFormat` outside this one file returns
  NOTHING — the field is written into every one of the 12 defs and never read anywhere else. The staged
  reveal grammar in `src/engine/liveSeason.ts` (`advanceCompetition` L582-623, `beginStaged` L509-518,
  `stagedBatchSize` L527-532) applies the identical "X is eliminated; N remain" narrowing-field
  presentation to EVERY comp regardless of format, and `momentPrompts.ts` has zero MOMENT text keyed to
  format either (see COMP-14).
- Problem: 0042's own design doc (`docs/features/0042-competition-library.md` §4/§8) explicitly wanted
  `CompetitionResultView` to carry `{ name, format, narrative }` so "the narrator (0018) dresses this
  specific comp instead of improvising one" — and it IS carried to the model once, via
  `runCompetition`/`peekCompetition`. But the mechanical per-round reveal content the engine hands back
  turn after turn is completely format-blind: "Whisper Network" (a social quote-matching comp),
  "House Scramble" (a crapshoot scavenger hunt), and "Hold the Wall" (a physical endurance wall) all
  produce the SAME "eliminated"/"still in" field-narrowing language every round. A race is narrated as
  an elimination bracket; a scavenger hunt is narrated as an elimination bracket; a trivia buzzer round
  is narrated as an elimination bracket. Over 11 weeks × 2 comps/week ≈ 20+ comps, the player experiences
  one repeating structural shape no matter which of the 6 named formats is drawn.
- Fix: branch the `comp-elimination` reveal content (and ideally the batch pacing, `STAGED_TARGET_ROUNDS`)
  on `def.format`: an endurance/skill comp keeps "drops"; a quiz/social/crapshoot comp should read as
  "is knocked out of contention" / "is matched incorrectly" / "comes up empty-handed" — format-specific
  reveal vocabulary, and thread `def.format` into a new `momentPrompts.ts` fragment (COMP-14) so the
  model varies tone, not just the engine's raw string.

[COMP-4] [Severity: Major] [Effort: multi-day] [Value: High]
Competition library too shallow for an 11-week season — guaranteed verbatim repeats
- Where: `src/engine/competitionLibrary.ts:41-152` (exactly 6 HOH defs + 6 veto defs) and `:155`
  (`export const NO_REPEAT_WINDOW = 1` — blocks only the immediately-preceding draw, per phase).
- Problem: a season runs ~11 HOH competitions (one per week, including Final 3) and ~10 veto
  competitions (skipped only at Final 3). Drawing 10-11 times from a 6-item pool with only a
  no-immediate-repeat constraint converges to a near-uniform distribution — expected ≈1.8 uses per def.
  By pigeonhole, at least 5 of the 6 defs in EACH pool must be drawn ≥2 times over an 11-week season on
  average, and variance means several will hit 3 times. Since every def carries a fixed `name` +
  `premise` + 3 canned `beats` + `winReads` line, a repeat is not just "another endurance comp" — it is
  the SAME named competition ("Hold the Wall," "Lock and Key") with the SAME flavor text recurring
  verbatim, which is exactly the kind of repetition a BB superfan (or any attentive player) will clock
  immediately, undermining the "structured variety" 0042 was built to deliver.
- Fix: either (a) widen `NO_REPEAT_WINDOW` to bar the last 2-3 draws per phase (a 1-line constant
  change, immediately halves visible short-interval repeats), and/or (b) grow each pool to 10-12 defs
  (real BB seasons run dozens of distinct named comps across a season) so the repeat rate drops
  meaningfully, and/or (c) vary the SURFACE presentation of a repeat draw (a second "Hold the Wall" gets
  a different premise variant/beat set) so even a mechanical repeat doesn't read as verbatim.

[COMP-5] [Severity: Major] [Effort: <1hr-<1day] [Value: Med-High]
The curated library skews governing aptitude 3:2:1 (mental:physical:social) — in BOTH pools
- Where: `src/engine/competitionLibrary.ts:41-152`. Tallying `governing` (which is pinned 1:1 to
  `RELEVANT[type]`, `src/domain/competitionOutcome.ts:32-36`): HOH = quiz+memory+mental → **mental×3**
  (hoh-quiz, hoh-maze, hoh-count), endurance+physical → **physical×2** (hoh-wall, hoh-haul), social → 
  **social×1** (hoh-read). Veto = puzzle+memory+puzzle → **mental×3** (veto-lock, veto-faces,
  veto-scramble), physical+endurance → **physical×2** (veto-hands, veto-hang), social → **social×1**
  (veto-whisper). The identical 3:2:1 skew appears independently in both pools.
- Problem: CLAUDE.md and the domain spec treat Physical/Mental/Social as three CO-EQUAL competition
  stats (explicitly "no Luck stat," implying the three that remain are meant to matter comparably). But
  the curated content layer draws a comp favoring "mental" 50% of the time and one favoring "social"
  only ~17% of the time, in EVERY phase, EVERY week. A social-strategy-archetype houseguest (or a
  player leaning into social play) is structurally handed 3x fewer favorable comp draws than a
  mentally-strong one across an entire season — a real, quantifiable, season-wide fairness skew baked
  into flavor content, not the (correctly stat-agnostic) resolution math.
- Fix: rebalance to an even 2:2:2 split per phase (e.g. retype "hoh-count" as physical-leaning or add a
  second social HOH def, similarly for veto), or explicitly document the skew as an intentional design
  choice (favoring cerebral formats) if it is one — currently it reads as an oversight, not a decision.

[COMP-6] [Severity: Major] [Effort: <1hr] [Value: Med]
House-event / trigger-eruption witness-set-of-2 bug
- Where: `src/composition/orchestrator.ts:716-727` — `witnessSet: [PLAYER, ids[0]!]`, where `ids` (L510)
  is EVERY living NPC in fixed cast order; `ids[0]` is therefore always the SAME single, earliest-order
  surviving houseguest, not a random or contextually-relevant one. Same pattern in the 0091 eruption
  path, `src/adapters/engine/GameSessionAdapter.ts` (`runTriggerEruptions`, ~L5133-5145):
  `witnessSet: [PLAYER, n.id]` (the erupter only) even though `ERUPTION_POOLS`
  (`src/engine/triggers.ts:107-128`) content explicitly reads "in front of the whole house," "a
  confrontation the whole house stops to watch," "everyone pretends not to listen," "the whole house
  clocks it." Compare `foldEruptionWitnesses` a few lines below (`GameSessionAdapter.ts:~5155-5165`),
  which DOES fold a relationship consequence for every awake, co-present houseguest — not just the
  hardcoded 2.
- Problem: the recorded event's `witnessSet` (what the pathway/knowledge model says people legitimately
  know, I3) is narrower than what the engine's OWN relationship-fold logic treats as witnessed a few
  lines later in the SAME function — an internal inconsistency. And the content text describing a
  whole-house happening while formally recording only 2 witnesses means every other houseguest
  structurally "never saw" an event the narration says they all watched — with no gossip pathway to ever
  correct it later (gossip diffusion runs over `scenes`/typed off-screen interactions, never over
  `house-event`-typed records).
- Fix: derive `witnessSet` from the same co-present/awake computation `foldEruptionWitnesses` already
  performs (or, once COMP-1 is fixed, reuse that same "whole gathered house" witness helper for these
  paths too) instead of a hardcoded 2-element array; drop the `ids[0]` special-casing entirely.

[COMP-7] [Severity: Minor] [Effort: <1day] [Value: Med]
Ambient house-event pool (12 lines) is too shallow for its real call frequency
- Where: `src/engine/houseEvents.ts:41-54` (`HOUSE_EVENT_POOL`, 12 entries), fed by the
  once-per-progressed-beat-commit debounced tick (`maybeTurnDrivenTick`,
  `src/composition/orchestrator.ts:339-371`), which can fire multiple times per week (roughly once per
  ceremony-beat progression — HOH comp, nominations, veto comp, veto ceremony, eviction — several times
  a week, well above once/day).
- Problem: even after COMP-2 is fixed, the anti-repeat guarantee (`houseEvents.ts:67-77`) only excludes
  the SINGLE immediately-preceding line — it does not track a longer recency window. At realistic call
  frequency, 12 lines get exhausted and start recurring (non-consecutively, but still verbatim) well
  within the first 2-3 weeks of an 11-week season.
- Fix: either throttle the call frequency (once per in-game DAY, using `dayOfWeek`, rather than once per
  progressed beat), widen the pool to 30-40+ lines, or extend the anti-repeat window (track the last
  N house-events, not just 1) — ideally all three.

[COMP-8] [Severity: Major] [Effort: none beyond COMP-2] [Value: High]
A shipped default-config game produces ZERO ambient (non-ceremony) house texture all season
- Where: `src/composition/orchestrator.ts:716-727` (dead, COMP-2) and `src/engine/triggers.ts` /
  `sandbox.session.triggersEnabledNow()` gated on `ORWELL_TRIGGERS` (opt-in, default OFF per
  `docs/features/0091-trigger-secrets-house-events.md`).
- Problem: taking COMP-2 and the 0091 eruption channel's default-off state together, in the SHIPPED
  default configuration, literally 100% of `type: "house-event"` content a player ever sees is
  engine-authored CEREMONY boilerplate: `"${winner} wins Head of Household"`, `"the veto players are
  drawn: …"`, batched drop/vote reveals, nomination/eviction announcements. The vision brief's "unhurried
  social runway" and "off-screen life exists, is rich, and matters" (I7) promise a house that lives and
  bickers and jokes between ceremonies — none of that ambient layer currently reaches a live player by
  default. This is the single highest-leverage finding in the lane: fixing COMP-2 (a ~1-line change)
  immediately restores an entire shipped-and-tested richness feature to real play.
- Fix: ship COMP-2's fix; consider defaulting `ORWELL_TRIGGERS` on (or re-evaluating why it's off) given
  it's the ONLY other source of non-ceremony ambient texture and is explicitly Vault-safe/calibration-
  neutral by its own design doc.

[COMP-9] [Severity: Major] [Effort: multi-day] [Value: High]
Have-Nots is pure flavor with zero mechanic; no Luxury Competition category exists at all
- Where: `src/domain/house.ts:266-267` — `["have-not", "lounge"]` / `["have-not-room", "lounge"]` are
  literally just ROOM-NAME ALIASES that route to the ordinary "lounge" location; the ONLY other mention
  anywhere in `src/` is one flavor line, `src/engine/houseEvents.ts:43`: `"A slop week hits the
  have-nots and tempers fray by mid-afternoon."` — which (per COMP-2) never fires in live play. There is
  no have-not SELECTION mechanic (no weekly comp/vote/HOH-decision that assigns have-not status), no
  slop-diet/cold-shower state, and no effect on stats/rest/mood anywhere. `CompetitionPhase`
  (`competitionLibrary.ts:16`) is `"hoh" | "veto"` only — no third category exists for reward/luxury
  competitions, even though `docs/features/0042-competition-library.md` §4/§8 explicitly SPECIFIED
  `phase: "hoh"|"veto"|"special"` in its own design contract, and that third phase was simply never
  built.
- Problem: Have-Nots and Luxury/reward Competitions are two of _Big Brother_'s most immediately
  recognizable weekly rituals (cold showers and mystery slop; spa days, phone calls home, prize
  competitions) — a superfan will notice their complete absence within the first couple of weeks. As
  built, "have-not" is not a status anyone can ever hold; it is dead vocabulary.
- Fix: add a genuine weekly have-not mechanic (a lightweight competition or an HOH decision that assigns
  2-4 have-nots for the week, feeding a small hidden mood/rest penalty parallel to the existing ADR 0006
  rest-deficit machinery) and a `"special"`/`"luxury"` `CompetitionPhase` with 3-4 reward-comp defs whose
  win is flavor/mood-only (no HOH/veto power) — this closes the gap the 0042 spec already anticipated.

[COMP-10] [Severity: Minor] [Effort: multi-day] [Value: Med]
NPCs never throw or play it safe in a competition
- Where: `src/engine/liveSeason.ts:760-771` (`roundIntents`) — only `intents.declare(ctx.player,
  playerApproach)` is ever called; the function's own comment states: "NPCs compete (their approach is
  soul-motivated; for now they always compete, matching the single-shot model's NPC path)."
- Problem: floater strategy (an NPC intentionally throwing HOH to stay under the radar), showmance
  veto-gifting (throwing veto so a partner can win it instead), and self-preservation throws near a
  personal target are some of the most memorable/discussed strategic behaviors in real BB seasons — and
  a core piece of "the house schemes without you" (I7). None of the 15 NPCs across an entire season ever
  exhibits this; every houseguest tries maximally hard at every comp, every week, which reads as
  behaviorally flat once a player notices the pattern (e.g. a clearly cornered NPC still "competing" at
  full effort in HOH the week after a brutal blindside).
- Fix: give NPCs a soul-motivated intent decision mirroring the player's (e.g. a strained/threatened NPC
  rolls a chance to declare "throw"/"play-safe" using the same `Intent` machinery already in
  `competitionOutcome.ts`) — carefully, since this is calibration-sensitive (any NPC-side intent change
  needs the same neutrality guardrails the trajectory/campaign layers already use to protect
  `juryReach`/gradient sims).

[COMP-11] [Severity: Minor] [Effort: multi-day] [Value: Med]
Final HOH (Final 3) is an ordinary single-roll draw, not the iconic 3-part format
- Where: `src/engine/liveSeason.ts:426-430` (`hohField`, `finalThree` lifts only the outgoing-HOH
  restriction) and `:634-637` (`crownCompetition`, `finalThree ? "the final Head of Household" :
  "Head of Household"` — same single `resolveHoh` call as every ordinary week, drawn from the same
  6-def library).
- Problem: real BB's Final HOH is structurally distinct and one of the show's most-anticipated
  set-pieces: Part 1 (an endurance/comp eliminating most of the remaining field down to 2), Part 2 (a
  different discipline eliminating to 1), Part 3 (a head-to-head between the Part 1 and Part 2 winners
  for the crown). Here it's flattened to "draw one of the same 6 comps used all season, one person wins."
  A superfan will immediately notice the endgame's signature format never appears.
- Fix: special-case `finalThree` in `resolveHohBeat`/`resolveHoh` into an explicit 3-stage sequence
  (reusing the SAME `resolveCompetition` primitive 3 times with a narrowing field), each stage its own
  BeatEvent so the model can narrate it as the show's climactic format.

[COMP-12] [Severity: Minor] [Effort: multi-day] [Value: Med]
Missing iconic BB competition archetypes entirely
- Where: `src/engine/competitionLibrary.ts:41-152` (all 12 defs).
- Problem: every def in the library resolves via the same shape — a field-wide single roll presented as
  a narrowing-elimination reveal (COMP-3). Missing are some of BB's most iconic and mechanically-distinct
  formats: an OTEV-style true/false question-tree (a stepped Q&A elimination with a distinct rhythm from
  a buzzer quiz), a "Before & After"/chronological-ordering trivia format, and — most notably — a
  pairwise 1-v-1 BRACKET faceoff (the library has no head-to-head elimination structure at all; every
  comp is "everyone competes at once," never "you go against one other person, loser's out"). Combined
  with COMP-9's missing Luxury/reward category, the library covers a narrower slice of BB's competition
  vocabulary than an attentive fan would expect from an "exhaustive" curated set.
- Fix: add 1-2 bracket-format defs (would need a genuinely different presentation grammar — a real
  differentiator from the current single-shape reveal, dovetailing with COMP-3's fix) and an OTEV-style
  question-tree def; both are pure content + a new (currently-nonexistent) bracket presentation branch.

[COMP-13] [Severity: Minor] [Effort: <1hr] [Value: Med]
Engine-authored beat content never carries the drawn competition's NAME
- Where: `src/engine/liveSeason.ts:640` (`` `${winner} wins ${finalThree ? "the final Head of
  Household" : "Head of Household"}` ``), `:649` (`` `${winner} wins the Power of Veto` ``), and
  `:676-689` (`resolveVetoDraw`'s content: `` `the veto players are drawn: ${draw.participants.join(",
  ")}` ``, with an optional Houseguest's-Choice note — but never `def.name`).
- Problem: the drawn `CompetitionDef` (with its curated `name`, e.g. "House Scramble," "Whisper
  Network") is resolved and committed at these exact points, yet none of the engine-authored content
  strings the model receives as ground truth ever say which named competition was played. The model can
  only recover the flavor name by having separately called `runCompetition`/`peekCompetition` earlier in
  the SAME turn and still holding it in context — a fragile hand-off across tool calls the ADR 0003
  "facts to voice" principle argues against (hand the model the fact directly, don't make it fish for it).
- Fix: append `def.name` into the veto-draw and crown content strings (e.g. `` `the veto players are
  drawn for ${def.name}: …` ``, `` `${winner} wins the Power of Veto (${def.name})` ``) — a few one-line
  template edits.

[COMP-14] [Severity: Minor] [Effort: <1hr] [Value: Low-Med]
No `momentPrompts.ts` guidance keyed to the `comp-elimination` beat
- Where: `src/engine/momentPrompts.ts` — grepping the whole file for "comp-elimination", "eliminat",
  "dropOrder", and "stillIn" returns zero matches, despite `comp-elimination` being a real, frequently-
  emitted `Beat` (`src/engine/liveSeason.ts:55,74,613-622`) that fires several times per competition,
  every week.
- Problem: the model gets a MOMENT fragment for `hoh-competition`/`veto-competition` (start of comp) but
  nothing at all for the repeated mid-comp drop-reveal beat — it has no engine-authored steer on how to
  vary pacing/tone across formats (compounding COMP-3) or how many of the drop-batches to actually dress
  in prose vs. summarize.
- Fix: add a `comp-elimination` entry to the `MOMENTS`-style map that reminds the model of the comp's
  format/premise (thread `def.format` through, per COMP-3) and instructs format-appropriate reveal
  language instead of leaving it to reconstruct context from several tool-calls back.

[COMP-15] [Severity: Minor] [Effort: <1hr] [Value: Low]
`narrative.beats` (3 canned phrases) is exposed to the model only once
- Where: `src/engine/liveSeason.ts:582-623` (`advanceCompetition`) never re-attaches `def.narrative` to
  the per-round `comp-elimination` BeatEvent; the def (with its 3 `beats` lines) is only available via
  the earlier `runCompetition`/`peekCompetition` preview call.
- Problem: `STAGED_TARGET_ROUNDS = 5` (`liveSeason.ts:527`) means a comp typically stages 4-8 reveal
  rounds, but each def carries exactly 3 pre-written beat lines meant to scaffold the telling
  ("beats": ["the wall pitches forward…", "cold water sprays…", "two are left white-knuckled…"]) — so for
  most comps the model runs out of engine-supplied material partway through the reveal and has to
  invent additional beats from nothing, risking drift from the def's specific premise the longer the
  comp runs (exactly the genericization 0042 was built to prevent).
- Fix: either attach the relevant `narrative.beats[i]` line to each `comp-elimination` BeatEvent's
  content/metadata (cycling or picking by round index), or write more than 3 beats per def so the
  material outlasts the typical 4-8 round reveal.

[COMP-16] [Severity: Polish] [Effort: <1hr] [Value: Low]
`src/engine/schedule.ts` is a completely orphaned day-cadence model
- Where: `src/engine/schedule.ts` (`scheduleWeek`, `simulateSeasonSchedule`, `isMeaningful`,
  `DayKind`/`Day`, the `SOCIAL_DAY_PROB = 0.25` "optional social day" rule). Grepping the whole repo for
  importers of this module outside itself finds exactly one: `tests/property/schedule.property.test.ts`.
  It is never imported by `liveSeason.ts`, `orchestrator.ts`, or any other production path.
- Problem: this module independently re-implements "does this week get one optional, significant
  house-event day" — a concept the LIVE loop and `houseEvents.ts`/orchestrator.ts already handle their
  own way (via the per-beat tick + `nextHouseEvent`, itself dead per COMP-2). Two unrelated,
  never-reconciled implementations of the same idea sitting in the codebase is exactly the kind of
  "half-wired" surface the vision brief's C6 flags — it costs real maintenance attention (a property
  test keeps it green) for zero player-facing effect.
- Fix: either wire it in (if the "0.25 probability of one optional social day per week" cadence is meant
  to govern the live loop and currently doesn't) or delete it along with its test as dead/legacy — but
  the current silent-orphan state should not persist un-flagged.
```

## COVERAGE NOTE (where I looked / what I did NOT cover)

Read in full: `src/engine/competitionLibrary.ts`, `src/domain/competitionOutcome.ts`,
`src/engine/houseEvents.ts`, `src/engine/triggers.ts`, `src/engine/schedule.ts`,
`docs/features/0042-competition-library.md`, `docs/features/0106-exclusive-house-events.md`. Read
narrowly (grep + targeted offsets, per the token-frugal instruction) in: `src/engine/liveSeason.ts`
(the full staged-comp/eviction-reveal grammar, ~L1-800 + the beat-content grep across the whole file),
`src/composition/orchestrator.ts` (the tick/commit spine, `defaultApply`, `commitPlayerTurn`,
`maybeTurnDrivenTick`), `src/composition/registry.ts` (`setOnEvent`/`setOnShowmanceSurfaced` event
recording), `src/adapters/engine/GameSessionAdapter.ts` (`runTriggerEruptions`,
`foldEruptionWitnesses`, `ctx()`/`restOf`), `src/domain/temperatureConstants.ts`,
`src/engine/confessionals.ts` (`selectRecentForConfessional`), `src/engine/confessionalConstants.ts`,
`src/engine/momentPrompts.ts` (grep for comp/house-event fragments), `src/engine/richness.ts`,
`src/engine/richnessConfig.ts`, `src/domain/house.ts` (room aliases).

Verified with cross-repo greps (not just spot reads) that: `CompetitionFormat`/`.format` is read
nowhere outside its own definition file; `nextHouseEvent`/`eruptionEvent` have exactly the call sites
documented above; `trigger === "player-turn"` is never produced by any production `.advance()` call
site (only 2 test-harness calls); `schedule.ts` has exactly one importer (its own test); "have-not"/
"haveNot" appears nowhere else in `src/` or `docs/features/`; `roundIntents` never declares an NPC
intent.

NOT covered (out of lane / would need live-model or FE verification, flagging for cross-territory
awareness): whether the FE actually renders `def.format`/`narrative` distinctly per comp type in any
UI chrome (gadget rail, decision cards) — that's FE/UX territory; the actual behavior of a real LLM
narrator given the current engine inputs (i.e., whether GLM-4.7 already compensates for COMP-3's
format-blindness through its own creative writing) — would need a live-model transcript run, which I
did not have budget/telemetry for in this pass; the jury/calibration-gradient sensitivity of COMP-5's
rebalance or COMP-10's NPC-throw proposal (both explicitly flagged above as "calibration-sensitive,
needs the same neutrality guardrails" rather than asserting a safe fix). I did not re-derive exact
expected-repeat-count statistics via simulation (no `ts-node`/build step run, per the audit's "don't
run test suites" instruction) — the ≈1.8 uses/def figure in COMP-4 is an analytic expectation
(11 draws / 6 items under a uniform stationary distribution with a no-immediate-repeat constraint), not
a measured simulation output; flagged as such in the finding.

I did NOT find these to be non-issues after investigation (i.e. ruled out, not reported): whether the
model could see a competition's outcome preview before the player's binding intent commits (checked —
`peekCompetition` returns `null` while `s.pending` is set, closing the loophole); whether the player
ever receives outcome protection (checked `resolveCompetition`/`competitionOutcome.ts` — no
player-special-casing found, intent penalties apply symmetrically, `restPenalty` is opt-in and applies
to the player exactly like any NPC).

I have exhausted the territory assigned (comp library, comp resolution/staging math, house-event
generation + its wiring, the daily-event/day-cadence machinery, comp-intent/throw behavior, and the
comp/house-event narration hand-off) to the depth the lane's token budget allows. I stopped adding
findings once further digging (e.g. micro-wording nits in specific beat-content template strings)
would have produced diminishing-value Polish items rather than new substantive gaps.
