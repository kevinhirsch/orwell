/**
 * THE SOCIETY OBSERVATORY (dev harness — feature 0078 exploration; NOT wired into runtime/CI).
 *
 * A standalone, read-only simulation to PLAY with the per-NPC motivation dials before implementing
 * them for real. It reuses the engine's PURE functions (`assignRooms`, `richOffscreenStretch`, the
 * `RelationshipModel`) with DIAL-BIASED dependency functions, so we can watch how different character
 * dials reshape WHERE houseguests go (location) and WHO they talk to + HOW (friendly vs. game) —
 * without touching the orchestrator, the runtime, or the calibrated vote spine.
 *
 * Run:  NODE_OPTIONS='--import tsx' node tests/dev/societyObservatory.ts
 *       (optional arg: a global "move-intent" multiplier, e.g. `... societyObservatory.ts 2.0`)
 *
 * This is a throwaway instrument. The `Dials` here are a PROTOTYPE, not the eventual CHARACTER schema.
 */
import { assignRooms } from "../../src/engine/presence";
import { richOffscreenStretch } from "../../src/engine/offscreen";
import { RelationshipModel } from "../../src/engine/relationships";
import { generateHouse, dispositionOf } from "../../src/engine/characterFactory";
import type { Houseguest } from "../../src/engine/characterFactory";
import type { EdgeSignals, InteractionType } from "../../src/engine/relationshipConstants";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { InMemoryEventStore } from "../../src/adapters/inmemory/InMemoryEventStore";
import { HOUSE_ROOMS, type Room } from "../../src/domain/house";
import type { EntityId } from "../../src/domain/ids";

// ── The prototype dial set (0..1; 0.5 = neutral) ──────────────────────────────────────────────
interface Dials {
  strategicAggression: number;  // reactive ↔ proactive schemer
  loyalty: number;              // opportunist ↔ ride-or-die
  paranoia: number;             // trusting ↔ intel-seeking/suspicious
  confrontation: number;        // avoidant ↔ seeks the fight
  powerProximity: number;       // independent ↔ courts the HOH
  socialEnergy: number;         // holds a room ↔ roams & works everyone
  emotionalVolatility: number;  // steady ↔ swings hard
  showmancePull: number;        // all-business ↔ romance-driven
  foresight: number;            // short-game ↔ jury-from-week-1
  riskTolerance: number;        // safe ↔ big-move gambler
  visibility: number;           // hidden hand ↔ wants the credit
  compDrive: number;            // throws ↔ grinds comps
  trust: number;                // skeptic ↔ gullible mark
  grudge: number;               // lets it go ↔ vendetta to the jury
}

const NEUTRAL: Dials = {
  strategicAggression: 0.5, loyalty: 0.5, paranoia: 0.5, confrontation: 0.5, powerProximity: 0.5,
  socialEnergy: 0.5, emotionalVolatility: 0.5, showmancePull: 0.5, foresight: 0.5, riskTolerance: 0.5,
  visibility: 0.5, compDrive: 0.5, trust: 0.5, grudge: 0.5,
};
const D = (over: Partial<Dials>): Dials => ({ ...NEUTRAL, ...over });

/** Each generated archetype → a dial vector (the prototype mapping we're here to feel out). */
const DIALS_BY_ARCHETYPE: Record<string, Dials> = {
  "comp-beast":      D({ compDrive: 0.95, strategicAggression: 0.6, riskTolerance: 0.6, visibility: 0.75, confrontation: 0.6 }),
  "mastermind":      D({ strategicAggression: 0.85, paranoia: 0.8, foresight: 0.85, visibility: 0.25, socialEnergy: 0.6 }),
  "social-butterfly":D({ socialEnergy: 0.95, confrontation: 0.35, paranoia: 0.35, strategicAggression: 0.4, showmancePull: 0.55 }),
  "floater":         D({ loyalty: 0.2, powerProximity: 0.85, strategicAggression: 0.3, visibility: 0.2, riskTolerance: 0.2 }),
  "villain":         D({ strategicAggression: 0.9, confrontation: 0.8, loyalty: 0.25, grudge: 0.75, riskTolerance: 0.7, visibility: 0.6 }),
  "underdog":        D({ loyalty: 0.7, foresight: 0.55, trust: 0.6, strategicAggression: 0.4, socialEnergy: 0.55 }),
  "flirt":           D({ showmancePull: 0.95, socialEnergy: 0.8, strategicAggression: 0.4 }),
  "loyalist":        D({ loyalty: 0.95, foresight: 0.55, confrontation: 0.35, grudge: 0.4, strategicAggression: 0.4 }),
  "wildcard":        D({ emotionalVolatility: 0.9, confrontation: 0.7, riskTolerance: 0.85, loyalty: 0.4, strategicAggression: 0.55 }),
  "analyst":         D({ paranoia: 0.75, foresight: 0.8, strategicAggression: 0.6, socialEnergy: 0.4, visibility: 0.3, confrontation: 0.35 }),
  "hothead":         D({ confrontation: 0.95, emotionalVolatility: 0.85, grudge: 0.8, strategicAggression: 0.55, socialEnergy: 0.55 }),
  "peacemaker":      D({ confrontation: 0.15, socialEnergy: 0.7, loyalty: 0.65, grudge: 0.2, paranoia: 0.3, strategicAggression: 0.3 }),
};
const dialsFor = (archetype: string): Dials => DIALS_BY_ARCHETYPE[archetype] ?? NEUTRAL;

