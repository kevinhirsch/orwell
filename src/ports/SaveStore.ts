import type { GameState } from "../domain/saveState";

export interface SaveRef {
  coreVersion: number;
  vaultVersion: number;
  journalVersion: number;
}

/** Persistence boundary. The Vault and Journal versions bump TOGETHER on save. */
export interface SaveStore {
  save(state: GameState): SaveRef;
  load(ref: SaveRef): GameState;
}
