# SOCIAL-GAME / EMERGENT-DRAMA AUDIT (audit v2 — SG lane)

**Scope:** engine social systems (relationships/gossip/deals/blocs/offscreen/confessionals/campaigns/
seeded ties/emotionalArc/jury + the liveSeason vote/nomination path) judged against the VISION_BRIEF,
plus the captured real-model season (`scratchpad/audit/journey-debug-bundle.json`, vault unsealed:
259 hiddenStory rows, week-1 ballot record, casting → W2).

**Synthesis.** The closed-set social machine is REAL, not cosmetic: `voteChoice` is a genuine
multi-term model (threat×paranoia + bloc + campaign tilt − deal honor − jury mgmt − bond-keep,
`liveSeason.ts:833-849`), nominations are tactic-gated and mood-bent, blocs are derived (never
stored) and actually shield/steer, deals reconcile with manner-scaled betrayal shocks, and the
VIEWED week-1 eviction split 9–4 (not a pile-on) with the player's dissent faithfully recorded.
The failures cluster in four places: (1) **the player's OFFENSIVE influence channel is structurally
missing** — every fold lands toward-the-initiator, so talking can shield you but can never move a
vote/nomination onto someone else, and the player is mathematically locked out of blocs/alliances
because the player→NPC edge direction never moves from play; (2) **the hidden layer's dramatic
authorship is templated and its enrichment layer is dead** — 100% of off-screen scene rows and 41/41
per-tick confessionals in the VIEWED vault are byte-identical templates, campaigns record zero
events, nomination tactics record nothing, so the 0048 "it was real all along" payoff has thin
receipts; (3) **two hidden-info leaks** de-anonymize E12 secret ballots through the deal/alliance
reveal seam; (4) **the strategic layer (0085/0086) was OFF in the audited season** (env-gated,
absent from the debug bundle's featureFlags) so the golden path has never live-verified it.

## Index

| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| SG-1 | Major | <1day | High | Player speech cannot move any third-party edge — offense (redirecting a target/flipping votes onto someone) is structurally impossible | EngineCommandsAdapter.recordInteraction fold; consequence.ts; campaigns wiring |
| SG-2 | Major | <1day | High | player→NPC edges are frozen by construction → the player is locked out of blocs, formAlliance ~always fails, joinAlliance refuses pitches | orwell_engine.py:511 initiator default; GameSessionAdapter:6016,6055; blocs.ts:76 |
| SG-3 | Major | <1day | High | Secret-ballot de-anonymization: deal-break + alliance-betrayal reveals fire instantly on vote-evict, naming the breaker (E12 violation) | GameSessionAdapter:6352-6366, 6069-6085; deals HUD status |
| SG-4 | Major | <1day | High | Campaigns leave ZERO receipts — a campaign that swings an eviction records no event, no gossip, no retrospective row | GameSessionAdapter.campaignTick:5233-5278 |
| SG-5 | Major | <1hr | High | 0085/0086 strategic layer silently OFF outside deploy; absent from debug-bundle featureFlags; the audited real-model season ran without it | GameSessionAdapter:349; deploy/orwell-install.sh:263; bundle featureFlags |
| SG-6 | Major | <1day | Med | Gossip "distortion" is cosmetic bookkeeping — content never becomes wrong; misinformation-driven dramatic irony impossible | gossip.ts:106-109; humanize.ts:206 |
| SG-7 | Major | <1day | Med | 0070 texture layer is write-only (skeletons-only consumer; retrospective reads raw template) AND never landed in the VIEWED season (per-turn ticks aren't kicked) | GameSessionAdapter:1873,7085; tool_implementations.py:4820; orchestrator maybeTurnDrivenTick |
| SG-8 | Major | <1hr | High | Per-tick confessional path bypasses ALL richness (no rng/voice/mood/nameOf): 41/41 identical template + literal "player" token in the unsealed story | orchestrator.ts:690 vs GameSessionAdapter:6497-6514 |
| SG-9 | Minor | <1day | Med | Nomination TACTIC (pawn/backdoor) is never recorded — retrospective receipts read incoherent; the backdoor can never complete | season.ts nominationStrategy; no Vault plan event |
| SG-10 | Major | <1day | High | NPC approaches are board-blind (motive ∈ bond/probe only) — nominees never campaign the player for votes; eviction eve feels like any lull; 0085 Phase C unbuilt | conversation.ts:50-69; GameSessionAdapter:3206 |
| SG-11 | Minor | <1hr | Med | Overhear truncation always keeps the head and drops the payload — the player learns WHO spoke, never with WHOM | presence overhearFraction; VIEWED vault Surfacing rows |
| SG-12 | Polish | <1hr | Med | "Shared target" deal label promises joint offense the mechanics can't represent (target-other = one-way spare-the-partner) | orwellDeals.js KIND_LABEL; domain/deal.ts conditionFor |
| SG-13 | Minor | <1day | Med | Eviction result/margin never lands on the board — no "Last eviction: X, 9–4" glance | orwellStatusPanel.js; PublicGameStatus |
| SG-14 | Minor | <1hr | Med | Veto aftermath illegible: noms row silently swaps the replacement in; no "saved · replacement" glance | orwellStatusPanel.js:365-371 |
| SG-15 | Minor | <1hr | Med | No "you vote tonight / you're on the block" seat cue at eviction phase | orwellStatusPanel.js seat chip |
| SG-16 | Minor | <1hr | Low | voteChoice exact-tie bias deterministically evicts the first-named nominee | liveSeason.ts:848 |
| SG-17 | Minor | <1day | High | Staged eviction ballot rounds are advance-gated, not pending-gated — the model chains past the season's climax (mechanism behind J-3's skipped reveal) | liveSeason.ts staged eviction; PendingDecisionView |
| SG-18 | Minor | <1day | Med | Early-season plot starvation: 0 NPC deals, 0 betrayals, ~90% of secret threads "(never surfaced)" after 2 VIEWED weeks — no pacing floor | DECISION.npcDeal; SOCIETY betrayal gates; secretPacing |
| SG-19 | Minor | <1day | High | Gossip-about-a-third-party is unrepresentable — scenes are pairs; A can never tell B about C, so no "word gets around" plot | offscreen.ts scene model; gossip.ts subjects |
| SG-20 | Minor | <1day | Med | A rumor's subject never learns they're being talked about — no confrontation loop | diffuseGossip; orchestrator gossip block |
| SG-21 | Minor | <1day | Med | Per-beat fold-budget cliff (3/pair/phase) silently zeroes the 4th+ conversation of a runway — "lingering is play" but stops counting | EngineCommandsAdapter:43,316-321 |
| SG-22 | Polish | <1hr | Med | No usage telemetry for the strategic levers (makeDeal/confide/expose/trade/formAlliance) — dead-at-runtime tools are undetectable; all were 0 in the VIEWED season | debug bundle; tool counters |
| SG-23 | Polish | <1hr | Low | Showmance exclusivity doesn't span ticks — VIEWED: Gina "grew close to" two different partners within 2 weeks | offscreen.ts hasActiveShowmance seam |
| SG-24 | Polish | <1hr | Low | PV1 player-subject clause is monotone — all 3 VIEWED instances are the same "sizes up player as a threat" branch | offscreen.ts playerSubjectClause |
| SG-25 | Minor | <1hr | Med | Alliance pitch/accept asymmetry: an NPC pitches on THEIR bond; joinAlliance then refuses on the frozen player→founder direction | GameSessionAdapter:5287-,6055 |
| SG-26 | Minor | <1day | Med | Jury-management vote discount is a constant for the player-nominee (reads the frozen player→voter trust) — NPCs never spare the player on bitter-juror grounds | liveSeason.ts:846 |
| SG-27 | Minor | <1day | Med | The 0048 unseal renders as a 259-row template wall — the vision's peak payoff needs curation (week grouping, arc threads, receipts first) | GameSessionAdapter retrospective; FE retrospective window |
| SG-28 | Polish | <1hr | Low | Day-one "Hidden side" reads repeat a small canned pool despite 14/14 authored deep profiles (authored dayOnePerception may not be landing) | vault Hidden side rows; recordCastProfile |

## Findings

### [SG-1] [Severity: Major] [Effort: <1day] [Value: High]
Player speech cannot move any third-party edge — social OFFENSE is structurally impossible
- Where: `src/adapters/engine/EngineCommandsAdapter.ts:161-298` (recordInteraction fold),
  `src/engine/consequence.ts:84-106` + `128-` (both folds apply `rel.applyDirected(other, INITIATOR)` /
  `applyImpactDirected(e.toward, initiator)` — every edge moves TOWARD the initiator only),
  `src/ports/EngineCommands.ts` ConsequenceDescriptor (no `aboutWhom`/holder field),
  `src/adapters/engine/GameSessionAdapter.ts:5219-5224` (`campaignActors()` filters out PLAYER),
  `:5179` (`declarePlayerCampaign` — called ONLY from BDD steps, no MCP tool, no FE path = dead code),
  `src/domain/deal.ts:88-95` (every deal kind incl. "target-other" is a NEGATIVE covenant — spare the
  partner; no joint-target commitment exists).
- Problem: The vision's core promise is "move a living social world WITH WORDS" (I4, peak moment #2:
  "pulling off your own blindside through social play"). Traced: the only mechanical products of the
  player's talk are edges toward the player (bond-keep shields them at votes, trust feeds jury mgmt —
  DEFENSE works). But "get the target off me and onto him" — the single most iconic BB move — has NO
  representable form: no fold can raise Lorenzo's threat-read of Maeve from the player's pitch, the
  player cannot own a campaign (the campaign layer's `campaignTiltFor` is the ONLY vote term that
  pushes a vote toward a named target), and no deal kind commits two people to a shared target.
  VIEWED corroboration: journey turn "I pull Lorenzo aside… float that Maeve is the bigger threat"
  → `recordInteraction` evt:mcp:163 folded only Lorenzo→Dana warmth; the house evicted Jada 9–4
  against the player's whole strategy — correctly per the math, but the pitch NEVER had a channel.
  Differential: (a) "anti-sycophancy demands this" — rejected: 0085 already gives NPCs a bounded,
  engine-owned persuasion channel (`campaignTilt` = base×progress×persuasiveness×susceptibility×trust);
  withholding the identical bounded channel from the player isn't fairness, it's asymmetry. (b) "the
  model should just narrate persuasion" — rejected: I2, narration must not decide.
