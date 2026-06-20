Feature: 0065 — cast pre-warm: deep-author the cast before portraits
  The cast is generated and deeply authored off the season seed BEFORE the casting interview ends,
  so portraits read a finished character. The authoring write-back must actually reach the engine
  (the boundary was previously closed), the pre-warm must be Vault-free and deterministic, and
  createCharacter must ADOPT the warmed, authored cast — losing none of it.

  # HARD: roles only, no names. The warmed roster is engine ids + observable public facets.

  Scenario: the authoring write-back reaches the engine over the player channel
    Given a player-channel server with no game yet
    When the cast is pre-warmed over the channel
    Then the pre-warm returns a Vault-free roster with portrait prompts
    When an authored biography is written back over the channel for a warmed houseguest
    Then the write-back is accepted over the channel

  Scenario: the warmed cast is deep, Vault-free, and player-independent
    Given a pre-warmed cast for seed "warm-A"
    Then every warmed houseguest carries a multi-sentence biography
    And the warmed roster carries no secret, true goal, weakness, or perception
    And a second pre-warm of the same seed produces the same warmed cast

  Scenario: createCharacter adopts the warmed and authored cast
    Given a pre-warmed cast for seed "warm-B"
    And a houseguest biography is authored before the season starts
    When the season is finalized with the warmed seed
    Then the authored biography is on the live house
    And the live game state never leaks the authored hidden content

  Scenario: a half-warmed authored cast is durable
    Given a pre-warmed cast for seed "warm-C"
    And a houseguest biography is authored before the season starts
    When the warmed cast is snapshotted and restored
    And the season is finalized with the warmed seed
    Then the authored biography is on the live house
