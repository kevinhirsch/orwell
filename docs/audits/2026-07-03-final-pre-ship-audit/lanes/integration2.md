# INTEGRATION-2 — FE↔BE / BE↔Engine Contract Audit (Orwell Pre-Ship v2)

Scope per brief: (1) FE-fetch → FE-route matrix, (2) FE-route → engine-tool matrix, (3) stream
lifecycle, (4) multi-device seam, (5) auth matrix, (6) timeout/clock-skew, (7) content-type/encoding.
Dedupe against v1's ~41 findings (index in CHARTER.md) — none re-reported below; several corroborate/
extend a v1 theme with a genuinely new site (noted inline).

**Matrix sizes actually audited:**
- FE-fetch → FE-route: **45 orwell-specific `fetch()` call sites across 35 `orwell*.js` files**,
  matched against **41 `/api/orwell/*` routes** in `routes/orwell_routes.py` (plus the shared
  `chat_stream`/`chat/events`/`chat/resume`/`chat/stop`/`sessions/*` seams in `chat_routes.py` /
  `session_routes.py` that the game rides on).
- FE-route → engine-tool: **28 distinct `orwell_engine.*()` call sites** (across `chat_helpers.py`,
  `orwell_routes.py`) mapped to their MCP tool + `McpServer.ts` `requireShape` guard.
- Stream lifecycle: **20 SSE `type` values** handled client-side in `chat.js` cross-referenced against
  every `"type": "..."` literal emitted server-side in `agent_loop.py`/`chat_helpers.py`/`chat_routes.py`.
- Multi-device: all 4 `_publish_game_updated`/`publish_game_updated_after_turn` call sites plus the
  `session_events.py` subscribe/publish/ring lifecycle, plus every session-delete code path (3 routes).
- Auth: `/api/orwell/*` guard posture (3 of 41 routes are intentionally admin-gated; the rest are
  `_current_user`-scoped by design) + the `gateway_routes.py`/`X-Orwell-User` trust chain end to end.
- Timeout/clock-skew: every timeout constant in `src/orwell_engine.py` + the client abort timer in
  `chat.js` cross-referenced against the server's disconnect-handling branch in `chat_routes.py`.
- Content-type/encoding: portrait upload validation, decision/diary free-text length limits, unicode
  spot-checks skipped in depth (engine-side, out of FE↔BE seam) beyond the FE upload/route boundary.

**Where I looked (files, not just endpoints):** all 35 `orwell*.js` files (line-level for the ~14 with
fetch calls), `routes/orwell_routes.py` (full 1470 lines), `routes/chat_helpers.py` (targeted:
beatSeq/sync-spine sections, ~lines 750-2700), `routes/chat_routes.py` (the whole `chat_stream`
generator + disconnect handler + SSE routes, ~1490-1900), `src/orwell_engine.py` (full), `src/session_events.py`
(full), `src/orwell_game_session.py` (full), `src/orwell_portraits.py` (targeted: studio-candidate
generation + locking), `routes/gateway_routes.py` + `gateway/handler.py` (full), `routes/session_routes.py`
(delete/bulk-delete/archive routes), `src/adapters/mcp/McpServer.ts` (`requireShape` switch), the
`admin_*_routes.py` family (auth-guard census only, not full read).

---

## INDEX

| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| INTEGRATION2-1 | Major | <1hr | High | `submitDecision` — the single highest-stakes mutation in the game — never attaches `expectedBeatSeq`/`idempotencyKey` | `routes/orwell_routes.py:1055` |
| INTEGRATION2-2 | Minor | <1hr | Med | Self-eviction request/cancel have the same beatSeq omission as #1 | `routes/orwell_routes.py:1116,1132` |
| INTEGRATION2-3 | Major | <1day | High | Mid-stream client disconnect drops the peer-push AND the E22 consequence fallback — both gated behind a sentinel the disconnect handler preempts | `routes/chat_routes.py:1608-1666` |
| INTEGRATION2-4 | Major | <1hr | High | `bulk_delete_sessions` regresses the GAP-1/#1085 canonical-session unbind fix via a second delete path | `routes/session_routes.py:535-558` |
| INTEGRATION2-5 | Major | <1day | High | `r.ok ? await r.json() : null` pattern discards the server's specific error body on every non-2xx response — 8 sites, 5 files | `orwellCast.js:397, orwellChatGate.js:35, orwellDiaryRoom.js:57, orwellHeadshot.js:227/247/265, orwellNewSeason.js:175/241` |
| INTEGRATION2-6 | Major | <1day | High | `rounds_exhausted`/`truncated` inject raw step-limit machinery + a "Continue ▸" button straight into `#chat-history`, un-gated by `game_build_enabled()` unlike the sibling operator-aside scrub | `src/agent_loop.py:6063-6071`, `static/js/chat.js:2210-2260` |
| INTEGRATION2-7 | Minor | <1hr | Med | `model_fallback` client handler is dead code (never emitted); the live sibling `fallback`/`compacted` toasts are the SAME I9 leak class as #6 but via toast, not chat-history | `static/js/chat.js:2147-2156,2176-2186,2354-2357` |
| INTEGRATION2-8 | Major | <1day | High | Gateway webhook is unauthenticated-by-default and trusts the payload-supplied platform identity as the credential — impersonation via a knowable platform user id | `routes/gateway_routes.py:1-19,78-124` |
| INTEGRATION2-9 | Minor | <1day | Med | Portrait studio generation: no client timeout/progress/cancel, and no server-side lock — two concurrent calls can interleave writes to the same candidate slots | `static/js/orwellHeadshot.js:230-241`, `src/orwell_portraits.py:1287-1311` |
| INTEGRATION2-10 | Minor | <1hr | Med | Diary Room error copy conflates a benign 409 ("no active game") with a genuine 502 outage into one "camera glitched" message | `static/js/orwellDiaryRoom.js:153-159`, `routes/orwell_routes.py:998-1013` |
| INTEGRATION2-11 | Polish | <1hr | Low | Portrait backfill's fallback message ("a run started recently…") is shown for a genuine request failure too, not just a real debounce | `static/js/orwellCast.js:394-411` |
| INTEGRATION2-12 | Minor | <1hr | Med | `removeAll()`/`deleteFromLibrary()` show/imply success even when the DELETE never reached the server | `static/js/orwellHeadshot.js:270-280,311-313` |
| INTEGRATION2-13 | Polish | <1day | Low | No length cap on Diary Room / decision free-text fields that get folded into recalled context | `routes/orwell_routes.py:995-1027` |
| INTEGRATION2-14 | Minor | <1hr | Med | Client abort timer is a one-shot "first byte" timer (not re-armed), sized inconsistently with its own comment, and a slow-but-healthy first token aborts a turn the server keeps running anyway | `static/js/chat.js:27-28,1140-1155,1701` |
| INTEGRATION2-15 | Polish | <1hr | Low | A game-session 404 mid-turn (canonical session deleted from another device/admin action) silently reloads the session list with no game-specific messaging | `static/js/chat.js:1300-1306` |
| INTEGRATION2-16 | Polish | <1day | Low | 16 independent polling loops across `orwell*.js`, several hitting overlapping/duplicate state (e.g. `/state` and `/status` both independently resolve "is the game live") — no shared cache/coalescing | `orwellCast.js, orwellPresence.js, orwellFinale.js, orwellSeasonProgress.js, orwellNightStatus.js, orwellStatusPanel.js, orwellDiaryRoom.js, orwellChatGate.js` (poll loops) |
| INTEGRATION2-17 | Minor | <1hr | Med | `/next-season` and `/conclude-season` FE handlers use the same error-swallowing ternary as #5, so the route's specific 409 reasons ("season not over yet", "no season to advance from") never reach the player | `static/js/orwellNewSeason.js:175,241` (see also #5) |
| INTEGRATION2-18 | Polish | <1hr | Low | `requestBackfill`'s button re-enable timer (5s) and the "Generating…" note both fire from the same handler regardless of success/failure — a genuine offline failure looks identical in UI affordance timing to a healthy kick-off | `static/js/orwellCast.js:388-412` |
| INTEGRATION2-19 | Minor | <1day | Med | `session_events.subscribe` heartbeat is 20s but no client-side reconnect-backoff cap is visible for the mirror EventSource — a flapping connection could hot-loop reconnects (needs live verification; flagged from source asymmetry) | `src/session_events.py:96`, `static/js/sessionSync.js` |

---

## FULL FINDINGS

### [INTEGRATION2-1] [Severity: Major] [Effort: <1hr] [Value: High]
`submitDecision` — the single highest-stakes mutation in the game — never attaches `expectedBeatSeq`/`idempotencyKey`

- **Where:** `routes/orwell_routes.py:1038-1101` (`orwell_decision` handler) calling
  `orwell_engine.submit_decision(decision, user=user)`; contrast `src/orwell_engine.py:622`
  (`async def submit_decision(decision, expected_beat_seq=None, idempotency_key=None, user=None)`) and
  `src/adapters/mcp/McpServer.ts:99` (`case "submitDecision": guardSyncFields(true)` — the engine tool
  fully supports both fields). `routes/chat_helpers.py:803` already defines `last_beat_seq(user)`,
  used everywhere else in the sync spine.
- **Problem:** CLAUDE.md documents the ADR-0065 sync spine as covering "every mutating tool":
  `expectedBeatSeq` for stale-write detection and `idempotencyKey` for at-most-once progression. The
  decision-card POST — nominations, veto decision, eviction votes, jury votes, finale answers, the
  goodbye message — is the ONE structural, engine-direct commitment path explicitly designed
  (per its own docstring) so "prose can never bind through this surface." Yet the route never passes
  `expected_beat_seq=last_beat_seq(user)` (trivially available — it's already imported and used
  elsewhere in this same package) nor generates an `idempotency_key`. Every other mutating surface
  (the chat-turn tool-call path via `chat_helpers.py`) is wired into the spine; this one — arguably the
  most consequential single mutation in the entire game — is not. Practically: the engine's own
  "no-op unless a matching pending exists" logic covers the common double-submit case, but a
  board-moved-underneath-you race (two windows racing a decision on the same pending, or a stale card
  surviving a reconcile) has no structural staleness guard here, unlike literally every other write.
  Ties to invariant **I10** (fair/reproducible — the sync-spine invariant exists precisely to keep the
  board consistent across concurrent writers) and is a sibling of, but materially different from, v1's
  "write-back beatSeq omission" (that finding was about `recordCastProfile`/`recordWorldSnapshot`
  FE-driven infra levers, not the primary player decision path).
- **Fix:** In `orwell_decision`, call `orwell_engine.submit_decision(decision, expected_beat_seq=last_beat_seq(user), idempotency_key=str(uuid4()), user=user)` (import `last_beat_seq` from `chat_helpers`
  or hoist it to a shared module), then `_refresh_beat_seq(user, res)` on the response, mirroring the
  pattern already used for the chat-turn path. Add a boundary test (per the CLAUDE.md-documented
  4-place write-back gotcha template) asserting the decision route actually forwards both fields
  through to `McpServer.callTool`.

---

### [INTEGRATION2-2] [Severity: Minor] [Effort: <1hr] [Value: Med]
Self-eviction request/cancel carry the same beatSeq omission as #1

- **Where:** `routes/orwell_routes.py:1108-1143` — `orwell_self_eviction_request` and
  `orwell_self_eviction_cancel` call `orwell_engine.request_self_eviction(user=...)` /
  `cancel_self_eviction(user=...)` with no `expected_beat_seq`.
