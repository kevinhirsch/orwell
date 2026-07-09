# 0114 — Theme surface consistency (computed-style probe + XFAIL ratchet)

> Companion: `0114-theme-surface-consistency.feature`. Builds on **0113** (the Playwright +
> `GoldenDriver` replay scaffolding this harness rides — same state source, same XFAIL-ratchet
> pattern, same "never a silent pass" discipline) and the **0052** house-theme system (the
> token set this gate audits). Owner-reported bug (2026-07-09): surfaces render the WRONG
> polarity per theme — on the `light` theme some windows/gadgets/sidebars stay dark; on `dark`
> some surfaces are mixed.

## Why

`theme.js`'s `applyColors` is the ONE place that sets the theme tokens every surface is supposed
to read: `--bg`, `--fg`, `--panel`, `--border`, `--red`, `--on-accent` (plus derived syntax/
advanced tokens). The correct surface pattern is already in wide use —
`.gadget-rail .ow-window { background: var(--panel, #1d2026); }` — token first, a sensible
fallback second (the fallback only ever paints if the token is literally unset, never as a
competing polarity). The bug class this gate catches: a surface hardcodes a color instead
(`background:#1d2026`), so it happens to look right on whichever theme that hardcoded color was
authored against and stays WRONG — stuck at a foreign polarity — on every other theme.

No existing gate looks at this. `responsive_matrix.py` checks overflow/overlap/tap-targets;
0113's geometry detector checks off-viewport/clipped/zero-size/covered; 0113's pixel diff is a
whole-screenshot advisory comparison against a blessed baseline (useful for "did this surface's
pixels move," useless for "is this surface reading the RIGHT theme's tokens" without a baseline
per theme × surface, which the sparse Tier-A matrix does partially cover for 5 house themes at
one parked state — but pixel diff is advisory, never blocking, and a still-passing baseline
comparison says nothing about WHY a color is what it is). This gate is a semantic, structural
check: read the computed background a surface actually painted, and prove it derives from the
ACTIVE theme's own tokens — not "is it light" or "is it dark," but "does it match --bg or --panel
of the theme that's ACTUALLY on screen."

## Scope

**In:**

1. A computed-style **theme-consistency probe** (`frontend/scripts/theme_consistency.py` +
   the pure classifier `frontend/src/theme_probe.py`), mirroring 0113's split exactly: a browser
   JS extraction pass, and a pure-Python classifier with no browser dependency (unit-testable
   against synthetic fixtures).
2. State source: **the SAME 0108 golden-replay drive 0113 rides**, composed via
   `scripts.visual_regression.VisualWalk` (0113's own walker) rather than re-deriving the wire
   protocol a second time — the walk drives casting → premiere → week to the `nominations`
   parked state, exactly as 0113's Tier A does, so every probed surface is real, walked game
   state (never an injected synthetic pending/decision-card event).
3. A sweep over **BOTH base themes** (`light`, `dark` — the two named in the DoD) × **2
   viewports** (390×844, 1440×900), opening the same panels 0113's Tier A opens (gadget rail,
   settings) PLUS the Settings → Account tab (mounts the headshot studio, G28 — the only reliable
   post-game moment to reach `.hs-preview`/`.hs-cand`/`.hs-libitem`).
