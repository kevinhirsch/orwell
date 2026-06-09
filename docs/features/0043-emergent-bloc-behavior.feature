# DRAFT executable spec — author: feature-maker; implementer makes it pass.
# Feature 0043 — Emergent multi-party bloc behavior: blocs DERIVED from the relationship graph at decision
# time (never stored — decision 0002), driving coordinated targeting/voting and fracture on betrayal.
# HARD rule: roles only (houseguest, HOH, nominee, bloc-mate). Add to cucumber.cjs when green.

Feature: Emergent multi-party bloc behavior

  Houseguests form blocs that vote together, shield each other, and target a shared enemy — but the bloc is
  an emergent read of the relationship graph, computed every time and stored never. A betrayal that drops a
  bond fractures the bloc on the next read. The player infers alliances from behavior, never a roster.

  Scenario: Blocs emerge from mutual bonds without being stored
    Given several houseguests with strong mutual bonds
    When blocs are detected from the relationship graph
    Then they are grouped into a bloc
    And no alliance or ally/enemy label is stored anywhere

  Scenario: A bloc has a derived shared target
    Given a detected bloc
    Then it carries a shared target derived from the members' aggregate threat

  Scenario: Bloc-mates coordinate more than chance
    Given a bloc within the house
    When nominations and eviction votes resolve
    Then bloc-mates shield each other from nomination and vote together
    And they lean toward targeting their shared enemy

  Scenario: A betrayal fractures the bloc
    Given a bloc of houseguests
    When one member betrays another and their bond drops
    Then the next bloc detection yields a smaller or split bloc
    And nothing about the old bloc was stored to update

  Scenario: No bloc or label is ever persisted
    Given a game in which blocs have formed
    When the soul/save is serialized
    Then it contains no bloc membership and no ally/enemy label

  Scenario: Blocs are Vault-free and deterministic
    Given a started game in which blocs have formed
    When any player surface is read
    Then no bloc roster or hidden state appears
    And the same relationship graph and seed yield the same blocs
