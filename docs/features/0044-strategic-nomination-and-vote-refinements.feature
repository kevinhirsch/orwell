# DRAFT executable spec — author: feature-maker; implementer makes it pass.
# Feature 0044 — Strategic nomination & vote refinements: enrich the BUILT, engine-decided nomination/vote
# functions with pawn/backdoor/bloc strategy and mood/bloc/deal-aware votes. Still engine-decided + seeded.
# HARD rule: roles only (HOH, nominee, pawn, target, voter, bloc-mate). Add to cucumber.cjs when green.

Feature: Strategic nomination & vote refinements

  An HOH plays like a strategist, not a threat calculator: a pawn beside a target, a backdoor, protecting
  their bloc — gated by who they are. A voter weighs their bloc, their nerves, and their deals, not just raw
  threat. The engine still decides every nomination and vote from the hidden signals and seeded temperature;
  the narrator only voices the result.

  Scenario: Nominations go beyond raw threat
    Given an HOH whose disposition favors a strategic game
    When they nominate
    Then their two nominees are not simply the two highest threats
    And the choice reflects a pawn, a backdoor, or bloc protection
    But the nominations remain legal under the eligibility rules

  Scenario: Different HOHs nominate differently
    Given a loyal HOH and a ruthless HOH facing the same house
    When each nominates
    Then their nominations differ in a way consistent with their disposition

  Scenario: A rattled houseguest votes differently than a calm one
    Given the same voter rattled versus settled
    When each casts an eviction vote
    Then the rattled voter's choice can differ, weighting self-protection

  Scenario: Bloc and deal shape the vote
    Given a voter aligned with a bloc and bound by a vote deal
    When they cast their eviction vote
    Then they lean to vote with their bloc
    And they honor or break the deal with its consequence — decided by the engine

  Scenario: The engine decides every nomination and vote
    Given any nomination or eviction vote
    Then it is computed from the hidden signals and seeded temperature
    And it is never decided or altered by narration
    And the player is shown no score or number

  Scenario: The refinements are deterministic and tunable
    Given two games started from the same seed
    When the same weeks are played in each
    Then the same nominations and votes result
    And every magnitude comes from a single tunable constants module
