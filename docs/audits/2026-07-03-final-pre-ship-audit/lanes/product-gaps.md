# PRODUCT-GAPS/SPIRIT — Orwell pre-ship audit v2 ("realize the vision 200%" lane)

**Question asked:** not "what's broken" but what's MISSING or UNDER-DELIVERING for the core fantasy
(VISION_BRIEF I1–I10, C1–C6). Grounded in: `docs/features/README.md` (status index, 0087–0109 skim),
the 2026-06-26 bb-nerd synthesis + 2026-06-27 ship-gate triage, the v1 live-journey transcript
(`scratchpad/audit/journey.md` + debug bundle), the engine feature modules (gossip/deals/blocs/
confessionals/presence/campaigns/emotionalArc/houseEvents/diaryRoom/retrospective/juryHouse/triggers/
trajectory/secretPacing/notoriety), the FE player surfaces (`orwellRetrospective/DiaryRoom/Deals/
NewSeason/GadgetRail/ChatHint/PremiereTutorial.js`, `agent_loop.py` belts, `chat_helpers.py`), and the
shipped deploy (`deploy/orwell-install.sh`, systemd units, `frontend/src/settings.py`).

**Headline:** the engine's hidden layer is genuinely rich (the PV audit proved it), but a striking
amount of that richness is *structurally unreachable from the player's chair*: five built society
systems ship with their flags dark, the newest player verbs have no under-call belts (against a
measured ~0% spontaneous tool-call rate), the scramble never knocks on the player's door, the Diary
Room is write-only, and THE payoff surface (the 0048 unsealing) silently truncates to 40 lines. The
two build-ready specs that most move the felt game (0102 day-1 experience, 0102 daily recap) are
unbuilt — and one of them is missing from the authoritative index.

No finding below proposes a trust meter, a vault peek, or a number crossing to the player (I1/I2/I8
respected throughout). Prior v1 findings (~41) and the already-ledgered nerd-audit F/PV items are not
re-reported; where one is corroborated it is flagged as such in one line.

---

## Index

| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| PG-1 | Major | <1hr(+verify) | High | Five built hidden-society systems ship dark (flags off, no deploy/FE opt-in) | deploy/orwell-install.sh:263 |
| PG-2 | Major | <1hr | High | Narration-faithfulness gate (0081) ships OFF while wrong-evictee narration is the known launch break | frontend/src/settings.py:281 |
| PG-3 | Minor | <1hr | Med | Overseer (0079) ships off — prod generates no diagnostic ring | frontend/src/settings.py:270 |
| PG-4 | Minor | <1day | Med | No single "season texture" inventory — richness dials scattered across env/FE/admin with no owner-facing view | deploy + admin settings |
| PG-5 | Major | <1day | High | formAlliance/joinAlliance have no under-call belt — the 0107 alliance layer is unreachable in live play | frontend/src/agent_loop.py belts |
| PG-6 | Major | <1day | High | Alliance pitches (gameStatus.alliancePitches) have zero FE surfacing — an NPC's offer can evaporate unvoiced | FE notice/card + Deals window |
| PG-7 | Major | <1day | Med | exposeSecret/tradeSecret (0093/0099) have no belts — secrets-as-power dead at runtime | frontend/src/agent_loop.py |
| PG-8 | Minor | <1day | Med | turnIn is prose-only with no belt — the player's bedtime lever (ADR 0006) never fires | agent_loop.py; orwellNightStatus.js:6 |
| PG-9 | Major | <1day | High | Verb discoverability ~zero: nothing teaches the social verbs; the chat-hint component has NO live consumers | orwellChatHint.js:41 (commented-out example) |
| PG-10 | Minor | <1day | Med | Player has no recall surface for what they HOLD (secrets/factIds, confidences, gossip+source) — the 0093/0099 input | momentPrompts + Deals window |
| PG-11 | Major | <1hr | High | Retrospective FE `slice(-40)` silently discards most of the unsealed hidden story — THE payoff truncated | orwellRetrospective.js:195 |
| PG-12 | Minor | <1day | Med | Retrospective has no per-houseguest view — "what did X really think of me" unanswerable at the reunion | orwellRetrospective.js render() |
| PG-13 | Minor | <1day | Med | (corroborates SG7) finale per-juror votes absent from the unseal schema — a core payoff missing | liveSeason.ts:1282; producerVault export |
| PG-14 | Major | <1day | High | The Diary Room is write-only: no producer voice, invitations never fire (producerPrompt has 0 callers), entries never resurface | src/engine/diaryRoom.ts:61; orwellDiaryRoom.js |
| PG-15 | Minor | <1day | Med | Player's own DR entries absent from the 0048 retrospective ("your season, in your own words") | GameSessionAdapter retrospective builder |
| PG-16 | Major | <1day | High | An evicted player has no path to the payoff except grinding spectate turns — advanceToFinale is admin-only | registry.ts:77; momentPrompts `evicted`/`jury` |
| PG-17 | Minor | multi-day | Med | Player-juror sequester is passive — no fellow-juror contact; 0100 jury house is NPC-only (and off) | momentPrompts.ts:788; juryHouse.ts |
| PG-18 | Minor | <1hr | Med | Jury boundary invisible at the moment it matters — no "first member of the jury" beat; goodbye card never says the evictee votes at the finale | liveSeason eviction beats; orwellDecision.js:314 |
| PG-19 | Major | multi-day | High | 0102 daily bedtime recap: build-ready, unbuilt — sessions end shapeless, no cliffhanger, no "previously on" | docs/features/0102-weekly-recap-cliffhanger.md |
| PG-20 | Major | multi-day | High | 0102 day-1 experience: build-ready + PO-resolved, unbuilt, AND missing from the README index (number collision) | docs/features/0102-day-1-experience.md |
| PG-21 | Minor | <1hr | Med | README status index drift: 0093/0099/0109 listed unbuilt but are built + gated; the index is the declared source of truth | docs/features/README.md:159,165,175 |
| PG-22 | Major | <1day | High | Campaign lobbying never reaches the player as a scene — the scramble never knocks on your door | campaigns.ts:239; GameSessionAdapter.campaignTick |
| PG-23 | Minor | — | Med | (corroborates PV1) the player is invisible as a SUBJECT of off-screen cognition — one theme with PG-22 | offscreen.ts:130 |
| PG-24 | Minor | <1day | Med | 0106 spectator opinion-folds deferred — comps are socially inert for watchers (a thrown comp is never noticed) | 0106 spec "deferred" note |
| PG-25 | Minor | <1hr | Med | Seasons can complete with ZERO fired twists (2 loaded, firing seeded-rare) — a twistless BB season reads flat on replay | GameSessionAdapter.ts:865; reserveTwists.ts |
| PG-26 | Minor | <1hr | Med | "Keep this houseguest" copy omits the 0104 hook — notoriety invisible at the exact decision point | orwellNewSeason.js:117-120 |
| PG-27 | Minor | <1hr | Med | The post-season reunion never sells season 2 (notoriety / seasons-as-levels / themes unmentioned) | momentPrompts.ts `post-season` |
| PG-28 | Polish | <1hr | Low | Rail chip "Season Recap" undersells the vault window ("The Season, Watched Back") | orwellGadgetRail.js:51 |
| PG-29 | Minor | <1day | Med | "Your Deals" window omits alliances — the named-alliance layer (0107) has no player surface at all | orwellDeals.js; gameStatus.alliances |
| PG-30 | Minor | <1hr | Med | npcVoice `mayConfide` readiness cue exists but the FE confide belt can't use it (not surfaced) — belt fires blind | agent_loop.py:2780 comment |
| PG-31 | Minor | spec-rank | Med | Unbuilt Producer's-Vault batch, ranked: 0095 (pre-show-tie time-bombs) + 0096 (nemesis) are the felt-game movers; 0094/0101 next; none half-wired | docs/features/0094–0101 |
| PG-32 | Major | multi-day | High | 0108 real-model golden-path gate unbuilt — every fix in this lane's territory ships regressible (the ship-gate's own #1 move) | docs/features/0108 |
| PG-33 | Minor | <1hr | Med | Ship-gate PARKED list is stale: #905–909 casting-reframe items were PO-resolved into build-ready 0102-day-1 | 2026-06-27-ship-gate.md:141 |
| PG-34 | Minor | <1day | Med | Post-eviction week has no "aftermath scramble" pull signal — the most dramatic window of the week opens with silence unless the player pushes | momentPrompts phase fragments; socialInitiatives |
| PG-35 | Minor | <1day | Med | No mid-season arc variety: weeks 3–8 are structurally identical; the twist reserve is the only pattern-break and can never fire (PG-25) | liveSeason cadence; 0025 |
| PG-36 | Polish | <1hr | Low | Retro window and the chat reunion don't cross-link — the window never says "ask the host about any of this" | orwellRetrospective.js:221 |
| PG-37 | Minor | <1day | Med | Notoriety (0104) has no in-fiction arrival beat — a carried reputation is never FELT on day 1 of season 2 | notoriety.ts; premiere framing |
| PG-38 | Polish | <1hr | Low | Diary-Room pill copy sells privacy but not PURPOSE — players don't know why they'd use it | orwellDiaryRoom.js:89 |

