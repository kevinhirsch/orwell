Feature: 0090 — Per-archetype voice (the cast reads as different people)
  The 0084 voice fingerprint already exists on every houseguest's static CHARACTER; 0090 makes it
  genuinely distinctive per archetype (and inflected per soul) AND threads it through the prose the
  ENGINE authors — confessionals, the hidden deep-profile prose, the story-thread / retrospective
  text — so each houseguest's hidden-layer prose sounds like THEM instead of one uniform template
  voice. Voice is public, observable identity: byte-stable for the whole game, carrying no hidden
  state, computed deterministically from the seed. It changes only the PHRASING, never a game fact.

  # Role-only (testing rule): a blunt-archetype houseguest, a warm-archetype houseguest,
  #   two-houseguests-of-one-archetype, a confessor, an evictee, the player.

  Background:
    Given a started season with the voice layer enabled

  Rule: Two different archetypes read as distinct voices

    Scenario: A blunt archetype and a warm archetype confess in different voices
      Given a blunt-archetype houseguest and a warm-archetype houseguest with the same engine-grounded target and ally
      When each records a confessional
      Then their confessionals are voiced in distinguishable diction and cadence
      And neither falls back to the single shared templated line
      And both still name the same engine-grounded target and ally

    Scenario: The hidden deep-profile prose reads in each houseguest's voice
      Given two houseguests of clearly different archetypes
      When the engine composes each one's hidden secrets, true goals, and blind spot
      Then the two profiles read in distinguishable voices, not identical templated tails

  Rule: Two houseguests of the same archetype still differ

    Scenario: Same archetype does not collapse to one voice
      Given two houseguests of one archetype across a full cast
      Then their voice fingerprints differ on at least their free dials, signature, or lexicon
      And no two houseguests in the cast share an identical voice fingerprint

  Rule: Voice is identity — stable across the whole game

    Scenario: A houseguest's voice survives a save and restore unchanged
      Given a houseguest with a generated voice fingerprint
      When the game is saved and restored
      Then the houseguest's voice fingerprint is byte-identical

    Scenario: Voice does not drift as the soul evolves
      Given a houseguest whose soul changes over many beats
      Then their voice fingerprint stays byte-identical across those beats
      And only the observable delivery carriage moves with their mood

  Rule: Voice carries no hidden state (Vault-safe)

    Scenario: No secret state is encoded in or inferable from the voice
      Given a houseguest with sealed secrets and hidden relationship reads
      When the voice projection and any player-visible voiced prose are read
      Then they contain no sealed secret, no soul number, and no relationship value
      And the voice is generated only from public facets, never the hidden profile

    Scenario: A voiced confessional stays sealed from the player
      Given a confessor records a confessional voiced in their own voice
      Then the confessional is witnessed by the confessor alone and never reaches the player in play
      And only its phrasing changed, not its witness set or its hidden flag

  Rule: Voice changes phrasing, never facts; and is deterministic from seed

    Scenario: Voicing the same confessional two ways never changes the underlying truth
      Given a confessor with a fixed engine-grounded target and ally
      When the confessional is voiced under two different voice fingerprints
      Then both versions name the same target and the same ally
      And no closed-set value is moved by the change in phrasing

    Scenario: Same seed reproduces the same voices and voiced prose
      Given two casts generated from the same seed
      Then every houseguest's voice fingerprint matches across the two casts
      And their voiced confessional phrasing matches across the two casts

    Scenario: With the voice layer off, the seeded game is byte-identical
      Given the voice application is disabled
      Then the engine-authored prose falls back to its templated phrasing
      And the seeded competition and jury calibration is unchanged
