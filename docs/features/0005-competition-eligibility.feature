# DRAFT executable spec — author: feature-maker; implementer makes it pass.
# Build priority #5 — Competition eligibility & legality.
# HARD rule: roles only; seeded randomness for draws.

Feature: Competition eligibility & legality — the hard rules of the weekly loop

  Eligibility and legality are hard rules the engine enforces and temperature never
  overrides: the outgoing HOH cannot defend the crown; the veto winner cannot be named a
  replacement nominee; the veto field is six (HOH, both nominees, and three drawn at random
  with no player agency); at eviction everyone except the HOH and the two nominees votes, and
  the HOH breaks ties.

  Scenario: The outgoing Head of Household cannot defend the crown
    Given a houseguest is the outgoing HOH for the current week
    When the next HOH competition begins
    Then that houseguest is not in the eligible participant set

  Scenario: The veto winner is not a valid replacement nominee
    Given a houseguest has won the Power of Veto this week
    And the veto is used to remove a nominee
    When the HOH selects a replacement nominee
    Then the veto winner is excluded from the selectable set

  Scenario: The veto competition fields exactly six players
    Given an HOH and two nominees for the current week
    When the veto participants are drawn
    Then the participant set contains exactly six houseguests
    And it includes the HOH and both nominees
    And the remaining three are drawn at random from the eligible pool
    And the player has no agency over the random draw

  Scenario: The eviction voting set excludes the HOH and the nominees
    Given an HOH and two nominees for the current week
    When the eviction vote is taken
    Then every houseguest except the HOH and the two nominees casts a vote
    And the HOH votes only to break a tie

  Scenario: A special competition may explicitly re-include the outgoing HOH
    Given a special competition that explicitly permits the outgoing HOH
    When eligibility is computed
    Then the outgoing HOH is in the eligible set
    # Rare, explicit exception (legacy Bible) — never the default.

  Scenario: Temperature never overrides an eligibility hard rule
    Given any temperature roll for the moment
    When eligibility is computed
    Then the outgoing-HOH rule and the veto-winner-replacement rule still hold
