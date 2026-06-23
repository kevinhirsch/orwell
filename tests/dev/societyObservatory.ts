/**
 * THE SOCIETY OBSERVATORY (dev harness — feature 0078 exploration; NOT wired into runtime/CI).
 *
 * A standalone, read-only simulation to PLAY with two prototype threads before implementing either
 * for real:
 *   1. the per-NPC motivation DIALS — how character reshapes WHERE houseguests go (location) and WHO
 *      they talk to + HOW (friendly vs. game);
 *   2. a realistic TIME BUDGET + the nightly AWAKE-SET economy — how a believable clock (a conversation
 *      ~1h, each phase several real hours) thins the house toward late-night so the off-screen society
 *      runs out of PEOPLE, not a beat counter.
 *
 * It reuses the engine's PURE functions (`assignRooms`, `richOffscreenStretch`, the `RelationshipModel`,
 * and the `timeOfDay` helpers) with DIAL-BIASED dependency functions, so we can watch all of this WITHOUT
 * touching the orchestrator, the runtime, or the calibrated vote spine.
 *
 * Run:  NODE_OPTIONS='--import tsx' node tests/dev/societyObservatory.ts
 *       (optional args:  [moveIntent]  [minutesPerTick]   e.g. `... societyObservatory.ts 1.5 60`)
 *
 * North star (owner ruling): TIME REALISM. The clock tracks a believable wall time; a "conversation
 * tick" costs ~1h; each phase spans a real several-hour window of an actual day.
 *
 * This is a throwaway instrument. The `Dials` and the minute budget here are a PROTOTYPE, not the
 * eventual CHARACTER schema or the live-engine cadence.
 */
import { assignRooms } from "../../src/engine/presence";
import { richOffscreenStretch } from "../../src/engine/offscreen";
import { RelationshipModel } from "../../src/engine/relationships";
import { generateHouse, dispositionOf } from "../../src/engine/characterFactory";
import type { Houseguest } from "../../src/engine/characterFactory";
import type { EdgeSignals, InteractionType } from "../../src/engine/relationshipConstants";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { InMemoryEventStore } from "../../src/adapters/inmemory/InMemoryEventStore";
import { type Room } from "../../src/domain/house";
import {
  bedtimeFor, SLEEP, TIME_OF_DAY_ORDER, TIME_OF_DAY_LABEL, type TimeOfDay,
} from "../../src/engine/timeOfDay";
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

// ── The realistic clock as a SLEEP ECONOMY (north star: TIME REALISM; owner ruling 2026-06-23) ──
// A full, continuous 24h RING. The WAKING day cascades 08:00→00:00; LATE-NIGHT IS THE SLEEP BLOCK
// (00:00–08:00, 8h), looping straight back to 08:00 morning — no dead gap. Minutes are linear from the
// 08:00 day start (480) to the next 08:00 (1920); the sleep block is [1440,1920) and DISPLAYS as
// 00:00–08:00 via hhmm's wrap. A "tick" is one ~1h slice (default 60 min). The trade: every hour a
// houseguest stays awake PAST MIDNIGHT (1440) cuts into their 8h sleep → a graded rest deficit (below).
const PHASE_WINDOW: Record<TimeOfDay, { start: number; end: number }> = {
  morning:      { start:  8 * 60, end: 13 * 60 }, // 08:00–13:00  (5h)
  afternoon:    { start: 13 * 60, end: 17 * 60 }, // 13:00–17:00  (4h)
  evening:      { start: 17 * 60, end: 21 * 60 }, // 17:00–21:00  (4h)
  night:        { start: 21 * 60, end: 24 * 60 }, // 21:00–24:00  (3h)
  "late-night": { start: 24 * 60, end: 32 * 60 }, // 00:00–08:00  (8h SLEEP BLOCK → loops to morning)
};
const DAY_START_MIN = PHASE_WINDOW.morning.start;            // 08:00
const DAY_END_MIN = PHASE_WINDOW["late-night"].end;          // 08:00 next day (32:00)
const SLEEP_BLOCK_START = PHASE_WINDOW["late-night"].start;  // 24:00 (midnight) — sleep starts here
const SLEEP_BLOCK_HOURS = (DAY_END_MIN - SLEEP_BLOCK_START) / 60; // 8h

