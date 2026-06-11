import { describe, it, expect } from "vitest";
import { composeRuntime } from "../../src/composition/runtime";
import { FakeClock } from "../../src/adapters/time/FakeClock";
import { PLAYER } from "../../src/domain/ids";

/**
 * D4/E33 — the jury-reach calibration gate (audit 2026-06-10, Theme 5; round-4 R5 → round-6 R11).
 *
 * Round 4 measured 62/62 passive seeded seasons ending in a pre-jury player eviction — the jury,
 * the finale, the juror's seat, and eviction night were unreachable content in practice. Round 6
 * (R11) reframed it: the ladder works; the survival rate is a CALIBRATION property that needs a
 * permanent gate. This is that gate, re-measured on the fixed spine (post PR #215).
 *
 * Methodology (the round-4 measurement, reproduced): seeded multi-season runs through the LIVE
 * loop — the same runtime composition `main.ts` uses (composeRuntime → registry → orchestrator
 * commit spine, pure turn-driven, one bounded off-screen tick per beat) — driven by a PASSIVE
 * player policy: no social game (zero recordInteraction folds, no deals), every engine pending
 * answered minimally (first legal option; compete at comps; veto used only to save self). The
 * player's outcome is read from the PUBLIC 0046 seam (`GameStateView.player.status`).
 *
 * The bounds (both sides matter — this is a calibration band, not a protection test):
 *  - FLOOR: a passive player must reach the jury in a real fraction of seasons. Anti-sycophancy
 *    ("never protect the player") cannot mean "the player always loses pre-jury" (E33): if the
 *    house re-becomes a standing consensus that hunts the idle player out in the first five weeks
 *    (the pre-#215 behavior: move-in threat priors + per-mutation off-screen bond-deepening while
 *    the passive player's edges idle), this floor fails.
 *  - CEILING (product ruling, 2026-06-11): floater-coasting is REALISTIC — NPCs rationally keep a
 *    no-jury-votes goat around (real-BB strategy), so a passive player reaching jury often is not
 *    by itself sycophancy. The anti-sycophancy teeth move to the FINALE: a player who played no
 *    social game earns no jury votes, so of their Final-2 appearances they must LOSE the jury
 *    vote in the overwhelming majority. The jury-reach ceiling stays only as a loose absurdity
 *    guard (a passive player must still be able to lose a season).
 *
 * Measured on the post-merge-train spine (2026-06-11, 20 seeds, this exact driver): 19/20 reached
 * jury/endgame, 9 reached the Final 2 — driven by emergent NPC self-interest (threat accrues to
 * the active players; the unattached pawn survives threat-primary votes; F3/F4 drags the goat).
 * The gate rides seeded determinism (same seeds ⇒ same outcomes), so a failure is always a REAL
 * behavior change in the nomination/vote/relationship calibration, never noise.
 * Roles only — no houseguest names.
 */

interface NamedRef { id: string; name: string }
interface PendingView { kind: string; options: NamedRef[]; appeals?: string[] }
interface AdvanceResult { started: boolean; finished: boolean; pending: PendingView | null }
interface StateView { player: { status: "active" | "jury" | "evicted" } | null }

/** The passive policy: first legal option everywhere; compete; veto only ever used on self. */
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
    // The 0046/0037 player-agency pendings (PR #217): tone rides `vote`, free text rides `statement`.
    case "goodbye-message":
      return { kind: "goodbye-message", vote: "respectful" };
    case "juror-question":
      return { kind: "juror-question", statement: "What was your biggest move?" };
    default:
      throw new Error(`unhandled pending kind: ${p.kind}`);
  }
}

const SEEDS = 20;        // deterministic seeds 1..SEEDS — one full live season each
const FLOOR = 3;         // ≥ 3/20 (15%): the jury/endgame is structurally reachable for a passive player
const CEILING = 19;      // ≤ 19/20: the loose absurdity guard — a passive player can still lose a season
const F2_WIN_MAX = 3;    // jury wins across the set stay rare (ruling 2026-06-11) …
const EARNED_WINS = 2;   // … and EVERY win must be EARNED: ≥ this many PUBLIC comp wins that season.
                         // A socially-passive comp threat winning is real BB; a 0-comp goat winning is the rigged jury.

