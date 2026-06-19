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

  replaceHidden(query: { kind?: HiddenKind; subject?: string }, records: readonly HiddenRecord[]): void {
    // Drop every record matching the query (a NARROW scope — both kind + subject in practice), then
    // append the replacements. Idempotent: re-sealing the same subject leaves exactly one set.
    for (let i = this.records.length - 1; i >= 0; i--) {
      const r = this.records[i]!;
      if ((query.kind === undefined || r.kind === query.kind) && (query.subject === undefined || r.subject === query.subject)) {
        this.records.splice(i, 1);
      }
    }
    for (const r of records) this.records.push(r);
  }
}
