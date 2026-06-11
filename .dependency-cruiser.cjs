/**
 * dependency-cruiser configuration — the STRUCTURAL proof of the Vault Wall.
 *
 * The crux of feature 0001: no outward-facing module (player surface, admin /
 * God-Mode port, the visible-state services they consume, or the outward
 * composition root) may depend on the engine-only `VaultStore` / `VectorIndex`
 * ports, their adapters, or the engine composition root that wires them.
 *
 * `tsPreCompilationDeps: true` makes the check catch even type-only imports, so
 * an outward module cannot so much as *name* the Vault types.
 */
// B59/audit E7: OUTWARD covers every leak-sensitive outward consumer — the narrative adapters
// (the LLM seam itself) and the process entrypoint included, not just surfaces/services/mcp.
const OUTWARD =
  "^src/(surfaces|services)/|^src/composition/outwardRoot\\.ts$|^src/adapters/(mcp|narrative)/|^src/main\\.ts$";
// B59/audit E7: VAULT also names the engine modules that HOLD hidden logic/state (the relationship
// ledger, confessionals, off-screen life, gossip, the live loop) — a surface could otherwise import
// confessionalFor()/relationship internals without tripping the gate. Type-only imports count.
const VAULT =
  "^src/ports/(VaultStore|VectorIndex|SoulProvider|EmbeddingProvider|UserSaveStore)\\.ts$" +
  "|^src/adapters/inmemory/(InMemoryVaultStore|InMemoryVectorIndex)\\.ts$" +
  "|^src/adapters/engine/(SoulStore|FileSaveStore)\\.ts$" +
  "|^src/adapters/embedding/DeterministicEmbedding\\.ts$" +
  "|^src/engine/(sessionSnapshot|relationships|confessionals|offscreen|gossip|liveSeason)\\.ts$" +
  "|^src/composition/engineRoot\\.ts$";

// Audit E18: the VAULT denylist above enumerates KNOWN hidden modules — every new engine
// module (characterFactory's hiddenElements, emotionalArc, deals, decisions, jury, blocs,
// presence, competitionLibrary, …) had to be remembered into it. ENGINE_LAYER closes that
// hole by construction: outward code may not reach into the engine layer AT ALL. The only
// sanctioned edge is the process entrypoint composing the runtime (src/main.ts →
// src/composition/runtime.ts); everything else outward consumes ports and outward-safe
// services. The denylist rule stays as a second, independent tripwire (strengthen, never
// weaken).
const ENGINE_LAYER =
  "^src/engine/" +
  "|^src/adapters/(inmemory|engine|embedding)/" +
  "|^src/composition/";

module.exports = {
  forbidden: [
    {
      name: "no-vault-on-outward",
      severity: "error",
      comment:
        "Outward-facing code must be structurally incapable of reading the Vault. " +
        "The narrator cannot leak what it never receives.",
      from: { path: OUTWARD },
      to: { path: VAULT },
    },
    {
      name: "no-engine-layer-on-outward",
      severity: "error",
      comment:
        "Default-deny (audit E18): outward code may not import ANY engine-layer module — " +
        "src/engine/**, the engine/inmemory/embedding adapters, or the composition wiring. " +
        "New hidden-state modules are covered the day they are created, without being " +
        "enumerated. The sole exception is below (entrypoint → runtime).",
      from: { path: OUTWARD, pathNot: "^src/main\\.ts$" },
      to: { path: ENGINE_LAYER, pathNot: "^src/composition/outwardRoot\\.ts$" },
    },
    {
      name: "entrypoint-composes-runtime-only",
      severity: "error",
      comment:
        "The process entrypoint may compose the runtime (which wires the Vault internally) " +
        "but nothing else in the engine layer (audit E18).",
      from: { path: "^src/main\\.ts$" },
      to: { path: ENGINE_LAYER, pathNot: "^src/composition/(runtime|outwardRoot)\\.ts$" },
    },
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular dependencies muddy the port boundaries; keep the graph acyclic.",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: { extensions: [".ts", ".js"] },
    doNotFollow: { path: "node_modules" },
    exclude: { path: "node_modules" },
  },
};
