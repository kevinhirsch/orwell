# DRAFT executable spec — author: feature-maker; implementer makes it pass.
# Feature 0030 — Durable per-user game persistence: a started game survives an engine restart,
# so the onboarding overlay never re-fires for a player who already has a game.
# HARD rule: roles only (player, NPC, HOH, nominee). "user A"/"user B" are account roles (0021).
# A "restart" is simulated by building a NEW registry over the SAME durable store (new process analogue).

Feature: Durable game persistence across engine restart

  The live per-user game is saved on every mutation and recalled on return, so an engine
  restart resumes the game instead of resetting it to setup. Per-user isolation, the 0007
  non-degradation guarantees, and the Vault Wall all hold across the restart.

  Scenario: A started game survives a restart and onboarding does not re-fire
    Given a user has created their houseguest and a game is in progress
    When the engine restarts and that user's sandbox is resumed
    Then the recalled game reports that it has started
    And it carries the same week, phase, and house roster as before the restart
    And a fresh onboarding state check for that user would not show the welcome overlay

  Scenario: A user with no saved game still sees onboarding after a restart
    Given one user has a saved game and another user has none
    When the engine restarts
    Then resuming the first user reports a started game
    But resuming the second user reports no started game

  Scenario: Per-user isolation holds across a restart
    Given two users each have their own in-progress game
    When the engine restarts and both sandboxes are resumed
    Then each user's recalled game is their own
    And no call on behalf of one user returns the other user's game

  Scenario: Detail does not degrade across a restart
    Given a game with recorded events, relationship beliefs, and deepened souls
    When the game is saved, the engine restarts, and the game is resumed
    Then every previously persisted detail is still present (a superset)
    And every detail count is non-decreasing
    And the static character baseline is byte-for-byte unchanged

  Scenario: The Vault Wall holds on a resumed game
    Given a saved game whose Vault holds off-screen NPC scheming and hidden attributes
    When the engine restarts and the player surface is queried over the resumed game
    Then the player surface returns no Vault data
