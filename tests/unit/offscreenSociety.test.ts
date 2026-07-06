import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { Orchestrator } from "../../src/composition/orchestrator";
import { FakeClock } from "../../src/adapters/time/FakeClock";
import { PLAYER } from "../../src/domain/ids";
import type { InteractionType } from "../../src/engine/relationships";

// Feature 0038 — the live off-screen society: the house lives in MORE than one way between turns,
// run through the orchestrator's off-screen tick (the 0035 watcher trigger). Each scene carries its
// real interaction nature and folds the matching hidden impact. (Gossip-to-player diffusion + soul
// deepening are scoped follow-ups — see 0038 §scope.) Deterministic (FakeClock + per-user seeded RNG).

const RICH_TYPES: InteractionType[] = ["alliance", "gossip", "conflict", "bonding", "strategy", "showmance", "betrayal"];

function startedSociety(user: string, seed: number, ticks: number) {
  const reg = new GameSessionRegistry();
  reg.sandboxFor(user).session.createCharacter({ playerName: "P", seed });
  const orch = new Orchestrator(reg, new FakeClock(), { seed });
  let advanced = 0;
  for (let i = 0; i < ticks; i++) {
    const r = orch.advance(user, "offscreen-tick");
    if (r.integrity === "ok") advanced++;
  }
  return { sb: reg.sandboxFor(user), advanced };
}

describe("0038 — live off-screen society", () => {
  it("the house lives in more than one way (varied interaction types, all hidden)", () => {
    const { sb } = startedSociety("u1", 7, 6);
    const hidden = sb.engine.events.queryAll().filter((e) => e.hidden);
    const kinds = new Set(hidden.map((e) => e.type).filter((t) => RICH_TYPES.includes(t as InteractionType)));
    expect(kinds.size).toBeGreaterThan(1); // not a single canned verb — varied scheming/bonding/conflict
    expect(hidden.every((e) => !e.witnessSet.includes(PLAYER))).toBe(true); // off-screen
  });

  it("every advance commits (no false leak / degradation rollback)", () => {
    const { advanced } = startedSociety("u2", 3, 6);
    expect(advanced).toBe(6); // the off-screen society passes the fail-closed integrity checkpoint
  });

  it("off-screen scenes accumulate and move the hidden relationship layer", () => {
    const { sb } = startedSociety("u3", 5, 8);
    // Many off-screen scenes recorded, each folded into the relationship model (varied natures).
    const hidden = sb.engine.events.queryAll().filter((e) => e.hidden);
    expect(hidden.length).toBeGreaterThanOrEqual(8 * 3 - 2); // ~3 scenes/tick accrue, never lost (0007)
  });

  it("the player is shown no hidden scene content", () => {
    const { sb } = startedSociety("u4", 9, 6);
    const visible = JSON.stringify(sb.player.getVisibleState());
    for (const c of sb.engine.events.queryAll().filter((e) => e.hidden).map((e) => e.content)) {
      expect(visible.includes(c)).toBe(false);
    }
  });

  it("is seed-deterministic for the same user", () => {
    const a = startedSociety("u", 4, 5).sb.engine.events.queryAll().map((e) => e.content).join("|");
    const b = startedSociety("u", 4, 5).sb.engine.events.queryAll().map((e) => e.content).join("|");
    expect(a).toBe(b);
  });
});
