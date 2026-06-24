/**
 * THE SOCIETY OBSERVATORY (dev harness — feature 0078 exploration; NOT wired into runtime/CI).
 *
 * A standalone, read-only simulation to PLAY with two prototype threads before implementing either
 * for real:
 *   1. the per-NPC motivation DIALS — how character reshapes WHERE houseguests go (location) and WHO
 *      they talk to + HOW (friendly vs. game);
 *   2. a realistic TIME BUDGET + the nightly SLEEP ECONOMY — a believable 24h clock where bedtime is an
 *      EMERGENT, character-driven choice (chronotype + who's still up + a conflict drains you to bed earlier),
 *      the house force-wakes everyone at 08:00, and short sleep is paid back the next day as reduced
 *      EFFECTIVENESS (worse comps + less social sway) — NEVER a personality change.
 *
 * It reuses the engine's PURE functions (`assignRooms`, `richOffscreenStretch`, the `RelationshipModel`,
 * and the `timeOfDay` labels) with DIAL-BIASED dependency functions, so we can watch all of this WITHOUT
 * touching the orchestrator, the runtime, or the calibrated vote spine.
 *
 * Run:  NODE_OPTIONS='--import tsx' node tests/dev/societyObservatory.ts
 *       (optional args:  [moveIntent]  [minutesPerTick]  [lateCluster]   e.g. `... 1.5 60 0.6`)
 *
 * North star (owner ruling): TIME REALISM. The clock tracks a believable wall time; a "conversation
 * tick" costs ~1h; each waking quarter spans a real 4h window of an actual day.
 *
 * This is a throwaway instrument. The `Dials` and the minute budget here are a PROTOTYPE, not the
 * eventual CHARACTER schema or the live-engine cadence.
 */
import { assignRooms } from "../../src/engine/presence";
import { richOffscreenStretch } from "../../src/engine/offscreen";
import { RelationshipModel } from "../../src/engine/relationships";
import { generateHouse, dispositionOf } from "../../src/engine/characterFactory";
import type { Houseguest } from "../../src/engine/characterFactory";
import { RELATIONSHIP_CONSTANTS, scaleImpact } from "../../src/engine/relationshipConstants";
import type { EdgeSignals, InteractionType } from "../../src/engine/relationshipConstants";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { InMemoryEventStore } from "../../src/adapters/inmemory/InMemoryEventStore";
import { type Room } from "../../src/domain/house";
import { TIME_OF_DAY_ORDER, TIME_OF_DAY_LABEL, type TimeOfDay } from "../../src/engine/timeOfDay";
import type { EntityId } from "../../src/domain/ids";

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const sortDesc = (xs: number[]): number[] => [...xs].sort((a, b) => b - a);
const sumTop = (xs: number[], n: number): number => sortDesc(xs).slice(0, n).reduce((a, b) => a + b, 0);

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

// ── The realistic clock as a SLEEP ECONOMY (north star: TIME REALISM; owner rulings 2026-06-23/24) ──
// A full, continuous 24h RING. The WAKING day is four even 4h quarters 08:00→00:00; LATE-NIGHT IS THE
// SLEEP BLOCK (00:00–08:00, 8h), looping straight back to 08:00 morning — no dead gap. Minutes are linear
// from the 08:00 day start (480) to the next 08:00 (1920); the sleep block is [1440,1920) and DISPLAYS as
// 00:00–08:00 via hhmm's wrap. A "tick" is one ~1h slice (default 60 min).
const PHASE_WINDOW: Record<TimeOfDay, { start: number; end: number }> = {
  morning:      { start:  8 * 60, end: 12 * 60 }, // 08:00–12:00  (4h)
  afternoon:    { start: 12 * 60, end: 16 * 60 }, // 12:00–16:00  (4h)
  evening:      { start: 16 * 60, end: 20 * 60 }, // 16:00–20:00  (4h)
  night:        { start: 20 * 60, end: 24 * 60 }, // 20:00–24:00  (4h)
  "late-night": { start: 24 * 60, end: 32 * 60 }, // 00:00–08:00  (8h SLEEP BLOCK → loops to morning)
};
const DAY_START_MIN = PHASE_WINDOW.morning.start;            // 08:00 (480)
const DAY_END_MIN = PHASE_WINDOW["late-night"].end;          // 08:00 next day (1920) — the HARD wake wall
const SLEEP_BLOCK_START = PHASE_WINDOW["late-night"].start;  // 24:00 (1440) — midnight; debt accrues past here
const SLEEP_NEED_MIN = 8 * 60;                               // everyone needs ~8h (owner ruling: <8h ⇒ debt)
const HARD_LIGHTS_OUT = 29 * 60;                             // 05:00 — production ceiling; nobody schemes past it

