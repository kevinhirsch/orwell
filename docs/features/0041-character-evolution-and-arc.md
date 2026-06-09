# 0041 — Character evolution & season arc

> **Status:** Draft. PARTIAL today. The pieces of character change exist — relationship edges evolve
> (0023/0026) and `SoulStore.recordToSoul`/`recall` + a soul `emotionalState` exist (0024) — but the
> soul's **emotional history doesn't feed back into live behavior**, and there is **no explicit arc**: a
> houseguest cocky in week 1 plays identically after a week-4 blindside. `recordToSoul`/`recall` are
> **unwired from the live loop** (module/test-only). This feature **drives emotional state from live event
> history**, **modulates live behavior** by it, and adds a bounded, persisted **disposition drift** — while
> the static `CHARACTER` stays byte-stable (0007).
> **Executable spec:** [`0041-character-evolution-and-arc.feature`](./0041-character-evolution-and-arc.feature)

## 1. Summary

A season should *change* a houseguest. Today the relationship layer moves, but the houseguest's own
**emotional trajectory** — rattled by a blindside, hardened by survival, emboldened by a win — neither
accumulates into their soul live nor bends their later play. 0041 closes the loop: consequential events
update the NPC's **soul emotional state** (live), that state **modulates competitions and decisions**, and
the accumulated trajectory is a **recall-able season arc** the narrator can voice — all in the hidden layer,
with the **static character baseline unchanged** (the `CHARACTER`/`SOUL` split, CLAUDE.md).

## 2. What exists today (the gap this closes)

- **Edges evolve** (`consequence.ts`/`0023` → `applyDirected`, decay/mean-reversion in `0026`) — but that's
  *relationships*, not the houseguest's own affect.
- **`SoulStore.recordToSoul`/`recall` + `emotionalState`** exist (0024) but are **not called from the live
  runtime** (grep: only the store, its port, and tests) — so the soul doesn't deepen during live play and
  `emotionalState` isn't driven by what happens.
- **The competition emotional modifier** (0006/0028) reads a soul emotional value, but nothing **evolves**
  that value from live events — so a "rattled" houseguest never actually exists in a live game.
- **No arc abstraction:** no persisted trajectory of "how this character has changed."

## 3. Scope

**In:** drive each NPC's **soul `emotionalState`** (e.g. distress / confidence / volatility) from **live
event history** (a blindside spikes distress/volatility; surviving a vote / winning builds confidence) via
**bounded, mean-reverting** deltas (sibling to 0028's emotional modifier); **wire `recordToSoul`/`recall`
into the live loop** so the soul deepens during play; have the evolving state **modulate live behavior** —
(a) the **competition** emotional modifier (0006/0028), and (b) **decision leanings** (a rattled HOH
nominates more erratically; a confident houseguest throws/plays-safe differently); a persisted, monotonic
**season arc** (`recall` surfaces "since the week-4 blindside, guarded"); and a bounded **disposition drift**
at the **soul** level that mean-reverts toward the character baseline.

**Out:** changing the **static `CHARACTER`** (archetype/core aptitudes/backstory stay **byte-stable**, 0007);
rebuilding `SoulStore` (reused, 0024); the relationship math (0026); narration quality (the engine evolves
the state; the LLM voices it).

## 4. Design

- **Emotional update (live).** On each consequential event for an NPC (eviction survived, blindside
  witnessed, betrayal suffered/committed, comp win/loss), apply **bounded** deltas to their soul
  `emotionalState` with **mean-reversion** when things calm (the 0028 emotional-constants family), and
  `recordToSoul` the moment (append-only, 0024/0007). This runs on the **live** path (the consequence fold,
  0023, and the off-screen society, 0038) — not just in tests.
- **Behavior modulation.** The evolving `emotionalState` feeds **competitions** (the 0006/0028 emotional
  modifier — a rattled houseguest is more volatile/under-performs; a confident one steadier) and **decision
  leanings** (mood scales the threat/trust weighting in nominations/votes/initiative). All bounded — emotion
  **never overrides hard rules** (eligibility, the Vault Wall).
- **The arc.** The persisted trajectory of `emotionalState` + the key events that moved it **is** the season
  arc; `recall(npc, context)` surfaces a *specific* past inflection so the narrator can voice a changed
  houseguest consistently.
- **CHARACTER vs SOUL.** Only the **SOUL** drifts; the **CHARACTER** (the byte-stable baseline, 0007) never
  changes. Disposition drift is a **soul-level current temperament** that mean-reverts toward the baseline —
  the character is who they are; the soul is who the game has made them this week.
- **Vault Wall.** All of it is hidden. The player sees a changed houseguest only through **behavior** — never
  an emotional number (sentinel-clean).

## 5. Contracts (stack-agnostic)

```
on a consequential event for npc:
   soul.emotionalState = boundedUpdate(state, eventKind)     // mean-reverts when calm (0028 family)
   soul.recordToSoul(npc, moment)                            // append-only (0024/0007); live
behavior:
   competitionEmotionalModifier(npc) reads the evolving soul state   (0006/0028)
   decisionLeaning(npc) scales threat/trust weighting by mood         (nominations/votes/initiative)
arc:
   recall(npc, context) → a specific past inflection ("since the week-4 blindside…")
invariants: CHARACTER byte-stable (0007); emotion bounded, never overrides hard rules; player sees no numbers
```

## 6. Definition of Done

- [ ] **Driven by live history:** a blindside (or a survived vote / a win) **measurably shifts** the NPC's
      soul emotional state on the **live** path (not just in `simulation.ts` tests).
- [ ] **Modulates behavior:** the shift changes live behavior — a rattled houseguest's competition and
      decision tendencies differ from the same houseguest calm (asserted with a seeded source).
- [ ] **Accumulates as an arc:** the soul deepens monotonically (0024/0007) and `recall` surfaces a specific
      past inflection that colors later play.
- [ ] **CHARACTER byte-stable:** the static character (archetype/aptitudes/backstory) is unchanged across the
      season; only the soul drifts (cross-check 0007).
- [ ] **Bounded + mean-reverting + deterministic:** emotion stays in bounds, reverts toward baseline when
      calm, never overrides hard rules; same seed ⇒ same arc.
- [ ] **Vault-free:** no emotional number on any player surface (extend the 0001 canary); persisted (0030);
      name-agnostic; added to `cucumber.cjs`; `npm test` green.

## 7. Dependencies & traceability

Wires **0024** (`SoulStore` recall) into the **live** loop, driven by **0023** (consequence) + **0038**
(off-screen life), modulating **0006/0028** (competition emotional modifier) and the decision leanings
(0011/0014), under **0001** (Vault Wall) and **0007** (the byte-stable `CHARACTER` vs the drifting `SOUL`),
persisted by **0030**. Makes "the house changed me / changed them" a real, hidden, recall-able mechanic.
