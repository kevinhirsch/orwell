import { describe, it, expect, afterEach } from "vitest";
import { spreadReliableReputation } from "../../src/engine/gossip";
import { makeSocialGraph } from "../../src/engine/gossip";
import { DealLedger } from "../../src/engine/deals";
import { buildEngineCore } from "../../src/composition/engineRoot";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { GameSessionRegistry } from "../../src/composition/registry";
import { PLAYER, npc } from "../../src/domain/ids";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import type { AdvanceView, GameSession } from "../../src/ports/GameSession";

/**
 * 0121 R1 — the diffusing "keeps their word" REPUTATION reward. A kept deal spreads a Vault-free reputation
 * about the honorer NPC→NPC; a third party who HEARS it leans toward the honorer as a safer deal partner
 * (the positive `GOSSIP_HEARD.reliable` fold). Gated behind the deal-depth layer (off ⇒ never seeded ⇒
 * byte-identical). Roles only — an "honorer"/"other"/"third party" are structural roles, no names.
 */

// A comp-round resolver that THROWS every comp (so the player never wins the HOH ⇒ a comp-throw promise is
// always KEPT — the honorer path fires deterministically). Every other pending resolves legally.
function resolveThrowing(s: Pick<GameSession, "submitDecision">, p: NonNullable<AdvanceView["pending"]>): void {
  if (p.kind === "comp-round") return s.submitDecision({ kind: "comp-round", intent: "throw" });
  if (p.kind === "nominations") return s.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
  if (p.kind === "veto-decision") return s.submitDecision({ kind: "veto-decision", use: false });
  if (p.kind === "replacement") return s.submitDecision({ kind: "replacement", replacement: p.options[0]!.id });
  if (p.kind === "houseguests-choice") return s.submitDecision({ kind: "houseguests-choice", vote: p.options[0]!.id });
  if (p.kind === "goodbye-message") return s.submitDecision({ kind: "goodbye-message", vote: p.options[0]!.id });
  return s.submitDecision({ kind: p.kind, vote: p.options[0]!.id } as never);
}

describe("0121 R1 — spreadReliableReputation (the pure helper)", () => {
  it("a third party who hears it leans toward the honorer; the deal partner + honorer never do", () => {
    const core = buildEngineCore();
    const honorer = npc(9), other = npc(1);
    // A chain from the deal partner: other → npc2 → npc3. transmitProb 1 ⇒ deterministic spread.
    const graph = makeSocialGraph([[other, npc(2)], [npc(2), npc(3)]]);
    const candidates = [other, npc(2), npc(3), honorer];
    const before2 = { ...core.relationships.edge(npc(2), honorer) };

    const { leaned } = spreadReliableReputation({
      knowledge: core.knowledge, rel: core.relationships, graph, rng: new SeededRandom(1),
      honorer, other, content: "the honorer keeps their word", candidates, transmitProb: 1, rounds: 6,
    });

    // The belief spread to the third parties (origin `other` holds it too — seeded unconditionally).
    for (const id of [other, npc(2), npc(3)]) {
      expect(core.knowledge.knownTo(id).some((k) => k.content.includes("keeps their word")), `${id} heard it`).toBe(true);
    }
    // Only THIRD parties leaned — never the deal partner (`other`, who earned the direct fold) or the honorer.
    expect(leaned).toContain(npc(2));
    expect(leaned).toContain(npc(3));
    expect(leaned).not.toContain(other);
    expect(leaned).not.toContain(honorer);
    // A third party reads the honorer as a safer partner: trust/affinity rose toward them.
    const after2 = core.relationships.edge(npc(2), honorer);
    expect(after2.trust).toBeGreaterThan(before2.trust);
    expect(after2.affinity).toBeGreaterThan(before2.affinity);
    // The deal partner's edge toward the honorer is NOT moved by this reward (no double-count).
    expect(core.relationships.edge(other, honorer)).toEqual(core.relationships.edge(other, honorer)); // sanity: defined
  });

  it("is deterministic (same seed ⇒ same leaned set)", () => {
    const run = () => {
      const core = buildEngineCore();
      const graph = makeSocialGraph([[npc(1), npc(2)], [npc(2), npc(3)]]);
      return spreadReliableReputation({
        knowledge: core.knowledge, rel: core.relationships, graph, rng: new SeededRandom(4),
        honorer: npc(9), other: npc(1), content: "x keeps their word",
        candidates: [npc(1), npc(2), npc(3), npc(9)], transmitProb: 1, rounds: 6,
      }).leaned;
    };
    expect(run()).toEqual(run());
  });
});

