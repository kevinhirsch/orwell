# Moonshot Round 2 — divergent ideation on mined intelligence

**Date:** 2026-07-21 · **Inputs:** 5 mining digests (v1 transcript magic, longitudinal owner want-map, churn forensics, built-but-unfelt systems, dormant capabilities) → 7 divergent expert personas → 3 independent rating lenses. **Nothing dropped:** every rated idea appears below with all three scores; duplicates are merged under a keeper with credit and their residual deltas preserved. The owner holds final cut.

---

## 1) The intelligence report

The strongest non-obvious findings from the mining passes, each with its evidence. These are the raw material the ideas are built from — worth reading even where no idea was minted.

### 1.1 The lost magic of v1 (transcript archaeology)

- **The interstitial "producer read" was the beloved voice, not the NPC dialogue.** After every scene, v1 broke into a second-person accounting of the information exchange itself — "You got almost nothing concrete from him and he got a read on your strategy" (`bb-day-2.md:148`), "They're all letting you hold the grenade while they point at the pin" (`:722`). The rebuild hands the model facts to voice but has no concept of a post-scene exchange-accounting beat. This taught the player to *read the game*.
- **Negative space was a first-class signal.** "Marcus hasn't come upstairs yet. That's worth noting." (`:502-504`); NPCs weaponized absence independently (`:2332-2344`); the narrator kept a "people you haven't connected with yet" stock-take before decisions (`:2098-2116`). The rebuild's presence stores (0049/0076) hold the ground truth for this and compute nothing from it.
- **Knowledge-provenance as a detectable tell, in both directions.** An NPC quoting the player's private word back ("How'd the recon go?" — "He just used your word", `:2484-2489`) and an NPC knowing something she shouldn't casually know (`:722-728`). The rebuild built the *defensive* half (knowledge-scoped voicing, overhear gates); the *offensive* half — provenance deliberately leaking through dialogue so the player can triangulate who talks to whom — was never built.
- **Choreographed consensus** — one message, many voices, deliberately unattributable ("that's not consensus. That's choreography… Choreography feels smooth. Too smooth", `:1412-1416`) — was the Week-1 drama engine and is not modeled by blocs (0043) or campaigns (0085).
- **Comps lost their one strategic decision.** v1 supported targeted soft-throws and conditional endurance drops ("I'll drop when I feel safe enough to"); the rebuild's intent is a closed 3-way enum, declared once, with post-round-1 beats deliberately inert.
- **Other lost set pieces:** the strategy-consistency confirm before a self-contradictory vote slip (`bb-day-12.md:1116-1130`); the full-room ceremony reaction pan with delayed information bombs (`bb-day-3.md:1015-1089`); the proxemics grammar (seat choice, threshold behavior, exit style as relationship channel); the player-owned dossier of reads-as-reads (`bb-day-2.md:3195`); and the DR voice that mirrored the player's *own authored self-knowledge* back at them (`:1220-1247`) — which the rebuild's DR is fed nothing to reproduce.

### 1.2 The owner want-map (longitudinal, Mar–Jul 2026)

