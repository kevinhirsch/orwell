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
  /**
   * Optional monotonic time marker for the record (#852) — additive/back-compat: a record written
   * without it round-trips byte-identically, and every existing reader ignores it. Lets the producer's
   * Vault dump carry a chronological marker for records that have one (the live, time-stamped hidden
   * layer); pre-game seals simply omit it and sort as setup.
   */
  ts?: number;
}

export interface VaultStore {
  readHidden(query?: { kind?: HiddenKind; subject?: string }): HiddenRecord[];
  writeHidden(record: HiddenRecord): void;
  /**
   * Atomically REPLACE every hidden record matching `query` with `records` (an idempotent upsert). Used
   * by the 0058 / L28b authored write-back to re-seal ONE houseguest's profile + threads without leaving
   * stale or duplicated records. Engine-only, like the rest of this port.
   *
   * `id` (#1067) narrows the match to ONE exact record — REQUIRED when two record families share a
   * `kind` for the same `subject` (the deep-profile + the private-orientation are BOTH `hidden-attribute`
   * for the same houseguest, so a `{kind,subject}`-only re-seal of the profile would also DELETE the
   * orientation — a Vault non-degradation regression). All provided query fields must match (AND).
   */
  replaceHidden(query: { kind?: HiddenKind; subject?: string; id?: string }, records: readonly HiddenRecord[]): void;
}
