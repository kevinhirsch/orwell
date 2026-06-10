import type { EntityId } from "./ids";
import type { RandomnessSource } from "../ports/RandomnessSource";

/**
 * Hard eligibility/legality rules of the weekly loop — PURE domain core, no I/O.
 * Temperature never overrides these (the functions don't even take a temperature),
 * and a reserve twist can't either: the rules are computed here, not in the
 * narrative or twist layers.
 */
export interface WeekState {
  houseguests: EntityId[];
  player: EntityId;
  hoh: EntityId;
  nominees: [EntityId, EntityId];
  /** The previous reign's HOH — ineligible to defend the crown (unless a special comp permits). */
  outgoingHoh?: EntityId;
  vetoWinner?: EntityId;
}

/** Marker chip: whoever draws it picks the slot instead of receiving a name. */
export const HOUSEGUESTS_CHOICE = "__houseguests_choice__" as const;
type Chip = EntityId | typeof HOUSEGUESTS_CHOICE;

export interface VetoDraw {
  participants: EntityId[];
  houseguestsChoice?: { holder: EntityId; picked: EntityId; candidates: EntityId[] };
}

/**
 * The legal veto field size for a house of `remaining` active houseguests (feature 0045): the classic
 * **six** (HOH + 2 nominees + 3 chip draws) until the house is too small, then it **degrades** to
 * everyone left. At Final 5 the field is 5; at Final 4 it is 4. `vetoParticipants` already yields this
 * (a short pool simply produces fewer draws); this pins the contract and is asserted in tests.
 */
export function vetoFieldSize(remaining: number): number {
  return Math.min(6, remaining);
}

function shuffle<T>(items: readonly T[], rng: RandomnessSource): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function eligibleForHOH(
  week: WeekState,
  opts?: { specialAllowsOutgoingHoh?: boolean },
): EntityId[] {
  if (opts?.specialAllowsOutgoingHoh) return [...week.houseguests];
  return week.houseguests.filter((h) => h !== week.outgoingHoh);
}

/**
 * The six-player veto field: HOH + both nominees ("pullers") plus three more,
 * each puller drawing one chip from a seeded bag of the eligible pool (optionally
 * including a single "Houseguest's Choice" chip). A puller who draws that chip
 * SELECTS the slot — an NPC via `choose` (their strongest bond, decision 0002).
 * The player cannot influence which chips come out; the only agency is picking,
 * and only if the player itself draws the chip.
 */
export function vetoParticipants(
  week: WeekState,
  rng: RandomnessSource,
  opts?: { houseguestsChoiceChip?: boolean; choose?: (holder: EntityId, candidates: EntityId[]) => EntityId },
): VetoDraw {
  const [n1, n2] = week.nominees;
  const pullers = [week.hoh, n1, n2];
  const pool = week.houseguests.filter((h) => h !== week.hoh && h !== n1 && h !== n2);

  const bag: Chip[] = [...pool];
  if (opts?.houseguestsChoiceChip) bag.push(HOUSEGUESTS_CHOICE);
  const drawn = shuffle(bag, rng);

  const selected: EntityId[] = [];
  let houseguestsChoice: VetoDraw["houseguestsChoice"];
  let bi = 0;

  for (const puller of pullers) {
    while (bi < drawn.length) {
      const chip = drawn[bi++]!;
      if (chip === HOUSEGUESTS_CHOICE) {
        const candidates = pool.filter((p) => !selected.includes(p));
        if (candidates.length === 0) continue;
        const picked = opts?.choose ? opts.choose(puller, candidates) : candidates[rng.int(candidates.length)]!;
        selected.push(picked);
        houseguestsChoice = { holder: puller, picked, candidates };
        break;
      }
      if (!selected.includes(chip)) {
        selected.push(chip);
        break;
      }
    }
  }

  const participants = [...pullers, ...selected];
  return houseguestsChoice ? { participants, houseguestsChoice } : { participants };
}

/** Replacement nominees: never the HOH, the current nominees, or the veto winner. */
export function selectableReplacements(week: WeekState): EntityId[] {
  const excluded = new Set<EntityId>([week.hoh, week.nominees[0], week.nominees[1]]);
  if (week.vetoWinner) excluded.add(week.vetoWinner);
  return week.houseguests.filter((h) => !excluded.has(h));
}

/** Everyone votes at eviction except the HOH and the two nominees. */
export function evictionVoters(week: WeekState): EntityId[] {
  const excluded = new Set<EntityId>([week.hoh, week.nominees[0], week.nominees[1]]);
  return week.houseguests.filter((h) => !excluded.has(h));
}

/** The HOH breaks an eviction-vote tie. */
export function breaksTie(week: WeekState): EntityId {
  return week.hoh;
}
