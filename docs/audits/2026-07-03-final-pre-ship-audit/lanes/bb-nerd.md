# BB-NERD — Big Brother canon & spirit audit (exhaustive pass v2)

**Auditor stance:** the superfan playtester. Evidence = the captured real-model season
(`scratchpad/audit/journey.md`, the full FE agent log `tasks/b5yte01l8.output`, the unsealed
vault + engine truth in `journey-debug-bundle.json` and the engine save
`journey-engine-data/64656661756c74/v000200.json`) + the rules as implemented in
`/home/user/orwell/src/engine/` and the canonical mechanics in CLAUDE.md. Every finding tagged
**[CANON]** (show-mechanics rule) or **[SPIRIT]** (the felt experience).

## Fan's-eye verdict
The skeleton is genuinely Big Brother — better than most licensed games: chip draw as its own
ritual beat with Houseguest's Choice, secret ballots that unseal post-season with receipts, a
10–3 week-1 pile-on blindside where my dissenting vote was faithfully recorded, "By a vote of
10 to 3, Jada Marin, you are evicted from the Big Brother house," keys turning at the
nomination ceremony, the outgoing HOH benched, compete/throw/play-safe intents, memory-wall
greying, even the deep-cut HOH music perk. The *hidden* season is rich (259 vault events in a
week and a half — the house truly schemes without you). What a superfan clocks instantly: the
cast wall cracked THREE times in one premiere (two real houseguests introduced under invented
names, whose fake bios then contaminated the veto crown), every comp is staged in the same
elimination grammar regardless of format, NPCs never throw a comp, there is no Final-3
three-part HOH, no eviction-night pleas, no HOH-room reveal, and the Diary-Room confessionals
that power the season-end payoff are 90% one mad-libs template that literally says "player is
the one I actually trust."

## Index
| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| BB-1 | Major | <1day | High | Premiere renames two REAL houseguests into phantoms; fake bios contaminate the veto crown | agent log rounds 18/20; premiere seam |
| BB-2 | Major | <1hr | High | Live confessionals drop rng/voice — 38/41 are one template; retrospective payoff reads mad-libs | orchestrator.ts:690 |
| BB-3 | Major | <1hr | High | Literal token "player" baked into retrospective-bound content | confessionals nameOf; liveSeason drop content |
| BB-4 | Major | multi-day | Med | No Final-3 three-part HOH — the endgame's most iconic structure is a generic drawn comp | liveSeason.ts:637,743 |
| BB-5 | Major | <1day | High | NPCs never throw or play safe — the whole house max-efforts every comp | liveSeason.ts:763-770 |
| BB-6 | Major | <1day | Med | Eviction night has no nominee speeches and no structural campaign slot | liveSeason advanceEviction; momentPrompts eviction |
| BB-7 | Major | <1day | High | Non-inert beats consumed in silent rounds — 3 cold goodbye VTs + the ballot drip never narrated | agent log 01:01–01:02; agent_loop |
| BB-8 | Minor | <1hr | Med | Comp library 6 HOH + 6 veto with NO_REPEAT_WINDOW=1 — comps repeat every other week | competitionLibrary.ts:152-155 |
| BB-9 | Minor | <1day | Med | One-size elimination staging grammar contradicts comp formats (quiz/race/counting "eliminate" players) | liveSeason staged rounds ×- library formats |
| BB-10 | Minor | <1hr | Med | "House History" season-quiz can be drawn week 1 when there is no season to quiz | competitionLibrary drawCompetition |
| BB-11 | Minor | <1hr | Low | Batched ballot beat "3 votes to evict X" reads like a raffle, not a live-vote reveal | liveSeason.ts:557-569 |
| BB-12 | Minor | <1day | Med | NPC goodbye-message tones are player-visible — canon says only the evictee ever sees goodbyes | liveSeason.ts:1262 |
| BB-13 | Minor | <1hr | Med | House-event pool invites the narrator to invent untracked mechanics (have-nots/slop, luxury winners, care packages) | houseEvents.ts:41-54 |
| BB-14 | Minor | <1day | Med | No HOH-room reveal / letter-from-home beat — the weekly emotional ritual is absent | momentPrompts social/hoh; liveSeason |
| BB-15 | Minor | <1day | Med | Jury threshold never lands in the fiction — "making jury" milestone missing | GameSessionAdapter seatOf; eviction prompt |
| BB-16 | Minor | <1day | Med | Alliances are unnamed pairwise edges — no "The Brigade" texture anywhere | deals.ts / blocs.ts / recordInteraction descriptor |
| BB-17 | Minor | <1hr | Med | Jury house (0100) built but default-off — jury-management's second half never runs at ship defaults | juryHouseConstants / ORWELL_JURY_HOUSE |
| BB-18 | Minor | <1hr | Med | Veto-ceremony moment prompt is the thinnest ceremony — no veto-meeting ritual grammar | momentPrompts.ts:673-675 |
| BB-19 | Minor | multi-day | Med | Player has no in-character Diary-Room confessional mode — the show's signature player texture | DR gadget / momentPrompts diary-room |
| BB-20 | Polish | <1hr | Med | NPC-evictee walk-out staging absent from the eviction prompt (front door, hug line, wall greys) | momentPrompts eviction |
| BB-21 | Polish | <1day | Low | No superfan-vs-recruit axis in generated casts | CharacterFactory archetypes |
| BB-22 | Polish | <1hr | Low | "steps in a montage" — edit-room vocabulary inside the house | competitionLibrary hoh-count premise |
| BB-23 | Polish | <1hr | Low | Overheard fragments truncate mid-word ("formed an allia…") | presence overhear truncation |
| BB-24 | Polish | <1hr | Low | No "expect the unexpected" production-voice texture on twist night | momentPrompts twist-reveal |
| BB-25 | Polish | <1day | Low | No luxury/food/reward comps — reward texture exists only as one random pool line | competitionLibrary; houseEvents |
| BB-26 | Polish | <1hr | Low | Endurance comps drop 3 houseguests per beat — kills the one-at-a-time falls | STAGED_TARGET_ROUNDS vs format |
| BB-27 | Polish | <1hr | Low | Premiere: all 16 walk in at once vs the show's staged entrance groups | momentPrompts premiere |
| BB-28 | Polish | <1hr | Low | House-event pool is 12 lines for a ~14-week season — visible recycling by mid-game | houseEvents.ts pool size |

