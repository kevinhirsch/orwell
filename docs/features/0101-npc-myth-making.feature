Feature: 0101 — NPC myth-making (you become house folklore)
  As the player does notable things in the house, the cast forms and spreads LEGENDS about
  them. A notable player act seeds a gossip belief whose SUBJECT is the player; that belief
  diffuses NPC-to-NPC along the existing relationship/gossip model, growing more distorted with
  each retelling; and it reaches the player only when a chain of tellings terminates at them —
  "people are saying you…". The engine seeds and spreads the legend; the model voices it. The
  Vault Wall holds (the verbatim act never crosses; the legend lives in the hidden layer until a
  pathway lands it), and anti-sycophancy holds (a legend about the player never moves the
  player's own reads, and the human judges whether it is true).

  # Role-only (testing rule): the-player, a houseguest, a witness, a far houseguest, the house.
  # This BUILDS ON the 0002 gossip diffusion (factId / source / confidence / distortion / the
  # player-terminal surfacing) — it adds only a player-subject ORIGIN; it is not a new system.

  Background:
    Given a started season with the player in the house

  Rule: A notable player act becomes a spreading legend

    Scenario: A big move becomes a story the house tells
      Given the player has done a notable, public thing in the house
      When the off-screen house lives between the player's turns
      Then the engine seeds a legend whose subject is the player
      And the legend is a vague public gloss of the act, not the verbatim scene
      And the legend diffuses from houseguest to houseguest along the relationship graph

    Scenario: An unremarkable turn seeds no legend
      Given the player has only had ordinary, unremarkable scenes
      When the off-screen house lives between the player's turns
      Then no legend about the player is seeded
      And the house tells no story about the player

  Rule: A legend distorts as it spreads

    Scenario: The legend grows with each retelling
      Given a legend about the player has begun spreading from a witness
      When the legend is retold across several houseguests
      Then a houseguest further along the chain holds a more distorted version than the witness
      And that houseguest's confidence in the legend is lower than the witness's
      And every version shares the same legend lineage

  Rule: A legend reaches the player only through a terminating pathway

    Scenario: The legend circles back as "people are saying you…"
      Given a legend about the player is spreading through the house
      When a chain of tellings terminates at the player
      Then the player learns the legend as their own knowledge
      And the legend carries its provenance and the houseguest who told it
      And a houseguest may voice it as what the house is saying about the player

    Scenario: A legend that never reaches the player stays unknown to them
      Given a legend about the player is spreading among houseguests only
      And no chain of tellings reaches the player
      Then the player learns nothing of the legend
      And the legend remains hidden-layer belief among the houseguests

  Rule: The Vault Wall holds — for the player and for the admin

    Scenario: Neither the player nor the admin can read the diffusing legend out of band
      Given a legend about the player is diffusing in the hidden layer
      Then no player-facing surface exposes the legend before a pathway delivers it
      And no admin or God-Mode surface exposes the legend, its confidence, or its diffusion graph
      And the surfaced legend carries no number and no truth marker
      And the player judges for themselves whether the legend is accurate

  Rule: Anti-sycophancy and determinism

    Scenario: A legend about the player never moves the player's own reads
      Given a legend about the player reaches the player through a pathway
      Then the legend does not change how the player feels about any houseguest
      And the engine never tells the player whether the legend is true

    Scenario: The myth layer is calibration-neutral
      Given two seasons played from the same seed and the same history
      When one season has myth-making enabled and the other has it disabled
      Then the seeded competition and eviction outcomes are byte-identical between them
      And the legends seeded are identical given the same seed and history
