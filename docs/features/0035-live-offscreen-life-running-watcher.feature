# Executable spec — IMPLEMENTED & green; BDD-gated in cucumber.cjs. (Originally drafted failing-first.)
# Feature 0035 — Live off-screen life: start 0031's Orchestrator/GameWatcher in the RUNTIME (add the
# missing real-timer Clock adapter + instantiation). Tests still use a FAKE clock (no real timers in
# tests); "the clock advances" = a fake clock stepped explicitly. HARD rule: roles only (player, NPC).

Feature: Live off-screen life (the running watcher)

  In the live game the house must live between player turns: a background watcher, behind a seedable
  clock, triggers bounded off-screen NPC advances on idle sandboxes so scheming and drift continue while
  the player is away — never leaking hidden state, never crossing users, never fast-forwarding the
  season. The runtime actually starts it; a cadence of zero disables it.

  Scenario: The runtime starts the watcher with a real clock
    Given the engine runtime is composed
    Then a watcher is instantiated over the session registry with a real-timer clock
    And it is started, and stops cleanly on shutdown

  Scenario: An idle game accrues off-screen consequences
    Given a started game the player has left idle
    When the clock advances past the idle threshold
    Then the watcher triggers bounded off-screen advances for that game
    And on the player's return there are new off-screen consequences
    But the player is shown no opinion numbers or hidden state

  Scenario: Off-screen advances are bounded over a long absence
    Given a started game left idle for a long stretch
    When the watcher wakes
    Then it advances the game at most the configured number of off-screen ticks
    And it does not fast-forward the season

  Scenario: Isolation holds while the watcher services many games
    Given two users each have their own idle game
    When the watcher ticks and audits across all sandboxes
    Then no off-screen advance carries one user's content into the other's game

  Scenario: A cadence of zero disables the watcher (pure turn-driven)
    Given the watcher cadence is configured to zero
    When time passes with the player idle
    Then no game advances on its own
    And the game advances only when the player takes a turn