Severity: **Blocker 0 · Major 7 · Minor 12 · Polish 9** (28 findings)

---

## What genuinely lands (credit where due — keep these exactly as they are)
- **[CANON] The chip-draw ceremony** (E35) as a witnessed ritual with Houseguest's Choice, NPC
  pick by strongest bond, player pick deferred to a real pending (B45). Show-accurate and better
  scripted in the prompt than most of the ceremonies.
- **[CANON] Secret ballots + post-season unsealing** (E12/0048): my 10–3 blindside vote was in
  the vault, attributed, sealed. The reveal grammar "a vote to evict…" and the final "By a vote
  of 10 to 3… you are evicted from the Big Brother house" is the real cadence.
- **[CANON] Eligibility spine**: outgoing HOH benched (and the persona prompt even makes them a
  named spectator), veto winner can't be the replacement, HOH+noms always play veto, F5/F4 veto
  fields shrink correctly, HOH tie-break, last-evicted-juror finale tie-break, jury of 9.
- **[SPIRIT] The hidden season is REAL**: 259 vault events across 1.5 weeks — secret threads,
  45 secrets, showmance seeds (Gina close to BOTH Javier and Diego — a love triangle no one
  showed me), gossip with drift and graded overhear clarity. I7 is honored.
- **[CANON] Reserve twists** are the right three (double eviction, battle-back, secret power),
  sealed, rare, non-structural. The double-eviction beat copy is already written.
- **[SPIRIT] Anti-sycophancy held all game**: I declared compete and got eliminated round 2;
  I voted Maeve and the house overruled me. Nothing protected me.
- **[CANON] Deep cuts**: the HOH music perk (the old CD-player luxury), memory-wall greyscale on
  eviction, "on the block" HUD copy, week = HOH reign with the Day-1..5 cadence, showmance
  discipline ("political first, not a dating show"), the no-real-host rule.

---

## Findings

### [BB-1] [Severity: Major] [Effort: <1day] [Value: High]
**[CANON] The premiere renamed two REAL houseguests into phantoms ("Myra Trujillo", "Irene Shaffer") — and the invented bios then contaminated the veto crown**
- **Where:** live run, agent log `tasks/b5yte01l8.output` rounds 18 & 20 (00:45:01 / 00:45:09):
  bolded nameplate intros — `**Myra Trujillo:** "Myra. Tattoo artist, Albany, thirty-five."` and
  `**Irene Shaffer:** "Irene. Phlebotomist, Queens, thirty-one."` — each immediately followed by
  a `markHouseguestMet` call. The engine roster (save v000200) has NO such people; the real
  tattoo artist is **Shea O'Malley** (npc:5) and the real phlebotomist is **Gina Ricci**
  (npc:11). Neither profile carries a hometown or age — "Albany, 35" and "Queens, 31" are pure
  invention. Days later the veto crown narration (00:58:59) read: *"**Shea O'Malley wins the
  Power of Veto.** The backyard erupts as **the tattoo artist from Albany** locks down the
  power…"* — the phantom's fake bio welded onto the real name.
