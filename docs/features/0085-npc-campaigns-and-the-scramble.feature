Feature: 0085 — NPC campaigns & the scramble
  Houseguests run strategy over time, not in one-tick impulses: a campaign is a persistent, hidden
  agenda with a goal and a target, executed across many beats — lobbying, planting doubt, cutting
  deals, repositioning — and adapting as the board changes, until it resolves at a ceremony. A
  campaign tilts the SEEDED outcome (the engine tallies it; narration only voices it), and the player
  learns one exists only through a real pathway — never by reading the house's mind. The pre-eviction
  scramble is the week's campaigns colliding, where the secret true count can diverge from what people
  say to your face.

  # Role-only (testing rule): the-player, a-schemer, the-target, an-ally, a-bloc, the-electorate.

  Background:
    Given a started season with a live off-screen society

  Rule: A campaign is strategy executed over time, not a one-tick reaction

    Scenario: A campaign persists and advances across many ticks
      Given a schemer forms a campaign to evict the target this week
      When the off-screen society runs several ticks
      Then the campaign advances by a concrete move on each tick
      And the campaign is still active and closer to its goal until the week resolves

    Scenario: A multi-week campaign survives a save and a week boundary
      Given a schemer forms a season-long campaign against the target
      When the game is snapshotted and restored after a week has passed
      Then the campaign is still active with its accumulated history intact

  Rule: A campaign adapts when the board changes

    Scenario: The target escaping veto re-aims the campaign
      Given a campaign to evict the target this week
      When the target wins the veto and removes themselves from the block
      Then the campaign re-targets or escalates rather than disappearing

    Scenario: A campaign pivots to self-protection when its owner is endangered
      Given a schemer running a campaign against the target
      When the schemer themselves is nominated
      Then the campaign pivots toward protecting its owner

  Rule: A campaign tilts the seeded outcome — the engine decides, not the narration

    Scenario: A sustained eviction campaign raises the target's odds of going home
      Given many seeded seasons with and without a sustained campaign to evict the target
      Then the target is evicted more often when the campaign runs
      But the same seed always produces the same outcome
      And the seeded competition and jury calibration is unchanged

    Scenario: A campaign is not destiny
      Given a sustained campaign to evict the target
      Then the target can still survive the vote on some seeds

  Rule: A campaign is hidden — the player learns of it only through a pathway

    Scenario: No surface reveals a campaign
      When every player-facing and admin-facing surface is read
      Then none of them returns any campaign's existence, target, plan, or progress

    Scenario: The player feels a campaign through real pathways, not mind-reading
      Given a campaign against the player is underway
      When houseguests lobby, gossip, and meet about it
      Then the player can learn that a campaign exists only through what they witness, are told, or overhear
      And the player never receives the sealed content of the schemers' private scenes

  Rule: The scramble — campaigns colliding at the vote

    Scenario: The secret count can diverge from what is said to the player's face
      Given several campaigns working the same electorate before an eviction
      Then the hidden true vote count may differ from the houseguests' stated intentions
      And the staged eviction reveal is anonymized
      And per-voter attribution unseals only in the post-season retrospective

  Rule: The player can run their own campaign — as player knowledge, never mind control

    Scenario: A player campaign is the player's knowledge and moves no NPC by itself
      Given the player declares a campaign to evict the target
      Then the player's campaign is the player's own knowledge with no pathway to any NPC
      And no NPC acts on the campaign except in response to the player's actual recorded moves
