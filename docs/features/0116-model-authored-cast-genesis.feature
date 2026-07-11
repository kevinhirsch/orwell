# spec-only: this .feature is a design contract, NOT wired into the BDD gate (absent from cucumber.cjs paths; no step definitions). Its behavior is verified elsewhere — see the per-feature status index in docs/features/README.md. (TEST-3, #628)
# Feature 0116 — Model-authored cast genesis inside an engine validation envelope. SPEC — drafted
# failing-first 2026-07-11; the seven genesis design questions are OWNER-DECIDED (cast-sketch + 15
# deep calls; player-blind; banded variable stat totals; free names inside validators; the seeded
# season brief; async pre-warm with a loud pre-finalize gate; skeletons + tie graph in scope).
# Phase 2 of the casting upgrade: the model proposes the ENTIRE 15-NPC skeleton — names, freeform
# identities (archetype DERIVED, not a generative constraint), personas, hidden elements, the
# pre-show tie graph, orientation fields, voices, point-buy stats — and the engine validates,
# clamps, and commits inside an envelope it owns. Generalizes ADR 0005 to world-gen: identity is
# open-set (recorded faithfully); power is closed-set (engine-dictated).
# HARD rule: roles only — no names. Roles used: the-player, an NPC, a houseguest, the admin,
# the operator, a comp beast, a floater.

