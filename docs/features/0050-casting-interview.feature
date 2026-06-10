# Executable spec — feature 0050: the casting interview (producer-led character creation).
# Evolves 0015: creation is a CONVERSATION the producer conducts in the chat, ending in the
# player's character type, strategy, and qualitative strengths — never a number.
# HARD rule: roles only, no names.

Feature: The casting interview — producer-led character creation that seeds the game

  Before a game starts, the chat is the pre-season casting interview: the producer gets to know
  the player, then distills their own words into the engine's character creation. The engine
  derives balanced stats, seeds the datastore with the interview, and returns a casting card.

  Scenario: Before a game starts, the moment is the producer's casting interview
    Given no game has started
    When the moment prompt is requested
    Then the prompt frames the producer conducting a casting interview
    And the prompt instructs the model to end the interview through character creation
    And the prompt carries every canonical archetype in its manifest
    And the prompt carries every canonical strategy style in its manifest

  Scenario: The producer's distillation creates the player from their own words
    When character creation is submitted with a canonical mapping and the player's own words
    Then the player's card voices the player's own words
    And the canonical archetype drives aptitudes within the generated houseguests' bounds

  Scenario: The casting card reveals type, strategy, and strengths as words — never numbers
    When character creation is submitted with interview material
    Then the creation result carries a casting card
    And the casting card names a character type and a strategy style
    And the casting card reads each strength as a tier word
    And no numeric aptitude appears anywhere in the player-facing payload

  Scenario: The interview seeds the datastore with who the player came in as
    When character creation is submitted with interview material
    Then the player's static Character carries the authored backstory
    And the player's Soul memory carries the interview material
    And the player's private strategy is held as player-only material

  Scenario: Interview material survives a restart without degrading
    Given character creation is submitted with interview material
    When the game is snapshotted and restored
    Then the restored player retains the backstory, motivation, and interview memories

  Scenario: The interview is out-of-character and reaches no houseguest
    When character creation is submitted with interview material
    Then character creation produces no witnessed event
    And no houseguest's knowledge at the start of the game holds any interview material

  Scenario: An interview-shaped creation cannot wipe a started game
    Given character creation is submitted with interview material
    When a second interview-shaped creation is submitted
    Then the running game is unchanged
