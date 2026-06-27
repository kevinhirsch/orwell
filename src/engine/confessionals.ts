import type { EventStore } from "../ports/EventStore";
import type { RandomnessSource } from "../ports/RandomnessSource";
import type { EntityId } from "../domain/event";
import { PLAYER } from "../domain/ids";
import type { SoulProvider } from "../ports/SoulProvider";
import type { RelationshipModel } from "./relationships";

/**
 * NPC Diary Room confessionals (feature 0040). A houseguest's private read of their
 * own game — who they're targeting, who they trust — GROUNDED in the engine's
 * relationship truth (never invented by the narrator). Recorded Vault-only: hidden,
 * witnessed by the confessing NPC alone, so by the 0002 visibility model it can never
 * enter the player's knowledge, and (the admin surface reads no events) never the
 * admin's either. The inverse of the player Diary Room (0013): NPC interiority with
 * no pathway to anyone.
 */
export interface Confessional {
  npc: EntityId;
  /** Who the NPC reads as their biggest threat (their target) — the highest-threat peer. */
  target: EntityId | null;
  /** Who the NPC trusts most — the strongest bond. */
  ally: EntityId | null;
  /** The Vault-only private line (reaches no one). */
  content: string;
  /** What prompted this confessional (audit E55) — the beat/scene it reacts to. */
  trigger?: string;
  /** The NPC's coarse mood at the moment of confessing (from their hidden soul, 0041). */
  mood?: "rattled" | "steady" | "confident";
}

/**
 * The structured context a confessional is composed FROM (audit E55): the beat that triggered it,
 * the confessor's soul state, and a seeded rng for phrasing — so confessionals vary across a
 * season (the 0048 unsealing payoff) instead of one canned line.
 */
export interface ConfessionalContext {
  /** The triggering beat/scene, e.g. "the nomination ceremony" / "the veto ceremony". */
  trigger?: string;
  /** The confessor's hidden emotional state (0..1; 0.5 = calm) — colors the voice. */
  emotionalState?: number;
  /** Seeded phrasing variance. Omitted ⇒ the first template (deterministic, pre-E55-compatible). */
  rng?: RandomnessSource;
  /**
   * PV1 (#1029) — the PLAYER as an eligible SUBJECT of an NPC's private read. The confessor draws its
   * target/ally from `others` (the NPC roster) only, so the player — who rides the whole season — was
   * NEVER named as a confessor's biggest threat or closest ally, even at Final 2. When supplied, the
   * player is folded into the SAME engine-grounded read (`rel.edge(npc, player)`) as any houseguest, so
   * an NPC can confess the player as their target or ally GROUNDED in real signals, never invented.
   * The player is a SUBJECT only — `recordConfessional` still witnesses the confessing NPC ALONE, so
   * the confessional stays Vault-only and reaches no one directly (the inverse player Diary Room, 0013).
   */
  player?: EntityId;
}

const MOOD_OF = (state: number): "rattled" | "steady" | "confident" =>
  state < 0.4 ? "rattled" : state > 0.6 ? "confident" : "steady";

/** Varied target/ally phrasings ({T}/{A} = names) — seeded pick, grounded in the same engine truth. */
const TARGET_LINES = [
  "I need {T} gone — they're my biggest threat",
  "every road to the end runs through {T}, and they have to go",
  "{T} is the one I'm watching — they're playing everybody",
  "if I get any power this week, {T} is the name I write down",
];
const ALLY_LINES = [
  "{A} is the one I actually trust",
  "if I have a ride-or-die in here, it's {A}",
  "{A} and I see this house the same way",
  "the only person I'd go to the end with is {A}",
];
const MOOD_LINES: Record<"rattled" | "steady" | "confident", string> = {
  rattled: "I'm shaken — this house just got very real",
  steady: "I'm keeping my head down and my eyes open",
  confident: "honestly? I feel untouchable right now",
};

/**
 * Build an NPC's confessional from their ACTUAL relationship signals (anti-sycophancy:
 * the NPC's "real feelings" are queried from the engine, not improvised). Pure + seeded.
 * With a `ConfessionalContext` (E55) the content is STRUCTURED — it names its trigger, carries
 * the confessor's mood, and varies its phrasing by seed — never one identical line all season.
 */
