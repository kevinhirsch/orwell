/**
 * ENGINE-ONLY PORT — the Producer's Vault.
 *
 * No player-facing OR admin/God-Mode-facing module may import this file. The
 * boundary is enforced structurally by dependency-cruiser (rule
 * `no-vault-on-outward`) with `tsPreCompilationDeps` on, so an outward module
 * cannot even name these types. The narrator cannot leak what it never receives.
 */
export type HiddenKind =
  | "hidden-attribute"
  | "confessional"
  | "hidden-thread"
  | "offscreen-event"
  | "reserved-twist"
  | "seeded-relationship";

export interface HiddenRecord {
  id: string;
  kind: HiddenKind;
  subject?: string;
  content: string;
}

export interface VaultStore {
  readHidden(query?: { kind?: HiddenKind; subject?: string }): HiddenRecord[];
  writeHidden(record: HiddenRecord): void;
  /**
   * Atomically REPLACE every hidden record matching `query` with `records` (an idempotent upsert by
   * subject+kind). Used by the 0058 / L28b authored write-back to re-seal ONE houseguest's profile +
   * threads without leaving stale or duplicated records. Engine-only, like the rest of this port.
   */
  replaceHidden(query: { kind?: HiddenKind; subject?: string }, records: readonly HiddenRecord[]): void;
}
