// Cucumber.js configuration.
//
// The scaffold runs ONE scenario from feature 0001 as the "first failing test":
// the player-facing surface outline. Its `When` step calls a not-yet-implemented
// surface, so the scenario is RED until the implementer renders from the visible
// projection. As 0001 is implemented, widen `name` (or remove it) and add step
// definitions for the remaining scenarios.
export default {
  paths: ['docs/features/0001-vault-wall-isolation.feature'],
  import: ['test/bdd/**/*.ts'],
  name: ['No Vault content appears on a player-facing surface'],
  format: ['progress'],
};
