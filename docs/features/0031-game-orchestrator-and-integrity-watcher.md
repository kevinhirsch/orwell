# 0031 — Game orchestrator & integrity watcher (per-sandbox)

> **Status:** Built (see the [README status index](./README.md#index)). A **per-sandbox game orchestrator** with two layers: (1) a **turn-driven**
> deterministic spine — one `advance()` path that runs the off-screen NPC tick, applies the next
> scheduled meaningful day, folds consequences, persists, and runs an **integrity checkpoint**; and
> (2) a **background watcher/scheduler** that, on a wall clock, triggers **bounded off-screen
> advances on idle games** (the house lives between sessions) and **audits every live sandbox's
> integrity/health**, surfacing a read-only status to **God Mode**. The watcher is a *trigger and
> auditor only* — **all game logic lives in the turn-driven `advance()`**, so a **fake clock** makes
> the daemon fully deterministic and testable. Implements the long-planned **`Clock`/`Scheduler`
> port**. Answers the question *"is there a watcher/scheduler that tracks each game and verifies
> integrity?"* — today there is **none** (§2).
> **Executable spec:** [`0031-game-orchestrator-and-integrity-watcher.feature`](./0031-game-orchestrator-and-integrity-watcher.feature)

## 1. Summary

Today the engine is **pull-only**: a game advances solely when the front-end/agent calls a tool, the
**off-screen NPC simulation never ticks on the live path** (so the house is inert between turns — a
direct miss against the off-screen-life mandate), and **no process verifies integrity at runtime**
(non-degradation, Vault Wall, and isolation are proven only in tests). This feature adds the missing
**orchestration + verification** layer, as a hybrid:

- **Turn-driven spine (deterministic).** Every advance — player-triggered or watcher-triggered —
  flows through **one** `Orchestrator.advance()`: off-screen tick → next scheduled meaningful day →
  consequence fold → persist → **integrity checkpoint** (fail-closed). Seeded, pure-logic, unit-testable.
- **Background watcher (supervisor).** Behind a **seedable `Clock`/`Scheduler` port**, a wall-clock
  loop that (a) triggers a **bounded off-screen advance** on *idle* sandboxes so the house keeps
  scheming/drifting between sessions, and (b) runs the **integrity audit** across all live sandboxes,
  updating a per-sandbox **health record** exposed read-only to **God Mode**. It holds **no game
  logic** — it only *triggers* `advance()` and *reads* health — so a **fake clock** makes it
  deterministic in tests, and a cadence of `0` disables it (pure turn-driven fallback).

## 2. What exists today (the gap this closes)

| Capability | Where | Wired to the LIVE runtime? |
|---|---|---|
| Season orchestration (HOH→…→jury) | `season.ts` `playSeason` | ❌ test-only (`jury_endgame.steps.ts`) |
| Day scheduler / daily-event (0008) | `schedule.ts` `scheduleWeek` | ❌ test-only |
| Off-screen NPC life / gossip (0003) | `simulation.ts`, `offscreen.ts`, `gossip.ts` | ❌ test-only (`richness.ts` + steps) |
| Non-degradation check (0007) | `saveState.ts` `isSuperset`, `countsNonDecreasing` | ❌ test-time assertion |
| Vault-Wall / isolation sentinels (0001/0021) | sentinel canaries, dependency-cruiser | ❌ build/test-time gate |
| `Clock`/`Scheduler` port | — (named in `CLAUDE.md` architecture) | ⛔ **does not exist** |
| Runtime orchestrator / watcher / health audit | — | ⛔ **does not exist** (`main.ts` = registry + HTTP, no loop) |

Net today: phases don't auto-advance, off-screen life never runs live, and nothing audits a running
sandbox. **This feature wires the existing pure logic into a live, verified, supervised loop.**

## 3. Scope

**In:** the per-sandbox `Orchestrator` (`advance()` spine); the **integrity checkpoint** (fail-closed,
runs on advance + audit); the **`Clock`/`Scheduler` port** + a real-timer adapter and a **fake-clock**
test adapter; the **background watcher** (idle-game off-screen ticks + integrity audit, bounded &
seeded); a Vault-free **God Mode health surface** (0016); wiring the off-screen sim (0003) into the
live advance.

**Out:** the off-screen simulation *content* itself (0003 — reused, not rebuilt); the relationship/
consequence math (0023/0026 — folded, not redefined); the durable store (0030 — the checkpoint runs
against its snapshots); multi-process/distributed scheduling (single-process in-registry watcher for
now); any player-facing surfacing of integrity/health (it's **admin/God-Mode only**, Vault-walled).

## 4. Design

### 4.1 Turn-driven spine — `Orchestrator.advance(sandbox, trigger)`
The **single** code path that moves a game. `trigger` ∈ `{ "player-turn", "offscreen-tick", "audit" }`.
1. **Off-screen tick** — run the 0003 sim for this sandbox (NPC-to-NPC scenes the player doesn't
   witness, gossip diffusion, relationship drift) via the seeded `RandomnessSource`.
2. **Schedule** — advance to the next **meaningful day/phase** (0008/0011); guarantee ≥1 meaningful event.
3. **Consequence fold** — apply hidden impact to soul/relationships (0023) for the new events.
4. **Persist** — save the snapshot (0030).
5. **Integrity checkpoint** (§4.3) — verify, **fail-closed**.

Pure-logic and **seed-deterministic**: identical seed + identical trigger sequence ⇒ identical state.

### 4.2 Background watcher — behind `Clock`/`Scheduler`
A supervisor loop, **trigger/auditor only** (no game logic):
- On each clock tick, for every live sandbox **idle** longer than `IDLE_TICK_AFTER`: call
  `advance(sandbox, "offscreen-tick")`, **rate-limited** (`MAX_OFFSCREEN_TICKS_PER_WAKE`) so a long
  absence doesn't fast-forward the whole season. The house evolves between sessions; on return the
  player meets new consequences (never numbers).
- On each `AUDIT_EVERY`, call `advance(sandbox, "audit")`'s checkpoint (verify only, no progression)
  and update the **health record**.
- **Determinism/testability:** real-timer adapter in prod; **fake-clock** adapter in tests (advance
  time explicitly — no real timers). Cadence `0` ⇒ watcher off ⇒ pure turn-driven.
- **Isolation:** iterates sandboxes but every `advance`/audit stays inside one sandbox; never carries
  state across users (0021). Never reaches the Vault from any outward read.

### 4.3 Integrity checkpoint (fail-closed)
Verifies the LIVE state against the prior persisted baseline; **on failure it refuses to commit the
advance and records a fault — never persists a degraded/leaky state** (mandate #4):
- **Non-degradation** (0007): `isSuperset` + `countsNonDecreasing` vs the last snapshot.
- **Daily-event** (0008): the advance produced ≥1 meaningful event.
- **Eligibility legality** (0005): the week's ceremony state is legal.
- **Vault Wall** (0001): the player **and** admin projections are **sentinel-clean**.
- **Cross-user isolation** (0021): this sandbox's outputs carry no other sandbox's sentinels.

### 4.4 God Mode health surface (0016, Vault-free)
A read-only admin tool `sandboxHealth()` → **metadata only**, never game content or Vault:
`{ user, started, week, phase, lastAdvanceAt, lastTrigger, eventCount, lastIntegrity: "ok"|"fault",
faults: [{ when, kind }] }`. Sentinel-clean; dependency-cruiser stays green (no Vault import).

## 5. Contracts (stack-agnostic)

```
Clock (port):        now(): number
Scheduler (port):    every(ms, fn): handle; cancel(handle)        // fake adapter for tests
Orchestrator:
    advance(sandbox, trigger): { events: number, integrity: "ok"|"fault", faults?: Fault[] }
    checkpoint(sandbox): { ok: boolean, faults: Fault[] }          // verify only (fail-closed)
GameWatcher(registry, clock, scheduler, cfg):
    start(); stop()                                                // idle off-screen ticks + audits
    cfg: { tickEveryMs, idleTickAfterMs, maxOffscreenTicksPerWake, auditEveryMs }  // all tunable; 0 disables
AdminPort (add):  sandboxHealth(user?): HealthRecord | HealthRecord[]   // Vault-free, sentinel-clean
```

## 6. Definition of Done

- [ ] **One `advance()` spine:** a player-triggered advance runs the off-screen tick, schedules ≥1
      meaningful event (0008), folds consequences (0023), persists (0030), and passes the checkpoint.
- [ ] **The house lives between turns:** with a **fake clock**, an idle sandbox accrues off-screen
      events/relationship drift; on return the player meets new consequences but **no numbers** (0001).
- [ ] **Integrity is fail-closed:** an advance that would degrade detail (drop events/memory/edges) or
      leak a sentinel is **refused**, the prior save is intact, and a **fault** is recorded.
- [ ] **The watcher is deterministic & logic-free:** same seed + same fake-clock ticks ⇒ identical
      state; disabling it (cadence 0) yields pure turn-driven behavior (games never self-advance).
- [ ] **Isolation under the watcher:** auditing/ticking many sandboxes never leaks one user's content
      into another (cross-user sentinel, 0021).
- [ ] **God Mode health is Vault-free:** `sandboxHealth()` returns metadata only, is sentinel-clean
      on player **and** admin canaries, and `npm run test:arch` stays green (no Vault import).
- [ ] Name-agnostic tests (roles only); `npm test` green.

## 7. Dependencies & traceability

Wires together **0003** (off-screen sim), **0007** (non-degradation primitives), **0008** (schedule),
**0011** (season loop), **0023** (consequence fold) + **0030** (durable snapshots the checkpoint
compares against), under **0001** (Vault sentinel) and **0021** (per-user isolation), surfaced via
**0016** (God Mode). Implements the **`Clock`/`Scheduler`** port named in `CLAUDE.md`'s architecture.
Answers the product question: *no runtime orchestrator/watcher/integrity-verifier exists today* — this
is it, built as a hybrid (deterministic turn-driven spine + background supervisor).

## 8. Shipped defaults & clarifications (PO review 2026-07-06)

- **The background wall-clock watcher is OFF by default** (`ORWELL_WATCHER_TICK_MS=0`; ruling
  2026-06-10, wired in `src/composition/runtime.ts`). Production runs **pure turn-driven**: the
  house does NOT advance while the player is away (NPCs can't leave the house, the player can — a
  background advance during an absence would be a structural disadvantage). Instead the orchestrator
  fires **one bounded off-screen tick per player turn** (`maybeTurnDrivenTick`), so the house still
  lives turn-to-turn. The watcher (scenario 2's wall-clock idle ticks) is an **opt-in operator knob**,
  never the default. So "advance" in normal play is **player-turn-triggered**, not clock-triggered.
- **Advance vs. in-game time (the two tracks).** An "advance" is one *committed player turn* (snapshot →
  work → verify → keep-or-revert). It is **not** 1:1 with a ceremony **beat**: ceremony beats
  (HOH → noms → veto → veto-ceremony → eviction) are the **sparse plot milestones** (~one per in-game
  day) and only progress on the turn that performs the ceremony action; **most turns are lingering /
  conversation** that advance the **in-game time-of-day** (0066, via `advanceClockPerConversation`) and
  run the off-screen life **without** moving the ceremony beat. Time-of-day (0066) is the finer-grained
  *pacing of a day* that fills the space between the sparse beats; as the in-game night gets late the
  awake set shrinks (0049) and the day ends by running out of *people*, not a timer. The orchestrator's
  turn commit is the seam that carries the 0066 clock forward — they are the same heartbeat, not rival
  clocks.
- **Health record.** The live `HealthRecord` also carries a `circuitOpen` flag (a resilience
  circuit-breaker: repeated off-screen-tick faults open the circuit so a wedged sandbox stops being
  hammered; any clean advance closes it) beyond the §4.4 metadata list — still Vault-free metadata only.