/** Which real phase a minutes-from-08:00 clock sits in. */
function phaseAt(min: number): TimeOfDay {
  for (const p of TIME_OF_DAY_ORDER) if (min < PHASE_WINDOW[p].end) return p;
  return "late-night";
}
const pad2 = (n: number): string => String(n).padStart(2, "0");
/** A believable wall-clock label (HH:MM) from minutes-from-midnight (wraps past 24h). */
function hhmm(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

// ── Chronotype + the natural bedtime it anchors (owner ruling 2026-06-24) ───────────────────────
// Chronotype is its OWN axis (early-bird ↔ night-owl), not just a restatement of the stats: blend the
// `social − physical` lean (social skews owl, comp-focused skews early) with an INDEPENDENT seeded jitter,
// so two similar-stat houseguests still differ. It sets the NATURAL bedtime — when they'd turn in with
// nobody around — which the social pull below then bends LATER (never earlier).
const STAT_LEAN_WEIGHT = 0.55;   // how much of chronotype is the stat lean vs. the independent draw
const CHRONO_GAIN = 1.3;         // stretch the blend toward the extremes (a blend of two centered draws clusters)
const NATURAL_BED_LARK = 20.5 * 60; // 20:30 — strongest early bird's natural turn-in
const NATURAL_BED_OWL = 26.5 * 60;  // 02:30 — strongest owl's natural turn-in
function chronotypeOf(stats: { physical: number; social: number }, jitter: number): number {
  const lean = Math.max(-1, Math.min(1, (stats.social - stats.physical) / 0.5));
  return Math.max(-1, Math.min(1, CHRONO_GAIN * (STAT_LEAN_WEIGHT * lean + (1 - STAT_LEAN_WEIGHT) * jitter))); // [-1,1]
}
const naturalBedMin = (chrono: number): number =>
  Math.round(NATURAL_BED_LARK + ((chrono + 1) / 2) * (NATURAL_BED_OWL - NATURAL_BED_LARK));
const chronoTag = (c: number): string => (c <= -0.33 ? "lark" : c >= 0.33 ? "owl " : "mid ");

// ── The emergent stay-up decision: who is still awake × how much you care, vs. sleep pressure ───
// Past their natural bedtime, each still-awake NPC turns in when the hours they've stayed past it exceed
// their TOLERANCE — built from the awake others they care about: ally/showmance bonds, a live threat to
// watch, the buzz of a busy house, restlessness, and an owl's extra tolerance. So a lively house keeps
// people up; an emptying one sends even owls to bed. All weights are tunable — this is the lever to feel.
const STAY = {
  bondW: 0.55, showmanceW: 0.7, threatW: 0.55, buzzW: 0.45, // the social-pull components
  chronoFloor: 0.25, chronoSpan: 1.55,                      // socialFactor = floor + span×chronotype01 (lark→0.25, owl→1.8)
  restlessW: 0.3, jitterW: 0.5,
  drainW: 0.4, drainCap: 4, // a CHARACTER conflict drains you ⇒ you turn in EARLIER (owner ruling: never a personality change)
};

// ── Sleep debt → next-day penalties: EFFECTIVENESS, never PERSONALITY (owner ruling 2026-06-24) ──
// `debt(h)` = the 8h need minus what you actually banked before the 08:00 wall. It costs you the NEXT day
// on TWO channels only — (1) comp sharpness, (2) social SWAY. The mechanic must NOT change who a character
// is (no manufactured conflict, no scene-nature skew): the emotional dimension instead flows the OTHER way,
// as a CONFLICT → EARLIER-BEDTIME drain (above, in `STAY.drainW`). Divisors set how fast each bites.
const DEBT = { compDiv: 8, socialDiv: 6 };
function debtHoursOf(turnIn: number): number {
  const slept = (Math.min(turnIn + SLEEP_NEED_MIN, DAY_END_MIN) - turnIn) / 60; // <8h once you bed past midnight
  return Math.max(0, 8 - slept);
}
// The tired SOCIAL penalty = reduced EFFECTIVENESS, applied to scenes a tired houseguest initiates the next
// day: their fold on the other person is scaled DOWN in magnitude — symmetric, so they're worse at warming
// AND at souring. They move the needle LESS (reduced sway); they do NOT move it in a different direction.
const TIRED = { swayDamp: 0.9 }; // fraction of sway lost at full social penalty (fold scaled by 1 − damp×penalty)

// ── Late-night cluster curve: the few who stay up should find EACH OTHER ───────────────────────
// The deepest owls can end up awake ALONE, paying full sleep cost for no scheming. So add a SLIGHT,
// night-depth-ramped co-location pull: 0 during waking hours (daytime movement unchanged), ramping after
// midnight to an additive `strength` floor folded into the movement pull, so awake owls gravitate to
// whatever room already has people. Tunable — the lever for WHEN staying up buys company.
const LATE_CLUSTER_DEFAULT = 0.6;
function clusterBoost(clock: number, strength: number): number {
  if (clock < SLEEP_BLOCK_START) return 0;                          // daytime: no co-location nudge
  const frac = Math.min(1, (clock - SLEEP_BLOCK_START) / (3 * 60)); // 0 at 00:00 → 1 by 03:00
  return strength * (0.6 + 0.4 * frac);                             // live from midnight, fuller by 03:00
}

// ── Scene-nature classes ──────────────────────────────────────────────────────────────────────
const GAME: ReadonlySet<InteractionType> = new Set<InteractionType>(["alliance", "strategy", "conflict", "betrayal"]);
const isGame = (t: InteractionType): boolean => GAME.has(t);
// The friction subset that DRAINS the people in it (→ earlier bedtime). Alliance/strategy are game but not draining.
const CONFLICT: ReadonlySet<InteractionType> = new Set<InteractionType>(["conflict", "betrayal"]);

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
// Personality-only: who they are decides what kind of scene they run. Sleep does NOT enter here (the
// debt mechanic must not change personality — no tired-friction tilt that would make a peacemaker fight).
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
  fights: number;     // conflict/betrayal scenes this NPC was IN (either role) — the drain that beds them earlier
}
const freshObs = (): Obs => ({ room: new Map(), coPresent: new Map(), friendly: 0, game: 0, scenePartners: new Map(), lateScenes: 0, fights: 0 });
const bump = <K>(m: Map<K, number>, k: K, by = 1): void => { m.set(k, (m.get(k) ?? 0) + by); };
const topN = <K>(m: Map<K, number>, n: number): [K, number][] =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

