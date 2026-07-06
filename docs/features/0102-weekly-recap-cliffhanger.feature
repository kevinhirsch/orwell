# BUILT 2026-07-05 as the REDESIGNED daily recap (#884, PO ruling 2026-06-27) — the WEEKLY mechanic
# below was superseded before it shipped and was never wired into cucumber.cjs. The shipped daily
# analog fires at the player's own bedtime (`turnIn`) rather than the week-roll: same two Vault-free
# sources (witnessed ceremony/scene/deal events + already-surfaced gossip), same non-committal-hook
# rule, same reproducibility guarantee — scoped to the day that just closed instead of the week. The
# scenarios below are RETAINED for historical/design context (the mechanics they assert are the same
# ones the daily version honors) but describe the never-built week-roll trigger, not the shipped
# turnIn trigger. The executable gate for the shipped mechanic is the Vitest suite
# `tests/unit/dailyRecap0102.test.ts` (13 cases), not this file — it stays unwired from cucumber.cjs.
Feature: 0102 — Weekly recap + cliffhanger (each HOH-week is an episode) [SUPERSEDED DESIGN — see note above]
  When an HOH-week closes, the game stitches a short, Vault-safe digest of the week the player
  just lived — from their WITNESSED events plus gossip that has ALREADY surfaced to them — and
  ends it on a cliffhanger hook anchored to a thread already in motion. The recap is the record
  recalled, never narrator memory; it augments play and never replaces it. The Vault Wall holds
  for the player AND admin: nothing sealed, off-screen, or un-surfaced ever appears, and the
  cliffhanger never reveals a secret and never commits the engine to an outcome (the seed decides).

  # Role-only (testing rule): the-player, a houseguest, an ally, the HOH, a nominee, an evictee, the admin.

  Background:
    Given a started season with the player in the house
    And one full HOH-week has played out and the eviction has resolved

  Rule: A weekly recap is stitched only from witnessed and already-surfaced material

    Scenario: The recap retells the week the player actually lived
      When the week rolls over to the next HOH
      Then a weekly recap is assembled for the week that just closed
      And it includes the ceremonies the player witnessed and the scenes the player took part in
      And it is assembled from the recorded event store, not from prior chat text

    Scenario: An un-surfaced rumor never enters the recap
      Given a rumor about a houseguest that is still diffusing in the hidden layer and has not reached the player
      And a separate rumor that has already surfaced to the player through a pathway
      When the weekly recap is assembled
      Then the already-surfaced rumor may appear in the recap
      And the un-surfaced rumor never appears in the recap
      And no off-screen scene the player did not witness appears in the recap

  Rule: The Vault Wall holds for the player and for admin

    Scenario: The recap and its hook carry no sealed state
      Given a houseguest is sitting on a sealed secret the player has not learned
      When the weekly recap and its cliffhanger hook are assembled
      Then no sealed secret appears in the recap or the hook
      And no hidden relationship number appears anywhere in the recap
      And no reserve twist that has not fired is named

    Scenario: Admin cannot reach Vault data through the recap
      Given the admin requests the weekly recap surface
      Then the recap returns only the same Vault-free material the player would see
      And no admin or God-Mode path reaches Vault data through the recap

  Rule: The cliffhanger teases an in-motion thread but commits to no outcome

    Scenario: The hook foreshadows a thread the player can already perceive is brewing
      Given a deal the player is party to has come under visible strain this week
      When the weekly recap is assembled
      Then the cliffhanger hook foreshadows that in-motion thread as a possibility
      And the hook names nothing the player has not already witnessed or been told

    Scenario: The cliffhanger never asserts a future result
      When the weekly recap closes on its cliffhanger
      Then the hook does not state who wins the next Head of Household
      And the hook does not state who will be nominated or evicted next week
      And the hook does not state any future vote tally
      And the next week's outcomes are still decided by the seeded game

    Scenario: A quiet week with no in-motion thread closes without a fabricated hook
      Given the week that just closed left no thread in motion that the player can perceive
      When the weekly recap is assembled
      Then the recap closes cleanly with no cliffhanger hook
      And no hook is invented to manufacture suspense

  Rule: The recap augments play and is reproducible

    Scenario: The recap progresses no game state
      When the weekly recap is delivered at the week-roll
      Then the game's week, phase, and ceremony state are unchanged by it
      And the player makes no binding decision inside the recap
      And play resumes in the new week unchanged whether or not the recap was shown

    Scenario: The same recorded history reproduces the same recap
      Given the season is re-entered in a fresh context after a restore
      When the weekly recap for that same week is assembled again with the same seed
      Then the recap body is identical to the first assembly
      And the cliffhanger hook choice is identical
