import type { EntityId } from "../domain/ids";
import { RelationshipModel } from "./relationships";
import type { RelationshipDisposition } from "./relationshipConstants";

/**
 * Emergent multi-party bloc behavior (feature 0043). Big Brother is bloc politics — but decision
 * 0002 forbids a STORED alliance object. So blocs are an EMERGENT READ: clustered from the live
 * relationship graph at decision time, carrying a derived shared target, cohesion, and a loyalty
 * strength — computed every read, persisted never. A betrayal that drops an edge fractures the
 * bloc on the next detection because there is nothing stored to update.
 *
 * PURE + stateless + deterministic: same edges + same loyalty reads ⇒ same blocs.
 */
export const BLOC = {
  /** BB-plausible bloc sizes: pairs through five-person voting blocs. */
  maxSize: 5,
  /** How hard the bloc term bends a decision read, scaled by the bloc's loyalty strength. */
  termWeight: 0.5,
  /** Below this derived loyalty a member is defection-prone (their own incentives dominate). */
  defectionLoyalty: 0.4,
  /** An outside bond must beat the member's weakest inside bond by this margin to peel them off. */
  defectionMargin: 0.1,
  /** Loyalty aggregation: the flightiest member matters more than the average. */
  weakestWeight: 0.7,
  /** Dispositional loyalty baselines (the 0026 disposition family): loyalists stick, clashers don't. */
  dispositionLoyalty: { bond: 0.8, neutral: 0.55, clash: 0.35 } as Record<RelationshipDisposition, number>,
  /** How far the CURRENT soul state (0041) swings effective loyalty around the dispositional base. */
  soulSwing: 0.4,
} as const;

/** A transient, derived bloc — NEVER persisted (decision 0002). */
export interface Bloc {
  members: EntityId[];
  /** The members' top aggregate-threat outsider — the bloc's shared enemy (null at endgame). */
  sharedTarget: EntityId | null;
  /** The weakest internal mutual bond — how tight the bloc actually is. */
  cohesion: number;
  /** Weakest-weighted aggregate of the members' derived loyalty — how STICKY the bloc is. */
  loyaltyStrength: number;
}

/**
 * A houseguest's derived loyalty (the ethereal↔static dial, product feedback 2026-06-10): their
 * dispositional baseline (a loyalist vs. a free agent — static CHARACTER) modulated by their
 * CURRENT soul state (0041: a freshly-rattled loyalist's effective loyalty dips). Derived per
 * read; never stored per bloc.
 */
export function derivedLoyalty(disposition: RelationshipDisposition, soulState: number): number {
  const base = BLOC.dispositionLoyalty[disposition];
  const v = base + (soulState - 0.5) * BLOC.soulSwing;
  return Math.max(0, Math.min(1, v));
}

export interface BlocDeps {
  rel: RelationshipModel;
  active: readonly EntityId[];
  /** The member's derived loyalty (see `derivedLoyalty`); omitted ⇒ a neutral 0.55 for everyone. */
  loyaltyOf?: (id: EntityId) => number;
  /** Mutual-bond threshold for a bloc edge; defaults to the model's alliance threshold (0.5). */
  threshold?: number;
}

const bondOf = (rel: RelationshipModel, a: EntityId, b: EntityId): number => {
  const e = rel.edge(a, b);
  return (e.trust + e.affinity) / 2;
};

/** The MUTUAL bond between two houseguests — a bloc edge needs both directions. */
const mutualBond = (rel: RelationshipModel, a: EntityId, b: EntityId): number =>
  Math.min(bondOf(rel, a, b), bondOf(rel, b, a));

/**
 * Detect the house's current blocs from the live relationship graph. Greedy clustering over the
 * strongest mutual bonds (bounded to `BLOC.maxSize`), then per-member DEFECTION: a low-loyalty
 * member with a stronger outside bond peels off BEFORE any formal betrayal event. Deterministic:
 * edges are ranked by strength with a stable id tiebreak.
 */
