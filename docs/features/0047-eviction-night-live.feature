# Executable spec — IMPLEMENTED & green; BDD-gated in cucumber.cjs. (Originally drafted failing-first.)
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

  # Amended 2026-06-10 (E12 + T2): eviction votes are SECRET BALLOTS, as on the real show — the
  # staged reveal reads anonymized ballots ("a vote to evict …"), never the voter; rogue votes,
  # scapegoating, and vote paranoia become possible again. The attribution is recorded
  # engine-only and unseals exclusively in the post-season retrospective (0048). T2 also
  # replaced the self-referential tally assertions with electorate-derived bounds.
  Scenario: Vote secrecy — ballots are anonymous until the season ends
    Given a started game at an eviction with a decided vote
    When the eviction is advanced through the seam
    Then every revealed ballot is anonymized
    And the post-season retrospective unseals the season's ballots

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

  # Amended 2026-06-10 (E34): the engine never authors the PLAYER's goodbye message. A surviving
  # player records their own — a real pending decision through the 0034 seam (the tone is the
  # player's choice; the prose is the model's to voice) — folded into the evictee's manner
  # exactly as NPC tones are. Jury management's signature lever belongs to the player.
  Scenario: The player's goodbye message is their own decision
    Given an eviction whose result has landed with the player surviving
    When the goodbye stage reaches the player
    Then the loop pauses for the player's goodbye message
    And no player goodbye beat exists before the decision is resolved
    And the player's chosen tone folds into the evictee's manner toward the player
