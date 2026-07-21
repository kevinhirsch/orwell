# 0132 — Full live per-NPC cognition (re-simulate every active houseguest's head each turn; the ambitious version of 0131)

> **Status:** ✅ **Specced** (2026-07-21); awaiting faithful-seam cluster (Theme A/B) landed/in
> flight before build begins. **Maximal version** of 0131's S1: instead of salience-gating (author
> only 1–2 NPCs per turn), **re-simulate *every* active houseguest's cognition live, each turn**.
> Each NPC's want/read/attempt refreshed from a per-NPC scoped call before the beat is narrated.
> Ambitious because it was R3 (passed on for cost); owner opted in ("let's do this"). See also 0131
> (salience-gated fallback mode). **Source:** Sonder design discussion + R3 cost-benefit analysis;
> owner request. **Hard constraints inherited (ADRs 0003/0005/0019/0021):** cognition-only,
> never outcome; fan out cognition, funnel narration; knowledge-scoped per call; soul-anchored.

## 1. Summary

The maximal per-NPC cognition enhancement: **every active houseguest's intent re-simulated live each
turn**, not just the 1–2 salience-gated NPCs of 0131's S1. Each NPC's want/read/attempt refreshed
from a scoped call, fed the tight `stateDelta` ("what changed for you since your last sim"), before
the beat is narrated. This is the thing 0131 deliberately bounded for cost; 0132 engineers the cost
down so "every NPC every turn" is viable while keeping the four integrity lines:

