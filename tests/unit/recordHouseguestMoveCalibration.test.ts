import { describe, it, expect } from "vitest";
import { adrFixture } from "../support/adr0003";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import type { RandomnessSource } from "../../src/ports/RandomnessSource";

/**
 * ADR 0009 (D4) — the dual-map contract: `recordHouseguestMove` (the D2 fold) is CALIBRATION-NEUTRAL.
 *
 * The move records a NARRATED relocation by mutating the OPEN, player-facing occupancy
 * (`this.presence` → `occupancy()`) ONLY — never the CLOSED, calibration-neutral baseline
 * (`presenceBase` → `societyOccupancy()`) the off-screen society pairs on. That separation is what
 * keeps the seeded society/relationship/vote spine byte-identical: the society reads `presenceBase`,
 * and the move neither touches it nor changes how the next `presenceTick`'s BASE pass consumes the
 * shared calibration rng.
 *
 * NOTE ON SCOPE (why this is an adapter-level guard, not a full-season byte-identity run): the engine's
 * seeded calibration gates (juryReach / movementStreamIsolation / the UAT) run a FIXED sequence of
 * advances and never interleave aux mutations. ANY interleaved aux commit — `recordInteraction`,
 * `makeDeal`, the shipped player-move belt `moveTo`/`movePlayer`, or even a bare `beatSeq` bump — shifts
 * the global seeded stream relative to that fixed sequence; that is a pre-existing, accepted property of
 * every aux belt, NOT a property of this fold. `recordHouseguestMove` is byte-for-byte the same commit
 * class as the long-shipped `moveTo`. So the meaningful, fold-specific guarantee is the DUAL-MAP
 * contract proved here: the open mutation never reaches the closed calibration occupancy.
 *
 * Roles only — no houseguest names.
 */

/** A RandomnessSource wrapper that counts every draw, so we can assert the shared-stream draw count. */
class CountingRng implements RandomnessSource {
  draws = 0;
  constructor(private readonly inner: RandomnessSource) {}
  next(): number { this.draws++; return this.inner.next(); }
  int(maxExclusive: number): number { this.draws++; return this.inner.int(maxExclusive); }
  pick<T>(items: readonly T[]): T { this.draws++; return items[this.inner.int(items.length)]!; }
  fork(label: string): RandomnessSource { return this.inner.fork(label); }
}

const otherRoom = (here: string | undefined): string => (here === "kitchen" ? "backyard" : "kitchen");

describe("ADR 0009 D4 — recordHouseguestMove is calibration-neutral (the dual-map contract)", () => {
  it("mutates the OPEN occupancy but leaves the CLOSED calibration occupancy byte-identical", () => {
    const fx = adrFixture("u-d4-a", 7);
    // Seed presence + presenceBase via the off-screen tick.
    fx.orch.advance("u-d4-a", "offscreen-tick");
    const s = fx.sb.session;

    const baseBefore = JSON.stringify([...(s.societyOccupancy() ?? new Map())].sort());
    const openBefore = JSON.stringify([...(s.occupancy() ?? new Map())].sort());

    // Move an active houseguest to a different room.
    const occ = s.occupancy()!;
    const mover = [...occ.keys()].find((id) => id !== fx.sb.session.snapshot().house!.player.id)!;
    const res = s.recordHouseguestMove(mover, otherRoom(occ.get(mover)));
    expect(res.status).toBe("moved");

    // The OPEN occupancy changed (the player sees the move) …
    expect(JSON.stringify([...(s.occupancy() ?? new Map())].sort())).not.toBe(openBefore);
    // … but the CLOSED calibration occupancy (presenceBase) the society pairs on is byte-identical.
    expect(JSON.stringify([...(s.societyOccupancy() ?? new Map())].sort())).toBe(baseBefore);
  });

  it("a presenceTick after a move yields a byte-identical base occupancy AND the same shared-rng draw count", () => {
    const fx = adrFixture("u-d4-b", 7);
    for (let i = 0; i < 3; i++) fx.orch.advance("u-d4-b", "offscreen-tick");
    const core = fx.sb.session.snapshot();
    const s = fx.sb.session;

    // Run a presenceTick from the same snapshot, with and without a preceding open-occupancy move,
    // each driving the BASE pass from a freshly-seeded identical shared rng. The calibration-bearing
    // base occupancy AND the number of shared-rng draws must match — proving the move cannot perturb
    // the seeded society/vote spine through the next tick.
    const run = (move: boolean): { base: string; draws: number } => {
      s.restore(core);
      if (move) {
        const occ = s.occupancy()!;
        for (const id of [...occ.keys()].filter((k) => k !== core.house!.player.id).slice(0, 2)) {
          s.recordHouseguestMove(id, otherRoom(occ.get(id)));
        }
      }
      const rng = new CountingRng(new SeededRandom(98765));
      s.presenceTick(rng);
      return { base: JSON.stringify([...(s.societyOccupancy() ?? new Map())].sort()), draws: rng.draws };
    };

    const clean = run(false);
    const moved = run(true);
    expect(moved.draws, "the base pass must draw the shared calibration rng the same number of times").toBe(clean.draws);
    expect(moved.base, "the calibration-neutral base occupancy must be byte-identical after the tick").toBe(clean.base);
  });
});
