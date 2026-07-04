# Executable spec — IMPLEMENTED & green; BDD-gated in cucumber.cjs. (Originally drafted failing-first.)
# Build priority #6 — Outcomes by stats + temperature. Distribution-style over many seeds.
# HARD rule: roles only. Assert PROPERTIES, not specific numbers (temperature math is open).

Feature: Outcomes by stats and temperature — earned results, never story convenience

  Competition outcomes are weighted by the relevant stat versus the competition type, a
  per-moment temperature roll across all involved variables, and an emotional modifier sourced
  from the houseguest's soul (no Luck stat). Results are
  reproducible under a fixed seed. Temperature governs variance but never overrides hard
  rules or archetype-grounded weighting, and the engine never protects the player.

  Scenario: A moment rolls temperature across its involved variables, reproducibly
    Given a gameplay moment with multiple involved variables
    When the moment is resolved with a fixed seed
    Then a temperature roll is applied across those variables
    And resolving again with the same seed yields the identical outcome

  Scenario: Hard rules are never overridden by temperature
    Given any temperature roll
    Then eligibility rules and the Vault Wall still hold

  Scenario: Outcomes follow archetype and temperature, not narrative need
    Given an endurance competition and a houseguest whose profile does not support endurance
    When outcomes are computed across many seeded runs
    Then that houseguest's win rate reflects stats and temperature, not story convenience

  Scenario: The engine never protects the player
    Given the player competes in a competition type their stats do not favor
    When outcomes are computed across many seeded runs
    Then the player's win rate reflects their stats like any other houseguest

  Scenario: Stats usually win — upsets are real but uncommon
    Given a clear favorite by stats in a competition
    When outcomes are computed across many seeded runs
    Then the favorite wins the clear majority of runs
    And the favorite still loses a real minority of runs
    # Earned outcomes with marginal drama: variance from temperature + the soul emotional modifier (no Luck stat).

  Scenario: Player competition intent is honored and immutable
    Given the player declares an intent of compete, throw, or play safe before a competition
    When the outcome is computed
    Then the declared intent affects the computation
    And the intent cannot be changed after the result is given

  Scenario Outline: The temperature roll stays within configured bounds
    Given the game is simulated with seed "<seed>"
    Then every temperature roll falls within the configured bounds

    Examples:
      | seed |
      | 1    |
      | 2    |
      | 3    |

  # ── PO EXPANSION (2026-06-28, PO-REVIEW-LEDGER) — PENDING BUILD ─────────────────────
  # PO ruling (two parts):
  #
  #  (1) TUNE DOWN competition-stat dominance so upsets are a bit more common. Target the
  #      favorite-win band toward ~60–70% (currently ~65–80%, ≈73%), TUNABLE further.
  #      Rationale: character depth now lives across emotions (0041) + sleep (0066) + the soul
  #      modifier; raw comp stats should NOT be the dominant factor. This is a DELIBERATE
  #      calibration retune (NOT byte-identical) — it re-baselines the seeded heavy sims and
  #      must keep the juryReach EARNED-WINS guard green (playing the game still converts).
  #      The exact band is pinned in the calibration/unit gate, not in Gherkin (this file
  #      asserts properties, not numbers).
  #
  #  (2) NPCs carry a competition INTENT too (compete / throw / play-safe), not just the
  #      player — and, like the player in a staged comp, an NPC may change its intent between
  #      rounds based on who remains, each round's intent locked once that round resolves.
  #
  #   Scenario: Upsets are common enough to matter, without erasing the favorite's edge
  #     Given a clear favorite by stats in a competition
  #     When outcomes are computed across many seeded runs
  #     Then the favorite wins more often than not
  #     And the favorite loses often enough that upsets are a regular occurrence
  #     # Numeric target (calibration gate): favorite-win rate ~60–70%, tunable.
  #
  #   Scenario: Competition stats are one factor among emotions and rest, not the dominant one
  #     Given two houseguests whose competition stats are close
  #     And one is emotionally rattled or under-rested and the other is steady
  #     When outcomes are computed across many seeded runs
  #     Then the steady houseguest's edge comes as much from soul and rest as from raw stats
  #
  #   Scenario: Every competitor carries an intent, not just the player
  #     Given a competition with the player and NPCs competing
  #     Then each competing NPC holds an intent of compete, throw, or play safe
  #     And each NPC's intent affects their outcome computation like the player's
  #
  #   Scenario: An NPC adapts its intent between staged rounds as the field narrows
  #     Given a staged elimination competition in progress
  #     And an NPC competing with a chosen intent for the current round
  #     When the field narrows to a new set of remaining houseguests
  #     Then the NPC may change its intent for the next round based on who remains
  #     And each round's intent is locked once that round resolves
  # ────────────────────────────────────────────────────────────────────────────────────
