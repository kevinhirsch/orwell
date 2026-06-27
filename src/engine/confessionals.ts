import type { EventStore } from "../ports/EventStore";
import type { RandomnessSource } from "../ports/RandomnessSource";
import type { EntityId, GameEvent } from "../domain/event";
import { PLAYER } from "../domain/ids";
import type { SoulProvider } from "../ports/SoulProvider";
import type { RelationshipModel } from "./relationships";
import { CONFESSIONAL, salienceClassOf } from "./confessionalConstants";
import type { SalienceClass } from "./confessionalConstants";

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
 * A single Vault-safe FACT a reactive confessional reacts to (feature 0089). The caller has ALREADY
 * selected this from the confessor's OWN witnessed events (`witnessedBy: npc`) and redacted it to this
 * shape — so it carries the event's CLASS, the confessor's ROLE in it, and a class-keyed `gist`, and
 * NEVER a raw number, another houseguest's sealed read, or the verbatim content of another participant.
 * `confessionalFor` opens the line with the `gist` (the concrete beat the confessor lived) when present.
 */
export interface RecentEventFact {
  /** The event's salience class (competition / ceremony / reveal / social / flavor). */
  type: SalienceClass;
  /** The confessor's role in the event: they initiated it, or merely witnessed it. */
  role: "initiator" | "witness";
  /** A Vault-safe, class-keyed phrase the confessional opens with — never a premise, never a number. */
  gist: string;
}

/**
 * The structured context a confessional is composed FROM (audit E55): the beat that triggered it,
 * the confessor's soul state, and a seeded rng for phrasing — so confessionals vary across a
 * season (the 0048 unsealing payoff) instead of one canned line.
 */
export interface ConfessionalContext {
  /** The triggering beat/scene, e.g. "the nomination ceremony" / "the veto ceremony". */
  trigger?: string;
  /**
   * Feature 0089 — the confessor's OWN recent witnessed events, already selected + redacted to
   * Vault-safe gists by the caller (`selectRecentForConfessional`). When present and NON-EMPTY,
   * `confessionalFor` opens the reaction with the concrete recent beat (a real Diary Room cut: "after
   * the veto ceremony…") instead of the bare `trigger` label, then keeps the grounded target/ally read.
   * ABSENT (or empty) ⇒ the composer falls back to today's `trigger` behavior, BYTE-IDENTICAL to 0040
   * (additive, back-compatible). The facts come ONLY from the confessor's witness set — never a free
   * Vault read — and carry no number/other-houseguest sealed state (mandate #2/#3).
   */
  recentEvents?: readonly RecentEventFact[];
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
  // Feature 0089 — when the caller hands over the confessor's OWN recent witnessed events, the line
  // OPENS with the concrete beat the engine selected (a real Diary Room reaction), then still names its
  // `trigger` beat so the structured occasion stays discoverable. The gists are already Vault-safe +
  // class-keyed (no number, no other-houseguest sealed read). With NO `recentEvents` the opening is
  // EXACTLY the 0040 `trigger` opener ⇒ the whole `content` is BYTE-IDENTICAL to 0040 (the back-compat
  // guarantee). The reacted facts NEVER assert an outcome the engine did not produce — they reference a
  // CLASS of beat the confessor lived ("after that competition", "after where that ceremony left me"),
  // so a reactive confessional can never fabricate a result (anti-sycophancy #3 / ADR 0005).
  const reactedGists = [...new Set((ctx.recentEvents ?? []).slice(0, CONFESSIONAL.anchorCount).map((f) => f.gist))];
  const reaction =
    reactedGists.length > 0
      ? `${reactedGists.join(", and ")}${ctx.trigger ? ` — after ${ctx.trigger}` : ""}: `
      : ctx.trigger
        ? `After ${ctx.trigger}: `
        : "";
  const opening = reaction;
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
 * Feature 0089 — the pure SELECTOR/RANKER for a reactive confessional. Given the recorded events and the
 * confessor `npc`, it returns the top-N recent events THE CONFESSOR WITNESSED, redacted to Vault-safe
 * `RecentEventFact` gists, for `confessionalFor` to open the reaction with.
 *
 * The Vault Wall is structural here (mandate #2): the selector keeps ONLY events whose witness set
 * includes `npc` (`witnessedBy: npc`) — never another houseguest's hidden read, another's confessional,
 * or an off-screen scene the confessor was not in — so a confessional reacts to *what this person
 * lived*, never omniscient board truth. It returns no number and no other-houseguest sealed state: each
 * fact is the event's CLASS + the confessor's ROLE + a class-keyed `gist` (`confessionalConstants.ts`).
 *
 * Anti-sycophancy (mandate #3): the ENGINE selects which events + their factual class from the recorded
 * log; the model never selects or invents one. Determinism (0007): the ranking consumes NO rng beyond a
 * single optional seeded tiebreak (`opts.rng`) for events that tie on BOTH salience AND recency — it
 * draws on no shared stream, so the seeded society/competition/vote spine is untouched. Selection over
 * EXISTING events only; with the same history + seed it returns the same facts.
 */
export function selectRecentForConfessional(
  events: readonly GameEvent[],
  npc: EntityId,
  now: number,
  opts: { window?: number; count?: number; rng?: RandomnessSource } = {},
): RecentEventFact[] {
  const window = opts.window ?? CONFESSIONAL.recencyWindow;
  const count = opts.count ?? CONFESSIONAL.anchorCount;
  // Witness-set bound (the crux): only what the confessor legitimately witnessed. We also drop the
  // confessor's OWN confessionals — a confessional reacting to a prior confessional is self-referential
  // noise (and we never re-voice another confessional's content). `idx` preserves the append order so
  // recency is the original log position, not the post-filter position.
  const witnessed = events
    .map((ev, idx) => ({ ev, idx }))
    .filter(({ ev }) => ev.witnessSet.includes(npc) && ev.type !== "confessional");
  if (witnessed.length === 0) return [];
  // Consider only the most-recent `window` events the confessor witnessed, then rank.
  const recent = witnessed.slice(-window);
  const ranked = recent
    .map(({ ev, idx }) => {
      const cls = salienceClassOf(ev);
      return { ev, idx, cls, salience: CONFESSIONAL.salience[cls] ?? CONFESSIONAL.salience.flavor! };
    })
    .sort((a, b) => {
      if (b.salience !== a.salience) return b.salience - a.salience; // more salient first
      if (b.idx !== a.idx) return b.idx - a.idx; // then more recent (later in the log) first
      return opts.rng ? opts.rng.int(2) * 2 - 1 : 0; // a true tie: seeded coin (no shared-stream draw)
    });
  void now; // accepted for symmetry with ts-based windows; recency is the log position here
  return ranked.slice(0, count).map(({ ev, cls }) => {
    const role: "initiator" | "witness" = ev.initiator === npc ? "initiator" : "witness";
    return { type: cls, role, gist: CONFESSIONAL.gists[cls]![role] };
  });
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
