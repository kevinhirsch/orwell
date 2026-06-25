Feature: 0091 — Trigger secrets fire house events (the foreseeable blow-up)
  A houseguest's volatile, sealed trigger attribute (a buried temper, a grudge they smile
  through, a desperate streak) stays inert until accumulated stress meets a fresh spark and a
  temperature roll — then it FIRES, emitting an emergent, Vault-safe public house event the
  player witnesses: a screaming match, a showmance detonating, a mask slipping. The engine owns
  whether, which, and how big; the model only voices the public eruption. The Vault Wall holds:
  the player learns the ERUPTION, never the TRIGGER. It is a surprise the player could have
  foreseen from the houseguest's observed, rattled behavior — never a cold pop-up, never a
  number, and never a perturbation of any seeded competition, vote, or jury outcome.

  # Role-only (testing rule): the-player, a houseguest, a volatile houseguest, a calm houseguest,
  # a witness, the house.

  Background:
    Given a started season with the player in the house

  Rule: A trigger fires only under earned stress, never from a quiet stretch

    Scenario: A volatile houseguest under stress detonates when a spark lands
      Given a houseguest carrying a volatile sealed trigger attribute
      And the season has left that houseguest's soul strained and wound tight
      When a fresh precipitating scene sparks them in a beat the player witnesses
      Then their trigger fires as a public house event the player witnesses
      And the public house event names no sealed trigger wording
      And no number is ever shown to the player

    Scenario: A calm houseguest with the same trigger does not fire
      Given a houseguest carrying the same volatile sealed trigger attribute
      And that houseguest's soul is calm and near baseline
      When the same precipitating scene occurs
      Then no trigger fires
      And the house carries on with no eruption

    Scenario: No cold open — a trigger never fires out of a quiet stretch
      Given a strained volatile houseguest whose trigger would otherwise be primed
      And no precipitating scene occurs this tick
      Then no trigger fires
      And no off-screen process starts an eruption on its own

  Rule: The Vault Wall holds — the eruption is witnessed, the trigger never leaks

    Scenario: The sealed trigger attribute never reaches the player
      Given a houseguest whose volatile trigger has fired in a public house event
      When the player reviews everything they know and every player-facing surface
      Then the witnessed eruption is the player's recorded knowledge
      And the sealed trigger attribute that caused it never appears on any surface
      And the model is never handed the sealed trigger wording

  Rule: Foreseeable in hindsight — a paid-off plant, not a deus ex machina

    Scenario: An eruption is anchored to behavior the player could already observe
      Given a volatile houseguest the player has watched grow visibly rattled over a bad stretch
      When that houseguest's trigger finally fires in a public scene
      Then the eruption reads as prompted by the strain the player could see building
      And the player could have foreseen it from the houseguest's observed behavior

  Rule: Engine-owned, seeded, and calibration-neutral

    Scenario: The same seed and history produce the same eruption
      Given a season seed and a fixed history that fires a trigger
      When the season is replayed from the same seed and history
      Then the same trigger fires at the same moment with the same eruption kind

    Scenario: Triggers never perturb a seeded competition, vote, or jury outcome
      Given a full season is played with the trigger mechanism disabled
      And the same season is played with the trigger mechanism enabled
      Then every seeded competition, vote, and jury outcome is byte-identical across the two runs
      And eruptions never exceed the season cap