- **Problem:** This is the cardinal sin (invented houseguest) in a *worse* mode than v1's J-1
  (Audrey Duran, a pure invention that got corrected): here the fake people were **marked met**,
  so the meet-everyone gate credited introductions that never happened under the real names.
  From the player's chair: I met "Myra from Albany"; a stranger named "Shea O'Malley" — *also* a
  tattoo artist from Albany — later won the Power of Veto and decided my week. Two tattoo
  artists from Albany, one who vanished, one who materialized holding the veto. The prompt-only
  guard (momentPrompts 304–309/616–619) demonstrably does not hold, exactly as mandate #2
  predicts. Violates I2/I6; corroborates + extends J-1 (three cast-wall breaks in ONE premiere).
- **Fix:** a hard FE belt, not prompt wording: during premiere intro turns, before a round's
  visible text commits, scan bolded/nameplate tokens against the engine roster
  (`/api/orwell/roster` names); any full-name nameplate not on the roster ⇒ reject/regenerate
  the round (the reasoning-scrub seam in `chat_helpers.py` already post-processes rounds). Also
  make `markHouseguestMet`'s tool RESULT echo the houseguest's canonical name + "introduce them
  by THIS exact name" so the model is grounded at the moment of use.

### [BB-2] [Severity: Major] [Effort: <1hr] [Value: High]
**[SPIRIT] Live confessionals never engage the variety/voice machinery — 38 of 41 are the same mad-libs template, gutting the retrospective payoff**
- **Where:** `src/composition/orchestrator.ts:690` — the live per-turn confessional call is
  `confessionalFor(confessor, ids, relationships, { player: PLAYER, recentEvents })`. Per
  `confessionals.ts:70-71`, **omitted `rng` ⇒ "the first template (deterministic)"**; omitted
  `voice` ⇒ the 0090 voice-keyed pools never fire; omitted `nameOf` ⇒ see BB-3.
- **Problem:** In the captured season, 38/41 vault confessionals collapse to *"after how that
  just played out: I need {X} gone — they're my biggest threat. {Y} is the one I actually
  trust."* The engine SHIPPED seeded phrasing variance (E55), voice-keyed curt/expansive pools
  (0090), and grounded gists (0089) — and the one call site that runs every live turn engages
  none of them. These lines are the receipts the 0048 retrospective unseals — the vision's peak
  payoff moment #1 ("it was real all along") reads as a template printer. A superfan who unseals
  the season will laugh at the DR.
- **Fix:** at orchestrator.ts:690 pass `rng` (a seeded per-confessional stream — one exists two
  lines up for `recentRng`), `voice: voiceProfileOf(confessor)`, and `nameOf` (the public
  display-name resolver). All three parameters are built and tested; this is wiring.

### [BB-3] [Severity: Major] [Effort: <1hr] [Value: High]
**[SPIRIT] The literal token "player" is baked into retrospective-bound content — "player is the one I actually trust"**
- **Where:** vault dump (`journey-debug-bundle.json` → producerVault.hiddenStory): 9+
  confessionals read *"player is the one I actually trust"*; engine save house-events read
  *"Tanner Huff, player, Regina Manning are eliminated; 10 remain"*. Root cause documented in
  `confessionals.ts:93-103`: the player's id is the bare word `player` and
  `humanizeForRetrospective` deliberately leaves bare words untranslated (#845 common-noun
  guard) — the compose-time `nameOf` resolver exists precisely for this and is not passed
  (BB-2); the staged-drop content in `liveSeason.ts` (comp-elimination joins raw ids) has no
  resolver at all.
- **Problem:** At the season-end unsealing — and on any record-fed surface (re-entry facts,
  journal) — the player named **Dana** reads about a houseguest called "player". It's the
  machinery's underwear showing at the exact moment the game is taking its bow (I9 + the 0048
  payoff).
- **Fix:** pass `nameOf` at the orchestrator call site (with BB-2), and use the same resolver
  when composing staged-drop / crown / eviction beat contents in `liveSeason.ts` (or resolve the
  bare `player` token inside `humanizeForRetrospective` behind an explicit player-name argument
  so the #845 guard stays intact for genuine common nouns).

### [BB-4] [Severity: Major] [Effort: multi-day] [Value: Med]
**[CANON] No Final-3 three-part HOH — the most iconic endgame structure in the franchise is a generic drawn comp**
- **Where:** `src/engine/liveSeason.ts:637` (`finalThree ? "final-eviction" : "nominations"`) and
  `:743` — at Final 3 the engine runs ONE standard library comp, then the winner personally
  evicts. Nothing anywhere models Part 1 (endurance, all three) → Part 2 (skill, the two Part-1
  losers) → Part 3 (the jury A/B quiz, Part-1 winner vs Part-2 winner).
- **Problem:** Every superfan knows Final 3 IS the three-part HOH — it's the endgame's whole
  dramatic engine (the Part-1 throw, the Part-3 choke). Skipping noms/veto at F3 is correct;
  replacing the three-parter with "Night Maze" is the single loudest "not really the show"
  moment left in the format. (Final-HOH-evicts-live is correctly implemented — credit.)
- **Fix:** a Final-3 sub-state machine like the eviction/finale ones: three staged parts, each a
  real `resolveCompetition` roll over the right field (endurance-typed, skill-typed, then a
  mental/social "jury quiz" def), player intent per part, winner of parts 1 & 2 meeting in part
  3. Presentation can reuse the staged-rounds kit; the trajectory-neutrality guard pattern
  already exists for staging.

### [BB-5] [Severity: Major] [Effort: <1day] [Value: High]
**[CANON][SPIRIT] NPCs never throw or play safe — sixteen try-hards, every comp, all season**
- **Where:** `src/engine/liveSeason.ts:763-770` — *"NPCs compete (their approach is
  soul-motivated; for now they always compete)"*; only the player's declared intent enters
  `CompetitionIntents`.
