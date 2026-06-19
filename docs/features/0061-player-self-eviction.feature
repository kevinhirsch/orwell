Feature: 0061 — Player self-eviction (the voluntary walk-out / quit path)
  A houseguest can voluntarily LEAVE the game — walk out / quit / self-evict — distinct from being
  voted out (0046) and from a fabricated narrated exit the GM must still refuse (L39a). The genuine
  path is a deliberate, explicitly-CONFIRMED, player-level (OOC) decision that flows through a real
  engine lever: it records a `self-eviction` event (correct witness set + the 0023 consequence fold)
  and transitions the player out through the SAME sanctioned door as 0046 — never a second eviction
  or restart path. Narrated-but-not-recorded means it didn't happen. Roles only — no names.
  #
  # SPEC ONLY — this skeleton is NOT YET wired into cucumber.cjs; it is added when the feature is
  # built to green (priority order), exactly as 0046/0047 were.

  # §4.1 / §4.2 — a CONFIRMED self-eviction is a real, recorded engine transition
  Scenario: a confirmed self-eviction records a real event and transitions state via the sanctioned door
    Given a started game in which the player is active before the jury
    And the player has confirmed an explicit, OOC self-eviction decision
    When the confirmed self-eviction is submitted through the validated decision seam
    Then a self-eviction event is recorded with the player in its witness set
    And the recorded event is not hidden
    And the event folds its hidden impact into the relationship and soul layer
    And the player's status transitions out through the same sanctioned player-exit door as a vote-out
    And the transition persists and survives an engine restart

  # §4.2 — an UNCONFIRMED / ambiguous intent does NOT evict (the L36 / confirmation gate holds)
  Scenario: an unconfirmed intent to leave surfaces a confirmation and never auto-evicts
    Given a started game in which the player is active
    When the player expresses a bare, ambiguous intent to leave
    Then a self-eviction confirmation decision is surfaced on the player-level OOC channel
    And no self-eviction event is recorded
    And the player's status is still active
    And the house neither hears nor reacts to the out-of-character intent

  # §4.2 — cancelling the confirmation is safe (no fabricated exit, state unchanged)
  Scenario: cancelling the confirmation leaves the player in the house unchanged
    Given a started game in which the player is active
    And a self-eviction confirmation decision is pending
    When the player cancels the confirmation
    Then no self-eviction event is recorded
    And the player remains active and in the house
    And the game state is unchanged

  # §4.3 — terminal handling by phase: pre-jury reuses 0046's terminal recap
  Scenario: a pre-jury self-eviction reaches the terminal recap end state
    Given a started game in which the player is active before the jury
    When the player completes a confirmed self-eviction
    Then the player's status is marked evicted
    And the season reaches a defined terminal end state for that player

  # §4.3 — terminal handling by phase: jury-phase resolves the owner-decided default (§9)
  Scenario: a jury-phase self-eviction resolves through the 0046 machinery without a new exit path
    Given a started game in which the player is active during the jury phase
    When the player completes a confirmed self-eviction
    Then the player's exit resolves through the 0046 player-exit machinery
    And the resolution uses no new eviction or restart path

  # §4.4 — the house reacts: significant house event + consequence fold + optional goodbye
  Scenario: the departure is a significant house event the souls fold
    Given a started game in which the player is active
    When the player completes a confirmed self-eviction
    Then the departure satisfies the daily-event invariant for that in-game day
    And the houseguests present witness the departure
    And the houseguests' souls fold the exit into their relationship reads
    And the player is offered the chance to author their own parting message

  # §4.5 — Vault Wall: no hidden state crosses anywhere in the self-eviction flow or its recap
  Scenario: no Vault sentinel crosses the self-eviction flow or its recap
    Given a started game with a Vault sentinel planted in the hidden layer
    When the player completes a confirmed self-eviction
    Then the sentinel never appears on the self-eviction confirmation pending
    And the sentinel never appears on the decision-seam output
    And the sentinel never appears on the post-exit player projection or recap
    And the sentinel never appears on the admin surface

  # §4.1 — the narrated-but-unrecorded gap stays closed (the L39a invariant)
  Scenario: a self-exit with no recorded engine transition means the player never left
    Given a started game in which the player is active
    And no self-eviction event has been recorded
    When the player's projection is read
    Then the player's status is still active
    And the player is still in the house