- Confidence: high (code-traced + VIEWED). Falsifier: any code path where a player-witnessed scene
  moves an NPC→third-party edge (none found; `GOSSIP_HEARD` folds only fire on the NPC-to-NPC
  diffusion of ENGINE-minted scenes).
- Prediction: playtesters will report "my scheming did nothing" on their first nomination/eviction
  scramble; measured: 0% of player evict-pitches change any target's vote count vs. baseline seed.
- Fix (direction): wire the player into the EXISTING 0085 channel — a `pitchTarget`-shaped seam
  (either surface `declarePlayerCampaign` as the spec §"The player runs their own" intends, tied to
  actually-recorded lobby scenes so progress is earned, or let `recordInteraction`'s consequence
  descriptor carry one bounded `about: {holder, toward, direction: more-threatened}` edge whose
  magnitude the engine owns and gates by holder trust of the player). The player already has an
  `influenceOf` entry — the tilt math needs no new constants.

### [SG-2] [Severity: Major] [Effort: <1day] [Value: High]
player→NPC edges are frozen by construction → the player is locked out of blocs; formAlliance ~always
returns null; joinAlliance refuses the engine's own pitches
- Where: `frontend/src/orwell_engine.py:511` (`initiator: str = "player"` default) +
  `frontend/src/tool_implementations.py:4508-4530` (`do_record_interaction` doesn't even accept an
  `initiator` arg — EVERY recorded scene is initiator=player); folds land partner→initiator only
  (SG-1), so the player→NPC direction moves ONLY at move-in scatter (`seedFirstImpressions`,
  GameSessionAdapter:3949-3961: bond ≈ 0.25 ± 0.15) and rare ceremony folds (veto-saved on the player).
  Consumers of the MUTUAL min: `blocs.ts:76-77` (`mutualBond = min(both directions)`, threshold 0.5),
  `GameSessionAdapter:6016` (`formAlliance` willing gate `min(bondOf(PLAYER,m), bondOf(m,PLAYER)) ≥
  0.45`), `:6055` (`joinAlliance` same min gate), `relationships.ts:370` (`allianceActive`).
