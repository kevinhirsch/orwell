import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { humanizeForRetrospective } from "../../src/domain/humanize";
import {
  preGameTieToRetrospectiveProse, showmanceToRetrospectiveProse,
  type PreGameTie, type Showmance,
} from "../../src/engine/seededRelationships";
import {
  storyThreadToVaultContent, storyThreadToRetrospectiveProse, type StoryThread,
} from "../../src/engine/deepProfile";

/**
 * P1 readability — the post-season "Producer's Vault" retrospective (0048, the Wall's ONE sanctioned
 * reveal) must render as readable, name-resolved PROSE, never a machine dump. The live repro leaked raw
 * ids and machine slugs:
 *   [hidden-thread] story-thread thread:npc:8:0 [dormant] premise: secret — … surfaces via: overheard
 *   [seeded-relationship] pre-game-tie Emilio Shepard <-> npc:3: old-acquaintance …
 *
 * HARD testing rules: ROLES ONLY — no real names. The structural assertions key off the raw-token /
 * raw-slug PATTERNS (`npc:`, `thread:`, `[dormant]`, `surfaces via:`, …), and on resolved-name presence
 * via the player's OWN authored name (a role, "The Player", never a cast name).
 */

// Raw machine audit slugs that must NEVER appear on the unsealed surface.
const RAW_SLUGS = [
  "[dormant]", "[active]", "[surfaced]", "[resolved]", "[expired]",
  "[spark]", "[bond]", "[visible]",
  "story-thread", "pre-game-tie", "seeded-relationship", "hidden-thread",
  "premise:", "trigger:", "surfaces via:",
  "goal-demands-move", "house-tightens", "on-block", "nominated-twice", "cornered-socially",
  "gossip-diffused", "told-by-confidant",
  " <-> ",
];

function assertReadable(rows: Array<{ type: string; content: string }>): void {
  for (const row of rows) {
    const blob = `[${row.type}] ${row.content}`; // exactly how the FE renders each row
    // no raw entity id / compound machine token
    expect(blob, `raw id/token leaked in: ${blob}`).not.toMatch(/\bnpc:\d+\b/);
    expect(blob, `raw thread id leaked in: ${blob}`).not.toMatch(/\bthread:/);
    // no raw machine slug
    for (const slug of RAW_SLUGS) {
      expect(blob.toLowerCase(), `raw slug "${slug}" leaked in: ${blob}`).not.toContain(slug.toLowerCase());
    }
  }
}

/** Drive a fresh season to a crowned winner via the admin fast-forward (deterministic, fast). */
function finishedSeason(user: string, seed: number) {
  const reg = new GameSessionRegistry();
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "The Player", seed });
  const ff = sb.session.advanceToFinale();
  expect(ff.finished).toBe(true); // the season legitimately reached its terminal state
  return sb;
}

describe("0048 retrospective — pure readable renderers (no ids, no slugs)", () => {
  it("story-thread prose resolves the source id and drops the machine identifier + slugs", () => {
    const roster = [{ id: "player", name: "The Player" }, { id: "npc:8", name: "The Nominee" }];
    const nameOf = (id: string): string => roster.find((r) => r.id === id)?.name ?? id;
    const thread: StoryThread = {
      id: "thread:npc:8:0",
      sourceId: "npc:8",
      premise: "secret — is hiding a serious-superfan knowledge of the game behind a casual front",
      trigger: "activates when this houseguest is genuinely threatened on the block or cornered socially",
      triggerCondition: "on-block",
      surfacingPathways: ["overheard"],
      weightImpact: "betrayal",
      status: "dormant",
      lifecycleWeek: 0,
    };
    const prose = storyThreadToRetrospectiveProse(thread, nameOf);
    expect(prose).toContain("The Nominee");      // the source resolved to its NAME
    expect(prose).toContain("serious-superfan");  // the premise (the good part) is preserved
    expect(prose).toContain("never surfaced");    // the status slug became readable
    expect(prose).not.toMatch(/\bnpc:\d+\b/);
    expect(prose).not.toMatch(/\bthread:/);
    expect(prose).not.toContain("[dormant]");

    // and the generic scrub of the RAW audit serialization is just as clean (the compound-id case A8 skips)
    const scrubbed = humanizeForRetrospective(storyThreadToVaultContent(thread), roster);
    expect(scrubbed).not.toMatch(/\bnpc:\d+\b/);
    expect(scrubbed).not.toMatch(/\bthread:/);
    expect(scrubbed).not.toContain("[dormant]");
    expect(scrubbed).not.toContain("surfaces via:");
    expect(scrubbed).toContain("The Nominee"); // the npc:8 EMBEDDED in thread:npc:8:0 still resolved
  });

  it("seeded-relationship prose resolves BOTH parties (the bare-id-on-one-side case)", () => {
    const roster = [{ id: "npc:3", name: "The Veteran" }, { id: "npc:7", name: "The Floater" }];
    const nameOf = (id: string): string => roster.find((r) => r.id === id)?.name ?? id;
    const tie: PreGameTie = { a: "npc:7", b: "npc:3", nature: "old-acquaintance" };
    const tieProse = preGameTieToRetrospectiveProse(tie, nameOf);
    expect(tieProse).toContain("The Veteran");
    expect(tieProse).toContain("The Floater");
    expect(tieProse).not.toMatch(/\bnpc:\d+\b/);
    expect(tieProse).not.toContain(" <-> ");

    const sm: Showmance = { a: "npc:3", b: "npc:7", stage: "spark" };
    const smProse = showmanceToRetrospectiveProse(sm, nameOf);
    expect(smProse).toContain("The Veteran");
    expect(smProse).toContain("The Floater");
    expect(smProse).not.toMatch(/\bnpc:\d+\b/);
    expect(smProse).not.toContain("[spark]");
  });
});

