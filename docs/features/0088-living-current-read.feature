Feature: 0088 — A living, current read of the player
  Each houseguest carries a FROZEN first impression of the player (their day-one read) AND a LIVING
  current read that moves with what the player has actually done. The current read is derived from the
  evolving, hidden NPC->player relationship edge and shaded by that houseguest's disposition and soul.
  It is surfaced ONLY behaviorally — how they carry themselves toward the player — never as a number,
  never to admin, and never as the engine asserting how the player feels. The player feels their
  reputation shifting in real time and infers the read themselves.

  # Role-only (testing rule): the-player, a houseguest, a warmed-to houseguest, a soured-on houseguest,
  # an undecided houseguest, an admin.

  Background:
    Given a started season with the player in the house

  Rule: The current read is living — it evolves with what the player does

    Scenario: Favorable conduct warms a houseguest's current read of the player
      Given a houseguest whose day-one read of the player is wary
      When the player accumulates favorable conduct toward that houseguest over several recorded scenes
      Then that houseguest's current read of the player carries a warmer carriage toward the player
      And the carriage reads as warming since an earlier reference point
      And the player is never shown a number for that read

    Scenario: Adverse conduct cools a houseguest's current read of the player
      Given a houseguest whose day-one read of the player is friendly
      When the player acts against that houseguest in recorded scenes
      Then that houseguest's current read of the player carries a cooler, more guarded carriage
      And the carriage reads as cooling since an earlier reference point

  Rule: The living read is distinct from the frozen day-one read

    Scenario: The day-one read never changes even as the current read moves
      Given a houseguest with a sealed day-one read of the player
      When the player's conduct moves that houseguest's current read across the season
      And the season is snapshotted and restored
      Then the sealed day-one read of the player is unchanged
      And the current read may disagree with the day-one read
      And the gap between the first impression and the current read is itself voiceable

  Rule: Vault Wall — never a number, never to admin

    Scenario: The current read surfaces only as observable conduct, never a number
      When the voicing projection for a houseguest is read
      Then any current read of the player is a carriage word, not a signal value
      And the projection carries no trust, affinity, or threat number toward the player
      And the projection carries no hidden cause for the read

    Scenario: Admin cannot see the underlying read magnitudes
      Given the player has built a strong reputation with a houseguest
      When an admin inspects the available game state
      Then no admin surface exposes the NPC-to-player relationship signals
      And no admin surface exposes a number for any houseguest's read of the player

  Rule: The player forms their own inference — the engine never asserts it

    Scenario: The engine voices conduct, never tells the player how they feel
      Given a houseguest whose current read of the player has warmed
      When that houseguest is voiced toward the player
      Then the houseguest's warmer conduct is shown
      And the engine never asserts that the player trusts or likes that houseguest
      And the engine never labels the relationship for the player

  Rule: The current read is deterministic and calibration-neutral

    Scenario: The same history yields the same read, and outcomes are unchanged
      Given two games seeded identically and played through the same history
      Then each houseguest's current read of the player is the same carriage in both games
      And the seeded competition and eviction outcomes are byte-identical to a game without the read surfaced
