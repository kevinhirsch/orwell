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
| **S3-RACE** | State 3 | ~~BLOCK~~ | **FIXED (implemented + gated)** | **Concurrent-write race (zero-tolerance): cross-tab chat render DIVERGED + ACCUMULATED.** Looped **10/10 diverge** (gap → A=45/B=40); engine ALWAYS consistent (`beatSeq` matches), **0 409, 0 JS err**. **Reconcile test: render-layer** — live diverged (45/47), **RELOAD reconciled (49/49)** → persisted log intact, no data loss. Root cause (FE-only): replicated log, no merge discipline (no `seq` ordering; sender optimistic-only; busy tab suppresses peer events). **Fixed per [ADR 0008](docs/decisions/0008-chat-conversation-consistency.md)** — FE-only, no engine/Vault impact: **Phase A** authoritative per-session `seq` (schema + backfill migration + seq-ordered reads + `message-added` completion broadcast); **Phase B** render-/reconcile-by-id (optimistic temp-id→canonical adoption, divergence-gated rebuild, deferred-past-live-stream; dropped the `hasActiveStream` suppression); **Phase C** permanent gates (`test_adr0008_chat_seq.py` + `…_reconcile_contract.py`). Verified: live DB migration (dense backfill + UNIQUE index), full FE suite green (1688), `/api/history` serves `{id,seq}` ordered, clean two-tab browser runtime. *Remaining: a live concurrent-write browser re-run with real-model turns (the convergence foundation is proven by the interleaved-writers gate).* |
| **S3-CORE** | State 3 | ~~BLOCK~~ | **VERIFIED-FIXED (live)** | **Prior launch-blocker (model bypasses engine on comp/ceremony resolution; invents cast) does NOT reproduce on current build.** Live `deepseek-v4-pro`, 14 turns through a full week-1 loop (hoh-competition → nominations → veto-competition → veto-ceremony → eviction): **engine advanced EVERY turn** (`advanced:true` 14/14 — the "won't `advanceGame`/freeze" defect is gone); **0 leaks** in the visible body 14/14; **0 genuine cast inventions** (the 5 `invented` flags are all `<conjunction>+roster-first-name` regex false positives — Hazel/Kenji/Evan/Steven all rostered). **Narration ↔ engine truth held**: HOH=Hazel surfaced exactly when engine phase→nominations; "Paige and Frankie are on the block" == engine `noms=[Paige Wu, Frankie Whitaker]`; veto holder "Steven" + medallion narrated at veto-ceremony/eviction in sync. The fix family (forced `advanceGame` L39b, finalize fallbacks, `markHouseguestMet` belt, pre-emission outcome guard) is **effective**. |
| **S4-RESOLVE** | State 4 | n/a | **PASS (live)** | **Full game to a clean finish.** Fast-forwarded the live sandbox via deterministic engine `callTool` (EchoNarrator, no model cost): **14 weeks → crowned winner Thomas Pearson** (a comp-earned NPC — not story-protected for the player). Player **evicted into the jury** and exercised the **interactive finale juror path** (`juror-question` + `juror-vote` pendings surfaced & resolved). FE **retrospective window renders** the winner + **ordered per-juror vote reveal** ("Hazel votes for Thomas, Kenji votes for…"). No stale-loop, no missing-winner, game always terminates. |
| **S4-VAULT-RETRO** | State 4 | n/a | **PASS — Wall holds at its one opening** | **The 0048 retrospective unsealing — the Vault's ONE sanctioned exception — reveals the STORY, never the NUMBERS.** Live finished season: **2087 off-screen hidden-story beats** across 13 types (Conflict/Alliance/Whisper/Confessional/Betrayal/Showmance/Deal/Secret-thread/…), all **humanized prose** ("Evan Reeves clashed with Charlie Emerson"); **13 weeks of per-voter unsealed ballots** (voter→votedFor NamedRefs). **Numeric-leak oracle: CLEAN (0)** — no soul float / relationship number / hidden stat / emotional-volatility-aptitude value crosses (the `RetrospectiveView` interface is structurally narrative-only). **Secret-ballot anonymization held ALL SEASON**: 83 player-visible eviction beats all read "a vote to evict ⟨nominee⟩", **0 per-voter attribution** (unseals only post-season). `npc:N` appears only in `id` leaf fields (proven by JSON-path walk), never in prose/name/content. FE retro DOM scan: numeric CLEAN, `npc:N` absent. |
| **S4-1** | State 4 | ~~BLOCK~~ | **VERIFIED-FIXED (code+live)** | Prior blocker (model narrates past a pending ⇒ player STUCK with no card) is fixed by **two layered backstops** in `orwellDecision.js`: `rearmFromStatus` (reload-survival, hardened vs. the async `#chat-history` mount race) **+ the explicit "S4-1 escape hatch"** (a 15s poll of the engine's authoritative `/api/orwell/status` `pending` that surfaces the card even when the chat agent never dispatched it — another device advanced, a missed tool call — without re-nagging a dismissed card; fail-open). Player can never be permanently stuck. Live s3core corroborated (cards surfaced & resolved). |
| **S4-EDGE** | State 4 | n/a | **PASS** | **Session rejoin:** reload of a finished game loads clean — chat intact (bodyLen 74.5k), no error screen, **0 JS errors**. **Dropped socket:** `sessionSync.js` SSE = native `EventSource` auto-reconnect + capped exponential backoff (1s→30s) on hard-close + 1.5s re-bind tick — transport-resilient. **AI timeout:** handled server-side (the client stall watchdog is *deliberately disabled* per CLAUDE.md; server-side stall detector + auto-continue supersede it). *Note: the client `message-added` SSE listener exists but the streaming path never fires it server-side — corroborates ADR 0008 defect #4 from the client.* |
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

## 2.5 State 4 — Resolution / finale / retrospective + edge cases · ALL PASS

**Method.** The interactive finale + post-season retrospective are weeks of play away; rather than burn
live-model budget driving there through the FE, the live `auditadmin` sandbox was **fast-forwarded to a
crowned winner via direct engine `callTool`** (`advanceGame`/`submitDecision` over `POST /player/call`,
`X-Orwell-User: auditadmin`). The engine narrator is `EchoNarrativePort` and outcomes are deterministic, so
this is a **byte-faithful, model-free** drive of the real closed-set loop — the same protocol as the
`fullGameUat` harness, run against the *live* sandbox. Every advance result + endgame projection was scanned
through the Vault-leak oracle. *(Caveat: this teleports the engine ahead of the FE chat, leaving the chat at
week 1 — a **test artifact**, not a defect; a natural playthrough narrates to finale.)*

**S4-RESOLVE — the loop terminates correctly.** 14 weeks → winner **Thomas Pearson** (an NPC; the engine
does not story-protect the player to the crown). The player was **evicted into the jury** and the
**interactive finale juror path** fired (`juror-question`, `juror-vote` pendings surfaced & resolved). The
FE **retrospective window renders** the winner + the **ordered per-juror vote reveal**.

**S4-VAULT-RETRO — the Wall holds at its one sanctioned opening.** The 0048 retrospective (`seasonRetrospective`,
registry `readsVault:false`) is the Wall's single structurally-gated exception, and it unseals the **story, not
the numbers**:
- **2087** off-screen hidden-story beats across **13 types** (Conflict/Alliance/Whisper/Confessional/Bonding/
  Strategy/Surfacing/Showmance/Betrayal/Deal/Secret-thread/Hidden-tie/Hidden-side) — all **humanized prose**, a
  rich behavioral-fidelity payoff of the NPC-to-NPC life the player never witnessed.
- **13 weeks** of per-voter unsealed eviction ballots (the "who really voted against you" reveal).
- **Numeric-leak oracle: CLEAN (0).** The `RetrospectiveView` interface carries only `{winner, hiddenStory[],
  twists[], evictionVotes[]}` — **no field can carry a raw soul/relationship/stat number**. Confirmed live: no
  `physical/mental/social/trust/affinity/threat/emotional/volatility/aptitude:<num>` anywhere in the payload.
- **Secret-ballot anonymization held all season:** 83 player-visible eviction beats all read "a vote to evict
  ⟨nominee⟩"; **0** per-voter attributions in any live projection (attribution unseals **only** post-season).
- `npc:N` appears **only under `id` leaf keys** (proven by a JSON-path walk of the live projections: 15/15 in
  `getGameState`, 185/185 in the retrospective — all `id`, 0 in prose/name/content). The FE rendered-DOM scan
  of the retrospective window: numeric **CLEAN**, `npc:N` **absent**.

**S4-1 — the stuck-player blocker is fixed (code + live).** `orwellDecision.js` carries two layered backstops so
a pending decision is reachable **without the chat agent dispatching it**: `rearmFromStatus` (reload-survival,
hardened against the async `#chat-history` mount race) and the explicit **"S4-1 escape hatch"** — a 15s poll of
the engine's authoritative `/api/orwell/status` `pending` that mounts the card even if the model narrated past it
or another device advanced, without re-nagging a dismissed card (fail-open). The live s3core run corroborated
(decision cards surfaced and resolved every turn).

**S4-EDGE — resilient.** *Session rejoin:* reload of a finished game loads clean (chat intact, no error screen,
**0 JS errors**). *Dropped socket:* `sessionSync.js` relies on native `EventSource` auto-reconnect + capped
exponential backoff (1s→30s) on hard-close, plus a 1.5s re-bind tick — transport-resilient. *AI timeout:*
server-side (the client stall watchdog is **deliberately disabled** per CLAUDE.md; the server stall detector +
auto-continue loop-breaker supersede it). One corroboration: the client `message-added` SSE listener exists but
the streaming path **never fires it server-side** — independent confirmation of **ADR 0008 defect #4** (the
missing completion broadcast) from the client side.

