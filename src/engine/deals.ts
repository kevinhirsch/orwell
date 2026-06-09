import type { EntityId } from "../domain/ids";
import { PLAYER } from "../domain/ids";
import type { RandomnessSource } from "../ports/RandomnessSource";
import type { RelationshipModel } from "./relationships";
import {
  type BindingAction,
  type Deal,
  type DealKind,
  actionBreaks,
  actionHonors,
  conditionFor,
  wrongedParty,
} from "../domain/deal";

export type { BindingAction, Deal, DealKind } from "../domain/deal";

/**
 * Feature 0039 — the deal ledger (engine layer).
 *
 * Tracks every open promise and RECONCILES it against the binding actions flowing through the live
 * loop (0034). When a bound party moves against their partner, the engine — not the storyteller —
 * marks the deal broken and makes it HURT: the betrayal-shock relationship fold (0026), a
 * jury-management demerit (0014, surfaced as `manner.betrayed`), and a witnessed reveal to the
 * wronged party when they see/learn it (0002). Honoring a deal leaves it `kept` with no consequence.
 *
 * Pure of I/O: side effects (relationship moves, jury demerits, reveal events) are delivered through
 * an injected `ReconcileSink`, so the ledger is unit-testable and the integration owns the wiring.
 */

/** Where reconciliation routes its consequences. All optional so status logic is testable in isolation. */
export interface ReconcileSink {
  rel?: RelationshipModel;
  rng?: RandomnessSource;
  /** Record a jury-management demerit: `wronged` will weigh `breaker`'s betrayal in their later lean. */
  juryDemerit?: (wronged: EntityId, breaker: EntityId, deal: Deal) => void;
  /** Record the witnessed reveal of a break into the wronged party's knowledge (returns its event id). */
  reveal?: (wronged: EntityId, breaker: EntityId, deal: Deal) => string | undefined;
  /** Whether the wronged party witnesses/learns this break (default: true for a public ceremony break). */
  witnessed?: (wronged: EntityId, breaker: EntityId, deal: Deal) => boolean;
}

export interface Reconciliation {
  broken: Deal[];
  kept: Deal[];
}

export class DealLedger {
  private deals: Deal[] = [];
  private seq = 0;

  /** Make a new OPEN deal between two parties. `id`/`madeEventId` are assigned/threaded by the caller. */
  make(parties: [EntityId, EntityId], kind: DealKind, terms: string, madeEventId?: string): Deal {
    const deal: Deal = {
      id: `deal:${++this.seq}`,
      parties,
      kind,
      terms,
      condition: conditionFor(kind, parties),
      status: "open",
      ...(madeEventId ? { madeEventId } : {}),
    };
    this.deals.push(deal);
    return deal;
  }

  /** Every open commitment. */
  open(): Deal[] {
    return this.deals.filter((d) => d.status === "open");
  }

  /** All deals a given houseguest is party to (any status) — the player's own visibility scope. */
  forParty(id: EntityId): Deal[] {
    return this.deals.filter((d) => d.parties.includes(id));
  }

  /** Deals NOT involving the player (NPC↔NPC) — Vault-held, never an outward fact. */
  npcOnly(): Deal[] {
    return this.deals.filter((d) => !d.parties.includes(PLAYER));
  }

  get all(): readonly Deal[] {
    return this.deals;
  }

  /**
   * Reconcile a binding action against every OPEN deal it implicates: honoring → `kept`, violating →
   * `broken` (+ consequences via the sink). Engine-decided from the action + condition, never prose.
   */
  reconcile(action: BindingAction, sink: ReconcileSink = {}): Reconciliation {
    const broken: Deal[] = [];
    const kept: Deal[] = [];
    for (const deal of this.deals) {
      if (deal.status !== "open") continue;
      if (actionBreaks(deal, action)) {
        // Resolve the wronged party WHILE the deal is still open (wrongedParty re-checks
        // actionBreaks, which requires status === "open"), then mark it and apply the fallout.
        const wronged = wrongedParty(deal, action);
        deal.status = "broken";
        broken.push(deal);
        if (wronged) this.applyBreak(deal, wronged, action.actor, sink);
      } else if (actionHonors(deal, action)) {
        deal.status = "kept";
        kept.push(deal);
      }
    }
    return { broken, kept };
  }

  /** The betrayal-shock fold + jury demerit + (if witnessed) the reveal event. */
  private applyBreak(deal: Deal, wronged: EntityId, breaker: EntityId, sink: ReconcileSink): void {
    // 0026: the wronged party's hidden read of the breaker takes the large, slow-decaying betrayal hit.
    if (sink.rel && sink.rng) sink.rel.applyDirected(wronged, breaker, "betrayal", sink.rng);
    // 0014: a discrete jury-management demerit (weighs that juror's later lean against the breaker).
    sink.juryDemerit?.(wronged, breaker, deal);
    // 0002: the wronged party learns it as a witnessed event when they see/learn the break.
    const witnessed = sink.witnessed ? sink.witnessed(wronged, breaker, deal) : true;
    if (witnessed) {
      const evId = sink.reveal?.(wronged, breaker, deal);
      if (evId) deal.resolvedEventId = evId;
    }
  }

  /** Plain-data snapshot (persistence 0030 — survives a restart, lossless). */
  serialize(): Deal[] {
    return this.deals.map((d) => ({ ...d, parties: [...d.parties] as [EntityId, EntityId], condition: { ...d.condition, promisors: [...d.condition.promisors] } }));
  }

  /** Replace all deals from a snapshot — recall on return/restart. */
  load(deals: readonly Deal[]): void {
    this.deals = deals.map((d) => ({ ...d, parties: [...d.parties] as [EntityId, EntityId], condition: { ...d.condition, promisors: [...d.condition.promisors] } }));
    this.seq = this.deals.reduce((m, d) => Math.max(m, Number(d.id.split(":")[1]) || 0), 0);
  }
}
