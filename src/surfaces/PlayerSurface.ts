import type { EventStore } from '../ports/EventStore';

export type PlayerSurfaceKind =
  | 'scene narration'
  | 'NPC dialogue'
  | 'system message'
  | 'player-visible log'
  | 'end-of-session summary';

export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet (feature 0001 — make the scenario green).`);
    this.name = 'NotImplementedError';
  }
}

/**
 * Player-facing surface. Depends ONLY on non-Vault ports (here, the visibility-filtered
 * EventStore) — it has no handle to the Vault, by construction.
 *
 * STUB. Implementer (feature 0001): render strictly from the visible projection
 * (events the player witnessed + the player's KnowledgeState), never from the Vault, so the
 * 0001 scenarios go red -> green.
 */
export class PlayerSurface {
  constructor(private readonly events: EventStore) {}

  render(_kind: PlayerSurfaceKind): string {
    throw new NotImplementedError('PlayerSurface.render');
  }

  endOfSessionSummary(): string {
    // Allowed output, once implemented: only a confirmation that updated saves exist.
    throw new NotImplementedError('PlayerSurface.endOfSessionSummary');
  }

  answerDirectQuestion(_question: string): string {
    throw new NotImplementedError('PlayerSurface.answerDirectQuestion');
  }

  competitionResult(): string {
    throw new NotImplementedError('PlayerSurface.competitionResult');
  }
}
