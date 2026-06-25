import { describe, it, expect } from "vitest";
import { humanizeIds, humanizeForRetrospective } from "../../src/adapters/engine/humanize";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * Audit A8 — `humanizeIds` turns raw loop-event ids into public names WITHOUT mangling the
 * ordinary English words "player"/"players" that share spelling with the player's bare-word id
 * `player`. The live repro was *"the veto Quinn Vales are drawn … the final Quinn Vale"*.
 * HARD rule: roles only — the "names" here are obvious placeholders, not personas.
 */
describe("A8 — id humanization is whole-token, never a blind substring replace", () => {
  const entities = [
    { id: PLAYER, name: "Hero" },   // id is the bare word "player" — the collision source
    { id: npc(1), name: "Ada" },
    { id: npc(15), name: "Bo" },
  ];

  it("never touches the English words 'player' / 'players' in beat prose", () => {
    const out = humanizeIds("the veto players are drawn and one will play", entities);
    expect(out).toBe("the veto players are drawn and one will play"); // unchanged — no 'Heros'
    expect(out).not.toContain("Hero");
  });

  it("substitutes a genuine `player` id token (whole word) with the name", () => {
    expect(humanizeIds("player wins Head of Household", entities)).toBe("Hero wins Head of Household");
    expect(humanizeIds(`${PLAYER} nominates ${npc(1)}`, entities)).toBe("Hero nominates Ada");
    expect(humanizeIds("the vote is read: player", entities)).toBe("the vote is read: Hero");
  });

  it("a short id never clobbers part of a longer one (npc:1 inside npc:15)", () => {
    expect(humanizeIds(`${npc(1)} and ${npc(15)} talk`, entities)).toBe("Ada and Bo talk");
    // even authored in the clobber-prone order, the longer token is matched whole.
    expect(humanizeIds("npc:15 then npc:1", entities)).toBe("Bo then Ada");
  });

  it("leaves content with no ids untouched, and handles the empty roster", () => {
    expect(humanizeIds("a house meeting shifts the week", entities)).toBe("a house meeting shifts the week");
    expect(humanizeIds("player wins", [])).toBe("player wins"); // no entities ⇒ nothing to humanize
  });

  // #845 — the bare-word player id collides with the SINGULAR English word "player". The whole-token
  // boundary already protects the plural; the singular common noun after a DETERMINER is left alone.
  it("never substitutes the SINGULAR dictionary word 'player' after a determiner (#845)", () => {
    // The live repro: a deep-profile goal "outlast every player" became "outlast every <name>".
    expect(humanizeIds("outlast every player in the house", entities)).toBe("outlast every player in the house");
    expect(humanizeIds("a player who throws comps", entities)).toBe("a player who throws comps");
    expect(humanizeIds("their day-one read of this player", entities)).toBe("their day-one read of this player");
    for (const sentence of [
      "outlast every player in the house",
      "a player who throws comps",
      "this player is dangerous",
    ]) {
      expect(humanizeIds(sentence, entities)).not.toContain("Hero");
    }
  });

  it("STILL substitutes a genuine bare `player` id token not preceded by a determiner (#845)", () => {
    // The id never follows a determiner in beat prose — it leads the content, or follows punctuation/a verb.
    expect(humanizeIds("player wins Head of Household", entities)).toBe("Hero wins Head of Household");
    expect(humanizeIds("the vote is read: player", entities)).toBe("the vote is read: Hero");
    expect(humanizeIds("npc:1 evicts player", entities)).toBe("Ada evicts Hero"); // final-eviction beat shape
  });
});

/**
 * The post-season retrospective scrub (0048) — STRONGER than `humanizeIds`: it also resolves ids hidden
 * inside COMPOUND machine tokens (`thread:npc:8:0`), drops the bare `thread:` identifier, and translates
 * the audit slugs/labels into readable prose — WITHOUT re-introducing the A8 "players" mangle for the
 * bare-word player id. HARD rule: roles only — the "names" are obvious placeholders.
 */
