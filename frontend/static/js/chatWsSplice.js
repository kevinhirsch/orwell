// static/js/chatWsSplice.js

/**
 * #1414 (R3 PR4): the WebSocket Phase-1 chat live-splice cluster (ADR 0017 /
 * websocket-phase1-protocol.md §3).
 *
 * The next extraction from the chat.js god-object (docs/REFACTOR-ROADMAP.md, R3), building on
 * PR0 (chatState.js) + PR1 (chatScrollEdges.js) + PR2 (chatSubmitButton.js) + PR3
 * (chatAttachments.js). Moved VERBATIM from chat.js — behavior-preserving, no logic change:
 *   - _wsChatActive() — is the socket live? (dormant when the flag is off).
 *   - _wsResetRound() / _wsPinRound(round) — the per-run live-render round lifecycle.
 *   - _wsEnsureRound() — lazily mount/find the live WS bubble to render inbound frames into.
 *   - _onWsChatFrame(frame) — the persistent inbound consumer for `chat` `event` frames.
 *   - _wsRegisterChat() — register the consumer with OrwellWs once it is available.
 *
 * This cluster was already isolated behind `_wsRegisterChat` in chat.js; it holds ONE inbound
 * consumer and the transient live-render round state (`_wsRound`/`_wsRichRun`) — both module-
 * local here. The only cross-cluster hand-off is the SENDER's up-frame pin: chat.js's
 * handleChatSubmit creates the streaming holder, then pins it as the WS render target. An ES
 * imported binding is read-only, so chat.js calls `_wsPinRound({...})` here instead of
 * reassigning `_wsRound` directly (the SSE observer/peer path still mounts its own holder via
 * `_wsEnsureRound`).
 *
 * Deps that STAY in chat.js and are read here through an injected resolver (the same
 * `_setOutboxDispatch` / `_setAttachmentsApiBase` pattern as PR2/PR3 — chat.js calls
 * `_setWsSpliceDeps({...})` once at module-eval):
 *   - `_renderLiveStream` — the SHARED incremental renderer (ADR 0015 / R2 render seam). NOT a
 *     second engine; the socket path renders through the exact same function the SSE path uses.
 *     It lives in chat.js (the R2 seam) — inject, never move.
 *   - `softReloadHistory` — the idempotent, seq-aware settle reconcile (the reconcile cluster,
 *     a later R3 PR) — inject.
 *   - `_senderLabel` — the SINGLE SOURCE for an AI message's sender label (game build ⇒ the
 *     narrator, never the raw model). Inject so the single-source contract holds.
 * `chatState._streamSessionId` (the active-stream lock) is read/written through the shared
 * chatState singleton (PR0). `_shortModel` and the incremental renderer's markdown come from
 * importable modules (chatRenderer / markdown).
 *
 * chat.js imports the four call points it still drives (`_wsChatActive`, `_wsResetRound`,
 * `_wsPinRound`, `_wsRegisterChat`) plus `_setWsSpliceDeps`, and keeps the boot registration
 * (`window.OrwellWs ? _wsRegisterChat() : addEventListener('orwell:ws-ready', …)`) at its own
 * init site exactly as before. None of these functions are on the `chatModule` public API and
 * none are called cross-file, so the export object stays byte-identical.
 *
 * Dual-load idempotent (#1399 generalized): the only module-level mutable state is the transient
 * live-render round (`_wsRound`/`_wsRichRun`), set only during an active WS stream; a second
 * evaluation would start a fresh null round, which is harmless (the same stance as the sibling
 * modules). Imported BY chat.js only (never app.js / an html shell), so there is a single module
 * record in practice.
 */

import sessionModule from './sessions.js';
import uiModule from './ui.js';
import markdownModule from './markdown.js';
import chatRenderer from './chatRenderer.js';
import { chatState } from './chatState.js';

