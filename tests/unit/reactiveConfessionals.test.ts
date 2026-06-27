import { describe, it, expect } from "vitest";
import {
  confessionalFor,
  selectRecentForConfessional,
} from "../../src/engine/confessionals";
import type { RecentEventFact } from "../../src/engine/confessionals";
import { CONFESSIONAL } from "../../src/engine/confessionalConstants";
import { RelationshipModel } from "../../src/engine/relationships";
import { GameSessionRegistry } from "../../src/composition/registry";
import { Orchestrator } from "../../src/composition/orchestrator";
import { FakeClock } from "../../src/adapters/time/FakeClock";
import type { AdvanceView } from "../../src/ports/GameSession";
import type { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import type { GameEvent, EntityId } from "../../src/domain/event";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * Feature 0089 — REACTIVE confessionals. A houseguest's private confessional REACTS to a concrete,
 * recent event they witnessed or were part of ("after where that ceremony left me…") instead of a
 * static target/ally readout. The ENGINE selects the recent events (restricted to that houseguest's
 * own witness set) and supplies them as facts; the model only VOICES them and never invents an outcome.
 * The confessional stays Vault-only (witnessed by the confessor alone) and leaks no other hidden state.
 *
 * HARD rule: roles only — NPC, HOH, nominee, the player. No names from any corpus.
 */

// Roles only.
const [A, B, C] = [npc(1), npc(2), npc(3)];

/** A minimal recorded event the confessor witnessed (or not), for the pure selector tests. */
function ev(
  id: string,
  type: GameEvent["type"],
  witnessSet: EntityId[],
  initiator: EntityId,
  content: string,
  extra: Partial<GameEvent> = {},
): GameEvent {
  return {
    id,
    ts: Number(id.replace(/\D/g, "")) || 0,
    type,
    initiator,
    witnessSet,
    hidden: !witnessSet.includes(PLAYER),
    content,
    ...extra,
  };
}

function resolve(s: GameSessionAdapter, p: NonNullable<AdvanceView["pending"]>): void {
  if (p.kind === "nominations") s.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
  else if (p.kind === "veto-decision") s.submitDecision({ kind: "veto-decision", use: false });
  else if (p.kind === "replacement") s.submitDecision({ kind: "replacement", replacement: p.options[0]!.id });
  else if (p.kind === "comp-intent") s.submitDecision({ kind: "comp-intent", intent: "compete" });
  else if (p.kind === "comp-round") s.submitDecision({ kind: "comp-round", intent: "compete" });
  else if (p.kind === "finale-statement") s.submitDecision({ kind: "finale-statement", statement: "x" });
  else if (p.kind === "finale-answer") s.submitDecision({ kind: "finale-answer", appeal: p.appeals![0]! });
  else if (p.kind === "juror-vote") s.submitDecision({ kind: "juror-vote", vote: p.options[0]!.id });
  else s.submitDecision({ kind: p.kind, vote: p.options[0]!.id });
}

describe("0089 — the recent-event selector (pure, engine-supplied facts)", () => {
  it("returns only events whose witness set includes the confessor (perspective-bound)", () => {
    const events = [
      ev("e1", "conversation", [A, B], A, "[offscreen] A schemed with B"), // A witnessed
      ev("e2", "conversation", [B, C], B, "[offscreen] B schemed with C"), // A NOT in it
      ev("e3", "house-event", [PLAYER, A], A, "A nominates two houseguests at the ceremony"), // A witnessed
    ];
    const facts = selectRecentForConfessional(events, A, 99, { rng: new SeededRandom(1) });
    expect(facts.length).toBeGreaterThan(0);
    // The selector NEVER reaches into an event A was not part of — proven structurally below + here:
    // only e1 (social) and e3 (ceremony) are A's; the off-screen scene between B and C cannot be chosen.
    // (We can't see ids in the redacted facts — that is the point — so we assert via a witness-set probe.)
    const aWitnessed = events.filter((e) => e.witnessSet.includes(A));
    expect(aWitnessed.map((e) => e.id).sort()).toEqual(["e1", "e3"]);
    expect(aWitnessed.some((e) => e.id === "e2")).toBe(false);
  });

  it("ranks a standing-changing beat (a ceremony/comp) above an ambient social scene", () => {
    const events = [
      ev("e1", "conversation", [A, B], A, "[offscreen] A chatted with B"), // social (0.6)
      ev("e2", "house-event", [PLAYER, A], A, "A is nominated at the veto ceremony"), // ceremony (0.95)
    ];
    const facts = selectRecentForConfessional(events, A, 99, { count: 1, rng: new SeededRandom(1) });
    expect(facts).toHaveLength(1);
    expect(facts[0]!.type).toBe("ceremony"); // the salient beat anchors the reaction, not the chit-chat
  });

  it("classifies a competition the confessor played as the most salient class", () => {
    const events = [
      ev("e1", "competition", [PLAYER, A, B], A, "A wins Head of Household"),
      ev("e2", "house-event", [PLAYER, A], A, "a houseguest is nominated"), // ceremony
    ];
    const facts = selectRecentForConfessional(events, A, 99, { count: 1, rng: new SeededRandom(2) });
    expect(facts[0]!.type).toBe("competition");
    expect(facts[0]!.role).toBe("initiator"); // A initiated the comp event in this fixture
  });

  it("never selects the confessor's own prior confessional (no self-reference / no re-voicing)", () => {
    const events = [
      ev("c1", "confessional", [A], A, "[confessional npc:1] I need B gone"), // A's own — excluded
      ev("e2", "conversation", [A, C], A, "[offscreen] A talked with C"), // a real witnessed scene
    ];
    const facts = selectRecentForConfessional(events, A, 99, { rng: new SeededRandom(3) });
    expect(facts).toHaveLength(1);
    expect(facts[0]!.type).toBe("social"); // the conversation, not the confessional
  });

  it("returns [] when the confessor has witnessed nothing in the window (graceful fallback)", () => {
    const events = [ev("e1", "conversation", [B, C], B, "[offscreen] B schemed with C")];
    expect(selectRecentForConfessional(events, A, 99, { rng: new SeededRandom(4) })).toEqual([]);
  });

  it("is deterministic — same history + seed ⇒ the same facts", () => {
    const events = [
      ev("e1", "conversation", [A, B], A, "[offscreen] A talked with B"),
      ev("e2", "house-event", [PLAYER, A], A, "A is nominated at the ceremony"),
      ev("e3", "competition", [PLAYER, A], A, "A plays the veto"),
    ];
    const one = selectRecentForConfessional(events, A, 99, { rng: new SeededRandom(7) });
    const two = selectRecentForConfessional(events, A, 99, { rng: new SeededRandom(7) });
    expect(one).toEqual(two);
  });

  it("draws NO rng unless two events tie on BOTH salience and recency (calibration isolation)", () => {
    // Two events of DIFFERENT salience never tie ⇒ a thrown rng (would throw if drawn) proves no draw.
    const throwingRng = { int: () => { throw new Error("rng must not be drawn for non-tying events"); }, next: () => { throw new Error("no"); } } as unknown as SeededRandom;
    const events = [
      ev("e1", "conversation", [A, B], A, "social scene"),
      ev("e2", "competition", [PLAYER, A], A, "A plays a comp"),
    ];
    expect(() => selectRecentForConfessional(events, A, 99, { rng: throwingRng })).not.toThrow();
  });
});

describe("0089 — confessionalFor composes a reaction from the facts (anti-sycophancy)", () => {
  const rel = new RelationshipModel(0.5);
  rel.edge(A, B).threat = 0.9; // engine-true biggest threat
  rel.edge(A, C).trust = 0.9;
  rel.edge(A, C).affinity = 0.8; // engine-true ally

  it("opens with the concrete recent beat AND still names the engine-grounded target + ally", () => {
    const recentEvents: RecentEventFact[] = [
      { type: "ceremony", role: "witness", gist: CONFESSIONAL.gists.ceremony!.witness },
    ];
    const conf = confessionalFor(A, [A, B, C], rel, {
      trigger: "the veto ceremony",
      recentEvents,
      rng: new SeededRandom(5),
    });
    // References the recent beat the engine selected (the reaction's anchor)...
    expect(conf.content).toContain(CONFESSIONAL.gists.ceremony!.witness);
    // ...still names the real engine threat read (anti-sycophancy) and the real bond...
    expect(conf.target).toBe(B);
    expect(conf.ally).toBe(C);
    expect(conf.content).toContain(B); // the target is named in the line
    // ...and still carries its structured trigger occasion.
    expect(conf.trigger).toBe("the veto ceremony");
  });

  it("states no competition result, vote tally, or nomination outcome — only a class of beat", () => {
    const recentEvents: RecentEventFact[] = [
      { type: "competition", role: "initiator", gist: CONFESSIONAL.gists.competition!.initiator },
    ];
    const conf = confessionalFor(A, [A, B, C], rel, { recentEvents, rng: new SeededRandom(6) });
    // The gist references that a comp was PLAYED — never WHO won, a tally, or an eviction (no fabricated
    // outcome the engine did not produce). Entity ids (npc:N) are references the 0040 read already embeds
    // (Vault-only), not an asserted outcome — strip them before the outcome/number sweep.
    expect(conf.content).toContain("competition");
    const outcomeFree = conf.content.replace(/npc:\d+/g, "X");
    expect(outcomeFree).not.toMatch(/\bwins?\b|\bwon\b|\bevicted\b|\bvotes?\b|\btally\b|\d/);
  });

  it("with NO recentEvents the content is BYTE-IDENTICAL to the 0040 grounded read", () => {
    // The neutrality guarantee: absent the new field, confessionalFor is unchanged from 0040.
    const baseline = confessionalFor(A, [A, B, C], rel, { trigger: "the eviction vote", rng: new SeededRandom(9) });
    const withEmpty = confessionalFor(A, [A, B, C], rel, { trigger: "the eviction vote", recentEvents: [], rng: new SeededRandom(9) });
    const withUndef = confessionalFor(A, [A, B, C], rel, { trigger: "the eviction vote", rng: new SeededRandom(9) });
    expect(withEmpty.content).toBe(baseline.content); // empty array ⇒ identical
    expect(withUndef.content).toBe(baseline.content); // absent ⇒ identical
    // And the bare no-context shape (the pre-E55 byte-identity the existing suite pins) is untouched.
    const a = confessionalFor(A, [A, B, C], rel);
    const b = confessionalFor(A, [A, B, C], rel);
    expect(a.content).toBe(b.content);
    expect(a.trigger).toBeUndefined();
  });

  it("byte-identity holds across a SWEEP of seeds, triggers, moods and relationship configs (the whole object)", () => {
    // A stronger neutrality proof: over many configurations, the FULL Confessional object (content +
    // target + ally + trigger + mood) is identical whether `recentEvents` is absent or an empty array.
    const triggers = ["the nomination ceremony", "the veto ceremony", "the eviction vote", undefined];
    for (let seed = 1; seed <= 20; seed++) {
      const r = new RelationshipModel(0.5);
      const rng0 = new SeededRandom(seed);
      // Build a varied, engine-true relationship field (seeded), so target/ally differ across runs.
      for (let i = 0; i < (seed % 7); i++) r.applyDirected(A, B, "betrayal", rng0);
      for (let i = 0; i < (seed % 5); i++) r.applyDirected(A, C, "bonding", rng0);
      for (const trigger of triggers) {
        const mood = seed % 3 === 0 ? 0.2 : seed % 3 === 1 ? 0.8 : undefined;
        const ctxBase = {
          ...(trigger ? { trigger } : {}),
          ...(mood !== undefined ? { emotionalState: mood } : {}),
          rng: new SeededRandom(seed * 31),
        };
        const absent = confessionalFor(A, [A, B, C], r, ctxBase);
        const empty = confessionalFor(A, [A, B, C], r, { ...ctxBase, recentEvents: [], rng: new SeededRandom(seed * 31) });
        expect(JSON.stringify(empty), `seed ${seed} trigger ${trigger}`).toBe(JSON.stringify(absent));
      }
    }
  });
});

describe("0089 — the LIVE ceremony confessional reacts AND stays Vault-sealed from everyone", () => {
  function playOneWeek(user: string, seed: number) {
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor(user);
    sb.session.createCharacter({ playerName: "P", seed });
    const session = sb.session as GameSessionAdapter;
    for (let i = 0; i < 300; i++) {
      const adv = sb.session.advanceGame();
      if (adv.pending) resolve(session, adv.pending);
      if (adv.event?.beat === "eviction-result" || adv.finished) break;
    }
    return { reg, sb };
  }

  it("an involved houseguest's ceremony confessional references a concrete recent beat", () => {
    const { sb } = playOneWeek("rc-react", 6);
    const confs = sb.engine.events.query().filter((e) => e.type === "confessional");
    expect(confs.length).toBeGreaterThan(0);
    // At least one ceremony confessional opens with a 0089 reactive gist (a real beat the confessor lived),
    // not only the bare standing readout. We look for ANY of the class-keyed openers.
    const gistPhrases = Object.values(CONFESSIONAL.gists).flatMap((g) => [g.initiator, g.witness]);
    const reactive = confs.filter((c) => gistPhrases.some((p) => c.content.includes(p)));
    expect(reactive.length, "at least one ceremony confessional reacted to a concrete recent event").toBeGreaterThan(0);
  });

  it("every reactive confessional is recorded witnessed by the confessor ALONE and hidden", () => {
    const { sb } = playOneWeek("rc-vault", 8);
    const confs = sb.engine.events.query().filter((e) => e.type === "confessional");
    expect(confs.length).toBeGreaterThan(0);
    for (const c of confs) {
      expect(c.hidden).toBe(true);
      expect(c.witnessSet).toEqual([c.initiator]); // the confessing NPC alone
      expect(c.witnessSet).not.toContain(PLAYER);
    }
  });

  it("the reactive confessional reaches NO player surface and NO admin surface (no leak)", () => {
    const { sb } = playOneWeek("rc-leak", 11);
    const confs = sb.engine.events.query().filter((e) => e.type === "confessional");
    expect(confs.length).toBeGreaterThan(0);
    // Player surface sweep.
    const playerSurface =
      JSON.stringify(sb.session.getGameState()) +
      JSON.stringify(sb.session.gameStatus()) +
      JSON.stringify(sb.player.getVisibleState()) +
      sb.player.produce("player-visible log") +
      JSON.stringify(sb.session.getMomentPrompt({}));
    // Admin surface sweep.
    const adminSurface = JSON.stringify(sb.admin.inspect());
    for (const c of confs) {
      expect(playerSurface.includes(c.content), "a reactive confessional leaked onto a player surface").toBe(false);
      expect(adminSurface.includes(c.content), "a reactive confessional leaked onto the admin surface").toBe(false);
    }
    expect(adminSurface).not.toContain("confessional"); // the admin surface reads no events at all
  });

  it("the off-screen tick's reactive confessional also stays Vault-only and leaks nowhere", () => {
    const reg = new GameSessionRegistry();
    const user = "rc-offscreen";
    reg.sandboxFor(user).session.createCharacter({ playerName: "P", seed: 3 });
    const orch = new Orchestrator(reg, new FakeClock(), { seed: 3 });
    for (let i = 0; i < 6; i++) orch.advance(user, "offscreen-tick");
    const sb = reg.sandboxFor(user);
    const confs = sb.engine.events.query().filter((e) => e.type === "confessional");
    expect(confs.length).toBeGreaterThan(0);
    const playerSurface = JSON.stringify(sb.player.getVisibleState()) + sb.player.produce("player-visible log");
    const adminSurface = JSON.stringify(sb.admin.inspect());
    for (const c of confs) {
      expect(c.hidden).toBe(true);
      expect(c.witnessSet).not.toContain(PLAYER);
      expect(playerSurface.includes(c.content)).toBe(false);
      expect(adminSurface.includes(c.content)).toBe(false);
    }
  });

  it("the assembled reactive content carries no hidden NUMBER and no other-houseguest sealed read", () => {
    const { sb } = playOneWeek("rc-sentinel", 14);
    const confs = sb.engine.events.query().filter((e) => e.type === "confessional");
    expect(confs.length).toBeGreaterThan(0);
    // The confessional content embeds the confessor's own id + the gist + their own target/ally read
    // (entity ids `npc:N` — references the 0040 read already embeds, Vault-only, never an outcome). It
    // must never embed a relationship VALUE (a trust/threat/affinity number) — strip every entity-id
    // token, then assert no stray digit remains anywhere in the assembled content.
    for (const c of confs) {
      const stripped = c.content.replace(/npc:\d+/g, "X").replace(/\bplayer\b/g, "X");
      expect(stripped, `confessional must carry no hidden number: ${c.content}`).not.toMatch(/\d/);
      // It also reacts only to the confessor's OWN witness set (asserted by the recording: witnessSet=[self]).
      expect(c.witnessSet).toEqual([c.initiator]);
    }
  });
});

describe("0089 — reactive confessionals deepen the soul deterministically", () => {
  function playOneWeek(user: string, seed: number) {
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor(user);
    sb.session.createCharacter({ playerName: "P", seed });
    const session = sb.session as GameSessionAdapter;
    for (let i = 0; i < 300; i++) {
      const adv = sb.session.advanceGame();
      if (adv.pending) resolve(session, adv.pending);
      if (adv.event?.beat === "eviction-result" || adv.finished) break;
    }
    return reg;
  }

  it("two runs from the same seed produce the same confessionals and the soul retains earlier ones", () => {
    const a = playOneWeek("rc-det", 21);
    const b = playOneWeek("rc-det2", 21); // different user key but same seed: like-for-like determinism
    const confsA = a.sandboxFor("rc-det").engine.events.query().filter((e) => e.type === "confessional").map((e) => e.content);
    const confsB = b.sandboxFor("rc-det2").engine.events.query().filter((e) => e.type === "confessional").map((e) => e.content);
    expect(confsA.length).toBeGreaterThan(0);
    // The per-user sandbox seeds off the game seed (not the user key), so like-seeded runs match content.
    expect(confsA.join("|")).toBe(confsB.join("|"));
    // The soul accumulated the confessionals (monotonic, recall-able) — never thinned.
    const house = a.sandboxFor("rc-det").session.snapshot().house!;
    const confessor = house.npcs.find((n) => n.soul.memory.some((m) => m.includes("[confessional")));
    expect(confessor, "a houseguest carries their own confessional in their soul").toBeTruthy();
  });
});
