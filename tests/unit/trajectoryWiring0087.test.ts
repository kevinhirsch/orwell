import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { RelationshipModel } from "../../src/engine/relationships";
import { STEADY, type Trajectory, type FoldSignal } from "../../src/engine/trajectory";
import { TRAJECTORY_CONSTANTS } from "../../src/engine/trajectoryConstants";
import type { EntityId } from "../../src/domain/ids";

/**
 * Feature 0087 — the live WIRING: relationship-trajectory momentum is built engine-side from the
 * off-screen folds, round-trips through the snapshot (resumes mid-arc), and is Vault-sealed off every
 * player- AND admin-facing seam. When the layer is OFF (the default) no momentum is computed and
 * `trajectoryOf` is `STEADY` (identity) ⇒ the off-screen tick is byte-identical (the calibration
 * guarantee). Roles only; generated cast.
 */

interface TWired {
  trajectories: Map<string, Trajectory>;
  trajectoryFolds: Map<string, FoldSignal[]>;
  recordTrajectoryFold: (a: EntityId, b: EntityId, type: string) => void;
  decayUntouchedTrajectories: (touched: ReadonlySet<string>) => void;
}
const wired = (s: GameSessionAdapter): TWired => s as unknown as TWired;

function started(seed: number, enabled: boolean): GameSessionAdapter {
  const s = new GameSessionAdapter(new RelationshipModel(0.5));
  s.setTrajectoriesEnabled(enabled);
  s.createCharacter({ playerName: "The Player", seed });
  return s;
}
function npcIds(s: GameSessionAdapter): EntityId[] {
  return (s.snapshot().house?.npcs ?? []).map((n) => n.id);
}

describe("0087 trajectories — live derivation gated by the layer flag", () => {
  it("with the layer ON, recording a string of bonding folds builds a WARMING arc", () => {
    const s = started(2026, true);
    const [a, b] = npcIds(s);
    for (let k = 0; k < TRAJECTORY_CONSTANTS.recencyWindow; k++) wired(s).recordTrajectoryFold(a!, b!, "bonding");
    const t = s.trajectoryOf(a!, b!);
    expect(t.phase).toBe("warming");
    expect(t.momentum).toBeGreaterThan(0);
  });

  it("with the layer ON, a run of conflict folds curdles into a SOURING arc", () => {
    const s = started(2026, true);
    const [a, b] = npcIds(s);
    for (let k = 0; k < TRAJECTORY_CONSTANTS.recencyWindow; k++) wired(s).recordTrajectoryFold(a!, b!, "conflict");
    expect(s.trajectoryOf(a!, b!).phase).toBe("souring");
  });

  it("with the layer OFF (default), recording folds computes NO momentum — trajectoryOf is STEADY (identity)", () => {
    const s = started(2026, false);
    const [a, b] = npcIds(s);
    for (let k = 0; k < 4; k++) wired(s).recordTrajectoryFold(a!, b!, "conflict");
    expect(wired(s).trajectories.size).toBe(0);
    expect(s.trajectoryOf(a!, b!)).toEqual(STEADY);
    expect(s.trajectoriesEnabledNow()).toBe(false);
  });

  it("an arc is perspective-bound (directed): A→B momentum is independent of B→A (criterion 7)", () => {
    const s = started(7, true);
    const [a, b] = npcIds(s);
    for (let k = 0; k < TRAJECTORY_CONSTANTS.recencyWindow; k++) wired(s).recordTrajectoryFold(a!, b!, "conflict");
    expect(s.trajectoryOf(a!, b!).phase).toBe("souring");
    expect(s.trajectoryOf(b!, a!)).toEqual(STEADY); // the reverse edge folded nothing
  });

  it("an unfed arc decays toward steady (the neglect cadence)", () => {
    const s = started(7, true);
    const [a, b, c] = npcIds(s);
    for (let k = 0; k < TRAJECTORY_CONSTANTS.recencyWindow; k++) wired(s).recordTrajectoryFold(a!, b!, "conflict");
    const before = s.trajectoryOf(a!, b!).momentum;
    // A later tick where a→b is NOT touched (only a→c folds): a→b decays.
    wired(s).recordTrajectoryFold(a!, c!, "bonding");
    wired(s).decayUntouchedTrajectories(new Set([`${a}->${c}`]));
    expect(s.trajectoryOf(a!, b!).momentum).toBeLessThan(before);
  });

  it("the arc round-trips through a snapshot/restore — a restored game resumes mid-curdle (criterion 6)", () => {
    const s = started(88, true);
    const [a, b] = npcIds(s);
    for (let k = 0; k < TRAJECTORY_CONSTANTS.recencyWindow; k++) wired(s).recordTrajectoryFold(a!, b!, "conflict");
    const before = s.trajectoryOf(a!, b!);
    expect(before.phase).toBe("souring");

    const revived = new GameSessionAdapter(new RelationshipModel(0.5));
    revived.setTrajectoriesEnabled(true);
    revived.restore(s.snapshot());
    expect(revived.trajectoryOf(a!, b!)).toEqual(before); // resumes at the same phase + momentum
    // And the ring buffer survived, so a FURTHER fold derives from the full recent history.
    expect([...wired(revived).trajectoryFolds.entries()]).toEqual([...wired(s).trajectoryFolds.entries()]);
  });

  it("a save written BEFORE this feature loads at steady with no error (criterion 6)", () => {
    const s = started(5, true);
    const snap = s.snapshot();
    // Simulate a pre-0087 save: strip the trajectory fields.
    delete (snap as { trajectories?: unknown }).trajectories;
    delete (snap as { trajectoryFolds?: unknown }).trajectoryFolds;
    const revived = new GameSessionAdapter(new RelationshipModel(0.5));
    revived.setTrajectoriesEnabled(true);
    expect(() => revived.restore(snap)).not.toThrow();
    const [a, b] = npcIds(revived);
    expect(revived.trajectoryOf(a!, b!)).toEqual(STEADY);
    expect(wired(revived).trajectories.size).toBe(0);
  });
});

