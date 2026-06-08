# DRAFT executable spec — author: feature-maker; implementer makes it pass.
# Milestone M5 — MCP tool boundary (the engine's outward tool API).
# HARD rule: roles only. Extends the feature-0001 Vault-Wall guarantees to the tool surface.

Feature: MCP tool boundary — the engine's permissioned outward API

  A permissioned MCP server exposes the game to the agent / LLM / front-end through a fixed
  allowlist of tools. Read tools return only the visible projection; action tools return only
  a Vault-free result. The server is structurally incapable of reading the Vault.

  Background:
    Given a running game sandbox with a fully populated Producer's Vault
    And every Vault datum carries a unique sentinel value
    And the engine is served as an MCP server

  Scenario: The server mounts only the allowlisted tools for a channel
    Given a client connected on the player channel
    Then the available tools are exactly the player allowlist
    And no admin tool and no Vault-reading tool is available

  Scenario Outline: No tool returns Vault content
    Given a client on the "<channel>" channel
    When it calls every tool that channel exposes
    Then no result contains a Vault sentinel value

    Examples:
      | channel        |
      | player         |
      | admin/God Mode |

  Scenario: getVisibleStateFor returns only the entity's visible projection
    When the player calls getVisibleStateFor for themselves
    Then the result contains only events they witnessed and facts they know
    And no off-screen or hidden event appears

  Scenario: recordInteraction records a player-witnessed event, not a secret
    When the player records an interaction they initiated
    Then the event is stored with the player in its witness set
    And it becomes part of the player's knowledge
    And it is never written to the Vault

  Scenario: resolveCompetition returns an engine-decided outcome only
    When the player requests a competition resolution
    Then the result is the engine-decided outcome
    And it contains no stat scores, rankings, or Vault-derived reasoning

  Scenario: surfaceInformationTo moves a hidden fact into knowledge via a pathway
    Given a hidden fact the player does not know
    When surfaceInformationTo is called with a valid in-game pathway
    Then that fact enters the player's knowledge
    And a surfacing event carrying that pathway is recorded

  Scenario: God-Mode tools return only non-Vault state
    Given a client on the admin/God Mode channel
    When it inspects game state
    Then only non-Vault state is returned
    And no Vault sentinel value is returned

  Scenario: The MCP-server adapter cannot read the Vault
    Then no MCP-server module depends on the VaultStore, the vector index, or the engine root

  Scenario: An external client can drive a minimal game loop without receiving Vault data
    Given an external MCP client on the player channel
    When it reads visible state, records an interaction, resolves a competition, and reads the summary
    Then every response is Vault-free
    And the summary confirms only that updated save(s) exist