Severity tally: **Major 12 · Minor 21 · Polish 3 — 36 findings** (+2 corroborations flagged inline).

---

## Findings (full schema)

### Cluster A — built richness that ships dark

[PG-1] [Severity: Major] [Effort: <1hr per flag + one <1day verification run] [Value: High]
Five built hidden-society systems are switched OFF in the shipped product
- Where: `deploy/orwell-install.sh:258-263` (the deploy .env opts in ONLY `ORWELL_CAMPAIGNS=1`);
  `frontend/src/settings.py` (only `time_of_day_enabled` gets an FE runtime toggle). No deploy line,
  FE setting, or admin dial exists for: **0087 `ORWELL_TRAJECTORIES`** (warming/cooling arcs — a
  friendship that visibly curdles over weeks), **0091 `ORWELL_TRIGGERS`** (secret-driven public
  eruptions — blow-ups/mask-slips the player witnesses), **0092 `ORWELL_SECRET_PACING`** (the ~1-2/week
  secret drip that makes dormant threads actually reach the player), **0100 `ORWELL_JURY_HOUSE`**
  (the sequestered jury as a second society hardening grudges), **0059§5 `ORWELL_SEEDED_TIE_SURFACING`**
  (pre-game-tie discovery scheduling).
- Problem: each was built, calibrated, BDD-gated — and then never turned on anywhere. The shipped
  season is the THIN version of the game: no relationship arcs, no eruptions, secrets that mostly
  never surface, a socially inert jury. This is the single largest "the richness exists but never
  reaches the player" gap — it under-delivers I7 (the house schemes without you) and mandate #1
  (behavioral fidelity) with zero code missing. Default-off in *code* is correct (calibration
  byte-identity); default-off in the *deploy* is a product decision nobody appears to have made —
  the campaigns flag proves the intended pattern ("DEFAULT OFF in code…; the deploy opts in here").
- Fix: add one `echo "ORWELL_<FLAG>=1"` per flag to the same install-script block as campaigns
  (0087/0091/0092/0100 first; 0059§5 owner-call), then run ONE combined verification pass (each
  flag's neutrality gate already exists; what's owed is a single all-on `juryReach`/UAT sanity run +
  a live spot-check). If any flag is deliberately dark, record the ruling in the feature row so the
  next audit doesn't re-flag it.

[PG-2] [Severity: Major] [Effort: <1hr] [Value: High]
The narration-faithfulness gate (0081) ships default OFF while narration infidelity is the known launch break
- Where: `frontend/src/settings.py:281` (`"faithfulness_mode": "off"`). Context: the 2026-06-26
  synthesis headline — "the launch break is the player-surface narration seam"; F16 (wrong evictee
  narrated) is a Tier-1 blocker; 0081 was built precisely to catch board/persona/leak/omission slips
  and re-ground closed-set errors.
- Problem: the one shipped system designed to catch the game's worst live failure class is off in
  the product that's about to ship. I2's runtime insurance exists and is disabled.
- Fix: flip the shipped default to `shadow` now (log-only, fail-soft, zero player-visible risk) and
  to `active` (reground) once the F16 guard live re-verify passes. One settings-default line + one
  live run to confirm cost is acceptable (it judges only claim-bearing turns by design).

[PG-3] [Severity: Minor] [Effort: <1hr] [Value: Med]
The runtime overseer (0079) ships off — production generates no diagnostic ring
- Where: `frontend/src/settings.py:270` (`"overseer_mode": "off"`).
- Problem: post-launch triage of "the game felt stuck/wrong" reports will have no OVERSEER ring to
  read; the shipped product runs blind exactly when field diagnosis matters most.
