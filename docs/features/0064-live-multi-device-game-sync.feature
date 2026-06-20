# 0064 — Live multi-device game sync (the canonical game chat)
#
# FE feature: the executable gate is front-end pytest + the browser smoke (the chat sessions and
# streaming live in the front-end), NOT Cucumber — this file is the role-only acceptance spec the
# pytest suites mirror. No names: roles only (the player, a device, a season).

Feature: One game, one canonical chat, every device live and in sync
  As a player signed in on more than one device
  I want every screen to show the same single game, live
  So that the house never splits into two parallel conversations or two reasoning chains

  Background:
    Given a signed-in player with one active game
    And the front-end game build is on

  # ── A. The canonical game session ──────────────────────────────────────────

  Scenario: Two devices converge on the same game session
    Given the player opens the game on a first device
    And the player opens the game on a second device at the same time
    When each device resolves its game session
    Then both devices receive the same game session id

  Scenario: A concurrent first-open mints exactly one session
    Given the player has no bound game session yet
    When two devices request the game session simultaneously
    Then exactly one new chat session is created
    And both devices are bound to that same session

  Scenario: A different player never shares a session
    Given a second player with their own active game
    When each player resolves their game session
    Then the two players receive different session ids
    And neither player can subscribe to the other's session stream

  Scenario: A season reset rotates the canonical session
    Given the player's season has ended
    When the player starts the next season
    Then a fresh game session is bound
    And the previous season's transcript is not loaded as narrator context

  # ── B. The live experience across devices ──────────────────────────────────

  Scenario: A turn driven on one device streams live on the other
    Given two devices are viewing the same game session
    When the player drives a game turn on the first device
    Then the second device shows the new turn streaming token by token
    And the second device shows the same finished narration as the first

  Scenario: A device opening mid-turn catches up
    Given a game turn is already streaming on the first device
    When the player opens the same game session on a second device
    Then the second device replays the turn so far and then streams live

  Scenario: The producers reach out exactly once
    Given a brand-new game whose casting interview has not opened
    When two devices both reach the casting kickoff
    Then the producers' opening message is recorded once
    And both devices show that single opening message

  # ── C. One driver at a time (spectator mode) ────────────────────────────────

  Scenario: A second device cannot start a parallel reasoning chain
    Given a game turn is in progress on the first device
    When the player submits a game turn on the second device
    Then the second device's turn is refused as turn-in-progress
    And the first device's turn is not interrupted
    And only one reasoning chain is ever running for the game

  Scenario: The spectating device watches live with a disabled composer
    Given a game turn is in progress on the first device
    When the player views the game on the second device
    Then the second device shows a watching-live notice
    And the second device's composer is disabled until the turn ends

  Scenario: A device can take over a stuck turn
    Given a game turn on the first device is in progress
    When the player chooses to take over on the second device
    Then the first device's run is stopped and its partial is saved
    And the second device can drive the next turn

  Scenario: The next turn is open to any device once the current one ends
    Given a game turn has finished on the first device
    When the player drives the next turn on the second device
    Then the turn is accepted
    And it streams live on the first device

  # ── D. Robustness & isolation ───────────────────────────────────────────────

  Scenario: A reconnect resumes the live view
    Given a device is watching a live turn
    When its connection drops and re-establishes
    Then it resumes the live view without losing the turn

  Scenario: A front-end restart degrades to history, never a stuck game
    Given a game turn was in progress when the front-end restarted
    When the player reopens the game on any device
    Then the device shows the conversation from saved history
    And a new turn can be driven

  Scenario: Sync payloads carry no game secrets
    When the server notifies devices that the session changed
    Then the notification carries only the session id and a change type
    And it carries no message body and no Vault content
