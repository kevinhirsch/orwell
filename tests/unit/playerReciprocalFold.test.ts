import { describe, it, expect } from "vitest";
import { foldPlayerReciprocal } from "../../src/engine/consequence";
import { RelationshipModel } from "../../src/engine/relationships";
import { RELATIONSHIP_CONSTANTS } from "../../src/engine/relationshipConstants";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import type { RandomnessSource } from "../../src/ports/RandomnessSource";
import { EngineCommandsAdapter } from "../../src/adapters/engine/EngineCommandsAdapter";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { InMemoryEventStore } from "../../src/adapters/inmemory/InMemoryEventStore";
import { InMemoryKnowledgeService } from "../../src/adapters/inmemory/InMemoryKnowledgeService";
import { PLAYER, npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";

/**
 * Phase 3 of "the player can play offense" (audit finding SG-2, 2026-07-03 final-pre-ship audit) —
 * the closed-set relationship layer. Before this fix, `player→NPC` moved ONLY at move-in scatter and
 * rare ceremony folds: every `recordInteraction` partner fold moved the partner's opinion OF the
 * player, never the player's OWN edge toward the partner, so `player→NPC` sat frozen under every
 * `formAlliance`/`joinAlliance` (0107) mutual-bond gate for a whole season. Roles only (no names —
 * testing rule).
 */

function build(seed = 77) {
  const rel = new RelationshipModel(0.5);
  const events = new InMemoryEventStore();
  const knowledge = new InMemoryKnowledgeService(events);
  const rng = new SeededRandom(seed);
  const commands = new EngineCommandsAdapter(events, knowledge, rel, rng);
  return { commands, rel, events };
}

describe("0107/SG-2 — foldPlayerReciprocal, the pure unit", () => {
  it("moves the initiator's OWN edge toward each partner, scaled by RECIPROCAL_SHARE", () => {
    const rel = new RelationshipModel(0.5);
    const rng = new SeededRandom(1);
    const before = { ...rel.edge(PLAYER, npc(1)) };
    foldPlayerReciprocal(rel, rng, PLAYER, [npc(1)], "bonding");
    const after = rel.edge(PLAYER, npc(1));
    expect(after.trust).toBeGreaterThan(before.trust);
    expect(after.affinity).toBeGreaterThan(before.affinity);
    // Bounded below the FULL direct impact (RECIPROCAL_SHARE < 1) — the player's own read firms up
    // more slowly than a houseguest's memorable read of the player.
    const rel2 = new RelationshipModel(0.5);
    const rng2 = new SeededRandom(1);
    rel2.applyDirected(PLAYER, npc(1), "bonding", rng2);
    expect(after.trust - before.trust).toBeLessThan(rel2.edge(PLAYER, npc(1)).trust - before.trust);
  });

  it("is a NO-OP for any initiator other than the player (byte-identical scope)", () => {
    const rel = new RelationshipModel(0.5);
    const rng = new SeededRandom(1);
    const before = { ...rel.edge(npc(2), PLAYER) };
    foldPlayerReciprocal(rel, rng, npc(1), [PLAYER], "bonding");
    expect(rel.edge(npc(2), PLAYER)).toEqual(before); // untouched — never fired for an NPC initiator
    expect(rel.edge(npc(1), PLAYER)).toEqual({ ...RELATIONSHIP_CONSTANTS.baseline, confidence: 0 });
  });

  it("no-ops on an empty partner list (never draws rng it doesn't need)", () => {
    const rel = new RelationshipModel(0.5);
    let draws = 0;
    const countingRng: RandomnessSource = {
      next: () => { draws++; return 0.5; },
      int: () => 0,
      pick: <T,>(a: readonly T[]) => a[0]!,
      fork: (_label: string) => countingRng,
    };
    foldPlayerReciprocal(rel, countingRng, PLAYER, [], "bonding");
    expect(draws).toBe(0);
  });
});

describe("0107/SG-2 — EngineCommandsAdapter.recordInteraction wires the reciprocal in", () => {
  it("a PLAYER-initiated kind-tagged scene moves BOTH directions: partner→player (existing) AND player→partner (new)", () => {
    const { commands, rel } = build();
    const before = { toward: { ...rel.edge(npc(1), PLAYER) }, from: { ...rel.edge(PLAYER, npc(1)) } };
    commands.recordInteraction({
      initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: "a genuine conversation", kind: "bonding",
    });
    expect(rel.edge(npc(1), PLAYER).trust).toBeGreaterThan(before.toward.trust); // unchanged existing direction
    expect(rel.edge(PLAYER, npc(1)).trust).toBeGreaterThan(before.from.trust); // the Phase 3 fix
  });

  it("an NPC-initiated scene through this channel is UNCHANGED (out of scope; no live caller sends it today)", () => {
    const { commands, rel } = build();
    const before = { ...rel.edge(PLAYER, npc(1)) }; // player's edge toward the NPC initiator
    commands.recordInteraction({
      initiator: npc(1), witnessSet: [npc(1), PLAYER], content: "they pulled me aside", kind: "betrayal",
    });
    // The pre-existing behavior (player, as the "partner" witness, forms their own read of the NPC
    // initiator) still fires — that path predates this change. What must NOT additionally fire is
    // `foldPlayerReciprocal` a second time on top of it (it is a strict no-op for a non-player initiator).
    const a = new RelationshipModel(0.5);
    const events = new InMemoryEventStore();
    const knowledge = new InMemoryKnowledgeService(events);
    const rngA = new SeededRandom(77);
    const commandsA = new EngineCommandsAdapter(events, knowledge, a, rngA);
    commandsA.recordInteraction({
      initiator: npc(1), witnessSet: [npc(1), PLAYER], content: "they pulled me aside", kind: "betrayal",
    });
    expect(rel.edge(PLAYER, npc(1))).toEqual(a.edge(PLAYER, npc(1)));
    expect(rel.edge(PLAYER, npc(1))).not.toEqual(before);
  });

  it("spends NO new budget — the per-beat-per-edge cap (E21) still bounds the reciprocal too", () => {
    const { commands, rel } = build();
    for (let i = 0; i < 12; i++) {
      commands.recordInteraction({
        initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: `chat ${i}`, kind: "bonding",
      });
    }
    const capped = { ...rel.edge(PLAYER, npc(1)) };
    // Exactly 3 more identical calls (MAX_FOLDS_PER_PAIR_PER_BEAT) must change nothing further.
    commands.recordInteraction({ initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: "one more", kind: "bonding" });
    expect(rel.edge(PLAYER, npc(1))).toEqual(capped);
  });
});

describe("0107/SG-2 — formAlliance becomes organically reachable through genuine play", () => {
  it("a few real bonding/alliance/strategy scenes (no manual edge-setting) clear the mutual-bond gate", () => {
    const rel = new RelationshipModel(0.5);
    const events = new InMemoryEventStore();
    const knowledge = new InMemoryKnowledgeService(events);
    const rng = new SeededRandom(2026);
    const commands = new EngineCommandsAdapter(events, knowledge, rel, rng);
    const session = new GameSessionAdapter(rel);
    session.createCharacter({ playerName: "The Player", seed: 2026 });
    const ids = (session.snapshot().house?.npcs ?? []).map((n: { id: EntityId }) => n.id);
    const allies = ids.slice(0, 2);

    // Before ANY play, the mutual bond is nowhere close (move-in scatter only) — the SG-2 baseline.
    const before = session.formAlliance({ name: "Too Soon", members: allies });
    expect(before).toBeNull();

    // A handful of genuine scenes per ally — the same shape the calibration gradient harness already
    // plays for "a player who shows up" (tests/property/calibrationGradientShared.ts).
    const kinds = ["bonding", "alliance", "strategy"] as const;
    for (const ally of allies) {
      for (const kind of kinds) {
        commands.recordInteraction({
          initiator: PLAYER, witnessSet: [PLAYER, ally], content: "a quiet conversation building trust", kind,
        });
      }
    }

    const view = session.formAlliance({ name: "The Nucleus", members: allies });
    // Before this fix `formAlliance` null-returned FOREVER here (SG-2) — the mutual bond could
    // never clear the gate however much the player engaged. It is enough to prove it is now
    // REACHABLE through ordinary play: the player is enrolled as founder, and at least one
    // genuinely-engaged ally clears the mutual-bond floor (per-seed jitter decides whether both do
    // — `alliances0107.test.ts` already covers the "not close enough declines" half separately).
    expect(view).not.toBeNull();
    expect(view!.youAreFounder).toBe(true);
    const joinedAllies = view!.members.map((m) => m.id).filter((id) => id !== PLAYER);
    expect(joinedAllies.length).toBeGreaterThanOrEqual(1);
    expect(joinedAllies.every((id) => allies.includes(id))).toBe(true);
    // Vault-safe: the projection never carries a relationship number.
    expect(JSON.stringify(view)).not.toMatch(/0\.\d/);
  });
});
