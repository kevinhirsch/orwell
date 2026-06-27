import { GOSSIP } from "./gossip";

/**
 * Feature 0100 — the JURY-HOUSE grudge magnitudes (the SINGLE tunable for the sequestered second
 * society, mirroring `juryConstants.ts` / `gossip.ts`'s `GOSSIP` / `offscreen.ts`'s `SOCIETY`).
 * **Every number the jury-house stretch + the grudge fold use lives here** (the B59 grep gate: each
 * constant has a real consumer in `juryHouse.ts` / the adapter's `juryHouseTick`).
 *
 * Sizing discipline (the 0086 ruling-#1 lesson): the bounded grudge adjustment is sized *under* the
 * eviction-MANNER lean it deepens — a fully-SATURATED grudge moves a juror's finale lean by strictly
 * less than a single recorded grievance manner (`MANNER_LEAN.betrayed × JURY_WEIGHTS.manner`). So the
 * jury house SHARPENS an already-bitter jury and pays off a clean exit; it never becomes a second flat
 * knob that swamps how the game actually went. The player never sees any of these (mandate #2 / 0020).
 *
 * The grudge is BOUNDED + MONOTONIC + SATURATED so it can never run away over a long sequester
 * (mandate #4 — it accumulates and deepens, but caps): each diffusion hop that reaches a juror adds a
 * confidence-scaled increment, the per-juror total is clamped to `adjustmentCap`, and it persists with
 * the season so a restored game resumes with the accumulated bitterness intact (never re-rolled).
 */
export const JURY_HOUSE = {
  /**
   * Hidden juror↔juror scenes per sequestered off-screen tick (open-question §1 default: per tick,
   * small, so the room's bitterness builds GRADUALLY over real sequester time rather than in one jump).
   * Bounded — the jury house is a quiet backstage, not the main house's busy society.
   */
  scenesPerTick: 2,
  /**
   * The grudge DIFFUSION transmit/decay over the jury-house affinity graph — reuse `GOSSIP`'s proven
   * shape (open-question §2 default) so a grievance spreads with the SAME low per-edge transmission,
   * decaying confidence, and bounded hop count main-house gossip uses. A grievance one juror carries
   * out can reach a second along their bond, but distorted and lower-confidence with each retelling.
   */
  transmitProb: GOSSIP.transmitProb,
  decay: GOSSIP.decay,
  rounds: GOSSIP.rounds,
  /** Affinity above this makes a jury-house social-graph edge (who talks to whom) — same as `GOSSIP`. */
  affinityEdge: GOSSIP.affinityEdge,
  /**
   * The PER-HOP grudge increment when a grievance belief about the player REACHES a juror, BEFORE the
   * confidence scale. A high-confidence (close-source) grievance lands near this; a fifth-hand whisper
   * barely registers (× its decayed confidence). Sized so several hops are needed to approach the cap —
   * the bitterness compounds over sequester, it does not arrive in one telling.
   */
  grudgePerHop: 0.06,
  /**
   * The bounded per-juror grudge-adjustment CAP (saturation) — a juror's accumulated jury-house grudge
   * can never lower their finale read of the responsible finalist by more than this. Sized strictly
   * UNDER a single recorded grievance manner so it DEEPENS the eviction-manner baseline, never swamps
   * it. The `juryHouse.test.ts` sizing-discipline gate pins `adjustmentCap < |MANNER_LEAN.betrayed|`.
   */
  adjustmentCap: 0.18,
} as const;