- **Problem:** Same class of gap as INTEGRATION2-1, lower stakes (a boolean confirmation-state toggle
  rather than a scored decision), but confirms this is a systemic omission across the whole
  `/api/orwell/decision`-adjacent family, not a one-off. If a season transition or an admin reset lands
  between the request and the confirm/cancel click, there's no staleness signal.
- **Fix:** Same as #1 — thread `expected_beat_seq=last_beat_seq(user)` through both calls once the
  helper is available in `orwell_routes.py`. Low cost to fix alongside #1 in the same PR.

---

### [INTEGRATION2-3] [Severity: Major] [Effort: <1day] [Value: High]
Mid-stream client disconnect drops the peer-device push AND the E22 consequence-fold fallback

- **Where:** `routes/chat_routes.py:1608-1626` (the `[DONE]`-gated block that calls
  `publish_game_updated_after_turn` and schedules `ensure_turn_recorded`) vs.
  `routes/chat_routes.py:1663-1683` (`except (asyncio.CancelledError, GeneratorExit): # Client
  disconnected — save partial response`).
- **Problem:** The generator's happy path only reaches the `data: [DONE]\n\n` sentinel branch — which
  fires `publish_game_updated_after_turn` (the cross-device HUD push, feature 0064) and schedules
  `ensure_turn_recorded` (the feature-0055/E22 fallback `recordInteraction` for a socially-engaged turn
  the model never explicitly recorded) — on a clean stream completion. The `CancelledError`/
  `GeneratorExit` handler that fires on an actual client disconnect (tab close, network drop, or the
  client-side timeout's own `abort()`) takes an entirely separate branch: it saves the PARTIAL
  narration text (good — the transcript survives) but never reaches, and has no `finally`-equivalent
  path to, the peer-push or the consequence-fallback. Concretely: a player has an engaging,
  scheme-relevant conversation with an NPC, the model never calls `recordInteraction` (the documented,
  common under-call failure mode this fallback exists to fix), and the connection drops (flaky wifi,
  phone lock, tab close) before the model finishes its reply — the scene is narrated, partially
  persisted as chat history, but its hidden relationship-layer consequence is NEVER folded. This is
  exactly the "cardinal implementation sin" CLAUDE.md names verbatim: "never ship an action that is
  narrated but never recorded." It also means a peer device stays stale until its next 20-30s poll
  instead of getting the instant push, on every disconnected-mid-turn case. Directly violates **I4**.
- **Fix:** Wrap the `[DONE]`-branch's two calls (`publish_game_updated_after_turn`,
  `ensure_turn_recorded`/`_rec_task`) in a `finally`-equivalent that also runs on the
  `CancelledError`/`GeneratorExit` path, using whatever partial `full_response` text was captured (the
  fallback extraction is already designed to work off free text; a partial reply is a strictly weaker
  but still-better-than-nothing input than none). At minimum, always attempt the beat-seq-diff peer
  push (`beat_now > beat_seq_before`) in the disconnect handler regardless of whether narration
  completed — that part needs no text at all and is pure upside.

---

### [INTEGRATION2-4] [Severity: Major] [Effort: <1hr] [Value: High]
`bulk_delete_sessions` regresses the GAP-1/#1085 canonical-session-unbind fix via a second delete path

