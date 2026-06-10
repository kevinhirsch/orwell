import type { RelationshipDisposition } from "./relationshipConstants";

/**
 * Feature 0044 — strategic nomination & vote refinements: the SINGLE tunable module (sibling to
 * `relationshipConstants.ts` / `temperatureConstants.ts`). Every magnitude the enriched
 * `nominationStrategy` (season.ts) and `voteChoice` (liveSeason.ts) read lives HERE — no magic
 * number is hard-coded at a call site (the B59 grep gate covers this file like the others).
 *
 * All terms are BOUNDED nudges layered on the threat-primary relationship read: they bend a
 * decision, they never override the 0005 hard rules (legality binds downstream of every read).
 */

/** The nomination tactic an HOH plays — gated by who they are (their static disposition). */
export type NominationTactic = "direct" | "pawn" | "backdoor";

export const DECISION = {
  nomination: {
    /** How hard a rattled HOH's paranoia bends the read toward whoever they least trust (0041). */
    paranoiaWeight: 0.5,
    /**
     * The week's POLITICAL TEMPERATURE: when the top house-wide threat outruns the median read by
     * more than this, the week is "hot" — there is a runaway threat and every HOH plays DIRECT
     * (the tactical games wait for a quiet week).
     */
    runawaySpread: 0.3,
    /**
     * Which tactic each disposition favors on a quiet week (the archetype gate): a loyalist (bond)
     * sits a PAWN beside the target and shields their own; a ruthless schemer (clash) plays the
     * BACKDOOR (bait the veto, name the real target as the replacement); everyone else is DIRECT.
     */
    tacticFor: { bond: "pawn", neutral: "direct", clash: "backdoor" } as Record<
      RelationshipDisposition,
      NominationTactic
    >,
  },
  vote: {
    /**
     * Self-protection under stress (0041): a fully-rattled voter's personal threat read is scaled
     * by (1 + this) — their nerves shout down their bloc and their deals; a calm voter is steady.
     */
    moodSelfProtectWeight: 0.5,
    /** The pull of an OPEN deal (0039): a bound voter leans this hard away from evicting the protected party. */
    dealHonorWeight: 0.3,
    /**
     * Light jury management (0014): evicting someone who still TRUSTS you makes a bitter juror, so
     * a voter discounts a nominee by this × the nominee's trust in them. Deliberately small — it
     * shades near-ties, it never outweighs a real threat read.
     */
    juryManagementWeight: 0.1,
  },
  /**
   * NPC↔NPC deal minting (audit E46): as a week's block goes up, the closest unbound NPC pair may
   * crystallize their scheming into a real, Vault-held pact — which then BINDS them (the 0044 vote
   * lean) and reconciles like any deal (E42): a break lands betrayal-shock, a jury demerit, and a
   * hidden reveal. The player learns of it only by pathway (gossip/overhears), never the ledger.
   */
  npcDeal: {
    /** Chance per nomination ceremony that the house's tightest unbound NPC pair makes a pact. */
    mintProb: 0.35,
    /** The pair's MUTUAL trust must clear this floor — pacts come from real bonds, not noise. */
    mutualTrustMin: 0.5,
    /** Above this mutual trust the pact is a full final-two; below, a week-scoped safety deal. */
    finalTwoTrustMin: 0.72,
  },
} as const;
