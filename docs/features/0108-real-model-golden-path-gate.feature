Feature: 0108 — Real-model golden-path gate (record-once / replay-in-CI)
  Every automated gate stubs the LLM, so the whole class of bugs in the model↔engine seam — tool
  under-calls, narration desyncs, cast-authoring truncation, an inert desync guard — ships green and
  only surfaces when a human drives a real model. This gate captures ONE real run of the golden path
  (casting → premiere → Week 1 HOH → noms → veto → eviction → week roll) as a deterministic transcript
  fixture, then replays it against the REAL engine and REAL front-end on every PR — no API key, fully
  deterministic — so the seam regresses loudly. A nightly real-model smoke re-records the fixture and
  catches prompt drift. The engine is exercised, never modified; the wrap lives at the front-end's
  single model chokepoint. The fixture is Vault-free by construction.

  # HARD: roles only, no names. The fixture's content is FORMAT ONLY — assertions key on roles and
  # structure (a nominee was named, a ballot was tallied, a phase advanced), never on generated names.

  Background:
    Given a committed golden-path transcript fixture recorded once against the real narrator model
    And the recorder wrapped the front-end's single model chokepoint, keying each request to its response
    And the fixture carries only the front-end's Vault-free request projections and the model's reply

  # ── The record / replay contract ────────────────────────────────────────────────

  Scenario: the replay drives the real engine and front-end with no API key
    Given replay mode is enabled with the committed fixture
    And no model endpoint is configured and no provider key is present
    When the golden-path driver walks casting through the first week
    Then every model call is resolved from the fixture by a stable request key
    And no outbound call is made to the provider
    And the run is deterministic — replaying twice produces identical driver output

  Scenario: a drifted request is a hard failure, never a silent pass
    Given replay mode is enabled with the committed fixture
    When a request reaches the chokepoint whose key is absent from the fixture
    Then the replay raises and the gate fails with a regenerate-the-fixture message
    And the miss is never papered over with a fallback response

  Scenario: the chokepoint is byte-identical when neither record nor replay is enabled
    Given neither record mode nor replay mode is enabled
    When the front-end calls the model chokepoint
    Then the request and the streamed response are byte-identical to today
    And the wrap is a near-zero passthrough

  # ── The golden-path invariants (one per the design note) ─────────────────────────

  Scenario: casting finalizes and the season starts
    Given replay mode is enabled with the committed fixture
    When the casting interview is driven to the player's readiness signal
    Then casting finalizes and the season starts
    And the finalize fallback is exercised when the model under-calls the finalize tool

  Scenario: the producers' opener fires without a player prompt
    Given casting has just finalized under replay
    When the first game-master turn is produced
    Then the producers' opener is emitted with no player message driving it

  Scenario: the post-photo resume fires without a manual continue
    Given the casting headshot beat has just completed under replay
    When the next turn is produced
    Then narration resumes on its own with no player "continue" required

  Scenario: cast authoring lands deep profiles for nearly the whole house
    Given the background cast-authoring write-back ran under replay
    Then at least thirteen of the fifteen houseguests are authored as deep profiles
    And the mass-fallback-to-floor signature is absent — no whole call class truncated with an empty body

  Scenario: the game advances through every beat with no stuck phase
    Given replay mode is enabled with the committed fixture
    When the week is driven from the head-of-household competition through eviction
    Then the engine phase and beat sequence advance monotonically through nominations, veto, the veto ceremony, and eviction
    And no phase repeats unboundedly — the advance under-call belts hold

  Scenario: the eviction reveal is batched and never runs ahead of the engine
    Given the eviction is driven under replay
    Then the staged reveal plays in roughly four to eight batched rounds
    And no player-facing turn narrates a tally or a result the engine has not committed
    And the pre-emission outcome guard holds — no stale-beat self-trip and no premature result text

  Scenario: every player-facing turn is clean
    Given the full golden path is replayed
    When every player-facing body across the run is inspected
    Then none contains Vault data
    And none contains a raw npc identifier, an operator aside, or a reasoning token
    And reasoning appears only in the thinking channel, never the public bubble

  Scenario: the week rolls into the next head-of-household reign
    Given the eviction has resolved under replay
    When the loop continues
    Then the next head-of-household week begins immediately per the standard cadence
    And the jury and board state are consistent and the beat sequence has continued to advance

  # ── Vault wall + CI wiring ────────────────────────────────────────────────────────

  Scenario: the fixture is Vault-free
    Given the committed golden-path fixture
    When its serialized contents are scanned
    Then it contains no soul, trust, threat, affinity, hidden-target, grudge, scheme, or confessional key
    And it contains no provider authorization or api-key material
    And no player-facing body field carries a raw npc identifier or a reasoning leak

  Scenario: the replay gate is part of the one required check
    Given the continuous-integration job graph
    Then the deterministic replay job is wired into the unified required-check aggregator
    And it is path-gated to run when the front-end, the engine, the fixture, or the workflow changes
    And it needs no provider key and must not flake

  Scenario: the nightly real-model smoke re-records and surfaces drift, never blocking
    Given the scheduled nightly job and a configured provider key
    When it stands up the real engine, front-end, and model and re-records the fixture
    Then it asserts the same golden-path invariants against the live run
    And it uploads the freshly recorded fixture and diffs the invariant results against the committed replay
    And it is allowed to flake and never blocks a merge
    And when no provider key is present the nightly is a clean skip, not a failure
