import { describe, it, expect } from "vitest";
import { composeRuntime } from "../../src/composition/runtime";
import { FakeClock } from "../../src/adapters/time/FakeClock";
import { PLAYER } from "../../src/domain/ids";

/**
 * Calibration GRADIENT gate (calibration-instrumentation lane, 2026-06-19).
 *
 * `juryReach.property.test.ts` gates the PASSIVE extreme only: a player who plays no social game.
 * That proves the floor/ceiling band and the anti-sycophancy finale teeth, but it says nothing
 * about whether PLAYING THE GAME measurably helps — the central calibration question the owner is
 * gathering data on ("does social play move the player's outcome, or do all roads lead to the same
 * goat seat?"). This gate measures the GRADIENT: a MINIMAL-ACTIVE policy (a few recorded social
 * scenes + basic self-preservation) must reach the jury AT LEAST AS OFTEN and win AT LEAST AS OFTEN
 * as the fully-passive policy across the same seeded seasons.
 *
 * Methodology mirrors `juryReach` exactly — seeded multi-season runs through the SAME live runtime
 * `main.ts` composes (composeRuntime → registry → orchestrator commit spine, pure turn-driven). The
 * ONLY difference between the two arms is the player policy, run over the SAME seeds, so any gap is
 * a REAL, attributable effect of social play — never noise (seeded determinism: same seeds ⇒ same
 * outcomes). The player's seat is read from the PUBLIC 0046 seam (`GameStateView.player.status`).
 *
 * The minimal-active policy (deliberately small — "a player who shows up", not an optimizer):
 *  - SOCIAL GAME: early each season it records a few `bonding`/`alliance` scenes (engine-folded
 *    hidden impact, 0023) with two fixed allies — the player builds real positive edges instead of
 *    idling. This is exactly the social play the passive arm omits.
 *  - SELF-PRESERVATION: at nominations it never nominates an ally; at an eviction vote it votes to
 *    evict a NON-ally. Bounded, legal (0005 binds downstream), and disposition-blind (the player
 *    sees no numbers — they just consistently back the two houseguests they bonded with).
 *
 * This is a measurement gate, not a tuning lever: it changes NO calibration weight. It asserts a
 * MONOTONIC relationship (active ≥ passive) with slack, so it stays green under future calibration
 * as long as playing the game is never WORSE than not playing it — a property that must always hold.
 * Roles only — no houseguest names. It is a HEAVY simulation (two full-season sweeps), so it lives
 * in the heavy-sims lane (modest seed count to keep CI lean).
 */

interface NamedRef { id: string; name: string }
interface PendingView { kind: string; options: NamedRef[]; appeals?: string[] }
interface AdvanceResult { started: boolean; finished: boolean; pending: PendingView | null }
interface HouseCard { id: string; status: string }
interface StateView { player: { id?: string; status: "active" | "jury" | "evicted" } | null; house?: HouseCard[] }

type Status = "active" | "jury" | "evicted";

/** The Vault-free MCP handle a channel resolver hands back — only `callTool` is used here. */
interface Mcp { callTool(name: string, args?: Record<string, unknown>): Promise<unknown> }
type Resolver = (channel: "player" | "admin", user: string) => Mcp;

/** The PASSIVE policy (identical to juryReach): first legal option everywhere; compete; veto on self only. */
function passiveAnswer(p: PendingView): Record<string, unknown> {
  switch (p.kind) {
    case "nominations":
      return { kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] };
    case "veto-decision":
      return p.options.some((o) => o.id === PLAYER)
        ? { kind: "veto-decision", use: true, save: PLAYER }
        : { kind: "veto-decision", use: false };
    case "comp-intent":
      return { kind: "comp-intent", intent: "compete" };
    case "houseguests-choice":
      return { kind: "houseguests-choice", vote: p.options[0]!.id };
    case "replacement":
      return { kind: "replacement", replacement: p.options[0]!.id };
    case "eviction-vote":
      return { kind: "eviction-vote", vote: p.options[0]!.id };
    case "tie-break":
      return { kind: "tie-break", vote: p.options[0]!.id };
    case "final-eviction":
      return { kind: "final-eviction", vote: p.options[0]!.id };
    case "finale-statement":
      return { kind: "finale-statement", statement: "I played my own game." };
    case "finale-answer":
      return { kind: "finale-answer", appeal: p.appeals?.[0] ?? "own-game" };
    case "juror-vote":
      return { kind: "juror-vote", vote: p.options[0]!.id };
    case "goodbye-message":
      return { kind: "goodbye-message", vote: "respectful" };
    case "juror-question":
      return { kind: "juror-question", statement: "What was your biggest move?" };
    default:
      throw new Error(`unhandled pending kind: ${p.kind}`);
  }
}

