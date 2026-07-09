# WebSocket Phase-1 test plan (build-ready)

> **Status:** test-implementation plan (docs-only). Companion to
> [`websocket-phase1-protocol.md`](websocket-phase1-protocol.md) (the wire spec) and ADR
> [`0017`](../decisions/0017-multiplexed-websocket-session-transport.md). The protocol spec §7
> enumerates the six WS-specific cases (a–f) and the fallback/parity requirements; **this document is
> how you build each of them.** It does not re-state the wire contract — read the spec first for
> frame shapes, `fromSeq` semantics, and the handshake branch. Every test below cites the real symbol
> it drives (`file:line`) so it can be coded directly.
>
> *(Both companions are in-flight: ADR 0017 in PR #1265 and the protocol spec in PR #1267. This test
> plan depends on them and should merge **after** both land; the two links above resolve then — do not
> retarget them.)*
>
> **This plan is INERT until Phase 0 is met.** Per ADR 0017 §Phasing and the protocol spec's Hard Gate,
> the F5 mirror-parity harness (`docs/audits/playtest-harness/mirror_live_parity.mjs` +
> `run_mirror_gate.sh`) is **RED on `main` as of 2026-07-09** (`bUsesIncrementalRenderer` fails). Phase 0
> = fix that race, turn the harness green, wire it as a required CI gate. **Do not code any test in this
> plan until `run_mirror_gate.sh` is green on `main` and gated in CI.** Case (f-parity) below is
> literally that gate; cases (a)–(f) are the WS build that lands *after* it. Coding these against a
> not-yet-built WS route yields red-forever tests that get skip-marked and rot — write each test with the
> step of the WS build it verifies (protocol spec §9 build order), never ahead of it.

---

## 0. Line-reference key (verified against `main`, 2026-07-09)

Every assertion binds to a symbol that exists **today** (the WS ports these, it does not invent them).
Re-verify these before coding — the WS branch will have shifted some by a few lines.

