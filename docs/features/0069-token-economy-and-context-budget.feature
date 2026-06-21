# Feature 0069 — Token economy: a metered LLM boundary, a reasoning budget & non-degrading
# context tiering (ADR 0010).
# Roles only (no houseguest names). Executable spec of record; the gate is the front-end pytest
# suite named in the design note's Definition of Done (a recorded deviation, like 0066/0033/0036/0055)
# — the behaviour is entirely FE/adapter (llm_core.py / agent_loop.py), not a new Cucumber world.

Feature: Token economy and context as architecture
  As the front-end that owns the LLM provider
  I want every model call metered and governed by call class
  So that spend is visible and controllable without showing the player a number or losing memory to save tokens

  Background:
    Given the LLM boundary is metered

  Scenario: Every model call records its full token and cost envelope
    When the house narrates a turn through the model
    Then the recorded usage includes input, cached, reasoning, and output tokens
    And the recorded usage includes the call cost
    And the record carries no message content and no secret state

  Scenario: Token and cost figures are admin-only — the player never sees a number
    When a turn is metered
    Then the token, cost, and context figures appear only on an admin surface
    And no player-facing surface shows a token, cost, or context number

  Scenario: Reasoning effort is governed per call class
    Given a narration turn and a background extraction turn
    Then the narration call carries a bounded reasoning budget
    And the extraction call runs with reasoning minimized or off
    And no call runs at the model's default reasoning effort by omission

  Scenario: Narration keeps a light thinking trace
    Given a narration turn with its reasoning budget dialed down
    When the model narrates
    Then a thinking trace is still produced for the Thinking accordion
    And reasoning is never fully disabled for narration

  Scenario: The stable prompt prefix is cache-friendly
    Given two consecutive turns that differ only in the player's latest message
    Then the system-and-tools prefix sent to the model is byte-identical across both turns
    And the per-turn variable content appears at the end of the prompt

  Scenario: A game session keeps its provider cache warm
    Given a live game session
    When the house plays several turns
    Then every turn pins to one provider for the session
    So that the provider's automatic prompt cache stays warm

  Scenario: Context grows toward the model's window before anything is summarized away
    Given a turn whose needed context exceeds the lean default budget
    And the model has a large context window
    When the input budget is computed
    Then the budget escalates toward the model's window before any lossy compaction
    And no persisted detail is dropped to save tokens

  Scenario: Lean-by-default is preserved
    Given a normal turn within the lean default budget
    Then the prompt stays lean
    And the turn recalls from the store rather than accumulating the whole chat

  Scenario: Token policy never moves a seeded outcome
    Given a fixed seed
    When the reasoning effort, the caching posture, or the context budget changes
    Then every seeded competition outcome is unchanged
    And only the cost and latency may differ