4. The **exact XFAIL-ratchet pattern** `visual_regression.py` uses: a `finding-id ->
   {shot-prefix, needle}` registry demotes a known, filed finding to non-blocking; removing the
   entry when the fix lands flips it back to a hard failure. A contract test pins the LIVE
   colon-form shot-id scope (`theme:<name>:<viewport>:<moment>`), guarding against the exact
   0113 bug where a registry entry was written in the on-disk `__`-encoded filename form and
   silently matched nothing (PR #1244 review P1).
5. CI wiring — a new `theme-consistency` job mirroring `visual-regression`'s shape exactly
   (dormant-with-notice when no golden fixture is committed; wired into `ci-gate`).

**Out:**

- **A full theme × surface × viewport cross.** The classifier itself is theme-agnostic (works
  for any of the ~25 themes — house themes, `glass`, every custom preset), but the CI-time sweep
  is deliberately the two BASE presets the DoD names. Running the full house-theme set is a
  trivial config extension (`THEME_NAMES`/`BASE_THEME_COLORS`) — left as a future item, not
  built here, per the same "sparse matrix, not a full cross" call 0113 made.
- **Replacing 0113's pixel diff.** Pixel diff answers "did this surface's pixels move since the
  last blessed baseline" — advisory, whole-image, no semantic understanding of WHY. This gate
  answers "does this surface's background derive from the active theme's tokens" — blocking,
  per-element, semantic. Both are useful; neither subsumes the other.
- **A nightly fuller cross.** Named as a natural follow-on (mirrors 0113's own non-goal); not
  built here.

## The classifier — "far from --bg/--panel," not "light theme ⇒ white"

There are ~25 themes, including tinted house themes (`the-feed`'s dark green) and the neutral
`glass` theme. The gate is NOT "on `light` every surface must be near-white" — it reads the
ACTIVE theme's OWN computed `--bg`/`--panel` at capture time (`getComputedStyle(document
.documentElement).getPropertyValue('--bg')`, the literal string `theme.js`'s `applyColors` set)
and classifies every registered surface's rendered background against THOSE two values only. A
surface is CORRECT iff its background derives from either (an exact match, or a deliberate tint —
`color-mix(in srgb, var(--fg) 5%, transparent)` — that composites close to one of them); WRONG iff
it renders a color far from both, in either direction — "stuck at a foreign polarity."

### Compositing (the "handle rgba alpha" requirement)

A surface's own `background-color` may be fully opaque (the common, and the offending, case),
semi-transparent (a deliberate wash meant to tint whatever's beneath it), or fully transparent
(inherits its ancestor's paint). The JS probe walks a bounded ancestor chain (`maxLayers`,
default 6) collecting each ancestor's own `background-color`, and `composite_layers`
alpha-composites them outermost → innermost (the element's own layer paints last, on top) into
one effective RGB — the same "paint the DOM back-to-front" model a browser uses, bounded rather
than walking the full render tree (the sanctioned simplification: composite over the parent, or
treat a near-transparent layer as inherit). A stack that's transparent all the way up composites
to `None` — such an element inherits the page's base paint by construction and can never itself
be a finding.

### Distance metric + calibration

A cheap, well-known perceptual RGB distance ("redmean") — the same "advisory eyeball, blocking
floor" posture 0113's pixel diff already documents for skipping AA-aware diffing. Two worked
examples fixed `OFFENDER_DISTANCE_THRESHOLD = 90`:

- A `rgba(255,255,255,.05)` wash (the subtle-chip-tint pattern several game-build surfaces
  legitimately use) composited over EITHER theme's own panel color sits at distance ≈ 30–40 —
  well under the threshold, correctly not flagged.
- The bug this gate's first live audit found — `background:#0d0f14` (headshot-studio portrait
  tiles, `orwellHeadshot.js`) — measured (live run, `light` theme, 1440×900 and 390×844) at
  distance **655** from the `light` preset's panel/bg (`#faf6f0`/`#f0ebe3`), correctly flagged
  (`theme:light:phone-390:midweek` / `theme:light:wide-1440:midweek`, both `.hs-preview`); the
  SAME hardcoded color measures far closer to the `dark` preset's own panel (`#111111`) — under
  the threshold, correctly NOT flagged there (`theme:dark:*` shots came back clean in the same
  run). This asymmetry is the whole point: the bug is polarity-specific (it happens to look fine
  on the theme closest to the hardcoded value and wrong everywhere else), and the classifier
  reproduces exactly that asymmetry rather than blanket-flagging the color on every theme.

## Offenders found (first live audit, 2026-07-09)

A manual pre-audit (grepping `static/style.css` + every `static/js/orwell*.js` for hardcoded
`background:` values not derived from `var(...)`, cross-checked against which selectors are
actually GAME-BUILD surfaces vs. the inherited general-purpose workspace apps — email/gallery/
notes/cookbook/tasks/calendar are NOT in scope) found:

- **Real, fixed offender:** `orwellHeadshot.js`'s `.hs-preview` / `.hs-cand` / `.hs-libitem`
  (the headshot/casting-studio portrait tiles — G26/G27/G28) hardcoded `background: #0d0f14
  center/cover no-repeat` for their idle/empty state, while the SIBLING `.hs-cand.hs-loading` /
  `.hs-cand.hs-broken` rules in the SAME file already correctly derive from
  `var(--panel, #11151c)`. Fixed in this change (three sites) to the same token-driven pattern —
  the studio window itself (`#orwell-headshot.ow-window`, `.ow-window` base kit) was already
  correctly token-driven; only these three descendant tiles were the bug.
- **Everything else audited was already correct or intentionally fixed-polarity by design**,
  and is documented here so a future audit doesn't re-flag it:
  - The `.ow-window` traffic-light window controls (`body.theme-frosted .ow-window.ow-focused
    .ow-controls .ow-close/.min/.dock`) are deliberately fixed macOS "stoplight" colors — a
    cross-theme UI convention, not a theme-token bug.
  - Every `body.theme-frosted` / `body.glass-full` scoped rule (the neutral, colorless glass
    material — an explicit Apple HIG design constraint per `theme.js`'s own comment) is a
    deliberate, SCOPED, single-theme override, not a cross-theme leak.
  - The various small `rgba(255,255,255,.05–.12)` "quiet wash" hover/idle tints across
    `orwellCast.js` / `orwellDossier.js` / `orwellMemoryWall.js` / `orwellFinale.js` /
    `orwellGadget.js` / `orwellNotice.js` / `orwellSheet.js` / `orwellStatusPanel.js` /
    `orwellWindow.js` composite CLOSE to either theme's panel (see the calibration worked
    example above) — legitimately not "foreign polarity," even though a human eye might call
    them a lower-contrast design smell on very light themes. Out of THIS gate's scope (it
    catches stuck-polarity, not low-contrast); a follow-on visual/contrast audit could revisit
    them.
  - The 31 hardcoded-hex / 73 rgb-rgba-hsl backgrounds the initial raw `style.css` grep
    surfaced are almost entirely the inherited GENERAL-PURPOSE workspace (print media, the
    signature pad, PDF-view overlays explicitly commented "theme-independent," gallery/cookbook/
    notes status dots, Reduce-Transparency accessibility overrides) — none are game-build
    surfaces in the sense this gate audits (`.ow-window` / `.ow-sheet` / gadget-rail cards /
    sidebar).

