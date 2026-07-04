import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";

// A1 (ship-blocker, "the phantom-houseguest root") — async deep cast-authoring races the premiere: the
// player meets an NPC under one (seeded floor) name, and the FE-driven `recordCastProfile` write-back
// (which authors in the BACKGROUND, both at season start and later via the authoring backfill) completes
// asynchronously and silently RENAMES that same houseguest. The GM then appears to "correct" the player
// about the game's own prior words, though the player misremembered nothing — this is an engine-side
// concurrency bug, not a model hallucination.
//
// The fix is structural, at the `recordCastProfile` boundary: once a houseguest has been INTRODUCED to
// the player (the engine's own `markHouseguestMet` structural tracker — the same signal the premiere
// meet-everyone gate uses), their PUBLIC name is permanently frozen. A late-arriving authored name is
// silently dropped (mirroring the existing cross-character per-field drop) — the rest of the authored
// profile (biography/secrets/etc.) still applies.
//
// Roles only — no fixture names; every name read below comes from the engine's own seeded/authored output.

function freshGame(seed: number) {
  const s = new GameSessionAdapter();
  s.createCharacter({ playerName: "The Player", seed });
  return s;
}

describe("A1 — recordCastProfile can never rename an already-introduced houseguest", () => {
  it("an NPC introduced via markHouseguestMet keeps its name through a later authoring write-back", () => {
    const s = freshGame(3);
    const npc = s.getGameState().house.find((h) => h.status === "active")!;
    const seededName = npc.name;

    // Structural introduction: the same event the premiere narration flow drives (the GM has now shown
    // the player this houseguest's name).
    s.markHouseguestMet(npc.id);

    // A deep cast-authoring write-back arrives AFTER the introduction (the async race) proposing a
    // DIFFERENT display name, as `author_cast`'s parsed profile would.
    const res = s.recordCastProfile({
      houseguestId: npc.id,
      name: "Marcus Webb",
      biography: "Grew up working the docks before chasing a very different kind of spotlight entirely.",
    });

    // The call still succeeds (best-effort authoring keeps applying everything else)...
    expect(res.accepted).toBe(true);
    // ...but the name field was refused — never listed as an accepted public field...
    expect(res.publicFields).not.toContain("name");
    // ...and the houseguest's PUBLIC name on the live roster is BYTE-IDENTICAL to what the player saw.
    const after = s.getGameState().house.find((h) => h.id === npc.id)!;
    expect(after.name).toBe(seededName);
    expect(after.name).not.toBe("Marcus Webb");

    // The rest of the authored profile (a genuinely public, non-name facet) still landed — the guard is
    // surgical, not a whole-call refusal.
    expect(res.publicFields).toContain("biography");
  });

  it("an NPC NOT yet introduced can still be renamed by authoring (the guard never over-rejects)", () => {
    const s = freshGame(3);
    const npc = s.getGameState().house.find((h) => h.status === "active")!;
    // No markHouseguestMet call — this houseguest has not been introduced to the player yet.

    const res = s.recordCastProfile({ houseguestId: npc.id, name: "Priya Anand" });
    expect(res.accepted).toBe(true);
    expect(res.publicFields).toContain("name");
    const after = s.getGameState().house.find((h) => h.id === npc.id)!;
    expect(after.name).toBe("Priya Anand");
  });

  it("the name lock survives a snapshot/restore (the race can span an engine restart)", () => {
    const s = freshGame(5);
    const npc = s.getGameState().house.find((h) => h.status === "active")!;
    const seededName = npc.name;
    s.markHouseguestMet(npc.id);

    const core = s.snapshot();
    s.restore(core);

    const res = s.recordCastProfile({ houseguestId: npc.id, name: "Diego Fuentes" });
    expect(res.publicFields).not.toContain("name");
    expect(s.getGameState().house.find((h) => h.id === npc.id)!.name).toBe(seededName);
  });

  it("the lock outlives the premiere itself — the vestigial `premiereMet` tracker clears, the name lock does not", () => {
    const s = freshGame(9);
    const activeNpcs = s.getGameState().house.filter((h) => h.status === "active");
    const target = activeNpcs[0]!;
    const seededName = target.name;
    for (const h of activeNpcs) s.markHouseguestMet(h.id);
    expect(s.premiereIntros()!.complete).toBe(true);

    // Advance past the premiere — the vestigial meet-everyone tracker is cleared (by design)...
    s.advanceGame();
    expect(s.premiereIntros()).toBeNull();
    expect(s.snapshot().premiereIntros).toBeUndefined();

    // ...but a LATE authoring write-back for the already-introduced houseguest is still refused.
    const res = s.recordCastProfile({ houseguestId: target.id, name: "Samuel Kessler" });
    expect(res.publicFields).not.toContain("name");
    expect(s.getGameState().house.find((h) => h.id === target.id)!.name).toBe(seededName);
  });

  it("a fresh season (restart) starts with no locked names — the lock is season-scoped", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "The Player", seed: 2 });
    const first = s.getGameState().house.find((h) => h.status === "active")!;
    s.markHouseguestMet(first.id);

    // Confirmed restart onto a fresh season (same in-process adapter, standalone fallback path).
    s.createCharacter({ playerName: "The Player", seed: 44, confirmRestart: true });
    const npc = s.getGameState().house.find((h) => h.status === "active")!;
    // A brand-new season's cast has not been introduced to anyone yet — authoring may still rename.
    const res = s.recordCastProfile({ houseguestId: npc.id, name: "Elena Torres" });
    expect(res.publicFields).toContain("name");
    expect(s.getGameState().house.find((h) => h.id === npc.id)!.name).toBe("Elena Torres");
  });
});