/** Which real phase a minutes-from-midnight clock sits in. */
function phaseAt(min: number): TimeOfDay {
  for (const p of TIME_OF_DAY_ORDER) if (min < PHASE_WINDOW[p].end) return p;
  return "late-night";
}
const pad2 = (n: number): string => String(n).padStart(2, "0");
/** A believable wall-clock label (HH:MM) from minutes-from-midnight (wraps past 24h). */
function hhmm(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}
/** A short bedtime tag for the readout (e — early/evening, n — night, ☾ — owl into the sleep block). */
const BEDTIME_TAG: Record<TimeOfDay, string> = {
  morning: "e", afternoon: "e", evening: "e", night: "n", "late-night": "☾",
};

/**
 * A houseguest's CONCRETE clock bedtime (minutes on the day ring) — the graded refinement of the
 * engine's 3-bucket `bedtimeFor`. Same signal (`social − physical`) and the same SLEEP thresholds, just
 * translated to a wall time so the sleep trade is graded: deep/early sleepers bed by 21:00 (bank the
 * whole 8h block, zero deficit); night sleepers bed ~22:30–00:00; social OWLS push PAST midnight into
 * the block (≈ 00:00→05:00 by owl strength), banking less sleep. (The live-engine follow-on would grade
 * its awake-set/deficit the same way — here we go finer than the phase-based `awakeSet` on purpose.)
 */
function clockBedtimeMin(stats: { physical: number; social: number }): number {
  const owl = stats.social - stats.physical;
  if (owl <= SLEEP.earlySleeperBelow) return 21 * 60;                 // 21:00 — deep/early sleeper
  if (owl <= SLEEP.nightOwlAbove) {
    const t = (owl - SLEEP.earlySleeperBelow) / (SLEEP.nightOwlAbove - SLEEP.earlySleeperBelow); // 0..1
    return Math.round(22.5 * 60 + t * (24 * 60 - 22.5 * 60));         // 22:30 → 00:00 (night sleeper)
  }
  const t = Math.min(1, (owl - SLEEP.nightOwlAbove) / 0.33);          // owl strength past the line
  return Math.round(SLEEP_BLOCK_START + t * (5 * 60));                // 00:00 → 05:00 (into the block)
}

// ── Late-night cluster curve: the few who stay up should find EACH OTHER ───────────────────────
// First cut exposed a wrinkle — the DEEPEST owl often ends up awake alone, paying full sleep cost for
// almost no scheming. So add a SLIGHT, night-depth-ramped co-location pull: it is 0 during waking hours
// (the daytime movement rule is unchanged) and ramps 00:00 → 05:00 to an additive `strength` floor folded
// into the movement pull, so awake owls gravitate to whatever room already has people (even weak ties /
// rivals congregate at 2am). Tunable — the lever for WHEN staying up pays for the sleep it costs.
const LATE_CLUSTER_DEFAULT = 0.6;
function clusterBoost(clock: number, strength: number): number {
  if (clock < SLEEP_BLOCK_START) return 0;                          // daytime: no co-location nudge
  // Strong from the FIRST sleep-block tick (midnight is the fullest late tick — the gathering should be
  // live the moment it's "late"), ramping the last bit deeper as the house empties toward the small hours.
  const frac = Math.min(1, (clock - SLEEP_BLOCK_START) / (3 * 60)); // 0 at 00:00 → 1 by 03:00
  return strength * (0.6 + 0.4 * frac);                             // 0.6× at midnight → full by 03:00
}

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
  lateScenes: number; // scenes this NPC initiated INSIDE the sleep block (the time bought with lost sleep)
}
const freshObs = (): Obs => ({ room: new Map(), coPresent: new Map(), friendly: 0, game: 0, scenePartners: new Map(), lateScenes: 0 });
const bump = <K>(m: Map<K, number>, k: K, by = 1): void => { m.set(k, (m.get(k) ?? 0) + by); };
const topN = <K>(m: Map<K, number>, n: number): [K, number][] =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