## Harness gotcha: an async-mounted surface needs a poll, not a fixed sleep

Live verification caught a real false-negative in the harness itself, not the classifier: the
headshot studio's `OrwellHeadshotStudio.mount()` kicks off an ASYNC `refreshStatus()` fetch
before its first `render()` call, so `.hs-preview` does not exist in the DOM until that fetch
resolves — a fixed `page.wait_for_timeout(350)` after the Settings → Account tab click was, on a
loaded golden-replay engine/FE, sometimes too short, so the FIRST live sweep against the
still-buggy file came back a false-clean 0 findings (the surface simply hadn't mounted yet, not
that its color was fine). `ThemeSweep._open_surfaces` now bounded-polls
(`_wait_for_selector`, up to 15 × 200ms) for `.hs-preview`/`.hs-cand`/`.hs-libitem` to exist
before probing, mirroring the same "poll, don't guess a sleep" discipline
`visual_regression.py`'s `_wait_layout_stable` already uses for slide-in drawers. Re-verified
live afterward: the SAME reverted-buggy file now correctly produces 2 findings (both
`.hs-preview`, both `light`-theme shots, `light`/`dark` distance asymmetry as calibrated above);
the fixed file reproduces 0. Any FUTURE surface added to `THEME_REGISTRY` that mounts async
should get the same treatment if it flakes clean.

## Baseline manifest / bless workflow

**None.** Unlike 0113's pixel diff, this gate has no baseline concept — it is a pure computed-
style classification against the LIVE active theme's own tokens, so there is nothing to bless.

## CI wiring

