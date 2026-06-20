# 0064 — Live multi-device game sync (the canonical game chat)

**Status:** 📝 Spec only (authored 2026-06-20). **Gate:** FE (pytest) + browser smoke.
**Depends on:** 0021 (per-user sandboxes / one game per user), 0032 (the game build), 0050
(casting interview), 0054 (gadget rail HUD). **Supersedes** the per-tab/per-device onboarding
guards described in *Implementer handoff → What this replaces*.

> **Companion:** `0064-live-multi-device-game-sync.feature` (role-only Gherkin). This is an
> **FE feature** (the chat sessions live in the front-end's store and streaming happens in the
> front-end), so the executable gate is **front-end pytest** + the browser smoke, **not** Cucumber
> — it is not added to `cucumber.cjs`.

---

## 1. Why (the bug this closes)

The engine already enforces **one active game per user** (0021). The front-end does **not**: it is
a multi-session chat app (ChatGPT-style), and every device independently picks or *creates its own*
chat session. Nothing binds the single per-user game to a single chat session.

Observed in the field (two devices, same account, same instant): **two producers, two thinking
traces, two divergent casting interviews** — two independent LLM reasoning chains, both writing
`updateCasting` into the one shared engine intake. The engine serializes per user
(`HttpMcpServer` enqueue, audit E10), so state is not *corrupted*, but the experience is broken and
casting answers from one screen clobber the other.

**Root cause:** the cross-device live-sync stack *already exists and works* —
`src/agent_runs.py` (detached runs + replay buffer), `src/session_events.py` (per-session SSE
pub/sub), the routes `GET /api/chat/events/{id}` · `/resume/{id}` · `/stop/{id}`, and the client
`static/js/sessionSync.js`. But `session_events` is keyed by **`session_id`**, and the two devices
are on **different** session ids, so the sync never engages.

This feature makes the game **one canonical chat session per user** that every device converges on,
then leans on the existing sync so all screens render the **same conversation live** — and adds
**one-driver-at-a-time** turn ownership so "two reasoning chains" becomes structurally impossible.

---

## 2. Scope

**In scope (FE only):**

- **A. Canonical game session** — a server-authoritative, per-user mapping `user → game_session_id`;
  every device resolves and opens *that* session for the game.
- **B. Engage the existing live-sync** for the canonical session (verify + harden late-join,
  hidden-kickoff reconciliation, HUD reconciliation).
- **C. Turn ownership** — a per-user (== per game session) turn lock: at most one in-flight run;
  other devices are live **spectators** with an explicit, guarded **take-over**.
- **D. Once-only casting kickoff** — the producers' opener fires once per game, not once per device.
- **E. Robustness** — late join (replay + live), reconnect, FE-restart catch-up, multi-tab,
  cross-user isolation, Vault-free throughout.

**Out of scope / non-goals:**

- Any change to engine authority, the Vault Wall, or per-user isolation (0021) — unchanged.
- Persisting in-flight runs across an FE process restart (`agent_runs`/`session_events` stay
  in-memory; devices catch up from persisted history — see §6.E).
- Real-time co-editing of the composer draft, or presence cursors.
- Sharing a game across *different* users (forbidden by 0021; this is multi-**device**, one user).

---

## 3. Design

### A. The canonical game session

The chat sessions are FE-owned, so the binding lives in the FE — mirroring the per-user
`orwell_seasons.py` store (a small JSON map in `DATA_DIR`, atomically written, keyed by
`_current_user`, Vault-free by construction: a session **id** carries no game secret).

**New store — `frontend/src/orwell_game_session.py`** (pattern: `orwell_seasons.py`):

```
get_game_session(user) -> str | None        # the user's bound game session id, or None
set_game_session(user, session_id) -> None   # bind (atomic; lock-guarded)
clear_game_session(user) -> None             # unbind (season reset / new season)
```

`DATA_DIR/orwell_game_session.json` = `{username: session_id}`. The factory-reset scrub of
`data/` already takes it back to OOBE; the in-app reset-progress / new-season rotates it explicitly
(below).

**New route — `GET /api/orwell/game-session`** (in `routes/orwell_routes.py`), `_current_user`-scoped:

