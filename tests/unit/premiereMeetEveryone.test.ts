import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { MOMENT_PROMPTS } from "../../src/engine/momentPrompts";

/**
 * PREMIERE — THE CHAMPAGNE CIRCLE (feature 0111, Pillar 3; owner ruling 2026-07-14).
 *
 * The premiere opens on the producers convening the WHOLE house for champagne-circle introductions,
 * and every houseguest is met right there, at once — DETERMINISTICALLY and RECORDED by the engine
 * (`meetWholeHouseAtChampagneCircle`, at premiere entry), never the model's progressive
 * `markHouseguestMet` calls, and never engine-authored prose (the model still narrates the toast).
 * So the player never mills about to stumble on strangers, the meet-everyone tracker is `complete`
 * for the whole premiere, and the first HOH is reachable the moment the toast is done — no roll-call.
 *
 * The tracker is Vault-free: it carries only names + the same observable persona facets the roster
 * already exposes. The first HOH itself stays a real, un-rigged seeded competition — only the GATE is
 * reframed, never the outcome (mandate #3).
 *
 * Roles only — no fixture names (the cast is procedurally generated).
 */
function liveGame(user: string, seed: number) {
  const reg = new GameSessionRegistry();
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "The Player", seed });
  return { reg, sb };
}

describe("premiere champagne circle — the whole house is met at the toast", () => {
  it("opens with EVERY active NPC met, nobody outstanding, and the gate already complete", () => {
    const { sb } = liveGame("circle-start", 4);
    const view = sb.session.getGameState();
    expect(view.moment).toBe("premiere");

    const pr = sb.session.premiereIntros()!;
    const activeNpcs = view.house.filter((h) => h.status === "active");
    // 15 NPCs on a standard cast — the champagne circle met them ALL at the toast (the player counts
    // themselves). The meet-everyone tracker is complete from the moment the premiere begins.
    expect(activeNpcs.length).toBe(15);
    expect(pr.complete).toBe(true);
    expect(pr.metCount).toBe(activeNpcs.length + 1); // the whole cast (player + NPCs)
    expect(pr.total).toBe(activeNpcs.length + 1);
    expect(pr.remaining).toEqual([]); // nobody left to introduce — no roll-call
    expect(pr.met.map((m) => m.houseguest.id).sort()).toEqual(activeNpcs.map((h) => h.id).sort());
  });

  it("the first power is REACHABLE the moment the premiere begins (no roll-call to grind through)", () => {
    const { sb } = liveGame("circle-power", 7);
    const activeNpcs = sb.session.getGameState().house.filter((h) => h.status === "active");
    const pr = sb.session.premiereIntros()!;
    // Every houseguest is a hot read (introduced at the circle) and nobody is invisible ⇒ power ready.
    expect(pr.hotReads).toBe(activeNpcs.length);
    expect(pr.powerReachable).toBe(true);
    expect(pr.complete).toBe(true);
  });

  it("marking a houseguest met is an idempotent no-op (the circle already met the whole house)", () => {
    const { sb } = liveGame("circle-idem", 5);
    const first = sb.session.getGameState().house.find((h) => h.status === "active")!;
    const before = sb.session.premiereIntros()!;

    // Every houseguest is already met — marking (model-driven OR the belt) never changes the tally.
    const a = sb.session.markHouseguestMet(first.id)!;
    const b = sb.session.markHouseguestMet(first.id, { via: "belt" })!;
    expect(a.metCount).toBe(before.metCount);
    expect(b.metCount).toBe(before.metCount);
    expect(a.complete).toBe(true);

    // The player and an unknown id are no-ops too.
    const me = sb.session.getGameState().player!.id;
    expect(sb.session.markHouseguestMet(me)!.metCount).toBe(before.metCount);
    expect(sb.session.markHouseguestMet("npc:does-not-exist")!.metCount).toBe(before.metCount);
  });

  it("a recorded player↔NPC scene (notePremiereReads) stays wired but is a dormant no-op", () => {
    const { sb } = liveGame("circle-note", 23);
    const activeNpcs = sb.session.getGameState().house.filter((h) => h.status === "active");
    const before = sb.session.premiereIntros()!;
    // The #1318 machinery is still wired (a genuine recorded scene), but the circle pre-registered every
    // hot read, so this is idempotent — the tally does not move and power stays reachable.
    sb.session.notePremiereReads([activeNpcs[0]!.id, activeNpcs[1]!.id]);
    const after = sb.session.premiereIntros()!;
    expect(after.hotReads).toBe(before.hotReads);
    expect(after.metCount).toBe(before.metCount);
    expect(after.powerReachable).toBe(true);
  });

  it("the champagne circle survives a snapshot/restore (the premiere resumes fully met)", () => {
    const { sb } = liveGame("circle-resume", 11);
    const activeNpcs = sb.session.getGameState().house.filter((h) => h.status === "active");

    const core = sb.session.snapshot();
    // Persisted: the whole house is met, every name locked in.
    expect(core.premiereIntros!.slice().sort()).toEqual(activeNpcs.map((h) => h.id).sort());
    expect(core.premiereHotReads!.slice().sort()).toEqual(activeNpcs.map((h) => h.id).sort());
    sb.session.restore(core);

    const pr = sb.session.premiereIntros()!;
    expect(pr.complete).toBe(true);
    expect(pr.metCount).toBe(activeNpcs.length + 1);
    expect(pr.powerReachable).toBe(true);
    expect(pr.remaining).toEqual([]);
  });
});

