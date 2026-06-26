Feature: 0105 — Drive-anchored suspicion (the wary read behind the sealed plan)
  A houseguest's drive (0086) gives them a specific, Vault-safe suspicion: the threat-READ that
  motivates the drive is their own subjective hunch, and it surfaces as behavior so the narrator finally
  has someone specific to voice them watching. The drive's PLAN — its intensity, its vote tilt, the whole
  campaign — stays sealed. Only threat-reading drives produce a suspicion; it anchors the 0084 mood and
  never reaches the player as data or a stated motive.

  # Role-only (testing rule): a-schemer, a-rival, a-safe-floater.

  Background:
    Given a started season with the live drive layer enabled

  Rule: A drive gives its owner a specific, behavioral suspicion

    Scenario: A houseguest targeting a rival is voiced as watching them
      Given a houseguest reads a rival as a threat
      When their voicing is read
      Then their suspicions name that rival
      And the suspicion is a behavioral hunch, not a number or a stated plan

    Scenario: A safe, under-the-radar houseguest has no manufactured suspicion
      Given a safe, under-the-radar houseguest
      When their voicing is read
      Then their voicing carries no drive-derived suspicion

  Rule: The suspicion anchors mood but never leaks the drive

    Scenario: The voicing exposes no plan, number, or motivation value
      Given a houseguest reads a rival as a threat
      When their voicing is read
      Then it contains no drive number, no campaign, and no stated motive

  Rule: Calibration is safe

    Scenario: With the drive layer off, no drive-derived suspicion is surfaced
      Given the drive layer is disabled
      Then no houseguest's voicing carries a drive-derived suspicion
      And the seeded competition and jury calibration is unchanged
