// Port barrel. Ports are interfaces only — no I/O lives here.
//
// Engine-only ports (VaultStore, VectorIndex) are intentionally re-exported here too, but
// importing this barrel from an outward-facing module would trip the dependency-cruiser
// rule via the transitive edge — outward code should import the specific non-Vault port.
export type { EventStore } from './EventStore';
export type { RandomnessSource } from './RandomnessSource';
export type { VaultStore, VaultRecord, VaultRecordKind } from './VaultStore';
export type { VectorIndex, VectorMatch } from './VectorIndex';
