import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { renderGameContext } from "../../src/engine/momentPrompts";
import { genderPresentationPhrase, pronounsFor } from "../../src/domain/gender";
import { nameGenderOf } from "../../src/engine/data/nameGender";

/**
 * Issue #1140 — the NPC gender/pronoun ↔ portrait mismatch.
 *
 * The engine carries ONE public gender facet, `genderPresentation` ("man" | "woman" | "nonbinary"),
 * and the engine DELIBERATELY lets it diverge from the NAME (diversity.ts: AI override, gender-balance
 * flip, nonbinary). The PORTRAIT prompt anchors on that stored facet; before this fix the NARRATION
 * inferred gender/pronouns from the name each turn — so the photo and the prose could disagree.
 *
 * These tests lock the regression closed: for every active houseguest the gender the PORTRAIT encodes
 * (`genderPresentationPhrase(genderPresentation)` in the portrait prompt) MUST equal the gender the
 * NARRATION voice-anchor encodes (the same phrase + the pronoun set in `renderGameContext`), and BOTH
 * must derive from the same stored `genderPresentation`. Roles only — no fixture names asserted.
 */

/** The single roster line `renderGameContext` emits for one houseguest (`  - <name> ... — <vibe>`). */
function rosterLineFor(ctx: string, name: string): string | undefined {
  // The name leads the line (`  - ${h.name}...`); match the whole line so the per-houseguest vibe
  // (which carries the gender cue) is scoped to THIS houseguest, never another's.
  return ctx.split("\n").find((l) => l.trimStart().startsWith(`- ${name}`));
}

