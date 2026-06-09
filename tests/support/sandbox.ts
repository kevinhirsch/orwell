import type { HiddenKind } from "../../src/ports/VaultStore";
import { buildEngineCore } from "../../src/composition/engineRoot";
import type { EngineCore } from "../../src/composition/engineRoot";
import { buildOutwardChannels } from "../../src/composition/outwardRoot";
import { InMemoryGameStateRepository } from "../../src/adapters/inmemory/InMemoryGameStateRepository";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";
import type { PlayerSurface, PlayerSurfaceType } from "../../src/surfaces/player/PlayerSurface";
import type { AdminPort } from "../../src/surfaces/admin/AdminPort";
import type { SummaryService } from "../../src/services/SummaryService";
import type { PlayerCompetitionView } from "../../src/domain/competition";

export const ALL_PLAYER_SURFACES: readonly PlayerSurfaceType[] = [
  "scene narration",
  "NPC dialogue",
  "system message",
  "player-visible log",
  "end-of-session summary",
];

export interface VaultDatum {
  id: string;
  content: string;
  sentinel: string;
}

export interface Sandbox {
  engine: EngineCore;
  player: PlayerSurface;
  admin: AdminPort;
  summary: SummaryService;
  /** Every fixture-injected sentinel (one per Vault datum). */
  sentinels: string[];
  /** Raw hidden content strings (each embeds its sentinel). */
  hiddenContents: string[];
  rng: SeededRandom;
  freshSentinel(prefix?: string): string;
  addConfessional(): VaultDatum;
  addOffscreenEvent(): VaultDatum;
  addReservedTwist(): VaultDatum;
  addHiddenAttribute(): VaultDatum;
  addNpcDeal(): VaultDatum;
  competitionViewForPlayer(): PlayerCompetitionView;
  surfaceHiddenFactToPlayer(): { content: string };
  allPlayerOutputs(): string;
  adminOutput(): string;
}

/**
 * Stands up a running game sandbox with a FULLY POPULATED Producer's Vault in
 * which every hidden datum carries a unique sentinel not derivable from visible
 * state. Used by both the Cucumber world and the Vitest property tests.
 */