Feature: Model-authored cast genesis — the model proposes the cast, the engine owns the envelope

  At game start the narration model emits a full 15-NPC cast proposal (one cast-level sketch call,
  then the phase-1 per-NPC deep pass), steered by a SEEDED season brief and carrying ZERO knowledge
  of the player. The engine validates the proposal against an envelope it owns — banded variable
  stat totals with a cast-wide variance floor, name validators instead of name pools, the closed
  hidden-element kinds, tie-graph sanity, the 0063 diversity pipeline — clamps what can be clamped,
  re-rolls what cannot (bounded), seals the hidden half into the Vault, and commits. No model
  number escapes the clamp. Under the strict enrichment policy an exhausted genesis fails LOUD
  before casting finalize — never a silent deterministic floor. Where no model is wired, the
  deterministic factory stands byte-identically: the test floor is unchanged.

  Background:
    Given a fresh game sandbox awaiting its cast
    And a genesis-capable model is wired unless a scenario says otherwise

  Rule: The model proposes; the engine validates, clamps, and commits

    Scenario: A valid full-cast proposal commits inside the envelope
      Given a cast proposal of exactly fifteen NPCs that satisfies every envelope validator
      When the engine validates and commits the proposal
      Then the committed cast carries the proposed names, identities, personas, and voices
      And the committed cast is byte-stable from the moment of commit
      And the archetype tag on each NPC is a member of the canonical archetype enum

    Scenario: The freeform identity is preserved verbatim beside the derived archetype tag
      Given a proposed NPC whose freeform identity matches no single canonical archetype cleanly
      When the engine commits the proposal
      Then the NPC's freeform identity is stored byte-equal to the proposal
      And the derived archetype tag rides alongside it as a mechanical coupling key only
      And player-facing narration voices the freeform identity, never the bare tag

  Rule: Stats are point-buy — banded variable totals; no model number escapes the clamp

    Scenario: An over-budget stat total is clamped and renormalized inside the band
      Given a proposed NPC whose stat total exceeds the engine's total band
      When the engine validates the proposal
      Then the committed stat total lands inside the engine-owned band
      And the committed distribution preserves the proposal's relative shape
      And no raw proposed number is committed unclamped

    Scenario: Real comp beasts and real floaters both exist inside the band
      Given a proposal with one NPC at the top of the total band and one at the bottom
      When the engine validates the proposal
      Then both NPCs commit without repair
      # Banded VARIABLE totals: the band admits genuinely strong and genuinely weak houseguests.

    Scenario: A flat cast fails the cast-wide variance floor
      Given a proposal whose fifteen NPCs carry near-identical stat totals and shapes
      When the engine validates the proposal
      Then the proposal fails the cast-wide variance validator
      And a re-roll is requested with the violation named

  Rule: Names are validated, never pooled

    Scenario: A duplicate name is refused with a structured violation
      Given a proposal in which two NPCs share a given name or a surname
      When the engine validates the proposal
      Then the offending NPC is re-rolled and the violation names the colliding field

    Scenario: A legacy-Bible name is refused on the genesis path
      Given a proposal containing a name from the legacy deny-list
      When the engine validates the proposal
      Then the proposal is refused for that NPC
      And the deny-list gate holds on the genesis path exactly as it holds on the floor

    Scenario: A name colliding with the player is refused
      Given a proposal containing an NPC whose name collides with the player's name
      When the engine validates the proposal
      Then the offending NPC is re-rolled

  Rule: Genesis is player-blind; the season brief is seeded

    Scenario: The genesis prompts carry zero knowledge of the player
      Given the player has answered casting-interview questions
      When the cast-sketch and deep-authoring prompts are assembled
      Then no player field appears in any genesis prompt
      # Sycophancy-proof by construction: a cast cannot be bent toward a player it never saw.

    Scenario: An accidental near-duplicate of the player is nudged post-hoc
      Given a committed-candidate NPC who by chance mirrors the player's vocation and hometown
      When the post-hoc near-duplicate validator runs
      Then the colliding facet of that NPC is re-rolled
      And the rest of the NPC's identity is preserved

    Scenario: The same seed yields the same season brief
      Given two fresh sandboxes created with the same seed
      When each engine derives its seeded season brief
      Then the two briefs are byte-equal
      And the brief derives from the seed alone, independent of the player

    Scenario: The brief steers but never binds
      Given a proposal that ignores the season brief but satisfies every envelope validator
      When the engine validates the proposal
      Then the proposal commits
      # The brief is creative steering (open set); only the engine's caps, floors, and bands bind.

  Rule: Hidden material routes to the Vault; the tie graph is validated for sanity

    Scenario: Committed hidden elements and tie backstories reach no outward surface
      Given a committed cast whose proposal carried hidden elements, tie backstories, and a private orientation
      When the player and admin projections are assembled
      Then no hidden element detail appears on any surface
      And no tie backstory or private orientation appears on any surface
      And no Vault sentinel value appears

    Scenario: A hidden-element kind outside the closed set is refused
      Given a proposed hidden element whose kind is not a canonical hidden-element kind
      When the engine validates the proposal
      Then the element is refused and the violation names the field
      # The KINDS are mechanical couplings (closed set); only the DETAILS are open-set prose.

    Scenario: An oversized tie graph is repaired to the sparseness budget
      Given a proposal carrying more pre-show ties than the seeded-relationship budget allows
      When the engine validates the proposal
      Then the committed tie graph holds at most the budgeted ties
      And every committed tie seals with sealed exposure
      And the tie's standing affinity fold magnitude is the engine's own constant

    Scenario: A tie graph naming the player or doubling a houseguest is refused
      Given a proposal with a tie involving the player and a houseguest carrying two ties
      When the engine validates the proposal
      Then both violations are named and the tie-graph slice is re-rolled

  Rule: Hidden game weights are never proposable

    Scenario: A proposal attempting to set a hidden game weight is ignored and flagged
      Given a proposal that includes influence values, a trigger volatility, and a day-one read of the player
      When the engine validates the proposal
      Then those fields are ignored and flagged, never committed
      And the engine seeds every hidden weight off the committed cast exactly as today

  Rule: Invalid proposals re-roll bounded, then fail LOUD before finalize under the strict policy

    Scenario: A per-NPC violation re-rolls only that NPC
      Given a proposal in which one NPC fails a validator and fourteen pass
      When the engine requests a re-roll
      Then only the failing NPC is re-proposed
      And the violation set is echoed to the model with the re-roll

    Scenario: Genesis failure surfaces before casting finalize, never after
      Given genesis has exhausted its re-roll budget under the strict enrichment policy
      When the player attempts to finalize casting
      Then the finalize is held with a visible refusal naming the last violation set
      And the game does not start on the deterministic floor
      And the operator-facing hold surface shows why
      # LOUD, and BEFORE the player commits their character — never a silent floor, never a
      # post-finalize surprise.

  Rule: The test floor is unchanged; the committed genesis is the recorded world-gen artifact

    Scenario: With no model wired the deterministic factory stands byte-identically
      Given a sandbox with no genesis-capable model wired
      When the cast is generated
      Then the cast is byte-identical to the deterministic factory's output for that seed
      # Stubbed lanes, keyless CI, calibration sims, and golden replay ride this floor untouched.

    Scenario: A reload reads the committed genesis from the store, never the model
      Given a committed model-authored cast persisted to the save
      When the engine restarts and the game resumes
      Then the cast (season brief included) is read from the store byte-equal
      And no genesis call is made on resume
      And a later write that thins the committed cast is refused by the superset gate
