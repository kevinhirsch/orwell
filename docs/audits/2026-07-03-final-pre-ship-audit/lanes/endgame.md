# ENDGAME / JURY / FINALE / POST-SEASON — deep audit lane (findings 25–…)

Territory: `src/engine/jury.ts` + `juryConstants.ts`, `liveSeason.ts` finale/eviction/Final-3/goodbye
sub-loops, `reserveTwists.ts`, `notoriety.ts`, the 0048 retrospective/unsealing engine
(`GameSessionAdapter.buildVaultUnseal`) + FE `orwellRetrospective.js`, the evicted/jury tail,
`momentPrompts.ts` endgame beats. Read from source (both live playthroughs stalled ~week 2, so the
back half is otherwise un-exercised — this is the value of the lane).

## INDEX

| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| ENDGAME-1 | Major | <1hr | High | Retrospective hidden story truncated to last 40 rows — drops the whole early/mid season | orwellRetrospective.js:195 |
| ENDGAME-2 | Major | <1day | High | No player-facing "watch to the finale" — evicted player must hand-advance dozens of NPC beats to reach the payoff | registry / tools (only admin L38) |
| ENDGAME-3 | Major | <1hr | High | `juryVotes` unsealed by engine but NEVER rendered by the FE — dead finale-vote payoff | GameSessionAdapter:1930 vs orwellRetrospective.js |
| ENDGAME-4 | Major | <1day | High | No distinct WINNER moment — champion and runner-up both get the generic "post-season" reunion prompt | GameSessionAdapter:7275 / momentPrompts:761 |
| ENDGAME-5 | Major | multi-day | Med | Final 3 is a single HOH comp, NOT the canonical 3-part final HOH | liveSeason.ts:426-429,634-637 |
| ENDGAME-6 | Major | <1hr | High | The jury house is inert by default — jurors' opinions frozen at eviction (bitter-jury drift off unless a hidden env flag is set) | GameSessionAdapter:390 (`ORWELL_JURY_HOUSE`) |
| ENDGAME-7 | Major | <1day | Med | 2 of 3 reserve twists (secret-power, battle-back) are dead code — only double-eviction is implemented | GameSessionAdapter:342; reserveTwists.ts:17 |
| ENDGAME-8 | Major | <1day | Med | 0104 notoriety half-dead: `legendBeats`/`notorietySummary()` have ZERO callers — the "reputation precedes you" callback never reaches the narrator | GameSessionAdapter:5016 (no callers) |
| ENDGAME-9 | Major | <1day | Med | No post-season stats / cross-season history surface — placement, comp resume, prior seasons all computed but never shown to the player | seasonStats/openSetOutcome exist; no FE |
| ENDGAME-10 | Minor | <1hr | Med | Recap arc highlights truncated to last 12 — early-week ceremonies dropped | orwellRetrospective.js:149 |
| ENDGAME-11 | Minor | <1day | Med | "Making jury" is never announced — the pre-jury→jury milestone has no beat | liveSeason eviction sub-loop; seatOf:7245 |
| ENDGAME-12 | Minor | <1day | Med | Finale reveal is fixed eviction-order and never stops at the clinching majority — flat vs BB's build-to-5 | jury.ts:228 (`revealOrder:[...jury]`); advanceFinale reveal |
| ENDGAME-13 | Minor | <1day | Med | 18-Q&A finale is a decision-card slog for a player finalist (statement + 9 appeal picks) | jury.ts:223-229; advanceFinale questions |
| ENDGAME-14 | Minor | <1hr | Low | `goodbye-message.message` free text is declared but ignored by the engine (only `tone` folds) | liveSeason.ts:1777-1792 |
| ENDGAME-15 | Minor | <1hr | Low | Only 3 NPC goodbye messages per eviction (real BB tapes goodbyes from everyone) | liveSeason.ts:1139 |
| ENDGAME-16 | Minor | <1hr | Low | Reserve-twist RNG waste makes double-eviction ~3× rarer than `twistCount` implies (pick-then-filter) | GameSessionAdapter:3514-3516 |
| ENDGAME-17 | Minor | <1hr | Low | Player's finale statement + juror question carry zero weight, with no signal — words feel ignored | liveSeason.ts:1799,1816 |
| ENDGAME-18 | Minor | <1day | Low | Evicted/jury player tail is agency-free spectation (corroborates known concern; concrete: no jury-house interaction, no roundtable) | momentPrompts "jury"/"evicted" |
| ENDGAME-19 | Polish | <1hr | Low | Winner line in the retrospective is understated when the PLAYER wins | orwellRetrospective.js:121 |
| ENDGAME-20 | Minor | <1hr | Low | Double-eviction silently no-ops when the house is small even if sealed — reads as bug, not "twist that never fired" | liveSeason.ts:1064 |
| ENDGAME-21 | Minor | <1hr | Low | Jury size hard-coded `slice(-9)`; a thinned season (self-evicts) silently degrades "Jury of 9" | liveSeason.ts:1370; seatOf:7250 |
| ENDGAME-22 | Polish | <1hr | Low | NPC finale opening statement is content-free (`gives an opening statement`) — model confabulates their pitch with zero engine grounding | liveSeason.ts:1423 |
| ENDGAME-23 | Minor | <1hr | Low | Finale performance floor (`appealPerf`) can be gamed: an NPC always plays `bestAppeal`, the player must match it 9× or lose ground — invisible skill wall | jury.ts:160; liveSeason.ts:1439 |
| ENDGAME-24 | Polish | <1hr | Low | Retrospective hidden-story rows are a flat bulleted dump with no week grouping — the "receipts" read as a log, not a story | GameSessionAdapter:1942; orwellRetrospective.js:194 |

