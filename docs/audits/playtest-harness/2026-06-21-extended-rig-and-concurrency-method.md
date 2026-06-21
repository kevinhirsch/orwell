# 2026-06-21 — Extended telemetry rig & the concurrency-testing method

**Status:** living methodology · authored during the 2026-06-21 pre-launch E2E playtest audit.
**Companion to** `README.md` (the reusable playbook — stand-up steps, gotchas, defect taxonomy) and the
2026-06-19 run plan. This file documents the **extended rig** built on top of `lib.mjs` and, in detail,
the **temporal + two-window + concurrency** method that found the cross-tab chat-divergence defect
(audit `AUDIT-LOG.md` §S3-RACE → ADR 0008).

> **One-line:** `lib.mjs` captures a *frame*; this rig captures *time, two windows, and the device
> matrix*, and treats the **engine as the consistency oracle** for every parity claim.

All scripts here are **reference tooling** (like the rest of this folder): copy them into the
git-ignored `.audit-telemetry/` sandbox to run. They read secrets from `.audit-telemetry/.secrets.env`
at runtime and contain **no literal secrets**.

---

## 0. Stack stand-up (additions to README §2)

README §2 is the canonical stand-up (engine on 8765, FE on 7000, model via Settings, sandboxed
Playwright). Two hard-won additions from this run:

- **Never `pkill -f` a server you're restarting from a script** — the pattern string (`"uvicorn app:app"`,
  `"dist/main.js"`) appears in your *own* command line, so `pkill -f` / `pgrep -f` **kills the restart
  script itself**. Kill by **port** instead: `fuser -k 8765/tcp` (or `lsof -ti:7000 | xargs -r kill`),
  which matches the listener, not your shell.
