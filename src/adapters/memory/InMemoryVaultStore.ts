import type { VaultStore, VaultRecord } from '../../ports/VaultStore';

/** In-memory, ENGINE-ONLY VaultStore. Only the engine composition root may wire this. */
export class InMemoryVaultStore implements VaultStore {
  private readonly records: VaultRecord[] = [];

  put(record: VaultRecord): void {
    this.records.push(record);
  }

  all(): readonly VaultRecord[] {
    return this.records;
  }
}