---

## FINDINGS

### [ENDGAME-1] [Severity: Major] [Effort: <1hr] [Value: High]
Retrospective "hidden story" truncated to the last 40 rows — drops the entire early/mid season
- Where: `frontend/static/js/orwellRetrospective.js:195` — `for (const h of (unsealed.hiddenStory || []).slice(-40))`. The engine (`GameSessionAdapter.buildVaultUnseal`, sorted chronologically at :1945) returns the FULL hidden layer — for a completed 16-cast season with off-screen sim, gossip diffusion, confessionals, threads and seeded ties this is easily hundreds of rows.
- Problem: `slice(-40)` keeps only the LATEST 40 (endgame). All of the early- and mid-season off-screen scheming — precisely the plots the player was blindsided by in weeks 1–6 — is silently dropped from the payoff. This directly guts the VISION's peak moment #1 ("being blindsided by a plot you never saw — and later learning it was real, recorded, and fair all along") and violates the spirit of I5 (nothing thins) at the one surface whose entire job is the non-degraded receipts. The truncation is silent — no "…and 600 more" affordance.
- Fix: remove the cap (the panel already scrolls inside `overflow`), or paginate/"load more". If a hard cap is kept for perf, keep the EARLIEST rows too (head+tail) and show a count of the omitted middle. At minimum bump to a few hundred and surface the omission.

