# Executable spec — IMPLEMENTED & green; BDD-gated in cucumber.cjs. (Originally drafted failing-first.)
# Feature 0021 — Game session & save lifecycle. One active game per user; sandbox per user;
# unlimited concurrent users; cross-user isolation is absolute.
# HARD rule: roles only (here, "user" = a physical-world account; A and B are role labels).

Feature: Per-user game sandboxes — one active game per user, fully isolated across users

  Each authenticated user has one active Big Brother game in their own isolated sandbox. Many users
  play at once, each in a separate sandbox; no user can ever reach another user's game. Starting a
  new game replaces only that user's own game, and a user's game resumes when they return.

  Background:
    Given two authenticated users, user A and user B

  Scenario: Each user gets their own isolated game
    When user A starts a game
    And user B starts a game
    Then user A and user B have different houses
    And neither user's game is affected by the other

  Scenario: No user can reach another user's game (cross-user isolation)
    Given user A has a game seeded with unique sentinel values
    When any tool is called on behalf of user B
    Then no sentinel from user A's game appears in user B's results
    And the reverse also holds

  Scenario: One active game per user; a new game replaces only the user's own
    Given user A has an active game
    And user B has an active game
    When user A starts a new game
    Then user A's previous game is replaced
    And user B's game is unchanged

  Scenario: Unlimited users play concurrently without interference
    Given many users each start a game at the same time
    Then each user has their own distinct game
    And no user's actions change another user's game

  Scenario: A user's game resumes when they return
    Given user A has an in-progress game
    When user A returns later
    Then user A is resumed into the same ongoing game

  Scenario: The Vault Wall still holds inside each sandbox
    Given user A has a game with a fully populated Producer's Vault
    When any player-facing surface is produced for user A
    Then no Vault sentinel value from user A's game appears

  Scenario: God Mode does not browse across users
    Given an administrator inspecting one user's sandbox
    Then no other user's game state is reachable
