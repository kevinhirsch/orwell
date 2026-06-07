# DRAFT executable spec — author: feature-maker; implementer makes it pass.
# Build priority #7 — Persistence non-degradation.
# HARD rule: roles only; generated fixtures.

Feature: Persistence non-degradation — detail accumulates and never regresses

  Persisted detail must never be lost across saves or versions and should accumulate and
  deepen over the game. A save is { domain-core version, Vault store, Journal store }; the
  Vault and Journal are versioned together.

  Scenario: A save round-trips losslessly
    Given a game with accumulated behavioral detail
    When the game is saved and immediately reloaded
    Then the reloaded state equals the saved state with no field dropped

  Scenario: Persisted detail does not degrade across versions
    Given a game saved at one version
    When the game is reloaded and saved again at the next version
    Then every datum present at the earlier version is still present
    And no previously-persisted detail is lost

  Scenario: Detail accumulates as the game proceeds
    Given two saves taken at two points in the same game
    When the later save is compared to the earlier
    Then the later save is a superset of the earlier
    And the counts of events, knowledge facts, and relationship edges are non-decreasing

  Scenario: The Vault and Journal versions increment together
    Given a save is taken
    When the Vault store version increments
    Then the Journal store version increments in the same save

  Scenario Outline: Non-degradation holds across a long seeded game
    Given the game is simulated and saved repeatedly with seed "<seed>"
    Then each save is a superset of the one before it

    Examples:
      | seed |
      | 1    |
      | 2    |
