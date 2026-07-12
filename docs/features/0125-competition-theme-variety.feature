# Executable spec — IMPLEMENTED & green; BDD-gated in cucumber.cjs. (Expands 0042.)
# Feature 0125 — Competition theme variety: a large seeded pool of Vault-free skins over the 0042
# mechanic library so a whole season runs repeat-free. The skin renames + re-scenes the comp; the
# ENGINE still decides the winner and no theme ever perturbs the seeded roll.
# HARD rule: roles only (player, houseguest, favorite). Add to cucumber.cjs when green.

Feature: Competition theme variety

  Each competition is drawn from the 0042 mechanic library and then dressed in a seeded theme, so a
  whole season shows visibly distinct competitions with no repeats — even when the same mechanic recurs.
  The theme is pure Vault-free flavor: it renames and re-scenes the comp, but the mechanic, the governing
  aptitude, and the winner are unchanged, and no theme ever crosses the wall.

  Scenario: A season of competitions runs without a repeated theme
    Given a started game played across a full season
    When each week's competition is themed from the seeded pool
    Then no theme repeats within a phase across the season
    And the same-week head-of-household and veto competitions are themed differently

  Scenario: The theme is a coherent Vault-free skin over the mechanic
    Given a resolved themed competition
    When the themed result is read on a player surface
    Then it carries a theme label and a themed name and a scene-set premise
    And the themed result contains no stat, score, ranking, or Vault sentinel

  Scenario: The theme never changes who wins
    Given a seeded game to be played with and without themes
    When it is played once with themes on and once with themes off
    Then the same houseguests are evicted in the same order in both
    And each week's competition is won by the same houseguest in both

  Scenario: With themes off, the competition is the bare mechanic library
    Given a started game played with themes off
    When a competition resolves
    Then its result carries no theme

  Scenario: The theming is seed-deterministic
    Given a seeded game to be replayed with themes on
    When the same themed weeks are played twice
    Then the same themed competitions are surfaced in both
