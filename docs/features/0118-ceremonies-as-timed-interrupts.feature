# Executable spec — Feature 0118 (Phase 2 of the in-game-time pivot). Seeded engine only, roles only,
# no cast names. In-game time ONLY — never the real-world clock.
#
# The day has a known shape: the next ceremony is telegraphed ("this afternoon"), the narrator is primed
# for it during the run-up, and when the clock reaches the time production calls the whole house to gather.
# All of it is dormant (and byte-identical) when the in-game clock is off.

Feature: Ceremonies as timed, telegraphed interrupts

  When in-game time is running, the day carries a schedule the player knows in advance. The next ceremony
  is announced ("the comp is this afternoon"), so every run-up conversation is primed for it; and when the
  clock reaches the scheduled time, the ceremony is due and production calls the whole house together — a
  fair, telegraphed interrupt. Bedtime stays the player's own; only the ceremonies are hard.

  Scenario: The next ceremony is telegraphed ahead of time
    Given a scheduled house with the in-game clock running
    When the narrator context is built during the run-up
    Then the day schedule names the coming ceremony and its in-game phase
    And the narrator is primed that the ceremony is coming

  Scenario: When the clock reaches the time, production calls the gather
    Given a scheduled house with the in-game clock running
    When the player lingers until the scheduled ceremony time arrives
    Then the ceremony is marked due
    And the narrator calls the whole house together for it

  Scenario: With the in-game clock off, the day carries no schedule
    Given a scheduled house with the in-game clock turned off
    When the narrator context is built during the run-up
    Then there is no day schedule
    And the narrator context carries no schedule line

  Scenario: The telegraphed schedule leaks no hidden state
    Given a scheduled house with the in-game clock running and a populated Vault
    When the day schedule and narrator priming are read
    Then they carry only the public schedule, never any Vault content
