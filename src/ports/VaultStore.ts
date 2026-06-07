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
  | "reserved-twist";

export interface HiddenRecord {
  id: string;
  kind: HiddenKind;
  subject?: string;
  content: string;
}

export interface VaultStore {
  readHidden(query?: { kind?: HiddenKind; subject?: string }): HiddenRecord[];
  writeHidden(record: HiddenRecord): void;
}
