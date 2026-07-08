# 0113 — Visual regression harness (screenshot matrix + off-screen detector + blessed baselines)

> Companion: `0113-visual-regression-harness.feature`. Builds on **0108** (the golden-path
> record/replay seam — the state source this harness rides, verbatim), **0065** (`beatSeq`/`phase`,
> the signal the walk uses to know a beat has arrived), Stream S / ruling #16
> (`frontend/scripts/responsive_matrix.py` — the sibling gate this harness extends without
> duplicating), and the 0052 house-theme system (the theme axis). Tracking issue: #1237
> (owner-approved design, decisions locked, 2026-07-08). Timing: shipped ahead of the M3/M4 UI
> waves (room strip, ceremony slates, Memory Wall) — heavy visual churn incoming, so the gate needs
> to exist before that churn, not after it regresses something.

## Why

Every existing FE gate either asserts **behavior** (pytest, browser smoke) or **measured layout
invariants** (`responsive_matrix.py`'s overflow/overlap/tap-target sweep). None of them look at a
**rendered pixel**. Two failure classes slip through that gap entirely:

- **Off-screen/covered regressions that aren't overlap or overflow.** `responsive_matrix.py`
  checks a curated set of registered surfaces for pairwise overlap and page-level horizontal
  scroll — it does not ask "is this element rendering entirely outside the viewport," "is this
  element's content being silently clipped by an ancestor's `overflow:hidden`," or "is something
  else painted on top of this element that shouldn't be." Those are exactly the failure modes a
  CSS refactor (a flex/grid change, a z-index reshuffle, a new fixed-position sibling) produces,
  and none of them trip an overlap/overflow assertion.
- **Pure visual drift.** A color-token edit, a spacing regression, a font-fallback change, a theme
  palette edit that only touches ONE of the five house themes — nothing in the existing suite
  looks at whether a surface still *looks* the way it did. The only prior signal was a human
  eyeballing a screenshot in a PR review, which doesn't scale and catches nothing automatically.

The M3/M4 UI waves (room strip, ceremony slates, the Memory Wall) are about to touch exactly the
surfaces most likely to regress this way. This gate exists to catch it structurally, before that
churn lands, not as an after-the-fact audit.

## Scope

**In:**

1. A **geometry/off-screen detector** — one DOM pass per shot, run in the real browser page,
   checking four things per registered element: off-viewport, clipped-by-ancestor
   (`overflow:hidden`), zero-size, and covered (an `elementFromPoint` probe at the element's own
   center resolving to something else). **Blocking** — any finding fails the CI job.
2. A **screenshot matrix** over a deliberately **sparse** cross of surfaces × viewports × themes ×
   game state (see "Design" below — the full cross is ~840 shots and infeasible per-PR).
3. A **pixel-diff** of every shot against a **blessed baseline** (a committed PNG). **Advisory**
   — never blocks; surfaces as a job summary + uploaded artifact + a before/after/diff triptych.
   A shot id with no blessed baseline is an explicit **SKIPPED-with-notice** pixel-compare entry,
   never a silent pass.
4. A **bless script** — one command, taking any conforming run directory (a local harness run or
   an unpacked CI artifact) and stamping its shots as the new blessed baselines + a manifest.
5. **CI wiring**: a new job on FE-touching PRs, geometry failures block (wired into `ci-gate` like
   the other required FE jobs), pixel-diff report uploads as an artifact + job summary,
   non-blocking.
6. **State source: the 0108 golden-replay drive** — key-free, byte-deterministic, real engine +
   real FE — never an injected synthetic state (the owner's explicit design ruling, #1237). Both
   tiers below ride ONE such walk.

**Out (deliberately, per the owner's locked design):**

- **A full surface × viewport × theme × state cross.** ~840 shots is infeasible per-PR wall-clock
  on the shared self-hosted runner. The sparse matrix (below) keeps the axes but doesn't fully
  cross them.
- **A nightly fuller cross** (themes × journey). Named as a future follow-on in the issue; not
  built here — this spec ships the PR-time gate only.
- **Replacing `responsive_matrix.py`.** That gate keeps its overflow/overlap/tap-target/crowding
  duties; this harness adds state-driven pixel shots and cross-state geometry it doesn't already
  do. Overlapping registries are fine (both watch similar surfaces); duplicated ASSERTIONS are
  not — the geometry detector here checks off-viewport/clip/zero-size/covered, which
  `responsive_matrix.py` does not.
- **Recording a NEW live-model corpus.** The harness only *replays* the already-committed 0108
  golden fixture; it never talks to a real model or a real provider.
- **Finale-beat coverage**, for now — see the sizing deviation below.

## Design (sparse matrix)

**Tier A (chrome)** — 6 surfaces × 4 viewports (390×844 / 768×1024 / 1024×768 / 1440×900) × 5
house themes, at **one** canonical mid-week state ≈ 120 shots:

| Surface | Selector | Walk moment |
|---|---|---|
| `casting` | `#chat-container` (mid-interview) | during the casting turns, pre-`started` |
| `chat` | `#chat-container` | the canonical mid-week pause |
| `status-panel` | `#orwell-status` | the canonical mid-week pause |
| `gadget-rail` | `#gadget-rail` | the canonical mid-week pause |
| `decision-card` | `#orwell-decision-card` | the canonical mid-week pause (a live `nominations` pending is on screen — no synthetic `dispatchEvent`, unlike `responsive_matrix.py`'s endgame-card probe) |
| `settings` | `#settings-modal` | the canonical mid-week pause, opened via the same gear-click seam `responsive_matrix.py` uses |

The **canonical mid-week state** is the engine `nominations` phase (HOH already resolved, nominees
named, real house texture on screen, the decision card live) — a representative "any given
Tuesday." The walk **parks** there: it captures ALL 5 midweek surfaces × 4 viewports × 5 themes
(100 shots) *before* resuming toward eviction, so every one of those shots is the SAME instant of
game state — the theme/viewport sweep is a **fresh page load with a seeded `orwell-theme`
localStorage value** (the same proven pattern `browser_smoke.py`'s frosted-off seed uses), never a
new engine turn. `casting` is captured separately (mid-interview, ×4 viewports ×5 themes = 20
shots) since it is definitionally a different, pre-game moment — 100 + 20 = 120, matching the
issue's estimate exactly.

**Tier B (journey)** — golden-replay walk shots at up to 7 beats (`casting → premiere → hoh →
nominations → veto → eviction → finale`) × 2 viewports (390×844 / 1440×900) × the default theme ≈
14 shots. A beat is captured the first time its condition is observed during the SAME walk that
parks Tier A:

| Beat | Trigger |
|---|---|
| `casting` | mid-interview (shared with Tier A's casting moment) |
| `premiere` | the turn `started` first flips true |
| `hoh` | a LATER turn still in `hoh-competition` (distinct from the premiere turn) |
| `nominations` | `phase == "nominations"` |
| `veto` | `phase in ("veto-competition", "veto-ceremony")` |
| `eviction` | `phase == "eviction"` |
| `finale` | `phase == "finale"` |

**Deviation from the issue's estimate, and why:** the currently committed golden fixture
(`frontend/tests/golden/golden_path_glm-5.2.jsonl`) only records **casting → premiere → Week 1 HOH
→ nominations → veto → eviction → week-roll** — per 0108's own explicit scope, it does **not**
walk to a jury/finale. `finale` is therefore **not reachable** by replaying today's fixture. Rather
than fabricate a finale shot from a synthetic/injected state (which the owner's design explicitly
rules out as the state source), the harness reports it **SKIPPED with a reason** — honest,
structurally identical to the "missing baseline" and "fixture dormant" notices this codebase
already uses elsewhere, never a silent pass and never a fake shot. Tier B currently produces up to
**12 shots** (6 reachable beats × 2 viewports) until a finale-covering golden fixture is recorded;
the beat list and the reachability check both stay in place so it self-extends to the full 14 the
moment such a fixture lands — no harness code change required.

**Nightly (not built here):** the issue names an optional follow-on — a fuller cross (themes ×
journey) on a schedule, never per-PR. Left as a documented future item; this spec ships the PR-time
gate only (see "Non-goals").

## The geometry/off-screen detector

One JS probe (`src/visual_geometry.py:GEOMETRY_PROBE_JS`), injected via `page.evaluate` on **every**
shot, over a curated registry of surface selectors (`GEOMETRY_REGISTRY` in
`scripts/visual_regression.py` — chat, sidebar, status panel, gadget rail, decision card, settings,
onboarding, the notice banner, any open kit window). For each matching **visible** element it
extracts, in ONE DOM pass:

- its bounding rect;
- the nearest `overflow:hidden`/`clip-path` **ancestor**'s rect, if any;
- an `elementFromPoint` probe at the element's own visual center — is the topmost hit itself, a
  descendant, or an ancestor (legitimately "on top"), or something unrelated (a stray scrim, an
  overlapping panel)?

**Classification is pure Python** (`src/visual_geometry.py:classify_shot_geometry`), deliberately
split from the extraction pass so it is unit-testable against synthetic DOM-rect fixtures with
**no browser dependency** — the split is the enabling move for "browser-free where possible" in the
test strategy below. Four finding kinds, checked in order (a zero-size element short-circuits the
rest — a 0×0 node can't be meaningfully off-viewport/clipped/covered too):

1. **`zero-size`** — rendered but occupies no visual area.
2. **`off-viewport`** — entirely outside the current viewport (a *partially* offscreen element,
   e.g. a drawer mid-slide, is not flagged — only wholly-outside).
3. **`clipped-by-ancestor`** — the element's box escapes a real `overflow:hidden` ancestor's box.
4. **`covered`** — the center-point probe resolves to an unrelated element **that is not part of
   a deliberate overlay layer**. The probe stamps `coveredByOverlay` when the covering node sits
   inside any `OVERLAY_ALLOWLIST` selector (kit modal scrims, the grail drawer scrim, the boot
   loader, the settings/onboarding modals, kit windows/sheets, the gadget rail, the decision
   card) — an overlay dimming/covering background content is the layering system *working*, and
   the first live run proved it empirically: 219 of its 223 covered-findings were exactly this
   class. Kit-window-vs-composer collisions remain `responsive_matrix.py`'s D2/#740 duty
   (deliberate non-duplication).

**Geometry findings BLOCK — through the XFAIL ratchet.** The harness carries the exact
XFAIL-registry pattern of `responsive_matrix.py`: `XFAIL` (finding-ID → substring of the
canonical `finding_line` shape) demotes a KNOWN, filed finding to a non-blocking xfail; removing
the entry when the fix lands flips it back to a hard failure (the gate only ratchets tighter),
and an entry that matched nothing this run prints an xpass removal nudge. Entries are added only
against a real observed finding, never speculatively. The first live run (2026-07-08, 132 shots)
seeded three: **VIS-1** (the decision card's content escapes its anchored sheet's
`overflow:hidden` box by ~10–45px at the bottom on phone-390 during comp-round beats — a real
clipping bug to file and fix) and **VIS-2/2b** (the open gadget-rail drawer + the status card
inside it measured wholly off the right viewport edge at tablet-768 under one theme — a
mid-slide capture, the drawer's slide transition ignoring the forced reduced-motion;
belt-and-suspendered by the harness's post-hook layout-stabilization poll, kept as a flake
guard). The harness's exit code is `1` whenever any NON-xfailed finding exists, independent of
the pixel-diff outcome.

## Pixel diff (advisory)

Pure-Python, PIL-based (`src/visual_pixeldiff.py`) — **no new heavyweight dependency**: Pillow +
numpy are already pinned in `requirements.lock.txt` for the qrcode/admin-image paths. A
per-channel-delta threshold (default 24/255) with a documented simplification versus the JS
`pixelmatch` library: **no anti-aliasing-aware fuzzy matching**. This is a deliberate scope call —
AA-aware diffing is a meaningfully bigger algorithm for a marginal false-positive reduction, and
the harness is advisory by design (a human eyeballs the triptych either way). If AA-driven noise
turns out to dominate the advisory signal after the first blessed set ships, tightening the
threshold or adding AA tolerance is a follow-on, not a blocker for this spec.

**Masks** (`MaskRect`) blank out a region in **both** images before diffing — the wall-clock /
live-cost-ticker problem. A curated `MASK_SELECTORS` list (`scripts/visual_regression.py`) is
resolved to device-pixel rects at capture time (the same DOM pass that takes the screenshot) and
carried in the shot's metadata so the diff step, which runs after the browser has closed, can still
apply them.

**Missing baseline is not a pass.** `run_pixel_diffs` reports an explicit `status:
"baseline-missing"` entry (`"SKIPPED ... never a silent pass"` in its `detail`) for any shot id the
manifest doesn't carry — this mirrors the golden-path CI job's own "dormant, explicit notice, never
a silent pass" convention.

**The diff never affects the exit code.** `pixel_report.json` carries a `"policy"` string
restating this, and the CI job uploads it as a build artifact + a job summary — never a required
check.

## Determinism / flake controls

- **Fixed `deviceScaleFactor`** (2, `DEVICE_SCALE_FACTOR` in `visual_regression.py`) on every
  context — a DPI mismatch alone would manufacture a pixel diff.
- **Forced `prefers-reduced-motion`** via Playwright's `reduced_motion="reduce"` context option on
  every context (not a per-navigation `emulate_media` call — set once, structurally, at context
  creation).
- **`ORWELL_LOGICAL_CLOCK`** under replay — inherited for free from `GoldenDriver.boot()` (0108's
  own determinism anchor), since the harness composes that class rather than re-implementing boot.
- **Data-dir scrub on boot** — `GoldenDriver.scrub_stale_state()` (0108) already scrubs
  `orwell_game_session.json` / `orwell_layout.json` / stale golden sessions before the FE boots;
  the harness inherits this by construction (same composed boot sequence).
  browser_smoke.py's lesson (a park-state or stale-session poisoning a run) is covered by the SAME
  scrub, not re-implemented.
- **id-seeded monograms** — already deterministic (no harness-side work needed).
- **Baselines are blessed from CI artifacts, not local renders** — a font/AA rendering difference
  between a developer's machine and the CI runner would otherwise poison the baseline for
  everyone. `visual_bless.py` cannot structurally verify provenance (a CI artifact and a local run
  have the identical directory shape by design), so it prints a loud policy reminder when
  `--source` doesn't look like a CI artifact stamp, but does not refuse to run — the policy is
  process, not code, exactly like the equivalent 0108 nightly-artifact-first convention.

## State driving: composing `GoldenDriver`, not re-deriving the wire protocol

The owner's locked design names the 0108 golden-replay drive as the *only* sanctioned state
source. To stay byte-identical to what the committed fixture was recorded against — any drift in
the request sequence is a replay-key miss, the same hard failure 0108 itself uses — the harness's
walker (`scripts/visual_regression.py:VisualWalk`) **composes** `scripts/_golden_driver.GoldenDriver`
(boot, `configure_model`, `preseed`, the HTTP helpers `_turn`/`_pending`/`_decision_body`/
`_quiesce_beats`) rather than reimplementing the wire protocol from scratch. The turn-SEQUENCING
loop (casting script → week prompts → phase-stall escalation → decision auto-resolution) is a
**parallel, screenshot-interleaved copy** of `GoldenDriver.walk()`'s shape, importing the same
constants (`CASTING_SCRIPT`, `WEEK_PROMPTS`, `PHASE_STALL_AFTER`, `PUSH_PROMPT`,
`PHASE_STALL_ABORT`) so every player-turn string and every decision payload is identical to what
`golden_path_replay.py` itself sends — a screenshot capture is interleaved BETWEEN turns, never
mid-turn, so it can never perturb the sequence.

**This is a deliberate, acknowledged coupling**, not an oversight: the alternative (forking 0108's
entire boot/HTTP plumbing into a second copy) is worse duplication for a walk that must, by
construction, hit the exact same fixture keys. If `_golden_driver.py`'s internals change shape,
this walker needs a matching update — call this out in review whenever either file changes.

## Baseline manifest (`src/visual_manifest.py`)

```jsonc
// frontend/tests/visual/baselines/manifest.json
{
  "format": 1,
  "updated_at": "2026-07-08T12:00:00Z",
  "shots": {
    "tierA:chat:phone-390:the-feed": {
      "path": "tierA__chat__phone-390__the-feed.png",
      "sha256": "…",
      "width": 390, "height": 844, "device_scale_factor": 2,
      "blessed_at": "…", "source": "ci-artifact:run-12345", "label": "…"
    }
  }
}
```

Shot ids are colon-delimited (`tierA:<surface>:<viewport>:<theme>` / `tierB:<beat>:<viewport>`) —
readable in reports; on-disk filenames use `__` instead of `:` for cross-tool/Windows-checkout
safety, via a bijective `encode_shot_id`/`decode_shot_id` pair (`visual_manifest.py`) shared by the
harness and the bless script, so a blessed baseline's filename always decodes back to the SAME shot
id the harness used as its report key. The manifest write is atomic (temp file + `os.replace`) so a
concurrent reader never sees a torn file.

## CI wiring

A new job, `visual-regression`, in `.github/workflows/ci.yml`, following the `golden-path` job's
shape (it depends on the SAME committed golden fixture and reuses the same build/boot
prerequisites):

- **Path-gated** on a new `changes.visual` output — `frontend/**` (the surfaces + the harness
  itself), `src/**` (an engine change can move rendered state), the baselines directory, and the
  workflow file. Follows the existing `changes` job's ERE-per-boolean pattern.
- **Fixture presence gate** (mirrors `golden-path`'s own step): no committed golden fixture ⇒ an
  explicit `::notice` and the job's shot-taking step is skipped — **dormant, never a silent pass**,
  exactly like `golden-path` is dormant until its first fixture lands.
- **Baseline presence is independent of fixture presence**: even with the fixture armed, an EMPTY
  (not-yet-blessed) `baselines/` directory is a legitimate first-run state — every shot reports
  `baseline-missing` (advisory), geometry still runs and still blocks.
- Builds the engine (`npm run build`), installs FE deps + playwright chromium (same steps as
  `golden-path` + `fe-browser`).
- Runs `python3 scripts/visual_regression.py --tier all --out $RUNNER_TEMP/visual-run`.
- **Geometry failures block** — wired into `ci-gate`'s `needs:`/`RESULTS` like the other required
  jobs (`test`, `golden-path`, `fe-unit`, …).
- **Pixel-diff report is advisory** — the job uploads `$RUNNER_TEMP/visual-run` (shots, reports,
  diff triptychs) as a build artifact and appends `summary.md` to the GitHub Actions job summary
  (`$GITHUB_STEP_SUMMARY`), but a nonzero pixel-diff count never fails the job (only `total_findings
  > 0` from the geometry report does, via the script's own exit code).
- **`timeout-minutes: 25`** (matching `golden-path`'s budget — the harness rides the identical
  walk plus a bounded number of extra page loads for the Tier-A sweep, which is cheap: no new
  engine turns, just page reloads).

## Non-goals / risks

- **A nightly fuller cross.** Named in the issue as an optional follow-on; not built here. A
  future spec can wire a `visual-regression-nightly` schedule mirroring `golden-nightly.yml`'s
  shape, re-recording a fresh golden fixture first and then crossing more of the theme × journey
  space off-PR-critical-path.
- **AA-aware pixel diffing.** A documented simplification (see "Pixel diff" above) — a plain
  per-channel threshold, not `pixelmatch`'s perceptual/AA algorithm. Advisory-only softens the
  risk; revisit if false-positive noise dominates after the first blessed set.
- **Finale-beat coverage.** Depends on a finale-covering golden fixture that doesn't exist yet
  (0108's own committed fixture stops at the week-1 roll). The harness is written to pick it up
  automatically the moment such a fixture is recorded — no code change needed, just a reachable
  `phase == "finale"` during the walk.
- **The `_golden_driver.py` coupling.** Acknowledged above — a maintenance cost, not a defect,
  and the DRY alternative (re-deriving 0108's entire wire protocol) is strictly worse.
- **First-run baseline set doesn't exist yet.** Every shot in the FIRST green run of this gate
  reports `baseline-missing` (advisory) — the geometry half still blocks from day one; the pixel
  half arms only once the owner runs `visual_bless.py` against a CI artifact and commits the
  result (mirrors 0108's "dormant PR gate until the first fixture lands" shape).

## Test strategy (Definition of Done)

1. **Geometry classifier** (`src/visual_geometry.py:classify_shot_geometry`) — unit-tested against
   synthetic DOM-rect fixtures for all four finding kinds plus their "clean" negatives (partially
   offscreen is NOT off-viewport; inside a clipping ancestor's box is NOT clipped; covered by an
   own descendant is NOT covered), with **no browser dependency** —
   `tests/test_0113_visual_harness.py`.
2. **The JS extraction pass itself**, proven against a real (synthetic, engine-free) DOM via
   `sync_playwright` + `page.set_content` — `tests/test_0113_visual_harness_browser.py` (carries
   the `browser` marker per `conftest.py`'s structural scan).
3. **Pixel diff** — identical images match; a full-frame change diffs at ratio 1.0; a size mismatch
   is its own status; a mask suppresses an otherwise-real diff; sub-threshold channel noise reads
   as a match; the triptych renders at the expected combined width, including the no-baseline
   placeholder case.
4. **Baseline manifest / bless round-trip** — blessing a run dir copies files + records correct
   sha256/dims/source; re-blessing identical content changes nothing but provenance; added/
   changed/removed shot ids are correctly diffed; an empty or missing run dir is a hard failure,
   never a silent no-op; the manifest write is atomic and round-trips through `load_manifest`.
5. **Missing baseline ⇒ an explicit notice, never a silent pass** — asserted both at the
   `baseline_bytes` level (returns `None`) and end-to-end through
   `VisualWalk.run_pixel_diffs` (a `status: "baseline-missing"` entry with `"SKIPPED"` in its
   detail).
6. **Report schema** — `geometry_report.json` / `pixel_report.json` / `summary.md` all carry the
   expected shape and prose (a nonzero geometry-findings count reads as "BLOCKING" in the summary;
   a clean run reads as "clean").
7. **Matrix config sanity** — the surface/viewport/theme/beat counts match the design (6 Tier-A
   surfaces, 4 Tier-A viewports, 5 house themes, 2 Tier-B viewports, 7 named Tier-B beats), every
   `PHASE_TO_BEAT` target is a declared Tier-B beat, every Tier-A surface declares a known walk
   moment, shot filenames are filesystem-safe.
8. **Run the WHOLE FE suite** (`cd frontend && python3 -m pytest tests/ -m "not browser"`) before
   pushing — the harness lives beside several source-pinned convention gates.
9. **CI wiring** — `visual-regression` is in `ci-gate`'s `needs:`/`RESULTS`; the `changes.visual`
   path filter gates it; the fixture-presence step mirrors `golden-path`'s dormant framing.

## Implementer handoff

- **Where:** pure logic in `frontend/src/visual_geometry.py` (classifier + the JS probe string),
  `frontend/src/visual_pixeldiff.py` (PIL-based diff), `frontend/src/visual_manifest.py` (baseline
  manifest I/O + the bless primitive) — all import-safe with no Playwright dependency.
  Orchestration in `frontend/scripts/visual_regression.py` (the CLI + `VisualWalk`, Playwright
  imported LAZILY inside functions so the pure pieces stay testable without a browser) and
  `frontend/scripts/visual_bless.py` (the one-command bless CLI). Baselines live in
  `frontend/tests/visual/baselines/` (PNGs + `manifest.json`, committed — the repo is private).
- **State source:** compose `scripts/_golden_driver.GoldenDriver`, mode `"replay"`, against the
  single committed `frontend/tests/golden/golden_path_*.jsonl` — see "State driving" above for the
  coupling rationale. Do **not** inject a synthetic pending/decision-card event the way
  `responsive_matrix.py`'s endgame probe does; every Tier A/B shot must come from a real, walked
  engine state.
- **Reuse, don't reinvent:** the XFAIL-registry PATTERN from `responsive_matrix.py` (a
  `finding-id -> substring` map that demotes a known failure to a non-blocking xfail) ships live
  in `visual_regression.py`, seeded with the first live run's three real findings (VIS-1/VIS-2/
  VIS-2b — see "Geometry findings BLOCK" above). Add an entry only against a real finding id,
  never speculatively; remove it when the fix lands (the ratchet), per that file's discipline.
- **Follow-up (surface list, post-M3/M4):** six UI PRs merged 2026-07-08 (room strip, decision
  faces, dossier, Memory Wall, ceremony slates, premiere cast strip). Tier A's 6-surface list and
  `GEOMETRY_REGISTRY` predate them — a follow-up item should evaluate adding the new surfaces
  (Memory Wall, room strip, ceremony slates) to the registry and/or as Tier-A surfaces once their
  selectors stabilize. Deliberately NOT expanded in this first cut (scope held to the
  owner-locked #1237 design); the harness structure (a dict entry + a selector) makes each
  addition a two-line change.
- **Do NOT** touch `responsive_matrix.py`'s own overflow/overlap/tap-target assertions — this is a
  new, additive gate. **Do NOT** add a debug endpoint exposing hidden state to make shots "more
  interesting" — every shot is exactly what the real player-facing surface already renders (the
  Vault Wall is untouched; this is read-only observation, ADR 0003 intact). **Do NOT** let a pixel
  diff fail the CI job. **Do NOT** fabricate a shot for an unreached beat — report it skipped.
