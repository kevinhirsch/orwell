# REFACTOR-ROADMAP.md — Orwell pre-launch refactor roadmap

**Status:** Phase 4 deliverable of the 2026-06-21 pre-launch E2E playtest/refactor audit. Synthesized
from the Phase-0.5 gap analysis (`docs/ARCHITECTURE-AS-IS.md`) and the E2E findings (`AUDIT-LOG.md`),
cross-referenced to the live ADRs. **This is advice, not applied code.** Each entry is mechanism-first
and requirement-grounded — *no requirement → not in the list.* The lead owns this single document.

> **Headline:** the audit found the **engine + the engine-backed surfaces are launch-ready** (Vault
> Wall holds, anti-sycophancy holds, the live loop is engine-grounded, the retrospective accumulates
> 2037 hidden events, casting works on both platforms, concurrency of *shared game state* converges).
> There is **exactly one launch-blocking architectural defect** — the FE chat-conversation divergence
> (the "garbage" bug) — and it is already root-caused and owned (**ADR 0008**). Everything else here is
> **post-launch**, sequenced highest-leverage / lowest-risk first.

## How to read an entry
**Requirement / failure mode · Current (steelmanned) · Target · Blast radius · Risk · Effort ·
Dependencies/sequencing · Verification.** Severity per the brief: **[LAUNCH-BLOCKING]** (only those that
*cause* a launch-blocking bug — these route back into the Phase-3 gated remediation) vs **[POST-LAUNCH]**.

