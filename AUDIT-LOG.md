# Orwell — Pre-Launch E2E Playtest Audit · Trace Ledger

> **The authoritative, on-disk trace ledger for this audit.** It survives context compaction.
> Every issue gets an entry with evidence and a literal `VIEWED` status; nothing is asserted
> without having been *seen* in captured telemetry, and nothing is `VERIFIED` until re-captured.

- **Run owner:** lead orchestrator (principal playtest researcher).
- **Branch:** `claude/gracious-tesla-wytijo`.
- **Started:** 2026-06-20.
- **Method:** real stack (TS engine on 8765 + Python/FastAPI FE on 7000), engine = ground truth,
  Playwright temporal capture (video → ffmpeg filmstrip + DOM MutationObserver/event + network log),
  **two-window parity × {desktop 1440×900, mobile 390×844}**, narration on `deepseek/deepseek-v4-pro`
  via OpenRouter (operator-supplied key; session secret, sandbox-only, never committed/logged).
- **Posture:** remediate + gate at peer review (per the operating brief), reusing the committed
  harness in `docs/audits/playtest-harness/` and building on the 2026-06-18/19 findings as baseline.

### Status legend
`OPEN` · `VIEWED` (visually confirmed in telemetry) · `ROOT-CAUSED` (traced engine→BE→FE→render with evidence)
· `FIX-PROPOSED` · `FIX-APPLIED` (awaiting gate) · `VERIFIED` (re-captured & re-confirmed) · `WONTFIX/NA`

### Triage key
`[BLOCK]` launch-blocking · `[POLISH]` high-priority polish · `[LATENT]` latent/potential (same mechanism)

---

## 1. Phase 0 — Evaluation baseline & premise reconciliation

### 1.1 Engine-is-truth oracle (the audit's consistency anchor)
- **Engine HTTP MCP** (`npm start`, port **8765**): tool transport `POST /:channel/call`
  `{"name":<tool>,"args":{…}}` + header `X-Orwell-User:<user>`; player tools are Vault-free by
  construction. `GET /health` → `{ok,…,embeddings}`.
- **FE projections** (port **7000**, Vault-free): `GET /api/orwell/{health,state,status,moment}`;
  `POST /api/orwell/{new-game,decision,next-season}` (admin-gated structured doors).
- **Oracle rule:** at every checkpoint capture engine state and assert (a) FE render matches it and
  (b) narration matches it. Any divergence among {engine, render, narration} is a defect — name which.

### 1.2 Narration tier mapping (confirmed — operator + harness README §1)
- Narration LLM is **runtime-configured**, not a code binding: an **OpenRouter** endpoint
  (`https://openrouter.ai/api/v1`) set through Settings (`POST /api/model-endpoints` +
  `POST /api/auth/settings`). Default model for grounding-critical play: **`deepseek/deepseek-v4-pro`**.
