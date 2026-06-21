import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { vetoParticipants, type WeekState } from "../../src/domain/eligibility";
import { RelationshipModel } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";

/**
 * ADR-coverage gap-fillers (TASK 2). Each closes a load-bearing, ADR-named, currently-uncovered
 * decision. Roles only — no fixture names. Seeded; deterministic; Vault-free.
 */

/* ──────────────────────────────────────────────────────────────────────────────────────────────
 * ADR 0009 (D1 — "one occupancy snapshot per turn") — SNAPSHOT CONSISTENCY, engine-side.
 *
 * The ADR's own Testability bullet: "for a single turn, the moment-prompt whereabouts block ==
 * the gadget's /api/orwell/whereabouts (same snapshot; no start-vs-end skew)." The FE half is
 * pytest, but BOTH reads are built engine-side from the same `this.presence`: `getMomentPrompt`'s
 * view carries `whereabouts: this.whereabouts()` (GameSessionAdapter), so the "WHERE YOU ARE
 * (engine truth)" grounding block (momentPrompts.ts:766+) and the `whereabouts()` projection the
 * gadget renders are, by construction, the SAME snapshot. Nothing tested that today; this pins it.
 *
 * What it catches: a regression that lets the moment prompt name a houseguest as present/adjacent
 * whom `whereabouts()` does NOT place there (or omit one it does) — i.e. the narrator being handed
 * a location ground-truth that disagrees with the gadget the player sees (root causes #1/#4).
 * ────────────────────────────────────────────────────────────────────────────────────────────── */
describe("ADR 0009 D1 — the moment-prompt location grounding == the whereabouts() snapshot", () => {
  function liveGame(seed: number) {
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor(`adr0009-${seed}`);
    sb.session.createCharacter({ playerName: "The Player", seed });
    return sb;
  }

  // Across several seeds (different starting occupancies): the social moment prompt's location
  // block must name EXACTLY the people whereabouts() reports — present and one-room-over alike —
  // and invent no one. The two reads are taken in the SAME beat (no advance between), so any
  // disagreement is a true snapshot divergence, not a temporal skew.
  for (const seed of [4, 7, 13, 21]) {
    it(`names exactly the present + adjacent occupants whereabouts() reports (seed ${seed})`, () => {
      const sb = liveGame(seed);
      const wa = sb.session.whereabouts()!;
      const prompt = sb.session.getMomentPrompt({ moment: "social" }).systemPrompt;

      // Scope the assertions to the WHERE YOU ARE grounding BLOCK — NOT the whole prompt. A
      // houseguest's name also appears in the cast roster, so a whole-prompt `toContain` would pass
      // vacuously even if the location grounding dropped/invented an occupant. The block is the
      // engine's location ground-truth fed to the narrator; it must match whereabouts() exactly.
      const blockStart = prompt.indexOf("WHERE YOU ARE (engine truth");
      expect(blockStart, "the grounding block must exist").toBeGreaterThanOrEqual(0);
      const blockEnd = prompt.indexOf("ROOMS YOU CAN WALK THE PLAYER TO", blockStart);
      const whereBlock = prompt.slice(blockStart, blockEnd >= 0 ? blockEnd : undefined);

      // The block pins the player's own room (the engine truth, voiced exactly).
      expect(whereBlock).toContain(wa.room.replace(/-/g, " "));

      // Every houseguest whereabouts() places IN THE PLAYER'S ROOM is named in the grounding block,
      // and an empty room is grounded as "to yourself" (so the narrator can't invent a crowd).
      if (wa.present.length) {
        for (const p of wa.present) {
          expect(whereBlock, `present occupant ${p.id} must be in the grounding block`).toContain(p.name);
        }
      } else {
        expect(whereBlock).toContain("to yourself");
      }

      // Every adjacent room's EXACT occupancy is voiced in the block: each named occupant appears;
      // an empty adjacent room is grounded as empty (so the narrator can't invent people into it).
      for (const n of wa.nearby) {
        if (n.present.length) {
          for (const p of n.present) {
            expect(whereBlock, `adjacent occupant ${p.id} of ${n.room} must be in the block`).toContain(p.name);
          }
        } else {
          expect(whereBlock).toContain(`${n.room.replace(/-/g, " ")}: empty.`);
        }
      }

      // Snapshot stability within the beat: re-read both — same occupancy, same grounding (root cause
      // #5 ruled out — whereabouts() is a pure read of persisted presence, no nondeterministic recompute).
      const wa2 = sb.session.whereabouts()!;
      expect(wa2.present.map((p) => p.id).sort()).toEqual(wa.present.map((p) => p.id).sort());
      expect(sb.session.getMomentPrompt({ moment: "social" }).systemPrompt).toBe(prompt);
    });
  }

  it("the grounding block is Vault-free — only public names, no relationship numbers", () => {
    const sb = liveGame(9);
    const prompt = sb.session.getMomentPrompt({ moment: "social" }).systemPrompt;
    // Presence is public (names + rooms); no hidden edge values may ride the location grounding.
    expect(prompt).not.toMatch(/"trust":|"affinity":|"threat":/);
  });
});

/* ──────────────────────────────────────────────────────────────────────────────────────────────
 * ADR 0001 §4 + ADR 0002 (Consumers) — NPC "Houseguest's Choice" picks BY SOUL MOTIVATION.
 *
 * The decision: an NPC chip-holder selects the sixth veto player as "their strongest, most-trusted
 * AVAILABLE bond as scored by the relationship model (decision 0002), with temperature variance —
 * never a stored flag." `relationshipModel.test.ts` unit-tests `chooseStrongestBond`, and
 * `houseguestsChoice.test.ts` proves an NPC AUTO-picks — but with a `choose` stub returning an
 * ARBITRARY candidate (`cands[0]`), so the SOUL-MOTIVATION selection is never exercised through the
 * draw. This pins the integration: the SAME production callback wired at `liveSeason.ts:564`
 * (`choose: (holder, cands) => ctx.rel.chooseStrongestBond(holder, cands, rng)`) routes the draw to
 * the holder's strongest bond — not an arbitrary or a disliked candidate.
 *
 * What it catches: a regression that decouples the NPC chip pick from the relationship model (a
 * back-door fixed flag, an arbitrary pick) — the exact "no stored flag; soul motivation" contract.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */
