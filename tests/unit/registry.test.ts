import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";

describe("0021 — per-user game sandboxes", () => {
  it("creates one isolated sandbox per user, resumed on return", () => {
    const reg = new GameSessionRegistry();
    const a1 = reg.sandboxFor("A");
    const a2 = reg.sandboxFor("A");
    expect(a1).toBe(a2); // same ongoing sandbox on return
    expect(reg.sandboxFor("B")).not.toBe(a1); // a different user → a different sandbox
    expect(reg.userCount()).toBe(2);
  });

  it("isolates games across users — distinct houses, no shared state", () => {
    const reg = new GameSessionRegistry();
    reg.sandboxFor("A").session.createCharacter({ playerName: "Player A", seed: 1 });
    reg.sandboxFor("B").session.createCharacter({ playerName: "Player B", seed: 2 });
    const a = reg.sandboxFor("A").session.getGameState();
    const b = reg.sandboxFor("B").session.getGameState();
    expect(a.player!.name).toBe("Player A");
    expect(b.player!.name).toBe("Player B");
    const aNames = new Set(a.house.map((h) => h.name));
    expect(b.house.some((h) => !aNames.has(h.name))).toBe(true);
  });

  it("a new game replaces only that user's sandbox", () => {
    const reg = new GameSessionRegistry();
    reg.sandboxFor("A").session.createCharacter({ playerName: "Player A", seed: 1 });
    const bBefore = reg.sandboxFor("B");
    bBefore.session.createCharacter({ playerName: "Player B", seed: 2 });
    const replaced = reg.resetUser("A");
    expect(replaced).not.toBe(undefined);
    expect(reg.sandboxFor("A")).toBe(replaced); // A replaced
    expect(reg.sandboxFor("B")).toBe(bBefore);  // B untouched
  });

  it("cross-user isolation: A's data never appears in B's sandbox", () => {
    const reg = new GameSessionRegistry();
    const a = reg.sandboxFor("A");
    a.session.createCharacter({ playerName: "PlayerA-SENTINEL", seed: 11 });
    a.engine.vault.writeHidden({ id: "v", kind: "hidden-thread", content: "A-SECRET" });
    const b = reg.sandboxFor("B");
    b.session.createCharacter({ playerName: "Player B", seed: 22 });
    const bView = JSON.stringify(b.session.getGameState());
    expect(bView.includes("PlayerA-SENTINEL")).toBe(false);
    expect(bView.includes("A-SECRET")).toBe(false);
    // B's vault is its own — A's secret is not in it.
    expect(b.engine.vault.readHidden().some((r) => r.content.includes("A-SECRET"))).toBe(false);
  });
});
