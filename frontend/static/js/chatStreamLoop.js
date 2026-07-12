// static/js/chatStreamLoop.js

/**
 * #1414 (R3 PR8): the FINAL extraction from the chat.js god-object (docs/REFACTOR-ROADMAP.md, R3),
 * building on PR0 (chatState.js) + PR1 (chatScrollEdges) + PR2 (chatSubmitButton) + PR3
 * (chatAttachments) + PR4 (chatWsSplice) + PR5 (chatMessageActions) + PR6 (chatOutbox) + PR7
 * (chatReconcile).
 *
 * SCOPE — PARTIAL BY DESIGN (behavior-preserving; the dispatch lift is DEFERRED). PR8's stated ideal
 * was to lift the whole `handleChatSubmit` SSE `while (true)` reader + its per-`json.type` dispatch
 * (~1,660 lines) into a `handleStreamEvent(json, ctx)` seam. That dispatch REASSIGNS ~30 per-turn
 * locals IN PLACE — `accumulated` / `roundText` / `roundReplyText` / `roundReasoningText`, `buffer`,
 * `isThinking` / `_thinkOpen` / `thinkingStartTime`, `_docFenceOpened` / `_docFenceContentStart`, the
 * `_liveThink*` DOM refs, the `_sources*`/`_findings*` box state, `metrics`, `currentToolBubble`,
 * `_sawMessageSaved` / `_producedVisibleOutput` / `_streamSawDone` / `_streamHadError`, … — and those
 * SAME locals are read/written by handleChatSubmit's SETUP block, by its ~700-line POST-loop
 * final-render block, AND by the nested `_renderStream` / `_commitRoundSegment` /
 * `_scheduleThinkingSpinner` closures. Lifting the dispatch is therefore impossible WITHOUT rewriting
 * essentially the entire function into `ctx.X` form — a rewrite of the turn orchestrator, NOT a
 * behavior-preserving MOVE, and precisely the "gamble the live stream" the roadmap warns against (a
 * single missed `accumulated` → `ctx.accumulated` conversion is a runtime break the source-pin gates
 * cannot see). So handleChatSubmit — the turn orchestrator, the SSE reader, the F8 two-buffer split,
 * the g15 tool-result seam, the truncation/`rounds_exhausted` Continue, `_renderStream` /
 * `_commitRoundSegment` — ALL stay in chat.js. This module takes only the SEVERABLE, self-contained
 * stream-presentation helpers that carry NO per-turn closure and NO source-pinned invariant. The
 * remaining dispatch lift is left to a follow-up (see the #1414 PR8 report).
 *
 * Moved VERBATIM from chat.js (logic unchanged):
 *   - `_ensureStreamLayout(body)` — ensure/return the stable `.stream-content` div inside a bubble
 *       body (the streaming render target). Pure DOM.
 *   - `_toolLabels` — the tool-name → quiet-production-beat label map ("Searching" / "Running" /
 *       "Remembering" …); also read by chat.js's tool_start handler, so it is imported back there.
 *   - `_thinkingLabel(lastToolName)` — pick the spinner label for the current tool. It now takes
 *       `lastToolName` as an ARGUMENT (chat.js passes its `_lastToolName` local) instead of closing
 *       over it — byte-identical output, just an explicit parameter.
 *   - `_showThinkingSpinner(label)` — mount the transient `.agent-thinking-dots` spinner bubble.
 *
 * These are pure / DOM-only (deps: `uiModule`, `spinnerModule`, and `document`) — they touch NO
 * chat.js-internal mutable state, so — unlike PR2..PR7 — there is NO `_setStreamLoopDeps` injector to
 * wire (there is nothing to inject). chat.js imports the four names back and calls them exactly as
 * before: `_scheduleThinkingSpinner` (which STAYS in chat.js, since it owns a per-turn timer) calls
 * `_showThinkingSpinner(_thinkingLabel(_lastToolName))`; the delta/tool handlers call
 * `_ensureStreamLayout(...)` and index `_toolLabels[...]`. None of the four are on the `chatModule`
 * public API and none are called cross-file (grep of static/js confirms), so there is no re-export.
 *
 * Dual-load idempotent (#1399 generalized): no module-level timers/listeners/caches; imported BY
 * chat.js only (never app.js / an html shell), so the single-eval invariant holds.
 */

import uiModule from './ui.js';
import spinnerModule from './spinner.js';

// ── stream render target ──────────────────────────────────────────────────────────────────
/** Ensure a stable `.stream-content` div exists inside the bubble `body` and return it (the live
 * streaming text renders into it). Idempotent — returns the existing div if already present. */
export function _ensureStreamLayout(body) {
  if (!body) return body;
  // Sources are deferred to final render — don't insert during streaming
  // Ensure a stable content div exists for text content
  var contentDiv = body.querySelector('.stream-content');
  if (!contentDiv) {
    contentDiv = document.createElement('div');
    contentDiv.className = 'stream-content';
    body.appendChild(contentDiv);
  }
  return contentDiv;
}

// ── tool-aware thinking spinner ───────────────────────────────────────────────────────────
const _searchIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="vertical-align:-2px;margin-right:4px"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
// C14 (immersion): the Big Brother engine tools render as quiet production
// beats — a label, never raw camelCase names or JSON payloads in the player's
// transcript. Applies wherever these names appear (they exist only in the game).
export const _toolLabels = {
  'web_search': _searchIcon + 'Searching',
  'bash': 'Running',
  'python': 'Running',
  'create_document': 'Writing',
  'update_document': 'Writing',
  'read_document': 'Reading',
  'edit_file': 'Editing',
  'read_file': 'Reading',
  'write_file': 'Writing',
  'list_files': 'Browsing',
  'image_gen': 'Generating',
  'generate_image': 'Generating',
  'manage_memory': 'Remembering',
  'save_memory': 'Remembering',
  'search_memory': 'Recalling',
  'manage_session': 'Organizing',
  'deep_research': 'Researching',
  'list_models': 'Browsing',
  'ui_control': 'Adjusting',
};

/** Pick the spinner label for the currently-running tool (`lastToolName`, chat.js's `_lastToolName`).
 * Falls back to 'Thinking' when there is no tool or no match. Exact match first, then a loose
 * prefix/substring match against the label map. Byte-identical to the pre-PR8 closure form. */
export function _thinkingLabel(lastToolName) {
  if (!lastToolName) {
    return 'Thinking';
  }
  // Check exact match first, then prefix match
  const lower = lastToolName.toLowerCase();
  if (_toolLabels[lower]) return _toolLabels[lower];
  for (const [key, label] of Object.entries(_toolLabels)) {
    if (lower.includes(key) || key.includes(lower)) return label;
  }
  return 'Thinking';
}

/** Mount the transient `.agent-thinking-dots` spinner bubble at the bottom of #chat-history.
 * No-op if one is already present. */
export function _showThinkingSpinner(label) {
  if (document.querySelector('.agent-thinking-dots')) return;
  const _thinkMsg = document.createElement('div');
  _thinkMsg.className = 'msg msg-ai agent-thinking-dots';
  const _thinkBody = document.createElement('div');
  _thinkBody.className = 'body';
  const _ts = spinnerModule.create(label || 'Thinking', 'right', 'wave');
  _thinkBody.appendChild(_ts.createElement());
  _ts.start(120);
  _thinkMsg._spinner = _ts;
  _thinkMsg.appendChild(_thinkBody);
  document.getElementById('chat-history').appendChild(_thinkMsg);
  uiModule.scrollHistory();
}
