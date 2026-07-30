import { describe, it, expect } from "vitest";
import { computeExchangeAccounting, producerReadPrompt, type ExchangeAccounting } from "../../src/engine/producerRead";

/**
 * #1792 — Producer Read: pure computation tests for ExchangeAccounting.
 * All tests use plain fixtures — no VaultStore, no engineRoot, no hidden state.
 */

describe("#1792 — computeExchangeAccounting (pure, Vault-free)", () => {
  it("playerGained=true when a new fact id appears in after", () => {
    const acc = computeExchangeAccounting(
      { content: "hello", kind: "bonding" },
      new Set(["fact1", "fact2"]),
      [{ id: "fact3" }],
    );
    expect(acc.playerGained).toBe(true);
  });

  it("playerGained=false when all ids were already present", () => {
    const acc = computeExchangeAccounting(
      { content: "hello", kind: "bonding" },
      new Set(["fact1", "fact2"]),
      [{ id: "fact1" }, { id: "fact2" }],
    );
    expect(acc.playerGained).toBe(false);
  });

  it("playerGained=true when beforeIds is empty (first fact)", () => {
    const acc = computeExchangeAccounting(
      { content: "hi", kind: "bonding" },
      new Set(),
      [{ id: "f1" }],
    );
    expect(acc.playerGained).toBe(true);
  });

  it("npcGained=true for strategy, gossip, alliance, betrayal kinds", () => {
    for (const kind of ["strategy", "gossip", "alliance", "betrayal"]) {
      const acc = computeExchangeAccounting(
        { content: "secret info", kind },
        new Set(),
        [],
      );
      expect(acc.npcGained).toBe(true);
    }
  });

  it("npcGained=false for bonding, conflict, showmance kinds", () => {
    for (const kind of ["bonding", "conflict", "showmance"]) {
      const acc = computeExchangeAccounting(
        { content: "whatever", kind },
        new Set(),
        [],
      );
      expect(acc.npcGained).toBe(false);
    }
  });

  it("npcGained=false when kind is undefined", () => {
    const acc = computeExchangeAccounting(
      { content: "hello" },
      new Set(),
      [],
    );
    expect(acc.npcGained).toBe(false);
  });

  it("asymmetry: player-ahead when only player gained", () => {
    const acc = computeExchangeAccounting(
      { content: "thinking out loud", kind: "bonding" },
      new Set(),
      [{ id: "f1" }],
    );
    expect(acc.asymmetry).toBe("player-ahead");
    expect(acc.playerGained).toBe(true);
    expect(acc.npcGained).toBe(false);
  });

  it("asymmetry: npc-ahead when only NPC gained", () => {
    const acc = computeExchangeAccounting(
      { content: "confessing strategy", kind: "strategy" },
      new Set(["f1", "f2"]),
      [{ id: "f1" }, { id: "f2" }],
    );
    expect(acc.asymmetry).toBe("npc-ahead");
    expect(acc.playerGained).toBe(false);
    expect(acc.npcGained).toBe(true);
  });

  it("asymmetry: even when both gained or neither gained", () => {
    const bothGained = computeExchangeAccounting(
      { content: "mutual gossip", kind: "gossip" },
      new Set(),
      [{ id: "f1" }],
    );
    expect(bothGained.asymmetry).toBe("even");
    expect(bothGained.playerGained).toBe(true);
    expect(bothGained.npcGained).toBe(true);

    const neitherGained = computeExchangeAccounting(
      { content: "small talk", kind: "bonding" },
      new Set(["f1"]),
      [{ id: "f1" }],
    );
    expect(neitherGained.asymmetry).toBe("even");
    expect(neitherGained.playerGained).toBe(false);
    expect(neitherGained.npcGained).toBe(false);
  });

  it("uses factId when present, falls back to id", () => {
    const acc = computeExchangeAccounting(
      { content: "x", kind: "bonding" },
      new Set(["existing-fact-id"]),
      [{ id: "doc-id", factId: "existing-fact-id" }],
    );
    expect(acc.playerGained).toBe(false);
  });

  it("no Vault handle — structural proof: callable with plain JSON fixtures", () => {
    // This is the structural proof: computeExchangeAccounting only accepts event
    // shape + string set + array — no VaultStore, no SoulProvider, no engineRoot
    // anywhere in scope. It compiles and runs without any hidden-state type.
    const result = computeExchangeAccounting(
      { content: "plain", kind: "bonding" },
      new Set<string>(),
      [] as Array<{ id: string; factId?: string }>,
    );
    expect(result.playerGained).toBe(false);
  });
});

describe("#1792 — producerReadPrompt (narrator guidance)", () => {
  it("returns a second-person string for a bilateral gain", () => {
    const s = producerReadPrompt({ playerGained: true, npcGained: true, asymmetry: "even" });
    expect(s).toContain("You both");
  });

  it("returns a second-person string for player-ahead", () => {
    const s = producerReadPrompt({ playerGained: true, npcGained: false, asymmetry: "player-ahead" });
    expect(s).toContain("more than you gave");
    expect(s).toContain("tipped");
  });

  it("returns a second-person string for npc-ahead", () => {
    const s = producerReadPrompt({ playerGained: false, npcGained: true, asymmetry: "npc-ahead" });
    expect(s).toContain("more than you got");
    expect(s).toContain("read you");
  });

  it("never states a number", () => {
    const accs: ExchangeAccounting[] = [
      { playerGained: true, npcGained: false, asymmetry: "player-ahead" },
      { playerGained: false, npcGained: true, asymmetry: "npc-ahead" },
      { playerGained: true, npcGained: true, asymmetry: "even" },
      { playerGained: false, npcGained: false, asymmetry: "even" },
    ];
    for (const acc of accs) {
      const s = producerReadPrompt(acc);
      expect(s).not.toMatch(/\d/);
    }
  });

  it("measures the draw case", () => {
    const s = producerReadPrompt({ playerGained: false, npcGained: false, asymmetry: "even" });
    expect(s).toContain("measured draw");
  });
});
