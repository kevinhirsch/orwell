# Executable spec — SPEC (drafted failing-first). Expands 0040 (NPC confessionals): deeper content
# (plan / standing / grudge / big-conversation aftermath / adjacent move) and a once-per-in-game-day
# sweep where MOST living houseguests confess unless their game is bare. Vault-only (sealed from the
# player AND admin), calibration-safe (default-off flag + dedicated rng). HARD rule: roles only
# (NPC, HOH, nominee, evictee, ally, showmance) — no names. Add to cucumber.cjs when green.

Feature: Deeper, daily NPC confessionals

  0040 gave every houseguest a real, private, engine-grounded read — but thin (biggest threat + trust)
  and rare (only ceremony-standers). This deepens the confessional with five more grounded facets and
  makes MOST houseguests confess once per in-game day, unless their game is bare. Everything stays
  Vault-only and the engine supplies every fact — the narrator never invents one.

  Scenario: Most houseguests confess each in-game day
    Given a started game with the daily-confessional depth on and the in-game clock live
    When an in-game day passes
    Then most of the living houseguests recorded a confessional that day
    And not only the houseguests who stood in a ceremony

  Scenario: A houseguest with a bare game stays quiet
    Given a houseguest with no recent meaningful events and no clear target or ally
    When the daily confessional sweep runs
    Then that houseguest records no confessional that day

  Scenario: A confessional carries only the facets its situation triggers
    Given the HOH and a coasting mid-pack houseguest both confess the same day
    Then the HOH's confessional is the deeper one, carrying their plan and safe standing
    And the coasting houseguest's confessional is short, carrying only what they actually hold
    And neither confessional is a fixed multi-part form

  Scenario: A confessional voices the NPC's plan, grounded in their target
    Given a houseguest whose hidden reads mark a clear top threat
    When that houseguest confesses
    Then the confessional states the move they intend against that threat
    And the plan is grounded in their real target, not invented

  Scenario: A confessional reflects whether the NPC feels safe or exposed
    Given a houseguest who is on the block
    When that houseguest confesses
    Then the confessional reflects that they feel exposed
    And a houseguest holding power reads as feeling safe instead

  Scenario: A confessional names a grudge distinct from the current target
    Given a houseguest betrayed by one peer but currently targeting another
    When that houseguest confesses
    Then the confessional names the betrayer as a grudge
    And it names the other peer as their current target
    And the grudge and the target are two different reads

  Scenario: A confessional reacts to how a big conversation sat with them
    Given a houseguest who just had a significant conversation that shifted a bond
    When that houseguest confesses
    Then the confessional reflects how that conversation sat with them
    And it is grounded in their real read of the person they spoke with

  Scenario: A confessional reacts to an adjacent move
    Given a houseguest whose ally just won power in a public beat
    When that houseguest confesses
    Then the confessional reacts to that beat through their bond with the ally
    And the reaction is grounded in a public beat the houseguest witnessed

  Scenario: The depth layer is Vault-sealed and calibration-neutral
    Given a started game in which houseguests have confessed the deeper reads
    When any player surface and the admin surface are read
    Then no confessional content appears on either
    And with the depth layer off the confessional stream is byte-identical to the base
    And the same seed reproduces the same confessions
