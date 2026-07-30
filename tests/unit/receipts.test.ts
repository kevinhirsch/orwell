import { describe, it, expect } from "vitest";
import { computePlayerReceipts, type ReceiptsInput, type Receipt } from "../../src/engine/receipts";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * #1800 — The Booth Has Receipts: pure deterministic contradiction extraction from the player's own record.
 * Boundary tests using plain fixtures (no Vault, no engine handle).
 */

const PLAYER_ID = PLAYER;
const LEO = npc(1);
const MAEVE = npc(2);
const MAX = npc(3);

function emptyInput(): ReceiptsInput {
  return {
    player: PLAYER_ID,
    deals: [],
    events: [],
    diaryRoomStatements: [],
    publicStatements: [],
  };
}

describe("#1800 — computePlayerReceipts (pure deterministic)", () => {
  it("returns [] for empty input", () => {
    const result = computePlayerReceipts(emptyInput());
    expect(result).toEqual([]);
  });

  it("returns [] for input with no contradictions", () => {
    const input: ReceiptsInput = {
      ...emptyInput(),
      deals: [
        { id: "deal:1", kind: "vote", parties: [PLAYER_ID, LEO], terms: "vote together", status: "open", madeEventId: "evt:1" },
      ],
      events: [
        { id: "evt:1", kind: "recordInteraction", content: "made a vote deal with Leo", initiator: PLAYER_ID },
      ],
    };
    const result = computePlayerReceipts(input);
    expect(result).toEqual([]);
  });

  it("detects divergent-commitment: multiple open final-two deals", () => {
    const input: ReceiptsInput = {
      ...emptyInput(),
      deals: [
        { id: "deal:1", kind: "final-two", parties: [PLAYER_ID, LEO], terms: "final two with Leo", status: "open", madeEventId: "evt:1" },
        { id: "deal:2", kind: "final-two", parties: [PLAYER_ID, MAEVE], terms: "final two with Maeve", status: "open", madeEventId: "evt:2" },
      ],
      events: [
        { id: "evt:1", kind: "recordInteraction", content: "made final two with Leo", initiator: PLAYER_ID },
        { id: "evt:2", kind: "recordInteraction", content: "made final two with Maeve", initiator: PLAYER_ID },
      ],
    };
    const result = computePlayerReceipts(input);
    expect(result.length).toBe(1);
    expect(result[0]!.kind).toBe("divergent-commitment");
    expect(result[0]!.sourceEventIds).toContain("evt:1");
    expect(result[0]!.sourceEventIds).toContain("evt:2");
  });

  it("detects divergent-commitment: one open final-two is not divergent", () => {
    const input: ReceiptsInput = {
      ...emptyInput(),
      deals: [
        { id: "deal:1", kind: "final-two", parties: [PLAYER_ID, LEO], terms: "final two with Leo", status: "open", madeEventId: "evt:1" },
      ],
    };
    const result = computePlayerReceipts(input);
    expect(result.filter((r) => r.kind === "divergent-commitment")).toHaveLength(0);
  });

  it("detects target-vote-mismatch", () => {
    const input: ReceiptsInput = {
      ...emptyInput(),
      events: [
        { id: "evt:5", kind: "strategy", content: "I think target Leo this week", initiator: PLAYER_ID },
        { id: "evt:6", kind: "vote-evict", content: "voting for Maeve", initiator: PLAYER_ID },
      ],
    };
    const result = computePlayerReceipts(input);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]!.kind).toBe("target-vote-mismatch");
  });

  it("detects dr-public-flip", () => {
    const input: ReceiptsInput = {
      ...emptyInput(),
      diaryRoomStatements: [
        { id: "dr:1", content: "I trust Leo completely", ts: 10, subject: LEO },
      ],
      publicStatements: [
        { id: "pub:1", content: "I don't trust Leo at all", ts: 20 },
      ],
    };
    const result = computePlayerReceipts(input);
    expect(result.length).toBeGreaterThanOrEqual(1);
    const flip = result.find((r) => r.kind === "dr-public-flip");
    expect(flip).toBeDefined();
    expect(flip!.sourceEventIds).toContain("dr:1");
    expect(flip!.sourceEventIds).toContain("pub:1");
  });

  it("does not create dr-public-flip when statements agree", () => {
    const input: ReceiptsInput = {
      ...emptyInput(),
      diaryRoomStatements: [
        { id: "dr:1", content: "I trust Leo completely", ts: 10, subject: LEO },
      ],
      publicStatements: [
        { id: "pub:1", content: "I trust Leo completely in this game", ts: 20 },
      ],
    };
    const result = computePlayerReceipts(input);
    const flips = result.filter((r) => r.kind === "dr-public-flip");
    expect(flips).toHaveLength(0);
  });

  it("is deterministic: same input yields same output", () => {
    const input: ReceiptsInput = {
      ...emptyInput(),
      deals: [
        { id: "deal:1", kind: "final-two", parties: [PLAYER_ID, LEO], terms: "final two", status: "open", madeEventId: "evt:1" },
        { id: "deal:2", kind: "final-two", parties: [PLAYER_ID, MAEVE], terms: "final two", status: "open", madeEventId: "evt:2" },
      ],
    };
    const r1 = computePlayerReceipts(input);
    const r2 = computePlayerReceipts(input);
    expect(r1).toEqual(r2);
  });

  it("includes sourceEventIds on every receipt", () => {
    const input: ReceiptsInput = {
      ...emptyInput(),
      deals: [
        { id: "deal:1", kind: "final-two", parties: [PLAYER_ID, LEO], terms: "final two with Leo", status: "open", madeEventId: "evt:1" },
        { id: "deal:2", kind: "final-two", parties: [PLAYER_ID, MAEVE], terms: "final two with Maeve", status: "open", madeEventId: "evt:2" },
      ],
    };
    const result = computePlayerReceipts(input);
    for (const r of result) {
      expect(r.sourceEventIds.length).toBeGreaterThan(0);
    }
  });

  it("structural proof: called with plain fixtures, no VaultStore/engineRoot in scope", () => {
    // This test proves the function can be called with plain data objects
    // — NO VaultStore, SoulProvider, RelationshipModel, or engineRoot handle —
    // because the module has zero imports of those types.
    const input: ReceiptsInput = {
      player: "player" as any,
      deals: [{ id: "d:1", kind: "final-two", parties: ["player" as any, "npc:1" as any], terms: "f2", status: "open" }],
      events: [],
      diaryRoomStatements: [],
      publicStatements: [],
    };
    const result = computePlayerReceipts(input);
    expect(Array.isArray(result)).toBe(true);
  });
});
