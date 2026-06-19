import { describe, it } from "vitest";
import assert from "node:assert/strict";
import fc from "fast-check";
import { GameSessionRegistry } from "../../src/composition/registry";

/**
 * Feature 0058 — over a spread of seeds, the HIDDEN deep profile (secrets / true goals / weakness /
 * Day-1 perception), planted with a unique per-run sentinel, never reaches ANY outward surface
 * (player projection + visible state + status + moment prompt + every active NPC's voicing) NOR the
 * admin / God-Mode surface. The 0001 canary, extended to the 0058 hidden depth axis. Roles only.
 */
describe("0058 Vault Wall — property over seeds: the hidden deep profile never leaks", () => {
  it("a planted secret sentinel never crosses to the player or the admin, for any seed", () => {
    let n = 0;
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50_000 }), (seed) => {
        const reg = new GameSessionRegistry();
        const sb = reg.sandboxFor(`dpprop${n++}`);
        sb.session.createCharacter({ playerName: "The Player", seed });
        const SENT = `SENTINEL-0058-prop-${seed}`;
        const core = sb.session.snapshot();
        for (const profile of Object.values(core.deepProfiles ?? {})) {
          profile.secrets = profile.secrets.map((s) => `${s} ${SENT}`);
          profile.weakness = `${profile.weakness} ${SENT}`;
          profile.trueGoals = profile.trueGoals.map((g) => `${g} ${SENT}`);
          profile.dayOnePerception.read = `${profile.dayOnePerception.read} ${SENT}`;
        }
        sb.session.restore(core);

        const player = JSON.stringify(sb.session.getGameState())
          + JSON.stringify(sb.player.getVisibleState())
          + JSON.stringify(sb.session.gameStatus())
          + sb.session.getMomentPrompt({}).systemPrompt
          + sb.session.getGameState().house.filter((h) => h.status === "active")
              .map((h) => JSON.stringify(sb.session.npcVoice(h.id))).join("");
        assert.ok(!player.includes(SENT), `seed ${seed}: a hidden secret reached a player surface`);
        sb.syncAdmin();
        assert.ok(!JSON.stringify(sb.admin.inspect()).includes(SENT), `seed ${seed}: a hidden secret reached the admin surface`);
      }),
      { numRuns: 40 },
    );
  });
});
