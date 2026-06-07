# 0008 — Daily-event invariant

> **Status:** Draft. **Build priority:** #8.
> **Executable spec:** [`0008-daily-event-invariant.feature`](./0008-daily-event-invariant.feature)

## 1. Summary

Every in-game day contains **at least one meaningful event** — an HOH competition, a
nomination or veto ceremony, a vote or eviction, or a significant house event. A **"week" is
one HOH reign** (HOH competition → eviction), not a fixed number of calendar days. Rest days
are a **rare, deliberate** exception and still carry a significant house event.

## 2. Scope

**In:** the loop/scheduler guarantee of ≥1 meaningful event per completed day; the
week-as-HOH-reign definition; the rare-rest-day bound.

**Out:** the *content/quality* of events (covered by #3) and the *outcomes* of competitions
(#6).

## 3. Contracts (stack-agnostic)

```
Clock / Scheduler:
    advanceDay(state) -> state'        # post-condition: day just completed has >= 1 meaningful event
Week = one HOH reign (HOH competition ... eviction); day-count may vary
MeaningfulEvent ∈ { HOH comp, nominations, veto comp, veto ceremony, eviction, significant house event }
```

## 4. Test strategy

- **Seeded season** simulation; assert **every** completed day has ≥1 meaningful event
  (property over seeds).
- Assert a week begins with an HOH comp and ends with an eviction, with a variable day count.
- Assert rest-day frequency stays below the configured rare threshold, and that any rest day
  still contains a significant house event.

## 5. Definition of Done

- [ ] All scenarios pass across the seed set, name-agnostic.
- [ ] No completed in-game day is ever empty.
- [ ] Week defined by HOH reign, not calendar days.
- [ ] Rest days provably rare and never truly empty.

## 6. Dependencies

The domain-core weekly loop, the `Clock`/`Scheduler`, and the event substrate (#2). Lightly
touches #3 (the "significant house event" category).

## 7. Traceability

`bb-sim-spec.md` §3, §12 (meaningful-event scenario); `docs/legacy/BB_GameBible.md` §4
(daily pacing; definition of a week); `CLAUDE_CODE_INSTRUCTIONS.md` §14.
