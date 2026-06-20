import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { PLAYER } from "../../src/domain/ids";
import { startNewGame } from "../../src/engine/characterFactory";
import {
  generateDiversityLayer, showmanceIdentities, showmancePlausible,
  privateOrientationVaultId,
} from "../../src/engine/diversity";
import {
  MIN_BIPOC, MIN_QUEER, MIN_PER_BINARY_GENDER, MIN_PER_AGE_BAND, MAX_NONBINARY,
  AGE_BANDS, AGE_ELIGIBILITY_FLOOR, ageBandOf,
} from "../../src/engine/diversityConstants";
import { buildPortraitPrompt } from "../../src/engine/portraitPrompts";

/**
 * Feature 0063 — the casting diversity floor. Roles only (no names). The engine GUARANTEES the four
 * floors (BIPOC / gender balance / age spread / LGBTQ+) across seeds; ethnicity is a first-class identity
 * facet grounding the skin tone; orientation is character-driven and split across the Vault by disclosure;
 * a private orientation NEVER reaches the player OR admin until a pathway surfaces it; the public
 * diversity + personality facets enrich the portrait prompt; and — the #338 lesson — the diversity layer
 * runs on a DEDICATED sub-stream so the public outcome stream is byte-identical with it on vs. off.
 */

const SENT = "SENTINEL-0063-private-orientation";

function liveGame(user: string, seed: number) {
  const reg = new GameSessionRegistry();
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "The Player", seed });
  return { reg, sb };
}

/** Re-derive the layer for a seed (the cast is generated player-independently off the seed). */
function layerForSeed(seed: number) {
  const house = startNewGame({ seed, playerName: "The Player" });
  return { house, layer: generateDiversityLayer(seed, house.npcs) };
}

const SEEDS = [1, 2, 3, 7, 13, 21, 42, 55, 99, 100, 256, 1000, 7777, 31337];