- **Tier story (corroborated by §9 findings):** `-pro` = higher-fidelity / disciplined (sources comp
  outcomes from the engine; real-roster grounding); `-flash` = fast/cheap/**verbose**, lower fidelity
  (invents cast, refuses `advanceGame`). Hunt narration failures hardest on `-flash` and at the
  Pro↔Flash boundary; all gates otherwise stub the LLM (`Echo`/`DeterministicNarrator`).

### 1.3 Consistency model (what "two-window garbage" maps onto HERE)
- **Not raw websockets.** Cross-tab/-device sync is **SSE/server-push**: `session_events`/`sessionSync`,
  the server-push `_publish_game_updated` (0064), and the single-dispatcher `orwell:gamechanged`
  debounce seam (`platform.js orwellGameChanged`). Closed-set ordering is the engine's monotonic
  **`beatSeq`** with **`expectedBeatSeq`** stale-guards → HTTP **409 `stale-beat`** and an
  **`idempotencyKey`** at-most-once funnel (feature 0065). The FE holds last-seen `beatSeq` per
  session and reconciles 409s through the desync mechanism.
- **Intended model:** the closed set (outcomes/state/persistence/Vault) is engine-authoritative and
  serialized per user (per-user promise queue, `HttpMcpServer.enqueue`); the open set (social prose)
  is recorded, never normalized. **The audit's consistency question:** does the FE assume a stronger
  guarantee than the SSE/beatSeq layer provides (lost updates, stale render, ordering races,
  optimistic UI), and do two windows converge to engine truth — and how fast?

### 1.4 The eight priority invariants (mandate order)
Vault isolation (incl. God Mode) → event visibility & propagation → behavioral fidelity →
replayability/naming → competition eligibility → outcomes by stats+temperature → persistence
non-degradation → daily-event. (Spec: `docs/bb-sim-spec.md` §12; mandate: `CLAUDE.md`.)

### 1.5 Surface reality (corrects the generic brief template)
- **No Canvas/WebGL game surface.** It is a **DOM/chat PWA** (vanilla JS + FastAPI). The brief's
  canvas/DPR/touch→canvas-mapping checks are **N/A** except `<img>` portraits/headshots. The
  responsive/touch/PWA/safe-area contract IS real and CI-gated (`responsive-tokens.css`,
  `responsive_matrix.py`, `test_s_responsive_mechanism.py`).
- **The game IS the main chat** (ADR 0003; 0022 rich UI deferred). HUD is the gadget-rail (0054) +
  status panel + presence/diary/cast/finale/retrospective windows (Lane-F `OrwellWindow`/`.ow-*` kit).

### 1.6 Prior-art incorporation (carried as baseline — RE-VERIFY against current code)
The 2026-06-18/19 live runs (DOC-ONLY) are the starting baseline. Open launch-blockers to re-verify:
- **S3-CORE [BLOCK]** — model bypasses engine on decision resolution (narrated past a `pending`
  player decision without `submitDecision`), invents an outcome + a non-roster houseguest, narration
  ↔ engine desync compounds. *Current code claims a fix family (createCharacter finalize fallback,
  forced `advanceGame` L39b, `markHouseguestMet` belt) — but the specific **pending-decision
  interlock** + **roster validation** + **outcome guard** must be confirmed present & effective.*
- **S4-1 [BLOCK]** — structured decision card only dispatched by `chat.js` parsing the agent's
  `advanceGame`; the status HUD offers no fallback ⇒ a player is stuck when the model narrates past a
  pending. Confirm whether the status poller now dispatches `orwell:pending`.
- **S1-1 [BLOCK]** — zero-data landing overlaps the casting card on the welcome message (figure-ground;
  text-over-text). Confirm whether the empty-chat/welcome controller now suppresses one.
- **S4-2 / S1-2 / S1-3 / S1-4 / S3-1 [POLISH]** + the L-series ledger (`2026-06-19-live-debug-issues.md`).

---

## 2. Issue ledger

| ID | State | Sev | Status | One-line |
|---|---|---|---|---|
| F1 | Phase 0 | n/a | ROOT-CAUSED (doc) | Operating brief is a generic template; several premises don't match this system (reconciled in §1.5/§1.3/§1.2). |
| S1-1 | State 1 | ~~BLOCK~~ | **VERIFIED-FIXED** | Zero-data landing text-over-text — fixed by the 2026-06-20 OOBE modal-scrim redesign; verified desktop/mobile-390/narrow-320. |
| S1-4 | State 1 | ~~POLISH~~ | **VERIFIED-FIXED** | Login password "clear ⓧ glyph" — is now the show/hide **eye toggle** (`login.html` eyeOpen/eyeClosed). Already implemented. |
| S1-2 | State 1 | POLISH | ROOT-CAUSED | `/api/orwell/avatar` returns **404 by design** when unset → console/resource error (2×/load). tts/stt stat pollers already gated (gone). Fix: 204. |
| S1-5 | State 1 | POLISH | VIEWED | Residual inherited-workspace copy ("Import a file … candidate memories you can approve") still in the game-build DOM (not visible; in `index.html`). |
| S1-A | State 1 | POLISH | ROOT-CAUSED | Login "Remember me" renders as an **unlabeled 14×14 dot** (`#remember` + `.remember-dot`, `aria-label`/`title` only) — missing signifier + sub-tap-floor (2.5.5/2.5.8 fail); **root: `login.html` never links `responsive-tokens.css`**, so the coarse-pointer floor can't rescue it. |
| S1-B | State 1 | POLISH | ROOT-CAUSED | Login version "v4.29" contrast **1.89:1** (AA fail) — `.version-label opacity:0.25` crushes a 9.43:1 pair. Borderline-incidental (decorative build string) but measurable; opacity ~0.6 → 4.43:1. |
| S1-C | State 1 | POLISH | ROOT-CAUSED | **One-frame full-white FOUC flash** on cold load (narrow `f-001`=100% white → dark `f-002`) — UA blank canvas before dark-theme CSS paints; fix: inline dark bg on `html`/`body` in `index.html` head. |
| S1-1L | State 1 | LATENT | ROOT-CAUSED | Splash-suppression is timing-fragile (TRANS-1): `body.ow-onboarding` set inside `mountWelcome` after the async `route()` chain — a slow engine `/state`/`/models` could let the splash paint before the modal (latent S1-1 regression). Harden: suppress at top of `route()` when `started===false`. |
| BG-1 | X-cut | POLISH (a11y) | **FIX-APPLIED (verified)** | **Operator report**: animated bg "not rendering". Under `prefers-reduced-motion` the canvas generator was skipped (`theme.js:644`) → the 6 canvas-only patterns (incl. default telescreen→perlin-flow) rendered **fully blank**. Not my change / not the CSP merge (both ruled out). **Fix:** `_bgStaticInit` renders a STATIC frame (bounded+restored rAF; zero motion). Verified; FE suite green. Committed `fbe2124`. |
| S2 | State 2 | n/a | **PASS (VIEWED)** | Live casting on `deepseek-v4-pro`: producers open first, distinct named producer (Vincent), reactive persona, **no leaks** any turn, reasoning hidden; tight grounding (`casting.ready` on name; `known` accretes playerName→backstory→archetype→strategy→privateStrategy→notes); **finalized on the FIRST readiness cue** (S2-1 didn't bite); move-in = 15 real cast names, none fabricated. |
| S3-PAR | State 3 | n/a | **PARITY HOLDS at rest (VIEWED)** | Two-window SAME-identity, SEQUENTIAL: CP1 both load **byte-identical** (engine `beatSeq:8`, HUD, chat 12/12, 0 JS err). CP2 (turn in A) → B syncs the GM beat via SSE/`beatSeq` (both `beatSeq:16`); transient `A=15/B=14` reconciled to **both 14, identical** on re-query. At rest, fine. |
| **S3-RACE** | State 3 | **[BLOCK] (likely)** | ROOT-CAUSING | **Concurrent-write race (operator: zero-tolerance, "persistent"): the cross-tab chat render DIVERGES and ACCUMULATES.** Looped (10×): **6/6 iterations diverge**, gap grows 1→6 msgs (A=35/B=30 by it6); even equal-count iters differ in content (`bodyId=false`). **Engine ALWAYS consistent** (beatSeq matches every iter), **0 409s, 0 JS errors** — so purely an **FE cross-tab chat-sync failure** (per-tab optimistic-append + best-effort SSE, no server-ordered authoritative log / no id-dedup / no reconciliation). **Rec: structural refactor** (server-ordered message log, idempotent SSE deltas, render-by-id). Confirming render-layer vs data-layer (reload-reconcile test) + the exact merge defect (specialist trace), then a firm refactor plan. |
| S1-3 | State 1 | POLISH | DEFERRED→S2 | Raw `<input type=file>` — re-verify on the casting **headshot card** (State 2) + Account/new-season. |
| S1-P1 | State 1 | n/a | VIEWED (ruled benign) | Two-window SAME-identity parity: only divergence is the **random rotating Tip**, which is covered by the welcome modal (pixel mismatch 0%) → legitimate client-side nondeterminism, **not** a consistency defect. |
| S1-P2 | State 1 | n/a | VIEWED (ruled benign) | Mobile Settings nav = **horizontal-scroll tab strip** (tabs reachable; "Appea…" peek = affordance). DEFECT_SCAN `offscreen` is a false positive for a scroll container → **legitimate reflow**, not clipping. |

### F1 — Brief premises vs. system reality (logged per Phase 0 step 3)
- **Status:** ROOT-CAUSED (documentation finding; no code defect). Evidence: this repo's source +
  `frontend/INTEGRATION.md` + `docs/audits/playtest-harness/README.md` §0.
- **Observation:** the brief assumes (a) a Canvas/WebGL surface, (b) websocket-based two-window
  concurrency, (c) DeepSeek V4 as an engine binding with output caps to test.
- **Mechanism / correction:** (a) the rendered game is a DOM/chat PWA — canvas checks are N/A except
  `<img>` portraits (§1.5); (b) sync is SSE/server-push + `beatSeq`/409 reconcile, not sockets — the
  garbage hunt retargets there (§1.3); (c) DeepSeek is a runtime OpenRouter model, output caps live in
  the provider/endpoint config, not code (§1.2). The brief's **rigor and lenses transfer intact**; only
  the surface specifics change. *(This is the brief's own "finding #1 if specs/assumptions contradict.")*

---

## 2.2 State 1 — Initial Instantiation (login · zero-data landing · settings · onboarding states)

**Method.** Real stack; Playwright device matrix {desktop 1440×900 pointer, mobile 390×844 DPR3 touch,
narrow 320}; video→ffmpeg filmstrips + pre-load MutationObserver/console/network instrument; engine-truth
snapshots; two-window same-identity parity (+ pixel A/B diff). Surfaces: `/login`, `/` (fresh engine ⇒
pre-game), Settings (12 tabs × 2 bp), forced onboarding states (dark-house F5, welcome). Artifacts under
`.audit-telemetry/shots/`. (Narration + social-game lenses have **no State-1 substance** — engine has no
game yet — deferred to States 2–3.)

**Headline.** The prior run's State-1 launch-blocker (**S1-1**) is **fixed**, and **S1-4** is fixed. State 1
yields **no launch-blockers** — only polish. Two apparent anomalies (parity tip-divergence; mobile settings
"overflow") were **adversarially ruled benign** via differential diagnosis.

### S1-2 — `/api/orwell/avatar` 404 on every load · [POLISH] · ROOT-CAUSED
- **VIEWED:** `s1-landing-{desktop,mobile,narrow}.json` net log → `404 GET /api/orwell/avatar` ×2 + a
  downstream `requestfailed` ×2, on every landing; console shows "Failed to load resource: 404".
- **Mechanism (traced FE→BE):** `orwellAvatar.js:22-34 apply()` probes `fetch('/api/orwell/avatar')` and
  treats `r.ok` as "avatar present"; `boot()` (L41) calls it twice (once + a 1.2s re-apply). When no avatar
  is set the route returns `Response(status_code=404)` (`orwell_routes.py:792`). 404 is used as the
  "no-avatar" signal, but the browser logs it as a console/resource **error** and a failed image fetch.
- **Differential:** not a polling loop (prior "19×/load" no longer reproduces — only boot+re-apply = 2×);
  the prior tts/stt `stats` 404 spam is **gone** (those pollers were gated in the game build). So the
  residual is solely the avatar presence-probe.
- **Fix:** route returns **204 No Content** (not 404) when unset; `orwellAvatar.js` treats `r.status===200`
  (or `r.ok && status!==204`) as present. Eliminates the console error AND the failed image fetch. Safe,
  Vault-irrelevant. Confidence high; falsifier: a 204 still logging an error in any consumer.

### S1-5 — Residual inherited-workspace copy in the game-build DOM · [POLISH] · VIEWED
- **VIEWED:** DEFECT_SCAN `smells` on the landing flags "Import a file — the AI reads it and suggests
  candidate memories you can approve" — present in the DOM (`index.html`), not visible in the game build.
- **Mechanism:** the game build hides but does not strip inherited-workspace template strings. Low risk
  (not rendered), but it is dead non-game copy shipping to the client. Fix: strip/guard in the game-build
  template. (Prior S1-5; still open.)

### S1-A — Login "Remember me" is an unlabeled dot · [POLISH] · ROOT-CAUSED · NEW
- **VIEWED:** `s1-login-{desktop,mobile}.png` — a filled teal dot at the right of the **empty Username**
  field, with no adjacent label; DEFECT_SCAN taps → `#remember.remember-check` **14×14**.
- **Mechanism:** `login.html` renders the "Remember me" checkbox as a custom `.remember-dot` toggle
  (`#remember` `checked` by default; label is `aria-label` only — no visible text; innerText has no
  "Remember me"). **Norman: the signifier is missing** — a first-timer reads the dot as a status indicator
  or stray artifact, not a toggle; and at 14×14 it is below the 44px coarse-pointer floor (2.5.5).
- **Fix:** add a visible "Remember me" label beside the control and raise the hit area to `--tap-min` on
  coarse pointer. (Responsive specialist asked to corroborate.)

### S1-P1 — Two-window same-identity parity · ruled BENIGN (consistency lens, first ruling)
- **VIEWED:** `s1-landing-parity-desktop-PARITY.json` → `textIdentical=false` BUT `pixel.pct≈0`. The only
  text divergence is the rotating Tip ("Status panel tracks…" vs "Deals are real…").
- **Mechanism + differential:** the tip is a **client-side random selection**, rendered on the welcome
  splash which sits **behind** the 88%-opaque onboarding scrim → not visible → pixel-identical render. No
  shared authoritative (engine) state is rendered inconsistently; the per-window difference is local
  nondeterminism, **not** a lost update / ordering race / optimistic-UI desync. **Not a defect.** (Real
  garbage-hunt load arrives in State 3 over the SSE/`beatSeq` seam.) Falsifier: a pixel-visible divergence,
  or a divergence in `status.{week,phase,hoh,noms}` between same-identity windows.

### S1-P2 — Mobile Settings nav "overflow" · ruled BENIGN (responsive lens)
- **VIEWED:** mobile settings JSONs flag `offscreen` nav items (Appearance +27px, Shortcuts +123,
  Agent Tools +322) — but `docOverflow=null` (no document scroll), the nav is a **horizontal-scroll tab
  strip** (screenshot shows "Appea…" peeking at the right edge; the active tab scrolls into view), and s1b
  successfully reached/clicked every tab. **Clipped/unreachable ruled out → legitimate reflow.** (Minor
  discoverability note: no scroll chevron; the partial-word peek is the only affordance — left to the
  responsive specialist.)

### Verified-good (do not regress)
Login card (clean, on-brand, eye-toggle); the OOBE **modal scrim** (welcome / dark-house F5 / J4 holding —
all clear copy, correct inert-background + focus-trap a11y); desktop Settings (no overflow on any of 12
tabs; OpenRouter 340/340; the displayed "key d2fba624" is a non-secret endpoint id, **not** the API key);
the mobile Add-Models/Appearance tabs at 390px.

### S1-B — Login version label contrast 1.89:1 · [POLISH] · ROOT-CAUSED · NEW (responsive specialist)
- **VIEWED:** `s1-login-{desktop,mobile}.png` bottom-right "v4.29". `.version-label{color:var(--fg);
  opacity:0.25;font-size:.7rem}` (`login.html:229`): `--fg #9cdef2` @0.25 over `--bg #282c34` composites to
  ≈#455864 → **1.89:1** (normal ~11px text needs 4.5:1).
- **Mechanism:** `opacity:0.25` crushes an otherwise 9.43:1 pair. Fix: opacity ≈0.6 → 4.43:1. Borderline
  WCAG-1.4.3-incidental (non-interactive, `pointer-events:none`) but measurable and hard to read.

### Responsive specialist — merged (RESP-1…5); confirmations & one latent
- **Confirmed S1-P2** with the exact mechanism: `style.css` `@container settings-modal (max-width:480px)`
  → `.settings-sidebar{flex-direction:row;overflow-x:auto}`, `.settings-nav-item{flex:0 0 auto}`, an edge
  `mask-image` fade as the scroll affordance; every offscreen entry is a `.settings-nav-item` **inside** the
  scroll container → reachable. Legitimate reflow; only discoverability hardening (a visible scroll
  indicator beyond the mask fade) is warranted.
- **Confirmed** no `docOverflow` / no content clipping on login, landing, or any of the 12 settings tabs at
  1440/390/320; desktop↔mobile **functional equivalence** holds (both `character-creation`, `casting`,
  `beatSeq:1`, identical system prompt).
- **Refuted** the settings-sublabel contrast suspicion: `--color-muted #888` on `--panel #111` = **5.33:1**
  (PASS). Not a defect.
- **S1-L1 [LATENT]:** mobile toggle `<input>`s compute to **23×23** (1px under the 24px coarse floor) because
  the fluid root `clamp()` sits at its 15px floor at 390px so `1.5rem≈23px`; operable via the full-width row
  hit area → cosmetic, not a functional fail. Also LATENT: login `#search-fb-remove` 13px wide (desktop-only,
  fine-pointer).

### S1-C — One-frame white FOUC flash on cold load · [POLISH] · ROOT-CAUSED · NEW (transient specialist)
- **VIEWED (photometry):** `s1-landing-narrow-frames/f-001.png` = meanL 255 (every px white); `f-002`
  onward dark (meanL ~17). Desktop/mobile recordings started a hair after theme paint so they didn't sample
  the pre-theme frame; login `f-001` was already dark.
- **Mechanism:** classic FOUC — the UA blank-white canvas before the app dark-theme CSS applies on first
  paint (no app element/mutation; not narrow-specific in nature, only in capture timing). Fix: inline a dark
  `background` on `html`/`body` in `index.html` `<head>` so the first paint is already dark. WCAG 2.3.1 (one
  sub-125ms frame) is under threshold, but a full-viewport white→dark jolt on a dark app is a real polish smell.

### Transient specialist — merged (TRANS-1…3); confirmations & one latent
- **Confirmed S1-P-transient (no splash flash):** photometry shows the welcome-splash never crosses
  perceptible luminance — the scrim (`color-mix(bg 88%,black)`, z99999) + splash co-fade and the splash is
  suppressed before reaching visible alpha; modal then rock-stable (49 frames, no flicker/premature
  unmount/double-mount). Login fully quiescent (0 mutations f-001≈f-038). `jsErrors:0` everywhere.
- **S1-1L [LATENT]:** the suppression is mechanism-fragile (see table) — fix is to set `body.ow-onboarding`
  / hide the splash at the **top of `route()`** when `started===false`, not inside `mountWelcome` after the
  async await chain. Not currently reproducing; proactively de-risks an S1-1 regression under a slow engine.
- **TRANS-2 [non-bug]:** `modal-minimize-btn` mount-without-unmount = a benign boot injection
  (`modalManager.injectMinimizeButton`) into **hidden inherited tool modals** (Settings/Theme), NOT the
  `#orwell-onboarding` overlay (which has no `.modal-header`/uses `.ob-btn`) — confirmed visually absent from
  every onboarding frame. Audit-instrument noise only (the `[class*=modal]` SEL catches it).

### State 1 — consolidated remediation (APPLIED to working tree; awaiting peer-review gate)
All [POLISH], FE-only, no engine/Vault impact, one cohesive change set. **Not committed** — held for
`/diff` review + authorization, then validation (re-capture).
- **APPLIED #1 S1-2** — `orwell_routes.py` `/avatar` → **204** when unset; `orwellAvatar.js` treats only
  `status===200` as present (kills the per-load console/resource 404 error).
- **APPLIED #2 S1-B** — `login.html` `.version-label` opacity `0.25→0.6` (1.89:1 → ~4.43:1, passes AA).
- **APPLIED #3 S1-C** — `index.html` head script now sets `documentElement.style.backgroundColor=c.bg`
  (theme-correct first-paint bg) → the cold-load white FOUC frame is gone.
- **APPLIED #4 S1-A** — `login.html`: the "Remember me" overlay dot replaced by a **visible labelled row**
  (`.remember-row`, whole-row hit target ≥24px); `#rememberToggle`/`#remember` ids preserved so the auth
  flow is unchanged.
- **DEFERRED S1-5** — residual workspace copy is already hidden by game-trim ("optionally strip"); low value,
  template-structural — left for a template-cleanup pass, not a pre-launch drive-by.
- **DEFERRED S1-1L** — the splash-suppression hardening is **latent, not reproducing**; a `route()`-flow
  change risks a real regression (splash not restoring after a J4 dismiss) and warrants its own validation.

**VALIDATION — VERIFIED (authorized 2026-06-21; FE restarted on current main; re-captured).**
- **S1-2 ✓** — landing net log: the `/avatar` **404 is gone**; landing **console errors 2→0**. (Residual
  `net::ERR_ABORTED ×2` is a capture-teardown artifact — the `cache:no-store` re-probe aborts as the browser
  context closes; not a server error, not a console error, not user-facing.)
- **S1-A ✓** — `s1v-login-{desktop,mobile}.png`: a visible "Remember me" checkbox+label row below the
  password; the username-field dot is gone. Hit target = the ≥24px label row (the scan still flags the 16px
  checkbox glyph, but operability is satisfied by the row).
- **S1-B ✓** — version label legible at opacity 0.6 (`v4.35` post-merge).
- **S1-C ✓** — narrow `f-001 meanL=18.7` (dark) vs the pre-fix **255 (pure white)**; the FOUC flash is gone.

Status: **S1-2 / S1-A / S1-B / S1-C = VERIFIED.** S1-5 / S1-1L = DEFERRED (documented). No State-1
launch-blockers. Branch synced onto current `main` (merge `9bca2b1`).

---

## 2.3 Cross-cutting findings & minor-observations log (surfaced during State 1)

### BG-1 — Reduced-motion gives a FULLY BLANK background on canvas-only house patterns · [POLISH / a11y-UX] · ROOT-CAUSED
- **Reported by the operator** ("the animated frontend background isn't rendering"); reproduced + root-caused.
- **VIEWED:** Playwright probe — `reducedMotion:'reduce'` → `canvasPresent:false` (no particle canvas), though
  the `bg-pattern-*` class is still on `body`. `no-preference` → canvas renders **and animates** (rain/embers/
  constellations, ~6–7k non-zero-alpha px, pixel count changes between 1.5s samples).
- **Mechanism (traced):** `theme.js:644` — `if (_CANVAS_PATTERNS[p] && !_prefersReducedMotion()) _CANVAS_PATTERNS[p]()`.
  Under reduced-motion the generator is never called ⇒ no canvas. The 6 **canvas-only** patterns (perlin-flow,
  petals, sparkles, rain, constellations, embers — `style.css:203-207` have NO CSS base) render **nothing**.
  Only `dots`/`synapse` keep a CSS gradient. **The default theme telescreen → perlin-flow is canvas-only**, so a
  reduced-motion user on the default theme sees a dead/flat background — exactly the report.
- **Steelman:** this is the A5 fix (`e1ae963`, ruling #18) honoring `prefers-reduced-motion`. The code comment
  intends "static or off; the CSS base still paints" — but for canvas-only patterns the realized behavior is
  **"off" (blank)**, not "static": the texture is lost, not merely the motion.
- **Ruled out with evidence:** NOT my S1-C change (perlin-flow canvas is `z-index:0` prepended to `body`, above
  `<html>`; my html bg can't occlude it; probe confirms canvas present with my change in the served file). NOT
  the CSP merge (purely additive — added `fonts.*`; canvas needs no CSP directive). The merge did not touch
  `theme.js`/`style.css`.
- **Decision (operator):** option (a) — render a **static frame**.
- **FIX APPLIED (`theme.js`), VERIFIED:** new `_bgStaticInit(initFn)` runs the existing generator but bounds
  `requestAnimationFrame` to a finite synchronous burst (n<90) then **restores** the real rAF — the particle
  field builds up *off-paint* and freezes (full texture, **zero ongoing motion**); `applyBgPattern` routes the
  reduced-motion case through it instead of skipping. Probe (`bgprobe4`/`bgapp`): `reducedMotion:reduce` →
  canvas **present + drawn** (constellations 3677 px / petals 892 px) and **`animating=false`** (stable across
  1.6s samples); `no-preference` → still **`animating=true`** (892→1144). `node --check` clean. FE suite green
  (the A5 source-contract test `test_a5_animated_particles_honor_prefers_reduced_motion` updated to assert the
  new "static, bounded+restored rAF" contract — passes).
- **OBS-8 [known minor limitation]:** under reduced-motion, a **window resize** re-inits + clears the canvas
  (the generator's `resize()` runs, but the frozen draw loop doesn't repaint) → the bg goes blank until the next
  theme re-apply/reload. Infrequent + recoverable; a clean fix needs per-generator resize-repaint and is left as
  a follow-up. (The reported issue — blank bg on load — is fixed.)
- **OBS-9 [info]:** the `auditadmin` account (created via `setup.py`) resolves to `bg-pattern: none` on the app
  (no particles) — a default-account quirk, not the player default (telescreen→perlin-flow). The fix was
  validated via the login page, which drives the **same** `theme.js applyBgPattern`.

### Minor-observations log (per the "log EVERY issue, no matter how small" directive)
- **OBS-1 [low]:** with no saved theme the bg **pattern is non-deterministic across loads** (observed embers →
  rain → constellations on identical fresh loads) — a brand-new user gets an inconsistent background pattern.
  Likely the default-theme/pattern resolution isn't pinned. Worth making telescreen→perlin-flow deterministic.
- **OBS-2 [low]:** the **login page logs 401** on `/api/prefs/theme` + `/api/prefs/custom-themes` pre-auth
  (2 console errors on the login screen) — benign, but console-error noise (same class as S1-2).
- **OBS-3 [info]:** residual `/api/orwell/avatar` `net::ERR_ABORTED ×2` on the landing (post-204) is a
  capture-teardown artifact (the `no-store` re-probe aborts as the context closes) — not user-facing.
- **OBS-4 [info, accepted]:** the S1-A remember checkbox glyph is 16×16 inside the ≥24px label row — operable via
  the row; the scan flags the glyph only.
- **OBS-5 [info]:** `--bg-effect-color` resolves empty (falls back to `--fg`) on the default theme.
- **OBS-6 [latent/cosmetic] (=S1-L1):** mobile toggle inputs compute to 23×23 (1px under the 24 coarse floor) via
  the rem clamp at 390px — operable via the row hit area.
- **OBS-7 [non-bug] (=TRANS-2):** `modal-minimize-btn` mount-without-unmount = benign boot injection into hidden
  inherited tool modals; audit-instrument noise (the `[class*=modal]` observer SEL).

---

## 2.4 S3-RACE — cross-tab chat divergence under concurrent writes · [BLOCK] · ROOT-CAUSED (deep refactor recommended)

**Symptom (reproduced, looped):** two tabs, same user/session; concurrent writes → the rendered chat
diverges and **accumulates** (10× loop: **6/6 diverge**, gap 1→6 msgs, `bodyId=false` even at equal counts);
**engine always consistent** (`beatSeq` matches every iter), **0 409, 0 JS errors**. Operator: persistent, zero-tolerance.

**Root cause (traced, FE-only — the engine/DB are correct & serialized):** the FE chat conversation is a
*replicated log with no merge discipline*. Three compounding defects:
1. **No ordering key** — `ChatMessage` (`core/database.py:161-188`) = random `uuid4` id + non-unique
   `timestamp(utcnow)`; render/reload `ORDER BY timestamp` only (`session_manager.py:143`, `history_routes.py:82`)
   → tie ambiguity → reorder.
2. **Sender tab is optimistic-only, never reconciles** — `chat.js:692-694` renders user bubble + streams the
   reply locally; **no post-`[DONE]` history re-fetch** for an ordinary game turn → the sender's DOM is a
   permanent local guess.
3. **Busy tab suppresses the peer's events** — `sessionSync.js:51` `if (hasActiveStream(id)) return` can't
   distinguish "my echo" from the peer's real `message-added`/`run-started`, so a streaming tab **drops** the
   events that would tell it the peer wrote; streaming turns publish only `run-started` (`chat_routes.py:1364`),
   never a completion event → no recovery. Latent: `agent_runs.py:154-164` keeps one `_Run` per session →
   run-replacement lost-update on `resumeStream`.

Intended model = read-your-writes / convergent server-ordered log (`session_events.py:1-15` says so); violated by
optimistic-append + at-least-once SSE treated as exactly-once + a suppress-gate that drops the reconcile signal.
**Permanent until manual reload** (reload re-fetches the correct DB log — pending the reconcile test below).

**Recommended STRUCTURAL fix (operator open to refactor):** make it the id+seq-ordered authoritative log the
comments already claim: (1) add monotonic per-session `seq` to `ChatMessage` (`UNIQUE(session_id,seq)`, assigned
under the `agent_runs` serialization), order all render paths + `/api/history` by `seq`; (2) render-by-id,
reconcile-not-replace (temp id → canonical on `{id,seq}` arrival, insert missing peers in `seq` order);
(3) replace `hasActiveStream` suppression with `{id,seq}` dedup (process every event); (4) publish `message-added`
+ `seq` on streaming completion, and attach `resumeStream` to a run BY ID. Scope: 1 schema column + 2 render paths
+ the sync handler + 1 broadcast — FE-only, no engine/Vault impact, preserves the tiny-SSE-payload privacy property.

---

## 3. Changelog
- 2026-06-20 — Ledger initialized; Phase 0 baseline + premise reconciliation (F1) recorded; prior
  2026-06-18/19 findings carried as the re-verify baseline; environment build kicked off; five
  specialist subagents defined in `.claude/agents/`.
- 2026-06-20 — Full stack live (engine 8765 + FE 7000, `deepseek/deepseek-v4-pro` wired & probed live);
  extended rig built (`.audit-telemetry/rig.mjs`: device matrix + video/ffmpeg + MutationObserver +
  two-window parity + pixel diff). **State 1 captured & analyzed:** S1-1 & S1-4 verified FIXED; S1-2 / S1-5 /
  S1-A open [POLISH] & root-caused; S1-P1 (parity) & S1-P2 (mobile settings) ruled benign. 2 specialists
  (transient, responsive) dispatched to validate; awaiting merge before the State-1 gate.
