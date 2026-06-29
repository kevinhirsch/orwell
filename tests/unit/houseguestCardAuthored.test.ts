import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";

// #1067 — the Vault-FREE provenance flag `authored` on the visible HouseguestCard. It mirrors the persisted
// `deepProfileAuthored`: absent on the seeded deterministic floor, `true` once recordCastProfile authors a
// richer PUBLIC facet for that houseguest. The FE cast-authoring backfill targets the still-floor cards.
// Roles only — no names from any corpus.

describe("#1067 — HouseguestCard.authored mirrors the persisted deepProfileAuthored provenance", () => {
  it("is absent on every floor card (a freshly-warmed cast is un-authored)", () => {
    const warm = new GameSessionAdapter().preSeedCast({ seed: 12 });
    expect(warm.house.length).toBe(15);
    for (const card of warm.house) {
      expect(card.authored).toBeUndefined();
    }
  });

  it("flips to true on the warmed roster card once a PUBLIC facet is authored, others stay floor", () => {
    const s = new GameSessionAdapter();
    const warm = s.preSeedCast({ seed: 21 });
    const id = warm.house[0]!.id;
    expect(s.recordCastProfile({
      houseguestId: id, biography: "A real authored backstory. With presentable, concrete detail.",
    }).accepted).toBe(true);

    const reread = s.preSeedCast({}); // idempotent re-warm read of the same cast
    const authoredCard = reread.house.find((h) => h.id === id);
    const floorCard = reread.house.find((h) => h.id !== id);
    expect(authoredCard?.authored).toBe(true);
    expect(floorCard?.authored).toBeUndefined();
  });

  it("survives onto the LIVE GameStateView roster (createCharacter adopts the authored cast)", () => {
    const s = new GameSessionAdapter();
    const warm = s.preSeedCast({ seed: 42 });
    const id = warm.house[0]!.id;
    s.recordCastProfile({ houseguestId: id, biography: "An authored life outside the house. Two real sentences." });
    const view = s.createCharacter({ playerName: "The Player", seed: 42 });
    expect(view.started).toBe(true);
    const card = view.house.find((h) => h.id === id);
    const floor = view.house.find((h) => h.id !== id);
    // The contract the FE backfill depends on: the field is exactly `authored`, a boolean, present + true
    // on the authored card; absent (still-floor) on the un-authored ones.
    expect(card?.authored).toBe(true);
    expect(typeof card?.authored).toBe("boolean");
    expect(floor?.authored).toBeUndefined();
  });

  it("persists across a snapshot→restore (the provenance flag is durable)", () => {
    const s = new GameSessionAdapter();
    const warm = s.preSeedCast({ seed: 11 });
    const id = warm.house[0]!.id;
    s.recordCastProfile({ houseguestId: id, biography: "A durable authored backstory. It persists across a restart." });
    const core = s.snapshot();
    const restored = new GameSessionAdapter();
    restored.restore(core);
    const view = restored.createCharacter({ playerName: "The Player", seed: 11 });
    expect(view.house.find((h) => h.id === id)?.authored).toBe(true);
  });

  it("the card carries the flag but NO Vault/secret content alongside it", () => {
    const s = new GameSessionAdapter();
    const warm = s.preSeedCast({ seed: 9 });
    const id = warm.house[0]!.id;
    const SECRET = "ZZZ-CARD-AUTHORED-SECRET-1067";
    expect(s.recordCastProfile({
      houseguestId: id,
      biography: "An ordinary public backstory. With two presentable sentences.",
      secrets: [SECRET], trueGoals: ["reach the end"], weakness: "too loyal once committed",
    }).accepted).toBe(true);

    const view = s.createCharacter({ playerName: "The Player", seed: 9 });
    const card = view.house.find((h) => h.id === id)!;
    expect(card.authored).toBe(true);
    // The hidden storyline fields are NEVER on the card, and the sealed secret never crosses anywhere.
    for (const hidden of ["secrets", "trueGoals", "weakness", "dayOnePerception"]) {
      expect(card).not.toHaveProperty(hidden);
    }
    expect(JSON.stringify(view).includes(SECRET)).toBe(false);
  });
});
