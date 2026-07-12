// static/js/chatSubmitButton.js

/**
 * #1414 (R3 PR2): the composer submit-button state machine (#971 / #986 button reconciler).
 *
 * The next leaf extraction from the chat.js god-object (docs/REFACTOR-ROADMAP.md, R3),
 * building on PR0 (chatState.js) + PR1 (chatScrollEdges.js). Moved VERBATIM from chat.js —
 * behavior-preserving, no logic change:
 *   - updateSubmitButton(state, submitBtn) — paint the Stop (streaming) / Send (idle) face.
 *   - _foregroundStreamLive() — the single truth for "a turn is genuinely streaming into the
 *     session the user is looking at right now".
 *   - _syncSubmitButtonState() — reconcile the button to that truth (#971 desync fix).
 *
 * These read/write the CROSS-CLUSTER streaming single-flight state (isStreaming, currentAbort,
 * _streamSessionId, _backgroundStreams), so they operate on the shared `chatState` singleton
 * (PR0) — NOT a module-local copy — which is what lets the submit path, the stream loop, and
 * the outbox all resolve to the SAME flags. They also read the current session id
 * (sessionModule) and the composer element (uiModule).
 *
 * chat.js imports these three and calls them exactly as before, and re-exports the two that
 * are on the `chatModule` public API (_syncSubmitButtonState, _foregroundStreamLive — the #971
 * browser gate) so the export object stays byte-identical. `_inProgressLabel` (#986) is NOT
 * moved here: it is used at four spinner-create sites across chat.js (not exclusively by the
 * button machine) and depends on the label helpers, so it stays in chat.js.
 *
 * Dual-load idempotent (#1399 generalized): pure functions over the shared singleton + the DOM —
 * no module-level mutable state of its own, so a second evaluation is harmless. Imported BY
 * chat.js only (never app.js / an html shell), so there is a single module record in practice.
 */

import uiModule from './ui.js';
import sessionModule from './sessions.js';
import { chatState } from './chatState.js';

/**
 * Update submit button state
 */
export function updateSubmitButton(state, submitBtn) {
  if (!submitBtn) return;

  if (state === 'streaming') {
    // Clear any pending transitions from + → arrow swap
    submitBtn.classList.remove('anim-spin', 'anim-spin-swap', 'anim-land', 'mic-mode', 'newchat-mode', 'newchat-expanded', 'recording');
    // Ensure arrow icon is showing before launch
    var icons = window._orwellBtnIcons;
    if (icons) submitBtn.innerHTML = icons.send;
    void submitBtn.offsetWidth;
    // Arrow launches up, then stop icon lands in
    submitBtn.classList.add('anim-launch');
    const _stopSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
    // Wait for the launch keyframe to finish (0.3s) before swapping the
    // arrow out for the stop icon — otherwise the swap happens mid-flight
    // and the user sees nothing fly out.
    setTimeout(() => {
      submitBtn.innerHTML = _stopSvg;
      submitBtn.classList.remove('anim-launch');
      void submitBtn.offsetWidth;
      submitBtn.classList.add('anim-land');
      submitBtn.addEventListener('animationend', () => submitBtn.classList.remove('anim-land'), { once: true });
    }, 300);
    submitBtn.title = 'Stop generation';
    submitBtn.dataset.mode = 'streaming';
    submitBtn.dataset.phase = 'processing';
    chatState.isStreaming = true;
  } else if (state === 'idle') {
    submitBtn.dataset.mode = '';
    delete submitBtn.dataset.phase;
    submitBtn.classList.remove('recording');
    chatState.isStreaming = false;
    // Defer to global updater which handles mic/newchat/send modes
    if (window._updateSendBtnIcon) {
      setTimeout(window._updateSendBtnIcon, 50);
    } else {
      var icons = window._orwellBtnIcons;
      submitBtn.innerHTML = icons ? icons.send : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
      submitBtn.title = 'Send message';
      submitBtn.classList.remove('mic-mode', 'newchat-mode');
    }
  }
}

// #971 — RECONCILE the composer button to the TRUE streaming state. The button is a state machine
// (Stop while streaming → Send/upload-file when idle, the latter via _updateSendBtnIcon's mic/
// newchat/send modes). It DESYNCS when a stream settles on a path that never calls
// updateSubmitButton('idle') — the chief offender is a BACKGROUNDED stream finishing (the
// `_isBgFinally` branch skips the idle reset), which strands `isStreaming = true` +
// `dataset.mode = 'streaming'`; the global `_updateSendBtnIcon` then early-returns on that stale
// 'streaming' mode and NEVER recovers, so the button is stuck on Stop even though nothing is
// streaming in the foreground. (The Enter/keydown SEND path is unaffected — it reads the live text,
// not the button — which is why "Enter still sends" while the button lies.)
//
// `_foregroundStreamLive()` is the single source of truth for "a turn is genuinely streaming into the
// session the user is looking at RIGHT NOW": isStreaming + a live reader (currentAbort) + we are on
// the streaming session and it is NOT detached to the background. Compose with #993: a non-empty
// composer while that is true should still read as SEND (the queue enqueues — it is NOT a Stop), so
// the button only shows Stop for a live foreground stream with an EMPTY composer; otherwise the
// global updater paints send/upload/mic from the composer/attachment state.
export function _foregroundStreamLive() {
  if (!chatState.isStreaming || !chatState.currentAbort) return false;
  try {
    const cur = sessionModule.getCurrentSessionId && sessionModule.getCurrentSessionId();
    if (cur != null && chatState._streamSessionId != null && cur !== chatState._streamSessionId) return false;
    if (chatState._streamSessionId != null && chatState._backgroundStreams.has(chatState._streamSessionId)) return false;
  } catch (_) {}
  return true;
}
export function _syncSubmitButtonState() {
  const submitBtn = document.querySelector('.send-btn') || document.getElementById('submit');
  if (!submitBtn) return;
  const live = _foregroundStreamLive();
  if (live) {
    // A turn is genuinely streaming in the foreground. The button shows Stop ONLY when the composer
    // is empty; with text it stays a Send affordance (#993 enqueues — never a silent Stop-and-drop).
    const _mi = uiModule.el('message');
    const hasText = !!(_mi && (_mi.value || '').trim().length > 0);
    if (!hasText) {
      if (submitBtn.dataset.mode !== 'streaming') updateSubmitButton('streaming', submitBtn);
    } else if (submitBtn.dataset.mode === 'streaming') {
      // Text was typed while a foreground stream runs: drop the Stop face, show Send, but DON'T flip
      // the live `isStreaming` flag — clear only the button mode so _updateSendBtnIcon can repaint.
      submitBtn.dataset.mode = '';
      if (window._updateSendBtnIcon) window._updateSendBtnIcon();
    }
    return;
  }
  // Not streaming in the foreground. If the button is stuck on the Stop face (a backgrounded/settled
  // stream left it there), clear the stale flag+mode and let the global updater repaint send/upload/
  // mic from the live composer/attachment state.
  if (chatState.isStreaming) chatState.isStreaming = false;
  if (submitBtn.dataset.mode === 'streaming') {
    submitBtn.dataset.mode = '';
    delete submitBtn.dataset.phase;
    submitBtn.classList.remove('recording', 'anim-launch', 'anim-land');
  }
  if (window._updateSendBtnIcon) window._updateSendBtnIcon();
}
