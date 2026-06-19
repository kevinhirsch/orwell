# 2026-06-19 — E2E Smoke-Test & HCI Audit: Run Plan (3 personas, full live RPG)

**Status:** run plan for the 2026-06-19 pre-launch E2E audit · companion to `README.md` (the
reusable playbook). Read the README first — this file records only what is *specific* to this run.
**Branch:** `claude/game-e2e-smoke-test-bhb9sd` · **Deliverable:** DOC-ONLY findings doc.

---

## Context

The game launches next week. This run is a rigorous, deterministic **End-to-End visual smoke
test + empirical UX/HCI audit** of the front-end and core loop, with **autonomously
provisioned visual telemetry** (Playwright screenshots → vision ingest — no manual
screenshots). It evaluates visual hierarchy / game feel ("feng shui"), Gestalt grouping,
cognitive load & affordance (Norman/Gibson/Sweller), and architectural/WCAG 2.1 AA
regressions across the whole first-time-user journey, and triages every defect into
**[Launch-Blocking]** vs **[High-Priority Polish]**.

It **reuses the committed harness** in this folder (`playSession.mjs`, `lib.mjs`,
`coreScenes.mjs`, `gameScenes.mjs`, `gameLoopUI.mjs`, `namesCheck.mjs`, `state1.mjs`) rather
than authoring new tooling — copy them into the git-ignored `.audit-telemetry/` to run.

## Decisions specific to this run

- **LLM (supplied by operator, OpenRouter):** base `https://openrouter.ai/api/v1`, model
  **`deepseek/deepseek-v4-pro`** (the README §9 verdict: escalate to `-pro` for
  grounding-critical play). Configured **through the Settings menu / `POST /api/model-endpoints`
  + `POST /api/auth/settings`** (§2c), never via source. **The API key is a session secret:
  it lives ONLY in `.audit-telemetry/.secrets.env`, and is NEVER committed, screenshotted,
  logged, or written into the findings doc. Remind the operator to revoke it when done.**
- **Multi-season shape: 3 distinct personas, full live RPG (operator's call).** Three
  sequential seasons, each cast with a *different* human-authored persona, **every season
  played fully live, turn by turn** through casting → conversations → ceremonies → finale →
  retrospective, then a fresh persona for the next season. This is the §4 roleplay
  methodology, not mechanical button-mashing. Personas for this run:
  1. **Social Butterfly** — Social-weighted, charm/bond-driven, floater-to-jury arc.
  2. **Comp Beast** — Physical/Mental-weighted, threat-forward, wins-out strategy.
  3. **Paranoid Strategist** — Mental-weighted, secretive, deal-and-betray play.
  (No hard-coded real names — the player persona is human-authored at OOBE per ruling #1.)
  Caveat: full live RPG × 3 seasons is long-running and token-heavy; capture screenshots at
  each *distinct UI state* per season (not every turn) and checkpoint between seasons.
- **Authentic casting flow (avoid the README confounders):** let the model run the **in-chat
  casting interview** to `createCharacter` for each persona — do **not** pre-create via the
  admin `new-game` door (§9 update: the door-vs-chat desync stalls play). Pin the model to
  `-pro` on each new session (the model-picker inherits the last-used model — drive the picker
  or create the session via API with `model=deepseek/deepseek-v4-pro`).
- **DOC-ONLY:** no product-code edits this run. Findings + proposed fixes (inline diffs at the
  README §6 remediation altitude) go into the deliverable; the operator applies them later.

## Execution (per the README, retargeted)

1. **Stand up the stack** (README §2): engine on **8765** (`npm install --ignore-scripts` →
   `npm run build` → `node dist/main.js`, `run_in_background`, deterministic embeddings ok);
   front-end on **7000** (venv, deterministic admin via `setup.py`, auth ON, game build ON,
   pointed at the engine); Playwright sandboxed in `.audit-telemetry` (`--prefix`,
   `PLAYWRIGHT_BROWSERS_PATH` inside the sandbox).
2. **Configure the model** through Settings (README §2c); verify `GET /api/default-chat` and a
   cheap `max_tokens:10` inference probe; confirm `GET /api/orwell/health → engine:true`.
3. **E2E capture → analyze → triage, one state at a time** (the standup→capture→analyze→
   remediate-draft→validate loop), surfacing each screenshot to the operator:
   - **S1 Initial instantiation:** login/first-run setup, main load, settings (all tabs),
     onboarding overlay states (engine-down F5 / no-model J4 / ready).
   - **S2 Onboarding:** the live casting interview per persona (producer prompts, prefilled
     composer, casting progress).
   - **S3 Core loop:** live HUD (sidebar status, gadget rail L/R, collapsed strip, mobile
     drawer), live narrated chat turns, presence/diary windows (drag/minimize/dock), cast +
     portraits, the 5 house themes, and the responsive matrix (320→1440 + 200% font).
   - **S4 Resolution/edge:** decision cards (noms/veto/eviction), finale panel, post-season
     retrospective (Vault-unsealed), new-season transition.
   - **S5 Multi-season RPG:** the 3 live seasons above, asserting the single restart door
     (`registry.resetUser` → `Orchestrator.forgetUser`) commits clean, **persistence
     non-degradation** (detail accumulates, never thins; no cross-season identity carryover —
     0004/0007), and no season-2+ stale-state / persona bleed-through.
4. **Per-turn defect classes** (README §5): houseguest invention (vs `GET /api/orwell/state
   house[].name`), engine bypass (outcome narrated but `GET /api/orwell/status` unchanged),
   machinery leaks (regex the visible message sans `.thinking-content`), decision
   double-surface, layout overflow/overlap, copy defects, console/page errors.

## Deliverable

- `docs/audits/2026-06-19-e2e-smoke-test-audit.md` — methodology, per-state analysis under the
  Phase-2 lenses, an exhaustive **[Launch-Blocking] vs [Polish]** catalogue, each finding
  backed by a cited PNG artifact, and proposed fixes as inline diffs (NOT applied).
- Update this folder's findings ledger (README §9) with the 2026-06-19 `-pro` results
  (especially the still-open B4/B5/B6 engine-discipline questions).
- Commit doc(s) to the branch, push, open a ready-for-review PR. `.audit-telemetry/`
  (sandbox, browsers, secrets, screenshots) stays git-ignored — never committed.