describe("0048 retrospective — live, end-to-end (a played, finished season)", () => {
  it("the gate holds while live, and unseals readable, name-resolved prose post-season", () => {
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor("retro-gate");
    sb.session.createCharacter({ playerName: "The Player", seed: 7 });
    // the structural gate: a LIVE season returns null (no unsealing, never by prompt)
    expect(sb.session.seasonRetrospective()).toBeNull();
  });

  it("the unsealed hiddenStory carries NO raw npc:/thread: token and NO raw machine slug", () => {
    const sb = finishedSeason("retro-readable", 7);
    const retro = sb.session.seasonRetrospective();
    expect(retro).not.toBeNull();
    expect(retro!.hiddenStory.length).toBeGreaterThan(0); // there IS a hidden story to read

    assertReadable(retro!.hiddenStory);

    // the threads always seed (every NPC gets some), so a "Secret thread" row is present and readable
    const threads = retro!.hiddenStory.filter((r) => r.type === "Secret thread");
    expect(threads.length).toBeGreaterThan(0);
    // …and each is real prose (resolved name dash-led), not an empty/stub line
    for (const t of threads) expect(t.content).toMatch(/\S+ — \S/);

    // the labels are readable category words, never raw kind slugs
    for (const row of retro!.hiddenStory) {
      expect(row.type).not.toMatch(/[:_]/);                 // no slug punctuation in the label
      expect(row.type).not.toMatch(/^[a-z]+(?:-[a-z]+)+$/); // not a raw lowercase-hyphen kind slug
      expect(row.type[0]).toBe(row.type[0]!.toUpperCase()); // a readable, Capitalized category word
    }
  });

  it("#996 — threads label by SOURCE CLASS: secret→'Secret thread', weakness→'Blind spot', goal→'Real game'", () => {
    const sb = finishedSeason("retro-thread-labels", 7);
    const retro = sb.session.seasonRetrospective();
    expect(retro).not.toBeNull();

    const byType = (t: string) => retro!.hiddenStory.filter((r) => r.type === t);
    const secrets = byType("Secret thread");
    const blindSpots = byType("Blind spot");
    const realGames = byType("Real game");

    // every NPC seeds 2–3 secret threads + exactly one weakness thread + one true-goal thread, so all
    // three labels must appear (the bug: all of them stacked under "Secret thread").
    expect(secrets.length).toBeGreaterThan(0);
    expect(blindSpots.length).toBeGreaterThan(0);
    expect(realGames.length).toBeGreaterThan(0);

    // the weakness/goal threads are NOT mislabeled as secrets — and each is real, name-resolved prose
    // matching the class naturalization ("Their blind spot…" / "Their real game…").
    for (const r of blindSpots) {
      expect(r.content).toMatch(/\S+ — /);
      expect(r.content).toContain("Their blind spot");
    }
    for (const r of realGames) {
      expect(r.content).toMatch(/\S+ — /);
      expect(r.content).toContain("Their real game");
    }

    // the labels stay readable category words (no slug punctuation, capitalized) — unchanged contract.
    for (const r of [...secrets, ...blindSpots, ...realGames]) {
      expect(r.type).not.toMatch(/[:_]/);
      expect(r.type[0]).toBe(r.type[0]!.toUpperCase());
    }
  });

  it("a seed with a seeded hidden tie renders it with BOTH houseguests named (no bare id)", () => {
    // sparseness: most seeds have no seeded relationships — probe for one that does, then finish it.
    let found = false;
    for (let seed = 1; seed <= 60 && !found; seed++) {
      const reg = new GameSessionRegistry();
      const sb = reg.sandboxFor(`tie-probe-${seed}`);
      sb.session.createCharacter({ playerName: "The Player", seed });
      const rels = sb.session.snapshot().seededRelationships;
      if (!rels || (rels.ties.length === 0 && rels.showmances.length === 0)) continue;
      found = true;
      const ff = sb.session.advanceToFinale();
      expect(ff.finished).toBe(true);
      const retro = sb.session.seasonRetrospective()!;
      const ties = retro.hiddenStory.filter((r) => r.type === "Hidden tie");
      expect(ties.length).toBeGreaterThan(0);
      assertReadable(ties);
      // each hidden-tie line names two houseguests joined by "and" — never a raw "<->"/id
      for (const tie of ties) {
        expect(tie.content).toContain(" and ");
        expect(tie.content).not.toMatch(/\bnpc:\d+\b/);
      }
    }
    expect(found, "no seed in [1,60] produced a seeded hidden tie/showmance to exercise").toBe(true);
  });
});
