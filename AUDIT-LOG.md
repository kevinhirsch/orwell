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

### Pending merge (specialist in flight)
- Transient/animation: filmstrip frame-step of the landing welcome-modal mount (ai-spinner unmount 550ms →
  `#orwell-onboarding` mount 744ms; the `modal-minimize-btn` mount at 513ms), login transients.

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
