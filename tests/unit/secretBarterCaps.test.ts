import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { SECRET_BARTER } from "../../src/engine/secretBarterConstants";
import type { SessionSnapshot } from "../../src/engine/sessionSnapshot";
import type { LiveSeasonState } from "../../src/engine/liveSeason";
import type { EdgeRecord } from "../../src/domain/saveState";
import { PLAYER, npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";

/**
 * Feature 0099 (hidden half) — per-tick HARD caps on the off-screen NPC↔NPC SECRET-BARTER tick driver.
 * PROVES the two bounded-resource knobs (`maxBartersPerTick`, `maxHoldersPerTick`) bite as declared in
 * `secretBarterConstants.ts`, even when the knowledge layer is rich with tradeable secrets.
 *
 * HARD rule: roles only, no names; all fixtures generated. Cast = player + npc(1..15).
 */

const SUBJECT = npc(2);   // the houseguest the secrets are about
const WANTER = npc(3);    // fears the SUBJECT ⇒ VALUES any secret about them ⇒ the barter's recipient
const ALL_NPCS: EntityId[] = Array.from({ length: 15 }, (_, i) => npc(i + 1));

/** A mid-game live state with every NPC still in the house — so `isActiveNpc` holds. */
function midGameLive(): LiveSeasonState {
  return {
    week: 1,
    beat: "hoh-competition",
    active: [PLAYER, ...ALL_NPCS],
    vetoUsed: false,
    evictionOrder: [],
    finished: false,
  };
}

/** The ONE recipient (WANTER) fears the subject; everyone else likes it so the secrets are worthless to them. */
function capsEdges(givers: readonly EntityId[]): EdgeRecord[] {
  const edges: EdgeRecord[] = [];
  const e = (from: EntityId, to: EntityId, o: Partial<EdgeRecord>): void => {
    edges.push({ from, to, trust: 0.3, affinity: 0.3, threat: 0.3, alignment: 0.3, confidence: 0.5, reliability: 0.3, ...o });
  };
  e(WANTER, SUBJECT, { threat: 0.9, affinity: 0.05 }); // fears the subject ⇒ wants leverage on them
  for (const g of givers) {
    e(WANTER, g, { trust: 0.7 }); // trusts each giver ⇒ the offer isn't discounted
  }
  for (const n of ALL_NPCS) {
    if (n === WANTER || n === SUBJECT || givers.includes(n)) continue;
    e(n, SUBJECT, { threat: 0.0, affinity: 0.9 }); // likes the subject ⇒ the secret is worthless to them
    for (const g of givers) {
      e(n, g, { trust: 0.0 }); // distrusts the giver ⇒ any offer is discounted
    }
  }
  return edges;
}

/**
 * Stand up a started game, restore a crafted mid-game state + edges, and seed the givers' secrets.
 * Each giver gets `secretsPerGiver` distinct secrets (unique factIds) ABOUT SUBJECT.
 */
function capsGame(
  user: string, seed: number, givers: readonly EntityId[], secretsPerGiver: number,
): {
  reg: GameSessionRegistry; sb: ReturnType<GameSessionRegistry["sandboxFor"]>;
} {
  const reg = new GameSessionRegistry();
  reg.sandboxFor(user).session.createCharacter({ playerName: "The Player", seed });
  const snap = reg.snapshot(user) as SessionSnapshot;
  snap.live = midGameLive();
  snap.relationships = capsEdges(givers);
  reg.restore(user, snap);
  const sb = reg.sandboxFor(user);
  // Seed each giver with their distinct secrets about SUBJECT (seeded AFTER restore so they survive).
  for (let gi = 0; gi < givers.length; gi++) {
    const giver = givers[gi]!;
    for (let si = 0; si < secretsPerGiver; si++) {
      sb.engine.knowledge.seedBelief(
        giver,
        { content: `secret-cap-${gi}-${si} about the subject`, factId: `sb-cap-${gi}-${si}`, subject: SUBJECT, confidence: 1 },
        "origin",
      );
    }
  }
  return { reg, sb };
}

const holds = (
  sb: ReturnType<GameSessionRegistry["sandboxFor"]>, who: EntityId, factId: string,
): boolean => sb.engine.knowledge.knownTo(who).some((k) => (k.factId ?? k.id) === factId);

describe("0099 — maxBartersPerTick: the per-tick transfer hard cap bites when many tradeable secrets exist", () => {
  const GIVERS_A: EntityId[] = [npc(4), npc(5), npc(6), npc(7), npc(8)]; // 5 givers, each with fuel
  const SECRETS_PER_GIVER = 5; // 25 total secrets — enough capacity to keep ticks busy

  it("never exceeds SECRET_BARTER.maxBartersPerTick in any single tick across many ticks", () => {
    const { sb } = capsGame("max-barters", 7, GIVERS_A, SECRETS_PER_GIVER);
    sb.session.setSecretBarterEnabled(true);

    let priorCount = sb.session.snapshot().secretBarterCount ?? 0;
    const perTickDeltas: number[] = [];

    for (let t = 0; t < 200; t++) {
      sb.session.secretBarterTick(sb.engine.events, sb.engine.knowledge);
      const currentCount = sb.session.snapshot().secretBarterCount ?? 0;
      perTickDeltas.push(currentCount - priorCount);
      priorCount = currentCount;
    }

    // Total barters must be > 0 (non-vacuous: some secrets actually moved).
    const totalBarters = perTickDeltas.reduce((a, b) => a + b, 0);
    expect(totalBarters, "at least one secret was bartered — test is not vacuous").toBeGreaterThan(0);

    // Every per-tick delta respects the hard transfer cap.
    for (let t = 0; t < perTickDeltas.length; t++) {
      expect(
        perTickDeltas[t],
        `tick ${t} exceeded the max-barters-per-tick cap of ${SECRET_BARTER.maxBartersPerTick}`,
      ).toBeLessThanOrEqual(SECRET_BARTER.maxBartersPerTick);
    }

    // Conservative bound: total across all ticks cannot exceed maxBartersPerTick * N.
    expect(totalBarters).toBeLessThanOrEqual(SECRET_BARTER.maxBartersPerTick * perTickDeltas.length);
  });

  it("the per-tick cap reference is SECRET_BARTER.maxBartersPerTick (value = 2)", () => {
    expect(SECRET_BARTER.maxBartersPerTick).toBe(2);
  });
});

describe("0099 — maxHoldersPerTick: only the first N holders are ever scanned per tick", () => {
  const GIVERS_B: EntityId[] = Array.from({ length: 12 }, (_, i) => npc(i + 4)); // npc(4)..npc(15), 12 givers
  const SECRETS_PER_GIVER = 1; // 1 secret each = 12 total

  it("at most SECRET_BARTER.maxHoldersPerTick distinct givers ever successfully barter across many ticks", () => {
    const { sb } = capsGame("max-holders", 7, GIVERS_B, SECRETS_PER_GIVER);
    sb.session.setSecretBarterEnabled(true);

    // Lexicographic sorted order of holder IDs:
    //   npc:1  (GIVER, no secret),
    //   npc:10, npc:11, npc:12, npc:13, npc:14, npc:15  (first 6 with tradeable secrets)
    //   npc:2  (SUBJECT, no tradeable secrets),
    //   npc:3  (WANTER, no tradeable secrets before receiving),
    //   npc:4, npc:5, npc:6, npc:7, npc:8, npc:9  (next 6 with tradeable secrets — never scanned)
    //
    // So only npc(10)..npc(15) should ever appear in the holders list and thus ever transfer.
    const scannedGivers = Array.from({ length: 6 }, (_, i) => npc(i + 10));
    const excludedGivers = Array.from({ length: 6 }, (_, i) => npc(i + 4)); // npc(4)..npc(9)

    for (let t = 0; t < 200; t++) {
      sb.session.secretBarterTick(sb.engine.events, sb.engine.knowledge);
    }

    // Non-vacuous: at least one secret was actually bartered.
    const totalBarters = sb.session.snapshot().secretBarterCount ?? 0;
    expect(totalBarters, "at least one secret was bartered — test is not vacuous").toBeGreaterThan(0);

    // Every giver in the scanned set (first 6) successfully bartered at least once.
    for (const g of scannedGivers) {
      // Each giver has exactly one secret about SUBJECT, factId = `sb-cap-${index}-0`.
      const idx = GIVERS_B.indexOf(g);
      const factId = `sb-cap-${idx}-0`;
      expect(holds(sb, WANTER, factId), `scanned giver ${g}'s secret reached WANTER`).toBe(true);
    }

    // Every giver NOT in the scanned slice (npc 4..9) never bartered — the holder cap excluded them.
    for (const g of excludedGivers) {
      const idx = GIVERS_B.indexOf(g);
      const factId = `sb-cap-${idx}-0`;
      expect(holds(sb, WANTER, factId), `excluded giver ${g}'s secret never reached WANTER`).toBe(false);
    }

    // The number of distinct holders who bartered is exactly the scanned slice size.
    expect(SECRET_BARTER.maxHoldersPerTick).toBe(6);
  });
});