> **GitHub issue tracking (added 2026-06-23).** The highest-value post-launch latent, **R1c / A-S3**
> (a stale-409 dropping a scene's only consequence fold), is tracked as
> [#591](https://github.com/kevinhirsch/orwell/issues/591). The remaining R-items here stay roadmap-only
> until scheduled; file them as `type:enhancement` + `post-launch` issues when picked up. This document
> remains the mechanism-first design record.

---

## Executive summary
- **Launch-blocking (1):** **R0 — ADR 0008** the chat-conversation consistency refactor. The sole
  architectural change that *causes* a launch-blocking bug (concurrent-tab chat divergence, 10/10,
  accumulating — "no tolerance"). Root-caused + fix-specified + owned; route into pre-launch remediation.
- **Post-launch, highest leverage:** **R1** consistency-contract hardening (stale-beat structured body,
  auto-derived `gamechanged` set, stale-409 fold preservation) · **R2** collapse the duplicated
  live-vs-reload chat render paths · **R3** decompose the `chat.js` god-object + add the missing
  guardrail-lattice + FE-write-back test seams.
- **Post-launch, medium:** **R4** movement/location grounding (ADR 0009) · **R5** per-user client-storage
  isolation guard · **R6** the failure-mode UX (system-error notice, truncation affordance) · **R7** the
  polish bundle.

---

## R0 — Chat-conversation consistency (ADR 0008) **[LAUNCH-BLOCKING]**
- **Requirement / failure mode:** ADR 0003 — the conversation IS the game; it must be consistent across
  a user's tabs/devices. **S3-RACE:** two tabs diverge in their rendered conversation under
  concurrent/active writes, **10/10**, accumulating; engine perfectly consistent; reload reconciles
  (live FE-replication failure). PO: "no tolerance."
- **Current (steelmanned):** the FE chat log is FE-owned (session DB) + replicated over the 0064 SSE
  channel. It *intends* to be "a single authoritative server-ordered log every device renders from" — a
  sound model — but isn't built that way: no ordering key (`uuid4` + non-unique `timestamp`), an
  optimistic sender that never reconciles, and a `hasActiveStream` gate that drops the peer's reconcile
  signal. The engine half (0065 `beatSeq`) is already correct.
- **Target:** the id+`seq`-ordered authoritative log the code already claims — monotonic per-session
  `seq` (`UNIQUE(session_id, seq)`) under the existing `agent_runs` serialization; all render paths +
  `/api/history` order by `seq`; render-by-id + reconcile-not-replace; `{id,seq}` dedup replacing the
  suppression gate; a `message-added` completion broadcast; `resumeStream` attaches by run id.
- **Blast radius:** `core/database.py` (schema + migration), `session_manager.py` / `history_routes.py`
  (order-by), `chat.js` + `chatRenderer.js` (render/merge), `sessionSync.js` + `session_events.py`
  (dedup + broadcast), `chat_routes.py` (publish). **Engine untouched.** Vault Wall + cross-user
  isolation untouched (payloads stay ids/`seq`/types).
- **Risk:** medium — touches the chat render/sync core + a schema migration; mitigated by the contained
  scope and the binding test below. **Effort:** ~1 focused lane. **Dependencies:** none (engine ready).
- **Verification:** the permanent **two-tab concurrent-write parity gate** (the audit's looped harness
  distilled to a test) — both tabs converge byte-identically under concurrent writes, reload never
  *required* to converge. (My `parity_s3.mjs` two-window rig + ADR 0008's repro are the seed.)

---

## R1 — Consistency-contract hardening (post-ADR-0008) **[POST-LAUNCH · Wave 1]**
Three independent, low-risk fixes to the FE↔engine sync spine (audit A-S5 / A-S4-D2 / A-S3).
- **R1a — stale-beat reconcile on the STRUCTURED body, not the error string** (audit **A-S5**, highest).
  - *Requirement:* a wording drift in `StaleBeatError.message` must not silently turn reconcile into
    fail-closed. *Current:* the FE parses `"stale write refused"` + regex `"(now N)"` from the message
    and **discards** the engine's `{code:"stale-beat",beatSeq,board}` body (`chat_helpers.py:405/474`,
    `orwell_engine.py` reads only `.error`). *Target:* consume the structured body. *Blast radius:* the
    thin client + `_handle_stale_beat`. *Risk:* low. *Effort:* small. *Verify:* a test that drifts the
    message wording and asserts reconcile (not fail-closed).
- **R1b — auto-derive the `orwell:gamechanged` dispatch set** (audit **A-S4/D2**).
  - *Requirement:* a new mutating tool must refresh HUDs by construction. *Current:* hand-coded
    tool-name array (`chat.js:2289`); `test_g15` only checks known seams. *Target:* derive the
    mutating-tool set from one shared registry (the same source `INFRA_LEVERS`/`PLAYER_TOOLS` use), so a
    new write-back can't silently leave HUDs stale. *Risk:* low. *Effort:* small. *Verify:* extend
    `test_g15` to assert every registry-mutating tool routes through the one dispatcher.
- **R1c — preserve a scene's consequence fold on a stale-409** (audit **A-S3**).
  - *Requirement (mandate #4):* no consequence fold silently dropped. *Current:* a stale-409 on
    `recordInteraction`/`makeDeal`/`moveTo` is reconciled-and-**skipped**; the only recording of a scene
    can be lost. *Target:* re-attempt the fold against the refreshed `beatSeq` (the fold is
    re-derivable) rather than drop it. *Risk:* low-medium (must not double-apply — idempotency-keyed).
    *Effort:* small-medium. *Verify:* a test that forces a stale-409 on the sole recording and asserts
    the fold still lands once.

## R2 — Collapse the duplicated live-vs-reload chat render paths **[POST-LAUNCH · Wave 2]**
- *Requirement / failure mode:* one render path, so live == reload by construction. *Current
  (steelmanned):* `chat.js` (live SSE) and `chatRenderer.js:1898` (reload, 517 LOC) are **two render
  engines** re-implementing the same concerns (reply/reasoning split, `processWithThinking`, tool-beat
  chips, `orwellBeatOutcome`, OOC asides, role relabel); in-file comments document real drift
  regressions ("leaking all of it on every re-open", "a stack of identical beat rows"). `orwellToolBeats`
  exists *solely* to stop one slice of this drift. *Target:* a single shared render module both paths
  call (a pure `renderMessage(msg) → DOM`), with live/reload differing only in *source* (stream vs
  history). *Blast radius:* `chat.js`, `chatRenderer.js`, the shared render helpers. *Risk:* medium
  (high-traffic code). *Effort:* 1 lane. *Dependencies:* sequence **after** R0 (ADR 0008 already touches
  the render/merge path — do them together or R0 first). *Verify:* a golden-render test asserting live
  and reload produce identical DOM for the same message set (incl. decision card, which today survives
  reload only via the out-of-band `rearmFromStatus`).

## R3 — Decompose the chat.js god-object + close the test-seam gaps **[POST-LAUNCH · Wave 2-3]**
- *Requirement:* testable seams; the densest, least-tested logic must be coverable. *Current:* `chat.js`
  ~5.3k LOC with a ~2.9k-LOC SSE loop mixing submit/stream-state-machine/doc-fence/TTS/background-streams/
  history-editing/the game-mutation seam; the **guardrail gating lattice** (`agent_loop.py:3395+` —
  `_want_advance`/`_record`/`_move`/`_approach` × lull/stale/runway/pending) is intricate, stateful, and
  has no confirmed unit harness; the **FE-write-back boundary** is protected only by per-tool
  `callTool`-dispatch tests (a new write-back is dead-at-runtime until one is added). *Target:* extract
  the SSE state machine into a tested module; add a gating-lattice unit harness over the
  lull/stale/runway/pending permutation matrix; add a generic FE-write-back boundary test. *Blast
  radius:* `chat.js`, `agent_loop.py`, new tests. *Risk:* medium. *Effort:* 1-2 lanes. *Verify:* the new
  unit harnesses green + no behavior change (golden transcripts). *(settings.js 290KB / slashCommands.js
  270KB are workspace-inherited outliers — split only if game-build-relevant.)*

## R4 — Location/movement source-of-truth (ADR 0009) **[POST-LAUNCH · Wave 3]**
- *Requirement:* "people make sense — one place at a time"; narration must ground to engine whereabouts.
  *Current:* movement grounding is documented as imperfect (the L21/L24 family; ADR 0009 root-causes it
  + records the fold-first PO ruling). *Target:* per ADR 0009 (operator-owned). My audit corroborates the
  positive side (presence panel matched narration in the parity run) but did not stress movement; defer
  to ADR 0009. *Risk/effort:* per ADR 0009. *Verify:* ADR 0009's gate. **Also fold in F-S4-F** (the
  suspected resume-context name-drift "Luke Fleming"→"Lake Fleming") — confirm whether name grounding
  degrades specifically on the resumable-stream resume path.

## R5 — Per-user client-storage isolation guard **[POST-LAUNCH · Wave 3]**
- *Requirement (0021):* client-layer per-user isolation. *Current (audit A-data-user):* every per-user
  localStorage key derives from `(document.body.dataset.user) || ""` — if the server ever omits
  `data-user`, all keys collapse to a shared empty namespace (layout/persistence bleed; not the Vault).
  *Target:* fail-closed when `data-user` is absent (skip per-user persistence rather than share a
  namespace) + assert the attribute is always injected. *Risk:* low. *Effort:* small. *Verify:* a test
  that an absent `data-user` does not write shared-namespace keys. **Also kill A-settingsModule** (the
  `window.settingsModule.open()` dead fallback — `orwellOnboarding.js:283` references a never-assigned
  global).

## R6 — Failure-mode UX **[POST-LAUNCH · Wave 4]**
- *Requirement:* failures degrade *honestly* (the brief). The probe proved **no engine desync / crash /
  stuck spinner** — the gaps are presentational. *Current:* **F-S4-C** an upstream error renders as a
  "Big Brother" GM message; **F-S4-D** a truncated stream stops silently mid-sentence with no
  interrupted/reconnect affordance. *Target:* a distinct **system/error notice** (not a GM bubble) +
  detect an incomplete stream (no `[DONE]`) and surface a **reconnect/retry** affordance. *Risk:* low.
  *Effort:* small. *Verify:* re-run `fault_probe.mjs` (the harness exists) and assert a system-error
  element + a retry control, no GM-voiced error.

## R7 — Polish bundle **[POST-LAUNCH · Wave 4]**
Contained, independent, mostly one-file (full list + evidence in `AUDIT-LOG.md`). **Issue #1418 pass
(2026-07-12, FE-safe-subset delegate):** the non-fenced FE subset was executed; the fenced/engine-
adjacent items are handed off. Status per sub-item below.

- ✅ **F-S1-H — DONE (#1418).** `theme.js`'s two cross-device prefs fetches (`GET /api/prefs/theme`,
  `GET /api/prefs/custom-themes`) fired pre-auth on `/login` (login_bg.js imports theme.js for the
  bundled perlin-flow wallpaper) → two 401 console lines per load. `_initWithSync` now early-returns on
  `/login` (`_onLoginPage()`) before both fetches; `initThemeUI()` still runs, so boot is otherwise
  unchanged and the login palette (localStorage-driven) is unaffected. **Verified:** a headless `/login`
  load + dynamic `theme.js` import fires **0** `/api/prefs/*` requests and **0** 4xx (was 401×1–2). FE
  suite 5032 passed; boot/browser smoke EXIT 0.
- ✅ **F-S2-B — DONE / already-resolved, VERIFIED (#1418).** Both console-404 sources are already fixed
  upstream: the inherited deep-research poller is game-build-gated (`chat.js checkPendingResearch` →
  early-return on `data-game-build`, #1035/F-8), and the finished-stream `stream_status` probe no longer
  404s — the route returns `{"status":"idle"}` (200) instead of 404 (`chat_routes.py` M1-8/audit A8). No
  edit needed; `boot_smoke`/`browser_smoke` are console-clean in the game build. (The deep-research
  poller lives in the FENCED `chat.js`; it was already fixed, so no fenced edit was required.)
- ✅ **F-S4-A — DONE / VERIFIED (#1418, no change).** The L40 "everyone romanced everyone" saturation is
  already fixed sparsely: `src/engine/seededRelationships.ts` seeds ≤ `DEFAULT_SHOWMANCE_BUDGET` (2)
  showmances/season, each slot only ~50% loaded (`SEED_LOAD_PROB = 0.5`) over DISTINCT houseguests — so
  0–2 per season, never a dense set. (Engine-fenced; read-only verification only.)
- ◻️ **F-S1-D — PARTIAL (#1418).** The **prewarm-cast fast-poll IS already gated to the mounted cast
  window** (verified): `orwellCast.js scheduleNextPoll()` returns early unless `_open`, and the
  `FAST_POLL_MS` cadence only applies to the open-panel roster poll (`_timer` re-arms only while `_open`;
  closing clears it). The 20s gate poll is fixed-cadence, not fast. **DEFERRED:** the "~10 uncoordinated
  `/state` pollers behind one shared poller" is a genuine ~15-file refactor (each panel has its own
  `getJSON`/`jget`/`jgetSafe`), several with **source-pinned tests on the literal `/api/orwell/state`
  string** (`test_c21_roster.py`, `test_c28_presence.py`, `test_m3_1_room_strip.py`) — churny and
  regression-prone, matching this file's own "Refactor (shared poller), not a leaf patch" classification.
  Do it as a dedicated coalescing pass (a short-TTL shared `/state` dedupe cache all panels route through
  while keeping the literal URL for the pinned tests).
- ✅ **F-S1-J — IDENTIFIED / already-resolved (#1418).** The "username-field dot" was the **Remember-me
  checkbox** that used to overlay the username input (unlabelled 14×14 glyph); **S1-A already relocated it
  to a labelled `.remember-row`** (login.html) — the username field now has only its `<label>` and no
  overlaying glyph. No residual dot to label.
- ⏸️ **F-S1-I — DEFERRED (#1418).** Stripping the inherited-workspace DOM from the template is the
  **deep code-level prune that `game-trim.css` explicitly defers** ("a deeper code-level prune is a
  separate pass, to be verified against a running instance"). The *visible* landing copy is already
  game-build-gated (index.html welcome-tip arrays swap to BB copy under `data-game-build`); the remaining
  workspace copy is hidden-not-rendered modals/tools. Out of scope for a low-risk polish pass — pair it
  with the game-trim deep prune.
- 🚧 **F-S1-E — FLAG (needs the fenced `static/style.css`).** The model-picker tap target is
  `.model-picker-btn { height: 21px }` (below AA 24px / AAA 44px), styled in `static/style.css` — which
  this pass is fenced from. The clean fix is a base-component min-tap-target there (or a padding-based hit
  area to avoid distorting the compact composer pill); an inline-markup override would either distort the
  composer at 44px or land a sub-AA half-measure. Hand to the style.css owner.
- ⏸️ **F-S1-K — DEFERRED / FLAG (#1418).** The two homes are both off-limits or risky: `LEAK_RE` lives in
  the **fenced `scripts/browser_smoke.py`**, and the ancestor-descendant overlap classifier
  (`frontend/src/visual_geometry.py`) is now a **CI-gated harness** for 0113/0114
  (`visual_regression.py` / `theme_consistency.py`, with pinned `test_0113_*`/`test_0114_*`) — the
  requested "ancestor-descendant overlap exclusion" is in fact **already implemented** there (the
  `covered` classifier excludes ancestors/descendants). Not a safe polish-tooling edit.
- ➡️ **S4-2 — HAND OFF (engine-read).** `finaleView`/`recap` return a null winner post-finish because the
  winner is projected from `this.live.winner` in `src/adapters/engine/GameSessionAdapter.ts` (engine
  side); making the endgame projections carry it is an engine-read change, not a pure FE surface patch —
  the task's one flagged engine-adjacency. (`/status` already carries `finished+winner`; the FE recovers
  via the retrospective, so it stays non-blocking.)
- ➡️ **S2-1 — HAND OFF (casting-finalize framing).** A structural "Enter the house" affordance that
  finalizes casting when the engine status is `finalizable` is intrinsically tied to the fenced
  casting-finalize path (`createCharacter` finalize / `chat_helpers.py apply_game_framing`) — when in
  doubt, hand off.

---

## Sequencing (what unblocks what)
1. **Pre-launch:** **R0** (ADR 0008) — into the Phase-3 gated remediation. Nothing else blocks launch.
2. **Post-launch Wave 1:** **R1a/b/c** (independent, low-risk, high-leverage consistency hardening).
3. **Wave 2:** **R2** (render unification) — *after/with* R0 (shared render/merge surface), then **R3**
   (decompose + test seams) which is easier once R2 lands one render path.
4. **Wave 3:** **R4** (ADR 0009), **R5** (isolation guard).
5. **Wave 4:** **R6** (failure UX), **R7** (polish).

Dependency direction is already correct (engine imports nothing from the FE; Vault structurally walled)
— **no inversion to fix.** The roadmap is about FE-side cohesion + the one consistency refactor (R0).

## Close — review gate
**The launch-blocking few:** exactly **R0 (ADR 0008)** — already owned. **The post-launch many:** R1–R7,
sequenced above; do NOT execute pre-launch. **Ask:** fold R0 into the remaining pre-launch remediation
(it's ADR-owned — confirm you want this audit to track/verify it), or hand the whole roadmap off as-is?
