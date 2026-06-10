# DRAFT executable spec — author: feature-maker; implementer makes it pass.
# Feature 0018 — Narrative & moment orchestration. The engine owns the moment; the LLM only narrates it.
# HARD rule: roles only. Prompts are persona/framing, never the Vault Wall.

Feature: Narrative & moment orchestration — the engine frames the narrator, per moment

  The engine owns the current moment and hands the narrator a managed, Vault-free system prompt so
  the model always speaks as the host and the voice of the house — never a generic assistant. The
  narrator voices the given moment and nothing more; it never decides outcomes or advances the game.

  Background:
    Given a running game sandbox with a fully populated Producer's Vault

  Scenario: The moment is derived from the engine's phase
    Given the game is in a given phase
    When the current moment is requested
    Then the moment corresponds to that phase
    And the same game state always yields the same moment

  Scenario: The narrator cannot advance the game
    Given the game is at the nomination phase
    When the narrator produces narration for the moment
    Then the phase is still the nomination phase
    And the moment is unchanged

  Scenario: The injected system prompt establishes the in-character persona
    When the system prompt for any moment is built
    Then it frames the model as the host and the voice of the house
    And it forbids the model from breaking character as a generic assistant

  Scenario: The base prompt is a tight operating manual naming every lever
    When the base system prompt is built
    Then it names every player-channel lever the agent can call
    And it states that the engine decides outcomes and the model only voices them
    And no lever in the player tool registry is missing from it

  Scenario: Each moment names the lever its beat calls for
    When the system prompt for a competition moment is built
    Then it directs the model to resolve the competition through the engine
    And it forbids inventing the winner or revealing scores

  Scenario: The per-moment prompt is sentinel-free under any Vault contents
    When the system prompt is built for every moment
    Then no hidden attribute appears in it
    And no off-screen event appears in it
    And no Vault sentinel value appears in it

  Scenario: The woven context is Vault-free
    Given a started game
    When the system prompt's game context is built
    Then it contains the player's own card, the phase, and the house roster by name
    And it contains no competition stats, souls, or hidden attributes

  Scenario: Editing a moment's fragment changes only that moment's injection
    Given the managed per-moment prompt registry
    When the fragment for one moment is changed
    Then only that moment's system prompt changes
    And the base persona and the other moments are unaffected
