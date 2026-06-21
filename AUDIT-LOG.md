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

### ⏸️ Follow-up finding (operator call) — "skipping the welcome" after a backend factory reset
The operator affirmed the welcome-first sequence is correct, so this is logged, **not** fixed. A **backend**
factory reset does not clear the **client** `localStorage['orwell-welcome-seen:<user>']`, so a returning
browser can take `orwellOnboarding.route()`'s `else` branch (welcome already "seen") and skip the welcome on
the new season's first open — matching the one-off "skipping the welcome" report. The design comment (L561)
says the welcome should show "on EVERY fresh game/season". **Question for the owner:** should a new-season /
factory reset call `clearWelcomeSeen()` (client-side) so the welcome re-shows each season? Ambiguous → owner's
call; no change made.

### Environmental (pre-existing, NOT a regression)
`test_h2b_all_model_pools::test_runtime_every_model_select_offers_a_subset_of_the_chat_pool` and
`test_h2h3_settings::test_runtime_image_options_are_a_subset_of_chat_options` fail in THIS reset container
(Playwright TimeoutError — "runtime" browser tests needing a configured model). **Confirmed pre-existing**:
they fail identically with my changes stashed. CI fixtures configure a model; not in scope here.

## Status legend
🔍 investigating · 👁 VIEWED · 🌳 ROOT-CAUSED · ✏️ FIX-DRAFTED · 🚧 FIX-APPLIED · ✅ VERIFIED · ⏸️ needs-owner-input
