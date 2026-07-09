Feature: 0114 — Theme surface consistency (computed-style probe + XFAIL ratchet)
  A surface is correct iff its rendered background derives from the ACTIVE theme's own --bg or
  --panel token; it is wrong iff it renders a color far from both — stuck at a foreign polarity
  (e.g. a hardcoded background:#1d2026 instead of var(--panel, #1d2026)). This is NOT "light
  theme implies white" — there are ~25 themes including tinted house themes and the neutral
  glass theme, and the classifier reads the ACTIVE theme's own resolved tokens at capture time,
  never a hardcoded expectation of what a theme "should" look like. The state source is the
  SAME 0108 golden-replay drive 0113 rides, composed via 0113's own walker — never an injected
  synthetic state.

  # HARD: roles only, no cast names. Every shot's CONTENT is whatever the seeded CharacterFactory
  # produced for that golden-path run — never asserted on, never canonical.

  Background:
    Given a committed golden-path transcript fixture (the same one 0113/0108's replay gate uses)
    And a curated registry of game-build surface selectors probed on every shot
    And the active theme's own computed --bg and --panel tokens read at capture time

  # ── The classifier (blocking) ────────────────────────────────────────────────────────

  Scenario: a surface whose background matches the active theme's panel token is clean
    Given a registered surface whose composited background equals the active theme's --panel
    When the theme-consistency probe classifies the shot
    Then the surface produces no finding

  Scenario: a surface whose background matches the active theme's bg token is clean
    Given a registered surface whose composited background equals the active theme's --bg
    When the theme-consistency probe classifies the shot
    Then the surface produces no finding

  Scenario: a surface that inherits its ancestor's paint is clean
    Given a registered surface that declares no background of its own anywhere up its bounded
      ancestor chain
    When the theme-consistency probe classifies the shot
    Then the surface produces no finding

  Scenario: a subtle tint over either token is not a false positive
    Given a registered surface whose own background is a low-alpha wash composited over the
      active theme's panel or bg
    When the theme-consistency probe classifies the shot
    Then the surface produces no finding

  Scenario: a surface hardcoding a color far from both tokens is a finding
    Given a registered surface whose composited background is far from both the active theme's
      --bg and --panel
    When the theme-consistency probe classifies the shot
    Then the surface is reported as a "foreign-polarity" finding
    And the finding blocks the harness's exit code

  Scenario: the same hardcoded color is not flagged on a theme it happens to resemble
    Given a registered surface with a fixed hardcoded background color
    And that color is close to one theme's own panel token but far from another theme's tokens
    When the theme-consistency probe classifies the shot under EACH theme separately
    Then the finding is reported only for the theme whose tokens the color is far from

  Scenario: a known, filed finding is demoted to xfail until its fix lands
    Given a theme finding whose formatted line matches a registered XFAIL entry
    When the harness computes its exit code
    Then that finding reports as xfail with its finding id and does not block
    And removing the registry entry when the fix lands flips it back to a hard failure
    And an entry that matched nothing this run prints an xpass removal nudge

  Scenario: an XFAIL entry is scoped to a live-form shot id, never the encoded filename form
    Given an XFAIL registry entry whose shot scope uses the live colon-delimited shot-id form
    When the harness matches it against a finding on that exact shot
    Then the finding is demoted to xfail
    But the same entry written in the on-disk double-underscore filename form matches nothing

  # ── The sweep (both base themes, real walked state) ─────────────────────────────────

  Scenario: the sweep covers both base themes at the canonical midweek state
    Given the golden-replay walk reaches the nominations phase
    When the theme sweep runs
    Then it probes the registered surfaces under the light theme and under the dark theme
    And each theme is probed at 390x844 and at 1440x900
    And no additional engine turn runs between two shots of the same parked state

  Scenario: harness setup errors block the exit code
    Given a capture or setup failure recorded during the sweep
    And zero theme findings were produced
    When the harness computes its exit code
    Then the exit code is non-zero — a wedged run must never pass as if the checks ran

  # ── CI wiring ────────────────────────────────────────────────────────────────────────

  Scenario: the job is dormant with an explicit notice when no golden fixture is committed
    Given no golden_path_*.jsonl fixture exists under frontend/tests/golden/
    When the theme-consistency CI job runs
    Then it emits an explicit notice that the job is dormant
    And it does not silently report a pass with zero shots taken
