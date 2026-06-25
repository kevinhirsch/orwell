import { describe, it, expect } from "vitest";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { humanizeForRetrospective } from "../../src/domain/humanize";
import { PLAYER, npc } from "../../src/domain/ids";
import { generateHouse } from "../../src/engine/characterFactory";
import {
  ALL_DEEP_PROFILE_POOL_STRINGS,
  generateCastDeepLayer,
  generateDeepProfile,
  deepProfileToVaultContent,
} from "../../src/engine/deepProfile";
import type { DeepProfileCharacter } from "../../src/engine/deepProfile";

/**
 * #854 — the umbrella-template sweep. The deep-profile composer interpolates POOL strings into a
 * houseguest's hidden secrets / true goals / weakness / Day-1 read. That hidden text is later UNSEALED
 * for the 0048 post-season retrospective and run through `humanizeForRetrospective` → `humanizeIds`,
 * whose whole-token pass substitutes a STANDALONE entity-id word (the player's id is the bare English
 * word `player`) with the player's NAME. So a pool string carrying a bare game-role id-token word
 * ("player"/"hoh"/"nominee"/…) gets mangled into nonsense on the one surface that ever shows it — the
 * live repro shape: an ARCHETYPE_GOAL line "outlast every player who counted them out" unseals as
 * "outlast every <PlayerName> who counted them out". (The A8 boundary protects "players" — a word char
 * follows — but NOT a bare "player".)
 *
 * This is the POOL-SIDE scrub gate: no pool string may contain a bare id-token word, proven both
 * exhaustively (every pool string) and end-to-end (a generated profile, unsealed, never substitutes a
 * role word). The humanize substitution itself is being hardened separately. Roles only — the "names"
 * here are obvious placeholders, never personas.
 */

// The bare GAME-ROLE id-token words that collide with entity ids / loop-beat role tokens and so are
// vulnerable to the whole-token humanize substitution. `player` is the literal `PLAYER` id; the rest
// are the role labels the loop/humanization machinery handles as tokens.
const BARE_ID_TOKENS = [
  "player", "players",
  "hoh",
  "nominee", "nominees",
  "evictee", "evictees",
  "veto",
  "juror", "jurors",
];

function facets(archetype: DeepProfileCharacter["archetype"], vocation: string, age: number): DeepProfileCharacter {
  return { archetype, vocation, age };
}

describe("#854 — no deep-profile pool string contains a bare id-token word", () => {
  it("every pool/template string is free of bare role id-tokens (exhaustive over all pools)", () => {
    expect(ALL_DEEP_PROFILE_POOL_STRINGS.length).toBeGreaterThan(50); // sanity: the aggregator is wired
    const offenders: Array<{ token: string; str: string }> = [];
    for (const str of ALL_DEEP_PROFILE_POOL_STRINGS) {
      const lower = str.toLowerCase();
      for (const token of BARE_ID_TOKENS) {
        // whole-word match — exactly the token the humanizer would substitute (the A8 boundary)
        if (new RegExp(`\\b${token}\\b`).test(lower)) offenders.push({ token, str });
      }
    }
    expect(offenders, `bare id-token words in pool strings: ${JSON.stringify(offenders)}`).toEqual([]);
  });

  it("pools carry NO stat-key substring and NO bare float (the §8 Vault-scan vocabulary)", () => {
    for (const str of ALL_DEEP_PROFILE_POOL_STRINGS) {
      expect(str).not.toMatch(/"physical":|"mental":|"social":/);
      expect(str).not.toMatch(/\d+\.\d+/);
    }
  });
});

