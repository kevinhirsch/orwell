# 0111 — The Day-1 experience (the first session is the first move of the social game)

> **Renumbered from 0102** (doc-drift audit, 2026-07-05): `0102` collided with the already-indexed
> `0102-weekly-recap-cliffhanger`; this is the newer, still-unbuilt spec, so it moved to the next
> free slot. No content change.
>
> **Status:** ✅ **BUILT (2026-07-10; Pillar 3 reframed 2026-07-14 — THE CHAMPAGNE CIRCLE).** All five
> pillars shipped: casting probes the self / no kill-list (#905), one Vault-free curiosity needle (#909,
> `src/engine/curiosityNeedle.ts`), fast house entry (#906) — **redesigned (owner ruling 2026-07-14): the
> premiere opens on the producers convening the WHOLE house for champagne-circle introductions, so every
> houseguest is met at the toast, at once, deterministically and engine-recorded** (`GameSessionAdapter.
> meetWholeHouseAtChampagneCircle`, at premiere entry — Vault-free, seed-neutral); the player no longer
> mills about to meet strangers and the premiere gadget no longer shows a "X of 15 met / still to meet"
> checklist. `PremiereIntrosView.powerReachable` is reachable the moment the toast is done (the whole house
> is met), and the first HOH stays a real, un-rigged seeded competition. The consequential Day-1 beat via
> the existing `recordInteraction`/0023 fold + the 0055 `_auto_record_scene` belt (#908), and the Diary
> Room enterable Day-1 & OOC (#907). BDD `0111-day-1-experience.feature` (wired in `cucumber.cjs`;
> `day1_experience.steps.ts`); the reframes are calibration-neutral (byte-identical `advanceToFinale`
> season). FE premiere tutorial touch in `orwellPremiereTutorial.js`. See § "PO review" +
> `docs/decisions/PO-DECISIONS-LOG.md` (2026-06-27) + #875.
> Tracks the first-run → end-of-day-1 audit (`docs/audits` / `scratchpad/audit_day1/AUDIT_REPORT.md`) and
> its umbrella **#875**. This is the **coherent design** over five already-filed sub-issues — it does not
> introduce a parallel system; it sequences and constrains them as **one first-session experience** rather
> than five disjoint edits.
> **Composes (does NOT duplicate):** **#905** (casting: discover-don't-declare), **#906** (fast, asymmetric
> house entry + fast first power), **#907** (Diary Room open as a room on Day 1), **#908** (one demonstrably
> consequential early social beat), **#909** (one Vault-free curiosity needle). Builds on **0050** (the
> casting interview), **0049** (presence / lingering), **0013** (the Diary Room), **0023** (the consequence
> & memory fold), **0038/0059/0043** (the hidden society / seeded relationships / blocs the needle *points
> at* but never reveals), the live premiere in `src/engine/liveSeason.ts`, and the FE casting framing
> (`frontend/routes/chat_helpers.py` `apply_game_framing`, `frontend/src/agent_loop.py`,
> `src/engine/momentPrompts.ts`).
> **Bounded by:** mandate #1 (behavioral fidelity), mandate #2 (the Vault Wall — player **and** admin),
> mandate #3 (anti-sycophancy — the engine owns outcomes; the model only voices), ADR **0003** (the
> conversation is the game — augment, never replace), ADR **0005** (split authority by openness).

## Why — the gap this closes

The engine already produces structured emergent drama (un-rigged outcomes, the consequence loop, the
hidden society, deals, blocs, the Diary Room, the interactive finale). The first-run audit found the
problem is not the machinery — it's that **Day 1 never makes the player believe that machinery exists, and
it doesn't get them into the conversation fast.** A brand-new player exits casting knowing *themselves* and
nothing about the *cast*, walks into a flat completionist roll-call before any stakes, is never shown the
Diary Room, and is never taught — by feeling it — that what they say sticks. The first session reads like
an AI workspace that happens to be about a game, not like *the first move of a social game.*

This spec reframes Day 1 around what a coalition / social-deduction game must establish in its opening
hour, and binds the five sub-issues to those pillars so they're built as one experience.

### Retention / why the first session decides whether they come back

A social game hooks on **paranoia and curiosity formed early**: *who do I trust, who's playing me, what
does the house know that I don't.* If the first session delivers reading-and-being-read, a sense of a
hidden game already in motion, the felt weight of a consequential choice, a private backstage, and a fast
taste of power, the player has *stakes* before they've seen the long game — and the long game (which the
engine genuinely runs) becomes the reason to return. Day 1 is the highest-leverage retention surface in the
product.

