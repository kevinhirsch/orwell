import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { nameGenderOf } from "../../src/engine/data/nameGender";

const MASC_PRONOUN_RE = /\b(he|him|his|himself)\b/i;
const FEM_PRONOUN_RE = /\b(she|her|hers|herself)\b/i;

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

// Greptile P1 — "Soft repairs are skipped in the adapter". `enforceCastCoherence` (run at the ONE
// point the whole assembled dossier exists, at createCharacter finalize) used to early-`continue`
// whenever `validateDossierCoherence(...).ok` was true. The nonbinary-pronoun fix on this branch
// makes the validator return ok:true WITH a non-empty `repairFields` for a SOFT contradiction — a
// nonbinary pin carrying a stray binary self-pronoun ("his left eyebrow"). Short-circuiting on `ok`
// alone skipped `repairDossierCoherence`, so the nonbinary houseguest KEPT the binary pronoun into the
// persisted appearance/mark and the portrait prose shipped wrong. The caller now skips ONLY when
// `ok && repairFields.length === 0`, so a soft-but-repairable dossier falls through to repair.
// Roles/placeholder prose only — never a real name or a paired identity.
describe("Greptile P1 — soft nonbinary pronoun repairs are NOT skipped at the adapter coherence gate", () => {
  // Warm a floor cast, mutate one warmed houseguest into the target shape via the durable snapshot (the
  // born-deep floor prose is always coherent, so mutating the warm is the only way to reach these cases),
  // then finalize a live season that ADOPTS the warm — the point `enforceCastCoherence` runs.
  it("a nonbinary pin whose appearance carries a binary self-pronoun is rewritten to they/their in the PERSISTED character", () => {
    const SEED = 5150;
    const warm = new GameSessionAdapter();
    warm.preSeedCast({ seed: SEED });
    const snap = warm.snapshot();
    const npc = snap.prewarm!.npcs[0]!;
    const targetId = npc.id;
    npc.character.genderPresentation = "nonbinary";
    // A SOFT contradiction: nonbinary pin + a stray binary self-pronoun in the portrait-facing prose.
    npc.character.appearance = "A lean, watchful presence; his sharp jaw and the scar over his left eyebrow give nothing away.";
    npc.character.physicalCharacteristics ??= {
      heightBuild: "lean", skinTone: "medium", hair: "cropped dark hair",
      facialFeatures: "sharp jaw", distinguishingMark: "none notable", ageLook: "late twenties", style: "muted",
    };
    npc.character.physicalCharacteristics.distinguishingMark = "a faint scar over his left eyebrow";

    const s = new GameSessionAdapter();
    s.restore(JSON.parse(JSON.stringify(snap)));
    const view = s.createCharacter({ playerName: "The Player", seed: SEED });

    // The gate ran and reported this houseguest as REPAIRED (a correction is surfaced, never cloaked).
    expect(view.castCoherence?.repaired).toBeGreaterThanOrEqual(1);
    expect(view.castCoherence?.houseguests.some((h) => h.id === targetId && h.action === "repaired")).toBe(true);

    // The PERSISTED character (read back off the snapshot) no longer carries a binary pronoun — the
    // scrub neutralized he/his → singular they/their IN PLACE, preserving the descriptive detail.
    const persisted = s.snapshot().house!.npcs.find((n) => n.id === targetId)!.character;
    expect(persisted.genderPresentation).toBe("nonbinary"); // the pin (spine) is authoritative — untouched
    expect(persisted.appearance).toMatch(/\btheir\b/i);
    expect(MASC_PRONOUN_RE.test(persisted.appearance ?? "")).toBe(false);
    expect(FEM_PRONOUN_RE.test(persisted.appearance ?? "")).toBe(false);
    expect(persisted.appearance).toContain("left eyebrow"); // the detail survived the repair
    // The structured distinguishing mark is scrubbed the same way (portrait + narration share it).
    expect(persisted.physicalCharacteristics!.distinguishingMark).toMatch(/\btheir\b/i);
    expect(MASC_PRONOUN_RE.test(persisted.physicalCharacteristics!.distinguishingMark)).toBe(false);
  });

  it("a CLEAN nonbinary dossier (no binary pronoun) is left byte-identical — no spurious rewrite", () => {
    const SEED = 24680;
    const warm = new GameSessionAdapter();
    warm.preSeedCast({ seed: SEED });
    const snap = warm.snapshot();
    const npc = snap.prewarm!.npcs[0]!;
    const targetId = npc.id;
    npc.character.genderPresentation = "nonbinary";
    const cleanAppearance = "A lean figure with a calm, watchful presence and neatly kept hair.";
    npc.character.appearance = cleanAppearance;

    const s = new GameSessionAdapter();
    s.restore(JSON.parse(JSON.stringify(snap)));
    const view = s.createCharacter({ playerName: "The Player", seed: SEED });

    const persisted = s.snapshot().house!.npcs.find((n) => n.id === targetId)!.character;
    // No repair field ⇒ the gate skips (the ok && empty-repairFields fast-path) ⇒ appearance verbatim.
    expect(persisted.appearance).toBe(cleanAppearance);
    expect(view.castCoherence?.houseguests.some((h) => h.id === targetId)).not.toBe(true);
  });

  it("a HARD man/woman contradiction still runs repair (unchanged behavior)", () => {
    const SEED = 909090;
    const warm = new GameSessionAdapter();
    warm.preSeedCast({ seed: SEED });
    const snap = warm.snapshot();
    const npc = snap.prewarm!.npcs[0]!;
    const targetId = npc.id;
    npc.character.genderPresentation = "woman";
    // A HARD contradiction: a woman pin with a masculine self-pronoun in the portrait-facing prose.
    npc.character.appearance = "Broad-shouldered, moving through the room with his easy, confident swagger.";

    const s = new GameSessionAdapter();
    s.restore(JSON.parse(JSON.stringify(snap)));
    const view = s.createCharacter({ playerName: "The Player", seed: SEED });

    expect(view.castCoherence?.houseguests.some((h) => h.id === targetId && h.action === "repaired")).toBe(true);
    const persisted = s.snapshot().house!.npcs.find((n) => n.id === targetId)!.character;
    expect(persisted.genderPresentation).toBe("woman");
    // The masculine pronoun scrubbed to the feminine pin, detail preserved.
    expect(persisted.appearance).toMatch(/\bher\b/i);
    expect(MASC_PRONOUN_RE.test(persisted.appearance ?? "")).toBe(false);
    expect(persisted.appearance).toContain("swagger");
  });
});
