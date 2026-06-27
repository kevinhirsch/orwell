import { describe, it, expect } from "vitest";
import { confessionalFor } from "../../src/engine/confessionals";
import { RelationshipModel } from "../../src/engine/relationships";
import { GameSessionRegistry } from "../../src/composition/registry";
import type { AdvanceView } from "../../src/ports/GameSession";
import type { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * Audit E55 + C12 — confessionals are STRUCTURED (trigger/mood/seeded phrasing — never one
 * canned line all season), fire at the week's dramatic beats (noms, veto ceremony, eviction),
 * and finally reach the confessor's own SOUL so they can recall their past reads. Roles only.
 */

function resolve(s: GameSessionAdapter, p: NonNullable<AdvanceView["pending"]>): void {
  if (p.kind === "nominations") s.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
  else if (p.kind === "veto-decision") s.submitDecision({ kind: "veto-decision", use: false });
  else if (p.kind === "replacement") s.submitDecision({ kind: "replacement", replacement: p.options[0]!.id });
  else if (p.kind === "comp-intent") s.submitDecision({ kind: "comp-intent", intent: "compete" });
  else if (p.kind === "finale-statement") s.submitDecision({ kind: "finale-statement", statement: "x" });
  else if (p.kind === "finale-answer") s.submitDecision({ kind: "finale-answer", appeal: p.appeals![0]! });
  else if (p.kind === "juror-vote") s.submitDecision({ kind: "juror-vote", vote: p.options[0]!.id });
  else s.submitDecision({ kind: p.kind, vote: p.options[0]!.id });
}

describe("E55 — structured confessional content (pure)", () => {
  const rel = new RelationshipModel(0.5);
  const others = [npc(1), npc(2), npc(3)];

  it("names its trigger, carries a soul-derived mood, and stays grounded in engine truth", () => {
    rel.edge(npc(1), npc(2)).threat = 0.9;
    rel.edge(npc(1), npc(3)).trust = 0.9; rel.edge(npc(1), npc(3)).affinity = 0.8;
    const conf = confessionalFor(npc(1), others, rel, {
      trigger: "the nomination ceremony", emotionalState: 0.2, rng: new SeededRandom(5),
    });
    expect(conf.content).toContain("the nomination ceremony"); // references its trigger (E55)
    expect(conf.trigger).toBe("the nomination ceremony");
    expect(conf.mood).toBe("rattled");
    expect(conf.target).toBe(npc(2)); // still the engine's real threat read (anti-sycophancy)
    expect(conf.ally).toBe(npc(3));
  });

  it("varies its phrasing by seed — never one identical line all season", () => {
    const lines = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      lines.add(confessionalFor(npc(1), others, rel, { trigger: "the eviction vote", rng: new SeededRandom(seed) }).content);
    }
    expect(lines.size).toBeGreaterThan(1);
  });

  it("without a context the pre-E55 deterministic shape is preserved", () => {
    const a = confessionalFor(npc(1), others, rel);
    const b = confessionalFor(npc(1), others, rel);
    expect(a.content).toBe(b.content);
    expect(a.trigger).toBeUndefined();
  });

  it("never names the same houseguest as both biggest threat and most trusted (issue #839)", () => {
    // A house where the SAME peer is simultaneously the confessor's top threat AND top bond:
    // without the distinctness constraint target === ally (the "Tiana Ortega" double-naming bug).
    const r = new RelationshipModel(0.5);
    const self = npc(1);
    const peers = [npc(2), npc(3)];
    // The first peer is both the strongest threat and the strongest bond...
    r.edge(self, peers[0]!).threat = 0.95;
    r.edge(self, peers[0]!).trust = 0.95;
    r.edge(self, peers[0]!).affinity = 0.95;
    // ...the second peer is the runner-up bond (and a lesser threat).
    r.edge(self, peers[1]!).threat = 0.1;
    r.edge(self, peers[1]!).trust = 0.6;
    r.edge(self, peers[1]!).affinity = 0.6;

    const conf = confessionalFor(self, [self, ...peers], r);
    expect(conf.target).toBe(peers[0]!); // still the true biggest threat (anti-sycophancy)
    expect(conf.ally).toBe(peers[1]!); // ally falls to the runner-up bond, not the target
    expect(conf.ally).not.toBe(conf.target); // ≥2 others ⇒ distinct (issue #839)
  });

  it("with only one other houseguest, target wins and ally stays null (no double-naming)", () => {
    const r = new RelationshipModel(0.5);
    const self = npc(1);
    const only = npc(2);
    r.edge(self, only).threat = 0.9; // the sole peer is the biggest threat
    r.edge(self, only).trust = 0.9;
    r.edge(self, only).affinity = 0.9; // ...and would be the top bond too
    const conf = confessionalFor(self, [self, only], r);
    expect(conf.target).toBe(only);
    expect(conf.ally).toBeNull(); // can't reuse the target as ally; legitimately null
  });
});

describe("E55/C12 — live ceremony confessionals reach the record AND the soul", () => {
  it("fires at nominations, the veto ceremony, and eviction night; content is Vault-only and recall-able after a restart", () => {
    const reg = new GameSessionRegistry();
    const user = "conf-user";
    const sb = reg.sandboxFor(user);
    sb.session.createCharacter({ playerName: "P", seed: 6 });
    const session = sb.session as GameSessionAdapter;

    // Play one full week (through the eviction result).
    for (let i = 0; i < 200; i++) {
      const adv = sb.session.advanceGame();
      if (adv.pending) resolve(session, adv.pending);
      if (adv.event?.beat === "eviction-result" || adv.finished) break;
    }

    const confs = sb.engine.events.query().filter((e) => e.type === "confessional");
    expect(confs.length).toBeGreaterThan(0);
    // Vault-only: the player never witnesses an NPC confessional (0002).
    for (const c of confs) {
      expect(c.hidden).toBe(true);
      expect(c.witnessSet.includes(PLAYER)).toBe(false);
    }
    // E55: more than one beat confesses now — distinct triggers appear across the week. 0089 made the
    // ceremony confessional REACTIVE: it opens with the concrete recent beat and still names its trigger
    // ("…— after the veto ceremony:"), so the trigger label now appears mid-line (case-insensitive scan).
    const triggers = new Set<string>();
    for (const c of confs) {
      const m = c.content.match(/after (the [a-z ]+):/i);
      if (m) triggers.add(m[1]!.toLowerCase());
    }
    expect(triggers.size, `distinct confession triggers (saw: ${[...triggers].join(", ")})`).toBeGreaterThanOrEqual(2);

    // C12: the confessional reached the confessor's own soul (durable mirror)...
    const house = sb.session.snapshot().house!;
    const confessor = house.npcs.find((n) => n.soul.memory.some((m) => m.includes("[confessional")));
    expect(confessor, "an NPC carries their own confessional in their soul").toBeTruthy();

    // ...and is recall-able from the SoulStore AFTER a restart (0030 — the store recalled).
    const reg2 = new GameSessionRegistry();
    reg2.restore(user, reg.snapshot(user));
    const hits = reg2.sandboxFor(user).engine.soul.recall(confessor!.id, "confessional", 5);
    expect(hits.some((m) => m.content.includes("[confessional"))).toBe(true);
  });
});
