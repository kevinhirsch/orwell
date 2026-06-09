import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { Orchestrator } from "../../src/composition/orchestrator";
import { FakeClock } from "../../src/adapters/time/FakeClock";
import { RelationshipModel } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { confessionalFor } from "../../src/engine/confessionals";
import { PLAYER, npc } from "../../src/domain/ids";

// Feature 0040 — NPC Diary Room confessionals: Vault-only NPC interiority, engine-grounded, walled
// from BOTH the player and the admin. (Soul-recall grounding of voice is 0041 — no soul store yet.)

function startedConfessing(user: string, seed: number, ticks: number) {
  const reg = new GameSessionRegistry();
  reg.sandboxFor(user).session.createCharacter({ playerName: "P", seed });
  const orch = new Orchestrator(reg, new FakeClock(), { seed });
  for (let i = 0; i < ticks; i++) orch.advance(user, "offscreen-tick");
  return reg.sandboxFor(user);
}

describe("0040 — NPC confessionals", () => {
  it("a confessional names the NPC's real top-threat target (engine-grounded, not invented)", () => {
    const rel = new RelationshipModel(0.5);
    const rng = new SeededRandom(1);
    const [A, B, C] = [npc(1), npc(2), npc(3)];
    for (let i = 0; i < 6; i++) rel.applyDirected(A, B, "betrayal", rng); // A reads B as the threat
    const conf = confessionalFor(A, [A, B, C], rel);
    expect(conf.target).toBe(B);
    expect(conf.content).toContain(B); // the private read names that threat
  });

  it("confessionals are recorded Vault-only — hidden, witnessed by the NPC alone", () => {
    const sb = startedConfessing("u1", 7, 5);
    const conf = sb.engine.events.query().filter((e) => e.type === "confessional");
    expect(conf.length).toBeGreaterThan(0);
    for (const e of conf) {
      expect(e.hidden).toBe(true);
      expect(e.witnessSet).not.toContain(PLAYER); // the player is NEVER present
      expect(e.witnessSet).toEqual([e.initiator]); // the confessing NPC alone
    }
  });

  it("confessionals never reach the player", () => {
    const sb = startedConfessing("u2", 3, 6);
    const view = JSON.stringify(sb.player.getVisibleState()) + "\n" + sb.player.produce("player-visible log");
    for (const e of sb.engine.events.query().filter((x) => x.type === "confessional")) {
      expect(view.includes(e.content)).toBe(false);
    }
  });

  it("confessionals never reach the admin / God Mode either", () => {
    const sb = startedConfessing("u3", 5, 6);
    const adminView = JSON.stringify(sb.admin.inspect());
    for (const e of sb.engine.events.query().filter((x) => x.type === "confessional")) {
      expect(adminView.includes(e.content)).toBe(false);
    }
    expect(adminView).not.toContain("confessional"); // the admin surface reads no events at all
  });

  it("is seed-deterministic for the same user", () => {
    const a = startedConfessing("u", 4, 5).engine.events.query().filter((e) => e.type === "confessional").map((e) => e.content).join("|");
    const b = startedConfessing("u", 4, 5).engine.events.query().filter((e) => e.type === "confessional").map((e) => e.content).join("|");
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });
});
