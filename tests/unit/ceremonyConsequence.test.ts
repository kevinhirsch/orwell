import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import type { AdvanceView } from "../../src/ports/GameSession";
import type { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { CEREMONY_IMPACTS, RELATIONSHIP_CONSTANTS } from "../../src/engine/relationshipConstants";
import { PLAYER } from "../../src/domain/ids";

/**
 * Feature B38 / audit C1 — the 0023 consequence backbone the live loop bypassed: ceremony acts now
 * move the HIDDEN relationship layer (the player's action changes how the house feels about them),
 * engine-owned, magnitudes from constants, never surfaced. HARD rule: roles only — no names.
 */
function resolveLegally(s: GameSessionAdapter, p: NonNullable<AdvanceView["pending"]>): void {
  if (p.kind === "nominations") s.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
  else if (p.kind === "veto-decision") s.submitDecision({ kind: "veto-decision", use: false });
  else if (p.kind === "replacement") s.submitDecision({ kind: "replacement", replacement: p.options[0]!.id });
  else if (p.kind === "finale-statement") s.submitDecision({ kind: "finale-statement", statement: "x" });
  else if (p.kind === "finale-answer") s.submitDecision({ kind: "finale-answer", appeal: p.appeals![0]! });
  else if (p.kind === "juror-vote") s.submitDecision({ kind: "juror-vote", vote: p.options[0]!.id });
  else s.submitDecision({ kind: p.kind, vote: p.options[0]!.id });
}

describe("B38 — ceremony acts fold hidden consequence", () => {
  it("a player-HOH nomination worsens the nominees' hidden edges toward the player — persisted, never surfaced", () => {
    // Find a seed where the player wins the opening HOH (deterministic; B37's preview tells us who wins),
    // so the player faces their OWN nomination ceremony on week 1.
    let reg!: GameSessionRegistry, rel!: ReturnType<typeof reg.sandboxFor>["engine"]["relationships"];
    let pending: NonNullable<AdvanceView["pending"]> | null = null;
    let sb!: ReturnType<GameSessionRegistry["sandboxFor"]>;
    let a = "", b = "";
    for (let seed = 1; seed <= 1200 && !pending; seed++) {
      const r = new GameSessionRegistry();
      const s = r.sandboxFor("u");
      s.session.createCharacter({ playerName: "P", seed });
      if (s.session.runCompetition({}).winner!.id !== PLAYER) continue; // player must win HOH
      s.session.advanceGame();                       // B46: comp-intent pause
      s.session.submitDecision({ kind: "comp-intent", intent: "compete" }); // resolve the HOH comp (player wins)
      const adv = s.session.advanceGame();           // reach the player's nomination decision
      if (adv.pending?.kind !== "nominations") continue;
      // Pick a nominee whose hidden edge toward the player still has headroom (the HOH-win fold already
      // nudged the whole house), so the nomination's adverse move is clearly observable, not pre-clamped.
      const [o0, o1] = [adv.pending.options[0]!.id, adv.pending.options[1]!.id];
      const e = s.engine.relationships.edge(o0, PLAYER);
      const e1 = s.engine.relationships.edge(o1, PLAYER);
      // BOTH nominees need headroom (B55's realistic move-in reads start lower, so a clamped-to-0
      // trust edge is possible after the HOH-win fold — that would mask the adverse move).
      if (e.trust > 0.1 && e.threat < 0.85 && e1.trust > 0.1) { reg = r; sb = s; rel = s.engine.relationships; pending = adv.pending; a = o0; b = o1; }
    }
    expect(pending, "found a seed where the player is the opening HOH").toBeTruthy();
    const beforeA = { threat: rel.edge(a, PLAYER).threat, trust: rel.edge(a, PLAYER).trust };
    const beforeBTrust = rel.edge(b, PLAYER).trust;

    sb.session.submitDecision({ kind: "nominations", choice: [a, b] });

    // The nominees now read their HOH (the player) as more of a threat, less trusted.
    expect(rel.edge(a, PLAYER).threat).toBeGreaterThan(beforeA.threat);
    expect(rel.edge(a, PLAYER).trust).toBeLessThan(beforeA.trust);
    expect(rel.edge(b, PLAYER).trust).toBeLessThan(beforeBTrust); // the other nominee soured too

    // The hidden move PERSISTS across a restart (0030) — never thins (mandate #4).
    const afterThreat = rel.edge(a, PLAYER).threat;
    const reg2 = new GameSessionRegistry();
    reg2.restore("u", reg.snapshot("u"));
    expect(reg2.sandboxFor("u").engine.relationships.edge(a, PLAYER).threat).toBe(afterThreat);

    // The Vault Wall: no edge number appears on any player surface (0001 canary, extended).
    // A value the math clamped to a SHORT round number ("0", "1") is no sentinel — any JSON
    // contains those digits — so only high-precision values are meaningful canaries here.
    const surface = [
      JSON.stringify(sb.session.getGameState()),
      JSON.stringify(sb.session.gameStatus()),
      JSON.stringify(sb.session.getMomentPrompt({})),
    ].join("|");
    for (const v of [afterThreat, rel.edge(a, PLAYER).trust]) {
      if (String(v).length > 6) expect(surface.includes(String(v))).toBe(false);
    }
  });

  it("a competition win raises the house's hidden threat toward the winner", () => {
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor("u");
    sb.session.createCharacter({ playerName: "P", seed: 4 });
    const rel = sb.engine.relationships;

    // The first beat is the HOH competition — preview the winner (B37), then resolve and check the fold.
    const winner = sb.session.runCompetition({}).winner!.id;
    const onlooker = sb.session.getGameState().house.find((h) => h.id !== winner)!.id;
    const before = rel.edge(onlooker, winner).threat;

    sb.session.advanceGame(); // B46: comp-intent pause
    const adv = sb.session.submitDecision({ kind: "comp-intent", intent: "compete" }); // resolve the HOH comp
    expect(adv.event!.beat).toBe("hoh-competition");
    expect(rel.edge(onlooker, winner).threat).toBeGreaterThan(before); // they read the new HOH as dangerous
  });

  it("every ceremony magnitude comes only from the constants module (no inline numbers)", () => {
    // CEREMONY_IMPACTS maps each act to a NAMED impact object whose magnitudes live in the module.
    for (const impact of Object.values(CEREMONY_IMPACTS)) {
      expect(Object.keys(impact).length).toBeGreaterThan(0);
      for (const v of Object.values(impact)) expect(typeof v).toBe("number");
    }
    // The acts cover the loop's consequential moves.
    expect(Object.keys(CEREMONY_IMPACTS).sort()).toEqual(["comp-won", "evicted", "nominated", "replaced", "veto-saved"]);
  });

  it("a comp win is a THREAT read only (audit E47) — the house does not stop liking its winner", () => {
    const impact = CEREMONY_IMPACTS["comp-won"];
    expect(impact.threat ?? 0).toBeGreaterThan(0);
    // No souring: winning must not cost the winner warmth or trust from anyone.
    expect(impact.affinity ?? 0).toBe(0);
    expect(impact.trust ?? 0).toBe(0);
    expect(RELATIONSHIP_CONSTANTS.IMPACT.conflict.affinity).toBeLessThan(0); // the old (wrong) mapping
  });
});