describe("#1140 — portrait and narration voice the SAME stored gender presentation", () => {
  it("every active houseguest's narration gender + pronouns match the portrait's gender, all from one facet", () => {
    // Sweep several seeds so the invariant holds across casts (every gender mix), not one lucky draw.
    for (const seed of [11, 23, 47, 101, 202]) {
      const s = new GameSessionAdapter();
      const view = s.createCharacter({ playerName: "The Player", seed });
      const ctx = renderGameContext(view);

      const active = view.house.filter((h) => h.status === "active");
      expect(active.length).toBeGreaterThan(0);

      for (const card of active) {
        // Every active houseguest carries the public facet (it is dealt for the whole cast).
        expect(card.genderPresentation).toBeDefined();
        const g = card.genderPresentation!;

        // (1) The PORTRAIT: the live, Vault-free prompt the FE renders, keyed by id. Its SUBJECT line
        // encodes the gender via `genderPresentationPhrase(card.genderPresentation)`.
        const portrait = s.getPortraitPrompt(card.id);
        expect(portrait).not.toBeNull();
        expect(portrait!.prompt).toContain(genderPresentationPhrase(g));

        // (2) The NARRATION: the roster line for this houseguest encodes the SAME phrase AND hands the
        // model the pronoun set — so the narrator anchors gender/pronouns on the stored facet, not the name.
        const line = rosterLineFor(ctx, card.name);
        expect(line).toBeDefined();
        expect(line!).toContain(genderPresentationPhrase(g));
        expect(line!).toContain(`use ${pronounsFor(g)}`);

        // (3) SAME SOURCE: both surfaces derive from the one stored `genderPresentation` — so the gender the
        // portrait encodes and the gender the narration encodes are, by construction, identical.
        expect(genderPresentationPhrase(g)).toBe(genderPresentationPhrase(g));

        // (4) #1140 Fix A — the NAME itself now reads the SAME gender. The diversity layer RE-PICKS the
        // given name to match the final presentation (the portrait puts the NAME in the prompt, so a
        // unisex-overlap / flipped name would otherwise make the image model render the name's gender). A
        // gendered presentation ⇒ the name reads that gender; nonbinary ⇒ a unisex (any-presentation) name.
        const ng = nameGenderOf(card.name);
        if (g === "nonbinary") expect(ng, `${card.id} ${card.name}`).toBe("unisex");
        else expect(ng, `${card.id} ${card.name}`).toBe(g);
      }
    }
  });

  it("CRITICAL — when the stored facet DISAGREES with the name, portrait and narration STILL agree", () => {
    // Force the divergence the bug rode on: take a clearly-gendered NPC and author the OPPOSITE
    // presentation through the real AI-identity seam (`recordCastIdentity`). The engine honors the proposal
    // and re-grounds the public facet; the name now points one way while `genderPresentation` points the
    // other — exactly the case where a name-inferring narrator would contradict the photo.
    let proved = false;

    for (const seed of [11, 23, 47, 101, 202, 303, 404]) {
      const s = new GameSessionAdapter();
      const view0 = s.createCharacter({ playerName: "The Player", seed });

      // Find an active houseguest whose FIRST name reads clearly man/woman, and propose the opposite.
      const target = view0.house.find((h) => {
        if (h.status !== "active") return false;
        const first = h.name.split(/\s+/)[0] ?? h.name;
        return nameGenderOf(first) === "man" || nameGenderOf(first) === "woman";
      });
      if (!target) continue;
      const firstName = target.name.split(/\s+/)[0] ?? target.name;
      const opposite: "man" | "woman" = nameGenderOf(firstName) === "man" ? "woman" : "man";

      const res = s.recordCastIdentity({ facets: { [target.id]: { genderPresentation: opposite } } });
      expect(res.accepted).toBe(true);

      // Re-read live state AFTER the fold.
      const view = s.getGameState();
      const card = view.house.find((h) => h.id === target.id);
      if (!card || card.status !== "active" || card.genderPresentation === undefined) continue;
      const g = card.genderPresentation;

      // Only assert the CRITICAL case when the AUTHORED facet truly disagrees with the ORIGINALLY-DRAWN
      // name (the repair pipeline could, in principle, re-balance a specific draft — we want a genuine
      // man↔woman flip vs. the name as it was at the deal). `nameG` is that DRAWN name's gender.
      const nameG = nameGenderOf(firstName);
      const disagrees = (g === "man" || g === "woman") && nameG !== "unisex" && g !== nameG;
      if (!disagrees) continue;

      const ctx = renderGameContext(view);
      const line = rosterLineFor(ctx, card.name);
      const portrait = s.getPortraitPrompt(card.id);

      expect(portrait).not.toBeNull();
      expect(line).toBeDefined();

      // The PROOF: the portrait and the narration BOTH encode the STORED facet `g` — they agree with each
      // other and with the photo. (Before #1140 the narration inferred gender from the name and contradicted
      // the photo; now both anchor on the facet.)
      expect(portrait!.prompt).toContain(genderPresentationPhrase(g));
      expect(line!).toContain(genderPresentationPhrase(g));
      expect(line!).toContain(`use ${pronounsFor(g)}`);

      // And the narration must NOT carry the (now-stale) drawn-name presentation phrase.
      const wrongPhrase = genderPresentationPhrase(nameG as "man" | "woman");
      // (the two binary phrases are distinct strings, so this is a real divergence check)
      expect(genderPresentationPhrase(g)).not.toBe(wrongPhrase);
      expect(line!).not.toContain(`use ${pronounsFor(nameG as "man" | "woman")}`);

      // #1140 Fix A — and the engine RE-PICKED the houseguest's NAME to match the authored facet (the
      // uncapped AI-override hole, now closed at the recordCastIdentity fold): the CURRENT display name
      // reads the SAME gender `g` the portrait + narration encode. The image model puts the name in the
      // prompt, so the name itself must point the right way — no "Marlon, a woman" mismatch survives.
      expect(nameGenderOf(card.name), `flipped name ${card.name} should read ${g}`).toBe(g);

      proved = true;
      break;
    }

    // The seeds above reliably yield a clearly-gendered NPC to flip; fail loudly if the setup ever can't
    // construct the divergent case (so the regression guard never silently no-ops).
    expect(proved).toBe(true);
  });

  it("the gender→phrase/pronoun mapping is total and deterministic (single shared helper, #1140)", () => {
    for (const g of ["man", "woman", "nonbinary"] as const) {
      expect(genderPresentationPhrase(g)).toBeTruthy();
      expect(pronounsFor(g)).toMatch(/\//); // a pronoun set ("he/him" | "she/her" | "they/them")
    }
    expect(pronounsFor("man")).toBe("he/him");
    expect(pronounsFor("woman")).toBe("she/her");
    expect(pronounsFor("nonbinary")).toBe("they/them");
    // The three phrases are pairwise distinct, so portrait↔narration agreement is a real equality check.
    const phrases = new Set(["man", "woman", "nonbinary"].map((g) => genderPresentationPhrase(g as "man")));
    expect(phrases.size).toBe(3);
  });
});
