# DRAFT executable spec — author: feature-maker; implementer makes it pass.
# Feature 0022 — Player experience MVP-2 (rich game UI). Every surface shows only player knowledge.
# HARD rule: roles only. House view, cards, journal, and comp visuals are all Vault-free.

Feature: Player experience MVP-2 — house view, houseguest cards, journal, competition visuals

  The rich game UI shows the cast, what the player legitimately knows about each houseguest, the
  player's own journal of the game, and competitions as visual moments — never any Vault data and
  never a stat score.

  Background:
    Given a running game sandbox with a fully populated Producer's Vault

  Scenario: The house view shows public status only
    When the house view is rendered
    Then each houseguest appears as a portrait card with their public status
    And no hidden vote or secret targeting appears
    And no Vault sentinel value appears

  Scenario: A houseguest card shows only what the player knows
    When the player opens a houseguest's card
    Then it shows facts the player has witnessed or been told
    And it shows the player's own read framed as their perception
    And it shows no true competition stats, hidden attributes, or soul content
    And it shows no off-screen event the player did not witness
    And no Vault sentinel value appears

  Scenario: Knowledge and suspicion are distinguished on a card
    Given the player suspects something about a houseguest without having confirmed it
    When the houseguest's card is rendered
    Then that belief is shown as a suspicion, not as known fact

  Scenario: The journal is exactly the player's own record
    When the journal is rendered
    Then it contains the events the player witnessed and the knowledge surfaced to them
    And it contains nothing the player has not legitimately learned
    And no NPC confessional appears

  Scenario: Competition visuals are outcome-only
    When a competition is shown
    Then it presents the outcome
    And it shows no stat scores, ratings, or rankings

  Scenario: Every MVP-2 surface is Vault-free under any Vault contents
    When the house view, a houseguest card, the journal, and a competition visual are produced
    Then no Vault sentinel value appears in any of them