// ── Scene-nature classes ──────────────────────────────────────────────────────────────────────
const GAME: ReadonlySet<InteractionType> = new Set<InteractionType>(["alliance", "strategy", "conflict", "betrayal"]);
const isGame = (t: InteractionType): boolean => GAME.has(t);

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

// ── Injection point 1: the dial-biased MOVEMENT pull (a's intent toward b) ─────────────────────
function movePull(d: Dials, e: EdgeSignals, bIsHoh: boolean, moveIntent: number): number {
  const bond = e.affinity * (0.4 + 0.6 * d.socialEnergy + 0.4 * d.loyalty);      // seek allies/company
  const work = e.threat * d.strategicAggression * d.confrontation;               // approach a rival to work them (bold)
  const avoid = e.threat * (1 - d.confrontation) * (0.5 + d.grudge);             // avoidant/grudgeful keep distance
  const power = bIsHoh ? d.powerProximity : 0;                                   // court the HOH
  const romance = e.affinity * d.showmancePull * 0.6;                            // orbit a romance
  return Math.max(0, moveIntent * (bond + work + power + romance - avoid));
}

// ── Injection point 2: a's dial-tinted READ of b (biases pairing + scene nature via natureWeights) ─
function tiltedEdge(d: Dials, e: EdgeSignals): EdgeSignals {
  return {
    ...e,
    // aggressive/paranoid read more threat & agenda (→ strategy/conflict); social read more warmth (→ bonding)
    affinity: clamp01(e.affinity + 0.25 * (d.socialEnergy - 0.5) + 0.2 * (0.5 - d.strategicAggression)),
    threat: clamp01(e.threat + 0.3 * (d.strategicAggression - 0.5) + 0.25 * (d.paranoia - 0.5) + 0.15 * (d.confrontation - 0.5)),
    alignment: clamp01(e.alignment + 0.25 * (d.strategicAggression - 0.5) + 0.2 * (d.foresight - 0.5)),
    trust: clamp01(e.trust + 0.2 * (d.loyalty - 0.5)),
  };
}

// ── Per-NPC observation accumulators ───────────────────────────────────────────────────────────
interface Obs {
  room: Map<Room, number>;
  coPresent: Map<EntityId, number>;
  friendly: number;
  game: number;
  scenePartners: Map<EntityId, number>;
}
const freshObs = (): Obs => ({ room: new Map(), coPresent: new Map(), friendly: 0, game: 0, scenePartners: new Map() });
const bump = <K>(m: Map<K, number>, k: K, by = 1): void => { m.set(k, (m.get(k) ?? 0) + by); };
const topN = <K>(m: Map<K, number>, n: number): [K, number][] =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