describe("D4/E33 — a passive player's structural reach of the jury (calibration gate)", () => {
  it(
    `across ${SEEDS} passive seeded live seasons, the player reaches the jury in [${FLOOR}, ${CEILING}]`,
    async () => {
      // The production composition (watcher off ⇒ pure turn-driven, the deploy default).
      const runtime = composeRuntime({
        clock: new FakeClock(),
        watcher: { tickEveryMs: 0, idleTickAfterMs: 0, maxOffscreenTicksPerWake: 0, auditEveryMs: 0 },
        seed: 1,
      });
      const resolver = runtime.registry.resolver();

      const outcomes: Array<"active" | "jury" | "evicted"> = [];
      let f2Appearances = 0;
      let f2Wins = 0;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const mcp = resolver("player", `jury-reach-${seed}`);
        await mcp.callTool("createCharacter", { playerName: "The Player", seed });
        let finished = false;
        let winner: { id: string } | null = null;
        let playerCompWins = 0; // PUBLIC broadcast beats only — the player's visible resume
        const countWin = (ev: { beat?: string; content?: string } | null): void => {
          if (ev?.content && /^The Player wins /.test(ev.content) && /competition$/.test(ev.beat ?? "")) playerCompWins++;
        };
        for (let i = 0; i < 5_000 && !finished; i++) {
          const adv = (await mcp.callTool("advanceGame", {})) as AdvanceResult & { winner?: { id: string } | null; event?: { beat?: string; content?: string } | null };
          finished = adv.finished;
          winner = adv.winner ?? winner;
          countWin(adv.event ?? null);
          if (adv.pending) {
            const sub = (await mcp.callTool("submitDecision", passiveAnswer(adv.pending))) as AdvanceResult & { winner?: { id: string } | null; event?: { beat?: string; content?: string } | null };
            finished = sub.finished;
            winner = sub.winner ?? winner;
            countWin(sub.event ?? null);
          }
        }
        expect(finished, `season for seed ${seed} must finish`).toBe(true);
        // The PUBLIC player seat (0046): "evicted" = out pre-jury; "jury" = evicted into the last-9
        // jury; "active" at a finished season = the player sat in the Final 2. Vault-free.
        const state = (await mcp.callTool("getGameState", {})) as StateView;
        outcomes.push(state.player!.status);
        if (state.player!.status === "active") {
          f2Appearances++;
          if (winner?.id === PLAYER) {
            f2Wins++;
            // THE TEETH: a crowned passive season must be EARNED on the public record — a real comp
            // resume. A jury crowning a 0-comp, no-social-game goat is the audit's rigged-jury fear.
            expect(playerCompWins, `seed ${seed}: the jury crowned a passive player with only ${playerCompWins} public comp wins`)
              .toBeGreaterThanOrEqual(EARNED_WINS);
          }
        }
      }

      const reachedJury = outcomes.filter((s) => s !== "evicted").length;
      const detail = `reached jury/endgame in ${reachedJury}/${SEEDS} passive seasons (${outcomes.join(", ")})`;
      // FLOOR (E33): the endgame content is reachable — passive play is a disadvantage, not a death
      // sentence. CEILING (anti-sycophancy): a social-game-less player is never shepherded to jury.
      expect(reachedJury, detail).toBeGreaterThanOrEqual(FLOOR);
      expect(reachedJury, detail).toBeLessThanOrEqual(CEILING);
      // The player can genuinely lose early (0046): at least one pre-jury eviction across the set —
      // anything else would mean the engine is quietly walking the player past the early weeks.
      expect(outcomes.filter((s) => s === "evicted").length, detail).toBeGreaterThan(0);
      // THE ANTI-SYCOPHANCY TEETH (ruling 2026-06-11): wins stay RARE across the set, and each one
      // was already proven EARNED above (a real public comp resume). A socially-passive player is
      // never handed the crown — when they win, the season record shows why.
      const f2Detail = `passive Final-2 appearances: ${f2Appearances}, jury wins: ${f2Wins}`;
      expect(f2Wins, f2Detail).toBeLessThanOrEqual(F2_WIN_MAX);
    },
    { timeout: 600_000 }, // ~20 full live seasons; generous for loaded CI hosts (same family as the UAT)
  );
});
