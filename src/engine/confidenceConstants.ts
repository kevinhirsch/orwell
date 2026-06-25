/**
 * Feature 0075 — trust-gated confidences: the SINGLE tunable module (sibling to `threadConstants.ts`
 * `THREAD` / `relationshipConstants.ts` / `gossip.ts`'s `GOSSIP`). Every magnitude the confidence
 * engine reads lives HERE — no magic number at a call site (the B59 grep gate covers this file like
 * its siblings).
 *
 * All terms are BOUNDED. They decide ONLY *whether* a houseguest opens up, *how much* of the secret
 * they share, and (rarely) whether they *lie* — never a hard rule and never the Vault Wall (the engine
 * still decides + records every disclosure; the model only voices what it is handed). No number ever
 * crosses to the player (anti-sycophancy, mandate #3).
 */
import type { HiddenElementKind } from "./characterFactory";

/** The graduated disclosure tiers (owner steer #1: the reason decides how much is told). */
export type DisclosureTier = "none" | "tease" | "partial" | "full";

export const CONFIDENCE = {
  // ── the reason: a computed, Vault-hidden motive to disclose ∈ [0,1] (read off existing signals) ──
  /** Weight on the MUTUAL bond (npc→player + player→npc trust+affinity) — genuine closeness. */
  warmthWeight: 0.7,
  /** Weight on banked GOODWILL / owed favor (kept deals, saves, votes, comfort — the reliability ledger). */
  goodwillWeight: 0.45,

  // ── the banked-goodwill ledger: how the player's reliability reads ∈ [0,1] (read off 0039 deals) ──
  // Concrete in-game debt the adapter derives from the deal ledger (kept word, an open pact) — NOT a
  // new authored signal. Bounded so a wall of deals can't trivialize the bond gate; a BROKEN deal
  // subtracts (a houseguest the player burned does not then bare their soul to them).
  keptDealGoodwill: 0.4,
  openDealGoodwill: 0.2,
  brokenDealPenalty: 0.5,

  // ── the disclosure ladder: motive bands (owner steer #1) ────────────────────────────────────────
  // Start at the confidant band (`THREAD.confidantBondThreshold` ≈ 0.7) and step up; tuned vs the UAT.
  bands: {
    tease: 0.7,    // a guarded admission there IS something — class gloss, no real detail crosses
    partial: 0.8,  // a hedged, specifics-blurred version of the real secret
    full: 0.9,     // the whole secret, in their own words — recorded as the player's knowledge
  },

  // ── lies (owner steer #3): a manipulative houseguest may PERFORM a confidence ───────────────────
  /** Archetypes that may fabricate intimacy (high threat read + low warmth) — the strategic-lie path. */
  manipulativeArchetypes: ["villain", "mastermind", "flirt"] as readonly string[],
  /** A lie needs the strategic motive at least this strong (else they simply don't open up). */
  lieMotiveFloor: 0.55,
  /** OF an eligible strategic opening, the seeded chance it is actually a lie (vs. a real partial truth). */
  lieProb: 0.6,
  /** HARD per-season cap on lies told TO the player — rare, like 0059's "≤2 ties" (a house of liars is noise). */
  maxLiesPerSeason: 2,

  // ── the vulnerability fold (0023): a confidence DEEPENS the bond (the houseguest opened up) ──────
  // A confidence is folded as a `bonding` interaction toward the player — the engine owns the
  // magnitude (anti-sycophancy); this only NAMES the nature. A lie folds the SAME warm bump (the
  // player feels closer — that is the trap); a later contradicting pathway is what reverses it (v1
  // surfaces that passively — spec open-Q #4).
  bondNature: "bonding",

  // ── the Vault-SAFE `mayConfide` reason words (the emergent hint) — NEVER the secret, NEVER a number ──
  // The adapter picks ONE by the dominant motive source, so the model leans into a confidence the
  // scene EARNED. Pure texture; carries no premise.
  reasons: {
    keptWord: "you've kept your word to them when it counted",
    openPact: "you've got something working between you",
    closeness: "they've come to trust you more than most of this house",
  },

  // ── the tease gloss (class-keyed, Vault-safe: never the premise, never a number) ────────────────
  teaseGloss: {
    "secret-motive": "there's a reason they're really here that they haven't said out loud",
    "pre-game-tie": "they let slip there's history with someone in this house",
    "concealed-aptitude": "they hinted they're better at this game than they've been letting on",
    "divergent-persona": "the way they talk to you in private doesn't match the version the house sees",
  } as Record<HiddenElementKind, string>,

  // ── fabricated (FALSE) admissions — engine-authored from the public archetype, NEVER a real secret ──
  // Generic, plausible, kind-shaped lies. A lie is not a leak: none of these is anyone's actual sealed
  // detail. The player hears a claim; the engine knows it is false; a later true pathway can contradict it.
  fabrications: {
    "secret-motive": [
      "I'm only here to win the money for my family — nothing else, no strategy",
      "I promised someone back home I'd play it totally straight, so I'd never come after you",
    ],
    "pre-game-tie": [
      "I've never met a single person in this house before the show — you can trust I'm unattached",
      "the only person I knew coming in already got evicted, so I'm a free agent now",
    ],
    "concealed-aptitude": [
      "honestly comps terrify me — I'm hopeless at them, I'm relying on people like you",
      "I throw every competition on purpose, I'd never be a target you'd have to worry about",
    ],
    "divergent-persona": [
      "what you see is what you get with me — I don't have a game face, this is just who I am",
      "I know I seem guarded but with you I've got nothing to hide, I swear",
    ],
  } as Record<HiddenElementKind, readonly string[]>,
} as const;
