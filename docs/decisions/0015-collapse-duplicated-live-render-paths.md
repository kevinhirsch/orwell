# 0015 — Collapse the duplicated live-vs-mirror chat render paths (one incremental renderer the observer drives live)

> **Status:** **Accepted** (streaming-parity investigation, 2026-06-27). The render-layer half of the
> two-window "Messenger mirror" — the **delivery** half (one authoritative run, fanned out token-by-token)
> is already sound; what remains is to stop the observer window from re-rendering that shared stream
> through a *second*, full-repaint render engine.
> **Source:** the streaming-text-parity investigation (branch `claude/streaming-text-parity-*`),
> root-causing **ship-gate F5** (realtime two-window mirror parity — the #1 release blocker).
> **Builds on:** ADR [`0008`](./0008-chat-conversation-consistency.md) (the per-session `seq` log +
> reconcile-by-id + the `message-added` completion broadcast — the **settled-log** consistency model)
> and ADR [`0012`](./0012-two-window-lockstep-mirror.md) (the **live-stream** mirror: one authoritative
> server-side run fanned out to every window on the canonical session, via the `agent_runs._Run`
> replay-then-tail primitive). This ADR completes 0012 §3.3 / the
> [refactor-roadmap **R2**](../REFACTOR-ROADMAP.md#r2--collapse-the-duplicated-live-vs-reload-chat-render-paths-post-launch--wave-2)
> entry ("collapse the duplicated live-vs-reload chat render paths").
> **Inherits / bounded by:** the **Vault Wall** (mandate #2) and **cross-user isolation** (0021) —
> structural and unchanged here. This is a **render-layer-only** decision: the transport, the engine,
> and the closed-set serialization (feature 0065) are untouched, and the live stream still splits by
> channel so **reasoning never reaches the public bubble** (the per-round `roundReplyText` /
> `roundReasoningText` contract stands). Not one byte of gameplay changes.

## Context

ADR 0012 made the live narration stream for a game turn **one authoritative server-side run, fanned out
token-by-token to every window** on the canonical session. The streaming-parity investigation confirmed
that **message DELIVERY/transport is sound and stays** exactly as built:

- **One canonical generator per turn.** A single ordered byte-buffer is fanned out **identically** to
  every subscriber via the `agent_runs._Run` replay-then-live-tail primitive (`frontend/src/agent_runs.py`)
  — replay everything buffered so far, then live-tail, so a window that opens or refreshes mid-stream joins
  the in-flight stream with no dropped or duplicated tokens.
- **Seq-ordered, reconcile-by-id** (ADR 0008): the settled log has a real total order and every window
  reconciles to it.
- **Canonical-session keying** with the #1092 liveness fixes (the mirror subscribes only once the
  canonical id resolves to a **live** FE chat-session row; it unbinds on delete).

This is **single-writer-per-turn broadcast** — the correct consistency model — and it is **not** the
defect. The transport already hands every window the same bytes at the same time.

### Root cause — a render/consume-layer duplication

The remaining F5 defect lives **one layer up**, in how each window *consumes and renders* that shared
stream. There are **two separate live-render consume loops**:

- **The sender** (the window that POSTed the turn) renders deltas incrementally through
  `createStreamRenderer` (`frontend/static/js/streamingRenderer.js`): finalized markdown blocks are
  **frozen**, only the growing tail re-renders, new tokens **fade in**, and a **live**
  `.thinking-section` accordion mounts early. Few unmounts; mostly character mutations on the tail.
- **The observer** (a second window on the same game) goes through `resumeStream` → `renderDelta`, which
  **full-`innerHTML`-repaints the entire bubble on every delta**
  (`contentDiv.innerHTML = processWithThinking(_combined())`): every delta **unmounts + remounts the whole
  content subtree**, and reasoning is inlined as a closed `<think>` block rather than a live accordion.

Same shared token stream, **two different live render engines** — the two-window "scratch and grind." And
in practice it is worse than mere churn: the observer often **doesn't render live at all** — it sits
**blank through the sender's entire stream** (~2–4 s) and only catches up **~2–4 s late** when ADR 0008's
settled-log reconcile lands (a `softReloadHistory` repaint through the *other*, non-incremental renderer).

This is the exact structural smell the project mandate warns against: a redundant second render path
re-implementing the same concerns (reply/reasoning split, `processWithThinking`, the thinking accordion)
and **drifting** from the first. It is the F5 / R2 / ADR 0012 §3.3 gap — the transport is shared, the
**render is not**.

## Decision

**Collapse to ONE incremental renderer that the observer drives LIVE during the stream.** The mirror
(`resumeStream`) attaches to the shared run and streams its deltas through the **same**
`createStreamRenderer` the sender already uses — instead of the full-`innerHTML`-repaint `renderDelta`
reconcile path. After R2, **live == reload by construction**: live and reload differ only in their
*source* (a live stream vs. `/api/history`), not in their render engine.

This is **refactor-roadmap R2** and **ADR 0012 §3.3** made concrete. The fix is to **delete the redundant
render path**, a bounded front-end simplification — not new architecture.

Concretely (FE-side, `frontend/static/js/`):

1. **One render engine, two sources.** The observer's `resumeStream` consume loop renders deltas through
   `createStreamRenderer` (freeze finalized blocks + token-fade + a live `.thinking-section` accordion),
   identically to the sender. The full-repaint `renderDelta` per-delta path is removed from the live
   mirror.
2. **The observer renders DURING the stream, not after.** Because the shared `_Run` buffer already
   replays-then-tails, the observer begins rendering the turn **while the sender is still streaming**
   (`bStartsDuringAStream`), within a bounded lag — it no longer sits blank then pops a late
   `softReloadHistory` reconcile.
3. **The channel split is preserved verbatim.** Reasoning still never reaches the public bubble: the
   per-round `roundReplyText` / `roundReasoningText` buffers stay split, the message **body** renders only
   `roundReplyText` (through `processWithThinking`, which in the game build also scrubs operator-aside /
   raw `npc:<id>` leaks), and reasoning renders only into the live "Thinking" accordion. The render
   unification does **not** merge the buffers.
4. **Transport, engine, and closed-set serialization are untouched.** The single-writer broadcast
   (`agent_runs._Run`), ADR 0008's `seq`/reconcile-by-id, the canonical-session keying, and the engine's
   `beatSeq`/409 closed-set spine (feature 0065) all stand exactly as built. This ADR changes **only** the
   observer's render path.

## Rejected alternatives

- **A deeper re-architecture of the transport — websockets / a CRDT / a server-push or event-store
  rewrite.** *Rejected.* This is **single-writer-per-turn broadcast**, already solved at the transport:
  one canonical generator, one ordered byte-buffer fanned out identically to every subscriber
  (`agent_runs.py`), seq-ordered + reconcile-by-id (ADR 0008). There is no concurrent-writer or
  lost-update problem at the transport for the *live stream* of a single turn — a CRDT/OT's concurrent-edit
  machinery buys nothing (the same reasoning ADR 0008 used to reject a CRDT for the settled log), and a
  websocket/server-push/event-store rewrite re-solves a problem that is already solved. The defect is a
  **render/consume-layer duplication**, not a transport gap; the correct fix is to **delete the redundant
  render path**, not add new transport.
- **Leave two render engines and lean harder on the settled-log reconcile to converge them faster.**
  *Rejected* — this is the same leaf-patch ADR 0012 already rejected one layer down. It only narrows the
  late-pop window; the observer still renders the live stream through a different (full-repaint) engine, so
  the two windows still **diverge in live render behaviour** for the whole stream. ADR 0008's reconcile
  acts on the **settled** message, not the **live** render — by construction it cannot make the two live
  engines agree.
- **A client turn-lock / spectator (only the sender renders live; the observer waits for settle).**
  *Rejected — forbidden by feature 0064's Messenger ruling* (`test_0064_salvage.py` pins the lock design
  out of the tree). The mirror must render live in **every** window regardless of which initiated.

## Testability / Acceptance

The acceptance is **executable** and **model-independent** — it runs key-free against a **deterministic
fake streamed model**, so it is reproducible and CI-fast (the F1–F5 bar is FE sync/render/queue-layer and
model-independent by design; see `docs/audits/2026-06-27-ship-gate.md`).

**The binding gate** — `docs/audits/playtest-harness/mirror_live_parity.mjs`, run via
`docs/audits/playtest-harness/run_mirror_gate.sh` (boots engine + the deterministic streamed fake model +
the FE + a *started* game, opens two windows on the one canonical session, sends a turn from window A, and
diffs the **live render behaviour** from the timestamp-aligned DOM filmstrip — where a settled-transcript
diff is blind). PASS requires **all** of:

- `bStartsDuringAStream` — window B begins rendering the turn **WHILE A is still streaming** (B's first AI
  render is before A's settle), not blank-then-pop.
- `bUsesIncrementalRenderer` — B mounts the **same** live streaming container A does (the
  `createStreamRenderer` incremental path), **not** a full-`innerHTML`-repaint reconcile (`renderDelta`).
- `lagWithinBudget` — B converges within `MIRROR_LAG_BUDGET_MS` (default 2500 ms) of A's settle.

**The fast tripwire** — `frontend/tests/test_0012_mirror.py`
(`test_chat_client_mirror_does_not_full_repaint_per_delta`): a source-level assertion that the mirror's
`resumeStream` no longer full-`innerHTML`-repaints per delta. **R2 landed 2026-06-27** (`bb2c3076`/
`14d071c1`) and the `xfail` marker has been removed — the tripwire passes outright. **But the R2
render-path unification alone did NOT turn the behaviour harness green:** under the fast deterministic fake
the turn often settled before window B finished attaching, so B rendered the `softReloadHistory` reconcile
(a STATIC bubble) and `resumeStream`'s own-echo dup-abort tore B's incremental holder down before it painted
(`bUsesIncrementalRenderer=false`). The **fast-settle race fix (2026-07-09)** closed that: the dup-abort is
scoped to the true own-echo case, a late-attaching observer's from-history reconcile is REPLACED by a live
incremental replay, and the one-burst `[DONE]` flush lands the paint. The harness gate is now **green** and
**promoted to a required CI gate** (`mirror-parity` in `.github/workflows/ci.yml`, under `ci-gate`, on the
FE path filter).

**Made host-independent + deterministic (2026-07-10, PR #1276).** The render fix was correct, but the
gate itself stayed timing-fragile on a **contended** CI runner: it measured the FIRST turn, where the
canonical session binds *mid-turn* (first-writer-wins on A's send), so window B started its
canonical-discovery poll COLD and — under CPU starvation — attached AFTER A's short stream settled,
painting a static reconcile (`bUsesIncrementalRenderer=false`, huge lag) even though the render paths
are unified. That is a **test-timing** hole, not a render regression, and the 4× retry masked it
unreliably. The gate now measures the **steady-state** mirror (the real F5 invariant — two windows
*already converged* on the shared run): it sends a **warm-up turn** so B is a genuine pre-subscribed
mirror before the measured turn, gives A's reply a **deterministic stream width** (spaced fake-model
reply tokens, pacing-only — identical bytes, so mirror byte-identity is intact), and **waits for the
filmstrip's `MutationObserver` to record the incremental-container mount** before draining (its
callback-time stamps lag the real mutation under load; the during-stream/lag checks still use accurate
direct-DOM clocks). The three F5 checks and their meaning are unchanged — only the measurement is made
fair. Two self-test knobs prove the gate still FAILS a non-mirroring B (`MIRROR_B_CPU_THROTTLE`,
`MIRROR_SKIP_WARMUP`); it passes even a cold, 8×-throttled B, and reproduces the original zero-width
cold-start FAIL under `MIRROR_SKIP_WARMUP=1 MIRROR_TOKEN_DELAY_MS=0 MIRROR_B_CPU_THROTTLE=8`. See harness
§10 "Timing model." The CI retry is retained as belt-and-suspenders (runner-boot blips), not relied upon.

> The executable BDD lives in the **harness gate + the pytest tripwire** referenced above — **not** in a
> Cucumber `.feature` / `cucumber.cjs`. That lane is the **TS engine** and cannot run an FE-render
> scenario; this defect is purely front-end render-layer, exercised by the real FE + real engine driven
> headless under Playwright against the fake streamed model.

**The F5 acceptance, as a Given/When/Then scenario:**

```gherkin
Scenario: Two windows mirror the live stream through one incremental renderer
  Given two windows are open on one started game (the same canonical session)
    And both windows are bound to the live FE chat-session row (ADR 0008/0012)
  When window A streams a turn (a single authoritative server-side run, fanned out
       token-by-token to every window — ADR 0012)
  Then window B begins rendering that turn WHILE A is still streaming
       (B's first render lands before A's settle — not blank-then-pop)
    And window B renders it through the SAME incremental renderer as A
       (createStreamRenderer: frozen finalized blocks, token-fade tail, a live
        ".thinking-section" accordion — never a full-innerHTML repaint per delta)
    And window B converges to A's text within the bounded mirror lag budget
       (≤ MIRROR_LAG_BUDGET_MS, default 2500 ms)
    And reasoning never reaches the public bubble in either window
       (the body renders only roundReplyText; reasoning only the Thinking accordion)
```

Mapping to the gate checks: *B begins rendering while A streams* ⇒ `bStartsDuringAStream`; *same
incremental renderer* ⇒ `bUsesIncrementalRenderer`; *within the lag budget* ⇒ `lagWithinBudget`; *reasoning
never in the body* ⇒ the standing per-round `roundReplyText`/`roundReasoningText` channel split (the game's
reasoning-scrub render contract, unchanged by this ADR).

**Boundaries that stay green (unchanged):** the dependency-cruiser Vault-edge test + the Vault sentinels
(no new reader here), cross-user isolation (0021), and the full FE pytest suite. The transport/delivery
gates (ADR 0008's `seq`/reconcile contract, the `_Run` replay-then-tail behaviour) are likewise unchanged.

## Consequences

- **Two windows mirror the live stream in realtime** — the observer renders **during** the sender's stream,
  through the **same** incremental renderer, within a bounded lag — closing ship-gate **F5**, the #1
  release blocker. The ADR 0003 shared-reality premise holds **during** the turn, not only after it settles.
- **One render path** (R2): live == reload by construction. The duplicated `renderDelta` full-repaint live
  path is **deleted**, removing the documented drift class (the "leaking all of it on every re-open" /
  "a stack of identical beat rows" regressions the dual render engines kept re-introducing).
- **Smaller surface, not larger.** The fix **removes** a redundant render path; it adds no transport, no
  new dependency, and no engine change. The blast radius is `frontend/static/js/` (the chat consume loop +
  the shared renderer), bounded.
- **Vault Wall + cross-user isolation untouched** — the mirror still carries the same Vault-free narration a
  single window already renders; the channel split keeps reasoning out of the public bubble.
- **Single-window play is byte-identical** — the sender already renders through `createStreamRenderer`; with
  one subscriber nothing about its render changes.
- **R2 landed 2026-06-27** (`bb2c3076`/`14d071c1`) — the render PATHS were unified and the
  `frontend/tests/test_0012_mirror.py` `xfail` removed (it passes outright). The behaviour **harness**
  stayed RED on a fast-settle race until the **2026-07-09 mirror-parity fix** (late-observer incremental
  replay + scoped dup-abort + one-burst `[DONE]` paint flush), which turned it **green** and **promoted it
  to a required CI gate** (`mirror-parity`, under `ci-gate`, FE path filter).

## Addendum (2026-07-21) — the persisted render-log + fold-deferral (issue #1728)

> **Scope note:** the ADR body above is about the **live-stream** render path (F5, two-window
> mirror parity — a purely in-flight-turn concern). This addendum is about the **persisted**
> render log one layer down — the durable row list a session's live stream and its `/api/history`
> reload both ultimately read back from — plus a **non-degradation (mandate #4) tail** the
> reconciliation/BB-Nerd audits (T2/T3 + F5/F6) found riding on top of it: a cancelled generation
> left an empty durable row, "Try again" appended a second row instead of superseding, and BOTH
> takes folded into the hidden relationship/soul layer — sometimes with the SUPERSEDED take's
> (fabricated) content surviving. Source: `kevinhirsch/orwell#1728`.

### D1 — the persisted render log is id-keyed, single-mutator, supersede-by-id

**Decision (shipped, PR #1751, then completed here):**

1. **One append-only, server-`seq`-ordered assistant-row list per session is the single source of
   truth.** `core.session_manager.SessionManager` + the DB `ChatMessage.seq` ordering ARE that
   log — both the live stream (which stamps each persisted row's real DB id onto its bubble,
   `dataset.dbId` in `frontend/static/js/chat.js`) and a reload (`GET /api/history/{id}`) read the
   same rows in the same order. There is no second, DOM-index-only source of row identity.
2. **Cancel = discard.** `_renderCancelledBubble` (`frontend/static/js/chat.js`) never calls
   `inject_messages` for a stopped/cancelled generation — a cancelled take leaves **zero** durable
   rows (kills T2 — the old `stopped+cancelled, len=0` persisted row).
3. **Regenerate = supersede by id, never append.** `regenerateFrom`
   (`frontend/static/js/chatMessageActions.js`) resolves the row to discard from the AI bubble's
   OWN stamped DB id (`truncate_from_id`), not a DOM-index guess that can drift from the true row
   count whenever a hidden/system row persists without a rendered bubble (the root cause of T3's
   "two near-identical rows"). `POST /api/session/{id}/truncate`
   (`routes/history_routes.py::truncate_session`) resolves the exact `keep_count` from the
   server's own `seq` order (`SessionManager.keep_count_before_message`) and 404s a stale/unknown
   id rather than guessing — and the client checks that response status BEFORE mutating the DOM or
   resubmitting, so a failed truncate can never leave a duplicate row behind.
4. **FE tier only.** None of the above touches `src/` (the engine) — narration rows are not, and
   never become, engine/Vault state (ADR 0003).

Live == reload by construction for a regenerated turn: both render the same server-`seq`-ordered,
id-keyed row list, and superseded rows are gone from that list, not merely hidden client-side.

### B2 — fold integrity: defer-fold-to-settle (chosen primary; compensating-retract documented, not built)

**The problem this closes.** Even with D1 shipped, the *consequence* layer had its own copy of the
same defect: the 0055 `_auto_record_scene` belt (`frontend/src/agent_loop.py`) folded a scene's
hidden impact into the relationship/soul layer **immediately**, mid-stream, per take. A "Try
again" produces a brand-new take with its OWN extraction+fold call — but the first take's fold had
already committed and cannot be un-narrated. Every regenerate **permanently double-folded** the
hidden layer (F5), and because the surviving fold was picked independently of which take actually
survived, its content could belong to neither take as narrated (F6 — a fabricated/distorted fold).

**Decision — DEFER-FOLD-TO-SETTLE is the primary mechanism (owner ruling, issue #1728).** A
scene's fold is no longer committed at proposal time. `frontend/src/fold_ledger.py` is a small,
Vault-free, in-memory, per-`(owner, session)` staging slot (one entry at most, mirroring the
established `routes/chat_helpers.py` `_DEFERRED_FOLDS`/`_LAST_BEAT_SEQ` pattern for exactly this
class of short-lived FE bookkeeping):

- `_auto_record_scene` validates the extraction exactly as before (the OOC/machinery gate, the
  engine-whereabouts witness-set intersection, the `withIds` roster normalization — #1729/#1730/
  #1734, unchanged) and then **stages** the payload instead of calling `recordInteraction`.
- The fold **settles** (the actual, CAS-guarded `recordInteraction` call) at the **start of the
  next turn** for that same session (`agent_loop._settle_pending_fold`, called before the new
  turn's round loop begins — never mid-stream) — reaching a new turn is the proof the prior take
  was accepted, not regenerated.
- A **regenerate discards the staged fold unconditionally** as part of the truncate it already
  performs (`routes/history_routes.py::truncate_session` calls `fold_ledger.discard_pending_fold`)
  — provably correct because a truncate always cuts this session's tail from some point to the
  end, and a staged fold only ever exists for the session's most-recent turn (settle always drains
  any earlier one first), so the row that produced a staged fold — if any — is always inside every
  truncate's discarded range.
- **Idempotency (AC):** the idempotency key is minted once, at stage time, and carried unchanged
  to the settle-time engine call (0065 Part B) — the engine dedups a repeated key, so a retried
  settle can never double-apply. A settle that fails on a transient error (not a stale-beat
  conflict, which `_backfill_with_cas`'s existing CON-11 deferred-retry queue already absorbs)
  **re-stages the identical entry** rather than dropping it (mandate #4 — a validated fold must
  never silently evaporate).

**The compensating-retract fallback — documented, deliberately NOT built (T9 doctrine).** The
issue specs a fallback for a seam where deferral proves infeasible: commit immediately, then issue
an explicit "un-fold" if the take turns out superseded. No such seam exists on this build's
surface — staging is a plain in-process dict write that happens strictly before the engine is ever
touched, so there is nothing for deferral to fail past. Per the T9 doctrine ("if you implement
deferral, note the retract design as the designated fallback, don't build both"), the shape is
recorded in `src/fold_ledger.py`'s module docstring: `recordInteraction` would grow an explicit
`retract` verb keyed by the original `idempotencyKey`, resolved to the exact prior fold and
reversed via the SAME bounded/seeded magnitude math applied forward (never a raw-number rollback
the FE could game). Build it only if a future seam genuinely forces committing before a take's
fate is known.

**Boundaries preserved:** the engine's fold **magnitude** is still entirely engine-decided at
settle time — nothing about *what* gets validated or *how much* it moves changed, only *when* the
already-validated call reaches `recordInteraction` — so `tests/unit/expressiveNonCollapse.test.ts`
+ `frontend/tests/test_expressive_non_collapse.py` (creative prose stays un-normalized) and the
belt-fire telemetry contract (`frontend/tests/test_belt_telemetry.py` — a fire still means an
applied/guaranteed-to-apply correction, never a bare attempt) both stay green unchanged.

**Tests:** `frontend/tests/test_1728_1729_1730_1734_recording_render_integrity.py` — the D1 id-
keyed-truncate + cancel-discard source pins (already landed with PR #1751) plus the B2 section
added here: stage-not-commit, settle-commits-once, the regenerate/discard/one-surviving-fold
repro (the F5/F6 case end to end), idempotency-key reuse, re-stage-on-transient-failure, the
`session_id=None` (0081 faithfulness retro-adopt) immediate-commit fallback, and two source pins
(the truncate route's discard call; settle sitting before the round loop starts).

## Traceability

- Source: the streaming-text-parity investigation, 2026-06-27 (branch `claude/streaming-text-parity-*`).
- Root-causes: ship-gate **F5** (`docs/audits/2026-06-27-ship-gate.md`) — realtime two-window mirror
  parity, the #1 release blocker.
- Completes: ADR [0012](./0012-two-window-lockstep-mirror.md) §3.3 (the live-stream mirror) +
  refactor-roadmap [**R2**](../REFACTOR-ROADMAP.md) (collapse the duplicated live-vs-reload render paths).
- Builds on: ADR [0008](./0008-chat-conversation-consistency.md) (the settled-log `seq` / reconcile-by-id /
  completion-broadcast model — the **delivery** half that is sound and stays).
- Bounded by: the Vault Wall (mandate #2) and cross-user isolation (0021) — both unchanged; ADR 0003; the
  reasoning-scrub render contract (the `roundReplyText`/`roundReasoningText` channel split).
- **Addendum (2026-07-21) source:** `kevinhirsch/orwell#1728` — the persisted render-log
  supersede-by-id/cancel-discard half (D1, PR #1751) + the defer-fold-to-settle consequence half
  (B2) closing the multi-audit BB-Nerd F5/F6 = reconciliation T2/T3 finding. See
  `frontend/src/fold_ledger.py`, `agent_loop._settle_pending_fold`, and
  `frontend/tests/test_1728_1729_1730_1734_recording_render_integrity.py`.
- Executable backing: `docs/audits/playtest-harness/mirror_live_parity.mjs` (+ `run_mirror_gate.sh`) and
  `frontend/tests/test_0012_mirror.py` (the former `xfail` tripwire, now passing outright); harness §10 of
  `docs/audits/playtest-harness/README.md`.
