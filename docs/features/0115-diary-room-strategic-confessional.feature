# Executable spec — BDD-gated in cucumber.cjs (done right this time; not a repeat of 0036's E87a deviation).
# Feature 0115 — The Diary Room as a strategic confessional: the player's DR intent grounds the GM's
# narration (so the game narrates the player's REAL strategy, not their public mask), the producer's DR
# invitations become pointed beat-specific questions, and the confessionals resurface in the post-season
# retrospective. HARD rule: roles only (player, NPC). The wall is the crux — NO houseguest ever learns DR
# content, and NO NPC behavior is ever driven by it.

Feature: The Diary Room as a strategic confessional (narration grounding, walled from the house)

  The player records their real strategy in the Diary Room. The Game Master narrates the player's scenes
  grounded in that truth — the irony of a lie — instead of believing the player's public performance, while
  every houseguest stays deceived: they never learn the Diary-Room content and never act on it.

  Scenario: The GM's narration is grounded in the player's real strategy
    Given a live game where the player has recorded a Diary-Room strategy
    When the narrator's game context is built for the player
    Then it carries the player's Diary-Room strategy as a private steer
    And that steer is marked as known to the GM but not to the houseguests

  Scenario: No houseguest ever learns or acts on the Diary-Room strategy
    Given a live game where the player has recorded a secret Diary-Room strategy
    When each houseguest's knowledge and voicing projection is derived
    Then none of them knows the Diary-Room strategy
    And no houseguest voicing projection carries the Diary-Room strategy
    And the Diary-Room strategy is stripped from any NPC-knowledge derivation

  Scenario: The producer's Diary-Room invitation is a pointed, beat-specific question
    When the game reaches a dramatic beat
    Then the Diary-Room invitation asks a question specific to that beat
    But at a routine beat there is no Diary-Room invitation

  Scenario: The player's confessionals resurface in the post-season retrospective
    Given a finished season where the player recorded Diary-Room confessionals
    When the post-season retrospective is unsealed
    Then it surfaces the player's own confessionals alongside the hidden story

  Scenario: The strategic Diary Room leaks no hidden state
    Given a live game whose Vault holds hidden scheming while the player keeps a Diary Room
    When the narrator's game context is built for the player
    Then the narrator context carries no Vault sentinel value
