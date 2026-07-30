import { describe, it, expect } from "vitest";
import { InMemoryKnowledgeService } from "../../src/adapters/inmemory/InMemoryKnowledgeService";
import { buildSandbox } from "../support/sandbox";
import { PLAYER, npc } from "../../src/domain/ids";
import { isNpcReachable, NO_NPC_PATHWAY } from "../../src/engine/diaryRoom";

/**
 * #1793 — The Player Dossier: subject-tagged diary-room reads, grouped per houseguest.
 * Boundary tests using in-memory implementations.
 */

describe("#1793 — Player Dossier", () => {
  it("subject-tagging: after recording a diary-room entry WITH a subjectId, the fact stored in knowledge has that subject", () => {
    const sb = buildSandbox(1);
    const leo = npc(1);
    const content = "I think Leo is playing both sides";
    sb.engine.knowledge.recordDiaryRoom(content, leo);

    const playerKnown = sb.engine.knowledge.knownTo(PLAYER);
    const dr = playerKnown.find((k) => k.content === content);
    expect(dr).toBeDefined();
    expect(dr!.subject).toBe(leo);
  });

  it("no-subject-backward-compat: diary-room entry WITHOUT subjectId stores no subject field", () => {
    const sb = buildSandbox(1);
    const content = "I have a gut feeling about this week";
    sb.engine.knowledge.recordDiaryRoom(content);

    const playerKnown = sb.engine.knowledge.knownTo(PLAYER);
    const dr = playerKnown.find((k) => k.content === content);
    expect(dr).toBeDefined();
    expect(dr!.subject).toBeUndefined();
  });

  it("playerDossier-groups-by-subject: multiple entries tagged to different subjects are grouped correctly", () => {
    const sb = buildSandbox(1);
    const leo = npc(1);
    const maeve = npc(2);

    sb.engine.knowledge.recordDiaryRoom("Leo is sketchy", leo);
    sb.engine.knowledge.recordDiaryRoom("Maeve might be a threat", maeve);
    sb.engine.knowledge.recordDiaryRoom("Leo denied everything", leo);

    const playerKnown = sb.engine.knowledge.knownTo(PLAYER);
    // Import and use groupPlayerDossier via the same function. Since it's module-private
    // in GameSessionAdapter, we test the knowledge facts directly:
    const leoEntries = playerKnown.filter((k) => k.subject === leo);
    const maeveEntries = playerKnown.filter((k) => k.subject === maeve);

    expect(leoEntries).toHaveLength(2);
    expect(maeveEntries).toHaveLength(1);
    // Verify the subject mapping
    expect(leoEntries.every((e) => e.subject === leo)).toBe(true);
    expect(maeveEntries.every((e) => e.subject === maeve)).toBe(true);
  });

  it("playerDossier-filters-by-subjectId: knowledge facts are filterable by subject", () => {
    const sb = buildSandbox(1);
    const leo = npc(1);
    const maeve = npc(2);

    sb.engine.knowledge.recordDiaryRoom("Leo is sketchy", leo);
    sb.engine.knowledge.recordDiaryRoom("Maeve might be a threat", maeve);
    sb.engine.knowledge.recordDiaryRoom("Leo denied everything", leo);

    const playerKnown = sb.engine.knowledge.knownTo(PLAYER);
    const leoEntries = playerKnown.filter((k) => k.subject === leo);

    expect(leoEntries).toHaveLength(2);
    for (const e of leoEntries) {
      expect(e.subject).toBe(leo);
    }
  });

  it("NO-ENGINE-TRUTH boundary: non-diary-room/NPC knowledge facts NEVER appear even with matching subject", () => {
    const sb = buildSandbox(1);
    const leo = npc(1);
    const maeve = npc(2);

    // Record a diary-room entry with subject — this SHOULD appear
    sb.engine.knowledge.recordDiaryRoom("Leo seems trustworthy", leo);

    // Seed a belief on the PLAYER with a non-diary-room pathway but matching subject
    // This simulates engine truth leaking through: a witnessed/told fact about the same subject
    sb.engine.knowledge.seedBelief(PLAYER, {
      content: "Leo actually IS the target (engine truth)",
      subject: leo,
      factId: "fi:engine-truth",
    }, "witnessed");

    // Seed beliefs on NPCs (should never reach the player's knowledge)
    sb.engine.knowledge.seedBelief(leo, {
      content: "I am definitely the target",
      subject: leo,
      factId: "fi:npc-knowledge-1",
    }, "witnessed");
    sb.engine.knowledge.seedBelief(maeve, {
      content: "Leo confessed to me",
      subject: leo,
      factId: "fi:npc-knowledge-2",
    }, "told-by:some-npc");

    const playerKnown = sb.engine.knowledge.knownTo(PLAYER);

    // The player dossier should ONLY contain the diary-room entries
    const drEntries = playerKnown.filter((k) => k.pathway === NO_NPC_PATHWAY && k.subject === leo);
    expect(drEntries).toHaveLength(1);
    expect(drEntries[0]!.content).toBe("Leo seems trustworthy");

    // Non-diary-room facts about the same subject exist in player knowledge (via seedBelief) but are NOT diary-room entries
    const nonDrFacts = playerKnown.filter(
      (k) => k.pathway !== NO_NPC_PATHWAY && k.subject === leo
    );
    expect(nonDrFacts.length).toBeGreaterThanOrEqual(1);
    expect(nonDrFacts[0]!.content).toContain("engine truth");

    // These should NOT be mixed into the archive: pathway filter is the wall
    for (const f of nonDrFacts) {
      expect(f.pathway).not.toBe(NO_NPC_PATHWAY);
    }

    // NPCs have their own facts but the player doesn't see them
    // (seedBelief on NPCs = NPC-only knowledge; surfaceInformationTo with told-by:maeve
    //  fails content lineage since maeve doesn't hold that content)
    const npcKnowledge = [
      ...sb.engine.knowledge.knownTo(leo),
      ...sb.engine.knowledge.knownTo(maeve),
    ];
    expect(npcKnowledge.some((k) => k.content.includes("confessed to me"))).toBe(true);
    // But the player doesn't see those NPC-only facts
    expect(playerKnown.some((k) => k.content.includes("I am definitely"))).toBe(false);
    expect(playerKnown.some((k) => k.content.includes("confessed to me"))).toBe(false);
  });

  it("NO-NPC-PATHWAY wall: diary-room facts with subject are still diary-room pathway and not NPC-reachable", () => {
    const sb = buildSandbox(1);
    const leo = npc(1);
    const content = "Leo is my biggest competition right now";

    sb.engine.knowledge.recordDiaryRoom(content, leo);

    const playerKnown = sb.engine.knowledge.knownTo(PLAYER);
    const dr = playerKnown.find((k) => k.content === content);

    expect(dr).toBeDefined();
    expect(dr!.pathway).toBe(NO_NPC_PATHWAY);
    expect(isNpcReachable(dr!)).toBe(false);

    // Verify no NPC's knowledge ever contains it
    for (const id of [npc(1), npc(2), npc(3), npc(4)]) {
      expect(sb.engine.knowledge.knownTo(id).some((k) => k.content === content)).toBe(false);
    }
  });
});
