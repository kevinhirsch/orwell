import { VisibleStateService } from "../services/VisibleStateService";
import { SummaryService } from "../services/SummaryService";
import { PlayerSurface } from "../surfaces/player/PlayerSurface";
import { AdminPort } from "../surfaces/admin/AdminPort";
import { EchoNarrativePort } from "../adapters/narrative/EchoNarrativePort";
import type { EventStore } from "../ports/EventStore";
import type { KnowledgeService } from "../ports/KnowledgeService";
import type { GameStateRepository } from "../ports/GameStateRepository";
import type { NarrativePort } from "../ports/NarrativePort";
import type { EntityId } from "../domain/ids";

/**
 * Outward composition root. It imports NO Vault types or adapters and never
 * touches the engine root that wires them — verified by dependency-cruiser. It
 * receives only the non-Vault ports (`EventStore`, `KnowledgeService`,
 * `GameStateRepository`), so the player and admin surfaces it builds are
 * structurally incapable of reading the Vault.
 */
export interface OutwardChannels {
  player: PlayerSurface;
  admin: AdminPort;
  summary: SummaryService;
}

export interface OutwardDeps {
  player: EntityId;
  events: EventStore;
  knowledge: KnowledgeService;
  adminState: GameStateRepository;
  narrator?: NarrativePort;
}

export function buildOutwardChannels(deps: OutwardDeps): OutwardChannels {
  const visible = new VisibleStateService(deps.events, deps.knowledge);
  const summary = new SummaryService();
  const narrator = deps.narrator ?? new EchoNarrativePort();
  const player = new PlayerSurface(deps.player, visible, narrator, summary);
  const admin = new AdminPort(deps.adminState);
  return { player, admin, summary };
}
