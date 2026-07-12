/**
 * The VOICE fingerprint (feature 0084) — HOW a houseguest talks, as pure domain data. PUBLIC and
 * Vault-free (how a person talks is observable), BYTE-STABLE for the season (voice is identity, never
 * drifts). The generation logic + the live `mood` derivation live in `src/engine/voice.ts`; this is
 * just the shape, in the dependency-free core so ports, surfaces, the factory, and the engine can all
 * name it without crossing a layer (mirrors `physicalCharacteristics`).
 */
export interface VoiceProfile {
  /** Word choice & politeness: formal … plainspoken … crude. */
  register: string;
  /** Sentence length & flow: clipped … measured … rambling. */
  rhythm: string;
  /** Volume & pace: flat … warm … manic. */
  energy: string;
  /** Do they answer the question? evasive … diplomatic … blunt. */
  directness: string;
  /** The KIND of funny (or not): dry … none … goofy … cutting. */
  humor: string;
  /** What the voice DOES under pressure (the real tell). */
  stressTell: string;
  /** One prose sentence capturing the texture — something human to inhabit. */
  signature: string;
  /** A SMALL set of habitual words/fillers — a light seasoning, never a catchphrase routine. */
  lexicon: string[];
  /**
   * Feature 0084 / #1395 — a SMALL set (up to a few) of characteristic PHRASINGS this houseguest
   * genuinely falls back on: how THIS person actually puts things ("at the end of the day", "I'm not
   * here to make friends", "we move"). AUTHENTIC verbal texture, grounded in their archetype/backstory,
   * NOT a comedy bit. Authored at casting from the deep-authoring call; OPTIONAL — the seeded floor
   * mints none (voice's dedicated side-rng draw count stays fixed), so an un-authored houseguest simply
   * has no catchphrases and the narrator leans on their register/rhythm/lexicon instead. PUBLIC + Vault-
   * free (how a person talks is observable) and BYTE-STABLE once folded (voice is identity, never
   * drifts). Reconciles with the standing no-catchphrase rule: the narrator uses these SPARINGLY as
   * texture, never hammered into a repeated punchline or a per-scene routine (see `momentPrompts`).
   */
  catchphrases?: string[];
}
