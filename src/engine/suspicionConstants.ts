/**
 * Feature 0097 — the suspicion ledger: the SINGLE tunable module (sibling to `threadConstants.ts`'s
 * `THREAD`, `gossip.ts`'s `GOSSIP`, `secretPacingConstants.ts`'s `SECRET_PACING`). Every magnitude the
 * ledger's DETERMINISTIC floor matcher reads lives HERE — no magic number at a call site (the B59 grep
 * gate covers this file like its siblings; every field below has a REAL consumer in `suspicionLedger.ts`).
 *
 * The ledger scores a player's stated hunch against an ALREADY-REVEALED, Vault-free fact ONLY at a
 * sanctioned reveal — it NEVER reads the Vault (the matcher is handed the reveal, not a Vault handle).
 * The leading verdict path is the FE model proposing the verdict (open-set interpretation, ADR 0005);
 * this deterministic keyword/about/topic floor covers the no-model case so the engine's floor still stands.
 */
export const SUSPICION = {
  /**
   * The deterministic floor matcher's threshold: the minimum count of shared SIGNIFICANT tokens between a
   * hunch's verbatim text and a revealed fact's Vault-free descriptors for the floor to call it a hit
   * (`called-it`). The floor is deliberately conservative — it only asserts a POSITIVE keyword match; a
   * `wrong` / `partial` verdict needs the model's open-set reading (the floor cannot tell a hunch asserted
   * the OPPOSITE of the reveal, so it leaves the ambiguous ones honestly `open`).
   */
  floorMatchTokens: 1,
  /** Tokens shorter than this are ignored as noise ("a", "is", "of") in the deterministic floor matcher. */
  minSignificantTokenLen: 3,
  /**
   * A small stoplist so common connective words never create a spurious floor match (a hunch and a reveal
   * both containing "the" is not a hit). Kept tiny + generic — never any name or hidden-layer word.
   */
  stopwords: [
    "the", "and", "that", "this", "they", "them", "their", "there", "will", "with",
    "have", "has", "was", "are", "for", "who", "what", "when", "from", "into", "going",
    "about", "not", "but", "you", "your", "his", "her", "she", "him", "one", "out",
  ] as readonly string[],
} as const;
