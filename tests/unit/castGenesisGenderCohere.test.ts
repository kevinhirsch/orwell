import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { nameGenderOf } from "../../src/engine/data/nameGender";

// F2 — `recordCastGenesis` must re-cohere the model-authored NAME against the pinned `genderPresentation`
// BY CONSTRUCTION, right when the names land, instead of relying on the later best-effort FE-driven
// `recordCastIdentity` call. When that identity call degrades (no utility model / a reply that fails to
// parse — the exact gender-drop failure), a clearly-wrong-gender name used to ship straight to the portrait
// + narration. Here we author a wrong-gender name and finalize the season WITHOUT ever calling
// recordCastIdentity, then assert the committed name reads coherent with the (unchanged floor) gender.
// Roles only — the "wrong" given tokens are lexicon probes, never a paired identity.

describe("F2 — recordCastGenesis re-coheres name↔gender without a later recordCastIdentity call", () => {
  it("a wrong-gender authored name is re-picked to a same-gender name; the pin is untouched", () => {
    const s = new GameSessionAdapter();
    const SEED = 987654;
    const warm = s.preSeedCast({ seed: SEED });
    // A binary-gendered warmed houseguest — a lone gendered NAME can only contradict a man/woman pin.
    const target = warm.house.find((c) => c.genderPresentation === "man" || c.genderPresentation === "woman")!;
    expect(target, "the warmed cast should carry a binary-gendered houseguest").toBeTruthy();
    const pin = target.genderPresentation as "man" | "woman";
    const opposite = pin === "man" ? "woman" : "man";
    // Author a given name that reads UNAMBIGUOUSLY as the OPPOSITE gender (both tokens are lexicon-clear
    // and NOT unisex, so `nameGenderOf` is the opposite of the pin).
    const wrongGiven = pin === "man" ? "Emma" : "James";
    expect(nameGenderOf(wrongGiven)).toBe(opposite); // the probe is genuinely contradictory

    const gen = s.recordCastGenesis({ npcs: [{ id: target.id, name: `${wrongGiven} Rivera` }] });
    expect(gen.accepted).toBe(true);
    expect(gen.committed).toBeGreaterThanOrEqual(1);

    // Finalize straight to a live season (adopts the warm) — NO recordCastIdentity was ever called.
    s.createCharacter({ playerName: "The Player", seed: SEED });

    const live = s.getGameState().house.find((h) => h.id === target.id)!;
    expect(live, "the target survives to the live cast").toBeTruthy();
    // The pin is unchanged — identity never ran, so it is still the floor gender.
    expect(live.genderPresentation).toBe(pin);
    // The committed given name no longer reads as the OPPOSITE gender (F2 re-cohered it by construction).
    const given = live.name.split(" ")[0]!;
    expect(nameGenderOf(given)).not.toBe(opposite);
  });

  it("a coherent (or unisex) authored name is left byte-identical (no gratuitous re-pick)", () => {
    const s = new GameSessionAdapter();
    const SEED = 424242;
    const warm = s.preSeedCast({ seed: SEED });
    const target = warm.house.find((c) => c.genderPresentation === "man" || c.genderPresentation === "woman")!;
    const pin = target.genderPresentation as "man" | "woman";
    // A UNISEX given name coheres with ANY presentation — it must NOT be re-picked.
    const gen = s.recordCastGenesis({ npcs: [{ id: target.id, name: "Jordan Rivera" }] });
    expect(gen.accepted).toBe(true);
    s.createCharacter({ playerName: "The Player", seed: SEED });
    const live = s.getGameState().house.find((h) => h.id === target.id)!;
    expect(live.genderPresentation).toBe(pin);
    expect(live.name).toBe("Jordan Rivera"); // unisex kept verbatim
  });
});
