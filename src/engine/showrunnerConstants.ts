/**
 * Feature 0101 (#1401) — the AI SHOWRUNNER: the SINGLE tunable module (sibling to
 * `threadConstants.ts` / `secretPacingConstants.ts` / `gossip.ts`'s `GOSSIP`). Every magnitude the
 * showrunner reads lives HERE — no magic number at a call site (the B59 grep gate covers this file
 * like its siblings).
 *
 * WHAT THE SHOWRUNNER IS. A DETERMINISTIC, SEEDED "producer's notes" pass that PACES the season's
 * arcs: each bounded off-screen tick it scores the house's SIMMERING hidden story threads (0058/0060)
 * by tension / staleness / current-board salience and writes a Vault-held note proposing which of them
 * the next tick should EMPHASIZE. It is the "the season has an arc" layer — the difference between a
 * season that happens and one that is paced.
 *
 * PURE ADR 0005 (split authority by openness). The showrunner proposes SHAPE only — which OPEN-SET
 * threads to lean on and with what RELATIVE emphasis. It has NO authority over the CLOSED set: it can
 * never decide an outcome, force a nomination/vote, protect the player, or perturb any competition
 * roll / eligibility rule / vote tally. Every term below is a BOUNDED, boost-only multiplier or a
 * bounded weight — the engine keeps every magnitude, and the hard 0060 caps
 * (`THREAD.maxSurfacedPerSeason` / `maxSurfacesPerTick`) remain the true ceilings on payoff. The note
 * SCHEMA (`ShowrunnerNote` in `showrunner.ts`) makes an outcome directive INEXPRESSIBLE by
 * construction — there is no "surface this" / "evict" / "winner" field, only a clamped `emphasis`.
 *
 * WHY DETERMINISTIC (no model call). The live engine is deliberately model-free (narration runs in the
 * FE; `EchoNarrativePort` is the live narrator). The notes CONSUME Vault content (they orchestrate
 * hidden threads), so their generation MUST run engine-side of the Wall — and a model that read Vault
 * content to write them would be a leak surface. A seeded heuristic over the EXISTING hidden threads is
 * mandate-trivial (zero model, zero new leak surface), testable, and fits "the engine avoids live
 * models." The "AI" flavor can ride the `setNarrator` / utility seam in a later pass without changing
 * this Vault-held, closed-set-neutral core.
 */
export const SHOWRUNNER = {
  // ── scoring weights (a bounded blend; the sum need not be 1 — the score is clamped to [0,1]) ─────
  /** How much a thread's dramatic FRICTION with the player weighs (a high-tension thread makes drama). */
  tensionWeight: 0.5,
  /** How much a thread's STALENESS weighs — how long it has simmered without a beat (it is "due"). */
  stalenessWeight: 0.3,
  /** How much the source's CURRENT-BOARD salience weighs — nominated / cornered / holding power now. */
  salienceWeight: 0.2,

  // ── staleness normalization ──────────────────────────────────────────────────────────────────────
  /** Weeks since a thread last changed lifecycle that map to FULL staleness (older ⇒ clamped at 1). */
  stalenessSpanWeeks: 4,

  // ── emphasis shape (BOUNDED, boost-only) ─────────────────────────────────────────────────────────
  /** How many threads one note EMPHASIZES (top-K). The rest keep the baseline multiplier (`minEmphasis`),
   *  so a note is a short "producer's shortlist", never a full re-scoring of the whole board. */
  emphasisSlots: 3,
  /** The BASELINE emphasis multiplier — 1.0 = no change. It is the floor, so the showrunner is BOOST-ONLY:
   *  it may move the most-dramatic threads to the FRONT and raise their surfacing odds, but it NEVER
   *  suppresses any thread below its own engine-owned baseline pacing (nothing persisted is ever lost). */
  minEmphasis: 1.0,
  /** The MAX emphasis multiplier a note may assign — a bounded ceiling. In Phase-1 `emphasis` is read ONLY to
   *  decide whether an emphasized surfaced thread's belief ALSO reaches the player (an open-set, fold-free
   *  routing choice); it never scales a magnitude or a seeded roll, so it can touch no closed-set outcome. The
   *  band's SHAPE (baseline vs emphasized, and the shortlist ordering) is what a note expresses. */
  maxEmphasis: 1.6,

  // ── Phase-2 REWEIGHT (#1455 — the OUTCOME-AFFECTING scheduler bias, behind ORWELL_SHOWRUNNER_REWEIGHT) ──
  /**
   * How many of a note's EMPHASIZED threads the Phase-2 reweight moves to the FRONT of the per-tick
   * scheduler queue (0 ⇒ the reweight is inert even when its flag is on; ≤ `emphasisSlots`, since a note
   * carries only that many emphases). This is the ONE knob that bounds the reweight's aggressiveness: the
   * emphasized shortlist (top-N, in note order) gets first crack at the SCARCE per-tick slots
   * (`THREAD.maxActivationsPerTick` / `maxSurfacesPerTick`, both 1) and the season surfacing cap — so a
   * "due" or high-friction storyline paces to the front instead of losing the slot to a lower-priority
   * thread that merely sits earlier in the derive order. It re-orders NOTHING else: every hard 0060 cap
   * still binds, every thread's activate/surface roll is its OWN thread-id-keyed side rng (invariant to
   * iteration order), every fold MAGNITUDE stays engine-owned + seeded, and NO closed-set decision
   * (nomination / vote / eviction / competition) is ever touched — the reweight only changes WHICH
   * OPEN-SET storyline consumes a bounded slot (ADR 0005). Unlike Phase-1 this DOES perturb the seeded
   * outcome stream (via which hidden relationship folds land this tick), which is why it is gated behind
   * the calibration heavy-sims. Set below `emphasisSlots` to tighten the reweight if a calibration band
   * regresses (e.g. 1 ⇒ "only the single most-emphasized thread ever jumps the queue").
   */
  reweightSlots: 3,
} as const;
