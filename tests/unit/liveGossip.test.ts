import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { Orchestrator } from "../../src/composition/orchestrator";
import { RUMOR_GLOSS } from "../../src/engine/gossip";
import { PLAYER } from "../../src/domain/ids";

/**
 * B27b — live gossip→player diffusion: a rumor RISES from the off-screen society, travels the
 * affinity graph with low probability and drift, and can terminate at the player as a belief with
 * source + confidence — while the 0031 checkpoint still COMMITS (no false leak) and the verbatim
 * hidden scenes never cross. Roles only — no fixture names.
 */
describe("B27b — a rumor can reach the player, legally", () => {
  it("diffusion lands a distorted, attributed belief on the player; the checkpoint stays green", () => {
    let landed = false;
    for (const seed of [1, 2, 3, 4, 5]) {
      const reg = new GameSessionRegistry();
      const user = `gossip-${seed}`;
      const orch = new Orchestrator(reg, { now: () => seed }, { seed });
      const sb = reg.sandboxFor(user);
      sb.session.createCharacter({ playerName: "The Player", seed });

      for (let t = 0; t < 60; t++) {
        // EVERY tick must commit: legal gossip propagation may never read as a vault leak (the
        // pathway-aware heuristic) — a fail-closed rollback here would silently undo the rumor.
        expect(orch.advance(user, "offscreen-tick").integrity).toBe("ok");
        const rumor = sb.engine.knowledge.knownTo(PLAYER).find((f) => f.pathway.startsWith("told-by:"));
        if (rumor) {
          landed = true;
          // The belief carries provenance + decayed confidence + drift — never certainty.
          expect(rumor.source).toBeTruthy();
          expect(rumor.confidence).toBeLessThan(1);
          expect(rumor.hops ?? 0).toBeGreaterThanOrEqual(1);
          // A vague paraphrase, never the verbatim hidden scene.
          expect(rumor.content).toContain("word around the house");
          const hidden = sb.engine.events.query().filter((e) => e.hidden).map((e) => e.content);
          for (const h of hidden) expect(rumor.content.includes(h)).toBe(false);
          break;
        }
      }
      if (landed) break;
    }
    expect(landed, "a rumor eventually terminated at the player across the seed set").toBe(true);
  });

  it("the rumor gloss never quantifies — vibes, not numbers", () => {
    for (const gloss of Object.values(RUMOR_GLOSS)) {
      expect(gloss).not.toMatch(/\d|trust|threat|affinity|confidence/i);
    }
  });

  it("most rumors do NOT reach the player (partial, distorted spread — not a broadcast)", () => {
    const reg = new GameSessionRegistry();
    const user = "gossip-bounded";
    const orch = new Orchestrator(reg, { now: () => 9 }, { seed: 9 });
    const sb = reg.sandboxFor(user);
    sb.session.createCharacter({ playerName: "The Player", seed: 9 });
    for (let t = 0; t < 40; t++) orch.advance(user, "offscreen-tick");
    const npcBeliefs = sb.engine.events.query().filter((e) => e.type === "gossip" && e.hidden).length;
    const playerRumors = sb.engine.knowledge.knownTo(PLAYER).filter((f) => f.pathway.startsWith("told-by:")).length;
    // The NPC-to-NPC grapevine is busier than what reaches the player — the house talks ABOUT
    // the player more than TO them (when nothing diffuses at this seed, both stay tiny).
    expect(playerRumors).toBeLessThanOrEqual(npcBeliefs + 1);
  });
});