- Fix: default `shadow` (diagnose-and-log only — 0079 is explicitly diagnose-only; the belts stay
  the hands). Keep `off` reachable as the kill switch.

[PG-4] [Severity: Minor] [Effort: <1day] [Value: Med]
There is no owner-facing inventory of the game's richness dials
- Where: cross-cutting — engine env flags (`orwell-install.sh` .env), FE settings
  (`settings.py`), admin dials (overseer/faithfulness), engine `configure` (twist count).
- Problem: PG-1/2/3 happened *because* the felt density of the game is scattered across three config
  planes with no single view. The class will recur with every new opt-in feature (the 0087–0107
  pattern is "flag, default off").
- Fix: an admin Settings → "Season texture" card that lists each layer (trajectories, triggers,
  secret pacing, jury house, campaigns, time-of-day, twists count, overseer, faithfulness) with its
  LIVE state — read-only is enough for v1 (a doc table in `deploy/README` is the <1hr floor). Never
  player-visible (I9).

### Cluster B — player verbs that exist but can't be reached

[PG-5] [Severity: Major] [Effort: <1day] [Value: High]
formAlliance / joinAlliance have no under-call belt — the alliance layer is unreachable in live play
- Where: `frontend/src/agent_loop.py` — belts exist for recordInteraction (`_auto_record_scene`),
  makeDeal (`_auto_record_deal`, :2699), moveTo, markHouseguestMet, confide (`_auto_confide`, :2805);
  NOTHING for `formAlliance`/`joinAlliance`. Context: the measured **0% spontaneous tool-call rate**
  across sampled live turns (synthesis DB5), and 0107's own registry copy ("the MOMENT the player and
  a group NAME an alliance… call formAlliance so the alliance is REAL").
- Problem (I4 — the cardinal sin, applied to 0107): the player says "us three, locked in — call us
  The Firm," the model narrates the pact, and no alliance exists: no bloc cement, no favor bank, no
  0075 confidence feed, no betrayal-cuts-deeper. Exactly the narrated-but-never-recorded class the
  CLAUDE.md mandate names, on the newest marquee mechanic.
- Fix: a `_auto_form_alliance` sibling — pre-filter on naming language ("call ourselves", "we're a
  team", "the three of us", an accepted pitch), constrained extraction proposes `{name, members}`,
  FE calls `formAlliance`; the ENGINE's bond gate stays the adjudicator (unearned members decline —
  the safe-no-op property `_auto_confide` relies on). Same for `joinAlliance` keyed on accepting a
  live pitch id. Model-driven calls take precedence, as with every belt.

[PG-6] [Severity: Major] [Effort: <1day] [Value: High]
Alliance pitches have zero FE surfacing — an NPC's offer can evaporate unvoiced
- Where: `GameSessionAdapter.formNpcAlliances` (pitches the player when bonded enough → only
  `gameStatus.alliancePitches`); `frontend/static/js/orwellDeals.js` (no alliance content at all);
  no notice/card/chip anywhere in FE for a pending pitch.
- Problem: a live pitch surfaces ONLY if the model spontaneously voices `gameStatus.alliancePitches`
  — the exact under-call seam everything else needed a belt for. A bidirectional-scenes beat (NPCs
  initiate too — CLAUDE.md "Bidirectional scenes") silently rots in a projection field.
