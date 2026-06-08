# DRAFT executable spec — author: feature-maker; implementer makes it pass.
# Feature 0027 — NarrativePort LLM adapter. Async, streaming, Vault-free input, never alters outcomes.
# HARD rule: roles only. The narrator voices; the engine decides.

Feature: NarrativePort LLM adapter — a real narrator that voices, never decides

  The async LLM behind NarrativePort streams narration from only the Vault-free NarrationContext.
  It cannot see Vault data and cannot change a game outcome — those are the engine's, handed in as
  already-settled context.

  Background:
    Given a running game sandbox with a fully populated Producer's Vault

  Scenario: The adapter receives only Vault-free context
    When narration is requested for the player
    Then the context handed to the adapter contains no Vault sentinel value
    And it contains only the visible projection and the moment prompt

  Scenario: Streaming concatenates to the full narration
    Given the deterministic test narrator
    When narration is streamed token by token
    Then the concatenated stream equals the full narration

  Scenario: A narration failure leaves game state untouched
    Given the narrator provider times out or errors
    When narration is requested for a resolved beat
    Then a safe fallback line is produced
    And the game state is unchanged
    And re-reading the engine gives the same result

  Scenario: Narration never changes an outcome
    Given the engine has decided a competition result
    When the narrator produces narration for it
    Then the engine's result is unchanged
    And even a hallucinated result in the prose changes no game state

  Scenario: The provider and secrets come from config, never code
    When the adapter is configured
    Then the provider, endpoint, and model come from the environment
    And no secret is read from committed source
