# Mirror-C — the two-window lockstep "Messenger mirror" fix: implementation design

> **Status:** Design (2026-06-21). The binding **build plan** for ADR
> `docs/decisions/0012-two-window-lockstep-mirror.md` — this doc is that ADR's implementation
> section. READ-ONLY investigation; **no code is changed here**.
> **Scope:** FE-side (`frontend/`). Open-set narration mirror only — closed-set serialization stays
> the engine's job (feature 0065 `beatSeq`/409). Vault Wall + cross-user isolation untouched.
> **Requirement:** two browser windows on the **same game** render the live conversation
> **byte-identical and in lockstep** (one authoritative generation, fanned out token-by-token to
> every open window), Facebook-Messenger style — independent of which window initiated; a window
> opened or refreshed **mid-generation** replays then live-tails the **same** in-flight stream and
> never starts its own. NOT turn-lock (feature 0064 forbids it).

---

## 1. The current game-turn stream path (end to end), and where it forks

### 1.1 Server: one POST → one private run keyed on the *per-tab* session

`frontend/routes/chat_routes.py` `POST /api/chat_stream` (`chat_stream`, ~412):

1. Resolves `session` from the **form field** the window posted — the per-tab open session id, NOT
   the canonical game session.
2. Builds context via `build_chat_context` (`routes/chat_helpers.py`). For a framed/game turn this
   calls `_bind_canonical_game_session(user, session_id)` (chat_helpers.py ~1443 / ~1535 →
   `src/orwell_game_session.bind_game_session`, **first-writer-wins**). **Binding records that this
   session *is* the canonical game session — it does NOT change the session id this request streams
   under.**
3. Constructs `stream_with_save()` (the agent loop generator; ~798) wrapped as `_safe_stream()`.
4. **Detaches it as a run:** `agent_runs.start(session, _safe_stream(), queue=bool(ctx.framed))`
   (~1365) — keyed on the **per-tab `session`**.
5. `session_events.publish(session, "run-started")` (~1368) — also on the per-tab session.
6. Returns `StreamingResponse(agent_runs.subscribe(session), …)` (~1369) — so even the **sender**
   reads its own reply back through `subscribe()`.

`agent_runs._Run` (`frontend/src/agent_runs.py`) is exactly the replay-then-live-tail primitive ADR
0012 wants: `_publish` appends to `run.buffer` and fans out to every subscriber queue; `subscribe()`
replays the whole buffer then live-tails; `start(..., queue=True)` already chains a second game turn
behind an in-flight one (feature 0064 Part C). **The primitive is correct and already used. The bug
is the key and the sender's render path, not the primitive.**

### 1.2 Browser: the sender renders a PRIVATE stream; observers use a DIFFERENT path

- **Sender** (`frontend/static/js/chat.js`, the send/stream consumer ~595–3300): captures
  `streamSessionId = sessionModule.getCurrentSessionId()` (line 602), POSTs `/api/chat_stream` with
  that session (~1078), and consumes **its own POST response** through the rich primary stream loop
  (multi-bubble agent rounds, `roundReplyText`/`roundReasoningText` channel split, tool bubbles,
  sources, doc streaming, metrics). It builds the AI bubble locally with a **client-side timestamp**
  `new Date().toLocaleTimeString(...)` (line 975).
- **Observer already open on the SAME session** (`frontend/static/js/sessionSync.js`): the
  `/api/chat/events/{session}` SSE delivers `run-started`; `handle('run-started')` (~69) runs
  `softReloadHistory` then, if idle, `chat.resumeStream(id)` (~73) → `GET /api/chat/resume/{id}` →
  `agent_runs.subscribe(id)`. `resumeStream` (chat.js ~3742) is a **separate, simpler** consume loop
  with its **own** bubble + its **own** `new Date()` timestamp (line 3766) and a coarser
  `rich`→reload heuristic.
- **Observer opening mid-generation** (`frontend/static/js/sessions.js` ~2170): on session select,
  `_checkServerStream` hits `/api/chat/stream_status/{id}`, and if streaming calls
  `chat.resumeStream(id)` (~2183) — same resume path.

### 1.3 The three concrete fork points (why the windows diverge for ~30s then snap)

