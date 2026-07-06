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

const args = (name: string, seed: number): Record<string, unknown> => {
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
    case "formAlliance": return { name: "The Test Alliance", members: [npc(1), npc(2)] }; // 0107
    case "joinAlliance": return { allianceId: "alliance:nope" }; // 0107 Phase B (no such pitch ⇒ null, never throws)
    // 0075: press a houseguest to confide — the returned content (whatever tier, even a fabricated
    // lie) must NEVER carry a planted sealed sentinel; the engine only ever discloses the secret it
    // chose + recorded, blurred/glossed to the tier, and a lie is engine-authored, not a real secret.
    case "confide": return { npcId: npc(1) };
    // 0095: accuse a pair of a prior connection. The sweep plants no seeded tie between npc(1)/npc(2),
    // so this exercises the MISS path (no sealed tie ⇒ no Vault read) — the result must never carry a
    // planted sealed sentinel either way (a hit would only ever echo the tie's own public nature/names).
    case "accuseTie": return { aId: npc(1), bId: npc(2) };
    // 0094: confront a houseguest over a learned belief. The sweep plants no player-held fact with this
    // id, so `confront` returns null (the Vault bright line — a non-learned belief is never minted); the
    // sweep proves the null return itself carries no sentinel.
    case "confront": return { npcId: npc(1), factId: `b42-no-such-fact:${seed}` };
    // 0093/0099: wield a secret. The sweep plants no learned fact, so a real factId would be rejected
    // (harmless) — instead exercise the BLUFF path (a fabricated claim that reads NOTHING from the Vault):
    // the result must NEVER carry a planted sealed sentinel (a bluff invents a claim; it never crosses a secret).
    case "exposeSecret": return { bluff: true, subject: npc(1) };
    case "tradeSecret": return { bluff: true, subject: npc(1), toNpcId: npc(2) };
    // B65: voice the NPC who HOLDS adjacent secrets — their soul/hidden-element/Vault sentinels and
    // every OTHER houseguest's knowledge sentinel must still never cross (the per-NPC bound).
    case "npcVoice": return { id: npc(1) };
    // 0051: portrait prompts are built from PUBLIC facets only — sweep them with a real id, and
    // record an image beat (a player-witnessed, Vault-free event) — neither may carry a sentinel.
    case "getPortraitPrompt": return { id: npc(1) };
    // PREMIERE meet-everyone (#380): mark a houseguest met — the returned reads carry PUBLIC facets
    // only, so no soul/hidden/Vault sentinel may cross (it's also a no-op once past the premiere).
    case "markHouseguestMet": return { id: npc(1) };
    // ADR 0009: record a narrated NPC relocation — a houseguest id + a room name. The result is a
    // Vault-free HouseguestMoveResult ({status, whereabouts}); no hidden state may cross.
    case "moveHouseguest": return { id: npc(1), room: "kitchen" };
    case "recordImageBeat": return { houseguestId: npc(1), imageRef: "img-ref" };
    // 0065: the FE authoring write-back (live house — the season is already running here) + the pre-warm
    // (a no-op refusal once started). Both are Vault-free by construction; the sweep proves the canary
    // never bites their outputs either.
    case "recordCastProfile": return { houseguestId: npc(1), biography: "A two-sentence public backstory. It has presentable parts." };
    // #544: the FE cast-identity write-back — a DESCRIPTIVE-only proposal on the live house. The sweep
    // folds it (validate/repair/re-ground/re-seal a private orientation) and proves the result
    // ({accepted, applied}) never echoes a soul/Vault/private-orientation sentinel.
    case "recordCastIdentity": return { facets: { [npc(1)]: { ethnicity: "Korean American", orientation: "gay", out: false, age: 41 } } };
    case "preSeedCast": return { seed: 1 };
    // 0062: the FE zeitgeist write-back — PUBLIC real-world flavor only (no Vault, no game input).
    // The sweep proves the canary never bites its output (an empty subset is a valid capture).
    case "recordWorldSnapshot": return { slices: {} };
    // 0070: the FE texture write-back addresses a planted HIDDEN off-screen event by id and writes
    // voiced prose — content-only. Point it at the real sentinel-bearing hidden event so the sweep
    // exercises the live write path; its result is a bare {ok} status that never echoes hidden content.
    case "recordOffscreenSceneTexture": return { eventId: `b42:hidden:${seed}`, content: "voiced off-screen prose" };
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
        + JSON.stringify(reg.sandboxFor(user).engine.events.queryAll())
        + JSON.stringify(reg.sandboxFor(user).engine.soul.soulOf(npc(1)))
        + JSON.stringify(reg.sandboxFor(user).engine.knowledge.knownTo(npc(2)))
        + JSON.stringify(reg.sandboxFor(user).engine.vault.readHidden());
      for (const s of sentinels) expect(engineSide.includes(s), `seed ${seed}: ${s} was not actually planted`).toBe(true);

      const sweep = async (server: McpServer, name: string): Promise<void> => {
        swept.add(name);
        const blob = JSON.stringify(await server.callTool(name, args(name, seed)));
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
        // E19: the per-beat re-sweep includes the knowledge-bearing reads (npcVoice/socialRead/
        // whereabouts/seasonRecap) — they were previously swept only at week 1, before the house
        // evolved any hidden history worth leaking.
        for (const name of ["gameStatus", "getGameState", "getMomentPrompt", "playerTagline", "socialInitiatives", "getVisibleStateFor", "finaleView", "npcVoice", "socialRead", "whereabouts", "seasonRecap"]) await sweep(player, name);

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

      // E19: one FULL post-finish sweep — every tool against the terminal house, where a season's
      // worth of hidden history exists to leak. Exclusions are principled, not convenient:
      //  - seasonRetrospective is the SANCTIONED post-season unsealing (0048) — it returns hidden
      //    content by design once the game is finished;
      //  - advanceGame was swept at every single beat above;
      //  - createCharacter/updateCasting are the start-of-game doors (swept pre-game) — calling
      //    them again would restart the sandbox and void the terminal state under sweep.
      // submitDecision is swept IN-LOOP when a decision arises; it is ALSO swept here (post-finish it
      // simply refuses — and the refusal text is sentinel-checked), so a player evicted early enough
      // to never reach an in-loop decision (a legitimate, fair loss — calibration-dependent) still
      // covers it. (It previously assumed the player always reaches a decision point.)
      const POST_FINISH_EXCLUDED = new Set(["seasonRetrospective", "advanceGame", "createCharacter", "updateCasting"]);
      // Action tools may deliberately REFUSE on a terminal house (e.g. recordInteraction naming an
      // evicted houseguest) — a refusal is a legitimate outcome, but its error text is still an
      // outward surface: it must be sentinel-free too.
      const sweepOrRefuse = async (server: McpServer, name: string): Promise<void> => {
        swept.add(name);
        let payload: string;
        try {
          payload = JSON.stringify(await server.callTool(name, args(name, seed)));
        } catch (err) {
          payload = String(err instanceof Error ? err.message : err); // the refusal text is the outward surface
        }
        for (const s of sentinels) expect(payload.includes(s), `seed ${seed}: post-finish ${name} leaked ${s}`).toBe(false);
      };
      for (const t of toolsFor("player")) if (!POST_FINISH_EXCLUDED.has(t.name)) await sweepOrRefuse(player, t.name);
      for (const t of toolsFor("admin/God Mode")) await sweepOrRefuse(admin, t.name);

      // Coverage: every player AND admin tool name was actually swept against the live graph.
      const allNames = [...toolsFor("player"), ...toolsFor("admin/God Mode")].map((t) => t.name);
      for (const name of allNames) expect(swept.has(name), `tool ${name} was never swept`).toBe(true);
    }
  });
});