- **"Narration invents outcomes" is THE recurring complaint** — re-erupted at a new layer each time it was fixed (v1 prompt layer → engine determinism → narration-grounding: BL-001/BL-002 fabricated HOH win, both P0 OPEN). It is the invariant the owner buys the product for.
- **The fail-loud mandate has been issued three times in five weeks** (2026-06-23, ruling #1599, T9) and the 07-16 playthrough still found a judge that "ran dark the entire session" and a 780s hang logged `ok:true`. This is a product surface waiting to be designed, not a bug class.
- **"The house should act without me" is a fixed-then-re-complained loop** from v1 Day 4 through BL-010 (dormant off-screen society, zero house→player information flow, P1 OPEN). The gap is *delivery*, not simulation.
- **An implicit pacing spec exists but was never written:** dramatic beats get full ceremony, mechanical beats compress toward instant (#420, BL-029, D10 "<10s finalize-to-house"; PO-1 eviction-night length still the lone PENDING owner decision since 06-20).
- **"Never author the player" is a five-times-recrossed red line** (name-hash appearance, E34 goodbyes, B4 Houseguest's Choice, BL-054, FLOW-13/CNT-6 composer prefill) that deserves elevation to a testable rule the way the Vault Wall was.
- **The owner's evidence standard is live play, not gates** — the unsealed-playthrough ritual is the real QA process; the golden-path fixture apparatus was owner-decommissioned as "perpetually stale" (−9,984 lines). Decisions come fast on live demos and stall indefinitely on prose memos (the 07-21 session cleared ten queued decisions at once).
- **The reversibility doctrine (T9):** "demoted, never deleted… nothing that hardens the game is thrown away." Proposals shaped as *primary + designated fallback + rollback condition* get ratified same-session; deletions get refused. Every idea below is framed accordingly.

### 1.3 Churn forensics (2,718 commits / 7 weeks, 47% fix-commits)

- The **deterministic core is empirically vindicated**: `liveSeason.ts`/`orchestrator.ts` have the *lowest* fix ratios; 80%+ of fix energy clusters at the LLM boundary (belts, prompts, casting, streaming) and FE presentation. The leverage is extending "contract, not correction" outward across the LLM seam.
- **Belts-on-belts is an unbounded fix generator** (128 "belt" commits; `agent_loop.py` at 70% fix ratio) — the one structural fix that stuck replaced a belt with a contract (engine-signaled `requiredLever`).
- **The casting→premiere seam is the most re-broken player-facing flow** (299 commits, incl. a Vault Wall P0) and just lost its only end-to-end gate with the golden-path decommission.
- **A-S3** (stale-409 can drop a scene's only consequence fold) has been "fixed" three times; the fold path needs an invariant property test, not more retry logic.
- *(A CLAUDE.md doc-reconcile flagged during mining was already completed — CLAUDE.md now records 0108 as decommissioned.)*

### 1.4 Built-but-unfelt & dormant (the highest-leverage finding class)

A remarkable pattern: **at least nine fully-built, tested systems produce no sentence the player ever reads.**

| System | State | Evidence |
|---|---|---|
| AI Showrunner (0101/#1401) | Built, dark — absent from deploy opt-in defaults | `GameSessionAdapter.ts:619`; no line in `orwell-env-defaults.sh` |
| Secret-barter economy (0099 hidden half) | Built, dark | same flag-gap |
| Gossip drift (#1397) | Built, dark | `gossip.ts:180-358`; no `ORWELL_GOSSIP_DRIFT` in defaults |
| Season notoriety voice (0104) | `notorietySummary()` has **zero consumers** — legend clauses authored "for the narrator to voice" are dead code | `notoriety.ts:55-56`, `GameSessionAdapter.ts:7163` |
| Jury house (0100) | Whole second society compresses to one hidden scalar; the "bearing" the module doc promises was never built | `juryHouse.ts:11-33` vs. `momentPrompts.ts:955-969` |
| Vote deduction (0110) | Wrong-blame dramatic irony is engine-terminal — never voiced, hinted, or unsealed | `voteDeduction.ts:6-18` |
| Relationship trajectories (0087) | Double-filtered: only re-weights off-screen scene selection; no player-facing surface reflects an arc | `trajectory.ts:5-13` |
| Campaigns (0085) | Richest per-NPC strategic state exits as one scalar + one heat word | `campaigns.ts:34-38`, `GameSessionAdapter.ts:9183-9190` |
| Zeitgeist (0062) | FE writes the snapshot; `worldSnapshotView` has zero readers | `registry.ts:72`; grep empty |

Plus two structural throttles: the **secrets budget math** (season cap 6 surfacings × 0.4 player probability ≈ 2–3 reveals per season from the entire authored hidden store — `threadConstants.ts`), and the **retrospective concentration risk** (confessionals, pull-quote reel, showrunner notes all pay off *only* in `buildVaultUnseal`; an abandoned season experiences none of it).

---

## 2) The full idea slate

28 ideas, grouped by **theme**. Scoring lenses: **L1** evidence-verification & novelty · **L2** mandate/Vault/feasibility · **L3** BB-show authenticity. ★ = consensus-exceptional. Merged duplicates are listed under their keeper with credit; their scores are preserved.

---

### Theme A — The watched house (surveillance, absence, self-surveillance)

#### A1. Fifteen Pairs of Eyes (absence-facts as surveillance) — **KEEPER, merged with The Attention Ledger**
*Expert: Panopticon dread designer (merged idea from: Mechanism-design economist)*

- **Pitch:** Your movements are data. Skip the kitchen all morning, avoid the HOH room while working the rest of the house, and someone clocked it: "Marcus noticed you never came down." Fifteen people are the cameras; the only counterplay is watching them back.
- **Spark evidence:** `bb-day-2.md:502-504` + `:2332-2344` (verbatim v1 beats); `presence.ts:276-301` verified — per-NPC room occupancy with adjacency-constrained movement already exists as ground truth.
- **Mechanism:** A pure derivation pass over the existing presence + event stores at tick time computes socially-loaded NON-events (absence from a high-occupancy room a full phase; zero-contact streaks; visible movement traces). Vault-free by construction — any co-present houseguest could legitimately have observed these — so they enter the observer's knowledge layer as ordinary witnessed facts, feeding npcVoice/narrator context. A seeded, temperature-gated roll decides *who* noticed (never everyone — the paranoia is not knowing who). Merged from Attention Ledger: a bounded, seeded avoidance-inference fold into hidden edges (sustained post-nomination avoidance reads as guilt/distance, same `relationshipConstants` bounds) plus the diegetic pre-decision coverage stock-take.
- **Cost:** M · **Scores:** 8 / 8 / 9 — **avg 8.3** (one exceptional)
- **Flags:** Merge ratified by all three lenses (identical spark evidence). L3: "peak BB grammar."

> **Merged: The Attention Ledger — allocation as an unfakeable signal** (Mechanism-design economist). Scores: 5 / 7 / 7 — avg 6.3. All lenses flagged it as the same absence-derivation over the same presence store with the same v1 spark; its residuals (the avoidance fold; time-as-rival-good framing — spending the afternoon with one ally *is* forgoing everyone else) are folded into A1.

#### A2. The Booth Has Receipts (your own permanent record, read back)
*Expert: Panopticon dread designer*

- **Pitch:** The Diary Room occasionally becomes a screening room: the producer voice quotes YOUR tape back — "Week 1, you promised final-two to three different people. Footage doesn't forget." Never judges, never leaks; just proves the archive is complete. Doubles as the v1-style anti-tragedy mirror before a self-contradictory decision.
- **Spark evidence:** `bb-day-2.md:1220-1247` (v1's DR mirroring the player's authored self-knowledge); mandate #4 (the player's lies structurally never expire); the mined finding that the rebuild's DR (0040) is fed nothing about the player.
- **Mechanism:** Utility-LLM composition (the `orwell_cast_authoring.py` fail-soft pattern) over ONLY the player's own record — witnessed events, authored deals, decisions, DR statements — computing "receipt" facts (divergent commitments, stated target vs. actual vote), delivered exclusively on the player-level OOC channel which by spec has NO pathway to any NPC. Zero Vault read, zero steering; the player can always proceed.
- **Cost:** M · **Scores:** 7 / 8 / 9 — **avg 8.0** (one exceptional)
- **Flags:** None. L3: "cleanest dread idea here"; L2: mandate-clean by construction. Also the natural home for the v1 strategy-consistency confirm (§1.1).

---

### Theme B — Words that travel (gossip, provenance, distortion)

#### B1. Telephone-Game Payoffs (gossip drift's distortion delta AS the joke)
*Expert: Comedy & character writer*

- **Pitch:** You said you liked the memory-foam beds; three retellings later an NPC solemnly warns you that "everyone knows" you've promised to throw comps for the HOH room. Only you can see the delta, because you know the original — and popping the balloon with the built confront lever is the punchline you get to deliver.
- **Spark evidence:** Verified: `GOSSIP_DRIFT` machinery fully built (`gossip.ts:180-358`), orchestrator hook live, and `ORWELL_GOSSIP_DRIFT` absent from `deploy/orwell-env-defaults.sh` — built, wired, dark on every box.
- **Mechanism:** (1) One-line flag light-up. (2) A Vault-free "provenance texture" word on surfacing facts when hops ≥ 2 ("third-hand," "everyone's saying") — chain *length* only, never members. (3) Prompt guidance: let the absurd version land deadpan; the player's memory supplies the joke. The 0094 `confront(npcId, factId)` lever traces one hop upstream per its existing spec — every gag is a playable whodunit.
- **Cost:** S · **Scores:** 8 / 8 / 8 — **avg 8.0**
- **Flags:** None. L2: "highest leverage-per-line in the batch."

#### B2. The Walls Repeat You (verbatim haunting) — **KEEPER, merged with Circle Receipts**
*Expert: Panopticon dread designer (merged idea from: Rival-format thief)*

- **Pitch:** You coin a private word with one ally — and two days later a different houseguest uses it to your face. Cold water down the spine: you were overheard, or your ally talks. Tracing how your phrase traveled becomes a winnable deduction about who is connected to whom.
- **Spark evidence:** `bb-day-2.md:2484-2489` (the "recon" beat — the single most electric moment in the v1 corpus); verified: the 0077 adjacency-overhear gate is built in both directions (`presence.ts:370-412`) and gossip records already carry source chains, hops, and per-hop distortion (`gossip.ts:293, :368-372`).
- **Mechanism:** A temperature-gated `verbatim` payload on gossip records: the existing 0055 auto-record extraction also captures one distinctive player phrase (the player's OWN words — Vault-free); with small seeded probability it rides an edge undistorted (skipping `distort()` for that field only) and resurfaces in a chain-holder's npcVoice context as a phrase-to-voice. The reveal travels only legitimate pathways, so the Wall holds; provenance is engine-recorded, so confrontation resolves against real chains.
- **Cost:** M (keeper) / S residual · **Scores:** 8 / 7 / 8 — **avg 7.7**
- **Flags:** Merge ratified by all lenses (identical spark quote and mechanism).

> **Merged: Circle Receipts — verbatim carriage on the gossip graph** (Rival-format thief). Scores: 5 / 7 / 8 — avg 6.7. Same idea; its skip-distort-for-the-verbatim-field implementation detail is adopted in B2.

#### B3. The Barium Meal — leak forensics on the knowledge graph
*Expert: Mechanism-design economist*

- **Pitch:** Selling a secret finally costs what it should: exposure. If only two people knew and it gets back to the subject, the suspect list is two names long. And the player can run the counterintelligence classic — tell slightly different versions to different people and wait to see which one walks back in the door.
- **Spark evidence:** Verified: the 0099 barter tick is built and dark (`secretBarterConstants.ts:14-18`); `leverage.ts:2-14` prices severity/vulnerability but not scarcity or attribution risk; gossip drift already produces per-retelling variants.
- **Mechanism:** (1) Scarcity pricing: `tradeValue` gains a knower-set term — fewer holders ⇒ higher value; information deterministically depreciates as it spreads. (2) Trace-back: when a secret's chain terminates at its SUBJECT, run a seeded leak-attribution deduction (the 0110 pattern — suspicion ranking + ambiguity jitter on a dedicated sub-rng) over the knower set at leak time; the possibly-wrong blame folds a bounded grudge and can itself circulate. (3) The canary trap falls out free from recorded per-recipient variants + the confront lever. No Vault content crosses; the player feels it as who suddenly goes cold on them.
- **Cost:** L · **Scores:** 7 / 8 / 8 — **avg 7.7**
- **Flags:** Depends on lighting `ORWELL_SECRET_BARTER` first — sequence after B1's flag flip. The batch's heaviest lift.

#### B4. The House Is Buzzing (you are being narrated by others)
*Expert: Panopticon dread designer*

- **Pitch:** Once a week you catch a fragment of your own myth — "people are saying you were behind the Marcus vote" — sourced, distorted, possibly false. Between fragments, one truthful ambient line keyed to real hidden-activity counts ("the house was busy while you slept — four conversations you weren't in") keeps the invisible machine's hum audible.
- **Spark evidence:** Verified: `legendTick` is quadruple-throttled (`GameSessionAdapter.ts:7641-7655` — flag-gated, seedProb-rare, season-capped, folds no edge) and `curiosityNeedle.ts:7-10` admits the dramatic-irony apparatus "never so much as WHISPERS that any of it exists" outside Day 1.
- **Mechanism:** (1) Let minted legends enter normal 0038 diffusion so a chain can terminate at the player — arriving exactly as the knowledge model specifies (distorted belief + source + confidence), confrontable via 0094. (2) Generalize the curiosity-needle pattern into a weekly one-line "buzz" fact in recap/whereabouts context, keyed to REAL engine counts, naming nothing sealed. Seeded gates keep both rare; no outcome touched.
- **Cost:** M · **Scores:** 7 / 7 / 8 — **avg 7.3**
- **Flags:** L2 notes mild Vault-adjacency in advertising hidden-scene *counts* (truthful, generic — kept fact-based). Directly answers the owner's standing BL-010 complaint.

---

### Theme C — Comedy & ensemble texture (entirely unclaimed territory — round 1 had zero humor)

#### C1. ★ The Wipeout Reel (character-expressive failure beats on the pre-rolled comp trajectory) — **CONSENSUS EXCEPTIONAL**
*Expert: Comedy & character writer*

- **Pitch:** Eliminations stop being names leaving a list: the meathead comes out too hot and never notices his wrong puzzle pieces; the schemer steps off the wall the second she's mathematically safe. HOW each person loses is stable, so the fails become anticipated bits — "here he goes again."
- **Spark evidence:** `bb-day-4-5.md:1043` (the exact v1 beat, verbatim); verified: the rebuild's per-drop `comp-elimination` beats are deliberately inert presentation, "bare eliminations for the narrator to improvise," with `stagedTrajectoryNeutral.test.ts` as the byte-identity guard.
- **Mechanism:** After the single up-front `resolveCompetition` roll fixes crown and drop order, a separate seeded pass in `competitionLibrary.ts` (0042) attaches a `failureStyle` fact to each pre-rolled drop (archetype × current mood-word × comp format), drawn from a **forked rng stream after resolution** — perturbing nothing downstream, outcomes byte-identical. The narrator gets each drop as a fact-to-voice. Failure styles are weighted per-CHARACTER so they recur as a comic signature.
- **Cost:** S · **Scores:** 9 / 9 / 9 — **avg 9.0** — the only unanimous exceptional
- **Flags:** None. All three lenses: cheapest highest-yield idea in the batch; zero mandate risk; the sanctioned staged-presentation pattern applied exactly as designed.

#### C2. Odd-Couple B-Plots (light the dormant trajectory engine as petty-feud sitcom)
*Expert: Comedy & character writer*

- **Pitch:** Two NPCs whose hidden relationship is souring AND whom the presence system keeps trapping in the same room become the season's odd couple — an escalating petty feud over dishes, snoring, a protein shaker, staged as witnessed public scenes the player tracks like a B-plot. You never see a number; you see two adults holding a house meeting about a shaker.
- **Spark evidence:** `trajectory.ts:5-13` verified verbatim — souring arcs are double-filtered and never player-perceivable; owner want-map BL-010 (dormant society, P1 OPEN).
- **Mechanism:** Each tick, intersect souring-phase pairs (0087) with high forced co-presence (0049/0066); the top seeded pair becomes a FrictionPair with a persisted escalation rung (0..4). `houseEvents.ts` gains a petty-dispute event family (seeded trivial-object table), staged PUBLIC with witness set = the room — the player witnesses rungs or hears them via normal gossip; each rung is a recorded event folding its own bounded seeded impact. The hidden edge causes the fight; the fight never states the edge.
- **Cost:** M · **Scores:** 8 / 8 / 9 — **avg 8.3** (one exceptional)
- **Flags:** None. NPC↔NPC arcs are absent from the round-1 portfolio entirely.

#### C3. The Reaction Pan Mandate (ceremonies where the whole cast exists at once)
*Expert: Comedy & character writer*

- **Pitch:** After your nomination speech, the camera pans the room — one beat per houseguest, each perfectly in character: the oversharer already crying, the literalist asking a procedural question, and "Jasmine gives you nothing, which from Jasmine means everything is fine." The biggest laughs are the non-reactions.
- **Spark evidence:** `bb-day-3.md:1015-1037` (the v1 pan — "the moment the whole cast exists at once"); `bb-day-2.md:1163-1169` (register-stable delivery: the same line landing as threat from one NPC, intimacy from another).
- **Mechanism:** At ceremony beats (closed-set, engine-committed before narration), emit a Vault-safe `reactionPan` block into the moment prompt: per witness, one seeded {register, valenceWord} pair. Register is a new byte-stable CHARACTER field (deadpan / oversharer / literalist / catastrophizer / performer, seeded at genesis); valenceWord derives from existing mood-word + relationshipLabel plumbing. Rides the always-on prompt (the I6 pattern) — NOT an under-callable tool. Pan lines are part of the recorded ceremony event (Bit-Ledger-eligible); the register field can also inflect v1-style proxemics staging words.
- **Cost:** M · **Scores:** 8 / 7 / 9 — **avg 8.0** (one exceptional)
- **Flags:** L2: a systematic per-NPC valence word at *every* ceremony is a fairly regular hidden-edge readout — keep it coarse (see owner question Q4).

#### C4. The Running Bit Ledger (house gags as persisted, appreciating assets)
*Expert: Comedy & character writer*

- **Pitch:** The first time an NPC quotes your weird word back it's a chill; the fifth time the whole house says it, it's the season's catchphrase. Running gags get FUNNIER over the season because the engine remembers every callback and who made it. Comedy compounds like interest.
- **Spark evidence:** `bb-day-2.md:2484-2489` + mandate #4 (persisted detail must accumulate and deepen — the exact opposite of v1's thinning); gossip source-chain substrate verified built.
- **Mechanism:** New pure module `houseBits.ts`: when the EventStore shows a distinctive token recurring across ≥2 recorded events, a seeded temperature roll promotes it to a Bit record {token, originEvent, witnesses, callbackCount, lastInvokedBy} — mintable only from player-known or fully-public events, so Vault-free. Bits ride the always-on context block; off-screen ticks give NPCs seeded callback chances (recorded events → bounded affinity folds — shared laughter is real glue). `callbackCount` is monotonic; 0048 unseals the bit's full biography. Bits can retire diegetically but never delete.
- **Cost:** M · **Scores:** 8 / 7 / 9 — **avg 8.0** (one exceptional)
- **Flags:** Two lenses note the minting detection is fuzzier than pitched — it leans on the 0055 utility-LLM seam, not pure token matching. The only proposal that makes mandate #4 *felt* rather than tested.
- **Cross-feeds:** C1 wipeouts, C2 feuds, and C5 rituals all generate Bit-eligible material.

#### C5. Cabin-Fever Ceremonies (lull-triggered absurd rituals, the killjoy included)
*Expert: Comedy & character writer*

- **Pitch:** Week 3, nothing strategic is happening — and suddenly the house is holding a full funeral for the broken toaster, with a eulogy, a procession, and one NPC refusing to participate on principle. Boredom becomes content; the refusal is funnier than the ritual.
- **Spark evidence:** The owner's oldest pacing complaint (v1 Day 2 "might get boring"; "Every single day should have something. Right?"); `houseEvents.ts` verified as the built seeded house-event mint.
- **Mechanism:** A "ritual" event family eligible ONLY when engine-side tension proxies are low (no pending decision, no fresh nomination, low recent salience) — rituals replace *silence*, never a comp or ceremony, so no player input modulates any outcome distribution. Template drawn seeded (mock award show, house court over a food crime, object funeral, invented sport); casting is the comedy engine — instigator = highest-fit CHARACTER facet, refuser = seeded worst-fit. Participation scenes are recorded public events folding real bounded affinity; recurring rituals feed the Bit Ledger. Lingering-is-play holds: attend, mock, or skip.
- **Cost:** M · **Scores:** 7 / 8 / 8 — **avg 7.7**
- **Flags:** L2: keep the FE-lull and engine-lull signals from tangling. Nothing in round 1 addresses the lull state at all.

#### C6. Superlatives Night (Circle-style ratings as a performed, deceptive house ritual)
*Expert: Rival-format thief*

- **Pitch:** A seeded party-game night where each houseguest must publicly name "most trustworthy" and "biggest threat." Some tell the truth; some perform. The player gets a complete, legible public map of the house they KNOW is partly theater — and the fun is texture analysis: whose answer was too smooth, who conspicuously didn't name you.
- **Spark evidence:** `houseEvents.ts` header (E58) verified as the intended slot; v1's choreography-detection play (`bb-day-2.md:1412-1416` — "Choreography feels smooth. Too smooth").
- **Mechanism:** A houseEvents entry where the engine derives each NPC's PUBLIC answer from their hidden edge plus a seeded, archetype-weighted deception roll (some mask, some blurt), recorded as ONE witnessed event — answers become player knowledge and later gossip fuel when behavior contradicts them. The player answers too, never prefilled (the "never author the player" red line). Zero outcome effect.
- **Cost:** M · **Scores:** 7 / 7 / 8 — **avg 7.3**
- **Flags:** L2: moderate calibration work to keep answers from becoming a periodic edge dump.

---

### Theme D — The vote economy (post-vote settlement, deal collateral, information markets)

#### D1. ★ Ballot Arithmetic — the vote-claim clearing house — **NEAR-CONSENSUS EXCEPTIONAL**
*Expert: Mechanism-design economist*

- **Pitch:** After every eviction, everyone claims how they voted — and the public tally is a hard budget constraint on lies. If four people swear "I kept her" but she only got two keep-votes, at least two of them are lying, and the house starts doing the math. The player can over-claim loyalty too — knowing the pigeonhole principle is watching.
- **Spark evidence:** `voteDeduction.ts:6-18` verified: counts are public, attribution sealed, and the built wrong-deduction irony is engine-terminal — "the fun part is never voiced."
- **Mechanism:** A post-eviction claims ledger: each NPC (Vault-side, reading their true ballot + edges) decides to claim truthfully or lie; each claim is minted as an ordinary knowledge-layer fact that diffuses via 0038. Player claims enter through `recordInteraction` like any speech. The engine runs a deterministic per-audience solvency check — claims-known-to-me vs. the public tally, pure arithmetic on knowledge facts + the public count, **no Vault read needed for the contradiction**. On over-claim, mint a "the numbers don't add up" fact scoped to whoever holds the contradicting set, plus a bounded seeded suspicion fold across over-claiming candidates (reusing 0110's ranking math). Sealed attribution never unseals — only speech and arithmetic circulate, so E12 holds.
- **Cost:** M · **Scores:** 9 / 8 / 9 — **avg 8.7** (two exceptionals)
- **Flags:** L2: M is optimistic — NPC claim policy + per-audience solvency is real engine work. All lenses: genuinely new mechanism class; the round-1 pledge portfolio is entirely PRE-vote. L3: "the votes don't add up" hunts are among the most iconic recurring BB dramas.

#### D2. Publicity-Priced Promises — witness-set collateral on deals
*Expert: Mechanism-design economist*

- **Pitch:** Where you make a promise matters as much as what you promise. A whispered final-two in an empty HOH room is cheap and deniable; the same deal sworn with three houseguests present posts your reputation as bond — more credibility now, and a breach with three witnesses to carry it through the house. The player starts staging promises like a lawyer choosing a venue.
- **Spark evidence:** `deals.ts:81-91` verified — breach visibility is a property of the *breaking* action; nothing prices the *formation's* audience. The collateral instrument (per-event witness sets) already exists on every recorded event.
- **Mechanism:** Extend the Deal record with the formation witness set (presence supplies ground truth). Two bounded seeded effects inside existing fold paths: (1) at formation, the counterpart's trust fold scales with audience size (a public promise is a costlier signal — same bounds, engine-owned magnitude per ADR 0005); (2) at breach, `applyBreak` seeds the breach fact into each formation-witness's knowledge with normal diffusion — the collateral forfeited equals the audience the promiser chose. The player lever is purely diegetic: pick the room and the company before speaking.
- **Cost:** M · **Scores:** 8 / 8 / 8 — **avg 8.0**
- **Flags:** None. Clean spatial complement to built 0109 (duration) and 0121 (streak) — the third, unpriced term of the same contract.

#### D3. The Genius Back-Room (arm the secret-barter market + player seat)
*Expert: Rival-format thief*

- **Pitch:** The NPC secret-barter economy is built and dark on every deployed box. Light it, and add the player's chair: offer a houseguest something you legitimately know for something they know; they counter, refuse, or fleece you by soul motivation on a seeded roll.
- **Spark evidence:** Verified: `SECRET_BARTER` gate exists (`GameSessionAdapter.ts`), absent from deploy defaults.
- **Mechanism:** (1) Add `ORWELL_SECRET_BARTER=1` to defaults (one line, calibration-neutral). (2) A player `tradeInformation(npcId, offeredFactId)` lever: engine validates the player HOLDS the fact; NPC accept/counter is a seeded roll over soul motivation; a completed trade mints two traceable `surfaceInformationTo` pathway events; the received fact can itself be distorted (the NPC trades what they *believe*). Full five-place FE wiring + boundary test.
- **Cost:** L · **Scores:** 4 / 8 / 5 — **avg 5.7** — **highest-variance idea in the slate**
- **Flags:** **L1 found an evidence overclaim:** player-channel `tradeSecret`/`exposeSecret` levers ALREADY exist (`registry.ts:62-63`, plus `makeDeal` leverage) — "first player-side port" is false; the residual is the flag light-up plus fact-for-fact (vs. fact-for-concession) barter. **L3 flags an ADR 0003/0005 tension:** a formal trade counter mechanizes what the conversation already is — BB info trading happens in talk. Recommended residual: ship the flag flip (S), skip the new lever pending owner read.

---

### Theme E — Eviction night & the jury (the unseal economy)

#### E1. The Exit Interview (eviction-night partial unseal — the mid-season Vault dividend) — **KEEPER of the exit-unseal trio, merged with Ponderosa + The Exit Interview Airs**
*Expert: Live-ops & replayability designer (merged ideas from: Rival-format thief, Panopticon dread designer)*

- **Pitch:** The moment a houseguest walks out, their season is over — and the show hands you their exit package: their diary-room voice about YOU, how they really felt about the alliance, and who they *believe* voted them out (possibly dead wrong — possibly you). Eight times a season the Vault pays a small, spoiler-safe dividend instead of hoarding everything for a finale most abandoned seasons never reach.
- **Spark evidence:** Built-not-felt digest: three whole engines (0040/0089 confessionals, #1396 pull-quote reel, showrunner notes) pay off exclusively inside `buildVaultUnseal`; `voteDeduction.ts:6-18` verified — the wrong-blame irony is never voiced anywhere.
- **Mechanism:** A new sanctioned, engine-scoped unseal tier `buildExitPackage(evicteeId)`, runnable only at the eviction beat, filtered by a **structural** spoiler rule (adopting Ponderosa's set-arithmetic formulation): include only Vault content where the speaker is the evictee AND every named subject is the player, an already-evicted houseguest, or a fact already in the player's knowledge layer. Anything touching a still-active houseguest's hidden state stays sealed until 0048. Contents: the evictee's confessional pull-quotes about the player, their 0110 deduction rendered as a belief ("she walked out certain it was you"), one legend clause. Same architectural pattern as `producerVault` — a deliberate, quarantined, test-gated door (`tests/unit/exitPackage.test.ts` proves no active-player Vault data crosses). The revealed wrong blame feeds live jury management — the player now *knows* a juror falsely blames them.
- **Cost:** M · **Scores:** 8 / 5 / 7 — **avg 6.7**
- **Flags:** **⚠ OWNER-RULING GATE.** All three lenses agree this collides with the hard do-not "never extend Vault exposure beyond producerVault" — a new mid-season unseal door requires an explicit owner ruling (Q1 below). L2's ruling: rate the trio as ONE owner question, not three features. Also softens 0048's finale payoff (Q6). Best-specified of the three; framed per T9 as flag-gated (`ORWELL_EXIT_PACKAGE`) with off ⇒ byte-identical.

> **Merged: Ponderosa — the eviction-night Exit Package** (Rival-format thief). Scores: 5 / 5 / 7 — avg 5.7. Same mechanic; its clean set-arithmetic filter formulation is adopted in E1. L2 noted its stated filter actually excluded the player-content its own pitch promised — corrected in the keeper.
>
> **Merged: The Exit Interview Airs — eviction-night broadcast unseal** (Panopticon dread designer). Scores: 6 / 4 / 5 — avg 5.0. Weakest of the trio (L3: houseguests never see broadcast content — a format bend; L2: pumps sealed confessional material into the living house's knowledge layer). Its one distinct residual — letting the evictee's wrong-blame *belief* enter the HOUSE's knowledge so it diffuses as gossip — is preserved as an optional sub-decision on E1.

#### E2. Traitors' Fury (jury-house misdirected blame + the Bearing Reveal) — **KEEPER, merged with Bearing at the Vote**
*Expert: Rival-format thief (merged idea from: Live-ops & replayability designer)*

- **Pitch:** A juror who wrongly deduced you flipped on them spends weeks nursing it in the jury house, poisoning the room — and at the finale you SEE it: each juror walks in wearing a bearing (cold, warm, burning, settled), and their question carries their possibly-wrong belief. You know you didn't flip. They don't. Dramatic irony you can feel, at the exact sanctioned moment.
- **Spark evidence:** Both module contracts verified verbatim: `voteDeduction.ts` (irony engine-terminal) and `juryHouse.ts:11-33` — which *itself promises* the player will feel the second society "through a juror's (hidden-state-driven) bearing" — a promise the `jury-finale` moment fragment (`momentPrompts.ts:955-969`) never delivers. A broken in-code promise.
- **Mechanism:** Three calibration-safe additions: (1) route each 0110 deduction's CONCLUSION (culprit id only, no numbers) into the deducer-juror's knowledge layer so jury-house grievance diffusion circulates named — possibly wrong — blame as rumor *content* (fold magnitudes unchanged; the seeded juryReach spine stays byte-identical); (2) a per-juror Vault-safe `bearing` word on the finale view, threshold-derived from the saturated grudge map — the exact carriage-word pattern 0088 ships; (3) each juror's finale question flavored with their held belief as a fact-to-voice. Merged from Bearing at the Vote: the (engine-committed) vote-reveal ORDER presented grouped for drama — presentation over one committed result, with a `stagedTrajectoryNeutral`-style guard; and the 0048 loop-closure ("why Marcus was burning" unseals with the jury-house scenes).
- **Cost:** S · **Scores:** 8 / 8 / 8 — **avg 8.0**
- **Flags:** Merge ratified by all lenses. The smallest possible ship of "the hidden layer is felt at the ending" — one word per juror redeeming a promise the code makes and breaks.

> **Merged: Bearing at the Vote — jury arcs as finale choreography** (Live-ops designer). Scores: 6 / 8 / 9 — avg 7.7, one exceptional (L3: "juror entrance demeanor is iconic finale television"). Its S-cost bearing core and reveal-order grouping are absorbed into E2.

#### E3. The Mole Quiz — a retrospective-scored Reads Test
*Expert: Rival-format thief*

- **Pitch:** You are silently scored all season on how well you've deduced the hidden truth. Each week the DR invites you to log your reads ("who's really with whom, who's coming for you"); nothing is confirmed in play; at the retrospective you get an Accuracy Reel — every prediction replayed against what was actually true at that moment. Devastating or vindicating.
- **Spark evidence:** The retrospective-concentration finding (`pullQuoteReel.ts:12-15`) + v1's beloved dossier of reads-as-reads (`bb-day-2.md:3195`).
- **Mechanism:** A player-level OOC DR lever `logRead({subject, claim})` records beliefs into the EventStore with event-time beatSeq — zero Vault read, zero NPC pathway (DR canon). Scoring runs ONLY inside `buildVaultUnseal`, checking each read against engine state true at its beatSeq. FE five-place wiring + a retrospective section. No outcome touched.
- **Cost:** M · **Scores:** 8 / 6 / 7 — **avg 7.0**
- **Flags:** L2 feasibility snags undersold: grading open-set player claims against never-stored organic relationship labels brushes ADR 0002/0005 (normalization), and "state true at that beatSeq" needs historical hidden-state reconstruction the stores don't directly keep. Also concentrates its payoff at the finale — the exact risk this batch elsewhere argues against. Natural pairing: it is the *scoring* half of the player dossier (§1.1); the dossier artifact itself remains un-pitched this round and is noted in §3.

---

### Theme F — Cross-season & retention (seasons-as-levels, finally felt)

#### F1. Your Legend Precedes You (light the dead notoriety wire) — **KEEPER, merged with Your Tape Precedes You**
*Expert: Live-ops & replayability designer (merged idea from: Panopticon dread designer)*

- **Pitch:** Game 2 opens with the house already whispering about you: "has a reputation for blindsiding their own allies." NPCs you've never met treat you like a known quantity — some star-struck, some pre-armed. The player feels that season 1 happened and mattered, in the first five minutes of season 2 — exactly where retention is won or lost.
- **Spark evidence:** Verified three ways: `notoriety.ts:55-56` authors Vault-free legend clauses "for the narrator to voice as a returning-cast callback"; `notorietySummary()` (`GameSessionAdapter.ts:7163`) has **zero consumers**; corroborated by ENDGAME-8 ("0104 notoriety half-dead… never reaches the narrator"). The hidden edge-bias half is already live — this voices the open half minted for exactly this purpose.
- **Mechanism:** (1) Expose `notorietySummary()` on the GameSession port and append its clauses to `renderGameContext` as a "RETURNING CAST: the house has heard…" facts-to-voice block on premiere/early-social moments — **always-on context, not an under-callable tool** (the I6 lesson). (2) A mandated premiere "reception pan": each NPC's move-in greeting inflected by the already-built hidden bias (they already feel it; the narrator now voices consistent behavior). (3) Clauses derive from committed prior-season events — engine truth, chat-delivered, zero new state.
- **Cost:** S · **Scores:** 8 / 8 / 8 — **avg 8.0**
- **Flags:** Merge ratified (same dead wire). Cheapest real retention win in the repo.

> **Merged: Your Tape Precedes You** (Panopticon dread designer). Scores: 5 / 8 / 8 — avg 7.0. Identical fix; the keeper's variant is more complete (always-on delivery + reception pan + audit citations).

#### F2. Cold Cases (player-elected sealed mysteries that carry into the next season)
*Expert: Live-ops & replayability designer*

- **Pitch:** At the retrospective: "3 secrets in this house never surfaced. Unseal them now — or leave them buried." Anything left sealed rides into your next season as a cold case: a returning thread, a rumor the new cast arrives carrying, a mystery with a season of real history behind it. The shareable moment is choosing NOT to know.
- **Spark evidence:** `threadConstants.ts:25-35` verified — the season yields ~2–3 player reveals from the entire authored secret store; pre-tuning, "a given rich secret [was] <4% likely to EVER reach the player." The mining digest stopped at instrumentation; this is the play loop built on the waste.
- **Mechanism:** `buildVaultUnseal` already knows which threads never surfaced; add a per-thread choice — reveal (current behavior) or seal as cold case. Sealed threads are excluded from the unseal payload (**Vault→Vault — the wall never opens**) and written into the 0104-designated small monotonic carry-over object. Next season's cast genesis samples carried cases as seed material for one NPC's hidden layer plus a dormant thread the 0060 scheduler surfaces under normal pathway rules. Non-degradation satisfied by construction. Flag-gated `ORWELL_COLD_CASES`, off ⇒ byte-identical.
- **Cost:** M · **Scores:** 7 / 7 / 8 — **avg 7.3**
- **Flags:** L2: moderate feasibility risk seeding castingIntake from carried threads across the season-reset hinge (the one sanctioned restart door). The most original hook in the batch — an inversion of the reveal economy.

#### F3. The Season Yearbook (the retrospective compiled into one keepable artifact)
*Expert: Live-ops & replayability designer*

- **Pitch:** When a season ends you get the Yearbook: the receipts page (every vote, who actually cast it, who each evictee wrongly blamed), the jury-house arc, the producers' bible, the pull-quote reel, and the season's frozen real-world time capsule. It's the object you show a friend; the shelf of them is why you play season 4.
- **Spark evidence:** Verified: `worldSnapshotView` built "so the narrator can weave it into the current moment" with zero FE consumers; 0110's misattribution never voiced; the owner's live-play ritual is "manual and lossy."
- **Mechanism:** An FE-side compiler strictly over the already-sanctioned `buildVaultUnseal` payload (**no new Vault doors**): a utility-LLM pass (the `orwell_zeitgeist.py` pattern) formats the unseal into a persisted per-user season document under `ORWELL_DATA_DIR`. Sections map 1:1 to built systems (0048 attribution + 0110 → "The Receipts"; juryHouse → "The Jury House"; showrunnerNotes → "The Production Bible"; pullQuoteReel → "In Their Own Words"; worldSnapshot → "The Time Capsule"). Delivered chat-forward as the finale's closing beat with a doc-fence render (ADR 0003). Past Yearbooks survive the season reset.
- **Cost:** M · **Scores:** 7 / 7 / 8 — **avg 7.3**
- **Flags:** Depends on E2's projections shipping for its best sections. A compiler, not a mechanic — retention-shaped value. Also the designable answer to the owner's "my game is one continuous object" want, extended across seasons (restarts become "New season"; old seasons become books, not deleted sessions).

#### F4. The Producers Remember (cross-season showrunner memory)
*Expert: Live-ops & replayability designer*

- **Pitch:** Season 2's invisible showrunner has read your season-1 file. You ignored comp drama but lived for betrayal arcs? The producers' notes now emphasize surfacing relationship threads. The game doesn't get easier or rigged — the CAMERA gets smarter about you, and the retrospective's production bible shows you exactly what it learned.
- **Spark evidence:** Verified: the showrunner (0101/#1401) is fully built and absent from deploy defaults — it runs nowhere; Phase-1 is documented calibration-neutral (emphasis routes which surfaced belief reaches the player, not outcomes).
- **Mechanism:** Step 1 (free): `ORWELL_SHOWRUNNER=1` in deploy defaults. Step 2: at season end, fold a Vault-FREE engagement profile — computed only from player-witnessed events — into the 0104 carry-over; next season's showrunner reads it to bias note composition and surfacing-slot routing only (never `resolveCompetition`, never vote math). The dangerous Phase-2 knob (`SHOWRUNNER_REWEIGHT`) stays OFF and is the named designated-fallback boundary. T9 framing: primary = memory-fed Phase-1; fallback = static Phase-1; rollback = any heavy-sims calibration drift.
- **Cost:** M · **Scores:** 6 / 6 / 7 — **avg 6.3**
- **Flags:** **⚠ Rulings-sensitive.** All lenses: engagement-derived surfacing bias walks right up to the owner's no-player-modulation line (surfacing isn't an outcome distribution, but this is the closest approach in the slate — Q5). Also sits adjacent to the round-1 editorial director; the longitudinal-memory delta is real but thin. Step 1 (the flag) is separable and uncontroversial.

---

### Slate summary table

| # | Idea (keeper bold where merged) | Theme | Cost | L1 | L2 | L3 | Avg | Gate/flag |
|---|---|---|---|---|---|---|---|---|
| C1 | ★ **The Wipeout Reel** | Comedy | S | 9 | 9 | 9 | **9.0** | — |
| D1 | ★ **Ballot Arithmetic** | Vote economy | M | 9 | 8 | 9 | **8.7** | cost may run L |
| A1 | **Fifteen Pairs of Eyes** (+ Attention Ledger) | Surveillance | M | 8 | 8 | 9 | 8.3 | — |
| C2 | Odd-Couple B-Plots | Comedy | M | 8 | 8 | 9 | 8.3 | — |
| A2 | The Booth Has Receipts | Surveillance | M | 7 | 8 | 9 | 8.0 | — |
| B1 | Telephone-Game Payoffs | Gossip | S | 8 | 8 | 8 | 8.0 | flag flip |
| C3 | The Reaction Pan Mandate | Comedy | M | 8 | 7 | 9 | 8.0 | coarseness dial (Q4) |
| C4 | The Running Bit Ledger | Comedy | M | 8 | 7 | 9 | 8.0 | utility-LLM minting |
| D2 | Publicity-Priced Promises | Vote economy | M | 8 | 8 | 8 | 8.0 | — |
| E2 | **Traitors' Fury** (+ Bearing at the Vote) | Jury | S | 8 | 8 | 8 | 8.0 | — |
| F1 | **Your Legend Precedes You** (+ Your Tape…) | Cross-season | S | 8 | 8 | 8 | 8.0 | — |
| B2 | **The Walls Repeat You** (+ Circle Receipts) | Gossip | M | 8 | 7 | 8 | 7.7 | — |
| B3 | The Barium Meal | Gossip | L | 7 | 8 | 8 | 7.7 | after B1/flag |
| C5 | Cabin-Fever Ceremonies | Comedy | M | 7 | 8 | 8 | 7.7 | — |
| B4 | The House Is Buzzing | Gossip | M | 7 | 7 | 8 | 7.3 | — |
| C6 | Superlatives Night | Comedy | M | 7 | 7 | 8 | 7.3 | — |
| F2 | Cold Cases | Cross-season | M | 7 | 7 | 8 | 7.3 | — |
| F3 | The Season Yearbook | Cross-season | M | 7 | 7 | 8 | 7.3 | after E2 |
| E3 | The Mole Quiz | Jury | M | 8 | 6 | 7 | 7.0 | ADR 0002 grading snag |
| E1 | **The Exit Interview** (+ Ponderosa + …Airs) | Jury | M | 8 | 5 | 7 | 6.7 | **⚠ Vault-door ruling (Q1)** |
| F4 | The Producers Remember | Cross-season | M | 6 | 6 | 7 | 6.3 | **⚠ modulation line (Q5)** |
| D3 | The Genius Back-Room | Vote economy | L | 4 | 8 | 5 | 5.7 | **⚠ evidence overclaim; ADR 0003 tension** |
| — | *Your Tape Precedes You (merged → F1)* | | S | 5 | 8 | 8 | 7.0 | duplicate |
| — | *Bearing at the Vote (merged → E2)* | | S | 6 | 8 | 9 | 7.7 | duplicate |
| — | *The Attention Ledger (merged → A1)* | | M | 5 | 7 | 7 | 6.3 | duplicate |
| — | *Circle Receipts (merged → B2)* | | S | 5 | 7 | 8 | 6.7 | duplicate |
| — | *Ponderosa (merged → E1)* | | M | 5 | 5 | 7 | 5.7 | duplicate |
| — | *The Exit Interview Airs (merged → E1)* | | M | 6 | 4 | 5 | 5.0 | duplicate |

---

## 3) Cross-cutting patterns

Independent convergences across miners, experts, and lenses:

1. **The biggest lever is projection, not simulation.** Four of five mining passes and over half the slate point at the same fact: the engine already simulates a rich hidden world (jury house, trajectories, campaigns, notoriety, vote deduction, drift, barter, showrunner) that exits as a scalar, a single word, or nothing. Round 2's best ideas are mostly *delivery architecture* — F1, E2, C2, B1 are light-ups of built-and-mute machinery. This is also the exact shape of the owner's standing BL-010 complaint: the gap is delivery, not machinery.
2. **Always-on context beats callable tools.** Three experts independently adopted the I6 roster-fingerprint lesson (the narrator reliably under-calls tools): the Reaction Pan, the notoriety block, the Bit Ledger, and the buzz line all ride the moment prompt itself. Any accepted idea should be delivery-audited against the under-call seam before build.
3. **The sanctioned-pathway pattern wins; new Vault doors lose.** Every top-scoring idea moves information exclusively through witnessed events + gossip diffusion + existing unseal surfaces. The only idea cluster that needs a new wall door (the exit-unseal trio) took the three lowest L2 scores in the slate — and correctly compresses to a single owner ruling rather than three features.
4. **Absence is a missing signal class.** v1 treated the non-event as first-class; two experts independently rebuilt it (A1 + merged Attention Ledger) from the presence stores that already hold its ground truth. No round-1 idea touches it.
5. **Presentation-over-committed-outcome generalizes.** The staged-comp precedent (one roll, inert staging, byte-identity guard) is reused verbatim by C1 (failure styles), E2 (reveal-order grouping), and F1 (reception pan) — a proven pattern for adding texture with zero calibration risk, each shippable with a `stagedTrajectoryNeutral`-style test.
6. **Comedy is completely unclaimed.** Round 1 produced zero humor ideas; this round's comedy theme took four of the eight highest averages, including the sole unanimous exceptional. The persistence mandate (#4) turns out to be a comedy engine: callbacks, running bits, and stable failure signatures are accumulation made *felt*.
7. **The retrospective is over-loaded and the eviction beat is under-loaded.** Three engines pay off only at a screen many seasons never reach, while eviction night — the season's recurring ritual — is pure loss. Multiple ideas (E1, E2, D1) independently move payoff mass to eviction night; the counter-pressure (finale spoiler integrity, the Vault-door do-not) is the owner's call, not a design unknown.
8. **Proposals must be reversibility-shaped.** Per the T9 doctrine, every idea above that changes felt behavior is (or should be, on acceptance) flag-gated with off ⇒ byte-identical — the same shape the owner has ratified same-session before.
9. **One v1 treasure remains un-pitched:** the player-visible living dossier (curating the player's OWN stated reads into per-houseguest prose — `bb-day-2.md:3195`). The Mole Quiz builds its scoring half; the artifact itself is still open territory for round 3 or direct owner commission.

---

## 4) Questions only the owner can answer

**Q1 — The eviction-night Vault door (gates E1 and its two merged variants).** The hard do-not reserves Vault exposure to `producerVault` alone. Is a *structurally-filtered* eviction-night exit package (speaker = evictee; subjects limited to the player, prior evictees, and already-known facts; test-gated like producerVault; flag-gated off-by-default) an acceptable second sanctioned door — or does mid-season unsealing stay forbidden regardless of filter? One ruling settles three pitches. Sub-question: may the evictee's wrong-blame *belief* also enter the house's knowledge layer to diffuse as gossip (the "…Airs" residual), or player-only?

**Q2 — Which dark flags go live in deploy defaults?** Three built-and-tested systems are one line from existing: `ORWELL_GOSSIP_DRIFT` (B1 — calibration-documented neutral when off), `ORWELL_SECRET_BARTER` (B3/D3 prerequisite), `ORWELL_SHOWRUNNER` Phase-1 (F4 step 1 — documented neutral; REWEIGHT stays off). Approve any/all? Each is independently reversible.

**Q3 — How much may a prior season shape a new one?** F1 (notoriety voiced), F2 (cold cases seeding one NPC's hidden layer), and F4 (production memory) all deepen seasons-as-levels. Is cross-season carry-in of *content* (not outcomes) wanted at all — and if so, how loud may Day 1 of season 2 be about season 1?

**Q4 — The behavior-readout coarseness dial.** The Reaction Pan (C3) and always-on mood words give a *regular* one-word behavioral readout of hidden edges at every ceremony. Behavior is the sanctioned channel — but how coarse must it stay before it starts feeling like a number in disguise? (Options: full pan every ceremony / pan only at nominations+eviction / seeded partial pan.)

**Q5 — Does engagement-biased surfacing cross the line?** F4 step 2 routes which already-committed hidden beat gets narrated first based on what the player engaged with last season. It never touches outcomes — but it is player input influencing engine routing. In or out?

**Q6 — Finale payoff vs. mid-season dividends.** E1/E2/D1 deliberately move reveal-mass from the 0048 retrospective toward weekly beats, softening the finale's all-at-once payoff in exchange for eight smaller ones (and coverage of abandoned seasons). Where should the balance sit? (Instrumenting how many real seasons reach the retrospective would inform this — cheap to add first.)

**Q7 — The beat-length budget.** Cabin-Fever rituals (C5) and the pacing want-map both point at the unwritten pacing spec (dramatic beats = full ceremony; mechanical beats = near-instant), which would also finally resolve PO-1 (eviction-night length, PENDING since 06-20). Commission that one-page budget doc?

**Q8 — Decision format.** The record shows you decide fast on live play and stall on prose. For the accepted subset here, should each ship behind its flag straight into your unsealed-playthrough ritual (approve/kill after one live session), rather than through further design memos? The frozen-spec decisions (0097/0098/0103) and the six dark behavioral flags from BL-059 could ride the same live-demo batch.

---

## 5) Owner rulings — 2026-07-21, LOCKED (same session as publication)

| Q | Ruling |
|---|---|
| Q1 | **Exit door APPROVED, player-only.** The structurally-filtered eviction-night exit package (speaker = evictee; subjects = the player, prior evictees, facts already in the player's knowledge layer (the same predicate as the mechanism text — one boundary, not two); adversarial-test-gated like producerVault; flag-gated off-by-default) becomes the second sanctioned Vault door. The gossip-diffusion variant ("…Airs") is NOT approved. |
| Q2 | **All three dark flags go live in deploy defaults:** `ORWELL_GOSSIP_DRIFT`, `ORWELL_SECRET_BARTER`, `ORWELL_SHOWRUNNER` Phase-1 (observe-only; REWEIGHT stays off). |
| Q3 | **Full cross-season carry-in** (content, never outcomes): legend precedes you + cold cases + production memory. Flag-gated + seeded each. |
| Q4 | **Seeded partial reaction pan** — the camera catches a temperature-rolled subset each ceremony, never all 15. |
| Q5 | **Engagement-biased surfacing is OUT** — no player-derived input influences any engine selection, including presentation routing. (F4 ships without step 2.) |
| Q6 | **Payoff-mass balance: spec both options, defer, PO-GATED** — the E1 door itself is approved (Q1); how much aggregate reveal-mass shifts weekly-vs-finale is specced both ways and judged later. |
| Q7 | **The one-page pacing budget is COMMISSIONED** — per-beat-class time/ceremony allocation; resolves PO-1 (eviction-night length); becomes the pacing authority future beats must cite. |
| Q8 | **HYBRID decision format adopted:** small/reversible ideas go flag-gated straight into the unsealed-playthrough ritual (approve/kill from play); M/L-cost ideas get a short spec first. Rule-bending items always get memos. |

**Greenlit for spec/build under Q8:** small+reversible → straight to flagged build + live demo (C1 Wipeout Reel, B1 Telephone-Game payoffs, E2 Traitors' Fury, F1 Legend); M/L → short spec first (D1 Ballot Arithmetic, A1 Fifteen Pairs of Eyes, C2 Odd-Couple B-Plots, A2, C3 partial-pan, C4, D2, E1 exit package, the cross-season pair F2/F4-without-step-2). D3 Genius Back-Room stays parked on its flagged tensions.

## 6) Review addendum — binding spec-time constraints (from the #1773 review, accepted)

Every accepted idea's spec MUST carry these, surfaced by automated review and adopted as contract:

1. **Typed beliefs, never bare facts** — vote claims, deductions, and any possibly-false information persist as typed belief/claim records (claimant, audience, confidence, provenance); solvency checks and diffusion run over CLAIMS, never promote a lie to engine truth (D1, E3, vote-deduction consumers).
2. **Bounded observer sets** — absence/attention facts derive an eligible-observer set from presence/adjacency/coverage windows BEFORE the seeded noticed-by roll; witness scope persists with the fact (A1 and kin). Aggregate ground truth must never leak to observers who couldn't have seen it.
3. **Deterministic grounding before persistence** — anything LLM-derived that becomes durable canon (running bits, yearbook prose) extracts candidates + source event ids deterministically from the EventStore, validates exact text and knowledge scope before persisting; the LLM only ranks or words, never originates canon (C4, F3).
4. **Per-idea reversibility fields** — each accepted idea's spec declares its flag, off ⇒ byte-identical invariant (stagedTrajectoryNeutral-style test), fallback, and rollback condition, per the T9 doctrine. Ideas lacking these are incomplete for build.
