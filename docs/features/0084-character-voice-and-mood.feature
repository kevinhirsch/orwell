Feature: 0084 — Character voice & grounded mood
  Each houseguest has a distinct, byte-stable way of talking (a public voice fingerprint on their
  static CHARACTER) and a live, observable mood read straight from their evolving soul. The voice is
  identity and never drifts; the mood moves with what has happened to them. Both are handed to the
  voicer as facts to voice — so sixteen houseguests sound like sixteen people, and a rattled one
  actually sounds rattled, without ever leaking a number or the hidden cause.

  # Role-only (testing rule): the-player, an-NPC, two-NPCs-of-one-archetype, the-cast, a-betrayed-NPC.

  Background:
    Given a started season with a generated cast

  Rule: Every houseguest has a distinct, public voice fingerprint

    Scenario: The cast does not share one voice
      Then every houseguest carries a voice fingerprint with a register, rhythm, and stress tell
      And no two houseguests in the cast have an identical voice fingerprint
      And the cast spans a range of registers and rhythms, not one default

    Scenario: Two houseguests of the same archetype still sound different
      Given two houseguests share an archetype
      Then their voice fingerprints are correlated with that archetype
      But they are not identical to each other

    Scenario: The voice is a public facet, never a Vault leak
      When the voicing projection for a houseguest is read
      Then it carries the voice fingerprint
      And it carries no hidden soul scalar, secret, or motive
      And it carries no number

  Rule: The voice is identity — byte-stable for the whole season

    Scenario: Voice survives a save round-trip unchanged
      Given a houseguest with a voice fingerprint
      When the cast is snapshotted and restored
      Then that houseguest's voice fingerprint is identical

    Scenario: Voice does not drift as the soul evolves
      Given a houseguest with a voice fingerprint
      When many consequential beats evolve that houseguest's soul
      Then their voice fingerprint is unchanged
      And only their mood has moved

  Rule: Mood is grounded in the live soul, not invented

    Scenario: A houseguest in distress is voiced as distressed
      Given a houseguest whose soul has moved toward distress
      When the voicer is given that houseguest to voice
      Then the mood handed to the voicer is a distress affect, not a pleasant default
      And the mood is an observable affect word, never a number

    Scenario: A blindside shifts the mood, not the cause
      Given a betrayed NPC whose betrayal is hidden from the player
      When the player reads that houseguest in a scene
      Then the houseguest's mood reflects the shift
      And the read never names the hidden cause of the mood
      And the player is left to infer why for themselves

    Scenario: Mood moves over the season
      Given a houseguest with a settled baseline mood
      When a costly beat lands on that houseguest
      Then their mood word changes from the baseline
      And it later settles back as the soul mean-reverts

    Scenario: Mood marinates — a long stretch of hardship shifts the baseline itself
      Given a houseguest worn down by many weeks of house dynamics
      When the houseguest has a calm, uneventful moment
      Then their mood still reads as worn rather than resetting to a neutral default
      And a houseguest who has had a long safe run reads as lasting ease in the same calm moment

  Rule: Determinism and the lever contract

    Scenario: The same seed produces the same voices
      Given two seasons generated from the same seed
      Then the two casts have identical voice fingerprints

    Scenario: The voicing lever voices the given mood and bans gimmickry
      When the moment prompt for a focal houseguest is built
      Then it instructs the voicer to voice the houseguest's given mood
      And it instructs the voicer to use the voice as a consistent texture, never a catchphrase or bit
