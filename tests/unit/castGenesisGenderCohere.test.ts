import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { nameGenderOf } from "../../src/engine/data/nameGender";
import type { GameStateView } from "../../src/ports/GameSession";

// NOTE: `castingIntake.ts` keeps these two regexes module-PRIVATE (they are not exported), so we
// re-declare the same literals here rather than reach into production source. See the report's
// "nit #3" note — exporting them would mean editing production source, which this change is scoped
// NOT to do; the duplication is low-value and deliberately left.
const MASC_PRONOUN_RE = /\b(he|him|his|himself)\b/i;
const FEM_PRONOUN_RE = /\b(she|her|hers|herself)\b/i;

// The Vault-only / engine-only cast fields the player-facing view must NEVER carry (HARD testing
// rule: a player-facing path isn't done until a test proves it returns no Vault data). These are
// the hidden cast material the engine holds internally on a Character/soul — `hiddenElements` (B50
// seeded secrets), the 0058 deep-profile HIDDEN half (`secrets`/`trueGoals`/`weakness`/
// `dayOnePerception`), the whole `soul`, the competition `stats`, the 0085 `influence` aptitudes,
// and the player's own authored `privateStrategy`. None appear on any public card by design; this
// is the canary that the gender-coherence repair path never regresses that projection.
const VAULT_ONLY_KEYS = [
  "hiddenElements",
  "secrets",
  "trueGoals",
  "weakness",
  "dayOnePerception",
  "soul",
  "stats",
  "influence",
  "privateStrategy",
] as const;

function assertVaultFree(obj: unknown): void {
  if (!obj || typeof obj !== "object") return;
  for (const key of VAULT_ONLY_KEYS) expect(obj).not.toHaveProperty(key);
}

/** Prove a `createCharacter` view is Vault-free: the top-level view, the player card, every
 * houseguest card, and each `castCoherence` entry expose no hidden cast material. */
function assertVaultFreeView(view: GameStateView): void {
  assertVaultFree(view);
  assertVaultFree(view.player);
  for (const card of view.house) assertVaultFree(card);
  for (const hg of view.castCoherence?.houseguests ?? []) assertVaultFree(hg);
}

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
//
// Shared setup: warm a floor cast, mutate one warmed houseguest into the target shape via the durable
// snapshot (the born-deep floor prose is always coherent, so mutating the warm is the only way to reach
// these cases), then finalize a live season that ADOPTS the warm — the point `enforceCastCoherence` runs.
type SessionSnapshot = ReturnType<GameSessionAdapter["snapshot"]>;
type PrewarmNpc = NonNullable<SessionSnapshot["prewarm"]>["npcs"][number];

function setupWithMutatedNpc(seed: number, mutate: (npc: PrewarmNpc) => void) {
  const warm = new GameSessionAdapter();
  warm.preSeedCast({ seed });
  const snap = warm.snapshot();
  const npc = snap.prewarm!.npcs[0]!;
  const targetId = npc.id;
  mutate(npc);

  const s = new GameSessionAdapter();
  s.restore(JSON.parse(JSON.stringify(snap)));
  const view = s.createCharacter({ playerName: "The Player", seed });
  const readPersisted = () => s.snapshot().house!.npcs.find((n) => n.id === targetId)!.character;
  return { view, targetId, readPersisted };
}

describe("Greptile P1 — soft nonbinary pronoun repairs are NOT skipped at the adapter coherence gate", () => {
  it("a nonbinary pin whose appearance carries a binary self-pronoun is rewritten to they/their in the PERSISTED character", () => {
    const SEED = 5150;
    const { view, targetId, readPersisted } = setupWithMutatedNpc(SEED, (npc) => {
      npc.character.genderPresentation = "nonbinary";
      // A SOFT contradiction: nonbinary pin + a stray binary self-pronoun in the portrait-facing prose.
      npc.character.appearance = "A lean, watchful presence; his sharp jaw and the scar over his left eyebrow give nothing away.";
      npc.character.physicalCharacteristics ??= {
        heightBuild: "lean", skinTone: "medium", hair: "cropped dark hair",
        facialFeatures: "sharp jaw", distinguishingMark: "none notable", ageLook: "late twenties", style: "muted",
      };
      npc.character.physicalCharacteristics.distinguishingMark = "a faint scar over his left eyebrow";
    });

    // HARD testing rule: the player-facing createCharacter view stays Vault-free even on the repair path.
    assertVaultFreeView(view);

    // The gate ran and reported this houseguest as REPAIRED (a correction is surfaced, never cloaked).
    expect(view.castCoherence?.repaired).toBeGreaterThanOrEqual(1);
    expect(view.castCoherence?.houseguests.some((h) => h.id === targetId && h.action === "repaired")).toBe(true);

    // The PERSISTED character (read back off the snapshot) no longer carries a binary pronoun — the
    // scrub neutralized he/his → singular they/their IN PLACE, preserving the descriptive detail.
    const persisted = readPersisted();
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
    const cleanAppearance = "A lean figure with a calm, watchful presence and neatly kept hair.";
    const { view, targetId, readPersisted } = setupWithMutatedNpc(SEED, (npc) => {
      npc.character.genderPresentation = "nonbinary";
      npc.character.appearance = cleanAppearance;
    });

    assertVaultFreeView(view);

    const persisted = readPersisted();
    // No repair field ⇒ the gate skips (the ok && empty-repairFields fast-path) ⇒ appearance verbatim.
    expect(persisted.appearance).toBe(cleanAppearance);
    expect(view.castCoherence?.houseguests.some((h) => h.id === targetId)).not.toBe(true);
  });

  it("a HARD man/woman contradiction still runs repair (unchanged behavior)", () => {
    const SEED = 909090;
    const { view, targetId, readPersisted } = setupWithMutatedNpc(SEED, (npc) => {
      npc.character.genderPresentation = "woman";
      // A HARD contradiction: a woman pin with a masculine self-pronoun in the portrait-facing prose.
      npc.character.appearance = "Broad-shouldered, moving through the room with his easy, confident swagger.";
    });

    assertVaultFreeView(view);

    expect(view.castCoherence?.houseguests.some((h) => h.id === targetId && h.action === "repaired")).toBe(true);
    const persisted = readPersisted();
    expect(persisted.genderPresentation).toBe("woman");
    // The masculine pronoun scrubbed to the feminine pin, detail preserved.
    expect(persisted.appearance).toMatch(/\bher\b/i);
    expect(MASC_PRONOUN_RE.test(persisted.appearance ?? "")).toBe(false);
    expect(persisted.appearance).toContain("swagger");
  });
});
