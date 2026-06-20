# 0006 — Outcomes by stats + temperature

> **Status:** Built (see the [README status index](./README.md#index)). **Build priority:** #6.
> **Executable spec:** [`0006-outcomes-by-stats-and-temperature.feature`](./0006-outcomes-by-stats-and-temperature.feature)
> **Amendment (staged rounds):** competitions now play out in **visible elimination ROUNDS** — see
> [§8 — Staged-rounds evolution](#8-staged-rounds-evolution-the-per-round-approach) below.

## 1. Summary

Competition outcomes are weighted by the **relevant stat vs. the competition type**, a
**per-moment temperature roll** across all involved variables, and an **emotional modifier**
sourced from the houseguest's soul (a rattled houseguest competes differently) — **no Luck stat**.
Outcomes are **reproducible** under a fixed seed. Temperature governs variance/surprise but
**never** overrides hard rules (eligibility, the Vault Wall) or archetype-grounded weighting,
and **the engine never protects the player**. Player intent (compete / throw / play safe) is
declared beforehand and is **immutable** after the result.

## 2. Open-decision note

The exact temperature math — distributions, per-variable weights, bounds, surfacing rate — is
an **open decision** (`bb-sim-spec.md` §16.2). This spec therefore asserts **properties**
(reproducibility, bounds, stat-correlated win rates, variance from temperature + emotion, no
player protection), **not specific numbers**. Keep weights/bounds in a tunable config. The
emotional-modifier weighting lives in that same config and reads the dynamic soul. **Variance
is calibrated so a clear stat favorite wins a strong majority of runs but loses a real
minority** — earned outcomes with uncommon upsets (target ≈ 65–80% favorite win rate, tunable);
temperature and the emotional modifier supply that minority.

## 3. Contracts (stack-agnostic)

```
resolveCompetition(participants, type, intents, rng) -> Result   # stat-vs-type weighting + temperature + soul emotional modifier
TemperatureRoll:
    rollFor(moment, rng) -> { perVariable: map<Variable, value> } # across ALL involved variables; bounded
```

`rng` is the seedable `RandomnessSource`; identical seed ⇒ identical `Result`.

## 4. Test strategy (distribution / property-based)

- **Reproducibility:** same seed ⇒ identical outcome; different seeds ⇒ varied outcomes.
- **Stat correlation:** over many seeded runs, win rate increases with the relevant-stat
  advantage for the competition type (monotonic trend), without being deterministic.
- **Calibrated variance:** a clear favorite wins a **strong majority** across seeds but loses
  a **real minority** (the configured upset band — target ≈ 65–80% favorite win rate, tunable)
  — neither near-deterministic nor coin-flippy.
- **No player protection:** the player's win rate in an unfavorable type is statistically
  indistinguishable from an NPC of equivalent stats.
- **Variance non-determinism:** temperature + the emotional modifier mean a clear favorite
  loses at least some runs (there is no Luck stat).
- **Bounds:** every temperature roll lies within configured bounds (property over seeds).
- **Hard-rule invariance:** no temperature roll changes eligibility or surfaces Vault data.
- **Intent immutability:** post-result intent changes are rejected.

## 5. Definition of Done

- [ ] All scenarios pass across the seed set, name-agnostic.
- [ ] Outcomes reproducible by seed; distributions reflect stats + temperature, not story.
- [ ] Player provably unprotected; temperature + emotional modifier provably break perfect predictability.
- [ ] A clear favorite's win rate lands in the configured "earned but upsettable" band (strong
      majority, real-minority upsets).
- [ ] Temperature bounded; hard rules invariant under temperature.
- [ ] Intent honored pre-comp and immutable post-result; weights/bounds in tunable config.

## 6. Dependencies

#5 (eligible/participant sets feed `resolveCompetition`); seedable `RandomnessSource`. Powers
#3 (temperature gates NPC initiative and which hidden element surfaces).

## 7. Traceability

`bb-sim-spec.md` §8, §12 (Randomness and temperature; archetype/temperature outcome scenario),
§5; `docs/legacy/BB_GameBible.md` §5 (stats Physical/Mental/Social/Luck; intent);
`CLAUDE_CODE_INSTRUCTIONS.md` §6, §8.

## 8. Staged-rounds evolution (the per-round approach)

**Owner decision (this amendment).** The single, up-front, irrevocable approach declaration
(compete / throw / play-safe) was too rigid: the player committed once, blind to how the field
would narrow. Competitions are now **endurance-style, played out in visible ELIMINATION ROUNDS**.

### 8.1 The round model

- A competition is a sequence of rounds over the **still-in field**. Each round resolves with the
  SAME 0006/0028 math — stat-vs-type weighting **+** a bounded per-moment temperature roll **+** the
  soul emotional modifier **+** the declared approach penalties — applied **round by round** to decide
  **who DROPS** (the lowest score steps out), not who wins. The last houseguest standing is the winner.
  No new outcome system: `resolveElimination` reuses `resolveCompetition` verbatim and reads the SAME
  scores to pick the lowest (`src/domain/competitionOutcome.ts`); the staged sub-loop lives in
  `src/engine/liveSeason.ts` (`CompetitionProgress` / `advanceCompetition`), the sibling of the staged
  eviction (0047) and finale (0037) sub-loops.
- **The player picks their approach for THAT round, seeing who remains** — adapting to the narrowing
  field (everyone left is an ally → throw; a threat is still in → keep competing). The per-round
  approach modulates **only the player's** survival that round (compete = full; play-safe = the
  middling 0028 penalty; throw = the deep penalty, i.e. drop / step out). NPCs choose by soul
  motivation (relationship-driven, as comp decisions already are — for now they compete).
- Seeded + reproducible: each round forks a child stream from the per-beat rng (`fork("comp-round:N")`),
  restart-stable (0030). The decision seam surfaces a per-round `comp-round` pending carrying the
  **still-in field** + the round number; `peekCompetition` continues the elimination from the live
  still-in field, so the single-authority preview (B37) still equals what the loop crowns when the
  player competes the rest of the way.

### 8.2 Anti-sycophancy, preserved PER ROUND (the non-negotiable)

The old popup was binding for one reason — **mandate #3**: the player must commit BEFORE seeing a
result, so a loss can never be retroactively re-labeled a "throw." That guarantee is preserved
**per round**:

- Each round's approach is **committed BEFORE that round resolves**; the engine uses the **structured
  selection only — never parsed from prose** (the FE posts it engine-direct via `submitDecision`,
  exactly as the single declaration did).
- Once a round (and the comp) resolves, it is **LOCKED** — no retroactive change. Submitting an
  approach for a round that already resolved is refused; a late submit after the crown is a no-op.
- **Adaptation happens forward** (the next round, over the narrowed field), **never backward**. There
  is no door to re-label a finished round.

### 8.3 Calibration holds

The END distribution over the staged comp stays within the 0006 band: a clear stat favorite wins a
**strong majority** (≈73% across field sizes — squarely inside the 65–80% target) but loses a real
minority; equal-stat houseguests each win their fair share (symmetry → no hidden favor, the player
unprotected); a per-round throw measurably lowers the player's win rate. Pinned by
`tests/unit/stagedCompetition.test.ts` (favorite band, symmetry, reproducibility, the per-round
throw penalty, and the preview↔crown single-authority match) and held on the live loop by the
existing `tests/property/liveFairness.property.test.ts`.