/** Per-phase telemetry — the nightly presence economy: how the awake set + scene volume thin. */
type PhaseStats = Record<TimeOfDay, { ticks: number; awakeSum: number; scenes: number }>;
const freshPhaseStats = (): PhaseStats =>
  Object.fromEntries(TIME_OF_DAY_ORDER.map((p) => [p, { ticks: 0, awakeSum: 0, scenes: 0 }])) as PhaseStats;

// ── One simulated run ──────────────────────────────────────────────────────────────────────────
interface RunOpts {
  seed: number;
  moveIntent: number;
  warmupDays: number;
  observeDays: number;
  minutesPerTick: number;
  lateCluster: number; // strength of the late-night co-location pull (the cluster curve)
}

function run(opts: RunOpts) {
  const { seed, moveIntent, warmupDays, observeDays, minutesPerTick, lateCluster } = opts;
  const house: Houseguest[] = generateHouse(new SeededRandom(seed)).npcs;
  const ids = house.map((h) => h.id);
  const name = new Map(house.map((h) => [h.id, h.name] as const));
  const arche = new Map(house.map((h) => [h.id, h.character.archetype] as const));
  const dials = new Map(house.map((h) => [h.id, dialsFor(h.character.archetype)] as const));
  // Character-driven bedtimes (PURE, byte-stable: derived from static stats, no rng). `bedtime` is the
  // engine's 3-bucket read (for the tag); `bedMin` is the graded clock bedtime the sleep economy runs on.
  const bedtime = new Map(house.map((h) => [h.id, bedtimeFor(h.character.stats)] as const));
  const bedMin = new Map(house.map((h) => [h.id, clockBedtimeMin(h.character.stats)] as const));
  const hoh = ids[0]!; // a stand-in HOH so power-proximity has a target to court

  const rel = new RelationshipModel(0.6);
  for (const h of house) rel.setDisposition(h.id, dispositionOf(h.character.archetype));

  const events = new InMemoryEventStore();
  const moveRng = new SeededRandom(seed * 7 + 1);
  const socRng = new SeededRandom(seed * 13 + 3);

  // The pull `assignRooms` reads. `currentClock` is set each tick so the LATE-NIGHT cluster floor can
  // ramp in after midnight (0 by day ⇒ daytime movement is unchanged). The floor is added to every
  // pair's pull, so occupied rooms accrue weight and the awake owls gravitate together.
  let currentClock = DAY_START_MIN;
  const dialPull = (a: EntityId, b: EntityId): number =>
    movePull(dials.get(a)!, rel.edge(a, b), b === hoh, moveIntent) + clusterBoost(currentClock, lateCluster);
  const dialEdge = (a: EntityId, b: EntityId): EdgeSignals => tiltedEdge(dials.get(a)!, rel.edge(a, b));

  let occ: Map<EntityId, Room> | null = null;
  const obs = new Map<EntityId, Obs>(ids.map((id) => [id, freshObs()] as const));
  const phaseStats = freshPhaseStats();
  // Late-block co-presence (the cluster signal, independent of the per-tick scene cap): over late ticks
  // where ≥2 are still up, how many of the awake share a room with another awake person vs. sit alone.
  let lateCompany = 0;
  let lateAlone = 0;

  // One ~1h slice at a given clock minute, among the AWAKE houseguests only. Awake iff the clock hasn't
  // passed their personal bedtime — so the sleep block (after midnight) thins to the deepest owls, then
  // empties, and the night ends because play runs out of PEOPLE (no curfew), not a timer.
  const tick = (phase: TimeOfDay, clock: number, record: boolean): void => {
    currentClock = clock; // so dialPull's late-night cluster floor knows how deep into the night it is
    const awake = ids.filter((id) => clock < bedMin.get(id)!);
    // Count presence for EVERY observed tick (incl. the empty late-night tail) so the economy shows the
    // house thinning toward zero; only RUN the society when ≥2 are still up to have a scene.
    if (record) { phaseStats[phase].ticks++; phaseStats[phase].awakeSum += awake.length; }
    if (awake.length < 2) return; // everyone who was up has gone to bed — the house is asleep
    occ = assignRooms(awake, occ, { rng: moveRng, affinity: dialPull, hoh });
    const scenes = richOffscreenStretch({
      events, rng: socRng, npcs: awake, interactions: 4, edgeOf: dialEdge, occupancy: occ,
    });
    for (const s of scenes) rel.applyDirected(s.partner, s.initiator, s.type, socRng); // mirror the orchestrator fold
    if (!record) return;
    phaseStats[phase].scenes += scenes.length;
    const late = phase === "late-night"; // initiated inside the 8h sleep block — bought with lost sleep
    // location + co-presence (awake only)
    const byRoom = new Map<Room, EntityId[]>();
    for (const [id, room] of occ) { bump(obs.get(id)!.room, room); (byRoom.get(room) ?? byRoom.set(room, []).get(room)!).push(id); }
    for (const group of byRoom.values()) {
      for (const a of group) for (const b of group) if (a !== b) bump(obs.get(a)!.coPresent, b);
    }
    if (late) { // the cluster signal: did the awake owls find each other, or scatter into solo rooms?
      for (const group of byRoom.values()) {
        if (group.length >= 2) lateCompany += group.length; else lateAlone += group.length;
      }
    }
    // conversation (nature + partner), credited to the initiator
    for (const s of scenes) {
      const o = obs.get(s.initiator)!;
      if (isGame(s.type)) o.game++; else o.friendly++;
      if (late) o.lateScenes++;
      bump(o.scenePartners, s.partner);
    }
  };

  // Run whole DAYS: the clock walks 06:00 → 02:00 in `minutesPerTick` steps, the phase deriving from
  // the real wall time, and naturally ends the night early once the awake set has emptied.
  const runDay = (record: boolean): void => {
    for (let clock = DAY_START_MIN; clock < DAY_END_MIN; clock += minutesPerTick) {
      tick(phaseAt(clock), clock, record);
    }
  };
  for (let day = 0; day < warmupDays; day++) runDay(false); // let relationships + positions form
  for (let day = 0; day < observeDays; day++) runDay(true);  // measure

  return { ids, name, arche, dials, bedtime, bedMin, rel, obs, phaseStats, lateCompany, lateAlone, minutesPerTick };
}