/** Per-phase telemetry — the nightly presence economy: how the awake set + scene volume thin. */
type PhaseStats = Record<TimeOfDay, { ticks: number; awakeSum: number; scenes: number }>;
const freshPhaseStats = (): PhaseStats =>
  Object.fromEntries(TIME_OF_DAY_ORDER.map((p) => [p, { ticks: 0, awakeSum: 0, scenes: 0 }])) as PhaseStats;

/** Per-NPC sleep ledger, averaged over observed days (emergent bedtime varies night to night). */
interface SleepAgg { tiSum: number; wakeSum: number; sleptSum: number; debtSum: number; days: number; }
const freshSleepAgg = (): SleepAgg => ({ tiSum: 0, wakeSum: 0, sleptSum: 0, debtSum: 0, days: 0 });

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
  // Chronotype + the natural bedtime it anchors (PURE, byte-stable: static stats + one seeded jitter draw
  // per NPC in id order). Bedtime itself is NOT precomputed — it emerges each night below.
  const chronoRng = new SeededRandom(seed * 101 + 5);
  const chrono = new Map(house.map((h) => [h.id, chronotypeOf(h.character.stats, chronoRng.next() * 2 - 1)] as const));
  const naturalBed = new Map(ids.map((id) => [id, naturalBedMin(chrono.get(id)!)] as const));
  const hoh = ids[0]!; // a stand-in HOH so power-proximity has a target to court

  const rel = new RelationshipModel(0.6);
  for (const h of house) rel.setDisposition(h.id, dispositionOf(h.character.archetype));

  const events = new InMemoryEventStore();
  const moveRng = new SeededRandom(seed * 7 + 1);
  const socRng = new SeededRandom(seed * 13 + 3);
  const sleepRng = new SeededRandom(seed * 17 + 5); // dedicated stream for the stay-up jitter (determinism)

  // Yesterday's short sleep → today's reduced social EFFECTIVENESS (sway), carried across days. =0 on day 0.
  // (No emotional/personality carry — the emotional dimension flows the other way, as conflictDrain below.)
  const tiredSocial = new Map<EntityId, number>();
  // Within-TODAY conflict drain (reset each day): a character conflict wears the involved houseguest down so
  // they turn in earlier THAT night. Personality produces the conflict; sleep never authors it.
  const conflictDrain = new Map<EntityId, number>();

  // The pull `assignRooms` reads. `currentClock` is set each tick so the LATE-NIGHT cluster floor ramps in
  // after midnight (0 by day ⇒ daytime movement unchanged). The dial READ is PERSONALITY-only (sleep absent).
  let currentClock = DAY_START_MIN;
  const dialPull = (a: EntityId, b: EntityId): number =>
    movePull(dials.get(a)!, rel.edge(a, b), b === hoh, moveIntent) + clusterBoost(currentClock, lateCluster);
  const dialEdge = (a: EntityId, b: EntityId): EdgeSignals => tiltedEdge(dials.get(a)!, rel.edge(a, b));

  let occ: Map<EntityId, Room> | null = null;
  const obs = new Map<EntityId, Obs>(ids.map((id) => [id, freshObs()] as const));
  const phaseStats = freshPhaseStats();
  const sleepAgg = new Map<EntityId, SleepAgg>(ids.map((id) => [id, freshSleepAgg()] as const));
  // Late-block co-presence (the cluster signal): of the awake owls, how many share a room vs. sit alone.
  let lateCompany = 0;
  let lateAlone = 0;
  // Per-hour awake count across the sleep block (00:00–08:00) — shows the DIP-AND-RISE (owls trail off after
  // midnight, early birds trickle back before the 08:00 wall). 8 buckets: 00:00..07:00.
  const lateHourSum = new Array(8).fill(0) as number[];
  const lateHourTicks = new Array(8).fill(0) as number[];

  // Per-night emergent sleep state (reset each day).
  const turnIn = new Map<EntityId, number>();   // the clock minute this NPC went to bed (undefined ⇒ still up)
  const wakeAt = new Map<EntityId, number>();    // min(turnIn + 8h, 08:00 wall) — early sleepers wake before 08:00
  const isAwakeNow = (id: EntityId, clock: number): boolean => {
    const ti = turnIn.get(id);
    if (ti === undefined) return true;            // hasn't gone to bed yet
    return clock >= wakeAt.get(id)!;              // asleep until their wake time, then up again (early risers)
  };

  // A houseguest's willingness (in HOURS past their natural bedtime) to stay up for who's still around.
  // CHRONOTYPE GATES the social pull (the key to early birds actually bedding early): a lark largely ignores
  // the buzz and turns in near their natural time even with the house up; an owl chases it. Without this the
  // full-house buzz at a lark's early bedtime keeps everyone up to midnight, and nobody ever wakes early.
  const stayTolerance = (id: EntityId, others: EntityId[]): number => {
    const d = dials.get(id)!;
    const c01 = (chrono.get(id)! + 1) / 2;
    const affs = others.map((o) => clamp01(rel.edge(id, o).affinity));
    const thr = others.map((o) => clamp01(rel.edge(id, o).threat));
    const bestAff = affs.length ? Math.max(...affs) : 0;
    const bond = sumTop(affs, 3) * (0.4 + 0.6 * d.loyalty);                         // my people are still up
    const show = bestAff * d.showmancePull;                                         // stay for the showmance
    const threat = sumTop(thr, 2) * (0.6 * d.strategicAggression + 0.4 * d.paranoia); // a live threat to watch
    const buzz = Math.min(1, others.length / 8) * d.socialEnergy;                   // FOMO on a busy house
    const social = STAY.bondW * bond + STAY.showmanceW * show + STAY.threatW * threat + STAY.buzzW * buzz;
    const socialFactor = STAY.chronoFloor + STAY.chronoSpan * c01;                  // larks discount it, owls chase it
    const restless = d.emotionalVolatility - 0.5;                                   // can't settle
    const drain = Math.min(STAY.drainCap, conflictDrain.get(id) ?? 0);              // today's conflicts wear them out
    const jitter = sleepRng.next() - 0.5;                                           // seeded wobble
    return Math.max(0, socialFactor * social + STAY.restlessW * restless - STAY.drainW * drain + STAY.jitterW * jitter);
  };

  // Mirror the orchestrator fold (partner updates their belief about the initiator), but a SLEEP-DEPRIVED
  // initiator moves the needle LESS — their fold is scaled down in magnitude (symmetric: worse at warming AND
  // souring). It's reduced sway, NOT a redirected one, so it never changes the kind of scene or who they are.
  // A fully-rested initiator (social=0) takes the plain `applyDirected` path ⇒ byte-identical to the no-debt model.
  const foldScene = (initiator: EntityId, partner: EntityId, type: InteractionType): void => {
    const social = tiredSocial.get(initiator) ?? 0;
    if (social <= 0) {
      rel.applyDirected(partner, initiator, type, socRng);
      return;
    }
    const scaled = scaleImpact(RELATIONSHIP_CONSTANTS.IMPACT[type], Math.max(0, 1 - TIRED.swayDamp * social));
    rel.applyImpactDirected(partner, initiator, scaled, socRng);
  };

  // One ~1h slice at a given clock minute. Decides emergent turn-ins, then runs the society among the AWAKE.
  const tick = (phase: TimeOfDay, clock: number, record: boolean): void => {
    currentClock = clock; // so dialPull's late-night cluster floor knows how deep into the night it is
    // Emergent bedtime: anyone awake, past their natural bedtime, decides to turn in when sleep pressure
    // (hours past natural bed) beats their tolerance for who's still up — or the 05:00 ceiling forces it.
    const awakeStart = ids.filter((id) => isAwakeNow(id, clock));
    for (const id of awakeStart) {
      if (turnIn.has(id) || clock < naturalBed.get(id)!) continue; // already in bed, or not yet bedtime
      const others = awakeStart.filter((o) => o !== id);
      const hoursPast = (clock - naturalBed.get(id)!) / 60;
      if (clock >= HARD_LIGHTS_OUT || hoursPast >= stayTolerance(id, others)) {
        turnIn.set(id, clock);
        wakeAt.set(id, Math.min(clock + SLEEP_NEED_MIN, DAY_END_MIN));
      }
    }
    const awake = awakeStart.filter((id) => isAwakeNow(id, clock)); // drop those who just turned in
    if (record) {
      phaseStats[phase].ticks++;
      phaseStats[phase].awakeSum += awake.length;
      if (clock >= SLEEP_BLOCK_START) {
        const h = Math.min(7, Math.floor((clock - SLEEP_BLOCK_START) / 60));
        lateHourSum[h] += awake.length; lateHourTicks[h]++;
      }
    }
    if (awake.length < 2) return; // everyone who was up has gone to bed — the house is asleep
    occ = assignRooms(awake, occ, { rng: moveRng, affinity: dialPull, hoh });
    const scenes = richOffscreenStretch({
      events, rng: socRng, npcs: awake, interactions: 4, edgeOf: dialEdge, occupancy: occ,
    });
    for (const s of scenes) {
      foldScene(s.initiator, s.partner, s.type); // fold, with the tired initiator's sway scaled down
      if (CONFLICT.has(s.type)) { // a character conflict drains BOTH ⇒ both turn in earlier tonight
        bump(conflictDrain, s.initiator); bump(conflictDrain, s.partner);
        if (record) { obs.get(s.initiator)!.fights++; obs.get(s.partner)!.fights++; }
      }
    }
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

  // Run whole DAYS on the 24h ring; bedtime emerges, the house empties after midnight, early birds re-wake
  // before the 08:00 wall, and the day ends by force-waking everyone — where the night's sleep debt is cashed.
  const runDay = (record: boolean): void => {
    turnIn.clear(); wakeAt.clear(); conflictDrain.clear();
    for (let clock = DAY_START_MIN; clock < DAY_END_MIN; clock += minutesPerTick) {
      tick(phaseAt(clock), clock, record);
    }
    // Cash the night out: turn-in → hours slept → debt → tomorrow's reduced social sway (and the observed ledger).
    for (const id of ids) {
      const ti = turnIn.get(id) ?? HARD_LIGHTS_OUT; // anyone still up at the wall is force-woken having bedded latest
      const wk = Math.min(ti + SLEEP_NEED_MIN, DAY_END_MIN);
      const debt = debtHoursOf(ti);
      tiredSocial.set(id, clamp01(debt / DEBT.socialDiv));
      if (record) {
        const a = sleepAgg.get(id)!;
        a.tiSum += ti; a.wakeSum += wk; a.sleptSum += (wk - ti) / 60; a.debtSum += debt; a.days++;
      }
    }
  };
  for (let day = 0; day < warmupDays; day++) runDay(false); // let relationships + positions form
  for (let day = 0; day < observeDays; day++) runDay(true);  // measure

  return { ids, name, arche, dials, chrono, naturalBed, rel, obs, phaseStats, sleepAgg, lateCompany, lateAlone, lateHourSum, lateHourTicks, minutesPerTick };
}

