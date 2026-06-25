Feature: 0089 — Reactive confessionals (the Diary Room remembers what just happened)
  A houseguest's private confessional REACTS to a concrete, recent event they witnessed or
  were part of — "after the veto ceremony, when they left me on the block…" — instead of a
  static target/ally readout. The ENGINE selects the recent events from the recorded event
  log (restricted to that houseguest's own witness set) and supplies them as facts; the model
  only VOICES the reaction and never invents an outcome. The confessional stays Vault-only NPC
  content (witnessed by the confessor alone) and leaks no other hidden state.

  # Role-only (testing rule): the-confessor, an NPC, the-player, a nominee, an ally, a juror.

  Background:
    Given a started season with recorded events in the house

  Rule: A confessional reacts to a real recent event the confessor witnessed

    Scenario: The confessional references the concrete beat that just happened to them
      Given a houseguest who was just left on the block at the veto ceremony
      When that houseguest gives their confessional
      Then the confessional references that recent veto-ceremony event
      And it still names their engine-grounded biggest threat and most-trusted ally
      And the recent event it reacts to comes from that houseguest's own witnessed events

    Scenario: With no qualifying recent event the confessional degrades to the grounded read
      Given a houseguest with no salient recent event in the recency window
      When that houseguest gives their confessional
      Then the confessional falls back to the standing target-and-ally read
      And no recent event is fabricated

  Rule: The engine supplies the facts; the model only voices them

    Scenario: The events reacted to are selected by the engine, not invented by the model
      Given a houseguest with several recent witnessed events
      When the engine builds that houseguest's confessional context
      Then the recent events in the context are drawn from the recorded event store
      And every selected event is one whose witness set includes that houseguest
      And no event outside that houseguest's witness set is selected

    Scenario: A confessional never asserts a fabricated outcome
      Given a houseguest reacting to a recent competition they played
      When that houseguest gives their confessional
      Then the confessional reacts to the recorded result only
      And it states no competition result, vote tally, or nomination the engine did not produce

  Rule: A reactive confessional stays Vault-only and leaks no other hidden state

    Scenario: The reactive confessional reaches no one
      Given a houseguest gives a confessional reacting to a recent beat
      Then the confessional is recorded witnessed by that houseguest alone and hidden
      And it never appears on any player-facing surface
      And it never appears on the admin or God-Mode surface

    Scenario: The reaction carries no other houseguest's sealed state and no number
      Given a houseguest whose confessional reacts to a scene they were part of
      When the confessional content and its context are assembled
      Then the assembled content contains no other houseguest's hidden read
      And it contains no hidden number

  Rule: Reactive confessionals deepen the house's memory deterministically

    Scenario: The same history yields the same reaction and deepens the soul
      Given two runs of the same season from the same seed and the same recorded history
      When a houseguest gives their confessional in each run
      Then both runs produce the same confessional reacting to the same recent event
      And the confessional appends to that houseguest's soul without losing earlier ones
