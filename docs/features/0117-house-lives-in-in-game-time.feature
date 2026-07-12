# Executable spec — Feature 0117 (Phase 1 of the in-game-time pivot). Tests use the seeded engine only,
# roles only, no cast names. In-game time ONLY — never the real-world clock.
#
# The house must live as in-game time passes during the player's social play (not only when a ceremony
# beat resolves), while everything seeded stays byte-identical.

Feature: The house lives in in-game time

  When in-game time is running, the off-screen house keeps scheming as the clock passes during the
  player's between-ceremony social play — paced to the player, roughly every in-game stretch, never once
  per tool call. When the in-game clock is off (the seeded calibration spine, golden replay), social turns
  change nothing: no time advances and the house stays quiet, byte-for-byte as before.

  Scenario: The house schemes during social play, not only at ceremonies
    Given a live house with the in-game clock running
    When the player takes several social turns between ceremonies
    Then in-game time advances across those turns
    And the off-screen house schemes at least once during that social play
    And none of that scheming is witnessed by the player

  Scenario: The scheming is paced by in-game time, not once per social turn
    Given a live house with the in-game clock running
    When the player lingers through many social turns
    Then the off-screen house schemes on some turns but stays quiet on others

  Scenario: With the in-game clock off, social play changes nothing
    Given a live house with the in-game clock turned off
    When the player takes several social turns between ceremonies
    Then no in-game time advances
    And the off-screen house stays quiet during that social play

  Scenario: The new clock reads leak no hidden state
    Given a live house with the in-game clock running and a populated Vault
    When the in-game clock is read for pacing
    Then the reads return only the clock, never any Vault content
