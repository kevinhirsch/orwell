import { describe, it, expect } from "vitest";
import { makeSocialGraph, diffuseGossip, rumorFrom, RUMOR_GLOSS } from "../../src/engine/gossip";
import {
  escalationBias,
  hedgePool,
  HEDGE_POOLS,
  GOSSIP_DRIFT,
} from "../../src/engine/gossipDriftConstants";
import { buildEngineCore } from "../../src/composition/engineRoot";
import { npc } from "../../src/domain/ids";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import type { VoiceProfile } from "../../src/domain/voiceProfile";

/**
 * Issue #1397 — CHARACTER-MEDIATED gossip drift. The base diffusion (audit SG-6) already DISTORTS a
 * rumor's claimed NATURE across retellings, but personality-AGNOSTICALLY (a fixed 50/50 escalate-or-soften
 * step). This suite proves the retelling now warps ACCORDING TO THE RETELLER'S OWN PUBLIC VOICE (feature
 * 0084): a dramatic / high-energy mouth AMPLIFIES the claim up the severity ladder (toward "alarming"),
 * a blunt / flat mouth FLATTENS it down (toward "mild") — from the SAME originating belief and the SAME
 * seeded stream. Roles only (no fixture names) — `npc(n)` ids, matching the gossip-test convention.
 *
 * FAIL-BEFORE / PASS-AFTER: before this feature `diffuseGossip` had no `voiceOf`, so a dramatic and a
 * blunt reteller drifted a rumor IDENTICALLY — the directional assertion below (dramatic escalates MORE
 * than blunt) was necessarily false (equal). It passes only because voice now biases the drift direction.
 */

// Two retellers with materially different PUBLIC voices (0084 dials only — nothing hidden).
const DRAMATIC: VoiceProfile = {
  register: "crude", rhythm: "rambling", energy: "manic", directness: "candid",
  humor: "cutting", stressTell: "talks faster", signature: "x", lexicon: [],
};
const BLUNT: VoiceProfile = {
  register: "formal", rhythm: "clipped", energy: "flat", directness: "blunt",
  humor: "dry", stressTell: "gets clipped", signature: "y", lexicon: [],
};

const SUBJECT_A = npc(1);
const SUBJECT_B = npc(2);
// A MID-ladder origin nature, so a retelling has room to drift BOTH up and down.
const ORIGIN_TYPE = "gossip";

// The severity ladder, mild → alarming (a local copy of gossip.ts `SEVERITY_LADDER`, mapped to the PUBLIC
// glosses so a belief's claimed nature can be read back from its content alone).
const LADDER_TYPES = ["bonding", "alliance", "showmance", "gossip", "strategy", "conflict", "betrayal"] as const;
const LADDER_GLOSSES = LADDER_TYPES.map((t) => RUMOR_GLOSS[t]!);

/** A longer chain with side-branches (candidates for a subject swap) — the SG-6 fixture graph. */
function chainGraph() {
  return makeSocialGraph([
    [npc(10), npc(11)], [npc(11), npc(12)], [npc(12), npc(13)], [npc(13), npc(14)],
    [npc(14), npc(15)], [npc(15), npc(16)], [npc(12), npc(20)], [npc(14), npc(21)],
  ]);
}

const CHAIN_IDS = [10, 11, 12, 13, 14, 15, 16, 20, 21].map((n) => npc(n));

/** Diffuse ONE rumor through the chain, every reteller wearing the SAME voice (so the effect is isolated:
 *  the parent rng — hence the `factId` + every per-hop drift FORK — is byte-identical across voices; ONLY
 *  the voice-derived thresholds differ). Returns the far (hops ≥ 2) beliefs, where content drift lives. */
function diffuse(seed: number, voiceOf?: (id: string) => VoiceProfile | undefined) {
  const core = buildEngineCore();
  const { factId } = diffuseGossip({
    knowledge: core.knowledge,
    graph: chainGraph(),
    rng: new SeededRandom(seed),
    origin: npc(10),
    fact: { content: rumorFrom(SUBJECT_A, SUBJECT_B, ORIGIN_TYPE) },
    rounds: 6,
    transmitProb: 1,
    subjects: [SUBJECT_A, SUBJECT_B],
    sceneType: ORIGIN_TYPE,
    ...(voiceOf ? { voiceOf } : {}),
  });
  const beliefs = CHAIN_IDS
    .map((id) => core.knowledge.knownTo(id).find((k) => k.factId === factId))
    .filter((b): b is NonNullable<typeof b> => b !== undefined);
  return { all: beliefs, far: beliefs.filter((b) => (b.hops ?? 0) >= 2) };
}

/** The claimed severity index (0 = mild … 6 = alarming) a belief's content asserts, via its trailing gloss. */
function severityIndex(content: string): number {
  const claim = content.split(" · ")[0]!;
  return LADDER_GLOSSES.findIndex((g) => claim.endsWith(g));
}
const meanSeverity = (beliefs: Array<{ content: string }>): number => {
  const idxs = beliefs.map((b) => severityIndex(b.content)).filter((i) => i >= 0);
  return idxs.reduce((a, b) => a + b, 0) / Math.max(1, idxs.length);
};

