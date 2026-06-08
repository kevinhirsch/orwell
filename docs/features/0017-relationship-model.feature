# DRAFT executable spec — author: feature-maker; implementer makes it pass.
# Feature 0017 — Relationship model (promotes decision 0002). Directed, graded, computed beliefs.
# HARD rule: roles only. No binary ally/enemy flag is ever stored — labels are organic.

Feature: Relationship model — directed, graded, asymmetric beliefs computed from history

  Who a houseguest confides in and who their enemies are is the most calculated part of the sim:
  directed edges carrying graded signals, computed from the event history through the holder's
  own character framing. Never binary flags. Labels are read on the spot and never stored.

  Scenario: An edge carries graded signals, not a binary flag
    Given a directed relationship from one houseguest toward another
    Then the edge exposes graded signals including trust, affinity, and threat
    And the edge is not a binary ally-or-enemy flag

  Scenario: Relationships are directed and can be asymmetric
    Given a history where one houseguest invests in another who does not reciprocate
    Then the edge in one direction differs from the edge in the other direction

  Scenario: A read with little data is uncertain, and firms up as data accrues
    Given two houseguests who have barely interacted
    Then the relationship read has low confidence
    And it is a suspicion rather than knowledge
    When consistent interactions accumulate between them
    Then the relationship read's confidence rises

  Scenario: A witnessed betrayal sharply shifts the edge
    Given an established trusting edge from one houseguest toward another
    When the holder witnesses the other betray them
    Then trust and affinity drop sharply in one step
    And threat rises

  Scenario: A neglected edge decays toward baseline
    Given an established edge between two houseguests
    When they do not interact for a long stretch
    Then the edge drifts back toward the holder's baseline

  Scenario: No relationship label is ever stored
    When a houseguest's soul is serialized
    Then it contains the graded signals and the interaction history
    And it contains no stored ally, enemy, or best-friend label

  Scenario: The same history yields different labels under different dispositions
    Given identical interaction history read by a paranoid houseguest and by a trusting one
    When each houseguest's view of the other is labeled
    Then the paranoid houseguest reads it as more of a threat
    And the trusting houseguest reads it as more of a bond
    And each label is derived on the spot, not stored

  Scenario: Houseguest's Choice reads the strongest available bond
    Given an NPC must pick a houseguest by their own motivation
    When the NPC chooses
    Then the NPC picks their strongest available bond as scored by the signals
    And the choice carries bounded temperature variance
