import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { AllianceStore, ALLIANCE } from "../../src/engine/alliances";
import { RelationshipModel } from "../../src/engine/relationships";
import { PLAYER } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";

/**
 * Feature 0107 Phase B — NPCs form + NAME alliances off-screen, PITCH the player, and a betrayal of a
 * named co-ally cuts deeper. Roles only (a build-drive founder, an ally, the player). Gated by the
 * campaign layer ⇒ the passive calibration harness forms none ⇒ byte-identical.
 */

interface Pokeable { live: unknown; drives: Map<EntityId, unknown>; alliances: AllianceStore; reconcileAllianceBetrayals(a: unknown): void; }
function started(seed: number, campaigns: boolean): { s: GameSessionAdapter; rel: RelationshipModel; ids: EntityId[] } {
  const rel = new RelationshipModel(0.5);
  const s = new GameSessionAdapter(rel);
  s.setCampaignsEnabled(campaigns);
  s.createCharacter({ playerName: "The Player", seed });
  const ids = (s.snapshot().house?.npcs ?? []).map((n) => n.id);
  return { s, rel, ids };
}
const warm = (rel: RelationshipModel, a: EntityId, b: EntityId, v = 0.85): void => {
  for (const [x, y] of [[a, b], [b, a]] as const) { const e = rel.edge(x, y); e.trust = v; e.affinity = v; e.threat = 0.1; }
};
const poke = (s: GameSessionAdapter): Pokeable => s as unknown as Pokeable;

describe("0107B NPC alliance formation — gated, excludes the player from membership", () => {
  it("with the campaign layer ON, a bonded build-drive founder names an alliance off-screen", () => {
    const { s, rel, ids } = started(2026, true);
    warm(rel, ids[0]!, ids[1]!); warm(rel, ids[0]!, ids[2]!); warm(rel, ids[1]!, ids[2]!); // a tight trio
    for (let k = 0; k < 4; k++) (s as unknown as { campaignTick(): void }).campaignTick();
    const all = poke(s).alliances.all();
    expect(all.length).toBeGreaterThan(0); // NPCs formed at least one alliance
    for (const a of all) expect(a.members).not.toContain(PLAYER); // the player joins only via a pitch
    for (const a of all) expect(a.members.length).toBeGreaterThanOrEqual(2);
  });

  it("with the campaign layer OFF, no NPC alliance forms (byte-identical)", () => {
    const { s, rel, ids } = started(2026, false);
    warm(rel, ids[0]!, ids[1]!); warm(rel, ids[0]!, ids[2]!);
    (s as unknown as { campaignTick(): void }).campaignTick();
    expect(poke(s).alliances.all()).toHaveLength(0);
  });
});

describe("0107B the pitch + joinAlliance", () => {
  it("an alliance the player is pitched (knownTo, not a member) surfaces as a pitch they can accept", () => {
    const { s, rel, ids } = started(7, true);
    warm(rel, PLAYER, ids[0]!); // close enough to the founder to be let in
    const a = poke(s).alliances.add("The Brigade", ids[0]!, [ids[0]!, ids[1]!], 1);
    poke(s).alliances.reveal(a.id, PLAYER); // the founder pitches the player

    const status = s.gameStatus();
    expect(status.alliances).toBeUndefined(); // not a member yet
    expect(status.alliancePitches?.[0]?.name).toBe("The Brigade");

    const joined = s.joinAlliance({ allianceId: a.id })!;
    expect(joined.name).toBe("The Brigade");
    expect(s.gameStatus().alliances?.[0]?.name).toBe("The Brigade"); // now a member
    expect(s.gameStatus().alliancePitches).toBeUndefined(); // pitch consumed
  });

  it("refuses a cold join — an alliance the player was never pitched", () => {
    const { s, rel, ids } = started(8, true);
    warm(rel, PLAYER, ids[0]!);
    const a = poke(s).alliances.add("The Cartel", ids[0]!, [ids[0]!, ids[1]!], 1); // no reveal to the player
    expect(s.joinAlliance({ allianceId: a.id })).toBeNull();
  });
});

describe("0107B betraying a named co-ally cuts deeper", () => {
  it("a binding adverse action against a co-ally bumps threat, fires a betrayal, and fractures the alliance", () => {
    const { s, rel, ids } = started(11, true);
    const [actor, wronged] = [ids[0]!, ids[1]!];
    const a = poke(s).alliances.add("Ride Or Die", actor, [actor, wronged], 1);
    const before = rel.edge(wronged, actor).threat;

    poke(s).reconcileAllianceBetrayals({ actor, kind: "nominate", targets: [wronged] });

    expect(rel.edge(wronged, actor).threat).toBeCloseTo(Math.min(1, before + ALLIANCE.betrayalThreatBump), 6);
    expect(poke(s).alliances.byId(a.id)).toBeUndefined(); // dropped to <2 members ⇒ dissolved
  });

  it("does nothing when the two share no alliance (byte-identical absent alliances)", () => {
    const { s, rel, ids } = started(12, true);
    const before = rel.edge(ids[1]!, ids[0]!).threat;
    poke(s).reconcileAllianceBetrayals({ actor: ids[0]!, kind: "vote-evict", targets: [ids[1]!] });
    expect(rel.edge(ids[1]!, ids[0]!).threat).toBe(before);
  });
});
