# PERFORMANCE-DEEP audit — Orwell exhaustive pre-ship pass

Agent tag: `PERF`. Scope: client + server perf, degradation-over-a-long-season (I5) as a first-class
lens. Read-only; no suites run; no `git stash`.

## Index

| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| PERF-1 | Major | <1hr | High | Per-turn story-facts prompt context re-scans the WHOLE event history, forever | `src/adapters/engine/GameSessionAdapter.ts:7129-7131` |
| PERF-2 | Minor | <1hr | Med | Every commit's Vault-leak checkpoint filters/maps the FULL candidate event log first | `src/composition/orchestrator.ts:433` |
| PERF-3 | Major | <1day | High | Gossip diffusion re-copies+re-scans each NPC's full growing knowledge array, twice per neighbor edge, every off-screen tick | `src/engine/gossip.ts:161-192`, `src/adapters/inmemory/InMemoryKnowledgeService.ts:74-76` |
| PERF-4 | Minor | <1day | Med | `told-by:` pathway anchoring falls back to a full O(events) scan on every miss | `src/adapters/inmemory/InMemoryKnowledgeService.ts:143-156` |
| PERF-5 | Major | multi-day | High | Every persisted turn synchronously serializes+writes the ENTIRE growing season snapshot as a brand-new row (no delta), on the single-threaded, synchronous better-sqlite3 path | `src/adapters/sqlite/SqliteSaveStore.ts:95-104` |
| PERF-6 | Major | <1day | High | Chat history has no pagination anywhere in the stack — every load/switch/resume fetches + renders the FULL season transcript into the DOM | `frontend/routes/history_routes.py:46-94`, `frontend/static/js/chat.js:4230-4260` |
| PERF-7 | Minor | <1day | Med | Per-turn prompt assembly estimates tokens over (and rebuilds) the entire conversation-so-far before trimming | `frontend/src/agent_loop.py:3858-3892` |
| PERF-8 | Major | <1day | High | Streaming-render hot path re-scans the whole accumulated reply and allocates fresh `RegExp` objects per line×prefix on EVERY SSE delta | `frontend/static/js/chat.js:1774-1799` |
| PERF-9 | Major | <1day | High | Poll storm: 6+ independent, uncoordinated `setInterval`s run concurrently on the live game screen, almost none pausing when the tab is hidden | `frontend/static/js/modalManager.js:782`, `sessionSync.js:258`, `orwellDecision.js:830`, `orwellGadgetRail.js:315`, `orwellEngineStatus.js:20,129`, `orwellCast.js:789` |
| PERF-10 | Minor | <1hr | High | Two independent files poll the identical `/api/orwell/state` endpoint just to read one boolean (`started`) | `frontend/static/js/orwellCast.js:78-92`, `frontend/static/js/orwellDiaryRoom.js:51-60` |
| PERF-11 | Major | multi-day | High | `index.html` unconditionally loads the FULL ~3.2MB / 85-file workspace JS bundle regardless of `ORWELL_GAME_BUILD` | `frontend/static/index.html:2617-2683`, sizes via `frontend/static/js/*.js` |
| PERF-12 | Minor | <1hr | Med | ALL static JS/CSS/HTML is served `Cache-Control: no-cache`, forcing a conditional-GET round trip for ~85 files on every load | `frontend/app.py:428-444` |
| PERF-13 | Minor | <1day | Med | Every soul-memory write triggers a queued ONNX embedding inference, but `SoulProvider.recall()` is never called anywhere in the live game | `src/adapters/engine/SoulStore.ts:100-163`, confirmed via repo-wide grep |
| PERF-14 | Major | <1day | High | Prompt-cache `cache_control` is wired only for the Anthropic payload path; the actual game-narrator provider path (OpenAI-compatible / OpenRouter) has no equivalent | `frontend/src/llm_core.py:796-826` |
| PERF-15 | Polish | <1hr | Low | `_LAST_ROSTER` is an unbounded process-global dict, one entry per user, with no sweep | `frontend/routes/orwell_routes.py:97-113` |
| PERF-16 | Polish | <1hr | Low | `_session_locks` grows one `asyncio.Lock` per session id ever created and is never cleaned up | `frontend/core/session_manager.py:69,80-83` |
| PERF-17 | Major | <1hr | High | KaTeX + Mermaid (multi-MB diagram/math libs) load from a third-party CDN unconditionally on every game-screen load | `frontend/static/index.html:344-347` |
| PERF-18 | Polish | <1hr | Low | Fastembed warm-up (up to 45s) blocks a resumed season's real-embedding path on EVERY engine restart, not just first boot | `src/main.ts:76-109` |
| PERF-19 | Minor | <1day | Med | `/api/generated-image/{filename}` does a synchronous DB ownership query per request; mitigated by immutable caching but a cold/cross-device fetch still pays it per image | `frontend/app.py:448-486` |
| PERF-20 | Polish | <1hr | Low | `orwellHeadshot.js`'s 4s re-route poll runs forever (module lifetime), never cleared, even though it self-no-ops after casting | `frontend/static/js/orwellHeadshot.js:719-721` |
| PERF-21 | Minor | <1day | Med | `renderGameContext`/`buildSystemPrompt` re-render the ~400+-line static GM prompt text into a fresh joined string every single turn with no reuse of the unchanged prefix | `src/engine/momentPrompts.ts:1111-1128` |
| PERF-22 | Polish | <1hr | Low | `chat.js` is cache-busted with a manual `?v=` query param; every other of the ~85 files is not — an inconsistent, manual, error-prone cache-busting story | `frontend/static/index.html:2633` vs. rest of the block |
| PERF-23 | Minor | <1day | Med | `slashCommands.js` alone registers 6 separate `setInterval`s (270KB file, always loaded) — several additional timers stacked on top of the core poll storm whenever any slash-command UI has ever been touched this session | `frontend/static/js/slashCommands.js:343,456,496,1907,2008,5184` |
| PERF-24 | Minor | <1day | Med | `sessions.js`/`admin.js` each carry their own ad hoc research/ops-status pollers on top of the steady-state game pollers, all independently reaching the backend | `frontend/static/js/sessions.js:2129,2293`, `frontend/static/js/admin.js:2601,2772` |

