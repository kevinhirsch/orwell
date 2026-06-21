# Mirror-B — "text generates then disappears" — transient/animation-correctness audit

- **Date:** 2026-06-21
- **Type:** READ-ONLY transient/lifecycle audit (no code changed).
- **Investigator lens:** transient & animated-correctness specialist — full lifecycle of a
  streamed assistant message (mount → stream deltas → round end → reconcile → persist), every
  point where VISIBLE text can be removed or overwritten mid-flight.
- **Symptom (PO):** "Sometimes things generate and then disappear — concurrent AND non-concurrent.
  Some text comes out but it's not getting to the FE, or it is and it's going away."
- **Two seeded leads reconciled:** (1) mid-stream SSE error → silent truncation
  (`2026-06-21-openrouter-conformance-audit.md` gap #1); (2) paint-then-hide / reconcile-replace
  in `chat.js` / `chatRenderer.js` (ADR 0008).
- **Roles only.** No game-entity names used.

> **Channel-split is NOT a bug.** Reasoning routed to the Thinking accordion and kept out of the
> public bubble (`chat.js` `roundReplyText` vs `roundReasoningText`; `agent_loop.py` `round_reasoning`
> vs `round_response`) is BY DESIGN (CLAUDE.md). This audit does not flag it. "Disappear" = text that
> was VISIBLE in the public bubble and then vanished.

---

## Lifecycle ground truth (where text lives at each stage)

1. **Stream deltas** (`chat.js:1457-1500`): each `{delta}` with `thinking` falsy → `roundReplyText`
   (+ `roundText` + `accumulated`); `_renderStream()` (`:1291-1327`) paints `stripToolBlocks(roundReplyText)`
   into the *current round's* bubble (`roundHolder`).
2. **Round boundary** (`agent_step` `:2661`, `teacher_takeover` `:2728`): `roundReplyText` /
   `roundReasoningText` / `roundText` are **reset to ''** and a fresh `roundHolder` is created. The
   merged `accumulated` survives (TTS/persistence/`dataset.raw`).
3. **Round end** (`[DONE]` final-render `:2861`): the public body is re-rendered from
   `stripToolBlocks(roundReplyText)` — i.e. **only the LAST round's reply buffer**.
4. **Persist** (server `chat_routes.py:1271-1285` agent / `:1113-1129` chat): the **full** multi-round
   `full_response` is saved; `message_saved{id}` stamps `roundHolder.dataset.dbId` (`chat.js:2136`).
5. **Reconcile** (`softReloadHistory` `:3655`, ADR 0008; `resumeStream` `:3742`): rebuilds the public
   log from the DB.

The asymmetry in steps 3 vs 4 (last-round reply buffer vs full multi-round save) is the seam most of
the single-window disappearances ride on.

---

## RANKED DISAPPEAR-CAUSES

### D1 — Game-build intermediate-round bubble is painted, then HIDDEN on `agent_step` / `tool_start` (BEST single-window match)
- **Where:** `chat.js:2169-2170` (tool follows a round) and `chat.js:2672-2673` (`agent_step` — new
  round starts). Final-render only re-shows the LAST round's reply (`:2861`).
- **Lifecycle, frame by frame:**
  1. Round N streams visible narration → `_renderStream()` paints it into `roundHolder` (the player
     SEES prose appear and grow).
  2. The model then emits a tool call (`advanceGame` / `recordInteraction` / a context read) **or** a
     new `agent_step` fires. In the game build, the handler unconditionally sets
     `roundHolder.style.display = 'none'` — **the just-painted narration vanishes in one frame.**
     - `tool_start` path: `:2159-2180` — `if (isGameBuild()) roundHolder.style.display = 'none'`.
     - `agent_step` path: `:2672-2674` — same.
  3. Buffers reset (`roundReplyText=''`), a fresh `roundHolder` mounts for round N+1.
  4. At `[DONE]`, the final render reads `stripToolBlocks(roundReplyText)` = **round N+1's** buffer
     only. If the closing round carried the real narration, it re-appears; if the closing round was a
     tool/empty/reasoning-only round, the body is hidden (`:2904`) and **round N's narration is gone
     for the rest of the turn** (only the post-turn DB reload, if it happens, brings it back).
- **Mechanism:** **JS timing / state-machine, not CSS.** The L6b rule ("an intermediate agent round is
  the model's *planning*, suppress its bubble; only the FINAL round is narration") assumes player
  narration only ever lands in the final round. The live agent loop violates that assumption whenever
  the model narrates **then** calls a tool (extremely common in this product — narrate the scene, then
  `advanceGame` / auto-`recordInteraction`). The narration round becomes "intermediate" and is hidden.
- **Differential ruled out:** not a CSS transition (it's a discrete `display:none`); not a reconcile
  (happens with zero peer activity); not the channel-split (the hidden text is public `roundReplyText`,
  not reasoning). Confirmed by `2026-06-21-deepseek-v4-reasoning-continuation-audit.md` #4, which
  isolates "visible-then-gone" as a scrub/suppress path distinct from the reasoning strip.
- **Single-window vs concurrent:** **SINGLE-WINDOW.** No second device required. The most likely
  match for "non-concurrent … text comes out but it's going away," and it literally "feels like wasted
  reasoning" because the wasted-looking output is real narration the model produced.
- **Theory (MDA / WCAG):** a Mechanics timing bug (round-classification heuristic) producing an
  Aesthetics failure (the reveal flashes then dies — tension built, release stolen). WCAG 2.2.2
  (pause/stop/hide) and Gestalt common-fate are both violated: content the eye is tracking is yanked.
- **Confidence:** HIGH that the paint-then-hide exists and fires single-window. MEDIUM-HIGH that it is
  the PO's primary report.
- **Falsifier:** a high-FPS filmstrip of a game turn where the model narrates then calls a tool, with
  `body.hide-thinking` off; if the narration bubble never reaches `display:none` before `[DONE]`, D1
  is wrong. (Predicted: it does, on the `agent_step`/`tool_start` frame.)

### D2 — Final render reads only the LAST round's `roundReplyText`; a tool/empty closing round blanks the turn live
- **Where:** `chat.js:2861` (`finalDisplay = stripToolBlocks(roundReplyText)`), reset points
  `:2706-2707` / `:2746-2747`, hide path `:2896-2910`.
- **Lifecycle:** narration streams in round N (visible) → `agent_step` resets `roundReplyText` and
  hides round N (D1) → round N+1 produces only a tool call or reasoning (empty reply) → `[DONE]`:
  `finalDisplay` is empty → `roundHolder.style.display='none'` (`:2904`). **Net: the whole turn shows
  no narration until/unless a DB reload runs.** The saved `full_response` still HAS the round-N prose
  (server saves the merged multi-round text), so on a later history reload it reappears — which is the
  exact "it came out, then went away (then maybe came back on refresh)" signature.
- **Mechanism:** buffer-reset race between the last-round-only final render and the multi-round server
  save. Same family as D1 (shares the L6b last-round assumption) but the *failure mode* is a fully
  blank turn rather than a single hidden intermediate bubble.
- **Single-window vs concurrent:** **SINGLE-WINDOW.**
- **Confidence:** MEDIUM-HIGH (depends on the model ending a turn on a tool/reasoning round with no
  trailing prose — common with `advanceGame`-terminal turns).
- **Falsifier:** a turn whose final agent round is a bare `advanceGame` with no closing narration; if
  the bubble stays populated at `[DONE]`, D2 is wrong.

### D3 — `softReloadHistory` ADR-0008 rebuild wipes an in-flight bubble that has no `data-db-id` yet (CONCURRENT)
- **Where:** `softReloadHistory` `chat.js:3655-3720`; divergence rebuild `box.innerHTML = ''` `:3707`;
  live-stream guard `if (hasActiveStream(sessionId)) {…return}` `:3701`; db-id stamping only on
  `message_saved` `:2136`; adopt/divergence both key on `.msg[data-db-id]` `:3679-3697`.
- **Lifecycle:** a peer device writes → server `session_events.publish(session,"run-started"/"message-added")`
  (`chat_routes.py:1368`,`:396`,`:1440`) → `sessionSync.js` `handle()` → `softReloadHistory(id)`.
  - The adopt pass and divergence check **only see bubbles that already carry `data-db-id`**. A locally
    streamed assistant bubble gets its `data-db-id` ONLY when `message_saved` arrives at the very END
    of the run (`:2136`). During the stream the bubble has **no** db-id.
  - The `hasActiveStream` guard (`:3701` / `:158-161`) defers the rebuild *while* `_streamSessionId ===
    sessionId`. But there is a **window after `_streamSessionId` is cleared and before the bubble is
    DB-id-stamped / a deferred reconcile fires** where a peer `message-added` can trigger the rebuild.
    `box.innerHTML = ''` then re-renders ONLY from `data.history`. If the just-finished local assistant
    message is not yet in the fetched `/api/history` payload (persistence/read lag, or a non-persisted
    empty-fallback turn), **the optimistic bubble is wiped and not replaced** → disappear.
- **Mechanism:** distributed-consistency + DOM-replace race. This is BOTH a transient bug (the bubble
  unmounts) AND a consistency bug (a concurrent peer write triggers a rebuild against a log snapshot
  that doesn't yet include the local write — read-your-writes violated for the in-flight, un-stamped
  bubble).
- **Single-window vs concurrent:** **CONCURRENT only** (requires a peer/second device or tab on the
  same canonical game session firing `run-started`/`message-added`). Matches the "happens on concurrent
  moments" half of the report.
- **Confidence:** MEDIUM. The `hasActiveStream` defer + the 120ms `scheduleReconcile` coalesce
  (`sessionSync.js:44-52`) + `flushPendingReconcile` narrow the window, but it is not provably closed —
  the db-id is stamped late and the divergence check is blind to un-stamped bubbles.
- **Falsifier:** two tabs on the one canonical game session; tab A mid-final-render (post-`_streamSessionId`-clear,
  pre-`message_saved`) while tab B's `message-added` lands. If tab A keeps its bubble through the rebuild,
  D3 is wrong. (Predicted: a narrow but real wipe window.)

### D4 — `resumeStream` "rich" path reloads from DB and replaces optimistic text with the DB version (or nothing) (CONCURRENT / re-entry)
- **Where:** `resumeStream` `chat.js:3742-3894`; rich-reload `:3889-3894`
  (`holder.remove(); selectSession(sessionId)` / `loadSessions()`).
- **Lifecycle:** on session re-entry / cross-device attach, `resumeStream` replays the buffer and
  streams live into a fresh `holder`. At end:
  - **Plain text, same session, non-empty** (`:3880-3886`): finalize in place from local `_combined()`.
    Safe.
  - **Rich (tools / multi-round — i.e. EVERY game turn) OR user moved on** (`:3889-3894`):
    `holder.remove()` then `selectSession(sessionId)` → **full DB reload**. The optimistic streamed text
    is discarded and replaced by the DB render. If the run is still finishing / not yet persisted, the
    reload shows the prior (shorter) state or nothing — the streamed text "goes away."
- **Mechanism:** deliberate paint-then-replace (optimistic → authoritative). Correct *when* the DB is
  already authoritative; a disappear when the reload races ahead of persistence, or when `rich` forces a
  reload for a game turn whose narration only existed in the live (now-removed) holder.
- **Single-window vs concurrent:** **CONCURRENT / re-entry** (triggered by `sessionSync.js:73-74`
  `run-started` → `resumeStream`, by `_checkServerStream` re-attach `sessions.js:2182-2237`, or by a
  device switching into a live game session). Not a plain single-window POST.
- **Confidence:** MEDIUM. Game turns are always `rich`, so they always take the reload-replace branch on
  resume — the disappear is gated on the persistence/reload timing only.
- **Falsifier:** attach via `/resume` to a live game turn and hold the DB write; if the bubble survives
  the `[DONE]` rich-reload, D4 is wrong.

### D5 — Mid-stream provider error ends the turn with `finish_reason:"error"` undetected; already-streamed prose is never re-shown after a hide (CONTRIBUTING)
- **Where:** OpenAI-compat stream loop `llm_core.py:1755-1979` (no `j.get("error")` /
  `finish_reason=="error"` branch); `_finish_reason` captured generically `:1786-1788`; agent loop acts
  only on `"length"` (`agent_loop.py:4461`); `_round_finish_reason=="error"` falls through `:3205-3209`.
- **Lifecycle:** provider streams partial tokens (visible), then sends an in-band error chunk with
  `choices[0].finish_reason=="error"`. The FE captures `_finish_reason="error"`, emits **no further
  delta and no `event: error`**, closes with a normal `[DONE]`. The agent loop does not surface it.
  - On its OWN, the already-streamed tokens REMAIN visible (the server save persists `full_response`
    with whatever streamed; `_empty_response_fallback` `agent_loop.py:2491-2512` even substitutes an
    error sentence when *nothing* streamed). So a bare mid-stream error is closer to "stops short" than
    "disappears."
  - **BUT** if that error-truncated prose landed in an **intermediate** round (D1) — model narrated a
    little, then the stream errored before the closing round — the narration is hidden by D1/D2 and,
    because the turn ends on an error with an empty closing reply, **never re-shown**. D5 is the trigger
    that converts a D1/D2 hide into a permanent disappear on the error path.
- **Mechanism:** stream-buffer / error-contract gap (conformance audit gap #1) compounding the D1/D2
  last-round-only render.
- **Single-window vs concurrent:** **SINGLE-WINDOW** (provider-driven; no peer needed). Also the
  "feels like wasted reasoning" report — reasoning tokens were spent, partial prose came out, then the
  turn ended blank with no error surfaced.
- **Confidence:** MEDIUM that it occurs; HIGH that, when it does, it is invisible to the user (no error
  affordance). LOW-MEDIUM that it is the *primary* report vs D1.
- **Falsifier:** inject a synthetic chunk `{"choices":[{"finish_reason":"error"}],"error":{...}}` after
  partial content; observe whether any `event: error` or Continue affordance appears (predicted: none),
  and whether the partial prose survives a closing-round hide (predicted: it does not if it was
  intermediate).

---

## Differential summary (what was RULED OUT as the cause)
- **Reasoning-in-body leak:** not happening — split is structural (`roundReplyText` vs
  `roundReasoningText`; `round_response` vs `round_reasoning`). Not a disappear cause.
- **`reasoning_details` strip** (`agent_loop.py:1237-1240`): causes redundant RE-reasoning, NOT
  visible-then-gone (per the reasoning-continuation audit #4). Out of scope for "disappear."
- **Background-stream `[DONE]` skip-final-render** (`chat.js:1372-1398`): backgrounded streams defer to
  `checkBackgroundStream` which relies on the DB reload — same persistence-timing exposure as D3/D4 but
  only when the user switched AWAY mid-stream; folded into D3/D4, not a distinct top cause.
- **CSS transitions / dropped frames:** none of the disappearances are CSS-driven; all are discrete
  `display:none` or `innerHTML=''`/`remove()` DOM operations (JS state machine), so this is not jank —
  it is correctness.

---

## Ranked verdict

| Rank | Cause | File:line | Window | Best-match to PO report |
|---|---|---|---|---|
| 1 | **D1** intermediate-round bubble painted then `display:none` (narrate-then-tool) | `chat.js:2169-2170`, `:2672-2673`; final `:2861` | SINGLE | **Yes — primary** |
| 2 | **D2** final render reads last round only → tool/empty closing round blanks turn | `chat.js:2861`, `:2896-2910`, resets `:2706-2707/2746-2747` | SINGLE | Yes (blank-turn variant) |
| 3 | **D3** `softReloadHistory` rebuild wipes un-`data-db-id` in-flight bubble | `chat.js:3707`, `:3701`, `:3679-3697`, `:2136` | CONCURRENT | Yes — concurrent half |
| 4 | **D4** `resumeStream` rich-path DB reload replaces optimistic text | `chat.js:3889-3894` | CONCURRENT / re-entry | Yes — concurrent half |
| 5 | **D5** mid-stream `finish_reason:"error"` undetected; converts a D1/D2 hide into permanent loss | `llm_core.py:1755-1979`, `agent_loop.py:4461` | SINGLE | Contributing |

**Single best match for "generates then disappears" (non-concurrent):** **D1** — the game build hides a
just-painted intermediate-round narration bubble the instant a tool call or new round follows, and the
last-round-only final render (D2) never brings it back when the turn ends on a tool/reasoning round.
The concurrent reports are **D3** (peer-triggered `innerHTML=''` rebuild over an un-stamped bubble) and
**D4** (resume rich-reload). **D5** is the provider-side trigger that makes a D1/D2 hide permanent and
silent.

> All findings are READ-ONLY observations. No remediation applied. Lifecycle frame/log capture
> (filmstrip + DOM mutation timestamps around `agent_step`/`tool_start`/`message_saved`/`message-added`)
> is the recommended next step to time-box D1's hide frame and D3/D4's wipe windows precisely.
