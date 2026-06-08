# DRAFT executable spec — author: feature-maker; implementer makes it pass.
# Feature 0025 — Reserve twists. Vault-sealed from player AND admin; engine-timed; format-preserving.
# HARD rule: roles only. A twist's existence/timing is secret until it fires.

Feature: Reserve twists — a Vault-sealed surprise neither the player nor the admin can see coming

  A small curated pool of classic, non-structural twists is held in reserve. The engine decides if
  and when one fires, at a dramatic beat. Until it fires, what it is and when it fires are sealed in
  the Vault — invisible to the player and to the admin alike — and the core format is never broken.

  Background:
    Given a running game sandbox with a reserve twist loaded and sealed in the Vault

  Scenario: A pending twist is invisible to the player
    When any player-facing surface is produced before the twist fires
    Then no reserve twist appears
    And no hint that a twist is pending appears
    And no Vault sentinel value appears

  Scenario: A pending twist is invisible to the admin too
    Given the admin enabled reserve twists by count
    When the admin inspects the sandbox before the twist fires
    Then the admin cannot see which twist was prepared
    And the admin cannot see when it will fire
    And no Vault sentinel value appears

  Scenario: The engine fires a twist rarely and deterministically
    When the game is played out under a fixed seed
    Then at most the admin-enabled count of twists fires
    And each fires at a dramatic beat
    And the same seed reproduces the same twist and timing

  Scenario: Firing a twist makes it a witnessed event
    When a reserve twist fires
    Then it becomes a witnessed in-game event
    And the narrator can voice it
    And only then is it known

  Scenario: A twist never breaks the hard rules or the core arc
    When a reserve twist fires
    Then the eligibility and legality invariants still hold
    And the season still reaches a jury of nine and a final two
