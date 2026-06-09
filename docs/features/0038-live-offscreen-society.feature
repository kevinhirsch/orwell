# DRAFT executable spec — author: feature-maker; implementer makes it pass.
# Feature 0038 — Live off-screen society: wire the rich sim + gossip diffusion + soul writes into the
# watcher tick (0035). Tests use a FAKE clock (no real timers). HARD rule: roles only (player, NPC).
# Add 0035 + 0038 to cucumber.cjs when green.

Feature: Live off-screen society

  Between the player's turns the house lives a varied hidden life: NPCs scheme, bond, and clash in more
  than one way; information travels NPC-to-NPC and drifts; off-screen scenes deepen the souls; and a
  distorted rumor can reach the player through an in-game pathway — never as a number. It is bounded,
  seed-deterministic, Vault-walled, and isolated per user.

  Scenario: The house lives in more than one way between turns
    Given a started game the player has left idle
    When the off-screen watcher runs several ticks
    Then more than one kind of NPC-to-NPC interaction occurs off-screen
    And none of it is witnessed by the player

  Scenario: Information travels NPC-to-NPC and drifts
    Given a hidden fact known to one houseguest
    When the off-screen society runs
    Then the fact diffuses to other houseguests along the social graph
    And it carries a source and a confidence that decays with distance
    And its content may drift from the original with each retelling

  Scenario: A distorted rumor can reach the player by pathway
    Given the off-screen society has diffused a fact toward the player
    When a diffusion pathway terminates at the player
    Then the player's knowledge gains the belief with its source and confidence
    But the player is shown no opinion number or hidden state

  Scenario: Off-screen scenes deepen the souls
    Given a started game the player has left idle
    When the off-screen society runs several ticks
    Then each houseguest's soul accumulates the off-screen scenes it lived
    And a later recall can surface a specific past off-screen moment
    And no previously recorded soul detail is lost

  Scenario: The off-screen society is bounded and deterministic
    Given two games started from the same seed and left idle
    When the same number of off-screen ticks is applied to each
    Then their resulting societies are identical
    And a long absence advances at most the configured number of ticks per wake

  Scenario: The off-screen society is Vault-free and isolated
    Given two users each have their own idle game whose Vault holds hidden scheming
    When the off-screen society runs across both
    Then no player surface reveals a hidden scene or an opinion number
    And no off-screen activity carries one user's content into the other's game
