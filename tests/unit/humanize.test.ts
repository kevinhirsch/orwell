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
});
