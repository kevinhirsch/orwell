/**
 * Trigger secrets → house events (feature 0091) — the single tunable constants module.
 *
 * A houseguest's volatile, sealed trigger attribute (a buried temper, a grudge,
 * a desperate streak) fires an emergent, Vault-safe public house event when
 * accumulated soul strain meets a precipitant + a temperature roll. The SOCIETY /
 * GOSSIP / CONFIDENCE sibling. Every weight has a real consumer (E53 discipline).
 *
 * DEFAULT OFF via ORWELL_TRIGGERS env var — zero draws when off ⇒ the calibration
 * harness (juryReach/UAT/gradient) is byte-identical.
 */
export const TRIGGER = {
  /** How easily a minted trigger is to set off (mint range floor/ceiling, 0..1). */
  volatilityFloor: 0.3,
  volatilityCeiling: 0.9,

  /** The per-check fire probability scalar — bounded LOW (a treat, not a flood). */
  fireRate: 0.04,

  /** How much the NPC's soul strain contributes to the pressure denominator. */
  strainWeight: 0.6,

  /** How much the precipitant (this tick's spark) contributes to the pressure. */
  precipitantWeight: 0.4,

  /** Maximum trigger-type hidden elements minted per NPC. */
  maxTriggersPerNpc: 1,

  /** Maximum eruption events across an entire season. */
  maxEruptionsPerSeason: 3,

  /**
   * Fraction of the hidden-element pool that can carry trigger elements across the
   * whole cast (sparseness — most houseguests stay un-triggered).
   */
  maxTriggerBearers: 0.33,
} as const;

/** The eruption kinds a trigger can emit. Public, Vault-free scene types. */
export type EruptionKind = "blow-up" | "showmance-detonation" | "mask-slips" | "meltdown";

/** The public, name-free eruption event lines — keyed by EruptionKind. */
export const ERUPTION_POOL: Readonly<Record<EruptionKind, ReadonlyArray<string>>> = {
  "blow-up": [
    "A simmering grudge finally boils over into a shouting match that empties the room.",
    "A long-buried feud erupts into a full-throated screaming match in the kitchen.",
    "Tempers that have been building for weeks finally detonate in a hallway showdown.",
    "A confrontation that started as a whisper escalates into a public blow-up that divides the house.",
  ],
  "showmance-detonation": [
    "A showmance detonates in front of the whole house, and the fallout splits the room.",
    "A house romance implodes at the dinner table, and everyone picks a side.",
    "A couple who had been inseparable all summer finally cracks under the pressure — publicly.",
  ],
  "mask-slips": [
    "A houseguest who has played it cool all season finally lets the mask slip — and everyone notices.",
    "The unflappable front cracks, and the real feelings underneath spill out for the whole house to see.",
    "A carefully managed persona collapses mid-conversation, and the house goes silent.",
  ],
  "meltdown": [
    "The pressure of the week breaks one houseguest into a public meltdown over something small.",
    "Weeks of accumulated stress finally overflow in a tearful, unfiltered outburst in the living room.",
    "A fragile composure shatters over a minor slight, and the whole house watches it happen.",
  ],
};
