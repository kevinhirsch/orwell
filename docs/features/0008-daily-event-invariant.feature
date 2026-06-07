# DRAFT executable spec — author: feature-maker; implementer makes it pass.
# Build priority #8 — Daily-event invariant.
# HARD rule: roles only.

Feature: Daily-event invariant — every in-game day earns its place

  Each in-game day contains at least one meaningful event: an HOH competition, a nomination
  or veto ceremony, a vote or eviction, or a significant house event. A "week" is one HOH
  reign — from an HOH competition to an eviction — not a fixed number of calendar days.

  Scenario: Each in-game day has a meaningful event
    When an in-game day completes
    Then at least one of {HOH competition, nominations, veto competition, veto ceremony, eviction, significant house event} occurred

  Scenario: A week is one HOH reign, not seven days
    Given a week begins with an HOH competition
    When the week ends
    Then it ends with an eviction
    And the number of in-game days in the week may vary

  Scenario Outline: No empty days over a seeded season
    Given a season is simulated with seed "<seed>"
    Then every completed in-game day contains at least one meaningful event

    Examples:
      | seed |
      | 1    |
      | 2    |
      | 3    |

  Scenario: A rest day is a rare, deliberate exception that still carries a house event
    Given the engine inserts a rest day for dramatic pacing
    Then that day still contains at least a significant house event
    And rest days remain below the configured rare threshold over a season
