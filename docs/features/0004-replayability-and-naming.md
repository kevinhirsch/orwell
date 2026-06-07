# 0004 — Replayability & naming

> **Status:** Draft. **Build priority:** #4.
> **Executable spec:** [`0004-replayability-and-naming.feature`](./0004-replayability-and-naming.feature)

## 1. Summary

Every new game is a new save: a player authored at first-run OOBE plus a brand-new house of
**15 generated, randomly-named NPCs** within plausible *Big Brother* archetype bounds, for a
cast of **16**. **No identity carries over** between games. **Only the player's profile is
human-authored**; all NPC profiles are generated and internally consistent.

## 2. Scope

**In:** `CharacterFactory` house generation (seeded); the OOBE handoff that produces the
player; cast-size and authorship invariants; name uniqueness and the no-fixed-list rule; the
no-carryover guarantee across seeds; archetype-plausibility constraints.

**Out:** the *depth* and *evolution* of hidden attributes/souls over a game (exercised by #3
richness and #7 non-degradation); the narrative voice (narrative layer).

## 3. Contracts (stack-agnostic)

```
CharacterFactory:
    generateHouse(seed) -> { npcs: [Houseguest x15] }   # randomly named, archetype-bounded, internally consistent
    runPlayerOOBE(input) -> PlayerCharacter             # the only human-authored profile
SoulProvider:
    characterOf(houseguest) -> Character                # STATIC baseline: archetype, core P/M/S aptitudes, identity
    soulOf(houseguest) -> Soul                          # DYNAMIC + evolving (md + vector): emotional state, memory,
                                                        #   and relationship beliefs — directed, graded, computed
                                                        #   from event history (NOT binary ally/bff flags; labels
                                                        #   are organic/emergent — see docs/decisions/0002)
```

**Invariants:** exactly 16 houseguests (1 player + 15 NPCs); display names unique within a
house and never drawn from a hard-coded/sample list; different seeds ⇒ disjoint identities.
Each houseguest splits into **static `Character`** (baseline: archetype, core P/M/S aptitudes,
identity) and **dynamic `Soul`** (evolving: emotional state, accumulated memory, and
**relationship beliefs** — graded and computed, not binary ally/bff flags) — see
`docs/decisions/0001-competition-stats-souls-and-veto-choice.md` and
`docs/decisions/0002-relationship-model.md`.

## 4. Test strategy

- **Seeded** generation; assert cast size, authorship origin, uniqueness, archetype bounds.
- **No-carryover:** generate two houses with different seeds and assert disjoint identities;
  generate with the same seed and assert reproducibility.
- **Name-agnostic & no-sample-content:** assert generated names are not members of any fixed
  list, and tests reference roles only (this feature is itself a guard against name hard-coding).
- **Archetype plausibility:** assert each NPC satisfies the internal-consistency / plausible-
  archetype constraints (a schema/ruleset the factory must honor).

## 5. Definition of Done

- [ ] All scenarios pass, name-agnostic.
- [ ] 16-cast, single human-authored player, 15 generated NPCs enforced.
- [ ] Names unique and provably not from any fixed/sample list.
- [ ] No identity carryover across seeds; same-seed reproducible.
- [ ] Generation is seeded via `RandomnessSource`.

## 6. Dependencies

`CharacterFactory`, `SoulProvider`, seedable `RandomnessSource`. Feeds #3 (the generated deep
characters whose hidden elements surface) and #7 (their persisted, deepening profiles).

## 7. Traceability

`bb-sim-spec.md` §1, §7, §12 (Replayability and naming; Generation constraints);
`CLAUDE_CODE_INSTRUCTIONS.md` §5, §13 (no hard-coded persona/names); `CLAUDE.md` characters.