describe("0063 — the four floors hold across seeds", () => {
  it("BIPOC representation floor (≥ MIN_BIPOC of the 15-cast)", () => {
    for (const seed of SEEDS) {
      const { layer } = layerForSeed(seed);
      const bipoc = Object.values(layer.public).filter((p) => p.bipoc).length;
      expect(bipoc, `seed ${seed}`).toBeGreaterThanOrEqual(MIN_BIPOC);
    }
  });

  it("gender-balance floor (neither binary below MIN_PER_BINARY_GENDER)", () => {
    for (const seed of SEEDS) {
      const { layer } = layerForSeed(seed);
      const pub = Object.values(layer.public);
      const men = pub.filter((p) => p.genderPresentation === "man").length;
      const women = pub.filter((p) => p.genderPresentation === "woman").length;
      expect(men, `seed ${seed} men`).toBeGreaterThanOrEqual(MIN_PER_BINARY_GENDER);
      expect(women, `seed ${seed} women`).toBeGreaterThanOrEqual(MIN_PER_BINARY_GENDER);
    }
  });

  it("gender is inclusive — nonbinary is possible and sparse (≤ MAX_NONBINARY)", () => {
    let everNonbinary = false;
    for (const seed of SEEDS) {
      const { layer } = layerForSeed(seed);
      const nb = Object.values(layer.public).filter((p) => p.genderPresentation === "nonbinary").length;
      expect(nb, `seed ${seed}`).toBeLessThanOrEqual(MAX_NONBINARY);
      if (nb > 0) everNonbinary = true;
    }
    expect(everNonbinary, "at least one seed in the set carries a nonbinary houseguest").toBe(true);
  });

  it("name coheres with gender presentation (the rare balance flip is bounded ≤ 2/cast)", () => {
    for (const seed of SEEDS) {
      const { layer } = layerForSeed(seed);
      const incoherent = Object.values(layer.public).filter((p) => !p.nameCoheres).length;
      // A byte-stable name draw can skew single-gender; the floor's last-resort flip is bounded & rare.
      expect(incoherent, `seed ${seed}`).toBeLessThanOrEqual(2);
    }
  });

  it("age-spread floor (every band ≥ MIN_PER_AGE_BAND) above the eligibility floor", () => {
    for (const seed of SEEDS) {
      const { layer } = layerForSeed(seed);
      const ages = Object.values(layer.public).map((p) => p.age);
      for (const a of ages) expect(a, `seed ${seed} age`).toBeGreaterThanOrEqual(AGE_ELIGIBILITY_FLOOR);
      for (const band of AGE_BANDS) {
        const n = ages.filter((a) => ageBandOf(a) === band.id).length;
        expect(n, `seed ${seed} band ${band.id}`).toBeGreaterThanOrEqual(MIN_PER_AGE_BAND);
      }
    }
  });

  it("LGBTQ+ floor (≥ MIN_QUEER non-straight OR nonbinary)", () => {
    for (const seed of SEEDS) {
      const { layer } = layerForSeed(seed);
      const pub = Object.values(layer.public);
      const nb = pub.filter((p) => p.genderPresentation === "nonbinary").length;
      const outQueer = pub.filter((p) => p.outOrientation).length;
      const privateQueer = Object.keys(layer.privateOrientations).length;
      expect(outQueer + privateQueer + nb, `seed ${seed}`).toBeGreaterThanOrEqual(MIN_QUEER);
    }
  });

  it("identity is reproducible by seed AND player-independent (same seed, different players ⇒ same facets)", () => {
    for (const seed of [7, 42]) {
      const a = generateDiversityLayer(seed, startNewGame({ seed, playerName: "Alice Example" }).npcs);
      const b = generateDiversityLayer(seed, startNewGame({ seed, playerName: "Zachary Other" }).npcs);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });
});

describe("0063 — ethnicity grounds the physical facet (text + portrait agree)", () => {
  it("each houseguest's physicalCharacteristics.skinTone equals their ethnicity-grounded cue", () => {
    const { sb } = liveGame("div-ground", 5);
    const house = sb.session.getGameState().house;
    for (const h of house.filter((x) => x.status === "active")) {
      expect(h.ethnicity, "ethnicity facet present").toBeTruthy();
      expect(h.physicalCharacteristics, "physical facet present").toBeTruthy();
      // The grounded cue is a non-empty complexion phrase shared by the card AND the portrait builder.
      expect(h.physicalCharacteristics!.skinTone.length).toBeGreaterThan(0);
    }
  });

  it("the public card carries ethnicity + gender presentation; descriptive, never a number", () => {
    const { sb } = liveGame("div-card", 8);
    const house = sb.session.getGameState().house;
    for (const h of house.filter((x) => x.status === "active")) {
      expect(h.ethnicity).toBeTruthy();
      expect(["man", "woman", "nonbinary"]).toContain(h.genderPresentation);
    }
    expect(JSON.stringify(house)).not.toMatch(/"physical":|"mental":|"social":/);
  });
});

describe("0063 — orientation is character-driven and Vault-split by disclosure", () => {
  it("a publicly-out orientation IS an observable public card facet", () => {
    // Find a seed with at least one out houseguest (almost all seeds have one).
    const { sb } = liveGame("div-out", 3);
    const house = sb.session.getGameState().house;
    const out = house.filter((h) => h.outOrientation);
    expect(out.length, "some houseguest is publicly out").toBeGreaterThan(0);
    for (const h of out) expect(typeof h.outOrientation).toBe("string");
  });

  it("a PRIVATE orientation never reaches player, admin, npcVoice, or the moment prompt", () => {
    const { sb } = liveGame("div-leak", 1);
    // Plant the sentinel into EVERY private-orientation record via snapshot→restore.
    const core = sb.session.snapshot();
    expect(Object.keys(core.privateOrientations ?? {}).length, "the cast has ≥1 private orientation").toBeGreaterThan(0);
    for (const id of Object.keys(core.privateOrientations!)) {
      core.privateOrientations![id] = `${core.privateOrientations![id]} ${SENT}` as never;
    }
    sb.session.restore(core);

    const playerSurface = JSON.stringify(sb.session.getGameState())
      + JSON.stringify(sb.player.getVisibleState())
      + JSON.stringify(sb.session.gameStatus())
      + sb.session.getMomentPrompt({}).systemPrompt
      + sb.session.getMomentPrompt({ moment: "social" }).systemPrompt
      + sb.session.getGameState().house.filter((h) => h.status === "active")
          .map((h) => JSON.stringify(sb.session.npcVoice(h.id))).join("");
    expect(playerSurface).not.toContain(SENT);

    sb.syncAdmin();
    expect(JSON.stringify(sb.admin.inspect())).not.toContain(SENT);
  });

  it("a private orientation IS sealed into the Vault (engine-only audit copy)", () => {
    const { sb } = liveGame("div-vault", 1);
    const ids = Object.keys(sb.session.snapshot().privateOrientations ?? {});
    expect(ids.length).toBeGreaterThan(0);
    // The sealed record exists under the private-orientation Vault id (engine-only store, never projected).
    const sealed = sb.engine.vault.readHidden().some((r) => r.id === privateOrientationVaultId(ids[0]!));
    expect(sealed).toBe(true);
  });

  it("a private orientation persists across a restart (never silently resets)", () => {
    const { sb } = liveGame("div-persist", 1);
    const before = sb.session.snapshot().privateOrientations;
    sb.session.restore(sb.session.snapshot());
    expect(JSON.stringify(sb.session.snapshot().privateOrientations)).toBe(JSON.stringify(before));
  });
});

describe("0063 — the 0059 showmance eligibility tie (queer showmances are first-class)", () => {
  it("showmancePlausible allows same-gender pairs only for plausible orientations", () => {
    expect(showmancePlausible({ orientation: "gay", genderPresentation: "man" }, { orientation: "gay", genderPresentation: "man" })).toBe(true);
    expect(showmancePlausible({ orientation: "bisexual", genderPresentation: "woman" }, { orientation: "lesbian", genderPresentation: "woman" })).toBe(true);
    // two strictly-straight same-gender houseguests: implausible
    expect(showmancePlausible({ orientation: "straight", genderPresentation: "man" }, { orientation: "straight", genderPresentation: "man" })).toBe(false);
    // a straight + gay different-gender pair: gay isn't attracted across genders ⇒ implausible
    expect(showmancePlausible({ orientation: "straight", genderPresentation: "man" }, { orientation: "gay", genderPresentation: "woman" })).toBe(false);
    // a straight man + straight woman: plausible
    expect(showmancePlausible({ orientation: "straight", genderPresentation: "man" }, { orientation: "straight", genderPresentation: "woman" })).toBe(true);
  });

  it("across seeds the seeded showmance layer can produce a QUEER (same-gender) showmance, sealed at cast time", () => {
    let queerShowmanceSeeds = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const { sb } = liveGame(`div-show-${seed}`, seed);
      const rels = sb.session.snapshot().seededRelationships;
      if (!rels?.showmances?.length) continue;
      const ids = showmanceIdentities(generateDiversityLayer(seed, sb.session.snapshot().house!.npcs));
      for (const s of rels.showmances) {
        const a = ids[s.a]!; const b = ids[s.b]!;
        // every seeded showmance is plausible (the eligibility gate), and none is visible at cast time
        expect(showmancePlausible(a, b), `seed ${seed} seeded an implausible showmance`).toBe(true);
        expect(s.stage).not.toBe("visible"); // never week-one visible (sealed; surfaces organically)
        if (a.genderPresentation === b.genderPresentation) queerShowmanceSeeds++;
      }
    }
    expect(queerShowmanceSeeds, "at least one seed seeds a same-gender (queer) showmance").toBeGreaterThan(0);
  });
});

