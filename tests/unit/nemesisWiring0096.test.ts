import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { RelationshipModel } from "../../src/engine/relationships";
import { NEMESIS, type Campaign, type NemesisTrack } from "../../src/engine/campaigns";
import { PLAYER } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";

/**
 * Feature 0096 — the live WIRING: an NPC whose threat-toward-player stays sustained becomes the emergent
 * nemesis, biases their EXISTING campaign/drive toward the player, surfaces only as a Vault-safe
 * `rivalry` tone hint inside a live scene, is never on any player OR admin projection otherwise, is
 * organic (lapses/hands off), persists across a restart, and — with the campaign layer off — is a
 * total no-op (the calibration guarantee). Roles only.
 */

type Peek = {
  nemesisTrack: NemesisTrack;
  campaigns: Campaign[];
  drives: Map<EntityId, { motivation: string; target?: EntityId; intensity: number }>;
  presence?: Map<EntityId, string>;
  campaignTick: () => void;
};
const peek = (s: GameSessionAdapter): Peek => s as unknown as Peek;

function started(seed: number, enableCampaigns: boolean): { session: GameSessionAdapter; rel: RelationshipModel; ids: EntityId[] } {
  const rel = new RelationshipModel(0.5);
  const session = new GameSessionAdapter(rel);
  session.setCampaignsEnabled(enableCampaigns);
  session.createCharacter({ playerName: "The Player", seed });
  const ids = (session.snapshot().house?.npcs ?? []).map((n) => n.id);
  return { session, rel, ids };
}

/** Make `rival`'s clear top threat read the PLAYER (well above the nemesis bar), everyone else calm. */
function aimAtPlayer(rel: RelationshipModel, rival: EntityId, others: EntityId[], threat = NEMESIS.threatThreshold + 0.15): void {
  rel.edge(rival, PLAYER).threat = threat;
  for (const o of others) rel.edge(rival, o).threat = 0.1;
}

describe("0096 nemesis — emerges from sustained threat, biases the existing campaign + drive", () => {
  it("a rival whose threat-toward-player is sustained across the window becomes the nemesis", () => {
    const { session, rel, ids } = started(2026, true);
    const [rival, ...rest] = ids;
    aimAtPlayer(rel, rival!, rest);
    for (let i = 0; i < NEMESIS.sustainTicks; i++) peek(session).campaignTick();
    expect(peek(session).nemesisTrack.current).toBe(rival);
  });

  it("a one-tick spike does not make a nemesis", () => {
    const { session, rel, ids } = started(31, true);
    const [rival, ...rest] = ids;
    aimAtPlayer(rel, rival!, rest);
    peek(session).campaignTick(); // one tick only
    expect(peek(session).nemesisTrack.current).toBeUndefined();
  });

  it("holds the nemesis's target drive at the upper of the intensity band", () => {
    const { session, rel, ids } = started(44, true);
    const [rival, ...rest] = ids;
    aimAtPlayer(rel, rival!, rest);
    for (let i = 0; i < NEMESIS.sustainTicks; i++) peek(session).campaignTick();
    const drive = peek(session).drives.get(rival!);
    expect(drive?.motivation).toBe("target");
    expect(drive?.target).toBe(PLAYER);
    expect(drive!.intensity).toBeGreaterThanOrEqual(NEMESIS.escalationIntensity);
  });

  it("prioritizes an active evict-the-player campaign for the nemesis under the UNCHANGED cap", () => {
    const { session, rel, ids } = started(55, true);
    const [rival, ...rest] = ids;
    aimAtPlayer(rel, rival!, rest);
    for (let i = 0; i < NEMESIS.sustainTicks; i++) peek(session).campaignTick();
    const camp = peek(session).campaigns.find((c) => c.owners[0] === rival && c.status === "active");
    expect(camp?.goal).toBe("evict");
    expect(camp?.target).toBe(PLAYER);
  });

  it("a peaceful board with no sustained threat toward the player elevates no one", () => {
    const { session } = started(66, true);
    for (let i = 0; i < 6; i++) peek(session).campaignTick();
    expect(peek(session).nemesisTrack.current).toBeUndefined();
  });
});