---

## 2.6 Audit close-out — verdict

**All four states swept (S1 instantiation · S2 onboarding · S3 core-loop + concurrency · S4 resolution).**
Engine-side Vault Wall, cross-user isolation, secret-ballot anonymization, retrospective story-not-numbers,
narration↔engine fidelity, and the decision-card escape hatch are all **verified clean on the live build**.

- **The ONE launch-blocker:** **S3-RACE** — cross-tab/-device chat divergence under concurrent writes
  (render-layer only; engine + persisted log are correct). Fix specified in **ADR 0008** (FE-only: per-session
  `seq` + render/reconcile-by-id + `{id,seq}` dedup + completion broadcast). **Awaiting implementation** (PO has
  authorized the deep refactor; "finish the audit first, then implement").
- **Prior-art blockers — all retired:** S3-CORE (engine-bypass/cast-invention) **VERIFIED-FIXED**; S4-1
  (stuck player) **VERIFIED-FIXED**; S1-1 (text-over-text) **VERIFIED-FIXED**.
- **Polish backlog (non-blocking, fixes applied this run):** S1-2 (avatar 204), S1-A (Remember-me label),
  S1-B (version contrast), S1-C (FOUC), BG-1 (reduced-motion static background) — all FIX-APPLIED & verified.
  Residual [POLISH]/[LATENT]: S1-5 (inherited copy), S1-1L (splash-suppression timing), S1-3 (raw file input).

**Next action:** implement **ADR 0008** + land the permanent two-tab concurrent-write parity gate.

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
- 2026-06-21 — **State 2 PASS** (live casting, no leaks, tight grounding). **State 3:** parity holds at rest;
  **S3-RACE [BLOCK]** root-caused (looped 10/10 diverge, render-layer, reload reconciles) → **ADR 0008** drafted;
  **S3-CORE re-verified VERIFIED-FIXED** (14-turn live week-1 loop: engine advanced 14/14, 0 leaks, 0 cast
  inventions, narration↔engine fidelity held). **BG-1** reduced-motion background fixed & verified. Playtest
  methodology doc published (`docs/audits/playtest-harness/2026-06-21-…`).
- 2026-06-21 — **State 4 ALL PASS** (§2.5): live fast-forward to a crowned winner (14 wks, NPC winner, player→
  jury, juror path fired); **retrospective unsealing holds the Wall at its one opening** (2087 narrative beats +
  13 wks per-voter ballots, **0 numeric leaks**); secret ballots anonymized all season; **S4-1 escape hatch**
  & **S4-EDGE** (rejoin/SSE/timeout) verified. **Audit close-out (§2.6): the lone launch-blocker is S3-RACE →
  ADR 0008** (FE-only); all prior-art blockers retired. Proceeding to implement ADR 0008.


---

# ═══════════════════════════════════════════════════════════════════════════
# PARALLEL AUDIT LANE — OOBE/casting + cross-platform + consistency (States 5–6)
# This ledger lane ran in parallel with the close-out above (same overall audit,
# different reviewer/branch). Filename collided on merge; preserved here in full.
# Owner to adjudicate final consolidation. NOTE: this lane's State-6 entry calls
# ADR 0008 "NOT-PRESENT" — SUPERSEDED: ADR 0008 landed BUILT on main (5e3a2f3).
# ═══════════════════════════════════════════════════════════════════════════

# AUDIT-LOG.md — Orwell pre-launch E2E playtest & refactor audit (trace ledger)

**Lead:** principal playtest orchestrator (4 domains: reality-competition/social-game · game design
MDA · distributed-consistency · frontier-AI / DeepSeek V4). **Started:** 2026-06-20.
**Posture:** launch is imminent ("next week"). This is the persistent, on-disk trace ledger — it
survives context compaction. Every issue gets an entry; nothing is asserted without being `VIEWED`.

> **Many readers, one writer.** Read-only investigation fans out to the `.claude/agents/`
> specialists; **all writes to this ledger and all remediation are the lead's, single-threaded and
> gated.** Subagents return structured findings; the lead reconciles, de-dupes, de-conflicts.

## How to use this ledger
- **State machine per issue:** `OPEN → VIEWED (seen in telemetry) → ROOT-CAUSED → FIX-DRAFTED →
  (gate) → FIX-APPLIED → VERIFIED (re-captured & re-viewed)`. `VIEWED`/`VERIFIED` are literal:
  only after visual confirmation in captured telemetry.
- **Severity:** `[BLOCK]` launch-blocking · `[POLISH]` high-priority polish · `[LATENT]`
  latent/potential bug sharing a mechanism.
- **Every entry carries:** id · state · sev · symptom · exact evidence (clip/frame range/session
  id/timestamp/device/`file:line`) · reproduction · full trace (engine→BE→FE→render) · **confirmed**
  root cause · fix · refactor notes · verification.

---

## Environment & credentials (this run)
- **Engine:** TS hexagonal core, `npm install --ignore-scripts && npm run build` → `node dist/main.js`
  on **:8765** (`ORWELL_DATA_DIR=.audit-telemetry/engine-data`). Built clean (`dist/main.js` 606kb).
  Embeddings fall back to the deterministic fake (no fastembed model fetched — fine for the audit).
- **Front-end:** Python/FastAPI in `frontend/`, venv at `frontend/.venv` (deps installed), run with
  `ORWELL_GAME_BUILD=1 AUTH_ENABLED=true LOCALHOST_BYPASS=false ORWELL_ENGINE_MCP_URL=http://127.0.0.1:8765`
  on **:7000**, behind a real deterministic admin account (`setup.py`).
- **Telemetry rig:** Playwright **sandboxed** in `.audit-telemetry/` (`--prefix`,
  `PLAYWRIGHT_BROWSERS_PATH` inside the sandbox) so browser deps never pollute the project graph.
  Reuses the committed harness in `docs/audits/playtest-harness/` (`playSession.mjs` roleplay
  daemon, `lib.mjs` capture/defect-scan, `coreScenes/gameScenes/state1/gameLoopUI/namesCheck`).
- **CREDENTIALS — session secret, handled per policy.** The operator supplied an OpenRouter API key
  for **`deepseek/deepseek-v4-pro`**. It lives **ONLY** in the git-ignored
  `.audit-telemetry/.secrets.env` (chmod 600; `.audit-telemetry/` confirmed git-ignored). It is
  **NEVER** committed, screenshotted, logged into this ledger, or written to any tracked file.
  **The key value appears nowhere in this repo.** → **Revoke the key when the audit is done.**

## Model-tier baseline (confirmed live from OpenRouter `/models`, 2026-06-20)
| Model | Context | Max output | Pricing prompt/completion (per Mtok) | Role |
|---|---|---|---|---|
| `deepseek/deepseek-v4-pro` | 1,048,576 | 384,000 | $0.435 / $0.87 | **configured tier** — higher fidelity, slower, pricier |
| `deepseek/deepseek-v4-flash` | 1,048,576 | 65,536 | $0.09 / $0.18 | cheaper, verbose, lower fidelity — overflow/drift risk |
- Both are **reasoning models**: a probe at `max_tokens:12` returned `reasoning_tokens:12` — reasoning
  counts against the output cap, so a small FE-configured `max_tokens` can starve visible content
  (truncation/empty-content failure mode). **TODO (narration lens):** trace `LLMConfig.DEFAULT_MAX_TOKENS`
  and the per-request cap actually sent, + whether `high`/`xhigh` reasoning effort is wired.

---

## Finding #1 — Brief-vs-reality reconciliation (logged per the Phase-0 mandate)
**Not a product defect — a scoping fact that governs the whole run.** The repo already carries a
mature audit campaign (`docs/audits/playtest-harness/README.md` playbook; the 2026-06-18 Flash run;
the 2026-06-19 `-pro` DOC-ONLY E2E audit `docs/audits/2026-06-19-e2e-smoke-test-audit.md`; the
live-debug L-series `docs/audits/2026-06-19-live-debug-issues.md`; the debug-notes
`docs/debug-notes/LEDGER.md`). The 2026-06-19 audit's three **[BLOCK]** items have since had
remediations **land in code** (commit `af02717` / PR #431, plus the pending-decision barrier) but
those fixes are **un-live-verified** (the audit was doc-only; the code came after). The single
highest-value pre-launch work is therefore **live re-verification of the just-landed launch-blocker
fixes** + driving the open `◐` items — not a redundant clean-room re-discovery. The DeepSeek
narration dimension requires the operator's API key (supplied). Confidence: high (traced to git log +
source). This ledger continues the campaign with the brief's stronger orchestration (parallel
specialists, two-window parity, device matrix, refactor roadmap).

