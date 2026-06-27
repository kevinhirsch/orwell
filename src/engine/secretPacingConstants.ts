/**
 * Feature 0092 — secret-pacing drip: the SINGLE tunable module (sibling to `threadConstants.ts`'s
 * `THREAD`, `gossip.ts`'s `GOSSIP`, and `confidenceConstants.ts`'s `CONFIDENCE`). Every magnitude the
 * pacing pass reads lives HERE — no magic number at a call site (the B59 grep gate covers this file
 * like its siblings; every weight below has a REAL consumer in `secretPacing.ts` / the adapter — no
 * decorative constant, audit E53).
 *
 * All terms are BOUNDED. The pacing layer decides ONLY *which* already-Wall-safe sealed secret is ripe
 * to edge toward THIS player, and *whether* the weekly drip budget allows it this tick. It NEVER
 * overrides a hard rule, never reads the Vault to a surface, and never authors a line — a dripped
 * secret still crosses ONLY through 0060's existing anchored pathways (gossip / `surfaceInformationTo`
 * / the 0075 confidant slip), as the same belief/paraphrase those organs already produce. No number
 * ever crosses to the player (anti-sycophancy, mandate #3).
 */
export const SECRET_PACING = {
  // ── ripeness: how ready a sealed secret is to edge toward the player (∈ [0,1], engine-only) ───────
  // ripeness = proximityWeight·proximity + tensionWeight·tension + recencyWeight·recency
  //            − alreadyToldPenalty·alreadyTold   (then clamped to [0,1])
  /** Weight on the player↔source CLOSENESS (a confidant slips; a close ally lets something show). The
   *  channel a 0075 confidence rides — the "betrayal" payoff lands hardest on a trusted ally. */
  proximityWeight: 0.55,
  /** Weight on the player↔source FRICTION (you're side-eyeing them; they're wary of you). The channel a
   *  gossip drip rides — the "I knew it" payoff lands hardest on a doubted rival. Balanced with proximity
   *  (open-Q #3: start even; tune which channel the cadence favors against playtest feel). */
  tensionWeight: 0.55,
  /** Friction is driven by THREAT, dampened by affinity: tension = threat − affinity·cushion (clamped).
   *  This is the line between TENSION (you read them as a danger) and mere DISTANCE (you're just not
   *  close): a no-threat bystander reads ~0 tension however cold the bond, so a secret about someone the
   *  player neither bonds with NOR fears stays below the relevance floor (the spec's bystander case). */
  tensionAffinityCushion: 0.5,
  /** Weight on RECENCY — a freshly-active thread is hotter than one that has simmered for weeks. */
  recencyWeight: 0.25,
  /** Penalty for a secret the player has ALREADY caught wind of (0075 disclosed / 0060 surfaced) — the
   *  drip moves ON, it never re-spams the same reveal (anti-spam + non-degradation). Large enough to
   *  push an already-told secret well below a fresh one of equal proximity/tension. */
  alreadyToldPenalty: 0.6,
  /** A source authors several DISTINCT threads (a secret + a weakness + a goal). A TRUE confidence the
   *  player earned from that source (0075) dampens — but does NOT fully floor — their OTHER unrevealed
   *  secrets: closeness has bled SOME of the mystery, but each secret is its own reveal. So a source-level
   *  confidence contributes only this FRACTION of the already-told signal for a thread that has not itself
   *  surfaced/dripped; the thread's OWN surfaced/dripped state still contributes the full 1.0. (A LIE the
   *  player was told — `truthful: false` — contributes NOTHING: the player was deceived, so the real
   *  secret's "I knew it" payoff must stay fully available.) */
  confidedSourceFraction: 0.5,

  // ── recency window (in WEEKS) — how the active age decays the recency term ────────────────────────
  /** A thread active THIS week scores full recency; one active this many weeks ago scores ~0 (linear). */
  recencyDecayWeeks: 3,

  // ── eligibility floor: a thread must be at least this ripe to be a drip CANDIDATE at all ──────────
  /** Below this ripeness the secret is not relevant enough to this player to drip — it keeps playing out
   *  off-screen NPC↔NPC (0060) but does not edge toward the player. Keeps the cadence about people the
   *  player is actually circling (the relevance threshold the §"relevance" test asserts). */
  ripenessFloor: 0.35,

  // ── the weekly drip BUDGET — the pace (the heart of the feature) ──────────────────────────────────
  /** The weekly target band's FLOOR — the cadence aims for at least about this many ripe secrets to edge
   *  toward the player across a week (often met, not always — a quiet week is a feature, not a bug). */
  weeklyTargetMin: 1,
  /** The weekly target band's CEILING — the cadence aims for at most about this many across a week. */
  weeklyTargetMax: 2,
  /** A HARD weekly ceiling: once spent, NO further secret edges toward the player this week, however
   *  ripe (the L40 firehose lesson, applied as a CADENCE). Surplus ripe threads still do their normal
   *  0060 off-screen NPC↔NPC surfacing — only the PLAYER-bound channel is paced. */
  maxDripsPerWeek: 2,

  // ── per-tick eligibility roll — modest so the weekly target is usually-but-not-always met ─────────
  /** OF the top ripe candidate, the seeded per-tick chance the drip actually fires this tick. Modest
   *  (open-Q #2): a quiet week is intentional and makes the next reveal land harder. The season cap
   *  (`THREAD.maxSurfacedPerSeason`) remains the true ceiling on total payoff; this only SHAPES the
   *  scarce reveals into a pace. */
  dripEligibilityRate: 0.34,
} as const;
