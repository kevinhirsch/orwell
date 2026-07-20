import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import type { McpServer } from "../../src/adapters/mcp/McpServer";
import { PLAYER } from "../../src/domain/ids";

/**
 * ADR 0019 enforcement instance #1 ("context is not knowledge") / mandate #2 (the Vault Wall).
 *
 * The player's CASTING INTERVIEW material — the producer-only backstory, motivation, private
 * strategy, and interview notes the player told production — is an OOC producer channel. Like the
 * Diary Room, it has NO in-game pathway to any NPC's knowledge. A live playtest showed it reaching
 * NPC-voiced narration ("you've got a counselor vibe"). This sentinel sweep is the ENGINE-side proof
 * that the split holds: the engine's NPC-facing / narration projections NEVER carry the player's
 * producer material, so the model "cannot leak what it never receives".
 *
 * (The FE walls the ONE view that legitimately carries it — the getGameState/createCharacter view
 * feeds the player's own casting-card reveal, so its `castingCard.story`/`motivation` are redacted
 * from the MODEL-facing tool result front-end-side; that boundary is proven in
 * `frontend/tests/test_casting_leak_gate.py`. This test proves the OTHER surfaces are clean at the
 * source.)
 *
 * HARD rule: roles only — no names. The sentinels are unique, non-game tokens so a leak is unambiguous.
 */

describe("casting producer material never reaches an NPC-facing engine projection", () => {
  it("no in-game narration / NPC-voice / social-read / roster projection carries the player's producer fields", async () => {
    for (const seed of [3, 8]) {
      const reg = new GameSessionRegistry();
      const user = `cp${seed}`;
      const player = reg.resolver()("player", user) as McpServer;

      // Plant a UNIQUE sentinel into every producer-only player field the casting interview captures.
      const BACKSTORY = `PRODUCER-BACKSTORY-${seed}-was-a-camp-counselor`;
      const MOTIVATION = `PRODUCER-MOTIVATION-${seed}-win-for-my-family`;
      const STRATEGY = `PRODUCER-PRIVSTRAT-${seed}-flip-the-house-week-one`;
      const NOTE = `PRODUCER-INTERVIEWNOTE-${seed}-told-production-in-confidence`;
      const producerSentinels = [BACKSTORY, MOTIVATION, STRATEGY, NOTE];

      await player.callTool("createCharacter", {
        playerName: "The Player",
        seed,
        backstory: BACKSTORY,
        motivation: MOTIVATION,
        privateStrategy: STRATEGY,
        interviewNotes: [NOTE],
      });

      const sb = reg.sandboxFor(user);
      const npcIds = sb.session.snapshot().house!.npcs.map((n) => n.id);

      // The canary is only meaningful if the material is GENUINELY held engine-side. The player's own
      // casting-card view (getGameState) legitimately carries the backstory + motivation (it feeds the
      // player's reveal), and the raw player object holds the private strategy + interview notes — prove
      // at least one carrier holds each sentinel, so a clean sweep below is a real wall, not an empty one.
      const stateView = JSON.stringify(await player.callTool("getGameState", {}));
      const playerObj = JSON.stringify(sb.session.snapshot().house!.player);
      const heldSomewhere = stateView + playerObj;
      for (const s of producerSentinels) {
        expect(heldSomewhere.includes(s), `seed ${seed}: ${s} was not actually planted engine-side`).toBe(true);
      }

      // THE WALL: no NPC-facing / narration engine projection may carry ANY producer sentinel.
      // getMomentPrompt (renderGameContext), every npcVoice, every socialRead, and each NPC's
      // visible-state roster are the surfaces the narrator + houseguests read.
      const sweep = async (name: string, callArgs: Record<string, unknown>): Promise<void> => {
        const blob = JSON.stringify(await player.callTool(name, callArgs));
        for (const s of producerSentinels) {
          expect(blob.includes(s), `${name} leaked producer material (${s}) — the casting wall broke`).toBe(false);
        }
      };

      // In-game narration context, across representative live moments.
      for (const moment of ["premiere", "hoh-competition", "nominations", "veto-ceremony", "eviction"]) {
        await sweep("getMomentPrompt", { moment });
      }
      // Every houseguest's voice + the player's social read of them + their visible-state roster.
      for (const id of npcIds) {
        await sweep("npcVoice", { id });
        await sweep("socialRead", { houseguest: id });
      }
      // The player's own visible-state projection (the roster + what the player legitimately knows).
      await sweep("getVisibleStateFor", { entity: PLAYER });
      // The re-entry / recall path: a fresh-context moment recalls from the stores — it must not
      // recall the player's producer material into narration either.
      await sweep("getMomentPrompt", { moment: "re-entry" });
    }
  });
});