- **Problem:** Throwing comps is a signature BB behavior the game itself teaches the player
  (compete/throw/play-safe buttons) — then no NPC ever does it. The comp-beast/floater
  archetype split loses its main expression (a floater who never lays low in a comp is not a
  floater); week-1 "nobody wants the first HOH" is a canon beat that can never happen; and the
  player's own throw lever has no mirror in the world, which quietly flags the machinery (I6/I7:
  people make sense; the house plays its own game).
- **Fix:** derive NPC intent in `buildIntents` from CHARACTER + SOUL + board state: floaters/
  under-the-radar archetypes play-safe by default; a housemate whose closest bond is cruising
  to win throws; high-threat-perceived NPCs sometimes throw the FIRST HOH (the classic superfan
  move); nominees always compete in veto. Seeded, bounded, and it feeds the existing intent
  penalty math (0028) unchanged — no new outcome authority.

### [BB-6] [Severity: Major] [Effort: <1day] [Value: Med]
**[CANON] Eviction night has no nominee speeches, and there is no structural campaign slot between the veto ceremony and the vote**
- **Where:** `advanceEviction` (`liveSeason.ts:1216+`) opens directly in the `votes` stage; the
  eviction moment prompt (momentPrompts.ts:676-709) goes straight to ballots. Observed live:
  veto ceremony narrated 01:00:20 → eviction-vote submitted 01:01:09 — 49 seconds of Day-4→5.
- **Problem:** Canon eviction night starts with each nominee's final plea ("save me because…"),
  and the veto-meeting→eviction window is the campaign scramble — arguably the most social-play-
  dense stretch of a real week, and this game's whole instrument is social play. There is no
  `eviction-speech` beat, no player-nominee plea pending (a survive-the-block player never gets
  their live speech), and the FE runway (`_LANDED_RUNWAY_PHASES` in chat_helpers.py:246) arms
  landed holds for `nominations` only — the eviction-vote pending "advances straight through"
  the hold by design, so nothing protects the campaign window from a model that self-advances.
- **Fix:** engine: prepend a `speeches` stage to `EvictionProgress` (one beat per nominee; when
  the player is nominated, a free-text `eviction-speech` pending — same pattern as
  finale-statement). FE: arm the landed runway for the post-veto-ceremony spectator window like
  nominations. Prompt: add the plea beat to the eviction moment script.

### [BB-7] [Severity: Major] [Effort: <1day] [Value: High]
**[SPIRIT] Non-inert beats get consumed in silent tool-only rounds — the week's juiciest dramatic irony (three cold goodbye VTs) and the staged ballot drip never reached the player**
- **Where:** agent log 01:01:11–01:02:50: rounds 2–6 (ballot reveals *"3 votes to evict Jada
  Marin"*…) and rounds 1–6 of the next turn (eviction-goodbye beats: **Diego cold, Shea cold,
  Klaus cold**) each executed `advanceGame` with **0 chars of narration**; the player got one
  summary paragraph ("The voting has finished… 10 to 3") and then "Week 2 begins."
- **Problem:** The engine choreographed a staged reveal (E12) and seeded goodbye messages whose
  tones are real jury-management signals — the exact "tension-and-release" the vision promises —
  and the narration layer swallowed all of it. I never learned three houseguests went COLD on
  Jada (legit dramatic-irony fuel), and the vote reveal I was owed as a live set-piece arrived
  as a wire-service recap. Corroborates J-3 (raises its priority) with a NEW mechanism finding:
  it's not only montage-by-advance — rounds that consume non-inert BeatEvents can end with zero
  visible text.