---

## Carried-forward watch-list (to live-verify / drive — newest understanding)
These are seeded from prior audits with **corrected** status. Each must be re-confirmed `VIEWED`
against fresh telemetry before any claim — a code fix landing is not verification.

| ID | Sev | State | Item | Where the fix landed (to verify it BINDS live) |
|----|-----|-------|------|------------------------------------------------|
| S3-CORE / B6 | [BLOCK] | FIX-APPLIED, **verify owed** | Model bypasses engine on decision resolution — narrates outcome (+ invents a houseguest) instead of `submitDecision`/`advanceGame`; HUD-vs-chat desync compounds. | Pending-decision BARRIER `frontend/routes/chat_helpers.py:259`; `_PROGRESSION_TOOLS`/`_decision_undelivered` `frontend/src/agent_loop.py`; FLAVOR-vs-OUTCOMES + outcome guard `momentPrompts.ts`. |
| S4-1 | [BLOCK] | FIX-APPLIED, **verify owed** | Decision card only reachable via the chat agent; status HUD had no fallback → player stuck on a pending. | "decision escape hatch" PR #431 (`af02717`); `orwellDecision.js` now self-dispatches `orwell:pending` (`:406/:437`) + listens (`:442`). |
| S1-1 / S6-2 | [BLOCK] | FIX-APPLIED, **verify owed** | Zero-data landing overlaps the casting card on the welcome message (figure-ground); cast/sidebar overlap. | "S6-2 cast/sidebar overlap" PR #431 (`af02717`). |
| debug-note #1 | [BLOCK] | FIX-APPLIED, **mobile re-verify owed** | Mobile casting interview short-circuits (name+photo flips `ready`, forced finalize → floater). | `castingIntake.ts` `finalizable` floor + `createRefused:"casting-incomplete"`; `agent_loop.py` gates. (`aca6ee5`, ledger note #1.) |
| S2-1 / S5-1 | [POLISH] | OPEN | Model under-finalizes casting (needs explicit "lock it in"); add a structural "Enter the house" when `casting.ready`. | proposed; not confirmed landed. |
| S4-2 | [POLISH] | partial | `status`/`finaleView` go stale at season end (no `finished`/`winner`). | `bd5e26e` "Add finished/winner to status projection" — verify. |
| S1-2 | [POLISH] | OPEN | Game-build console 404 spam (`/api/orwell/avatar` 19×, `tts/stats`, `stt/stats`). | gate pollers behind feature flags. |
| S1-3 / S4-3 | [POLISH] | OPEN | Raw unstyled `<input type=file>` in casting / account / new-season. | styled upload control. |
| S1-4 | [POLISH] | OPEN | Login password field shows a clear (ⓧ) glyph while empty. | show/hide eye toggle. |
| S3-1 | [POLISH] | OPEN | HUD "16/16" count vs the visible 15-NPC list ambiguity. | label "15 houseguests" or include the player row. |
| L18 | [BLOCK-adjacent] | `◐` | Engine hang / 502 on the E22 fallback-digest path (R3 O(events) snapshot cost on an under-resourced host). | single-flight fallback `chat_helpers.py`; bigger LXC baseline; R3 incremental-snapshot **deferred**. |
| L31 | [feature] | `◐` | Premiere tutorial-overlay FE framing (engine half shipped). | FE tutorial framing. |
| L28b | [feature] | `◐` | FE producer-LLM backstory authoring caller + backstory-first→portrait order (engine `recordCastProfile` shipped). | FE caller. |
| L37 | [OPS] | `◐` | Rotate/size-cap on-disk `ops-panel.log`; quiet per-poll httpx INFO lines. | log rotation. |
| L39 a/b/c | [ENG/FE] | `☐` | (a) player walk-out narrated-but-not-recorded; (b) season won't advance; (c) "enter God Mode" typed in chat got role-played. | self-eviction 0061 + channel discipline + advance nudges — verify. |
| L40 | [ENG] | `◐` | Showmance-overload scheduler (0059 organic stage-advancement surfacing remaining). | scheduler. |
| L35 | [ENG] | `◐` | Pre-game seeded ties — organic pathway-surfacing remaining (0059). | discovery-only surfacing. |
| L45 | [FE/test] | `◐` | Extend the trailing-punctuation regression guard beyond `?` to `! . …`. | test coverage. |

---

## Rig status (Phase 1) — VALIDATED end-to-end (2026-06-21)
Engine :8765 (rebuilt from synced main) healthy · FE :7000 auth + `engine:true` · admin
`audit-admin` · OpenRouter endpoint registered (340 models) · default model
`deepseek/deepseek-v4-pro` confirmed · Playwright+chromium sandboxed in `.audit-telemetry/`.
**Capture→vision loop proven:** `.audit-telemetry/cap_login.mjs` captured `/login` at desktop
(1440×900) + mobile (iPhone-13 descriptor, DPR3); PNGs read back via vision. Still to build for the
full per-state cycle: two-window parity + DOM MutationObserver/event log + video→filmstrip + the A/B
diff (extend `docs/audits/playtest-harness/lib.mjs` + this pattern).

**Sync discipline (operator note: main moves fast, parallel auditors):** re-`git fetch origin main`
and merge **before each state's capture**; rebuild engine if `src/` moved, restart FE if `frontend/`
moved. Currently synced to `093da44` (= origin/main `106b9ad` + my Phase-0 commit). Re-synced at:
State-1 standup.

## STATE 1 — Initial Instantiation (login · zero-data landing · settings) — findings

**Engine truth at capture:** `moment:character-creation, started:false` (no game). Captured desktop
1440×900 + mobile iPhone-13 (DPR3); same-identity two-window parity on the landing: **`sameScan=true`**
(A/B identical — no same-identity divergence on the static landing). Artifacts: `.audit-telemetry/
shots/state1/`. **Headline: no [BLOCK] in State 1 — the S1-1 launch-blocker is visually fixed.**

### Launch-blocker re-verification
- **S1-1** (zero-data landing overlap) — ✅ **FIXED visually** (👁 VIEWED `landing-{desktop,mobile}.png`):
  one clean "Welcome to the house" onboarding card + "Meet the producers" CTA, no text-over-text, good
  mobile tap target. ⚠️ **LATENT structurally** (logged as F-S1-G): the welcome overlay is not mutually
  exclusive with the casting/headshot overlays.
- **S1-4** (login password glyph) — ✅ **RESOLVED** (#436). The visible eye in Chromium is the intended
  custom `.pw-toggle`; #436 hides the *Edge-native* `::-ms-reveal/::-ms-clear` (Chromium never showed
  those). `login.html` is served from disk per-request (`app.py:860`) — current code confirmed. *(My
  earlier provisional F-S1-B was a misread; withdrawn.)*