export function confessionalFor(
  npc: EntityId,
  others: readonly EntityId[],
  rel: RelationshipModel,
  ctx: ConfessionalContext = {},
): Confessional {
  let target: EntityId | null = null;
  let ally: EntityId | null = null;
  let maxThreat = -Infinity;
  // PV1 (#1029) — the player is an eligible SUBJECT of this read (never invented; same engine signals
  // as any houseguest). They are a candidate ONLY, never the confessor: `confessionalFor` is called
  // for an NPC `npc` and the player is excluded as a confessor upstream (`involvedConfessionals`).
  const candidates: readonly EntityId[] =
    ctx.player && ctx.player !== npc && !others.includes(ctx.player) ? [...others, ctx.player] : others;
  // First pass: the true biggest threat (their target) — unchanged read.
  for (const o of candidates) {
    if (o === npc) continue;
    const e = rel.edge(npc, o);
    if (e.threat > maxThreat) {
      maxThreat = e.threat;
      target = o;
    }
  }
  // Second pass: the strongest bond (their ally), EXCLUDING the target so the same
  // houseguest is never named as both biggest threat and most-trusted (issue #839). With
  // the top bond skipped this naturally falls to the runner-up; with 0/1 distinct others
  // `ally` legitimately stays null. Selection over existing edges only — consumes no rng.
  let maxBond = -Infinity;
  for (const o of candidates) {
    if (o === npc || o === target) continue;
    const e = rel.edge(npc, o);
    const bond = (e.trust + e.affinity) / 2;
    if (bond > maxBond) {
      maxBond = bond;
      ally = o;
    }
  }
  const pick = (lines: readonly string[]): string => (ctx.rng ? lines[ctx.rng.int(lines.length)]! : lines[0]!);
  const targetStr = target ? pick(TARGET_LINES).replace("{T}", target) : "I'm still reading the room";
  const allyStr = ally ? pick(ALLY_LINES).replace("{A}", ally) : "I'm not sure who to trust yet";
  const mood = ctx.emotionalState !== undefined ? MOOD_OF(ctx.emotionalState) : undefined;
  const opening = ctx.trigger ? `After ${ctx.trigger}: ` : "";
  const moodStr = mood ? ` ${MOOD_LINES[mood]}.` : "";
  return {
    npc,
    target,
    ally,
    content: `[confessional ${npc}] ${opening}${targetStr}. ${allyStr}.${moodStr}`,
    ...(ctx.trigger ? { trigger: ctx.trigger } : {}),
    ...(mood ? { mood } : {}),
  };
}

/**
 * Record a confessional as a VAULT-ONLY event: hidden, witnessed by the NPC alone —
 * the player is NEVER a witness, so it can never enter player knowledge (0002), and the
 * admin surface (which reads no events) never sees it (0001/0016).
 */
export function recordConfessional(events: EventStore, conf: Confessional, rng: RandomnessSource, ts: number): void {
  events.record({
    id: `confessional:${conf.npc}:${events.count()}:${rng.int(1_000_000_000)}`, // store-size-keyed: restart-safe (B71)
    ts,
    type: "confessional",
    initiator: conf.npc,
    witnessSet: [conf.npc],
    hidden: true,
    content: conf.content,
  });
}

/**
 * The directly-involved NPC houseguests at a dramatic beat (e.g. the HOH and the two nominees at a
 * nomination ceremony) each confess their REAL, engine-grounded read. The player is excluded — they
 * have their own player Diary Room (0013) and never confess as an NPC. Pure: returns the confessionals;
 * the caller records them Vault-only.
 */
export function involvedConfessionals(
  confessors: readonly EntityId[],
  houseguests: readonly EntityId[],
  rel: RelationshipModel,
  /** Per-confessor structured context (E55): trigger + soul mood + seeded phrasing. */
  ctxFor?: (npc: EntityId) => ConfessionalContext,
): Confessional[] {
  const seen = new Set<EntityId>();
  const out: Confessional[] = [];
  for (const c of confessors) {
    if (c === PLAYER || seen.has(c)) continue;
    seen.add(c);
    out.push(confessionalFor(c, houseguests, rel, ctxFor ? ctxFor(c) : {}));
  }
  return out;
}

/**
 * Fold a confessional into the confessing NPC's dynamic Soul (0024): append-only, so confessionals
 * ACCUMULATE across beats without losing earlier ones (0007), and a later `recall` can surface a
 * specific past confessional to keep the NPC's voice consistent. Vault-stays-Vault: the soul is
 * engine-only and the player never reads it; this only deepens the hidden interiority.
 */
export function recordConfessionalToSoul(soul: SoulProvider, conf: Confessional): void {
  soul.recordToSoul(conf.npc, conf.content);
}