// ── One simulated run ──────────────────────────────────────────────────────────────────────────
function run(seed: number, moveIntent: number, warmup: number, observe: number) {
  const house: Houseguest[] = generateHouse(new SeededRandom(seed)).npcs;
  const ids = house.map((h) => h.id);
  const name = new Map(house.map((h) => [h.id, h.name] as const));
  const arche = new Map(house.map((h) => [h.id, h.character.archetype] as const));
  const dials = new Map(house.map((h) => [h.id, dialsFor(h.character.archetype)] as const));
  const hoh = ids[0]!; // a stand-in HOH so power-proximity has a target to court

  const rel = new RelationshipModel(0.6);
  for (const h of house) rel.setDisposition(h.id, dispositionOf(h.character.archetype));

  const events = new InMemoryEventStore();
  const moveRng = new SeededRandom(seed * 7 + 1);
  const socRng = new SeededRandom(seed * 13 + 3);

  const dialPull = (a: EntityId, b: EntityId): number =>
    movePull(dials.get(a)!, rel.edge(a, b), b === hoh, moveIntent);
  const dialEdge = (a: EntityId, b: EntityId): EdgeSignals => tiltedEdge(dials.get(a)!, rel.edge(a, b));

  let occ: Map<EntityId, Room> | null = null;
  const obs = new Map<EntityId, Obs>(ids.map((id) => [id, freshObs()] as const));

  const tick = (record: boolean): void => {
    occ = assignRooms(ids, occ, { rng: moveRng, affinity: dialPull, hoh });
    const scenes = richOffscreenStretch({
      events, rng: socRng, npcs: ids, interactions: 4, edgeOf: dialEdge, occupancy: occ,
    });
    for (const s of scenes) rel.applyDirected(s.partner, s.initiator, s.type, socRng); // mirror the orchestrator fold
    if (!record) return;
    // location + co-presence
    const byRoom = new Map<Room, EntityId[]>();
    for (const [id, room] of occ) { bump(obs.get(id)!.room, room); (byRoom.get(room) ?? byRoom.set(room, []).get(room)!).push(id); }
    for (const group of byRoom.values()) {
      for (const a of group) for (const b of group) if (a !== b) bump(obs.get(a)!.coPresent, b);
    }
    // conversation (nature + partner), credited to the initiator
    for (const s of scenes) {
      const o = obs.get(s.initiator)!;
      if (isGame(s.type)) o.game++; else o.friendly++;
      bump(o.scenePartners, s.partner);
    }
  };

  for (let t = 0; t < warmup; t++) tick(false);   // let relationships + positions form
  for (let t = 0; t < observe; t++) tick(true);    // measure

  return { ids, name, arche, dials, rel, obs };
}

// ── Readout ──────────────────────────────────────────────────────────────────────────────────
function report(seed: number, moveIntent: number): void {
  const { ids, name, arche, rel, obs } = run(seed, moveIntent, 18, 18);
  const label = (id: EntityId): string => `${name.get(id)} (${arche.get(id)})`;

  console.log(`\n${"═".repeat(92)}`);
  console.log(`  SOCIETY OBSERVATORY — seed ${seed}, move-intent ×${moveIntent.toFixed(2)}  (18 warmup + 18 observed ticks)`);
  console.log(`${"═".repeat(92)}`);
  console.log("  Each NPC: top room · who they kept ending up with · scene mix (friendly/game) · warmest bond / top threat\n");

  for (const id of ids) {
    const o = obs.get(id)!;
    const topRoom = topN(o.room, 1)[0];
    const partners = topN(o.coPresent, 2).map(([p]) => name.get(p)).join(", ") || "—";
    const total = o.friendly + o.game;
    const gamePct = total ? Math.round((100 * o.game) / total) : 0;
    // relationship drift (who this NPC now feels most warmly / most threatened by)
    const warm = topN(new Map(ids.filter((x) => x !== id).map((x) => [x, rel.edge(id, x).affinity])), 1)[0];
    const threat = topN(new Map(ids.filter((x) => x !== id).map((x) => [x, rel.edge(id, x).threat])), 1)[0];
    console.log(
      `  ${label(id).padEnd(34)} ${(topRoom ? String(topRoom[0]) : "—").padEnd(13)}` +
      ` with: ${partners.padEnd(22)} ${String(o.friendly).padStart(2)}f/${String(o.game).padStart(2)}g (${gamePct}% game)` +
      `  ♥ ${warm ? name.get(warm[0]) : "—"} / ⚔ ${threat ? name.get(threat[0]) : "—"}`,
    );
  }

  // archetype-level summary: does game-share track the dials?
  console.log(`\n  ── game-scene share by archetype (does aggression/paranoia scheme more?) ──`);
  const byArche = new Map<string, { f: number; g: number }>();
  for (const id of ids) {
    const o = obs.get(id)!;
    const a = arche.get(id)!;
    const agg = byArche.get(a) ?? { f: 0, g: 0 };
    agg.f += o.friendly; agg.g += o.game; byArche.set(a, agg);
  }
  for (const [a, { f, g }] of [...byArche.entries()].sort((x, y) => (y[1].g / (y[1].g + y[1].f || 1)) - (x[1].g / (x[1].g + x[1].f || 1)))) {
    const pct = f + g ? Math.round((100 * g) / (f + g)) : 0;
    console.log(`     ${a.padEnd(18)} ${String(pct).padStart(3)}% game   (${f}f / ${g}g)`);
  }
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────
const moveIntent = Number(process.argv[2] ?? "1.0");
report(7, moveIntent);
report(7, moveIntent * 2.2); // a second pass at higher move-intent — watch co-presence tighten
console.log("");
