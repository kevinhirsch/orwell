/**
 * #1800 — The Booth Has Receipts: deterministic contradiction extraction from the player's
 * own recorded record ONLY. Pure module: NO VaultStore, SoulProvider, RelationshipModel,
 * or hidden engine module handle. Structurally incapable of reading hidden state.
 *
 * Candidate classes:
 *   - divergent-commitment: multiple open final-two deals
 *   - target-vote-mismatch: stated target ≠ actual vote in the same week
 *   - dr-public-flip: Diary Room statement contradicts a later public statement
 */

import type { EntityId } from "../domain/ids";

/** A single receipt: a deterministic contradiction extracted from the player's own record. */
export interface Receipt {
  kind: "divergent-commitment" | "target-vote-mismatch" | "dr-public-flip";
  summary: string;
  sourceEventIds: string[];
}

/** Input to computePlayerReceipts — plain data only, never a Vault handle. */
export interface ReceiptsInput {
  player: EntityId;
  deals: Array<{
    id: string;
    kind: string;
    parties: readonly [EntityId, EntityId];
    terms: string;
    status: string;
    madeEventId?: string;
  }>;
  events: Array<{
    id: string;
    kind?: string;
    content: string;
    initiator?: string;
  }>;
  diaryRoomStatements: Array<{
    id: string;
    content: string;
    ts: number;
    subject?: EntityId;
  }>;
  publicStatements: Array<{
    id: string;
    content: string;
    ts: number;
  }>;
}

/**
 * Compute deterministic contradiction receipts from the player's OWN record.
 * No LLM, no RNG — pure deterministic logic over plain input data.
 *
 * After collecting candidates, sorts them by kind priority:
 * divergent-commitment → target-vote-mismatch → dr-public-flip,
 * then by sourceEventIds length ascending (simplest first).
 */
export function computePlayerReceipts(input: ReceiptsInput): Receipt[] {
  const receipts: Receipt[] = [];

  // 1. divergent-commitment: open final-two deals where player is a party
  const finalTwoDeals = input.deals.filter(
    (d) => d.kind === "final-two" && d.status === "open" &&
      (d.parties[0] === input.player || d.parties[1] === input.player)
  );
  if (finalTwoDeals.length > 1) {
    const partnerNames = finalTwoDeals.map((d) =>
      d.parties[0] === input.player ? d.parties[1] : d.parties[0]
    );
    const sourceIds = finalTwoDeals
      .map((d) => d.madeEventId)
      .filter((id): id is string => id !== undefined);
    receipts.push({
      kind: "divergent-commitment",
      summary: `You promised final-two to ${partnerNames.length} different people: ${partnerNames.join(", ")}. Footage doesn't forget.`,
      sourceEventIds: sourceIds.length > 0 ? sourceIds : [finalTwoDeals[0]!.id],
    });
  }

  // 2. target-vote-mismatch: player stated a target in an event, then voted differently in same week
  // Match by finding events where initiator===player with a stated target, then find vote-evict
  // events where the player voted differently — match by week/timing proximity.
  const playerEvents = input.events.filter((e) => e.initiator === input.player);
  const voteEvents = playerEvents.filter((e) => e.kind === "vote-evict");
  // Look for target-naming events (stated intention to target someone)
  const targetEvents = playerEvents.filter(
    (e) => e.kind && ["strategy", "gossip", "alliance"].includes(e.kind)
  );

  for (const vote of voteEvents) {
    if (!vote.content) continue;
    // Extract the voted-for entity from content (simple heuristic: look for "vote" or named references)
    const votedFor = tryExtractTarget(vote.content);
    if (!votedFor) continue;

    // Find a nearby target-naming event that states a DIFFERENT target
    for (const target of targetEvents) {
      const statedTarget = tryExtractTarget(target.content);
      if (!statedTarget || statedTarget === votedFor) continue;
      // Match by proximity: same numeric id prefix for same-week grouping
      const votePrefix = vote.id.split(":")[0];
      const targetPrefix = target.id.split(":")[0];
      if (votePrefix !== targetPrefix) continue;

      receipts.push({
        kind: "target-vote-mismatch",
        summary: `You told someone you'd target ${statedTarget}, but when it came time to vote, you voted for ${votedFor}.`,
        sourceEventIds: [vote.id, target.id],
      });
      break;
    }
  }

  // 3. dr-public-flip: DR statement content disagrees with public statement
  for (const dr of input.diaryRoomStatements) {
    // Find a public statement that contradicts this DR statement
    for (const pub of input.publicStatements) {
      if (pub.ts <= dr.ts) continue; // public statement must be AFTER the DR statement
      if (isContradictory(dr.content, pub.content)) {
        receipts.push({
          kind: "dr-public-flip",
          summary: `In the Diary Room you said something different about this than what you said publicly.`,
          sourceEventIds: [dr.id, pub.id],
        });
        break; // one flip per DR statement
      }
    }
  }

  // Sort: by kind priority, then sourceEventIds length ascending
  const kindOrder: Record<string, number> = {
    "divergent-commitment": 0,
    "target-vote-mismatch": 1,
    "dr-public-flip": 2,
  };
  receipts.sort((a, b) => {
    const ka = kindOrder[a.kind] ?? 99;
    const kb = kindOrder[b.kind] ?? 99;
    if (ka !== kb) return ka - kb;
    return a.sourceEventIds.length - b.sourceEventIds.length;
  });

  return receipts;
}

