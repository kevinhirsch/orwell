# 0006 — Outcomes by stats + temperature

> **Status:** Draft. **Build priority:** #6.
> **Executable spec:** [`0006-outcomes-by-stats-and-temperature.feature`](./0006-outcomes-by-stats-and-temperature.feature)

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
emotional-modifier weighting lives in that same config and reads the dynamic soul.

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
- [ ] Temperature bounded; hard rules invariant under temperature.
- [ ] Intent honored pre-comp and immutable post-result; weights/bounds in tunable config.

## 6. Dependencies

#5 (eligible/participant sets feed `resolveCompetition`); seedable `RandomnessSource`. Powers
#3 (temperature gates NPC initiative and which hidden element surfaces).

## 7. Traceability

`bb-sim-spec.md` §8, §12 (Randomness and temperature; archetype/temperature outcome scenario),
§5; `docs/legacy/BB_GameBible.md` §5 (stats Physical/Mental/Social/Luck; intent);
`CLAUDE_CODE_INSTRUCTIONS.md` §6, §8.
