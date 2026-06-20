import type { EventStore } from "../ports/EventStore";
import type { KnowledgeService } from "../ports/KnowledgeService";
import type { EntityId } from "../domain/ids";
import type { GameEvent } from "../domain/event";
import { classify } from "../domain/event";
import type { KnowledgeFact, Suspicion } from "../domain/knowledge";
import { makeForPlayerScrub } from "../domain/humanize";

export interface VisibleState {
  forEntity: EntityId;
  visibleEvents: GameEvent[];
  knowledge: KnowledgeFact[];
}

/** A public houseguest roster entry (id → public display name). Non-Vault: names are public facts. */
export type RosterEntry = { id: EntityId; name: string };

/**
 * The ONLY state source for outward channels. It reads the non-Vault
 * `EventStore` (filtered to events the entity witnessed) plus the entity's
 * `KnowledgeState`. It has no handle to the Vault — there is no method, and no
 * dependency, by which Vault data could enter the visible projection.
 *
 * Player-facing CONTENT scrub (audit R4-03 / C-01): the raw stores interpolate machine tokens —
 * entity ids (`npc:8`) and pathway/diffusion slugs (`overheard:offscreen:alliance:1:594987875`,
 * a gossip drift suffix ` · more or less#754`) — into event/knowledge content. The narrator
 * receives this content as context, so it must read as PROSE, not plumbing. An optional public
 * roster resolver (wired from the live session — names are public, never Vault) lets this service
 * substitute ids → names and neutralize slug noise via the pure `humanizeForPlayer`. With no roster
 * (the pure in-memory composition has no live cast) it still scrubs slug noise; it just can't name.
 */
export class VisibleStateService {
  /** Optional public-roster provider. Pure/Vault-free: returns id→name pairs for the live cast. */
  private roster: () => readonly RosterEntry[] = () => [];

  constructor(
    private readonly events: EventStore,
    private readonly knowledge: KnowledgeService,
  ) {}

  /** Wire the public roster so player-facing content names houseguests instead of echoing ids. */
  setRoster(fn: () => readonly RosterEntry[]): void {
    this.roster = fn;
  }

  /** The live public roster (id → public name). Vault-free — names only; for surface-side scrubs. */
  publicRoster(): readonly RosterEntry[] {
    return this.roster();
  }

  /** The player-facing content scrub: ids → names + slug-noise neutralized (Vault-free, pure). */
  private clean(content: string): string {
    return makeForPlayerScrub(this.roster())(content);
  }

  getVisibleStateFor(entity: EntityId): VisibleState {
    // Build the scrub ONCE for this read (the id matcher compiles once), then apply it across the whole
    // visible log + knowledge — instead of recompiling 16 per-id regexes for every event/fact. The
    // projection cleans the entire growing log per commit (the checkpoint's vault-leak sweep), so this
    // batch reuse was the dominant per-season cost (CPU-profiled). Byte-identical to per-item cleaning.
    const scrub = makeForPlayerScrub(this.roster());
    return {
      forEntity: entity,
      visibleEvents: this.events
        .query({ witnessedBy: entity })
        .map((e) => ({ ...e, content: scrub(e.content) })),
      knowledge: this.knowledge
        .knownTo(entity)
        .map((k) => ({ ...k, content: scrub(k.content) })),
    };
  }

  /**
   * 0065 Part E — the player-visible events appended AT OR AFTER `fromIndex` in the append-only log, in
   * order: the O(Δ) delta tail. It slices the immutable log tail FIRST (`eventsSince` — copies only
   * Δ elements) and then applies the SAME witness filter + roster scrub `getVisibleStateFor` uses — so
   * the result is Vault-free by construction (hidden events the entity never witnessed are dropped) and
   * the work is bounded by the number of events since `fromIndex`, never the whole log. `fromIndex` is
   * an event-log length (a count), clamped to `[0, total]`.
   */
  visibleEventsSince(entity: EntityId, fromIndex: number): GameEvent[] {
    const scrub = makeForPlayerScrub(this.roster());
    return this.events
      .eventsSince(Math.max(0, fromIndex))
      .filter((e) => classify(e, entity) === "VISIBLE")
      .map((e) => ({ ...e, content: scrub(e.content) }));
  }

  /**
   * The entity's pathway-free hunches. Non-Vault: a suspicion is, by definition,
   * a belief with no in-game pathway — it carries no Vault content. A social read
   * (0012) may hint at these without naming any off-screen event.
   */
  suspicionsFor(entity: EntityId): Suspicion[] {
    return this.knowledge.suspicionsOf(entity).map((s) => ({ ...s, content: this.clean(s.content) }));
  }
}