- Resolve the bound id. If it is **missing**, or **no longer exists** in the session store, or is
  **not owned by this user**, mint a fresh chat session (server-side, owner = the user), bind it,
  and return `{ "sessionId": "<id>", "created": true }`. Otherwise `{ "sessionId": "<id>",
  "created": false }`.
- **Idempotent under concurrency** (the whole point): two devices hitting it at the same instant
  must get the **same** id. Guard with the store lock; first writer wins; a racing second caller
  reads back the just-written id (re-check inside the lock before minting).

**Season-reset rotation.** The three reset doors already exist in `orwell_routes.py`
(`/new-game`, `/next-season`, `/reset-progress`). Each must `clear_game_session(user)` as part of
the reset so the next `GET /api/orwell/game-session` mints a clean session for the new season —
a dead season's transcript never rides as narrator context. This makes the existing F7/E65
"fresh session on restart" behavior **server-authoritative** instead of per-tab `sessionStorage`.

**Onboarding change — `static/js/orwellOnboarding.js`.** `openFreshInterviewSession()` no longer
blindly clicks "+ New chat" (which mints a *device-local* session). Instead it:

1. `GET /api/orwell/game-session` → `sessionId`.
2. If the currently open session ≠ `sessionId`, `sessionModule.selectSession(sessionId)` (load it).

Every device — first load, second device, a reload — lands on the **same** session id. The
per-device `SEAT_TAKEN_KEY` (`sessionStorage`) and `WELCOME_KEY` (`localStorage`) guards become
**advisory UI niceties only**; the server store is the source of truth for "which session is the
game."

### B. Engage the existing live-sync

Once every device shares the session id, `sessionSync.js` + `session_events` already deliver the
live experience: device A's `run-started` / `message-added` events reach device B, which
soft-reloads history and attaches to the live reply (`chatModule.resumeStream`). Harden three game
edges:

1. **Late join (open mid-run).** A device opening the canonical session while a run is in flight
   must **proactively** attach (replay buffer + go live) rather than wait for the next event.
   `sessions.js` already does an on-open resume check (~`selectSession`); verify it fires for the
   game session and that `agent_runs.subscribe` replays the buffer from seq 0 (it does — see
   `agent_runs.subscribe`).
2. **Hidden kickoff reconciliation.** The casting opener is auto-sent with the user bubble hidden
   (`_orwellOpenGameAfterCasting`, the `OPEN_GAME_LINE` production cue). When device B soft-reloads
   history it must **not** render that raw cue as a player line. The persisted kickoff message is
   already phase-marked (`mark_message_phase`) / hidden-bubble; verify the reload path honors the
   hidden flag so B sees the producers' message first, exactly like A.
3. **HUD reconciliation.** The decision card, status panel, roster, finale, and gadget rail already
   poll `/api/orwell/*` and read the engine's **authoritative** `pending` (the engine is the source
   of truth; ADR 0003). So a binding decision on A clears on B within one poll. Add a
   `session_events.publish(game_session, "game-updated")` after `/api/orwell/decision`,
   `/self-eviction/*`, and a committed `advanceGame` so B reconciles **instantly** instead of
   waiting up to ~2s (optional nicety; polling remains the correctness floor).

### C. Turn ownership — one driver at a time

