# CONSISTENCY & TWO-WINDOW PARITY — exhaustive audit (lens: distributed consistency)

Ground truth = the TS engine (:8765). Same-identity two-window parity is the floor; Orwell is
one-game-per-user, so "cross-identity" = two DIFFERENT users are two FULLY ISOLATED seasons with
NO shared public state to diverge (isolation is by construction; verified `_current_user` →
per-user sandbox). Therefore every parity defect below is SAME-identity (two devices/tabs, one
user, one game) — which is exactly where ADR 0008/0012/0064/0065 live. Intended model: the
closed set (board/outcomes) is linearizable via the engine's per-user promise queue + the 0065
beatSeq CAS spine; the open set (prose) is causal/eventual and reconciled by softReloadHistory +
the mirror stream. The recurring failure class: the CAS spine and the desync spine are wired ONLY
onto the FE-issued belts and assume ONE turn per user at a time — the MODEL-driven and
decision-card progression paths, and the auth-off posture, are left unguarded.

## Index

| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| CON-1 | Major | <1day | High | 0065 CAS spine is fully INERT under auth-off (user=None never tracks beatSeq) | chat_helpers.py:820-833,803-806 |
| CON-2 | Major | <1day | High | Model-driven advanceGame/submitDecision carry NO idempotencyKey — retry double-advances | tool_implementations.py:4814,4853 |
| CON-3 | Major | <1day | High | Model-driven progression never refreshes `_LAST_BEAT_SEQ` → self-409 + spurious RE-GROUND next turn | tool_implementations.py:4811-4857 |
| CON-4 | Major | <1day | Med | Decision-card `/decision` route submits with no expectedBeatSeq/idempotencyKey | orwell_routes.py:1057,1075 |
| CON-5 | Major | multi-day | Med | Desync spine keys per-user, assumes one turn/user — two concurrent windows cross-contaminate baselines | chat_helpers.py:576-580,634-636 |
| CON-6 | Minor | <1day | Med | RPC/JSON-RPC envelope swallows StaleBeatError into isError (HTTP 200) — no stale-beat signal | HttpMcpServer.ts:348-364 |
| CON-7 | Minor | <1hr | Med | SSE fan-out silently drops on a full 256 queue with NO ring re-delivery to a live subscriber | session_events.py:119-123,130 |
| CON-8 | Minor | <1hr | Med | 8-slot replay ring SHARED across run-started/message-added/game-updated evicts the mirror invitation | session_events.py:39-40,92,111-115 |
| CON-9 | Latent | <1day | Med | Engine idempotencyCache CLEARED on snapshot restore + never persisted → void across any restart | GameSessionAdapter.ts:2267,469-470 |
| CON-10 | Latent | <1hr | Med | All cross-device sync state is process-local — uvicorn --workers/WEB_CONCURRENCY silently breaks it | session_events.py:14-16; deploy/systemd/orwell-frontend.service:54 |
| CON-11 | Latent | <1day | Med | R-A-S3: a scene's only consequence fold still evaporates on a double stale-409 | agent_loop.py:2008-2011 |
| CON-12 | Latent | <1day | Med | Whereabouts freeze/desync/runway state bleeds between two windows of one user | chat_helpers.py:639-648,278-289 |
| CON-13 | Latent | <1hr | Low-Med | E22 fallback single-flight per-user drops window B's scene fold under concurrent turns | chat_helpers.py:2605-2611 |
| CON-14 | Latent | <1hr | Low-Med | Auth-off single-tenant collapses two anonymous LAN users into one canonical/desync bucket | chat_helpers.py:600-612; orwell_game_session.py:41-43 |
| CON-15 | Minor | <1hr | Low-Med | Roster blanks on a successful `started:false` read; last-good only serves on exception | orwell_routes.py:663-676 |
| CON-16 | Minor | <1hr | Low | Post-goodbye follow-up advanceGame in /decision is unguarded — retried goodbye POST double-rolls | orwell_routes.py:1070-1077 |
| CON-17 | Polish | <1hr | Low | `_STALE_BEAT_REJECTIONS` is a process-GLOBAL counter, not per-user | chat_helpers.py:793,809-817 |
| CON-18 | Latent | <1hr | Low | `resolve_live_game_session` unbinds a canonical id on a transient empty row → mirror-collapse (#1085 re-risk) | orwell_game_session.py:119-142 |
| CON-19 | Polish | <1day | Low | Background-mirror render uses merged buffer; foreground uses split reply buffer — divergent paths | chat.js:1744-1747,1514-1519 |
| CON-20 | Polish | <1hr | Low | notifyGameUpdated coalesced through the 250ms debounce delays a cross-device decision re-arm | sessionSync.js:96; platform.js:91-102 |
| CON-21 | Latent | <1hr | Low | Model-driven recordInteraction/makeDeal carry no CAS token (only the FE back-fills do) | tool_implementations.py:4811+; agent_loop.py:1996-1998 |
| CON-22 | Minor | <1hr | Low-Med | stateDelta full-refresh fallback silently masks a lost beatSeq under churn (no observability) | GameSessionAdapter.ts:799-814 |

---

## CON-1 — [Severity: Major] [Effort: <1day] [Value: High]
The 0065 beatSeq compare-and-swap spine is FULLY INERT under auth-off (`AUTH_ENABLED=false`)
- Where: `frontend/routes/chat_helpers.py:820-833` (`_refresh_beat_seq` early-returns `if user is None`), `:803-806` (`last_beat_seq` = `_LAST_BEAT_SEQ.get(user)` = `.get(None)`).
- Problem: Under auth-off the FE-internal `user` is `None` (the `x-orwell-user` header is engine-isolation only, not FE auth — documented at `:293-300`). `_refresh_beat_seq` bails on `None`, so `_LAST_BEAT_SEQ` is NEVER populated; `last_beat_seq(None)` is always `None`; every FE-issued progression call (the pre-resolve `:2097`, the back-fills) attaches `expected_beat_seq=None` ⇒ NO compare-and-swap is sent. The entire 0065 Part A CAS guard — the mechanism built for the 0064 queued-turn / two-window lost-update case — is disabled in exactly the posture the live-verify recipe (SOUL lesson 17) runs in, AND in a real documented deploy (single-user LAN, `AUTH_ENABLED=false`). Two devices can then lost-update each other's board with zero protection. This is the SAME "silently inert under auth-off" class already fixed for the social runway (`_runway_key`/`_ANON_RUNWAY_KEY`, `:300-307`) and the desync stores (`_desync_key`, `:600-612`) — but the beatSeq tracker was never given the `_anon` sentinel treatment. Consistency model: intended linearizable-via-CAS collapses to last-writer-wins under auth-off. Violates I10 (fair/reproducible) + the F4 multi-window concurrency bar.
- Fix: give `_LAST_BEAT_SEQ` the same sentinel collapse the runway/desync stores got — key it via a `_beat_seq_key(user)` that maps `None`→`_ANON_RUNWAY_KEY` (or reuse `_desync_key`), and drop the `if user is None: return` bail in `_refresh_beat_seq` (track under the sentinel). Then auth-off single-tenant gets a stable per-game CAS baseline exactly as `#1045`/`#1127` did for their stores.

## CON-2 — [Severity: Major] [Effort: <1day] [Value: High]
Model-driven advanceGame/submitDecision carry NO idempotencyKey — a retry double-advances the season
- Where: `frontend/src/tool_implementations.py:4814` (`do_advance_game`: `advance_game(user=owner)`), `:4853` (`do_submit_decision`: `submit_decision(decision, user=owner)`).
- Problem: These are the PRIMARY, sanctioned progression paths (ADR 0003 — the model drives its own levers). Neither attaches `idempotency_key` (the plumbing exists — `advance_game(idempotency_key=...)` at `orwell_engine.py:604`; the engine caches by key at `GameSessionAdapter.ts:5617`). So the at-most-once guarantee 0065 Part B was built to provide is UNUSED on the path that fires most. The only mitigation is PROMPT WORDING: the GM system prompt literally says "do NOT blindly retry advanceGame or submitDecision: a timed-out call may have already committed" (`agent_loop.py:84`). That is the exact anti-pattern the charter names — at-least-once delivery treated as exactly-once by asking the narrator not to retry. A GLM-4.7 agent-loop retry after a socket timeout (or the harness's own retry) double-advances: skips a staged eviction ballot, double-crowns a finale beat, or evicts on a second unintended advance. Violates I2/I10 (the engine decides, reproducibly).
- Fix: thread an `idempotency_key` (and `expected_beat_seq=last_beat_seq(owner)`) through `do_advance_game`/`do_submit_decision`, minted per model-tool-call and REUSED on the agent loop's retry of that same call (mirror `_backfill_with_cas`). The engine already returns the cached view for a repeated key.

## CON-3 — [Severity: Major] [Effort: <1day] [Value: High]
Model-driven progression never refreshes `_LAST_BEAT_SEQ` → guaranteed self-409 + spurious RE-GROUND on the next FE mutation
- Where: `frontend/src/tool_implementations.py:4811-4857` — `do_advance_game`/`do_submit_decision` return `res` (which carries `beatSeq`) but never call `_ch._refresh_beat_seq`.
- Problem: When the model advances the engine itself (the common case), engine `beatSeq` goes N→N+1 but the FE's `_LAST_BEAT_SEQ[user]` stays N. Any FE-issued CAS mutation LATER in the SAME turn — `_auto_move_player`, `_auto_record_scene`, or the pre-resolve — then attaches `expected_beat_seq=N` against an engine at N+1 → a SELF-inflicted 409 `stale-beat`. `_handle_stale_beat` (`chat_helpers.py:863`) reconciles it but ALSO stashes a `_DESYNC_REGROUND` directive ("RE-GROUND ON THE BOARD — a game action was computed against a stale view…") that is injected into the NEXT turn's system frame — even though NOTHING actually diverged. That spurious re-ground pins the model to "re-read the live state" and forbids building on its own (correct) prior narration: an immersion break (I9) and a wasted turn, caused purely by the FE not tracking its own model's advance. Consistency model: the FE's read-your-own-writes invariant (`_refresh_beat_seq` "the last-seen value MUST update from each response", `:743-748`) is broken precisely where the model — not the FE — issued the write.
- Fix: wrap the model tool-call dispatch so every engine response with a `beatSeq` flows through `_refresh_beat_seq(owner, res)` (do it in `do_advance_game`/`do_submit_decision`, or centrally where the agent loop dispatches game-mutating tools). Then the FE never self-409s after a model advance.

## CON-4 — [Severity: Major] [Effort: <1day] [Value: Med]
The decision-card `/decision` route submits with no expectedBeatSeq/idempotencyKey — relies solely on the engine's kindMatches no-op
- Where: `frontend/routes/orwell_routes.py:1057` (`submit_decision(decision, user=user)`), `:1075` (the `_gb_done` follow-up `advance_game(user=user)`).
- Problem: The structural commitment path for binding decisions posts engine-direct but omits both sync-spine tokens. Its only double-apply defense is the engine's "no-op unless a matching pending exists" (`GameSessionAdapter.ts:5697` `kindMatches`). That guard is INSUFFICIENT for SEQUENTIAL SAME-KIND decisions: a staged comp plays out as repeated `comp-round` pendings, and the finale takes `juror-vote` from nine jurors in turn. A delayed-duplicate POST (a lost 200 → client retry; a double-tap on two mirrored windows both showing the card) that arrives after the FIRST resolved and a NEW same-kind pending has armed will match the NEW pending and apply to the WRONG round/juror. The `idempotencyKey` (Part B) exists to prevent exactly this and is unused here. Also: no `_refresh_beat_seq` after this route advances the engine, feeding CON-3's stale-token window.
- Fix: attach `idempotency_key` (minted per card render, sent with the POST body and reused on client retry) + `expected_beat_seq` to `submit_decision`/`advance_game` in this route; refresh last-seen from the response.

## CON-5 — [Severity: Major] [Effort: multi-day] [Value: Med]
The desync spine keys per-user and assumes ONE turn per user at a time — two concurrent windows cross-contaminate the before/after baseline
- Where: `frontend/routes/chat_helpers.py:576` (`_LAST_BEAT_SIG: dict`), `:580` (`_DESYNC_REGROUND`), `:634-636` (`_TURN_WHEREABOUTS`/`_TURN_NPC_MOVES`/`_TURN_FREEZE_OK`). Baseline captured at framing, diffed at post-turn.
- Problem: The pre-emission/post-turn desync checkpoint stores a single per-user BEFORE-signature (`_LAST_BEAT_SIG[user]`) at framing and diffs the post-turn board against it. This is correct for one turn at a time. But ADR 0012's whole premise is TWO windows of one user active together. Window A frames (writes sig=S_A); window B frames before A finishes (overwrites sig=S_B); A's post-turn check now diffs its narration against B's baseline → a bogus delta → false "narrated-but-uncommitted outcome" → a spurious `_DESYNC_REGROUND` stashed and injected into whichever window frames next. The FE process serializes nothing here (only the ENGINE serializes per-user calls; the FE's per-user dicts are shared, last-writer-wins). Every per-user process-local turn store (`_LAST_BEAT_SIG`, `_TURN_WHEREABOUTS`, `_LAST_FRAMED_BEAT_KEY`, `_RUNWAY_*`) has this shape. Consistency model: the desync guard's own correctness precondition (a stable single-turn baseline) is unmet under the concurrency it is supposed to survive.
- Fix: key these per-turn stores by (user, session_id) or by a per-turn token, not by user alone — so two windows keep independent baselines. Minimum: guard the post-turn diff to skip when the framed beat key no longer matches (extend the existing `_LAST_FRAMED_BEAT_KEY` peer-advanced check to the desync checkpoint too).

## CON-6 — [Severity: Minor] [Effort: <1day] [Value: Med]
The JSON-RPC envelope swallows StaleBeatError into isError tool-content (HTTP 200) — it never surfaces the structured stale-beat signal
- Where: `src/adapters/mcp/HttpMcpServer.ts:348-364` — the `/rpc` path calls `handleRpcPayload(gateway,…)` whose `callTool` "swallows tool failures into isError content"; only the `/call` path (`:283-284`) maps `StaleBeatError` → HTTP 409 with `{code, beatSeq, board}`.
- Problem: A progression call routed through the additive MCP/JSON-RPC envelope that hits a CAS conflict returns a normal 200 with an isError text blob — NO `code:"stale-beat"`, no fresh `beatSeq`, no board. Any MCP client that isn't the vendored FE (the gateway 0072 multi-platform seam, an external MCP consumer) gets no machine-readable reconcile signal and would fail-closed or blind-retry into a stomp. The sync-spine's own detection (`_is_stale_beat_error` at `chat_helpers.py:844`) checks `EngineToolError.status == 409` + `code` — which the RPC envelope can never produce. The two transports have divergent CAS semantics for the same tool. Latent for the shipped FE (it uses `/call`), but a stated cross-surface guarantee is untrue.
- Fix: in `handleRpcPayload`'s error path (or the RPC dispatch here), special-case `StaleBeatError` to emit a JSON-RPC error carrying `code/beatSeq/board` in `data`, mirroring the `/call` mapping, so every transport surfaces the same reconcile envelope.

## CON-7 — [Severity: Minor] [Effort: <1hr] [Value: Med]
SSE fan-out drops silently on a full 256-slot subscriber queue, with no ring re-delivery to a still-connected subscriber
- Where: `frontend/src/session_events.py:119-123` (`q.put_nowait(payload)` under `except Exception: pass`), `:130` (`asyncio.Queue(maxsize=256)`).
- Problem: `publish` fans out with `put_nowait` and swallows any exception — a `QueueFull` on a slow/stalled consumer silently discards the event. The replay ring only re-delivers on a NEW `subscribe()` (reconnect), not to a live-but-backed-up subscriber. So a device whose SSE consumer stalls (a busy main thread, a throttled background tab that stays connected) silently misses `game-updated`/`message-added` pings and sits stale until its 20-30s poll — with no reconnect to trigger replay. Intended delivery for the closed-set reconcile ping is at-least-once (poll is the floor), but the code treats the queue as lossless. Under a burst (an agent turn firing multiple pings) a 256-deep backlog is implausible, so this is bounded — but the silent-drop + no-live-replay combo is the mechanism by which a mirror falls a full poll-cycle behind with no error anywhere.
- Fix: on `QueueFull` for an invitation-class event, either drop the OLDEST queued item and enqueue the newest (a reconcile ping is idempotent — newest wins), or log at debug so the drop is observable; the poll floor already prevents permanent staleness, but make the loss visible.

## CON-8 — [Severity: Minor] [Effort: <1hr] [Value: Med]
The 8-slot replay ring is SHARED across run-started + message-added + game-updated — a busy turn can evict the mirror-attach invitation before a late peer connects
- Where: `frontend/src/session_events.py:39-40` (`_RING_MAX = 8`), `:92` (`_RING_REPLAY_EVENTS` = all three types), `:111-115` (one deque per session, all types appended).
- Problem: The durable "attach to the live run" invitation (`run-started`, ADR 0012 §3.4b) shares one 8-entry ring with `message-added` and (now) `game-updated`. A single agent turn can emit a `run-started` then several `message-added` + `game-updated` pings; a multi-round agent turn emits more. If ≥8 events land between a `run-started` and a peer window connecting (the sessionSync ~1500ms reconnect tick), the `run-started` is evicted from the ring and the late peer NEVER replays the invitation → it sits blank and only catches up on a later poll (the F5 realtime-mirror miss the ring was built to close). The ring conflates a scarce, must-deliver event with chatty ones.
- Fix: either raise `_RING_MAX` (cheap, Vault-free — 8→24), or keep a separate 1-deep "latest live run-started" slot that never gets crowded out by message/game pings.

## CON-9 — [Severity: Latent] [Effort: <1day] [Value: Med]
The engine's idempotencyCache is CLEARED on snapshot restore and never persisted — at-most-once is void across any engine restart
- Where: `src/adapters/engine/GameSessionAdapter.ts:2267` (`this.idempotencyCache.clear()` in the hydrate/restore path), `:469-470` (`private readonly idempotencyCache = new Map…; IDEMPOTENCY_CACHE_MAX = 32`).
- Problem: The Part B at-most-once cache is in-memory per adapter instance and is explicitly wiped on restore-from-save. So across ANY engine restart (deploy/update, crash-loop recovery, systemd bounce) all idempotency keys vanish. The precise scenario Part B exists for — a flaky socket mid-advance where the FE retries with the SAME key — is defeated if the retry straddles a restart: the engine has forgotten the key and re-applies the advance (double-advance). The FE's `_LAST_BEAT_SEQ` is also process-local and reset, and (per CON-2) the model path re-mints keys anyway. So the durable-progression guarantee only holds within one continuous process lifetime on BOTH ends. `expectedBeatSeq` also can't help across a restart because the FE's last-seen resets too.
- Fix: either persist the recent idempotency keys with the snapshot (they are Vault-free — key + committed beatSeq), or on restore rely on `expectedBeatSeq` re-derived from the restored `beatSeq` (already restored at `:2266`) and document that at-most-once is best-effort across restarts. At minimum, note the restart gap in the 0065 contract.

## CON-10 — [Severity: Latent] [Effort: <1hr] [Value: Med]
Every cross-device sync structure is PROCESS-LOCAL — a multi-worker uvicorn silently breaks all mirroring and SSE fan-out
- Where: `frontend/src/session_events.py:14-16` ("in-memory, per server process"); the process-local dicts in `chat_helpers.py` (`_LAST_BEAT_SEQ`, `_LAST_BEAT_SIG`, `_RUNWAY_*`, `_TURN_WHEREABOUTS`, `_SESSION_GAME_FRAMED`) and `orwell_game_session` cache; the ship config `deploy/systemd/orwell-frontend.service:54` (single `uvicorn app:app`, no `--workers`).
- Problem: `session_events._SUBS/_RING`, the canonical-binding cache, the beatSeq tracker, and the desync/runway stores all live in one process's heap. The shipped systemd unit is single-process, so this holds TODAY — but there is no guard against an operator adding `--workers N` / setting `WEB_CONCURRENCY` (a standard uvicorn scale knob): a `game-updated` published in worker A never reaches an SSE subscriber pinned to worker B, and two devices load-balanced onto different workers get independent beatSeq/desync/runway state. Cross-device sync would silently, invisibly break with no error — a CAP-partition the code assumes can't happen. Because the constraint is undocumented at the deploy seam, it is a latent foot-gun for the launch.
- Fix: assert single-worker at the deploy seam (a guard/comment in the systemd unit + `app.py` startup check that refuses `WEB_CONCURRENCY>1`), or move the invitation bus + canonical binding to a shared store (the SQLite the app already uses) before ever scaling out.

## CON-11 — [Severity: Latent] [Effort: <1day] [Value: Med]
A scene's ONLY consequence fold still evaporates on a double stale-409 under sustained two-window concurrency (corroborates SOUL R-A-S3)
- Where: `frontend/src/agent_loop.py:2008-2011` — `_backfill_with_cas`: a SECOND consecutive `stale-beat` on the re-attempt reconciles-and-returns None (skips the write).
- Problem: The back-fill `recordInteraction` is frequently the SOLE record of a player↔NPC scene (the model under-calls recordInteraction ~once/game). The belt re-attempts once against the reconciled token, but if the board moves AGAIN under the retry (two windows both driving, or a fast off-screen tick between the two attempts), it gives up — and that scene's hidden fold is LOST, never recalled (I4: "a novel move must never evaporate"). The comment claims "re-derivable next turn," but nothing re-derives a specific past scene; the next turn is a new scene. This is the standing R-A-S3 latent, and it is reachable precisely in the ADR-0012 two-window scenario this audit targets — not a theoretical.
- Fix: on a second stale-409, instead of dropping, DEFER the fold to a durable retry queue (persist the `{withIds, kind, content, consequence}` and re-issue after the next successful read), so the fold lands late rather than never. Bounds the loss to latency, not data.

## CON-12 — [Severity: Latent] [Effort: <1day] [Value: Med]
Whereabouts-freeze, desync, and runway per-user state BLEED between two windows of the same user
- Where: `frontend/routes/chat_helpers.py:639-648` (`freeze_capture_whereabouts` keyed `user or ""`), `:278-289` (`_RUNWAY_LEFT`/`_RUNWAY_SIG`/`_RUNWAY_LAST_DONE`).
- Problem: The occupancy freeze (ADR 0009 D1) pins the gadget to "the snapshot THIS turn's prose was grounded in," keyed on `user`. Two windows of one user share the key: window A's framing overwrites `_TURN_WHEREABOUTS[user]` with A's snapshot mid-way through window B reading its own scene, so B's whereabouts gadget can render A's frozen board (a wrong-room / state-bleed render across the two windows). Same for the social runway (`_RUNWAY_LEFT[key]`): window A entering a ceremony arms a runway that window B — on a different beat view — then consumes, so B's pacing is driven by A's ceremony. These are per-viewer stores masquerading as per-user. Same-identity two-window parity requires per-window isolation of view-scoped state; the closed board is shared, but the "what THIS window's prose was grounded in" snapshot is inherently per-window.
- Fix: key the freeze + runway on (user, session_id/window) rather than user alone; the shared closed board stays engine-sourced, the view-grounding snapshot becomes per-window.

## CON-13 — [Severity: Latent] [Effort: <1hr] [Value: Low-Med]
E22 fallback single-flight-per-user drops window B's distinct scene fold under concurrent turns
- Where: `frontend/routes/chat_helpers.py:2605-2611` — `if user in _fallback_in_flight: … return False`.
- Problem: The E22 "record a fallback so the beat has consequence" guard is single-flight per user. If window A and window B each finish a game turn needing a fallback record at the same time, B's fallback is SKIPPED (not queued) because A's is in flight — so B's player↔NPC scene folds ZERO impact and is never recalled (I4). The single-flight is a correct backpressure choice against stacking, but it silently discards a DISTINCT second scene, not a duplicate.
- Fix: replace the drop with a tiny per-user serialized queue (depth 1-2) so a concurrent distinct fallback runs after the in-flight one rather than being lost.

## CON-14 — [Severity: Latent] [Effort: <1hr] [Value: Low-Med]
Auth-off single-tenant collapses two anonymous LAN users into ONE canonical/desync bucket
- Where: `frontend/routes/chat_helpers.py:600-612` (`_desync_key` falls back to the canonical game-session id for `user=None`); `frontend/src/orwell_game_session.py:41-43` (`_key(None)` → `"default"`).
- Problem: Under `AUTH_ENABLED=false` every request is `user=None` → the canonical binding, desync stores, and (via CON-1) beatSeq all collapse onto a single "default"/`_anon` bucket. Two different PEOPLE on the same LAN hitting an auth-off deploy share one canonical game session, one desync baseline, one runway — i.e. they drive and observe the SAME season and cross-contaminate each other's turn state. CLAUDE.md calls auth-off "single-user by nature," but a shared-LAN auth-off install (a plausible home deploy) has multiple humans. Cross-user isolation (I10) — a first-class guarantee — silently degrades to shared-session in this posture.
- Fix: document + enforce that auth-off ⇒ genuinely single-client (bind to a stable device/browser cookie even without accounts), or refuse concurrent distinct clients under auth-off rather than merging them.

## CON-15 — [Severity: Minor] [Effort: <1hr] [Value: Low-Med]
Roster blanks the whole cast on a SUCCESSFUL `started:false` read; last-good only serves on an exception
- Where: `frontend/routes/orwell_routes.py:663-671` (last-good served only in the `except`), `:674-676` (`state.get("started") is False` → `_forget_roster` + empty).
- Problem: The last-good fallback covers a read EXCEPTION, but a read that SUCCEEDS with `started:false` empties the panel and forgets the cache. During an engine restart mid-season the sandbox rehydrates from save; if a state read is answered before hydration completes with a transient `started:false` (rather than an exception), the roster goes fully dark and the cache is cleared — so the very next poll can't fall back either. This is a distinct mechanism from the prior "roster empty-flash" finding (which was a first-load flash): here it is a mid-season restart blanking a populated cast.
- Fix: only `_forget_roster` + empty when `started is False` AND there is no last-good cache within TTL; when a good roster is cached, serve it flagged `stale` on a `started:false` read too (a real reset clears the cache via the reset door, so this can't pin a dead season).

## CON-16 — [Severity: Minor] [Effort: <1hr] [Value: Low]
The post-goodbye follow-up advanceGame in /decision is unguarded — a retried goodbye POST double-rolls the eviction result
- Where: `frontend/routes/orwell_routes.py:1070-1077` — after a `goodbye-message` submit with no new player pending, the route fires `advance_game(user=user)` with no idempotency key.
- Problem: This FE-driven follow-up rolls `goodbye → eviction-result → rollWeek`. If the goodbye POST's 200 is lost and the client retries the identical decision, the DB1/DB2 debounce only suppresses FAILED decisions (`_recent_decision_failure`), not successful ones — so the retry re-runs the submit (kindMatches no-op) AND re-fires this follow-up advance, double-advancing past the eviction result. Combined with CON-4's missing idempotencyKey, the eviction sub-loop is the most exposed sequence.
- Fix: make the follow-up advance idempotency-keyed (reuse the decision's key), and clear the pending atomically so a retry cannot re-enter the `_gb_done` branch.

## CON-17 — [Severity: Polish] [Effort: <1hr] [Value: Low]
`_STALE_BEAT_REJECTIONS` is a process-GLOBAL counter, not per-user — the 0065 diagnostic conflates all users
- Where: `frontend/routes/chat_helpers.py:793` (`_STALE_BEAT_REJECTIONS = 0` module global), `:809-817` (accessor/reset).
- Problem: The sync-spine reconcile counter (the ledger's data source) is a single process global. In multiuser mode every user's reconciles sum into one number, so the diagnostic can't attribute stale-beat churn to a user/session — useless for spotting which game is thrashing. A minor observability defect but it undercuts the 0065 Part D ledger's purpose.
- Fix: key the counter per-user (dict), mirroring the other per-user stores; expose per-user in the ledger.

## CON-18 — [Severity: Latent] [Effort: <1hr] [Value: Low]
`resolve_live_game_session` unbinds a LIVE canonical id if the row lookup returns a transient empty — re-opening the #1085 window-collapse
- Where: `frontend/src/orwell_game_session.py:119-142` (unbinds when `is_live(sid)` returns False), `frontend/routes/chat_helpers.py:3388-3392` (`_is_live_chat_session` queries the sessions table).
- Problem: The predicate fail-softs to True only on an EXCEPTION; a query that succeeds but returns no row (a session row momentarily absent during a migration/recreate, or a read against a not-yet-committed row) resolves False → `clear_game_session` UNBINDS a genuinely live canonical id. That is exactly the #1085 failure (a dead/absent canonical id collapses a converging window's DOM), reachable via a non-exception empty result rather than a real wipe. Narrow (local sqlite, low latency), but the unbind is a destructive side-effect fired from a READ path.
- Fix: require TWO consecutive confirmed-dead observations (or a short grace) before unbinding, so a single transient empty can't destroy a good binding.

## CON-19 — [Severity: Polish] [Effort: <1day] [Value: Low]
Background-mirror render uses the merged `accumulated` buffer while foreground uses the split reply buffer — two render paths for the same peer turn
- Where: `frontend/static/js/chat.js:1744-1747` (bg stores `bgEntry.accumulated = accumulated`, the merged reply+`<think>` buffer) vs `:1514-1519` (foreground body renders the reasoning-free `roundReplyText`).
- Problem: A window observing a peer's run while focused on a DIFFERENT session buffers the merged `accumulated` (reasoning wrapped in `<think>`), and renders it via markdown's `<think>`-scrub on settle; a foreground window renders the clean channel-split `roundReplyText`. Both end scrubbed, so no reasoning leak — but they are DIFFERENT code paths reaching the "same" content, and any divergence in the `<think>`-scrub vs the channel-split (e.g. a model that interleaves reasoning oddly, an unclosed `<think>`) surfaces differently in the two windows. Same-identity parity should ride ONE render contract.
- Fix: have the background path also retain the split buffers (or reconstruct from them on adopt), so both windows render via the identical channel-split contract rather than the merged-buffer fallback.

## CON-20 — [Severity: Polish] [Effort: <1hr] [Value: Low]
A cross-device game-updated push is coalesced through the 250ms debounce, delaying the decision-card re-arm on the observing window
- Where: `frontend/static/js/sessionSync.js:96` (`notifyGameUpdated` → `window.orwellGameChanged('sync:game-updated')`), `frontend/static/js/platform.js:91-102` (250ms trailing debounce).
- Problem: When device A submits a decision, device B's `game-updated` SSE ping routes through the single debounced dispatcher — so B's decision-card re-arm (`orwellDecision.rearmFromStatus`) is delayed by up to 250ms + the fetch. In that window B may still show the card A just resolved; a click on it hits the engine's kindMatches no-op (nothing happens, no feedback). Acceptable latency, but the debounce that exists to coalesce a single window's tool burst also throttles the cross-device push, which wants promptness.
- Fix: let the server-push reconcile bypass the trailing debounce (fire immediately, then debounce follow-ups), or disable/grey the card optimistically the moment a `game-updated` arrives.

## CON-21 — [Severity: Latent] [Effort: <1hr] [Value: Low]
Model-driven recordInteraction/makeDeal/moveTo carry no CAS token — only the FE back-fills do
- Where: `frontend/src/tool_implementations.py` (the `do_record_interaction`/`do_make_deal`/`do_move_to` model paths call `orwell_engine.*` without `expected_beat_seq`) vs `frontend/src/agent_loop.py:1996-1998` (`_backfill_with_cas` attaches it only for the FE-issued belts).
- Problem: When the MODEL calls recordInteraction/makeDeal itself, no `expectedBeatSeq` is attached, so the fold applies unconditionally against whatever the board is — including a board a concurrent peer moved. For most folds this is order-tolerant (why it's Latent, not Major), but it means the closed-set "computed against a superseded board ⇒ refuse" guarantee only holds for FE-issued mutations, not model-issued ones. An asymmetry that could let a model-issued makeDeal/record land against a stale board in the two-window case.
- Fix: thread `expected_beat_seq=last_beat_seq(owner)` through the model-driven mutating-tool dispatch too (with the same reconcile-and-skip handling), unifying the CAS posture across issuer.

## CON-22 — [Severity: Minor] [Effort: <1hr] [Value: Low-Med]
The stateDelta full-refresh fallback silently masks a lost beatSeq checkpoint — no observability when the delta window is exceeded
- Where: `src/adapters/engine/GameSessionAdapter.ts:799-814` (`beatCheckpoints` ring, `DELTA_WINDOW`) — a delta requested against a beatSeq older than the window full-refreshes.
- Problem: The O(Δ) "what changed since your last turn" feed (0065 Part E) keeps a bounded checkpoint ring; a request keyed on a beatSeq that has aged out silently falls back to a full refresh. Correct for safety, but there is no signal when it happens — so a window that has fallen far behind (a long-backgrounded tab, a device that missed many pushes) silently pays a full refresh every turn with nothing surfaced, masking an underlying sync lag (e.g. the CON-7 silent-drop case). The fail-safe hides the symptom that would reveal a real staleness bug.
- Fix: increment a per-user "delta-miss / full-refresh" counter (paired with CON-17's per-user stale counter) so persistent delta misses are observable rather than invisibly absorbed.

---

## Coverage / where I looked · what I did NOT cover

LOOKED: the 0065 sync spine end-to-end (`chat_helpers.py` beatSeq tracking `:731-905`, `_beat_signature`/`_capture_beat_signature`, the pre-resolve `:2088-2116`, the back-fill CAS `agent_loop.py:1958-2019`); the model-driven progression seams (`tool_implementations.py:4811-4857`) and the decision-card route (`orwell_routes.py:1038-1107`); the canonical-session binding + liveness (`orwell_game_session.py` all; `_resolve_canonical_session`/`_is_live_chat_session`); the server-push bus (`session_events.py` all) and `_publish_game_updated` callers; the g15 dispatcher (`platform.js`) and sessionSync mirror wiring; the FE reconcile engine (`chat.js` softReloadHistory/adopt/divergence/reorder `:4227-4353`, the stream finally `:3590-3660`, the canonical_session adopt `:2382-2392`, the channel-split buffers `:1726-1748`); the engine CAS/idempotency/checkpoint internals (`GameSessionAdapter.ts` `:453-839,5605-5706,2266-2271`) and the HTTP/RPC transports (`HttpMcpServer.ts:120-392`, the per-user enqueue, the 409 mapping); the deploy worker posture (systemd unit).

CROSS-IDENTITY: confirmed Orwell is one-isolated-season-per-user, so there is NO shared public state between two DIFFERENT users to diverge — cross-user divergence is precluded by sandbox isolation, and the only live "different players" bleed I found is the auth-off single-tenant collapse (CON-14) and the shared-process/worker risk (CON-10). All other parity findings are same-identity two-window.

NOT COVERED (out of lane or needs a live two-window run I did not execute): (a) the reasoning-scrub / operator-aside leak specifics (machinery-invisible lane); (b) a captured live filmstrip diff — the telemetry dir had empty `filmstrips/`/`stills/`, so every finding is source-traced, not frame-VIEWED; a live two-window drive with the real key would confirm CON-1/2/3/5 empirically (predicted symptoms: garbage after a model retry, spurious RE-GROUND lines, whereabouts bleed). (c) the finale's 29-beat staged reveal under two windows specifically (I traced the phase machinery but did not drive it concurrently). (d) mobile/backgrounded-tab SSE behavior beyond the visibilitychange reconcile (`platform.js:112-118`).
