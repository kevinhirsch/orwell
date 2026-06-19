import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { renderStoryFacts } from "../../src/engine/momentPrompts";
import type { AdvanceView } from "../../src/ports/GameSession";

/**
 * Anti-confabulation (priority #3): found in live playtest, the post-season REUNION/recap invented
 * specifics — it reported the jury vote as "9-2" when the real ballot was 8-1, and claimed the player
 * "made the Final 5 with two HOH wins" when they were actually evicted at the Final 6. A recap that
 * embellishes the record cheats the truth. The engine now hands the model the EXACT public finale
 * facts (jury margin + the player's own placement) so it voices them instead of inventing. Roles only.
 */
type Pending = NonNullable<AdvanceView["pending"]>;
function resolve(s: GameSessionAdapter, p: Pending): void {
  const o = (i = 0): string => p.options[i]?.id;
  switch (p.kind) {
    case "nominations": s.submitDecision({ kind: "nominations", choice: [o(0), o(1)] }); break;
    case "veto-decision": s.submitDecision({ kind: "veto-decision", use: false }); break;
    case "comp-intent": s.submitDecision({ kind: "comp-intent", intent: "compete" }); break;
    case "houseguests-choice": s.submitDecision({ kind: "houseguests-choice", choice: [o(0)] }); break;
    case "replacement": s.submitDecision({ kind: "replacement", replacement: o(0) }); break;
    case "eviction-vote": s.submitDecision({ kind: "eviction-vote", vote: o(0) }); break;
    case "goodbye-message": s.submitDecision({ kind: "goodbye-message", vote: o(0), statement: "x" }); break;
    default: s.submitDecision({ kind: (p as any).kind, vote: o(0) }); break;
  }
}

describe("post-season recap is grounded in the real finale facts (anti-confabulation)", () => {
  it("renders the EXACT jury margin + the player's placement, and forbids embellishing either", () => {
    const out = renderStoryFacts(
      [{ content: "an event" }],
      { winner: "The Winner", week: 14, tally: { winnerVotes: 8, runnerUpVotes: 1, runnerUp: "The Runner Up" } },
      "You were evicted in week 12, going out at the Final 6, then sat on the jury.",
    );
    expect(out).toMatch(/jury vote of 8–1/);          // the exact margin, never a guess
    expect(out).toContain("The Runner Up");            // the real finalist
    expect(out).toContain("Final 6");                  // the real placement
    expect(out).toMatch(/never invent a different count, margin, or finalist/i);
    expect(out).toMatch(/never embellish/i);
    // No tally / no placement → the lines simply don't appear (mid-season re-entry stays tight).
    const bare = renderStoryFacts([{ content: "x" }], { winner: "W", week: 3 }, null);
    expect(bare).not.toMatch(/jury vote/);
    expect(bare).not.toContain("THE PLAYER'S OWN SEASON");
  });

  it("the live post-season prompt carries the engine's real tally + placement (not an invented one)", () => {
    let checked = false;
    for (let seed = 1; seed <= 10 && !checked; seed++) {
      const s = new GameSessionAdapter();
      s.createCharacter({ playerName: "P", seed });
      for (let i = 0; i < 400; i++) {
        const adv = s.advanceGame();
        if (adv.pending) resolve(s, adv.pending);
        if (adv.finished) break;
      }
      const gs = s.getGameState();
      if (!gs.finished) continue;
      const prompt = s.getMomentPrompt({ moment: "post-season" }).systemPrompt;
      // The grounded finale facts are present: an exact jury margin and the player's own placement.
      const m = prompt.match(/jury vote of (\d+)–(\d+)/);
      expect(m, "post-season prompt states an exact jury margin").not.toBeNull();
      const [winnerVotes, runnerUpVotes] = [Number(m![1]), Number(m![2])];
      expect(winnerVotes).toBeGreaterThan(runnerUpVotes);       // the winner actually won
      expect(winnerVotes + runnerUpVotes).toBeGreaterThan(0);   // real ballots, not a placeholder
      expect(prompt).toContain("THE PLAYER'S OWN SEASON:");      // the player's real placement is stated
      expect(prompt).toMatch(/never embellish/i);
      checked = true;
    }
    expect(checked, "drove at least one season to a grounded post-season recap").toBe(true);
  });
});
