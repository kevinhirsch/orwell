import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { toolsFor } from "../../src/surfaces/tools/registry";
import type { McpServer } from "../../src/adapters/mcp/McpServer";
import type { AdvanceView } from "../../src/ports/GameSession";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * Feature B42 / audit E8 — the sentinel canary must bite the LIVE game. The old sweep ran against a
 * STANDALONE adapter disconnected from the fixture, so the session tools (advanceGame, gameStatus,
 * getGameState, runCompetition, the finale, …) could never fire it. This wires the sweep to the same
 * object graph the resolver serves, plants sentinels into the live hidden state (NPC backstory + soul
 * text + souls + hidden events + Vault + NPC knowledge), and proves NO player/admin tool — across the
 * whole game including the finale — ever returns one. HARD rule: roles only — no names.
 */

/** Plant a unique sentinel into every kind of hidden state the live game holds; return them all. */
function plantLiveSentinels(reg: GameSessionRegistry, user: string, seed: number): string[] {
  const sb = reg.sandboxFor(user);
  let n = 0;
  const sentinels: string[] = [];
  const mk = (tag: string): string => { const s = `SENTINEL-B42-${tag}-${seed}-${++n}`; sentinels.push(s); return s; };

  // (1) The generated house's HIDDEN string fields — the typed hidden elements (B50) + soul
  // memory — via snapshot→restore (the engine-side post-process of CharacterFactory output).
  // NOTE (B61): `background` is a curated PUBLIC facet (the narrator's voice anchor, projected
  // on the houseguest card by design) — the hidden material lives in `hiddenElements`.
  const core = sb.session.snapshot();
  for (const hg of core.house!.npcs) {
    hg.character.hiddenElements.push({ kind: "secret-motive", detail: mk("hidden") });
    hg.soul.memory.push(mk("soul"));
  }
  sb.session.restore(core); // also rebuilds the soul recall index from the (now sentinel-bearing) memory

  // (2) The engine's hidden layer the player/admin projections must never surface.
  sb.engine.events.record({ id: `b42:hidden:${seed}`, ts: 9_000_000, type: "conversation", initiator: npc(1), witnessSet: [npc(1), npc(2)], hidden: true, content: `off-screen ${mk("event")}` });
  sb.engine.soul.recordToSoul(npc(1), mk("soulstore"));
  sb.engine.vault.writeHidden({ id: `b42:vault:${seed}`, kind: "confessional", content: mk("vault") });
  sb.engine.knowledge.seedBelief(npc(2), { content: mk("npcknow"), factId: `b42k:${seed}` }, "witnessed"); // another NPC's private knowledge
  return sentinels;
}

const args = (name: string): Record<string, unknown> => {
  switch (name) {
    case "getMomentPrompt": return { moment: "nominations" };
    case "getVisibleStateFor": return { entity: PLAYER };
    case "renderScene": return { mode: "scene" };
    case "socialRead": return { houseguest: npc(1) };
    case "askProducers": return { question: "is anyone working against me?" };
    case "recordInteraction": return { initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: "a chat" };
    case "runCompetition": return { type: "endurance" };
    case "surfaceInformationTo": return { entity: PLAYER, fact: { content: "x" }, pathway: "told-by:npc:1" };
    case "diaryRoom": return { entry: "my private read" };
    case "makeDeal": return { with: npc(1), kind: "safety", terms: "we ride together" };
    // B65: voice the NPC who HOLDS adjacent secrets — their soul/hidden-element/Vault sentinels and
    // every OTHER houseguest's knowledge sentinel must still never cross (the per-NPC bound).
    case "npcVoice": return { id: npc(1) };
    case "overrideMechanic": return { mechanic: "pace", value: 1 };
    case "configure": return { temperature: 1 };
    case "manageSandbox": return { action: "save" }; // never "reset" — that would wipe the sentinels
    default: return {};
  }
};