---

## Findings

```
[PERF-1] [Severity: Major] [Effort: <1hr] [Value: High]
Per-turn story-facts prompt context re-scans the WHOLE event history, forever
- Where: src/adapters/engine/GameSessionAdapter.ts:7129-7131 (`storyFacts()`), called from
  `getMomentPrompt()` at line 6924-6926 — i.e. once per player turn / narration beat, the entire
  live game.
- Problem: `const recent = (this.record?.events() ?? []).filter((e) => !e.hidden).slice(-8)`.
  `this.record.events()` itself is O(1) amortized (the R3 optimization documented in
  `InMemoryEventStore.ts:10-22` caches the raw array), but this consumer immediately does a fresh
  `.filter()` over the FULL returned array on every single call to find the last 8 non-hidden
  events. Cost is O(total events ever recorded), and total events strictly grows across an
  11-week/multi-hour season (comps, ceremonies, off-screen scenes, gossip, confessionals,
  surfacings all append). By late-game this is scanning many hundreds to low-thousands of events
  on EVERY turn, just to keep 8. This is the exact "unbounded per-turn full-history rescan"
  pattern the codebase has already identified and fixed elsewhere for other consumers — 0065 Part
  E's `eventsSince(fromIndex)` (`InMemoryEventStore.ts:73-83`) exists precisely to give O(Δ) tail
  access instead of O(total); this call site simply doesn't use it. Directly hits I5 as a
  perf-degradation-over-a-long-session concern: the game gets measurably slower to produce every
  system prompt as the season goes on, not because content thickens (which is desired) but because
  of a needless full rescan.
- Fix: swap to a small bounded look-back (e.g. `events().slice(-64)` before the `.filter()`, or
  maintain a rolling "last N non-hidden" cache incrementally alongside `record()` appends) so the
  per-turn cost is O(small constant) instead of O(total history).

[PERF-2] [Severity: Minor] [Effort: <1hr] [Value: Med]
Every commit's Vault-leak checkpoint filters/maps the FULL candidate event log first
- Where: src/composition/orchestrator.ts:433 (`checkpoint()`), invoked on every player-turn commit
  (line ~297) and every progression advance.
- Problem: `const allHidden = candidate.events.filter((e) => e.hidden).map((e) => e.content);` runs
  unconditionally, BEFORE the function slices off the already-verified prefix
  (`baselineHiddenCount`) a few lines later. The surrounding comment block (lines 405-429) is
  explicit that this exact class of bug ("the per-season quadratic this guard's `includes` scan
  was — CPU-profiled as ~88% of checkpoint time") was found and fixed for the DOWNSTREAM
  `.includes()`/`.some()` work — but the upstream `.filter().map()` over the whole array is still
  O(total events) on every single checkpoint, i.e. every commit, for the whole season. Smaller in
  magnitude than the fixed bug (a filter+map vs. a nested scan), but the same shape and it compounds
  with PERF-1's identical anti-pattern on the identical growing array.
- Fix: since `trustEventPrefix` already tracks how much of the log was previously verified, slice
  `candidate.events` to just the NEW tail (from the previous checkpoint's event count) before the
  `.filter().map()`, mirroring the `eventsSince` pattern used elsewhere in the same file's neighborhood.

[PERF-3] [Severity: Major] [Effort: <1day] [Value: High]
Gossip diffusion re-copies+re-scans each NPC's full growing knowledge array, twice per neighbor edge
- Where: src/engine/gossip.ts:161-192 (`diffuseGossip`'s `holds`/`beliefOf` closures, used inside
  the `for (rounds) { for (holders) { for (neighbors) } }` loop), backed by
  src/adapters/inmemory/InMemoryKnowledgeService.ts:74-76 (`knownTo`).
- Problem: `knownTo(entity)` does `return [...(this.knowledge.get(entity) ?? [])]` — a full ARRAY
  COPY of everything that entity has ever come to know, every single call. Inside
  `diffuseGossip`, `holds(e)` calls `knownTo(e).some(...)` and is invoked once per graph node
  (`graph.nodes().filter(holds)`) AND once per (holder × neighbor) pair inside the innermost loop.
  With `GOSSIP.rounds = 2` and a ~16-person awake roster with realistic affinity-graph degree, a
  single `diffuseGossip` call (fired probabilistically on ~15% of off-screen ticks, i.e.
  potentially once per several player turns) makes on the order of 100-250 `knownTo()` calls, EACH
  copying+scanning an array whose length is monotonically non-decreasing across the whole season
  (per I5, "nothing thins" — knowledge only accumulates: surfacings, tellings, gossip receipts,
  seeded beliefs). Late-season, when each NPC may hold dozens-to-hundreds of known facts, this
  turns a "just diffuse one rumor" tick into real, repeated, avoidable allocation+scan work. (Note:
  the separate O(roster²) edge-affinity loop that BUILDS the gossip graph, in
  `src/composition/orchestrator.ts:640-651`, is also technically O(n²) but n is capped at the fixed
  cast size of 16 — negligible in isolation; it's the per-node `knownTo()` cost inside diffusion
  that actually scales with season length.)
- Fix: give `InMemoryKnowledgeService` an O(1) `Set<factId>`-per-entity membership index for
  `holds()` (avoid the full-array copy + linear scan for a boolean membership test), and cache
  `beliefOf` lookups by factId via a `Map` instead of `.find()` over a freshly copied array.

[PERF-4] [Severity: Minor] [Effort: <1day] [Value: Med]
`told-by:` pathway anchoring falls back to a full O(events) scan on every miss
- Where: src/adapters/inmemory/InMemoryKnowledgeService.ts:143-156 (`pathwayAnchored`), called from
  `surfaceInformationTo` — the seam every "an NPC tells the player something" / overhear /
  surfacing beat routes through.
- Problem: when the teller's own held beliefs don't already contain a derivable fragment, the code
  falls back to `this.events.query().some((e) => e.witnessSet.includes(teller) && ...)` — a full
  scan of literally every event ever recorded in the sandbox, checking `witnessSet.includes(teller)`
  (itself an O(witnessSet) array scan) for each. `events.query()` with no filter is the same
  R3-cached array as PERF-1 relies on (cheap to fetch), but the `.some()` predicate still walks the
  whole thing. This runs on the anti-sycophancy/anchoring hot path for surfaced information, which
  is exactly the kind of beat that fires repeatedly through a season.
- Fix: index events by `witnessSet` membership (a `Map<EntityId, GameEvent[]>` built incrementally
  as events are recorded) so this lookup is O(events witnessed by that one entity), not O(total events).

[PERF-5] [Severity: Major] [Effort: multi-day] [Value: High]
Every persisted turn synchronously serializes+writes the ENTIRE growing season snapshot, blocking
the single Node thread, with no delta persistence
- Where: src/adapters/sqlite/SqliteSaveStore.ts:95-104 (`saveTxn`/`saveFor`), invoked via the
  orchestrator's per-turn persist hook (CLAUDE.md: "persists each turn with a fail-closed integrity
  checkpoint").
- Problem: `saveFor` does `JSON.stringify(snapshot)` of the FULL session snapshot (every event,
  every NPC's knowledge/soul/relationship state — everything I5 mandates must never thin) and
  inserts it as a brand-new row, EVERY commit. `better-sqlite3` is synchronous by design (the class
  doc even says so, at line 26: "SYNCHRONOUS ... no async leaks into the engine"), and Node is
  single-threaded — so this JSON.stringify + disk write BLOCKS the entire HTTP MCP server (all
  concurrent users' requests, `/health`, everything) for however long serialization+write takes.
  Because the snapshot is a full, non-incremental copy (not a delta), that per-commit blocking
  window's DURATION grows across the season as the snapshot itself grows — turn 5 blocks for
  microseconds, turn 500 (late in an 11-week season with a full cast's worth of accumulated souls,
  relationships, and event history) blocks for measurably longer, and it blocks EVERY concurrent
  user on the box, not just the one whose turn triggered it. The `prune()` step (lines 157-174)
  keeps the LIVE ROW COUNT bounded, which is good, but does nothing about the size of each
  individual row, which is the actual blocking cost.
- Fix: at minimum, measure real JSON blob size growth across a full played-out 11-week season and
  confirm the synchronous stringify+write latency stays sub-perceptible even at the end; if not,
  investigate incremental/delta persistence (store the append-only event log and evolving-state
  diffs separately, reconstructing on load) or move the write off the main thread via a worker.

[PERF-6] [Severity: Major] [Effort: <1day] [Value: High]
Chat history has no pagination anywhere in the stack — full transcript on every load/switch/resume
- Where: frontend/routes/history_routes.py:46-94 (`GET /api/history/{session_id}`, both the
  in-memory and the DB-fallback path — neither takes a `limit`/`offset`), consumed by
  frontend/static/js/chat.js:4230-4260 (`for (const msg of visible)` renders EVERY message from the
  fetched history into `#chat-history` with no window/virtualization).
