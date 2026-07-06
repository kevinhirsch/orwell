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
    // PERSIST-12: guard against duplicate-id growth, mirroring `InMemoryEventStore.record()`'s
    // duplicate-id guard in SPIRIT (no two live records ever share an id) — but stay IDEMPOTENT
    // rather than throwing, because `writeHidden` is used as a stable-id UPSERT by several live re-fold
    // paths, not a strict append log: the 0063 private-orientation seal re-derives + re-writes every
    // still-private houseguest's record on every `recordCastIdentity` call (most re-seals are byte-
    // identical no-ops, but the one houseguest whose proposal just changed their orientation legitimately
    // re-seals the SAME id with genuinely DIFFERENT content — see `GameSessionAdapter.recordCastIdentity`,
    // exercised by `castIdentity.test.ts` and the `liveSentinel` property gate). So: an identical re-seal
    // is a no-op (nothing duplicated), and a re-seal with different content updates that one record IN
    // PLACE (an id-scoped upsert, exactly what `replaceHidden({ id }, [record])` would do) — either way
    // the store never ends up with two records under the same id, so `readHidden` can't return stale AND
    // current content for the same subject at once, but no detail is silently dropped either (the
    // current truth for that id is always present).
    const existing = this.records.findIndex((r) => r.id === record.id);
    if (existing !== -1) {
      const prior = this.records[existing]!;
      if (prior.kind === record.kind && prior.subject === record.subject && prior.content === record.content) {
        return; // identical re-seal — idempotent no-op
      }
      this.records[existing] = record; // an evolved re-seal of the SAME id — update in place, never duplicate
      return;
    }
    this.records.push(record);
  }

  replaceHidden(query: { kind?: HiddenKind; subject?: string; id?: string }, records: readonly HiddenRecord[]): void {
    // Drop every record matching the query (a NARROW scope — kind + subject, and #1067 optionally the exact
    // id when two record families share a kind for one subject), then append the replacements. Idempotent:
    // re-sealing the same subject leaves exactly one set.
    for (let i = this.records.length - 1; i >= 0; i--) {
      const r = this.records[i]!;
      if ((query.kind === undefined || r.kind === query.kind)
          && (query.subject === undefined || r.subject === query.subject)
          && (query.id === undefined || r.id === query.id)) {
        this.records.splice(i, 1);
      }
    }
    for (const r of records) this.records.push(r);
  }
}