1. Cognition-only, never outcome (model proposes, engine disposes; ADR 0005).
2. Fan out cognition, funnel narration (one voice, not N; ADR 0021).
3. Knowledge-scoped per call, gated on engine presence (not narrated; ADR 0019).
4. Soul-anchored (continue persisted character, don't re-roll; 0041).

The cost engineering: **parallel cheap-tier calls over the awake set, delta-fed prompts, budget guard
with graceful degradation to 0131-S1 (salience-gated) under pressure.** A/B the flag to measure
feel (richer/more-independent play) vs. cost (tokens/latency).

## 2. What exists today (the gap this closes)

- **0131 gates by salience (1–2 NPCs per turn).** Deliberate cost control: only author intent for
  the NPCs whose situation measurably changed. Real-time constraints make every-NPC-every-turn too
  expensive.
- **Deterministic floor runs for the rest.** The other NPCs tick off-screen, using the engine's
  seeded resolver with no authored intent. Emergent play is real, but it's less rich than if every
  NPC had a live, authored read on the current moment.
- **The question:** does live-every-NPC produce materially richer/more-independent play than
  salience-gated? And at what cost? Owner wants to explore this (opt-in mode, flagged, A/B'able).

## 3. Scope

### In:

- **Full-fidelity mode: every active houseguest's cognition re-simulated live, each turn.**
  - **Awake-set bound:** "every NPC" in practice = the awake set (0066 sleep economy shrinks the
    active cast late-night). No re-simulating NPCs who are off-screen asleep.
  - **Parallel cheap-tier calls:** all N per-NPC calls fire in parallel (e.g., utility model,
    Qwen-flash class), fail-soft over the deterministic floor (timeout or garbage ⇒ that NPC runs
    the floor this turn; turn never blocks).
  - **Delta-driven prompts:** each NPC call fed only a `stateDelta` (feature 0065: "what changed for
    you since your last sim"), not the full context. Keeps per-call tokens tiny (O(1) to O(N) instead
    of O(N²)).
  - **Output:** same as 0131-S1 — structured intent {kind, target, emphasis}, persisted as soul
    state, folded into the resolver.
  - **Budget guard:** per-turn ceiling on tokens + latency. When pressure exceeds budget:
    **graceful degrade to 0131-S1 (salience-gated mode)** — fire only for the top K by salience,
    rest use deterministic floor. Make this a **flag** so full vs. gated can be A/B'd.
  - **Failure-surface containment:** N structured-JSON calls = N malformed-output chances; each
    validated + fail-soft (never load-bearing). Belt-fire telemetry (success-gated contract,
    `docs/CLAUDE.md`): a belt fire = an applied correction (a cognition call produced a real
    authored intent), never a mere attempt or no-op.

- **Cost model + graceful degradation architecture.**
  - Document expected tokens/latency per turn at cast size N (e.g., 15 NPCs at ~50 tokens per call
    = ~750 tokens; Qwen-flash class = tens of ms per call, parallel = ~100ms wall-clock + 15 LLM
    tokens-per-second = ~50ms serialized throughput, total ~150ms).
  - Define budget ceiling: when `(tokens_this_turn + projected_N_intent_tokens) > BUDGET_MAX` or
    `latency > LATENCY_MAX`, **switch to salience-gated mode** (0131-S1) this turn; next turn
    resume full-fidelity if budget permits.
  - Implement graceful degrade: maintain a running ledger of cost; when budget pressure rises,
    reduce N from awake set to K by salience; if pressure falls, re-expand.

- **A/B feel-vs-cost evaluation.**
  - Flag to enable/disable full-fidelity mode (default: TBD at design time — likely *on* if cost
    modeling proves viable, *off* if latency is problematic).
  - Telemetry: per-turn `cognitionMode` (full vs. gated), `npcCount`, `totalTokens`, `latency`,
    `gracefulDegrades` (times we dropped to salience-gated). Aggregate per session.
  - After a week of real play, compare feel/emergence/richness (full) vs. cost (gated); owner makes
    default-mode call.

### Out:

- **Engine closed-set authority unchanged.** Per ADR 0005, NPCs do not author outcomes; the
  resolver is still the source of truth.
- **Narration stays monolithic.** One voice writes every NPC's words (ADR 0021); cognition calls
  emit data only.
- **0131-S2 (divergent memory) and 0131-S3 (paraphrase-residual)** are distinct; 0132 is a variant
  on 0131-S1 (intent) only, scaling it to every NPC with cost controls.

## 4. Design

- **Awake-set computation.**
  - At the start of each beat, compute the awake set: houseguests currently awake (time-of-day,
    rest penalty, personal schedule; 0066).
  - This is the max N for per-NPC calls this turn. (Late night → smaller awake set → fewer calls,
    lower cost.)

- **Per-NPC call architecture (parallel, delta-fed, cheap-tier).**
  - For each NPC in the awake set (up to cost budget):
    - Fetch their soul state (character + current goals + relationships + persisted divergent
      memories from 0131-S2).
    - Fetch the `stateDelta` from feature 0065 (just the board facts that changed since their last
      sim — no full context).
    - **Call a cheap-tier model** (Qwen-flash, ~50 tokens per call, cost-optimized) with the per-NPC
      bounds.
    - Validate output (JSON schema; fail if malformed).
    - Fold into resolved outcome as a weighted input (same as 0131-S1).
    - Persist result in soul state (cache for repeated scenes within the lull, like 0131-S1).
  - Fire all N calls **in parallel** (e.g., via `Promise.all`); timeout after T ms; any timeout
    becomes deterministic floor for that NPC.

- **Budget guard + graceful degradation.**
  - Maintain a per-session cost ledger: running total of tokens + latency.
  - Before firing the full awake set, **estimate the cost:** `awake_count * avg_tokens_per_call +
    base_overhead`.
  - Compare to budget: `BUDGET_MAX_TOKENS` + `BUDGET_MAX_LATENCY`.
  - If estimate > budget, **switch to salience-gating this turn:**
    - Compute salience for the awake set.
    - Fire only the top K by salience (e.g., K = 2).
    - Persist this decision in the ledger (`gracefulDegrades += 1`).
  - Next turn, re-check budget; if budget permits, re-expand to full awake set.
  - **Make this a flag** so the mode can be toggled on/off for A/B testing.

- **Belt-fire telemetry (success-gated contract).**
  - A belt fire is an **applied correction** — the scoped call produced a real intent that was
    folded into the resolver.
  - Not a mere selection, not a no-op, not a failed validation. Only count successful folds.
  - Per-turn ledger: `{turnSeq, cognitionMode, awakeCount, npcsCalled, tokensUsed, latencyMs,
    gracefulDegrades, beltsFired}`.

## 5. Contracts (stack-agnostic)

```text
0132 Full live per-NPC cognition (full-fidelity vs. salience-gated graceful-degrade):
  per-turn:
    compute awake set (0066 sleep economy) → estimate cost
    if cost > budget: degrade to salience-gated (0131-S1, top K by salience)
    else: fire all N awake-set per-NPC intent calls in parallel
    
  per-NPC call (parallel, cheap-tier, delta-fed):
    input: character + soul + relationships + divergent memories + stateDelta (0065)
    output: structured intent {kind, target, emphasis}
    validate JSON; fail-soft (timeout / malformed → deterministic floor for that NPC)
    fold into resolver (input to outcome, not the outcome itself; ADR 0005)
    persist in soul state (cache for repeated scenes within lull)
    
  budget guard:
    tokens_budget_max = BUDGET_MAX_TOKENS (e.g., 2000 per turn)
    latency_budget_max = BUDGET_MAX_LATENCY (e.g., 500ms)
    graceful_degrade: when pressure > budget, switch to salience-gated (K NPCs by salience)
    ledger: per-turn {cognitionMode, npcCount, tokensUsed, latency, gracefulDegrades, beltsFired}
    
  integrity gates (inherited from 0131 + new cost-control):
    cognition-only (engine owns resolve/state)
    funnel narration (one voice, not N per-NPC; ADR 0021)
    knowledge-scoped (engine presence gated, ADR 0019)
    soul-anchored (continue persisted character; 0041)
    cost-controlled (budget guard, graceful degrade)
    fail-soft (timeout/malformed → floor)
    expressiveNonCollapse (closed set unchanged, open set enriched)
```

## 6. Definition of Done (when built)

- [ ] **Full-fidelity mode:** every NPC in awake set fires a per-NPC intent call; results fold into
      resolver correctly; cache works (repeated scenes = cached intent).
- [ ] **Parallel execution:** all N calls fire concurrently; timeout after T ms; timeout → floor
      for that NPC (turn never blocks).
- [ ] **Delta-fed prompts:** each call receives only `stateDelta` (change since last sim), not full
      context; per-call tokens stay <100.
- [ ] **Budget guard + graceful degrade:** cost ledger computed; when budget exceeded, degrade to
      salience-gated (0131-S1, K by salience); when budget permits, re-expand to full awake set.
- [ ] **Flag toggleable:** full-fidelity mode can be enabled/disabled per game; telemetry
      distinguishes mode per turn.
- [ ] **Belt-fire telemetry (success-gated):** per-turn ledger records cognitionMode, npcCount,
      tokensUsed, latency, gracefulDegrades, beltsFired; only successful folds count.
- [ ] **Integrity gates green:** `expressiveNonCollapse` test confirms closed set unchanged;
      Vault canary extended; knowledge-scoped gate passes; soul-anchor holds.
- [ ] **Cost model validated:** measured tokens/latency per turn at cast size N; budget ceiling
      confirmed; graceful degrade works (no stalls).
- [ ] **A/B evaluation:** after a week of play with full-fidelity mode on, measure feel (emergence,
      richness, NPC independence) vs. salience-gated; telemetry supports owner decision on
      default mode.
- [ ] **Seed-deterministic; name-agnostic (roles only); restart mid-cognition-call resumes (0030);
      0132 added to feature status docs; `npm test` green.**

## 7. Dependencies & traceability

**Depends on (must land or be in flight first):**
- **Faithful-seam cluster (Theme A/B):** #1726 (engine-presence gating), #1735 (terminal
  constraints).
- **0131 (per-NPC authored cognition, salience-gated):** 0132 is the full-fidelity version of 0131-S1;
  0131 is the fallback mode when budget pressure rises.
- **Feature 0065 (closed-set sync spine + `beatSeq`, `stateDelta`):** 0132 feeds each NPC a tight
  `stateDelta` (O(1) change since last sim), not full context.
- **Feature 0066 (in-game time + sleep economy):** awake set is computed from time-of-day + rest
  state.
- **Feature 0041 (character evolution):** soul-anchoring; 0132 folds intent back into soul via
  `evolveFromBeat`.
- **ADR 0019 (per-NPC knowledge scoping):** parallel calls must be knowledge-scoped to avoid re-opening
  leak N times.
- **ADR 0021 (one-voice architecture):** calls emit data only; narration stays monolithic.

**Complements:**
- **0131 (salience-gated S1/S2/S3):** 0132 extends 0131-S1; 0131-S2/S3 are orthogonal (divergent
  memory, paraphrase-residual).
- **Feature 0055 (auto-record scene):** 0132 intent can inform the auto-record mechanism.

## 8. Implementer-ready (Definition of Ready) — when scheduled

**Touch points (exact):**
- `src/adapters/engine/GameSessionAdapter.ts` — per-turn, before narration, compute awake set
  (feature 0066) and estimate cost. If cost > budget, use salience gate (0131-S1); else fire full
  set.
- `src/engine/liveSeason.ts` — integrate per-NPC intent calls: fetch soul + stateDelta, call
  cheap-tier model in parallel, validate, fold into resolver.
- **Parallel call infrastructure:** wire a concurrency pool (e.g., `Promise.all` with timeout
  guard); fail-soft on timeout/malformed JSON.
- **Cost ledger:** maintain per-session running totals of tokens, latency, graceful-degrade events,
  belt-fire successes. Write to game state or telemetry log per beat.
- **Graceful degrade logic:** when `(tokens_this_turn + projected_N_calls) > BUDGET_MAX`, set
  `cognitionMode = 'salience-gated'` and reduce N to top K by salience. Next turn, re-check budget.
- **Flag:** `ORWELL_COGNITION_FULL_FIDELITY=1` (default TBD); telemetry includes flag state per
  turn.
- **Belt-fire telemetry (success-gated contract):** per-turn ledger only counts successful folds,
  never attempts or no-ops. Aggregate `beltsFired` per session.
- **Extend the 0001 Vault canary** to full-fidelity beats; no hidden state crosses.
- **Tests:** `tests/unit/fullLivePerNpcCognition.test.ts` (parallel calls, timeout handling, budget
  guard, graceful degrade, cost model, belt-fire success-gating) +
  `expressiveNonCollapse.test.ts` (closed set unchanged) + FE
  `frontend/tests/test_…_full_cognition.py` (end-to-end parallel calls + cost telemetry).

**No open decisions** (TBD at build/A/B time only):
- Default mode (full-fidelity on/off at launch) — decided by A/B results.
- Exact budget ceilings (`BUDGET_MAX_TOKENS`, `BUDGET_MAX_LATENCY`) — tuned after cost model
  validates.
- Salience-gate K (how many to fire when degraded) — likely 2–3, same as 0131-S1.
- Per-NPC call timeout duration (T ms) — likely ~1000ms (wall-clock timeout, not LLM token limit).

---

*Provenance: multi-audit backlog 2026-07-21 — R3 (every NPC every turn) was passed on for cost;
owner opted in ("let's do this") and requested full-fidelity spec with cost engineering that keeps
the four integrity lines (cognition-only, funnel narration, knowledge-scoped, soul-anchored).*
