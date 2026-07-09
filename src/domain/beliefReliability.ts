/**
 * Feature 0094 — distorted gossip has consequences. The gossip belief model (`src/engine/gossip.ts`)
 * already tracks per-rumor `distortion` (grows with hops) and `confidence` (decays with hops) on every
 * `KnowledgeFact` — this module adds nothing to that model; it only CLASSIFIES an already-held belief as
 * faithful or materially distorted, purely from those existing fields. No new belief store, no new
 * field, no I/O, no Vault handle (a pure function of the belief record alone — the caller already holds
 * it via `KnowledgeService.knownTo(PLAYER)`).
 *
 * It lives in `src/domain/**` (pure, dependency-free, importable everywhere) so BOTH the engine
 * (`confront`'s misfire classification — `src/engine/beliefReliability.ts` re-exports from here) AND the
 * outward player projection (`VisibleStateService`, which may NOT import the engine layer) can derive the
 * Vault-safe qualitative `distorted` flag from the same single-sourced thresholds (#1239).
 */
import type { KnowledgeFact } from "./knowledge";

export interface GossipConsequenceConstants {
  /**
   * A belief only counts as "materially distorted" once `distortion` clears this floor — set at the
   * `gossip.ts` `CONTENT_DRIFT_MIN_HOPS` rung (2): the CONTENT itself (the claimed nature/subjects) only
   * genuinely starts to warp at or past the second retelling; a direct or one-hop retelling stays
   * faithful to what was actually witnessed (`distortion` there sits in [0,2)). Below the floor, the
   * belief is treated as faithful regardless of confidence — a one-hop, intact rumor must NOT misfire.
   */
  distortionFloor: number;
  /**
   * AND the holder's own `confidence` must be at/below this ceiling — the belief has ALSO genuinely
   * decayed. Gating on BOTH (never either alone) keeps a confidently-held, lightly-drifted belief safe
   * and only catches beliefs that are both far-traveled AND shaky. Two hops under the default
   * `GOSSIP.decay` (0.7) lands confidence ≈0.49, comfortably under this ceiling.
   */
  confidenceCeiling: number;
}

export const GOSSIP_CONSEQUENCE: GossipConsequenceConstants = {
  distortionFloor: 2,
  confidenceCeiling: 0.55,
};

/**
 * Is this held belief materially distorted (BOTH gates clear), i.e. reliable enough to justify a
 * closed-set move against reality — or should acting on it risk a misfire? A witnessed fact (no
 * `distortion`/`confidence` recorded at all) is never distorted. Pure; deterministic; no rng.
 */
export function isMateriallyDistorted(
  belief: Pick<KnowledgeFact, "distortion" | "confidence">,
  c: GossipConsequenceConstants = GOSSIP_CONSEQUENCE,
): boolean {
  const distortion = belief.distortion ?? 0;
  const confidence = belief.confidence ?? 1;
  return distortion >= c.distortionFloor && confidence <= c.confidenceCeiling;
}
