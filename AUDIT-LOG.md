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
| **F-S1-C** | POLISH | ✅ | `/api/orwell/avatar` returns **404 on every authed load** (2×/load) → console-error noise. The S1-2 avatar-404. | `landing-desktop.meta.json` net log | Return **204/default** when no avatar set; gate the poller in game build. |
| **F-S1-D** | POLISH | ✅ | **`/api/orwell/state` polled ~13× in ~2.5s** on the zero-data landing (`/status` ~4×, `/models` ~3×) — heavy, pre-game. | `landing-desktop.meta.json` net log | **Traced:** `orwellOnboarding.js:569` fires `prewarm-cast` on landing → engine reports a `generation` record → `orwellCast.js` adaptive `FAST_POLL_MS=3500` engages; **AND ~10 gadget modules each fetch `/state` independently** (no shared coordinator). Each `/state` serializes in the engine's per-user queue (L18-adjacent). Fix: gate the cast fast-poll to a mounted cast window; coalesce gadget `/state` reads behind one shared poller. |
| **F-S1-E** | POLISH | ✅ | **model-picker button 148×21px** (`#model-picker-btn`, "deepseek-v4-pro") — sub-minimum tap target (WCAG 2.5.5/2.5.8). | `landing-desktop.meta.json` taps | min-height ≥24 (44 coarse-pointer). Confirm on mobile. |
| **F-S1-F** | POLISH | ✅ | **Settings is occluded by the onboarding scrim (z-index 99999)** on the zero-data landing — `#user-bar-settings` click can't open Settings until onboarding is dismissed. | `settings-desktop-open.png` (onboarding still up after click) | Differential: by-design focus (settings is admin-only) vs. accidental occlusion. Confirm a new player isn't blocked; consider an in-onboarding settings/escape affordance. (Echoes L2.) |
| **F-S1-G** | LATENT | trace | S1-1 **structural** latent: `#welcome-screen` is an abs-positioned overlay hidden only by `.hidden`; casting/headshot are separate overlays over the same region; soft body-class suppression hides `#welcome-tip/-sub` but **NOT `.welcome-name`**. | `ARCHITECTURE-AS-IS.md` §Seam-3; `style.css:2001`, `orwellHeadshot.js`, `orwellOnboarding.js` | Make welcome ⟂ onboarding/casting by construction (suppress `.welcome-name` too / remove from layout). **Verify in State 2** (headshot mounts mid-interview). |
| **F-S1-H** | POLISH | ✅ | **2× `console.error: 401`** on the **unauthenticated** `/login` page (an authed XHR fires pre-auth). | `login-{desktop,mobile}.meta.json` | Identify the endpoint (likely a theme/pref fetch pre-auth); gate behind auth or no-op when unauthed. |
| **F-S1-I** | NOTE | ✅ | Leftover **vendored-workspace copy ships in the game-build DOM** (hidden but present): "Import a file — the AI reads it and suggests candidate memories you can approve"; example preset "build-vllm-wheel"; workspace themes ("claude","GPT","cyberpunk"…) + model "north-mini-code:free". The S1-5 family. | `landing-desktop.meta.json` smells | Strip from the game-build template (low risk; not visible). |
| **F-S1-J** | NOTE | ✅ | Small **unidentified dot adornment on the empty username field** on `/login`. | `login-desktop.png` | Identify (validation indicator? stray). Minor. |
| **F-S1-K** | TOOLING | — | Audit instrument: the injected MutationObserver logged **0 mutations** on the landing (FE likely toggles `display` rather than mounting, or an init-script world issue). | `landing-*.meta.json` `audit.mutCount=0` | **Fix the observer for State-2+ transient capture** (not a product bug). Also harden `OVERLAP_SCAN` to exclude ancestor–descendant pairs (it false-positived S1-1) and the copy-smell scan (innerText concatenation across siblings yields spurious double-spaces). |

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

## Status legend
🔍 investigating · 👁 VIEWED · 🌳 ROOT-CAUSED · ✏️ FIX-DRAFTED · 🚧 FIX-APPLIED · ✅ VERIFIED · ⏸️ needs-owner-input
