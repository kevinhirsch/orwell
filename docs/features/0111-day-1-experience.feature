Feature: 0111 — The Day-1 experience (the first session is the first move of the social game)
  Day 1's job is to make the player believe the whole season's depth before they've seen it
  and get them into the conversation fast. Five pillars: casting probes the self (not a
  declared kill-list); the producer plants one Vault-free curiosity needle that the hidden
  game exists; house entry is fast and asymmetric with the first power arriving quickly; one
  early social beat demonstrably folds a real read (teaching action→consequence diegetically);
  and the Diary Room is an enterable room on Day 1. The Vault Wall holds for player AND admin:
  the needle reveals no specific hidden fact, no number ever crosses from the consequence fold,
  and the Diary Room has no pathway to any NPC. Composes #905/#906/#907/#908/#909 under #875.

  # Role-only (testing rule): the-player, a houseguest, a near-stranger, the-HOH, a hot-read,
  # a straggler, the admin. No names. Fixtures are generated; no sample-save content.

  Background:
    Given a fresh player completing the casting interview into a new season

  Rule: Casting probes the self, it does not demand a declared strategy (#905)

    Scenario: The interview elicits self-belief and tells, not a kill-list
      When the player completes the casting interview
      Then the interview probes the player's self-belief and tells
      And finalizing casting does not require a declared target list
      And the recorded intake captures character, not a committed strategy

  Rule: The producer plants exactly one Vault-free curiosity needle (#909)

    Scenario: A truthful "the house has a hidden game" beat that reveals no secret
      When the producer frames the season during casting
      Then exactly one curiosity needle signals that a hidden game exists
      And the needle is sourced only from public or seeded framing
      And the needle carries no specific hidden secret, relationship, or scheme

  Rule: House entry is fast and asymmetric; the first power arrives quickly (#906)

    Scenario: The first power is reachable without a full roster roll-call
      Given the player has formed two-to-three hot first reads
      And some stragglers have only been met in motion
      When the premiere proceeds to the first power
      Then the first power is reachable while the to-meet list is non-empty in the in-motion sense
      And no houseguest is left invisible
      And the first power competition is a real seeded competition that is never gifted

  Rule: One early social beat demonstrably folds a real read (#908)

    Scenario: A Day-1 choice changes how a houseguest later treats the player
      Given a Day-1 social beat between the player and a houseguest
      When the player makes a consequential choice in that beat
      Then the beat is recorded and folds a hidden first read
      And the fold is guaranteed even when the model under-calls the recording tool
      And the change is recalled later only as observable behavior, never as a number

    Scenario: With no Day-1 beat, the folds are byte-identical to the baseline
      Given a Day-1 with no consequential social beat taken
      Then the relationship folds are byte-identical to the baseline first day

  Rule: The Diary Room is an enterable room on Day 1 (#907)

    Scenario: The player can confess on Day 1 with no leak to the house
      When the player enters the Diary Room on Day 1
      Then the Diary Room is available as a room before week-one nominations
      And the player can give a confessional
      And nothing said in the Diary Room reaches any houseguest's behavior

  Rule: The Vault Wall holds for player AND admin

    Scenario: Neither the player nor the admin sees Day-1 hidden state
      Given the player has finished a Day-1 with a curiosity needle and a consequential beat
      When the Day-1 player-facing and admin-facing projections are assembled
      Then the curiosity needle exposes no specific hidden fact on either surface
      And no number from the consequence fold appears on either surface
      And the Diary Room exposes no pathway from the player's confession to any NPC

  Rule: Day-1 is deterministic and calibration-neutral

    Scenario: With the reframes inactive, the season is byte-identical
      Given a full season is played with the Day-1 reframes inactive
      Then the seeded competition and eviction outcomes are byte-identical to the baseline season
