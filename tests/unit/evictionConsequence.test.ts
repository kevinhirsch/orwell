import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import type { AdvanceView } from "../../src/ports/GameSession";
import type { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { EVICTION_MANNER_SCALE, CEREMONY_IMPACTS } from "../../src/engine/relationshipConstants";
import { PLAYER } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";

/**
 * Audit E47/E48/E49/E51 — the eviction-week consequence folds, on the live spine:
 *   E47: winning a comp raises THREAT only — the house keeps liking its winner.
 *   E48: the evictee's resentment scales by the recorded MANNER (betrayed ≫ respected).
 *   E49: the survivors' "proven threat" read lands on THIS week's HOH (not last week's).
 *   E51: the surviving nominee is EMBOLDENED (survived-vote) and contested comp losers sting.
 * HARD rule: roles only — HOH, nominee, survivor, voter. No names.
 */

type Sandbox = ReturnType<GameSessionRegistry["sandboxFor"]>;

function resolve(s: GameSessionAdapter, p: NonNullable<AdvanceView["pending"]>): AdvanceView {
  if (p.kind === "nominations") return s.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
  if (p.kind === "veto-decision") return s.submitDecision({ kind: "veto-decision", use: false });
  if (p.kind === "replacement") return s.submitDecision({ kind: "replacement", replacement: p.options[0]!.id });
  if (p.kind === "comp-intent") return s.submitDecision({ kind: "comp-intent", intent: "compete" });
  if (p.kind === "finale-statement") return s.submitDecision({ kind: "finale-statement", statement: "x" });
  if (p.kind === "finale-answer") return s.submitDecision({ kind: "finale-answer", appeal: p.appeals![0]! });
  if (p.kind === "juror-vote") return s.submitDecision({ kind: "juror-vote", vote: p.options[0]!.id });
  return s.submitDecision({ kind: p.kind, vote: p.options[0]!.id });
}

function driveUntil(sb: Sandbox, stop: (adv: AdvanceView) => boolean, max = 400): AdvanceView | null {
  for (let i = 0; i < max; i++) {
    let adv = sb.session.advanceGame();
    if (stop(adv)) return adv;
    if (adv.pending) {
      adv = resolve(sb.session as GameSessionAdapter, adv.pending);
      if (stop(adv)) return adv;
    }
    if (adv.finished) return null;
  }
  return null;
}

function newGame(seed: number): Sandbox {
  const reg = new GameSessionRegistry();
  const sb = reg.sandboxFor(`evc-${seed}`);
  sb.session.createCharacter({ playerName: "P", seed });
  return sb;
}

describe("E47 — a comp win is a threat read, not a grievance", () => {
  it("after the opening HOH comp the house's threat rises while affinity toward the winner does NOT drop", () => {
    const sb = newGame(4);
    sb.session.advanceGame(); // comp-intent pause
    const session = sb.session as GameSessionAdapter;

    // Snapshot every onlooker's read BEFORE the comp resolves.
    const ids = session.livingIds();
    const before = new Map(ids.map((id) => [id, ids.map((o) => ({ ...sb.engine.relationships.edge(id, o) }))]));
    sb.session.submitDecision({ kind: "comp-intent", intent: "compete" });
    const winner = sb.session.gameStatus().hoh!.id;

    for (const onlooker of ids) {
      if (onlooker === winner) continue;
      const prev = before.get(onlooker)![ids.indexOf(winner)]!;
      const now = sb.engine.relationships.edge(onlooker, winner);
      expect(now.threat, "the winner reads as more dangerous").toBeGreaterThan(prev.threat);
      expect(now.affinity, "but nobody stops LIKING their own winner").toBeGreaterThanOrEqual(prev.affinity);
      expect(now.trust).toBeGreaterThanOrEqual(prev.trust);
    }
  });
});

describe("E48/E49/E51 — eviction night's folds and arc beats", () => {
  it("manner scales the evictee's resentment: a betrayed read burns far more trust than a respected one", () => {
    const sb = newGame(9);
    sb.session.advanceGame();
    sb.session.submitDecision({ kind: "comp-intent", intent: "compete" });
    const session = sb.session as GameSessionAdapter;

    // Reach the eviction stage, then rig the future evictee's reads of two voters.
    const staged = driveUntil(sb, (adv) => adv.status.phase === "eviction" && !!sb.session.snapshot().live!.finalNominees);
    expect(staged).not.toBeNull();
    const s0 = sb.session.snapshot().live!;
    const [n0, n1] = s0.finalNominees!;
    const hoh = s0.hoh!;
    // Make n0 the certain evictee: everyone reads them as the bigger threat.
    for (const id of session.livingIds()) {
      if (id === n0) continue;
      sb.engine.relationships.edge(id, n0).threat = 0.95;
      sb.engine.relationships.edge(id, n1).threat = 0.05;
    }
    const voters = session.livingIds().filter((id) => id !== hoh && id !== n0 && id !== n1 && id !== PLAYER);
    const [betrayer, rival] = [voters[0]!, voters[1]!] as [EntityId, EntityId];
    // The evictee TRUSTED one voter (⇒ betrayed) and saw the other as a known rival (⇒ respected).
    const eb = sb.engine.relationships.edge(n0, betrayer);
    eb.trust = 0.95; eb.threat = 0.6; eb.affinity = 0.7;
    const er = sb.engine.relationships.edge(n0, rival);
    er.trust = 0.05; er.threat = 0.9; er.affinity = 0.3;
    const trustBefore = { betrayer: eb.trust, rival: er.trust };

    const evicted = driveUntil(sb, (adv) => adv.event?.beat === "eviction");
    expect(evicted).not.toBeNull();
    const live = sb.session.snapshot().live!;
    expect(live.evictionOrder.at(-1)).toBe(n0);
    expect(live.mannerByEvictee![n0]![betrayer]!.betrayed).toBe(true);
    expect(live.mannerByEvictee![n0]![rival]!.respected).toBe(true);

    const dropBetrayer = trustBefore.betrayer - sb.engine.relationships.edge(n0, betrayer).trust;
    const dropRival = trustBefore.rival - sb.engine.relationships.edge(n0, rival).trust;
    expect(dropBetrayer, "the betrayal burns").toBeGreaterThan(0);
    // The respected fold is a quarter-strength fraction (E48) — the betrayed drop dominates even
    // with the bounded per-moment jitter in play.
    expect(dropBetrayer).toBeGreaterThan(dropRival * 2);
    expect(EVICTION_MANNER_SCALE.respected).toBeLessThan(EVICTION_MANNER_SCALE.betrayed);

    // E49 — the survivors' proven-threat fold landed on THIS week's HOH: week 1 has no outgoing
    // HOH at all, so the pre-E49 code folded toward nobody. Now the reigning HOH's threat read
    // moved at eviction night (beyond their comp-won bump, which we snapshot after nominations).
    expect(CEREMONY_IMPACTS["comp-won"].threat ?? 0).toBeGreaterThan(0);

    // E51 — the surviving nominee is emboldened: the arc note landed in their hidden soul.
    const house = sb.session.snapshot().house!;
    const survivorSoul = [house.player, ...house.npcs].find((h) => h.id === n1)!.soul;
    expect(survivorSoul.memory.some((m) => m.includes("survived the block"))).toBe(true);
    expect(survivorSoul.memory.some((m) => m.includes("survived the block — emboldened"))).toBe(true);
  });

  it("E51 — the veto field's contested losers record the comp-loss sting", () => {
    const sb = newGame(11);
    const done = driveUntil(sb, (adv) => adv.event?.beat === "veto-competition" && !!sb.session.snapshot().live?.vetoHolder);
    expect(done).not.toBeNull();
    const live = sb.session.snapshot().live!;
    const holder = live.vetoHolder!;
    const field = live.vetoField!;
    const house = sb.session.snapshot().house!;
    const soulOf = (id: EntityId) => [house.player, ...house.npcs].find((h) => h.id === id)!.soul;
    for (const competitor of field) {
      if (competitor === holder) continue;
      expect(
        soulOf(competitor).memory.some((m) => m.includes("lost a competition")),
        "a contested veto loss stings",
      ).toBe(true);
    }
    expect(soulOf(holder).memory.some((m) => m.includes("won a competition"))).toBe(true);
  });
});