- **Fix:** in `agent_loop.py`, track BeatEvents returned by `advanceGame` during a turn; if the
  turn is ending with consumed non-inert beats that were never voiced (no visible text since),
  force one final narration round whose prompt enumerates exactly those beats ("voice these, in
  order, then stop"). This is error-correcting an omission (sanctioned belt class C1), not
  authoring.

### [BB-8] [Severity: Minor] [Effort: <1hr] [Value: Med]
**[CANON] Six HOH + six veto comps with a no-repeat window of 1 — a full season replays each comp ~2×, sometimes two weeks apart**
- **Where:** `competitionLibrary.ts:41-155`; `NO_REPEAT_WINDOW = 1`.
- **Problem:** a 16-cast season runs ~13 HOH + ~12 veto comps against pools of 6. With only the
  immediately-previous draw excluded, "Hold the Wall" can legally return in week 3 after week 1.
  Real seasons essentially never rerun a comp concept (recurring franchise formats aside). A
  superfan tracks comps; visible recycling by week 4 reads low-budget.
- **Fix (quick):** raise `NO_REPEAT_WINDOW` to 4 (pool of 6 still always leaves 2 candidates).
  **Fix (right):** grow each pool toward 10-12 defs — the module header explicitly invites
  adding defs freely; include the missing canon staples (an OTEV-style scramble-and-answer, a
  days/before-or-after quiz, a "how bad do you want it" punishment-taking veto).

### [BB-9] [Severity: Minor] [Effort: <1day] [Value: Med]
**[CANON] Every comp is staged in the same elimination-rounds grammar, contradicting the comp's own format**
- **Where:** staged rounds (`liveSeason.ts` `advanceCompetition`) emit "X, Y, Z are eliminated;
  N remain" for every def; observed: **"The Long Haul"** (a race — *first* to tip your scale
  WINS) narrated as four elimination waves; "Count the House" (closest-guess) and "House
  History" (buzzer quiz) would stage identically.
- **Problem:** elimination staging is native to endurance (drops) and OK for sudden-death
  quizzes, but a race or a counting comp has no mechanism by which "Diego, Caleb, Jada are
  eliminated" — a fan hears the format contradiction immediately, and the narrator is forced to
  invent one ("heading to the sidelines"). The library carries a `format` field that the staging
  ignores.
- **Fix:** presentation-only (keep the single up-front roll + fixed drop order — the
  `stagedTrajectoryNeutral` guard stays): key the per-round BeatEvent content on `def.format` —
  endurance ⇒ "drops"; quiz ⇒ "answered wrong and is out"; skill/race ⇒ "falls behind" with the
  final beat "first across"; social ⇒ "misses a read". Same ids, same order, same winner —
  different verbs.

### [BB-10] [Severity: Minor] [Effort: <1hr] [Value: Med]
**[CANON] A season-history quiz can be drawn in week 1, when the season has no history**
- **Where:** `drawCompetition` (competitionLibrary.ts:168-176) draws uniformly per phase;
  `hoh-quiz` ("rapid-fire questions about what really happened this season") and `veto-faces` /
  `veto-whisper` (match overheard quotes) are legal week-1 draws.
- **Problem:** "House History" on Day 1 quizzes five days of nothing; "Whisper Network" needs
  weeks of overheard material. The show schedules memory/history comps late-season for exactly
  this reason.
- **Fix:** add an optional `minWeek` to `CompetitionDef` (hoh-quiz/veto-whisper: 3+) and filter
  in `drawCompetition` alongside the no-repeat window (fall back to the pool when empty, as now).

### [BB-11] [Severity: Minor] [Effort: <1hr] [Value: Low]
**[CANON] Batched ballot beats read "3 votes to evict Jada Marin" — a raffle, not a vote reveal**
- **Where:** `batchedRevealContent` (liveSeason.ts:557-569); observed beats: "3 votes to evict
  Jada Marin" ×2, "2 votes to evict Jada Marin, a vote to evict Maeve O'Shea" ×2…
- **Problem:** the live-show grammar is one ballot at a time ("I've got a vote to evict…").
  Handing the narrator a pre-summed clump invites exactly the flat "the voting has finished"
  recap we got (BB-7). The batching is a sanctioned pacing call — but the *content* shouldn't
  pre-aggregate.
- **Fix:** keep the batch cadence, but make the content an ordered list of individual anonymized
  ballots ("a vote to evict Jada. a vote to evict Jada. a vote to evict Maeve.") so the model
  can read them out one by one with the count building.

