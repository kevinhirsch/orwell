import type { VaultStore, HiddenRecord, HiddenKind } from "../../ports/VaultStore";

/** ENGINE-ONLY adapter. Wired only into the engine composition root. */
export class InMemoryVaultStore implements VaultStore {
  private readonly records: HiddenRecord[] = [];

  readHidden(query: { kind?: HiddenKind; subject?: string } = {}): HiddenRecord[] {
    return this.records.filter(
      (r) =>
        (query.kind === undefined || r.kind === query.kind) &&
        (query.subject === undefined || r.subject === query.subject),
    );
  }

  writeHidden(record: HiddenRecord): void {
    this.records.push(record);
  }
}