describe("premiere champagne circle — the first HOH", () => {
  it("the player stays in the premiere until the game is advanced into the first HOH", () => {
    const { sb } = liveGame("circle-gate", 9);
    // Everyone met, power reachable — but the player is still in the premiere moment until advanceGame.
    expect(sb.session.premiereIntros()!.powerReachable).toBe(true);
    expect(sb.session.getGameState().moment).toBe("premiere");
  });

  it("the FIRST advanceGame closes the toast (releases into premiere) — it does NOT start the HOH", () => {
    const { sb } = liveGame("circle-close-edge", 6);
    // 0111: the premiere opens with the circle GATHERED.
    expect(sb.session.premiereIntros()!.champagneCircle).toBe("gathered");

    // The FIRST advanceGame CLOSES the champagne circle (the toast resolves) but the premiere is NOT
    // over — the bedroom-pick / settling-in beats still run (ADR 0003: guide, don't force-march).
    sb.session.advanceGame();
    expect(sb.session.getGameState().phase).toBe("premiere");
    expect(sb.session.premiereIntros()!.champagneCircle).toBe("done"); // released to free-roam
    expect(sb.session.premiereIntros()!.complete).toBe(true);
  });

  it("a LATER advanceGame begins the first HOH and the premiere tracker is gone (returns null)", () => {
    const { sb } = liveGame("circle-after-hoh", 6);
    expect(sb.session.premiereIntros()!.complete).toBe(true);

    // First advanceGame closes the circle (still premiere); the second brings up the first HOH.
    sb.session.advanceGame();
    expect(sb.session.getGameState().phase).toBe("premiere");
    sb.session.advanceGame();
    expect(sb.session.getGameState().phase).not.toBe("premiere");
    expect(sb.session.premiereIntros()).toBeNull();
    // The view no longer carries the premiere block.
    expect(sb.session.getGameState().premiere).toBeUndefined();
    // And the stale trackers were cleared from the durable snapshot (non-degradation hygiene) — the
    // champagne-circle flag is premiere-scoped, so it is gone from the live state too.
    expect(sb.session.snapshot().premiereIntros).toBeUndefined();
    expect(sb.session.snapshot().premiereHotReads).toBeUndefined();
    expect(sb.session.snapshot().live?.champagneCircle).toBeUndefined();
  });
});

