# 0011 — Weekly loop orchestration

> **Status:** Built (see the [README status index](./README.md#index)). **The gameplay spine** — the playable week + season as a pure-domain state
> machine, binding the rules (0005), outcomes (0006), pacing (0008), and the relationship model
> (decision 0002) into the actual flow. The engine has the rules and the off-screen sim, but not
> yet the orchestrated competition loop.
> **Executable spec:** [`0011-weekly-loop-orchestration.feature`](./0011-weekly-loop-orchestration.feature)

## 1. Summary

A **week** (= one HOH reign) runs as a phase state machine:

```
HOH competition → nominations → veto competition → veto ceremony → eviction vote
   → live eviction → (next HOH) …
```

A **season** runs that loop from premiere down to **Final 2**, then a **jury vote** decides the
winner. The loop is **pure domain core** (no I/O), seed-deterministic, and reads/writes
`GameState`.

## 2. Scope

**In:** the phase state machine + legal transitions; the **decision points** and who owns each
(player vs NPC); the season → endgame transition (jury formation, Final 2); the win condition.

**Out:** the *rules themselves* (eligibility/voting set/tie-break live in **0005**; outcomes in
**0006**); the **interaction model** for how the player supplies a decision (→ conversation
feature); the **jury-vote choreography / presentation** (→ a dedicated endgame feature); the
narration (NarrativePort / 0009).

## 3. Phases & transitions

| Phase | Produces | Decided by |
|---|---|---|
| HOH competition | the week's HOH | engine outcome (0006); outgoing HOH ineligible (0005) |
| Nominations | two nominees | the HOH (player if player is HOH, else NPC) |
| Veto competition | the veto holder | engine outcome (0006); six-player field incl. Houseguest's Choice (0005) |
| Veto ceremony | use? + replacement | the veto holder; if used, HOH names a replacement (not the veto winner — 0005) |
| Eviction vote | the evictee | all but HOH + nominees vote; HOH breaks ties (0005) |
| Live eviction | evictee leaves (to jury once jury has begun) | — |

Transitions are **guarded**: a phase can only begin when its predecessor has produced its
result. Each phase emits the events the cadence rule (0008) counts.

## 4. Decision points — player vs NPC

- **NPC decisions** (nominations, veto use, replacement, votes) are driven by the **relationship
  model** (decision 0002): threat → who to nominate/evict; trust/affinity → who to protect; plus
  strategy and the per-moment temperature roll. They are **not** random and **not** narrator-
  chosen.
- **Player decisions** are *requested* at the points where the player holds power (nominate when
  HOH; use/replace when holding veto; vote when eligible). This spec marks **where** a player
  decision is needed and validates it against the rules — **how** it's collected is the
  interaction model (separate feature).

## 5. Off-screen between beats

Per **0003**, most social life is off-screen. Between phases the engine simulates NPC scheming
(gossip diffusion, relationship shifts), so each nomination/vote reflects the **evolving** state,
not a frozen snapshot. The player witnesses only a slice and infers the rest.

## 6. Endgame transition

- The **jury** is the **last 9 evictees**; for a 16-cast Final-2 that is evictions **6–14** (the
  first 5 are pre-jury). Sequester begins at the first juror's eviction.
- At **Final 2**, the season moves to the jury vote; the winner has the **most jury votes**; a tie
  is broken by the **last-evicted juror** (0005/spec). *(Deliberate: with a jury of 9 — odd — this
  tie is **unreachable in the untwisted format**; the rule exists for the returning-juror twist
  family, where the jury can become even.)* The vote *choreography* (statements,
  one-question-per-juror, reveal order) is a separate endgame feature.

## 7. Contracts (stack-agnostic, pure core)

```
Phase = HOH | NOMINATIONS | VETO_COMP | VETO_CEREMONY | EVICTION | (ENDGAME)
pendingDecision(state) -> { phase, owner: player|NPC, options } | none   # what the loop is waiting on
advancePhase(state, decision, rng) -> state'                            # applies a (validated) decision; pure
winner(state) -> Houseguest | none
```

`advancePhase` (as built, the live tools are `advanceGame` / `submitDecision`) rejects an illegal
decision (e.g. naming the veto winner as replacement) — the
0005 predicates are the gate.

## 8. Test strategy

- **Full season, seeded:** run premiere → Final 2 → a **single winner**; assert a valid phase
  sequence every week and reproducibility by seed.
- **Legality per week:** cross-checks 0005 (outgoing HOH ineligible; veto-winner not replaceable;
  correct voter set; HOH tie-break).
- **Jury formation:** exactly the last 9 evictees; sequester starts at the right eviction.
- **Endgame:** Final 2 → jury vote → most-votes winner; last-juror tie-break.
- **NPC decisions reflect relationships:** an NPC nominates/evicts by threat/trust, not at random
  (cross-checks decision 0002 / 0003) — property over seeds.
- **Cadence:** every in-game day carries ≥1 meaningful event (cross-checks 0008).

## 9. Definition of Done

- [ ] A seeded season runs end-to-end to one winner with a legal phase sequence every week.
- [ ] Every per-week rule from 0005 holds; illegal decisions are rejected by `advancePhase`
      (as built: `submitDecision`).
- [ ] Jury = last 9 evictees; endgame produces a winner with the correct tie-break.
- [ ] NPC decisions are relationship-driven (not random); player decision points are surfaced
      and validated.
- [ ] Pure core, unit-tested with the seeded `RandomnessSource`.

## 10. Dependencies

0005 (eligibility/voting), 0006 (outcomes/temperature), 0008 (cadence), the relationship model
(decision 0002, for NPC decisions), 0007 (the season state persists/deepens). **Feeds** the MCP
action tools (`resolveCompetition` — as built: `runCompetition` — etc., 0009), the player-decision interaction layer, and a
dedicated endgame/jury feature.

## 11. Traceability

`docs/bb-sim-spec.md` §3 (weekly loop), §11 (Season/Week/…); `docs/legacy/BB_GameBible.md` §4
(weekly cycle), §11 (jury & endgame); `CLAUDE.md` canonical mechanics; decision 0002 (NPC
decision drivers).
