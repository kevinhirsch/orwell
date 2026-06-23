Feature: 0078 — Motivated off-screen society & intentional movement
  Houseguests must be in the same room to have any off-screen scene — co-presence is the gate, so
  "who's in a room together" matters. But co-presence is EARNED, not arbitrary: NPCs move with intent,
  like the player, toward what their motivation wants (a bond to build, a target to work, a quiet room
  to scheme). And being in a room together does not mean talking game: the nature follows motivation —
  a friendly conversation (affinity only, no scheming) or a strategic one — and relationships build
  either way.

  # Role-only (testing rule): the-player, an ally, a rival, a target, a schemer, an outsider.

  Background:
    Given a started season with the off-screen society running between turns

  Rule: Co-presence is required for any off-screen interaction

    Scenario: No scene happens between houseguests in different rooms
      Given two houseguests in different rooms
      When the house lives between the player's turns
      Then no off-screen scene fires between them

  Rule: Co-presence is earned by intentional movement, not by random drift

    Scenario: A houseguest moves toward the person their motivation points at
      Given a houseguest with a motive to bond with an ally
      And another houseguest with a motive to work a rival
      When the house lives between the player's turns
      Then each trends toward their target's vicinity more than a motiveless houseguest
      And the pairs that end up co-present reflect agenda, not luck

    Scenario: Shuffling who has a motive changes who ends up together
      Given a fixed seed
      When the same season is run with different houseguest agendas
      Then the co-presence pattern shifts to follow the agendas

  Rule: Co-presence is not game talk — motivation sets the nature

    Scenario: A warm pair has a friendly conversation that builds the bond only
      Given two co-present houseguests with a warm, low-threat relationship
      When they have an off-screen scene
      Then the scene is friendly, not strategic
      And it raises their affinity
      And it folds no strategic weight and triggers no vote-affecting change

    Scenario: A threatened pair has a strategic conversation
      Given two co-present houseguests where one reads the other as a threat
      When they have an off-screen scene
      Then the scene is a game conversation
      And it folds the strategic weights that feed votes

    Scenario: Every co-present scene deepens the relationship layer
      When any off-screen scene resolves
      Then it records, folds its impact, and persists
      And nothing is left inert

  Rule: Asleep houseguests neither move nor scheme (the night bound holds)

    Scenario: A turned-in houseguest drops out of the society
      Given the night has thinned the awake set
      Then a houseguest who has gone to bed neither relocates nor appears in an off-screen scene

  Rule: The anti-sycophancy floor holds on the new movement model

    Scenario: Playing the game is never a disadvantage
      When the calibration band is measured across seeded seasons on the intentional-movement model
      Then an active player reaches the jury at least as often as a passive one
      And an active player wins at least as often as a passive one