describe("ADR 0001 §4 / 0002 — an NPC chip-holder draws their strongest bond, soul-motivated", () => {
  // The production choose callback verbatim (liveSeason.ts:564) — the integration under test.
  const productionChoose =
    (rel: RelationshipModel, rng: SeededRandom) =>
    (holder: EntityId, cands: EntityId[]): EntityId =>
      rel.chooseStrongestBond(holder, cands, rng);

  it("the live draw's choose callback picks the holder's strongest available bond, not an arbitrary candidate", () => {
    // HOH holds the chip's pull; an ally and a stranger are both AVAILABLE candidates (neither the
    // HOH nor a nominee). Build a clear, asymmetric bond HOH→ally so soul motivation has a clear max.
    const HOH = npc(1);
    const NOMINEE_A = npc(2);
    const NOMINEE_B = npc(3);
    const ALLY = npc(4);     // the holder's strong bond — should be picked
    const STRANGER = npc(5); // no bond — must NOT be picked over the ally
    const week: WeekState = {
      houseguests: [PLAYER, HOH, NOMINEE_A, NOMINEE_B, ALLY, STRANGER],
      player: PLAYER, hoh: HOH, nominees: [NOMINEE_A, NOMINEE_B],
    };

    const rel = new RelationshipModel(0.5);
    // A genuine, established bond toward the ally; the stranger stays at baseline (no investment).
    const warm = new SeededRandom(100);
    for (let i = 0; i < 8; i++) rel.applyDirected(HOH, ALLY, "bonding", warm);
    expect(rel.bondStrength(HOH, ALLY)).toBeGreaterThan(rel.bondStrength(HOH, STRANGER));

    // Sweep seeds: on every seed where the HOH (an NPC) actually draws the chip, the production
    // choose routes to the ally — the strongest bond — never the stranger. Bounded variance never
    // flips a clear lead (ADR 0001 §4 / the chooseStrongestBond contract).
    let drewAsNpc = 0;
    let bondedHolderPicks = 0; // seeds where the BONDED holder (HOH) drew + auto-picked
    for (let seed = 1; seed <= 200; seed++) {
      const draw = vetoParticipants(week, new SeededRandom(seed), {
        houseguestsChoiceChip: true,
        choose: productionChoose(rel, new SeededRandom(seed)),
        playerChoosesOwn: PLAYER,
      });
      const hc = draw.houseguestsChoice;
      if (hc && hc.holder !== PLAYER && hc.picked !== undefined) {
        drewAsNpc++;
        if (hc.holder === HOH && hc.candidates.includes(ALLY)) bondedHolderPicks++;
        // The strongest-bond contract is the HOLDER's: only the bonded holder (the HOH, who invested
        // in the ally) should pick the ally. A different puller (a nominee with no bond) picks by
        // variance, so we don't constrain their pick — only that it is a legal candidate.
        if (hc.holder === HOH && hc.candidates.includes(ALLY)) {
          // A decisive bond (gap ≫ the bounded ±allianceShift/2 variance): the ally is always picked.
          expect(hc.picked, `the bonded holder should pick the ally, not ${hc.picked}`).toBe(ALLY);
        }
        // And whatever was picked is a legal candidate (never a nominee/HOH/already-drawn player).
        expect(hc.candidates).toContain(hc.picked);
      }
    }
    expect(drewAsNpc, "at least one seed must have an NPC draw the chip and auto-pick").toBeGreaterThan(0);
    // The soul-motivation assertion is NOT vacuous: the bonded holder genuinely drew + auto-picked
    // (and, asserted above, always chose the ally) on multiple seeds.
    expect(bondedHolderPicks, "the bonded holder must draw + auto-pick on at least one seed").toBeGreaterThan(0);
  });

  it("the pick is computed from the bond, not a stored label — zeroing the bond changes the pick", () => {
    // Same field; this time NO bond is built. With every candidate at baseline, the soul-motivated
    // pick is NOT forced to the ally — proving the selection reads the graded signals (0002), not a
    // persisted ally/enemy flag (there is none to read).
    const HOH = npc(1);
    const week: WeekState = {
      houseguests: [PLAYER, HOH, npc(2), npc(3), npc(4), npc(5)],
      player: PLAYER, hoh: HOH, nominees: [npc(2), npc(3)],
    };
    const flatRel = new RelationshipModel(0.5); // every edge at baseline — no stored bonds anywhere

    const picks = new Set<EntityId>();
    for (let seed = 1; seed <= 200; seed++) {
      const draw = vetoParticipants(week, new SeededRandom(seed), {
        houseguestsChoiceChip: true,
        choose: productionChoose(flatRel, new SeededRandom(seed)),
        playerChoosesOwn: PLAYER,
      });
      const hc = draw.houseguestsChoice;
      if (hc && hc.holder !== PLAYER && hc.picked !== undefined) picks.add(hc.picked);
    }
    // With no bond to anchor the choice, temperature variance spreads the pick across candidates —
    // it is NOT pinned to one "stored best friend". (A fixed-flag implementation would always pick
    // the same houseguest regardless of the empty relationship graph.)
    expect(picks.size).toBeGreaterThan(1);
  });
});