describe("premiere champagne circle — the GATHERED scene (the toast pins the whole house)", () => {
  it("whereabouts seats the whole house co-present in the living room under a champagne-circle event", () => {
    const { sb } = liveGame("circle-gathered", 9);
    const activeNpcs = sb.session.getGameState().house.filter((h) => h.status === "active");

    const wa = sb.session.whereabouts()!;
    // The GAME has gathered the house — the player is in the living room, the whole house is present,
    // there are no side rooms to slip into, and the event is the champagne circle.
    expect(wa.room).toBe("living-room");
    expect(wa.houseEvent?.kind).toBe("champagne-circle");
    expect(wa.nearby).toEqual([]);
    expect(wa.present.map((p) => p.id).sort()).toEqual(activeNpcs.map((h) => h.id).sort());
    // No competition split on a gathered toast (nobody competes — the house simply toasts).
    expect(wa.houseEvent?.competing).toBeUndefined();
    expect(wa.houseEvent?.youAreCompeting).toBeUndefined();
  });

  it("movePlayer is a no-op while the circle is gathered, and works once the toast has closed", () => {
    const { sb } = liveGame("circle-pin", 12);
    // Pinned: a moveTo during the gathered toast leaves the player in the living room.
    const afterMove = sb.session.movePlayer("bedroom a")!;
    expect(afterMove.room).toBe("living-room");
    expect(afterMove.houseEvent?.kind).toBe("champagne-circle");

    // Close the circle (the first advanceGame), then the player is free to move — the bedroom pick works.
    sb.session.advanceGame();
    expect(sb.session.getGameState().phase).toBe("premiere"); // still the premiere
    const wa = sb.session.whereabouts()!;
    expect(wa.houseEvent).toBeUndefined(); // no longer gathered
    const moved = sb.session.movePlayer("bedroom a")!;
    expect(moved.room).not.toBe("living-room"); // the move now takes effect
  });

  it("snapshot/restore round-trips the gathered flag (a reload mid-toast resumes gathered)", () => {
    const { sb, reg } = liveGame("circle-snap", 11);
    const core = sb.session.snapshot();
    expect(core.live?.champagneCircle).toBe("gathered");

    // Restore into a FRESH sandbox — the flag survives and the pin still holds.
    const sb2 = reg.sandboxFor("circle-snap-2");
    sb2.session.restore(core);
    expect(sb2.session.premiereIntros()!.champagneCircle).toBe("gathered");
    expect(sb2.session.whereabouts()!.houseEvent?.kind).toBe("champagne-circle");
  });

  it("the gathered whereabouts carries NO Vault/soul/hidden content (sentinel sweep)", () => {
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor("circle-gathered-sentinel");
    sb.session.createCharacter({ playerName: "The Player", seed: 13 });

    const SENTINELS = {
      vault: "SENTINEL-CIRCLE-vault-confessional",
      soul: "SENTINEL-CIRCLE-soul-memory",
      hidden: "SENTINEL-CIRCLE-hidden-element-motive",
    };
    sb.engine.vault.writeHidden({ id: "circle:v", kind: "confessional", content: SENTINELS.vault });
    const core = sb.session.snapshot();
    core.house!.npcs[0]!.soul.memory.push(SENTINELS.soul);
    core.house!.npcs[0]!.character.hiddenElements.push({ kind: "secret-motive", detail: SENTINELS.hidden });
    sb.session.restore(core);

    const blob = JSON.stringify(sb.session.whereabouts());
    expect(sb.session.whereabouts()!.houseEvent?.kind).toBe("champagne-circle");
    for (const s of Object.values(SENTINELS)) {
      expect(blob, `the gathered whereabouts must not leak ${s}`).not.toContain(s);
    }
  });
});

describe("premiere champagne circle — determinism (same seed ⇒ same reads)", () => {
  it("two same-seed premieres surface the SAME observable reads in the same order", () => {
    const a = liveGame("det-a", 14).sb.session.premiereIntros()!;
    const b = liveGame("det-b", 14).sb.session.premiereIntros()!;
    expect(JSON.stringify(a.met)).toBe(JSON.stringify(b.met));
  });
});

