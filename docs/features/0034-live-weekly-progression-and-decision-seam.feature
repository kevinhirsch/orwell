# DRAFT executable spec — author: feature-maker; implementer makes it green.
# Feature 0034 — Live weekly progression & binding-decision seam. CODIFIES already-built engine code
# (liveSeason.ts + GameSessionAdapter.advanceGame/submitDecision); most steps map to existing code —
# this is codification + targeted hardening (esp. the Vault-free sentinel on the live tools).
# HARD rule: roles only (player, HOH, nominee, veto holder, evictee). Add to cucumber.cjs when green.

Feature: Live weekly progression & binding-decision seam

  The live game advances the weekly loop over the live house: NPC beats resolve automatically, the loop
  stops when it is the player's turn to make a binding choice, and that choice is taken only through a
  validated path. Illegal choices are refused, every beat persists and survives a restart, and nothing
  on the live path leaks hidden state.

  Scenario: Advancing resolves NPC beats and stops for the player's decision
    Given a started game on the player's HOH week
    When the game is advanced
    Then NPC beats resolve automatically
    And the loop stops and returns the player's pending decision with its legal options
    And it does not advance past that decision until the player submits it

  Scenario: A binding decision is taken only through the validated path
    Given a pending nomination decision for the player
    When the player submits a legal nomination through the decision seam
    Then the nominations are recorded as a witnessed event
    And the loop continues to the next beat
    And no binding choice is ever inferred from chat prose

  Scenario: An illegal decision is refused
    Given a pending replacement-nominee decision after a veto was used
    When the player submits the veto winner as the replacement
    Then the decision is refused as illegal
    And the ceremony state is left unchanged

  Scenario: Each resolved beat persists and survives a restart
    Given a started game advanced several beats with player decisions
    When the engine restarts and the game is resumed
    Then the live position is exactly where it left off
    And no previously recorded beat, event, or detail is lost

  Scenario: The live progression is Vault-free
    Given a started game whose Vault holds hidden votes, targeting, and off-screen scheming
    When the game is advanced and a decision is submitted
    Then the advance, decision, and status outputs contain no hidden state
    And they carry no Vault sentinel value

  Scenario: The progression is seed-deterministic
    Given two games started from the same seed
    When the same sequence of advances and player decisions is applied to each
    Then their resulting live positions are identical
