# DRAFT executable spec — author: feature-maker; implementer makes it pass.
# Build priority #3 — Behavioral fidelity (richness). Property-style over seeded runs.
# HARD rule: roles only, never names. Fixtures are generated, never sample-save content.

Feature: Behavioral fidelity — a house with real social life beyond the player

  A mechanically-correct but behaviorally-thin game is a failure state. Over a season the
  house must generate alliances forming and fracturing, gossip, scheming, showmance,
  betrayal, and private strategy talk — with most of it off-screen relative to
  the player. Deep hidden character elements surface only rarely, never dumped.

  Background:
    Given an active game simulated over many in-game days with a fixed seed

  Scenario: The house has rich social life beyond the player
    When the simulated stretch completes
    Then alliances, gossip, scheming, and private conversations have occurred among NPCs
    And most of them occurred off-screen relative to the player

  Scenario: NPCs initiate among themselves without the player
    When the simulated stretch completes
    Then some scenes were initiated by NPCs with witness sets that exclude the player

  Scenario: Alliances form and fracture over the season
    When the simulated stretch completes
    Then at least one alliance formed
    And at least one alliance shifted or fractured
    And relationship edge strengths changed over time

  Scenario: Hidden character elements surface rarely, not dumped
    When the simulated stretch completes
    Then hidden elements were revealed on only a small fraction of moments
    And no single moment revealed more than the allowed maximum of hidden elements

  Scenario Outline: Richness thresholds hold across seeds
    Given the game is simulated with seed "<seed>"
    Then most NPC interactions occurred off-screen (share ≥ the configured majority minimum)
    And the diversity of NPC interaction types meets the configured minimum
    And the hidden-element surfacing rate stays within the configured bounds

    Examples:
      | seed |
      | 1    |
      | 2    |
      | 3    |
