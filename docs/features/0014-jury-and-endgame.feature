# DRAFT executable spec — author: feature-maker; implementer makes it pass.
# Feature 0014 — Jury & endgame. HARD rule: roles only. Vote is engine-decided; LLM only voices.

Feature: Jury & endgame — the jury vote decides the winner

  The last nine evictees form the jury; jury management shapes their votes; at Final 2 each
  finalist gives a statement and takes one question from each juror; the most-voted finalist wins,
  ties broken by the last-evicted juror.

  Scenario: The jury is the last nine evictees
    When the season reaches Final 2
    Then the jury is the last nine evicted houseguests
    And the earlier evictees are pre-jury

  Scenario: A blindsided or disrespected juror is less likely to vote for the finalist
    Given a juror a finalist blindsided or disrespected on eviction
    When the jury votes across many seeded runs
    Then that juror's probability of voting for that finalist is reduced

  Scenario: Jury management dominates; the finale sways the margin
    Given a finalist with strong accumulated jury relationships
    When the jury votes across many seeded runs
    Then that finalist wins the clear majority of runs
    And a strong or weak finale shifts close jurors but rarely overturns a clear lead

  Scenario: The Final 2 choreography plays out
    Given a Final 2 and a jury
    Then each finalist gives an opening statement
    And each juror asks a question of each finalist
    And the votes are revealed one at a time

  Scenario: The winner is decided by jury vote with a last-juror tie-break
    When the jury vote is tallied
    Then the finalist with the most votes wins
    And a tie is broken by the last-evicted juror

  Scenario: The engine decides the vote; the LLM only voices the jurors
    Given the jurors are voiced by the narrative layer
    When the jury vote is computed
    Then each vote is decided by the engine from jury relationships and finale performance
    And the narrative layer does not change any vote