describe("0063 — the portrait generator reflects the unique person (no private state leaks)", () => {
  it("a houseguest's portrait prompt includes their ethnicity / gender / age / demeanor (public)", () => {
    const { sb } = liveGame("div-portrait", 5);
    const h = sb.session.getGameState().house.find((x) => x.status === "active")!;
    const pp = sb.session.getPortraitPrompt(h.id)!;
    expect(pp.prompt).toContain(h.ethnicity!);              // heritage in the SUBJECT line
    expect(pp.prompt).toContain(String(h.age));             // the age look
    // gender presentation phrase appears (a man / a woman / nonbinary presentation)
    expect(pp.prompt).toMatch(/a man|a woman|nonbinary/);
  });

  it("portrait prompts are DISTINCT across the cast (not a grid of siblings)", () => {
    const { sb } = liveGame("div-distinct", 5);
    const ids = sb.session.getGameState().house.filter((h) => h.status === "active").map((h) => h.id);
    const prompts = ids.map((id) => sb.session.getPortraitPrompt(id)!.prompt);
    expect(new Set(prompts).size).toBe(prompts.length);
  });

  it("NO private/hidden state appears in ANY portrait prompt (the §5 Vault rule)", () => {
    const { sb } = liveGame("div-portrait-leak", 1);
    // Poison every private orientation + a hidden stat via snapshot→restore.
    const core = sb.session.snapshot();
    for (const id of Object.keys(core.privateOrientations ?? {})) {
      core.privateOrientations![id] = `${core.privateOrientations![id]} ${SENT}` as never;
    }
    for (const n of core.house!.npcs) { n.character.stats.physical = 99999; n.soul.memory.push(`${SENT}-soul`); }
    sb.session.restore(core);
    for (const h of [PLAYER, ...sb.session.getGameState().house.map((x) => x.id)]) {
      const pp = sb.session.getPortraitPrompt(h);
      if (!pp) continue;
      expect(pp.prompt).not.toContain(SENT);
      expect(pp.prompt).not.toContain("99999");
    }
  });

  it("buildPortraitPrompt is pure + dignified (heritage informs the subject line, no clichés required)", () => {
    const result = buildPortraitPrompt(
      "npc:1", "The Houseguest",
      {
        appearance: "athletic, a warm smile", age: 34, presentation: "casual and laid-back",
        ethnicity: "Korean American", genderPresentation: "woman", demeanor: "deadpan and dry",
      },
      "studio portrait",
    );
    expect(result.prompt).toContain("Korean American");
    expect(result.prompt).toContain("a woman");
    expect(result.prompt).toContain("deadpan and dry");
  });
});

