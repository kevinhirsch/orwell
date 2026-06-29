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

**The fast tripwire** — `frontend/tests/test_0012_mirror.py` (the `xfail` source-pin
`test_chat_client_mirror_does_not_full_repaint_per_delta`): a source-level assertion that the mirror's
`resumeStream` no longer full-`innerHTML`-repaints per delta. It **XPASSes the moment R2 lands**; flip the
`xfail` then, and promote the harness gate to a required CI gate.

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
- The harness gate flips **RED → green** when R2 lands; then it becomes a **required CI gate** and the
  `frontend/tests/test_0012_mirror.py` `xfail` is removed (it XPASSes).

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
- Executable backing: `docs/audits/playtest-harness/mirror_live_parity.mjs` (+ `run_mirror_gate.sh`) and
  `frontend/tests/test_0012_mirror.py` (the `xfail` tripwire); harness §10 of
  `docs/audits/playtest-harness/README.md`.
