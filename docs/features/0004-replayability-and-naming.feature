# DRAFT executable spec — author: feature-maker; implementer makes it pass.
# Build priority #4 — Replayability & naming + generation constraints.
# HARD rule: roles only; NO name drawn from any fixed/sample list.

Feature: Replayability & naming — a fresh, randomly-named house every game

  No fixed protagonist. Each new game is a new save: a player created at first-run character
  creation (OOBE) and a brand-new house of newly generated, randomly-named NPCs within
  plausible Big Brother contestant bounds. The cast is a curated ensemble — deliberately varied
  (archetypes, strategy styles, backgrounds) so every house has built-in friction and variety.
  No identity carries over between games. Only the player's profile is human-authored.

  Scenario: Each new game generates a new, randomly-named house
    When a new game is started
    Then a player character is produced via character creation
    And the house is populated with newly generated, randomly-named houseguests
    And no identity carries over from any previous game

  Scenario: The cast size is sixteen
    When a new house is generated
    Then the house contains sixteen houseguests
    And exactly one is the player
    And the other fifteen are NPCs

  Scenario: Only the player's profile originates from human authoring
    When a new house is generated
    Then the player's profile originates from OOBE authoring
    And every NPC profile is generated

  Scenario: NPC profiles stay within plausible Big Brother bounds
    When a new house is generated
    Then each NPC profile is internally consistent
    And each falls within plausible reality-TV contestant archetypes

  Scenario: Each cast is a curated, varied ensemble
    When a new house is generated
    Then the cast spans a spread of distinct archetypes and strategy styles
    And no single archetype dominates the house beyond the configured balance
    And the mix includes personalities likely to clash and to bond

  # Amended by product ruling #1 (2026-06-10, E38): NPC names must read as REAL names —
  # seeded sampling from vendored real-name corpora. The corpora are raw material only
  # ("no fixed cast"): no full-name+persona pairing is hard-coded, and the legacy Bible's
  # names stay banned (excluded from the corpora).
  Scenario: Names are unique within a house, realistic, and never a fixed cast
    When a new house is generated
    Then every houseguest display name is unique within the house
    And every generated name is sampled from the vendored real-name corpora
    And no legacy sample-save name is ever generated
    And no full name and persona pairing is fixed across seeds

  Scenario: Two differently-seeded games share no identities
    Given a house generated with seed "A"
    And a house generated with seed "B"
    Then the two houses share no houseguest identities

  # Amendment (for 0020 portraits) — PENDING IMPLEMENTATION (queue item B9).
  # When CharacterFactory generates the public appearance fields (see 0004 §8), the
  # implementer adds this scenario + its step defs and makes it green:
  #   Scenario: Each houseguest carries public appearance fields for their portrait
  #     When a new house is generated
  #     Then each houseguest's Character carries public appearance and presentation fields
  #     And those fields are internally consistent with the houseguest's archetype
  #     And those fields contain no competition aptitudes or hidden attributes
  # Kept out of the live suite until then so this implemented feature stays green.
