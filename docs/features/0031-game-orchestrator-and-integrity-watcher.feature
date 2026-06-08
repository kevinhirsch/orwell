# DRAFT executable spec — author: feature-maker; implementer makes it pass.
# Feature 0031 — Per-sandbox game orchestrator + integrity watcher (hybrid: turn-driven spine +
# background supervisor). HARD rule: roles only (player, NPC, HOH, nominee); "user A"/"user B" are
# account roles (0021). "the clock advances" = a FAKE clock stepped explicitly (no real timers).

Feature: Game orchestrator & integrity watcher

  Every game advances through one deterministic, seeded path that runs off-screen NPC life,
  schedules the next meaningful day, folds consequences, persists, and verifies integrity
  (fail-closed). A background watcher triggers bounded off-screen advances on idle games and
  audits every sandbox's health — but holds no game logic, so a fake clock keeps it deterministic.
  Health is visible to God Mode only, Vault-free.

  Scenario: A turn-driven advance runs off-screen life and passes the integrity checkpoint
    Given a started game
    When the player triggers an advance
    Then the day carries at least one meaningful event
    And at least one off-screen scene occurs that the player does not witness
    And the integrity checkpoint passes
    And the new state is persisted

  Scenario: The house lives between turns (background off-screen ticks)
    Given a started game that the player has left idle
    When the clock advances past the idle threshold
    Then the watcher triggers bounded off-screen advances for that game
    And on the player's return there are new off-screen consequences
    But the player is shown no opinion numbers or hidden state

  Scenario: The integrity checkpoint is fail-closed (no degradation, no leak)
    Given a started game with recorded events, beliefs, and deepened souls
    When an advance would drop previously persisted detail or leak hidden state
    Then the checkpoint refuses to commit the advance
    And the prior persisted save is left intact
    And an integrity fault is recorded on that sandbox's health

  Scenario: The watcher is deterministic and holds no game logic
    Given two games started from the same seed
    When the same sequence of clock ticks is applied to each
    Then their resulting states are identical
    And disabling the watcher leaves games that never advance on their own

  Scenario: Isolation holds while the watcher audits many sandboxes
    Given two users each have their own in-progress game
    When the watcher ticks and audits across all sandboxes
    Then no advance or audit carries one user's content into the other's game

  Scenario: Sandbox health is visible to God Mode only and is Vault-free
    Given a started game whose Vault holds off-screen scheming and hidden attributes
    When God Mode reads that sandbox's health
    Then it returns only metadata (phase, counts, last advance, integrity status, faults)
    And it returns no Vault data and no other user's content
    And the player has no access to the health surface