describe("0096 nemesis — organic: it lapses and can hand off", () => {
  it("lapses when the rival's threat toward the player decays", () => {
    const { session, rel, ids } = started(77, true);
    const [rival, ...rest] = ids;
    aimAtPlayer(rel, rival!, rest);
    for (let i = 0; i < NEMESIS.sustainTicks; i++) peek(session).campaignTick();
    expect(peek(session).nemesisTrack.current).toBe(rival);
    rel.edge(rival!, PLAYER).threat = 0.05; // the threat releases
    peek(session).campaignTick();
    expect(peek(session).nemesisTrack.current).toBeUndefined();
  });

  it("a different, clearly-overtaking rival can hand off the arc", () => {
    const { session, rel, ids } = started(88, true);
    const [rival, challenger, ...rest] = ids;
    aimAtPlayer(rel, rival!, [challenger!, ...rest]);
    for (let i = 0; i < NEMESIS.sustainTicks; i++) peek(session).campaignTick();
    expect(peek(session).nemesisTrack.current).toBe(rival);
    // The challenger now clearly overtakes (well past the hand-off margin) and sustains just as long.
    rel.edge(challenger!, PLAYER).threat = NEMESIS.threatThreshold + 0.4;
    for (let i = 0; i < NEMESIS.sustainTicks; i++) peek(session).campaignTick();
    expect(peek(session).nemesisTrack.current).toBe(challenger);
  });
});

describe("0096 nemesis — behavior-only: no surface (player or admin) ever names it or a number", () => {
  it("no player-facing surface returns the nemesis identity, a threat number, or a hostility score", () => {
    const { session, rel, ids } = started(99, true);
    const [rival, ...rest] = ids;
    aimAtPlayer(rel, rival!, rest);
    for (let i = 0; i < NEMESIS.sustainTicks; i++) peek(session).campaignTick();
    const blob = JSON.stringify([...ids.map((id) => session.npcVoice(id)), session.gameStatus(), session.whereabouts()]);
    expect(blob).not.toMatch(/nemesis|hostility|escalationIntensity|threatThreshold/i);
  });

  it("the rivalry tone hint appears ONLY inside a live scene with the held nemesis", () => {
    const { session, rel, ids } = started(101, true);
    const [rival, ...rest] = ids;
    aimAtPlayer(rel, rival!, rest);
    for (let i = 0; i < NEMESIS.sustainTicks; i++) peek(session).campaignTick();
    // Not in a scene (no shared presence assumed) ⇒ no hint on any houseguest's voice.
    for (const id of ids) expect(session.npcVoice(id)?.rivalry).toBeUndefined();
    // Put the player and the nemesis in the same room — a live scene.
    const presence = peek(session).presence ?? new Map<EntityId, string>();
    presence.set(PLAYER, "kitchen");
    presence.set(rival!, "kitchen");
    (session as unknown as { presence: Map<EntityId, string> }).presence = presence;
    const voice = session.npcVoice(rival!);
    expect(voice?.rivalry).toBeDefined();
    expect(["simmering", "open"]).toContain(voice!.rivalry!.tone);
    // Everyone else still carries no hint, even in a shared house.
    for (const other of rest) if (presence.get(other) !== "kitchen") expect(session.npcVoice(other)?.rivalry).toBeUndefined();
  });
});

describe("0096 nemesis — persistence: the arc survives a save/restore, accumulating never thinning", () => {
  it("round-trips through a snapshot/restore", () => {
    const { session, rel, ids } = started(111, true);
    const [rival, ...rest] = ids;
    aimAtPlayer(rel, rival!, rest);
    for (let i = 0; i < NEMESIS.sustainTicks; i++) peek(session).campaignTick();
    expect(peek(session).nemesisTrack.current).toBe(rival);

    const revived = new GameSessionAdapter();
    revived.restore(session.snapshot());
    expect(peek(revived).nemesisTrack.current).toBe(rival);
  });

  it("a pre-0096 save (no nemesis field) restores to no nemesis and re-derives cleanly", () => {
    const { session } = started(112, true);
    const snap = session.snapshot();
    delete (snap as unknown as Record<string, unknown>)["nemesis"];
    delete (snap as unknown as Record<string, unknown>)["nemesisStreak"];
    const revived = new GameSessionAdapter();
    revived.restore(snap);
    expect(peek(revived).nemesisTrack.current).toBeUndefined();
    expect(() => peek(revived).campaignTick()).not.toThrow();
  });
});

describe("0096 nemesis — calibration-neutral: OFF is a total no-op", () => {
  it("with the campaign layer OFF, no nemesis is ever computed", () => {
    const { session, rel, ids } = started(2026, false);
    const [rival, ...rest] = ids;
    aimAtPlayer(rel, rival!, rest);
    for (let i = 0; i < 6; i++) peek(session).campaignTick();
    expect(peek(session).nemesisTrack.current).toBeUndefined();
    expect(peek(session).campaigns.length).toBe(0);
  });
});
