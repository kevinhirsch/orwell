# DRAFT executable spec — author: feature-maker; implementer makes it pass.
# Build priority #2 — Event visibility & propagation.
# HARD rule: roles only, never names. Fixtures are generated, never sample-save content.

Feature: Event visibility & propagation — who knows what, and how they learned it

  There is one interaction record. Visibility is per-event metadata — a witness set and a
  hidden flag — not a function of which store the event lives in. Player-witnessed events
  are the player's knowledge and are NOT secret. Off-screen NPC-to-NPC events are simulated
  and hidden. A hidden fact reaches an entity only through a legitimate in-game pathway
  (told, overheard, caught); until then the entity has no access — it may suspect, but
  cannot know.

  Background:
    Given a running game sandbox with a single event record

  Scenario: A player-witnessed interaction is the player's knowledge and is not hidden
    Given an interaction whose witness set includes the player
    Then that interaction is part of the player's knowledge
    And it is not classified as off-screen or hidden

  Scenario: Visibility follows the witness set, not the store
    Given two interactions with identical content
    And the first has a witness set that includes the player
    And the second has a witness set that excludes the player
    Then the first is visible to the player
    And the second is hidden from the player

  Scenario: Off-screen NPC-to-NPC interactions are simulated and hidden
    Given a stretch of game time in which the player is absent
    Then NPC-to-NPC interactions occur with witness sets that exclude the player
    And they remain hidden from the player until surfaced by an in-game pathway

  Scenario: Information propagates only through an in-game pathway
    Given a hidden interaction the player did not witness
    And an NPC who witnessed it
    When that NPC tells the player about it
    Then that fact enters the player's knowledge state
    And the surfacing is itself recorded as an event with a traceable pathway

  Scenario: Without a pathway, the player has no access to a hidden fact
    Given a hidden interaction the player did not witness
    And no in-game pathway has surfaced it
    Then the player has no access to that fact

  Scenario: An NPC knows only what it witnessed or was told
    Given a fact an NPC neither witnessed nor was told
    Then that NPC does not know the fact
    And the NPC may hold it only as a suspicion, never as knowledge

  Scenario: A witnessed event is never mislabeled as off-screen or secret
    Given an interaction whose witness set includes the player
    When the event record is classified
    Then it is never written to the hidden / off-screen classification
    # Regression guard: a past bug logged player-witnessed events as off-screen/secret.

  Scenario: Player Diary Room content reaches no NPC
    Given the player speaks privately in the Diary Room
    Then that content is part of the player's own knowledge
    And no NPC's knowledge state gains a pathway to it
