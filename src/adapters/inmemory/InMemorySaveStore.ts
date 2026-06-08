import type { SaveStore, SaveRef } from "../../ports/SaveStore";
import type { GameState } from "../../domain/saveState";
import { serialize, deserialize, deepCopy } from "../../domain/saveState";

/**
 * In-memory persistence. Each save bumps the Vault and Journal versions TOGETHER
 * and stores an immutable snapshot, so older saves remain loadable unchanged —
 * detail can never regress (mandate #4). SQLite/Postgres adapters slot in behind
 * the same `SaveStore` port later.
 */
export class InMemorySaveStore implements SaveStore {
  private readonly snapshots = new Map<number, string>();
  private version = 0;

  save(state: GameState): SaveRef {
    this.version += 1;
    const snapshot: GameState = { ...deepCopy(state), vaultVersion: this.version, journalVersion: this.version };
    this.snapshots.set(this.version, serialize(snapshot));
    return { coreVersion: snapshot.coreVersion, vaultVersion: this.version, journalVersion: this.version };
  }

  load(ref: SaveRef): GameState {
    const blob = this.snapshots.get(ref.vaultVersion);
    if (!blob) throw new Error(`no save at version ${ref.vaultVersion}`);
    return deserialize(blob);
  }
}