| Symbol | Location | Role in the test |
|---|---|---|
| `agent_runs._Run` | `frontend/src/agent_runs.py:25` | the detached-run buffer the splice replays |
| `_publish` → `seq = len(run.buffer) - 1` | `frontend/src/agent_runs.py:45-48` | **binds the frame `seq` to the buffer index** — the `fromSeq` identity the whole splice rests on |
| `agent_runs.subscribe` | `frontend/src/agent_runs.py:179` | replay-from-0 → live-tail generator the socket wraps |
| register-before-replay (`run.subscribers.add(q)`) | `frontend/src/agent_runs.py:186` | nothing lost between replay and tail |
| de-dup (`if seq >= next_seq`) | `frontend/src/agent_runs.py:205` | no dup across the splice |
| flush-the-raced-tail (`while next_seq < len(run.buffer)`) | `frontend/src/agent_runs.py:201-203` | no gap on the end sentinel |
| `agent_runs.has_run` | `frontend/src/agent_runs.py:83` | subscribe gates on **`has_run`**, not `is_active` (terminal-but-buffered still mirrors) |
| `_EVICT_GRACE_S = 180` | `frontend/src/agent_runs.py:42` | the reconnect window for the terminal-but-buffered splice case |
| `agent_runs.start(..., queue=)` | `frontend/src/agent_runs.py:151` | `turn` up-frame routes here unchanged (queue-don't-cancel) |
| `run_key = ctx.canonical_session or session` | `frontend/routes/chat_routes.py:1791` | the channel key = the handshake-`ack`'d `canonicalId` |
| `chat_resume` gates on `has_run` | `frontend/routes/chat_routes.py:1867-1877` | the SSE sibling the socket `subscribe` mirrors |
| casting single-flight guard (`_casting and is_active`) | `frontend/routes/chat_routes.py:1806-1816` | casting stays per-tab; never chains — the #1086 seam |
| `chat_events` + `_verify_session_owner` | `frontend/routes/chat_routes.py:1851-1856` | the owner guard every `hello`/`bind`/`subscribe` reuses |
| `_verify_session_owner` (import) | `frontend/routes/chat_routes.py:29` (from `routes.session_routes`) | raises for a non-owned session → `error{forbidden}` |
| `_sse_error_response` | `frontend/routes/chat_routes.py:90` | today's pre-stream refusal contract → becomes an `error` frame |
| `_resolve_canonical_session` | `frontend/routes/chat_helpers.py:4121` | the **server-derived** handshake branch |
| `_is_live_chat_session` | `frontend/routes/chat_helpers.py:4106` | the liveness predicate; the dead-id guard |
| `resolve_live_game_session` (unbind side-effect) | `frontend/src/orwell_game_session.py:119` | a confirmed-dead binding is unbound during `hello` |
| `bind_game_session` (first-writer-wins) | `frontend/src/orwell_game_session.py:55` | the `adopted:true` race |
| `session_events.publish` / `_RING_REPLAY_EVENTS` | `frontend/src/session_events.py:92,~103` | the invitation bus → `state`/`event` frames; ring stays a fallback concern |
| `orwell_layout.patch_layout` + `origin` echo | `frontend/routes/orwell_routes.py:1640-1656` | the `layout` LWW + self-echo suppression source |
| `window.orwellGameChanged` (ONE dispatcher) | `frontend/static/js/platform.js` | `state`/`hud` frame handler calls this; the g15 invariant |
| mirror harness checks | `docs/audits/playtest-harness/mirror_live_parity.mjs:91-93` (`bStartsDuringAStream`, `bUsesIncrementalRenderer`, `lagWithinBudget`) | the F5 parity gate for both modes |

---

## 1. Test taxonomy — two tiers, matching the existing suite

The FE suite already splits exactly the way these tests need (CLAUDE.md testing rules; `conftest.py`
auto-marks `browser`):

- **`fe-unit` tier (pytest, no browser).** Server-side WS behavior driven with an in-process ASGI
  WebSocket client (`starlette.testclient.TestClient.websocket_connect`, already a dependency).
  Cases (a), (b), (f-CAS) live here — they assert frame sequences off the real route + real
  `agent_runs`/`session_events`/canonical-binding helpers, no DOM. This is the bulk of the plan and the
  fast gate. Model after `test_0012_mirror.py` (drives the real persist/publish primitives) and
  `test_985_crossdevice_peer_resume.py` (structural + behavioral halves).
- **`fe-browser` tier (pytest, `sync_playwright`, auto-marked `browser`, serial `--reruns 1`).** Cases
  (c), (d), (e-render) need the **client router** — the JS that dispatches frames by `ch` and keeps the
  `roundReplyText`/`roundReasoningText` split. Model after the harness pattern in
  `docs/audits/playtest-harness/` and the browser tests already in `frontend/tests/`.
- **The F5 harness (`run_mirror_gate.sh`, node/playwright, its own CI job).** Case (f-parity) — runs the
  real two-window stack. Extended (not duplicated) to run in **both** WS and fallback mode.

**Naming.** Follow the existing `test_NNNN_slug.py` / `test_<feature>_<concern>.py` convention. Proposed
files in §10.

---

## 2. Shared test scaffolding (build once, reuse across a–f)

Before the cases, three helpers. Put them in `frontend/tests/support/ws_harness.py` (new; mirrors the
role of `tests/support/sandbox.ts` on the engine side — a canonical factory, not per-test wiring).

1. **`ws_client(app, cookie)` → context manager** wrapping
   `TestClient(app).websocket_connect("/api/ws/session", headers={"cookie": ...})`. Yields a thin
   object with `.send(frame: dict)` (JSON-dumps one text frame) and `.recv() -> dict` (JSON-loads),
   plus `.recv_until(t=..., ch=..., timeout=)` and `.drain(timeout=)` that collects all frames until
   quiescent. The cookie carries the authenticated user exactly as `get_current_user` reads it (same
   session cookie every `/api/*` route uses — protocol spec §1.1).
2. **`seed_live_game(user)` → canonicalId** — create a started-game chat-session row and
   `bind_game_session(user, sid)` so `_is_live_chat_session(sid)` is true and
   `resolve_live_game_session` returns it. Roles only, no names (CLAUDE.md). Reuse the DB fixture
   pattern from `test_0012_mirror.py`'s `sm` fixture.
3. **`push_run(canonicalId, deltas)`** — drive a fake detached run through the **real** `agent_runs`:
   call `agent_runs.start(canonicalId, _fake_agen(deltas), queue=True)` where `_fake_agen` yields the
   exact SSE event strings the producer emits (`data: {"delta":...,"thinking":false}\n\n`,
   `message_saved`, `data: [DONE]\n\n`). This exercises the **real** `_publish`/`subscribe`/`has_run`
   path — the socket adapter is the only new code under test; the splice logic is the shipped one.
   **Do not stub `agent_runs`** — the entire risk (protocol spec §10) is that the socket adapter breaks
   the real splice, so it must run the real generator.

A note that recurs below: **the frame `seq` MUST equal the `_Run.buffer` index** (`agent_runs.py:48`).
Every case that reads `frame["seq"]` asserts it against that buffer index, never a client-side counter
(protocol spec §10 "`fromSeq` seq identity" is the #1 subtle-bug risk).

---

## 3. Case (a) — reconnect-resume splice (the crown jewel)

**What it proves:** a socket that drops mid-turn and reconnects with `subscribe{fromSeq:N+1}` gets the
buffered gap then the live tail — **no seq gap, no dup, one terminal `done`** — because the socket
delegates to the shipped `agent_runs.subscribe` replay-then-tail (`agent_runs.py:179-207`), and the
frame `seq` is the buffer index (`agent_runs.py:48`).

**Tier / file:** `fe-unit` — `frontend/tests/test_ws_reconnect_splice.py`.

**Setup.**
1. `user = "u"`; `canonicalId = seed_live_game(user)`.
2. Start a run that will emit a **known, ordered** sequence of events, but pause it mid-stream so the
   reconnect happens with the run still live. The cleanest control: an `asyncio.Event`-gated fake agen —
   `_fake_agen` yields events 0..N, then `await gate.wait()` (holds the run open), then yields N+1..M and
   `[DONE]`. This gives a deterministic "drop after seq N, more arrives later" without wall-clock races.
3. **Baseline (single connection).** Socket S0: `hello` → `ack`, then `subscribe{ch:"chat",fromSeq:0}`.
   Release the gate. Collect every `event` frame + the terminal. Record `baseline = [f["seq"] for f in
   events]` and the concatenated `delta` payload. This is the oracle.
4. **Reconnect run.** Fresh run (re-`start` with a fresh gate). Socket A: `hello`→`ack`,
   `subscribe{fromSeq:0}`, collect frames until it has rendered through `seq == N` (N = a fixed
   mid-stream index, e.g. 2 of a 6-event script), then **close socket A** (drop mid-turn) with the gate
   still unreleased. Record `highestRendered = N`.
5. Socket B: `hello`→`ack` (same `canonicalId` — the handshake re-binds/adopts, §4 case b covers the
   binding), `subscribe{ch:"chat", fromSeq:N+1}`. **Now release the gate.** Collect B's frames.

**Exact assertions.**
- **Contiguity, no gap, no dup:** let `rendered = A_seqs[:N+1] + B_seqs` (what the client actually
  mounted across the drop). Assert `rendered == list(range(0, M+1))` — a contiguous `0..M` with **no
  missing index and no repeated index**. (`M` = last buffer index before `[DONE]`.)
- **B receives exactly the gap-then-tail:** `B_seqs == list(range(N+1, M+1))` — B replays only
  `buffer[N+1..len)` then live-tails, never re-sends `0..N`. This is the direct proof the socket honored
  `fromSeq` against the buffer index (`agent_runs.py:205` de-dup + the adapter's `from_seq` skip).
- **One terminal:** exactly one `event` with `d.done == true` across the whole `rendered` set (maps
  `data: [DONE]`, `agent_runs.py:137`/producer). Never two.
- **Byte-identity vs. oracle:** the concatenated visible `delta` text of `rendered` (thinking-false
  frames) `==` the baseline single-connection visible text. The splice reassembles the identical stream.

**Second variant — terminal-but-buffered (`has_run`, not `is_active`).** Re-run steps 4–5 but let the
run **finish** (release the gate, drain to `[DONE]`) *before* socket B connects, all within the 180 s
`_EVICT_GRACE_S` (`agent_runs.py:42`). Assert B still gets `subscribe{fromSeq:0}` → the **entire**
buffer `0..M` replayed then a clean end (the peer that attaches just after settle still mirrors the whole
turn). This is the exact `has_run`-vs-`is_active` distinction (`agent_runs.py:83`, mirrored at
`chat_routes.py:1875`) — assert that a `subscribe` for a run whose `is_active` is false but `has_run` is
true **succeeds** (does not `error{not-found}`). Optionally assert that past the grace (monkeypatch
`_EVICT_GRACE_S` to a small value and let it evict) the `subscribe` yields nothing / the client is told
to do a normal history load (the documented fallback, spec §3.6).

**Why unit, not browser:** the hazard is entirely server-side (the replay/tail/de-dup). Asserting the
frame `seq` set off the ASGI WS client is a tighter, faster proof than eyeballing a rendered DOM. The
client-side "render each seq once" is the incremental renderer's `{id, seq}` reconcile, already gated by
the F5 harness (case f) — no need to re-prove it here.

**Seam that complicates this (report-worthy):** honoring `fromSeq > 0` "for free" by skipping
client-side means the server still **re-yields** the whole prefix over the socket (wasteful, and it
muddies the assertion). The protocol spec §3.2 prefers adding a `from_seq=0` param to
`agent_runs.subscribe` (the loop already tracks `next_seq`). **This test should assert the preferred
path:** that B never *receives* frames `< fromSeq` on the wire (not merely that it discards them) — i.e.
`min(B_seqs) == N+1`. That assertion is what forces the `from_seq` param to be built rather than a
lossy client-side skip, and it is the single most important line in the whole plan.

---

## 4. Case (b) — liveness handshake (the #1085/#1086 guard, socket-native)

**What it proves:** a `hello` is resolved and validated **before** any channel is subscribable, and the
branch is **server-derived** — a dead id yields `ack{live:false}` with no channel opened (and the stale
binding is unbound), a non-owned id yields `error{forbidden}` + close with no bind.

**Tier / file:** `fe-unit` — `frontend/tests/test_ws_handshake_liveness.py`.

**Sub-case (i) — dead canonical id.**
- Bind a canonical id, then delete its chat-session row (so `_is_live_chat_session(sid)` is now false),
  leaving the binding dangling — exactly the GAP-1 state `resolve_live_game_session` handles
  (`orwell_game_session.py:119`).
- Socket: `hello{cid:"c_00", d:{perTabId: sid}}`. Assert the reply is `ack{cid:"c_00", live:false}`
  (spec §2.4) and that the `canonicalId` in the `ack` is **not** the dead id (it fell back to `perTabId`
  per the unbind side-effect).
- Assert the binding was **unbound as a side effect**: `get_game_session(user)` is now `None`
  (`resolve_live_game_session` → `clear_game_session`, `orwell_game_session.py:141`).
- Assert **no channel opened**: a subsequent `subscribe{ch:"chat"}` on this socket without a live bind
  → `error{cid, code:"not-bound"}` (spec §2.4), and no `event` frame is ever delivered. The socket never
  subscribes a 404 channel — the literal #1085 window-collapse root cause, now impossible before
  subscribe.

**Sub-case (ii) — non-owned session.**
- User A owns `sidA`. Connect as **user B** (different cookie). `hello{perTabId: sidA}` (or a `bind`
  naming `sidA`). Assert `error{cid:"c_00", code:"forbidden"}` **then the socket closes**
  (`websocket.receive()` raises `WebSocketDisconnect`) — mirrors `_verify_session_owner` raising
  (`chat_routes.py:1856`). Assert **no bind occurred**: `get_game_session("B")` unchanged, and A's
  binding untouched. This is cross-user isolation (0021) at the handshake.

**Sub-case (iii) — server-derived branch (the forge guard).** Send a `hello` whose payload *claims* a
started game (e.g. an extra `framed:true`/`gameActive:true` the client is not supposed to send) for a
user whose season is **not** started. Assert the server **ignores** the claim and resolves the
**casting/per-tab** branch (`canonicalId == perTabId`, spec §2.2 / `chat_helpers.py:4141` — casting stays
per-tab), i.e. a forged flag cannot flip the branch or adopt a foreign canonical id. This is the
security-critical §2.2 assertion; without it a forged `hello` could re-introduce #1086.

**Sub-case (iv) — first-writer-wins adopt.** Two sockets for the same user, no binding yet, started
game. Socket 1 `hello` → `ack{adopted:false, canonicalId:X}`. Socket 2 `hello` → `ack{adopted:true,
canonicalId:X}` (it lost the race and adopted the bound id, `bind_game_session` first-writer-wins,
`orwell_game_session.py:55`). Assert both `canonicalId` are equal and socket 2's `adopted` is `true`.

**Assertion on ordering (all sub-cases):** the refusal/`ack` is the **first** frame the server sends;
no `event`/`state`/`hud` frame precedes a successful `ack`. Enforce "no subscribe before ack"
server-side and assert it (a `subscribe` sent before `hello` → `error{not-bound}`).

---

## 5. Case (c) — multiplex isolation (frames never cross channels)

**What it proves:** the client frame router dispatches strictly by `ch`; a `hud`/`layout`/`state` frame
never reaches the chat renderer, and a `chat` delta never reaches the layout/HUD stores. No cross-channel
bleed on one multiplexed socket.

**Tier / file:** `fe-browser` — `frontend/tests/test_ws_multiplex_isolation.py` (needs the real client
router JS). Structural half can be `fe-unit`.

**Behavioral half (browser).** Load the page with WS mode forced on (flag `ORWELL_WS_TRANSPORT`, spec
§6). Inject an **interleaved** frame sequence into the socket the client holds (a test WS server or a
`page.evaluate` that feeds the client's frame handler directly): `chat` `event`(delta) → `hud`(kind) →
`chat` `event`(delta) → `layout` → `state` → `chat` `event`(done). Assert:
- The message body contains **only** the two `chat` deltas' visible text — no `hud`/`layout`/`state`
  payload string appears anywhere in the rendered transcript (`page.locator(...).inner_text()`).
- The HUD-refresh hook (`window.orwellGameChanged`) fired for the `state`/`hud` frames (spy on the one
  dispatcher, `platform.js`) and **did not** fire for the `chat` deltas.
- The layout store received the `layout` frame and **not** the chat deltas.

**Structural half (unit — cheaper, revert-proof).** Grep-pin the router: the frame handler switches on
`frame.t`/`frame.ch` and routes `ch:"chat"` → the stream buffers, `ch:"state"|"hud"` → the
`orwellGameChanged` caller, `ch:"layout"` → the layout apply, with **no fall-through** that lets a
non-chat frame reach `roundReplyText`. Model on `test_985_crossdevice_peer_resume.py`'s structural
half (reads the real JS, asserts the leg exists). This catches a revert that collapses the router.

**Why it matters beyond tidiness:** the reasoning-split contract (CLAUDE.md; spec §3.4) says reasoning
rides as a `d.thinking` flag **inside** the one `chat` channel — never a separate `ch`. This test's
"a non-chat frame never reaches the chat body" is the same wall that keeps a stray channel from
becoming a second public path. Add one explicit assertion: a `chat` `event` with `d.thinking:true`
routes to the **Thinking accordion**, not the body (the `roundReplyText`/`roundReasoningText` split
survives on the socket — spec §3.4).

---

## 6. Case (d) — layout LWW + per-device echo-suppression

**What it proves:** per-device layout sync holds over the socket — same-device other tabs apply a move,
a **second device does NOT** (geometry is per-device, not cross-device), the originating tab ignores its
own `origin` echo, and two conflicting moves resolve last-write-wins per field.

**Tier / file:** `fe-browser` — `frontend/tests/test_ws_layout_lww.py`. Persist-key half → `fe-unit`.

**Setup.** Three sockets, one user: tab A and tab B share `deviceId = "dev_1"`; tab C is `deviceId =
"dev_2"` (the stable per-device localStorage token, spec §5). All three `hello`→`ack` and `subscribe`
the `layout` channel.

**Assertions.**
- **Same-device fan-out + self-echo suppression.** Tab A sends `layout{windowId:"hud-roster",
  state:{x:40,...}, origin:"<tabA-origin>"}`. Assert **tab B applies it** (its layout store now has
  `x:40`) and **tab A ignores its own echo** — A's store is not re-applied from the echo (dedupe by
  `origin`, mirroring `orwell_routes.py:1656` + `sessionSync.dispatchLayoutChanged` filter today). Spy
  on the apply path and assert it fired once on B, zero times on A from the echo.
- **Cross-device NON-sync (the owner call 2026-07-09).** Assert **tab C (dev_2) does NOT** receive the
  geometry — its layout store still holds the pre-move value. This is the explicit supersede of 0064-F:
  only game state syncs cross-device, geometry does not (spec §5). This is the load-bearing new
  assertion vs. the old `test_0064_layout_sync.py` (which asserted cross-device sync — that test must be
  **updated/retired** for the per-device policy; see §9).
- **LWW per field.** Tab A then tab B send two rapid conflicting moves of the same `windowId` (A:
  `{x:40}`, B: `{x:80}`, close together). Assert the converged stored `x` is the last writer's (`80`),
  per-field, not a merge (`orwell_layout.patch_layout` LWW, `orwell_routes.py:1647`).

**Persist-key half (unit).** Assert `orwell_layout` is keyed **`(user, deviceId)`** not `user` alone
(spec §5 / §10 migration): a `patch_layout(user, dev_1, ...)` and a `patch_layout(user, dev_2, ...)`
keep independent records, and a legacy `user`-only record **seeds** a new device's layout on first read
(read-compatible migration — spec §10 "Per-device layout key migration"). This is a storage-shape change;
pin it so a device doesn't lose its arrangement.

---

## 7. Case (e) — fallback parity (no WS ⇒ SSE/poll, still F1–F5)

**What it proves:** a client with no WS falls back to the unchanged SSE/poll stack and still passes F1–F5,
**and** a mid-turn WS→SSE downgrade carries the resume cursor (last `seq`/`fromSeq`/`beatSeq`) into
`GET /api/chat/resume/{id}` — no replay-from-0, no skipped tail.

**Tier / files:** browser + harness — `frontend/tests/test_ws_fallback_negotiation.py` (behavioral) plus
the F5 harness in fallback mode (case f).

**Sub-case (e1) — negotiation.** Force fallback two ways and assert each runs the *existing* stack:
(1) flag off (`ORWELL_WS_TRANSPORT` default off, spec §6) → client never attempts the upgrade; (2) flag
on but the upgrade fails/times out (~3 s to first `ack`) → client falls back. In both, assert: the client
opens `POST /api/chat_stream` (SSE), `GET /api/chat/events/{id}`, `GET /api/chat/resume/{id}`, and the
20 s / 25 s polls run (spy on the fetch URLs). Assert the WS is **not** open. Because both paths hit the
**same** server helpers (`agent_runs`, `session_events`, `_resolve_canonical_session`), behavior is
identical — the assertion is transport selection, not a behavior fork.

**Sub-case (e2) — the mid-drop cursor hand-off (the subtle one).** Start a turn in WS mode, render
through `chat` `seq == N`, then **drop the socket mid-stream**. Assert the client reopens
`GET /api/chat/resume/{canonicalId}` (`chat_routes.py:1867`, gated on `has_run`) and:
- carries `fromSeq = N+1` forward as the resume cursor — because SSE `agent_runs.subscribe` replays the
  buffer **from index 0** (`agent_runs.py:193`), the client **discards** the already-rendered prefix up
  to N and mounts only `buffer[N+1..]` + live tail. Assert the final rendered `seq` set is contiguous
  `0..M` with **no dup of 0..N and no gap after N** — the same splice invariant as case (a), but across
  the WS→SSE seam (spec §6). The incremental renderer's `{id,seq}` reconcile makes the overlap a no-op.
- carries the last-seen `beatSeq` (from `ack`/`state`) into the SSE path so the next turn's
  `expectedBeatSeq` CAS (0065) is still correct across the downgrade (assert the subsequent
  `POST /api/chat_stream` body / the next `turn` carries the right `beatSeq`).

**Sub-case (e3) — F5 in fallback mode.** Covered by case (f): the harness runs with the flag **off**
(pure fallback) and must pass `bStartsDuringAStream` + `bUsesIncrementalRenderer` + `lagWithinBudget`.
This is the "fallback is not allowed to bit-rot" guarantee (spec §6).

**Seam note:** the `session_events` invitation ring (`_RING_REPLAY_EVENTS`, `session_events.py:~103`) is
a **fallback-mode** concern only (the socket handshake makes attach deterministic, spec §10). This test
must **not** delete or weaken the ring — assert it still replays `run-started`/`game-updated` for a late
SSE subscriber in fallback mode.

---

## 8. Case (f) — F5 mirror-parity, before AND after the WS swap (the Phase-0 gate)

**What it proves:** the two-window realtime mirror (F1–F5, the #1 release blocker) holds under the WS
transport exactly as under SSE. This is the **required Phase-0 gate** and the after-swap regression gate.

**Tier / file:** the existing harness — `docs/audits/playtest-harness/mirror_live_parity.mjs` via
`run_mirror_gate.sh`, its own CI job.

**Phase 0 (before any WS code).** `run_mirror_gate.sh` must be **green on `main`** and wired as a
required CI check. Today it is RED (`bUsesIncrementalRenderer`, spec Hard Gate). Turning it green (fix the
`resumeStream`/`_renderLiveStream` incremental-render race) is Phase 0; **no test a–e is coded until this
is green** (see the header). The three checks are at `mirror_live_parity.mjs:91-93`.

**After the swap.** Extend `run_mirror_gate.sh` to run the identical two-window scenario in **both**
modes via the flag:
- `ORWELL_WS_TRANSPORT=1` — WS mode (windows mirror over the socket).
- `ORWELL_WS_TRANSPORT=0` — fallback mode (windows mirror over SSE/poll — proves case e3).

Both invocations must pass all three checks. Do **not** clone the harness; parameterize it by an env the
`run_mirror_gate.sh` already-style env block reads (like `MIRROR_LIVE`/`MIRROR_TOOLTURN` at
`run_mirror_gate.sh:18-20`). The CI job runs both invocations; either red fails the gate.

**Flag-flip gate.** Per spec §6/§9 step 7, `ORWELL_WS_TRANSPORT` flips to default-on only once **every**
WS test (a–e) **and** both harness modes are green in CI. Encode that as the CI dependency, not prose.

---

## 9. Existing gates that MUST stay green (regression fence)

The WS "swaps the pipe" — it must not perturb these. Each is an existing gate; add nothing, keep them
green (protocol spec §7 "Boundaries unchanged").

| Gate | Where | Why it must not move |
|---|---|---|
| **`test_0012_mirror.py`** (the Messenger-mirror tripwire) | `frontend/tests/test_0012_mirror.py` | the `message-added` broadcast on the streaming save path must still fire exactly once; the socket adds a subscriber transport, it does not touch `_persist_message`. |
| **dependency-cruiser Vault edge** | engine `npm run test:arch` | the socket introduces **no new reader** of `VaultStore` — `state`/`hud` are pings (ids + `beatSeq`), the client re-reads its own Vault-free projection (spec §4/§8). Assert no WS code path imports a Vault surface. |
| **Vault sentinels** (player/admin surfaces return no Vault data) | `frontend/tests/` + engine surface tests | the socket carries only the projections SSE/poll already carry — the same "no Vault in the payload" assertion applies to every frame body. Add a body-scan assertion to case (a)/(c) frames as a belt (no forbidden key crosses). |
| **cross-user isolation (0021)** | case (b)(ii) here + existing session-owner tests | one socket ↔ one user; every `hello`/`bind`/`subscribe` owner-guarded (`_verify_session_owner`, `chat_routes.py:1856`). |
| **`test_g15_gamechanged.py`** (exactly ONE dispatcher) | `frontend/tests/test_g15_gamechanged.py` | the `state`/`hud` frame handler calls `window.orwellGameChanged('ws:state')` — one **more caller** of the one debounced dispatcher; we delete the poll **timers**, not the dispatcher. This test must stay green unchanged. |
| **ADR 0008 `seq`/reconcile contract** | existing incremental-renderer tests + F5 harness | the frame `seq` IS the buffer index; the renderer still reconciles by `{id,seq}`. |
| **`test_canonical_session_liveness.py`** | `frontend/tests/test_canonical_session_liveness.py` | the dead-id unbind the handshake reuses (`resolve_live_game_session`) — case (b)(i) is its socket-native sibling; both must agree. |

**One gate that must be UPDATED, not just kept:** `test_0064_layout_sync.py` asserts **cross-device**
layout sync — the exact behavior ADR 0017 §5 supersedes (layout is now **per-device**). Case (d) replaces
its cross-device assertion with the per-device one. Flag this in the WS PR: retire/rewrite
`test_0064_layout_sync.py`'s cross-device geometry assertion, keep its notice-dismissal-sync assertion
(dismissal still syncs per-user, spec §5). Do not silently delete it.

---

## 10. Proposed test-file layout & naming

New files, all under `frontend/tests/` (the FE pytest gate; CLAUDE.md — run the **whole** suite before
pushing, a `-k` subset hides convention gates):

| File | Tier / CI job | Cases | Models after |
|---|---|---|---|
| `frontend/tests/support/ws_harness.py` | shared (no tests) | §2 scaffolding | `tests/support/sandbox.ts` (canonical factory) |
| `frontend/tests/test_ws_handshake_liveness.py` | `fe-unit` | (b) i–iv | `test_canonical_session_liveness.py`, `test_985_...` structural half |
| `frontend/tests/test_ws_reconnect_splice.py` | `fe-unit` | (a) live + terminal-but-buffered | `test_0012_mirror.py` (real primitives) |
| `frontend/tests/test_ws_beatseq_cas.py` | `fe-unit` | (f-CAS) — stale `expectedBeatSeq` → `error{cid,stale-beat}` | `test_0065_sync_ledger.py` |
| `frontend/tests/test_ws_multiplex_isolation.py` | `fe-browser` (+ unit structural half) | (c) | browser tests in `frontend/tests/`; `test_985_...` structural half |
| `frontend/tests/test_ws_layout_lww.py` | `fe-browser` (+ unit persist-key half) | (d) | `test_0064_layout_sync.py` (updated), `test_m1_4_decision_card_layout.py` |
| `frontend/tests/test_ws_fallback_negotiation.py` | `fe-browser` | (e1, e2) | `test_985_crossdevice_peer_resume.py` |
| `run_mirror_gate.sh` (extended, both modes) | its own CI job | (e3, f) | existing harness |

**`fromSeq`/`seq` identity is asserted in three places** — case (a) (`min(B_seqs)==N+1`), case (e2)
(WS→SSE cursor), and the shared `push_run` helper (frame `seq == buffer index`). All three trace to the
one line `agent_runs.py:48`; if that identity is ever violated the reconnect drops or dups a token, so
over-cover it deliberately.

---

## 11. Build order (mirrors protocol spec §9 — write the test with the step it verifies)

0. **Phase 0** — `run_mirror_gate.sh` green on `main` + required CI gate. **Nothing below is coded before
   this.** (Case f, before-swap.)
1. WS route + handshake (spec §9.2) → code **case (b)** + the `ws_harness.py` scaffolding.
2. `chat` channel over `agent_runs` + `turn`/`decision` up-frames (spec §9.3, highest risk) → code
   **case (a)** and **case (f-CAS/beatseq)**. **Land case (a) green before anything else** — the splice
   is the whole ballgame (spec §10).
3. `state`/`hud` push + poll deletion (spec §9.4) → code **case (c)**; keep `test_g15_gamechanged.py`
   green.
4. `layout`/`notice` (spec §9.5) → code **case (d)**; update `test_0064_layout_sync.py`.
5. Fallback negotiation + flag (spec §9.6) → code **case (e)**; extend the harness to both modes (case
   f, after-swap).
6. Flip `ORWELL_WS_TRANSPORT` default-on (spec §9.7) only when a–e + both harness modes are green in CI.

---

## 12. Summary — what an engineer picks up here

- Six WS-specific tests (a–f), each with tier, file, real symbol driven, and exact assertion.
- The crown jewel (a) asserts a contiguous `0..M` seq set with **no gap / no dup** across a mid-turn
  drop, driving the **real** `agent_runs.subscribe` splice — and forces the preferred `from_seq` param by
  asserting B never *receives* frames `< fromSeq` on the wire.
- The regression fence: the `test_0012_mirror.py` tripwire, dependency-cruiser Vault edge, Vault
  sentinels, cross-user isolation, `test_g15_gamechanged.py` — all stay green; `test_0064_layout_sync.py`
  is the one test the policy change **updates**.
- **Inert until Phase 0.** The F5 harness (case f) is the gate that unlocks the rest; code nothing ahead
  of the WS-build step it verifies.