describe("0048 — humanizeForRetrospective resolves embedded ids + de-slugs, keeping ordinary words", () => {
  const entities = [
    { id: PLAYER, name: "Hero" },
    { id: npc(8), name: "Nominee" },
    { id: npc(3), name: "Veteran" },
  ];

  it("resolves an `npc:N` EMBEDDED in a compound `thread:npc:N:M` id and drops the wrapper", () => {
    const raw = "story-thread thread:npc:8:0 [dormant]\npremise: secret — keeps a secret\nsurfaces via: overheard";
    const out = humanizeForRetrospective(raw, entities);
    expect(out).toContain("Nominee");               // the embedded npc:8 resolved to its NAME
    expect(out).not.toMatch(/\bnpc:\d+\b/);          // no raw id
    expect(out).not.toMatch(/\bthread:/);            // no raw thread identifier
    expect(out).not.toContain("[dormant]");          // slug translated
    expect(out).toContain("never surfaced");
    expect(out).not.toContain("surfaces via:");      // pathway label dropped
  });

  it("resolves a bare `npc:N` AND a `player` id but never mangles the ordinary word 'players'", () => {
    const raw = "deep-profile npc:3 | true-goals: let the loud players take the heat | day-1 read of player: a possible ally";
    const out = humanizeForRetrospective(raw, entities);
    expect(out).toContain("Veteran");                // npc:3 → name
    expect(out).toContain("players");                // the ordinary word is intact (NOT "Heros")
    expect(out).not.toContain("Heros");
    expect(out).not.toMatch(/\bnpc:\d+\b/);
    expect(out).not.toContain("deep-profile");
    expect(out).not.toContain("true-goals:");
    expect(out).not.toContain("day-1 read of player:");
    expect(out).not.toContain(" | ");                // the list separator became readable
  });

  it("is idempotent and strips a bare thread id even with no roster", () => {
    const once = humanizeForRetrospective("story-thread thread:npc:8:0 [resolved]", entities);
    expect(humanizeForRetrospective(once, entities)).toBe(once);
    expect(humanizeForRetrospective("thread:npc:8:0 [dormant]", [])).not.toMatch(/thread:|\[dormant\]/);
  });

  // #844 — a knowledge/gossip BREADCRUMB pathway slug must collapse to a calm gloss with NO orphan
  // surname stranded and NO stray `via :` colon, regardless of where id resolution lands.
  it("collapses a gossip/surfacing pathway slug with no orphan name and no stray colon (#844)", () => {
    const teller = [{ id: "player", name: "Hero" }, { id: "npc:8", name: "Pat Garner" }, { id: "npc:3", name: "Lee Vance" }];
    // The `gossip ${pathway} reaches ${to}` breadcrumb: a `told-by:<id>` slug — the teller's id is INSIDE
    // the slug, so resolving it first would strand the surname. It must not.
    const gossip = humanizeForRetrospective("gossip told-by:npc:8 reaches npc:3", teller);
    expect(gossip).not.toMatch(/\bnpc:\d+\b/);
    expect(gossip).not.toContain("Garner");       // no orphan surname stranded after the gloss
    expect(gossip).not.toMatch(/\btold-by\b/);
    expect(gossip).toContain("Lee Vance");        // the recipient (a clean trailing id) still resolves
    // The `surfaced to ${entity} via ${pathway}` breadcrumb: a colon-pathway whose keyword could be
    // stripped upstream, leaving `via :…`. It must not.
    const surf = humanizeForRetrospective("surfaced to npc:3 via overheard:offscreen:alliance:1:594987875", teller);
    expect(surf).not.toMatch(/via\s+:/);          // no stray `via :`
    expect(surf).not.toMatch(/(?:^|\s):[\w-]+:/); // no orphan colon-led machine fragment
    expect(surf).toContain("Lee Vance");
  });

  // #845 — the retrospective unseals AUTHORED deep-profile prose where "player" is a COMMON NOUN. The
  // bare-word player id is never a hidden-scene subject (hidden scenes exclude the player) and the
  // day-1-read label is pre-translated to "you", so a literal "player" must NEVER become the player name.
  it("never turns the COMMON NOUN 'player' into the player's name in deep-profile prose (#845)", () => {
    // The live repro shape: a true-goal that contains the singular word "player" (any modifier, not just
    // a determiner) — npc:3 still resolves, but "player" stays a word.
    const raw = "deep-profile npc:3 | true-goals: be the strongest player and outlast every player here";
    const out = humanizeForRetrospective(raw, entities);
    expect(out).toContain("Veteran");        // npc:3 → name
    expect(out).toContain("strongest player"); // the common noun is intact
    expect(out).toContain("every player");
    expect(out).not.toContain("Hero");       // the player name never leaked into authored prose
    expect(out).not.toMatch(/\bnpc:\d+\b/);
  });
});