- Fix: two halves. (a) FE: when `gameStatus.alliancePitches` is non-empty and unacknowledged, inject
  the same one-shot nudge the approach belt uses ("<founder> has let you in on <name> — play the
  offer in their voice; joinAlliance if the player accepts"). (b) Show open pitches in the Deals
  window (PG-29) so an unvoiced one is at least visible. Names + alliance name only — no numbers (I8).

[PG-7] [Severity: Major] [Effort: <1day] [Value: Med]
exposeSecret / tradeSecret have no belts — secrets-as-power is dead at runtime
- Where: `frontend/src/agent_loop.py` (no `_auto_expose`/`_auto_trade`); registry.ts:56-57 (the
  tools + their bluff variants); 0093/0099 built + BDD-gated (cucumber.cjs:78-79).
- Problem: the "learned secret becomes a weapon/currency" loop — including the bluff, the game's
  only first-class deception lever — depends entirely on a spontaneous call measured at ~0%. The
  player says "I'm telling everyone what Klaus is hiding" and the house never reels.
- Fix: belts on unambiguous outing/trading language ("I'm telling everyone / the house should know
  what X is hiding" → exposeSecret; "I'll tell you what I know about X if you…" → tradeSecret), with
  the engine's `knownTo(player)` factId validation as the safe gate (a non-held secret is REJECTED
  harmlessly; a deliberate bluff needs the model's explicit call — the belt should never infer
  `bluff:true`). Lower urgency than PG-5 only because the precondition (a learned secret) is rarer.

[PG-8] [Severity: Minor] [Effort: <1day] [Value: Med]
turnIn is prose-only with no belt — the sleep economy's player lever never fires
- Where: `registry.ts:51` (turnIn: "FE-driven"); `orwellNightStatus.js:5-6` ("no bedtime button —
  the player turns in by SAYING so in prose"); no turnIn handling anywhere in `agent_loop.py`.
- Problem: ADR 0006's ruling (diegetic bedtime, no button) assumed the model converts "I'm heading
  to bed" into `turnIn`. At ~0% spontaneous calls, the night never rolls on the player's word — the
  time-of-day system (the ONE texture flag that IS on by default) loses its player half; late-night
  costs and the morning reset can't be player-owned.
- Fix: a narrow belt on explicit first-person bedtime prose ("I go to bed / turn in / call it a
  night") → FE calls `turnIn`. It's the registry's OWN designation ("FE-driven") — the belt is the
  missing implementation, not a new ruling. Keep it conservative (no belt on "I should sleep soon").

[PG-9] [Severity: Major] [Effort: <1day] [Value: High]
Verb discoverability is ~zero — and the purpose-built hint component has no live consumers
- Where: `frontend/static/js/orwellChatHint.js:41` ("Example (commented — uncomment + adapt to
  re-enable a composer hint later)") — grep confirms zero `OrwellChatHint.show()` callers in the
  codebase. `orwellPremiereTutorial.js` covers ONLY the weekly rhythm. Nothing anywhere teaches:
  confide, deals, alliances, secret trades/bluffs, the Diary Room's purpose, declaring comp intent,
  bedtime, or that lingering/moving rooms is play.
- Problem: the game's depth is its verb set, and the player must guess every verb from a blank
  composer. A first-timer plays the whole season as "talk + click cards" and never touches the
  systems clusters B and the engine teams spent months building. This is the fantasy under-delivering
  not because the systems are missing but because the player was never told the instrument has keys.
- Fix: 3–5 ONE-TIME contextual hints through the existing kit (it already has per-user dismiss
  persistence): first 1:1 scene → "You can press people — make deals, ask what's really going on";
  first time nominated → "Campaign. Work the voters one by one"; first secret learned → "What you
  know is currency — spend it carefully"; first late-night → "The house is thinning; you own your own
  bedtime." All diegetic-adjacent, out of the fiction's mouth (producer voice), never naming tools (I9).

[PG-10] [Severity: Minor] [Effort: <1day] [Value: Med]
The player has no recall surface for what they HOLD — the input to 0093/0099 is invisible
- Where: player knowledge lives in `getVisibleStateFor(...).knowledge` (KnowledgeFacts with ids —
  the factIds exposeSecret/tradeSecret require); no FE surface, no momentPrompts retrieval rule
  reminds the model to answer "what have I heard about Klaus?" from the store.
- Problem: a game about partial, distorted information gives the player no way (beyond scrolling
  chat across sessions) to review what they've learned, from whom, or what secrets they hold — so
  the levers that consume held facts (expose/trade/leverage in deals) have an invisible inventory.
  This respects the 0097 freeze (no scoring, no truth-marking — pure recall of already-surfaced facts).
- Fix (chat-first, ADR 0003): one momentPrompts rule — "when the player asks what they know/have
  heard about someone, answer FROM their recorded knowledge (getVisibleStateFor), with the
  as-heard source framing, never invented" — plus an optional "What you're holding" line-items
  section in the Deals window (content of learned secrets the player may wield, no confidence
  numbers). The facts are the player's own knowledge; I1/I8 untouched.

### Cluster C — the payoff surfaces

[PG-11] [Severity: Major] [Effort: <1hr] [Value: High]
The retrospective renders `slice(-40)` of the unsealed hidden story — THE payoff is silently truncated
- Where: `frontend/static/js/orwellRetrospective.js:195` (`(unsealed.hiddenStory || []).slice(-40)`);
  the engine builds the full story (events + threads + day-one reads + ties + showmances —
  `GameSessionAdapter.ts:1850-1910`; the PV audit measured ~650 hidden entries in one season).
- Problem: the vision names the unsealing as one of the two peak moments the whole architecture
  exists to produce — and the FE shows the LAST 40 entries of an unordered concatenation (events
  first, then structural appends), so most of the season's off-screen story — including the week-1
  schemes that pay off the earliest blindsides — is discarded without a scroll, a count, or a "show
  more." The player finishes a 12-week season and gets a truncated tail.
- Fix: drop the slice; render the full story in the window's own scroll (it's already
  `overflow`-safe kit content), with a count header ("214 sealed moments"). PG-12 adds structure;
  this alone is the one-line unblock.

[PG-12] [Severity: Minor] [Effort: <1day] [Value: Med]
The retrospective has no organization — "what did X really think of me" is unanswerable
- Where: `orwellRetrospective.js` `render()` — one flat `<ul>`; the engine rows carry `ts` (#852,
  explicitly added "so the dump can order chronologically") and participant names in prose.
- Problem: the single most-wanted reunion question — per-houseguest truth about YOU — requires the
  player to eyeball hundreds of lines. The day-one reads ("Hidden side — day-one read of you") are
  the emotional core and land unsorted mid-list. The chat reunion can answer questions, but the
  window (the thing players will actually screenshot/share) presents the payoff as a log dump.
- Fix: group by week (using `ts`) with collapsible sections, and pin a "What they thought of you"
  block (the day-one reads + any player-subject confessionals) to the top under the votes reveal.
  Render-only; the engine payload already suffices.

[PG-13] [Severity: Minor] [Effort: <1day] [Value: Med]
(Corroborates SG7 — raise its priority) Finale per-juror votes never enter the unseal
- Where: `liveSeason.ts:1282/1352` (computed + revealed live); absent from the season record and
  the retrospective/producerVault export.
- Problem: the finale vote breakdown is BB canon's attributed-by-design vote (the contrast to
  secret weekly ballots) and the jury-management report card — the retrospective answers "who
  really voted you out weekly" but not "who crowned the winner." Second independent hit this audit
  cycle; promote from LATENT.
- Fix: as SG7 — persist juror→finalist votes into the season record; add a `juryVotes` block beside
  `evictionVotes`; render it in the votes section (PG-12's top block).

[PG-14] [Severity: Major] [Effort: <1day] [Value: High]
The Diary Room is write-only — no producer voice, no invitation, no payoff
- Where: `frontend/static/js/orwellDiaryRoom.js` (POST → "Recorded ✓" → auto-exit; that is the
  entire experience); `src/engine/diaryRoom.ts:61` (`producerPrompt()` — the "producer pulls the
  player aside after a dramatic beat" invitation — has ZERO callers, verified by grep);
  `playerStrategyRead()` likewise uncalled.
- Problem: in the fantasy, the Diary Room is where the show talks BACK — the probing producer
  question that makes you articulate your game is one of BB's most beloved rituals, and it's also
  the game's natural reflection/pacing beat. Shipped: a one-way text drop with a checkmark. Three
  built affordances (the invitation, the strategy read, the OOC channel) all dead-end. The player
  has no reason to ever use it — and its content never matters (see PG-15).
- Fix (three independently shippable parts, each ≤1day):
  (a) wire `producerPrompt` into the existing nudge family — after a dramatic beat (nomination,
  eviction survived, betrayal witnessed), one-shot nudge: "the producers call <player> to the Diary
  Room" (an invitation, never a force);
  (b) make DR mode conversational — in DR mode the model answers as the PRODUCER voice (it's
  already the player-level OOC channel; `NO_NPC_PATHWAY` keeps the wall — nothing said there can
  reach an NPC), asking one probing question back;
  (c) PG-15's replay.

[PG-15] [Severity: Minor] [Effort: <1day] [Value: Med]
The player's own DR entries are absent from the retrospective
- Where: `GameSessionAdapter` retrospective builder (events + hidden layers only; DR facts are
  player-knowledge with pathway `diary-room`, never included); `orwellRetrospective.js`.
- Problem: the retrospective replays everyone's hidden season EXCEPT the player's own recorded
  inner game. "Week 3, you told the producers you didn't trust Mila" landing beside the unsealed
  truth is the cheapest possible "I called it / I was so wrong" payoff — the 0097 emotion with none
  of 0097's frozen scoring machinery (no called-it marking; the player draws the comparison).
- Fix: append the player's DR entries (their own knowledge — zero Vault involvement) as a "Your
  diary" section, timestamped, interleavable by week with PG-12's grouping.

### Cluster D — the loss experience

[PG-16] [Severity: Major] [Effort: <1day] [Value: High]
An evicted player has no path to the payoff except grinding spectate turns
- Where: `momentPrompts.ts` `evicted` ("you may recap the remaining season to its winner if they
  want to watch") + `jury` (watch results-only broadcasts); `registry.ts:77` — the ONLY
  fast-forward, `advanceToFinale`, is admin/God-Mode. Pure turn-driven default means the house does
  not advance without player turns.
- Problem: the game's emotional design says losing is survivable because the retrospective pays
  everything off — but a week-5 evictee must manually push potentially 6+ weeks of beats
  ("continue… continue…") through a results-only spectator lens to REACH it. Most players will
  abandon at the exact moment the design most needs them to stay (and a pre-jury evictee gets even
  less en route). The payoff is gated behind the product's dullest stretch.
- Fix: a player-channel "watch the season finale edit" — on the evicted/jury moments, offer a
  condensed engine-driven run-out: drives the deterministic loop like advanceToFinale but STOPS at
  the player's real juror obligations (their finale question, their jury vote — never
  auto-resolved, unlike the admin tool) and hands the model a compressed weekly digest to narrate
  as a highlight reel. Player-initiated, results-only, no Vault; the retrospective then unseals
  normally. (Engine: a bounded variant of the existing advanceToFinale driver; FE: one offer in the
  evicted/jury moment prompt + accept path.)

[PG-17] [Severity: Minor] [Effort: multi-day] [Value: Med]
The player-juror's sequester is empty — no fellow-juror contact
- Where: `momentPrompts.ts:788` (jury seat = watch broadcasts, form a read, vote); `juryHouse.ts`
  (0100 — juror↔juror scenes exist! — but the player is explicitly excluded: "witness set = the two
  jurors, EXCLUDES the player", and the layer ships off per PG-1).
- Problem: real BB's jury house is a social space — arriving evictees bring news and grievances,
  and jury-vote philosophy is argued out loud. The player-juror gets none of it: weeks of passive
  result-watching before one vote. The engine literally simulates the room the player is sitting in
  and doesn't let them into it.
- Fix (minimal, phased): (a) each new juror's ARRIVAL is a scene the player-juror witnesses ("Maeve
  storms in — she's still furious about the veto") — pathway-legal (co-present in the jury house),
  one beat per eviction; (b) allow player↔juror 1:1 conversation while sequestered (same scene
  machinery, jurors' knowledge scoped to what they carried out + broadcasts). Full roundtable is
  multi-day; (a) alone is ≤1day and transforms the stretch.

[PG-18] [Severity: Minor] [Effort: <1hr] [Value: Med]
The jury boundary is invisible at the moment jury management matters
- Where: no "first member of the jury" beat exists (grep across `liveSeason.ts`/`momentPrompts.ts`);
  the goodbye-message card (`orwellDecision.js:314` "Goodbye message — your tone, your words") never
  signals the evictee will hold a finale vote; the Cast panel tags "Jury" only after the fact.
- Problem: jury management is a REAL mechanic (goodbye tone folds into the juror's manner) but the
  fiction never marks the stakes transition — the player can't deliberately manage a jury the game
  never announces. "X becomes the first member of the jury" is also iconic stakes-legibility canon.
- Fix: (a) one line in the eviction moment prompt: from the first jury-phase eviction on, the host
  names the evictee's juror seat; (b) goodbye card helper text gains ", they'll carry this to the
  finale vote" when the evictee is jury-bound (the engine knows; the pending can carry a boolean).
  Facts only — no numbers, no advice (I8).

### Cluster E — session boundaries & the episode shape

[PG-19] [Severity: Major] [Effort: multi-day (P1 ≤1day)] [Value: High]
0102 daily bedtime recap is build-ready and unbuilt — sessions end shapeless
- Where: `docs/features/0102-weekly-recap-cliffhanger.md` — PO REVIEW RESOLVED 2026-06-27,
  redesigned to a DAILY bedtime recap pop-up (#884), rulings R1–R2 in hand; reads only Vault-free
  projections.
- Problem: nothing gives a play session an ending — no digest, no cliffhanger, no reason the
  player logs off wanting tomorrow's episode; and a returning player's only re-orientation is the
  chat scroll (the `re-entry` moment deliberately refuses recap dumps — correct, but the sanctioned
  recap FORM was designed and left unbuilt). The vision's "log off with theories" needs a beat that
  crystallizes the theories.
- Fix: build it — and note the natural composition with PG-8: the recap's designed trigger
  (bedtime) is the same `turnIn` seam, so the belt and the recap ship as one arc ("I turn in" →
  night rolls → recap card with a cliffhanger from already-surfaced gossip). P1 = the recap window
  from `seasonRecap`-style witnessed digest; the cliffhanger line is the model's (open set).

[PG-20] [Severity: Major] [Effort: multi-day] [Value: High]
0102 day-1 experience is build-ready + PO-resolved, unbuilt — and missing from the authoritative index
- Where: `docs/features/0102-day-1-experience.md` (+ `.feature`) — "PO REVIEW RESOLVED (owner,
  2026-06-27) — BUILD-READY", champagne-circle premiere, category-level casting strategy, three
  sequenced PRs, composing the parked #905–909. NOT PRESENT in `docs/features/README.md` (its
  number collides with 0102-weekly-recap; the index's own rule: "the single source of truth").
- Problem: the spec's own words — "Day 1 is the highest-leverage retention surface in the product"
  and "the first session reads like an AI workspace that happens to be about a game." Every
  first-session complaint in the journey audit (meet-15 slog, flat roll-call, no early stakes, DR
  never shown) is addressed by this one spec, which is owner-approved and invisible in the tracker.
  With 14 days to ship, this is the highest-value unbuilt work in the whole spec ceiling.
- Fix: (a) <1hr: renumber (0110?) and index it so it exists administratively; (b) build P1 (the
  champagne-circle premiere: mingle → circle → mingle → fast first HOH) before ship if anything
  from this lane gets build budget; P2/P3 post-launch.

[PG-21] [Severity: Minor] [Effort: <1hr] [Value: Med]
The features README status index has drifted on exactly the rows that matter
- Where: `docs/features/README.md:159` (0093 "build-ready… not in cucumber.cjs"), `:165` (0099
  same), `:175` (0109 "SPEC — BUILD-READY"). Verified against source: 0093/0099 are fully built
  (registry.ts:56-57, McpServer dispatch, `GameSessionAdapter.exposeSecret/tradeSecret`,
  `tests/unit/secretPower*.test.ts`, cucumber.cjs:78-79) and 0109's duration scaling is live in
  `src/engine/deals.ts:42-52`.
- Problem: the index self-describes as "the single source of truth… reconciled against the actual
  code," and CLAUDE.md routes every implementer to it. Stale rows on the newest mechanics cause
  double-building or (worse) nobody wiring FE support because the feature "isn't built" (see PG-7 —
  plausibly a consequence).
- Fix: reconcile the three rows (plus the PG-20 index omission) in one docs PR.

### Cluster F — mid-week texture & the living house

[PG-22] [Severity: Major] [Effort: <1day] [Value: High]
Campaign lobbying never reaches the player as a scene — the scramble never knocks on your door
- Where: `src/engine/campaigns.ts:239-244` (`advanceCampaign`: a lobby move appends the next ally —
  which CAN be the player, `allyReadsOf` filters only the owner — to `knownTo`, and does nothing
  else); `GameSessionAdapter.campaignTick` records no event, no knowledge fact, no
  `surfaceInformationTo`, no socialInitiatives entry when that target is the player.
- Problem (I3 + I7): for NPCs, "a lobby tells the lobbied" is honored by the tilt (`knownTo` gates
  susceptibility). For the PLAYER, being lobbied produces zero observables: no pitch scene, no
  recorded pathway, not even a hint the campaign exists — yet the player is marked "aware." In real
  BB, campaign week is defined by people pitching YOU ("it has to be Maeve this week"). The
  shipped scramble happens entirely around the player; the sister finding PV1 showed the player is
  also invisible as a SUBJECT of off-screen cognition — together: the house schemes neither AT you
  nor ABOUT you, only NEAR you.
- Fix: when a lobby/plant move's next recipient is the player, (a) record the pathway
  (`surfaceInformationTo(player, <owner wants <target> out>, "lobbied:<campaignId>")` — the belief
  arrives as a real, distortable fact), and (b) push an approach onto `socialInitiatives` with
  motive `probe` so the existing FE approach nudge stages the scene ("Klaus wants a word"). Rides
  the existing dedicated campaign rng/flag ⇒ calibration untouched; content is the owner's ASK,
  never a number.

[PG-23] [Severity: Minor] [Effort: —] [Value: Med]
(Corroborates PV1 — one theme with PG-22, fix together)
- Where: `offscreen.ts:130/177` (scene partners drawn from `npcs` only).
- Problem/Fix: as PV1 (let NPCs name the player as a confessional/strategy SUBJECT, never
  initiator/witness). Filed in the ledger; this lane independently hit the same wall from the
  campaigns side — treat PV1 + PG-22 as one "the player exists in the hidden layer" work item.

[PG-24] [Severity: Minor] [Effort: <1day] [Value: Med]
Spectator opinion-folds are deferred — competitions are socially inert for watchers
- Where: `docs/features/0106` row ("Spectator *seeded* opinion-folds deferred"); `liveSeason.ts`
  comp resolution (folds credit the winner's resume + `comp-won` threat, nothing for the field's
  observable choices).
- Problem: the whole house watches every comp (0106 made that literal — everyone gathers), yet
  nobody's read of anybody moves from what they SAW: a suspicious underperformance (a throw), a
  dominant win witnessed up close, the player conspicuously gunning after declaring "play safe" —
  all socially free. Comp spectacle carries no social weight, which flattens the "compete vs. throw"
  decision the game asks the player to make every round.
- Fix: build the deferred fold, minimally: one bounded, seeded witness-fold per comp on the
  watchers' edges toward the winner (threat) and toward a detected thrower (a suspicion-grade read,
  only when the engine knows intent ≠ result shape). Behind a flag on a side rng like every 0087+
  layer.

[PG-25] [Severity: Minor] [Effort: <1hr] [Value: Med]
Seasons can complete with zero fired twists
- Where: `GameSessionAdapter.ts:865` (`twistCount = 2` loaded), `reserveTwists.ts` seeded-rare
  firing; PV4 observed `twists:[]` at a real finale; admin `configure` can change the count but
  nothing guarantees a fire.
- Problem: a full BB season with no twist reads flat — and on replay (the 0057 loop this product
  banks on) consecutive twistless seasons make the seasons feel same-y. The retrospective even has
  a payoff line ready for it ("a twist was sealed but never fired") — that's fun once.
- Fix: owner call, then one constant: guarantee ≥1 of the loaded twists fires per season (seed the
  fire-week uniformly mid-season rather than rolling per-week). Keep the second twist seeded-rare so
  seasons still vary.

### Cluster G — replay hooks & copy

[PG-26] [Severity: Minor] [Effort: <1hr] [Value: Med]
"Keep this houseguest" never mentions that your reputation comes with you
- Where: `frontend/static/js/orwellNewSeason.js:117-120` — "Keep = the same person, a new cast.
  Recast = the casting interview runs again."
- Problem: 0104's owner-ruled diegetic opt-in IS this button (keep ⇒ `carriesNotoriety`), and the
  copy hides the entire hook — the one thing that makes the choice interesting ("they'll know who
  you are") is unsaid, so players choose on portrait-convenience.
- Fix: "Keep — the same person returns; your reputation precedes you into the new house." /
  "Recast — a stranger again; clean slate." (Facts of the mechanic's existence, not numbers.)

[PG-27] [Severity: Minor] [Effort: <1hr] [Value: Med]
The reunion never sells season 2
- Where: `momentPrompts.ts` `post-season` moment — hosts the reunion, offers the vault, notes the
  New-season button; says nothing about what returning MEANS (notoriety, seasons-as-levels
  progression 0057, the five house themes 0052).
- Problem: the post-season moment is the product's one retention beat and it's a passive button
  mention. The engine has real replay hooks built; the fiction never mentions any of them.
- Fix: one sentence in the post-season prompt: after the vault payoff, the host may tease the
  next season in-fiction ("the house gets rebuilt; word of your game travels — same face or a new
  one?") — voicing keep-vs-recast as a diegetic choice.

[PG-28] [Severity: Polish] [Effort: <1hr] [Value: Low]
The rail chip undersells the payoff window
- Where: `orwellGadgetRail.js:51` ("📼 Season Recap") vs the window's own title ("The Season,
  Watched Back") and its vault CTA.
- Problem: post-season, the most emotionally valuable click in the product is labeled like a
  utility log.
- Fix: chip title "The Untold Story" (or match the window title) once `finished` is true.

[PG-29] [Severity: Minor] [Effort: <1day] [Value: Med]
"Your Deals" omits alliances entirely
- Where: `frontend/static/js/orwellDeals.js` (zero alliance references); `gameStatus.alliances`
  (name + members, Vault-free by design) + `alliancePitches` already exist.
- Problem: named alliances are the player-legible layer of the social structure (0107's whole
  point: naming makes it real) — and the product's only standing "my commitments" surface doesn't
  show them, nor open pitches. The player can't even review what alliances they're in.
- Fix: an "Alliances" section in the same window: your alliances (name + members), open pitches
  (accept routes through chat, not a button — ADR 0003: the window augments, the conversation
  acts). Data is one fetch away.

[PG-30] [Severity: Minor] [Effort: <1hr] [Value: Med]
The confide belt fires blind — `mayConfide` is computed but not surfaced to the FE
- Where: `agent_loop.py:2780` ("We do NOT depend on `npcVoice.mayConfide` — it is NOT surfaced to
  the FE"); the engine computes readiness per NPC.
- Problem: the belt substitutes a broad regex over the player's line for an engine signal that
  already exists — more false extractions (cost) and missed non-verbal presses. A one-field
  projection gap forcing a heuristic.
- Fix: include `mayConfide` (boolean only) in a Vault-free per-scene projection the FE already
  fetches (e.g., the status/state read used by the belts), and let `_auto_confide` require
  scene-partner readiness OR the regex — cheaper and more precise. Never player-visible.

### Cluster H — forward work, ranked; process

[PG-31] [Severity: Minor] [Effort: ranking only] [Value: Med]
The unbuilt Producer's-Vault batch, ranked by felt-game value (none half-wired — verified)
- Where: 0094/0095/0096/0101 (spec-only; grep confirms zero stubs/flags in src — clean C6 state);
  0097/0098/0103 FROZEN (respected — not re-litigated).
- Ranking for post-launch build order, by what the PLAYER would feel:
  1. **0095 pre-show ties → time-bombs** — the seeded ties (0059, built) currently pay off only at
     the retrospective; 0095 makes them detonate DURING play — the single biggest blindside
     generator on the shelf, and it feeds the `accuseTie` player verb.
  2. **0096 emergent nemesis** — a felt antagonist arc from systems already on (0085/0086);
     narration-side elevation, cheap for its impact.
  3. **0094 distorted-gossip consequences** — makes the belief/confidence model MATTER (acting on a
     bad rumor burns you); deepens paranoia but needs careful surfacing.
  4. **0101 NPC myth-making** — delightful ("people are saying you…") but additive texture.
- Fix: adopt this order into the queue when post-launch batches are cut.

[PG-32] [Severity: Major] [Effort: multi-day] [Value: High]
0108 (real-model golden-path gate) is unbuilt — everything above ships regressible
- Where: `docs/features/0108-real-model-golden-path-gate.md` (spec only); ship-gate's own
  recommendation #1 ("the move that makes 'ship soon' safe").
- Problem (lane-relevant angle): nearly every fix this lane proposes lives on the model↔engine seam
  that NO automated gate exercises — belts, nudges, prompt rules, recap beats. Without 0108, each
  ships hand-verified once and can silently die (the `recordCastProfile` precedent: dead for weeks).
- Fix: build 0108 before (or alongside) the belt work in clusters B/F; add its replay assertions
  for each new belt as they land. Cross-territory: flagged to the orchestrator as shared
  infrastructure, not this lane's own build.

[PG-33] [Severity: Minor] [Effort: <1hr] [Value: Med]
The ship-gate PARKED list is stale on the casting-reframe cluster
- Where: `docs/audits/2026-06-27-ship-gate.md:141` parks "#905–909 / #916–918 — design proposals
  awaiting owner rulings"; `0102-day-1-experience.md` header records the owner RESOLVED them
  2026-06-27 into a build-ready spec.
- Problem: a parked item that silently became build-ready is invisible to anyone triaging from the
  ship-gate (the "authoritative what-blocks-ship" doc) — exactly how PG-20 got lost.
- Fix: one-line ship-gate amendment moving the cluster from PARKED to "resolved → 0102-day-1
  (build-ready, post-launch or P1-before-ship per owner)".

[PG-34] [Severity: Minor] [Effort: <1day] [Value: Med]
The post-eviction aftermath has no pull — the week's most dramatic window opens with silence
- Where: `momentPrompts.ts` phase fragments (eviction night ends the sub-loop; the next moment is
  the fresh HOH comp); `socialInitiatives` ranks by standing relationship agenda, not by "the house
  just changed."
- Problem: the vision names "the lived aftermath scramble" as part of the great session, and the
  journey audit showed transitions montage PAST it (J-3, filed). Beyond the montage bug there's a
  product gap: even played correctly, nothing marks the aftermath as a distinct, charged beat —
  no surge of approaches from the people whose plans just detonated, no post-vote tension read. The
  blindsided player who wants to find out "who flipped" has no one coming to spin them.
- Fix: after an eviction commits (and before the next HOH), one aftermath-aware tick: boost
  `socialInitiatives` ranking for houseguests whose recorded expectations diverged from the result
  (the engine knows who voted against the house — Vault-safe as a MOTIVE-less approach; the spin is
  the model's), and give the eviction-night moment prompt one closing line steering a scramble beat
  before the comp. No numbers, no attribution (E12 holds — approaches don't reveal ballots).

[PG-35] [Severity: Minor] [Effort: <1day] [Value: Med]
Mid-season weeks are structurally identical — nothing breaks the pattern between premiere and endgame
- Where: `liveSeason.ts` weekly cadence (HOH→noms→veto→ceremony→eviction ×N); the only structural
  variety is the reserve twist (can never fire — PG-25) and the comp library's flavor rotation.
- Problem: emotional pacing across the season arc sags in weeks 3–8: same beats, same order, same
  stakes shape, until Final-5 structure kicks in. Real BB paces with mid-season ritual variety
  (luxury/food comps, have-nots, live-audience weeks). The engine's own levers for this (twists
  0025, exclusive house events 0106, triggers 0091) are respectively never-firing, ceremony-only,
  and dark.
- Fix (composes with PG-1/PG-25 rather than new machinery): turn on 0091 (eruptions ARE the
  mid-week pattern-break), guarantee the mid-season twist (PG-25), and add 2–3 non-competitive
  whole-house event entries to the `houseEvents.ts` pool that the 0106 gather treatment applies to
  (a house dinner, a luxury reward afternoon) — flavor-pool additions, no outcome surface.

[PG-36] [Severity: Polish] [Effort: <1hr] [Value: Low]
The retrospective window and the chat reunion don't cross-link
- Where: `orwellRetrospective.js:221` (the vault CTA hint text); `momentPrompts.ts` post-season.
- Problem: the window shows the record; the model can NARRATE any moment of it with relish — and
  neither surface tells the player the other exists.
- Fix: one line under the vault content: "Ask the host about any of this — they were there." (The
  reunion prompt already handles the other direction.)

[PG-37] [Severity: Minor] [Effort: <1day] [Value: Med]
Notoriety never gets an arrival beat — a carried reputation is invisible on day 1 of season 2
- Where: `src/engine/notoriety.ts` (seedFirstImpressions folds the bias, recognition levels, even
  distorted reads — all hidden, correctly); premiere framing/momentPrompts have no
  returning-player awareness.
- Problem: the mechanic is Vault-correct (no numbers, direction-only fold) but experientially
  silent: the returning player is never SHOWN the house has heard of them — no "wait, you're the
  one who blindsided their whole alliance" cold-open line, no premiere framing that some
  houseguests arrive starstruck/wary. The player who chose "Keep" (PG-26) gets nothing observable
  for it until much later behavior, which reads as the feature not existing.
- Fix: surface recognition BEHAVIORALLY at the premiere: the premiere moment prompt (for a
  `carriesNotoriety` season) gets one line — "some houseguests recognize the player's reputation;
  let recognition color their introductions (a fan's excitement, a strategist's wariness) without
  ever stating a read or a fact from the prior season they couldn't know." Recognition level per
  NPC is already computed; expose only the boolean per NPC to the premiere context (public gloss —
  fame is observable), never the bias direction.

[PG-38] [Severity: Polish] [Effort: <1hr] [Value: Low]
The Diary-Room pill sells privacy but not purpose
- Where: `orwellDiaryRoom.js:89` ("Diary Room — private & out-of-character; the house never hears
  this.") and the composer placeholder ("Tell the producers what you're really thinking…").
- Problem: the copy explains the WALL, not the VALUE — a player has no reason to open it (compounded
  by PG-14; fix copy alongside).
- Fix: placeholder → "Call your shots. Vent. Work out who you trust — the producers are listening,
  the house never will." (If PG-15 ships: "…and your diary comes back at the reunion.")

---

## Ranked list (value-per-effort, do-in-this-order)

**Tier 1 — do now (<1hr each, high leverage):**
1. **PG-11** retro `slice(-40)` — one line unblocks THE payoff.
2. **PG-2** ship faithfulness_mode=shadow (→active after verify).
3. **PG-1** turn the five dark flags on in the deploy (+ one verification run).
4. **PG-18** jury-boundary line + goodbye-card stakes copy.
5. **PG-26 + PG-27** notoriety/keep copy + reunion sell (two copy edits).
6. **PG-21 + PG-33 + PG-20a** index/ship-gate reconciliation (docs, but it un-loses 0102-day-1).
7. **PG-25** guarantee one mid-season twist (owner call + one constant).
8. **PG-28 / PG-36 / PG-38** copy polish batch.

**Tier 2 — ≤1day each, core spirit recovery:**
9. **PG-5** alliance belts (the I4 hole on the newest marquee mechanic).
10. **PG-22 (+PG-23)** the scramble knocks on the player's door — lobby-the-player pathway + approach.
11. **PG-9** the 3–5 contextual verb hints (component already exists, unused).
12. **PG-14** Diary Room parts (a)+(b): invitations + the producer voice.
13. **PG-16** the evicted player's condensed run-out to the finale.
14. **PG-6** alliance-pitch surfacing (belt-nudge + Deals section, pairs with PG-29).
15. **PG-8 + PG-19(P1)** turnIn belt + bedtime recap card (one arc).
16. **PG-12 + PG-13 + PG-15** retrospective structure + jury votes + your-diary (one window PR).
17. **PG-7** expose/trade belts; **PG-10** what-you-hold recall; **PG-30** mayConfide surfacing.
18. **PG-34** aftermath-scramble approach boost; **PG-24** spectator folds; **PG-37** notoriety arrival beat.
19. **PG-3 / PG-4** overseer shadow + the texture inventory.

**Tier 3 — multi-day (sequence with owner):**
20. **PG-20** build 0102-day-1 P1 (champagne circle) — highest-value unbuilt spec, pre-ship if anything is.
21. **PG-32** build 0108 (the regression net for all of Tier 2).
22. **PG-19** full daily-recap feature; **PG-17** jury-house arrivals/roundtable; **PG-35** mid-season variety.
23. **PG-31** post-launch spec order: 0095 → 0096 → 0094 → 0101.

---

## Coverage statement

Looked at: the full feature status index 0001–0109 (incl. verifying "built" claims against
registry/adapter/cucumber for 0093/0099/0109 and stub-scanning 0094–0101); the deploy's actual env
(install script + systemd + FE settings defaults); every engine society module's player-visible
outlet (gossip/presence overhears, deals, blocs/alliances, confessionals, campaigns+drives,
triggers/trajectories/secretPacing/juryHouse/notoriety, houseEvents, diaryRoom, retrospective);
the FE player surfaces (gadget-rail inventory, retrospective, diary room, deals, new-season,
tutorial, chat-hint) and the agent-loop belt inventory vs. the registry's player-tool list; the
loss/jury/finale/post-season moment prompts; goodbye/jury mechanics; the journey transcript and the
nerd-audit + ship-gate ledgers for dedupe. NOT covered (other lanes): live behavioral runs,
rendering/animation states, a11y, mobile matrix, two-window parity, prompt-wording quality per se,
and the FE↔engine transport bugs. Ran out of genuinely NEW product-gap ground at this altitude —
remaining ideas were duplicates of ledgered items (F14-class surfacing, PV2 gossip prefix) or would
violate the 0097/0098/0103 freezes.