export function detectBlocs(deps: BlocDeps): Bloc[] {
  const { rel, active } = deps;
  const threshold = deps.threshold ?? 0.5;
  const loyaltyOf = deps.loyaltyOf ?? ((): number => 0.55);

  // 1) Every qualifying mutual edge, strongest first (stable order for determinism).
  const edges: Array<{ a: EntityId; b: EntityId; w: number }> = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const w = mutualBond(rel, active[i]!, active[j]!);
      if (w >= threshold) edges.push({ a: active[i]!, b: active[j]!, w });
    }
  }
  edges.sort((x, y) => y.w - x.w || (x.a + x.b).localeCompare(y.a + y.b));

  // 2) Greedy size-capped, CLIQUE-LIKE growth: the strongest bonds seed the blocs, and a member
  // joins only if mutually bonded with EVERY current member — a bloc cannot span two houseguests
  // who distrust each other just because they share a friend (that is two blocs, not one). This
  // is also what makes fracture work: a betrayal that collapses one internal edge excludes the
  // betrayer from the next read even when a common friend remains.
  const qualifies = (m: EntityId, cluster: ReadonlySet<EntityId>): boolean =>
    [...cluster].every((x) => mutualBond(rel, m, x) >= threshold);
  const blocOf = new Map<EntityId, Set<EntityId>>();
  for (const { a, b } of edges) {
    const ba = blocOf.get(a);
    const bb = blocOf.get(b);
    if (!ba && !bb) {
      const s = new Set([a, b]);
      blocOf.set(a, s); blocOf.set(b, s);
    } else if (ba && !bb && ba.size < BLOC.maxSize && qualifies(b, ba)) {
      ba.add(b); blocOf.set(b, ba);
    } else if (bb && !ba && bb.size < BLOC.maxSize && qualifies(a, bb)) {
      bb.add(a); blocOf.set(a, bb);
    } else if (ba && bb && ba !== bb && ba.size + bb.size <= BLOC.maxSize) {
      const crossOk = [...ba].every((m) => qualifies(m, bb));
      if (crossOk) for (const m of bb) { ba.add(m); blocOf.set(m, ba); }
    }
  }

  // 3) Per-member defection (pre-betrayal): low loyalty + a stronger bond outside ⇒ peel off.
  const clusters = [...new Set(blocOf.values())].filter((s) => s.size >= 2);
  for (const cluster of clusters) {
    for (const m of [...cluster]) {
      if (loyaltyOf(m) >= BLOC.defectionLoyalty) continue;
      const inside = [...cluster].filter((x) => x !== m);
      if (inside.length === 0) continue;
      const weakestInside = Math.min(...inside.map((x) => mutualBond(rel, m, x)));
      const outside = active.filter((x) => x !== m && !cluster.has(x));
      const bestOutside = outside.length ? Math.max(...outside.map((x) => bondOf(rel, m, x))) : 0;
      if (bestOutside > weakestInside + BLOC.defectionMargin) {
        cluster.delete(m);
        blocOf.delete(m);
      }
    }
  }

  // 4) Project each surviving cluster into a derived, transient Bloc.
  const out: Bloc[] = [];
  for (const cluster of clusters) {
    if (cluster.size < 2) continue;
    const members = [...cluster].sort();
    const outsiders = active.filter((x) => !cluster.has(x));
    let sharedTarget: EntityId | null = null;
    let topThreat = -1;
    for (const o of outsiders) {
      const agg = members.reduce((sum, m) => sum + rel.edge(m, o).threat, 0);
      if (agg > topThreat) { topThreat = agg; sharedTarget = o; }
    }
    let cohesion = 1;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        cohesion = Math.min(cohesion, mutualBond(rel, members[i]!, members[j]!));
      }
    }
    const loyalties = members.map(loyaltyOf);
    const loyaltyStrength =
      BLOC.weakestWeight * Math.min(...loyalties) +
      (1 - BLOC.weakestWeight) * (loyalties.reduce((a, b) => a + b, 0) / loyalties.length);
    out.push({ members, sharedTarget, cohesion, loyaltyStrength });
  }
  return out.sort((a, b) => a.members[0]!.localeCompare(b.members[0]!));
}

/** The bloc the holder belongs to, if any (a derived read — recomputed by the caller per decision). */
export function blocFor(blocs: readonly Bloc[], holder: EntityId): Bloc | null {
  return blocs.find((b) => b.members.includes(holder)) ?? null;
}

/**
 * The bloc TERM on a decision read (0043 §4): how much belonging to a bloc bends the holder's
 * score for a target. Positive = more likely to move against the target. Shield bloc-mates,
 * lean toward the shared enemy — bounded by `termWeight × loyaltyStrength`, layered on the base
 * threat/trust read (it nudges; it never overrides the 0005 hard rules, which bind downstream).
 */
export function blocTerm(blocs: readonly Bloc[], holder: EntityId, target: EntityId): number {
  const bloc = blocFor(blocs, holder);
  if (!bloc) return 0;
  const strength = BLOC.termWeight * bloc.loyaltyStrength;
  if (bloc.members.includes(target)) return -strength;          // shield a bloc-mate
  if (bloc.sharedTarget === target) return +strength;           // lean toward the shared enemy
  return 0;
}