/**
 * The MINIMAL-ACTIVE decision policy — the passive answers PLUS basic self-preservation: never
 * nominate or vote out an ALLY (the two houseguests the player bonds with each season). The social
 * scenes that build those allies are recorded out-of-band in `recordEarlyScenes` below.
 */
function activeAnswer(p: PendingView, allies: ReadonlySet<string>): Record<string, unknown> {
  const notAlly = (o: NamedRef) => !allies.has(o.id) && o.id !== PLAYER;
  switch (p.kind) {
    case "nominations": {
      // Prefer two non-allies; fall back to the legal first-options if the block forces an ally up.
      const targets = p.options.filter(notAlly).map((o) => o.id);
      const choice = targets.length >= 2 ? [targets[0]!, targets[1]!] : [p.options[0]!.id, p.options[1]!.id];
      return { kind: "nominations", choice };
    }
    case "eviction-vote": {
      const target = p.options.find(notAlly) ?? p.options[0]!;
      return { kind: "eviction-vote", vote: target.id };
    }
    case "tie-break": {
      const target = p.options.find(notAlly) ?? p.options[0]!;
      return { kind: "tie-break", vote: target.id };
    }
    case "final-eviction": {
      const target = p.options.find(notAlly) ?? p.options[0]!;
      return { kind: "final-eviction", vote: target.id };
    }
    case "replacement": {
      const target = p.options.find(notAlly) ?? p.options[0]!;
      return { kind: "replacement", replacement: target.id };
    }
    default:
      // Everything else (comps, veto-on-self, finale answers, …) is identical to passive.
      return passiveAnswer(p);
  }
}

const SEEDS = 6;        // modest (heavy lane): two full-season sweeps per seed (passive + active) = 12 seasons
const SCENES_PER_ALLY = 3; // a few bonding/alliance scenes per ally each season — "a player who shows up"

/** Play one full passive season for a seed; return the player's final public seat + whether they won. */
async function playPassive(
  resolver: Resolver,
  seed: number,
): Promise<{ status: Status; won: boolean }> {
  const mcp = resolver("player", `grad-passive-${seed}`);
  await mcp.callTool("createCharacter", { playerName: "The Player", seed });
  return runToEnd(mcp, (p) => passiveAnswer(p), null);
}

/** Play one full minimal-active season for a seed; the player bonds with two fixed allies and protects them. */
async function playActive(
  resolver: Resolver,
  seed: number,
): Promise<{ status: Status; won: boolean }> {
  const mcp = resolver("player", `grad-active-${seed}`);
  await mcp.callTool("createCharacter", { playerName: "The Player", seed });

  // Pick two allies from the seeded cast (deterministic: the first two active houseguests — the
  // `house` projection is NPCs only, so the player is never among them).
  const state0 = (await mcp.callTool("getGameState", {})) as StateView;
  const allyIds = (state0.house ?? [])
    .filter((h) => h.status === "active" && h.id !== PLAYER)
    .map((h) => h.id)
    .slice(0, 2);
  const allies = new Set(allyIds);

  // The social game the passive arm omits: a few engine-folded bonding/alliance scenes per ally.
  await recordEarlyScenes(mcp, allyIds);

  return runToEnd(mcp, (p) => activeAnswer(p, allies), allyIds);
}

