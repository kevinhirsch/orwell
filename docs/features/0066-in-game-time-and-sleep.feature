# Feature 0066 — In-game time of day & the nightly sleep economy (ADR 0006).
# Roles only (no houseguest names). Executable spec of record; the gate is the Vitest suite named
# in the design note's Definition of Done (a recorded deviation, like 0033/0036/0055) — the behaviour
# is exercised end-to-end through the live adapter + the opt-in ORWELL_TIME_OF_DAY flag.

Feature: In-game time of day and the nightly sleep economy
  As the simulation
  I want a finite day where managing sleep against late-night scheming is real
  So that the house feels finite and staying up late before a competition has a cost

  Background:
    Given the in-game clock is enabled

  Scenario: The day runs forward by play, not a wall clock
    Given a live season
    When the house plays through the day
    Then the time of day advances through morning, afternoon, evening, night, and late-night
    And the time of day is surfaced as a public, Vault-free read

  Scenario: The house puts itself to sleep — the diegetic bound
    Given it is late at night
    Then only the player and the night owls are still awake
    And every houseguest has a latest bedtime, so the house always fully empties
    And the player is never sent to bed

  Scenario: The player chooses their own bedtime
    Given the player is up late
    When the player turns in
    Then the house rolls to the next morning
    And an early night leaves the player rested for tomorrow

  Scenario: Staying up late costs competition performance
    Given two equally skilled houseguests
    And one of them stayed up into late-night and the other was rested
    When they compete many times
    Then the rested houseguest wins a clear majority
    And a tired favorite can still lose a competition they would otherwise win

  Scenario: Sleep is symmetric and never protective
    Then the rest penalty is applied to every competitor by the same math
    And the player is never special-cased

  Scenario: The Vault Wall holds — only the player's own tiredness is visible
    Then the player sees their own qualitative rest cue, never a number
    And no houseguest's sleep, bedtime, or rest deficit is ever exposed

  Scenario: Dormant by default keeps the calibration spine byte-identical
    Given the in-game clock is disabled
    When the house plays through the day
    Then no time of day or rest cue is surfaced
    And every seeded competition outcome is unchanged
