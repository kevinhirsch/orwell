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

  # --- B53 amendment (2026-06-10): the twists fire in the LIVE game ---------------
  # The original scenarios proved the pure module; these prove the live loop fires a
  # sealed double eviction through the real decision seam (audit D6 + B8).

  Scenario: A sealed double eviction fires in the live game, exactly once
    Given a live seeded game with a double eviction sealed for an upcoming week
    When the season is played through the live decision seam
    Then the double eviction fires exactly once, at its sealed week
    And the reveal is a witnessed live event
    And no player or admin surface revealed the twist before it fired

  Scenario: The double-eviction night preserves the hard rules and the arc
    Given a live seeded game with a double eviction sealed for an upcoming week
    When the season is played through the live decision seam
    Then two houseguests are evicted in the twist week
    And the first crown's head of household does not win the second crown of the night
    And both evictions count toward the jury order
    And the live season still reaches a final two with a winner

  Scenario: The sealed twist schedule survives an engine restart
    Given a live seeded game with a double eviction sealed for an upcoming week
    When the engine restarts before the twist week
    Then the restored game still fires the double eviction at its sealed week
