Feature: 0113 — Visual regression harness (screenshot matrix + off-screen detector + baselines)
  No existing gate looks at a rendered pixel. `responsive_matrix.py` checks measured layout
  invariants (overflow, overlap, tap targets) over a curated surface registry; nothing checks
  whether an element renders entirely off-viewport, is silently clipped by an ancestor's
  overflow:hidden, is zero-size, or has something unrelated painted over it — and nothing catches
  pure visual drift (a color-token edit, a theme palette regression) at all. This harness adds
  both: a geometry/off-screen detector (BLOCKING) and a pixel diff against blessed baselines
  (ADVISORY), over a deliberately sparse matrix of surfaces x viewports x themes x game state. The
  state source is the 0108 golden-replay drive — a real engine + real front-end walk, replayed
  key-free and byte-deterministically from a committed fixture — never an injected synthetic
  state.

  # HARD: roles only, no cast names. Every shot's CONTENT is whatever the seeded CharacterFactory
  # produced for that golden-path run — never asserted on, never canonical.

  Background:
    Given a committed golden-path transcript fixture (the same one 0108's replay gate uses)
    And a curated registry of surface selectors probed on every shot
    And a blessed-baselines directory of committed PNGs plus a manifest keyed by shot id

  # ── The geometry/off-screen detector (blocking) ─────────────────────────────────

  Scenario: an element rendering entirely outside the viewport is a finding
    Given a registered element whose bounding rect lies wholly outside the current viewport
    When the geometry detector runs its DOM pass for a shot
    Then the element is reported as an "off-viewport" finding
    And the finding blocks the harness's exit code

  Scenario: a partially offscreen element is not a false positive
    Given a registered element whose bounding rect only partially crosses the viewport edge
    When the geometry detector runs its DOM pass for a shot
    Then the element produces no off-viewport finding

  Scenario: content silently clipped by an ancestor's overflow:hidden is a finding
    Given a registered element whose box escapes a real overflow:hidden ancestor's box
    When the geometry detector runs its DOM pass for a shot
    Then the element is reported as a "clipped-by-ancestor" finding naming that ancestor

  Scenario: an element fully inside its clipping ancestor is not a false positive
    Given a registered element whose box lies entirely inside an overflow:hidden ancestor's box
    When the geometry detector runs its DOM pass for a shot
    Then the element produces no clipped-by-ancestor finding

  Scenario: a rendered but zero-size element is a finding
    Given a registered element with zero width or zero height
    When the geometry detector runs its DOM pass for a shot
    Then the element is reported as a "zero-size" finding
    And no off-viewport, clipped-by-ancestor, or covered finding is also reported for it

  Scenario: an element covered by something unrelated is a finding
    Given a registered element whose own visual center is topped by an unrelated element
    When the geometry detector's elementFromPoint probe runs for a shot
    Then the element is reported as a "covered" finding naming the covering element

  Scenario: an element covered only by its own descendant is not a false positive
    Given a registered element whose own visual center resolves to one of its own children
    When the geometry detector's elementFromPoint probe runs for a shot
    Then the element produces no covered finding

  Scenario: any geometry finding fails the CI job regardless of the pixel-diff outcome
    Given a shot with at least one geometry finding not registered in the XFAIL ratchet
    And every pixel diff for the same run reports a clean match
    When the harness computes its exit code
    Then the exit code is non-zero
    And the job is wired as a required, blocking check

  Scenario: a known, filed finding is demoted to xfail until its fix lands
    Given a geometry finding whose formatted line matches a registered XFAIL entry
    When the harness computes its exit code
    Then that finding reports as xfail with its finding id and does not block
    And removing the registry entry when the fix lands flips it back to a hard failure
    And an entry that matched nothing this run prints an xpass removal nudge

  Scenario: a covering element inside a deliberate overlay layer is not a finding
    Given a registered element whose center probe resolves inside a declared overlay layer
    When the geometry detector classifies the shot
    Then no covered finding is reported for that element
    And a covering element outside every declared overlay layer still reports as covered

  # ── The screenshot matrix (sparse — axes kept, not fully crossed) ──────────────────

  Scenario: Tier A parks at one canonical mid-week state and sweeps viewport x theme
    Given the golden-replay walk reaches the nominations phase
    When Tier A captures its five midweek surfaces
    Then it captures chat, status panel, gadget rail, decision card, and settings
    And each is captured at every one of 4 viewports and every one of 5 house themes
    And no additional engine turn runs between two shots of the same parked state
    And the theme swap is applied via a fresh page load with a seeded theme preference only

  Scenario: Tier A's casting surface is captured at its own natural walk moment
    Given the golden-replay walk is mid-way through the casting interview
    When Tier A captures the casting surface
    Then it is captured at every one of 4 viewports and every one of 5 house themes
    And this capture happens before the season has started

  Scenario: Tier B captures a beat the first time its condition is observed
    Given the golden-replay walk is in progress
    When the engine phase first becomes one of nominations, veto-competition, veto-ceremony,
      eviction, or finale
    Then the corresponding Tier B beat is captured at 390x844 and at 1440x900
    And the same beat is never captured a second time later in the walk

  Scenario: a beat the current fixture never reaches is reported skipped, never fabricated
    Given the committed golden fixture's walk does not reach a finale phase
    When Tier B finishes its walk
    Then the finale beat is reported with status "skipped" and a human-readable reason
    And no screenshot file is written for that beat

  # ── Pixel diff (advisory) ──────────────────────────────────────────────────────────

  Scenario: a shot matching its blessed baseline reports a clean match
    Given a shot id with a blessed baseline of identical pixels
    When the pixel-diff step compares the candidate against the baseline
    Then the result status is "match"
    And the run's exit code is unaffected by this result

  Scenario: a shot differing from its blessed baseline is reported but does not block
    Given a shot id with a blessed baseline whose pixels differ beyond the channel threshold
    When the pixel-diff step compares the candidate against the baseline
    Then the result status is "diff"
    And a before/after/diff triptych image is written for the PR to inspect
    And the run's exit code is unaffected by this result

  Scenario: a masked region cannot manufacture a false diff
    Given a shot containing a known time-varying element such as a wall-clock readout
    And that region is registered as a mask for the shot's id
    When the pixel-diff step compares the candidate against the baseline
    Then the masked region is blanked out in both images before comparison
    And a pixel difference confined to the masked region does not appear in the diff result

  Scenario: a shot with no blessed baseline is skipped with an explicit notice
    Given a shot id that does not appear in the baseline manifest
    When the pixel-diff step runs for that shot
    Then the result status is "baseline-missing"
    And the report carries a human-readable notice that no comparison was made
    And this is never reported as a silent pass

  # ── The bless workflow ──────────────────────────────────────────────────────────────

  Scenario: blessing a run directory stamps new baselines and a manifest
    Given a harness run directory containing shot PNGs and their per-shot metadata
    When the bless script is pointed at that run directory
    Then every shot PNG is copied into the baselines directory
    And the manifest records each shot id's sha256, dimensions, and provenance
    And re-blessing byte-identical content changes no pixel, only provenance

  Scenario: blessing from a non-CI-artifact source prints a policy reminder, not a refusal
    Given a run directory whose --source does not look like a CI artifact stamp
    When the bless script is invoked
    Then it prints a reminder that baselines should be blessed from CI artifacts, not local renders
    And it still completes the bless (the policy is process, not an enforced code refusal)

  # ── Determinism ──────────────────────────────────────────────────────────────────────

  Scenario: every context is captured at a fixed device scale factor and reduced motion
    Given any Tier A or Tier B screenshot context
    When the harness creates that browser context
    Then its device scale factor is fixed across the whole run
    And prefers-reduced-motion is forced for that context

  Scenario: replaying the same golden fixture never reaches a real model provider
    Given the harness drives its walk in golden-replay mode
    When every model call the front-end makes during the walk resolves
    Then it resolves from the committed fixture by a stable request key
    And no outbound call is made to a model provider

  # ── CI wiring ────────────────────────────────────────────────────────────────────────

  Scenario: the job is dormant with an explicit notice when no golden fixture is committed
    Given no golden_path_*.jsonl fixture exists under frontend/tests/golden/
    When the visual-regression CI job runs
    Then it emits an explicit notice that the job is dormant
    And it does not silently report a pass with zero shots taken

  Scenario: an empty baseline set is a legitimate first run, not a failure
    Given a committed golden fixture but an empty or absent baselines manifest
    When the visual-regression CI job runs
    Then geometry detection still runs and can still block the job
    And every shot's pixel comparison reports baseline-missing, advisory only
