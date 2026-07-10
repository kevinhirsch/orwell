import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { MOMENT_PROMPTS } from "../../src/engine/momentPrompts";

/**
 * PREMIERE — "meet everyone before the first HOH" (feature #380 follow-on).
 *
 * The owner's requirement + a real bug the player hit: the producer SKIPPED introductions ("you
 * skipped introductions… I'm missing 3"). The fix is STRUCTURAL — the engine tracks which
 * houseguests have been introduced (it never relies on the model to remember), surfaces who's left
 * into the premiere moment prompt, and exposes a `complete` gate so the first HOH does not begin
 * until all 15 NPCs (+ the player) have been met. The player also forms early OBSERVABLE
 * first-impression reads (public persona facets only) — never the soul, a number, or how they feel.
 *
 * Roles only — no fixture names (the cast is procedurally generated).
 */
function liveGame(user: string, seed: number) {
  const reg = new GameSessionRegistry();
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "The Player", seed });
  return { reg, sb };
}

describe("premiere meet-everyone — the structural tracker", () => {
  it("starts with nobody met, every active NPC outstanding, and the gate NOT complete", () => {
    const { sb } = liveGame("meet-start", 4);
    const view = sb.session.getGameState();
    expect(view.moment).toBe("premiere");

    const pr = sb.session.premiereIntros()!;
    const activeNpcs = view.house.filter((h) => h.status === "active");
    // 15 NPCs on a standard cast — none met yet; the player is implicitly met (counted in metCount/total).
    expect(activeNpcs.length).toBe(15);
    expect(pr.complete).toBe(false);
    expect(pr.metCount).toBe(1); // just the player
    expect(pr.total).toBe(activeNpcs.length + 1); // the whole cast (player + NPCs)
    expect(pr.met).toEqual([]);
    expect(pr.remaining.map((r) => r.houseguest.id).sort()).toEqual(activeNpcs.map((h) => h.id).sort());
  });

  it("marking each houseguest met drives the count up and flips `complete` only when ALL 16 are met", () => {
    const { sb } = liveGame("meet-all", 7);
    const activeNpcs = sb.session.getGameState().house.filter((h) => h.status === "active");

    // Mark every NPC met one by one; the gate stays open until the LAST one.
    activeNpcs.forEach((h, i) => {
      const pr = sb.session.markHouseguestMet(h.id)!;
      const metSoFar = i + 1;
      expect(pr.metCount).toBe(metSoFar + 1); // +1 for the player
      // complete iff every NPC has now been met.
      expect(pr.complete).toBe(metSoFar === activeNpcs.length);
      // The just-met houseguest moved from `remaining` into `met`.
      expect(pr.met.some((m) => m.houseguest.id === h.id)).toBe(true);
      expect(pr.remaining.some((m) => m.houseguest.id === h.id)).toBe(false);
    });

    // Final state: all 16 (player + 15 NPCs) met, nobody outstanding.
    const final = sb.session.premiereIntros()!;
    expect(final.complete).toBe(true);
    expect(final.metCount).toBe(activeNpcs.length + 1);
    expect(final.total).toBe(activeNpcs.length + 1);
    expect(final.remaining).toEqual([]);
    expect(final.met.length).toBe(activeNpcs.length);
  });

  it("marking is idempotent and a no-op for the player / an unknown id", () => {
    const { sb } = liveGame("meet-idem", 5);
    const first = sb.session.getGameState().house.find((h) => h.status === "active")!;

    const a = sb.session.markHouseguestMet(first.id)!;
    const b = sb.session.markHouseguestMet(first.id)!; // again — no double count
    expect(a.metCount).toBe(b.metCount);

    // The player and an unknown id never move the count.
    const me = sb.session.getGameState().player!.id;
    const before = sb.session.premiereIntros()!.metCount;
    expect(sb.session.markHouseguestMet(me)!.metCount).toBe(before);
    expect(sb.session.markHouseguestMet("npc:does-not-exist")!.metCount).toBe(before);
  });

  it("the meet-everyone progress survives a snapshot/restore (a half-done premiere resumes)", () => {
    const { sb } = liveGame("meet-resume", 11);
    const activeNpcs = sb.session.getGameState().house.filter((h) => h.status === "active");
    // Meet the first three, then round-trip through the durable snapshot.
    const met = activeNpcs.slice(0, 3).map((h) => h.id);
    for (const id of met) sb.session.markHouseguestMet(id);

    const core = sb.session.snapshot();
    sb.session.restore(core);

    const pr = sb.session.premiereIntros()!;
    expect(pr.metCount).toBe(met.length + 1); // the three + the player — nothing lost
    expect(pr.met.map((m) => m.houseguest.id).sort()).toEqual([...met].sort());
    expect(pr.complete).toBe(false); // still 12 to meet — the premiere resumes mid-introductions
  });
});