### State-1 findings (all POLISH / LATENT / NOTE)
| ID | Sev | 👁 | Finding | Evidence | Mechanism / direction |
|----|-----|----|---------|----------|----------------------|
| **F-S1-C** | POLISH | ✅✅ **VERIFIED FIXED** | `/api/orwell/avatar` returned **404 on every authed load** (2×/load) → console-error noise (S1-2). | `landing-desktop.meta.json`; re-capture: **console errors 2→0, avatar 200→204** | **FIXED (this gate):** route returns **204** when no avatar (`orwell_routes.py:786`), `orwellAvatar.js` guards `r.status!==204` → shows the initial, test `test_g27_avatar_studio.py:164` updated 404→204. 204 isn't an error status ⇒ no console 404. Avatar test green (10). |
| **F-S1-D** | POLISH | ✅ | **`/api/orwell/state` polled ~13× in ~2.5s** on the zero-data landing (`/status` ~4×, `/models` ~3×) — heavy, pre-game. | `landing-desktop.meta.json` net log | **Traced:** `orwellOnboarding.js:569` fires `prewarm-cast` on landing → engine reports a `generation` record → `orwellCast.js` adaptive `FAST_POLL_MS=3500` engages; **AND ~10 gadget modules each fetch `/state` independently** (no shared coordinator). Each `/state` serializes in the engine's per-user queue (L18-adjacent). Fix: gate the cast fast-poll to a mounted cast window; coalesce gadget `/state` reads behind one shared poller. |
| **F-S1-E** | low (deferred) | ✅ | model-picker button 148×**21px** — sub-min tap target, but **DESKTOP-only** (mobile landing `taps=0` → adequate on touch where it matters; WCAG 2.5.8 AA is satisfiable for a precise pointer). Reclassified **desktop-pointer AAA**. | `landing-desktop.meta.json` taps; `landing-mobile` taps=0 | **Deferred** — low value, composer-bar layout-sensitive; not worth a pre-launch layout-regression risk. Logged. |
| **F-S1-F** | POLISH | ✅ | **Settings is occluded by the onboarding scrim (z-index 99999)** on the zero-data landing — `#user-bar-settings` click can't open Settings until onboarding is dismissed. | `settings-desktop-open.png` (onboarding still up after click) | Differential: by-design focus (settings is admin-only) vs. accidental occlusion. Confirm a new player isn't blocked; consider an in-onboarding settings/escape affordance. (Echoes L2.) |
| **F-S1-G** | LATENT | trace | S1-1 **structural** latent: `#welcome-screen` is an abs-positioned overlay hidden only by `.hidden`; casting/headshot are separate overlays over the same region; soft body-class suppression hides `#welcome-tip/-sub` but **NOT `.welcome-name`**. | `ARCHITECTURE-AS-IS.md` §Seam-3; `style.css:2001`, `orwellHeadshot.js`, `orwellOnboarding.js` | Make welcome ⟂ onboarding/casting by construction (suppress `.welcome-name` too / remove from layout). **Verify in State 2** (headshot mounts mid-interview). |
| **F-S1-H** | POLISH (deferred) | ✅ | **2× `console.error: 401`** on the **unauthenticated** `/login` page. | `login-{desktop,mobile}.meta.json` | **Root cause confirmed:** `login.html`'s deferred `theme.js` ES-module import auto-inits (`_initWithSync`→`initThemeUI`) and fires authed prefs fetches **pre-auth** → 401. **Deferred** — fix lives in shared `theme.js` (just changed by #439); gate the prefs sync when unauthed or no-op the 401. Regression/collision risk too high for this gate. |
| **F-S1-I** | NOTE | ✅ | Leftover **vendored-workspace copy ships in the game-build DOM** (hidden but present): "Import a file — the AI reads it and suggests candidate memories you can approve"; example preset "build-vllm-wheel"; workspace themes ("claude","GPT","cyberpunk"…) + model "north-mini-code:free". The S1-5 family. | `landing-desktop.meta.json` smells | Strip from the game-build template (low risk; not visible). |
| **F-S1-J** | NOTE | ✅ | Small **unidentified dot adornment on the empty username field** on `/login`. | `login-desktop.png` | Identify (validation indicator? stray). Minor. |
| **F-S1-K** | TOOLING | — | Audit instrument: the injected MutationObserver logged **0 mutations** on the landing (FE likely toggles `display` rather than mounting, or an init-script world issue). | `landing-*.meta.json` `audit.mutCount=0` | **Fix the observer for State-2+ transient capture** (not a product bug). Also harden `OVERLAP_SCAN` to exclude ancestor–descendant pairs (it false-positived S1-1) and the copy-smell scan (innerText concatenation across siblings yields spurious double-spaces). |

