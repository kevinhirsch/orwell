# Executable spec — IMPLEMENTED & green; BDD-gated in cucumber.cjs. (Originally drafted failing-first.)
# Feature 0026 — Relationship math. Default sticky/realistic; per-game feel via disposition + temperature; tunable.
# HARD rule: roles only. The player never sees these numbers (0020).

Feature: Relationship math — the firmed update rule, sticky by default, dynamic per game

  The numbers behind 0017's shape: how interactions move trust/affinity/threat, how hard a betrayal
  hits and how long it lingers. The default is realistic and competitive (grudges stick), but each
  game's feel emerges from the cast's dispositions and the per-game temperature.

  Scenario: A betrayal lingers (the sticky default)
    Given an established trusting edge from one houseguest toward another
    When the holder witnesses a betrayal
    And then a quiet stretch passes with no further interaction
    Then the holder's trust toward the other stays depressed
    And the grudge has not decayed away

  Scenario: A betrayal is a single sharp step, not a slope
    Given an established edge between two houseguests
    When one witnessed betrayal occurs
    Then trust and affinity drop sharply in one step
    And threat rises in the same step

  Scenario: Disposition changes how sticky the same history feels
    Given identical interaction history including a betrayal
    When it is read by a paranoid houseguest and by a forgiving one
    Then the paranoid houseguest's grudge is stronger and decays slower
    And the forgiving houseguest's grudge is softer and fades faster

  Scenario: The feel varies across games but is reproducible by seed
    Given many casts generated across different seeds
    Then the aggregate stickiness of relationships varies measurably between games
    And the same seed reproduces the same dynamics

  Scenario: Confidence firms up with interaction data
    Given two houseguests with little interaction
    Then the edge's confidence is low
    When more interactions accumulate
    Then the confidence rises

  Scenario: The feel is retunable from one constants module
    Given the relationship constants module
    When a weight such as the betrayal-shock is changed
    Then the resulting dynamics change accordingly
    And no relationship number is hard-coded outside that module