- **Where:** `routes/session_routes.py:535-558` (`POST /sessions/bulk-delete`, "for compare cleanup via
  sendBeacon") vs. `routes/session_routes.py:564-598` (`DELETE /session/{sid}`, which DOES call
  `orwell_game_session.clear_game_session(user)` when the deleted session is the canonical game
  session — the documented fix for bug #1085/"a session-delete that doesn't unbind the canonical id
  leaves the mirror subscribed to a dead channel and collapses the window").
- **Problem:** `bulk_delete_sessions` calls `session_manager.delete_session(sid)` directly in its loop
  and never checks/clears `orwell_game_session`. `POST /session/{sid}/delete` (the sendBeacon-friendly
  single-session variant, line 530) correctly delegates to `delete_session()` and inherits the fix, but
  the BULK variant does not. If the canonical game session id is ever among the ids swept by a bulk
  delete (e.g. the "Compare" feature's cleanup sweep, or a future bulk-cleanup UI action), the binding
  becomes a dangling pointer and reproduces the exact regression already fixed once: the mirror SSE
  404s forever, `/api/chat/resume` 404s, and a live window can collapse on convergence. This is a
  concrete, reproducible **regression of a previously-fixed bug through an un-audited second code
  path** — exactly the kind of thing SOUL.md's "diagnose before revert" lesson exists to catch before
  ship.
- **Fix:** Factor the unbind check out of `delete_session` into a small helper
  (`_unbind_if_canonical(request, sid)`) and call it from both `delete_session` and inside
  `bulk_delete_sessions`'s per-id loop after a successful delete. Add a regression test that bulk-
  deletes a set of ids including the canonical game session id and asserts the binding clears.

---

### [INTEGRATION2-5] [Severity: Major] [Effort: <1day] [Value: High]
`r.ok ? await r.json() : null` discards the server's specific error body on every non-2xx response

- **Where (8 sites, 5 files):**
  - `static/js/orwellCast.js:397` (`requestBackfill`)
  - `static/js/orwellChatGate.js:35` (retired module, lower impact but same pattern)
  - `static/js/orwellDiaryRoom.js:57` (`refreshGate`)
  - `static/js/orwellHeadshot.js:227,247,265` (`upload`, `studioGenerate`, `finalizeSelected`)
  - `static/js/orwellNewSeason.js:175,241` (`startNextSeason`, the evicted-conclude handler)
- **Problem:** Every one of these ternaries reads `r.ok ? await r.json() : null` — meaning the moment
  the server answers with ANY non-2xx status, the client throws the response body away UNPARSED and
  substitutes `null`, before any code even has a chance to read `.error`. But the matching server
  routes consistently return a specific, actionable JSON error body on failure — e.g.
  `routes/orwell_routes.py:815` returns `{"error": "image missing or too large (max 12MB)"}` on 413,
  `:822` returns `{"error": "that file is not an image"}` on 400, `:1307` returns `{"error": "the
  current season is not over yet"}` on 409 — and every one of those specific, helpful messages is
  unreachable from the client because `d` is forced to `null` before the `(d && d.error)` fallback
  logic ever runs. The player only ever sees the generic hardcoded fallback ("That image couldn't be
  used — try another.", "The house wouldn't open just yet — try again.") regardless of which of several
  distinct failure reasons actually occurred — directly working against good error-state design
  (contrast with `orwellDecision.js`'s confirm handler, which DOES status-branch its copy well — see
  INTEGRATION2-14's related note on inconsistency). This is systemic enough (8 sites) to be worth a
  single sweep rather than a spot fix.
- **Fix:** Replace the pattern everywhere with `let d = null; try { d = await r.json(); } catch (_) {}`
  (parse regardless of status, tolerate a non-JSON body), then keep the existing `if (!r.ok || !d)`
  gating logic for the "did it succeed" branch but let the `d && d.error` fallback actually see the
  real body on failure. A tiny shared helper (`fetchJson(url, opts)` returning `{ok, status, body}`)
  in a shared orwell JS util would prevent this from recurring a 9th time.

---

### [INTEGRATION2-6] [Severity: Major] [Effort: <1day] [Value: High]
`rounds_exhausted`/`truncated` inject raw workspace machinery directly into `#chat-history`, un-gated by `game_build_enabled()`

- **Where:** `src/agent_loop.py:6063` (`yield f'data: {json.dumps({"type": "rounds_exhausted", ...})}\n\n'`)
  and `:6071`/`:6346` (`"type": "truncated"`) — contrast `src/agent_loop.py:4035-4038`, where the
  operator-aside scrub is explicitly widened with `_scrub_active = _is_live_game or game_build_enabled()`
  specifically because "in the game build the model is never a workspace assistant... machinery/
  operator-asides are ALWAYS a leak." Client rendering: `static/js/chat.js:2210-2260`.
- **Problem:** When the agent hits its per-turn round cap or the model's output-token cap mid-turn,
  the client appends a DOM node straight into the live chat transcript reading "Reached the N-step
  limit — not finished." with a "Continue ▸" button — literally inside `#chat-history`, adjacent to and
  indistinguishable in placement from in-fiction GM narration bubbles. Neither the emission site
  (`agent_loop.py`) nor the render site (`chat.js`) checks `game_build_enabled()`/`isGameBuild()` before
  firing, even though the exact same file already has an established, working pattern for gating
  workspace-only leaks behind that check (the operator-aside scrub, `_scrub_active`). In the game
  build, a player who happens to hit either cap (long/tool-heavy turns are common on premiere/casting
  turns — flagged elsewhere as prompt-bloat risk) sees raw agent-harness vocabulary — "step limit,"
  "Continue" — appear as if it were part of the show. This is a direct, concrete **I9** violation
  ("no engine/tool/app/system talk in anything the player sees") and a fresh instance of **C2**
  (workspace bleed-through) distinct from v1's `update_plan` TODO-dashboard finding (different event
  family, different render site).
- **Fix:** Gate both emission sites behind `game_build_enabled()` (mirroring the existing
  `_scrub_active` pattern) so the game build either suppresses the raw note entirely and instead
  auto-fires the same continuation the button would (the codebase already has an established pattern
  for "the model needs a nudge, do it server-side, never surface the mechanism" — the stall-nudge/
  forced-advance family) or renders in-fiction copy ("the cameras cut away mid-scene — say the word to
  pick back up") instead of the raw step-limit sentence.

---

### [INTEGRATION2-7] [Severity: Minor] [Effort: <1hr] [Value: Med]
`model_fallback` toast handler is dead code; the live `fallback`/`compacted` toasts are the same I9-leak class as #6

- **Where:** `static/js/chat.js:2147-2156` (`json.type === 'model_fallback'` — toasts
  `` `Model ${old} offline — switched to ${new}` `` ); `:2176-2186` (`'fallback'` — toasts `'⚠ ' + selected
  + ' failed — answered by ' + answeredBy`); `:2354-2357` (`'compacted'` — toasts `'Context compacted —
  older messages summarized'`).
- **Problem:** A repo-wide grep for `"model_fallback"` as an emitted SSE type across every `.py` file
  in `frontend/` returns zero hits — the string only exists as unrelated settings-key substrings
  (`default_model_fallbacks` etc). The client-side handler and its toast are therefore genuinely
  unreachable dead code (matches the brief's explicit "handled-but-never-emitted = dead code" ask).
  More important: its LIVE siblings `fallback` and `compacted` ARE reachable (passthrough at
  `agent_loop.py:4339` for `fallback`), and neither is scrubbed for the game build either — a
  provider failover or a context-compaction event during play pops a toast naming real model
  identifiers ("⚠ deepseek/deepseek-v4-pro failed — answered by openrouter/gemini-flash") or
  workspace vocabulary ("Context compacted") over the fiction. Toasts are a separate surface from
  the chat body (no reasoning-scrub/render-contract touches them at all), so this leak class is
  invisible to the existing `chat.js` render-contract tests.
- **Fix:** Delete the dead `model_fallback` branch. Gate the `fallback`/`compacted` toasts (and any
  other model-identifying toast) behind `isGameBuild()` in `chat.js`, substituting an in-fiction-safe
  generic ("the feed glitched for a second") or simply suppressing the toast in the game build (the
  turn still completes; nothing is lost by not narrating the provider hop to the player).

---

### [INTEGRATION2-8] [Severity: Major] [Effort: <1day] [Value: High]
Gateway webhook is unauthenticated by default and trusts the payload-supplied platform identity as the credential

- **Where:** `routes/gateway_routes.py:1-19` (module docstring, candidly documents the posture),
  `:60-124` (`platform_webhook`, `_gateway_secret_ok`), `gateway/handler.py:40-79`
  (`handle_platform_turn` resolves `user = orwell_user or get_paired_user(platform_identity)`).
- **Problem:** `ORWELL_GATEWAY_WEBHOOK_SECRET` (the platform-agnostic transport secret) and the
  per-platform secret (e.g. `TELEGRAM_WEBHOOK_SECRET`) are BOTH opt-in and unset by default — the
  docstring says so explicitly: "By default the endpoint is unauthenticated and treats the platform
  identity as the credential." With neither secret configured (the out-of-the-box state for a fresh
  deploy that enables the gateway without following the SEC-2 hardening note), anyone who can reach
  `POST /gateway/webhook/{platform_id}` can submit an arbitrary JSON body claiming any
  `platform_identity` (e.g. `"telegram:123456"`) they know or can guess (platform user ids are often
  observable — shared groups, forwarded messages — and in Telegram's case are sequential integers).
  `get_paired_user()` resolves that identity straight to a real orwell account and the turn is routed
  into THAT PLAYER'S live game with zero further verification — a direct cross-user isolation break
  (**I10**: "absolute cross-user isolation" is a first-class guarantee "alongside the Vault Wall"). This
  is the closest thing in the codebase to the brief's explicit "can a header be spoofed through the
  gateway?" question — it isn't a header, but functionally it's the same shape of problem: an unverified
  identity claim from an untrusted transport is trusted as the auth boundary. There is also no runtime
  signal anywhere (boot log, `/admin/status`) that flags "a platform is registered with no webhook
  secret configured" — the exposure is silent, not just opt-in.
- **Fix:** At minimum, log a loud warning (and surface it on `/admin/status`, mirroring the pattern
  used for other posture warnings in that surface) whenever a platform adapter is registered AND
  neither `ORWELL_GATEWAY_WEBHOOK_SECRET` nor that platform's own secret is set. Stronger: refuse to
  register a platform adapter at all without a configured secret unless an explicit
  `ORWELL_GATEWAY_ALLOW_UNVERIFIED=1` escape hatch is set, so the unauthenticated posture requires a
  deliberate, documented opt-IN rather than being the silent default for a public-facing deploy.

---

### [INTEGRATION2-9] [Severity: Minor] [Effort: <1day] [Value: Med]
Portrait studio generation: no client timeout/progress/cancel, and no server-side lock against concurrent runs

- **Where:** `static/js/orwellHeadshot.js:230-241` (`studioGenerate`) and `:350` (the busy-state render,
  a static "Working…"/"Generating 3 studio options…" string with no progress and no cancel affordance);
  `src/orwell_portraits.py:1287-1311` (`generate_studio_candidates` — sequential loop, `_clear_candidates`
  then up to 4 sequential `_generate_one` calls, no per-user lock) and `:875` (`httpx.Timeout(...,
  read=300.0, ...)` — a 300s per-image-call read timeout).
- **Problem:** No `fetch()` call anywhere in `orwell*.js` uses `AbortController`/a client-side timeout
  (confirmed by grep — the only `AbortController` usages in the orwell surface are in generic window/
  sheet-kit teardown, unrelated to network calls). Combined with the server's 300s-per-image read
  timeout and up to 4 sequential generations, a pathological slow/hanging image provider can leave the
  player staring at a static "Generating 3 studio options…" string for up to ~20 minutes with zero
  progress feedback and no way to cancel except abandoning the tab. Separately, `generate_studio_
  candidates` has no per-user mutex: the client's own `st.busy` flag only prevents a SECOND click from
  the SAME rendered instance of the module — it does not prevent two browser tabs (or a fast
  double-fire before the busy re-render commits) from both calling `POST /portrait/studio/generate`
  concurrently, both of which call `_clear_candidates(user)` then write to the SAME `cand-0..N-1` file
  paths — the two runs' images can interleave, leaving a candidate set that's part run-A, part run-B.
- **Fix:** Add a client-side `AbortController` with a generous but finite timeout (e.g. 90s) on the
  studio-generate fetch, with a visible "still working…" progress tick and a Cancel button that calls
  `abort()`; server-side, guard `generate_studio_candidates` with a simple per-user `asyncio.Lock` (or
  reuse whatever debounce primitive `_fe_report_limiter`-style code elsewhere in the FE already uses)
  so a concurrent second call either waits or is refused with a clear "already generating" response.

---

### [INTEGRATION2-10] [Severity: Minor] [Effort: <1hr] [Value: Med]
Diary Room error copy conflates a benign 409 with a genuine outage

- **Where:** `static/js/orwellDiaryRoom.js:153-159` (`submitDR` throws a bare `Error("HTTP "+status)`;
  the `catch` in the submit handler always sets the SAME text: "📔 The Diary Room camera glitched —
  try again."); `routes/orwell_routes.py:998-1013` (`orwell_diary_room` returns a clean 409
  `{"started": False, "error": "no active game"}` when there's no active game — explicitly NOT an
  outage per its own comment — vs. a 502 for a genuine engine-unreachable case).
  Contrast `static/js/orwellDecision.js:695-708`, which DOES status-branch its recovery copy (409 vs
  400 vs other) for the exact same class of failure on a sibling surface.
- **Problem:** The route already distinguishes "no active game" (retrying won't help — the season is
  over/not started) from "engine unreachable" (retrying might help) via status code, but the Diary Room
  client throws that distinction away and shows the SAME "camera glitched, try again" message either
  way — actively telling the player to retry an action that structurally cannot succeed if the game has
  ended between opening Diary Room mode and hitting send (a real race: the season-conclude flow, or a
  self-eviction resolving, can end the game while the composer is mid-entry). This is the same
  underlying pattern gap as INTEGRATION2-5 but on the ERROR-MESSAGE-QUALITY axis rather than the
  response-parsing axis, and worth fixing to the standard `orwellDecision.js` already sets nearby.
- **Fix:** Have `submitDR` attach `r.status` to its thrown error (mirroring `orwellDecision.js`'s
  `Object.assign(new Error(...), { httpStatus: r.status })`), and branch the pill copy: 409 → "the
  season's already over — nothing to record," anything else → the existing glitch copy.

---

### [INTEGRATION2-11] [Severity: Polish] [Effort: <1hr] [Value: Low]
Portrait backfill's fallback message can't tell a real failure from a genuine debounce

- **Where:** `static/js/orwellCast.js:394-411` (`requestBackfill`).
- **Problem:** `const data = r.ok ? await r.json() : null;` (the same #5 pattern) means a genuine
  500/timeout on `POST /api/orwell/portraits/backfill` falls into the same `else` branch as a
  legitimate "a generation run started recently" debounce response, both rendering "A generation run
  started recently — give it a few minutes, then try again." A player hitting a real backend failure
  is told to just wait, when the truth is the request never even landed.
- **Fix:** Same remediation as INTEGRATION2-5 (parse the body regardless of status) plus an explicit
  branch for `!r.ok` distinct from the "recently ran" debounce case.

---

### [INTEGRATION2-12] [Severity: Minor] [Effort: <1hr] [Value: Med]
`removeAll()`/`deleteFromLibrary()` imply success even when the DELETE never reached the server

- **Where:** `static/js/orwellHeadshot.js:270-274` (`removeAll`: `try { await fetch(...DELETE...); }
  catch (_) {} st.file = null; ...; msg("Removed."); await refreshStatus();` — the success message and
  local-state reset run UNCONDITIONALLY, regardless of whether the fetch threw) and `:311-313`
  (`deleteFromLibrary`: same swallow, no message at all either way).
- **Problem:** If the DELETE request fails (offline, 5xx), the code still clears local UI state and
  tells the player "Removed." — a false-positive success. `refreshStatus()` immediately after would
  normally re-sync from the server and could reveal the item is still there, but the player has
  already been told (and the UI has already visually acted as though) the removal succeeded, which is
  actively misleading in the failure case rather than fail-open-silent.
- **Fix:** Check the fetch's `.ok` before showing "Removed."/clearing local state; on failure, show
  "Couldn't remove that — try again" and skip the optimistic local clear (or clear only after
  `refreshStatus()` confirms the server's view agrees).

---

### [INTEGRATION2-13] [Severity: Polish] [Effort: <1day] [Value: Low]
No length cap on Diary Room / decision free-text fields that feed recalled context

- **Where:** `routes/orwell_routes.py:995-997` (`DiaryRoomRequest.entry: str`, no `max_length`),
  `:1016-1027` (`DecisionRequest.statement`/`appeal`, also uncapped); the composer `<textarea
  id="message">` in `static/index.html:1241` also carries no `maxlength`.
- **Problem:** Diary Room entries and decision statements/appeals are player OOC/IC content that
  persists into recalled context for future turns (per CLAUDE.md's memory-loop invariant, "nothing
  thins" — persisted detail accumulates). None of these fields have a length ceiling at either the FE
  Pydantic model or (as far as the FE→engine boundary is concerned) a documented cap, so an
  accidental giant paste (or a deliberate stress test) has an unbounded blast radius on prompt size for
  every future turn that recalls it, with no graceful truncation defined at this boundary — whatever
  happens downstream (token-budget truncation, a 400, silent mid-word cut) is undefined from the FE's
  perspective. Lower-confidence/lower-severity than the others above since I did not trace the full
  downstream prompt-assembly behavior for an oversized entry — flagging the missing guard at the
  boundary, not a confirmed crash.
- **Fix:** Add a reasonable `max_length` (e.g. 4000 chars) to `DiaryRoomRequest.entry` and the
  decision free-text fields, returning a clean 400 with a specific message, plus a client-side
  `maxlength` + counter on the composer/diary-room textarea so the player gets feedback before
  submitting rather than after a 400.

---

### [INTEGRATION2-14] [Severity: Minor] [Effort: <1hr] [Value: Med]
Client abort timer is a one-shot "first byte" guard, sized inconsistently with its own comment

- **Where:** `static/js/chat.js:27-28` (`RESEARCH_TIMEOUT_MS = 360000` / `DEFAULT_TIMEOUT_MS =
  120000`) and `:1140-1155` (the `setTimeout` that arms `abortCtrl.abort()`), vs. the comment directly
  above it: `// Timeout: 6 min for research and agent mode, 3 min otherwise` — the actual
  `DEFAULT_TIMEOUT_MS` constant is 120000ms (2 min), not 3. Cleared once, at `:1701-1702`
  (`clearResponseTimeout()`, guarded by a `responseTimeoutCleared` latch so it can only fire once) on
  the FIRST `delta`/`tool_start`/`tool_progress`/`agent_step`/`doc_stream_*`/`research_progress` event.
- **Problem:** Two related issues. (a) Stale comment: "3 min otherwise" vs. the real 120000ms/2min
  constant — trivial but worth fixing before ship so a future tuning pass doesn't trust the wrong
  number. (b) Structurally, this is a "time to first meaningful event" timeout, not a rolling/idle
  timeout across the whole stream — which is the right shape ONCE streaming has started, but means a
  turn whose FIRST token is simply slow (a large casting-interview system prompt against a loaded
  provider, or a cold-start on a fresh model endpoint) can abort at the 2-or-6-minute mark even though
  the server — per INTEGRATION2-3's finding — generally keeps the generator running to completion
  regardless of the client's fate. The player sees "⚠ Connection error — your message didn't go
  through. Try again," which is misleading when the turn wasn't actually broken, just slow to start,
  and (per #3) resending can risk a duplicate mutation if the abandoned turn's tool calls do eventually
  land.
- **Fix:** Correct the comment to match the real constant (or bump the constant to match the intent).
  Consider a lightweight "still thinking…" server-emitted keepalive event within the first ~10-15s of
  a turn (distinct from a real content chunk) purely to signal liveness and avoid the client's abort
  firing on a merely-slow-but-healthy first token.

---

### [INTEGRATION2-15] [Severity: Polish] [Effort: <1hr] [Value: Low]
A game-session 404 mid-turn silently reloads the session list with no game-specific messaging

- **Where:** `static/js/chat.js:1298-1306` — on a 404 from `chat_stream`, the code assumes "Session
  was deleted (e.g. by AI)" and does `holder.remove(); sessionModule.loadSessions(); return;` with no
  further messaging.
- **Problem:** This handling is written for the generic multi-session workspace case. For the orwell
  game specifically, a 404 mid-turn on the canonical game session is a real, if rare, possible outcome
  of the cross-device seams audited elsewhere in this report (e.g. a bulk-delete per INTEGRATION2-4, or
  a season-reset from another device racing an in-flight turn) — and when it happens the player's
  in-flight message/turn simply vanishes with the chat view silently reloading the session list. There
  is no "the season restarted" or "this chat ended" framing — the player is left to infer what
  happened from the session list changing under them, which reads as a bug rather than an explained
  state.
- **Fix:** In the game build (`isGameBuild()`), branch this 404 path to show a specific, in-fiction-
  safe notice ("that thread of the story just ended — the season moved on") before reloading, rather
  than a silent session-list refresh.

---

### [INTEGRATION2-16] [Severity: Polish] [Effort: <1day] [Value: Low]
16 independent polling loops, several resolving overlapping/duplicate state, with no shared cache

- **Where:** `orwellCast.js` (roster + gate poll on `/state`), `orwellPresence.js` (`/whereabouts`
  poll), `orwellFinale.js` (`/finale` poll), `orwellSeasonProgress.js`, `orwellNightStatus.js`,
  `orwellStatusPanel.js` (`/status` + `/state`), `orwellDiaryRoom.js` (`/state` gate poll),
  `orwellChatGate.js` (retired, still polls), `orwellDecision.js` (`/status` rearm poll),
  `orwellRetrospective.js`, `orwellDeals.js`, `orwellEngineStatus.js` (`/health`),
  `orwellHeadshot.js`, `orwellGadgetRail.js`, `orwellOnboarding.js`, `orwellNewSeason.js` — 16 files
  each independently arm their own `setInterval`/self-rescheduling `setTimeout` loop.
- **Problem:** This is distinct from v1's "setInterval leaks×5" (a lifecycle/cleanup bug) — this is an
  efficiency/battery observation: at minimum three of these (`orwellCast.js`'s gate check,
  `orwellDiaryRoom.js`'s gate check, and `orwellChatGate.js`) independently poll `/api/orwell/state`
  purely to answer "is the game live," each on its own cadence, and `orwellStatusPanel.js` polls BOTH
  `/status` and `/state`. On a mobile connection (explicitly a named ship concern per the charter)
  this is meaningfully more radio wake-ups and battery draw than necessary for data that's shared
  across panels and changes together (per the g15 `orwell:gamechanged` dispatcher's own premise — see
  CLAUDE.md — the panels ARE meant to reconcile off one shared signal, but each still independently
  re-fetches its own source data on its own timer rather than sharing one fetch and fanning the result
  out).
- **Fix:** Not a ship-blocker; a post-launch consolidation candidate. Introduce one shared,
  short-TTL cache (e.g. a 2-3s memoized promise) for `/api/orwell/state` reads so panels calling it
  within the same tick share one network round trip, and audit whether `/status` can absorb `/state`'s
  `started` field (or vice versa) so panels don't need both.

---

### [INTEGRATION2-17] [Severity: Minor] [Effort: <1hr] [Value: Med]
`/next-season` and `/conclude-season` lose their specific 409 reasons to the same swallow pattern as #5

- **Where:** `static/js/orwellNewSeason.js:175` and `:241` — see INTEGRATION2-5 for the shared root
  cause; called out separately here because the LOST information is unusually actionable: the server's
  409 bodies are specifically "the current season is not over yet" / "no season to advance from"
  (`routes/orwell_routes.py:1307,1312`) — exactly the kind of message a confused player needs when the
  "See how it ends" / "start next season" buttons don't work as expected, and instead they get "The
  house wouldn't open just yet — try again" with no indication that retrying without first finishing
  the season will never work.
- **Problem/Fix:** Same as INTEGRATION2-5 — listed separately in the index because it's a concrete,
  named consequence of that pattern worth its own line item for prioritization (this is a visible,
  reachable player flow — end-of-season handoff — not just an edge case).

---

### [INTEGRATION2-18] [Severity: Polish] [Effort: <1hr] [Value: Low]
Backfill button re-enable timing doesn't distinguish success from failure

- **Where:** `static/js/orwellCast.js:388-412` (`requestBackfill`) — `setTimeout(() => { btn.disabled =
  false; }, 5000);` runs unconditionally after the try/catch, regardless of which branch executed.
- **Problem:** Minor polish: whether the request succeeded, was debounced, or failed outright
  (network offline), the "Backfill" button re-enables on the exact same fixed 5s timer with no
  difference in affordance — a genuinely offline photo service and a healthy kick-off look and feel
  identical to the player for that 5 seconds, missing a chance to signal "this isn't working right
  now" distinctly from "this is normal, hang on."
- **Fix:** Shorten (or skip) the re-enable delay on a hard failure (`catch` branch) since there's no
  server-side debounce to protect against in that case, and/or add a distinct disabled-state title
  ("offline") vs. the debounce case ("cooling down").

---

### [INTEGRATION2-19] [Severity: Minor] [Effort: <1day] [Value: Med]
Mirror SSE heartbeat/reconnect asymmetry (flagged from source; not live-verified)

- **Where:** `src/session_events.py:96` (`_HEARTBEAT_S = 20` — the server sends a `: keepalive`
  comment every 20s on an idle mirror connection) — I did not find a corresponding client-side
  reconnect backoff/cap in the portion of `sessionSync.js` I read (native `EventSource` reconnects on
  its own per the browser's default retry, which most browsers do NOT back off exponentially by
  default unless the server sends a `retry:` field, which this endpoint does not).
- **Problem:** Flagged with lower confidence since I did not instrument a live flapping-connection
  test (out of budget for this pass; the brief allows source-level flags where telemetry isn't
  available). If the mirror SSE connection to `/api/chat/events/{id}` drops repeatedly (a genuinely
  flaky network, not a clean disconnect), the lack of an explicit `retry:` interval or client-side
  backoff could produce a reconnect hot-loop, each reconnect re-subscribing (cheap, per
  `session_events.py`'s clean subscribe/unsubscribe lifecycle — no leak there) but potentially
  generating meaningful request volume on a bad connection, and each reconnect replays the ring
  (bounded to 8 events, cheap) — so the blast radius looks bounded, but I could not fully confirm the
  client's reconnect cadence from source alone.
- **Fix:** Verify live (a network-conditions test toggling the connection off/on rapidly) whether the
  browser's default `EventSource` reconnect cadence is acceptable; if not, emit an explicit `retry:
  5000\n` (or similar) in the SSE preamble to floor the reconnect interval, which costs nothing and
  removes the ambiguity.

---

## Cross-territory flags

- **INTEGRATION2-3 (disconnect drops consequence-fold) is the standout cross-cutting finding** — it
  sits exactly on the seam the vision brief calls the highest-severity concentration ("severity
  concentrated historically in ONE seam: model↔engine") and directly instantiates invariant I4's
  named cardinal sin via an infrastructure gap rather than a model under-call, which is a NEW failure
  mode for that invariant beyond the already-known "model skips the tool call" class the FE belts
  (agent_loop.py) are built to catch. Worth flagging to any lane auditing I4/the consequence loop
  directly (e.g. a social-game or narration-fidelity lane) as a structural amplifier: even a model that
  reliably calls `recordInteraction` can lose the fold to a disconnect.
- **INTEGRATION2-1 (decision-card beatSeq gap)** is worth flagging to whichever lane owns the
  multi-window/consistency audit (`orwell-consistency-parity` territory) — it's the one mutating tool
  NOT wired into the sync spine that every other seam in this app relies on, and a two-window race on a
  decision card specifically is a plausible real scenario given the app's own multi-device design goals.
- **INTEGRATION2-6/7 (I9 leaks via rounds_exhausted/truncated/fallback/compacted)** should be
  corroborated against any UX/content lane's own I9 sweep — I found these via SSE-type cross-reference
  rather than live telemetry, so a live-model run that happens to hit a round cap or a provider
  fail-over would directly confirm the leak visually.
- **INTEGRATION2-8 (gateway impersonation)** is arguably outside a narrow "integration contract" frame
  and closer to a security-review finding — flagging for whichever lane (if any) is doing a dedicated
  security pass, since it's the most severe individual finding in this file by blast radius (cross-user
  isolation) even though its likelihood depends on whether the operator enables the gateway without
  reading the SEC-2 hardening note.

## Coverage statement

Audited exhaustively: all 35 `orwell*.js` files for fetch call sites and their error/loading/retry
handling (45 sites); the complete `routes/orwell_routes.py` (1470 lines) and the beatSeq/sync-spine
sections of `routes/chat_helpers.py`; the full `chat_stream` generator and every SSE lifecycle route in
`routes/chat_routes.py` including the disconnect-handling branch; the complete multi-device stack
(`orwell_game_session.py`, `session_events.py`) and every session-delete code path; the gateway's full
auth posture end to end (`gateway_routes.py`, `gateway/handler.py`); every timeout constant on the
`src/orwell_engine.py` client and its client-side counterpart in `chat.js`; the `McpServer.ts`
`requireShape` guards for the tools the FE actually calls. **Did NOT cover** (out of budget / genuinely
requires live telemetry rather than source reading): live network-condition testing of SSE
reconnect behavior (INTEGRATION2-19 flagged at reduced confidence accordingly); the full admin-route
auth census beyond a guard-count spot-check (all 10 `admin_*_routes.py` files showed guard-count ≥
route-count, no finding, but I did not read every route body); deep unicode/non-ASCII round-trip
testing of houseguest names through the portrait-prompt/markdown pipeline (engine-side, judged
outside the FE↔BE contract-matrix frame this lane owns); the non-orwell 400+ generic-workspace fetch
call sites (deliberately out of scope — those aren't the game surface). I did not run out of real
issues in my territory; I stopped at 19 to stay within the depth-over-padding spirit of the mandate
after exhausting the highest-signal seams (decision/sync-spine, stream lifecycle, multi-device,
auth/gateway, and the FE error-handling census) — a further pass over the remaining ~30 non-fetch
`orwell*.js` files (window-kit mechanics, layout persistence, keyboard/a11y wiring) would likely
surface more but is UX/a11y-lane territory, not integration-contract territory.