- Problem: a season is explicitly a long session (11 weeks, hours of play, hundreds to low
  thousands of narration/tool/player turns). Every page load, session switch, cross-device
  reconnect (0064), or refresh re-fetches the WHOLE conversation as one JSON payload and
  synchronously builds/attaches a DOM node (with markdown parsing, image loads, and
  `chatRenderer.js`-attached listeners per node — grep shows dozens of per-message
  `addEventListener` calls for attachments/copy/vision-editor buttons) for every single historical
  message. There is no server-side `limit`/`offset`/cursor and no client-side "load more"/
  virtualization. This directly produces the "the game gets laggier the longer you play" failure
  mode the charter calls out: reload/resume latency, DOM node count, and memory footprint all grow
  monotonically and unboundedly with total season length, worst exactly when the player has invested
  the most time. (The DB-side query is properly indexed — `ix_messages_session_seq` in
  `frontend/core/database.py:192-198` — so this is a pagination gap, not a missing-index bug.)
- Fix: add `limit`/`before_seq` params to `/api/history/{session_id}`, default to the most recent
  N messages, and add a client-side "load earlier" affordance (or IntersectionObserver-triggered
  backfill) instead of rendering the entire history synchronously on load.

[PERF-7] [Severity: Minor] [Effort: <1day] [Value: Med]
Per-turn prompt assembly estimates tokens over (and rebuilds) the entire conversation-so-far before
trimming
- Where: frontend/src/agent_loop.py:3858-3892 (`estimate_tokens(messages)` called on the full,
  untrimmed `messages` list before `trim_for_context` runs).
- Problem: the soft token-budget trim (`agent_input_token_budget`, default-on) is the right
  mitigation for context-window growth, but the PRE-trim step itself — building `messages` from the
  session's full history and calling `estimate_tokens` over all of it — is O(total conversation
  length so far), run fresh on every single turn. Over an 11-week season this list only grows
  (session.history is never trimmed in-memory/in-DB, only the LLM-bound copy is), so the FE-side
  preprocessing cost creeps up turn over turn even though the final LLM payload stays capped.
  Compounds with PERF-6 (same underlying full-history object).