### [BB-12] [Severity: Minor] [Effort: <1day] [Value: Med]
**[CANON] The player can watch other houseguests' goodbye-message tones — on the show, only the evictee ever sees goodbyes**
- **Where:** `liveSeason.ts:1262` — the goodbye stage emits player-narratable beats
  `"Diego Salinas leaves Jada Marin a cold goodbye message"` for every seeded NPC sender, with
  the player as audience of the narration (the recorded event's witness set is
  [sender, evictee], but the BeatEvent is handed to the GM to voice into the player's turn).
- **Problem (I3-adjacent):** goodbye VTs are recorded privately and shown only to the evictee;
  the house never learns who went cold. If the model voices these beats (it should — see BB-7),
  Dana learns "Diego is cold on Jada" — first-class social intel with no legitimate pathway.
  The knowledge model is right in the event store and wrong on the narration channel.
- **Fix:** when the evictee is an NPC, emit the NPC goodbye beats as camera-facing color WITHOUT
  the tone (e.g. "Diego records a goodbye message for Jada") or collapse them into one beat
  ("the house records its goodbye messages"); keep the tones engine-only (they already fold into
  manner). When the PLAYER is the evictee, voice the full toned goodbyes — that's the canon
  payoff moment.

### [BB-13] [Severity: Minor] [Effort: <1hr] [Value: Med]
**[CANON][SPIRIT] House-event pool lines invite the narrator to invent mechanics the engine doesn't track (have-nots, luxury winners, care packages)**
- **Where:** `houseEvents.ts:41-54`: "A slop week hits the have-nots…", "A luxury reward splits
  the house into winners celebrating and losers sulking", "A care-package delivery stirs
  jealousy over who got remembered from home". The engine has no have-not assignment (the
  "have-not room" in `domain/house.ts:266` is just an alias for the lounge), no luxury-comp
  winner, no care-package recipient; the persona prompt simultaneously orders "never invent a
  MECHANIC or beat that wasn't handed to you".
- **Problem:** when one of these fires, the model must either name have-nots/winners that exist
  nowhere (inventing board-adjacent facts — who's on slop is real BB *state* that affects comps
  and mood) or narrate weirdly around them. Also: care packages from home aren't classic-format
  canon at all (that's BB18/OTT America's packages) — a fan clocks it.
