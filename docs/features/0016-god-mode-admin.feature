# DRAFT executable spec — author: feature-maker; implementer makes it pass.
# Feature 0016 — God Mode (the administrator port). The SECOND walled surface.
# HARD rule: roles only. The admin is walled from the Vault too — spoilers ruin the game.

Feature: God Mode — the administrator inspects and overrides non-Vault state, walled from the Vault

  The administrator configures the sandbox, overrides non-Vault mechanics, and inspects non-Vault
  state. Like the player, the admin can never read the Vault — the human has never read it and
  must not be able to. God Mode is powerful over the game's machinery and powerless over its secrets.

  Background:
    Given a running game sandbox with a fully populated Producer's Vault

  Scenario: The admin inspects non-Vault state
    When the admin inspects the sandbox
    Then the admin sees the current week and phase
    And the admin sees the public houseguest roster
    And the admin sees the sandbox configuration

  Scenario: Admin inspection returns no Vault content
    When the admin inspects the sandbox
    Then no hidden attribute appears
    And no off-screen event appears
    And no Vault sentinel value appears

  Scenario: The admin tool allowlist contains no Vault reader
    When the admin channel's available tools are enumerated
    Then the tool set is a fixed allowlist
    And no tool in it reads the Vault
    And no tool in it returns reserve-twist content
    And obtaining a Vault-reading tool on the admin channel fails

  Scenario: The admin overrides a non-Vault mechanic
    When the admin overrides a non-Vault mechanic in the sandbox
    Then the observed non-Vault state reflects the override
    And the override returns no Vault-derived value

  Scenario: God Mode cannot reveal the Vault
    When the admin attempts to reveal hidden game state
    Then no such capability exists on the admin channel
    And no Vault content is returned

  Scenario: The admin can enable reserve twists without learning them
    When the admin enables reserve twists in the configuration
    Then the twist content is generated and sealed in the Vault
    And no admin surface reveals which twist was prepared
    And no admin surface reveals when it will fire
    And the twist can still occur during play

  Scenario: Admin actions are isolated to their own sandbox
    Given a second, separate game sandbox
    When the admin acts on the first sandbox
    Then the second sandbox is unchanged
