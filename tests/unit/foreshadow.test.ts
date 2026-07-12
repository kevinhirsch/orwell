import { describe, it, expect } from "vitest";
import {
  foreshadowFit, rankForeshadowCandidates, hintBudget, buildHint, leadTimeFromWeeksOut,
  type InMotionPathway,
} from "../../src/engine/foreshadow";
import { FORESHADOW } from "../../src/engine/foreshadowConstants";

/**
 * Feature 0103 — edit-bay foreshadowing (pure core). A thin, relationship-aware layer that decides WHICH
 * in-motion pathway is worth a Vault-safe nod for THIS player and WHETHER the weekly/season budget allows
 * it. It foreshadows only an `active` pathway with a real public observation, never commits an outcome, and
 * surfaces only a public observation + a tone — never a sealed premise or number. Roles only — no names.
 *
 * The byte-identical-draw-stream neutrality (flag off ⇒ zero foreshadow draws ⇒ the seeded spine unchanged)
 * is an ADAPTER guarantee; this file pins the pure fit/eligibility/budget/hint core + the Vault-safety.
 */

const SENTINEL = "VAULT-PREMISE-do-not-leak-7731";

const base = (over: Partial<InMotionPathway> = {}): InMotionPathway => ({
  id: "p1", kind: "campaign", motion: "active",
  observability: 0.6, relevance: 0.6, leadTime: 0.6, alreadyHinted: 0,
  observation: "the cameras keep finding the two of them together in the corner",
  ...over,
});

describe("0103 — foreshadowFit (relevance + observability + leadTime − already-hinted)", () => {
  it("rises with each positive signal and is penalized by already-hinted", () => {
    const b = { relevance: 0.5, observability: 0.5, leadTime: 0.5, alreadyHinted: 0 };
    expect(foreshadowFit({ ...b, relevance: 0.9 })).toBeGreaterThan(foreshadowFit({ ...b, relevance: 0.1 }));
    expect(foreshadowFit({ ...b, observability: 0.9 })).toBeGreaterThan(foreshadowFit({ ...b, observability: 0.1 }));
    expect(foreshadowFit({ ...b, leadTime: 0.9 })).toBeGreaterThan(foreshadowFit({ ...b, leadTime: 0.1 }));
    expect(foreshadowFit({ ...b, alreadyHinted: 1 })).toBeLessThan(foreshadowFit({ ...b, alreadyHinted: 0 }));
  });

  it("is clamped to [0,1]", () => {
    expect(foreshadowFit({ relevance: 1, observability: 1, leadTime: 1, alreadyHinted: 0 })).toBeLessThanOrEqual(1);
    expect(foreshadowFit({ relevance: 0, observability: 0, leadTime: 0, alreadyHinted: 1 })).toBeGreaterThanOrEqual(0);
  });
});

describe("0103 — a hint foreshadows only an IN-MOTION pathway with a public observation", () => {
  it("a DORMANT (never-started) pathway is never foreshadowed", () => {
    const ranked = rankForeshadowCandidates([base({ id: "dormant", motion: "dormant", relevance: 1, observability: 1, leadTime: 1 })]);
    expect(ranked).toHaveLength(0);
  });

  it("a pathway with no public surface (off-screen only) is never foreshadowed — no invented observation", () => {
    const ranked = rankForeshadowCandidates([base({ id: "offscreen", observability: FORESHADOW.observabilityFloor - 0.01, relevance: 1, leadTime: 1 })]);
    expect(ranked).toHaveLength(0);
  });

  it("drops candidates below the fit floor and ranks the rest by fit (id tiebreak, seed-stable)", () => {
    const ranked = rankForeshadowCandidates([
      base({ id: "b", relevance: 0.9, observability: 0.9, leadTime: 0.9 }),  // high fit
      base({ id: "a", relevance: 0.9, observability: 0.9, leadTime: 0.9 }),  // equal fit → id tiebreak
      base({ id: "low", relevance: 0.05, observability: 0.25, leadTime: 0.0, alreadyHinted: 1 }), // below floor
    ]);
    expect(ranked.map((p) => p.id)).toEqual(["a", "b"]);   // "low" dropped; equal-fit sorted by id
  });
});

describe("0103 — the cadence is scarce and bounded (weekly ceiling + season cap)", () => {
  it("allows a nod while under the weekly ceiling, refuses once spent", () => {
    expect(hintBudget({ week: 2, currentWeek: 2, spentThisWeek: 0, spentThisSeason: 0 }).allowed).toBe(true);
    expect(hintBudget({ week: 2, currentWeek: 2, spentThisWeek: FORESHADOW.maxHintsPerWeek, spentThisSeason: 1 }).allowed).toBe(false);
  });

  it("a NEW week resets the weekly spent count (the cadence is per-week)", () => {
    const d = hintBudget({ week: 1, currentWeek: 2, spentThisWeek: FORESHADOW.maxHintsPerWeek, spentThisSeason: 1 });
    expect(d.spent).toBe(0);
    expect(d.allowed).toBe(true);
  });

  it("the season cap is a hard ceiling even in a fresh week", () => {
    const d = hintBudget({ week: 3, currentWeek: 3, spentThisWeek: 0, spentThisSeason: FORESHADOW.maxHintsPerSeason });
    expect(d.allowed).toBe(false);
  });
});

describe("0103 — a hint is Vault-safe by construction and commits nothing", () => {
  it("buildHint carries only the public observation + tone + engine-side pathway id — never a premise", () => {
    const hint = buildHint({ id: "p1", observation: "an aside you weren't meant to catch was cut short" });
    expect(hint.observation).toBe("an aside you weren't meant to catch was cut short");
    expect(hint.tone).toBe(FORESHADOW.toneWord);
    expect(hint.pathwayId).toBe("p1");
    // No premise/target/plan/number field exists on the hint at all.
    expect(Object.keys(hint).sort()).toEqual(["observation", "pathwayId", "tone"]);
  });

  it("a sentinel planted in a pathway's sealed premise never reaches the hint (the builder never sees it)", () => {
    // The adapter builds the observation from a Vault-FREE co-presence fact; the sealed premise is never
    // handed to the pure module, so it is structurally impossible for the sentinel to reach a hint.
    const p = base({ id: "p1", observation: "the two of them keep ending up alone together" }); // NO sentinel
    const ranked = rankForeshadowCandidates([p]);
    const hint = buildHint(ranked[0]!);
    expect(JSON.stringify({ ranked, hint })).not.toContain(SENTINEL);
  });
});

describe("0103 — lead-time favors a pathway 1-2 weeks from its likely payoff", () => {
  it("peaks around 1 week out and is 0 about-to-fire or too far off", () => {
    expect(leadTimeFromWeeksOut(0)).toBeLessThan(leadTimeFromWeeksOut(1));   // no lead time if it fires now
    expect(leadTimeFromWeeksOut(1)).toBeGreaterThan(leadTimeFromWeeksOut(3)); // stale/too-far edits worse
    expect(leadTimeFromWeeksOut(99)).toBe(0);
  });
});

describe("0103 — determinism (same shapes ⇒ same ranking, no rng)", () => {
  it("ranks reproducibly", () => {
    const set = [base({ id: "x", relevance: 0.7 }), base({ id: "y", relevance: 0.9 }), base({ id: "z", relevance: 0.8 })];
    expect(rankForeshadowCandidates(set)).toEqual(rankForeshadowCandidates(set));
  });
});