### [ENDGAME-2] [Severity: Major] [Effort: <1day] [Value: High]
No player-facing fast-forward to the finale — the evicted player must hand-advance the whole rest of the season to reach the payoff
- Where: `src/surfaces/tools/registry.ts:77` — `advanceToFinale` is ADMIN/God-Mode ONLY (DEBUG L38). No player-tier equivalent. A pre-jury evictee (evicted week 2–5, the most common outcome) is done playing but the retrospective only unseals on `this.live.finished` (`GameSessionAdapter.seasonRetrospective:1829`).
- Problem: to reach the retrospective (their only remaining payoff) the evicted player must call `advanceGame` through every remaining beat of a game they're no longer in — multiple weeks × staged HOH rounds + noms + veto draw + veto comp rounds + veto ceremony + staged eviction reveals + the full 18-Q&A finale + 9 reveal beats. That's ~40–60 advance clicks of pure NPC spectation with zero agency. The "evicted-player tail is dull" concern made concrete: there is no "sim to the end / watch the finale" button, so the payoff is gated behind a grind.
- Fix: add a player-facing "watch it play out to the finale" affordance (a Vault-free wrapper over the same L38 driver, legal-default auto-resolve of any of the player's own owed decisions — there are none once evicted) that fast-forwards to `finished` and opens the retrospective. Offer it the moment the player is evicted / makes jury.

### [ENDGAME-3] [Severity: Major] [Effort: <1hr] [Value: High]
`juryVotes` is unsealed by the engine but never rendered by the FE — the per-juror finale-vote payoff is dead
- Where: `GameSessionAdapter.buildVaultUnseal:1930-1938` builds `juryVotes { finalists, votes:[{juror, votedFor}] }` (SG7/#1030) and the route passes it through verbatim (`orwell_routes.py:593`). But `grep juryVotes frontend/` returns NOTHING — `orwellRetrospective.js` renders `twists`, `evictionVotes`, and `hiddenStory` only (:160-200). `juryVotes` is silently discarded.
- Problem: the retrospective unseals per-voter eviction ballots ("How the votes really fell") but NOT the equivalent for the crowning vote. A player who lost the jury 5–4 has no post-season way to see WHICH jurors turned on them (the live reveal is one-at-a-time and gone). The signature "who really voted for me at the end" receipt is built end-to-end in the engine and thrown away in the render.
- Fix: render `unsealed.juryVotes` in `orwellRetrospective.js` right after the eviction-votes section — a "How the jury voted" block mirroring the existing eviction-votes list (names only, same styling).

### [ENDGAME-4] [Severity: Major] [Effort: <1day] [Value: High]
No distinct WINNER moment — the champion and the runner-up get the identical generic "post-season" reunion prompt
- Where: `GameSessionAdapter.view():7273-7277` — a finished season maps to `moment: "post-season"` for EVERYONE (`this.live?.finished ? "post-season" : …`), regardless of whether the player won, was runner-up, or is a spectating juror. `momentPrompts.ts:761` "post-season" is a reunion-HOST prompt ("host the reunion. Offer the real story…"). There is no `champion`/`you-won` moment key (keys: …jury-finale, evicted, post-season, self-evicted, jury, default).
- Problem: the entire game builds to winning Big Brother, and the moment it happens the framing drops straight to "host the reunion, offer the recap." Winning and LOSING the finale are narrated from the same instruction set. The player who just won half a million gets no dedicated triumphant beat; the runner-up gets no dedicated gut-punch. The single biggest emotional payoff in the product is unframed.
- Fix: split the terminal moment by placement — a `champion` moment (the crowning, the confetti, "you did it") when `winner === player`, and a `runner-up` moment (the near-miss, the jury that turned) otherwise — before falling through to reunion-hosting. `_derive_placement`/`seasonStats` already know the placement; branch on it in `view()`.

### [ENDGAME-5] [Severity: Major] [Effort: multi-day] [Value: Med]
Final 3 is a single HOH competition, NOT the canonical 3-part final HOH
- Where: `liveSeason.ts:426-429` (`hohField` lifts the outgoing-HOH restriction so all 3 play ONE comp) → `crownCompetition:634-637` (`s.beat = finalThree ? "final-eviction" : "nominations"`) → `advance` `final-eviction:1483` (the lone HOH personally evicts one). The whole Final 3 is: one staged comp, one personal eviction.
- Problem: real BB's Final 3 is a THREE-PART final HOH — Part 1 (all three, endurance), Part 2 (the two who lost Part 1), Part 3 (the two part-winners head-to-head on the finale night) — one of the format's most iconic set-pieces and a major strategic beat (throwing part 1, who you'd take). Orwell collapses it to a single roll. This is the biggest BB-canon gap at the climax; the CLAUDE.md "canonical mechanics" section itself doesn't spec the 3-part, so it was never built.
- Fix: implement the 3-part final HOH as three sequenced staged comps with the correct fields (P1 all-3 → P2 the two P1 losers → P3 the two part-winners), the P3 winner becoming the final HOH who evicts. Keep it one calibrated outcome chain (byte-identical trajectory guard). Multi-day but it is the finale's marquee mechanic.

### [ENDGAME-6] [Severity: Major] [Effort: <1hr] [Value: High]
The jury house is inert by default — sequestered jurors' opinions are frozen at eviction
- Where: `GameSessionAdapter.ts:390` `const JURY_HOUSE_ENABLED_DEFAULT = process.env.ORWELL_JURY_HOUSE === "1";` — OFF unless the env flag is set, and the deploy default does not set it. With it off, `s.juryGrudge` is never populated, so `edgeAsJuryRel` (`liveSeason.ts:1311`) applies a zero grudge and every juror votes off the snapshot of how they felt the day THEY were evicted.
- Problem: the jury house is one of BB's defining dramatic engines — jurors argue, sway each other, turn bitter or come around across the weeks in sequester, and that shift decides close finales. Orwell built it (feature 0100, `juryHouse.ts`) but ships it default-off, so by default a juror the player blindsided in week 6 stays maximally bitter through the finale even if the house would have talked them down. The finale's fairness/drama is thinner than the engine is capable of, and nobody flipping the flag will ever know it exists (C6 half-wired-flag pattern, and an I7 "the house schemes without you" gap for the one room the player can never enter).
- Fix: enable `ORWELL_JURY_HOUSE=1` in the deploy default (systemd env) — it is calibration-bounded (`adjustmentCap < |MANNER_LEAN.betrayed|`) so it deepens, never swamps, jury management. If left off for calibration reasons, that's a launch decision to make explicitly, not by default.

### [ENDGAME-7] [Severity: Major] [Effort: <1day] [Value: Med]
Two of three reserve twists (secret-power, battle-back) are dead — only double-eviction is implemented
- Where: `GameSessionAdapter.ts:342` `const IMPLEMENTED_TWISTS = new Set(["double-eviction"]);` filters the seal at :3515; `reserveTwists.ts:14-17` advertises `RESERVE_POOL = ["secret-power","double-eviction","battle-back"]` but only double-eviction has a firing handler (`rollWeek:1064`; there is no `secret-power`/`battle-back` case anywhere).
- Problem: the "producer's sealed twists" reveal in the retrospective — a real payoff ("the twist that never fired") — can only ever contain double-eviction. secret-power and battle-back are generated and immediately filtered out, so they can never be sealed OR fired. The endgame's variety and the retrospective's twist section are thinner than advertised, and there's dead pool content dragging the RNG (see ENDGAME-16).
- Fix: either implement secret-power and battle-back (they're non-structural: a one-time veto/nullify, a jury-house re-entry that respects the 16→jury-9→final-2 arc) or drop them from `RESERVE_POOL` so the pool matches reality and the RNG stops being wasted.

### [ENDGAME-8] [Severity: Major] [Effort: <1day] [Value: Med]
0104 notoriety is half-dead: `notorietySummary()`/`legendBeats` have zero callers — the "your reputation precedes you" callback never reaches the narrator
- Where: `notoriety.ts` derives `legendBeats` ("has a reputation for blindsiding their own allies", etc.); `GameSessionAdapter.ts:5016` exposes `notorietySummary()` explicitly commented "the (Vault-free) notoriety the narrator may VOICE as a returning-cast callback." But `grep notorietySummary|legendBeats` across `src/surfaces`, `src/ports/GameSession.ts`, and all of `frontend/` returns NOTHING — it is not on the port, not a tool, not in the view, not in `momentPrompts`.
- Problem: the notoriety day-one edge BIAS is wired (`seedFirstImpressions`, :3984-3992) so a returning same-character player's hidden edges shift — but the DIEGETIC half, the whole point of the feature being player-facing, is dead: no NPC ever references your past season, no "word is you won this thing before." A player who returns as the same houseguest (a real FE path via `keepCharacter`) gets a silently-biased cast and zero on-screen acknowledgment of their legend. The fantasy "a reputation that precedes you" is invisible.
- Fix: expose `notorietySummary()` on the `GameSession` port and hand `legendBeats` to the narrator on the premiere/re-entry moment (as "facts to voice", ADR 0003) so a returning player's legend actually lands in the fiction.

### [ENDGAME-9] [Severity: Major] [Effort: <1day] [Value: Med]
No post-season stats or cross-season history surface — placement, comp resume, and prior seasons are all computed but never shown
- Where: `GameSessionAdapter.ts:5020-5062` computes `seasonStats`/`openSetOutcome` (placement, castSize, `playerCompWins`, `playerEvictionRoles`, `reachedJury`, `juryVoteShare`); `notoriety.ts` persists `seasonsPlayed`/`bestPlacement`/`lastPlacement` across seasons (`FileUserNotorietyStore`). The retrospective panel shows only winner + placement + margin + 12 highlights.
- Problem: after finishing a season the player gets no "your Big Brother resume" — no comp-win count, no HOH/veto tally, no "you were on the block N times", and crucially no CROSS-SEASON history ("Season 1: 3rd · Season 2: winner") even though the store holds `seasonsPlayed`/`bestPlacement`. A returning player has an accumulating career the product never reflects back to them. This is a product gap: the retention hook (multiple seasons, a growing legend) exists in the engine and is invisible.
- Fix: add a post-season stats card (this season's resume from `seasonStats`) and a small career strip from the notoriety summary (seasons played, best placement, the legend beats). Cheap given the data already exists.

### [ENDGAME-10] [Severity: Minor] [Effort: <1hr] [Value: Med]
Recap arc highlights truncated to the last 12 — early-week ceremonies dropped
- Where: `orwellRetrospective.js:149` `for (const h of (recap.highlights || []).slice(-12))`. `seasonRecap` (`GameSessionAdapter:1807`) returns every non-hidden `season:`/deal/betrayal event as highlights — a 14-week season has far more than 12 ceremony lines.
- Problem: same silent-tail-truncation as ENDGAME-1 but on the PUBLIC arc: weeks 1–~9 of ceremony highlights vanish from the recap, leaving only the endgame. The season "you lived" reads as if it started at Final 4.
- Fix: remove/greatly raise the cap (panel scrolls), or group by week and show all.

### [ENDGAME-11] [Severity: Minor] [Effort: <1day] [Value: Med]
"Making jury" is never announced — the pre-jury→jury milestone has no beat
- Where: `seatOf:7245-7252` derives jury seat retroactively (`idx >= cast-2-9`); `beginFinale:1370` slices `evictionOrder.slice(-9)`. The eviction sub-loop's `eviction-result` beat is a flat "X leaves the house" with no notion of whether X is the first juror.
- Problem: reaching jury is a huge BB milestone (guaranteed stipend, you now get a vote, you're locked in the jury house not sent home). Neither the evicted player who just BECAME the first juror nor the house is ever told "the jury phase has begun." A player evicted at position 6 has no idea they "made jury" vs. going home pre-jury except by inference from the moment prompt.
- Fix: mark the jury-phase transition — when the first juror is evicted, emit/annotate a "the jury begins" production beat, and frame the evicted player's "jury" moment as the milestone it is ("you've made the jury").

### [ENDGAME-12] [Severity: Minor] [Effort: <1day] [Value: Med]
Finale vote reveal is fixed eviction-order and never stops at the clinching majority
- Where: `jury.ts:228` `revealOrder: [...jury]` (jury = `evictionOrder.slice(-9)`, i.e. oldest juror first, always the same order); `advanceFinale` reveal stage (`liveSeason.ts:1454-1465`) walks the full `revealOrder` and only tallies after ALL 9 are read.
- Problem: unlike the weekly eviction (which seeded-shuffles its reveal order, `beginEviction:1202`), the FINALE reveals votes in a deterministic, predictable order and always reads all 9 even after the win is mathematically locked. Real BB reveals until someone hits 5 (the majority), building suspense and stopping on the clinching vote. Orwell's crowning is flatter and more predictable than its weekly evictions.
- Fix: seeded-shuffle the finale `revealOrder` (as the eviction sub-loop does), and stop the reveal once a finalist reaches the majority (⌈jury/2⌉) — the crowning lands ON the deciding vote.

### [ENDGAME-13] [Severity: Minor] [Effort: <1day] [Value: Med]
The 18-Q&A finale is a decision-card slog for a player finalist
- Where: `runFinale` (`jury.ts:223-229`) builds `questions = jury.flatMap(juror => finalists.map(finalist))` = 9 jurors × 2 finalists = 18 Q&A. For a player finalist that is 9 `finale-answer` HARD-STOP decision cards (`advanceFinale:1428`), plus their opening statement — ~10 sequential decision cards, each a pick among the same 4 appeals.
- Problem: the finale's emotional peak becomes a repetitive form-fill: nine times, pick one of {own-game, mend, connect, discredit-rival}. The appeal set never changes, so after two or three it's mechanical, not dramatic — the opposite of the gravitas the moment wants. (Real BB: each juror asks ONE pointed question, ~7–9 total, directed.)
- Fix: reduce to one question per juror directed at one finalist (or batch the player's answers), and/or vary the surfaced appeal framing per juror so each answer feels bespoke. Keep the scoring symmetric but cut the card count.

### [ENDGAME-14] [Severity: Minor] [Effort: <1hr] [Value: Low]
`goodbye-message.message` free text is declared but silently ignored by the engine
- Where: `SubmitDecisionReq` includes `{ kind: "goodbye-message"; tone: GoodbyeTone; message?: string }` (`liveSeason.ts:407`) but `applyDecision`'s goodbye-message case (:1777-1792) reads only `input.tone` — `message` is never touched.
- Problem: a declared-but-unused API field invites callers (the FE, a tool author) to send the player's authored goodbye prose expecting it to matter; it evaporates at the boundary. Harmless today (the model voices the prose from chat) but it's a latent "why didn't my goodbye do anything" trap and dead surface area.
- Fix: drop `message?` from the type, or record it on the event content so the authored words are at least persisted with the goodbye beat.

### [ENDGAME-15] [Severity: Minor] [Effort: <1hr] [Value: Low]
Only 3 NPC goodbye messages per eviction
- Where: `liveSeason.ts:1139` `const GOODBYE_MESSAGE_COUNT = 3;` — `selectGoodbyeSenders` picks 3 of the remaining house (+ the player, appended last).
- Problem: real BB tapes a goodbye message from EVERY remaining houseguest — the "who was warm, who was cold" montage is a beat in itself and a jury-management tell. Sampling only 3 makes eviction night thin and means most houseguests' goodbye tone never folds into the evictee's manner (only their vote does).
- Fix: raise the count toward the full remaining house (bounded for pacing at larger sizes), so the goodbye montage reads as the full-house send-off it is.

### [ENDGAME-16] [Severity: Minor] [Effort: <1hr] [Value: Low]
Reserve-twist RNG waste makes double-eviction rarer than `twistCount` implies
- Where: `GameSessionAdapter.ts:3514-3516` — `loadReserveTwists(twistCount=2)` picks a random kind from the 3-pool per slot (`reserveTwists.ts:48`), THEN `.filter(t => IMPLEMENTED_TWISTS.has(t.kind))` drops the ~2/3 that landed on secret-power/battle-back.
- Problem: each armed slot only "counts" if its random pick happened to be double-eviction (~1/3). Combined with the 50% load prob, the effective per-season double-eviction rate is ~1/3 of intent — a double eviction almost never fires, so the one working twist is nearly as absent as the dead ones. If the design wants double-evictions to feel occasional, this quietly makes them near-nonexistent.
- Fix: filter the POOL to implemented kinds BEFORE the seeded pick (`RESERVE_POOL.filter(IMPLEMENTED_TWISTS.has)`), so every armed slot picks a twist that can actually fire.

### [ENDGAME-17] [Severity: Minor] [Effort: <1hr] [Value: Low]
The player's finale statement and juror question carry zero weight, with no signal
- Where: `finale-statement` (`liveSeason.ts:1799` "Free-text flavor — carries NO score") and `juror-question` (:1816 "SCORELESS flavor"). Only the 4-way structured `finale-answer` appeal sways the tally.
- Problem: this is correct anti-sycophancy (only structured appeals sway; the LLM never grades eloquence). But from the player's seat, they pour a heartfelt closing statement / a pointed juror question into a HARD-STOP decision card and it changes nothing — with no in-fiction cue that it's flavor. It can read as "the game ignored my best moment."
- Fix: no scoring change — but frame these beats so the flavor lands as flavor (the statement is the DRAMA, the appeal is the STRATEGY) rather than as an ignored decision, so the player doesn't feel their words were discarded.

### [ENDGAME-18] [Severity: Minor] [Effort: <1day] [Value: Low]
Evicted/jury player tail is agency-free spectation (corroborates the known concern)
- Where: `momentPrompts.ts` "jury" (:787 "they hold no power and cast no vote" until the finale) and "evicted" (:747 "their season is over… they hold no power"). Between eviction and the finale a juror has exactly one beat of agency: their own juror-question, then their vote.
- Problem: a player evicted to jury spends weeks of real play watching public-ceremony recaps with nothing to do — no jury-house conversations, no jury roundtable, no interaction with fellow jurors, no campaigning-from-sequester. Real BB's jury phase is full of segments. Orwell's is dead air plus one vote. Combined with ENDGAME-2 (no fast-forward), the losing player's experience is a long passive grind.
- Fix: give the juror SOMETHING — a jury-house scene or two they participate in (their read hardening/softening, feeding the 0100 grudge if enabled), or at least a "return for the finale" jump so the tail isn't a manual advance-grind.

### [ENDGAME-19] [Severity: Polish] [Effort: <1hr] [Value: Low]
Winner line in the retrospective is understated when the PLAYER is the winner
- Where: `orwellRetrospective.js:121` — `"👑 " + recap.winner.name + " won the season (week N)"` renders identically whether the winner is an NPC or the player; the placement block below explicitly skips the winner case (:128 "winner is already the apex line above").
- Problem: when the player themselves won, the panel says "👑 [PlayerName] won the season (week 12)" in the same third-person register as an NPC win — no "You won.", no celebration weight for the single biggest outcome in the product.
- Fix: detect player-is-winner and render a first-person, celebratory apex ("👑 You won Big Brother — week 12"), distinct from an NPC crowning.

### [ENDGAME-20] [Severity: Minor] [Effort: <1hr] [Value: Low]
Double-eviction silently no-ops when the house is small even if it was sealed
- Where: `liveSeason.ts:1064` — the sealed double-eviction only fires if `s.active.length > 3` after the first eviction. Otherwise the pending twist is left on `s.twist` and never fired; it surfaces in the retrospective as "sealed but never fired."
- Problem: if the seeded fire-week lands late (small house), the twist silently doesn't happen. That's defensible ("the twist that never fired") but it's indistinguishable from a bug, and a late-seeded double-eviction is effectively wasted — the `fireAtBeat` seed (`reserveTwists.ts:50`, `2 + rng.int(totalBeats-3)`) can easily land where the house is already ≤4.
- Fix: bias `fireAtBeat` to weeks where the house is large enough to run a compressed second cycle, so a sealed double-eviction reliably has a legal firing window (or explicitly cap the seedable fire-week).

### [ENDGAME-21] [Severity: Minor] [Effort: <1hr] [Value: Low]
Jury size is hard-coded `slice(-9)` — a thinned season silently degrades "Jury of 9"
- Where: `liveSeason.ts:1370` `s.evictionOrder.slice(-9)`; `seatOf:7250` `preJury = cast-2-9`; `calibration.ts:103`.
- Problem: the jury is defined as "the last 9 evictees" with no lower bound. A season that reaches Final 2 with fewer than 9 total prior evictions (e.g. self-evictions removing bodies without evictions, or a smaller cast) yields a jury of <9 and the mandate's "Jury of 9" silently degrades, with a possible even-sized jury (tie every time → last-juror tiebreak carries every close finale). Standard 16-cast is fine; the edge is unguarded.
- Fix: derive the jury from an explicit jury-formation marker (the first juror onward) rather than a blind tail-slice, and assert an odd/expected jury size or handle the short case deliberately.

### [ENDGAME-22] [Severity: Polish] [Effort: <1hr] [Value: Low]
NPC finale opening statement is content-free — the model confabulates their pitch with zero grounding
- Where: `liveSeason.ts:1423` the NPC statement beat is just `${finalist} gives an opening statement` (no appeal, no resume facts attached), unlike the NPC ANSWER beats which are grounded in a chosen appeal.
- Problem: the model narrates the NPC finalist's closing pitch from nothing — it can invent a game resume (comp wins, moves) that contradicts what actually happened (an I2 grounding risk at the finale, the highest-stakes narration). The engine HAS the resume (`s.resume`) and the manner history but hands the statement beat no facts.
- Fix: attach the finalist's public resume (HOH/veto tally from `s.resume`) to the statement beat so the model voices a grounded pitch, not a confabulated one.

### [ENDGAME-23] [Severity: Minor] [Effort: <1hr] [Value: Low]
Finale scoring has an invisible skill wall: NPC always plays `bestAppeal`, the player must match it 9× or lose ground
- Where: `advanceFinale:1439` the NPC finalist answers with `bestAppeal(...)` (the argmax-optimal appeal per juror, `jury.ts:160`); the player answers by hand-picking one of 4 (`finale-answer`). `appealPerf` scores both by the same `appealEffect`.
- Problem: the NPC finalist is a perfect finale player by construction; the human must correctly reason which of {own-game, mend, connect, discredit-rival} is optimal for each specific juror's hidden grievance/affinity — with NO visibility into that juror's state (I8: the numbers are hidden). So the "fair" symmetric scoring is actually stacked: the NPC never misplays, the player is guessing blind. The finale weight is small (`JURY_WEIGHTS.finale=0.3`) so it rarely decides, but where it does, it favors the NPC.
- Fix: either give the player legible in-fiction cues about each juror's disposition before they choose an appeal (their grievance, whether they liked you), or cap the NPC to a plausibly-imperfect appeal rather than strict argmax, so the finale is a readable choice rather than a hidden optimization the human can't see.

### [ENDGAME-24] [Severity: Polish] [Effort: <1hr] [Value: Low]
Retrospective hidden-story is a flat bulleted dump — the "receipts" read as a log, not a story
- Where: `GameSessionAdapter.ts:1942` explicitly declines week-grouping ("events carry a monotonic tick, not a week number… chronological order is the robust win"); `orwellRetrospective.js:194-199` renders each row as a flat `<li>` "Label — content".
- Problem: the single most important payoff surface — "here is everything that was really happening behind your back" — is a chronological bullet list with no week anchors, no scene grouping, no "the week you were blindsided" framing. Even un-truncated (ENDGAME-1) it reads like a debug feed, not the dramatic reveal the vision wants ("with receipts").
- Fix: carry a week marker on hidden events (or reconstruct from adjacent ceremony ts) and group the reveal by week with headers, so the untold story reads as a narrative the player can walk back through, not a log.

---

## COVERAGE / WHERE I LOOKED
- Read in full: `jury.ts`, `juryConstants.ts`, `reserveTwists.ts`, `notoriety.ts`, `orwellRetrospective.js`; the finale/eviction/Final-3/goodbye/self-eviction sub-loops of `liveSeason.ts` (~lines 420–1595, 1770–1844); `buildVaultUnseal`/`seasonRecap`/`seasonStats`/`playerStatus`/`seatOf`/`view` in `GameSessionAdapter.ts`; the endgame moment prompts + `renderStoryFacts` in `momentPrompts.ts`; the retrospective route in `orwell_routes.py`; the notoriety wiring in `registry.ts`.
- Verified: Final-3 is single-comp (no 3-part); jury management DOES reach the vote (manner + goodbye tone + reliability + gameRespect all fold via `edgeAsJuryRel`/`mannerFor`); jury-house grudge default-OFF; notoriety carry IS wired engine-side (`keepCharacter`→`carriesNotoriety`→`setNotoriety`) but its diegetic half is dead; reserve twists 2/3 dead; `juryVotes` unsealed but unrendered; goodbye `message` ignored; the null bytes in `GameSessionAdapter.ts` are intentional `\x00` map-key delimiters (NOT a corruption bug — verified).
- NOT deeply covered (flag for other lanes): the FE decision-card UX for finale-answer/goodbye/tie-break (frontend lane); the two-window/beatSeq behaviour across the finale reveal (consistency lane); real-model narration quality of the crowning/reunion (narration-fidelity lane); `blocs.ts`/`deals.ts` internal math at the final few (only skimmed for dangling-deal handling — deals stay binding until broken/season-end, no obvious endgame break found).

## CROSS-TERRITORY FLAGS
- **C6 (spec ceiling ahead of build):** jury-house (0100) and the notoriety diegetic callback (0104) are BUILT but shipped inert/unwired by default — the "half-wired flag/stub" pattern the vision brief flags. Relevant to any lane auditing the opt-in/default-off batch.
- **I5 (nothing thins):** the retrospective's `slice(-40)`/`slice(-12)` truncation is a non-degradation violation at the payoff surface — flag to the persistence/backend lane too.
- **I2 (grounding):** the content-free NPC finale statement (ENDGAME-22) is an anti-confabulation gap at the highest-stakes narration — flag to narration-fidelity.
- **Retention/product:** the dead post-season stats + cross-season history (ENDGAME-9) and the invisible legend (ENDGAME-8) overlap the product-gaps lane.
