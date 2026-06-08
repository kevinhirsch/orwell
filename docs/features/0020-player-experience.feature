# DRAFT executable spec — author: feature-maker; implementer makes it pass.
# Feature 0020 — Player experience (MVP-1): status panel, inline decisions, portraits.
# HARD rule: roles only. Everything the player sees is Vault-free.

Feature: Player experience (MVP-1) — a chat-forward game with a light status panel

  On top of the narration, the player gets a light always-visible status panel (week/phase, HOH,
  nominees, veto), binding decisions as inline buttons over the engine's legal options, and a
  generated portrait per houseguest. Everything shown is public, Vault-free state.

  Background:
    Given a running game sandbox with a fully populated Producer's Vault

  Scenario: The status panel shows the public state of the house
    When the status panel is rendered
    Then it shows the current week and phase
    And it shows the Head of Household and the nominees
    And it shows the veto holder and whether the veto has been used

  Scenario: The status panel never shows hidden information
    When the status panel is rendered
    Then it shows no hidden vote or off-screen targeting
    And no Vault sentinel value appears in it

  # PENDING IMPLEMENTATION (the MVP-1 refinement — human-driven reads, public-only options,
  # confirm step; 0020 §3–§4/§7). The .md captures the requirements; the implementer adds these
  # scenarios + step defs and makes them green. Kept out of the live suite until then.
  #   Scenario: No surface tells the player how they feel or where they stand
  #     When the status panel and a houseguest's portrait are rendered
  #     Then nothing asserts the player's own read of a houseguest
  #     And nothing shows a trust, threat, or standing number or badge
  #     And the player's standing is left for the player to infer
  #   Scenario: Decision options carry public info only
  #     Given a pending nomination decision
  #     When the decision options are rendered for the eligible houseguests
  #     Then each option shows only a name, a portrait, and public status
  #     And no option shows a hidden read, a threat, or a recommendation
  #   Scenario: A binding move is confirmed before it fires
  #     Given a pending binding decision with rendered option buttons
  #     When the player taps an option
  #     Then the player is asked to confirm before it is executed
  #     And only on confirmation is it executed through the validated path

  Scenario: A pending decision is offered as exactly the engine's legal options
    Given a pending replacement-nominee decision
    When the decision buttons are rendered
    Then the buttons are exactly the engine's legal option set
    And the veto winner is not offered

  Scenario: Tapping an option makes the choice through the validated path
    Given a pending decision with rendered option buttons
    When the player taps a legal option
    Then the choice is executed through the validated decision path
    And the engine re-validates it

  Scenario: An illegal option can never be presented or chosen
    Given a pending decision with a known legal option set
    Then no option outside that set is offered
    And an attempt to choose outside the set is rejected

  Scenario: A houseguest portrait is built from the generated Character, public facets only
    Given a generated houseguest with a static Character
    When that houseguest's portrait descriptor is produced
    Then the descriptor draws on the Character's public identity facets
    And it excludes competition aptitudes, hidden attributes, and Soul secrets
    And no Vault sentinel value appears in it
    And the same save yields a consistent portrait for that houseguest

  Scenario: Free-text social play does not make a binding decision
    Given no decision is pending
    When the player chats socially in free text
    Then no binding decision is made