- Problem (I7/I8 + the strategy layer): however much the player genuinely bonds, `bond(player→m)`
  stays ≈0.25–0.40 (< every gate) all season, so: the player can never be IN a derived bloc (never
  bloc-shielded from nominations, never part of a voting bloc); `formAlliance` — the marquee 0107
  tool the GM prompt orders the model to call ("so the alliance is REAL") — needs ≥2 members clearing
  0.45 and will return null, forcing the narrator to either contradict the engine or deflect the
  player's earned win; `joinAlliance` refuses a pitch the engine itself extended (SG-25). It also
  quietly violates I8's spirit inverted: the engine refuses the player's OWN declared allegiance
  ("you don't like them enough") based on a number the player's play cannot move.
- Confidence: high (code-traced; arithmetic). Marked inference for live behavior — the VIEWED season
  never called formAlliance (SG-22). Falsifier: a live game where `formAlliance` succeeds before ~W4
  without a veto save on the player.
- Prediction: `formAlliance` null-returns in ≥90% of real seasons' first 3 weeks; `alliancePitches`
  accepted ~never.
- Fix (direction): gate PLAYER-side alliance actions on the NPC→player direction only (the player's
  own willingness IS the tool call — I8 says their feeling is theirs to declare), OR give
  player-initiated bonding scenes a small engine-owned reciprocal fold (the engine's read of the
  player's demonstrated investment — same anti-pump budget as E21). Also forward `initiator` through
  `do_record_interaction` so NPC-initiated scenes fold the correct direction at all.

### [SG-3] [Severity: Major] [Effort: <1day] [Value: High]
Secret-ballot de-anonymization: vote-evict deal breaks and alliance betrayals are revealed to the
player INSTANTLY, naming the breaker (E12 violation; kills the blindside-then-receipts arc)
- Where: `src/adapters/engine/GameSessionAdapter.ts:6388-6401` (eviction beat mints one `vote-evict`
  binding action PER VOTER from the secret `voteOf` ledger) → `:6352-6366` `reconcileDeals` whose sink
  sets `reveal:` (mints a player-witnessed `"<NPC> broke a vote deal with <player>"` betrayal event)
  and NEVER wires the `witnessed` hook — `DealLedger.applyBreak` (deals.ts:210) defaults
  `witnessed = true` ("a public ceremony break" — false for a secret ballot). Same shape at
  `:6069-6085` `reconcileAllianceBetrayals` (unconditional `onPlayerEvent` naming the actor on
  `vote-evict`). Second surface: `dealView` (`:6564`) projects raw `d.status` → the deals HUD
  (`orwellDeals.js`) flips to "✕ Broken" on the next poll.
- Problem (hidden-info correctness; E12: "per-voter attribution unseals ONLY in the 0048
  retrospective"): make a vote/safety deal with X; X secretly votes against you; the moment the
  anonymized reveal finishes, the game hands you "X broke a vote deal with you" — X's ballot is
  attributed. The betrayal the player was supposed to SUSPECT (peak emotion: paranoia) is stamped
  as fact. LATENT, not VIEWED (the journey made no deals) — but the trigger set is exactly the
  intended play pattern.
- Differential: "the wronged should feel the break" — yes, via the FOLD and jury demerit (both
  hidden, both fine); it's the named reveal event + the HUD status flip that leak. "Maybe onPlayerEvent
  hides NPC-witnessed events" — checked: witnessSet [wronged, breaker] includes PLAYER when the player
  is the wronged party ⇒ not hidden.
- Confidence: high (code-traced end to end). Falsifier: a `witnessed` wiring I missed (grep shows the
  sink's `witnessed` is never passed at this call site).
- Fix (direction): for `action.kind === "vote-evict"`, pass `witnessed: () => false` (fold + demerit
  stay immediate; the reveal defers to the 0048 unseal or a genuine later pathway), and have
  `dealView` report a vote-broken deal as still "open" until a recorded pathway informs the player.
  Alliance betrayal reveal: same gate on vote-evict only (nominate/replace ARE public ceremonies).

### [SG-4] [Severity: Major] [Effort: <1day] [Value: High]
Campaigns leave ZERO receipts — the strategic layer influences votes but records no story
- Where: `src/adapters/engine/GameSessionAdapter.ts:5233-5278` (`campaignTick`: forms/replans/advances
  campaigns and derives drives — `events.record` is never called; lobby/plant moves only grow
  `knownTo`), `campaigns.ts:229-246`. The retrospective hiddenStory builder (:1866-1911) reads
  events + threads + seeded rels — campaigns appear NOWHERE. VIEWED: journey vault has 0 campaign
  rows (though that run also had the layer off — SG-5; the absence is structural regardless: no
  record call exists).
- Problem (I4 — "an action narrated but never recorded has no consequence AND NO MEMORY"; vision
  peak #1 — "later learning it was REAL, RECORDED, and fair"): `campaignTiltFor` can genuinely swing
  an eviction (up to 0.25/voter), yet the season's record holds no trace that Mateo ran a two-week
  evict-the-player campaign, lobbied three allies, and won. The blindside it causes can never be
  explained by the retrospective — the receipts the whole architecture exists to produce don't exist
  for the one system built to produce blindsides. Gossip can't carry it either (rumors rise only
  from off-screen SCENES; a lobby move is not a scene).
- Confidence: high. Falsifier: none found — grep `events.record` in the campaign path is empty.
- Fix (direction): record Vault-only events at campaign formation ("X sets out to get Y evicted"),
  each lobby move ("X pressed Z to move on Y" — witnessSet [X,Z], hidden), and resolution — they then
  flow free into the existing retrospective, gossip-rise pool (a lobby IS a strategy scene), and
  overhear surface. ~30 lines inside `campaignTick`.

### [SG-5] [Severity: Major] [Effort: <1hr] [Value: High]
The strategic layer (0085 campaigns + 0086 drives + 0107 NPC alliance-naming) is env-gated OFF
everywhere except the LXC deploy — the audited real-model season ran without it, and the debug
bundle can't tell you
- Where: `GameSessionAdapter.ts:349` (`CAMPAIGNS_ENABLED_DEFAULT = process.env.ORWELL_CAMPAIGNS ===
  "1"`); the ONLY place that sets it is `deploy/orwell-install.sh:263`. The VISION_BRIEF's live-agent
  boot recipe and the journey run set no such env ⇒ the captured golden-path season (and every dev
  boot, every FE test, both audit passes' live stacks) ran with campaigns, drives, own-ballot leans,
  and NPC alliance-naming all inert. `formNpcAlliances` (:5277) is inside `campaignTick` — so 0107
  Phase B NPC pitches also never fire. Debug bundle `featureFlags` = {gameBuild, authEnabled,
  localhostBypass, embeddings, multiuser} — no campaigns/trajectories/triggers/timeOfDay, so the
  omission is invisible in the exact artifact used to audit the season (VIEWED: bundle featureFlags).
- Problem (C6 + ship risk): the single most drama-generating subsystem has NEVER been observed in a
  real-model season. "NPC targets/strategies evolve" was untestable in the journey — what the vault
  shows evolving is only the edge-derived confessional reads. First production season = first live
  run of campaigns.
- Confidence: high (env grep + bundle). Falsifier: a live-run artifact with ORWELL_CAMPAIGNS=1.
- Fix (direction): add the social-layer flags to the debug bundle's featureFlags; set
  ORWELL_CAMPAIGNS=1 in the dev/live-test recipe (SOUL lesson-17 stack) and run one real-model week
  with it on before ship; consider default-ON with the calibration harness explicitly exporting =0
  (the harness already controls its env).

### [SG-6] [Severity: Major] [Effort: <1day] [Value: Med]
Gossip "distortion" is cosmetic bookkeeping — a rumor can never become WRONG
- Where: `src/engine/gossip.ts:106-109` (`distort()` appends `" · supposedly#347"` — a hedge word +
  a random integer; the proposition never changes), `src/domain/humanize.ts:206` (the display scrub
  strips exactly that suffix), `gossip.ts:87-95` (RUMOR_GLOSS: the rumor is always the TRUE
  pair + TRUE nature).
- Problem (I3 promises "hidden facts diffuse … with drift; what reaches the player can be a DISTORTED
  belief"): traced end to end, every belief that reaches the player or any NPC is semantically
  identical to the origin — the distortion number is stripped before display and nothing else ever
  mutates content, subjects, or vibe. The classic BB engine of drama — someone acting on a WRONG
  version of events — cannot occur. `GOSSIP_HEARD` folds scale by confidence but always in the TRUE
  direction. VIEWED: all vault Whisper/Surfacing rows carry the undistorted gloss.
- Differential: "confidence decay IS the distortion" — rejected: decay lowers how firmly a truth is
  held; it never produces a falsehood. That's noise-free telephone.
- Confidence: high. Falsifier: any content-mutating hop (none: `distort` is the only mutation).
- Fix (direction): at each hop, with a small seeded probability, mutate the GLOSS one rung on a
  severity ladder ("talking strategy" → "cutting a deal" → "have a final-two") and/or swap one
  subject for a socially-adjacent houseguest; keep `originalContent` for provenance so the 0048
  unseal can show the player how the story warped — which is itself a payoff.

### [SG-7] [Severity: Major] [Effort: <1day] [Value: Med]
The 0070 texture-enrichment layer is write-only, and in the VIEWED season it never landed at all
- Where: consumers of `textureOverrides`: exactly one — `getOffscreenSceneSkeletons`
  (GameSessionAdapter:7085), i.e. the enricher's own input. The 0048 retrospective builds hiddenStory
  from RAW `e.content` (:1873); gossip glosses, soul memory (`soulMemo` at record time), and overhears
  all read pre-texture content. Kick seam: `tool_implementations.py:4811-4823` — `kickoff_enrich`
  fires ONLY from `do_advance_game`, while the off-screen tick runs on EVERY committed player turn
  (`orchestrator.maybeTurnDrivenTick:347`), and the skeleton registry is REPLACED each tick
  (`notifyOffscreenTick:7065`) — so scenes minted on non-advance turns are never enrichable. VIEWED:
  100% of the ~120 off-screen scene rows in the journey vault are the bare `"${a} ${verb} ${b}"`
  template — zero enrichments landed across a full real-model season with a live LLM. Bonus defect:
  the voicing prompt (`orwell_offscreen_texture.py:_voicing_messages`) FORBIDS names ("refer to
  participants only as 'the two houseguests'") — so even if wired into the retrospective, enriched
  rows would LOSE who-did-what.
- Problem (I7 — richness is priority #1; the feature exists to make the hidden layer vivid and
  currently improves no surface anyone ever sees): dead feature walking.
- Confidence: high (consumer grep + VIEWED vault).
- Fix (direction): (1) kick `kickoff_enrich` from the per-turn tick seam (or make the registry
  cumulative-per-N-ticks); (2) have the retrospective prefer `textureOverrides.get(id) ?? e.content`;
  (3) allow names in the voicing prompt (the content is Vault-held; names are already in the
  template).

### [SG-8] [Severity: Major] [Effort: <1hr] [Value: High]
The per-tick confessional path bypasses every richness upgrade — 41/41 identical template lines and
a literal "player" token in the unsealed story
- Where: `src/composition/orchestrator.ts:690` — `confessionalFor(confessor, ids, rel, { player:
  PLAYER, recentEvents })`: no `rng` (⇒ `pick()` returns `lines[0]` — confessionals.ts:216), no
  `voice` (0090 voice pools dead on the most frequent path), no `emotionalState` (no mood line), no
  `trigger`, no `nameOf`. Compare the ceremony path (GameSessionAdapter:6497-6514) which passes all
  six. VIEWED: every one of the 41 vault confessionals is `"I need {T} gone — they're my biggest
  threat. {A} is the one I actually trust."` (TARGET_LINES[0]+ALLY_LINES[0]); two read `"I need
  player gone"` / `"player is the one I actually trust"` — the raw `player` id, exactly the #845
  bug the `nameOf` param exists to fix (the retro scrubber resolves colon-bearing ids only).
- Problem (I6 distinct voices + the 0048 payoff): the Diary Room — the genre's interiority engine —
  reads as one robot repeated 41 times in the unseal; 0090's entire voice system is dead where ~80%
  of confessionals are minted.
- Confidence: high (VIEWED + traced). Falsifier: none — the ctx literal is right there.
- Fix: build the same ctx the ceremony path builds (seeded rng keyed off confessor+tick, the 0084
  voice, soul state, `nameOf`) at orchestrator.ts:690. One call-site change.

### [SG-9] [Severity: Minor] [Effort: <1day] [Value: Med]
Nomination tactics (pawn/backdoor) are invisible — no recorded plan, incoherent receipts, and the
backdoor can never actually complete
- Where: `src/engine/season.ts:104-121` (`nominationStrategy` picks a tactic, returns only the pair —
  the tactic is dropped on the floor; nothing records "real target: X, pawn: Y"), replacement pick
  re-derives ranking (liveSeason.ts:1588-1593); no lever makes the HOH pursue getting the veto USED,
  so "backdoor" = de facto "nominate #2/#3". VIEWED coherence casualty: Lorenzo's vault confessional
  says trust-Maeve-most / player-is-my-target, then he nominates Maeve (+Jada) — dramatically
  legible ONLY if a pawn/backdoor plan existed on the record; it doesn't, so the retrospective reads
  as contradiction, not strategy.
- Problem: the retrospective is the proof-of-fairness artifact; unexplained noms read as engine
  incoherence (they're actually tactics). And the most delicious BB move (the completed backdoor)
  is structurally unreachable.
- Confidence: high on the recording gap; medium on the Lorenzo read (his disposition wasn't
  verified — falsifier: Lorenzo maps to a `direct` archetype, in which case the noms were pure
  threat-ranking drift between confessional-time and noms-time — still unexplained on the record).
- Fix (direction): mint a Vault-only "nomination plan" event from `nominationStrategy`'s branch
  (tactic + real target + pawn); (design follow-on) let a backdoor-HOH's plan register as an evict
  campaign whose `deal`/`lobby` moves target the veto holder's save decision.

### [SG-10] [Severity: Major] [Effort: <1day] [Value: High]
NPC approaches are board-blind — nobody campaigns, courts, or begs; eviction eve feels like any lull
- Where: `src/engine/conversation.ts:50-69` (`rankApproaches` reads ONLY the NPC→player edge; motive
  is a 2-value derivation `bond|probe`), `GameSessionAdapter:3206-3234` (no ceremony/phase input
  beyond the E89 start gate). 0085's Phase C ("player surfacing + scramble") is explicitly unbuilt
  (campaigns.ts:14 comment; no scramble seam in src).
- Problem (the weekly rhythm IS the genre): a nominee facing eviction never seeks the player's vote;
  a new HOH is never courted; the player-HOH is never lobbied by NPCs (their campaigns can't reach
  the player's decisions at all — `campaignTiltFor` applies only to NPC voters, and noms made by the
  PLAYER take no tilt, correctly, but no APPROACH carries the pitch either). The eviction-eve
  scramble — the show's most reliable drama beat — never самоinitiates. VIEWED: across the journey's
  two nomination→eviction cycles, no NPC ever raised the vote with the player.
- Differential: "the GM model should improvise this" — rejected: bidirectional scenes are an engine
  mandate ("NPCs hold goals … that make them approach the player"), and the model demonstrably
  under-calls even its existing levers (C1).
- Confidence: high. Falsifier: an approach motive beyond bond/probe anywhere in src (grep: none).
- Fix (direction): extend `rankApproaches` with board context — a nominee (pre-eviction, non-player
  voter available) gets a large additive drive with motive "campaign"; bloc/deal partners of a new
  HOH get "court"; a campaign owner whose knownTo includes the player gets "lobby". The motive is
  still just a category the narrator voices (E60 discipline holds).

### [SG-11] [Severity: Minor] [Effort: <1hr] [Value: Med]
Overhears always decapitate the payload — the player learns WHO spoke, never with WHOM
- Where: presence overhear keeps the leading ~60% (`PRESENCE.overhearFraction`, presence.ts) of a
  template whose informative tokens (partner + nature qualifier) sit at the END. VIEWED (vault
  Surfacing rows): "(overheard, faintly) Shea O'Malley formed an allia…", "…Gina Ricci talked
  strate…" — every fragment ends before the partner's name.
- Problem: partial information should be VARIED partial (sometimes the pair, sometimes the topic,
  sometimes just voices); systematically head-anchored truncation makes every overhear the same
  shape of useless, and the player learns to ignore them (killing the paranoia loop).
- Fix: seeded window sampling (head/mid/tail) or template-aware redaction that keeps a random
  informative token subset.

### [SG-12] [Severity: Polish] [Effort: <1hr] [Value: Med]
"Shared target" deal label promises joint offense the mechanics can't represent
- Where: `frontend/static/js/orwellDeals.js` KIND_LABEL `"target-other": "Shared target"`;
  `src/domain/deal.ts:88-95` (`conditionFor("target-other")` = one-way spare-the-partner; no
  commitment to target anyone).
- Problem: the HUD tells the player they hold a "Shared target" pact; nothing reconciles whether
  anyone ever moves on the supposed target — the label writes a check the engine can't cash
  (and feeds the SG-1 illusion).
- Fix: relabel ("Protection pact" / "I'll spare you") — or implement a real joint-target deal kind
  whose honor condition is a nominate/vote against the named target (pairs with SG-1's fix).

### [SG-13] [Severity: Minor] [Effort: <1day] [Value: Med]
The eviction result and margin never land on the board
- Where: `orwellStatusPanel.js` (rows: week/phase/tod/HOH/noms/veto only); `PublicGameStatus` carries
  no last-eviction field. The anonymized tally ("9–4") is a broadcast fact (E12-safe) that exists
  only as scrollback prose.
- Problem (legibility): a returning player reconstructs "who left, by how much" from chat history;
  margins are the genre's power barometer (a 9–4 vs 7–6 house is a different game).
- Fix: add `lastEviction: {evictee, tally}` to the status projection + one panel row (flash on
  change like TRANS-3).

### [SG-14] [Severity: Minor] [Effort: <1hr] [Value: Med]
Veto aftermath illegible: the noms row silently swaps the replacement in
- Where: `orwellStatusPanel.js:365-371` — `nominees` re-renders as the final pair; `veto` shows
  "used · holder". Nothing shows saved-whom / replaced-with-whom for the rest of the week.
- Problem: the week's most political fact ("X came off, Y went up") is a transient row flash; the
  glanceable board can't answer "who is safe" (my lane's core legibility test) after the ceremony.
- Fix: during veto-ceremony→eviction phases render "Veto: used by H — saved S · Y named" (all
  public ceremony facts already in engine state).

### [SG-15] [Severity: Minor] [Effort: <1hr] [Value: Med]
No "you vote tonight / you're on the block" cue at the eviction phase
- Where: `orwellStatusPanel.js` seat chip (`seatOf`) shows HOH/NOM/VETO/EVICTED/JURY but nothing for
  the voter/tie-breaker roles the eviction phase creates.
- Problem: first-timers stall exactly here (prior finding J-9 showed the vote card can fail to
  render; a board cue is the cheap redundant affordance).
- Fix: phase-conditional seat chip — "You vote tonight" (voter), "You break ties" (HOH), "The house
  votes on you" (nominee).

### [SG-16] [Severity: Minor] [Effort: <1hr] [Value: Low]
voteChoice exact-tie bias systematically evicts the first-named nominee
- Where: `liveSeason.ts:848` — `score(fn[0]) >= score(fn[1]) ? fn[0] : fn[1]`.
- Problem: on near-identical reads every voter breaks the SAME way (toward nominee order 0 =
  nomination order), correlating tie-noise across the whole electorate — a source of quiet
  unanimity in low-information weeks (the "dumb pile-on" I hunted; the VIEWED week was healthy,
  9–4, but that had real signal).
- Fix: per-voter seeded epsilon tiebreak (dedicated stream, |Δ| < ε ⇒ coin).

### [SG-17] [Severity: Minor] [Effort: <1day] [Value: High]
Staged eviction ballot rounds are advance-gated, not pending-gated — the mechanism that let the model
montage the season's climax (corroborates prior J-3 with the fix seam)
- Where: `liveSeason.ts:536-570` (staged reveal resolves per `advanceGame`, returning beats; only
  the player's own vote is a pending). VIEWED: journey eviction = "the voting has finished" → result,
  in one turn — the designed anonymized per-round reveal never rendered.
- Problem: everything that is merely an advance is montage-able (C1); the E12 reveal is presentation
  the engine stages precisely so it can land as tension-and-release, and it structurally can't
  survive an advance-chaining model.
- Fix (direction): emit each reveal round as a `binding:false` pending (the same mechanism
  comp-rounds already use) so the FE renders a card per round and the agent loop's chain-guard has a
  hard stop; alternatively an FE belt: never allow >1 `advanceGame` while `phase==="eviction"` in
  one turn.

### [SG-18] [Severity: Minor] [Effort: <1day] [Value: Med]
Early-season plot starvation: no pacing floor for pacts/betrayals/secret surfacing
- Where: `decisionConstants.ts` DECISION.npcDeal.mintProb 0.35/week; `offscreen.ts` SOCIETY betrayal
  gates (bond ≥0.45 AND threat ≥0.25 — near-impossible before edges mature); secretPacing exists but
  VIEWED: after 2 full weeks the vault holds 0 NPC deals, 0 betrayal scenes, 4 stalled "grew close"
  showmances, and ~90% of secret threads/real-games/blind-spots stamped "(never surfaced)".
- Problem (I7 richness as FELT, not just present): the hidden story's first act is texture without
  plot — bonding/clashing one-liners. Two weeks is ~a third of many players' total exposure.
- Fix (direction): pity-timer floors — guarantee ≥1 NPC pact by the end of W2 (mint the tightest
  pair), schedule the first seeded-tie/secret surfacing beat inside W1-2, and let one high-heat
  edge pair bypass the betrayal gate once edges cross a season-scaled threshold.

### [SG-19] [Severity: Minor] [Effort: <1day] [Value: High]
Gossip-about-a-third-party is unrepresentable — A can never tell B about C
- Where: `offscreen.ts` scenes are strictly pairs (initiator, partner) with no topic slot; the ONLY
  third-party reference in the whole hidden layer is the PV1 player-subject clause (:317-323).
  `diffuseGossip` subjects = the two participants — so a "gossip" rumor is always about the
  GOSSIPERS ("they talk about everyone"), never about a target.
- Problem: "who is talking about whom to whom" is the substrate of house politics; without a topic
  target, `GOSSIP_HEARD` can never move B's read of C from A's whisper (except via the rumor's own
  subjects = A themself), and the Whisper rows in the unseal are contentless (VIEWED: 20 identical
  "gossiped about the house with" rows).
- Fix (direction): give strategy/gossip scenes an optional seeded `topic: EntityId` (weighted by the
  initiator's top threat reads — the same reads the confessionals use), thread it into
  `rumorFrom`/`subjects` so hearing it folds toward the TOPIC. This also gives SG-1's player-pitch
  a natural home (a player pitch = a scene with a topic).

### [SG-20] [Severity: Minor] [Effort: <1day] [Value: Med]
A rumor's subject never learns they're being talked about — no confrontation loop
- Where: `diffuseGossip` transmits only to non-holders along affinity edges; nothing checks whether
  the chain reached the SUBJECT, and no event/fold marks "word got back to X".
- Problem: the drama payoff of gossip is the blowback (X storms in: "I heard what you said").
  Currently a subject can hold the belief about themselves with zero reaction — the trigger
  eruption system (0091) keys off conflict/betrayal scenes, not received rumors.
- Fix: when a diffusion hop lands on a subject, fold a directed grievance toward the origin
  (confidence-scaled, via the proven rule) and mark the belief so 0091's precipitants / the
  approach layer (SG-10) can spark a confrontation.

### [SG-21] [Severity: Minor] [Effort: <1day] [Value: Med]
The per-pair fold budget is a silent cliff: the 4th conversation of a runway counts for nothing
- Where: `EngineCommandsAdapter.ts:43` (`MAX_FOLDS_PER_PAIR_PER_BEAT = 3`), `:304-321` — the window
  is the current SEASON BEAT (one ceremony phase), which by design spans a long multi-turn social
  runway ("lingering is play").
- Problem (I4): scenes 4+ with the same houseguest in one phase record but fold zero, with no
  narrative or mechanical signal of diminishing returns — the player's deliberate investment
  evaporates silently (the exact "narrated but consequence-free" shape the mandate calls the
  cardinal sin, here by budget rather than omission). Differential: E21's anti-pump purpose is
  legitimate — the defect is the CLIFF + silence, not the bound.
- Fix: diminishing scale (1.0 / 0.5 / 0.25 / 0.1 floor) instead of a hard 3-then-zero; optionally
  reset the window on real in-game time-of-day change (ADR 0006) rather than ceremony beat.

### [SG-22] [Severity: Polish] [Effort: <1hr] [Value: Med]
No usage telemetry for the strategic levers — dead-at-runtime tools are undetectable
- Where: debug bundle `health.engine.toolCalls` aggregates but the bundle carries no per-tool
  counts for makeDeal/confide/exposeSecret/tradeSecret/formAlliance/joinAlliance. VIEWED: the full
  journey season used NONE of them (the deals window, alliance system, confidence system,
  secret-economy — all untouched), and only the deals path has an FE belt (`_auto_record_deal`).
- Problem: the whole strategic toolset can silently be dead (C1's measured ~0% spontaneous rate)
  and no artifact shows it.
- Fix: per-tool call counters in the bundle + a post-season "levers used" line in the ops panel;
  flag a season that ends with 0 strategic-lever calls.

### [SG-23] [Severity: Polish] [Effort: <1hr] [Value: Low]
Showmance exclusivity doesn't span ticks — one houseguest courts two partners
- Where: `offscreen.ts:273-284` — exclusivity checks the SEEDED layer (`hasActiveShowmance`) + a
  within-tick set; scene-layer showmances from prior ticks aren't consulted. VIEWED: vault shows
  "Gina Ricci grew close to Javier Cruz" AND "Gina Ricci grew close to Diego Salinas" within 2 weeks.
- Problem (I6 people-make-sense): minor continuity wobble in the hidden story (and the retrospective
  shows both rows side by side).
- Fix: have `hasActiveShowmance` also consult recent showmance-typed scenes (or promote a scene
  showmance into the seeded layer's one-partner registry).

### [SG-24] [Severity: Polish] [Effort: <1hr] [Value: Low]
The PV1 player-subject clause is monotone in practice
- Where: `offscreen.ts:106-115` — three branches, but the threat branch wins whenever threat ≥ 0.25
  AND ≥ bond; NPC→player bonds rarely clear 0.45 early. VIEWED: all 3 instances in the vault are
  "sizes up player as a threat they need gone".
- Fix: phrase pools per branch + lower the ally-branch bar (or use the graded currentReadOf words).

### [SG-25] [Severity: Minor] [Effort: <1hr] [Value: Med]
Alliance pitch/accept asymmetry: the engine offers a pitch its own accept-gate then refuses
- Where: `formNpcAlliances` (GameSessionAdapter:5287-) pitches the player off NPC-side bonds;
  `joinAlliance` (:6055) refuses unless `min(bond(PLAYER→founder), bond(founder→PLAYER)) ≥ 0.45` —
  the player→founder direction is the frozen one (SG-2). Inference (campaigns were off in the VIEWED
  run, so no pitch was ever observed live). Falsifier: pitch gate already using the same mutual min
  (partial-read; flagged for verification).
- Problem: "accept their offer" failing with "not close enough" after the game itself surfaced the
  offer is a promise-break in the UI (`gameStatus.alliancePitches` → dead button).
- Fix: gate acceptance on the founder→player direction only (the pitch's own basis), or on the pitch
  having been extended at all.

### [SG-26] [Severity: Minor] [Effort: <1day] [Value: Med]
The jury-management vote discount is a constant for the player-nominee
- Where: `liveSeason.ts:846` — `juryManagementWeight × trust(nominee → voter)`: for a player-nominee
  this reads the frozen player→voter edge (≈baseline all season, SG-2 root), so NPC voters get the
  "don't make a bitter juror" hesitation for each other but effectively never for the player.
- Problem: a subtle systemic tilt AGAINST keeping the player in close votes — an emergent
  anti-player bias from a stale input, the inverse of the D4/E33 shield the bondKeep term was
  calibrated to fix. Confidence: medium-high (arithmetic; magnitude small, weight 0.1).
- Fix: rides on SG-2's fix (any mechanism that lets player→NPC trust move); or read the voter-facing
  term for player-nominees off the NPC's own belief of the player's trust (their read, not the
  player's edge).

### [SG-27] [Severity: Minor] [Effort: <1day] [Value: Med]
The 0048 unseal — the vision's peak payoff — renders as a 259-row template wall
- Where: retrospective assembly (GameSessionAdapter:1866-1958) — chronological, coalesced, but flat;
  VIEWED bundle: 259 rows of which ~120 are one-line templates and 41 identical confessionals.
- Problem: the player's blindside explanation is buried; "it was real all along" should read like an
  episode of receipts, not a log dump.
- Fix (direction): group by week with per-week headline (the ceremony row), float the receipt classes
  first (campaign events SG-4, nomination plans SG-9, deal breaks, the ballots), and collapse
  repeated texture rows into counts ("…and 11 more quiet conversations"). FE-side rendering of the
  existing data; no new unsealing.

### [SG-28] [Severity: Polish] [Effort: <1hr] [Value: Low]
Day-one "Hidden side" reads repeat a small canned pool despite 14/14 authored deep profiles
- Where: VIEWED vault "Hidden side" rows — e.g. "a likable rival who will have to go eventually"
  appears verbatim for two different NPCs; bundle `health.castAuthoring` = 14/14 authored.
  Inference: either the authored `dayOnePerception.read` isn't landing through `recordCastProfile`
  or the author reuses the seeded floor phrasing. Cross-flag to the prompt-AI lane.
- Fix: verify recordCastProfile carries dayOnePerception.read through (boundary test per the
  four-place write-back rule); if it does, vary the deterministic floor pool.

## What genuinely works (state plainly — evidence)
- `voteChoice`/`nominationStrategy` are real strategy models, and the VIEWED week-1 vote split 9–4
  with the player's dissenting ballot faithfully in the sealed record (bundle evictionVotes).
- Confessional TARGETS evolve with the board (vault: Jada×4, Caleb×5, player×2, Klaus, Tanner,
  Mila… across two weeks) — NPC reads are live edges, not static scripts.
- Off-screen society is motivated and co-present (E45), the player IS a subject of off-screen NPC
  cognition (PV1, VIEWED ×3), witnessed events are never mislabeled secret, and the DR wall
  (diaryRoom.ts) is structural.
- Deal ledger + manner-graded jury (goodbye-tone precedence, no threat term at finale) is the most
  dramatically literate jury model I've seen in a simulation of this genre.
