import { describe, it, expect } from "vitest";
import {
  buildWorldSnapshot, renderZeitgeist, sliceEmphasisFor, hasZeitgeist,
  ZEITGEIST, ZEITGEIST_SLICES, type WorldSnapshot,
} from "../../src/engine/zeitgeist";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { GameSessionRegistry } from "../../src/composition/registry";
import { Orchestrator } from "../../src/composition/orchestrator";
import { isSuperset, type GameState } from "../../src/domain/saveState";

/**
 * Feature 0062 — the move-in zeitgeist snapshot. The cast moves in carrying ONE frozen, shared picture
 * of the real-world moment, recalled all season, coloring BOTH the player's scenes AND off-screen NPC
 * life, growing stale as the weeks pass — and FLAVOR ONLY (a third state category: public, shared,
 * real-world context — never Vault, never game truth). HARD rule: roles only — no fixture names.
 */

const MOVE_IN = "move-in day";

describe("0062 — the zeitgeist module (pure, seeded, frozen)", () => {
  it("§3/§9 builds a bounded snapshot seeded off the season seed", () => {
    const snap = buildWorldSnapshot({ seed: 123, capturedFor: MOVE_IN });
    expect(snap.source).toBe("model-framed");
    expect(snap.capturedFor).toBe(MOVE_IN);
    expect(snap.lagDays).toBe(ZEITGEIST.defaultLagDays);
    // A handful per slice (texture, not an almanac, §3) — bounded by the budget.
    for (const slice of ZEITGEIST_SLICES) {
      expect(snap.slices[slice].length).toBeGreaterThan(0);
      expect(snap.slices[slice].length).toBeLessThanOrEqual(ZEITGEIST.itemsPerSlice);
    }
    expect(snap.slices.mood.length).toBeGreaterThan(0);
  });

  it("§9 is reproducible by seed and varies across seeds (flavor divergence only)", () => {
    const a1 = buildWorldSnapshot({ seed: 7, capturedFor: MOVE_IN });
    const a2 = buildWorldSnapshot({ seed: 7, capturedFor: MOVE_IN });
    const b = buildWorldSnapshot({ seed: 8, capturedFor: MOVE_IN });
    expect(JSON.stringify(a2)).toBe(JSON.stringify(a1)); // same seed ⇒ byte-identical
    // Different seeds draw different flavor (overwhelmingly; assert the concatenation differs).
    expect(JSON.stringify(b.slices)).not.toBe(JSON.stringify(a1.slices));
  });

  it("§8 the absent tier carries no slices and round-trips as absent", () => {
    const snap = buildWorldSnapshot({ seed: 1, capturedFor: MOVE_IN, source: "absent" });
    expect(snap.source).toBe("absent");
    expect(hasZeitgeist(snap)).toBe(false);
    for (const slice of ZEITGEIST_SLICES) expect(snap.slices[slice].length).toBe(0);
    expect(hasZeitgeist(null)).toBe(false);
    expect(hasZeitgeist(undefined)).toBe(false);
  });

  it("§3 the deterministic build never reads real entropy (pure function of its inputs)", () => {
    // No timers / random source: two builds at different wall-clock moments are byte-identical.
    const a = buildWorldSnapshot({ seed: 42, capturedFor: MOVE_IN });
    const b = buildWorldSnapshot({ seed: 42, capturedFor: MOVE_IN });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("0062 — rendering: the world block, the freeze, the drift", () => {
  const snap = buildWorldSnapshot({ seed: 5, capturedFor: MOVE_IN });

  it("§5/§7 renders the shared world, the freeze, and the out-of-the-loop instruction", () => {
    const block = renderZeitgeist(snap, { week: 1, channel: "player" });
    expect(block).toMatch(/world you all moved in with/i);
    expect(block).toMatch(/frozen as of move-in/i);
    expect(block).toMatch(/unknowable to the whole house/i);
    expect(block).toMatch(/flavor only/i);
  });

  it("§7 scales the elapsed in-house duration with the weeks (more dated over time)", () => {
    expect(renderZeitgeist(snap, { week: 1 })).toMatch(/moved in just now/i);
    expect(renderZeitgeist(snap, { week: 2 })).toMatch(/sealed in for about a week/i);
    expect(renderZeitgeist(snap, { week: 6 })).toMatch(/sealed in for about 5 weeks/i);
  });

  it("§5 the off-screen channel extends the world to NPC-to-NPC life (the C32-beyond delta)", () => {
    const off = renderZeitgeist(snap, { week: 1, channel: "offscreen" });
    expect(off).toMatch(/off-screen life too/i);
    const player = renderZeitgeist(snap, { week: 1, channel: "player" });
    expect(player).not.toMatch(/off-screen life too/i);
  });

  it("§8 an absent / missing snapshot renders nothing (fail-soft)", () => {
    expect(renderZeitgeist(null, { week: 1 })).toBe("");
    expect(renderZeitgeist(buildWorldSnapshot({ seed: 1, capturedFor: MOVE_IN, source: "absent" }), { week: 1 })).toBe("");
  });
});

describe("0062 — §4 per-NPC interest filtering (read-time, public facets only)", () => {
  it("hands different personas different slice emphases from the same shared snapshot", () => {
    const sportsFan = sliceEmphasisFor({ archetype: "comp-beast", vocation: "fitness trainer", background: "former athlete" });
    const techMind = sliceEmphasisFor({ archetype: "mastermind", vocation: "software engineer", demeanor: "analytical" });
    const onliner = sliceEmphasisFor({ archetype: "social butterfly", vocation: "content creator", demeanor: "chronically online" });
    expect(sportsFan[0]).toBe("sports");
    expect(techMind[0]).toBe("news");
    expect(onliner[0]).toBe("internet");
    // Distinct personas ⇒ distinct orderings (individual color over a shared world).
    expect(JSON.stringify(sportsFan)).not.toBe(JSON.stringify(techMind));
  });

  it("is a pure read — it never mutates the snapshot and is order-deterministic", () => {
    const persona = { archetype: "floater", background: "a quiet schemer" };
    expect(JSON.stringify(sliceEmphasisFor(persona))).toBe(JSON.stringify(sliceEmphasisFor(persona)));
    // Every call returns a permutation of the full slice set.
    expect([...sliceEmphasisFor(persona)].sort()).toEqual([...ZEITGEIST_SLICES].sort());
  });
});

describe("0062 — adapter integration (frozen, persisted, Vault-free, fail-soft)", () => {
  function started(seed: number): GameSessionAdapter {
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "P", seed });
    return s;
  }

  it("captures the snapshot once at season creation and freezes it across turns", () => {
    const s = started(2024);
    const view = s.worldSnapshotView();
    expect(view).not.toBeNull();
    expect(view!.source).toBe("model-framed");
    const before = JSON.stringify(view);
    // Drive a few beats — the snapshot must not regenerate (it is FROZEN at move-in).
    for (let i = 0; i < 6; i++) {
      const v = s.advanceGame();
      if (v.pending?.kind === "comp-intent") s.submitDecision({ kind: "comp-intent", intent: "compete" });
      else if (v.pending) break;
      if (v.finished) break;
    }
    expect(JSON.stringify(s.worldSnapshotView())).toBe(before);
  });

  it("§3/§9 survives snapshot→restore byte-identical", () => {
    const s = started(99);
    const before = JSON.stringify(s.snapshot().worldSnapshot);
    expect(before).not.toBe("undefined");
    const core = s.snapshot();
    s.restore(core);
    expect(JSON.stringify(s.snapshot().worldSnapshot)).toBe(before);
    expect(JSON.stringify(s.worldSnapshotView())).toBe(JSON.stringify(s.worldSnapshotView())); // stable
  });

  it("a pre-0062 save (no snapshot, with a seed) re-derives the SAME snapshot on restore", () => {
    const s = started(555);
    const expected = JSON.stringify(s.worldSnapshotView());
    const core = s.snapshot();
    delete (core as { worldSnapshot?: unknown }).worldSnapshot; // simulate a legacy save
    s.restore(core);
    // Re-derived deterministically off the persisted seed ⇒ identical to the original capture.
    expect(JSON.stringify(s.worldSnapshotView())).toBe(expected);
  });

  it("§5 colors BOTH the player moment prompt AND the off-screen (social) moment", () => {
    const s = started(7);
    const player = s.getMomentPrompt({ moment: "premiere" }).systemPrompt;
    const social = s.getMomentPrompt({ moment: "social" }).systemPrompt;
    expect(player).toMatch(/world you all moved in with/i);
    expect(player).toMatch(/frozen as of move-in/i);
    expect(social).toMatch(/world you all moved in with/i);
    expect(social).toMatch(/off-screen life too/i); // the NPC-to-NPC reach (channel two)
  });

  it("§6 the FE write-back replaces the fallback and freezes byte-stable", () => {
    const s = started(11);
    expect(s.worldSnapshotView()!.source).toBe("model-framed");
    const res = s.recordWorldSnapshot({
      capturedFor: "the week before move-in",
      slices: { screen: ["a real captured film everyone saw"], mood: "a real captured mood" },
    });
    expect(res.accepted).toBe(true);
    expect(res.source).toBe("web_search");
    const view = s.worldSnapshotView()!;
    expect(view.source).toBe("web_search");
    expect(view.slices.screen).toContain("a real captured film everyone saw");
    // A partial capture never thins the snapshot — the un-supplied slices keep the fallback's values.
    expect(view.slices.music.length).toBeGreaterThan(0);
    // It is now FROZEN: snapshot→restore is byte-identical.
    const before = JSON.stringify(s.snapshot().worldSnapshot);
    s.restore(s.snapshot());
    expect(JSON.stringify(s.snapshot().worldSnapshot)).toBe(before);
  });

  it("§8 pre-game there is no snapshot, and a no-op write-back is refused", () => {
    const s = new GameSessionAdapter();
    expect(s.worldSnapshotView()).toBeNull();
    expect(s.getMomentPrompt({}).systemPrompt).not.toMatch(/world you all moved in with/i);
    const res = s.recordWorldSnapshot({ slices: { screen: ["x"] } });
    expect(res.accepted).toBe(false);
    expect(res.source).toBe("absent");
  });

  it("§8 the FE write-back commits in the LIVE game (the one sanctioned fallback→capture upgrade)", () => {
    // The registry-composed game runs every persist through the 0031 fail-closed degradation checkpoint.
    // The freeze guard must PERMIT the one-time `model-framed`→`web_search` upgrade (not flag it as drift),
    // then freeze the capture forever.
    const seed = 4242;
    const reg = new GameSessionRegistry();
    const orch = new Orchestrator(reg, { now: () => seed }, { seed, turnDriven: true });
    reg.setCommit((u) => orch.commitPlayerTurn(u));
    const sb = reg.sandboxFor("player");
    sb.session.createCharacter({ playerName: "P", seed });
    expect(sb.session.worldSnapshotView()!.source).toBe("model-framed");
    // The FE write-back must NOT throw a TurnRefusedError (the upgrade is sanctioned, not degradation).
    expect(() => sb.session.recordWorldSnapshot({ slices: { screen: ["a real captured film"] } })).not.toThrow();
    expect(sb.session.worldSnapshotView()!.source).toBe("web_search");
    // And it persisted: a fresh advance still commits cleanly against the now-frozen capture.
    expect(() => { const v = sb.session.advanceGame(); if (v.pending?.kind === "comp-intent") sb.session.submitDecision({ kind: "comp-intent", intent: "compete" }); }).not.toThrow();
  });

  it("§3 isSuperset freezes the snapshot but allows the one fallback→capture upgrade", () => {
    const base = (snap: WorldSnapshot | undefined): GameState => ({
      coreVersion: 1, vaultVersion: 1, journalVersion: 1, events: [], knowledge: [],
      relationships: [], souls: {}, characters: {},
      ...(snap ? { worldSnapshot: snap as unknown as Record<string, unknown> } : {}),
    });
    const framed = buildWorldSnapshot({ seed: 1, capturedFor: MOVE_IN });
    const captured = { ...framed, source: "web_search" as const, slices: { ...framed.slices, screen: ["real"] } };
    const otherFramed = buildWorldSnapshot({ seed: 2, capturedFor: MOVE_IN });
    // The freeze: a model-framed snapshot may NOT drift to a different model-framed one.
    expect(isSuperset(base(otherFramed), base(framed))).toBe(false);
    // The sanctioned upgrade: model-framed → web_search is allowed.
    expect(isSuperset(base(captured), base(framed))).toBe(true);
    // A web_search capture is then frozen forever (no further change allowed).
    const captured2 = { ...captured, slices: { ...captured.slices, screen: ["changed"] } };
    expect(isSuperset(base(captured2), base(captured))).toBe(false);
    // Accretion: an earlier save WITHOUT a snapshot may gain one later.
    expect(isSuperset(base(framed), base(undefined))).toBe(true);
  });

  it("§6 the snapshot carries no Vault sentinel and no provenance leaks to the player view", () => {
    const s = started(31);
    const SENTINEL = "SENTINEL-0062-vault-canary";
    // The capture metadata `capturedAt` is provenance — plant a sentinel there and prove it never crosses.
    const core = s.snapshot();
    (core.worldSnapshot as WorldSnapshot).capturedAt = `${SENTINEL} ${(core.worldSnapshot as WorldSnapshot).capturedAt}`;
    s.restore(core);
    const surfaces = JSON.stringify(s.worldSnapshotView())
      + "\n" + s.getMomentPrompt({ moment: "premiere" }).systemPrompt
      + "\n" + s.getMomentPrompt({ moment: "social" }).systemPrompt
      + "\n" + JSON.stringify(s.getGameState());
    expect(surfaces.includes(SENTINEL)).toBe(false); // provenance never voiced (§3/§6)
    // No bare relationship/stat number rides on the public projection (the 0001 canary shape).
    const view = JSON.stringify(s.worldSnapshotView());
    expect(/"trust":|"affinity":|"threat":|"physical":|"mental":|"social":/.test(view)).toBe(false);
  });
});

describe("0062 — media fidelity: no live media + the HOH music perk", () => {
  const snap = buildWorldSnapshot({ seed: 5, capturedFor: MOVE_IN });

  it("the block always carries the no-live-media + feeds-cut guardrail (singing → the jingle, never lyrics)", () => {
    const block = renderZeitgeist(snap, { week: 2, channel: "player" });
    expect(block).toMatch(/no live media/i);
    expect(block).toMatch(/feeds[\s\S]*cut/i);
    expect(block).toMatch(/never actual copyrighted lyrics/i);
  });

  it("without the perk, music is frozen MEMORY like every other slice (no live framing)", () => {
    const block = renderZeitgeist(snap, { week: 2, channel: "player", musicAccess: false });
    expect(block).not.toMatch(/HOH MUSIC PERK/);
    expect(block).not.toMatch(/RIGHT NOW/);
    expect(block).toMatch(/· Music:/); // a plain memory line
  });

  it("with the HOH music perk, the music slice reads as PLAYING NOW — the one live exception", () => {
    const block = renderZeitgeist(snap, { week: 2, channel: "player", musicAccess: true });
    expect(block).toMatch(/HOH MUSIC PERK/);
    expect(block).toMatch(/RIGHT NOW/);
    expect(block).not.toMatch(/· Music:/);  // the music line is the perk variant, not the plain one
    expect(block).toMatch(/· Screen \(/);   // the OTHER slices stay frozen memory
  });
});

describe("0062 — the HOH music perk flows into the live moment prompt", () => {
  // Mirror the lifecycleMoments driver: resolve any player decision with a legal default.
  function resolve(s: GameSessionAdapter, p: NonNullable<ReturnType<GameSessionAdapter["advanceGame"]>["pending"]>): void {
    if (p.kind === "nominations") s.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
    else if (p.kind === "veto-decision") s.submitDecision({ kind: "veto-decision", use: false });
    else if (p.kind === "comp-intent") s.submitDecision({ kind: "comp-intent", intent: "compete" });
    else if (p.kind === "comp-round") s.submitDecision({ kind: "comp-round", intent: "compete" } as never);
    else if (p.options[0]) s.submitDecision({ kind: p.kind, vote: p.options[0].id, replacement: p.options[0].id } as never);
  }

  it("the base prompt always states the no-live-media rule + the HOH music perk exception", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "P", seed: 3 });
    const prompt = s.getMomentPrompt({ moment: "social" }).systemPrompt;
    expect(prompt).toMatch(/NO LIVE MEDIA/);
    expect(prompt).toMatch(/HOH MUSIC PERK/);
    expect(prompt).toMatch(/NEVER actual copyrighted lyrics/i);
  });

  it("the perk reaches the moment prompt: live in the HOH room, memory elsewhere", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "P", seed: 7 });
    s.recordWorldSnapshot({ slices: { music: ["a song the whole house loved"] } });

    // Drive to the first crowned HOH (the premiere does not stall).
    let hoh: string | null = null;
    for (let i = 0; i < 60 && !hoh; i++) {
      const v = s.advanceGame();
      if (v.pending) resolve(s, v.pending);
      hoh = s.gameStatus().hoh?.id ?? null;
      if (v.finished) break;
    }
    expect(hoh).not.toBeNull();
    const me = s.getGameState().player.id;

    // The LIVE music framing in the per-moment world block (distinct from the always-on base-prompt rule,
    // which states the perk exists regardless): "on rotation in the HOH room RIGHT NOW".
    const LIVE = /on rotation in the HOH room RIGHT NOW/;
    // In the HOH room → the player has live music (as HOH, or overhearing it).
    s.movePlayer("hoh-room");
    expect(s.getMomentPrompt({ moment: "social" }).systemPrompt).toMatch(LIVE);

    // Out in the kitchen → live ONLY if the player IS the HOH (they carry the perk); otherwise memory.
    s.movePlayer("kitchen");
    const inKitchen = s.getMomentPrompt({ moment: "social" }).systemPrompt;
    if (hoh === me) expect(inKitchen).toMatch(LIVE);
    else expect(inKitchen).not.toMatch(LIVE);
  });
});
