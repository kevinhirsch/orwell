# Executable spec — SPEC (drafted failing-first), now IMPLEMENTED & green. Expands 0040 (NPC confessionals):
# deeper content (plan / standing / grudge / big-conversation aftermath / adjacent move) and a
# once-per-in-game-day sweep where MOST living houseguests confess unless their game is bare. Vault-only
# (sealed from the player AND admin), calibration-safe (default-off flag + dedicated rng). HARD rule:
# roles only (NPC, HOH, nominee, ally) — no names. Added to cucumber.cjs when green.

Feature: Deeper, daily NPC confessionals

  0040 gave every houseguest a real, private, engine-grounded read — but thin (biggest threat + trust)
  and rare (only ceremony-standers). This deepens the confessional with five more grounded facets and
  makes MOST houseguests confess once per in-game day, unless their game is bare. Everything stays
  Vault-only and the engine supplies every fact — the narrator never invents one.

  Scenario: Most houseguests confess each in-game day
    Given a started game with the daily-confessional depth on and the in-game clock live
    When an in-game day passes
    Then most of the living houseguests recorded a confessional that day

  Scenario: A houseguest with a bare game stays quiet
    Given a confessing houseguest with no recent meaningful events and no clear target or ally
    When the daily confessional sweep considers them
    Then that houseguest is skipped and records no confessional that day

  Scenario: A deep confessional voices the NPC's plan, grounded in their target
    Given a confessing houseguest who reads one peer as their clear top threat
    When that houseguest records a deep confessional as the Head of Household
    Then the deep confessional states the move they intend against that threat
    And the plan is grounded in their real target

  Scenario: A deep confessional reflects whether the NPC feels safe or exposed
    Given a confessing houseguest who is on the block
    When that nominee records a deep confessional
    Then the deep confessional reads as exposed
    And a power-holder's deep confessional reads as safe instead

  Scenario: A deep confessional names a grudge distinct from the current target
    Given a confessing houseguest betrayed by one peer but targeting another
    When that betrayed houseguest records a deep confessional
    Then the deep confessional names the betrayer as a grudge
    And it names the other peer as their current target
    And the grudge and the target are two different reads

  Scenario: A deep confessional reacts to how a big conversation sat with them
    Given a confessing houseguest who just had a significant conversation with an ally
    When that houseguest records a deep confessional after the talk
    Then the deep confessional reflects how that conversation sat with them

  Scenario: A deep confessional reacts to an adjacent move
    Given a confessing houseguest whose ally just won power on the public board
    When that houseguest records a deep confessional about the board
    Then the deep confessional reacts to that beat through their bond with the ally

  Scenario: The depth layer is Vault-sealed and calibration-neutral
    Given a started game whose houseguests have swept deep confessionals
    When the player surface and the admin surface are both read for confessionals
    Then no deep confessional content appears on either
    And with the depth layer off the day-close sweep does not fire
    And the same seed reproduces the same swept confessionals