## The core idea — five social-game truths Day 1 must establish

Day 1's only job is to make the player **believe the whole season's depth before they've seen it** and **get
them into the conversation fast.** Five pillars, each mapped to a sub-issue and to existing machinery:

### Pillar 1 — "I am being read while I read them." → casting probes self, not strategy (#905)
The casting interview today presses the player to *declare* a kill-list / strategy and files it as
`privateStrategy`. In a coalition game, strategy is **discovered live** against a real house. Reframe the
interview (`momentPrompts.ts` casting prompt + `apply_game_framing`) to **probe self-belief and tells** —
relationship to lying, the line they won't cross, what rattles them — and let alliances/targets *emerge* in
play. The payoff is the already-specced mid-season producer re-read ("you said you'd never lie…") converting
the declaration into **earned dramatic irony**. Net: the player leaves casting *curious and read*, not
*pre-committed*.

### Pillar 2 — "The house already has a life I'm walking into." → one Vault-free curiosity needle (#909)
The engine's whole dramatic-irony apparatus (off-screen scheming 0038, seeded relationships 0059, blocs
0043) is real but Day 1 never *whispers it exists.* The producer drops **one truthful, Vault-free curiosity
needle** — grounded only in facts the engine can stand behind (the seeded diversity floor, the *existence*
of hidden elements), never a specific secret — e.g. "this cast was assembled for friction." What crosses is
the **promise of depth**, never a fact. The Wall stays absolute (see § Vault Wall).

### Pillar 3 — "Strategy/agency arrive fast — I'm playing, not auditioning." → the champagne circle (#906)
The premiere used to forbid the first HOH "while [the to-meet] list still has names on it" — a
completionist 15-introduction roll-call before any stakes. **Redesigned (owner ruling 2026-07-14 — THE
CHAMPAGNE CIRCLE):** the premiere opens on the producers convening the **whole house for champagne-circle
introductions**, and every houseguest is met **right there, at once** — the FIRST thing that happens. The
player never mills about to stumble on strangers. This is **deterministic and engine-recorded**
(`GameSessionAdapter.meetWholeHouseAtChampagneCircle`, at premiere entry — it marks every active NPC met +
name-locked, Vault-free and seed-neutral), NOT the model's progressive `markHouseguestMet` calls (the model
still *narrates* the toast; the engine only records — ADR 0003). The premiere gadget drops the "X of 15 met
/ still to meet" checklist accordingly (it keeps the cast-roster strip as color). `powerReachable` is
therefore true the moment the toast is done, and the **first power arrives fast** (cf. v1's "won HOH Day
1"). The HOH remains a real, un-rigged, seeded `runCompetition` — never gifted (mandate #3).

### Pillar 4 — "What I do sticks." → one demonstrably consequential early beat (#908)
Day 1's only stakes today are the high-variance first HOH. Add **one Day-1 social beat** (a bedroom-pick
exchange, a toast, a first confidence) that **demonstrably folds a real first read** via
`recordInteraction` / `_auto_record_scene` — no numbers shown, the change living in the hidden layer (0023),
surfacing later only as **behavior** the player can see bite. This teaches the action→consequence loop
*diegetically* — the stated point of the game.

### Pillar 5 — "I have a backstage." → the Diary Room open as a room on Day 1 (#907)
The Diary Room (0013) is built but the premiere never introduces it. Establish it as an **enterable room
from Day 1** ("the diary room's open whenever you want to vent — nobody in the house hears it") so the
backstage confessional — core to the genre and to the player's private voice — exists *before* it's needed
as a pressure valve at week-1 nominations. It stays **player-level / OOC**: its content is the player's own
knowledge with **no in-game pathway to any NPC** (the visibility model + Bible §6–§7).

## The ideal fresh-install → end-of-Day-1 path (the through-line)

