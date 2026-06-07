// ENGINE-ONLY PORT.
//
// No player-facing or admin/God-Mode-facing module may import or depend on this port.
// The boundary is enforced structurally (composition roots) and verified by
// dependency-cruiser (.dependency-cruiser.cjs) — feature 0001.

export type VaultRecordKind =
  | 'hidden-attribute'
  | 'confessional'
  | 'hidden-thread'
  | 'offscreen-event'
  | 'reserved-twist';

export interface VaultRecord {
  readonly id: string;
  readonly kind: VaultRecordKind;
  readonly content: string;
}

export interface VaultStore {
  put(record: VaultRecord): void;
  all(): readonly VaultRecord[];
}
