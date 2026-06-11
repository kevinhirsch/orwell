import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { resolveCompetition, CompetitionIntents } from "../../src/domain/competitionOutcome";
import type { Competitor, CompetitionType } from "../../src/domain/competitionOutcome";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";

/**
 * Audit C5 — malformed competition input must refuse loudly, never resolve quietly.
 * A NaN stat used to silently crown competitors[0] (every NaN comparison is false, so the
 * initial candidate never lost) and an empty field died with a bare TypeError. Both are
 * anti-sycophancy hazards: a data bug could decide a competition.
 */

const TYPES: CompetitionType[] = ["endurance", "physical", "puzzle", "quiz", "memory", "mental", "social"];

const finiteStat = fc.double({ min: 0, max: 1, noNaN: true });
const competitorArb = (id: string): fc.Arbitrary<Competitor> =>
  fc.record({
    id: fc.constant(id),
    stats: fc.record({ physical: finiteStat, mental: finiteStat, social: finiteStat }),
    emotionalState: fc.option(finiteStat, { nil: undefined }),
  });

const fieldArb = fc
  .integer({ min: 1, max: 8 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => competitorArb(`hg:${i}`))));

describe("audit C5 — competition input guards", () => {
  it("an empty field throws a deliberate error, not a TypeError", () => {
    expect(() => resolveCompetition([], "physical", new CompetitionIntents(), new SeededRandom(1))).toThrowError(
      /empty competitor field/,
    );
  });

  it("any single non-finite stat (NaN/Infinity) anywhere in the field is refused (property)", () => {
    fc.assert(
      fc.property(
        fieldArb,
        fc.constantFrom(...TYPES),
        fc.nat(),
        fc.constantFrom<"physical" | "mental" | "social" | "emotionalState">("physical", "mental", "social", "emotionalState"),
        fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
        (field, type, idx, slot, bad) => {
          const victim = field[idx % field.length]!;
          if (slot === "emotionalState") victim.emotionalState = bad;
          else victim.stats[slot] = bad;
          expect(() => resolveCompetition(field, type, new CompetitionIntents(), new SeededRandom(7))).toThrowError(
            /non-finite/,
          );
        },
      ),
      { numRuns: 150 },
    );
  });

  it("well-formed fields always resolve with finite scores and a winner from the field (property)", () => {
    fc.assert(
      fc.property(fieldArb, fc.constantFrom(...TYPES), fc.integer({ min: 1, max: 10_000 }), (field, type, seed) => {
        const result = resolveCompetition(field, type, new CompetitionIntents(), new SeededRandom(seed));
        expect(field.some((c) => c.id === result.winner)).toBe(true);
        for (const c of field) expect(Number.isFinite(result.scores[c.id])).toBe(true);
      }),
      { numRuns: 150 },
    );
  });
});