1. **Login centered, dissolve straight in** — no model modal in the healthy case (the start fixes #872✅ /
   #874 / #859 are the *gate*; this spec is the *content* behind the gate).
2. **Producers reach out first, in-chat** the instant the player lands (the casting interview is the first
   scene, ADR 0050). Probe self-belief + tells (Pillar 1); drop one truthful curiosity needle (Pillar 2).
3. **The champagne circle** — the producers convene the whole house for a champagne toast; every houseguest
   is met at once, then the first power is a breath away (Pillar 3).
4. **One early consequential social beat** the player can later see bite (Pillar 4).
5. **The Diary Room opened as a room** before it's needed (Pillar 5).
6. **First power fast, stakes intact** — the un-rigged HOH, as built (Pillar 3).

## The mechanics (ports / modules — Definition of Ready, pending PO rulings)

These are a mix of **FE framing** (prompts/flow — the model voices; never engine-authors content) and
**engine reframes** (the premiere gate, the consequential-beat fold). Nothing here adds a new disclosure
path or a new outcome authority.

- **`src/engine/momentPrompts.ts`** — the **casting prompt** (Pillar 1) steers to self-belief/tells over a
  declared kill-list; the **premiere/meet moment** (Pillar 3) frames asymmetric first reads + "stragglers in
  motion"; the **curiosity needle** (Pillar 2) is a Vault-free producer line sourced only from public/seeded
  framing. These are *facts handed to the model to voice*, never scripts.
- **`frontend/routes/chat_helpers.py` (`apply_game_framing`) + `frontend/src/agent_loop.py`** — carry the
  Pillar-1 casting reframe and the Pillar-2 needle into the live framing; the Pillar-4 beat rides the
  existing `_auto_record_scene` (0055) error-correction so the early beat **always folds** even if the model
  under-calls `recordInteraction`. **FE error-corrects the omission; never engine-authors content.**
- **`src/adapters/engine/GameSessionAdapter.ts`** — the **champagne circle** (Pillar 3, owner ruling
  2026-07-14): `meetWholeHouseAtChampagneCircle()` marks the whole house met at premiere entry (deterministic,
  Vault-free, seed-neutral), so `powerReachable` is true the moment the toast is done — no manual roll-call.
  The premiere-scoped trackers are cleared inside the commit that leaves the premiere (`syncProjection`). The
  first HOH stays a real seeded `runCompetition` in `liveSeason.ts`. The **Day-1 consequential beat** (Pillar
  4) is recorded through the existing `recordInteraction` + the 0023 live fold — no new fold authority.
- **The Diary Room (Pillar 5)** — surface the existing 0013 DR as a **present, enterable room on Day 1**
  (presence/lingering 0049 + the FE room affordance); no new DR mechanics, only its Day-1 availability +
  one introducing touch.

## The Vault Wall (player AND admin) — why this is safe

- **Pillar 2's needle is the only thing that points at hidden state, and it reveals none.** It is sourced
  **only** from public/seeded framing the engine can stand behind (the *existence* of hidden elements, the
  seeded diversity floor) — never a specific secret, relationship, or scheme. The model "cannot leak what it
  never receives": the needle is built from Vault-free projections, so there is no Vault content in the
  prompt to leak. The load-bearing test asserts the needle carries no specific hidden fact.
- **Pillar 4's beat folds into the hidden layer; no number crosses.** The consequence lives in the
  Soul/Vault (0023); player surfaces show only later *behavior*, never a delta. God Mode / admin is walled
  identically (mandate #2).
- **Pillar 5's Diary Room stays OOC with no NPC pathway** — its content is the player's own knowledge and
  may inform the engine's read of player strategy, **never** NPC behavior; nothing from the DR surfaces a
  hidden fact back to the player.

## ADR 0003 fit — the conversation is still the game

Every pillar **augments** the conversation; none moves play into UI. Casting is a producer *talking*
(Pillar 1); the needle is a *line*, not a dashboard (Pillar 2); the fast entry + first power happen *in the
house* (Pillar 3); the consequential beat is a *scene that gets recorded* (Pillar 4); the Diary Room is a
*room you walk into* (Pillar 5). The only UI is augmentation that builds the game, never replaces an
interaction.

## ADR 0005 fit — shape vs. magnitude (anti-sycophancy)

The model proposes only **shape** (which questions, which reads run hot, the prose of the needle and the
beat); the engine keeps the **closed set** — the first HOH is a real seeded roll, the consequence fold is
bounded/seeded, no outcome is bent to please. With the reframes inactive the existing folds and seeded
distributions are **byte-identical** (the `expressiveNonCollapse` + `juryReach`/UAT gates stay the proof).

## Acceptance criteria (role-only; HARD rules — firm up at build)

- [ ] **Casting probes self, not a kill-list (#905).** The casting interview elicits self-belief/tells and
      does not require a declared target list to finalize; the captured intake is *character*, not a
      committed strategy.
- [ ] **One Vault-free curiosity needle lands by end of casting (#909).** The producer plants exactly one
      truthful "there's a hidden game" beat sourced only from public/seeded framing — carrying **no**
      specific secret/relationship/scheme.
- [ ] **The champagne circle meets the whole house at the toast (#906).** The premiere opens on
      champagne-circle introductions that meet every houseguest at once (deterministic, engine-recorded, no
      manual roll-call); no houseguest is invisible; the first HOH is reachable the moment the toast is done;
      the HOH is a real un-rigged seeded competition.
- [ ] **One demonstrably consequential Day-1 beat (#908).** A Day-1 social choice folds a real first read
      via `recordInteraction`/`_auto_record_scene` (guaranteed even if the model under-calls); the change is
      recalled later as behavior, never shown as a number.
- [ ] **The Diary Room is an enterable room on Day 1 (#907).** The player can enter the DR and give a
      confessional before week-1 nominations; nothing said there reaches any NPC.
- [ ] **Vault Wall (player AND admin).** The needle reveals no hidden fact; no number crosses from the
      consequence fold; the DR has no NPC pathway; a sentinel sweep over player/admin surfaces finds no
      sealed magnitude introduced by Day-1.
- [ ] **Anti-sycophancy + determinism.** The first HOH and the beat fold are seeded/engine-owned; with the
      reframes inactive, `juryReach`/UAT are byte-identical.

## PO review — owner rulings needed (before build)

The audit flagged two of these as explicit design calls; this spec adds the sequencing decision.

- **R1 — Casting reframe depth (#905).** How far to swing from "declare strategy" to "discover" — drop the
  kill-list entirely, or keep a light "instinct" prompt? *Recommendation:* probe self-belief/tells, drop the
  committed kill-list; rely on the mid-season re-read for the dramatic-irony payoff.
- **R2 — The premiere gate reframe (#906).** Exactly what replaces "meet all 15 before any power" — confirm
  "no one invisible, 2–3 hot reads, stragglers in motion, fast first power," and whether the first HOH timing
  changes. *Recommendation:* keep the HOH a real seeded comp; reframe only the *gate*, not the outcome.
- **R3 — Build sequencing.** Build #905/#909 (casting framing) together first (one FE/prompt surface), then
  #906/#908 (premiere + first beat, engine-side) together, then #907 (DR Day-1 touch). *Recommendation:*
  yes — three small coherent PRs over the same seams, **after** the in-flight dedup/cast-gallery/responsive
  work merges to avoid contending the casting/premiere/FE files.
- **R4 — Confirm the curiosity needle's source (#909).** That it is built only from Vault-free public/seeded
  framing (no Vault read), so the Wall holds structurally. *Recommendation: confirm* — the load-bearing test
  pins it.

## Testability (role-only; HARD rules)

- **Vault Wall (load-bearing):** the curiosity needle carries no specific hidden fact (built from Vault-free
  projections); the Day-1 consequence fold exposes no number on any player **or admin** surface; the Diary
  Room exposes no NPC pathway; a sentinel sweep finds no sealed magnitude introduced by the Day-1 path.
- **Casting discovers, not declares:** finalizing casting requires no declared target list; the intake
  records self/tells.
- **Champagne circle (#906):** the premiere meets the whole house at the toast (deterministic, engine-
  recorded — `meetWholeHouseAtChampagneCircle`), so `complete`/`powerReachable` are true from premiere entry
  and no houseguest is invisible, asserted structurally on the premiere gate; the HOH is a seeded
  competition (un-rigged).
- **Consequential beat folds:** a Day-1 social beat folds a relationship read (0023) — guaranteed via the
  `_auto_record_scene` belt when the model under-calls — recalled later as behavior; byte-identical folds
  when the beat is absent.
- **Diary Room on Day 1:** the DR is enterable Day 1 and stays OOC (no NPC behavior reads from it).
- **Determinism / calibration-neutral:** seeded; byte-identical `juryReach`/UAT on the path with the
  reframes inactive.

## Dependencies & traceability

Composes **#905** (casting discover-don't-declare), **#906** (fast asymmetric entry), **#907** (DR Day-1),
**#908** (consequential beat), **#909** (curiosity needle) — all under **#875**. Builds on **0050** (casting
interview), **0049** (presence/lingering), **0013** (Diary Room), **0023** (consequence fold), **0055**
(`_auto_record_scene` error-correction), and the premiere in `src/engine/liveSeason.ts`; points at (never
reveals) **0038/0059/0043** (hidden society). Under **0001** (Vault Wall) and **0021** (isolation), on ADR
**0003** (the conversation is the game) and ADR **0005** (shape vs. magnitude). Source: the first-run →
end-of-day-1 audit (`scratchpad/audit_day1/AUDIT_REPORT.md`), umbrella **#875**. The first session is the
first move of the social game — read and be read, sense the hidden game, feel a choice bite, hold a
backstage, take power fast — believed before it's seen.