A new job, `theme-consistency`, in `.github/workflows/ci.yml`, following `visual-regression`'s
shape exactly (same fixture-presence dormant gate, same build/install steps, same
`timeout-minutes: 25`):

- **Path-gated** on the SAME `changes.visual` output 0113 uses (a theme-token edit lives in
  `frontend/`, same as everything else this lane audits — no new path-filter regex needed; the
  `visual` boolean already covers `frontend/**` + `src/**`).
- **Fixture presence gate** — dormant with an explicit notice, mirroring `golden-path`/
  `visual-regression`'s own shape, until the committed golden fixture exists (it already does).
- Runs `python3 scripts/theme_consistency.py --out $RUNNER_TEMP/theme-run`.
- **Findings block** — wired into `ci-gate`'s `needs:`/`RESULTS` like the other required jobs.
- The run's `summary.md` + `theme_report.json` + shots upload as a build artifact + job summary
  (useful evidence even though nothing here is advisory-vs-blocking split the way 0113's pixel
  diff is — every finding here blocks).

## Test strategy (Definition of Done)

1. **Classifier** (`src/theme_probe.py:classify_theme_findings`) — unit-tested against synthetic
   layer-stack fixtures: an exact token match is clean, a subtle wash over either token is clean,
   full inheritance (nothing declared) is clean, a foreign fixed color is flagged on the theme
   it's far from and NOT flagged on the theme it happens to sit close to (the calibration
   asymmetry) — `tests/test_0114_theme_consistency.py`, no browser dependency.
2. **The JS extraction pass itself**, proven against a real (synthetic, engine-free) DOM via
   `sync_playwright` + `page.set_content` — `tests/test_0114_theme_consistency_browser.py`.
3. **XFAIL ratchet + live-form scope** — the same demote/block/xpass-nudge contract
   `visual_regression.py`'s tests pin, PLUS a dedicated test proving a live-form (`theme:`)
   scope matches while the same entry written in the `__`-encoded filename form does NOT — the
   exact 0113 bug class this reuses the pattern from.
4. **Matrix config sanity** — the two base themes, the two viewports, and the registry's surface
   families (window/sheet/gadget-rail/sidebar) match the design.
5. **Report schema** — `theme_report.json` / `summary.md` carry the expected shape; a clean run
   reads as clean, a findings run reads as BLOCKING.
6. **Run the WHOLE FE suite** (`cd frontend && python3 -m pytest tests/ -m "not browser"`, plus
   the browser-marked tests) before pushing.
7. **CI wiring** — `theme-consistency` is in `ci-gate`'s `needs:`/`RESULTS`; the fixture-presence
   step mirrors `visual-regression`'s dormant framing.
8. **Live evidence** — the harness was actually run against the real engine + FE (composing the
   SAME golden-replay walk 0113 uses), confirming the fix (`orwellHeadshot.js`'s three tiles) is
   green on both themes; before/after screenshots at 1440×900 and 390×844 are referenced in the
   PR.

## Implementer handoff

- **Where:** pure logic in `frontend/src/theme_probe.py` (classifier + the JS probe string) —
  import-safe with no Playwright dependency. Orchestration in
  `frontend/scripts/theme_consistency.py` (the CLI + `ThemeSweep`, composing
  `scripts.visual_regression.VisualWalk` for the walk and Playwright imported lazily).
- **State source:** compose `scripts.visual_regression.VisualWalk` (which itself composes
  `scripts._golden_driver.GoldenDriver`, mode `"replay"`) against the single committed
  `frontend/tests/golden/golden_path_*.jsonl` — never an injected synthetic state.
- **Reuse, don't reinvent:** the XFAIL-registry pattern from `visual_regression.py` ships live
  in `theme_consistency.py`. Add an entry only against a real finding, never speculatively;
  remove it when the fix lands (the ratchet).
- **Do NOT** touch `responsive_matrix.py` or `visual_regression.py`'s own assertions — this is a
  new, additive gate. **Do NOT** fabricate a shot for an unreached state. **Do NOT** widen the
  fix beyond genuine game-build surfaces — the general-purpose inherited workspace (email,
  gallery, notes, cookbook, tasks, calendar) is explicitly out of scope.
