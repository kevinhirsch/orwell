# 0066 — In-game time of day & the nightly sleep economy

**Status:** ✅ Built · **gate: unit + integration** (a recorded deviation from the BDD-default, matching
0033/0036/0055 — the `.feature` is the spec of record; the executable gate is the Vitest suite named
under Definition of Done, because the behaviour is exercised end-to-end through the live adapter and
the opt-in env flag rather than through a new Cucumber world).
**Executable spec:** [`0066-in-game-time-and-sleep.feature`](./0066-in-game-time-and-sleep.feature)
**Provenance:** ADR [`0006`](../decisions/0006-in-game-time-sleep-and-the-presence-economy.md) (in-game
time, sleep & the nightly presence economy); PO direction 2026-06-20.

## 1. Summary

Give the house a finite day. Time of day becomes first-class engine state (morning → afternoon →
evening → night → late-night), and with it the **nightly sleep economy**: managing sleep vs.
late-night conversation time is a trade-off **every** houseguest runs. Staying up late buys scarce
private scheming time at a hidden, bounded cost to the next competition; the comp-focused protect
their sleep and stay sharp. The bound on "functionally infinite" scheming is **diegetic** — the house
puts itself to sleep as houseguests reach their bedtimes — and the **player always chooses their own
bedtime** (never auto-slept). A simple time-of-day graphic surfaces in the HUD.

## 2. What exists today

- "Days" are ceremony beats only (`schedule.ts`); "morning/evening" is narration flavor, never state.
- Competition outcome already blends a hidden, bounded **soul emotional modifier** (0041) — the exact
  precedent a sleep term plugs into (`competitionOutcome.ts`).
- Presence/lingering (0049) seeds occupancy but is not time-aware.
- Pacing is engagement-driven (the FE lull-nudge) with no upper bound on a single beat.

## 3. Scope

**In:**
- The five-phase `TimeOfDay` model + character-driven bedtimes + the awake-set predicate (pure).
- A hidden, bounded sleep→competition penalty (symmetric; never protective).
- The player's bedtime lever (`turnIn`) and their own qualitative rest cue.
- Vault-free `timeOfDay` + player `restStatus` projections; the HUD clock + rest cue.
- **Opt-in** via `ORWELL_TIME_OF_DAY` (default off) so the seeded calibration spine is byte-identical.

**Out (clean follow-ups):**
- Wiring the time-driven **awake set into the off-screen society pairing** (calibration-sensitive —
  must isolate its own RNG stream like L21/L24; deferred to protect the juryReach golden spine).
- NPC fatigue bleeding into **next-day social volatility**; a compounding fatigue meter (ADR 0006
  Phase-2 extensions).
- Per-social-turn clock advance (today the clock moves on each `advanceGame`).

## 4. Design

- **Time advances by play, never a wall-clock** (ADR Principle 1). The clock moves one phase per
  enabled `advanceGame`, cycling morning→late-night and wrapping to a new morning — banking that the
  player was up to the bitter end if they never turned in. Dormant (and byte-identical) when off.
- **Bedtimes are character-driven** (`bedtimeFor` = `social − physical`): the social game stays up
  (night owls), the comp-focused bed early. Derived from static stats ⇒ no randomness, byte-stable.
- **The bound is diegetic** (`awakeSet` shrinks toward the player + night owls) — no curfew; the
  player is never auto-slept (`turnIn` is the only thing that retires them — Principle 6).
- **Sleep is a hidden, bounded comp term** (`outcome.sleepPenalty ~0.15`) added beside the emotional
  modifier in `resolveCompetition`; 0 by default ⇒ byte-identical (Principle 4, never protective).
- **The Vault Wall holds** (Principle 5): NPC sleep is engine-only; the player's *own* tiredness is a
  qualitative `restStatus` cue (never a number, never any NPC's).

## 5. Contracts (stack-agnostic)

```
domain:  TimeOfDay = morning|afternoon|evening|night|late-night
state:   liveSeason.timeOfDay?, playerRetired?, lastSleepPhase?   (engine-only; optional ⇒ dormant)
pure:    nextPhase · bedtimeFor(stats) · isAwakeAt · awakeSet · restDeficitFor · restStatusFor
comp:    Competitor.restPenalty? (0..1) → score −= restPenalty·sleepPenalty   (0 ⇒ byte-identical)
ctx:     SeasonCtx.restOf?(id)   (player: last night; npc: bedtime habit; 0 unless clock running)
lever:   GameSession.turnIn()    (player-only; rolls to morning, banks the bedtime)
read:    GameStateView.timeOfDay, PublicGameStatus.timeOfDay, PlayerCard.restStatus  (Vault-free)
flag:    ORWELL_TIME_OF_DAY (default off) gates every clock mutation + restOf
```

## 6. Definition of Done

- `tests/unit/timeOfDay.test.ts` — the pure model: phases advance/clamp; bedtimes are deterministic;
  the awake set shrinks monotonically to the player + night owls; the player is never auto-slept; the
  rest deficit/cue are monotonic in lateness.
- `tests/unit/sleepCompetition.test.ts` — the comp term is real, symmetric, never protective, refuses
  non-finite input, and is **byte-identical when absent**.
- `tests/unit/timeOfDaySession.test.ts` — end-to-end through the adapter (flag on): the clock surfaces
  and advances; `restStatus` appears; the bedtime lever rolls to morning; **NPC sleep never leaks**;
  and the whole feature is **dormant when off**.
- The full fast suite stays green (the dependency-cruiser Vault-Wall + vault-sentinel + replayability
  + persistence all unchanged): the opt-in guarantees the juryReach/UAT calibration spine is unmoved.

## 7. Dependencies & traceability

- Builds on: 0049 (presence), 0041 (the hidden emotional modifier), 0028/0006 (outcome resolution).
- Governed by: ADR 0006; the Vault Wall (0001) and anti-sycophancy mandates.
- Followed by: the Out items in §3 (off-screen awake-set pairing; NPC social fatigue; the calibration
  pass once enabled).

## 8. Implementer-ready (built)

- Pure: `src/engine/timeOfDay.ts`.
- Engine: `src/engine/liveSeason.ts` (state + `advanceClock`/`playerTurnIn`/`restOf`),
  `src/domain/competitionOutcome.ts` + `src/domain/temperatureConstants.ts` (the sleep term).
- Adapter: `src/adapters/engine/GameSessionAdapter.ts` (the opt-in clock advance, `restOf`, `turnIn`,
  the `timeOfDay`/`restStatus` projections).
- Port + seam: `src/ports/GameSession.ts`, `src/surfaces/tools/registry.ts`, `src/adapters/mcp/McpServer.ts`.
- FE: `frontend/static/js/orwellStatusPanel.js` (the clock chip + the player's rest cue).
- **Deploy:** set `ORWELL_TIME_OF_DAY=1` on the engine service to turn the feature on.