### State-1 remediation (this gate)
**Applied + VERIFIED:** **F-S1-C** avatar `404→204` (route + `orwellAvatar.js` guard + test) — re-captured: landing console errors **2→0**. Avatar test green (10); full FE suite running.
**Deferred with confirmed root causes** (rigor: no hasty pre-launch churn on shared/just-changed files with parallel auditors active):
- **F-S1-D** (`/state` ×13 on landing) — *structural* (prewarm fast-poll + ~10 uncoordinated `/state` pollers). Candidate refactor (coalesce behind one shared poller) → roadmap, not a leaf patch.
- **F-S1-H** (login pre-auth 401) — shared `theme.js` auto-init (#439 just touched it); risk.
- **F-S1-E** (model-picker 21px) — desktop-pointer AAA only; mobile adequate; layout-sensitive.
- **F-S1-F/G/I/J** — by-design / latent (verify State 2) / cosmetic DOM copy / minor.

### Architecture latent items (static-traced from the 3 cartographers — confirm in later states)
Logged per "log EVERY issue." See `docs/ARCHITECTURE-AS-IS.md` for full traces.
- **A-S5** `[LATENT·High]` — stale-beat 409 is reconciled by **parsing the error message string** while the engine's structured `{code:"stale-beat",beatSeq,board}` body is discarded → a wording drift turns reconcile into fail-closed. **Confirm in State-3 concurrency.** (`chat_helpers.py:405/474`, `orwell_engine.py`)
- **A-S4/D2** `[LATENT]` — manual `orwell:gamechanged` dispatch allowlist (`chat.js:2289`) → silent HUD staleness for any unlisted mutating tool.
- **A-S3** `[LATENT]` — stale-409 on `recordInteraction`/`makeDeal`/`moveTo` is skipped → can drop a scene's only consequence fold (non-degradation tension).
- **A-render** `[LATENT]` — duplicated live (`chat.js`) vs reload (`chatRenderer.js`) render engines with in-file-documented drift (the central FE maintainability smell).
- **A-settingsModule** `[LATENT]` — `window.settingsModule` referenced (`orwellOnboarding.js:283`) but never assigned → silent dead fallback.
- **A-data-user** `[LATENT]` — `body[data-user] || ""` collapses per-user client-storage keys to a shared namespace if the attr is ever absent (client-layer isolation hygiene; not the Vault).

### Model-config baseline (confirmed, narration lens)
Live game turn sends **no explicit `max_tokens`** (provider default governs ⇒ low main-turn truncation
risk); **no `reasoning_effort`/`high`/`xhigh` knob wired** anywhere — DeepSeek at default reasoning, FE
consumes+scrubs reasoning deltas. (`llm_core.py:21/1371`, `agent_loop.py`.)

*Outstanding State-1 coverage to close next turn:* settings tab-by-tab capture (trigger = bottom-left
user-bar gear; neutralize onboarding first), and identify F-S1-H/F-S1-J endpoints/element.

## STATE 2 — Onboarding / live casting interview (DeepSeek-V4-pro, LIVE) — findings
Driven **live** on desktop + mobile with a consistent human-authored persona (social-butterfly
"Robin Vale"). First state exercising real DeepSeek narration. Artifacts:
`.audit-telemetry/shots/state2-{desktop,mobile,b4}/`.

### Verified GOOD (do not regress)
- **Casting flow works end-to-end live, both platforms:** producer opener (L5 — producers speak
  first) → incremental **engine-grounded `updateCasting`** (casting.known populated correctly:
  playerName→backstory→motivation→personaArchetype→strategyStyle→interviewNotes) → `createCharacter`
  → premiere move-in (L31 tutorial card + populated 15-NPC roster gadget).
- **Producer persona is excellent** — sharp, consistent, *perceptive* (caught the persona deflecting
  the same question 3× — "three different ways to say 'I play nice'"). Real behavioral fidelity.
- **0 real machinery leaks** (the turn-02 "let me try" flag was an in-character producer line — a
  false positive of the over-broad `LEAK_RE`, not an operator aside).
- **Debug-note #1 (mobile casting short-circuit) — ✅ VERIFIED FIXED:** mobile ran a FULL interview
  (all fields by turn 3), `createCharacter` at turn 5 — **no** force-finalize to floater after
  name+photo. The `finalizable` floor holds on mobile.
- **B4 (houseguest invention) — ✅ NOT reproduced** (clean run): narration grounded to the real
  roster (Andre Barton / Penny Yu / Andres Ware ∈ roster); the only non-roster hits were "Big
  Brother" (GM) + "Kansas City" (place). The earlier "Gemma Meyer" was a **stale-session test
  artifact** (engine wiped without resetting the FE session), not a live invention.
- Desktop casting: **0 console errors** (avatar 204 fix holding).

### Findings
| ID | Sev | 👁 | Finding | Evidence | Mechanism / direction |
|----|-----|----|---------|----------|----------------------|
| **F-S2-A** | High Polish | ✅✅ **VERIFIED FIXED** | The gating **"Your Cast Photo" card overlapped the producer narration** — frosted translucency let the GM text bleed through → collision on the first casting beat. | `state2-{desktop,mobile}/00-opener.png`; verify: `state2-verify/*-cardview.png` + `*.json` **bgAlpha 0.32→1, backdrop none** | **FIXED (this gate):** the gating `#orwell-headshot` dialog floats over the live (non-blocking) interview, so under the frosted theme its 32%-opacity glass bled the narration through. Added a higher-specificity `body.theme-frosted #orwell-headshot.ow-window` override → **opaque** fill + no backdrop blur (every other window stays frosted). Re-captured both platforms: card opaque, narration reads cleanly beside/below it, no bleed-through. `style.css` only. |
| **S2-1** | POLISH | ✅ | **Model under-finalizes casting** — probes for the optional `privateStrategy` past `finalizable=true` (desktop needed an explicit "lock it in" at turn 6/7; mobile finalized turn 5). | desktop beats 04→06; mobile beats | Structural **"Enter the house"** affordance when `finalizable` (the prior S2-1/S5-1 direction; mirrors the FE's `advanceGame` error-correction). |
| **F-S2-B** | POLISH (deferred) | ✅ | 2× console 404 during/after a casting stream. | `state2-verify/*.json` net4xx | **Identified (not avatar/icons — those exist):** `404 /api/research/status/<id>` (an inherited **deep-research poller firing in the game build** — should be feature-gated off) + `404 /api/chat/stream_status/<id>` (a resumable-stream probe for a **finished** stream id). **Deferred** — gate research in game build + quiet the stream-status probe; touches feature-gating / stream lifecycle, low value, not this gate. |
| **F-S2-C** | NOTE | ~ | Possible narration spelling "Bohemeian" (Bohemian?) in the move-in — low confidence (may be extraction noise). | `state2-b4/_b4.json` tokens | Verify in a clean read; if real, a model spelling slip (minor). |

### Tooling / methodology learnings (logged so future states run cleaner)
- **`LEAK_RE` is over-broad** — `let me (check\|record\|see\|try)` flags in-character "let me try
  again". Tighten to operator-aside phrasing ("let me check the game state/the engine/record") so the
  narration-fidelity gate doesn't false-positive on dialogue.
- **Engine reset MUST be paired with a fresh FE chat session** — wiping `engine-data` without
  resetting the FE session shows stale history against the new roster (the "Gemma Meyer" confound).
  Clean runs start via `#sidebar-new-chat-btn` (README §3).
- **GOOD resilience (VIEWED):** the model self-recovers from a stale-history/fresh-engine desync —
  "Whoa, let's back that up. You're still in the casting" — rather than running with stale state.
- The `OVERLAP_SCAN` / copy-smell instrument still needs the ancestor-descendant + sibling-concat
  hardening noted in F-S1-K.

### F-S1-G (latent S1-1) — partial resolution
F-S2-A **is** the "casting overlay over content" case F-S1-G predicted — but it overlaps the GM
**narration**, not the welcome `.welcome-name` (the onboarding card was dismissed by "Meet the
producers" before the cast-photo card mounted, so `.welcome-name` co-occupancy wasn't triggered).
F-S1-G stays a latent structural note; **F-S2-A is its concrete, fixable manifestation.**

## STATE 3 — Core gameplay loop (IN PROGRESS) — concurrency parity
Game instantiated via the admin debug door (started, premiere, 15-NPC **diverse** roster — varied
archetype/age 22–47/ethnicity/demeanor/body, L28 visible; `/api/orwell/state` is **Vault-free** —
public facets only, no hidden secrets/goals/stats). Two-window **same-identity** parity (two devices,
same user, same game), one live mutating turn in window A. Artifacts: `shots/state3-parity/`.

### Two-window concurrency parity — split verdict (reconciled with ADR 0008 / the parallel S3-RACE lane)
- **Shared ENGINE/HUD state: ✅ CONSISTENT.** cp0 (idle) A==B identical; after a live turn in A
  mutated the engine (`beatSeq 2→11`, met 1→8, moved to kitchen), **Window B reconciled within ~3s**
  (0064 push beating the 20s poll floor) and **A==B at 24s**, both matching engine truth. VIEWED both
  frames: identical roster + presence HUD. **This corroborates ADR 0008's finding that the engine is
  "perfectly consistent throughout"** — the closed-set `beatSeq` spine (0065) is solid.
- **The FE CHAT CONVERSATION is the "garbage" bug — REAL, now authoritatively root-caused (ADR 0008).**
  The chat log is **FE-owned** (FastAPI session DB, replicated over the 0064 SSE channel), NOT engine
  state. A parallel auditor's **S3-RACE** lane reproduced it **10/10** (two tabs' rendered conversation
  diverges + accumulates under concurrent/active writes; a manual reload reconciles ⇒ persisted log
  intact, live FE-replication failure). Root cause (ADR 0008): a replicated log with **no merge
  discipline** — (1) no ordering key (`uuid4` + non-unique `timestamp`), (2) optimistic sender never
  reconciles post-`[DONE]`, (3) `hasActiveStream` gate drops the peer's events. **Fix = ADR 0008**
  (FE-side `seq` + render-by-id reconcile + `{id,seq}` dedup + a completion broadcast) — **operator-owned,
  deferred.** Not re-investigated here (root-caused + owned).
- 2× console errors per window = the **F-S2-B** research-status / stream-status 404s (already logged).

### Findings
| ID | Sev | 👁 | Finding | Evidence | Mechanism / direction |
|----|-----|----|---------|----------|----------------------|
| **F-S3-A** | → folded into **ADR 0008** | ✅ | Window B's **chat** showed divergent/stale narration ("Penny Yu", "Andre Barton" — not on this roster) vs the current-roster HUD. | `state3-parity/cp2-24s-B.png` | **This is a (single, confounded) sighting of the S3-RACE / ADR-0008 chat-replication divergence** — my caution about the debug-door stale-session confound was right to flag, but the parallel lane's looped 10/10 reproduction proves the underlying defect is real (FE chat log, no merge discipline). **Authoritative root cause + fix: ADR 0008 (operator-owned).** A latent sub-question it also covers: stale chat sessions across a restart. Closed here — tracked by ADR 0008. |

### S3-CORE engine-bypass re-verify (the prior launch-blocker) — ✅ PASS
Drove the live loop to the first HOH competition. Artifacts: `shots/state3-core/`.
- **NO engine bypass.** When the engine raised the player's `comp-round` decision, the model
  **surfaced the structured decision card** ("Competition round — your approach this round") and did
  **NOT** invent an HOH or narrate past the pending — narration stayed consistent with engine truth
  (phase=`hoh-competition`, pending=`comp-round`, hoh=null) across every turn. The pending-decision
  barrier (`chat_helpers.py`, #444/#447) BINDS.
- **Engine-grounded outcome, no invention.** Resolving the comp-round cards ran the staged comp and
  the engine crowned **Karl Duncan (HOH)** — a **real roster member** — then auto-progressed HOH →
  noms (**Jada Small + Arjun Patton**, both real) → veto-competition. VIEWED `hoh-crowned.png`: the
  narration names the real HOH + nominees and the HUD reads "Week 1 Veto Competition" in lockstep.
- **Anti-sycophancy holds:** the player (Robin) did NOT win the HOH just for declaring intent — a real
  NPC (Karl) did. The deterministic core decided; the LLM narrated.
- **S4-1 escape hatch works:** the structured decision card surfaced for the player's `comp-round`
  pending and resolving it through the route drove the engine correctly.

### State-3 verdict
**No new launch-blocker.** The closed-set engine + the narration→engine handoff are solid on current
code: the prior S3-CORE engine-bypass is fixed/holding, the shared engine/HUD is consistent across
windows, and the decision card is reachable. The one real concurrency defect — the **FE chat-log
divergence** — is **ADR 0008 (operator-owned)**; movement-grounding refinements are **ADR 0009**.

## STATE 4 — Resolution & endgame (fast-forwarded via the L38 God-Mode lever) — findings
Drove the game to completion via `POST /api/admin/ops/advance-to-finale` (L38 — reads no Vault).
14 weeks, `moment:post-season`. Artifacts: `shots/state4/`.

### Verified GOOD (do not regress) — the endgame is excellent
- **Winner Taylor Wong** (real roster); **player Robin Vale → `status:jury`** — the player-loss /
  juror path works (0046).
- **Retrospective Vault-unseal is rich + engine-true: 2037 hiddenStory events** across 13 types —
  Confessional 492 · Whisper 301 · Conflict 264 · Alliance 224 · Strategy 200 · Bonding 197 ·
  Showmance 112 · Betrayal 79 · Secret-thread 67 · Surfacing 53 · Hidden-side 39 · Deal 7 · Hidden-tie 2.
  **The behavioral-fidelity (#1) + non-degradation (#4) mandates are delivered** — the off-screen
  society accumulated over a full season, never thinned.
- **E12 secret-ballot per-voter unseal** post-season works (13 weeks of votes with per-voter attribution).
- **Endgame UI (VIEWED `postseason-desktop.png`, both platforms):** the retrospective window ("📼 The
  Season, Watched Back") + the "✨ A New Season" keep/recast card render cleanly. **L43 (retro ⊕
  new-season collision) FIXED** — both stack in the right rail, none off-screen.
- **Vault Wall HOLDS:** Vault-free projections + leak-free narration throughout play; the Vault
  unseals **only** post-finish in the retrospective (the one sanctioned reveal, 0048); the God-Mode
  fast-forward reads no Vault (L38).

### Findings
| ID | Sev | 👁 | Finding | Evidence | Mechanism / direction |
|----|-----|----|---------|----------|----------------------|
| **S4-2** | POLISH (partial) | ✅ | **Stale endgame projections.** `/status` NOW carries `finished:true` + `winner` (bd5e26e landed ✓), but **`/recap` + `/finale` still return empty/None winner post-finish** — the winner only lives in `/retrospective.winner`. | direct route probes post-finish | Residue of the 2026-06-19 S4-2: have `finaleView`/`recap` return the final result (not null) once decided, so every surface agrees. FE recovers via `/state moment:post-season` → retrospective, so non-blocking. |
| **F-S4-A** | NOTE (tracked) | ~ | **112 Showmance** hiddenStory entries in one 14-week season — possible volume (the L40 "showmance overload" family). | retrospective type histogram | Entries ≠ distinct showmances (the 0059 staged spark→… emits multiple events per arc), so not necessarily overload — but worth confirming the count maps to a *sparse* set. **Tracked by L40 (◐) / 0059** — not re-investigated. |
| **F-S4-B** | NOTE | ~ | New-season "season portrait" file control may be the raw `<input type=file>` (S4-3 family; #436 says S1-3 styled via `::file-selector-button` on main — verify it covers this one too). | `postseason-desktop.png` | Confirm the styled file control applies to the new-season card. Minor. |

### Failure modes — fault-injection probe (executed) — ✅ graceful degradation
Injected three faults on `/api/chat_stream` via Playwright. Artifacts: `shots/state4-fault/`.
**In EVERY case: no engine desync (beatSeq stable on a failed turn), no crash, no stuck spinner,
composer re-enabled (player can retry).** Strong for launch robustness.

| ID | Sev | 👁 | Finding | Evidence | Mechanism / direction |
|----|-----|----|---------|----------|----------------------|
| **F-S4-C** | POLISH | ✅ | **Upstream 502** renders the **raw error text as a "Big Brother" GM message** ("Big Brother … upstream model error") — graceful (no crash/stuck/desync, retry works) but immersion-breaking (error voiced as in-game narration). | `state4-fault/error.png`, `_fault.json` | Render a model/stream error as a distinct **system/error notice**, not a GM bubble. |
| **F-S4-D** | POLISH | ✅ | **Truncated stream (dropped socket mid-message)** renders the partial content and **silently stops** mid-sentence ("…and then the lights—") — no error, no "interrupted/reconnect" affordance, no completion footer. | `state4-fault/truncate.png`, `_fault.json` | Detect an incomplete stream (no `[DONE]`) and surface a **"message interrupted — reconnect/retry"** affordance. |
| **F-S4-E** | ✅ GOOD | ✅ | **Mid-stream reload RECONCILES** — the engine completed the turn server-side (`beatSeq 1→15`) and the reload rendered the **full** narration (the "stuck spinner" flag was a false positive — a collapsed admin thinking accordion). Corroborates ADR 0008's "a manual reload reconciles." | `state4-fault/rejoin.png` | (No action — positive result.) |
| **F-S4-F** | suspected | ✅ | The **rejoin (post-reload-resume) turn drifted two roster names**: "Lake Fleming" / "Nina Howser" vs the real "**Luke Fleming**" / "**Nina Hoover**" — close-but-wrong (name DRIFT, not B4 invention). | `state4-fault/rejoin.png` vs `/state` roster | **Confounded by the rejoin context** (a resumed turn may carry a degraded/partial context → name-grounding slip). Exact-name grounding was perfect in normal play (S3-CORE/B4). **Needs a clean check:** does name drift reproduce in normal play, or only on resume? If resume-specific, it ties to the ADR-0008 / resumable-stream context handling. |

## STATE 3b — Seeded deep-casting parity: narrated storyline vs engine SEEDED truth — ✅ PASS
**Question (PO 2026-06-21):** do the live narrated storylines accurately reflect the engine's
**seeded** deep-casting characteristics (physical / demeanor / vocation / hometown / age / backstory),
or do they drift/invent? Fresh seeded game (seed 31337); seeded truth dumped to
`.audit-telemetry/seeded_profiles.json`; live drive `seeded_parity.mjs`; artifacts `shots/state3b-seeded/`.

### Two layers
- **STRUCTURAL — grounding is fed + guaranteed.** `momentPrompts.ts` feeds each roster line the seeded
  **vocation + hometown** (`:701`), the **demeanor** to voice (`:702`), and the **appearance authored
  from the SAME `physicalCharacteristics` facet the portrait uses** (`physicalFacetToAppearance`, `:645`),
  plus hard rules: *EXACT names, NEVER invent/rename/substitute* (`:246`) and *appearance once, then
  behavior* (L23, `:256`). **Tested:** `appearanceConsistency.test.ts` (L29) proves the facet is the
  **single source** — the prose `appearance` is *derived* from it and cannot contradict, and narration +
  portrait read the same source. (+ `momentOrchestration` / `deepProfileCoherence` / `postSeasonGrounding`.)
- **EMPIRICAL — the model HONORS it (VIEWED).** Probed 3 houseguests deeply; **every** facet matched the
  seed **exactly**:
  - **Hugo Cabrera** (37, welder, terse): petite/slight ✓ · medium-brown skin ✓ · close-cropped fade ✓ ·
    even symmetrical face ✓ · freckles-across-nose ✓ · 37 ✓ · terse→"unreadable" ✓.
  - **Elena Powers** (30, trucker, warm/bubbly): tall/willowy ✓ · fair-warm complexion ✓ · strong
    cheekbones ✓ · small nose ring ✓ · salt-and-pepper buzzcut ✓ · 30 ✓ · warm→"first to break the ice" ✓.
  - **Hassan Mercado** (23, escape-room designer, stoic): petite/slight ✓ · warm-tan ✓ · braided dark
    hair ✓ · sharp angular face ✓ · scar-above-eyebrow ✓ · 23 ✓ · **Peoria IL ✓ · escape-room designer ✓**
    · stoic→"carries it like armor" ✓.
  - **Names exact** (`exactNameHits`: Hugo/Elena/Hassan; the only "drift" flag was "West Virginia", a
    place — a fuzzy false positive). Decision card + roster all real names.

**Verdict: the seeded deep-casting parity HOLDS in normal play** — the deep-profile (0058) +
`physicalFacetToAppearance` (L28b/L29) work pays off; the narration is a faithful rendering of the seed,
no drift/invention. This also **confirms the earlier F-S4-F drift was RESUME-CONTEXT-SPECIFIC**, not general.

### The gap that "needs to be tested for"
The structural single-source parity is already guarded (`appearanceConsistency`), and normal-play fidelity
is confirmed. **The one untested risk is the RESUMABLE-STREAM RESUME PATH (F-S4-F):** a mid-stream reload
resumed a turn that drifted "Luke Fleming"→"Lake Fleming" / "Nina Hoover"→"Nina Howser" — a degraded/partial
context on resume losing name+facet grounding. **Recommended new gate:** assert the resume path
reconstructs the FULL seeded GAME-CONTEXT roster (exact names + facets) so grounding can't degrade on
resume (FE-side; ties to ADR 0008 / the resumable-stream handling). *(A metamorphic empirical gate — the
`seeded_parity.mjs` harness distilled to "narrated facets ⊆ seeded facets" — is the optional stochastic
backstop.)*

## State 5 — OOBE / casting polish (operator-reported, post-factory-reset first-open) ✅

Three operator-reported bugs on the first open after a **backend factory reset**. All three
ROOT-CAUSED, FIXED, and VERIFIED **before/after** with real-chromium telemetry + screenshots
(`.audit-telemetry/repro_d.py`, `repro_ab.py`; shots `problem-d-{before,after}.png`,
`problem-ab-{mounted,after-drag}.png`). *(Problem c — "first producer message concurrent with the
box" — was **retracted by the operator** ("that was my mistake"); the welcome → producers → kickoff →
ask-photo → box sequence is correct.)*

### ✅ Problem D — animated particle background not rendering on a fresh / factory-reset client
- 🌳 **Root cause (longstanding, PR #342):** `theme.js` `initThemeUI()` computed the boot pattern as
  `const _initPattern = (saved && saved.bgPattern) || (saved && THEME_DEFAULT_PATTERN[saved.name]) || 'none';`
  — both terms are `saved &&`-guarded, so with **no stored theme** (`saved === null`: brand-new player,
  cleared localStorage, or post-factory-reset with the server pref also `null`) it fell straight through
  to `'none'`. The COLORS resolve correctly for the default theme (`saved ? saved.colors : THEMES[DEFAULT_THEME]`,
  L975), but the PATTERN didn't — so telescreen's signature `perlin-flow` canvas never spawned. The
  design intent (L47-51) is explicit: a factory-reset / no-stored-theme session resolves to telescreen,
  whose default pattern is `perlin-flow`. *(NOT the A5 reduced-motion gate `e1ae963` — that only suppresses
  when reduced-motion is set; the repro confirmed reduced-motion OFF.)*
- 🚧 **Fix:** resolve the pattern for the ACTIVE theme name (reusing `activeName = saved ? saved.name :
  DEFAULT_THEME`, L855), exactly like the colors: `(saved && saved.bgPattern) || THEME_DEFAULT_PATTERN[activeName] || 'none'`.
- ✅ **VERIFIED before/after** (no-saved-theme client, reduced-motion OFF): **before** →
  `perlinCanvas=False`, no `bg-pattern-*` class (flat dark bg); **after** → `#perlin-flow-canvas` present,
  `bg-pattern-perlin-flow` class. Unit gates green (`test_a5_a6_house_polish`, `test_0057_ui`,
  `test_fe_final_batch` — the reduced-motion gate + per-house pattern map untouched).

### ✅ Problems A/B — "Your Cast Photo" box: movable-looking grip but static; must be moveable, not resizeable
- 🌳 **Root cause:** the box (`orwellHeadshot.js`) was created `draggable:false, resizable:false` on the
  `top-right` slot, then **hard-pinned viewport-centered with `!important`** (`left:50% … translateX(-50%)
  !important`). Inline non-important styles lose to `!important` CSS, so the kit's drag (which writes inline
  `left/top`) could never move it — the titlebar *looked* like a grip (kit chrome) but was dead.
- 🚧 **Fix (3 files):** (1) `orwellSlots.js` — add a **`top-center`** slot (the `(innerWidth-w)/2` centering
  branch already exists for `*-center`; added to the registry + the narrow-sheet loop). (2) `orwellHeadshot.js`
  — `slot:"top-center"`, `draggable:true`, `resizable:false`; **removed the `!important` position pin** (kept
  width/z-index only). The slot now owns centering + the persisted drag offset; the kit owns the live grip.
  (3) `tests/test_0064_salvage.py` — re-pinned the gate test from the old `!important`/`translateX(-50%)` to
  the new `slot:"top-center"` + `draggable:true`/`resizable:false` mechanism.
- ✅ **VERIFIED on the REAL window** (drove the actual `route()→mount()` via stubbed pre-game casting state):
  **centered** (cx=720 = viewport center) ✓ · **draggable/grip-live** (`elementAtGrab='ow-title'`,
  `modal-dragging=True`, moved 480,52 → 240,232 = **420px**) ✓ · **NOT resizeable** (edge-drag dW=dH=0, no
  `winsize-` key) ✓. Full FE suite: **1743 passed**; the cast-photo gate test green.
  - 👁 **Repro-artifact noted (not a code bug):** the synthetic harness left the `#orwell-onboarding`
    welcome overlay (z:99999, `inset:0`) on top of the box, eating the mousedown — because the harness
    never clicked "Meet the producers". In the real sequence that overlay is `el.remove()`'d on dismiss
    **before** the box appears mid-interview, so the grip is clear. Removing the stale overlay in the repro
    (mirroring the real DOM state) made the drag pass.

### ✅ "Skipping the welcome" after a backend factory reset — FIXED (owner authorized "clear on new season")
- 🌳 **Root cause:** the per-user `localStorage['orwell-welcome-seen:<user>']` reload-debounce is cleared
  only by the **client-initiated** restart hooks (`settings.js` reset-progress, `orwellNewSeason.js`) via
  `_orwellMarkRestart → clearWelcomeSeen()`. A **backend/host** factory reset runs server-side and never
  reaches those hooks, so a returning browser took `route()`'s `else` branch (welcome already "seen") and
  skipped the welcome on the new season's first open — though the design (L561) says it shows "on EVERY
  fresh game/season".
- 🚧 **Fix (`orwellOnboarding.js`):** in `route()`, clear the stale marker when the engine reports a
  **genuinely fresh casting** (server-derived: `casting.known` has no captured fields) that **this tab
  session never opened** (`SEAT_TAKEN_KEY` captured **before** `openFreshInterviewSession()` can set it).
  The server-derived empty-intake signal survives a backend reset (the wiped engine starts empty), and the
  seat gate kills the post-dismiss race (marker just set + producer turn in flight is **not** mistaken for
  a new season). No engine change; back-compatible.
- ✅ **VERIFIED in-browser** (`repro_welcome.py`, stubbed pre-game state + model): **new season / fresh tab**
  (stale marker, no seat) → welcome **re-shown**, marker **cleared** ✓ · **same-session mid-interview reload**
  (marker set, seat taken) → welcome **NOT re-popped**, marker kept ✓. New source-pin gate
  `test_welcome_reshows_after_a_backend_reset_via_fresh_intake`; `test_oobe_onboarding` green (31 passed).
- 📌 **Known residual edge (documented):** a hard same-tab F5 *immediately* after a backend reset keeps the
  tab's `sessionStorage` seat flag, so that one path still skips — fully closing it needs a server-side
  per-game nonce (out of scope for launch-week OOBE polish; the common reopen / new-tab path is fixed).

### Environmental (pre-existing, NOT a regression)
`test_h2b_all_model_pools::test_runtime_every_model_select_offers_a_subset_of_the_chat_pool` and
`test_h2h3_settings::test_runtime_image_options_are_a_subset_of_chat_options` fail in THIS reset container
(Playwright TimeoutError — "runtime" browser tests needing a configured model). **Confirmed pre-existing**:
they fail identically with my changes stashed. CI fixtures configure a model; not in scope here.

## State 6 — post-OOBE specialist sweep (read-only fan-out; one-writer reconcile) 🔍

Three read-only specialists dispatched on the surfaces State 5 touched + the carried-forward
consistency launch-blocker. Findings reconciled by the lead; fixes (if any) applied single-threaded.

### ✅ consistency-parity — RETURNED

**Target 1 — ADR 0008 (chat cross-tab "garbage" divergence): NOT-PRESENT (operator-owned).**
The **ADR document** `docs/decisions/0008-chat-conversation-consistency.md` is merged but status
**`Proposed` / "awaiting implementation authorization"** — the *implementation* is NOT on the tree
(matches the owner's "I will implement later"). The divergence is still reproducible **by
construction**; three [BLOCK]-class root causes survive verbatim (high confidence, source-traced):
- **F1 — no ordering key.** `ChatMessage` (`frontend/core/database.py:161-188`) has only a random
  `uuid4` id + a non-unique `timestamp`; every render/history path orders by `timestamp` and the
  `/api/history` payload carries **no `seq`**. Two near-simultaneous writes tie on `timestamp` →
  SQLite tie-break unspecified → cross-tab reorder. Intended model (server-ordered convergent log)
  vs actual (optimistic-append over at-least-once SSE treated as exactly-once).
- **F2 — busy tab drops peer events.** `sessionSync.js:48-63` `hasActiveStream` gate discards the
  peer `run-started`/reconcile signal; `softReloadHistory` (`chat.js:3517-3568`) self-guards on the
  same flag; the streaming game-turn path (`chat_routes.py:1361-1364`) emits only `run-started`,
  never a completion `message-added` → a tab that missed the one-shot event never converges.
- **F3 — optimistic sender never reconciles** (`chat.js:692-694`): the user/reply bubbles are a
  permanent local guess with no temp-id→canonical-`{id,seq}` merge.
- **Reconciliation/ruling:** **operator owns this** (explicitly deferred). NOT fixed by the audit.
  The trace above *is* the implementation spec when the owner picks it up (it mirrors ADR 0008's own
  items 1–4). Do **not** leaf-patch with a `softReloadHistory`-on-DONE (still `timestamp`-ordered +
  self-guarded — the ADR's own rejected alternative). **Launch-blocker-class, owner-tracked.**

**Target 2 — my State-5 welcome-marker change: WORKING AS INTENDED (verified safe).**
No bad interaction with 0064 cross-device sync or 0065 `beatSeq`. The marker is `localStorage`
(per-device, never synced); there is **no `storage` listener** and `orwellOnboarding.js` does **not**
listen for `orwell:gamechanged`, so a cross-device `game-updated` can't re-fire `route()`. The clear
is triple-gated (`started===false` early-return at route()'s top → `_intakeEmpty` → pre-call
`!_seatTakenBefore`), and `casting.known` populates on the first captured answer, closing the window
after turn one. The comment's "purely local, no desync risk" is accurate. *(LATENT note: the gate's
safety depends on onboarding never gaining an `orwell:gamechanged` listener; if one is ever added the
`started===false` early-return must stay the first gate — worth a one-line comment, not a fix.)*

### ✅ responsive-cross-platform — RETURNED
The `top-center` slot change is **structurally sound**: across 390/375/360/320px the box reflows to a
top sheet with **zero horizontal overflow, no clipping** (WCAG 1.4.10 holds), all three action buttons
≥44px (2.5.5/2.5.8 pass), never covers the composer. Actionable items (mine to fix; HELD until the
animation specialist finishes reading these files):
- **F1 — should-fix (mine):** the mobile "sheet" isn't full-width — `#orwell-headshot { max-width:
  min(92vw,480px) }` (`orwellHeadshot.js:43`) fights the narrow sheet host's `left:0;right:0`
  (`orwellSlots.js:119-134`), leaving a one-sided **~26–31px dead right gutter** at every mobile width
  (left-pinned, not flush). Not a clip (no overflow) — but defeats the sheet intent. Fix: gate/relax the
  `max-width` to the wide tier (or `restackNarrowSheets` sets `max-width:none` on narrow entries).
- **F4 — should-fix (kit-level; surfaced by my change):** the titlebar keeps `cursor:move`
  (`orwellWindow.js:91`) + tooltip "Drag to move · arrows to nudge" (`orwellWindow.js:345`) on touch
  where drag is dead (`windowDrag.js:349-350`, `mobileSkip:768`) — a misleading affordance. Fix at the
  KIT (`≤768px` → `cursor:default`, omit the tooltip below `mobileSkip`) so every kit window benefits.
- **F2 — nit (mine + kit):** body max-heights use fixed `vh`/`100vh` not `dvh` (`orwellHeadshot.js:46`,
  `orwellWindow.js:114`); on a keyboard-shrunk viewport the lowest exit "Skip for now" sits ~10px below
  the fold (reachable by internal scroll — `overflow:auto`, so not a block). Fix: `vh`→`dvh` (vh fallback).
- **F6 — nit (existing):** sheet top `TOP_BASE−8=44` overlaps the mobile hamburger by a 44×6px strip
  (tap centroid at y28 never occluded — visual only). Harden later via live-header-bottom + safe-area inset.
- **F3 — working as intended:** touch can't move the box on the mobile sheet tier (drag works ≥769) — by
  design; the sheet owns the top region, nothing to move it out of the way of. Do NOT add a touch handle.
- **F5 — working as intended + a design Q + a CLEANUP (mine):** desktop centering is fine on a clean user
  (cx=720); my earlier off-center reading was a **confound** — `repro_ab.py`'s drag PERSISTED a layout via
  0064 sync into `frontend/data/orwell_layout.json` (`orwell-headshot {x:4,y:412}`), replayed every load.
  → **Cleanup:** remove that stale entry so audit-admin's box re-centers. → **Design Q for owner:** should a
  one-time OOBE dialog persist/sync its drag geometry across reloads+devices for the season at all? (My
  draggable change enabled this.) Candidate: opt the cast-photo box out of geometry persistence.

### ✅ transient-animation — RETURNED
Both headline changes are **fundamentally sound** (VIEWED across the full lifecycle): perlin canvas
spawns cleanly, honors reduced-motion exactly, tears down with zero orphans even under 30ms rapid
cycling, never escapes z:0; the OOBE chain has a single open animation (no double-anim), Escape-dismiss
leaves no orphan, and the box centers (cx=720) + drags (420px) on a clean layout. Findings:
- **A-F2 — [BLOCK]:** **"Skip for now" is not durable.** On a failed/lagged `POST /api/orwell/casting/photo`
  the engine keeps `castPhoto` in `missing`, so the 4s poll / `orwell:gamechanged` re-fire `route()`→
  `mount()` and the box **re-appears — the player is trapped** with the welcome splash hidden. Root:
  `onCastingPhotoSkipped` (`orwellHeadshot.js:440`) tears down + `recordPhotoStep` swallows the error
  (`:429`), and `route()` decides purely from engine state with **no local skip latch**. Pre-existing (not
  my change), but a real player-trap on a flaky connection.
- **A-F3 — [LATENT]:** `teardownWindow()` (`orwellHeadshot.js:449`) does NOT clear
  `body.ow-casting-headshot-open` (only `unmount():457` does) → the welcome splash stays pinned `opacity:0`
  in the gap between teardown and the next `route()→unmount()`. Compounds A-F2 (one-liner fix).
- **A-F1 — [LATENT]:** perlin canvas **pops in after** the app-loader scrim under a slow `/api/prefs/theme`
  read (~1.8s bare telescreen bg; loader-REMOVE t=1015ms vs perlin-MOUNT t=2849ms). The first-paint
  head-script synthesizes telescreen colors but **no `bgPattern`**, so the static class isn't present until
  `applyBgPattern` runs at the end of `_initWithSync` (after an awaited `_loadFromServer`). Adjacent to my
  State-5 perlin fix (timing). Fast loopback masks it.
- **A-F4 — [POLISH]:** ~120–180ms welcome→box handoff splash flash (welcome removed → full-opacity splash →
  box covers it). `ow-onboarding` cleared before the box mounts.
- **A-F5 — working-as-designed + the SAME design Q as responsive-F5; the specialist REPAIRED the
  `orwell_layout.json` confound back to centered `{x:480,y:52}` (cleanup DONE).**

### 📋 State 6 — consolidated remediation plan (reconciled across all three specialists)
Mine / found-blockers to fix (all clearly-correct, low-risk):
- **R1** (resp-F1): gate `#orwell-headshot` `max-width` to the wide tier so the mobile sheet goes flush
  (kills the ~26–31px right gutter). — `orwellHeadshot.js` / `orwellSlots.js`.
- **R2** (resp-F4, kit): under `≤768px` set `.ow-titlebar{cursor:default}` + omit the "Drag to move" tooltip
  below `mobileSkip` (every kit window benefits). — `orwellWindow.js`.
- **R3** (anim-F1): synthesize the default theme's `bgPattern` in the first-paint head-script so the static
  `bg-pattern-perlin-flow` class is present pre-boot (no bare-bg race). — `index.html`.
- **R4** (resp-F2/anim): `vh`→`dvh` (vh fallback) on the box body max-heights. — `orwellHeadshot.js` (+ kit).
- **R5** (anim-F2 **[BLOCK]**): a local skip/finalize latch that suppresses re-mount until a state read
  confirms `castPhoto` cleared; stop silently swallowing the `recordPhotoStep` failure. — `orwellHeadshot.js`.
- **R6** (anim-F3): clear `ow-casting-headshot-open` in `teardownWindow()` too (compounds R5). — `orwellHeadshot.js`.
Optional polish: **R7** (anim-F4 handoff bridge class), **R8** (resp-F6 hamburger overlap / safe-area).
Owner decision: **D1** (resp-F5/anim-F5) — should the one-time OOBE cast-photo box persist/sync its drag
geometry across reloads+devices for the season? *(Recommend: opt it out — it's a transient dialog.)*

### ✅ State 6 — remediation APPLIED & VERIFIED (owner authorized R1–R8 + D1=opt-out)
All applied; JS syntax clean; targeted FE tests green; before/after VIEWED in-browser (real modules,
stubbed state, fresh contexts — the shared game untouched):
- **R5 [BLOCK] — FIXED & VERIFIED:** skip + a 500'd `casting/photo` POST + 3 re-routes → box stays
  CLOSED, splash not pinned (`boxPresent=False, splashPinned=False`). Session latch `_photoHandledLocally`
  + `recordPhotoStep` retry-with-backoff. `orwellHeadshot.js`.
- **R6 — VERIFIED** (with R5): `teardownWindow()` now clears `ow-casting-headshot-open` (splash returns).
- **R1 — VERIFIED:** mobile sheet flush full-width at 390px (`left=0 right=390 width=390 rightGutter=0`).
  Narrow-tier `width:auto;max-width:none`. `orwellHeadshot.js`.
- **R2 — VERIFIED:** mobile titlebar `cursor='default'` + empty tooltip (was `move`); desktop drag intact
  (a/b VERDICT still all-PASS). Root: `windowDrag.js` no longer paints inline `cursor:move` ≤mobileSkip
  (the inline was beating CSS) + kit media query + JS tooltip gate. `windowDrag.js`/`orwellWindow.js`.
- **R3 — VERIFIED:** head-script synthesizes `bgPattern:'perlin-flow'` (class at first paint) + a faint
  static phosphor base for `body.bg-pattern-perlin-flow` (also the reduced-motion fallback); canvas still
  spawns (`#perlin-flow-canvas` present). `index.html` + `style.css`.
- **R4 — applied:** `vh`→`dvh` (vh fallback) on the box + kit body max-heights. `orwellHeadshot.js`/`orwellWindow.js`.
- **R7 — applied:** welcome→box handoff bridge class `ow-onboarding-bridge` (set on dismiss + 4s fallback,
  cleared on box mount) pins the splash across the gap. `orwellOnboarding.js`+`game-trim.css`+`orwellHeadshot.js`.
- **R8 — VERIFIED (visual):** narrow sheet top now clears the live hamburger bottom + GAP (no 6px overlap).
  `orwellSlots.js` `narrowTopBase()`.
- **D1 — VERIFIED:** the cast-photo box is `persistLayout:false` + no `slotKey` → it ALWAYS re-centers and
  a drag writes NO layout (the dragged 240,232 did NOT overwrite the stored centered entry; box opens
  centered cx=720). New kit `persistLayout` option + `_emit` funnel. `orwellWindow.js`+`orwellHeadshot.js`.
- **No regressions:** a/b (centered/draggable/not-resizeable) + d (perlin) repros still all-PASS.

## Status legend
🔍 investigating · 👁 VIEWED · 🌳 ROOT-CAUSED · ✏️ FIX-DRAFTED · 🚧 FIX-APPLIED · ✅ VERIFIED · ⏸️ needs-owner-input
