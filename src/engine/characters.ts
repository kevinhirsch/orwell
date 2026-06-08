import { npc } from "../domain/ids";
import type { EntityId } from "../domain/ids";
import type { RandomnessSource } from "../ports/RandomnessSource";

/**
 * Minimal house generation for the behavioral-fidelity simulation: role-based
 * NPCs each carrying a few HIDDEN elements that surface rarely. A stub for the
 * full `CharacterFactory` (feature 0004) / Character–Soul split (decision 0001);
 * deliberately name-agnostic.
 */
export interface NpcCharacter {
  id: EntityId;
  hiddenElements: string[];
}

const HIDDEN_POOL = [
  "secret superfan",
  "hidden grudge from day one",
  "concealed showmance crush",
  "playing a double game",
  "a thrown competition",
  "a pre-game connection",
  "a buried insecurity",
  "a secret final-two pact",
  "a hidden competition strength",
  "a grudge they hide with a smile",
];

export function generateHouse(rng: RandomnessSource, n: number): NpcCharacter[] {
  const house: NpcCharacter[] = [];
  for (let i = 1; i <= n; i++) {
    const count = 3 + rng.int(3); // 3..5 hidden elements
    const elements: string[] = [];
    for (let k = 0; k < count; k++) elements.push(rng.pick(HIDDEN_POOL));
    house.push({ id: npc(i), hiddenElements: elements });
  }
  return house;
}