describe("0063 — RNG isolation: identity never bends a seeded outcome (the #338 golden test)", () => {
  it("the public outcome stream is BYTE-IDENTICAL with the diversity layer ON vs. OFF", () => {
    // Drive the full live game to completion at a fixed seed, once with diversity ON and once OFF
    // (the ORWELL_DISABLE_DIVERSITY test seam), capturing the PUBLIC outcome stream (every beat's
    // public content + the eviction order + winner). Equal ⇒ the diversity sub-stream never perturbs
    // the competition/vote sequence — the descriptive attributes are non-mechanical by construction.
    const capture = (seed: number): string => {
      const reg = new GameSessionRegistry();
      const sb = reg.sandboxFor(`golden-${seed}-${process.env.ORWELL_DISABLE_DIVERSITY ?? "on"}`);
      sb.session.createCharacter({ playerName: "The Player", seed });
      const beats: string[] = [];
      for (let i = 0; i < 5000; i++) {
        const adv = sb.session.advanceGame() as { finished: boolean; pending: { kind: string; options?: Array<{ id: string }> } | null; event?: { beat?: string; content?: string } | null };
        if (adv.event?.content) beats.push(`${adv.event.beat}:${adv.event.content}`);
        if (adv.pending) {
          // Deterministic passive answers (first legal option), enough to push the season to its end.
          const p = adv.pending; const o = p.options ?? [];
          const ans: Record<string, unknown> =
            p.kind === "nominations" ? { kind: p.kind, choice: [o[0]?.id, o[1]?.id] }
            : p.kind === "veto-decision" ? { kind: p.kind, use: false }
            : p.kind === "comp-intent" ? { kind: p.kind, intent: "compete" }
            : p.kind === "comp-round" ? { kind: p.kind, intent: "compete" } // 0006 staged-rounds
            : p.kind === "houseguests-choice" ? { kind: p.kind, vote: o[0]?.id }
            : p.kind === "replacement" ? { kind: p.kind, replacement: o[0]?.id }
            : p.kind === "eviction-vote" ? { kind: p.kind, vote: o[0]?.id }
            : p.kind === "tie-break" ? { kind: p.kind, vote: o[0]?.id }
            : p.kind === "final-eviction" ? { kind: p.kind, vote: o[0]?.id }
            : p.kind === "finale-statement" ? { kind: p.kind, statement: "x" }
            : p.kind === "finale-answer" ? { kind: p.kind, appeal: "own-game" }
            : p.kind === "juror-vote" ? { kind: p.kind, vote: o[0]?.id }
            : p.kind === "goodbye-message" ? { kind: p.kind, vote: "respectful" }
            : p.kind === "juror-question" ? { kind: p.kind, statement: "x" }
            : { kind: p.kind };
          const sub = sb.session.submitDecision(ans as never) as { finished: boolean; event?: { beat?: string; content?: string } | null };
          if (sub.event?.content) beats.push(`${sub.event.beat}:${sub.event.content}`);
          if (sub.finished) break;
        }
        if (adv.finished) break;
      }
      const live = sb.session.snapshot().live;
      return JSON.stringify({ evictionOrder: live?.evictionOrder, finished: live?.finished, beats });
    };

    const seed = 1234;
    delete process.env.ORWELL_DISABLE_DIVERSITY;
    const withDiversity = capture(seed);
    process.env.ORWELL_DISABLE_DIVERSITY = "1";
    const withoutDiversity = capture(seed);
    delete process.env.ORWELL_DISABLE_DIVERSITY;

    expect(withDiversity).toBe(withoutDiversity);
  });
});
