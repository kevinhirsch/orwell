import { InMemoryEventStore } from "../adapters/inmemory/InMemoryEventStore";
import type { EventStore } from "../ports/EventStore";
import type { RandomnessSource } from "../ports/RandomnessSource";
import { PLAYER } from "../domain/ids";
import type { EntityId } from "../domain/ids";
import { generateHouse } from "./characters";
import { RelationshipModel } from "./relationships";
import type { InteractionType } from "./relationships";
import { SIM } from "./richnessConfig";

const TYPES: readonly InteractionType[] = [
  "alliance", "gossip", "conflict", "bonding", "strategy", "showmance", "betrayal",
];

export interface MomentRecord {
  day: number;
  type: InteractionType;
  initiator: EntityId;
  partner: EntityId;
  offscreen: boolean;
  reveals: number;
}

export interface SeasonResult {
  events: EventStore;
  moments: MomentRecord[];
  rel: RelationshipModel;
  alliancesFormed: number;
  alliancesFractured: number;
  edgeStrengthsChanged: boolean;
}

/**
 * Simulate a season of off-screen-heavy NPC social life over many in-game days.
 * Records every interaction in the EventStore (visibility derived from the
 * witness set, per feature 0002), evolves the relationship model (alliances form
 * and fracture as graded bonds cross thresholds), and surfaces hidden character
 * elements only rarely. Deterministic under a fixed seed.
 */
export function simulateSeason(opts: {
  rng: RandomnessSource;
  events?: EventStore;
  days?: number;
}): SeasonResult {
  const { rng } = opts;
  const events = opts.events ?? new InMemoryEventStore();
  const days = opts.days ?? SIM.days;

  const house = generateHouse(rng, SIM.npcCount);
  const npcs = house.map((h) => h.id);
  const rel = new RelationshipModel(SIM.allianceThreshold);

  const moments: MomentRecord[] = [];
  let formed = 0;
  let fractured = 0;
  let evid = 0;

  const pickPartner = (initiator: EntityId): EntityId => {
    let p = rng.pick(npcs);
    for (let g = 0; p === initiator && g < 16; g++) p = rng.pick(npcs);
    return p;
  };

  const interact = (
    day: number,
    initiator: EntityId,
    partner: EntityId,
    type: InteractionType,
    reveals: number,
  ): void => {
    const before = rel.allianceActive(initiator, partner);
    rel.apply(initiator, partner, type, rng);
    const after = rel.allianceActive(initiator, partner);
    if (!before && after) formed++;
    if (before && !after) fractured++;

    const offscreen = rng.next() < SIM.offscreenProb;
    const witnessSet: EntityId[] = offscreen ? [initiator, partner] : [initiator, partner, PLAYER];
    const char = house.find((h) => h.id === initiator)!;
    const tail = reveals > 0 && char.hiddenElements.length > 0
      ? ` [reveals: ${char.hiddenElements[rng.int(char.hiddenElements.length)]}]`
      : "";
    events.record({
      id: `sim:${++evid}`, ts: day * 100 + moments.length, type,
      initiator, witnessSet, hidden: !witnessSet.includes(PLAYER),
      content: `${initiator} ${type} ${partner}${tail}`,
    });
    moments.push({ day, type, initiator, partner, offscreen, reveals });
  };

  for (let day = 0; day < days; day++) {
    for (let m = 0; m < SIM.momentsPerDay; m++) {
      const initiator = rng.pick(npcs);
      const partner = pickPartner(initiator);
      const type = rng.pick(TYPES);
      const reveals = rng.next() < SIM.surfaceProb ? 1 : 0; // bounded to 1 — never dumped
      interact(day, initiator, partner, type, reveals);
    }

    // A weekly high-stakes betrayal targets an existing bond — authentic BB
    // churn that guarantees alliances fracture once any have formed.
    if (day > 0 && day % 5 === 0) {
      const active: Array<[EntityId, EntityId]> = [];
      for (const a of npcs) for (const b of npcs) if (a !== b && rel.allianceActive(a, b)) active.push([a, b]);
      if (active.length > 0) {
        const [a, b] = rng.pick(active);
        interact(day, a, b, "betrayal", 0);
      }
    }
  }

  // B54/audit D3: the old back-stop here force-set `reveals = 1` when none surfaced — a test
  // asserting its own input. Deleted: at `surfaceProb` over 224 moments the no-reveal case is
  // (1-p)^224 ≈ never, and if calibration ever drives reveals to zero the gate SHOULD fail.

  const edgeStrengthsChanged = rel.allBondStrengths().some((s) => Math.abs(s - 0.25) > 1e-9);

  return { events, moments, rel, alliancesFormed: formed, alliancesFractured: fractured, edgeStrengthsChanged };
}