// ── Readout ──────────────────────────────────────────────────────────────────────────────────
function report(seed: number, moveIntent: number, minutesPerTick: number, lateCluster: number): void {
  const { ids, name, arche, bedtime, bedMin, rel, obs, phaseStats } =
    run({ seed, moveIntent, warmupDays: 3, observeDays: 4, minutesPerTick, lateCluster });
  const label = (id: EntityId): string => `${name.get(id)} (${arche.get(id)})`;
  const ticksPerDay = Math.ceil((DAY_END_MIN - DAY_START_MIN) / minutesPerTick);

  console.log(`\n${"═".repeat(96)}`);
  console.log(`  SOCIETY OBSERVATORY — seed ${seed}, move-intent ×${moveIntent.toFixed(2)}, ${minutesPerTick}min/conversation, cluster ${lateCluster.toFixed(2)}`);
  console.log(`  (3 warmup + 4 observed days · waking ${hhmm(DAY_START_MIN)}→00:00, sleep block 00:00→08:00 ≈ ${ticksPerDay} slices/day)`);
  console.log(`${"═".repeat(96)}`);
  console.log("  Each NPC: bedtime · top room · who they kept ending up with · scene mix · warmest bond / top threat\n");

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
      `  ${BEDTIME_TAG[bedtime.get(id)!]} ${label(id).padEnd(34)} ${(topRoom ? String(topRoom[0]) : "—").padEnd(13)}` +
      ` with: ${partners.padEnd(22)} ${String(o.friendly).padStart(2)}f/${String(o.game).padStart(2)}g (${gamePct}% game)` +
      `  ♥ ${warm ? name.get(warm[0]) : "—"} / ⚔ ${threat ? name.get(threat[0]) : "—"}`,
    );
  }

  // The nightly presence economy: how the awake set + scene volume thin toward late-night.
  console.log(`\n  ── nightly presence economy (the house thins as people turn in; cast of ${ids.length}) ──`);
  console.log(`     phase        window        avg awake   scenes`);
  for (const p of TIME_OF_DAY_ORDER) {
    const s = phaseStats[p];
    const w = PHASE_WINDOW[p];
    const avg = s.ticks ? (s.awakeSum / s.ticks).toFixed(1) : "—";
    console.log(
      `     ${TIME_OF_DAY_LABEL[p].padEnd(12)} ${`${hhmm(w.start)}–${hhmm(w.end)}`.padEnd(13)} ${String(avg).padStart(7)}   ${String(s.scenes).padStart(5)}`,
    );
  }

  // The sleep economy: who traded sleep for after-midnight scheming, and the deficit they'll carry into
  // the next comp. `slept` is hours of the 8h block actually slept; `deficit` (0..1) ∝ hours awake past
  // midnight; `late` is the scenes they bought with that lost sleep. Sorted by deficit (the owls on top).
  console.log(`\n  ── sleep economy (stay up to scheme ⇒ bank less sleep ⇒ rest deficit into next comp) ──`);
  console.log(`     houseguest                         bedtime   slept/${SLEEP_BLOCK_HOURS}h   deficit   late scenes`);
  const sleepRows = ids.map((id) => {
    const awakeInBlockH = Math.max(0, bedMin.get(id)! - SLEEP_BLOCK_START) / 60;
    return {
      id, late: obs.get(id)!.lateScenes,
      slept: SLEEP_BLOCK_HOURS - awakeInBlockH,
      deficit: clamp01(awakeInBlockH / SLEEP_BLOCK_HOURS),
    };
  }).sort((a, b) => b.deficit - a.deficit);
  for (const r of sleepRows) {
    console.log(
      `     ${label(r.id).padEnd(34)} ${hhmm(bedMin.get(r.id)!).padStart(5)}     ${r.slept.toFixed(1).padStart(4)}h     ${r.deficit.toFixed(2).padStart(5)}      ${String(r.late).padStart(4)}`,
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

// ── Time-knob sweep ────────────────────────────────────────────────────────────────────────────
// Vary minutes-per-conversation and watch the day compress: a realistic 60min keeps several
// conversations per phase; a bloated cost burns whole periods per beat (the live bug we're fixing).
function timeSweep(seed: number, moveIntent: number, lateCluster: number): void {
  console.log(`\n${"═".repeat(96)}`);
  console.log(`  TIME-KNOB SWEEP — seed ${seed}, move-intent ×${moveIntent.toFixed(2)}  (how the clock cadence reshapes a day)`);
  console.log(`${"═".repeat(96)}`);
  console.log(`  minutes/    slices    scenes/day    ── scenes per phase ──`);
  console.log(`  convo       /day      (observed)    morn  aft  eve  night  late`);
  for (const minutesPerTick of [30, 60, 120, 240]) {
    const { phaseStats } = run({ seed, moveIntent, warmupDays: 2, observeDays: 4, minutesPerTick, lateCluster });
    const ticksPerDay = Math.ceil((DAY_END_MIN - DAY_START_MIN) / minutesPerTick);
    const per = (p: TimeOfDay): string => String(Math.round(phaseStats[p].scenes / 4)).padStart(4);
    const totalScenes = TIME_OF_DAY_ORDER.reduce((a, p) => a + phaseStats[p].scenes, 0);
    console.log(
      `  ${String(minutesPerTick).padEnd(10)}  ${String(ticksPerDay).padStart(4)}      ${String(Math.round(totalScenes / 4)).padStart(6)}` +
      `        ${per("morning")} ${per("afternoon")} ${per("evening")} ${per("night").padStart(5)} ${per("late-night").padStart(5)}`,
    );
  }
  console.log(`\n  Read: at 60min a conversation is ~1h and each phase holds several; as the cost balloons`);
  console.log(`  the same beats consume whole periods (fewer slices/day) — the "time races" bug, made visible.`);
}

// ── Cluster-knob sweep ─────────────────────────────────────────────────────────────────────────
// Vary the late-night cluster strength and watch whether the (same, shrinking) awake owls actually
// FIND each other: avg awake-late is fixed by bedtimes — only co-location moves, so more clustering ⇒
// more late-block scenes for the same people ⇒ staying up finally buys scheming.
function clusterSweep(seed: number, moveIntent: number, minutesPerTick: number): void {
  // The late-night population is tiny per seed (a handful of overlapping owls), so a single seed is
  // noisy — average over several to read the curve cleanly.
  const seeds = [seed, 11, 13, 19, 23, 31];
  console.log(`\n${"═".repeat(96)}`);
  console.log(`  CLUSTER-KNOB SWEEP — move-intent ×${moveIntent.toFixed(2)}, ${minutesPerTick}min/conversation, mean over ${seeds.length} seeds`);
  console.log(`  (do the late-night owls find each other? avg awake-late is fixed by bedtimes — only co-location moves)`);
  console.log(`${"═".repeat(96)}`);
  console.log(`  cluster    co-present %   late scenes/day`);
  for (const lateCluster of [0, 0.3, 0.6, 1.0, 1.6]) {
    let company = 0, alone = 0, scenes = 0;
    for (const s of seeds) {
      const r = run({ seed: s, moveIntent, warmupDays: 2, observeDays: 4, minutesPerTick, lateCluster });
      company += r.lateCompany; alone += r.lateAlone; scenes += r.phaseStats["late-night"].scenes;
    }
    const rate = company + alone ? Math.round((100 * company) / (company + alone)) : 0;
    const scenesPerDay = (scenes / (seeds.length * 4)).toFixed(1);
    console.log(`  ${lateCluster.toFixed(2).padEnd(9)}  ${String(rate).padStart(5)}%        ${scenesPerDay.padStart(6)}`);
  }
  console.log(`\n  Read: the lever is CO-PRESENT % — how many of the still-up owls share a room (vs. sit alone).`);
  console.log(`  It rises with cluster, so staying up starts to buy company/scheming. (The deepest solo tail —`);
  console.log(`  ticks with only ONE owl up — can't be helped by clustering; that's a bedtime-overlap question,`);
  console.log(`  not a co-location one. Scenes/day is capped per tick, so it moves less than co-presence.)`);
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────
const moveIntent = Number(process.argv[2] ?? "1.0");
const minutesPerTick = Number(process.argv[3] ?? "60");
const lateCluster = Number(process.argv[4] ?? String(LATE_CLUSTER_DEFAULT));
report(7, moveIntent, minutesPerTick, lateCluster);       // realistic clock — dials + presence + sleep readout
timeSweep(7, moveIntent, lateCluster);                    // how the clock cadence reshapes a day
clusterSweep(7, moveIntent, minutesPerTick);              // when does late-night clustering make staying up pay?
report(7, moveIntent * 2.2, minutesPerTick, lateCluster); // higher move-intent pass — watch co-presence tighten
console.log("");