const SEEDS = [1, 2, 3, 5, 7, 11, 13, 17];

describe("issue #1397 — the reteller's PUBLIC voice shapes HOW gossip drifts", () => {
  it("the constants map voice → drift as designed (dramatic amplifies, blunt flattens; distinct hedges)", () => {
    // The load-bearing severity lever: a dramatic mouth reads > 0.5 (escalates), a blunt mouth < 0.5 (softens).
    expect(escalationBias(DRAMATIC)).toBeGreaterThan(GOSSIP_DRIFT.baseEscalationBias);
    expect(escalationBias(BLUNT)).toBeLessThan(GOSSIP_DRIFT.baseEscalationBias);
    expect(escalationBias(DRAMATIC)).toBeGreaterThan(escalationBias(BLUNT));
    // Always a lean, never a certainty.
    expect(escalationBias(DRAMATIC)).toBeLessThanOrEqual(GOSSIP_DRIFT.escalationCeil);
    expect(escalationBias(BLUNT)).toBeGreaterThanOrEqual(GOSSIP_DRIFT.escalationFloor);
    // The phrasing texture differs by mouth too.
    expect(hedgePool(BLUNT)).toBe(HEDGE_POOLS.curt);
    expect(hedgePool(DRAMATIC)).toBe(HEDGE_POOLS.embellished);
  });

  it("two DIFFERENT voices drift the SAME belief into materially DIFFERENT content", () => {
    // Same seed / graph / origin ⇒ the ONLY difference is the reteller's voice. The believed claims diverge.
    const dramatic = diffuse(2, () => DRAMATIC).far.map((b) => b.content).sort();
    const blunt = diffuse(2, () => BLUNT).far.map((b) => b.content).sort();
    expect(dramatic.length).toBeGreaterThan(0);
    expect(dramatic).not.toEqual(blunt);
  });

  it("a DRAMATIC voice AMPLIFIES the claim up the severity ladder vs a BLUNT voice (aggregate over seeds)", () => {
    // Aggregate across seeds so the directional bias dominates the per-hop drift roll. This is the assertion
    // that is FALSE on the pre-feature agnostic code (both voices would drift identically ⇒ equal means).
    const dramatic = SEEDS.flatMap((s) => diffuse(s, () => DRAMATIC).far);
    const blunt = SEEDS.flatMap((s) => diffuse(s, () => BLUNT).far);
    expect(dramatic.length).toBeGreaterThan(0);
    expect(blunt.length).toBeGreaterThan(0);
    expect(meanSeverity(dramatic)).toBeGreaterThan(meanSeverity(blunt));
  });

  it("the SAME voice is deterministic; NO voice (agnostic) is byte-identical to itself", () => {
    expect(diffuse(2, () => DRAMATIC).far.map((b) => b.content))
      .toEqual(diffuse(2, () => DRAMATIC).far.map((b) => b.content));
    // The agnostic path (no `voiceOf`) is the pre-feature behavior — a stable control.
    expect(diffuse(2).far.map((b) => b.content)).toEqual(diffuse(2).far.map((b) => b.content));
  });

  it("VAULT SENTINEL: the drifted content encodes NO hidden state — only public template + gloss + hedge", () => {
    // Any hidden-layer signal word or a leaked voice DIAL in a diffusing belief would be a Vault-Wall breach.
    const HIDDEN = /\b(trust|threat|affinity|reliability|alignment|volatility|disposition|soul|mood)\b/i;
    const DIAL_WORDS = /\b(manic|buzzy|crude|folksy|cutting|goofy|evasive|diplomatic|clipped|rambling|blunt|formal|polished)\b/i;
    const KNOWN_HEDGES = new Set<string>(Object.values(HEDGE_POOLS).flat());
    for (const voiceOf of [undefined, () => DRAMATIC, () => BLUNT] as const) {
      for (const seed of SEEDS) {
        for (const b of diffuse(seed, voiceOf).all) {
          const content = b.content;
          // 1. No hidden relationship/soul signal words, and no voice-dial word, ever appears.
          expect(HIDDEN.test(content)).toBe(false);
          expect(DIAL_WORDS.test(content)).toBe(false);
          // 2. The CLAIM is the intact PUBLIC template ending in a KNOWN public gloss — no injected payload.
          const [claim, hedgeToken] = content.split(" · ");
          expect(claim!.startsWith("word around the house is that ")).toBe(true);
          expect(LADDER_GLOSSES.some((g) => claim!.endsWith(g))).toBe(true);
          // 3. Any hedge is one of the KNOWN public pools (the `#nonce` stripped) — never hidden text.
          if (hedgeToken !== undefined) {
            expect(KNOWN_HEDGES.has(hedgeToken.replace(/#\d+$/, ""))).toBe(true);
          }
          // 4. Vault ground truth is preserved verbatim regardless of drift.
          expect((b as unknown as { originalContent?: string }).originalContent)
            .toBe(rumorFrom(SUBJECT_A, SUBJECT_B, ORIGIN_TYPE));
        }
      }
    }
  });
});
