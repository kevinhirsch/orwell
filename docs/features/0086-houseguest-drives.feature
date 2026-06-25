Feature: 0086 — Houseguest drives (everyone always plays; intensity varies)
  Every houseguest always carries a drive — a primary motivation (self-preserve, target, build, lay
  low, win power) with an intensity that scales with the board and who they are. The campaign of 0085
  is just the top gear of a drive: most houseguests simmer with a quiet lean, a few work it, and only
  the loudest reach a full lobbying campaign. A drive is hidden engine state, computed from each
  houseguest's own reads — never an omniscient board, never a number to the player.

  # Role-only (testing rule): the-house, a-nominee, a-safe-floater, an-aggressor, the-target.

  Background:
    Given a started season with the live drive layer enabled

  Rule: Everyone always plays — motivation is continuous, not a capped privilege

    Scenario: Every active houseguest has a drive each tick
      When the society runs a tick
      Then every living houseguest has a drive with a motivation and an intensity
      And the drive set covers the whole house, not a capped subset

    Scenario: The cap limits loud campaigns, not who is motivated
      Given more houseguests have a drive than the loud-campaign cap allows
      When the society runs a tick
      Then only up to the cap are promoted to active campaigns
      And the rest still carry a quieter lean

  Rule: Intensity tracks the board and who they are

    Scenario: A houseguest in danger drives hard at self-preservation
      Given a houseguest is on the block
      Then their motivation is self-preservation
      And their intensity is high

    Scenario: A safe, low-threat under-the-radar houseguest simmers
      Given a houseguest is safe and reads little threat
      Then their motivation is to lay low
      And their intensity is low

    Scenario: An aggressor pursues harder than a floater at the same board state
      Given an aggressive archetype and a floater hold the same threat read
      Then the aggressor's intensity is higher than the floater's

  Rule: A drive promotes through the gears of the same spectrum

    Scenario: Raising the intensity promotes a lean into a campaign
      Given a houseguest holds a low-intensity target lean
      When that drive's intensity rises past the campaign threshold
      Then it becomes an active campaign with lobbying
      And below the threshold it stays a lean that nudges the vote far less than a campaign

  Rule: Perspective is symmetric and calibration is safe

    Scenario: A drive is computed from the owner's own reads, never an omniscient board
      Given a houseguest has no pathway to another's plan
      Then their drive reflects only what they themselves read, not the full house

    Scenario: With the drive layer off, the seeded game is byte-identical
      Given the drive layer is disabled
      Then no drive is computed and no lean is applied
      And the seeded competition and jury calibration is unchanged

    Scenario: A drive never reaches the player as a number
      When every player-facing surface is read
      Then none of them returns a drive, an intensity, or a motivation value