describe("premiere meet-everyone — the first HOH waits on it", () => {
  it("the premiere does not leave the move-in phase until everyone has been met", () => {
    const { sb } = liveGame("meet-gate", 9);
    const activeNpcs = sb.session.getGameState().house.filter((h) => h.status === "active");

    // Meet all but the last NPC — the gate is still NOT complete (the premiere isn't done).
    for (const h of activeNpcs.slice(0, -1)) sb.session.markHouseguestMet(h.id);
    expect(sb.session.premiereIntros()!.complete).toBe(false);

    // Meet the last — NOW the meet-everyone beat is complete; the first HOH may begin.
    sb.session.markHouseguestMet(activeNpcs[activeNpcs.length - 1]!.id);
    expect(sb.session.premiereIntros()!.complete).toBe(true);

    // The player is still in the premiere moment until the game is advanced into the first HOH.
    expect(sb.session.getGameState().moment).toBe("premiere");
  });

  it("once the first HOH begins, the premiere tracker is gone (the read returns null)", () => {
    const { sb } = liveGame("meet-after-hoh", 6);
    const activeNpcs = sb.session.getGameState().house.filter((h) => h.status === "active");
    for (const h of activeNpcs) sb.session.markHouseguestMet(h.id);
    expect(sb.session.premiereIntros()!.complete).toBe(true);

    // Advance into the first HOH competition — the premiere is over.
    sb.session.advanceGame();
    expect(sb.session.getGameState().phase).not.toBe("premiere");
    expect(sb.session.premiereIntros()).toBeNull();
    // The view no longer carries the premiere block.
    expect(sb.session.getGameState().premiere).toBeUndefined();
    // And the stale tracker was cleared from the durable snapshot (non-degradation hygiene).
    expect(sb.session.snapshot().premiereIntros).toBeUndefined();
  });
});

