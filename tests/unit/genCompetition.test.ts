import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { PLAYER, npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { RelationshipModel } from "../../src/engine/relationships";
import type { Stats } from "../../src/engine/season";
import {
  newLiveSeason, advance, applyDecision, validateCompetitionFiction, competitionStagingData,
  type LiveSeasonState, type SeasonCtx, type BeatEvent, type CompetitionFictionInput,
} from "../../src/engine/liveSeason";

/**
 * Feature #1400 — GENERATIVE COMPETITION DESIGN: the model DRESSES the engine's fixed roll. This is the
 * engine-side proof that the presentation-only fiction is OUTCOME-NEUTRAL: injecting VALIDATED model
 * fiction at every competition (the flag-ON path) produces a BYTE-IDENTICAL competition-outcome stream
 * (every winner, every fixed drop order, the whole eviction order, the crown) to the vanilla flag-OFF
 * path — while the per-round `comp-elimination` PROSE is the only thing that changes. The `dropOrder`
 * bright-line validator is proven to REJECT any fiction that renames who goes or reorders them. HARD
 * rule: roles only — no names.
 */

/** A seeded house: balanced stats + a seeded relationship graph (IDENTICAL inputs feed both runs). */
function buildHouse(size: number, seed: number): { active: EntityId[]; statsOf: (id: EntityId) => Stats; rel: () => RelationshipModel } {
  const rng = new SeededRandom(seed);
  const active: EntityId[] = [PLAYER, ...Array.from({ length: size - 1 }, (_, i) => npc(i + 1))];
  const stats = new Map<EntityId, Stats>();
  for (const id of active) stats.set(id, { physical: rng.next(), mental: rng.next(), social: rng.next() });
  const edges = new Map<string, { trust: number; affinity: number; threat: number }>();
  for (const a of active) for (const b of active) {
    if (a === b) continue;
    edges.set(`${a}|${b}`, { trust: rng.next(), affinity: rng.next(), threat: rng.next() });
  }
  const freshRel = (): RelationshipModel => {
    const rel = new RelationshipModel(0.5);
    for (const a of active) for (const b of active) {
      if (a === b) continue;
      const e = rel.edge(a, b);
      const seeded = edges.get(`${a}|${b}`)!;
      e.trust = seeded.trust; e.affinity = seeded.affinity; e.threat = seeded.threat; e.confidence = 0.5;
    }
    return rel;
  };
  return { active, statsOf: (id) => stats.get(id)!, rel: freshRel };
}

interface Capture {
  /** `${comp}|${winner}|${dropOrder}` for each competition that resolved — the seeded competition-outcome stream. */
  compOutcomes: string[];
  /** WHO dropped each staged round (the comp-elimination participants) — must be identical OFF vs ON. */
  dropParticipants: string[];
  /** The per-round drop PROSE — this is what the fiction changes (OFF: template · ON: model fiction). */
  elimContents: string[];
  evictionOrder: EntityId[];
  winner: EntityId | undefined;
  finalTwo: EntityId[] | undefined;
}

/**
 * Author matching fiction for the current staged comp (once, when its roll has committed): one line per
 * `dropOrder` entry, IN ORDER — the shape a well-behaved FE producer returns. Validated through the real
 * `validateCompetitionFiction` gate before it is stored, so this test authors nothing the engine would reject.
 */
function authorFiction(s: LiveSeasonState): void {
  const c = s.competition;
  if (!c || c.winner === undefined || c.dropOrder === undefined || s.competitionFiction) return;
  const req: CompetitionFictionInput = {
    comp: c.comp, week: s.week,
    theme: `The Themed ${c.comp} of Week ${s.week}`,
    premise: `A wholly invented staging for the ${c.comp}.`,
    winReads: "sheer refusal to fold",
    eliminations: c.dropOrder.map((id, i) => ({ id, fiction: `${id} is written out of the fiction in beat ${i + 1}.` })),
  };
  const v = validateCompetitionFiction(s, req);
  if (!v.ok) throw new Error(`test authored fiction the engine rejected: ${v.reason}`);
  s.competitionFiction = v.fiction;
}

/** Drive a SHORT-but-COMPLETE seeded game, optionally injecting VALIDATED fiction at each comp. */
function play(active: EntityId[], ctx: SeasonCtx, seed: number, withFiction: boolean): Capture {
  const s = newLiveSeason(active);
  const rng = new SeededRandom(seed);
  const cap: Capture = { compOutcomes: [], dropParticipants: [], elimContents: [], evictionOrder: [], winner: undefined, finalTwo: undefined };
  let lastCompKey = "";
  const observe = (ev: BeatEvent | null): void => {
    const c = s.competition;
    if (c && c.winner !== undefined && c.dropOrder !== undefined) {
      const key = `${s.week}:${c.comp}:${c.winner}`;
      if (key !== lastCompKey) { cap.compOutcomes.push(`${c.comp}|${c.winner}|${c.dropOrder.join(",")}`); lastCompKey = key; }
      if (withFiction) authorFiction(s);
    }
    if (ev?.beat === "comp-elimination") {
      cap.dropParticipants.push(ev.participants.join(","));
      cap.elimContents.push(ev.content);
    }
  };
  for (let guard = 0; guard < 20_000 && !s.finished; guard++) {
    let ev: BeatEvent | null = null;
    if (s.pending) {
      const p = s.pending;
      if (p.kind === "comp-round" || p.kind === "comp-intent") ev = applyDecision(s, { kind: p.kind, intent: "compete" }, ctx, rng);
      else if (p.kind === "nominations") ev = applyDecision(s, { kind: "nominations", choice: [p.options[0]!, p.options[1]!] }, ctx, rng);
      else if (p.kind === "veto-decision") ev = applyDecision(s, { kind: "veto-decision", use: false }, ctx, rng);
      else if (p.kind === "replacement") ev = applyDecision(s, { kind: "replacement", replacement: p.options[0]! }, ctx, rng);
      else if (p.kind === "eviction-vote") ev = applyDecision(s, { kind: "eviction-vote", vote: p.nominees[0] }, ctx, rng);
      else if (p.kind === "tie-break") ev = applyDecision(s, { kind: "tie-break", evict: p.nominees[0] }, ctx, rng);
      else if (p.kind === "final-eviction") ev = applyDecision(s, { kind: "final-eviction", evict: p.options[0]! }, ctx, rng);
      else if (p.kind === "houseguests-choice") ev = applyDecision(s, { kind: "houseguests-choice", pick: p.options[0]! }, ctx, rng);
      else if (p.kind === "goodbye-message") ev = applyDecision(s, { kind: "goodbye-message", tone: p.tones[0]! }, ctx, rng);
      else if (p.kind === "finale-statement") ev = applyDecision(s, { kind: "finale-statement", statement: "" }, ctx, rng);
      else if (p.kind === "finale-answer") ev = applyDecision(s, { kind: "finale-answer", appeal: p.appeals[0]! }, ctx, rng);
      else if (p.kind === "juror-question") ev = applyDecision(s, { kind: "juror-question", question: "" }, ctx, rng);
      else if (p.kind === "juror-vote") ev = applyDecision(s, { kind: "juror-vote", vote: p.finalists[0] }, ctx, rng);
      else throw new Error(`unhandled pending ${p.kind}`);
    } else {
      ev = advance(s, ctx, rng);
    }
    observe(ev);
  }
  cap.evictionOrder = [...s.evictionOrder];
  cap.winner = s.winner;
  cap.finalTwo = s.finalTwo ? [...s.finalTwo] : undefined;
  return cap;
}

function outcomeDigest(c: Capture): string {
  return createHash("sha256").update(JSON.stringify({
    compOutcomes: c.compOutcomes, evictionOrder: c.evictionOrder, winner: c.winner, finalTwo: c.finalTwo,
  })).digest("hex");
}

describe("#1400 — generative competition fiction is OUTCOME-NEUTRAL (SHA256 stream OFF vs ON)", () => {
  for (const size of [5, 8, 12]) {
    for (const seed of [1, 2, 3, 7, 13, 42]) {
      it(`size ${size}, seed ${seed}: the competition-outcome stream is byte-identical with fiction OFF vs ON`, () => {
        const h = buildHouse(size, seed);
        const off = play(h.active, { player: PLAYER, statsOf: h.statsOf, rel: h.rel() }, seed, false);
        const on = play(h.active, { player: PLAYER, statsOf: h.statsOf, rel: h.rel() }, seed, true);

        // A real, multi-competition game was played (guards against a trivially-empty pass).
        expect(off.winner, "OFF must crown a winner").toBeDefined();
        expect(off.compOutcomes.length, "several competitions resolved").toBeGreaterThan(3);

        // THE PROOF: identical winners, identical FIXED drop orders, identical eviction order + crown.
        expect(outcomeDigest(on), "SHA256 competition-outcome stream must match OFF vs ON").toBe(outcomeDigest(off));
        // And WHO drops each staged round is byte-identical — the fiction never reorders the field.
        expect(on.dropParticipants, "the per-round drop participants must be identical").toEqual(off.dropParticipants);
      });
    }
  }

  it("with fiction ON, the per-round drop PROSE actually changed (the feature is wired, not a no-op)", () => {
    const h = buildHouse(12, 7);
    const off = play(h.active, { player: PLAYER, statsOf: h.statsOf, rel: h.rel() }, 7, false);
    const on = play(h.active, { player: PLAYER, statsOf: h.statsOf, rel: h.rel() }, 7, true);
    expect(on.elimContents.length).toBeGreaterThan(0);
    // At least one comp-elimination beat now reads the model's fiction instead of the deterministic template.
    expect(on.elimContents).not.toEqual(off.elimContents);
    expect(on.elimContents.some((c) => c.includes("written out of the fiction"))).toBe(true);
  });
});

// --- The HARD drop-order validator — the whole safety property ---------------------------------------

/** Drive a live season to a RESOLVED HOH competition (winner + dropOrder fixed) for validator tests. */
function resolvedHohSeason(size: number, seed: number): { s: LiveSeasonState; dropOrder: EntityId[] } {
  const h = buildHouse(size, seed);
  const ctx: SeasonCtx = { player: PLAYER, statsOf: h.statsOf, rel: h.rel() };
  const s = newLiveSeason(h.active);
  const rng = new SeededRandom(seed);
  advance(s, ctx, rng); // pauses for the up-front approach
  if (s.pending?.kind === "comp-round" || s.pending?.kind === "comp-intent") {
    applyDecision(s, { kind: "comp-round", intent: "compete" }, ctx, rng); // resolves + begins staging
  }
  const data = competitionStagingData(s);
  if (!data) throw new Error("expected a resolved HOH competition");
  return { s, dropOrder: data.dropOrder };
}

function baseReq(s: LiveSeasonState, dropOrder: EntityId[]): CompetitionFictionInput {
  return {
    comp: s.competition!.comp, week: s.week, theme: "A Theme", premise: "A premise.",
    eliminations: dropOrder.map((id) => ({ id, fiction: `${id} bows out.` })),
  };
}

describe("#1400 — validateCompetitionFiction is the hard drop-order gate", () => {
  it("ACCEPTS fiction whose eliminations match the fixed drop order EXACTLY (and sanitizes it)", () => {
    const { s, dropOrder } = resolvedHohSeason(10, 3);
    const v = validateCompetitionFiction(s, baseReq(s, dropOrder));
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.fiction.eliminations.map((e) => e.id)).toEqual(dropOrder);
      expect(v.fiction.theme).toBe("A Theme");
    }
  });

  it("REJECTS a REORDERED drop order (renaming when who goes) — the core safety reject", () => {
    const { s, dropOrder } = resolvedHohSeason(10, 3);
    if (dropOrder.length < 2) return; // needs at least two drops to reorder
    const reordered = [dropOrder[1]!, dropOrder[0]!, ...dropOrder.slice(2)];
    const req = { ...baseReq(s, dropOrder), eliminations: reordered.map((id) => ({ id, fiction: `${id} out.` })) };
    const v = validateCompetitionFiction(s, req);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("drop-order-mismatch");
  });

  it("REJECTS a RENAMED elimination (an id not in the drop order)", () => {
    const { s, dropOrder } = resolvedHohSeason(10, 3);
    const renamed = [...dropOrder];
    renamed[0] = npc(999); // a houseguest who never dropped (indeed never existed)
    const req = { ...baseReq(s, dropOrder), eliminations: renamed.map((id) => ({ id, fiction: `${id} out.` })) };
    const v = validateCompetitionFiction(s, req);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("drop-order-mismatch");
  });

  it("REJECTS a wrong COUNT (missing or extra eliminations)", () => {
    const { s, dropOrder } = resolvedHohSeason(10, 3);
    const short = { ...baseReq(s, dropOrder), eliminations: dropOrder.slice(1).map((id) => ({ id, fiction: `${id} out.` })) };
    expect(validateCompetitionFiction(s, short).ok).toBe(false);
    const long = { ...baseReq(s, dropOrder), eliminations: [...dropOrder, npc(998)].map((id) => ({ id, fiction: `${id} out.` })) };
    expect(validateCompetitionFiction(s, long).ok).toBe(false);
  });

  it("REJECTS an empty fiction line, an empty theme, or an empty premise", () => {
    const { s, dropOrder } = resolvedHohSeason(10, 3);
    const noFiction = { ...baseReq(s, dropOrder), eliminations: dropOrder.map((id) => ({ id, fiction: "  " })) };
    expect(validateCompetitionFiction(s, noFiction)).toMatchObject({ ok: false, reason: "empty-fiction" });
    expect(validateCompetitionFiction(s, { ...baseReq(s, dropOrder), theme: "" })).toMatchObject({ ok: false, reason: "empty-fiction" });
    expect(validateCompetitionFiction(s, { ...baseReq(s, dropOrder), premise: "" })).toMatchObject({ ok: false, reason: "empty-fiction" });
  });

  it("REJECTS a comp/week mismatch (a stale write-back never dresses the wrong comp)", () => {
    const { s, dropOrder } = resolvedHohSeason(10, 3);
    expect(validateCompetitionFiction(s, { ...baseReq(s, dropOrder), comp: "veto-competition" })).toMatchObject({ ok: false, reason: "comp-mismatch" });
    expect(validateCompetitionFiction(s, { ...baseReq(s, dropOrder), week: s.week + 5 })).toMatchObject({ ok: false, reason: "week-mismatch" });
  });

  it("REJECTS when no competition is staging (nothing resolved to dress)", () => {
    const s = newLiveSeason([PLAYER, npc(1), npc(2), npc(3), npc(4)]);
    const v = validateCompetitionFiction(s, { comp: "hoh-competition", week: 1, theme: "t", premise: "p", eliminations: [] });
    expect(v).toMatchObject({ ok: false, reason: "no-competition" });
  });

  it("REJECTS a SECOND write for an already-authored comp (engine-side exactly-once), leaving the first stored", () => {
    const { s, dropOrder } = resolvedHohSeason(10, 3);
    const first = validateCompetitionFiction(s, baseReq(s, dropOrder));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    s.competitionFiction = first.fiction; // the adapter stores it here
    const firstTheme = s.competitionFiction.theme;
    // A perfectly VALID second write (correct drop order) is still refused — authoring is once per comp.
    const second = validateCompetitionFiction(s, { ...baseReq(s, dropOrder), theme: "A DIFFERENT theme" });
    expect(second).toMatchObject({ ok: false, reason: "already-authored" });
    // The stored fiction is UNCHANGED (the validator never mutates; the adapter never reassigns on reject).
    expect(s.competitionFiction.theme).toBe(firstTheme);
  });
});