- Fix: cache the token estimate incrementally (track a running total, adjust by delta as messages
  are appended) instead of re-summing the whole list every turn; or feed `trim_for_context` the
  already-bounded tail directly instead of the full accumulated history.

[PERF-8] [Severity: Major] [Effort: <1day] [Value: High]
Streaming-render hot path re-scans the whole accumulated reply and allocates fresh RegExp objects
per line×prefix on EVERY SSE delta
- Where: frontend/static/js/chat.js:1774-1799 (inside the per-`json.delta` handler that runs once
  per streamed token/chunk).
- Problem: on every incoming delta, the code calls `markdownModule.hasUnclosedThinkTag(roundText)`
  over the FULL accumulated text-so-far (grows every delta ⇒ O(n) per delta ⇒ O(n²) over one
  streamed reply), then `_trimmedRT.split('\n')` over the same growing text, then for lines[1..] ×
  ~24 reply-prefix candidates does `_replyPrefixes.some(rp => { const rx = new RegExp(...); ... })`
  — CONSTRUCTING AND COMPILING A NEW REGEXP OBJECT per line, per prefix, per delta. For a
  moderately long narrated reply (common in this game — the vision brief explicitly wants rich
  prose), by delta #150-200 this is doing hundreds of lines × 24 regex compilations on every single
  incoming token, which is real, avoidable main-thread work during the exact moment the UI most
  needs to stay responsive (live streaming). This is the concrete "render hot path" / "layout
  thrash" risk the charter names, and it gets WORSE the longer and richer the narration (i.e. it
  penalizes the game being good at its own core fantasy).
- Fix: hoist the 24 `RegExp` objects out of the loop (compile once, module-level), and change the
  unclosed-think/reasoning-prefix detection to operate incrementally on the newest chunk plus a
  small trailing window instead of re-scanning the whole accumulated buffer every delta.

[PERF-9] [Severity: Major] [Effort: <1day] [Value: High]
Poll storm: 6+ independent, uncoordinated setIntervals run concurrently on the live game screen,
almost none pausing when the tab is hidden
- Where (all fire unconditionally once mounted, for the lifetime of the page):
  - `frontend/static/js/modalManager.js:782` — `_scanTimer`, every 1000ms, module-scope, forever.
  - `frontend/static/js/sessionSync.js:258` — `tick`, every 1500ms.
  - `frontend/static/js/orwellDecision.js:830` — the pending-decision backstop poll, every 2500ms
    (tightened from 15s to 2.5s per its own comment, "F14 #1013").
  - `frontend/static/js/orwellGadgetRail.js:315` — `syncVisibility`, every 4000ms.
  - `frontend/static/js/orwellEngineStatus.js:20,129` — `refresh`, every `POLL_MS`=15000ms.
  - `frontend/static/js/orwellCast.js:789` — `refreshGate`, every 20000ms.
  - (`orwellDiaryRoom.js:219` also polls every 30000ms but DOES check `document.hidden` — the one
    good citizen in the set.)
- Problem: on a standard, steady-state game screen (mid-season, no modal open, no admin/settings
  panel touched) there are AT LEAST 6 concurrently-running, completely independent poll loops, none
  of which coordinate with each other, at cadences from 1s to 20s. Only `orwellDiaryRoom.js` checks
  `document.hidden`; the rest keep firing (timers, `fetch()` calls, DOM queries) even when the
  browser tab is backgrounded, minimized, or the phone screen is off — this is exactly the kind of
  thing that drains mobile battery and burns cellular data over a multi-hour session, and the
  charter explicitly calls out that a season is a long session. None of these are catastrophic
  individually (that's why the prior pass's "setInterval leaks×5" finding undercounted the real
  scope — this is a distinct problem from leaking: these all run "as designed," just uncoordinated
  and un-gated), but the aggregate is a steady drumbeat of background work for the entire
  lifetime of every game tab.