1. **Two windows can key two different `_Run`s.** The run is keyed on the **per-tab** `session` form
   field (chat_routes.py ~1365), not the canonical game session. Convergence onto the canonical id is
   **best-effort**: `_bind_canonical_game_session` is *first-writer-wins*, and the second window only
   adopts the canonical id if its client polled `/api/orwell/game-session` and `selectSession`'d onto
   it (`orwellOnboarding.js` ~349). Two windows that each opened their **own** chat (e.g. both land on
   a fresh "new chat", or one is on an older game chat) hold **different** session ids → each POST
   starts an **independent** `_Run` → **two independent open-set generations** (the reported
   divergence). This is the **primary** root cause.
2. **The sender never subscribes to the shared run — it renders a private copy.** Even when both
   windows *are* on one session, the **sender** renders the rich primary POST-stream loop while
   **observers** render through `resumeStream`. These are **two different render code paths** with
   different bubble construction, different timestamps (`new Date()` at send vs. at attach vs. the DB
   `timestamp`), and a different rich/finalize heuristic. Byte-identical is not even structurally
   guaranteed. ADR 0012 §1 ("the initiating window's stream is teed to the shared buffer rather than
   rendered privately") targets exactly this.
3. **The `message-added` completion broadcast is DEAD on the streaming path.** The broadcast lives
   **only** in `SessionManager.add_message` (`frontend/core/session_manager.py` ~209–218). The
   streaming save path (`save_assistant_response` → `sess.add_message`, `frontend/core/models.py`
   ~64–76) calls `self._session_manager._persist_message(...)` **directly**, which stamps `_db_id` +
   `_seq` (session_manager.py ~293–294) but **does not publish** `message-added`. So at completion no
   authoritative `{id, seq}` is broadcast; the late "snap" relies on `softReloadHistory`'s polling /
   `run-started`-driven reconcile (ADR 0008), which is why convergence lands **seconds late**.

> **Net:** the windows agree only on the closed set (`beatSeq`, the board, the settled log after a
> reconcile). The **live open-set token stream** is never a shared resource — exactly ADR 0012's
> root cause.

### 1.4 Two reinforcing gaps confirmed in the parallel parity investigation

A second independent read (consistency-parity lens) confirmed all of the above and surfaced two
notification-layer details that the fix must close, or the shared run still won't reach an idle peer:

- **`session_events` has NO replay buffer (at-most-once).** `publish` is
  `if not subs: return` (`frontend/src/session_events.py` ~41–43) — `run-started` fired in the gap
  between an idle window selecting the session and its SSE actually connecting (the `sessionSync.js`
  ~1500ms `tick` reconnect) is **dropped silently**. The idle window then attaches only on its next
  HUD poll or a manual select. So even with one shared `_Run`, an idle peer can miss the *invitation*
  to subscribe. (`agent_runs`' OWN buffer is durable; the `session_events` *notification* channel is
  not.)
- **The in-game session-resolution ladder has NO canonical step.** `sessions.js` resolves
  `hash → currentSession → lastSessionId → most-recent` (~1380–1417) with **no** canonical-session
  preference. Client convergence onto the canonical id lives only in
  `orwellOnboarding.openFreshInterviewSession` (`orwellOnboarding.js` ~349–382), which is
  **casting-phase-only** and `route()` early-returns once a season is started (~561–566). A window
  opened **fresh mid-game** (new tab, cleared storage, a second device that never cast) lands on its
  own per-tab session and never force-selects the canonical one — the concrete split-brain path.

---

## 2. The shared-stream broadcast design

### 2.1 Key the run on the CANONICAL game session, not the per-tab session

This is the linchpin and the smallest change with the largest effect.

- On a **framed (game/casting) turn**, the run and all SSE/subscribe keys must be the **canonical
  game session id** resolved BEFORE the run starts. `build_chat_context` already binds it; expose the
  effective canonical id on `ctx` (e.g. `ctx.canonical_session`) and use it as the run key when
  `ctx.framed`.
- A **non-framed plain chat** turn keeps keying on the per-tab `session` (unchanged behavior; plain
  chats are not the shared-game surface and keep cancel-on-double-send).
- **Cold-start ordering (ADR 0012 "Open / to confirm").** Bind the canonical session **before** the
  first shared run starts. `_bind_canonical_game_session` already runs inside `build_chat_context`
  (before `agent_runs.start`), so the ordering holds for the *first* framed turn of a window; the
  remaining gap is two **fresh** windows racing the very first bind. First-writer-wins makes the bind
  deterministic; the loser window must **re-key onto the winner** — see §2.4.
- **In-game convergence is a CLIENT change too (§1.4).** Keying the run on the canonical id server-side
  is necessary but not sufficient: a window opened fresh mid-game must actually **be on** the canonical
  session. Add a canonical step to the `sessions.js` resolution ladder — whenever a season is started,
  resolve `/api/orwell/game-session` and force-select the bound id as the **highest-priority** target
  (above `lastSessionId`/hash). This generalizes the casting-only convergence in `orwellOnboarding.js`
  to every in-game load.

### 2.2 Sender subscribes too — one render path for every window

The sender must stop rendering a private copy and instead render through the **same** subscribe path
every observer uses, so all windows execute identical render code over identical buffered events.

Two viable shapes (pick A; B is the fallback if A is too invasive for one PR):

- **(A, preferred — true tee, minimal new code):** the server already returns
  `agent_runs.subscribe(session)` to the POSTer (chat_routes.py ~1369), so the sender's HTTP response
  **is** the shared buffer replayed+tailed. The remaining work is **client-side**: make the sender
  render its POST response through the **same consume routine** the observer uses (the
  `resumeStream`/subscribe renderer), rather than the bespoke primary loop. Concretely: factor the
  rich consume loop (channel split, tool bubbles, sources, docs, metrics, finalize) into **one shared
  renderer** that both the POST response and `/api/chat/resume` feed. Then the sender and observer are
  the same code over the same bytes ⇒ byte-identical by construction.
- **(B, fallback):** keep the sender's POST loop but **discard its body render** and have the sender
  ALSO attach via `resumeStream(canonical)` like an observer (POST only kicks the run; rendering is
  always the subscribe path). Simpler to land but the sender briefly double-attaches; needs a guard so
  the POST reader doesn't render. A is cleaner and avoids a self-double-render.

In both, the **timestamp** must come from the **stream/DB**, not `new Date()` at the client. The
server should emit the canonical message timestamp (it already stamps `metadata.timestamp` /
`_message_timestamp_iso` in `_persist_message`) and both bubble builders must use it. Remove the
client `new Date()` at chat.js:975 and chat.js:3766 in favor of a server-provided time (carried on
`model_info` or the `message_saved`/`message-added` event).

### 2.3 Late join + refresh = replay then live-tail (already correct once keyed right)

- **Window opened mid-generation:** `sessions.js` `_checkServerStream` → `resumeStream(canonical)` →
  `subscribe()` replays the buffer (catch-up) then live-tails. Works **once the key is the canonical
  session** (§2.1) so `stream_status`/`resume` find the live run.
- **Refresh mid-generation:** on reload, the session-restore path (`sessions.js` ~2170 +
  `chat.js resumeStream`) re-subscribes to the SAME `_Run` (the run is detached and survives the SSE
  drop — `agent_runs._drain` runs to completion regardless of subscribers). No fresh generation. The
  `_EVICT_GRACE_S = 180` retention (agent_runs.py ~42) already covers a refresh landing just after
  `[DONE]`.

### 2.4 Two windows that BOTH type near-simultaneously

Two authorities, cleanly separated:

- **Closed set (the engine's job, unchanged):** feature 0065 `beatSeq` CAS — the second mutating tool
  call carries a stale `expectedBeatSeq`, the engine refuses with **409 `stale-beat`** before any
  write, and the FE reconciles through the existing desync mechanism. Progression never double-applies.
- **Open set (this design):** because both windows key the **canonical session**, the
  `agent_runs.start(canonical, …, queue=True)` path (feature 0064 Part C) makes the second turn
  **CHAIN** behind the first (`_drain` awaits `prev_task`) instead of forking — one reasoning chain at
  a time, serialized, each fanned out to **all** windows. The live turn is never stomped; the second
  turn streams to everyone once the first ends. The `run-started` event tells idle windows to attach.
- **The loser-of-the-bind window** (cold start, §2.1): when window B's framed turn resolves the
  canonical id to A's session (first-writer-wins returns A's id), B must **re-key**: its POST should
  carry the canonical id (server can rewrite to the bound canonical for framed turns), and its client
  should `selectSession(canonical)` so its SSE/subscribe attach to the shared run. This closes the ADR
  0012 cold-start gap.

### 2.5 Reconcile with the existing seams (no new transport, no double-refresh)

- **`_publish_game_updated` (feature 0064, `orwell_routes.py` ~113):** unchanged. It pings the
  canonical session's `/api/chat/events` with `game-updated`; `sessionSync.js` routes it through
  `window.orwellGameChanged` (the **single** `orwell:gamechanged` dispatcher, `platform.js`). HUDs
  reconcile; this design adds no new dispatcher and no new poll (honors the g15 single-dispatcher
  invariant).
- **`orwell:gamechanged` debounce (`platform.js`):** unchanged — still the only dispatcher.
- **ADR 0008 (`seq` + reconcile-by-id + completion broadcast):** the settled-log reconcile stays the
  correctness floor; this design makes the **live** stream shared so the windows don't *need* the
  reconcile to look identical mid-turn, and §3 revives the dead completion broadcast so the settled
  snap also lands promptly.
- **ADR 0065 `beatSeq`/409:** unchanged; the open-set mirror and the closed-set CAS are orthogonal.

---

## 3. File-by-file change plan (an implementer can execute this)

### 3.1 Server — key framed runs on the canonical session

**`frontend/routes/chat_helpers.py`** — `build_chat_context` / its result object
- Resolve and expose the **effective canonical game session id** on the context object for framed
  turns: after `_bind_canonical_game_session(user, session_id)`, read back
  `orwell_game_session.get_game_session(user)` and set `ctx.canonical_session` (fall back to
  `session_id` when unbound/unframed). Vault-free (a session id only).
- *(Optional, recommended)* return the bind's effective id from `_bind_canonical_game_session` so the
  caller learns when it was the **loser** (effective id != its own `session_id`) for the §2.4 re-key.

**`frontend/routes/chat_routes.py`** — `chat_stream`
- Compute `run_key = ctx.canonical_session if getattr(ctx, "framed", False) else session`.
- `agent_runs.start(run_key, _safe_stream(), queue=bool(ctx.framed))` (was `session`).
- `session_events.publish(run_key, "run-started")` (was `session`).
- `return StreamingResponse(agent_runs.subscribe(run_key), …)` (was `session`).
- **Persist under the canonical session too.** The agent-loop save path (`save_assistant_response`,
  `ensure_turn_recorded`, the user-message persist in `build_chat_context`) must write to the
  **canonical** session so all windows' history/`seq` agree. If `run_key != session` (loser window),
  redirect the turn's persistence + `_active_streams` key to `run_key`, OR (cleaner) **reject/redirect
  the framed POST to the canonical session id** so the window adopts it (return the canonical id in an
  early `data: {"type":"canonical_session", "id": …}` event the client uses to `selectSession`). Pick
  one and pin it with a test; do not leave persistence split across two session ids.
- `/api/chat/resume/{id}`, `/api/chat/events/{id}`, `/api/chat/stream_status/{id}`,
  `/api/chat/stop/{id}` already accept an explicit id — observers will pass the canonical id (they
  already resolve it via `/api/orwell/game-session`). No route signature change.

### 3.2 Server — revive the dead `message-added` completion broadcast

**`frontend/core/models.py`** — `ChatSession.add_message` (~64–76)
- After `self._session_manager._persist_message(self.id, message)`, publish the completion event with
  the authoritative `{id, seq, role, client_msg_id}` now stamped on `message.metadata` (`_db_id`,
  `_seq`). i.e. move/duplicate the broadcast block from `SessionManager.add_message` (session_manager.py
  ~209–218) so it fires on the path the streaming save actually uses.
- **Cleaner alternative (preferred):** move the broadcast **into `_persist_message`** itself
  (session_manager.py, right after `message.metadata['_db_id']`/`_seq` are set, ~294) so **every**
  persist path (both `SessionManager.add_message` and `ChatSession.add_message`) broadcasts exactly
  once. Then drop the now-redundant block at session_manager.py ~209–218 to avoid a double-publish.
- Payload stays Vault-free (ids/seq/role/client_msg_id only — never content), matching ADR 0008.

### 3.3 Client — one render path; canonical-session attach; server timestamps

**`frontend/static/js/chat.js`**
- **Unify the renderer (ADR 0012 §1).** Factor the rich consume/render loop (channel-split
  `roundReplyText`/`roundReasoningText`, tool bubbles, sources, doc streaming, metrics, finalize) out
  of the primary send loop into **one shared renderer** consumed by BOTH the POST response (sender)
  and `/api/chat/resume` (observer). The sender no longer renders a bespoke private copy — it renders
  the same subscribe stream every window does. (Shape A in §2.2.)
- **Remove client-minted timestamps:** chat.js:975 (`const roleTs = new Date()...`) and chat.js:3766
  (resume path) must use a **server-provided** message timestamp (carried on `model_info` or the
  `message_saved`/`message-added` payload) so all windows render the identical time string.
- **Key on the canonical session for framed turns:** `streamSessionId` (line 602) and the
  `/api/chat_stream` `session` field must be the canonical game session when a game/casting is active
  (resolve via the cached `/api/orwell/game-session` or adopt the server's `canonical_session` event).
  If the server redirects (loser window), `selectSession(canonical)` and re-attach.
- **Drop the mid-turn DB reload on a plain reply (ADR 0012 §1, the divergence at ~3889–3893).** When
  `resumeStream`/the shared renderer finishes a plain (non-rich) reply, finalize **in place** from the
  streamed buffer (it already does for plain text at ~3880); the **rich** branch's `selectSession`/
  `loadSessions` reload (~3891–3893) should be reserved for genuinely rich turns AND should reconcile
  via the (now-live) `message-added` `{id, seq}` rather than a blind full reload, so a finishing turn
  doesn't yank the bubble out from under a window mid-read. Keep the reload only where the rich render
  truly needs the DB record.

**`frontend/static/js/sessionSync.js`** — no structural change
- `handle('run-started')` and `resumeStream` already do replay-then-tail; they now attach to the
  **canonical** run because the server keys/publishes on it. Confirm the `id` it receives is the
  canonical session (it is — the server publishes `run-started` on `run_key`).
- `message-added` (~77) now actually fires at completion → `scheduleReconcile` lands the settled snap
  promptly (closes the late-snap tail).

**`frontend/static/js/sessions.js`** — `_checkServerStream` (~2170) needs no change; it already
calls `resumeStream(sessionId)` for the open session. BUT the session-resolution ladder (~1380–1417,
`hash → currentSession → lastSessionId → most-recent`) **must gain a canonical step** (§1.4 / §2.1):
when a season is started, resolve `/api/orwell/game-session` and force-select the bound id ahead of
`lastSessionId`/hash so a fresh mid-game window lands on the shared session and its
`_checkServerStream`/`resumeStream` attach to the live run instead of starting a parallel game.
*(Optional belt:* run `_checkServerStream` on SSE-**connect**, not only on session-select, so a window
that connected late still discovers an in-flight run.)*

### 3.4b Server — make the `run-started` invitation durable (§1.4)

**`frontend/src/session_events.py`** — `publish` / `subscribe`
- Give `session_events` a tiny per-session **ring buffer** (last N events, e.g. the most recent
  `run-started`/`message-added`), replayed on `subscribe()` after the `connected` hello — mirroring
  `agent_runs._Run.buffer`. Today `publish` is `if not subs: return` (~41–43): an event fired before a
  window's SSE connects is lost, so an idle peer can miss the invitation to attach to the shared run.
  Replay-on-connect closes the at-most-once gap. Keep it id/seq/type-only (Vault-free) and bounded
  (a couple of events per session is enough — this is a reconnect catch-up, not a log).

### 3.4 Tests (the binding gates — ADR 0012 "Verification")

- **`frontend/tests/test_0012_mirror.py` (new):** assert (a) a framed `/api/chat_stream` keys
  `agent_runs.start`/`subscribe` on the **canonical** session, not the per-tab session; (b) the
  `message-added` broadcast fires on the **streaming** save path (the `sess.add_message` →
  `_persist_message` route), not only on `SessionManager.add_message`; (c) a second framed turn on the
  canonical session **chains** (queue=True) rather than forking; (d) `session_events.subscribe`
  **replays** a just-published `run-started` to a window that connects after the publish (the §1.4
  durability gap).
- **Upgrade the ADR-0008 contract gate (it is currently a source-pin only).**
  `frontend/tests/test_adr0008_reconcile_contract.py` greps `session_manager.py` for the literal
  `"message-added"` — it stays green even though the streaming completion path bypasses that function
  entirely. Replace/extend it to **exercise** `save_assistant_response`/`_persist_message` and assert
  the event is actually **published** with `{id, seq, client_msg_id}`. Without this, the dead-leg fix
  has no regression guard.
- **Two-window filmstrip harness (parallel build, referenced by the ADR):** two headless windows on
  one game must show **byte-identical token timelines** during live generation, including a window
  that **joins mid-stream**; plus a **50× concurrent smoke loop** clean.
- **Single-window byte-identity guard:** with one subscriber, the shared run renders exactly as today
  (the tee/replay are inert) — a regression gate so the refactor doesn't perturb the solo path.
- Run the **whole** FE suite (`cd frontend && python3 -m pytest tests/`) — several gates are
  source-pinned convention checks (g15 single-dispatcher, the reasoning-scrub, the render contract)
  that a `-k` subset silently skips.

---

## 4. Risks and the live-test gates

| Risk | Mechanism | Mitigation / gate |
|---|---|---|
| **Double-streaming / self-double-render** | Sender both consumes its POST body AND re-attaches via resume → two renders of the same run in one window. | Shape A (one shared renderer over the single subscribe stream) eliminates it by construction. If Shape B: a hard guard so the POST reader does not render — only the resume attach does. Pin with the single-window byte-identity test. |
| **Token ordering at the replay→live-tail splice** | A late-joining window must get the exact buffer prefix then live tokens with no dup/drop at the handoff. | `agent_runs.subscribe()` already registers the queue **before** replaying and skips `seq < next_seq` on the live side (agent_runs.py ~176, ~195) — the splice is correct; the harness must **prove** it on a mid-stream join (ADR 0012 open item #1). |
| **Completion/persist race** | Run finishes + persists while a window is mid-replay; or two windows both try to finalize. | Persistence is server-side and single (one run, one save). The revived `message-added` `{id, seq}` is the single authoritative finalize signal; clients reconcile **by id**, idempotently (ADR 0008). Test: refresh landing in the `[DONE]`→evict grace window still shows the finished turn. |
| **Cold-start split run** | Two fresh windows race the first canonical bind → two runs before convergence. | Bind canonical **before** the first shared run (already ordered in `build_chat_context`); first-writer-wins is deterministic; the **loser re-keys** onto the winner (§2.4). Gate: a concurrency test starting two windows with no prior bind ends on **one** run. |
| **Persistence split across two session ids** | If the loser window persists under its own id while streaming under canonical, history diverges. | §3.1: redirect the framed turn's persistence (and `_active_streams`) to the canonical id, OR redirect the POST to the canonical session id outright. Pin with a test that both windows' `/api/history` are identical after the turn. |
| **Plain-vs-rich finalize divergence** | The mid-turn `selectSession`/`loadSessions` reload (~3891) yanks the bubble and can render differently from the live stream. | Finalize plain replies in place; reserve the DB reload for genuinely rich turns and reconcile by `{id, seq}` not a blind reload. |
| **Vault / cross-user leak** | Keying on the wrong session could fan one user's run to another. | The canonical key is **per-user** (`orwell_game_session` is keyed by `_current_user`); `/api/chat/events|resume` already enforce `_verify_session_owner`. No Vault data is in the stream (same Vault-free narration a single window renders). Gate: the existing owner-guard tests + a cross-user no-fan-out assertion. |
| **Idle peer misses the invitation** | `session_events` is at-most-once; `run-started` fired before a window's SSE connects is dropped, so the peer never attaches to the shared run. | §3.4b: a small per-session replay ring on `session_events`, replayed on `subscribe`. Gate: test (d) above. |
| **Fresh mid-game window forks** | The session-resolution ladder has no canonical step, so a window opened after game-start lands on its own session and starts a parallel run. | §3.3/§3.4: add the canonical step to the `sessions.js` ladder (force-select the bound game session when a season is started). Gate: a two-window test where the second window opens with no prior bind and converges to one run. |

### What MUST be live-tested against the real model before merge (mandatory)

Every automated gate **stubs the LLM** (`DeterministicNarrator`/`Echo…`), so the real player journey
is exercised only by wiring a real model into the FE. Before merge, with a real model wired
(`POST /api/model-endpoints` + `default_model`/`default_endpoint_id`):

1. **Two real windows, same game, live generation:** the same tokens appear in both windows at the
   same time; neither "types a different response." (ADR 0012's literal requirement.)
2. **Mid-generation join:** open a second window while the first is mid-stream — it replays then
   live-tails the **same** stream, no dup/drop at the splice.
3. **Refresh mid-generation:** refresh the initiating window mid-stream — it re-attaches to the same
   run, no fresh generation, no divergence.
4. **Both windows type near-simultaneously:** the second turn **chains** (one reasoning chain at a
   time), each fanned to both windows; the closed set serializes via 409/`beatSeq` with no
   double-apply.

---

## 5. Scope estimate

**A genuine, bounded FE refactor — not a localized patch.** Three of the five changes are small and
surgical (key on canonical: a few lines in `chat_routes.py` + a `ctx` field; revive `message-added`:
move one block in the persist path; server timestamps: emit + consume one field). The **load-bearing**
work is **§3.3's renderer unification** — collapsing the sender's bespoke primary stream loop and the
observer's `resumeStream` loop into **one shared renderer** so every window runs identical render code
over identical buffered events. That touches the most-regression-prone code in `chat.js` (the
multi-bubble agent loop, channel split, tool/sources/doc rendering) and is where the byte-identity
guarantee is actually earned. The owner has pre-authorized this spec'd refactor; this document is the
implementation section of ADR `docs/decisions/0012-two-window-lockstep-mirror.md`. Estimate: one
focused PR for §3.1/§3.2 (keying + dead-broadcast) behind tests, then a second for §3.3 (renderer
unification) gated by the two-window filmstrip harness and the mandatory live-LLM run.

---

## Appendix — evidence index (file:line)

- `frontend/src/agent_runs.py` — `_Run` buffer+subscribe (25–36), `_publish` fan-out (45–53),
  `_EVICT_GRACE_S=180` (42), `start(..., queue)` chain (141–166), `subscribe()` replay-then-tail
  (169–204).
- `frontend/routes/chat_routes.py` — `chat_stream` (412); run keyed on per-tab `session` (1365);
  `run-started` publish (1368); sender returns `subscribe(session)` (1369); resume/events/status/stop
  routes (1378–1427).
- `frontend/routes/chat_helpers.py` — `_bind_canonical_game_session` (60–71); bind sites in
  `build_chat_context` (1443, 1535); `save_assistant_response` uses `sess.add_message` (2631).
- `frontend/src/orwell_game_session.py` — canonical session store; `bind_game_session` first-writer-
  wins (55–75).
- `frontend/core/models.py` — `ChatSession.add_message` → `_persist_message` directly, no broadcast
  (64–76).
- `frontend/core/session_manager.py` — `message-added` broadcast ONLY in `SessionManager.add_message`
  (203–220); `_persist_message` stamps `_db_id`/`_seq` but does not broadcast (222–296).
- `frontend/static/js/chat.js` — `hasActiveStream` (158); sender keys current session (602);
  POST `/api/chat_stream` (1078); client timestamp at send (975); `resumeStream` separate loop (3742),
  its client timestamp (3766), plain finalize-in-place (3880), rich-branch DB reload (3889–3893).
- `frontend/static/js/sessionSync.js` — `run-started`→`resumeStream` (69–76); `message-added`→
  reconcile (77–79); `game-updated`→`orwellGameChanged` (32–34, 58).
- `frontend/static/js/sessions.js` — `_checkServerStream`→`resumeStream` on open (2170–2185);
  session-resolution ladder with NO canonical step (1380–1417).
- `frontend/src/session_events.py` — at-most-once `publish` (37–49, `if not subs: return` at 41–43);
  `subscribe` yields `connected` then live only, no replay (52–69).
- `frontend/static/js/orwellOnboarding.js` — casting-only canonical convergence (349–382); `route()`
  early-return once a season is started (~561–566).
- `frontend/tests/test_adr0008_reconcile_contract.py` — the `message-added` gate is a **source-pin
  grep**, blind to the dead streaming path (must be upgraded, §3.4).
- `docs/decisions/0012-two-window-lockstep-mirror.md` — the governing ADR (this doc is its build plan).
- `docs/decisions/0008-chat-conversation-consistency.md` — `seq`/reconcile-by-id/completion broadcast.
