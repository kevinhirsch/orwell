/**
 * Feature 0089 — reactive confessionals: the SINGLE tunable module (sibling to `confidenceConstants.ts`
 * `CONFIDENCE` / `threadConstants.ts` `THREAD` / `gossip.ts`'s `GOSSIP`). Every magnitude the
 * recent-event SELECTOR reads lives HERE — no magic number at a call site (the B59 grep gate covers
 * this file like its siblings).
 *
 * These knobs decide ONLY *which* of the confessor's OWN already-witnessed events a confessional reacts
 * to, and *how many* — the recency window, the count, and the relative salience of one event class over
 * another. They NEVER select an event the confessor did not witness, never carry a number, and never
 * author content (the model voices the engine-supplied fact). The Vault Wall is structural (0001/§7):
 * the selector is handed events already filtered to the confessor's witness set and returns only a
 * class-keyed gist, so no other houseguest's sealed state and no number can cross (mandate #2/#3).
 */
import type { EventType } from "../domain/event";

export const CONFESSIONAL = {
  // ── the recency window + count (open-Q #1: react to NOW, not week 1) ─────────────────────────────
  /**
   * How many of the MOST RECENT events (by append order — the log is insertion-ordered) the selector
   * even considers. A confessional reacts to the last beat or two that touched this houseguest, never
   * the whole season; the salience ranking then picks the anchor from inside this fresh tail. Kept
   * small so the reaction reads fresh (the "after the veto ceremony…" beat, not a history lecture).
   */
  recencyWindow: 8,
  /** How many salient events anchor the reaction (the top-N after ranking). 1–2 keeps the line a
   *  REACTION, not a recap — the first is the opener; a second adds at most a brief aside. */
  anchorCount: 2,

  // ── salience weights by event CLASS (open-Q #2: standing > social > flavor) ──────────────────────
  // A beat that CHANGED this houseguest's standing (a comp they played, a ceremony that put them
  // up / saved them, an eviction they survived) outranks an ordinary social scene, which outranks
  // ambient flavor. Recency breaks ties (a seeded coin only when recency is also equal). Bounded,
  // relative weights — they only ORDER existing events; they are never shown and never fold.
  salience: {
    /** A competition this houseguest played — a standing-defining beat. */
    competition: 1.0,
    /** A ceremony / vote / eviction that touched them (nomination, veto ceremony, eviction). */
    ceremony: 0.95,
    /** A houseguest's hidden element surfaced in a scene they were in (a charged, memorable beat). */
    reveal: 0.85,
    /** A social scene they had (a conversation — with the player or another houseguest). */
    social: 0.6,
    /** Anything else they witnessed (ambient house flavor). */
    flavor: 0.3,
  } as Record<string, number>,

  // ── ceremony/comp keyword cues (the event CONTENT is engine-authored board prose; we read its CLASS,
  //    never a number out of it). These map a public `house-event` beat to the right standing class. ──
  /** Content cues that mark a `house-event` as a CEREMONY/vote beat (vs. ambient house flavor). */
  ceremonyCues: ["nominat", "veto", "evict", "Head of Household", "Power of Veto", "block"] as readonly string[],

  // ── the Vault-SAFE gist openers, keyed by CLASS + the confessor's ROLE (never the premise, never a
  //    number). The selector returns ONE of these as the `gist`; `confessionalFor` opens the line with
  //    it. Pure texture anchored to a FACT the confessor lived — it states no outcome the engine did
  //    not produce (a comp they "played", a ceremony that "left them on the block"), so a reactive
  //    confessional can never fabricate a result (mandate #3 / ADR 0005). ──
  gists: {
    competition: {
      initiator: "coming out of that competition",
      witness: "after watching how that competition went",
    },
    ceremony: {
      initiator: "after I made my move at that ceremony",
      witness: "after where that ceremony left me",
    },
    reveal: {
      initiator: "after what came out of me just now",
      witness: "after what I just saw slip out of someone",
    },
    social: {
      initiator: "after the conversation I just had",
      witness: "after that talk I got pulled into",
    },
    flavor: {
      initiator: "after how that just played out",
      witness: "after what just went down in here",
    },
  } as Record<string, { initiator: string; witness: string }>,
} as const;

/** The salience CLASS of a witnessed event (the selector's internal ranking bucket). */
export type SalienceClass = "competition" | "ceremony" | "reveal" | "social" | "flavor";

/**
 * Classify a witnessed event into its salience bucket from PUBLIC structure only — its `type`, its
 * `reveal` flag, and (for a generic `house-event`) keyword cues in the engine-authored board prose.
 * Reads no number and no other houseguest's sealed state; a pure fact-class projection.
 */
export function salienceClassOf(ev: { type: EventType; content: string; reveal?: boolean }): SalienceClass {
  if (ev.type === "competition") return "competition";
  if (ev.reveal) return "reveal";
  if (ev.type === "house-event") {
    return CONFESSIONAL.ceremonyCues.some((cue) => ev.content.includes(cue)) ? "ceremony" : "flavor";
  }
  if (ev.type === "conversation") return "social";
  return "flavor";
}
