// Architecture boundary for the Vault Wall (feature 0001).
//
// Outward-facing code — the player/admin surfaces and their composition roots —
// must NEVER depend on the engine-only Vault or the engine-only vector index.
// dependency-cruiser fails the build on any forbidden edge, so the boundary is a
// machine-checked structural guarantee, not a convention.
module.exports = {
  forbidden: [
    {
      name: 'no-outward-vault-access',
      severity: 'error',
      comment:
        'Player-/admin-facing surfaces and their composition roots must not import the ' +
        'VaultStore or the (engine-only) VectorIndex — the model cannot leak what it never receives.',
      from: { path: '^src/(surfaces/|app/(player|admin)Context)' },
      to: { path: '^src/(ports/VaultStore|ports/VectorIndex|adapters/.*[Vv]ault)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { extensions: ['.ts', '.js'] },
  },
};