- **Long-lived servers as background jobs:** run them as the job's **`exec` target** (`… exec node
  dist/main.js`) so the process *is* the tracked background job and runs across tool calls; pair with a
  separate readiness poller (`until curl -s …/health | grep '"ok":true'`). Don't `&`-background inside a
  job and exit — and don't foreground-`sleep`.
- **Model:** `deepseek/deepseek-v4-pro` via OpenRouter, configured through the Settings API
  (`POST /api/model-endpoints` + `POST /api/auth/settings`). It is a **reasoning model** — the API
  returns `message.reasoning` separately from `message.content`; a too-small `max_tokens` yields
  `content:null` (all budget spent on reasoning). The FE routes `reasoning` to the collapsed thinking
  accordion and `content` to the body; the audit reads the **rendered DOM** (thinking stripped), never the
  raw stream.

---

## 1. `rig.mjs` — the extended capture library (the centerpiece)

Reuses `lib.mjs`'s `DEFECT_SCAN` (overflow / offscreen / copy-smells / undersized taps) and adds:

- **Real device descriptors** (`DEVICES`), not a CSS resize: `desktop` 1440×900 pointer; `mobile`
  390×844 **DPR 3 + touch + iPhone UA**; `android` 360×800; `narrow` 320×720. Two-window parity is
  computed **within** a device; desktop-vs-mobile is judged as **functional equivalence**, not pixels.
- **Temporal capture** — `captureSurface({video:true, recordMs, fps})` records a Playwright `webm`, then
  `ffmpeg -vf fps=N` extracts a **dense filmstrip** (`shots/<name>-<device>-frames/f-*.png`). You read the
  *lifecycle* (mount→behave→unmount) frame-by-frame, not a still. (Used to catch the cold-load FOUC frame
  and to confirm the welcome-modal mount has no splash-flash — by **per-frame luminance**, not the
  algebraic frame=t/ms mapping, because the webm has paint-startup lag.)
- **A pre-load instrument** (`INSTRUMENT`, injected via `addInitScript` **before any app script**): a
  `MutationObserver` that timestamps **mount/unmount of every transient** (toasts, modals, cards,
  accordions, thinking blocks, the decision card, the welcome splash) into `window.__audit.log`, plus
  `error`/`unhandledrejection` capture. This catches transients that appear and vanish *between* sampled
  frames.
- **The engine-truth oracle** — `engineSnapshot(ctx)` reads `GET /api/orwell/{state,status,moment}` +
  the engine `/health` at every checkpoint. **Every parity/consistency claim is anchored to this.** The
  closed-set fields that must agree across tabs: `beatSeq`, `week`, `phase`, `hoh`, `nominees`, `pending`.
- **`newCtx(browser, device, {video, auth, user})`** — a context with the device profile, the instrument,
  and an API login (cookies shared with page navigations). `captureSurface` and `twoWindowParity` build on it.
- **`twoWindowParity({identity, …})`** — opens two synchronized contexts (same- or cross-identity),
  captures both, and emits a structural diff (normalized `innerText` + first divergence) **and** a
  **pixel A/B diff** (`pixelmatch` + `pngjs`, written as `…-DIFF.png`). You decide signal vs. legitimate
  per-viewer/private difference vs. legitimate reflow.

**Discrimination rules baked into the method** (the brief's "is it a bug?"): a **reflow** is not a bug;
a **random covered tip** that's pixel-identical is not a consistency defect; a **transient beat-chip in
the active tab that reconciles** is not garbage. **Lost/clipped/unreachable**, **divergence in
shared/engine-truth state**, or **a divergence that does not reconcile** *is*.

---

## 2. The per-state drivers

| Script | What it does |
|---|---|
| `s1.mjs` | State 1 — login + zero-data landing across the device matrix (incl. 320), video + two-window same-identity landing parity. |
| `s1b.mjs` | State 1 — Settings (every tab × desktop/mobile) + the forced onboarding states (`_orwellOnboardingMount` dark-house F5, `_orwellWelcomeMount` welcome) via the deterministic seams. |
| `s1validate.mjs` | State 1 — post-fix re-capture (the validation step): re-checks a specific fix set (e.g. avatar-204 net log, the FOUC first-frame luminance). |
| `s2cast.mjs` | State 2 — **live casting interview** driver (below). |
| `s3parity.mjs` · `s3race.mjs` · `s3raceloop.mjs` · `s3reconcile.mjs` | State 3 — the **concurrency suite** (§4). |

### Live narration driving (`s2cast.mjs`, the roleplay method)

- Loads the app (authed, fresh context ⇒ onboarding fires), clicks **"Meet the producers"**
  (`[data-ob-welcome-go]`) — the producers' hidden kickoff opens the interview (the player never types
  first). Then plays a **consistent, human-authored player persona** turn-by-turn (allowed — the player
  authors their own character; **never** a legacy/NPC name).
- **`waitDone`** waits for the streaming **completion footer** (tok/s) on the last `.msg-ai` **and** a
  non-placeholder body (it strips `.thinking*`/`.msg-footer`) — the README's "Thinking-trap" fix. Do not
  use a length-stable heuristic; it latches on the `Generating…` placeholder.
- **Leak check on the rendered body** (thinking stripped): a regex for engine/tool machinery
  (`advanceGame`, `submitDecision`, `updateCasting`, `the player has`, `let me check`, `npc:<n>`, …). A
  leak in the **visible** message is the bug; a mention buried in the hidden reasoning is secondary.
- **Engine grounding each turn:** `casting.ready` / `casting.known` / `next` from `GET /api/orwell/state`
  — proves `updateCasting` fired and the engine (not the model) computes coverage. Move-in names are
  checked against `house[].name` (cast-invention guard).

---

## 3. The temporal-vs-still principle

A screenshot misses animations, toasts, the FOUC frame, and streaming transients. So **every dynamic
surface is captured as video → filmstrip + the mutation log**, and read across the **whole lifecycle**.
Concretely this run: the cold-load white **FOUC** was caught only on the `narrow` filmstrip
(`f-001` meanL 255 → `f-002` ~18); the welcome-modal mount was cleared of a splash-flash by per-frame
luminance; the "active-tab transient beat-chip" (vs a real lost message) was distinguished only by
**re-querying after settle** rather than trusting the single post-turn snapshot.

---

## 4. The concurrency method (how S3-RACE was found and characterised)

The known "garbage" bugs are concurrency bugs, so concurrency is tested as a **distributed-consistency
problem**, with the **engine `beatSeq` as the oracle**. Four escalating harnesses:

1. **`s3parity.mjs` — same-identity parity (sequential).** Two tabs load the same live game →
   assert engine truth + HUD + chat **byte-identical** (CP1). Then drive **one** turn in tab A and assert
   tab B **reconverges** via SSE/`beatSeq` (CP2). *Result this run: identical at rest; a one-message
   transient after a turn that reconciled on re-query.*
2. **`s3race.mjs` — concurrent-write race (one shot).** Fire turns in **both** tabs **simultaneously**
   (`Promise.all([send(A), send(B)])`), then compare. Captures engine convergence, msg-count match, body
   identity, **HTTP 409 `stale-beat`** counts (a 409 *with* recovery = the guard working; divergence
   *without* a 409 = the bug is upstream of the guard), and JS errors.
3. **`s3raceloop.mjs` — the LOOPED race (because races are intermittent).** Persistent two tabs, **N
   iterations** of simultaneous writes, flagging **any** iteration with engine divergence / msg mismatch
   / body divergence / JS error, screenshotting failures, logging incrementally. **This is the harness
   that proved S3-RACE is reliable, not flaky:** 10/10 iterations diverged, the gap **accumulating**
   (A=45 / B=40), engine `beatSeq` matching every time, **0 409s, 0 JS errors** — i.e. a pure FE
   chat-replication failure, not an engine or transport problem. *Run it on a loop — a single green pass
   proves nothing about a race.*
4. **`s3reconcile.mjs` — transient-vs-persistent / render-layer-vs-data-layer.** Reproduce the divergence
   with concurrent writes, then **reload both tabs** and re-compare. **Reload reconciles (49/49) ⇒
   render-layer** (the persisted DB log is intact; only the live FE replication drifts) — which scopes
   the fix to the FE (+ one `seq` column), not a data migration. If a reload had *not* reconciled, the
   defect would be data-layer (worse).

**Reading the result:** engine consistent + chat diverges + accumulates + no 409/JS-error + reload
reconciles ⇒ the conversation is a **replicated log with no merge discipline** (no monotonic ordering
key; the sender tab is optimistic-only and never re-fetches; the busy tab's `hasActiveStream` gate drops
the peer's events). The structural fix is **ADR 0008** (per-session `seq`; render/reconcile-by-id;
`{id,seq}` dedup; a completion broadcast). The looped race distilled into a permanent test is the gate.

---

## 5. Secret hygiene (unchanged, restated)

The OpenRouter key and the admin password live **only** in `.audit-telemetry/.secrets.env`
(`chmod 600`, git-ignored). The committed scripts read it at runtime and never contain a literal secret;
the model endpoint + key persist in `frontend/data/` (git-ignored). Revoke the key when the run ends.
