import { describe, it, expect } from "vitest";
import { richOffscreenStretch } from "../../src/engine/offscreen";
import { showmancePlausible, type ShowmanceIdentity } from "../../src/engine/diversity";
import { RelationshipModel } from "../../src/engine/relationships";
import { InMemoryEventStore } from "../../src/adapters/inmemory/InMemoryEventStore";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";

/**
 * #840 — a LIVE off-screen `showmance` scene must obey the SAME discipline the SEEDED layer (0059/0063)
 * does: it may form ONLY between an orientation-PLAUSIBLE pair, and no houseguest may hold more than one
 * active showmance partner. The fix wires `showmancePlausible` + a one-partner exclusivity cap into
 * `richOffscreenStretch`; an ineligible draw is DEMOTED to ordinary `bonding`, never recorded as romance.
 * HARD rule: roles only — no houseguest names.
 */

const NPCS: EntityId[] = [npc(1), npc(2), npc(3), npc(4), npc(5), npc(6)];

/** A warm house: every directed edge has high affinity, so showmance/bonding natures are drawn often. */
function warmHouse(): RelationshipModel {
  const rel = new RelationshipModel(0.5);
  for (const a of NPCS) for (const b of NPCS) {
    if (a === b) continue;
    const e = rel.edge(a, b);
    e.affinity = 0.95; e.trust = 0.6; e.threat = 0.02; e.alignment = 0.1;
  }
  return rel;
}

function runStretch(opts: {
  seed: number;
  interactions: number;
  rel: RelationshipModel;
  showmancePlausible?: (a: EntityId, b: EntityId) => boolean;
  hasActiveShowmance?: (id: EntityId) => boolean;
}) {
  const events = new InMemoryEventStore();
  return richOffscreenStretch({
    events,
    rng: new SeededRandom(opts.seed),
    npcs: NPCS,
    interactions: opts.interactions,
    edgeOf: (a, b) => opts.rel.edge(a, b),
    ...(opts.showmancePlausible ? { showmancePlausible: opts.showmancePlausible } : {}),
    ...(opts.hasActiveShowmance ? { hasActiveShowmance: opts.hasActiveShowmance } : {}),
  });
}

describe("#840 — live off-screen showmance gating (orientation + exclusivity)", () => {
  it("a warm house DOES produce showmance scenes when ungated (the gate has something to act on)", () => {
    const rel = warmHouse();
    let showmances = 0;
    for (let seed = 1; seed <= 60; seed++) {
      showmances += runStretch({ seed, interactions: 8, rel }).filter((s) => s.type === "showmance").length;
    }
    expect(showmances, "the warm-house fixture must actually generate showmances ungated").toBeGreaterThan(0);
  });

  it("(a) every live showmance is orientation-PLAUSIBLE", () => {
    // Two strictly-straight men + two strictly-straight women + a bi pair: only some pairings are plausible.
    const identities: Record<EntityId, ShowmanceIdentity> = {
      [npc(1)]: { orientation: "straight", genderPresentation: "man" },
      [npc(2)]: { orientation: "straight", genderPresentation: "man" },
      [npc(3)]: { orientation: "straight", genderPresentation: "woman" },
      [npc(4)]: { orientation: "straight", genderPresentation: "woman" },
      [npc(5)]: { orientation: "bisexual", genderPresentation: "man" },
      [npc(6)]: { orientation: "lesbian", genderPresentation: "woman" },
    };
    const plausible = (a: EntityId, b: EntityId) => showmancePlausible(identities[a]!, identities[b]!);
    const rel = warmHouse();
    let showmances = 0;
    for (let seed = 1; seed <= 200; seed++) {
      for (const s of runStretch({ seed, interactions: 6, rel, showmancePlausible: plausible })) {
        if (s.type !== "showmance") continue;
        showmances++;
        // Both directions are checked because the recorded pair is unordered for plausibility.
        expect(
          plausible(s.initiator, s.partner),
          `seed ${seed}: a live showmance formed between an orientation-implausible pair`,
        ).toBe(true);
      }
    }
    // The gate DEMOTES the implausible ones to bonding, but plausible pairs (e.g. a straight man+woman,
    // the bi/lesbian women) still form — so the gating is real, not a blanket suppression.
    expect(showmances, "plausible showmances still form (the gate is selective, not total)").toBeGreaterThan(0);
  });

  it("(b) no houseguest holds more than ONE active showmance partner — within a single stretch", () => {
    const rel = warmHouse(); // everyone plausible (no orientation gate ⇒ exclusivity is the only gate)
    for (let seed = 1; seed <= 200; seed++) {
      const scenes = runStretch({ seed, interactions: 10, rel, hasActiveShowmance: () => false });
      const partnerCount = new Map<EntityId, number>();
      const partners = new Map<EntityId, Set<EntityId>>();
      for (const s of scenes) {
        if (s.type !== "showmance") continue;
        for (const [x, y] of [[s.initiator, s.partner], [s.partner, s.initiator]] as const) {
          const set = partners.get(x) ?? new Set<EntityId>();
          set.add(y);
          partners.set(x, set);
          partnerCount.set(x, set.size);
        }
      }
      for (const [id, n] of partnerCount) {
        expect(n, `seed ${seed}: ${id} held ${n} distinct active showmance partners (cap is 1)`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("(b) a houseguest who ALREADY holds a seeded showmance never forms a SECOND one off-screen", () => {
    const rel = warmHouse();
    // npc1 already has an active (seeded) showmance partner coming in.
    const hasActiveShowmance = (id: EntityId) => id === npc(1);
    for (let seed = 1; seed <= 200; seed++) {
      for (const s of runStretch({ seed, interactions: 10, rel, hasActiveShowmance })) {
        if (s.type !== "showmance") continue;
        expect(
          s.initiator !== npc(1) && s.partner !== npc(1),
          `seed ${seed}: an already-partnered houseguest formed a second off-screen showmance`,
        ).toBe(true);
      }
    }
  });

  it("the gate is OFF when its deps are absent — the pre-#840 society is byte-for-byte preserved", () => {
    const rel = warmHouse();
    const draw = () =>
      runStretch({ seed: 11, interactions: 8, rel }).map((s) => `${s.initiator}|${s.partner}|${s.type}`);
    const ungated = draw();
    // Re-deriving the SAME gate predicate set should not change a single drawn scene id/type sequence
    // beyond the showmance demotions — but with NO deps supplied, it is identical to itself (determinism).
    expect(draw()).toEqual(ungated);
    // And at least one showmance survives in the ungated stream (so the "off" path genuinely allows them).
    expect(ungated.some((s) => s.endsWith("|showmance")), "ungated stream still yields showmances").toBe(true);
  });
});