describe("0087 trajectories — Vault-sealed off the player AND admin (criterion 3)", () => {
  // Build the SAME seeded house, drive the SAME folds, but with the trajectory layer ON vs OFF. Every
  // player- AND admin-facing projection must be BYTE-IDENTICAL — because the hidden momentum changes
  // NOTHING observable. This is strictly stronger than a token sweep (the words "phase"/"cooling"/etc.
  // appear in the narration prompt as ordinary English): if momentum surfaced ANYWHERE, the projection
  // would differ. Momentum lives ONLY in the engine-only `trajectories` map, read by no projection.
  function houseWithFolds(seed: number, enabled: boolean): GameSessionAdapter {
    const s = started(seed, enabled);
    const ids = npcIds(s);
    // A strong souring arc on one pair, a warming arc on another (real momentum, both directions).
    for (let k = 0; k < TRAJECTORY_CONSTANTS.recencyWindow; k++) {
      wired(s).recordTrajectoryFold(ids[0]!, ids[1]!, "conflict");
      wired(s).recordTrajectoryFold(ids[2]!, ids[3]!, "bonding");
    }
    return s;
  }

  /** Every Vault-FREE projection a player or admin surface can read off the adapter. */
  function projections(s: GameSessionAdapter): string {
    const ids = npcIds(s);
    return JSON.stringify([
      s.getMomentPrompt({}),            // the assembled narration prompt (the strongest player sweep)
      s.getMomentPrompt({ moment: "social" }),
      ...ids.map((id) => s.npcVoice(id)),
      s.gameStatus(),                   // the public board (player + admin status panel)
      s.whereabouts(),
      s.getGameState(),                 // the 0007 GameState projection
      s.playerTagline(),
      s.seasonRecap(),                  // the admin-readable post-game summary
    ]);
  }

  it("momentum genuinely exists when the layer is on (the test isn't vacuous)", () => {
    const s = houseWithFolds(91, true);
    const ids = npcIds(s);
    expect(s.trajectoryOf(ids[0]!, ids[1]!).phase).toBe("souring");
    expect(s.trajectoryOf(ids[2]!, ids[3]!).phase).toBe("warming");
    expect(wired(s).trajectories.size).toBeGreaterThan(0);
  });

  it("every player- AND admin-facing projection is BYTE-IDENTICAL with the layer on vs off", () => {
    for (const seed of [91, 92, 137]) {
      const on = projections(houseWithFolds(seed, true));
      const off = projections(houseWithFolds(seed, false));
      expect(on, `seed ${seed}: hidden momentum changes NO observable projection`).toBe(off);
    }
  });

  it("a strong-momentum arc's projections carry no trajectory-shaped {phase, momentum} OBJECT", () => {
    // Defense-in-depth beside the byte-identity proof: assert the distinctive serialized SHAPE a leaked
    // Trajectory would take ({"phase":"…","momentum":<n>}) is absent — without tripping on the ordinary
    // English words ("phase"/"cooling") that legitimately appear in the narration prose.
    const blob = projections(houseWithFolds(91, true));
    expect(blob).not.toMatch(/"momentum"\s*:/);
    expect(blob).not.toMatch(/"phase"\s*:\s*"(warming|cooling|souring|steady)"/);
  });
});