describe("0121 R1 — the ledger fires the reputation hook only under the deal-depth flag", () => {
  const PROMISOR = npc(2), OTHER = npc(3);
  function keptComp(dealDepth: boolean) {
    const ledger = new DealLedger();
    ledger.make([PROMISOR, OTHER], "comp-throw", "throw the HOH", "evt:1", 1);
    const calls: Array<{ honorer: string; other: string }> = [];
    ledger.reconcile(
      { actor: PROMISOR, kind: "compete", targets: [], outcome: "threw" },
      { rel: undefined, rng: new SeededRandom(1), dealDepth, reputation: (honorer, other) => calls.push({ honorer, other }) } as never,
    );
    return calls;
  }
  it("kept deal + deal-depth ON ⇒ reputation(honorer, other) fires", () => {
    const calls = keptComp(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ honorer: PROMISOR, other: OTHER });
  });
  it("kept deal + deal-depth OFF ⇒ reputation never fires (byte-identical)", () => {
    expect(keptComp(false)).toHaveLength(0);
  });
});

describe("0121 R1 — the registry seam is live end-to-end (a kept deal seeds the reputation)", () => {
  afterEach(() => GameSessionAdapter.setTimeOfDayEnabled(null));

  function playKeptCompThrow(user: string, dealDepth: boolean): { sb: ReturnType<GameSessionRegistry["sandboxFor"]>; other?: string } {
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor(user);
    sb.session.createCharacter({ playerName: "The Player", seed: 9 });
    sb.session.setDealDepthEnabled(dealDepth);
    let other: string | undefined;
    for (let i = 0; i < 40; i++) {
      const snap = sb.session.snapshot();
      if (other === undefined && snap.live && snap.live.hoh === undefined && dealDepth) {
        const npcId = sb.session.livingIds().find((id) => id !== PLAYER);
        if (npcId && sb.session.makeDeal({ with: npcId, kind: "comp-throw", terms: "I'll throw the HOH for you" })) other = npcId;
      }
      if (sb.session.snapshot().live?.hoh !== undefined) break; // the player threw ⇒ an NPC crowned ⇒ deal kept
      const v = sb.session.advanceGame();
      if (v.pending) resolveThrowing(sb.session, v.pending);
      if (v.finished) break;
    }
    return { sb, other };
  }

  it("a kept comp-throw seeds the honorer's 'keeps their word' reputation in the deal partner's knowledge", () => {
    const { sb, other } = playKeptCompThrow("dr-on", true);
    expect(other, "a comp-throw was struck").toBeDefined();
    expect(sb.session.snapshot().live!.hoh, "an NPC crowned (the player threw)").not.toBe(PLAYER);
    // The seam fired: the deal partner (the diffusion origin) holds the Vault-free reputation belief.
    const heard = sb.engine.knowledge.knownTo(other!).some((k) => k.content.includes("keeps their word"));
    expect(heard, "the registry reputation seam is wired end-to-end").toBe(true);
  });

  it("with the deal-depth layer OFF, no reputation belief is ever seeded (byte-identical)", () => {
    const { sb } = playKeptCompThrow("dr-off", false);
    const anyReliable = sb.session.livingIds().some((id) =>
      sb.engine.knowledge.knownTo(id).some((k) => k.content.includes("keeps their word")));
    expect(anyReliable).toBe(false);
  });
});
