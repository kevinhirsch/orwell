import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import type { Drive } from "../../src/engine/campaigns";

/**
 * Feature 0086 — the live WIRING: drives round-trip through the snapshot, are Vault-sealed off every
 * player-facing seam, and — when the drive/campaign layer is OFF (the default) — no drive is computed,
 * so the seeded game is byte-identical (the calibration guarantee). Roles only.
 */

function started(seed: number, enableCampaigns: boolean): GameSessionAdapter {
  const s = new GameSessionAdapter();
  s.setCampaignsEnabled(enableCampaigns); // gate is per-instance; module default is OFF (the calibration default)
  s.createCharacter({ playerName: "The Player", seed });
  return s;
}

type WithDrives = { drives: Map<string, Drive>; campaignTick: () => void };

describe("0086 drives — live derivation gated by the campaign layer", () => {
  it("with the layer ON, a tick derives a drive for every living NPC", () => {
    const s = started(2026, true);
    (s as unknown as WithDrives).campaignTick();
    const drives = (s as unknown as WithDrives).drives;
    const npcs = s.snapshot().house!.npcs.map((n) => n.id);
    expect(drives.size).toBeGreaterThan(0);
    for (const id of npcs) {
      const d = drives.get(id);
      expect(d, "every NPC carries a drive").toBeTruthy();
      expect(["self-preserve", "target", "build", "lay-low", "win-power"]).toContain(d!.motivation);
      expect(d!.intensity).toBeGreaterThanOrEqual(0);
      expect(d!.intensity).toBeLessThanOrEqual(1);
    }
  });

  it("with the layer OFF (default), a tick derives NO drives — byte-identical to pre-0086", () => {
    const s = started(2026, false);
    (s as unknown as WithDrives).campaignTick();
    expect((s as unknown as WithDrives).drives.size).toBe(0);
  });

  it("drives round-trip through a snapshot/restore", () => {
    const s = started(88, true);
    (s as unknown as WithDrives).campaignTick();
    const before = (s as unknown as WithDrives).drives;
    expect(before.size).toBeGreaterThan(0);

    const revived = new GameSessionAdapter();
    revived.restore(s.snapshot());
    const restored = (revived as unknown as WithDrives).drives;
    expect([...restored.entries()]).toEqual([...before.entries()]);
  });

  it("a drive never crosses any player-facing seam (Vault-sealed)", () => {
    const s = started(91, true);
    (s as unknown as WithDrives).campaignTick();
    const ids = s.snapshot().house!.npcs.map((n) => n.id);
    const surfaces = JSON.stringify([s.npcVoice(ids[0]!), s.gameStatus(), s.whereabouts()]);
    expect(surfaces).not.toMatch(/"motivation"|"intensity"|self-preserve|lay-low/);
  });
});
