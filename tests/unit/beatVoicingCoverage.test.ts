import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BASE_GAME_MASTER_PROMPT,
  MOMENT_PROMPTS,
  momentForPhase,
} from "../../src/engine/momentPrompts";

// Batch C gate #2 (2026-07-11 narrator-prompt audit) — BEAT-COVERAGE.
//
// The gap the audit found: `day-break` (the ADR-0006 HOH→noms night gate) shipped as a live,
// EMITTED `BeatEvent` with NO voicing guidance anywhere — the narrator was handed a beat it had
// never been told how to play. Nothing structural caught it (the lever-manifest drift test only
// checks the base prompt's `• name —` bullets; the moment-fragment map has no completeness check).
//
// This gate closes that: every beat the live loop actually EMITS to the narrator must have voicing
// guidance — a dedicated moment fragment, a phase→fragment mapping, or an explicit prose mention in
// the base prompt / a fragment. A new emitted beat with no guidance fails here, on the engine PR
// that adds it (this runs in the `test` job, so an engine-only PR can't ship the gap latent).
//
// "EMITTED" is precise: only beats returned as an object-literal `beat: "X"` on a `BeatEvent`
// (the value the narrator voices) count — NOT the STRUCTURAL `s.beat = "X"` bookkeeping assignments
// (e.g. `battle-back`, which is a next-beat-to-resolve marker whose player-facing event is actually
// emitted as `twist-reveal`). Keying on the `beat:` colon form (never `s.beat =`) draws that line.
describe("beat-voicing coverage (Batch C #2 — no emitted beat ships without guidance)", () => {
  const liveSeasonSrc = readFileSync(
    join(process.cwd(), "src/engine/liveSeason.ts"),
    "utf-8",
  );

  /** Every beat the live loop EMITS on a BeatEvent (object-literal `beat: "X"`), never the
   * structural `s.beat = "X"` assignments the narrator never sees. */
  function emittedBeats(): string[] {
    const beats = new Set<string>();
    for (const m of liveSeasonSrc.matchAll(/\bbeat:\s*"([a-z-]+)"/g)) {
      beats.add(m[1]!);
    }
    return [...beats].sort();
  }

  /** All the text the narrator is ever handed as voicing guidance: the base persona prompt plus
   * every managed moment fragment. */
  const allGuidanceText = [BASE_GAME_MASTER_PROMPT, ...Object.values(MOMENT_PROMPTS)].join("\n");

  /** A beat has voicing guidance iff it is a dedicated moment key, OR `momentForPhase` routes it to
   * a real (non-`default`) fragment, OR its name is explicitly named in the base prompt / a
   * fragment (how `day-break`, `veto-draw`, `comp-elimination` are covered). */
  function hasGuidance(beat: string): boolean {
    if (beat in MOMENT_PROMPTS) return true;
    if (momentForPhase(beat) !== "default") return true;
    return allGuidanceText.includes(beat);
  }

  it("emits a real, non-trivial set of beats (the parser still matches the emission sites)", () => {
    const beats = emittedBeats();
    // Sanity: the loop emits many beats — a near-empty result means the `beat:` shape changed and
    // this gate silently stopped guarding.
    expect(beats.length).toBeGreaterThanOrEqual(12);
    // Spot-pin the beats the audit specifically cared about are actually seen as emitted.
    for (const b of ["day-break", "eviction-result", "finale-reveal", "veto-draw"]) {
      expect(beats, `expected the live loop to emit \`${b}\``).toContain(b);
    }
  });

  it("every emitted beat has voicing guidance (base prompt, a fragment, or a phase mapping)", () => {
    const uncovered = emittedBeats().filter((b) => !hasGuidance(b));
    expect(
      uncovered,
      `emitted beats with NO voicing guidance (this is exactly how \`day-break\` shipped): ` +
        `${uncovered.join(", ")} — add a moment fragment, a momentForPhase mapping, or name the ` +
        `beat in BASE_GAME_MASTER_PROMPT / a fragment`,
    ).toEqual([]);
  });

  it("does NOT require the STRUCTURAL-only `battle-back` beat (never emitted to the narrator)", () => {
    // `battle-back` is assigned to `s.beat` (bookkeeping) but its player-facing event fires as
    // `twist-reveal` — so it must not appear in the emitted set the gate demands coverage for.
    // Pins the emitted-vs-structural line the gate draws, so a future refactor that starts EMITTING
    // `battle-back` (needing its own guidance) trips the coverage test above, not a silent gap.
    expect(emittedBeats()).not.toContain("battle-back");
  });

  it("day-break — the audit's exemplar — is now explicitly covered in the base prompt", () => {
    // Regression pin for the exact gap: day-break routes to `default` (no phase keyword) and is not
    // a moment key, so its ONLY coverage is the explicit base-prompt mention. If that mention is
    // ever removed without adding a fragment, the coverage test above goes red — this pins WHY.
    expect(momentForPhase("day-break")).toBe("default");
    expect(MOMENT_PROMPTS["day-break"]).toBeUndefined();
    expect(BASE_GAME_MASTER_PROMPT).toContain("day-break");
  });
});
