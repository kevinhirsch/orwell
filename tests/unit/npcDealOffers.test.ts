import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { PLAYER } from "../../src/domain/ids";
import type { AdvanceView, GameSession } from "../../src/ports/GameSession";
import type { UserSandbox } from "../../src/composition/registry";

/**
 * Feature 0123 — NPC-initiated deal offers. A motivated houseguest floats the PLAYER a deal at a lull
 * (the NPC->player counterpart of makeDeal). Drives a real season (no LLM) and proves: an offer surfaces
 * as a `deal-offer` pending; accept makes a real player deal; decline cools the rebuffed NPC; the offer is
 * player-witnessed (not hidden); flag off is byte-identical; seed-deterministic. Roles only — no names.
 */

function resolveLegally(s: Pick<GameSession, "submitDecision">, p: NonNullable<AdvanceView["pending"]>): void {
  if (p.kind === "nominations") s.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
  else if (p.kind === "veto-decision") s.submitDecision({ kind: "veto-decision", use: false });
  else if (p.kind === "replacement") s.submitDecision({ kind: "replacement", replacement: p.options[0]!.id });
  else if (p.kind === "comp-round") s.submitDecision({ kind: "comp-round", intent: "compete" });
  else if (p.kind === "houseguests-choice") s.submitDecision({ kind: "houseguests-choice", vote: p.options[0]!.id });
  else if (p.kind === "goodbye-message") s.submitDecision({ kind: "goodbye-message", vote: p.options[0]!.id });
  else s.submitDecision({ kind: p.kind, vote: p.options[0]!.id } as never);
}

function newGame(user: string, seed: number, offersOn: boolean): UserSandbox {
  const reg = new GameSessionRegistry();
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "The Player", seed });
  sb.session.setNpcDealOffersEnabled(offersOn);
  return sb;
}

/** Drive advanceGame (resolving ceremony pendings) until a deal-offer surfaces; return its pending or null. */
function driveToOffer(sb: UserSandbox, maxSteps = 200): NonNullable<AdvanceView["pending"]> | null {
  for (let i = 0; i < maxSteps; i++) {
    const v = sb.session.advanceGame();
    if (v.pending?.kind === "deal-offer") return v.pending;
    if (v.pending) resolveLegally(sb.session, v.pending);
    if (v.finished) return null;
  }
  return null;
}

describe("0123 — a houseguest floats the player a deal, resolved accept/decline", () => {
  it("an offer surfaces as a deal-offer pending naming who, kind, and terms", () => {
    const sb = newGame("offer-basic", 7, true);
    const offer = driveToOffer(sb);
    expect(offer, "an NPC offered the player a deal").not.toBeNull();
    expect(offer!.kind).toBe("deal-offer");
    expect(offer!.offer, "the offer detail is present").toBeDefined();
    expect(offer!.offer!.from.id).not.toBe(PLAYER); // an NPC floated it
    expect(["safety", "final-two"]).toContain(offer!.offer!.kind);
    expect(offer!.offer!.terms.length).toBeGreaterThan(0);
    // Vault-safe: the approach is a PLAYER-WITNESSED event (not hidden) — the NPC came to them.
    const approach = sb.engine.events.queryAll().find((e) => e.content.includes("float") && e.content.includes("deal"));
    expect(approach, "the approach was recorded").toBeDefined();
    expect(approach!.hidden).toBeFalsy();
    expect(approach!.witnessSet.includes(PLAYER)).toBe(true);
  });

  it("accepting the offer makes a REAL player↔NPC deal on the board", () => {
    const sb = newGame("offer-accept", 7, true);
    const offer = driveToOffer(sb);
    expect(offer).not.toBeNull();
    const from = offer!.offer!.from.id;
    const before = (sb.session.getGameState().deals ?? []).length;
    sb.session.submitDecision({ kind: "deal-offer", vote: "accept" });
    const deals = sb.session.getGameState().deals ?? [];
    expect(deals.length).toBe(before + 1);
    // DealView.parties are { id, name } refs — the new deal binds the player and the offering NPC.
    const partyIds = (d: (typeof deals)[number]): string[] =>
      d.parties.map((p) => (typeof p === "string" ? p : p.id));
    expect(deals.some((d) => partyIds(d).includes(PLAYER) && partyIds(d).includes(from))).toBe(true);
    // The offer is consumed — no deal-offer pending stands after answering.
    expect(sb.session.advanceGame().pending?.kind === "deal-offer").toBe(false);
  });

  it("declining the offer makes NO deal and cools the rebuffed houseguest (hidden)", () => {
    const sb = newGame("offer-decline", 7, true);
    const offer = driveToOffer(sb);
    expect(offer).not.toBeNull();
    const from = offer!.offer!.from.id;
    const beforeThreat = sb.engine.relationships.edge(from, PLAYER).threat;
    const beforeDeals = (sb.session.getGameState().deals ?? []).length;
    sb.session.submitDecision({ kind: "deal-offer", vote: "decline" });
    expect((sb.session.getGameState().deals ?? []).length).toBe(beforeDeals); // no deal created
    // The rebuff is a small directed cooling — the NPC reads the player as a bit more of a threat.
    expect(sb.engine.relationships.edge(from, PLAYER).threat).toBeGreaterThan(beforeThreat);
  });

  it("with the layer OFF, no offer is ever floated (byte-identical)", () => {
    const sb = newGame("offer-off", 7, false);
    const offer = driveToOffer(sb, 200);
    expect(offer).toBeNull();
    expect(sb.engine.events.queryAll().some((e) => e.content.includes("float") && e.content.includes("deal"))).toBe(false);
  });

  it("is seed-deterministic — the same seed floats the same offer (from + kind)", () => {
    const a = driveToOffer(newGame("offer-det", 11, true));
    const b = driveToOffer(newGame("offer-det", 11, true));
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.offer!.from.id).toBe(b!.offer!.from.id);
    expect(a!.offer!.kind).toBe(b!.offer!.kind);
  });
});

describe("0123 — the offer's kind is grounded in the NPC's real read", () => {
  it("a houseguest who strongly bonds with the player floats a FINAL-TWO offer", () => {
    const sb = newGame("offer-grounded", 7, true);
    // Make one NPC read the player as a very strong ally so they are the most-motivated offerer.
    const ally = sb.session.livingIds().find((id) => id !== PLAYER)!;
    sb.engine.relationships.edge(ally, PLAYER).trust = 0.95;
    sb.engine.relationships.edge(ally, PLAYER).affinity = 0.95;
    const offer = driveToOffer(sb);
    expect(offer).not.toBeNull();
    // The strongest-bond NPC offers, and a strong bond ⇒ a final-two ask (grounded, not invented).
    expect(offer!.offer!.from.id).toBe(ally);
    expect(offer!.offer!.kind).toBe("final-two");
  });
});
