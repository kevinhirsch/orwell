# spec-only: this .feature is a design contract, NOT wired into the BDD gate (absent from cucumber.cjs paths; no step definitions). Its behavior is verified elsewhere — see the per-feature status index in docs/features/README.md. (TEST-3, #628)
# Feature 0130 — Exit interviews. Expands 0047 (eviction night); feeds 0048 (retrospective). HARD rule:
# roles only (evictee, producer, player, juror). NOT YET BUILT — spec authored 2026-07-13 during the 0047
# PO review.

Feature: Exit interviews (the producer's eviction-night sit-down)

  Every eviction ends with the evictee interviewed by the producers on their way out: they see their goodbye
  messages, react in the moment, and tell their side. For an NPC it is grounded narration; for the player it
  is a real say at their lowest point. Each exit interview is recorded and resurfaces in the season-end
  retrospective. The evictee speaks only to what they know and their own goodbye messages — nothing hidden.

  Scenario: Every eviction ends with an exit interview
    Given an eviction whose result has landed
    When the eviction night continues past the goodbye messages
    Then the evicted houseguest is interviewed by the producers
    And this happens for every eviction, NPC or player

  Scenario: The evictee sees and reacts to their goodbye messages
    Given an evictee at their exit interview
    When the goodbye messages are surfaced to them
    Then the evictee reacts to what the house said
    And a houseguest who later returns via a battle-back keeps that memory

  Scenario: An NPC exit interview is grounded, not invented
    Given an NPC evicted with a recorded eviction manner
    When they are interviewed on the way out
    Then their reaction reflects that manner and their own knowledge of the season
    And a blindsided evictee reacts differently than a respected one
    And no hidden scheme or number appears in the interview

  Scenario: The player's exit interview is their own decision
    Given the player has been evicted
    When the exit interview reaches the player
    Then the loop pauses for the player's own answer through the decision seam
    And the engine never authors the player's words for them

  Scenario: Exit interviews resurface in the season-end retrospective
    Given a season in which several houseguests were evicted and interviewed
    When the end-of-season retrospective is read
    Then it replays each evictee's exit interview as a first-person account

  Scenario: The exit interview leaks nothing and moves no seeded outcome
    Given a seeded season played to completion with exit interviews
    Then no Vault sentinel value appears in any exit interview
    And the player's exit interview reaches no active houseguest still in the game
    And the eviction order, finalists, and jury result are byte-identical to the pre-feature model
