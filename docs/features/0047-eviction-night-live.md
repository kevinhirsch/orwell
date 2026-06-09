# 0047 — Eviction night live (reveal + goodbye messages)

> **Status:** Draft (queue **B49**, "NEEDS SPEC FIRST"). The weekly eviction — _Big Brother_'s **defining
> beat, ~13×/season** — emits **one line** (`liveSeason.ts`). The **finale** got full staged choreography
> (0037), but the ordinary eviction did not. This feature stages it through the **0034 seam** like 0037: an
> **ordered, one-at-a-time vote reveal** (revealed-only tally, never a pre-reveal winner), an **evictee
> goodbye** beat, and **goodbye messages** from selected houseguests — recorded as events that feed eviction
> **manner** (0037 §4.2) and **jury lean** (0014). Reveal order is engine-decided + seeded.
> **Executable spec:** [`0047-eviction-night-live.feature`](./0047-eviction-night-live.feature)

## 1. Summary

Eviction night is the show's heartbeat: the votes read one at a time, the tension of a building tally, the
evicted houseguest's exit, and the goodbye messages that reveal who really had their back. Today the engine
resolves all of that into a single recorded line. 0047 gives the eviction the same live, staged treatment
the finale already has — a dramatic, Vault-safe sub-loop — and makes the **goodbye** matter: a warm send-off
vs. a cold one **measurably** shifts how that evictee (now a juror) later votes. It reuses 0037's proven
pattern (a staged view on `AdvanceView`, advanced through the decision seam).

## 2. What exists today (the gap this closes)

- **One-line eviction.** `liveSeason.ts` resolves the eviction vote and records a single event — no reveal
  order, no goodbye, no goodbye messages.
- **The finale is staged, the eviction isn't.** 0037 built `FinaleView` + the staged statements → questions →
  ordered vote reveal through the 0034 seam; the weekly eviction (far more frequent) got none of it.
- **Goodbye messages don't exist.** A core jury-management lever — how you treat someone on the way out — has
  no live representation feeding **manner**/**jury lean**.

## 3. Scope

**In:** stage the eviction through the **0034 seam** as a sub-loop (mirroring 0037): an **`EvictionView`** on
`AdvanceView` (`{ stage, nominees, votesRevealed[] }`) advanced beat-by-beat; an **ordered one-at-a-time vote
reveal** (revealed-only running tally; the outcome lands only when the last vote is read; HOH tie-break as
today); an **evictee goodbye** beat; **goodbye messages** from selected houseguests recorded as events that
feed eviction **manner** (0037 §4.2) + **jury lean** (0014). Reveal order **engine-decided + seeded**
(principle #1). Vault-safe; persisted (0030).

**Out:** the *who-is-evicted* decision (0011/0034/0045 — unchanged; this stages the **reveal** of an
already-decided vote); the finale (0037 — reused as the pattern, not re-built); the player-evicted experience
(0046 — but a player evicted here gets the goodbye beat).

## 4. Design

- **Staged sub-loop (reuse 0037's shape).** While an eviction is resolving, `advanceGame` returns an
  `EvictionView` with the current `stage` (`votes | goodbye | result`) and the **reveals so far** — exactly
  as `FinaleView` does for the finale. Each advance reveals the **next** vote.
- **Ordered reveal, no leak.** Votes are revealed **one at a time in a seeded order**; the projection carries
  **only the revealed tally** — never a pre-reveal count of unread votes, never the evictee before the last
  vote lands. The engine already decided the tally (0034); 0047 only choreographs the **reveal**.
- **Goodbye + goodbye messages.** After the result, an **evictee goodbye** beat; then **goodbye messages**
  from a seeded selection of houseguests, each recorded as an event with a **tone** (warm/cold/respectful)
  that folds into the evictee's **eviction manner** (0037 §4.2) and thus their later **jury lean** (0014).
- **Vault Wall / anti-sycophancy.** Reveal order + tally are engine-decided and seeded; goodbye tone is
  derived from real relationship state, not narration. No pre-reveal tally or hidden number crosses the wall
  (extend the 0001 canary to the `EvictionView`).

## 5. Contracts (stack-agnostic)

```
AdvanceView += eviction?: EvictionView | null            // present only while an eviction stages
EvictionView: { stage: "votes"|"goodbye"|"result", nominees: NamedRef[], votesRevealed: { voter, votedFor }[] }
reveal: one vote per advance, seeded order; revealed-only tally; outcome lands on the last vote (HOH tie-break)
goodbye: an evictee goodbye beat + goodbye messages (tone) → eviction manner (0037 §4.2) → jury lean (0014)
invariants: engine-decided + seeded reveal; no pre-reveal tally/leak (0001); persisted (0030)
```

## 6. Definition of Done

- [ ] **Staged reveal:** an eviction reveals votes **one at a time** in a **seed-deterministic** order, with
      a revealed-only tally; the evictee is not knowable before the last vote.
- [ ] **No leak:** no pre-reveal tally or hidden vote appears on any player surface (extend the 0001 canary
      to `EvictionView`).
- [ ] **Goodbye matters:** a **respectful** vs. a **cold** goodbye **measurably** moves the evictee's later
      **juror lean** (asserted with a seeded source) via recorded manner (0037 §4.2 / 0014).
- [ ] **Through the seam:** the staging advances via the 0034 `advanceGame` seam (like 0037); restart
      mid-reveal resumes (0030).
- [ ] 0034/0037/0014 scenarios stay green; name-agnostic (roles only — HOH/nominee/evictee/voter/juror);
      `0047` added to `cucumber.cjs`; `npm test` green.

## 7. Dependencies & traceability

Extends the **0034** decision/advance seam with an eviction sub-loop, reusing **0037**'s staged-reveal
pattern + its **eviction-manner** (§4.2), feeding **0014** jury lean, under **0001** (Vault Wall) and
**0030** (restart). Sibling to **0045** (the endgame the eviction runs within) and **0046** (a player evicted
here gets the goodbye beat).

## 8. Implementer-ready (Definition of Ready)

**Touch points (exact):**
- `src/engine/liveSeason.ts` — the one-line eviction site (~L403): turn it into a staged sub-loop (a
  `FinaleProgress`-style `EvictionProgress` with `stage` + a seeded reveal order); add the goodbye + goodbye-
  message beats; fold tone into manner via `jury.ts` `mannerToward`.
- `src/ports/GameSession.ts` — add `EvictionView` + `AdvanceView.eviction?`; `GameSessionAdapter` projects it
  (Vault-free; mirror the existing `finaleView()` projection).
- Goodbye-message tone reads the relationship model; recorded as events (the existing event sink).
- Extend the **0001** sentinel canary to the `EvictionView` projection (no pre-reveal tally).

**Build order / deps:** 0037 (the staged-reveal pattern + manner) + 0034 + 0014 are built — this mirrors
them for the weekly eviction. **Test targets:** `tests/unit/evictionNight.test.ts` +
`docs/features/0047-*.feature` → `cucumber.cjs`. Assert §6 (esp. seeded reveal order, no pre-reveal leak, and
the warm-vs-cold goodbye → jury-lean delta).
**No open decisions.** Reveal one vote per advance, seeded order, revealed-only tally — the 0037 shape.