describe("premiere first-power gate — genuine reads unlock power, name-belt marks do not (#1318)", () => {
  it("BELT-source marks fill the meet-list but NEVER form a hot read or unlock power", () => {
    const { sb } = liveGame("belt-no-power", 21);
    const activeNpcs = sb.session.getGameState().house.filter((h) => h.status === "active");

    // The FE regex belt "meets" the WHOLE cast (a move-in narration that names everyone). The meet-list
    // fills and `complete` flips — its anti-soft-lock job is intact — but NOT ONE hot read forms, so the
    // first power stays LOCKED. This is the #1318 fix: hearing names is not engagement.
    for (const h of activeNpcs) sb.session.markHouseguestMet(h.id, { via: "belt" });
    const pr = sb.session.premiereIntros()!;
    expect(pr.complete).toBe(true);                 // meet-list machinery unchanged
    expect(pr.metCount).toBe(activeNpcs.length + 1);
    expect(pr.hotReads).toBe(0);                     // belt marks are never hot reads
    expect(pr.powerReachable).toBe(false);           // power stays locked off pure name-drops
  });

  it("PLAYER-source marks (the default) form hot reads and unlock power once a couple are formed", () => {
    const { sb } = liveGame("player-power", 22);
    const activeNpcs = sb.session.getGameState().house.filter((h) => h.status === "active");

    // No genuine reads yet ⇒ locked.
    expect(sb.session.premiereIntros()!.powerReachable).toBe(false);

    // One genuine read (default source = a model-driven introduction the player was part of): still short
    // of the couple the gate wants.
    sb.session.markHouseguestMet(activeNpcs[0]!.id);
    const afterOne = sb.session.premiereIntros()!;
    expect(afterOne.hotReads).toBe(1);
    expect(afterOne.powerReachable).toBe(false);

    // A second genuine read ⇒ a couple of hot reads formed and (everyone seated/visible at move-in) power
    // is REACHABLE — without grinding through all fifteen formal introductions (`complete` still false).
    sb.session.markHouseguestMet(activeNpcs[1]!.id);
    const afterTwo = sb.session.premiereIntros()!;
    expect(afterTwo.hotReads).toBe(2);
    expect(afterTwo.powerReachable).toBe(true);
    expect(afterTwo.complete).toBe(false);
  });

  it("a RECORDED player↔NPC scene (notePremiereReads) is a genuine hot read and unlocks power", () => {
    const { sb } = liveGame("recorded-power", 23);
    const activeNpcs = sb.session.getGameState().house.filter((h) => h.status === "active");

    // The reliable engagement signal: the 0055 auto-record belt records the scene even when the model
    // skips the tool. Two distinct recorded partners ⇒ two hot reads ⇒ power reachable.
    sb.session.notePremiereReads([activeNpcs[0]!.id]);
    expect(sb.session.premiereIntros()!.powerReachable).toBe(false); // one is not yet a couple
    sb.session.notePremiereReads([activeNpcs[1]!.id]);
    const pr = sb.session.premiereIntros()!;
    expect(pr.hotReads).toBe(2);
    expect(pr.powerReachable).toBe(true);
    // A recorded scene also counts the partner as met (name-lock included) — the meet-list shrinks too.
    expect(pr.met.some((m) => m.houseguest.id === activeNpcs[0]!.id)).toBe(true);
    expect(sb.session.snapshot().introducedNames).toContain(activeNpcs[0]!.id);
  });

  it("belt marks + genuine reads mix cleanly: belt fills the list, only the genuine reads count as hot", () => {
    const { sb } = liveGame("belt-plus-genuine", 24);
    const activeNpcs = sb.session.getGameState().house.filter((h) => h.status === "active");

    // Belt-meet everyone (list fills), then form exactly two genuine reads on two of them.
    for (const h of activeNpcs) sb.session.markHouseguestMet(h.id, { via: "belt" });
    sb.session.markHouseguestMet(activeNpcs[0]!.id);            // upgrade to a genuine read
    sb.session.notePremiereReads([activeNpcs[1]!.id]);         // recorded genuine read
    const pr = sb.session.premiereIntros()!;
    expect(pr.complete).toBe(true);       // still met-everyone
    expect(pr.hotReads).toBe(2);          // only the two genuine reads, not all fifteen belt marks
    expect(pr.powerReachable).toBe(true);
  });

  it("the earned hot-read state survives a snapshot/restore and is cleared once the first HOH begins", () => {
    const { sb } = liveGame("hotread-resume", 25);
    const activeNpcs = sb.session.getGameState().house.filter((h) => h.status === "active");
    sb.session.markHouseguestMet(activeNpcs[0]!.id);   // genuine
    sb.session.markHouseguestMet(activeNpcs[1]!.id);   // genuine
    for (const h of activeNpcs.slice(2)) sb.session.markHouseguestMet(h.id, { via: "belt" });

    // Persisted…
    const core = sb.session.snapshot();
    expect(core.premiereHotReads!.sort()).toEqual([activeNpcs[0]!.id, activeNpcs[1]!.id].sort());
    sb.session.restore(core);
    const pr = sb.session.premiereIntros()!;
    expect(pr.hotReads).toBe(2);           // the earned power state is not lost on restore
    expect(pr.powerReachable).toBe(true);

    // …and cleared, like the meet-list, once the premiere is over.
    sb.session.advanceGame();
    expect(sb.session.getGameState().phase).not.toBe("premiere");
    expect(sb.session.snapshot().premiereHotReads).toBeUndefined();
  });

  it("recordInteraction (the live registry wiring) registers premiere hot reads end to end", () => {
    const { sb } = liveGame("record-e2e", 27);
    const player = sb.session.getGameState().player!.id;
    const activeNpcs = sb.session.getGameState().house.filter((h) => h.status === "active");

    // Drive the LIVE command port (as the FE would). The registry wires recordInteraction →
    // notePremiereReads, so a genuine player↔NPC scene forms a hot read without any markHouseguestMet call.
    sb.commands.recordInteraction({
      initiator: player, witnessSet: [player, activeNpcs[0]!.id], content: "a real first one-on-one",
    });
    expect(sb.session.premiereIntros()!.hotReads).toBe(1);
    sb.commands.recordInteraction({
      initiator: player, witnessSet: [player, activeNpcs[1]!.id], content: "another genuine connection",
    });
    const pr = sb.session.premiereIntros()!;
    expect(pr.hotReads).toBe(2);
    expect(pr.powerReachable).toBe(true);
  });

  it("a via='belt' mark and a later genuine mark of the SAME houseguest upgrades it to a hot read", () => {
    const { sb } = liveGame("belt-then-genuine", 26);
    const activeNpcs = sb.session.getGameState().house.filter((h) => h.status === "active");
    sb.session.markHouseguestMet(activeNpcs[0]!.id, { via: "belt" });
    expect(sb.session.premiereIntros()!.hotReads).toBe(0);
    sb.session.markHouseguestMet(activeNpcs[0]!.id); // genuine read of the same person
    expect(sb.session.premiereIntros()!.hotReads).toBe(1);
  });
});

