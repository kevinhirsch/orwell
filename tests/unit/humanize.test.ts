import { describe, it, expect } from "vitest";
import { humanizeIds } from "../../src/adapters/engine/humanize";
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
