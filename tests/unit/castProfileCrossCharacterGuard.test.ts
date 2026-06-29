import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";

// RCA hardening — recordCastProfile must not seal an authored HIDDEN storyline field (secrets / true goals /
// weakness / Day-1 read) that names ANOTHER CURRENT houseguest. The engine models inter-houseguest dynamics
// through the relationship layer, not through one NPC's authored secret, so a cross-character claim baked
// into a sealed thread is an ungrounded board assertion (anti-sycophancy #3). A genuinely-EXTERNAL person
// (an ex / colleague from before the house, i.e. a non-roster name) is legitimate and stays. Roles only —
// peer names are read from the engine's own seeded roster, never hard-coded.

describe("RCA — authored secrets naming another CURRENT houseguest are refused (the floor stands)", () => {
  it("does NOT seal a secret-thread containing a current peer's roster name", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "The Player", seed: 7 });
    const live = s.getGameState();
    const [subject, peer] = live.house; // the subject we author; a different current houseguest
    expect(subject && peer).toBeTruthy();
    const peerName = peer!.name;
    expect(peerName.length).toBeGreaterThanOrEqual(3);

    const res = s.recordCastProfile({
      houseguestId: subject!.id,
      secrets: [`Has been secretly working ${peerName} the whole game and feeding them the votes.`],
    });
    // The call itself still succeeds (we strip the offending field, not the whole call) — but `secrets`
    // is NOT among the sealed hidden fields (it fell back to the seeded floor).
    expect(res.accepted).toBe(true);
    expect(res.hiddenFields).not.toContain("secrets");

    // And the SUBJECT's own sealed secret threads (rendered through the producer-Vault unseal) carry no
    // peer name — they fell back to the seeded floor. (Each row renders as "<sourceName> — <prose>", so we
    // scope to the subject's rows; the peer legitimately appears as the source of THEIR OWN seeded threads.)
    const dump = s.producerVaultDump();
    expect(dump).not.toBeNull();
    const peerNameRe = new RegExp(`\\b${peerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    const subjectSecretThreads = dump!.hiddenStory
      .filter((r) => r.type === "Secret thread" && r.content.startsWith(`${subject!.name} —`));
    expect(subjectSecretThreads.length).toBeGreaterThan(0); // the floor secret thread still exists
    for (const t of subjectSecretThreads) expect(peerNameRe.test(t.content)).toBe(false);
  });

  it("an EXTERNAL (non-roster) name in a secret still passes — case (a) stays legitimate", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "The Player", seed: 7 });
    const live = s.getGameState();
    const subject = live.house[0]!;
    const rosterNames = new Set([live.player?.name, ...live.house.map((h) => h.name)]);
    const EXTERNAL = "Bartholomew Quillfeather"; // a person from before the house; provably NOT on the roster
    expect(rosterNames.has(EXTERNAL)).toBe(false);

    const res = s.recordCastProfile({
      houseguestId: subject.id,
      secrets: [`Left ${EXTERNAL}, an old business partner from back home, owed a great deal of money.`],
    });
    expect(res.accepted).toBe(true);
    // The external name is legitimate, so the authored `secrets` field IS sealed.
    expect(res.hiddenFields).toContain("secrets");
    const dump = s.producerVaultDump();
    expect(dump!.hiddenStory.some((r) => r.type === "Secret thread" && r.content.includes(EXTERNAL))).toBe(true);
  });

  it("the same guard covers true goals, weakness, and the Day-1 read", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "The Player", seed: 13 });
    const live = s.getGameState();
    const subject = live.house[0]!;
    const peerName = live.house[1]!.name;

    const res = s.recordCastProfile({
      houseguestId: subject.id,
      trueGoals: [`Get to the end sitting next to ${peerName}.`],
      weakness: `Will never cut ${peerName} even when it costs them.`,
      dayOnePerception: `Sized up ${peerName} as the person to beat.`,
    });
    expect(res.accepted).toBe(true);
    // Every peer-naming storyline field is refused (none sealed).
    expect(res.hiddenFields).not.toContain("trueGoals");
    expect(res.hiddenFields).not.toContain("weakness");
    expect(res.hiddenFields).not.toContain("dayOnePerception");
  });

  it("a clean storyline (no peer name) seals normally — the guard never over-rejects", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "The Player", seed: 13 });
    const subject = s.getGameState().house[0]!;
    const res = s.recordCastProfile({
      houseguestId: subject.id,
      secrets: ["Quietly cannot stand the kitchen clean-up rota and games the chore wheel."],
      trueGoals: ["Win without ever touching blood on their own hands."],
      weakness: "Folds under direct confrontation.",
    });
    expect(res.accepted).toBe(true);
    expect(res.hiddenFields).toEqual(expect.arrayContaining(["secrets", "trueGoals", "weakness"]));
  });
});
