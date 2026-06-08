import type { SessionSnapshot } from "../engine/sessionSnapshot";

/**
 * Durable, per-user persistence for the LIVE game (feature 0030). Keyed by the
 * authenticated user (0021): user A's reload can only load user A's game, and a
 * user with no save is treated as new (onboarding). A "restart" is a fresh process
 * (new registry) over the SAME durable store — `hasSave`/`loadLatest` recall the
 * game from disk with no in-memory pointer.
 *
 * ENGINE-ONLY: a snapshot carries the house's souls + the hidden relationship
 * layer, so no outward module may import this (enforced by dependency-cruiser,
 * like `VaultStore`/`SoulProvider`).
 */
export interface UserSaveStore {
  /** Persist the user's latest snapshot (a new version; prior versions are never overwritten). */
  saveFor(user: string, snapshot: SessionSnapshot): void;
  /** Whether a durable save exists for this user (drives load-on-resume vs fresh onboarding). */
  hasSave(user: string): boolean;
  /** The user's latest durable snapshot, or null if they have none. */
  loadLatest(user: string): SessionSnapshot | null;
}
