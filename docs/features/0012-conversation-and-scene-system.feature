# Executable spec — IMPLEMENTED & green; BDD-gated in cucumber.cjs. (Originally drafted failing-first.)
# Feature 0012 — Conversation & scene system. Interaction model: hybrid (free-text social,
# explicit validated decisions). HARD rule: roles only. Extends 0001/0002 guarantees.

Feature: Conversation & scene system — the player's social game

  The player plays the social game in free-text; the LLM voices NPCs and narrates; NPCs also
  initiate. The engine owns ground truth. Binding decisions are explicit, validated prompts.
  Everything is Vault-free and runs over the MCP boundary.

  Background:
    Given a running game sandbox with a fully populated Producer's Vault

  Scenario: A player-initiated scene is recorded as the player's knowledge
    When the player approaches a houseguest and speaks with them
    Then the scene is recorded as an event whose witness set includes the player
    And it is part of the player's knowledge, not the Vault

  Scenario: NPCs initiate scenes too (bidirectional)
    Given a stretch of game time
    Then some scenes are initiated by houseguests approaching the player
    And which houseguest approaches reflects their agenda and relationships, not chance

  Scenario: A social read is honest and Vault-free
    When the player asks for the energy in the room or a read on a houseguest
    Then an honest, character-appropriate read is returned
    And it contains no Vault sentinel value
    And it may hint at off-screen shifts without naming any off-screen event

  Scenario: An NPC never voices a fact it has no pathway to know
    Given a hidden fact a houseguest neither witnessed nor was told
    When that houseguest speaks with the player
    Then its dialogue never asserts that fact
    And at most it expresses suspicion, never knowledge

  Scenario: Binding decisions are explicit and validated, not parsed from prose
    Given the player holds power at a decision point
    When the player lobbies houseguests in free-text
    Then the binding choice is not changed by that conversation
    And the choice is made only via an explicit prompt over the legal options
    And an illegal choice is rejected with a reason

  Scenario: Scene fidelity is player-directed
    When the player requests a compressed beat or a full scene
    Then the narration is rendered at that fidelity
    And the underlying ground truth is unchanged

  Scenario Outline: No player-facing conversation output contains Vault content
    When the engine produces "<surface>" for the player
    Then it contains no Vault sentinel value

    Examples:
      | surface       |
      | scene         |
      | NPC dialogue  |
      | social read   |
