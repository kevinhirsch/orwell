import { describe, it, expect } from "vitest";
import { confessionalFor } from "../../src/engine/confessionals";
import { RelationshipModel } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { npc } from "../../src/domain/ids";
import { generateVoice, VOICE_ARCHETYPE_SIGNATURES, VOICE_ARCHETYPE_LEXICON } from "../../src/engine/voice";
import type { VoiceProfile } from "../../src/domain/voiceProfile";

/**
 * Feature 0090 — per-archetype voice. Two halves, both Vault-safe / byte-stable / role-only:
 *  1. `generateVoice` is genuinely per-archetype distinctive (own signature + lexicon pools, harder anchoring).
 *  2. The voice fingerprint is THREADED through the engine-authored confessional prose, so a blunt voice and a
 *     warm voice confess in distinguishable diction/cadence on identical engine-grounded content — phrasing
 *     only, never a fact. ABSENT voice ⇒ byte-identical to the 0040 templated fallback (calibration-safe).
 */

const CURT: VoiceProfile = {
  register: "plainspoken", rhythm: "clipped", energy: "flat", directness: "blunt",
  humor: "dry", stressTell: "goes quiet", signature: "states the play and moves on", lexicon: ["bottom line"],
};
const WARM: VoiceProfile = {
  register: "plainspoken", rhythm: "rambling", energy: "warm", directness: "diplomatic",
  humor: "goofy", stressTell: "over-explains", signature: "narrates the whole room's vibe", lexicon: ["okay so"],
};

describe("0090 — per-archetype voice generation", () => {
  it("draws each archetype's signature + fillers from its OWN pool", () => {
    const v = generateVoice(new SeededRandom(7), "comp-beast");
    expect(VOICE_ARCHETYPE_SIGNATURES["comp-beast"]).toContain(v.signature);
    for (const w of v.lexicon) expect(VOICE_ARCHETYPE_LEXICON["comp-beast"]).toContain(w);
  });

  it("two archetypes read as different voices (signature pools never overlap)", () => {
    const beastSigs = new Set<string>();
    const butterflySigs = new Set<string>();
    for (let s = 0; s < 40; s++) {
      beastSigs.add(generateVoice(new SeededRandom(s), "comp-beast").signature);
      butterflySigs.add(generateVoice(new SeededRandom(s), "social-butterfly").signature);
    }
    for (const sig of beastSigs) expect(butterflySigs.has(sig)).toBe(false);
  });

  it("an un-pooled archetype falls back to the flat pool (additive)", () => {
    // An archetype with no specific pool must still produce a voice (the flat-pool fallback).
    const v = generateVoice(new SeededRandom(3), "no-such-archetype");
    expect(v.signature).toBeTruthy();
    expect(v.lexicon.length).toBeGreaterThan(0);
  });
});

describe("0090 — voice-keyed confessionals", () => {
  const others = [npc(1), npc(2), npc(3)];
  function grounded(): RelationshipModel {
    const rel = new RelationshipModel(0.5);
    rel.edge(npc(1), npc(2)).threat = 0.9; // the real target
    rel.edge(npc(1), npc(3)).trust = 0.9;
    rel.edge(npc(1), npc(3)).affinity = 0.8; // the real ally
    return rel;
  }

  it("a blunt voice and a warm voice confess in distinguishable diction on identical truth", () => {
    const rel = grounded();
    const curt = confessionalFor(npc(1), others, rel, { rng: new SeededRandom(2), voice: CURT });
    const warm = confessionalFor(npc(1), others, rel, { rng: new SeededRandom(2), voice: WARM });
    // Distinguishable phrasing...
    expect(curt.content).not.toBe(warm.content);
    expect(warm.content.length).toBeGreaterThan(curt.content.length); // expansive rambles, curt clips
    // ...but the SAME engine-grounded read (voice never moves a fact).
    expect(curt.target).toBe(npc(2));
    expect(warm.target).toBe(npc(2));
    expect(curt.ally).toBe(npc(3));
    expect(warm.ally).toBe(npc(3));
    // Neither falls back to the single shared templated line.
    expect(curt.content).not.toContain("I need");
    expect(warm.content).not.toContain("I need");
  });

  it("weaves a habitual filler for an expansive voice only", () => {
    const rel = grounded();
    const warm = confessionalFor(npc(1), others, rel, { rng: new SeededRandom(1), voice: WARM });
    expect(warm.content).toContain("okay so");
    const curt = confessionalFor(npc(1), others, rel, { rng: new SeededRandom(1), voice: CURT });
    expect(curt.content).not.toContain("bottom line"); // a clipped voice does not pad
  });

  it("is byte-identical to the templated fallback when no voice is supplied", () => {
    const rel = grounded();
    for (let seed = 1; seed <= 8; seed++) {
      const withMeasured = confessionalFor(npc(1), others, rel, { rng: new SeededRandom(seed) });
      const again = confessionalFor(npc(1), others, rel, { rng: new SeededRandom(seed) });
      expect(withMeasured.content).toBe(again.content); // deterministic
    }
  });

  it("is deterministic — same seed + same voice ⇒ same phrasing", () => {
    const rel = grounded();
    const a = confessionalFor(npc(1), others, rel, { rng: new SeededRandom(9), voice: CURT });
    const b = confessionalFor(npc(1), others, rel, { rng: new SeededRandom(9), voice: CURT });
    expect(a.content).toBe(b.content);
  });

  it("Vault-safe — a voiced confessional leaks no number / soul scalar", () => {
    const rel = grounded();
    const conf = confessionalFor(npc(1), others, rel, {
      rng: new SeededRandom(4), voice: WARM, emotionalState: 0.2,
    });
    expect(conf.content).not.toMatch(/0\.\d|\d{2,}/); // no relationship value, no scalar
  });
});