describe("premiere champagne circle — the reads are OBSERVABLE public persona only", () => {
  it("each first impression carries only Vault-free public facets (no soul, no numbers)", () => {
    const { sb } = liveGame("reads-public", 8);
    const pr = sb.session.premiereIntros()!;
    // Everyone is met at the circle, so the whole cast lives on `met` (not `remaining`).
    expect(pr.met.length).toBeGreaterThan(0);

    // The cast card carries the same public facets — the read mirrors EXACTLY those, nothing more.
    const cards = new Map(sb.session.getGameState().house.map((h) => [h.id, h]));
    for (const fi of pr.met) {
      const card = cards.get(fi.houseguest.id)!;
      expect(fi.archetype).toBe(card.archetype);
      expect(fi.strategyStyle).toBe(card.strategyStyle);
      expect(fi.background).toBe(card.background);
      expect(fi.age).toBe(card.age);
      expect(fi.presentation).toBe(card.presentation);
      // No relationship-math / soul leak: the read is observable persona, never a feeling or a number.
      // (`strategyStyle` may legitimately be the public word "emotional" — that is a persona facet, not a
      // soul leak; we guard the genuine hidden-layer markers + any bare number, not that public value.)
      const blob = JSON.stringify(fi);
      expect(blob).not.toMatch(/trust|threat|affinity|\bsoul\b|secret|hidden/i);
      expect(blob).not.toMatch(/\d\.\d{2,}/); // no bare aptitude float
    }
  });
});

describe("premiere champagne circle — the Vault Wall holds (sentinel sweep)", () => {
  it("the premiere/first-impression surfacing carries NO Vault/soul/hidden content", () => {
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor("circle-sentinel");
    sb.session.createCharacter({ playerName: "The Player", seed: 13 });

    // Poison every hidden surface with unique sentinels, restore, then prove neither the
    // premiereIntros() view NOR the woven premiere system prompt surfaces any of them.
    const SENTINELS = {
      vault: "SENTINEL-MEET-vault-confessional",
      soul: "SENTINEL-MEET-soul-memory",
      hidden: "SENTINEL-MEET-hidden-element-motive",
    };
    sb.engine.vault.writeHidden({ id: "meet:v", kind: "confessional", content: SENTINELS.vault });
    const core = sb.session.snapshot();
    core.house!.npcs[0]!.soul.memory.push(SENTINELS.soul);
    core.house!.npcs[0]!.character.hiddenElements.push({ kind: "secret-motive", detail: SENTINELS.hidden });
    sb.session.restore(core);

    // The structured reads view.
    const readsBlob = JSON.stringify(sb.session.premiereIntros());
    for (const s of Object.values(SENTINELS)) {
      expect(readsBlob, `premiereIntros must not leak ${s}`).not.toContain(s);
    }
    // The woven premiere system prompt (base persona + premiere fragment + the champagne-circle block).
    const prompt = sb.session.getMomentPrompt({ moment: "premiere" }).systemPrompt;
    for (const s of Object.values(SENTINELS)) {
      expect(prompt, `the premiere prompt must not leak ${s}`).not.toContain(s);
    }
    // And the woven prompt names the (0111-reframed) champagne-circle context blocks.
    expect(prompt).toMatch(/PREMIERE — THE CHAMPAGNE CIRCLE/);
    expect(prompt).toMatch(/PREMIERE — FIRST POWER/);
    expect(prompt).toMatch(/PREMIERE — THE HOUSE AT THE CIRCLE/);
  });
});

describe("premiere champagne circle — the prompt framing", () => {
  it("the premiere fragment frames the champagne circle, the auto-meet, and the early observable reads", () => {
    const premiere = MOMENT_PROMPTS["premiere"]!;
    // 0111 (Pillar 3, owner ruling 2026-07-14): the champagne circle introduces the WHOLE house at once —
    // meeting auto-happens at the toast, not via a manual roll-call. Still engine-recorded, never memory.
    expect(premiere).toMatch(/THE CHAMPAGNE CIRCLE/);
    expect(premiere).toMatch(/the WHOLE\s+house/i);
    expect(premiere).toMatch(/ENGINE HAS ALREADY RECORDED THE WHOLE HOUSE AS MET/);
    // The model does NOT drive markHouseguestMet person-by-person anymore.
    expect(premiere).toMatch(/do NOT call markHouseguestMet person by person/i);
    // The reframed first-power gate — ready once the circle has played, no roll-call.
    expect(premiere).toMatch(/THE FIRST POWER IS READY ONCE THE CIRCLE HAS PLAYED/);
    expect(premiere).toMatch(/there is NO roll-call/i);
    // Early observable reads — "clock people as their type", anti-sycophancy intact.
    expect(premiere).toMatch(/OBSERVABLE/);
    expect(premiere).toMatch(/how the player feels \('you trust them'\)/i);
  });
});
