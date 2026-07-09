/**
 * Feature 0094 — belief-reliability classifier. The pure logic now lives in
 * `src/domain/beliefReliability.ts` (dependency-free, importable by the outward player projection too —
 * #1239). This engine module re-exports it unchanged so every existing engine-side importer
 * (`GameSessionAdapter`'s `confront` misfire check, the 0094 tests + step definitions) keeps its
 * `../../engine/beliefReliability` import path with byte-identical behavior. Mirrors the
 * `src/adapters/engine/humanize.ts` → `src/domain/humanize.ts` re-export pattern.
 */
export {
  GOSSIP_CONSEQUENCE,
  isMateriallyDistorted,
  type GossipConsequenceConstants,
} from "../domain/beliefReliability";
