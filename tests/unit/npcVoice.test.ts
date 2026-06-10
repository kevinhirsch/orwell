import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import type { AdvanceView } from "../../src/ports/GameSession";
import type { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import type { Room } from "../../src/domain/house";
import type { EntityId } from "../../src/domain/ids";
import { npc } from "../../src/domain/ids";

/**
 * B65 / ADR 0003 §8 — "people must make sense", structurally: the narrator voices an NPC from a
 * KNOWLEDGE-BOUNDED projection. A sentinel planted OUTSIDE an NPC's knowledge set never appears
 * in that NPC's voicing context (the 0001 canary on the per-NPC axis); the persona is byte-stable;
 * co-presence facts never cross rooms. Roles only — no fixture names.
 */
function liveGame(user: string, seed: number) {
  const reg = new GameSessionRegistry();
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "The Player", seed });
  return { reg, sb };
}

function resolve(s: GameSessionAdapter, p: NonNullable<AdvanceView["pending"]>): void {
  if (p.kind === "nominations") s.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
  else if (p.kind === "veto-decision") s.submitDecision({ kind: "veto-decision", use: false });
  else if (p.kind === "comp-intent") s.submitDecision({ kind: "comp-intent", intent: "compete" });
  else if (p.options[0]) s.submitDecision({ kind: p.kind, vote: p.options[0].id, replacement: p.options[0].id } as never);
}

describe("B65 — the per-NPC knowledge bound (the canary on the per-NPC axis)", () => {
  it("an NPC's voice carries THEIR knowledge — never another's, never the Vault, never a number", () => {
    const { sb } = liveGame("voice-bound", 4);
    const MINE = "SENTINEL-B65-known-to-the-voiced";
    const THEIRS = "SENTINEL-B65-known-to-someone-else";
    const VAULTED = "SENTINEL-B65-vault";
    sb.engine.knowledge.seedBelief(npc(1), { content: MINE, factId: "b65:mine" }, "witnessed");
    sb.engine.knowledge.seedBelief(npc(2), { content: THEIRS, factId: "b65:theirs" }, "witnessed");
    sb.engine.vault.writeHidden({ id: "b65:v", kind: "confessional", content: VAULTED });
    const core = sb.session.snapshot();
    core.house!.npcs[0]!.soul.memory.push("SENTINEL-B65-soul");
    core.house!.npcs[0]!.character.hiddenElements.push({ kind: "secret-motive", detail: "SENTINEL-B65-hiddenEl" });
    sb.session.restore(core);

    const voice = sb.session.npcVoice(npc(1))!;
    const blob = JSON.stringify(voice);
    expect(voice.knows).toContain(MINE);            // their own legitimate knowledge IS the seam
    expect(blob).not.toContain(THEIRS);             // another houseguest's knowledge never crosses
    expect(blob).not.toContain(VAULTED);            // the Vault never crosses
    expect(blob).not.toContain("SENTINEL-B65-soul");      // the soul never crosses
    expect(blob).not.toContain("SENTINEL-B65-hiddenEl");  // hidden elements never cross
    expect(blob).not.toMatch(/trust|threat|affinity|confidence|emotional/i); // labels, never numbers
  });

  it("hunches stay hunches: a suspicion appears under suspects, never under knows", () => {
    const { sb } = liveGame("voice-suspect", 5);
    sb.engine.knowledge.addSuspicion(npc(1), { content: "something is off about the vote" });
    const voice = sb.session.npcVoice(npc(1))!;
    expect(voice.suspects.some((s) => s.includes("something is off"))).toBe(true);
    expect(voice.knows.some((s) => s.includes("something is off"))).toBe(false);
  });

  it("stances are organic labels toward the living only — never numbers, never the departed", () => {
    const { sb } = liveGame("voice-stance", 2);
    const s = sb.session;
    for (let i = 0; i < 400; i++) {
      const v = s.advanceGame();
      if (v.pending) resolve(s, v.pending);
      if (s.getGameState().house.some((h) => h.status !== "active")) break;
    }
    const departed = s.getGameState().house.find((h) => h.status !== "active")!;
    const speaker = s.getGameState().house.find((h) => h.status === "active")!;
    const voice = s.npcVoice(speaker.id)!;
    expect(voice.stances.length).toBeGreaterThan(0);
    for (const st of voice.stances) {
      expect(["ally", "enemy", "acquaintance"]).toContain(st.stance);
      expect(st.toward.id).not.toBe(speaker.id);
      expect(st.toward.id).not.toBe(departed.id); // the departed hold no live stance line
    }
    expect(s.npcVoice(departed.id)).toBeNull(); // the departed are voiced from the public record only
  });
});

describe("B65 — persona stability + room coherence", () => {
  it("the persona facets are byte-stable across reads and turns (no drift between context windows)", () => {
    const { sb } = liveGame("voice-stable", 7);
    const s = sb.session;
    const before = JSON.stringify(s.npcVoice(npc(3))!.persona);
    for (let i = 0; i < 30; i++) {
      const v = s.advanceGame();
      if (v.pending) resolve(s, v.pending);
    }
    expect(JSON.stringify(s.npcVoice(npc(3))!.persona)).toBe(before);
  });

  it("an NPC in one room has NO co-presence fact for a scene in another room", () => {
    const { sb } = liveGame("voice-rooms", 8);
    const core = sb.session.snapshot();
    core.presence = {
      [npc(1)]: "kitchen", [npc(2)]: "kitchen", [npc(3)]: "backyard",
    } as Record<EntityId, Room>;
    sb.session.restore(core);
    const inKitchen = sb.session.npcVoice(npc(1))!;
    expect(inKitchen.whereabouts!.room).toBe("kitchen");
    expect(inKitchen.whereabouts!.present.map((p) => p.id)).toEqual([npc(2)]);
    const inYard = sb.session.npcVoice(npc(3))!;
    expect(inYard.whereabouts!.room).toBe("backyard");
    expect(inYard.whereabouts!.present).toEqual([]); // alone — nobody from the kitchen bleeds in
  });
});
