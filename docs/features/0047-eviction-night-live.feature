# DRAFT executable spec — author: feature-maker; implementer makes it pass.
# Feature 0047 — Eviction night live: stage the weekly eviction through the 0034 seam like the finale.
# HARD rule: roles only (HOH, nominee, evictee, voter, juror). Add to cucumber.cjs when green.

Feature: Eviction night live

  The weekly eviction plays out live: the votes are revealed one at a time in a seeded order with a
  revealed-only tally, the evicted houseguest gets a goodbye, and goodbye messages from the house shape how
  that evictee later votes as a juror. The engine decides the reveal order and the outcome; no pre-reveal
  tally ever crosses the wall.

  Scenario: Votes are revealed one at a time in a deterministic order
    Given a started game at an eviction with a decided vote
    When the eviction is advanced through the seam
    Then the eviction votes are revealed one at a time
    And the reveal order is the same for the same seed
    And the running tally shows only the votes revealed so far

  Scenario: The evictee is not knowable before the last vote
    Given an eviction mid-reveal
    When the eviction surface is read mid-reveal
    Then it shows no pre-reveal tally and no unread vote
    And it does not name the evictee until the final vote lands
    And no Vault sentinel value appears on the eviction surface

  Scenario: The evicted houseguest gets a goodbye beat
    Given an eviction whose result has landed
    When the staging continues
    Then an evictee goodbye beat occurs
    And goodbye messages from the house are recorded

  Scenario: A warm goodbye and a cold goodbye move the jury differently
    Given the same evictee sent out with respectful goodbyes versus cold ones
    When that evictee later leans as a juror
    Then the respectful send-off yields a measurably more favorable lean

  Scenario: The staging runs through the decision seam and survives a restart
    Given an eviction staged through the advance seam
    When the engine restarts mid-reveal
    Then the eviction resumes from where it left off
