# Mirror-A · Two-Window Chat Consistency Audit (consistency-model violation analysis)

> Investigator lane: distributed-consistency / two-window parity. **READ-ONLY** (no code touched).
> Scope: the "two browser windows on the SAME game must render byte-identical, lockstep-mirrored
> conversations like Facebook Messenger" requirement. Symptom (owner): *"for 30 seconds each window
> was typing DIFFERENT responses … settled to the right thing after many seconds but was so out of
> sync and looked messy."* Roles only; no game-entity names. Date 2026-06-21. Branch: current `main`.

---

## 1. Intended consistency model vs. what the code actually implements

**Intended (owner's hard requirement):** ONE authoritative generation per game turn, fanned out
token-by-token to every open window. "It doesn't matter which session sent the message — it shows up
the same, at the same time." This is a **single-writer broadcast / shared live-stream** model:
linearizable on the *live token stream itself*, not merely eventually-convergent on the persisted log.

**What ADR 0008 actually built (and what the code on `main` implements):** a weaker model —
**read-your-writes over an eventually-convergent server-ordered log**. The persistence layer gained a
real total order (`seq`), and each window *reconciles* to it after the fact. The live token stream was
**partially** wired as a shared resource (`agent_runs._Run` replay buffer + `subscribe()`), and the
peer window is *supposed* to attach to it via `run-started → resumeStream`. But the attach is racy,
the completion signal is missing for the exact (streaming game) turn that matters, and reconciliation
is deferred-not-live while a stream is in flight. The net effect is: **convergence, but only
eventually (after the turn ends / a poll / a reload)** — never the lockstep token mirror the owner
asked for. ADR 0008's own "Consequences" claims windows "provably converge during live play"; that is
true for the *persisted log* but NOT for the *live in-flight stream*, which is where the owner's 30s
of divergence lives.

**Mechanism class:** an optimistic / per-window-render UI layered over an at-least-once SSE fan-out
that is *treated as* a shared exactly-once broadcast but isn't reliably one. The shared-broadcast
primitive EXISTS (`_Run.buffer` + `subscribe`) but the **handshake that points the second window at
it is best-effort and lossy**, so in the contended cases each window falls back to its own view.

---

## 2. Is the live token stream a shared broadcast resource, or per-window?

**Partially shared, by design — but the sharing is not guaranteed, and three seams break it.**

- The sender POSTs `/api/chat_stream` (`chat.js:1078`); the server starts ONE detached run
  (`agent_runs.start`, `chat_routes.py:1365`) and returns `StreamingResponse(agent_runs.subscribe(session))`
  (`chat_routes.py:1369`). So even the *sender* reads from the shared `_Run.buffer`. Good.
- The server then `session_events.publish(session, "run-started")` (`chat_routes.py:1368`). The peer
  window's `sessionSync.js` receives it and calls `cm.resumeStream(id)` (`sessionSync.js:69-76`), which
  GETs `/api/chat/resume/{id}` → `agent_runs.subscribe(session)` (`chat_routes.py:1394-1399`) — the SAME
  buffer. So in the happy path (one window idle, one sends) the peer DOES tail the same tokens.

**Why it is not reliably shared in the cases the owner hit:** the subscribe target is selected by
`_RUNS[session_id]` *at the moment resume is called*, and that pointer is overwritten on every new run
(`agent_runs.py:164`), including the chained `queue=True` game path that does NOT cancel the prior run.
Combined with the missing completion broadcast and the deferred reconcile, a window that is itself busy,
or that joins a beat late, ends up rendering a DIFFERENT run (or its own optimistic guess) than the peer.

---

## 3. Ranked divergence sources (each: what / which window sees what / why "different for 30s then snaps" / file:line)

### D1 — [PRIMARY] Concurrent sends create TWO live runs; each window tails a different one
- **What the code does:** `agent_runs.start(..., queue=True)` (the game path, `ctx.framed`) does NOT
  cancel the in-flight run — it builds a NEW `_Run`, **immediately overwrites `_RUNS[session_id]` with
  it** (`agent_runs.py:163-164`), and chains its `_drain` behind the previous task's completion
  (`agent_runs.py:99-105`). So from the instant the second window sends, `_RUNS[session_id]` points at
  run #2 while run #1 is still streaming live to window A.
- **Which window sees what:** Window A reads run #1's tokens (its own POST response). Window B reads run
  #2's tokens (its own POST response). Each window's `run-started` reaches the *other*; but the peer's
  `resumeStream` self-guards on `hasActiveStream(id)` (`chat.js:3744`, and `sessionSync.js:73`) — a
  window that is itself mid-send is "active," so it does **not** attach to the peer's run. Two
  independent reasoning chains, two different texts, rendered simultaneously.
- **Why the symptom:** a game turn is multi-round (the agent loop, `agent_loop.py` / `MAX_AGENT_ROUNDS`)
  — tens of seconds. For that whole window, A is typing run #1 and B is typing run #2 → "each window
  typing DIFFERENT responses." When run #1 ends and run #2's chained drain finally streams (or the turn
  settles and `flushPendingReconcile`/`softReloadHistory` rebuilds to the `seq` log), both snap to the
  same persisted order → "settled to the right thing after many seconds." Exactly the reported shape.
