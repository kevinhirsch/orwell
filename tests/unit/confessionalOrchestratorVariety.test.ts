import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { Orchestrator } from "../../src/composition/orchestrator";
import { FakeClock } from "../../src/adapters/time/FakeClock";
import { PLAYER } from "../../src/domain/ids";

/**
 * BB-2 / SG-8 — the off-screen society's confessional call site (`orchestrator.ts` `defaultApply`)
 * used to pass `confessionalFor` no `rng`, no `voice`, and no `nameOf` — so `pick()` always fell back
 * to `lines[0]` (the SAME measured-pool template every time), the voice pool always resolved to
 * "measured" (no per-character texture), and a player-named target/ally baked the bare `player` id
 * instead of their display name. Across a season this produced 41/41 IDENTICAL confessional lines and
 * killed the 0048 retrospective payoff. The fix threads a DEDICATED seeded rng (mirroring the isolated
 * `recentRng` pattern already beside it), the confessor's PUBLIC 0084 voice, and a `nameOf` resolver —
 * exactly the wiring `GameSessionAdapter.recordCeremonyConfessionals` already used for the LIVE ceremony
 * path. These tests exercise the OFF-SCREEN tick path end to end (roles only, no names hard-coded).
 */

// Known distinguishing marker substrings from the target-line pools (measured / curt / expansive) in
// `src/engine/confessionals.ts`. Any ONE of these appearing pins which template/style was used; seeing
// more than one distinct marker across a season proves real variety instead of one repeated template.
// (Not implementation-internal — these are the actual rendered player-facing... err, Vault-facing text.)
const TARGET_MARKERS = [
  "they're my biggest threat", // measured[0] — the SOLE template the un-fixed call site always produced
  "and they have to go", // measured[1]
  "they're playing everybody", // measured[2]
  "the name I write down", // measured[3]
  "Simple as that", // curt[0]
  "'s my target. Done", // curt[1]
  "no debate", // curt[2]
  "That's the name. Period", // curt[3]
  "it scares me a little", // expansive[0]
  "every single road to the end", // expansive[1]
  "keeping me up at night", // expansive[2]
  "the longer I sit on that the worse it gets for me", // expansive[3]
];

function markerIn(content: string): string | null {
  return TARGET_MARKERS.find((m) => content.includes(m)) ?? null;
}

function runOffscreenSeason(user: string, seed: number, ticks: number, biasPlayerAsThreat = false) {
  const reg = new GameSessionRegistry();
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "P", seed });
  const orch = new Orchestrator(reg, new FakeClock(), { seed });
  for (let i = 0; i < ticks; i++) {
    if (biasPlayerAsThreat) {
      const house = sb.session.snapshot().house;
      for (const n of house?.npcs ?? []) sb.engine.relationships.edge(n.id, PLAYER).threat = 1;
    }
    orch.advance(user, "offscreen-tick");
  }
  return sb.engine.events.query().filter((e) => e.type === "confessional").map((e) => e.content);
}

describe("BB-2/SG-8 — off-screen confessionals vary across a season (orchestrator wiring)", () => {
  it("produces MORE THAN ONE distinct target-line template over a season (not 41/41 identical)", () => {
    const confs = runOffscreenSeason("bb2-variety", 101, 60);
    expect(confs.length, "at least a few confessionals should have been recorded").toBeGreaterThan(3);
    const markers = confs.map(markerIn).filter((m): m is string => m !== null);
    expect(markers.length, "at least some confessionals should hit a known target-line template").toBeGreaterThan(0);
    const distinct = new Set(markers);
    expect(distinct.size, `only ONE template used across the season: ${[...distinct]}`).toBeGreaterThan(1);
    // The specific historical bug: EVERY confessional resolving to the un-seeded default template.
    expect(distinct).not.toEqual(new Set(["they're my biggest threat"]));
  });

  it("never bakes the literal 'player' token — a player-targeted confessional names them", () => {
    const confs = runOffscreenSeason("bb2-playername", 202, 40, true);
    expect(confs.length).toBeGreaterThan(0);
    for (const c of confs) {
      expect(/\bplayer\b/i.test(c), `bare 'player' token leaked in: ${c}`).toBe(false);
    }
  });

  it("is deterministic — the same seed reproduces the SAME confessional sequence", () => {
    // The off-screen TICK stream is keyed by `${orchestratorSeed}:${user}` (Orchestrator.rngFor), on
    // top of the game seed that drives cast generation — so a same-seed rerun must reuse the SAME
    // sandbox user key too (two fresh registries/orchestrators, same user, no shared state between runs).
    const a = runOffscreenSeason("bb2-det", 303, 30);
    const b = runOffscreenSeason("bb2-det", 303, 30);
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
  });
});
