/** Entity identity in the domain. Tests use ROLE-based ids only (never names). */
export type EntityId = string;

/** The single human player. */
export const PLAYER: EntityId = "player";

/** Role-based NPC id helper (e.g. npc(1) -> "npc:1"). No names, ever. */
export function npc(n: number): EntityId {
  return `npc:${n}`;
}