describe("#854 — pool-sourced text unseals cleanly through the real retrospective humanize surface", () => {
  // A roster whose PLAYER name is a distinctive token that could NEVER occur naturally in a secret —
  // so if a bare `player`/role token survived in a POOL and got substituted, it shows up unmistakably.
  const entities = [
    { id: PLAYER, name: "ZZSENTINELNAME" },
    ...Array.from({ length: 15 }, (_, i) => ({ id: npc(i + 1), name: `NPCNAME${i + 1}` })),
  ];

  it("the legacy shared-pool profile (pools ONLY, no vocation noun) never injects the player name", () => {
    // The legacy path interpolates NOTHING but pool strings, so it isolates the POOL-side hazard this
    // change closes: after the scrub, no bare role token survives to be mangled by the whole-token
    // `humanizeIds` substitution on the one surface (the 0048 retrospective) that ever unseals it.
    for (let seed = 1; seed <= 120; seed++) {
      const p = generateDeepProfile(new SeededRandom(seed)); // no character ⇒ shared-pool floor
      const prose = humanizeForRetrospective(deepProfileToVaultContent(npc(1), p), entities);
      expect(prose, `seed ${seed}`).not.toContain("ZZSENTINELNAME");
    }
  });

  it("on the conditioned path the ONLY residual role-word substitution is the vocation noun (humanize lane)", () => {
    // CROSS-LANE NOTE: a few corpus vocations legitimately CONTAIN a bare role word — e.g. "professional
    // poker player". The conditioned floor interpolates that vocation NOUN into the hidden text, and the
    // whole-token `humanizeIds` substitution can still mangle that noun ("poker player" → "poker <name>")
    // when the retrospective unseals it. That is the VOCATION × humanize-substitution hazard being
    // hardened SEPARATELY (out of this pool-side lane). This test pins the boundary: any residual
    // substitution on the conditioned path is attributable to the vocation noun ALONE — never to a pool
    // string. So when the humanize hardening lands, this whole surface is clean; until then, the pools
    // are proven not to contribute. (If this ever fails, a NON-vocation pool string regressed — fix the pool.)
    for (let seed = 1; seed <= 40; seed++) {
      const npcs = generateHouse(new SeededRandom(seed)).npcs;
      const layer = generateCastDeepLayer(seed, npcs);
      for (const hg of npcs) {
        const p = layer.hidden[hg.id]!;
        const prose = humanizeForRetrospective(deepProfileToVaultContent(hg.id, p), entities);
        if (!prose.includes("ZZSENTINELNAME")) continue;
        // A substitution happened — it MUST be the vocation noun (which contains a bare role word). A cast
        // NPC always carries a concrete vocation (L28); if one were absent the conditioned path would fall
        // to the proven-clean shared pool, so any substitution there is a pool regression too.
        const vocation = (hg.character.vocation ?? "").toLowerCase();
        const hasRoleWord = BARE_ID_TOKENS.some((t) => new RegExp(`\\b${t}\\b`).test(vocation));
        expect(hasRoleWord, `seed ${seed} ${hg.id}: substitution NOT from the vocation noun — a pool regressed`).toBe(true);
      }
    }
  });
});

describe("#854 — spot-check: the conditioned floor stays occupation-fit + cross-cast unique over seeds", () => {
  it("the generated hidden material names the houseguest's own concrete vocation (occupation fit)", () => {
    // A spread of vocations across the refined sectors (incl. the #848 re-keyed ones).
    const samples: Array<[DeepProfileCharacter["archetype"], string]> = [
      ["villain", "cheese monger"],        // #848: service, not curio
      ["comp-beast", "firefighter"],
      ["mastermind", "data analyst"],      // #848: tech
      ["loyalist", "nail technician"],     // #848: service
      ["analyst", "aerospace technician"], // #848: tech
      ["floater", "court reporter"],       // #848: publicService
      ["underdog", "competitive-eating champ"],
    ];
    for (const [arch, vocation] of samples) {
      const p = generateDeepProfile(new SeededRandom(13), undefined, facets(arch, vocation, 34));
      const blob = [...p.secrets, ...p.trueGoals, p.weakness].join(" ");
      expect(blob, `${arch}/${vocation}`).toContain(vocation);
    }
  });

  it("no two houseguests across the cast share a verbatim secret / goal / weakness (many seeds)", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const npcs = generateHouse(new SeededRandom(seed)).npcs;
      const layer = generateCastDeepLayer(seed, npcs);
      const secrets = new Map<string, number>();
      const goals = new Map<string, number>();
      const weaknesses = new Map<string, number>();
      for (const id of Object.keys(layer.hidden)) {
        const p = layer.hidden[id]!;
        for (const s of p.secrets) secrets.set(s, (secrets.get(s) ?? 0) + 1);
        for (const g of p.trueGoals) goals.set(g, (goals.get(g) ?? 0) + 1);
        weaknesses.set(p.weakness, (weaknesses.get(p.weakness) ?? 0) + 1);
      }
      expect(Math.max(...secrets.values()), `seed ${seed} secret dup`).toBe(1);
      expect(Math.max(...goals.values()), `seed ${seed} goal dup`).toBe(1);
      expect(Math.max(...weaknesses.values()), `seed ${seed} weakness dup`).toBe(1);
    }
  });
});
