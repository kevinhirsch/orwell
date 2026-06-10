import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSaveStore } from "../../src/adapters/engine/FileSaveStore";
import { GameSessionRegistry } from "../../src/composition/registry";
import { toGameState } from "../../src/engine/sessionSnapshot";
import { counts, isSuperset, countsNonDecreasing } from "../../src/domain/saveState";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * B68 / test-audit C1 — the live-path knowledge-survival test that was MISSING: the snapshot fix
 * itself shipped with B40 (SessionSnapshot carries knowledge + suspicions + counters and
 * `toGameState().knowledge` feeds the 0031 checkpoint), but no test ever drove the REAL durable
 * path — surface a fact to the player by pathway → save to disk → a NEW registry (a process
 * restart) over the same dir → the fact and the counts survive. The old version's "memory
 * thinning" failure must stay impossible. Roles only — no fixture names.
 */
describe("B68 — the player's knowledge layer survives a real restart (live path)", () => {
  it("a pathway-surfaced fact + a suspicion survive save → new registry over the same disk dir", () => {
    const dir = mkdtempSync(join(tmpdir(), "orwell-knowledge-"));
    try {
      const user = "knowledge-restart";
      const store = new FileSaveStore(dir);
      const reg = new GameSessionRegistry(store);
      const sb = reg.sandboxFor(user);
      sb.session.createCharacter({ playerName: "The Player", seed: 4 });

      // A REAL anchored surfacing (0002): an NPC tells the player about a recorded scene.
      sb.engine.events.record({
        id: "b68:scene", ts: 9_300_000, type: "conversation",
        initiator: npc(1), witnessSet: [npc(1), npc(2)], hidden: true,
        content: "two houseguests planned the week's votes",
      });
      const fact = sb.engine.knowledge.surfaceInformationTo(
        PLAYER, { content: "you overheard pieces of a plan" }, "overheard:b68:scene",
      );
      expect(fact).not.toBeNull();
      const suspicion = sb.engine.knowledge.addSuspicion(PLAYER, { content: "someone is lying about their vote" });
      reg.saveUser(user); // the durable save (every live mutation also persists via the commit hook)

      const before = counts(toGameState(reg.snapshot(user)));
      expect(before.knowledge).toBeGreaterThan(0);

      // A process restart: a brand-new registry over the SAME disk dir, no in-memory pointer.
      const reg2 = new GameSessionRegistry(new FileSaveStore(dir));
      const restored = reg2.sandboxFor(user);

      const known = restored.engine.knowledge.knownTo(PLAYER);
      expect(known.some((k) => k.id === fact!.id), "the surfaced fact's id survives").toBe(true);
      expect(known.some((k) => k.pathway === "overheard:b68:scene"), "the pathway survives").toBe(true);
      expect(
        restored.engine.knowledge.suspicionsOf(PLAYER).some((s) => s.id === suspicion.id),
        "the suspicion survives",
      ).toBe(true);

      // The 0007 contract over the LIVE durable path: superset + non-decreasing counts, knowledge included.
      const after = counts(toGameState(reg2.snapshot(user)));
      expect(after.knowledge).toBeGreaterThanOrEqual(before.knowledge);
      expect(countsNonDecreasing(after, before)).toBe(true);
      expect(isSuperset(toGameState(reg2.snapshot(user)), toGameState(reg.snapshot(user)))).toBe(true);

      // The id/ts counters resumed too (product-audit C3): a post-restart surfacing mints a FRESH id.
      const fresh = restored.engine.knowledge.surfaceInformationTo(
        PLAYER, { content: "a second overheard fragment" }, "overheard:b68:scene",
      );
      expect(fresh).not.toBeNull();
      expect(known.some((k) => k.id === fresh!.id), "no duplicate knowledge id after restart").toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
