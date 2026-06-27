import { describe, it, expect } from "vitest";
import {
  allianceTieBoost, allianceFavor, allianceBetrayalScale, willingMembers, AllianceStore, ALLIANCE,
  type Alliance,
} from "../../src/engine/alliances";
import { detectBlocs } from "../../src/engine/blocs";
import { RelationshipModel } from "../../src/engine/relationships";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { McpServer } from "../../src/adapters/mcp/McpServer";
import { EngineCommandsAdapter } from "../../src/adapters/engine/EngineCommandsAdapter";
import { buildSandbox } from "../support/sandbox";
import { PLAYER, npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";

/**
 * Feature 0107 — NAMED ALLIANCES. Roles only (the founder, a close ally, a distant houseguest). The
 * PURE effects (cement / favor / stakes / bond-gated join) + the live wiring (formAlliance bond-gates,
 * the cement raises a borderline bloc, the projection is Vault-safe, it persists). Calibration: every
 * effect is 0/identity when no alliance is shared ⇒ the seeded spine is byte-identical.
 */

const ally = (members: EntityId[]): Alliance =>
  ({ id: "alliance:t", name: "The Test", members, founder: members[0]!, formedBeat: 1, knownTo: [...members] });

describe("0107 alliance effects — bounded, saturation-diluted, identity when unshared", () => {
  it("the CEMENT boosts a shared pair's bond, bounded by the base tie, 0 when unshared", () => {
    const a = [ally([npc(1), npc(2)])];
    expect(allianceTieBoost(a, npc(1), npc(2))).toBeCloseTo(ALLIANCE.tieBoost, 10);
    expect(allianceTieBoost(a, npc(1), npc(2))).toBeLessThanOrEqual(ALLIANCE.tieBoost);
    expect(allianceTieBoost(a, npc(1), npc(9))).toBe(0); // npc(9) shares none
  });

  it("SATURATION dilutes — a member in many alliances cements each one less", () => {
    const lean = [ally([npc(1), npc(2)])];
    const busy = [ally([npc(1), npc(2)]), { ...ally([npc(1), npc(3)]), id: "alliance:b" }, { ...ally([npc(1), npc(4)]), id: "alliance:c" }];
    expect(allianceTieBoost(busy, npc(1), npc(2))).toBeLessThan(allianceTieBoost(lean, npc(1), npc(2)));
  });

  it("FAVOR banks bounded goodwill toward a co-ally, 0 when unshared", () => {
    const a = [ally([npc(1), npc(2)])];
    expect(allianceFavor(a, npc(1), npc(2))).toBeCloseTo(ALLIANCE.favor, 10);
    expect(allianceFavor(a, npc(1), npc(9))).toBe(0);
  });

  it("STAKES scale a betrayal of a named co-ally; identity (1) otherwise", () => {
    const a = [ally([npc(1), npc(2)])];
    expect(allianceBetrayalScale(a, npc(1), npc(2))).toBe(ALLIANCE.betrayalMultiplier);
    expect(allianceBetrayalScale(a, npc(1), npc(9))).toBe(1);
  });

  it("the JOIN is bond-gated — the founder is in; only members over the floor join", () => {
    const bond: Record<string, number> = { [npc(2)]: 0.8, [npc(3)]: 0.2 }; // npc(3) too distant
    const willing = willingMembers(npc(1), [npc(2), npc(3)], (m) => bond[m] ?? 0);
    expect(willing).toContain(npc(1)); // the founder
    expect(willing).toContain(npc(2)); // close enough
    expect(willing).not.toContain(npc(3)); // declined
  });
});

describe("0107 the CEMENT raises a borderline bloc (and byte-identical without it)", () => {
  it("a pair just under the bloc threshold clusters ONLY once their alliance cements them", () => {
    const rel = new RelationshipModel(0.5);
    for (const [a, b] of [[npc(1), npc(2)], [npc(2), npc(1)]] as const) {
      const e = rel.edge(a, b); e.trust = 0.46; e.affinity = 0.46; // mutual bond 0.46 < 0.5
    }
    const active = [npc(1), npc(2), npc(3)];
    expect(detectBlocs({ rel, active })).toHaveLength(0); // no cement ⇒ no bloc (byte-identical)
    const a = [ally([npc(1), npc(2)])];
    const withCement = detectBlocs({ rel, active, tieBoost: (x, y) => allianceTieBoost(a, x, y) });
    expect(withCement).toHaveLength(1); // naming it pulled the borderline pair together
    expect(withCement[0]!.members).toEqual([npc(1), npc(2)]);
  });
});

describe("0107 AllianceStore — prune + round-trip", () => {
  it("prunes evictees and dissolves a sub-two alliance; serialize/load round-trips", () => {
    const store = new AllianceStore();
    store.add("The Brigade", npc(1), [npc(1), npc(2), npc(3)], 1);
    store.prune(new Set([npc(1), npc(2), npc(3)]));
    expect(store.all()).toHaveLength(1);
    store.prune(new Set([npc(1)])); // only the founder remains ⇒ dissolves
    expect(store.all()).toHaveLength(0);

    const s2 = new AllianceStore();
    s2.add("The Six", npc(1), [npc(1), npc(2)], 3);
    const revived = new AllianceStore();
    revived.load(s2.serialize());
    expect(revived.all()).toEqual(s2.all());
  });
});

describe("0107 formAlliance — live, bond-gated, Vault-safe, persisted", () => {
  function started(seed: number): { s: GameSessionAdapter; rel: RelationshipModel; ids: EntityId[] } {
    const rel = new RelationshipModel(0.5);
    const s = new GameSessionAdapter(rel);
    s.createCharacter({ playerName: "The Player", seed });
    const ids = (s.snapshot().house?.npcs ?? []).map((n) => n.id);
    return { s, rel, ids };
  }
  const warm = (rel: RelationshipModel, a: EntityId, b: EntityId): void => {
    for (const [x, y] of [[a, b], [b, a]] as const) { const e = rel.edge(x, y); e.trust = 0.8; e.affinity = 0.8; }
  };

  it("names an alliance over bonded members and surfaces it Vault-safe on gameStatus", () => {
    const { s, rel, ids } = started(2026);
    warm(rel, PLAYER, ids[0]!); warm(rel, PLAYER, ids[1]!);
    const view = s.formAlliance({ name: "The Nucleus", members: [ids[0]!, ids[1]!] })!;
    expect(view.name).toBe("The Nucleus");
    expect(view.youAreFounder).toBe(true);
    const status = s.gameStatus();
    expect(status.alliances?.[0]?.name).toBe("The Nucleus");
    const blob = JSON.stringify(status.alliances);
    expect(blob).not.toMatch(/0\.\d/); // never a cement/favor number
  });

  it("declines members not close enough — no alliance of one", () => {
    const { s, rel, ids } = started(7);
    // Only ids[0] is bonded; the rest stay at the 0.5 baseline (< the 0.45 mutual floor is false…) —
    // set them clearly distant so they decline.
    warm(rel, PLAYER, ids[0]!);
    for (const id of ids.slice(1)) { for (const [x, y] of [[PLAYER, id], [id, PLAYER]] as const) { const e = rel.edge(x, y); e.trust = 0.1; e.affinity = 0.1; } }
    const ok = s.formAlliance({ name: "Solo", members: [ids[1]!, ids[2]!] }); // both distant
    expect(ok).toBeNull(); // nobody close enough ⇒ no alliance
  });

  it("survives a snapshot/restore", () => {
    const { s, rel, ids } = started(11);
    warm(rel, PLAYER, ids[0]!); warm(rel, PLAYER, ids[1]!);
    s.formAlliance({ name: "Ride Or Die", members: [ids[0]!, ids[1]!] });
    const revived = new GameSessionAdapter();
    revived.restore(s.snapshot());
    expect(revived.gameStatus().alliances?.[0]?.name).toBe("Ride Or Die");
  });
});

describe("0107 formAlliance — the MCP boundary is open (4-place wiring live)", () => {
  function mkServer(seed: number): { server: McpServer; session: GameSessionAdapter; rel: RelationshipModel } {
    const sb = buildSandbox(seed);
    const rel = new RelationshipModel(0.5);
    const session = new GameSessionAdapter(rel);
    const commands = new EngineCommandsAdapter(sb.engine.events, sb.engine.knowledge);
    const srv = new McpServer("player", { player: sb.player, admin: sb.admin, summary: sb.summary, commands, session });
    session.createCharacter({ playerName: "The Player", seed });
    return { server: srv, session, rel };
  }

  it("dispatches formAlliance (not rejected as unavailable)", async () => {
    const { server, session, rel } = mkServer(13);
    const ids = (session.snapshot().house?.npcs ?? []).map((n) => n.id);
    for (const id of [ids[0]!, ids[1]!]) for (const [x, y] of [[PLAYER, id], [id, PLAYER]] as const) { const e = rel.edge(x, y); e.trust = 0.8; e.affinity = 0.8; }
    const res = await server.callTool("formAlliance", { name: "The Committee", members: [ids[0], ids[1]] });
    expect((res as { name: string }).name).toBe("The Committee");
  });

  it("refuses a missing name / members with a typed field (the arg-guard)", async () => {
    const { server } = mkServer(14);
    await expect(server.callTool("formAlliance", { members: [] })).rejects.toThrow(/name/);
    await expect(server.callTool("formAlliance", { name: "X" })).rejects.toThrow(/members/);
  });
});
