import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { Orchestrator } from "../../src/composition/orchestrator";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * Audit R4-03 / C-01 — player-facing reads must read as PROSE, not machinery. The hidden stores
 * interpolate raw entity ids (`npc:8`) and pathway/diffusion slugs (`overheard:offscreen:…`, the
 * gossip drift suffix ` · more or less#754`) into event/knowledge content; the live play-through
 * caught these reaching the narrator (and the played-record log) verbatim. The fix humanizes ids →
 * public NAMES and neutralizes slug noise at the outward read boundary (the visible projection +
 * the player surface), wired from the live public roster.
 *
 * HARD rule: roles only — the player is "The Houseguest"; NPC names are read off the live roster,
 * never asserted as personas. We assert the SHAPE (a name, no `npc:N`, no slug), not any identity.
 */
describe("R4-03 — player-facing reads name houseguests, never echo raw ids or pathway slugs", () => {
  /** Stand up a live sandbox with a real house so the public roster resolves names. */
  function liveSandbox(seed = 1) {
    const reg = new GameSessionRegistry();
    const user = `humanize-${seed}`;
    const orch = new Orchestrator(reg, { now: () => seed }, { seed });
    const sb = reg.sandboxFor(user);
    sb.session.createCharacter({ playerName: "The Houseguest", seed });
    return { reg, orch, user, sb };
  }

  it("getVisibleStateFor knowledge content: a raw `npc:N` id is substituted with the houseguest's NAME", () => {
    const { sb } = liveSandbox(1);
    // The two NPCs whose ids the rumor names — read their PUBLIC names off the live roster (no fixture).
    const a = npc(1);
    const b = npc(2);
    const roster = sb.session.publicRoster();
    const nameA = roster.find((r) => r.id === a)!.name;
    const nameB = roster.find((r) => r.id === b)!.name;

    // Seed the PLAYER's knowledge with content shaped exactly like the play-through leak: raw ids
    // plus the gossip drift suffix the diffusion layer appends.
    sb.engine.knowledge.seedBelief(
      PLAYER,
      { content: `word around the house is that ${a} and ${b} are getting awfully close · more or less#754`, factId: "rumor-x" },
      "told-by:" + b,
    );

    // The RAW hidden layer still carries the ids + slug (diffusion bookkeeping is untouched).
    const raw = sb.engine.knowledge.knownTo(PLAYER).find((k) => k.factId === "rumor-x")!;
    expect(raw.content).toContain(a);
    expect(raw.content).toContain("· more or less#754");

    // The PLAYER-FACING read names the houseguests and drops the slug noise.
    const known = sb.player.getVisibleState().knowledge.find((k) => k.factId === "rumor-x")!;
    expect(known.content).toContain(nameA);
    expect(known.content).toContain(nameB);
    expect(known.content).not.toMatch(/npc:\d/);
    expect(known.content).not.toContain("#754");
    expect(known.content).not.toContain("· more or less");
  });

  it("getVisibleStateFor never surfaces an `overheard:`/`offscreen:` pathway slug embedded in content", () => {
    const { sb } = liveSandbox(2);
    // A slug that leaked into content (the audit's `overheard:offscreen:alliance:1:594987875` shape).
    sb.engine.knowledge.seedBelief(
      PLAYER,
      { content: `you caught overheard:offscreen:alliance:1:594987875 in the lounge`, factId: "slug-y" },
      "witnessed",
    );
    const known = sb.player.getVisibleState().knowledge.find((k) => k.factId === "slug-y")!;
    expect(known.content).not.toMatch(/overheard:|offscreen:/);
    expect(known.content).not.toMatch(/\bnpc:\d/);
  });

  it("the played-record log renders a friendly pathway label, never the raw slug", () => {
    const { sb } = liveSandbox(3);
    sb.engine.knowledge.seedBelief(
      PLAYER,
      { content: "a quiet word in the kitchen", factId: "log-z" },
      "overheard:offscreen:alliance:1:594987875",
    );
    const log = sb.player.renderLog();
    expect(log).not.toMatch(/overheard:offscreen|:\d{3,}/);
    expect(log).toContain("overheard"); // the friendly KIND label survives, not the slug
  });

  it("live gossip→player: when a rumor terminates at the player, the player-facing read is name-bearing and slug-free", () => {
    let checked = false;
    for (const seed of [1, 2, 3, 4, 5]) {
      const { sb, orch, user } = liveSandbox(seed);
      for (let t = 0; t < 60; t++) {
        orch.advance(user, "offscreen-tick");
        const rumor = sb.engine.knowledge.knownTo(PLAYER).find((f) => f.pathway.startsWith("told-by:"));
        if (!rumor) continue;
        // The raw belief still names ids (the diffusion content is built from them).
        const known = sb.player.getVisibleState().knowledge.find((k) => k.factId === rumor.factId);
        expect(known, "the landed rumor appears in the player-facing read").toBeTruthy();
        // No raw id and no drift suffix reaches the narrator's context / the log.
        expect(known!.content).not.toMatch(/\bnpc:\d/);
        expect(known!.content).not.toMatch(/#\d+\b/);
        checked = true;
        break;
      }
      if (checked) break;
    }
    expect(checked, "a rumor reached the player across the seed set so the read was exercised").toBe(true);
  });
});
