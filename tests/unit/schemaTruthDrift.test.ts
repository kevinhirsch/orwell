import { describe, it, expect } from "vitest";
import { PLAYER_TOOLS } from "../../src/surfaces/tools/registry";
import { NPC_COUNT } from "../../src/engine/characterFactory";
import { WALKABLE_ROOMS, roomDisplayName, HOUSE_SIGHTLINE } from "../../src/domain/house";

// Batch C gate #8 (2026-07-11 narrator-prompt audit) — SCHEMA-TRUTH DRIFT.
//
// The gap: the lever-drift test only proves a prompt-named lever is CALLABLE. But the tool-schema
// DESCRIPTIONS are also read by the model — and they make concrete factual claims about the engine
// ("you do NOT need every one of the 15 formally introduced", "each room within SIGHTLINE",
// "Valid rooms: kitchen, living room, …"). Those claims can silently drift from engine semantics
// (the cast size changes, a room is renamed, the sightline model is replaced by adjacency) with NO
// test catching it — the description keeps asserting a stale fact the model then narrates.
//
// This gate pins the load-bearing factual claims in the player-tool descriptions against the engine
// symbols they describe. It never touches callability (the existing drift tests own that); it guards
// the TRUTH of what the description tells the model.
describe("schema-truth drift (Batch C #8 — tool descriptions match engine semantics)", () => {
  const desc = (name: string): string => {
    const t = PLAYER_TOOLS.find((d) => d.name === name);
    expect(t, `player tool \`${name}\` not found in the registry`).toBeTruthy();
    return t!.description;
  };

  it("markHouseguestMet's cast-size claim tracks NPC_COUNT (not a hard-coded 15)", () => {
    // The description says "you do NOT need every one of the <N> formally introduced". <N> is the
    // NPC roster size — if the cast size ever changes, this claim must move with it.
    const d = desc("markHouseguestMet");
    expect(d).toMatch(new RegExp(`\\b${NPC_COUNT}\\b\\s+formally introduced`));
    // Anti-stale pin: no OTHER bare cast-count integer is asserted in the description (a leftover
    // "16"/"14" would be a drifted claim). We only expect NPC_COUNT and the feature tag (0111).
    const bareCounts = (d.match(/\b(1[0-9]|20)\b/g) ?? []).filter((n) => n !== String(NPC_COUNT));
    // 0111 is a feature tag, not a count — allow it explicitly.
    expect(
      bareCounts.filter((n) => !d.includes(`(0${n}`) && !d.includes(`${n})`)),
      `markHouseguestMet asserts a cast count other than NPC_COUNT=${NPC_COUNT}: ${bareCounts.join(", ")}`,
    ).toEqual([]);
  });

  it("moveTo's 'Valid rooms' list names ONLY real walkable rooms (no invented/renamed room)", () => {
    const d = desc("moveTo");
    const walkable = new Set(WALKABLE_ROOMS.map((r) => roomDisplayName(r).toLowerCase()));
    const m = d.match(/Valid rooms:\s*([^.(]+)/);
    expect(m, "moveTo description no longer lists 'Valid rooms:' — update this pin").toBeTruthy();
    const listed = m![1]!.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    expect(listed.length, "expected moveTo to enumerate several valid rooms").toBeGreaterThanOrEqual(4);
    const invalid = listed.filter((r) => !walkable.has(r));
    expect(
      invalid,
      `moveTo names rooms the engine cannot walk to (WALKABLE_ROOMS=${[...walkable].join(", ")}): ${invalid.join(", ")}`,
    ).toEqual([]);
  });

  it("whereabouts's SIGHTLINE/eyeshot claim is backed by the engine's sightline graph", () => {
    // The description tells the model `nearby` rooms are those within SIGHTLINE (eyeshot) — a
    // real, NARROWER-than-adjacency engine model (0077 Phase 2). If that model were removed, the
    // description would be lying to the model about what it can see.
    const d = desc("whereabouts");
    expect(d).toMatch(/SIGHTLINE/);
    expect(d.toLowerCase()).toContain("eyeshot");
    // The engine graph actually exists and is populated (at least one room can see into another).
    expect(HOUSE_SIGHTLINE.size).toBeGreaterThan(0);
    let anyEdge = false;
    for (const sees of HOUSE_SIGHTLINE.values()) if (sees.length > 0) anyEdge = true;
    expect(anyEdge, "HOUSE_SIGHTLINE has no edges — whereabouts's SIGHTLINE claim is unbacked").toBe(true);
  });

  it("every player-tool description is non-empty (a description IS model-read schema surface)", () => {
    const blank = PLAYER_TOOLS.filter((t) => !t.description || !t.description.trim());
    expect(blank.map((t) => t.name), "player tools with an empty description").toEqual([]);
  });
});