- **Fix (quick):** reword the three lines to mechanism-free texture ("a brutal week of slop
  rations has the kitchen at war" without "the have-nots"; cut the care-package line). **Fix
  (right, ties BB-25):** add a minimal seeded weekly have-not pick (Vault-free, witnessed) so
  slop is a real, consequential state the narrator can voice honestly.

### [BB-14] [Severity: Minor] [Effort: <1day] [Value: Med]
**[CANON] No HOH-room reveal — "Who wants to see my HOH room?!", the letter from home, the basket**
- **Where:** nothing in `liveSeason.ts` beats, `houseEvents.ts`, or `momentPrompts.ts` stages
  the HOH room reveal; the only HOH perk modeled is the (excellent) music luxury
  (`zeitgeist.ts:298`). Observed: Lorenzo's crown → nomination ceremony in the same narration
  chain, no room beat.
- **Problem:** the HOH-room reveal is the show's weekly emotional heartbeat — the whole house
  crowding in, the letter from home read aloud (often the season's only tears), the photos. It's
  also load-bearing socially: it's where the house performs loyalty to new power — exactly this
  game's subject matter.
- **Fix:** cheapest: a line in the post-HOH `social` moment prompt ("the evening of a crown, the
  new HOH calls 'who wants to see my HOH room?' — play the reveal, the basket, the letter from
  home in their own voice"). Better: a seeded `house-event` emitted once after each HOH crown so
  it's a real recorded fact (and the letter is a natural CHARACTER/backstory surfacing hook).

### [BB-15] [Severity: Minor] [Effort: <1day] [Value: Med]
**[CANON] "Making the jury" never lands in the fiction — the season's biggest mid-game milestone is silent**
- **Where:** the jury boundary is computed (`GameSessionAdapter` `seatOf`: `preJury = cast-2-9`)
  and the Cast panel flips evictees to "Jury" — but no beat, house-event, or moment-prompt line
  marks the week the jury phase begins, and `jury = evictionOrder.slice(-9)` is only assembled
  at the finale.
- **Problem:** in the house, "are we at jury yet?" drives whole strategies (throw-until-jury,
  jury-threat evictions, "don't waste a juror on him"). Houseguests *know* and *say* when jury
  starts. Here the player can only infer it from a HUD status flip on an evicted card.
- **Fix:** at the eviction that forms the first juror, append the fact to the eviction beat
  content ("…and becomes the first member of the jury") and add one line to the eviction moment
  prompt ("when the game marks a juror, that's a live-show announcement — the house reacts:
  everyone left is guaranteed a jury vote to court or burn").

### [BB-16] [Severity: Minor] [Effort: <1day] [Value: Med]
**[SPIRIT] Alliances have no names — pairwise edges and emergent blocs, but no "The Brigade"**
- **Where:** vault alliance events are pairwise ("Mila Kowalski formed an alliance with Shea
  O'Malley"); `deals.ts` kinds are safety/vote/final-two/target-other; `blocs.ts` computes
  emergent clusters; nothing anywhere carries an alliance NAME.
- **Problem:** naming the alliance is half the fun of forming one on the show (Chilltown, The
  Brigade, The Cookout, Level Six) — it's identity, comedy, and the thing the retrospective
  hangs its story on ("The Hitmen ran the season"). The player forming a core alliance here has
  nothing to call it and nothing that remembers what they called it.
- **Fix:** open-set, per ADR 0005: let `recordInteraction`'s consequence descriptor (or a small
  optional field on deal creation) carry a model/player-authored alliance name; store it on the
  bloc/deal as expressive texture (never normalizing behavior), surface it in npcVoice context
  and the retrospective. The engine keeps deciding everything; the name is pure recorded meaning.

### [BB-17] [Severity: Minor] [Effort: <1hr] [Value: Med]
**[SPIRIT] The jury house (0100) is built but default-off — at ship settings, jurors never harden their grudges and the finale prompt never sees jury-house texture**
- **Where:** `juryHouse.ts` + `ORWELL_JURY_HOUSE` gate (liveSeason.ts:249-259, 1304-1308) —
  bounded grudge deepening, grievance rumors ("word in the jury house is that {finalist} did
  {origin} dirty on the way out").
- **Problem:** jury management is a headline canon mechanic ("how you treat houseguests on the
  way out genuinely influences their vote" — CLAUDE.md). The sequestered second society that
  makes bitter juries FEEL earned exists in the codebase and won't run for a single shipped
  player. Default-off was a PO batch ruling for the 0087–0104 texture set, but this one is
  calibration-capped (`adjustmentCap < |MANNER_LEAN.betrayed|`) and deepens the game's most
  vision-central loop.
- **Fix:** promote `ORWELL_JURY_HOUSE=1` to the deploy default (it's engine-bounded and
  seeded; the juryReach guard gates regression), or at minimum add it to the launch config
  checklist as a recommended flag.

### [BB-18] [Severity: Minor] [Effort: <1hr] [Value: Med]
**[CANON] The veto-ceremony moment prompt is two lines — the only ceremony with no ritual grammar**
- **Where:** `momentPrompts.ts:673-675`: "The veto holder uses it or not; if used, the HOH names
  a replacement… Maximize the suspense of the chess move." Compare nominations (15 lines, keys,
  speeches) and eviction (30+ lines, ballots, tallies).
- **Problem:** the veto meeting has the most quotable ritual script on the show: the holder
  gives each nominee the chance to plead their case, then "…I have decided NOT to use the Power
  of Veto" / "I have decided to use the Power of Veto on X" → the HOH "must name a replacement
  nominee" → "this veto meeting is adjourned." None of that grammar is cued, so the ceremony's
  weight rides entirely on the model's training luck.
- **Fix:** expand the moment fragment with the canon beats: gather the house, nominee pleas
  (voice both), the holder's decision speech in their own register, the replacement naming (from
  the game's recorded pick ONLY), "this veto meeting is adjourned," then the room's fallout.

### [BB-19] [Severity: Minor] [Effort: multi-day] [Value: Med]
**[SPIRIT] The player never gets an in-character Diary Room confessional — the show's signature first-person texture**
- **Where:** the DR gadget + `diary-room` moment (momentPrompts.ts:731-733) are an OOC
  producer/strategy channel by design (correct for I3 — no pathway to NPCs). NPC confessionals
  exist (Vault-only). There is no mode where DANA talks to the camera in character.
- **Problem:** every houseguest fantasy includes the DR chair — narrating your own game, trash-
  talking your rivals to the camera. It's also the natural home for the player's OWN voice in
  the 0048 retrospective "edit" (right now the unsealed season has NPC confessionals but no
  player DR cuts to intercut them with).
- **Fix (feature suggestion):** an opt-in "roll camera" mode in the DR gadget: player speaks in
  character; recorded as a player-witnessed-only confessional event (zero pathway, zero fold —
  pure record); surfaced in the retrospective alongside NPC confessionals. Cheap engine-side
  (an event type), big fantasy payoff.

### [BB-20] [Severity: Polish] [Effort: <1hr] [Value: Med]
**[CANON] NPC-evictee walk-out staging is unscripted — no front door, no hug line, no wall grey**
- **Where:** the `eviction` moment prompt covers ballots and goodbyes; only the PLAYER-evictee
  moment (`evicted`) scripts the walk-out. Observed: Jada's exit got "Jada Marin leaves the
  house" folded into a recap (the model volunteered a nice "blank spot on the memory wall" in
  Week 2 — unprompted).
- **Fix:** add two sentences to the eviction fragment: the evictee gets a few moments, the hug
  line at the door, the walk out the front door, the house watching the memory-wall portrait go
  grey — every week, it's the same liturgy, that's why it works.

### [BB-21] [Severity: Polish] [Effort: <1day] [Value: Low]
**[SPIRIT] Generated casts have no superfan-vs-recruit axis**
- **Where:** archetype pool (observed roster: comp-beast, floater, mastermind, villain, flirt…)
  — game-role archetypes only; no dimension for franchise literacy.
- **Problem:** modern BB casting texture is the superfan/recruit split, and it drives play (the
  superfan who over-schemes week 1; the recruit who doesn't know what a backdoor is and must be
  taught in-fiction). All 15 NPCs currently speak fluent BB implicitly.
- **Fix:** add a `fandom: superfan|casual|recruit` facet to CharacterFactory personas, surfaced
  in the voice/roster cue so the narrator plays vocabulary and meta-knowledge accordingly.

### [BB-22] [Severity: Polish] [Effort: <1hr] [Value: Low]
**[SPIRIT] "steps in a montage" — TV-edit vocabulary inside the sealed house**
- **Where:** `competitionLibrary.ts:83`, hoh-count premise: "jellybeans in a tub, seconds of a
  silent timer, steps in a montage."
- **Problem:** houseguests don't see montages; the word smells like the edit bay. (Comps that
  quiz a *video package* exist on the show, but then say that.)
- **Fix:** reword to "steps from the front door to the backyard gate" or "a highlight reel
  production plays on the living-room screen" if the video-package flavor is wanted.

### [BB-23] [Severity: Polish] [Effort: <1hr] [Value: Low]
**[SPIRIT] Overheard fragments truncate mid-word: "(overheard, faintly) Shea O'Malley formed an allia…"**
- **Where:** the presence overhear keeps ~60% of source then cuts with an ellipsis
  (`PRESENCE.overhearFraction`; render in `humanize.ts` `humanizeOverhearPrefix`). Vault dump
  shows "formed an allia…", "grew clos…".
- **Problem:** the graded-clarity design is lovely, but a human half-hearing a sentence loses
  *words*, not *syllables*. "formed an allia…" reads like a string slice, because it is one.
- **Fix:** truncate at the previous word boundary before appending the ellipsis.

### [BB-24] [Severity: Polish] [Effort: <1hr] [Value: Low]
**[SPIRIT] Twist night has no "expect the unexpected"**
- **Where:** `twist-reveal` fragment (momentPrompts.ts:710-714).
- **Problem:** the one catchphrase the franchise owns (and it's production-voice, so it's the
  GM's line to say) is nowhere. Twist night is exactly where a fan expects it.
- **Fix:** one clause in the fragment: open the reveal in the Big Brother voice with a nod to
  the house motto — "you were told to expect the unexpected" — then the twist the game fired.

### [BB-25] [Severity: Polish] [Effort: <1day] [Value: Low]
**[CANON] No luxury/food/reward competitions anywhere**
- **Where:** `competitionLibrary.ts` is HOH/veto only; reward texture is one random pool line
  (BB-13).
- **Problem:** no-power reward comps (luxury week, food comps in the classic era, team rewards)
  are canon house texture AND great social material (winners/losers resentment) — currently the
  narrator can only fake them.
- **Fix:** 2–3 reward defs with a seeded engine-picked winner recorded as a house-event (so the
  narrator voices, never invents, who won); no power attached, pure texture + soul folds.

### [BB-26] [Severity: Polish] [Effort: <1hr] [Value: Low]
**[CANON] Endurance drops arrive three-at-a-time — the one-at-a-time fall is the whole drama**
- **Where:** staged batching (`STAGED_TARGET_ROUNDS` sizing) applied uniformly; observed week-1
  HOH: "Diego, Caleb, Jada are eliminated" in one beat.
- **Problem:** wall comps live on the single splash — "and there goes X!" Batching three deaths
  into one beat is right for a 13-ballot eviction, wrong for a wall.
- **Fix:** make the batch size format-aware (endurance ⇒ 1–2 per round, ceiling on total rounds
  intact); presentation-only, no rng.

### [BB-27] [Severity: Polish] [Effort: <1hr] [Value: Low]
**[CANON] Premiere: all sixteen flood in at once; the show enters in staged groups**
- **Where:** premiere fragment (momentPrompts.ts:602-631) — toast, bedroom pick, mingling; entry
  itself is one open door.
- **Problem:** the groups-of-four entrance (sprint for the beds, first-four bonds) is a fan-
  known premiere rhythm and a free pacing aid for the meet-everyone gate (meet a wave at a time
  instead of a 15-person blur).
- **Fix:** one line in the premiere fragment: bring the cast in as three or four waves, letting
  the player's wave claim beds first.

### [BB-28] [Severity: Polish] [Effort: <1hr] [Value: Low]
**[SPIRIT] Twelve house-event lines for a ~14-week season — visible recycling by mid-game**
- **Where:** `HOUSE_EVENT_POOL` (houseEvents.ts:41-54), no-repeat window of exactly one.
- **Problem:** with ≥1 meaningful event per in-game day, the same "practical joke war" will
  demonstrably recur several times a season; the daily-event invariant deserves a deeper deck.
- **Fix:** grow the pool to ~30 lines (the module invites it) and skew additions toward
  state-referencing texture (post-veto tension, jury-phase nerves) so late-season fillers don't
  read week-1 generic.
