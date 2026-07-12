# Executable spec — Feature 0121 (PO expansion of the 0039 review), Part 1: the ACTIVE-obligation deal
# kinds. Seeded engine only, roles only (promisor, protected party, other). The engine — never the
# narrator — decides kept/broken from the structured action.

Feature: Active-obligation deal kinds

  Beyond "don't move against me", a houseguest can promise to DO something for you — throw a competition,
  or use the veto to save you. These are active promises: a break is a failure to act, and the engine
  decides it from what actually happened, reusing the full betrayal fallout. They exist only when the
  deal-depth layer is on (off ⇒ they can't be made, and everything is byte-identical).

  Scenario: A comp-throw is kept when the promisor throws, broken when they win
    Given a comp-throw promise to throw a competition
    When the promisor throws that competition
    Then the promise is kept
    When another promisor wins the competition they swore to throw
    Then that promise is broken and the wronged party holds the grudge

  Scenario: A veto-save is kept when the promisee is pulled off the block
    Given a veto-save promise to use the veto to save a houseguest
    When the veto-holder pulls the promised houseguest off the block
    Then the promise is kept

  Scenario: A veto-save is broken when the promisee is left on the block
    Given a veto-save promise to use the veto to save a houseguest
    When the veto-holder leaves the promised houseguest nominated
    Then that promise is broken and the wronged party holds the grudge

  Scenario: A veto-save carries no duty when the promisee was never nominated
    Given a veto-save promise to use the veto to save a houseguest
    When the veto is used while the promised houseguest is not on the block
    Then the promise is still open with nothing owed

  Scenario: The active kinds are engine-decided, never inferred from prose
    Given two comp-throw promises with very different wording
    When both promisors win the competition they swore to throw
    Then both promises break identically

  Scenario: The active kinds exist only when the deal-depth layer is on
    Given a live game with the deal-depth layer off
    When the player tries to make a comp-throw promise
    Then the promise is refused