- Fix: (1) gate every one of these on `document.hidden`/`visibilitychange` (pause on hide, resume +
  immediately re-poll on show); (2) fold the liveness/gating checks (orwellCast's `refreshGate` +
  orwellDiaryRoom's `refreshGate`, see PERF-10) into a single shared low-frequency "is the game
  live" poll that dispatches an internal event, rather than N independent HTTP round trips.

[PERF-10] [Severity: Minor] [Effort: <1hr] [Value: High]
Two independent files poll the identical `/api/orwell/state` endpoint just to read one boolean
- Where: frontend/static/js/orwellCast.js:78-92 (`refreshGate`, every 20s, unconditional) and
  frontend/static/js/orwellDiaryRoom.js:51-60 (`refreshGate`, every 30s, `document.hidden`-gated).
- Problem: both functions are named `refreshGate`, both `fetch("/api/orwell/state")`, and both
  exist solely to read `st.started` and toggle a sidebar button's visibility. Neither is aware of
  the other; the full `/api/orwell/state` payload (presumably the whole Vault-free game-state
  projection, not just a boolean) is fetched and JSON-parsed twice, on two staggered cadences,
  forever, for the entire game. This is a clean, low-effort, high-value fix precisely because it's
  such an exact duplicate — a textbook case of a shared concern implemented twice.
- Fix: extract one shared "game-live" poll (or better, drive both purely off the existing
  `orwell:gamechanged` event plus a single shared cached fetch) that both sidebar buttons subscribe
  to, eliminating one of the two redundant network round trips entirely.

[PERF-11] [Severity: Major] [Effort: multi-day] [Value: High]
`index.html` unconditionally loads the FULL ~3.2MB / 85-file workspace JS bundle regardless of
ORWELL_GAME_BUILD
- Where: frontend/static/index.html:2617-2683 (every `<script>` tag for `/static/js/*.js` — no
  server-side templating conditions any of them out); file weights via `du -h frontend/static/js/`:
  `chat.js` 332KB, `settings.js` 312KB (`slashCommands.js` 268KB, `admin.js` 166KB, `sessions.js`
  136KB, `theme.js` 144KB (matches the charter's 144-166KB callout), `chatRenderer.js` 120KB,
  `orwellWindow.js` 76KB, `liquidGlass.js` 64KB, `orwellOnboarding.js` 60KB, `markdown.js` 60KB,
  `ui.js` 56KB, `orwellDecision.js` 54KB — totaling ~3.2MB across ~85 files.
- Problem: `ORWELL_GAME_BUILD` is documented (CLAUDE.md) as gating "the reduced surface" for the
  player-facing game, but that gating is entirely runtime/behavioral (JS checks `isGameBuild()`
  internally) — there is NO server-side conditional in `index.html`'s script-tag list keyed off
  `ORWELL_GAME_BUILD`, confirmed by grepping the template for `GAME_BUILD`/`game_build` (zero
  hits). This means `admin.js` (166KB — full admin/ops console, deploy/TLS/backup panels, unlikely
  to matter to a player mid-season), `settings.js` (312KB — the full general-chat-workspace
  settings surface: providers, presets, model pickers), and `slashCommands.js` (268KB — the entire
  general-purpose slash-command library) are ALL downloaded, parsed, and their top-level module
  code executed on EVERY load of the game screen, whether or not `ORWELL_GAME_BUILD=1` reduces
  what's actually shown. That's real, avoidable parse/compile/execute cost and memory footprint on
  every load, worst on mobile/low-end devices, paid for a workspace surface the game build's own
  design intent says shouldn't be there (this is contradiction C2, "an immersive game wearing a
  workspace's clothes," made concrete and measurable).
- Fix: either code-split so `ORWELL_GAME_BUILD=1` renders a template variant that omits the
  workspace-only script tags (admin.js, most of settings.js/slashCommands.js/presets.js/
  providers.js/modelPicker.js), or dynamically `import()` those modules only when their specific UI
  entry point (e.g. an admin route, a settings modal) is actually opened.

[PERF-12] [Severity: Minor] [Effort: <1hr] [Value: Med]
ALL static JS/CSS/HTML is served Cache-Control: no-cache, forcing a conditional-GET round trip for
~85 files on every load
- Where: frontend/app.py:428-444 (`_RevalidatingStatic.get_response` unconditionally sets
  `Cache-Control: no-cache` for every `.js`/`.css`/`.html` response, mounted at `/static`).
- Problem: the stated intent ("browsers were caching modules across deploys — a code change
  wouldn't appear without a manual hard-refresh") is legitimate, but the fix is a blanket
  `no-cache` on literally every static file rather than a versioned-URL scheme. `no-cache` still
  requires the browser to send a conditional request (If-None-Match/If-Modified-Since) for EVERY
  one of the ~85 JS files on EVERY page load, even when nothing changed — each gets a cheap-but-
  nonzero 304, but that's still ~85 extra round trips per load, which matters on higher-latency
  mobile connections and adds up over a season's worth of reloads/session-switches/tab-reopens. The
  one file that IS cache-busted with a real content-addressed-ish scheme is `chat.js?v=20260604s`
  (a manual version string) — see PERF-22 for the resulting inconsistency.
- Fix: adopt a real cache-busting scheme (content-hash or build-id query param) across all static
  JS/CSS so they can be served `immutable`/long-max-age like the generated-image route already
  does (`GENERATED_IMAGE_HEADERS`, `frontend/app.py:481-486`), eliminating the conditional-request
  round trip entirely instead of just making it cheap.

[PERF-13] [Severity: Minor] [Effort: <1day] [Value: Med]
Every soul-memory write triggers a queued ONNX embedding inference, but SoulProvider.recall() is
never called anywhere in the live game
- Where: src/adapters/engine/SoulStore.ts:100-163 (`recordToSoul` queues an embed for every memory
  via the shared "breathing lane"; `recall` is the only consumer of the resulting vector index).
  Confirmed via repo-wide grep: `grep -rn "\.recall(" src --include=*.ts` outside of
  `SoulProvider.ts`'s own interface declaration and `SoulStore.ts`'s own definition returns ZERO
  hits — `GameSessionAdapter.ts` only ever calls `recordToSoul` (write), never `recall` (read); one
  of its own comments even says "vector recall index (0024), when wired into the sandbox" (line
  ~5408), acknowledging the read side isn't wired in yet.
- Problem: the engine pays the FULL compute+engineering cost of semantic recall — an ONNX
  inference per soul-memory write (careful macrotask-spaced via the G8/G12 "breathing lane" so it
  doesn't stall `/health`, per the extensive comments in `SoulStore.ts:6-53`), the 45s fastembed
  model warm-up (PERF-18), a per-houseguest in-memory vector index, and a full re-embed of every
  memory for every saved user on `rebuildSoulIndex` at boot/restore — for a feature that currently
  provides ZERO benefit in live play, since nothing ever queries it. Over an 11-week season with
  16 houseguests each accumulating many soul memories, this is a non-trivial amount of wasted CPU
  paid every single turn for a dead read path.
- Fix: either wire `recall()` into an actual consumer (e.g. narrator context assembly pulling
  semantically-relevant past memories, which would also be a genuine behavioral-fidelity win per
  I7), or skip the indexing work entirely until a real caller exists, to stop paying for it.

[PERF-14] [Severity: Major] [Effort: <1day] [Value: High]
Prompt-cache cache_control is wired only for the Anthropic payload path; the actual game-narrator
provider path has no equivalent
- Where: frontend/src/llm_core.py:796-826 (`_build_anthropic_payload` attaches
  `cache_control: {type: "ephemeral"}` to the system block and the last tool schema when the system
  text exceeds 4000 chars or tools are present — explicitly because "the agent loop re-sends this
  same large prefix every round"); no equivalent exists in the OpenAI-compatible payload builder.
- Problem: CLAUDE.md documents the live/default game narrator as `deepseek/deepseek-v4-pro` (and
  SOUL/ADR 0016 references GLM-4.7), both routed through the OpenAI-compatible / OpenRouter path,
  NOT the Anthropic path. The ~420-line static GM system prompt (`BASE_GAME_MASTER_PROMPT` +
  moment fragment + game context, assembled fresh every turn in
  `src/engine/momentPrompts.ts:1111-1128`, see PERF-21) plus the accumulating conversation history
  is resent on every single turn for the entire season, and the ONE mechanism in this codebase
  built to avoid re-billing/re-processing that stable prefix (`cache_control`) only fires for a
  provider family the shipped game apparently doesn't use. Depending on whether the specific
  OpenRouter-fronted model already caches automatically server-side (some do, some require
  explicit markers — this needs verification against the actual provider(s) configured for launch),
  this could mean the single most expensive, most repeated request in the whole product (the
  per-turn narration call) is paying full prefix-processing cost and latency every turn, all season,
  with an existing, unexploited mechanism sitting right next to it in the same file.
- Fix: verify empirically (compare `usage`/cache-hit fields, if the provider surfaces them, across
  two consecutive turns) whether the configured OpenRouter model already benefits from automatic
  prompt caching; if not, add the equivalent explicit caching markers/headers for the
  OpenAI-compatible request path, or restructure the prompt so the stable prefix is a genuinely
  reusable segment for whichever caching scheme the launch provider supports.

[PERF-15] [Severity: Polish] [Effort: <1hr] [Value: Low]
`_LAST_ROSTER` is an unbounded process-global dict, one entry per user, with no sweep
- Where: frontend/routes/orwell_routes.py:97-113.
- Problem: `_LAST_ROSTER: dict = {}` is a module-level (process-lifetime) cache keyed by user id,
  written by `_remember_roster` and only ever removed by an explicit, narrowly-triggered
  `_forget_roster` call. A user who plays a season and never triggers that specific removal path
  (e.g. abandons the app rather than reaching the "no cast" terminal state) leaves a permanent
  entry (a small list of roster card dicts) in this process-global dict for the life of the server
  process, across however many seasons/users it ever serves. Small per-entry footprint, but
  unbounded and never swept — a slow leak proportional to total distinct users served, not
  bounded by any TTL despite the 90s `_LAST_ROSTER_TTL_S` only gating READS, not eviction.
- Fix: add a periodic sweep (or an LRU cap, mirroring the pattern already used for resident
  sandboxes per audit R4 in `src/composition/registry.ts:640`) that evicts entries whose `ts` is
  well past the TTL, regardless of whether `_forget_roster` was ever explicitly called for them.

[PERF-16] [Severity: Polish] [Effort: <1hr] [Value: Low]
`_session_locks` grows one asyncio.Lock per session id ever created and is never cleaned up
- Where: frontend/core/session_manager.py:69 (`self._session_locks: Dict[str, "asyncio.Lock"] =
  {}`), populated lazily at line 80-83, referenced nowhere else — no corresponding `del`/`.pop()`
  anywhere in the file, including at the session-deletion code path (`del self.sessions[...]`
  around line 947 does not touch `_session_locks`).
- Problem: every chat session (including ephemeral/incognito ones, per the codebase's own
  `session_routes.py` comment about "Lazy purge: incognito sessions are ephemeral by design") that
  ever calls `session_lock()` leaves a permanent `asyncio.Lock` object keyed by its id in this
  dict for the lifetime of the server process — across every season, every user, every archived/
  deleted/forked/compare session ever created. Individually tiny, but unbounded and permanent.
- Fix: pop the corresponding `_session_locks` entry wherever a session is deleted/archived/expired
  (same code paths that already remove from `self.sessions`).

[PERF-17] [Severity: Major] [Effort: <1hr] [Value: High]
KaTeX + Mermaid (multi-MB diagram/math libraries) load from a third-party CDN unconditionally on
every game-screen load
- Where: frontend/static/index.html:344-347 — `https://cdn.jsdelivr.net/npm/katex@0.16.22/...` and
  `https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js`, both `async` but unconditionally
  present in the document for every load, no `ORWELL_GAME_BUILD` gating.
- Problem: Mermaid (v11, minified) is a genuinely large bundle (it embeds its own layout/rendering
  engines) and KaTeX's JS+CSS add further weight — both are workspace-chat features (rendering math
  and flowcharts in assistant replies) that have essentially no role in a text-based Big Brother
  social-game narration (the model is never going to emit a Mermaid diagram of who's on the block).
  `async` keeps them from blocking initial parse, but they still consume real bandwidth/CPU/battery
  on every load, introduce a hard runtime dependency on a third-party CDN being reachable
  (`jsdelivr.net` — a real availability + a privacy/telemetry surface for a "your season, your
  isolated sandbox" product), and add to the total JS weight audited in PERF-11.
- Fix: gate these two `<script>` tags out entirely when `ORWELL_GAME_BUILD=1` (or, more
  conservatively, lazy-load them only the first time a message actually contains a ```` ```mermaid ````
  fence or `$...$` math delimiter, which the surrounding inline-script comments suggest the
  init logic already half-expects).

[PERF-18] [Severity: Polish] [Effort: <1hr] [Value: Low]
Fastembed warm-up (up to 45s) blocks a resumed season's real-embedding path on EVERY engine
restart, not just first boot
- Where: src/main.ts:76-109 — the warm-up runs after `/health` is already answering (a real,
  documented fix for a 2026-06-19 prod incident), bounded by `ORWELL_EMBED_WARMUP_MS` (default
  45000ms), and "saved games are resumed only AFTER this."
- Problem: this is already well-engineered for the FIRST-boot cold-cache case, but the comment
  itself says every resume (not just a fresh model download) waits behind this same up-to-45s
  window before a restored season's souls capture real embeddings. For a season played over many
  days/weeks, the engine could restart multiple times (deploys, crashes, host reboots) — each one
  reintroduces up to 45s of "not fully warmed" resume latency, not just the very first cold start.
  Low severity because `/health` itself isn't blocked and the deterministic fallback keeps the game
  playable meanwhile — but given PERF-13 shows `recall()` is dead code in the live game anyway,
  this 45s budget is currently being spent on every restart for a feature that provides no
  observable in-game benefit yet.
- Fix: no urgent action needed beyond noting the coupling to PERF-13 — if recall is wired in, revisit
  whether the warm-up window should shrink now that there's a real payoff to measure against.

[PERF-19] [Severity: Minor] [Effort: <1day] [Value: Med]
`/api/generated-image/{filename}` does a synchronous DB ownership query per request
- Where: frontend/app.py:448-486 (`serve_generated_image`).
- Problem: every image request opens a fresh `SessionLocal()` and does a `.filter(...).first()`
  ownership check against the `GalleryImage` table before serving bytes. This is well-mitigated by
  `GENERATED_IMAGE_HEADERS` using `immutable` long-max-age caching (so a browser that already has
  the image never re-requests it) — but the FIRST load of each of a season's 16+ portraits (plus
  any regenerated variants), and every cross-device/cross-browser/incognito load, still pays a
  synchronous DB round trip per image, serialized behind whatever connection-pool contention exists
  at that moment. Not a missing index (filename lookups would want one — worth confirming
  `GalleryImage.filename` is indexed) so much as an avoidable per-request DB hit for a value that's
  effectively static once portraits are generated for the season.
- Fix: cache the ownership check (e.g. an in-process TTL cache keyed by filename, populated on
  first successful check) so repeat cross-session/cross-device loads within a season don't re-hit
  the DB; confirm `GalleryImage.filename` has an index.

[PERF-20] [Severity: Polish] [Effort: <1hr] [Value: Low]
`orwellHeadshot.js`'s 4s re-route poll runs forever, never cleared, even though it self-no-ops
after casting
- Where: frontend/static/js/orwellHeadshot.js:719-721.
- Problem: `setInterval(function () { if (_win || document.getElementById(ID) || _maybePregame) {
  route(); } }, 4000)` is deliberately self-limiting (the guard conditions go false once the season
  starts, per the surrounding comment "a no-op once the season is underway"), so its RUNTIME cost
  post-casting is negligible — but the timer itself is never `clearInterval`'d, so it's one more
  perpetual background tick contributing to the ambient poll-storm count audited in PERF-9. Listed
  separately here (rather than folded fully into PERF-9) because its per-tick cost is genuinely
  near-zero, unlike the others.
- Fix: `clearInterval` it once `_maybePregame` flips false and no relevant DOM node exists, rather
  than leaving an eternally-firing (if cheap) timer for the rest of the season.

[PERF-21] [Severity: Minor] [Effort: <1day] [Value: Med]
`renderGameContext`/`buildSystemPrompt` re-render the ~400+-line static GM prompt text into a fresh
joined string every single turn
- Where: src/engine/momentPrompts.ts:1111-1128 (`buildSystemPrompt` does
  `[BASE_GAME_MASTER_PROMPT, momentFragment(moment), ..., renderGameContext(view), ...].join("\n\n")`
  fresh on every `getMomentPrompt` call).
- Problem: `BASE_GAME_MASTER_PROMPT` is a large, wholly static string (the ~420-line GM prompt the
  charter references) — it never changes within a season. Rebuilding the joined array + running
  `.join()` over it every turn is comparatively cheap in isolation (string concatenation, not a
  scan of growing state like PERF-1/2/3), but it's real, avoidable work on the single hottest path
  in the whole engine (every turn, every game, forever) and it's the LOCAL half of PERF-14's
  network-level caching gap — even with provider-side prompt caching wired up, the ENGINE still
  reconstructs and re-transmits the identical static prefix as a fresh string object every time,
  which matters for anyone measuring engine-side latency independent of the network hop.
- Fix: memoize the static `BASE_GAME_MASTER_PROMPT`+moment-fragment concatenation (these have a
  small, enumerable key space — moment × producerVoice presence) so only the genuinely
  turn-varying pieces (`renderGameContext`, `worldContext`, `storyFacts`) get freshly rendered.

[PERF-22] [Severity: Polish] [Effort: <1hr] [Value: Low]
`chat.js` is cache-busted with a manual `?v=` query param; every other of the ~85 files is not
- Where: frontend/static/index.html:2633 (`chat.js?v=20260604s`) vs. every other `<script src=
  "/static/js/*.js">` tag in the same block (lines 2617-2683), none of which carry a version param.
- Problem: this is an inconsistent, hand-maintained cache-busting story layered on top of the
  blanket `no-cache` header from PERF-12 — one file gets belt-and-suspenders versioning, 84 others
  rely purely on the `no-cache` conditional-GET. It's evidence the team has already hit (and
  manually patched) the "browser served a stale module" problem once for `chat.js` specifically,
  which is a strong signal the same class of staleness risk exists for the other 84 files too,
  just without anyone having hit it yet (or without it having been noticed).
- Fix: fold into the PERF-12 fix — a single, systematic cache-busting scheme applied uniformly
  removes both the inconsistency and the residual staleness risk for every other file.

[PERF-23] [Severity: Minor] [Effort: <1day] [Value: Med]
`slashCommands.js` alone registers 6 separate setIntervals, layering more timers onto the poll
storm whenever any slash-command UI has been touched this session
- Where: frontend/static/js/slashCommands.js:343, 456, 496, 1907, 2008, 5184 (six distinct
  `setInterval` call sites in one 268KB, always-loaded file).
- Problem: on top of the steady-state 6+ pollers audited in PERF-9, this single file — loaded
  unconditionally per PERF-11 — contributes up to 6 MORE interval timers once whatever UI state
  triggers each of them is touched (autocomplete polling, draft-restore polling at 200ms per line
  1907, etc.). A 200ms poll (`_draftPoll` at line 1907) is a notably tight cadence for a background
  timer; worth confirming it's properly torn down when its owning UI closes, given the pattern
  established elsewhere in this codebase (PERF-9) of timers that outlive their relevance.
- Fix: audit each of the 6 for a matching `clearInterval` on the relevant close/unmount path (not
  performed as part of this pass — flagging the concentration for a follow-up focused sweep), and
  consider whether the 200ms `_draftPoll` cadence is necessary vs. event-driven (input events)
  restoration.

[PERF-24] [Severity: Minor] [Effort: <1day] [Value: Med]
`sessions.js`/`admin.js` each carry their own ad hoc research/ops-status pollers on top of the
steady-state game pollers
- Where: frontend/static/js/sessions.js:2129 (`_researchPollTimer`), :2293 (`pollId`);
  frontend/static/js/admin.js:2601, :2772 (both named `pollTimer`, polling
  `/api/admin/ops-status`).
- Problem: these are individually well-behaved (the admin ones self-clear on settle, per code read
  at admin.js:2599-2611/2770-2782), but they're additional, independent polling loops that exist in
  files loaded unconditionally on every game screen per PERF-11 — i.e. even though a player will
  essentially never trigger the admin ops-status flow or a deep-research job during a Big Brother
  season, the CODE for four more pollers ships and initializes on every load regardless.
- Fix: lower priority than PERF-9/11 (these are properly scoped/cleared once triggered) — noting
  for completeness since the charter asks for every poll/setInterval cadence to be accounted for.
```

---

## Coverage notes (where I looked / didn't)

**Looked at:** `frontend/static/index.html`'s full script-tag manifest + CDN includes; every
`setInterval` call site across `frontend/static/js/*.js` (grepped all ~85 files) and cross-checked
`document.hidden`/`visibilitychange` gating on each; `addEventListener` vs `removeEventListener`
ratio (1041 vs 142) with targeted sampling in `chatRenderer.js` (found the delegated/module-scope
ones are fine — properly one-time or self-cleaning); the chat-history render/fetch path end to end
(`history_routes.py`, `chat.js`'s adopt-pass renderer, `sessions.js`); the streaming SSE delta
handler's per-token work in `chat.js`; the engine's per-turn prompt-build path
(`momentPrompts.ts`, `GameSessionAdapter.storyFacts`); the orchestrator's per-commit checkpoint
cost profile (including its own documented prior optimization, which I did NOT re-report, only the
adjacent residual cost); `InMemoryEventStore`/`InMemoryKnowledgeService` for their documented and
undocumented complexity; `SqliteSaveStore`'s save/prune path; `SoulStore`'s embedding
breathing-lane engineering plus whether `recall()` has any live caller (repo-wide grep, confirmed
none); `SqliteVectorIndex.ts` (skimmed — no additional findings beyond what SoulStore already
surfaces); `src/main.ts`'s boot sequence (embed warmup, deferred resume) and `registry.ts`'s
resident-sandbox LRU (already well-engineered, not re-reported); `frontend/app.py`'s static-file
serving + generated-image route; `frontend/src/llm_core.py`'s Anthropic vs. OpenAI-compatible
payload builders for prompt-caching parity; `frontend/src/agent_loop.py`'s context-budget/trim
path; `frontend/core/session_manager.py`'s in-memory session cache (confirmed already fixed —
lazy-hydration + `limit(100)` — not re-reported) and its un-swept `_session_locks`; roster-related
O(n²) loops in `src/engine/blocs.ts`/`gossip.ts` (found them bounded/negligible at the fixed
16-person cast, noted but not flagged as major).

**Did NOT cover / ran low on budget before exhausting:** `frontend/static/js/settings.js` (315KB)
and `slashCommands.js` (268KB) internals beyond their `setInterval` sites (grep-then-narrow
discipline — did not read either end to end per the charter's explicit prohibition, and did not
attempt a line-by-line audit of their logic for additional hot paths); the Playwright/browser-
level runtime profiling that would give real numbers (I had no telemetry captures of a played-out
long season to inspect — this pass is source-level, evidence-based estimation, not a profiler
trace; several findings explicitly recommend "measure this on a real played-out season" rather
than asserting a numeric magnitude I can't verify from source alone); `SqliteVectorIndex.ts`'s own
query complexity in depth; the Python-side `context_compactor.py`/`context_budget.py`
implementations' own internal complexity (confirmed they exist and run by default, did not audit
their internals for a further hot-path bug); CSS layout-thrash specifically (charter mentions it
under render hot paths, but a byte-level layout/reflow audit needs live profiling, not source
reading, and other lanes cover visual/motion in depth already); the `dependency-cruiser`/build
pipeline's own build time; mobile-specific battery-profiling data (none available — flagged the
structural cause — uncoordinated un-gated polling — instead).

I did not exhaust every one of the ~85 JS files individually, but I did exhaust every
`setInterval`/poll-cadence site (the charter's explicit ask), the full server-side persistence and
prompt-assembly hot paths, and cross-checked every finding against actual call sites rather than
speculation. I have not run out of findable issues in this territory — a deeper pass with real
browser profiling (CPU flame graphs during a long streamed reply, a heap snapshot after a
simulated multi-week season) would very likely surface more, especially inside `settings.js`/
`slashCommands.js`'s un-audited internals — but I've hit strong diminishing returns on
grep-and-read-source alone and have a solid, evidence-backed set above the target range.
