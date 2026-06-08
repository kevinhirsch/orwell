// Cucumber.js configuration (CommonJS so it loads regardless of "type": "module").
// TypeScript step definitions are loaded through the tsx ESM loader, wired via
// NODE_OPTIONS="--import tsx" in the `test:bdd` npm script.
//
// `paths` intentionally lists only the features that have been IMPLEMENTED. The
// drafts for later priorities (0002–0008) stay untouched and are added here as
// each one is built to green, in priority order.
module.exports = {
  default: {
    paths: [
      "docs/features/0001-vault-wall-isolation.feature",
      "docs/features/0002-event-visibility-and-propagation.feature",
      "docs/features/0003-behavioral-fidelity.feature",
      "docs/features/0004-replayability-and-naming.feature",
      "docs/features/0005-competition-eligibility.feature",
      "docs/features/0006-outcomes-by-stats-and-temperature.feature",
      "docs/features/0007-persistence-non-degradation.feature",
      "docs/features/0008-daily-event-invariant.feature",
      "docs/features/0009-mcp-tool-boundary.feature",
      "docs/features/0011-weekly-loop-orchestration.feature",
      "docs/features/0012-conversation-and-scene-system.feature",
      "docs/features/0013-diary-room.feature",
      "docs/features/0014-jury-and-endgame.feature",
      "docs/features/0015-character-creation-oobe.feature",
      "docs/features/0016-god-mode-admin.feature",
      "docs/features/0017-relationship-model.feature",
      "docs/features/0018-narrative-moment-orchestration.feature",
      "docs/features/0019-agent-driven-play-loop.feature",
      "docs/features/0020-player-experience.feature",
      "docs/features/0021-game-session-and-save-lifecycle.feature",
      "docs/features/0023-consequence-and-memory.feature",
      "docs/features/0024-soul-storage-and-memory-recall.feature",
      "docs/features/0025-reserve-twists.feature",
      "docs/features/0027-narrative-port-llm-adapter.feature",
    ],
    import: ["features/support/**/*.ts", "features/step_definitions/**/*.ts"],
  },
};
