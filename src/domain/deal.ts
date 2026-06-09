import type { EntityId } from "./ids";

/**
 * Feature 0039 — Promise & deal tracking (pure domain model).
 *
 * A deal is a first-class commitment between two houseguests with a CONDITION that a later
 * binding action (a nomination, replacement, veto, or eviction vote) can break. The ENGINE —
 * never the narrator — decides kept/broken by evaluating the action against the condition
 * (anti-sycophancy, priority #3). This module is pure data + predicates: no I/O, no relationship
 * math, no Vault — it only answers "does this action implicate / honor / break this deal?".
 */

/** The concrete _Big Brother_ deal kinds (no general contract DSL — model only what the game has). */
export type DealKind = "safety" | "vote" | "final-two" | "target-other";

export type DealStatus = "open" | "kept" | "broken";

/**
 * What a binding action would have to do to break the deal. `protect` is the party who must not be
 * targeted by an adverse action; `promisors` are the parties bound by it (one-way for `target-other`,
 * both ways for the mutual kinds). Engine-decidable: a break is `actor ∈ promisors ∧ protect ∈ targets`.
 */
export interface DealCondition {
  protect: EntityId;
  promisors: readonly EntityId[];
}

export interface Deal {
  id: string;
  parties: [EntityId, EntityId];
  kind: DealKind;
  /** Vault-free, human-readable description of the promise (safe to show a party). */
  terms: string;
  condition: DealCondition;
  status: DealStatus;
  /** The event that recorded the deal being made (player-witnessed → knowledge; NPC↔NPC → Vault). */
  madeEventId?: string;
  /** The event that recorded it being kept/broken (set on reconciliation). */
  resolvedEventId?: string;
}

/** A binding action through the live decision seam (0034/0005) the engine reconciles deals against. */
export interface BindingAction {
  actor: EntityId;
  kind: "nominate" | "replace" | "veto-use" | "vote-evict";
  /** Who the action moves AGAINST (nominees, replacement, eviction target) — NOT a veto save. */
  targets: readonly EntityId[];
}

/** Adverse actions move against their target; using the veto SAVES, so it is never a betrayal. */
const ADVERSE = new Set(["nominate", "replace", "vote-evict"]);

/**
 * Build the condition for a freshly-made deal. `safety` / `vote` / `final-two` bind BOTH parties not
 * to move against the other; `target-other` binds only the promisor (`parties[0]`) to spare `parties[1]`.
 */
export function conditionFor(kind: DealKind, parties: [EntityId, EntityId]): DealCondition {
  const [a, b] = parties;
  if (kind === "target-other") return { protect: b, promisors: [a] };
  // safety / vote / final-two are mutual: neither party may move against the other.
  return { protect: b, promisors: [a, b] };
}

/** Does this action involve a party of the deal taking an adverse swing whose target is a party? */
export function actionImplicates(deal: Deal, action: BindingAction): boolean {
  if (deal.status !== "open") return false;
  if (!ADVERSE.has(action.kind)) return false;
  const isParty = deal.parties.includes(action.actor);
  const hitsParty = action.targets.some((t) => deal.parties.includes(t) && t !== action.actor);
  return isParty && hitsParty;
}

/**
 * The crux: did this binding action BREAK the deal? True iff a bound promisor moved adversely against
 * the protected party. Decided purely from the action + the condition — never from chat prose.
 */
export function actionBreaks(deal: Deal, action: BindingAction): boolean {
  if (deal.status !== "open") return false;
  if (!ADVERSE.has(action.kind)) return false;
  const c = deal.condition;
  if (!c.promisors.includes(action.actor)) return false;
  // The protected party was targeted — OR, for a mutual deal, either party was targeted by the other.
  if (action.targets.includes(c.protect) && action.actor !== c.protect) return true;
  if (c.promisors.length > 1) {
    // Mutual: the actor (a promisor) moving against the OTHER party also breaks it.
    return action.targets.some((t) => deal.parties.includes(t) && t !== action.actor);
  }
  return false;
}

/** The party wronged by a break (the one moved against); undefined when the action doesn't break it. */
export function wrongedParty(deal: Deal, action: BindingAction): EntityId | undefined {
  if (!actionBreaks(deal, action)) return undefined;
  return deal.parties.find((p) => p !== action.actor);
}

/**
 * Did a party HONOR the deal — i.e., take an adverse binding action where they COULD have moved
 * against their partner but pointedly did not? That is the signal that a promise was actively kept
 * (not merely untouched). Used by the seam to mark a deal `kept`.
 */
export function actionHonors(deal: Deal, action: BindingAction): boolean {
  if (deal.status !== "open") return false;
  if (!ADVERSE.has(action.kind)) return false;
  if (!deal.condition.promisors.includes(action.actor)) return false;
  const other = deal.parties.find((p) => p !== action.actor);
  return !!other && action.targets.length > 0 && !action.targets.includes(other);
}
