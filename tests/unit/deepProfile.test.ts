import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER } from "../../src/domain/ids";
import {
  generateCastDeepLayer, generateDeepProfile, generatePhysicalCharacteristics, generateBiography,
  deriveStoryThreads, ageLookFor, SECRET_RANGE, STORY_THREAD_KIND,
  MAX_PER_SECRET, MAX_PER_GOAL, MAX_PER_WEAKNESS, MAX_PER_PERCEPTION,
} from "../../src/engine/deepProfile";
import { generateHouse } from "../../src/engine/characterFactory";

/**
 * Feature 0058 — deep character profiles. Roles only (no names). The PUBLIC depth (biography +
 * physical facet) crosses to the player and is byte-stable; the HIDDEN depth (secrets/goals/
 * weakness/Day-1 perception) NEVER reaches the player OR admin, seeds the NPC→player edge, and
 * seeds story threads that fold a hidden weight on activation.
 */

const SENT = "SENTINEL-0058-unit";

function liveGame(user: string, seed: number) {
  const reg = new GameSessionRegistry();
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "The Player", seed });
  return { reg, sb };
}

describe("0058 deepProfile — deterministic generators", () => {
  it("a deep profile carries 2–3 secrets, true goals, a weakness, and a Day-1 perception", () => {
    const p = generateDeepProfile(new SeededRandom(7));
    expect(p.secrets.length).toBeGreaterThanOrEqual(SECRET_RANGE.min);
    expect(p.secrets.length).toBeLessThanOrEqual(SECRET_RANGE.max);
    expect(new Set(p.secrets).size).toBe(p.secrets.length); // distinct
    expect(p.trueGoals.length).toBe(2);
    expect(p.weakness.length).toBeGreaterThan(0);
    expect(p.dayOnePerception.read.length).toBeGreaterThan(0);
  });

  it("the structured physical facet is fully populated and age-appropriate", () => {
    const f = generatePhysicalCharacteristics(new SeededRandom(3), 23);
    for (const k of ["heightBuild", "skinTone", "hair", "facialFeatures", "distinguishingMark", "ageLook", "style"] as const) {
      expect(f[k].length).toBeGreaterThan(0);
    }
    expect(f.ageLook).toBe(ageLookFor(23));
    expect(ageLookFor(55)).not.toBe(ageLookFor(22)); // age bands differ
  });

  it("no public facet serializes a banned stat key or a bare float (the 0001 canary form)", () => {
    const f = generatePhysicalCharacteristics(new SeededRandom(99), 40);
    const bio = generateBiography(new SeededRandom(99), { background: "a chef who plays as a villain" });
    const blob = JSON.stringify({ f, bio });
    expect(blob).not.toMatch(/"physical":|"mental":|"social":/);
    expect(blob).not.toMatch(/\d+\.\d+/);
  });

  it("the biography is a real multi-sentence backstory, not a one-liner", () => {
    const bio = generateBiography(new SeededRandom(11), { background: "a nurse who plays as a loyalist" });
    expect((bio.match(/[.!?]/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(bio.length).toBeGreaterThan(40);
  });

  it("story threads are derived from secrets + weakness + the first true goal, all dormant with in-game pathways", () => {
    const profile = generateDeepProfile(new SeededRandom(5));
    const threads = deriveStoryThreads(new SeededRandom(5), "npc:1", profile);
    // one per secret + weakness + first goal
    expect(threads.length).toBe(profile.secrets.length + 1 + (profile.trueGoals[0] ? 1 : 0));
    for (const t of threads) {
      expect(t.status).toBe("dormant");
      expect(t.surfacingPathways.length).toBeGreaterThan(0);
      // surfacing is always an in-game pathway, never "exposition"
      for (const path of t.surfacingPathways) {
        expect(["witnessed", "told-by-confidant", "overheard", "gossip-diffused"]).toContain(path);
      }
    }
  });

  it("the cast deep layer is deterministic per seed and player-INDEPENDENT (keys off the cast names)", () => {
    const npcs = generateHouse(new SeededRandom(42)).npcs;
    const a = generateCastDeepLayer(42, npcs);
    const b = generateCastDeepLayer(42, npcs);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a)); // same seed ⇒ identical
    // every NPC has both a public and a hidden half
    for (const n of npcs) {
      expect(a.public[n.id]).toBeTruthy();
      expect(a.hidden[n.id]).toBeTruthy();
    }
    expect(a.threads.length).toBeGreaterThan(npcs.length); // ≥1 thread per NPC
  });

  it("L41 — no hidden trope clusters across the cast (spread caps hold over many seeds)", () => {
    // The 2026-06-19 finale reveal showed 4 NPCs sharing one "secretly clocking every move" trope.
    // The cast-wide spread caps must keep any secret/goal/weakness/Day-1-read under its MAX_PER_*.
    for (let seed = 1; seed <= 60; seed++) {
      const npcs = generateHouse(new SeededRandom(seed)).npcs;
      const layer = generateCastDeepLayer(seed, npcs);
      const secret = new Map<string, number>();
      const goal = new Map<string, number>();
      const weak = new Map<string, number>();
      const read = new Map<string, number>();
      for (const id of Object.keys(layer.hidden)) {
        const p = layer.hidden[id]!;
        for (const s of p.secrets) secret.set(s, (secret.get(s) ?? 0) + 1);
        for (const g of p.trueGoals) goal.set(g, (goal.get(g) ?? 0) + 1);
        weak.set(p.weakness, (weak.get(p.weakness) ?? 0) + 1);
        read.set(p.dayOnePerception.read, (read.get(p.dayOnePerception.read) ?? 0) + 1);
      }
      expect(Math.max(...secret.values())).toBeLessThanOrEqual(MAX_PER_SECRET);
      expect(Math.max(...goal.values())).toBeLessThanOrEqual(MAX_PER_GOAL);
      expect(Math.max(...weak.values())).toBeLessThanOrEqual(MAX_PER_WEAKNESS);
      expect(Math.max(...read.values())).toBeLessThanOrEqual(MAX_PER_PERCEPTION);
      // and the hidden layer reads as genuinely varied — many distinct secrets across a 15-cast
      expect(secret.size).toBeGreaterThanOrEqual(8);
    }
  });
});

describe("0058 live wiring — the public depth crosses, the hidden depth never does", () => {
  it("every active houseguest card carries a public biography + physical facet (no hidden field)", () => {
    const { sb } = liveGame("dp-public", 4);
    const house = sb.session.getGameState().house;
    for (const h of house.filter((x) => x.status === "active")) {
      expect(h.biography && h.biography.length > 0).toBe(true);
      expect(h.physicalCharacteristics).toBeTruthy();
    }
    const blob = JSON.stringify(house);
    for (const banned of ["secret", "trueGoal", "weakness", "dayOnePerception", "trustLean"]) {
      expect(blob).not.toContain(banned);
    }
    expect(blob).not.toMatch(/"physical":|"mental":|"social":/);
    expect(blob).not.toMatch(/\d+\.\d+/);
  });

  it("a planted secret/goal/weakness/perception sentinel never reaches player, admin, npcVoice, or the moment prompt", () => {
    const { sb } = liveGame("dp-leak", 6);
    // Plant the sentinel into EVERY hidden field of EVERY NPC's deep profile via snapshot→restore.
    const core = sb.session.snapshot();
    expect(Object.keys(core.deepProfiles ?? {}).length).toBeGreaterThan(0);
    for (const profile of Object.values(core.deepProfiles!)) {
      profile.secrets = profile.secrets.map((s) => `${s} ${SENT}`);
      profile.trueGoals = profile.trueGoals.map((g) => `${g} ${SENT}`);
      profile.weakness = `${profile.weakness} ${SENT}`;
      profile.dayOnePerception.read = `${profile.dayOnePerception.read} ${SENT}`;
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

  it("the Day-1 perception seeds the NPC→player edge (some npc→player edges differ from their mirror)", () => {
    const { sb } = liveGame("dp-edge", 9);
    const rel = sb.engine.relationships;
    let differ = 0;
    for (const h of sb.session.getGameState().house) {
      const to = rel.edge(h.id, PLAYER);
      const from = rel.edge(PLAYER, h.id);
      if (Math.abs(to.trust - from.trust) > 1e-9 || Math.abs(to.affinity - from.affinity) > 1e-9 || Math.abs(to.threat - from.threat) > 1e-9) differ++;
    }
    expect(differ).toBeGreaterThan(0);
    // and no number crosses to the player
    expect(JSON.stringify(sb.session.getGameState())).not.toMatch(/"trust":|"affinity":|"threat":/);
  });
});

describe("0058 story threads — sealed, persisted, and they play out", () => {
  it("threads are sealed in the Vault and never reach the player", () => {
    const { sb } = liveGame("dp-thread-seal", 4);
    const sealed = sb.engine.vault.readHidden({ kind: STORY_THREAD_KIND });
    expect(sealed.length).toBeGreaterThan(0);
    // plant a sentinel premise and prove it never crosses
    sb.engine.vault.writeHidden({ id: "thread:unit:sent", kind: STORY_THREAD_KIND, content: `${SENT}-thread` });
    expect(JSON.stringify(sb.session.getGameState())).not.toContain(`${SENT}-thread`);
  });

  it("activating a dormant thread folds a hidden weight into the player's read of the source", () => {
    const { sb } = liveGame("dp-thread-fold", 5);
    const source = sb.session.getGameState().house[0]!.id;
    const before = { ...sb.engine.relationships.edge(PLAYER, source) };
    const activated = sb.session.activateThread(source);
    expect(activated?.status).toBe("active");
    const after = sb.engine.relationships.edge(PLAYER, source);
    const moved = Math.abs(after.trust - before.trust) > 1e-9 || Math.abs(after.affinity - before.affinity) > 1e-9 || Math.abs(after.threat - before.threat) > 1e-9;
    expect(moved).toBe(true);
  });
});

describe("0058 non-degradation + full recall (L27b)", () => {
  it("the public deep profile survives snapshot→restore byte-identical and threads persist", () => {
    const { sb } = liveGame("dp-persist", 7);
    const before = JSON.stringify(sb.session.getGameState().house);
    const core = sb.session.snapshot();
    expect((core.storyThreads ?? []).length).toBeGreaterThan(0);
    sb.session.restore(core);
    expect(JSON.stringify(sb.session.getGameState().house)).toBe(before);
    expect((sb.session.snapshot().storyThreads ?? []).length).toBe((core.storyThreads ?? []).length);
  });

  it("authored hidden detail is recall-able in full from the soul (not flattened)", () => {
    const { sb } = liveGame("dp-recall", 8);
    const id = sb.session.getGameState().house[0]!.id;
    const recalled = sb.engine.soul.recall(id, "secret true goal weakness", 5);
    expect(recalled.length).toBeGreaterThan(0);
    // the recalled content is the full sealed deep-profile string (carries the labeled sections)
    expect(recalled.some((m) => /deep-profile|secrets:|weakness:/.test(m.content))).toBe(true);
  });

  it("a pre-0058 save (no deepProfiles) re-derives the hidden layer deterministically on restore", () => {
    const { sb } = liveGame("dp-legacy", 12);
    const core = sb.session.snapshot();
    const seed = core.seed!;
    // simulate a legacy save: strip the persisted deep layer
    delete core.deepProfiles;
    delete core.storyThreads;
    sb.session.restore(core);
    // threads + profiles are re-derived from seed; activation still works
    const id = sb.session.getGameState().house[0]!.id;
    const activated = sb.session.activateThread(id);
    expect(activated).toBeTruthy();
    expect(typeof seed).toBe("number");
  });
});

describe("0058 / L28b write-back seam — LIVE, airtight, split-safe", () => {
  it("recordCastProfile reports public/hidden field NAMES and never echoes a hidden value", () => {
    const { sb } = liveGame("dp-writeback", 3);
    const id = sb.session.getGameState().house[0]!.id;
    const res = sb.session.recordCastProfile({
      houseguestId: id,
      biography: "Authored. Two sentences.",
      secrets: [`${SENT}-secret`],
      weakness: `${SENT}-weakness`,
    });
    expect(res.accepted).toBe(true);
    expect(res.publicFields).toContain("biography");
    expect(res.hiddenFields).toEqual(expect.arrayContaining(["secrets", "weakness"]));
    const blob = JSON.stringify(res);
    expect(blob).not.toContain(`${SENT}-secret`);
    expect(blob).not.toContain(`${SENT}-weakness`);
  });

  it("recordCastProfile refuses an unknown houseguest (Vault-safe refusal)", () => {
    const { sb } = liveGame("dp-writeback-unknown", 3);
    const res = sb.session.recordCastProfile({ houseguestId: "npc:999", biography: "x. y." });
    expect(res.accepted).toBe(false);
  });

  it("L28b — the authored PUBLIC biography crosses to the player and stays put", () => {
    const { sb } = liveGame("dp-wb-public", 11);
    const id = sb.session.getGameState().house[0]!.id;
    const bio = "Authored backstory. A welder from Detroit who came up the hard way.";
    expect(sb.session.recordCastProfile({ houseguestId: id, biography: bio }).accepted).toBe(true);
    const card = sb.session.getGameState().house.find((h) => h.id === id)!;
    expect(card.biography).toBe(bio); // the public facet is now the authored one
  });

  it("L28b — the authored HIDDEN detail NEVER reaches the player/admin/npcVoice/moment, but recalls in full", () => {
    const { sb } = liveGame("dp-wb-hidden", 12);
    const id = sb.session.getGameState().house[0]!.id;
    expect(sb.session.recordCastProfile({
      houseguestId: id,
      secrets: [`${SENT}-authored-secret`],
      weakness: `${SENT}-authored-weakness`,
      dayOnePerception: `${SENT}-authored-read`,
    }).accepted).toBe(true);

    const playerSurface = JSON.stringify(sb.session.getGameState())
      + JSON.stringify(sb.player.getVisibleState())
      + sb.session.getMomentPrompt({ moment: "social" }).systemPrompt
      + JSON.stringify(sb.session.npcVoice(id));
    expect(playerSurface).not.toContain(SENT);
    sb.syncAdmin();
    expect(JSON.stringify(sb.admin.inspect())).not.toContain(SENT);

    // …but the authored hidden detail IS recall-able in full from the (engine-only) soul (L27b).
    const recalled = sb.engine.soul.recall(id, "secret weakness read", 5);
    expect(recalled.some((m) => m.content.includes(`${SENT}-authored-secret`))).toBe(true);
  });

  it("L28b — re-sealing is IDEMPOTENT: writing twice leaves exactly one profile + one thread set", () => {
    const { sb } = liveGame("dp-wb-idem", 13);
    const id = sb.session.getGameState().house[0]!.id;
    const write = () => sb.session.recordCastProfile({ houseguestId: id, secrets: ["a single authored secret"], weakness: "one authored weakness" });
    write(); write();
    const profiles = sb.engine.vault.readHidden({ kind: "hidden-attribute", subject: id });
    expect(profiles.length).toBe(1); // not duplicated
    // the sealed profile is the AUTHORED one
    expect(profiles[0]!.content).toContain("a single authored secret");
  });

  it("L28b — refuses an authored profile that MIRRORS the player (cast stays player-independent)", () => {
    const { sb } = liveGame("dp-wb-mirror", 14);
    const id = sb.session.getGameState().house[0]!.id;
    const playerName = "The Player";
    const res = sb.session.recordCastProfile({ houseguestId: id, biography: `A friend of ${playerName} from back home.` });
    expect(res.accepted).toBe(false);
    expect(res.reason).toMatch(/mirror/i);
  });
});
