import type { EntityId } from "../../domain/ids";
import type { SubmitDecisionReq } from "../../ports/GameSession";

/**
 * The single houseguest id a player picked for a single-pick decision (houseguests-choice /
 * tie-break / final-eviction).
 *
 * Audit A10: the engine read the pick only from `vote`, while the FE tool schema documents it on
 * `choice` ("one houseguest id" for those kinds) — so a client following the documented convention
 * silently failed ("a … pick is required"). This accepts EITHER field, so the two contracts agree:
 * the canonical `vote` wins when both are present, and `choice` may arrive as a bare id or a
 * 1-element array (the schema's "one houseguest id" / the array type of `nominations`).
 */
export function singlePickId(req: Pick<SubmitDecisionReq, "vote" | "choice">): EntityId | undefined {
  if (req.vote) return req.vote;
  const c = req.choice as unknown as EntityId[] | EntityId | undefined;
  return Array.isArray(c) ? c[0] : c;
}