/** Simple heuristic to extract a target entity name from event content. */
function tryExtractTarget(content: string): string | null {
  // Look for patterns like "X is the target", "voting for X", "target X", "nominate X"
  const patterns = [
    /target (\w+)/i,
    /vote for (\w+)/i,
    /voting for (\w+)/i,
    /nominate (\w+)/i,
    /naming (\w+)/i,
    /go after (\w+)/i,
  ];
  for (const pat of patterns) {
    const m = content.match(pat);
    if (m && m[1]) return m[1];
  }
  // Fallback: first capitalized word longer than 1 char as a possible name
  const words = content.split(/\s+/);
  for (const w of words) {
    const cleaned = w.replace(/[^a-zA-Z]/g, "");
    if (cleaned.length >= 2 && cleaned[0] === cleaned[0]!.toUpperCase()) {
      return cleaned;
    }
  }
  return null;
}

/**
 * Simple contradiction detection: checks whether content of two statements
 * disagree on a specific claim (e.g., trust vs distrust, like vs dislike).
 * Deterministic word-list approach, no LLM.
 */
function isContradictory(a: string, b: string): boolean {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();

  // Contradictory word pairs
  const pairs: [string[], string[]][] = [
    [["trust", "believe", "confide", "loyal", "solid"], ["distrust", "doubt", "suspect", "suspicious", "untrustworthy", "liability"]],
    [["like", "fond", "enjoy", "love", "appreciate"], ["dislike", "hate", "annoy", "irritate", "resent", "despise"]],
    [["strong", "powerful", "threat", "dangerous", "formidable"], ["weak", "fragile", "harmless", "easy", "pushover"]],
  ];

  // Helper: check if text expresses a positive word (present and NOT negated)
  function expressedPositively(text: string, posWords: string[]): boolean {
    // Negation prefixes to check - must be a complete word/prefix before the positive word
    const negationPrefixes = ["don't ", "doesn't ", "didn't ", "not ", "never ", "won't ", "can't ", "isn't ", "aren't ", "no "];
    for (const w of posWords) {
      const idx = text.indexOf(w);
      if (idx >= 0) {
        // Check if negated by looking 30 chars before the match
        const start = Math.max(0, idx - 30);
        const before = text.slice(start, idx);
        const isNegated = negationPrefixes.some(neg => before.includes(neg));
        if (!isNegated) return true;
      }
    }
    return false;
  }

  // Helper: check if text contains any negative word directly
  function containsNegative(text: string, negWords: string[]): boolean {
    return negWords.some(w => text.includes(w));
  }

  // Helper: check if text has a positive word that IS negated (equivalent to expressing negativity)
  function containsNegatedPositive(text: string, posWords: string[]): boolean {
    const negPrefixes = ["don't ", "doesn't ", "didn't ", "not ", "never ", "won't ", "can't ", "isn't ", "aren't ", "no "];
    for (const w of posWords) {
      const idx = text.indexOf(w);
      if (idx >= 0) {
        const start = Math.max(0, idx - 30);
        const before = text.slice(start, idx);
        if (negPrefixes.some(neg => before.includes(neg))) return true;
      }
    }
    return false;
  }

  for (const [posWords, negWords] of pairs) {
    const aPos = expressedPositively(aLower, posWords);
    const aNeg = containsNegative(aLower, negWords);
    const bPos = expressedPositively(bLower, posWords);
    const bNeg = containsNegative(bLower, negWords);

    const aNegPos = containsNegatedPositive(aLower, posWords);
    const bNegPos = containsNegatedPositive(bLower, posWords);

    // Contradiction: a is positive and b is negative, OR a is negative and b is positive
    // OR a is positively expressed and b has a negated-positive, OR a has negated-positive and b is positive
    if ((aPos && bNeg) || (aNeg && bPos) || (aPos && bNegPos) || (aNegPos && bPos)) return true;
  }

  return false;
}
