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

## Live findings (this run) — appended as captured
*Provisional (to harden in the full State-1 fan-out — not yet final triage):*
- **F-S1-A** `[POLISH]` 👁 VIEWED — 2× `console.error: 401 Unauthorized` on the **unauthenticated**
  `/login` page (an authed XHR fires pre-auth). Evidence: `shots/state1/login-{desktop,mobile}.meta.json`.
  Root cause TBD — 401 is not a `requestfailed`, so add response-URL logging to name the endpoint.
  Mechanism hypothesis (unconfirmed): a poller/session-probe (`/api/...`) runs before the auth gate.
- **F-S1-B** `[POLISH]` 👁 VIEWED (calibrating) — login **password** field shows a right-side glyph
  while empty (appears to be an eye-slash reveal toggle on mobile — possibly the S1-4 fix already
  landed) **and** the **username** field shows a small dot glyph while empty. Affordance ambiguity.
  Evidence: `shots/state1/login-{desktop,mobile}.png`. Needs focus/hover/click-behavior capture
  before finalizing (differential: recommended eye-toggle fix vs. residual clear-X vs. validation dot).
- **No-overflow (good, VIEWED):** `/login` reflows clean at both viewports (`overflow:null`).

## Status legend
🔍 investigating · 👁 VIEWED · 🌳 ROOT-CAUSED · ✏️ FIX-DRAFTED · 🚧 FIX-APPLIED · ✅ VERIFIED · ⏸️ needs-owner-input