describe("B42 — the sentinel canary bites the live game (production path)", () => {
  it("no player or admin tool leaks a sentinel — across the whole game incl. the finale", async () => {
    for (const seed of [2, 5]) {
      const reg = new GameSessionRegistry();
      const user = `u${seed}`;
      const player = reg.resolver()("player", user) as McpServer;
      const admin = reg.resolver()("admin", user) as McpServer;

      await player.callTool("createCharacter", { playerName: "The Player", seed });
      const sentinels = plantLiveSentinels(reg, user, seed);
      const swept = new Set<string>();

      // The canary only bites if the sentinels are GENUINELY in the live hidden state. Prove it: every
      // planted marker is present engine-side (house souls + the hidden event/Vault/soul/knowledge)…
      const engineSide = JSON.stringify(reg.sandboxFor(user).session.snapshot())
        + JSON.stringify(reg.sandboxFor(user).engine.events.query())
        + JSON.stringify(reg.sandboxFor(user).engine.soul.soulOf(npc(1)))
        + JSON.stringify(reg.sandboxFor(user).engine.knowledge.knownTo(npc(2)))
        + JSON.stringify(reg.sandboxFor(user).engine.vault.readHidden());
      for (const s of sentinels) expect(engineSide.includes(s), `seed ${seed}: ${s} was not actually planted`).toBe(true);

      const sweep = async (server: McpServer, name: string): Promise<void> => {
        swept.add(name);
        const blob = JSON.stringify(await server.callTool(name, args(name)));
        for (const s of sentinels) expect(blob.includes(s), `seed ${seed}: tool ${name} leaked ${s}`).toBe(false);
      };

      // Every NON-progression tool, with all houseguests still living (recordInteraction/makeDeal etc.).
      for (const t of toolsFor("player")) if (t.name !== "advanceGame" && t.name !== "submitDecision") await sweep(player, t.name);
      for (const t of toolsFor("admin/God Mode")) await sweep(admin, t.name);

      // Drive the loop to a winner, sweeping the live projections at EVERY beat — including the finale.
      let finished = false;
      for (let i = 0; i < 6000 && !finished; i++) {
        const adv = (await player.callTool("advanceGame", {})) as AdvanceView;
        swept.add("advanceGame");
        for (const s of sentinels) expect(JSON.stringify(adv).includes(s), `seed ${seed}: advanceGame leaked ${s}`).toBe(false);
        for (const name of ["gameStatus", "getGameState", "getMomentPrompt", "playerTagline", "socialInitiatives", "getVisibleStateFor", "finaleView"]) await sweep(player, name);

        // Finale projection lock (no pre-reveal tally): while the finale stages, no winner crosses, and
        // the precomputed votes / script are never serialized — only the reveals shown so far.
        if (adv.finale && !adv.finished) {
          expect(adv.winner, `seed ${seed}: a finale winner leaked before the reveal`).toBeNull();
          const fjson = JSON.stringify(adv.finale);
          expect(/"votes"|"script"|"tally"|"lean"/i.test(fjson), `seed ${seed}: the finale tally/script leaked`).toBe(false);
        }

        if (adv.pending) {
          swept.add("submitDecision");
          const p = adv.pending;
          if (p.kind === "nominations") await player.callTool("submitDecision", { kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
          else if (p.kind === "veto-decision") await player.callTool("submitDecision", { kind: "veto-decision", use: false });
          else if (p.kind === "replacement") await player.callTool("submitDecision", { kind: "replacement", replacement: p.options[0]!.id });
          else if (p.kind === "finale-statement") await player.callTool("submitDecision", { kind: "finale-statement", statement: "I earned this." });
          else if (p.kind === "finale-answer") await player.callTool("submitDecision", { kind: "finale-answer", appeal: p.appeals![0]! });
          else if (p.kind === "juror-vote") await player.callTool("submitDecision", { kind: "juror-vote", vote: p.options[0]!.id });
          else await player.callTool("submitDecision", { kind: p.kind, vote: p.options[0]!.id });
        }
        finished = adv.finished;
      }
      expect(finished, `seed ${seed}: the game reached a winner`).toBe(true);

      // Coverage: every player AND admin tool name was actually swept against the live graph.
      const allNames = [...toolsFor("player"), ...toolsFor("admin/God Mode")].map((t) => t.name);
      for (const name of allNames) expect(swept.has(name), `tool ${name} was never swept`).toBe(true);
    }
  });
});
