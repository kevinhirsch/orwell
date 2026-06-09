# 0035 — Live off-screen life (start the watcher in the runtime)

> **Status:** **Built** (core wired live; not yet BDD-gated). The `SystemClock` real-timer adapter
> (`src/adapters/time/SystemClock.ts`), `composeRuntime()` (`src/composition/runtime.ts`), and the
> `main.ts` instantiation + `start()` of the `GameWatcher` all shipped — so the watcher **runs in the live
> runtime** (cadence via `ORWELL_WATCHER_*`; `TICK_MS=0` disables). **Remaining:** the off-screen *content*
> the tick runs is thin (a 4-verb stub) — the depth is **0038**; and 0035 is **not yet in `cucumber.cjs`**
> (added with 0038). The text below is the original gap analysis (now closed by the build).
> *(Historical:)* Feature 0031 built the `Orchestrator` + `GameWatcher` + the `Clock`/`Scheduler` port
> (BDD-green with a **fake** clock), but the live runtime never started them and there was **no real-timer
> `Clock` adapter** — so the live game had zero off-screen NPC life. This feature wired 0031 into the runtime.
> **Executable spec:** [`0035-live-offscreen-life-running-watcher.feature`](./0035-live-offscreen-life-running-watcher.feature)

## 1. Summary

`src/main.ts` builds only `new GameSessionRegistry(...)` + `startHttpMcp(...)` — **no orchestrator, no
watcher, no clock**. `src/composition/registry.ts` never instantiates `GameWatcher`/`Orchestrator`
(only the comment on its snapshot method mentions 0031). `src/adapters/time/` contains **only**
`FakeClock.ts`. Net: the watcher that's supposed to (a) tick **bounded off-screen advances** on idle
sandboxes and (b) audit integrity **only runs in tests**. The audit verdict: *the house does not evolve
between turns; no off-screen gossip; no hidden drift; `socialRead`'s suspicion hint never fires because
zero off-screen events ever exist in the live game.*

This is the same "built in isolation, not wired live" pattern as 0023/0030/0034 — here for **0031**.
Closing it is the single highest-impact functional change for behavioral fidelity.

## 2. What's missing (the precise gap)

| Piece | State |
|---|---|
| `Orchestrator.advance()` spine (off-screen tick → schedule → fold → persist → checkpoint) | ✅ built (0031) |
| `GameWatcher` (idle off-screen ticks + audit, cadence-`0` disable) | ✅ built (0031) |
| `Clock`/`Scheduler` port | ✅ built (0031) |
| `FakeClock` (deterministic, tests) | ✅ built |
| **Real-timer `Clock`/`Scheduler` adapter (prod)** | ⛔ **missing** |
| **Runtime instantiation + `start()` in `main.ts`/composition** | ⛔ **missing** |
| **Env config for cadence/idle/rate-limit** | ⛔ **missing** |

## 3. Scope

**In:** a **real-timer `Clock`/`Scheduler` adapter** (sibling to `FakeClock`, e.g. `SystemClock` —
`now()` = `Date.now()`, `every()` = `setInterval`, `cancel()` = `clearInterval`); **instantiate + start**
the `GameWatcher`/`Orchestrator` over the live `GameSessionRegistry` in the runtime composition
(`main.ts` or a small runtime root); **env-configured** cadence/idle-threshold/`maxOffscreenTicksPerWake`
(0031's `cfg`); **graceful start/stop**; keep the **fake clock** in tests and **cadence `0` ⇒ disabled**
(pure turn-driven fallback) intact.

**Out:** the orchestrator/watcher **logic** (built — 0031; reused, not changed); the turn-driven spine;
the off-screen-sim **content** (0003); multi-process/distributed scheduling (single-process for now).

## 4. Design

- **`SystemClock` adapter** implementing the 0031 `Clock`+`Scheduler` port with real timers. Unref the
  interval so it never blocks process exit.
- **Runtime wiring:** in `main.ts`, after building the registry, construct the watcher
  (`new GameWatcher(registry, systemClock, systemClock, cfg)`) and `start()` it; register a clean
  `stop()` on shutdown. `cfg` from env (`ORWELL_WATCHER_TICK_MS`, `ORWELL_WATCHER_IDLE_MS`,
  `ORWELL_WATCHER_MAX_TICKS`, with sane defaults; **`ORWELL_WATCHER_TICK_MS=0` disables**).
- **Guarantees preserved (already 0031, assert under the *running* watcher):** every off-screen advance
  stays inside one sandbox (**0021 isolation**); the player sees **no opinion numbers** — only later
  behavior (**0001 Vault Wall**); each advance is **bounded/rate-limited** so a long absence can't
  fast-forward the season; integrity stays **fail-closed**.
- **Determinism:** production uses real time; **tests use `FakeClock`** (no real timers) — unchanged.

## 5. Contracts (stack-agnostic)

```
SystemClock implements Clock + Scheduler:
    now(): number = Date.now()
    every(ms, fn): handle = setInterval(fn, ms).unref(); cancel(handle) = clearInterval
main.ts (runtime):
    const watcher = new GameWatcher(registry, systemClock, systemClock, cfgFromEnv())
    watcher.start();  // on shutdown: watcher.stop()
    cfgFromEnv(): { tickEveryMs, idleTickAfterMs, maxOffscreenTicksPerWake, auditEveryMs }  // 0 disables
```

## 6. Definition of Done

- [ ] **The house lives between turns:** with the watcher running (real `SystemClock` under a short test
      cadence, or `FakeClock` stepped), an **idle** live sandbox accrues off-screen events / relationship
      drift; on the player's next turn there are **new consequences** and `socialRead` can surface unease.
- [ ] **No leak:** the player sees **no opinion numbers or hidden state** from the off-screen activity
      (extend the 0001 canary to the running-watcher path); `npm run test:arch` stays green.
- [ ] **Isolation under load:** the watcher ticking/auditing many sandboxes never carries one user's
      content into another's (0021).
- [ ] **Bounded:** a long idle stretch advances at most `maxOffscreenTicksPerWake` per wake — no
      season fast-forward.
- [ ] **Disable switch:** `tickEveryMs = 0` (or unset) ⇒ pure turn-driven (the game never self-advances),
      so deployments can opt out.
- [ ] **Started in the runtime:** `main.ts` instantiates + `start()`s the watcher with the `SystemClock`
      and stops it cleanly on shutdown. Name-agnostic tests (roles only); `npm test` green.

## 7. Dependencies & traceability

The **live realization of 0031** (reuses its `Orchestrator`/`GameWatcher`/`Clock` port and the 0003
off-screen sim) under **0001** (Vault Wall) and **0021** (isolation). Adds the missing **real-timer
adapter** + the missing **runtime instantiation**. This is the highest-priority functional gap because
off-screen NPC life is **mandate #1**; without it the live game is mechanically complete but
behaviorally inert between turns.
