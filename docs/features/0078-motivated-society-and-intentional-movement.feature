Feature: 0078 — Motivated off-screen society & intentional movement
  Who an NPC schemes or bonds with off-screen is decided by their relationships and motivations —
  never by who happens to share a room. Room placement becomes a consequence (where the scene is set,
  so it can be overheard) and a gameplay surface (privacy, reach, conspicuousness), never the cause of
  the social graph. Because pairing never reads the floor plan, rearranging the house can never move a
  vote — the calibrated outcomes are decoupled from presentation. NPCs move with intent, like the
  player, toward what their agenda wants.

  # Role-only (testing rule): the-player, an ally, a rival, a target, a schemer, an outsider.

  Background:
    Given a started season with the off-screen society running between turns

  Rule: Who bonds is driven by motivation and relationship, not by the room

    Scenario: A scheme pairs by agenda, not by co-location
      Given a schemer whose agenda points at a target
      When the off-screen society runs
      Then the schemer's off-screen partners reflect their relationships and agenda
      And do not depend on which room the floor plan placed them in

    Scenario: Shuffling the rooms does not change who pairs
      Given a fixed seed and a fixed cast
      When the same season is run on two different floor plans
      Then the off-screen pairings are identical across both layouts

  Rule: Rearranging the house can never move a competitive outcome (the decoupling)

    Scenario: Identical votes across floor plans
      Given a fixed seed
      When a full season is played on the small floor plan and on the large floor plan
      Then every eviction vote and the final placements are identical
      And the seeded calibration band is unchanged by the layout

  Rule: Location is a consequence and a gameplay surface, not the cause

    Scenario: A motivated scene is set in the initiator's room so it can be overheard
      Given the society decides a motivated pair will interact
      Then the scene is placed in the room the initiator is actually in
      And a houseguest one room over may overhear a fragment through the real pathway
      And the room placement never decided who the pair was

    Scenario: The content of the hidden scene never leaks, only an overheard fragment
      When a hidden off-screen scene resolves
      Then its full content stays sealed in the Vault
      And only a partial, lower-confidence fragment can reach an adjacent listener

  Rule: NPCs move with intent

    Scenario: A houseguest moves toward what their agenda wants
      Given a houseguest with a motive to work a target
      When the house lives between the player's turns
      Then that houseguest trends toward the target's vicinity more than a motiveless houseguest

    Scenario: Asleep houseguests neither move nor scheme at night
      Given the night has thinned the awake set
      Then a houseguest who has turned in neither relocates nor appears in an off-screen scene

  Rule: The anti-sycophancy floor holds on the new model

    Scenario: Playing the game is never a disadvantage
      When the calibration band is measured across seeded seasons on the new society model
      Then an active player reaches the jury at least as often as a passive one
      And an active player wins at least as often as a passive one