- **file:line:** `agent_runs.py:141-166` (start/overwrite/chain), `agent_runs.py:99-105` (chain wait),
  `chat_routes.py:1361-1369` (queue=True dispatch + run-started), `chat.js:3744` & `sessionSync.js:73`
  (resume self-guard that prevents a busy window from sharing the peer's run).

### D2 — [PRIMARY] Streaming game-turn completion never broadcasts `message-added` (the "dead leg")
- **What the code does:** the streaming assistant save goes through `save_assistant_response`
  (`chat_helpers.py:2560,2631`), which calls **`sess.add_message(...)` = `Session.add_message`**
  (`models.py:64-76`). That method appends to `history` and calls `_persist_message` — but does **NOT**
  publish anything. Only the OTHER entry point, `SessionManager.add_message`
  (`session_manager.py:189-220`), carries the ADR-0008 completion broadcast (`message-added` with
  `{id, seq, client_msg_id}`). The streaming path bypasses it.
- **Which window sees what:** for a streaming game turn the peer ever only receives `run-started`
  (`chat_routes.py:1368`) — never a completion event. If the peer's `resumeStream` did not attach (it
  was busy, D1; or it joined after the buffer was evicted; or its attach raced), it has NO later signal
  that the assistant turn landed. Its view stays stale until the next `game-updated` poll-ping or a
  manual reload.
- **Why the symptom:** this is the recovery path that ADR 0008 §Decision item 4 *specified* ("publish
  `message-added` when a streaming turn persists") but which is **not wired for the streaming save**.
  Its absence is precisely why divergence persists for "many seconds" instead of self-healing the moment
  the turn completes. (`session_manager.add_message`'s broadcast only fires for non-streaming saves,
  e.g. the finalize path at `chat_routes.py:391-396` and inject-context at `:1440`.)
- **file:line:** `models.py:64-76` (silent `Session.add_message`), `chat_helpers.py:2631` (streaming save
  uses it), `session_manager.py:209-219` (the broadcast that the streaming path skips),
  `chat_routes.py:1368` (only `run-started` fires for the stream).

### D3 — [HIGH] `resumeStream` attaches to "whatever `_RUNS[session_id]` is now," by id-less subscribe
- **What the code does:** `/api/chat/resume` → `agent_runs.subscribe(session_id)` resolves the run by
  `_RUNS.get(session_id)` (`agent_runs.py:173`) — the LATEST run, not the run named in the `run-started`
  event. ADR 0008 §Decision item 4 explicitly called for "make `resumeStream` attach to a run **by id**,
  not whatever `_RUNS[session_id]` is now"; that was NOT done (there is no run id in the event payload —
  `chat_routes.py:1368` publishes `run-started` with no id, and `subscribe()` takes only `session_id`).
- **Which window sees what:** during a rapid double-send / chained queue, the peer's resume can attach to
  run #2's empty/partial buffer while window A is still showing run #1, or replay run #1's buffer then
  get a `[DONE]` sentinel for run #1 and stop — missing run #2 entirely. Whichever run the pointer names
  at attach time wins; the windows can name different ones.
- **Why the symptom:** contributes the "wrong run / stops early then is stale" flavor of the mismatch and
  defeats the recovery that D2's missing broadcast would otherwise have triggered.
- **file:line:** `agent_runs.py:169-204` (subscribe by session, not run-id), `agent_runs.py:163-164`
  (pointer overwrite), `chat_routes.py:1368` (no run-id in the event), `chat.js:3742-3744`.

### D4 — [MEDIUM] A busy/streaming window DEFERS reconcile to end-of-stream (not live)
- **What the code does:** `softReloadHistory` bails to `_pendingReconcile` when `hasActiveStream(id)` is
  true (`chat.js:3701`); it only rebuilds to the `seq` order at stream end via `flushPendingReconcile`
  (`chat.js:3722-3730`, fired from the stream `finally` at `chat.js:3293`). `hasActiveStream` is true if
  THIS window sent (`_streamSessionId`), is resuming, or has a background stream (`chat.js:158-161`).
- **Which window sees what:** while either window is mid-turn it will NOT pull the peer's just-persisted
  turns into view — by design, to avoid stomping the live stream. So even though the `seq` log is correct
  server-side, neither window shows the convergent order until its own stream settles.