**The hazard:** `agent_runs.start(session, …)` **cancels** any prior in-flight run for the same
session on a new submit (it was designed for *one* device's rapid double-send). With two devices on
one session, a second device's submit would **stomp** the first's turn mid-stream. A game must have
**one** reasoning chain.

**The lock.** A per-user (== per game session) **turn lock**, server-side, in-memory (a new
`frontend/src/game_turn_lock.py`, or a guarded set keyed by session id):

- The game chat route acquires the lock when starting a game-framed run; releases it when the run
  reaches a terminal state (`done` / `error` / `stopped`).
- While held, a **second device's game-turn submit is refused** with a typed **409**
  `{ "error": "turn-in-progress", "driver": "<opaque-token>" }` — *never* a silent stomp. (Plain
  non-game chats are unaffected; the lock is scoped to game-framed turns on the canonical session.)
- The refused device renders an **in-fiction spectator banner** ("Another screen is in the house
  right now — you're watching live.") and a **disabled composer**, and attaches to the live reply
  via the existing path. So it *sees* the turn unfold, it just can't start a second one.

**Take-over.** The spectating device gets an explicit **"Take over"** affordance that calls the
existing `POST /api/chat/stop/{session}` (cancels the current run — the wrapped generator still
saves its partial), which releases the lock, then re-enables that device's composer. This reclaims a
stuck/abandoned driver without leaving the game wedged. Guard against accidental double-drive: the
button confirms, and a normal completed turn releases the lock automatically (no take-over needed
for the common case).

**Why this kills the bug at the root:** with the canonical session (A) + the lock (C), there is at
most **one** run per game per instant, enforced server-side — *independent of how many devices,
tabs, or how flaky the per-device JS guards are.*

### D. Once-only casting kickoff

The producers' opener must fire **once per game**, not once per device. Today `_openSent`
(in-memory) + `SEAT_TAKEN_KEY` (`sessionStorage`) are per-page-load / per-tab. Re-anchor the guard
to game state, two layers:

1. **Server (authoritative):** the turn lock (C) already prevents a second concurrent kickoff run.
   Additionally, the kickoff should only fire when the canonical session has **no prior assistant
   turn** — i.e. the game session is empty. The FE can check session history length before sending
   the cue; the engine's casting intake (`updateCasting` "next" status) is the deeper truth (a
   half-done interview resumes, never re-opens).
2. **Client:** `_orwellOpenGameAfterCasting` fires the cue only if (a) this is the canonical
   session, (b) the session has no messages yet, and (c) no run is active (existing
   `hasActiveStream` guard). A second device finding the opener already present simply renders it
   live and joins as spectator.

### E. Robustness

- **Late join:** §B.1 (replay + live).
- **Reconnect:** `EventSource` auto-reconnects; `sessionSync.js` already re-establishes with capped
  backoff on hard-close.
- **FE restart mid-turn:** `agent_runs` / `session_events` / the turn lock are in-memory, so a
  restart drops the in-flight run **and** clears the lock (fail-open — a new turn can be driven).
  Devices catch up from **persisted history** (the wrapped generator saved the assistant message on
  completion, or its partial on cancel); the next poll / open reloads it. No run survives a restart
  by design (non-goal).
- **Multi-tab, one device:** same session id ⇒ one driver, the rest spectate (identical to
  multi-device).
- **Cross-user isolation (0021):** `/api/chat/events/{id}` already owner-guards (W2);
  `/api/orwell/game-session` is `_current_user`-scoped and never returns another user's session;
  the turn lock is keyed by the user's own session id. No call for user A can observe user B.

---

## 4. Port / route / module contracts

| Surface | Kind | Contract |
|---|---|---|
| `frontend/src/orwell_game_session.py` | **new** FE store | `get/set/clear_game_session(user)`; JSON in `DATA_DIR`; atomic + lock; Vault-free (ids only). |
| `GET /api/orwell/game-session` | **new** route | `_current_user`-scoped; resolves-or-mints the canonical session; idempotent under concurrency; `{sessionId, created}`. |
| `/api/orwell/{new-game,next-season,reset-progress}` | **amend** | also `clear_game_session(user)` on reset (rotate the session for the new season). |
| `frontend/src/game_turn_lock.py` | **new** FE lock | per-session acquire/release; `is_held(session)`; in-memory; auto-released on run terminal state. |
| `POST /api/chat/stream` (game-framed) | **amend** | acquire the lock before `agent_runs.start`; on a held lock for a *different* driver, return **409 `turn-in-progress`** instead of stomping; release on terminal. |
| `POST /api/chat/stop/{id}` | **reuse** | the take-over path; releases the lock. |
| `GET /api/chat/events/{id}`, `/resume/{id}` | **reuse** | the existing per-session SSE + run-attach; now engaged because devices share `id`. |
| `static/js/orwellOnboarding.js` | **amend** | resolve + `selectSession` the canonical session instead of minting a device-local one. |
| `static/js/sessionSync.js` | **reuse/verify** | already reconciles `run-started` / `message-added`; verify late-join attach. |
| `static/js/` spectator UI | **new** | the "watching live / Take over" banner + disabled composer on a 409. |

**Vault Wall:** every new surface is Vault-free by construction — session **ids**, run status, and
"something changed" pings only; message bodies are fetched through the existing **owner-guarded**
history route. No new path touches `VaultStore` (engine-only anyway). The God-Mode wall is
untouched.

---

## 5. Test strategy

FE **pytest** is the gate (the feature is FE-only); the **browser smoke** drives two simulated
clients. No names in any fixture (roles only). Concrete suites:

- **Canonical session (`test_0064_canonical_session.py`)** — two *concurrent* `GET
  /api/orwell/game-session` for one user return the **same** id; a different user gets a **different**
  id; a reset (`/next-season`, `/reset-progress`) **rotates** the id; a stored id that no longer
  exists is re-minted.
- **Turn lock (`test_0064_turn_lock.py`)** — while a game run is active, a second game-turn submit
  returns **409 `turn-in-progress`**; after the run reaches terminal, a submit **succeeds**;
  `POST /api/chat/stop` releases the lock; a plain (non-game) chat is unaffected.
- **Live sync (`test_0064_session_sync.py`)** — a subscriber to `/api/chat/events/{id}` receives
  `run-started` + `message-added` for the shared session; a subscriber for a **different user's**
  session id is refused (owner guard); event payloads carry **no message body** and no Vault
  sentinel.
- **Once-only kickoff (`test_0064_kickoff_once.py`)** — with two devices on the canonical session,
  the producers' opener is recorded **once** (one assistant opener; one casting-intake open).
- **Browser smoke (extend `scripts/browser_smoke.py`)** — two headless contexts, same account:
  device A drives a casting turn; device B (already open) renders the **same** producer message and
  the live stream; B's composer is disabled with the spectator banner during A's turn; after A's
  turn B can drive the next one.

**Definition of done:** the pytest suites green; the browser smoke shows two devices on one
conversation with one-driver-at-a-time; an owner-guard + Vault-sentinel assertion on every new
route; the two-device casting-interview no longer produces two reasoning chains.

---

## 6. Acceptance criteria

1. Two devices on one account always open the **same** game `session_id`.
2. A game turn driven on one device **streams live** on every other device (tokens, not just the
   final message).
3. At most **one** game reasoning chain runs at a time per user; a second device's attempt is a
   clean **409 + spectator mode**, never a stomp and never a second chain.
4. The casting producers reach out **once** per game regardless of device count.
5. A device opening mid-turn **catches up** (replay + live); a reconnect resumes; an FE restart
   degrades to history catch-up without a stuck game.
6. A season reset **rotates** the canonical session (no dead-season bleed-through).
7. Every new surface is **owner-scoped and Vault-free**; no cross-user observation.

---

## 7. Implementer handoff

**Build order:** A (canonical session + onboarding) → D (once-only kickoff) → C (turn lock +
spectator UI) → B hardening (late-join/HUD) → E (robustness) → tests throughout (BDD/TDD-first:
write the pytest red, implement to green).

**What this replaces.** The per-tab / per-device onboarding guards (`_openSent`, `SEAT_TAKEN_KEY`,
the `currentSessionId` localStorage default, the per-session `_SESSION_GAME_FRAMED`) are no longer
the coordination mechanism — the **server-side canonical session + turn lock** are. Leave the JS
guards as cheap local fast-paths, but they must never be the only thing standing between two devices
and two reasoning chains.

**Watch:** `routes/chat_helpers.py` `_SESSION_GAME_FRAMED` and the desync spine
(`_LAST_BEAT_SIG`, `_DESYNC_REGROUND`) are keyed by `session_id` / `user`. With a single canonical
session this is now coherent across devices (good) — verify the re-entry moment (P2) fires once on
the shared session, not per device.

**Open questions (product owner):**

1. **Spectator default — passive vs. co-drive?** Spec assumes **passive spectator + explicit
   take-over** (cleanest; one author of the fiction at a time). Alternative: a softer "request the
   chair" handoff. Recommend passive + take-over for v1.
2. **Take-over friction.** Confirm dialog on "Take over" (spec: yes) vs. one-tap. Recommend confirm
   — accidental take-over mid-sentence is jarring.
3. **`game-updated` instant-reconcile event (§B.3)** — ship in v1 or rely on the existing ~2s poll?
   Recommend ship it (small, removes a visible lag on the non-driving device's decision card).
4. **Idle-driver auto-release.** Should the lock auto-release if a run is "done" but the player
   never takes the pending decision for N minutes, so another device can drive? Spec leaves the lock
   tied to **run** lifecycle (not the decision); a stuck *decision* is reclaimable via take-over.
   Confirm that's enough.