describe("premiere meet-everyone — determinism (same seed ⇒ same reads)", () => {
  it("two same-seed premieres surface the SAME observable reads in the same order", () => {
    const a = liveGame("det-a", 14).sb.session.premiereIntros()!;
    const b = liveGame("det-b", 14).sb.session.premiereIntros()!;
    expect(JSON.stringify(a.remaining)).toBe(JSON.stringify(b.remaining));
  });
});

describe("premiere meet-everyone — the reads are OBSERVABLE public persona only", () => {
  it("each first impression carries only Vault-free public facets (no soul, no numbers)", () => {
    const { sb } = liveGame("reads-public", 8);
    const pr = sb.session.premiereIntros()!;
    expect(pr.remaining.length).toBeGreaterThan(0);

    // The cast card carries the same public facets — the read mirrors EXACTLY those, nothing more.
    const cards = new Map(sb.session.getGameState().house.map((h) => [h.id, h]));
    for (const fi of pr.remaining) {
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

describe("premiere meet-everyone — the Vault Wall holds (sentinel sweep)", () => {
  it("the premiere/first-impression surfacing carries NO Vault/soul/hidden content", () => {
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor("meet-sentinel");
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
    // The woven premiere system prompt (base persona + premiere fragment + the meet-everyone block).
    const prompt = sb.session.getMomentPrompt({ moment: "premiere" }).systemPrompt;
    for (const s of Object.values(SENTINELS)) {
      expect(prompt, `the premiere prompt must not leak ${s}`).not.toContain(s);
    }
    // And the woven prompt names the (0111-reframed) reading-the-house gate + the met-in-motion list.
    expect(prompt).toMatch(/PREMIERE — READING THE HOUSE/);
    expect(prompt).toMatch(/PREMIERE — FIRST POWER/);
    expect(prompt).toMatch(/PREMIERE — STILL TO MEET IN MOTION/);
  });
});

describe("premiere meet-everyone — the prompt framing", () => {
  it("the premiere fragment frames the (0111) asymmetric entry, the engine tracker, and the early observable reads", () => {
    const premiere = MOMENT_PROMPTS["premiere"]!;
    // 0111 (Pillar 3, #906): the reframed gate — no one invisible, not everyone equal; a few hot reads,
    // the rest met in motion; the first power arrives fast. Still engine-driven, never memory.
    expect(premiere).toMatch(/NO ONE IS INVISIBLE, BUT NOT EVERYONE IS EQUAL/);
    expect(premiere).toMatch(/first reads run HOT/);
    expect(premiere).toMatch(/met the rest IN MOTION|meet the rest IN MOTION/i);
    expect(premiere).toMatch(/DO NOT TRACK THE INTRODUCTIONS FROM MEMORY/);
    expect(premiere).toMatch(/markHouseguestMet/);
    // The reframed first-power gate — reachable fast, not a completionist roll-call.
    expect(premiere).toMatch(/THE FIRST POWER ARRIVES FAST/);
    expect(premiere).toMatch(/do NOT need every one of the fifteen formally introduced first/i);
    // Early observable reads — "clock people as their type", anti-sycophancy intact.
    expect(premiere).toMatch(/EARLY READS/);
    expect(premiere).toMatch(/OBSERVABLE/);
    expect(premiere).toMatch(/how the player feels \('you trust them'\)/i);
  });
});
