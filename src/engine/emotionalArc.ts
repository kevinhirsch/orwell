import type { Soul } from "./characterFactory";
import type { InteractionType } from "./relationships";
import { TEMPERATURE_CONSTANTS } from "../domain/temperatureConstants";
import type { TemperatureConstants } from "../domain/temperatureConstants";

/**
 * Character evolution & season arc (feature 0041) — the LIVE emotional layer.
 *
 * A season should *change* a houseguest. Consequential events move their hidden soul
 * `emotionalState` (a 0..1 confidence−distress scalar; 0.5 = calm baseline) and `volatility`;
 * a calm stretch mean-reverts them toward baseline. This is the sibling to the 0028
 * competition emotional modifier — it reuses the SAME tunable constants
 * (`emotional.volatilityScale`, `meanReversionRate`, `baseline`), so the game's "swing"
 * retunes in one place. It is BOUNDED ([0,1]) and never overrides a hard rule (0005) or the
 * Vault Wall (0001) — the player feels the change only through later behavior, never a number.
 *
 * Only the dynamic SOUL drifts; the static CHARACTER baseline is untouched (0007).
 */
export type EmotionalEvent =
  | "blindside"      // an eviction you never saw coming — rattling
  | "betrayed"       // an ally moved against you / broke a deal
  | "nominated"      // put on the block — exposed and rattled going into the veto (B51)
  | "comp-loss"      // lost a competition you contested
  | "scheme"         // an off-screen scheming scene — low-grade agitation
  | "calm"           // a quiet stretch — settle toward baseline
  | "bond"           // an off-screen bonding scene — steadying
  | "survived-vote"  // sat on the block and survived — emboldening
  | "comp-win";      // won a competition — confidence

interface Impact {
  /** Moves `emotionalState`: − toward distress, + toward confidence. */
  valence: number;
  /** Moves `volatility`: + more volatile (shock), − settling. */
  arousal: number;
}

const IMPACT: Record<EmotionalEvent, Impact> = {
  blindside:       { valence: -0.6,  arousal: +0.5 },
  betrayed:        { valence: -0.5,  arousal: +0.45 },
  nominated:       { valence: -0.35, arousal: +0.25 },
  "comp-loss":     { valence: -0.2,  arousal: +0.1 },
  scheme:          { valence: -0.05, arousal: +0.2 },
  calm:            { valence:  0.0,  arousal: -0.3 },
  bond:            { valence: +0.15, arousal: -0.15 },
  "survived-vote": { valence: +0.4,  arousal: -0.1 },
  "comp-win":      { valence: +0.45, arousal: +0.05 },
};

/** How an off-screen scene's nature (0038) colors the initiator's mood. */
const OFFSCREEN_EMOTION: Record<InteractionType, EmotionalEvent> = {
  alliance: "bond",
  bonding: "bond",
  showmance: "bond",
  gossip: "scheme",
  strategy: "scheme",
  conflict: "scheme",
  betrayal: "betrayed",
};

export function offscreenEmotion(type: InteractionType): EmotionalEvent {
  return OFFSCREEN_EMOTION[type];
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/**
 * Evolve a soul's `emotionalState` + `volatility` from one live event, in place. Bounded,
 * mean-reverting toward the soul's emotional baseline (the 0028 family). A more volatile soul
 * swings harder. Appends the new level to `emotionalHistory` so the trajectory persists and
 * never degrades (0007/0030). Deterministic — no randomness.
 */
export function evolveEmotion(
  soul: Soul,
  event: EmotionalEvent,
  c: TemperatureConstants = TEMPERATURE_CONSTANTS,
): void {
  const { valence, arousal } = IMPACT[event];
  const k = c.emotional.volatilityScale;
  const r = c.emotional.meanReversionRate;

  // emotionalState: nudge by valence (scaled by current volatility), then mean-revert toward baseline.
  const swing = valence * k * (0.5 + soul.volatility);
  const nudged = clamp01(soul.emotionalState + swing);
  soul.emotionalState = clamp01(nudged + (soul.emotionalBaseline - nudged) * r);

  // volatility: shocks raise it; calm/bonding settle it. Bounded.
  soul.volatility = clamp01(soul.volatility + arousal * k);

  // arc: the trajectory of where the season has taken them (monotonic, never dropped).
  soul.emotionalHistory.push(soul.emotionalState);
}

/**
 * A short, NAME-FREE arc note for the soul's deepening narrative + vector recall (0024). Carries a
 * distinguishing keyword so a later `recall` can surface this specific inflection to keep the
 * houseguest's voice consistent with what the season did to them.
 */
export function arcNote(event: EmotionalEvent, week: number): string {
  switch (event) {
    case "blindside":      return `week ${week}: blindsided by an eviction — rattled, guarded now`;
    case "betrayed":       return `week ${week}: betrayed by someone they trusted — wary`;
    case "nominated":      return `week ${week}: put on the block — exposed, rattled going into the veto`;
    case "comp-loss":      return `week ${week}: lost a competition — frustrated`;
    case "scheme":         return `week ${week}: deep in off-screen scheming — restless`;
    case "calm":           return `week ${week}: a quiet stretch — steadier`;
    case "bond":           return `week ${week}: bonded with an ally off-screen — reassured`;
    case "survived-vote":  return `week ${week}: survived the block — emboldened`;
    case "comp-win":       return `week ${week}: won a competition — confident`;
  }
}