/** Record a small, bounded set of player-witnessed bonding/alliance scenes (0023 hidden fold). */
async function recordEarlyScenes(mcp: Mcp, allyIds: string[]): Promise<void> {
  const kinds = ["bonding", "alliance", "strategy"] as const;
  for (const ally of allyIds) {
    for (let i = 0; i < SCENES_PER_ALLY; i++) {
      await mcp.callTool("recordInteraction", {
        initiator: PLAYER,
        witnessSet: [PLAYER, ally],
        content: "A quiet conversation building trust.",
        kind: kinds[i % kinds.length],
      });
    }
  }
}

/** Drive a season to completion with the given answer policy; returns the player's final seat + win. */
async function runToEnd(
  mcp: Mcp,
  answer: (p: PendingView) => Record<string, unknown>,
  _allyIds: string[] | null,
): Promise<{ status: Status; won: boolean }> {
  let finished = false;
  let winner: { id: string } | null = null;
  for (let i = 0; i < 5_000 && !finished; i++) {
    const adv = (await mcp.callTool("advanceGame", {})) as AdvanceResult & { winner?: { id: string } | null };
    finished = adv.finished;
    winner = adv.winner ?? winner;
    if (adv.pending) {
      const sub = (await mcp.callTool("submitDecision", answer(adv.pending))) as AdvanceResult & { winner?: { id: string } | null };
      finished = sub.finished;
      winner = sub.winner ?? winner;
    }
  }
  expect(finished, "season must finish").toBe(true);
  const state = (await mcp.callTool("getGameState", {})) as StateView;
  return { status: state.player!.status, won: winner?.id === PLAYER };
}

describe("calibration gradient — minimal-active play reaches/wins at least as often as passive play", () => {
  it(
    `across ${SEEDS} seeded live seasons, active jury-reach ≥ passive and active wins ≥ passive`,
    async () => {
      const runtime = composeRuntime({
        clock: new FakeClock(),
        watcher: { tickEveryMs: 0, idleTickAfterMs: 0, maxOffscreenTicksPerWake: 0, auditEveryMs: 0 },
        seed: 1,
      });
      const resolver = runtime.registry.resolver();

      let passiveReach = 0, activeReach = 0;
      let passiveWins = 0, activeWins = 0;
      const passiveSeats: Status[] = [];
      const activeSeats: Status[] = [];

      for (let seed = 1; seed <= SEEDS; seed++) {
        const passive = await playPassive(resolver, seed);
        const active = await playActive(resolver, seed);
        passiveSeats.push(passive.status);
        activeSeats.push(active.status);
        if (passive.status !== "evicted") passiveReach++;
        if (active.status !== "evicted") activeReach++;
        if (passive.won) passiveWins++;
        if (active.won) activeWins++;
      }

      const detail =
        `passive reach=${passiveReach}/${SEEDS} (${passiveSeats.join(",")}) wins=${passiveWins} | ` +
        `active reach=${activeReach}/${SEEDS} (${activeSeats.join(",")}) wins=${activeWins}`;

      // THE GRADIENT: playing a basic social game is never a DISADVANTAGE. Active must reach the
      // jury at least as often as passive, and win at least as often. This is the monotonic property
      // calibration must always preserve — if it ever inverts (passive strictly out-reaches/out-wins
      // active across the same seeds), the social loop has stopped paying off and that is a real
      // calibration regression worth catching, not noise.
      expect(activeReach, `active jury-reach must be ≥ passive — ${detail}`).toBeGreaterThanOrEqual(passiveReach);
      expect(activeWins, `active wins must be ≥ passive — ${detail}`).toBeGreaterThanOrEqual(passiveWins);

      // Sanity floor (the run is meaningful, not two degenerate all-evicted sweeps): the active
      // player reaches the jury/endgame in at least one season (the same structural-reach guarantee
      // juryReach asserts for passive — playing the game cannot be a death sentence).
      expect(activeReach, `active play must reach the endgame in some season — ${detail}`).toBeGreaterThanOrEqual(1);
    },
    { timeout: 600_000 }, // two full-season sweeps × SEEDS; same generous budget as juryReach.
  );
});