- **Why the symptom:** this is the mechanism that makes the divergence VISIBLE for the full turn duration
  ("for 30 seconds") rather than flickering and resolving. It converts a momentary race into a sustained
  visible mismatch, then "snaps" at `flushPendingReconcile`. It is a deliberate trade (don't fight the
  stream) but it directly produces the owner's "out of sync the whole time, then snaps" experience.
- **file:line:** `chat.js:3701` (defer), `chat.js:3722-3730` (flush at end), `chat.js:3286-3293`
  (clear `_streamSessionId` + deferred flush in `finally`), `chat.js:158-161` (hasActiveStream).

### D5 — [MEDIUM] `/api/history` serves IN-MEMORY append order, not `seq` order, when history is hot
- **What the code does:** the history route iterates `session.history` **in list/append order**
  (`history_routes.py:54-83`) and only falls back to the `ORDER BY seq` DB read when in-memory is empty
  (`history_routes.py:86-126`). During live play the in-memory list is populated, so the seq-ordered DB
  read is bypassed. The `seq` VALUES are attached per message, but the ARRAY is not re-sorted by them.
- **Which window sees what:** the FE divergence check (`chat.js:3693-3698`) compares the rendered id
  order against `serverIds = visible.map(_serverMsgId)` **in the server's array order** — it trusts the
  server to have already sorted. If a peer's concurrent assistant turn was appended to `session.history`
  out of `seq` order (interleaved writers under the per-session race the `UNIQUE(session_id, seq)` index
  resolves at persist time but the in-memory list does not re-order), the FE rebuilds both windows to the
  in-memory append order, which can differ from the authoritative `seq` order — a *convergent-but-wrong*
  reconcile (both windows agree with each other yet disagree with the `seq` log until a reload re-hydrates
  from the DB).