// ── Readout ──────────────────────────────────────────────────────────────────────────────────
function report(seed: number, moveIntent: number, minutesPerTick: number, lateCluster: number): void {
  const { ids, name, arche, chrono, rel, obs, phaseStats, sleepAgg, lateHourSum, lateHourTicks } =
    run({ seed, moveIntent, warmupDays: 3, observeDays: 4, minutesPerTick, lateCluster });
  const label = (id: EntityId): string => `${name.get(id)} (${arche.get(id)})`;
  const ticksPerDay = Math.ceil((DAY_END_MIN - DAY_START_MIN) / minutesPerTick);

  console.log(`\n${"═".repeat(96)}`);
  console.log(`  SOCIETY OBSERVATORY — seed ${seed}, move-intent ×${moveIntent.toFixed(2)}, ${minutesPerTick}min/conversation, cluster ${lateCluster.toFixed(2)}`);
  console.log(`  (3 warmup + 4 observed days · waking ${hhmm(DAY_START_MIN)}→00:00 in 4×4h quarters, sleep block 00:00→08:00 ≈ ${ticksPerDay} slices/day)`);
  console.log(`${"═".repeat(96)}`);
  console.log("  Each NPC: chronotype · top room · who they kept ending up with · scene mix · warmest bond / top threat\n");

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
      `  ${chronoTag(chrono.get(id)!)} ${label(id).padEnd(34)} ${(topRoom ? String(topRoom[0]) : "—").padEnd(13)}` +
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

  // The sleep-block DIP-AND-RISE, hour by hour: owls trail off after midnight, early birds re-wake by 08:00.
  console.log(`\n  ── sleep-block awake by hour (owls trail off ▸ early birds trickle back before the 08:00 wall) ──`);
  const hourLabels = lateHourSum.map((_, h) => hhmm(SLEEP_BLOCK_START + h * 60).slice(0, 5));
  const hourAvg = lateHourSum.map((s, h) => (lateHourTicks[h] ? s / lateHourTicks[h] : 0));
  console.log(`     ${hourLabels.map((l) => l.padStart(6)).join("")}`);
  console.log(`     ${hourAvg.map((a) => a.toFixed(1).padStart(6)).join("")}`);
  const maxAwake = Math.max(1, ...hourAvg);
  console.log(`     ${hourAvg.map((a) => "█".repeat(Math.round((a / maxAwake) * 5)).padStart(6)).join("")}`);

  // The sleep economy: who traded sleep for after-midnight scheming, the penalties they carry into the next
  // day (comp sharpness + reduced social SWAY), and `fights` — the conflicts that drained them earlier to bed.
  // `bed`/`wake`/`slept`/`fights` are averaged over the observed days (emergent bedtime varies nightly).
  console.log(`\n  ── sleep economy (stay up to scheme ⇒ bank <8h ⇒ pay it back next day: comp sharpness + social sway) ──`);
  console.log(`     houseguest                         chrono   bed    wake   slept   comp  sway%  fights  late`);
  const sleepRows = ids.map((id) => {
    const a = sleepAgg.get(id)!;
    const days = Math.max(1, a.days);
    const debt = a.debtSum / days;
    return {
      id, late: obs.get(id)!.lateScenes, fights: obs.get(id)!.fights / days,
      bed: a.tiSum / days, wake: a.wakeSum / days, slept: a.sleptSum / days,
      comp: clamp01(debt / DEBT.compDiv), social: clamp01(debt / DEBT.socialDiv),
    };
  }).sort((x, y) => y.social - x.social); // tired owls on top
  for (const r of sleepRows) {
    console.log(
      `     ${label(r.id).padEnd(34)} ${chronoTag(chrono.get(r.id)!)}   ${hhmm(r.bed).padStart(5)}  ${hhmm(r.wake).padStart(5)}  ${r.slept.toFixed(1).padStart(4)}h` +
      `   ${r.comp.toFixed(2)}  ${String(Math.round(r.social * 100)).padStart(3)}%   ${r.fights.toFixed(1).padStart(4)}   ${String(r.late).padStart(4)}`,
    );
  }
  console.log(`     (sway% = reduced EFFECTIVENESS, not a personality change: a tired actor's social folds move others`);
  console.log(`      that much LESS — symmetric, never a redirected one. fights = conflicts/day that drain them to bed EARLIER.)`);

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
// FIND each other: avg awake-late is set by emergent bedtimes — only co-location moves, so more clustering
// ⇒ more late-block scenes for the same people ⇒ staying up finally buys scheming.
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
