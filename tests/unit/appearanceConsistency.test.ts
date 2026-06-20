import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { generateHouse, portraitDescriptorFor } from "../../src/engine/characterFactory";
import { physicalFacetToAppearance } from "../../src/engine/portraitPrompts";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";

/**
 * L29 single-source-of-truth guard (appearance/physicalCharacteristics consistency).
 *
 * The bug: the prose `appearance` (0004) and the structured `physicalCharacteristics` (0058) were
 * generated from INDEPENDENT pools and never reconciled, so a houseguest's two physical descriptions
 * contradicted each other (petite vs stocky, olive vs golden-brown, buzzcut vs long auburn). The
 * structured facet is the single source of truth the portrait AND the narration share, so this suite
 * makes that structural:
 *   1. no outward projection (house card / npcVoice persona) ships BOTH descriptors at once;
 *   2. the persisted prose `appearance` is DERIVED from the structured facet (cannot contradict it);
 *   3. `portraitDescriptorFor` reads through the single source whenever a facet exists.
 */
describe("L29 — appearance ↔ physicalCharacteristics never contradict", () => {
  const SEEDS = [1, 7, 42, 99, 2026];
  const freshView = (seed: number) => {
    const a = new GameSessionAdapter();
    return { a, view: a.createCharacter({ playerName: "The Player", seed }) };
  };

  it("no house card carries BOTH appearance and physicalCharacteristics", () => {
    for (const seed of SEEDS) {
      const { view } = freshView(seed);
      expect(view.house.length).toBe(15);
      for (const card of view.house) {
        // a fresh 0058 cast ships the structured facet …
        expect(card.physicalCharacteristics, `npc ${card.id} @${seed} missing facet`).toBeTruthy();
        // … and therefore NEVER the redundant prose alongside it.
        expect(card.appearance, `card ${card.id} @${seed} ships both descriptors`).toBeUndefined();
      }
    }
  });

  it("no npcVoice persona carries BOTH appearance and physicalCharacteristics", () => {
    for (const seed of SEEDS) {
      const { a, view } = freshView(seed);
      for (const card of view.house) {
        const voice = a.npcVoice(card.id);
        if (!voice) continue;
        const p = voice.persona;
        expect(
          p.appearance !== undefined && p.physicalCharacteristics !== undefined,
          `voice ${card.id} @${seed} carries both`,
        ).toBe(false);
        expect(p.physicalCharacteristics, `voice ${card.id} @${seed} missing facet`).toBeTruthy();
      }
    }
  });

  it("the persisted prose appearance is DERIVED from the structured facet (cannot contradict it)", () => {
    for (const seed of SEEDS) {
      const { a } = freshView(seed);
      // The snapshot exposes the stored static Character (the engine-side persistence shape).
      const snap = a.snapshot() as { house?: { npcs: ReadonlyArray<{ id: string; character: { appearance: string; physicalCharacteristics?: import("../../src/domain/physicalCharacteristics").PhysicalCharacteristics } }> } };
      const npcs = snap.house?.npcs ?? [];
      expect(npcs.length).toBe(15);
      for (const n of npcs) {
        const c = n.character;
        expect(c.physicalCharacteristics, `npc ${n.id} @${seed}`).toBeTruthy();
        expect(c.appearance, `npc ${n.id} @${seed} appearance not derived from facet`)
          .toBe(physicalFacetToAppearance(c.physicalCharacteristics!));
      }
    }
  });

  it("portraitDescriptorFor reads through the single source (facet authors the look; prose only as fallback)", () => {
    // generateHouse alone seeds NO structured facet → the descriptor falls back to the prose (unchanged).
    const noFacet = generateHouse(new SeededRandom(11)).npcs[0]!;
    expect(noFacet.character.physicalCharacteristics).toBeUndefined();
    expect(portraitDescriptorFor(noFacet).appearance).toBe(noFacet.character.appearance);

    // With a structured facet present, the descriptor is AUTHORED by it — never the stale prose.
    const facet = {
      heightBuild: "tall and rangy", skinTone: "deep brown skin", hair: "long dark waves",
      facialFeatures: "strong cheekbones", distinguishingMark: "none notable",
      ageLook: "youthful, early-twenties energy", style: "sporty and laid-back",
    };
    const withFacet = { name: noFacet.name, character: { ...noFacet.character, appearance: "STALE prose blurb", physicalCharacteristics: facet } };
    const d = portraitDescriptorFor(withFacet);
    expect(d.appearance).toBe(physicalFacetToAppearance(facet));
    expect(d.appearance).not.toContain("STALE");
  });
});