// shortModel is a chatRenderer helper (same binding chat.js uses).
const _shortModel = chatRenderer.shortModel;

// ── chat.js-internal deps injected at module-eval (see the header) ────────────────
// _renderLiveStream (R2 render seam) + softReloadHistory (reconcile) + _senderLabel
// (the single-source sender label) all stay in chat.js; chat.js injects them through
// `_setWsSpliceDeps`. Safe no-op defaults keep a bare test import inert.
let _renderLiveStream = () => {};
let _softReloadHistory = async () => {};
let _senderLabel = (modelLabel) => (modelLabel || '');
export function _setWsSpliceDeps(deps) {
  if (!deps) return;
  if (deps.renderLiveStream) _renderLiveStream = deps.renderLiveStream;
  if (deps.softReloadHistory) _softReloadHistory = deps.softReloadHistory;
  if (deps.senderLabel) _senderLabel = deps.senderLabel;
}

// ── WebSocket Phase-1 chat splice (ADR 0017 / websocket-phase1-protocol.md §3) ──
//
// When OrwellWs is live, the player's turn goes UP as a `turn` frame (the reroute in
// handleChatSubmit) and the reply comes back as `chat` `event` frames — the SAME
// replay-then-tail broadcast both the sender and a peer window receive. We render
// those frames through the SAME shared incremental renderer the SSE path uses
// (`_renderLiveStream` → `createStreamRenderer`, ADR 0015) — NOT a second engine —
// and we keep the reasoning split VERBATIM (§3.4): a delta with `d.thinking` truthy
// lands in the reasoning accordion, never the public reply body.  This is the exact
// `roundReplyText`/`roundReasoningText` contract, socket-side.
//
// Dormant when the flag is off (`isActive()` false): the fetch/SSE path stays
// byte-identical, so F1–F5, g15, and the reasoning-scrub gate are untouched. Full
// live finalize/dedup runs after the server route (claude/ws-phase1-server) lands.
export function _wsChatActive() {
  try { return !!(window.OrwellWs && window.OrwellWs.isActive && window.OrwellWs.isActive()); }
  catch (_) { return false; }
}

// The live WS round render target. When the sender fires a turn we pin its
// already-created streaming holder here (via _wsPinRound) so the inbound consumer renders into
// it — the sender's own turn. A peer/observer window has no pinned holder and mounts
// its own live bubble, exactly as resumeStream does for the SSE mirror.
let _wsRound = null;   // { holder, contentDiv, state, reply, reasoning, sessionId, clientMsgId, _spinner }
// Is the CURRENT run tool-rich (multi-round)? A rich run's narration spans N rounds that history
// reconstructs as N bubbles (chatRenderer "Agent multi-bubble reconstruction"), so its ONE live WS
// holder must never be adopted at settle — it would keep round 1..N merged in a single bubble
// beside (or in place of) the reconstruction, the mirror-toolturn divergence. Same contract as the
// SSE observer's rich resume (resumeStream rich=true: discard the live holder, reload). Reset per
// run at `done` (frames arrive in run order, `done` last).
let _wsRichRun = false;
const _wsLiveRender = (t) => markdownModule.processWithThinking(markdownModule.squashOutsideCode(t));
export function _wsResetRound() { _wsRound = null; _wsRichRun = false; }

// Pin the sender's already-created streaming holder as the live WS render target. chat.js's
// handleChatSubmit calls this (an ES imported binding is read-only, so it can't reassign _wsRound
// itself). The inbound consumer then renders reply frames into the pinned holder and runs the
// settle on `done`.
export function _wsPinRound(round) { _wsRound = round; }

