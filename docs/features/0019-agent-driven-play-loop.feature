# DRAFT executable spec — author: feature-maker; implementer makes it pass.
# Feature 0019 — Agent-driven play loop. The agent orchestrates and voices; the engine decides.
# HARD rule: roles only. Binding decisions only via the validated path; the engine decides outcomes.

Feature: Agent-driven play loop — the agent drives turns by calling engine tools

  The LLM agent plays the game by calling Vault-free engine tools: read the visible state, narrate
  the moment, surface the engine's legal options when a decision is due, take the player's choice,
  and execute it through a validated path. The engine decides every outcome; the agent only voices.

  Background:
    Given a running game sandbox with a fully populated Producer's Vault

  Scenario: A binding decision changes state only through the validated path
    Given a pending eviction vote
    When the player says in free-text that they would probably vote out the nominee
    Then no vote is recorded
    When the player makes the choice through the validated decision path
    Then the vote is recorded

  Scenario: The presented options are exactly the engine's legal set
    Given a pending replacement-nominee decision
    When the agent surfaces the options
    Then the options are exactly the engine's legal set
    And the veto winner is not among them

  Scenario: An illegal choice is rejected
    Given a pending decision with a known legal option set
    When the player attempts a choice outside that set
    Then the engine rejects it
    And the game state is unchanged

  Scenario: The agent cannot fabricate an outcome the engine did not decide
    Given a competition is resolved by the engine
    Then the agent narrates the engine's result
    And the agent cannot produce a different winner

  Scenario: Free-text social play does not make a binding decision
    Given no decision is pending
    When the player engages in free-text social conversation
    Then the conversation is recorded as a witnessed event
    And relationships may shift
    But no binding decision is made

  Scenario: Every tool result the loop consumes is Vault-free
    When the agent runs a full turn over the engine tools
    Then no tool result contains a Vault sentinel value
