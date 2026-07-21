import { describe, it, expect } from "vitest";
import { renderHardConstraints } from "../../src/engine/momentPrompts";

// #1752 — the terminal PRONOUN LOCK must never contradict itself. For a nonbinary present NPC,
// `pronounsFor` returns "they/them"; the old fixed caveat also said "never they/them", locking the
// NPC out of their own pronoun set. The caveat is now conditional.
describe("#1752 — the hard-constraints pronoun lock is never self-contradictory", () => {
  const mk = (gp: string) =>
    ({
      started: true,
      player: { id: "player", name: "The Player" },
      whereabouts: { present: [{ id: "npc:1", name: "Robin" }] },
      house: [{ id: "npc:1", name: "Robin", genderPresentation: gp }],
      presentKnowledge: [],
    }) as any;

  it("a present nonbinary NPC gets they/them with NO 'never they/them' contradiction", () => {
    const hc = renderHardConstraints(mk("nonbinary"))!;
    expect(hc).toContain("PRONOUN LOCK: Robin uses they/them.");
    expect(hc).not.toContain("never they/them");
  });

  it("a present gendered NPC still carries the 'never they/them' de-default nudge", () => {
    const hc = renderHardConstraints(mk("woman"))!;
    expect(hc).toContain("PRONOUN LOCK: Robin uses she/her.");
    expect(hc).toContain("never they/them");
  });
});