export function _wsEnsureRound() {
  if (_wsRound && _wsRound.holder && _wsRound.holder.isConnected) return _wsRound;
  const box = document.getElementById('chat-history');
  if (!box) return null;
  const holder = document.createElement('div');
  holder.className = 'msg msg-ai';
  const roleLabel = _senderLabel(_shortModel(sessionModule.getCurrentModel && sessionModule.getCurrentModel()));
  const roleTs = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  holder.innerHTML = '<div class="role">' + uiModule.esc(roleLabel) +
    ' <span class="role-timestamp">' + roleTs + '</span></div>' +
    '<div class="body"><div class="stream-content"></div></div>';
  box.appendChild(holder);
  _wsRound = { holder: holder, contentDiv: holder.querySelector('.stream-content'),
               state: {}, reply: '', reasoning: '',
               sessionId: (sessionModule.getCurrentSessionId && sessionModule.getCurrentSessionId()) || null };
  uiModule.scrollHistory();
  return _wsRound;
}

// The persistent inbound consumer — registered ONCE, drives every `chat` event frame.
export function _onWsChatFrame(frame) {
  const d = (frame && frame.d) || {};
  // A tool/agent-round marker ⇒ this run is RICH (multi-round). The WS splice renders the whole
  // run into one holder (it has no per-round bubble machinery), so flag it — the `done` branch
  // discards the merged holder and lets softReloadHistory rebuild the N-bubble reconstruction.
  if (d.type === 'agent_step' || d.type === 'tool_start' || d.type === 'tool_output' || d.type === 'tool_progress') {
    _wsRichRun = true;
    return;
  }
  if (typeof d.delta === 'string') {
    const round = _wsEnsureRound();
    if (!round) return;
    if (round._spinner) { try { round._spinner.destroy(); } catch (_) {} round._spinner = null; }
    // The reasoning CHANNEL SPLIT is sacred (§3.4): thinking → the accordion, the
    // clean reply → the body. `_renderLiveStream` places reasoning in a default-
    // collapsed `.thinking-section` and the reply in `.live-reply-content` — reasoning
    // can NEVER paint in the public reply container, by construction.
    if (d.thinking) round.reasoning += d.delta;
    else            round.reply += d.delta;
    _renderLiveStream(round.contentDiv, round.reply, round.reasoning, _wsLiveRender, round.state, round.holder);
    return;
  }
  if (d.type === 'message_saved') {
    // Stamp the server db id so the settle reconcile adopts THIS bubble with zero
    // churn (mirrors resumeStream's savedDbId — no db-id-less duplicate).
    if (_wsRound && _wsRound.holder && d.id != null) _wsRound.holder.dataset.dbId = String(d.id);
    return;
  }
  if (d.done) {
    // Terminal sentinel (maps `[DONE]`, §3.2). Release the live holder and run the
    // settle reconcile from history — the SAME idempotent, seq-aware softReloadHistory
    // the SSE path settles through; it adopts the streamed bubble by {id, seq}.
    const round = _wsRound;
    const rich = _wsRichRun;
    const sid = (round && round.sessionId) ||
                (window.OrwellWs && window.OrwellWs.canonicalId && window.OrwellWs.canonicalId()) ||
                (sessionModule.getCurrentSessionId && sessionModule.getCurrentSessionId());
    if (round && round._spinner) { try { round._spinner.destroy(); } catch (_) {} }
    // A RICH (multi-round) run's live holder holds rounds 1..N MERGED — never adoptable (history
    // reconstructs the turn as N bubbles). Discard it; the reload below rebuilds the real shape.
    // Mirrors the SSE observer's rich resume contract (mirror-toolturn parity, #1087).
    if (rich && round && round.holder) { try { round.holder.remove(); } catch (_) {} }
    _wsResetRound();
    if (sid && chatState._streamSessionId === sid) chatState._streamSessionId = null; // release the active-stream lock
    if (sid) { try { _softReloadHistory(sid); } catch (_) {} }
    return;
  }
}

export function _wsRegisterChat() {
  try { if (window.OrwellWs && window.OrwellWs.onFrame) window.OrwellWs.onFrame('chat', _onWsChatFrame); }
  catch (_) {}
}