export function buildSandbox(seed = 1): Sandbox {
  const rng = new SeededRandom(seed);
  const engine = buildEngineCore();
  const sentinels: string[] = [];
  const hiddenContents: string[] = [];
  let sc = 0;
  let evid = 0;
  const nextEvId = (): string => `evt:${++evid}`;

  const freshSentinel = (prefix = "S"): string => {
    const s = `SENTINEL-${prefix}-${seed}-${++sc}-${Math.floor(rng.next() * 1e9)}`;
    sentinels.push(s);
    return s;
  };

  const addVault = (kind: HiddenKind, subject?: EntityId): VaultDatum => {
    const sentinel = freshSentinel(kind);
    const id = `vault:${sc}`;
    const content = `[${kind}]${subject ? ` ${subject}` : ""} secret-detail ${sentinel}`;
    engine.vault.writeHidden({ id, kind, content, ...(subject ? { subject } : {}) });
    hiddenContents.push(content);
    return { id, content, sentinel };
  };

  const recordOffscreen = (a: EntityId, b: EntityId, verb: string, prefix: string): VaultDatum => {
    const sentinel = freshSentinel(prefix);
    const id = `vault:${sc}`;
    const content = `[offscreen] ${a} ${verb} ${b} ${sentinel}`;
    engine.events.record({
      id: nextEvId(), ts: sc, type: "conversation",
      initiator: a, witnessSet: [a, b], hidden: true, content,
    });
    engine.vault.writeHidden({ id, kind: "offscreen-event", content });
    hiddenContents.push(content);
    return { id, content, sentinel };
  };

  // An NPC↔NPC deal (0039): a hidden pact the player never witnessed. Vault-held with a sentinel,
  // so the canary proves a secret deal can never bleed onto a player surface.
  const recordNpcDeal = (a: EntityId, b: EntityId): VaultDatum => {
    const sentinel = freshSentinel("npc-deal");
    const id = `vault:${sc}`;
    const content = `[npc-deal] ${a} and ${b} struck a hidden final-two pact ${sentinel}`;
    engine.events.record({
      id: nextEvId(), ts: sc, type: "conversation",
      initiator: a, witnessSet: [a, b], hidden: true, content,
    });
    engine.vault.writeHidden({ id, kind: "hidden-thread", content });
    hiddenContents.push(content);
    return { id, content, sentinel };
  };

  // --- Fully populate the Vault with sentinels ---
  for (let i = 1; i <= 4; i++) addVault("hidden-attribute", npc(i));
  for (let i = 1; i <= 3; i++) {
    const d = addVault("confessional", npc(i));
    engine.events.record({
      id: nextEvId(), ts: sc, type: "confessional",
      initiator: npc(i), witnessSet: [npc(i)], hidden: true, content: d.content,
    });
  }
  addVault("hidden-thread");
  addVault("hidden-thread");
  recordNpcDeal(npc(2), npc(3)); // a hidden NPC↔NPC deal (0039) — Vault-walled like any secret
  for (let i = 1; i <= 3; i++) recordOffscreen(npc(i), npc(i + 1), "schemed with", "offscreen");
  addVault("reserved-twist");

  // --- Visible, player-witnessed events (NO sentinel) ---
  engine.events.record({
    id: nextEvId(), ts: sc, type: "conversation",
    initiator: PLAYER, witnessSet: [PLAYER, npc(1)], hidden: false,
    content: "You chatted with an ally in the kitchen.",
  });
  engine.events.record({
    id: nextEvId(), ts: sc, type: "house-event",
    initiator: npc(2), witnessSet: [PLAYER, npc(2), npc(3)], hidden: false,
    content: "A house meeting was called.",
  });

  // --- Admin-visible non-Vault state (NO sentinel) ---
  const adminState = new InMemoryGameStateRepository({
    week: 1,
    phase: "nominations",
    houseguests: [
      { role: "HOH", status: "active" },
      { role: "nominee", status: "active" },
      { role: "nominee", status: "active" },
    ],
  });

  const { player, admin, summary } = buildOutwardChannels({
    player: PLAYER, events: engine.events, knowledge: engine.knowledge, adminState,
  });

  const allPlayerOutputs = (): string =>
    ALL_PLAYER_SURFACES.map((s) => player.produce(s)).join("\n---\n") +
    "\n---\n" + JSON.stringify(player.assembleNarrationContext("scene")) +
    "\n---\n" + JSON.stringify(player.assembleNarrationContext("dialogue")) +
    "\n---\n" + player.renderScene("compressed") +
    "\n---\n" + player.renderScene("full") +
    "\n---\n" + player.socialRead() +
    "\n---\n" + player.socialRead(npc(1));

  const adminOutput = (): string => JSON.stringify(admin.inspect());

  return {
    engine, player, admin, summary, sentinels, hiddenContents, rng, freshSentinel,
    addConfessional: () => {
      const d = addVault("confessional", npc(5));
      engine.events.record({
        id: nextEvId(), ts: sc, type: "confessional",
        initiator: npc(5), witnessSet: [npc(5)], hidden: true, content: d.content,
      });
      return d;
    },
    addOffscreenEvent: () => recordOffscreen(npc(6), npc(7), "betrayed", "offscreen-extra"),
    addReservedTwist: () => addVault("reserved-twist"),
    addHiddenAttribute: () => addVault("hidden-attribute", npc(8)),
    addNpcDeal: () => recordNpcDeal(npc(6), npc(7)),
    competitionViewForPlayer: () => {
      // Engine-side stats are Vault/engine-only and carry a sentinel...
      const statSentinel = freshSentinel("stat");
      const content = `competition stats physical/mental/social ${statSentinel}`;
      engine.vault.writeHidden({ id: `vault:${sc}`, kind: "hidden-attribute", subject: "competition", content });
      hiddenContents.push(content);
      // ...the player surface only ever receives a stat-free {type, winnerLabel}.
      return player.competitionResult({ type: "HOH", winnerLabel: "The new Head of Household" });
    },
    surfaceHiddenFactToPlayer: () => {
      recordOffscreen(npc(1), npc(2), "formed a secret alliance with", "surfaceable");
      const gossip = "An NPC told you a secret alliance has formed.";
      // Anchored (A4): the teller actually holds what they tell — seed npc:1's belief, then surface it.
      engine.knowledge.seedBelief(npc(1), { content: gossip, factId: "alliance-gossip" }, "witnessed");
      engine.knowledge.surfaceInformationTo(PLAYER, { content: gossip }, "told-by:npc:1");
      return { content: gossip };
    },
    allPlayerOutputs,
    adminOutput,
  };
}
