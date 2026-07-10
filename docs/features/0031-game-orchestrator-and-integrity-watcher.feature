# Executable spec — IMPLEMENTED & green; BDD-gated in cucumber.cjs. (Originally drafted failing-first.)
# Feature 0031 — Per-sandbox game orchestrator + integrity checkpoint (a pure turn-driven spine).
# HARD rule: roles only (player, NPC, HOH, nominee); "user A"/"user B" are account roles (0021).
# Real-time purge 2026-07-10 (PO ruling): there is NO wall-clock watcher and NO real-world clock —
# the house lives ONLY on the player's play-clock (one bounded off-screen tick per committed turn).

Feature: Game orchestrator & integrity checkpoint

  Every game advances through one deterministic, seeded path that runs off-screen NPC life,
  schedules the next meaningful day, folds consequences, persists, and verifies integrity
  (fail-closed). The house lives ONLY on the player's play-clock: every committed player turn
  fires one bounded off-screen tick — nothing runs on real time, and the house does not exist
  while the player is away. Health is visible to God Mode only, Vault-free.

  Scenario: A turn-driven advance runs off-screen life and passes the integrity checkpoint
    Given a started game
    When the player triggers an advance
    Then the day carries at least one meaningful event
    And at least one off-screen scene occurs that the player does not witness
    And the integrity checkpoint passes
    And the new state is persisted

  Scenario: The house lives between turns (one bounded off-screen tick per committed turn)
    Given a started game the player is actively playing
    When the player commits a turn
    Then that turn fires one bounded off-screen advance for that game
    And on the next turn there are new off-screen consequences
    But the player is shown no opinion numbers or hidden state

  Scenario: The integrity checkpoint is fail-closed (no degradation, no leak)
    Given a started game with recorded events, beliefs, and deepened souls
    When an advance would drop previously persisted detail or leak hidden state
    Then the checkpoint refuses to commit the advance
    And the prior persisted save is left intact
    And an integrity fault is recorded on that sandbox's health

  Scenario: Off-screen life is deterministic and holds no game logic
    Given two games started from the same seed
    When the same sequence of committed turns is applied to each
    Then their resulting states are identical
    And a game with no committed turn never advances on its own

  Scenario: Isolation holds while the house lives between turns across sandboxes
    Given two users each have their own in-progress game
    When each user commits a turn in their own game
    Then no advance carries one user's content into the other's game

  Scenario: Sandbox health is visible to God Mode only and is Vault-free
    Given a started game whose Vault holds off-screen scheming and hidden attributes
    When God Mode reads that sandbox's health
    Then it returns only metadata (phase, counts, last advance, integrity status, faults)
    And it returns no Vault data and no other user's content
    And the player has no access to the health surface