- **Why the symptom:** secondary; it makes the "snap" land on the wrong order in the interleaved case
  (the residual the ADR's "remaining verification" item explicitly left unproven), so a subsequent reload
  is still sometimes REQUIRED to reach the true order — contradicting ADR 0008's "reload never required."
- **file:line:** `history_routes.py:54-83` (in-memory append-order serve), `:86-126` (seq-order only on
  empty), `chat.js:3693-3698` (FE trusts server array order). Contrast `session_manager._db_to_session`
  (`session_manager.py:143-145`) and `truncate_messages` (`:354`), which DO order by seq.

### D6 — [LOW] Fresh `new Date()` timestamps on resume; cosmetic role-line divergence
- **What the code does:** the resumed bubble stamps its role timestamp with `new Date()` at attach time
  (`chat.js:3766`), and the sender stamps its own at send time (`chat.js:975`). Two windows attaching at
  different wall-clock moments show different role timestamps for the same logical message.
- **Which window sees what / why:** a minor, visible "not byte-identical" mismatch even when content
  converges. Not a token-stream divergence, but it violates the strict "byte-identical" bar the owner set
  and is worth noting for a true Messenger mirror.
- **file:line:** `chat.js:3766` (resume), `chat.js:975` (send).

### D7 — [LOW/LATENT] Eviction of a finished `_Run` after 180s defeats late reconnect
- **What the code does:** a terminal run + buffer is evicted after `_EVICT_GRACE_S = 180`
  (`agent_runs.py:42, 56-75`). A window that was offline/backgrounded longer than the grace window, then
  returns, finds no run to resume and — absent D2's missing `message-added` — has only the `game-updated`
  poll/`orwell:gamechanged` debounce (`platform.js` `orwellGameChanged`, `sessionSync.js:32-34`) to
  recover. Bounded, but a real "stayed stale longer than expected" tail.
- **file:line:** `agent_runs.py:42,56-75,128-138`.

---

## 4. The SINGLE root architectural gap

**There is no one authoritative live generation per turn that all windows are guaranteed to render from.**
The shared-broadcast primitive exists (`agent_runs._Run` replay buffer + `subscribe`), but a turn is
**bound to the request that started it, not to the session as a single broadcast channel**: a second
concurrent send spins up a *second* run and silently re-points `_RUNS[session_id]` at it
(`agent_runs.py:163-164`), the peer-attach handshake is best-effort and id-less (`resumeStream` +
`run-started`, self-suppressed while busy), the streaming-turn completion never broadcasts the
reconcile signal (`Session.add_message` dead leg, `models.py:64-76` vs `session_manager.py:209-219`),
and reconciliation is deferred to end-of-stream and trusts in-memory append order. So the system
delivers **eventual read-your-writes convergence on the persisted log**, not the **single-writer,
fan-out-the-one-live-stream linearizability** the Messenger requirement demands.

**One-sentence root cause:** *Each window runs its own request-scoped generation and merely tries to
reconcile afterward, because the live token stream is bound per-request (with an id-less, busy-suppressed
peer attach and no streaming-completion broadcast) instead of being a single per-session authoritative
broadcast that every window subscribes to — so under concurrent or merely active two-window use the
windows render different in-flight generations for the whole turn and only snap together once it ends.*

---

## 5. Differential — competitors considered and ruled out

- **Poll-lag (20-30s HUD poll) as the cause?** Ruled out: the conversation does not depend on the HUD
  poll; it has its own SSE seams (`/api/chat/events`, `/api/chat/resume`). The 30s is the *turn duration*
  (multi-round agent loop), not a poll interval. `game-updated` pings the HUD, not the chat bubbles.
- **Lost update / data loss?** Ruled out: the audit (ADR 0008 §Source) and the persistence code show the
  `seq` log is intact and a reload reconciles (49/49). The defect is render-layer live replication, not
  storage. D5 is an *ordering* defect on read, not a lost write.
- **Engine (closed-set) inconsistency?** Ruled out: `beatSeq` matched on every iteration, zero 409s
  (ADR 0008 §Source). The engine half (feature 0065) is solid; this is entirely FE chat-log replication.
- **Pure ordering race on a non-unique timestamp (the ORIGINAL S3-RACE finding)?** Partially fixed:
  `seq` + `UNIQUE(session_id, seq)` closed the persist-order race, but D5 shows the READ path
  (`/api/history` in-memory branch) still doesn't sort by it, and D1/D2/D3 are *live-stream* races the
  `seq` work never addressed. So the symptom survives the ADR-0008 persistence fix.
- **Optimistic-UI showing a state the engine refused?** Not applicable here — the chat log is FE-owned;
  no engine refusal (409) is involved. The optimism is in *which generation each window renders*, not in
  a board claim.

---

## 6. Convergence assessment

- **Does window B reach engine/persisted truth?** Yes — eventually. Via: (a) `flushPendingReconcile`
  at its own stream end (`chat.js:3293`), (b) a `message-added`/`run-started` SSE *if* one fires, (c) a
  `game-updated` poll-ping → `orwell:gamechanged` (HUD only, not chat bubbles), or (d) a manual reload.
- **Latency:** for the contended case, ~the full turn duration (tens of seconds), i.e. it does NOT
  converge live — it converges at turn settle. For the offline-past-180s case, until the next poll/reload.
- **Seam:** the convergent seam is the **deferred `softReloadHistory` rebuild to the `seq` log**, not the
  live token stream. That is the gap vs. the Messenger requirement.
- **Does a stale state self-loop?** No infinite loop observed; the `seq` log is a stable fixpoint. But D5
  can converge both windows to a *wrong* order that only a DB re-hydrate (reload) corrects.

---

## 7. Top findings (ranked by contribution to visible mismatch)

1. **D1** — concurrent/active sends create two live runs; each window tails its own → different text for
   the whole turn. (`agent_runs.py:163-164`, `chat_routes.py:1361-1369`, `chat.js:3744`/`sessionSync.js:73`)
2. **D2** — streaming game-turn completion never broadcasts `message-added` (the `Session.add_message`
   dead leg) → no live recovery signal; divergence persists to turn end. (`models.py:64-76` vs
   `session_manager.py:209-219`; `chat_helpers.py:2631`)
3. **D3** — `resumeStream` attaches by session to "whatever `_RUNS` is now," not by run-id → peer can tail
   the wrong/empty run. (`agent_runs.py:169-204`, `chat_routes.py:1368`)
4. **D4** — a busy window defers reconcile to end-of-stream, making the mismatch visible the whole turn,
   then snapping. (`chat.js:3701`, `:3722-3730`, `:3286-3293`)
5. **D5** — `/api/history` serves in-memory append order, not `seq` order, when hot → a convergent-but-
   wrong reconcile that still needs a reload. (`history_routes.py:54-83`)
6. **D6** — fresh `new Date()` resume timestamps break strict byte-identity. (`chat.js:3766`, `:975`)
7. **D7** — 180s run eviction defeats a late reconnect. (`agent_runs.py:42,56-75`)

**Confidence:** High that D1+D2 are the dominant contributors to the owner's exact "different text for
30s then snaps" shape (mechanism traced end to end through start/overwrite/chain → per-window POST
stream → missing completion broadcast → end-of-stream deferred rebuild). Medium-high on D3/D4 as
amplifiers. Medium on D5 as the residual that keeps a reload sometimes necessary (consistent with ADR
0008's own un-closed verification item).

**Falsifier:** If a live two-window run shows window B's bubble streaming the IDENTICAL tokens to window
A in real time (not after turn settle) under a concurrent send from B — i.e. both windows provably share
one `_Run` for the contended turn — then D1/D3 are wrong. The code path (two POSTs → two
`agent_runs.start` → `_RUNS` overwrite → two `subscribe` streams, with the peer-attach self-suppressed
while busy) predicts they will NOT share, so observing shared live tokens under concurrent send would
falsify the primary finding.
