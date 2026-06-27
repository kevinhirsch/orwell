// static/js/chat.js

/**
 * Main chat functionality - message handling and streaming
 */
// ES6 module — IIFE removed

import Storage from './storage.js';
import uiModule from './ui.js';
import sessionModule from './sessions.js';
import chatRenderer from './chatRenderer.js';
import chatStream from './chatStream.js';
import { ORWELL_TOOL_BEATS as _orwellToolBeats, orwellBeatOutcome, isGameBuild, orwellBeatIsSilent, ORWELL_MAX_VISIBLE_BEATS } from './orwellToolBeats.js';
import { addAITTSButton } from './tts-ai.js';
import markdownModule from './markdown.js';
import { svgifyEmoji } from './markdown.js';
import planWindowModule from './planWindow.js';
import spinnerModule from './spinner.js';
import presetsModule from './presets.js';
import fileHandlerModule from './fileHandler.js';
import codeRunnerModule from './codeRunner.js';
import slashCommands, { initSlashCommands, isCommand, handleSlashCommand, handleSetupInput, handleSetupWizard, typewriterInto } from './slashCommands.js';
// Game build (feature 0032): workspace verticals removed — null stubs for guarded usage sites.
const searchModule = null, documentModule = null, emailInbox = null, createResearchSynapse = null;
import { createStreamRenderer } from './streamingRenderer.js';
import { isNarrow } from './platform.js';
  const RESEARCH_TIMEOUT_MS = 360000;
  const DEFAULT_TIMEOUT_MS = 120000;
  const RESEARCH_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>';

  let API_BASE = '';
  let currentAbort = null;
  let isStreaming = false;
  let _sendInFlight = false;   // covers the window from click → streaming start
  let _displayOverride = null; // Override visible user bubble text (hides injected prompts)
  let _hideUserBubble = false; // Skip user bubble entirely (e.g. continue after stop)
  let _pendingContinue = null; // Stores the stopped AI element to merge with new response
  // ── Auto-recovery: when a turn's stream silently dies (connection drop) or
  // goes quiet while the connection is alive, re-engage the model with a
  // completion handshake instead of leaving it hung. Capped so it can't loop.
  let _autoNudges = 0;             // handshakes fired for the CURRENT user turn
  let _autoContinuePending = false; // marks the next submit as an auto-continue (don't reset the counter)
  const _AUTO_NUDGE_CAP = 3;

  // ── #985 P2-A: the SEND OUTBOX ──────────────────────────────────────────────
  // A message the player sends WHILE a turn is streaming must NOT be silently dropped (the old
  // `isStreaming → Stop` branch aborted the reply and `return`ed before the new text was ever read).
  // The owner's ruling was "Queue it": enqueue the new message into this in-memory FIFO, paint its
  // optimistic bubble immediately (composes with #992 render-by-seq — a pending bubble carries a
  // clientMsgId, NO dbId/seq, so it floats to the tail until its seq lands), clear the composer (the
  // text is now safely captured here, not lost), and flush the queue IN ORDER the moment the current
  // turn settles — one in flight at a time, mirroring the engine's server-side `_framed` serialization.
  // Idempotent + multibrowser-safe: each item is keyed by its `clientMsgId`, which the existing
  // optimistic-adopt path reconciles by, so a flush is at-most-once and reconciles cleanly across
  // windows (sends target the canonical session per #990, render by seq per #992, mirror per #991).
  // Items: { clientMsgId, text, bubbleEl }. STOP is reserved for the explicit Stop button / an EMPTY
  // composer — "stop the current reply" and "send a new message" are no longer collapsed onto one
  // silent action. In-memory only (reload-durable IndexedDB outbox is a #891 follow-up, see the PR note).
  const _sendOutbox = [];
  let _flushingOutbox = false;     // re-entrancy guard so only one flush send is dispatched at a time

  // shortModel and modelColor are now in chatRenderer.js
  var _shortModel = chatRenderer.shortModel;
  var _modelRouteLabel = chatRenderer.modelRouteLabel;
  var _sameModelName = chatRenderer.sameModelName;
  var _applyModelColor = chatRenderer.applyModelColor;
  // C14/immersion: the single source for an AI message's SENDER label. In the game build the
  // narrator is the show ("Orwell"), never the raw LLM model name — used at every
  // placeholder / resume / continuation site so the model machinery stays invisible to the
  // player (mirrors _setRoleModelLabel for the resolved-model path).
  function _senderLabel(modelLabel) {
    return isGameBuild() ? 'Orwell' : (modelLabel || '');
  }
  // J1-30 (immersion): the pre-token wait — most visible right after the player's first deliberate
  // action ("Start casting"), where a generic "Processing request…" reads as lag/OOC. In the game
  // build, dress the GENERIC waiting stages in a production voice so the gap feels like the show
  // rolling, not the app stalling. Endpoint-DIAGNOSTIC states (online/offline/latency/countdown)
  // stay literal — they are operator truth a player rarely sees and must not be fictionalised.
  function _waitLabel(stage, fallback) {
    if (!isGameBuild()) return fallback;
    switch (stage) {
      case 'init':    return 'The producers are rolling';
      case 'waiting': return 'The producers are talking it over';
      case 'still':   return 'The producers are still deliberating';
      default:        return fallback;
    }
  }
  // #986 — the ONE in-progress ("model is generating a response") spinner label, so it reads in the
  // same in-character "producers" voice across EVERY spinner-create site: the initial send, a
  // continuation round, a resumeStream re-attach, and a background re-entry. Before this, only the
  // initial-send site dressed its label through `_waitLabel`; the other three hard-coded "Generating
  // response" / "Response streaming in background", so two windows watching the same run showed
  // divergent labels. Routes through `_waitLabel('waiting', …)`, inheriting its game-build/non-game
  // behavior (fail-open to the generic fallback outside the game build).
  function _inProgressLabel(fallback) {
    return _waitLabel('waiting', fallback || 'Generating response');
  }
  function _setRoleModelLabel(roleEl, requestedModel, actualModel, opts) {
    if (!roleEl) return;
    opts = opts || {};
    const tsSpan = roleEl.querySelector('.role-timestamp');
    const req = requestedModel || actualModel || '';
    const actual = actualModel || requestedModel || '';
    let label = _modelRouteLabel(req, actual);
    if (opts.suffix) label += ' (' + opts.suffix + ')';
    if (opts.characterName) label = opts.characterName;
    // C14/immersion: the player must never see the raw LLM model name as the sender —
    // in the game build the narrator IS the show. Use a diegetic label unless a specific
    // speaker name was supplied.
    else if (document.body.hasAttribute('data-game-build')) label = 'Orwell';
    roleEl.textContent = label + ' ';
    _applyModelColor(roleEl, actual || req);
    // C14/immersion: the raw "alias -> dated-version" model string must never reach the
    // player in the game build — not as the sender label and not as the hover tooltip.
    if (isGameBuild()) {
      roleEl.removeAttribute('title');
    } else if (req && actual && !_sameModelName(req, actual)) {
      roleEl.title = req + ' -> ' + actual + (opts.reason ? ': ' + opts.reason : '');
    } else if (!opts.reason) {
      roleEl.removeAttribute('title');
    }
    if (tsSpan) roleEl.appendChild(tsSpan);
  }
  // Per-session research tracking (supports concurrent research across sessions)
  const _researchingStreamIds = new Set();
  let _researchTimerEl = null, _researchTimerInterval = null;
  let _researchStartTime = 0, _researchAvgDuration = null;
  let _researchSynapse = null;
  function _clearResearchTimer() {
    if (_researchTimerInterval) { clearInterval(_researchTimerInterval); _researchTimerInterval = null; }
    if (_researchTimerEl) { _researchTimerEl.remove(); _researchTimerEl = null; }
    if (_researchSynapse) {
      // Mark complete first so the user briefly sees the "done" state,
      // then tear it down on next tick.
      try { _researchSynapse.complete(); } catch {}
      const s = _researchSynapse;
      _researchSynapse = null;
      setTimeout(() => { try { s.destroy(); } catch {} }, 800);
    }
    _researchStartTime = 0;
    _researchAvgDuration = null;
  }

  /** Append a "Generate Visual Report" button — delegates to chatRenderer. */
  function _appendViewReportLink(msgEl, sessionId) {
    const body = msgEl.querySelector('.body');
    if (body) chatRenderer.appendReportButton(body, sessionId);
  }
  let currentAccumulated = ''; // Track accumulated text across function scope
  let currentHolder = null; // Track current message holder
  let currentSpinner = null; // Track current spinner for stop cleanup

  // Background streaming support
  const _backgroundStreams = new Map(); // sessionId -> { status, accumulated, sourcesHtml, abortCtrl, query, metrics }
  const _resumingStreams = new Set();   // sessionId -> a resumeStream() reader is live (re-attach lock)
  let _streamSessionId = null; // Session ID for the currently active reader loop
  let _lastReaderActivity = 0; // Timestamp of last reader.read() success — used to detect frozen streams
  let _webLockRelease = null;  // Function to release the Web Lock held during streaming
  let _forcePlanOff = false;   // One-shot: suppress plan_mode for the next send (Approve & Run)

  // ── Plan store: the latest proposed/approved checklist for the CURRENT chat ──
  // Kept so (a) it can be sent back each turn and pinned in context (a long plan
  // on a weak model survives history truncation), and (b) the plan window can be
  // re-opened/docked at any time via the plan-button menu. Stored per session in
  // localStorage so it survives a reload mid-execution.
  function _setStoredPlan(text) {
    const sid = sessionModule.getCurrentSessionId();
    if (!sid || !text || !text.trim()) return;
    Storage.setJSON(Storage.KEYS.PLAN, { sid, text });
    // Live-refresh the plan window if it's open (shows progress as the agent
    // restates the checklist with [x]).
    try {
      if (planWindowModule.isPlanWindowOpen && planWindowModule.isPlanWindowOpen()) {
        planWindowModule.openPlanWindow(text, null);
      }
    } catch (_) {}
  }
  function _getStoredPlan() {
    const sid = sessionModule.getCurrentSessionId();
    const rec = Storage.getJSON(Storage.KEYS.PLAN, null);
    return (rec && rec.sid === sid && rec.text) ? rec.text : '';
  }
  // A line like "- [ ] step" / "- [x] step" marks a GitHub-style checklist.
  const _CHECKLIST_RE = /^\s*[-*]\s+\[[ xX]\]\s+/m;
  // Exposed for app.js (plan-button menu) — re-open the stored plan window.
  window._getStoredPlan = _getStoredPlan;
  window.planWindowModule = planWindowModule;

  /** Check if an SSE reader is still actively connected for a session. */
  function hasActiveStream(sessionId) {
    return _streamSessionId === sessionId || _backgroundStreams.has(sessionId) ||
           _resumingStreams.has(sessionId);
  }

  /** ADR 0012 §2.2: stamp a live bubble's role-timestamp from the SERVER-minted ISO time (carried on
   * the message_saved event) so every window renders the identical time string — replacing the
   * speculative client `new Date()` the bubble was created with. Formats identically to
   * chatRenderer.roleTimestamp (the history-reload path) so the live bubble and the settled/reloaded
   * bubble read the same. Best-effort: a bad/absent value leaves the existing placeholder intact. */
  function _applyServerTimestamp(holderEl, iso) {
    try {
      if (!holderEl || !iso) return;
      var span = holderEl.querySelector('.role-timestamp');
      if (!span) return;
      var d = new Date(iso);
      if (isNaN(d.getTime())) return;
      span.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      span.title = d.toLocaleString();
    } catch (_) {}
  }

  // Sources box builder and toggleSources are now in chatRenderer.js
  var _buildSourcesBox = chatRenderer.buildSourcesBox;

  // Browser notifications now in chatStream.js
  var _notifyResearchComplete = chatStream.notifyResearchComplete;

  // Model/image pricing, _buildImageBubble now in chatRenderer.js
  var _buildImageBubble = chatRenderer.buildImageBubble;
  var getModelCost = chatRenderer.getModelCost;
  var getImageCost = chatRenderer.getImageCost;

  // stripToolBlocks and roleTimestamp now in chatRenderer.js
  var stripToolBlocks = chatRenderer.stripToolBlocks;

  function _normalizeEndpointForCompare(url) {
    if (!url) return '';
    try {
      const u = new URL(String(url), window.location.origin);
      let path = u.pathname.replace(/\/+$/, '');
      const suffixes = [
        '/v1/chat/completions', '/chat/completions',
        '/v1/completions', '/completions',
        '/v1/messages', '/messages',
        '/v1/models', '/models',
      ];
      for (const suffix of suffixes) {
        if (path.toLowerCase().endsWith(suffix)) {
          path = path.slice(0, -suffix.length).replace(/\/+$/, '');
          break;
        }
      }
      return (u.origin + path).toLowerCase();
    } catch (_) {
      return String(url).trim().replace(/\/+$/, '').toLowerCase();
    }
  }

  async function _probeCurrentEndpointStatus(endpointUrl, signal) {
    const target = _normalizeEndpointForCompare(endpointUrl);
    if (!target) return null;
    const modelsRes = await fetch(`${API_BASE}/api/models`, { credentials: 'same-origin', signal });
    if (!modelsRes.ok) return null;
    const modelsData = await modelsRes.json().catch(() => ({}));
    const item = (modelsData.items || []).find(ep =>
      _normalizeEndpointForCompare(ep.url || ep.endpoint_url || ep.base_url) === target
    );
    if (!item || !item.endpoint_id) return null;

    const probesRes = await fetch(`${API_BASE}/api/model-endpoints/probe-local`, {
      credentials: 'same-origin',
      signal,
    });
    if (!probesRes.ok) return null;
    const probes = await probesRes.json().catch(() => ({}));
    return probes[item.endpoint_id] || null;
  }

  /**
   * Initialize with dependencies
   */
  export function init(apiBase) {
    API_BASE = apiBase;
    initSlashCommands({ apiBase, isStreaming: () => isStreaming });
    if (emailInbox) emailInbox.init(documentModule);
    // L9 (composer): the Agent|Chat mode toggle is meaningless in the game build —
    // play is always hybrid (OOC chat + in-character role-play + the engine tools
    // run every turn). game-trim.css hides it; this is the belt-and-suspenders JS
    // gate so the dead control stays gone even if the visibility system (app.js
    // applyUIVis) clears the inline display. The full inherited workspace is
    // unchanged. Fail-safe: wrapped so a missing node never throws in init.
    try {
      if (isGameBuild()) {
        const _modeToggle = document.querySelector('.mode-toggle');
        if (_modeToggle) _modeToggle.style.display = 'none';
      }
    } catch (_) {}
    // Wire the slash-command autocomplete popup on the chat composer. The
    // dispatcher already handles the typed command — this just surfaces the
    // registry as a discoverable menu when the user starts a message with /.
    import('./slashAutocomplete.js').then(mod => {
      const ta = document.getElementById('message');
      if (ta && mod.initSlashAutocomplete) mod.initSlashAutocomplete(ta);
    }).catch(() => {});
  }

  // addMessage, createMsgFooter, displayMetrics, hideWelcomeScreen, showWelcomeScreen
  // are now in chatRenderer.js — referenced via the public API delegation above.
  var addMessage = chatRenderer.addMessage;
  var createMsgFooter = chatRenderer.createMsgFooter;
  var displayMetrics = chatRenderer.displayMetrics;
  var hideWelcomeScreen = chatRenderer.hideWelcomeScreen;
  var showWelcomeScreen = chatRenderer.showWelcomeScreen;

  /**
   * Update submit button state
   */
  function updateSubmitButton(state, submitBtn) {
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
      isStreaming = true;
    } else if (state === 'idle') {
      submitBtn.dataset.mode = '';
      delete submitBtn.dataset.phase;
      submitBtn.classList.remove('recording');
      isStreaming = false;
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
  function _foregroundStreamLive() {
    if (!isStreaming || !currentAbort) return false;
    try {
      const cur = sessionModule.getCurrentSessionId && sessionModule.getCurrentSessionId();
      if (cur != null && _streamSessionId != null && cur !== _streamSessionId) return false;
      if (_streamSessionId != null && _backgroundStreams.has(_streamSessionId)) return false;
    } catch (_) {}
    return true;
  }
  function _syncSubmitButtonState() {
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
    if (isStreaming) isStreaming = false;
    if (submitBtn.dataset.mode === 'streaming') {
      submitBtn.dataset.mode = '';
      delete submitBtn.dataset.phase;
      submitBtn.classList.remove('recording', 'anim-launch', 'anim-land');
    }
    if (window._updateSendBtnIcon) window._updateSendBtnIcon();
  }

  // -----------------------------------------------------------------------
  // Slash commands — now in slashCommands.js
  // -----------------------------------------------------------------------

  // API key pattern for the guard in handleChatSubmit
  const API_KEY_RE = /^(sk-[a-zA-Z0-9_\-]{20,}|gsk_[a-zA-Z0-9]{20,}|AIza[a-zA-Z0-9_\-]{30,}|xai-[a-zA-Z0-9]{20,})$/;


  /**
   * Handle chat form submission
   */
  export async function handleChatSubmit(e, overrideMsg = null, overrideOpts = null) {
    if (e && e.preventDefault) e.preventDefault();
    // Headless / programmatic send. Callers (auto-continue, stream-drop recovery, a choice-card
    // pick, a slash dispatch) hand us the message text + options DIRECTLY, instead of the old
    // anti-pattern of writing the user-visible composer (`el('message').value = …`) and synthesizing
    // a `.send-btn` click. That puppeteering depended on UI timing (the deferred click could land
    // while `isStreaming` was still true and toggle Stop instead of Send), polluted the composer, and
    // stranded text on any failure. A headless send is plain text only — never a slash command or
    // setup input — so the intercepts below are skipped for it, and the composer is never touched.
    const _headless = overrideMsg != null;
    // #985 P2-A — a FLUSHED OUTBOX send is a headless send that re-uses the ALREADY-PAINTED optimistic
    // bubble + its pre-stamped clientMsgId (so the send is at-most-once / idempotent and the bubble
    // adopts cleanly instead of painting a duplicate). These flow through the same render/adopt path as
    // a normal optimistic send below — they just skip the "paint a fresh bubble" + "generate a fresh id"
    // steps. Absent (the common case) ⇒ byte-identical behaviour.
    let _queuedClientMsgId = null;
    let _queuedBubbleEl = null;
    if (_headless && overrideOpts) {
      if (overrideOpts.hideUserBubble) _hideUserBubble = true;
      if ('pendingContinue' in overrideOpts) _pendingContinue = overrideOpts.pendingContinue;
      if (overrideOpts.autoContinue) _autoContinuePending = true;
      if (overrideOpts.queuedClientMsgId) _queuedClientMsgId = overrideOpts.queuedClientMsgId;
      if (overrideOpts.queuedBubbleEl) _queuedBubbleEl = overrideOpts.queuedBubbleEl;
    }
    // Cancel research clarification timeout if active
    if (window._researchTimeoutTimer) {
      clearTimeout(window._researchTimeoutTimer);
      window._researchTimeoutTimer = null;
    }
    // Get current session
    const sessionId = sessionModule.getCurrentSessionId();
    const session = sessionModule.getSessions().find(s => s.id === sessionId);
    
    const submitBtn = document.querySelector('.send-btn');
    // Streaming-TTS flag, hoisted to the function scope: it is SET when the stream starts (below)
    // but also READ in the error/abort cleanup branch — a block-scoped `const` there threw
    // "streamingTTS is not defined" on ANY early submit error, masking the real failure and
    // blowing up the whole submit (no chat POST ever fired). Declare once here so both see it.
    let streamingTTS = false;

    // If compare is active, stop all compare streams
    if (window.compareModule && window.compareModule.isActive()) {
      window.compareModule.handleCompareSubmit();
      return;
    }

    // #985 P2-A — SEND-WHILE-STREAMING → QUEUE, don't Stop. A user Send with NON-EMPTY composer text
    // while a turn is in flight used to fall into the Stop branch below (abort the reply + `return`
    // before the new text was ever read → the message was silently DROPPED). The owner ruled "Queue
    // it": enqueue the new message, paint its optimistic bubble NOW, clear the composer, and flush in
    // FIFO order when the current turn settles. Only a NON-headless, NON-command, NON-empty composer
    // queues; an EMPTY composer (or the explicit Stop button) still falls through to the Stop branch,
    // and a slash command runs through its own dispatcher below (never queued as chat). The compare/
    // group routing above has already returned, so this is the plain-chat send path only.
    if (isStreaming && !_headless) {
      const _qInput = uiModule.el('message');
      const _qText = _qInput ? (_qInput.value || '') : '';
      const _qTrim = _qText.trim();
      if (_qTrim && !isCommand(_qTrim) && slashCommands.getSetupMode && !slashCommands.getSetupMode()) {
        _enqueueSend(_qText);
        return;
      }
      // empty composer / slash / setup mode → fall through to the existing Stop semantics
    }

    // If currently streaming, stop it (a headless/programmatic send never toggles Stop — it sends).
    if (isStreaming && !_headless) {
      // Cancel server-side research if in progress
      const _cancelSid = sessionModule.getCurrentSessionId();
      if (_cancelSid && _researchingStreamIds.has(_cancelSid)) {
        fetch(`${API_BASE}/api/research/cancel/${_cancelSid}`, { method: 'POST' }).catch(e => console.warn('Research cancel failed:', e));
        _researchingStreamIds.delete(_cancelSid);
        _clearResearchTimer();
      }
      abortCurrentRequest(true);  // explicit user Stop → also cancel the detached server run

      // Clean up any running agent thread nodes (stop wave animation, remove "running" state)
      document.querySelectorAll('.agent-thread-node.running').forEach(node => {
        if (node._waveInterval) { clearInterval(node._waveInterval); node._waveInterval = null; }
        if (node._elapsedTicker) { clearInterval(node._elapsedTicker); node._elapsedTicker = null; }
        node.classList.remove('running');
        const wave = node.querySelector('.agent-thread-wave');
        if (wave) wave.textContent = '';
        const icon = node.querySelector('.agent-thread-icon');
        if (icon) icon.textContent = '\u25A0'; // stop square
        const statusEl = node.querySelector('.agent-thread-status');
        if (!statusEl) {
          const header = node.querySelector('.agent-thread-header');
          if (header) {
            const s = document.createElement('span');
            s.className = 'agent-thread-status';
            s.textContent = 'stopped';
            header.appendChild(s);
          }
        }
      });
      document.querySelectorAll('.agent-thread.streaming').forEach(t => t.classList.remove('streaming'));

      // Clean up any thinking spinners
      document.querySelectorAll('.agent-thinking-dots').forEach(el => {
        if (el._spinner) el._spinner.destroy();
        el.remove();
      });
      // No text accumulated — remove the empty holder with spinner
      if (currentHolder && !currentAccumulated) {
        if (currentSpinner) { currentSpinner.destroy(); currentSpinner = null; }
        // Empty cancel — keep the assistant bubble around with a "Cancelled
        // by user" indicator and persist a placeholder server-side so the
        // turn survives a refresh instead of vanishing without a trace.
        _renderCancelledBubble(currentHolder);
        currentHolder = null;
        updateSubmitButton('idle', submitBtn);
        const messageInput = uiModule.el('message');
        if (messageInput) messageInput.disabled = false;
        currentAccumulated = '';
        return;
      }
      // Render whatever was accumulated so far
      if (currentHolder && currentAccumulated) {
        // Store accumulated in a closure variable before it gets cleared
        const stoppedContent = currentAccumulated;
        
        // Store raw content in dataset for consistency with other messages
        currentHolder.dataset.raw = stoppedContent;
        
        currentHolder.querySelector('.body').innerHTML = markdownModule.processWithThinking(
          markdownModule.squashOutsideCode(stoppedContent)
        );
        
        // Highlight code blocks
        if (window.hljs) {
          currentHolder.querySelectorAll('pre code').forEach((block) => {
            window.hljs.highlightElement(block);
          });
        }
        
        // Add the stopped indicator with continue button
        const stoppedIndicator = document.createElement('div');
        stoppedIndicator.className = 'stopped-indicator';
        const stoppedLabel = document.createElement('span');
        stoppedLabel.textContent = '[Message interrupted]';
        stoppedIndicator.appendChild(stoppedLabel);
        const continueBtn = document.createElement('button');
        continueBtn.className = 'continue-btn';
        continueBtn.title = 'Continue';
        continueBtn.textContent = '\u25B8';
        const _stoppedHolder = currentHolder; // capture before it gets cleared
        continueBtn.addEventListener('click', () => {
          stoppedIndicator.remove();
          _hideUserBubble = true;
          _pendingContinue = _stoppedHolder;
          const cutoff = stoppedContent;
          // Headless send (no composer puppeteering) — the _hideUserBubble/_pendingContinue flags set
          // above flow through; the continuation merges into the existing bubble.
          handleChatSubmit(null, 'Your previous response was interrupted. It ended with:\n\n' + cutoff.slice(-500) + '\n\nDo NOT repeat what you already said. Continue exactly from where you were cut off.');
        });
        stoppedIndicator.appendChild(continueBtn);
        currentHolder.querySelector('.body').appendChild(stoppedIndicator);

        // Tell server to mark this message as stopped
        const _sid = sessionModule.getCurrentSessionId();
        if (_sid) fetch(`${API_BASE}/api/session/${_sid}/mark-stopped`, { method: 'POST' }).catch(e => console.warn('mark-stopped failed:', e));

        // Add footer with copy/regen if not already present
        if (!currentHolder.querySelector('.msg-footer')) {
          currentHolder.dataset.raw = stoppedContent;
          currentHolder.appendChild(createMsgFooter(currentHolder));
        }

        uiModule.scrollHistory();
      }
      
      // Reset button state
      updateSubmitButton('idle', submitBtn);
      
      // Re-enable message input
      const messageInput = uiModule.el('message');
      if (messageInput) messageInput.disabled = false;
      
      // Clear tracking variables
      currentAccumulated = '';
      currentHolder = null;

      return;
    }

    // --- OOBE image gate (P1 onboarding): the houseguest photo is the player's FIRST
    // interaction. Pre-game, until a cast photo is secured, NO chat message may be sent — this
    // covers every send path (button, Enter, programmatic) at one chokepoint. The gate module
    // fails OPEN (only ever blocks a confirmed pre-game game-build with no image yet), so this is
    // a no-op for normal play, a non-game build, an engine outage, or a started season. The
    // producers' auto-open fires only AFTER the photo is finalized, so it is never blocked here.
    try {
      if (window._orwellChatGate && window._orwellChatGate.blocked()) {
        if (window._orwellChatGate.recompute) window._orwellChatGate.recompute();
        return;
      }
    } catch (_) { /* gate unavailable → never block the chat */ }

    // --- Send-path entry: block re-clicks between submit and stream start ---
    if (_sendInFlight) return;
    _sendInFlight = true;
    // Instant visual feedback so the user sees their click was accepted
    // even before the streaming button state kicks in below.
    const _earlyMessageInput = uiModule.el('message');
    if (_earlyMessageInput) _earlyMessageInput.disabled = true;
    if (submitBtn) submitBtn.classList.add('send-pending');
    const _releaseSendFlag = () => {
      _sendInFlight = false;
      if (_earlyMessageInput) _earlyMessageInput.disabled = false;
      if (submitBtn) submitBtn.classList.remove('send-pending');
    };

    // --- Setup mode: intercept next message (but let slash commands through) ---
    if (!_headless) {
      const el = uiModule.el;
      const rawMsg = (el('message').value || '').trim();
      const currentSetupMode = slashCommands.getSetupMode();
      if (currentSetupMode && rawMsg && !isCommand(rawMsg)) {
        const mode = currentSetupMode;
        slashCommands.clearSetupMode(mode === 'endpoint-provider' || mode === 'endpoint-key-for-provider');
        el('message').value = '';
        if (window._syncModelPickerAutohide) window._syncModelPickerAutohide();
        if (uiModule.autoResize) uiModule.autoResize(el('message'));
        if (mode === true || mode === 'endpoint') {
          handleSetupInput(rawMsg);
        } else {
          handleSetupWizard(mode, rawMsg);
        }
        _releaseSendFlag();
        return;
      }
      if (currentSetupMode && rawMsg && isCommand(rawMsg)) {
        slashCommands.clearSetupMode();  // Clear setup mode, fall through to slash handler
      }
    }

    const el = uiModule.el;
    const msg = _headless ? overrideMsg : el('message').value;
    // Allow empty text when a regen carries over the original message's
    // attachment ids — a photo-only message still has something to send.
    if (!msg.trim() && !fileHandlerModule.getPendingCount() && !(_pendingRegenAttachments && _pendingRegenAttachments.length)) { _releaseSendFlag(); return; }

    // --- Slash commands: execute directly without AI (no session needed) ---
    if (!_headless && isCommand(msg.trim())) {
      const handled = await handleSlashCommand(msg.trim());
      if (handled) {
        el('message').value = '';
        if (window._syncModelPickerAutohide) window._syncModelPickerAutohide();
        if (uiModule.autoResize) uiModule.autoResize(el('message'));
        _releaseSendFlag();
        return;
      }
    }

    // --- BUG 1 (never eat a message): render the optimistic user bubble SYNCHRONOUSLY here,
    // BEFORE anything that might clear the composer or early-return. The first send of a session
    // has to await session/model materialization below (`materializePendingSession`,
    // `/api/default-chat`); previously those branches cleared the composer and returned with NO
    // bubble, so the user's text simply vanished ("Hello?" eaten; the 2nd message worked because by
    // then a session existed). The bubble is painted up front (in a PENDING state) so the message
    // is always visible; if materialization fails the bubble is marked unsent and the composer text
    // is RESTORED (never wiped into nothing). The later render block (post-attachment-upload) adopts
    // this element instead of painting a second bubble. Headless / skip-bubble sends never get one.
    const _wantOptimisticBubble = !_headless && !_hideUserBubble;
    // ADR 0008: a client-temp id for the optimistic user bubble. The server stamps it on the
    // persisted user message, so on reconcile the sender ADOPTS this bubble to the canonical
    // {id, seq} (temp -> canonical) instead of fetching history and rendering a duplicate.
    // #985 P2-A: a flushed outbox send carries its bubble's PRE-STAMPED clientMsgId so the POST below
    // re-uses the exact same key the optimistic bubble already holds — at-most-once + clean adoption.
    const _clientMsgId = _queuedClientMsgId || ('c-' + ((window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : (Date.now() + '-' + Math.random().toString(36).slice(2))));
    // The visible text for the optimistic bubble. Doc-edit context is folded into the display
    // string later (it only applies when a session already exists, never on the first-send path
    // these early returns guard), so the plain message is the correct pre-materialize display.
    const _earlyAttachInfo = (!_headless && fileHandlerModule.getPendingCount())
      ? fileHandlerModule.getPendingInfo() : null;
    let _userMsgEl = null;
    if (_queuedBubbleEl) {
      // #985 P2-A: a flushed outbox send already painted its bubble at enqueue time. ADOPT it (don't
      // paint a second one) — the adopt block below settles its msg-pending state. It already carries
      // the matching clientMsgId; re-stamp defensively so the POST + reconcile key are byte-identical.
      _userMsgEl = _queuedBubbleEl;
      _userMsgEl.dataset.clientMsgId = _clientMsgId;
    } else if (_wantOptimisticBubble) {
      _userMsgEl = addMessage('user', _displayOverride || msg, null,
        _earlyAttachInfo ? { attachments: _earlyAttachInfo } : null);
      if (_userMsgEl) {
        _userMsgEl.dataset.clientMsgId = _clientMsgId;
        _userMsgEl.classList.add('msg-pending');
      }
    }
    // The composer text was just captured (`msg`) and is now mirrored in the bubble, so it is safe
    // to clear the composer immediately — BUT only once a send is actually going to proceed. On a
    // hard early-return (no model configured / materialize failed) we KEEP the bubble (marked
    // unsent) and RESTORE the composer so the user never loses their words. This helper centralizes
    // the "send is dead, don't eat the message" cleanup.
    const _abortSendKeepMessage = (assistantNote) => {
      if (_userMsgEl) {
        _userMsgEl.classList.remove('msg-pending');
        _userMsgEl.classList.add('msg-unsent');
        _userMsgEl.dataset.unsent = '1';
      }
      // Restore the composer text (it was never cleared on this path, but be explicit/idempotent so
      // a future reordering can't strand the words) — the message is preserved, never eaten.
      if (!_headless) {
        try {
          const _mi = el('message');
          if (_mi && !_mi.value) { _mi.value = msg; if (uiModule.autoResize) uiModule.autoResize(_mi); }
        } catch (_) {}
      }
      if (assistantNote) addMessage('assistant', assistantNote);
      _releaseSendFlag();
    };
    const _NO_SESSION_NOTE =
      'No chat session active. You can:\n\n' +
      '- Open the model picker in the chat box and pick a model\n' +
      '- Use the `+` button in the model picker to add a model endpoint\n' +
      '- Use `/help` to see all available commands';

    // Materialize pending session (deferred from model click) on first message
    if (sessionModule.hasPendingChat && sessionModule.hasPendingChat()) {
      const ok = await sessionModule.materializePendingSession();
      if (!ok || !sessionModule.getCurrentSessionId()) { _abortSendKeepMessage(); return; }
    }

    if (!sessionModule.getCurrentSessionId()) {
      // Auto-create a session using default chat config. Always fetch fresh
      // so that a recent Settings change takes effect without a page reload.
      try {
        let dc = null;
        try {
          const dcRes = await fetch('/api/default-chat');
          dc = await dcRes.json();
          if (dc && dc.endpoint_url && dc.model) {
            try { window.__orwellDefaultChat = dc; } catch (_) {}
          }
        } catch (_) {
          dc = (typeof window !== 'undefined' && window.__orwellDefaultChat) || null;
        }
        if (dc && dc.endpoint_url && dc.model) {
          await sessionModule.createDirectChat(dc.endpoint_url, dc.model, dc.endpoint_id);
          const ok = await sessionModule.materializePendingSession();
          if (!ok || !sessionModule.getCurrentSessionId()) { _abortSendKeepMessage(); return; }
        } else {
          _abortSendKeepMessage(_NO_SESSION_NOTE);
          return;
        }
      } catch (e) {
        _abortSendKeepMessage(_NO_SESSION_NOTE);
        return;
      }
    }

    // --- API key guard: warn if message looks like an API key ---
    if (API_KEY_RE.test(msg.trim())) {
      if (!await window.styledConfirm('This looks like an API key. Sending it to the AI could expose it.\n\nDid you mean to use /setup instead?', { confirmText: 'Send anyway', danger: true })) {
        _releaseSendFlag();
        return;
      }
    }


    const messageInput = el('message');
    const originalBtnText = submitBtn ? submitBtn.innerHTML : '';

    // Re-enable the textarea now that we've handed off to the stream: the
    // user wants to compose the next message while the AI is still talking.
    // The `isStreaming` flag is the re-click guard for the send button.
    if (messageInput) messageInput.disabled = false;
    updateSubmitButton('streaming', submitBtn);
    if (submitBtn) submitBtn.classList.remove('send-pending');
    _sendInFlight = false;

    // Capture session ID for background stream detection
    const streamSessionId = sessionModule.getCurrentSessionId();
    _streamSessionId = streamSessionId;
    const streamQuery = msg;
    _lastReaderActivity = Date.now();

    // Acquire Web Lock to hint browser not to discard this tab while streaming
    if (navigator.locks) {
      navigator.locks.request('orwell-stream-' + streamSessionId, { mode: 'exclusive', ifAvailable: true }, lock => {
        if (!lock) return; // Another stream already holds a lock — fine
        return new Promise(resolve => { _webLockRelease = resolve; });
      }).catch(e => console.warn('web lock acquire failed:', e)); // Ignore lock errors — best-effort
    }

    // Declare accumulated outside try block so it's accessible in catch
    let accumulated = '';
    // ADR 0012 §2.4: set if the server tells this (loser-of-the-bind) window the run lives under a
    // DIFFERENT canonical session id; converged onto in the finally (never mid-stream).
    let _adoptCanonicalAfterStream = null;
    // ADR 0012 (GAP 2 — error-path consistency): set when this turn rendered a LIVE model error (e.g.
    // "Error 503"). The agent loop persists a FRIENDLY fallback ("The model returned an empty
    // response…") instead, so a peer/reload shows that text while the sender shows the raw error — two
    // windows, different text (the closest thing to the original "each window typing different
    // responses" complaint, on the error path). The finally FORCE-reconciles the sender's bubble to
    // the persisted message so the live + persisted + peer views all converge to ONE string. The
    // immediate live error feedback is kept; only the SETTLED state is reconciled.
    let _streamHadError = false;
    // P1 (OOBE cutover): set when createCharacter paints the inline "finalizing" indicator this
    // turn, so the first house-entry narration token can clear it (and the finally can safety-net).
    let _orwellFinalizingActive = false;
    // Are we currently inside an unclosed <think> block? Toggled per think/answer
    // cycle so a multi-round agent response (one reasoning phase PER round) wraps each
    // round's reasoning in its own <think>…</think> instead of leaking rounds 2+ as text.
    let _thinkOpen = false;
    let holder = null;
    let finalMeta = null;
    let spinner = null;
    let timedOut = false;
    let processingProbeTimer = null;
    let processingProbeAbort = null;
    let _renderStream = () => {};
    let _cancelThinkingTimer = () => {};
    let _removeThinkingSpinner = () => {};
    let timeoutId = null;
    let responseTimeoutCleared = false;
    let clearResponseTimeout = () => {};
    const clearProcessingProbe = () => {
      if (processingProbeTimer) {
        clearTimeout(processingProbeTimer);
        processingProbeTimer = null;
      }
      if (processingProbeAbort) {
        try { processingProbeAbort.abort(); } catch (_) {}
        processingProbeAbort = null;
      }
    };

    // Reset tracking variables at start
    currentAccumulated = '';
    currentHolder = null;
    
    try {
      // Re-enable auto-scroll when user sends a message
      uiModule.setAutoScroll(true);
      uiModule.scrollHistoryInstant();
      // Clear completed dot now that user is interacting
      if (sessionModule.clearStreamComplete) sessionModule.clearStreamComplete(sessionModule.getCurrentSessionId());

      // Check for document selection context before consuming display override
      const docSel = documentModule && documentModule.getSelectionContext();
      if (docSel) {
        const sels = Array.isArray(docSel) ? docSel : [docSel];
        const lineRefs = sels.map(s =>
          s.startLine === s.endLine ? `L${s.startLine}` : `L${s.startLine}-${s.endLine}`
        );
        _displayOverride = `[Doc edit: ${lineRefs.join(', ')}] ${msg}`;
      }

      const userDisplay = _displayOverride || msg;
      _displayOverride = null;
      const skipBubble = _hideUserBubble;
      _hideUserBubble = false;
      // Auto-recovery counter: carries across a turn's auto-continues, but resets
      // when the user genuinely sends a new message (so each task gets a fresh cap).
      // A real user turn (visible bubble) ALWAYS resets the budget — even if a
      // prior auto-continue's deferred click never cleared the pending flag — so a
      // stuck flag can't silently eat the next turn's recovery budget.
      if (!skipBubble) { _autoNudges = 0; _autoContinuePending = false; }
      else if (_autoContinuePending) { _autoContinuePending = false; }
      const _pendingAttachInfo = fileHandlerModule.getPendingCount() ? fileHandlerModule.getPendingInfo() : null;
      // Pre-read importable file contents before upload clears pending files
      const IMPORTABLE_EXT = /\.(txt|py|js|ts|html|htm|css|md|json|csv|yml|yaml|sh|sql|rs|go|java|c|cpp|h|rb|php|xml|jsx|tsx|log|toml|ini|conf|env|vue|svelte|scss|sass|less)$/i;
      const _importableFiles = [];
      if (_pendingAttachInfo && documentModule) {
        const rawFiles = fileHandlerModule.getPendingRaw ? fileHandlerModule.getPendingRaw() : [];
        for (let i = 0; i < _pendingAttachInfo.length; i++) {
          const att = _pendingAttachInfo[i];
          if (IMPORTABLE_EXT.test(att.name) && rawFiles[i]) {
            _importableFiles.push({ info: att, file: rawFiles[i] });
          }
        }
      }
      // ADOPT the optimistic bubble painted up front (BUG 1). The early render already created the
      // user bubble + stamped `_clientMsgId` before any session/model materialization could clear the
      // composer, so we DON'T paint a second one here — we just settle its state and reconcile its
      // visible text with the (possibly doc-edit-augmented) `userDisplay`. The `_userMsgEl` /
      // `_clientMsgId` are function-scoped from the early block.
      if (_userMsgEl) {
        _userMsgEl.classList.remove('msg-pending');
        // Doc-edit context augments the display string after the early bubble was painted with the
        // plain message — re-render the body so the user sees the same text the AI receives.
        if (userDisplay !== msg) {
          try {
            const _body = _userMsgEl.querySelector('.body');
            if (_body) _body.innerHTML = markdownModule.processWithThinking(markdownModule.squashOutsideCode(userDisplay));
          } catch (_) {}
        }
      } else if (!skipBubble) {
        // Defensive fallback: if the early render didn't happen (e.g. an unexpected state where the
        // bubble was suppressed early but is wanted now), paint it here so a message is NEVER eaten.
        _userMsgEl = addMessage('user', userDisplay, null, _pendingAttachInfo ? { attachments: _pendingAttachInfo } : null);
        if (_userMsgEl) _userMsgEl.dataset.clientMsgId = _clientMsgId;
      }
      // A headless send never touches the user's composer (no clear, no draft wipe, no keyboard
      // dismiss) — the message came from a caller, not the textarea, so the user's draft is preserved.
      if (!_headless) {
      messageInput.value = '';
      messageInput.style.height = '';
      messageInput.dispatchEvent(new Event('input'));
      // G17 (refresh-persistence audit F3): a sent turn clears the persisted composer
      // draft — a refresh must never resurrect words the house already heard.
      if (window._orwellComposerDraftClear) window._orwellComposerDraftClear();
      // Mobile: dismiss the on-screen keyboard after sending. iOS in
      // particular ignores a bare blur() in some cases (or some other
      // listener refocuses straight after), so we temporarily mark the
      // input readonly which forces the keyboard to retract, then blur,
      // then drop the readonly attribute after the keyboard is gone so
      // typing still works for the next message.
      if (isNarrow()) {
        try {
          messageInput.setAttribute('readonly', 'readonly');
          messageInput.blur();
          const _dropReadonly = () => { try { messageInput.removeAttribute('readonly'); } catch {} };
          setTimeout(() => {
            // If the blur stuck, the input is no longer the active element —
            // safe to drop readonly now so the next message can be typed.
            // If it did NOT stick (some mobile browsers keep the textarea
            // focused after a programmatic blur), removing readonly here would
            // re-summon the keyboard mid-stream — the "bounce up" that then
            // lingers until the end-of-stream blur. In that case keep readonly
            // on (keyboard stays down) and drop it the moment the user taps to
            // type again, so typing still works without the bounce.
            if (document.activeElement === messageInput) {
              messageInput.addEventListener('pointerdown', _dropReadonly, { once: true });
              messageInput.addEventListener('focus', _dropReadonly, { once: true });
            } else {
              _dropReadonly();
            }
          }, 120);
        } catch {}
      }
      } // end if (!_headless) composer reset

      let ids = [];
      try {
        ids = await fileHandlerModule.uploadPending();
      } catch(e) {
        console.error('upload failed', e);
      }

      // Carry over the original message's file-ids on a regenerate so the new
      // send still references the same photos / docs (and picks up the user's
      // edited OCR text via the server-side .vision cache). Always CONSUME the
      // slot — even when empty / errored — so the regen ids can't bleed into
      // an unrelated next message if uploadPending() above had thrown.
      if (_pendingRegenAttachments && _pendingRegenAttachments.length) {
        ids = ids.concat(_pendingRegenAttachments);
      }
      _pendingRegenAttachments = null;

      // The optimistic user bubble was rendered before the upload assigned ids,
      // so image previews couldn't show (the renderer needs att.id). Now that
      // the upload resolved, stamp the ids — plus width/height for images so
      // the skeleton can size itself to the photo's aspect ratio — and
      // re-render so the thumbnail appears live, no refresh needed.
      if (_userMsgEl && _pendingAttachInfo && ids.length) {
        const _meta = fileHandlerModule.getLastUploadedMeta?.() || [];
        for (let i = 0; i < _pendingAttachInfo.length && i < ids.length; i++) {
          _pendingAttachInfo[i].id = ids[i];
          const _m = _meta[i];
          if (_m) {
            if (_m.width)  _pendingAttachInfo[i].width  = _m.width;
            if (_m.height) _pendingAttachInfo[i].height = _m.height;
          }
        }
        chatRenderer.updateMessageAttachments(_userMsgEl, _pendingAttachInfo);
      }

      // Offer to import text files to document library. #951: routed through the OrwellNotice kit
      // (an above-composer "continue"-kind notice) so it shares the ONE chrome/dismiss/motion/a11y
      // contract instead of hand-rolling its own banner + anchor + ×. Auto-dismisses after 15s.
      if (_importableFiles.length > 0 && window.OrwellNoticeKit) {
        const label = _importableFiles.length === 1
          ? `Import "${_importableFiles[0].info.name}" to document library?`
          : `Import ${_importableFiles.length} files to document library?`;
        const _imp = window.OrwellNoticeKit.create({
          id: 'import-prompt-banner',
          kind: 'continue',         // a quiet, dismissible above-composer nudge
          title: label,
          dismissible: true,
          persistDismiss: false,    // transient: it must reappear on a future upload, not "forever"
          autoDismissMs: 15000,
        });
        const body = document.createElement('span');
        body.style.cssText = 'display:inline-flex;align-items:center;';
        const importBtn = document.createElement('button');
        importBtn.textContent = 'Import';
        importBtn.style.cssText = 'padding:2px 12px;border:1px solid var(--fg);border-radius:4px;background:none;color:var(--fg);cursor:pointer;font-size:12px;';
        importBtn.addEventListener('click', async () => {
          importBtn.disabled = true;
          importBtn.textContent = 'Importing…';
          const EXT_LANG = {'.py':'python','.js':'javascript','.ts':'typescript','.html':'html','.css':'css','.md':'markdown','.json':'json','.yml':'yaml','.yaml':'yaml','.sh':'bash','.sql':'sql','.rs':'rust','.go':'go','.java':'java','.c':'c','.cpp':'cpp','.rb':'ruby','.php':'php','.xml':'xml','.jsx':'javascript','.tsx':'typescript'};
          let imported = 0;
          for (const { info, file } of _importableFiles) {
            try {
              const content = await file.text();
              const dotIdx = info.name.lastIndexOf('.');
              const title = dotIdx > 0 ? info.name.slice(0, dotIdx) : info.name;
              const ext = dotIdx >= 0 ? info.name.slice(dotIdx).toLowerCase() : '';
              await fetch(`${API_BASE}/api/document`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, language: EXT_LANG[ext] || '', content }),
              });
              imported++;
            } catch (e) { console.error('Import failed:', info.name, e); }
          }
          _imp.update({ title: `Imported ${imported} file${imported !== 1 ? 's' : ''}`, body: '' });
          setTimeout(() => _imp.hide(), 2000);
        });
        body.appendChild(importBtn);
        _imp.show();
        _imp.setBody(body);
      }

      // Auto-save document editor content before sending so the AI sees latest text
      if (documentModule && documentModule.isPanelOpen() && documentModule.getCurrentDocId()) {
        try { await documentModule.saveDocument(); } catch(e) { console.warn('doc auto-save failed', e); }
      }

      // Inject document selection context if present
      let finalMsg = msg;
      if (docSel) {
        const sels = Array.isArray(docSel) ? docSel : [docSel];
        if (sels.length === 1) {
          const s = sels[0];
          const lineRef = s.startLine === s.endLine ? `line ${s.startLine}` : `lines ${s.startLine}-${s.endLine}`;
          finalMsg = `In the document, edit this specific text (${lineRef}):\n\`\`\`\n${s.text}\n\`\`\`\n\nInstruction: ${msg}`;
        } else {
          const parts = sels.map((s, i) => {
            const lineRef = s.startLine === s.endLine ? `line ${s.startLine}` : `lines ${s.startLine}-${s.endLine}`;
            return `Selection ${i + 1} (${lineRef}):\n\`\`\`\n${s.text}\n\`\`\``;
          });
          finalMsg = `In the document, edit these specific sections:\n\n${parts.join('\n\n')}\n\nInstruction: ${msg}`;
        }
      }

      // Apply inject prefix/suffix
      const _inject = presetsModule.getInject ? presetsModule.getInject() : { prefix: '', suffix: '' };
      let _finalMsgWithInject = finalMsg;
      if (_inject.prefix) _finalMsgWithInject = _inject.prefix + ' ' + _finalMsgWithInject;
      if (_inject.suffix) _finalMsgWithInject = _finalMsgWithInject + ' ' + _inject.suffix;

      const fd = new FormData();
      fd.append('message', _finalMsgWithInject);
      fd.append('session', streamSessionId);
      fd.append('client_msg_id', _clientMsgId);  // ADR 0008: optimistic temp id for bubble adoption
      if (ids.length) fd.append('attachments', JSON.stringify(ids));
      // Auto-save & send active doc ID so the backend sees latest content
      if (documentModule && documentModule.isPanelOpen() && documentModule.getCurrentDocId()) {
        try { await documentModule.saveDocument({ silent: true }); } catch (_e) { /* best-effort */ }
        fd.append('active_doc_id', documentModule.getCurrentDocId());
      }
      // Web toggle: pre-search in Chat mode, tool permission in Agent mode
      const toggleState = Storage.loadToggleState();
      let isAgentMode = (toggleState.mode || 'chat') === 'agent';
      // Auto-escalate to agent mode when a document is open — the user expects
      // the AI to see the document and have tools to edit it
      if (!isAgentMode && documentModule && documentModule.isPanelOpen() && documentModule.getCurrentDocId()) {
        isAgentMode = true;
      }
      fd.append('mode', isAgentMode ? 'agent' : 'chat');
      if (el('web-toggle').checked) {
        if (isAgentMode) {
          fd.append('allow_web_search', 'true');
        } else {
          fd.append('use_web', 'true');
        }
      }
      if (el('research-toggle').checked) {
        fd.append('use_research', 'true');
        // Research always runs in chat mode — override agent if set
        fd.set('mode', 'chat');
      }
      if (el('bash-toggle').checked) {
        fd.append('allow_bash', 'true');
      }
      // Plan mode: agent investigates read-only and proposes a plan to approve.
      // Only meaningful in agent mode, and never alongside deep research.
      // _forcePlanOff is a one-shot set by "Approve & Run" so the execution turn
      // runs with full tools even though the Plan toggle is still on.
      const _planToggle = el('plan-toggle');
      const planTurn = !_forcePlanOff && isAgentMode && _planToggle && _planToggle.checked && !el('research-toggle').checked;
      _forcePlanOff = false;
      if (planTurn) {
        fd.append('plan_mode', 'true');
        fd.set('mode', 'agent');
      } else if (isAgentMode) {
        // Executing (not proposing): send the stored plan back so the backend
        // pins it in context and the agent can always re-reference it.
        const _sp = _getStoredPlan();
        if (_sp) fd.append('approved_plan', _sp);
      }
      const ragChk = el('rag-toggle');
      if (ragChk && !ragChk.checked) {
        fd.append('use_rag', 'false');
      }
      const incognitoChk = el('incognito-toggle');
      if (incognitoChk && incognitoChk.checked) {
        fd.append('incognito', 'true');
      }
      const _ws = (Storage.KEYS && Storage.get(Storage.KEYS.WORKSPACE, '')) || '';
      if (_ws) {
        fd.append('workspace', _ws);
      }
      if (presetsModule.getSelectedPreset()) {
        fd.append('preset_id', presetsModule.getSelectedPreset());
      }


      const abortCtrl = new AbortController();
      abortCtrl._reason = '';
      currentAbort = abortCtrl;

      const _tState = Storage.loadToggleState();
      const _isAgent = (_tState.mode || 'chat') === 'agent';

      // Timeout: 6 min for research and agent mode, 3 min otherwise
      const timeoutMs = el('research-toggle').checked || _isAgent ? RESEARCH_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
      timeoutId = setTimeout(() => {
        if (!abortCtrl.signal.aborted) {
          timedOut = true;
          abortCtrl._reason = 'timeout';
          try {
            if (streamSessionId) {
              fetch(`/api/chat/stop/${encodeURIComponent(streamSessionId)}`, {
                method: 'POST',
                credentials: 'same-origin',
              }).catch(() => {});
            }
          } catch (_) {}
          abortCtrl.abort();
        }
      }, timeoutMs);
      clearResponseTimeout = () => {
        if (responseTimeoutCleared) return;
        responseTimeoutCleared = true;
        clearTimeout(timeoutId);
      };
      
      const box = el('chat-history');
      holder = document.createElement('div');
      holder.className = 'msg msg-ai streaming';

      // Track holder globally so stop button can access it
      currentHolder = holder;
      holder._researchQuery = msg; // Store query for notification text
      
      const modelName = sessionModule.getCurrentModel() || null;

      let loadingText = 'Initializing...';

      if (el('web-toggle').checked && !_isAgent) {
        const _searchLabel = searchModule ? searchModule.getProviderLabel() : 'web';
        loadingText = `Searching via ${_searchLabel}...<br>
                       <span style="font-size: 0.9em; opacity: 0.8;">
                       Query: "${msg.substring(0, 50)}${msg.length > 50 ? '...' : ''}"<br>
                       Fetching top results...</span>`;
      } else if (el('research-toggle').checked) {
        loadingText = 'Deep research mode active...';
      } else {
        loadingText = 'Processing request...';
      }

      var roleLabel = _senderLabel(_modelRouteLabel(modelName, modelName));
      var _charNameInit = presetsModule.getCharacterName ? presetsModule.getCharacterName() : '';
      if (_charNameInit) roleLabel = _charNameInit;
      const roleTs = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
      holder.innerHTML = `<div class="role">${uiModule.esc(roleLabel)} <span class="role-timestamp">${roleTs}</span></div><div class="body"></div>`;
      holder._requestedModel = modelName;
      holder._actualModel = modelName;
      _applyModelColor(holder.querySelector('.role'), modelName);
      holder.style.position = 'relative';
      
      // Create spinner
      spinner = spinnerModule.create(_waitLabel('init', 'Initializing'), 'right', 'wave');
      currentSpinner = spinner;
      const bodyDiv = holder.querySelector('.body');
      bodyDiv.appendChild(spinner.createElement());
      spinner.start();
      
      // Update spinner message based on mode
      if (el('web-toggle').checked && !_isAgent) {
        spinner.updateMessage('Searching web with ' + (searchModule ? searchModule.getProviderLabel() : 'SearXNG'));
        setTimeout(() => spinner.updateMessage('Processing results'), 1500);
      } else if (el('research-toggle').checked) {
        spinner.updateMessage('Researching');
        setTimeout(() => spinner.updateMessage('Analyzing sources'), 1500);
      } else {
        spinner.updateMessage(_waitLabel('waiting', 'Processing request'));
        const endpointUrlForProbe = sessionModule.getCurrentEndpointUrl ? sessionModule.getCurrentEndpointUrl() : null;
        if (endpointUrlForProbe && modelName) {
          processingProbeTimer = setTimeout(async () => {
            processingProbeTimer = null;
            if (accumulated || !spinner || !spinner.element || (currentAbort && currentAbort.signal.aborted)) return;
            processingProbeAbort = new AbortController();
            try {
              spinner.updateMessage('Checking model endpoint');
              const status = await _probeCurrentEndpointStatus(endpointUrlForProbe, processingProbeAbort.signal);
              if (accumulated || !spinner || !spinner.element || (currentAbort && currentAbort.signal.aborted)) return;
              if (!status) {
                spinner.updateMessage(_waitLabel('still', 'Still waiting for model'));
              } else if (status.alive) {
                const latency = status.latency_ms ? ` (${status.latency_ms}ms)` : '';
                spinner.updateMessage(`Endpoint online${latency}; waiting for first token`);
              } else {
                // Probe confirms the endpoint isn't responding. Don't
                // sit on a hung fetch — give the user 5s to read the
                // status, then auto-abort with reason='offline' so the
                // catch handler shows a clean "switch model" message
                // instead of leaving the spinner spinning forever.
                if (status.error) console.warn('Model endpoint probe failed:', status.error);
                let _countdown = 5;
                spinner.updateMessage(`Endpoint offline — cancelling in ${_countdown}s`);
                const _tick = setInterval(() => {
                  _countdown--;
                  if (!spinner || !spinner.element || (currentAbort && currentAbort.signal.aborted) || accumulated) {
                    clearInterval(_tick);
                    return;
                  }
                  if (_countdown > 0) {
                    spinner.updateMessage(`Endpoint offline — cancelling in ${_countdown}s`);
                  } else {
                    clearInterval(_tick);
                    if (currentAbort && !currentAbort.signal.aborted) {
                      currentAbort._reason = 'offline';
                      currentAbort.abort();
                    }
                  }
                }, 1000);
              }
            } catch (e) {
              if (e && e.name !== 'AbortError' && spinner && spinner.element && !accumulated) {
                spinner.updateMessage(_waitLabel('still', 'Still waiting for model'));
              }
            } finally {
              processingProbeAbort = null;
            }
          }, 10000);
        }
      }
      
      const researchBtn = el('research-toggle-btn');
      if (el('research-toggle').checked && researchBtn) {
        researchBtn.disabled = true;
        researchBtn.classList.remove('active');
      }
      box.appendChild(holder);
      uiModule.scrollHistory();

      const enableResearchBtn = () => {
        if (!researchBtn) return;
        researchBtn.disabled = false;
        researchBtn.classList.toggle('active', el('research-toggle').checked);
      };

      if (el('research-toggle').checked && researchBtn) {
        researchBtn.style.display = 'none';
        // Uncheck research toggle so follow-up messages don't trigger another research
        el('research-toggle').checked = false;
      }

      // User's current UTC offset in minutes (east of UTC). Threaded into
      // the agent so natural-language times like "today at 9pm" are
      // interpreted in YOUR timezone, not the server's.
      const _tzOffsetMin = -new Date().getTimezoneOffset();
      const _tzName = (() => {
        try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; }
        catch { return ''; }
      })();
      const res = await fetch(`${API_BASE}/api/chat_stream`, {
        method: 'POST',
        body: fd,
        headers: { 'X-Tz-Offset': String(_tzOffsetMin), 'X-Tz-Name': _tzName },
        signal: abortCtrl.signal
      });
      
      if (!res.ok) {
        clearResponseTimeout();
        if (res.status === 404) {
          // Session was deleted (e.g. by AI) — reload and go to welcome
          holder.remove();
          if (sessionModule) await sessionModule.loadSessions();
          return;
        }
        let errText = `Error ${res.status}`;
        try {
          const errBody = await res.text();
          // Parse nested JSON error if present
          const m = errBody.match(/"message"\s*:\s*"([^"]+)"/);
          if (m) errText = m[1].replace(/\\"/g, '"');
          else if (errBody.length < 200) errText = errBody;
        } catch {}
        // Auto-switch to chat mode for tool-related errors
        if (errText.includes('tool') || errText.includes('auto')) {
          errText = 'This model doesn\'t support agent tools — switched to Chat mode. Try again.';
          const _ab = document.getElementById('mode-agent-btn');
          const _cb = document.getElementById('mode-chat-btn');
          if (_ab && _cb) {
            _ab.classList.remove('active');
            _cb.classList.add('active');
            const _toggle = _ab.closest('.mode-toggle');
            if (_toggle) _toggle.classList.add('mode-chat');
          }
          if (typeof Storage !== 'undefined' && Storage.KEYS) {
            const _st = Storage.getJSON(Storage.KEYS.TOGGLES, {});
            _st.mode = 'chat';
            Storage.setJSON(Storage.KEYS.TOGGLES, _st);
          }
        }
        // F-S4-C (audit): a stream/connection error is a SYSTEM notice, NOT the GM's voice. The pre-created
        // bubble is `msg msg-ai` (Big Brother) WITH a GM `.role` label, so typing a raw "Error 502 / upstream
        // model error" into it read as in-game narration (immersion break). Reclassify it to the quiet
        // `.msg-system` style (left-border, no GM avatar) AND drop the `.role` label so nothing attributes the
        // failure to a houseguest; frame a generic connection failure out-of-character (the helpful tool-mode-
        // switch message set above keeps its own copy). The error path returns right after, so rebuilding the
        // idle holder is side-effect-free.
        try {
          holder.className = 'msg msg-system';
          holder.innerHTML = '<div class="body"></div>';
        } catch (_) {}
        if (!/Chat mode/i.test(errText)) {
          errText = `⚠ Connection error (${res.status}) — your message didn't go through. Try again.`;
        }
        typewriterInto(holder.querySelector('.body'), errText);
        enableResearchBtn();
        return;
      }

      // Mark the chat log busy while streaming so screen readers wait for the
      // settled response instead of announcing every token. Cleared in finally.
      const _chatLog = document.getElementById('chat-history');
      if (_chatLog) _chatLog.setAttribute('aria-busy', 'true');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let metrics = null;
      let isThinking = false;
      let thinkingStartTime = null;
      // Streaming TTS: synthesize sentence-by-sentence during streaming (assigns the hoisted flag).
      streamingTTS = !!(window.aiTTSManager && window.aiTTSManager.autoPlay && window.aiTTSManager.available);
      if (streamingTTS) window.aiTTSManager.streamingStart();
      // Multi-bubble agent tracking
      let roundHolder = holder;       // Current AI text bubble (changes per round)
      // #834: has a VISIBLE turn-header bubble (role + timestamp, not a continuation) been shown
      // yet? The initial `holder` carries the header, but it is hidden at agent_step when the round
      // produced no narration (a pure hidden tool-call round, e.g. getGameState). When that header
      // is hidden, the next continuation bubble must be PROMOTED to the turn header (role +
      // timestamp, NOT a continuation) so the received message still shows a timestamp.
      let turnHeaderShown = true;     // the initial holder starts as the visible header
      let roundText = '';             // Text accumulated for current round (MERGED reply+reasoning)
      // F8: per-round channel-split buffers. The BODY renders roundReplyText (reasoning-free by
      // construction); the live "Thinking" accordion renders roundReasoningText. These MUST be
      // reset wherever roundText is reset (agent_step / teacher_takeover) — see those sites.
      let roundReplyText = '';        // deltas with json.thinking falsy (the public reply)
      let roundReasoningText = '';    // deltas with json.thinking truthy (reasoning → accordion)
      let currentToolBubble = null;   // Current tool execution bubble
      let roundFinalized = false;     // Whether current round's text is finalized
      let _sourcesHtml = '';          // Sources box HTML to prepend to body
      let _sourcesExpanded = false;   // Track if user expanded sources during stream
      let _sourcesData = null;        // Raw sources data for rebuilding
      let _sourcesType = '';          // 'web' or 'research'
      let _findingsData = null;      // Raw findings data for collapsible box
      // _keepResearchOn removed — clarification state now persisted server-side via DB mode
      // Insert sources box as a stable DOM node that won't be replaced during streaming.
      // Returns the content container to use for innerHTML updates.
      function _ensureStreamLayout(body) {
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
      const esc = uiModule.esc;
      // Remove thinking spinner helper
      _removeThinkingSpinner = () => {
        const el = document.querySelector('.agent-thinking-dots');
        if (el) {
          if (el._spinner) el._spinner.destroy();
          el.remove();
        }
      };

      // Tool-aware thinking spinner
      let _lastToolName = '';
      const _searchIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="vertical-align:-2px;margin-right:4px"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
      // C14 (immersion): the Big Brother engine tools render as quiet production
      // beats — a label, never raw camelCase names or JSON payloads in the player's
      // transcript. Applies wherever these names appear (they exist only in the game).
      // E96 (ruling #11): the game build carries no Documents vertical — the
      // export item is removed from the DOM, not just hidden.
      if (document.body.hasAttribute('data-game-build')) {
        const docBtn = document.getElementById('export-doc-btn');
        if (docBtn) docBtn.remove();
      }
      // _orwellToolBeats now lives in ./orwellToolBeats.js (single source of truth,
      // imported at module top, shared with the history-reload path in
      // chatRenderer.js so the live + reload renders cannot drift).
      const _toolLabels = {
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
      function _thinkingLabel() {
        if (!_lastToolName) {
          return 'Thinking';
        }
        // Check exact match first, then prefix match
        const lower = _lastToolName.toLowerCase();
        if (_toolLabels[lower]) return _toolLabels[lower];
        for (const [key, label] of Object.entries(_toolLabels)) {
          if (lower.includes(key) || key.includes(lower)) return label;
        }
        return 'Thinking';
      }

      function _showThinkingSpinner(label) {
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

      // Auto-show thinking spinner after text stops streaming
      let _textPauseTimer = null;
      function _scheduleThinkingSpinner() {
        if (_textPauseTimer) clearTimeout(_textPauseTimer);
        _textPauseTimer = setTimeout(() => {
          if (!document.querySelector('.agent-thinking-dots') && isStreaming) {
            _showThinkingSpinner(_thinkingLabel());
          }
        }, 400);
      }
      _cancelThinkingTimer = () => {
        if (_textPauseTimer) { clearTimeout(_textPauseTimer); _textPauseTimer = null; }
      };

      // Document streaming state (text-fence detection)
      let _docFenceOpened = false;
      let _docFenceContentStart = -1;
      let _liveThinkSection = null;
      let _liveThinkContent = null;
      let _liveThinkInner = null;
      let _liveThinkHeader = null;
      let _liveThinkSpinnerSlot = null;
      let _liveThinkTimerEl = null;
      let _liveThinkToggle = null;
      let _liveThinkDomId = null;

      function _replyAfterClosedThinking(text) {
        const closeRe = /<\/(?:think(?:ing)?|thought)>|<channel\|>/gi;
        let match = null;
        let last = null;
        while ((match = closeRe.exec(text || '')) !== null) last = match;
        if (!last) return '';
        return (text || '').slice(last.index + last[0].length).trimStart();
      }

      // Direct render helper for streaming text
      _renderStream = () => {
        // F8: the BODY renders the reply-only buffer (roundReplyText — deltas with json.thinking
        // falsy). Reasoning is structurally ABSENT here, so it can NEVER paint in the public
        // bubble; the live "Thinking" accordion renders roundReasoningText separately. (A model
        // that inlines literal <think> tags on the CONTENT channel still works: processWithThinking
        // extracts/handles inline <think> and, in the game build, scrubs operator asides.)
        const dt = stripToolBlocks(roundReplyText);
        const bodyEl = roundHolder.querySelector('.body');
        const contentEl = _ensureStreamLayout(bodyEl);

        // When the reasoning accordion has collapsed in-place, a dedicated reply container exists
        // — render the reply into it (preserve the thinking bar when there's no reply yet).
        const liveReply = contentEl.querySelector('.live-reply-content');
        if (liveReply) {
          const replyTrimmed = dt.trim();
          if (replyTrimmed) {
            const r = liveReply._streamRenderer ||
              (liveReply._streamRenderer = createStreamRenderer(liveReply, {
                render: (t) => markdownModule.processWithThinking(markdownModule.squashOutsideCode(t)),
                hljs: window.hljs,
              }));
            r.update(replyTrimmed);
          }
          uiModule.scrollHistory();
          return;
        }

        // Normal streaming: incremental render (freeze finalized blocks, re-render only the
        // growing tail, highlight each code block once). See streamingRenderer.js.
        const renderer = contentEl._streamRenderer ||
          (contentEl._streamRenderer = createStreamRenderer(contentEl, {
            render: (t) => markdownModule.processWithThinking(markdownModule.squashOutsideCode(t)),
            hljs: window.hljs,
          }));
        renderer.update(dt);
        uiModule.scrollHistory();
      };

      let _nextIsError = false;
      let _streamSawDone = false;
      // BUG 2 (#985 P2-B): did the server persist ANY message this turn? A clean empty turn (the final
      // round made a tool call but emitted no narration; the server's `if full_response:` save is
      // skipped) emits NO `message_saved`. Combined with `accumulated === ''`, that is the
      // "backend produced no turn" terminal state — distinct from a thrown network drop. We render the
      // user-controlled Retry for it instead of silently hiding the empty bubble.
      let _sawMessageSaved = false;
      // BUG 2 — did the turn produce a VISIBLE artifact OTHER than narration text/a save? An in-character
      // image, an ask_user prompt, a budget notice, a surfaced error etc. all leave `accumulated === ''`
      // yet are a real, completed turn — NOT the empty-turn-with-no-recourse case. Set true on those so
      // the empty-turn Retry never spuriously fires after one.
      let _producedVisibleOutput = false;

      while (true) {
        const { done, value } = await reader.read();
        _lastReaderActivity = Date.now();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          // Log SSE event types (e.g. "event: error") for debugging
          if (line.startsWith('event: ')) {
            const evtType = line.slice(7).trim();
            if (evtType === 'error') _nextIsError = true;
            continue;
          }
          if (line.startsWith('data: ')) {
            const data = line.slice(6);

            // (thinking spinner removal is handled in agent_step / tool_start / content handlers)

            // Background detection: are we on a different session?
            const _isBg = (sessionModule.getCurrentSessionId() !== streamSessionId);

            // On first transition to background, store state in map
            if (_isBg && !_backgroundStreams.has(streamSessionId)) {
              _backgroundStreams.set(streamSessionId, {
                status: 'running',
                accumulated: accumulated,
                sourcesHtml: _sourcesHtml,
                findingsData: null,
                abortCtrl: currentAbort,
                query: streamQuery,
                metrics: null,
              });
              if (sessionModule && sessionModule.markStreaming) {
                sessionModule.markStreaming(streamSessionId);
              }
            }

            if (data === '[DONE]') {
              _streamSawDone = true;
              // Always update background map if entry exists (even if user switched back)
              var bgDone = _backgroundStreams.get(streamSessionId);
              if (bgDone) {
                bgDone.status = 'completed';
                bgDone.accumulated = accumulated;
                if (_isBg) {
                  try {
                    _notifyStreamComplete(streamSessionId, streamQuery);
                    _insertStreamDoneToast(streamSessionId, streamQuery);
                  } catch (toastErr) {
                    console.warn('[bg-stream] Toast/notification error:', toastErr);
                  }
                }
                // CRITICAL: always mark stream complete for the sidebar dot
                try {
                  if (sessionModule && sessionModule.markStreamComplete) {
                    sessionModule.markStreamComplete(streamSessionId);
                  }
                } catch (dotErr) {
                  console.warn('[bg-stream] markStreamComplete error:', dotErr);
                }
                // Don't do foreground final render — the checkBackgroundStream poll
                // will detect 'completed' and reload history cleanly
                break;
              }
              // Force-close thinking if still open (model never output boundary)
              if (isThinking) {
                isThinking = false;
                cancelAnimationFrame(_thinkTimerRAF);
                var _elapsedDone = thinkingStartTime ? ((Date.now() - thinkingStartTime) / 1000).toFixed(1) : null;
                if (_elapsedDone) {
                  accumulated = accumulated.replace(/<think>/i, '<think time="' + _elapsedDone + '">');
                  roundText = roundText.replace(/<think>/i, '<think time="' + _elapsedDone + '">');
                }
                if (_liveThinkHeader) _liveThinkHeader.textContent = 'View thinking process';
                if (_liveThinkSpinnerSlot) _liveThinkSpinnerSlot.remove();
                if (_liveThinkTimerEl && _elapsedDone) {
                  _liveThinkTimerEl.textContent = _elapsedDone + 's';
                  _liveThinkTimerEl.style.marginLeft = 'auto';
                  _liveThinkTimerEl.style.marginRight = '5px';
                  var _hdrDone = _liveThinkTimerEl.closest('.thinking-header');
                  // Keep the chevron furthest right with the timer to its left
                  // (match the live + final-render layout) — insert before the
                  // toggle rather than appending (which would land after it).
                  if (_hdrDone) {
                    if (_liveThinkToggle && _liveThinkToggle.parentElement === _hdrDone)
                      _hdrDone.insertBefore(_liveThinkTimerEl, _liveThinkToggle);
                    else _hdrDone.appendChild(_liveThinkTimerEl);
                  }
                }
                // Assign stable IDs
                var _thinkIdDone = 'think-' + Date.now();
                var _liveHdrDone = _liveThinkSection && _liveThinkSection.querySelector('.thinking-header');
                if (_liveHdrDone) _liveHdrDone.dataset.thinkingId = _thinkIdDone;
                if (_liveThinkContent) _liveThinkContent.id = _thinkIdDone;
                if (_liveThinkToggle) _liveThinkToggle.id = _thinkIdDone + '-toggle';
                // Create live-reply container so final render preserves thinking bar
                var _streamElDone = _liveThinkSection ? _liveThinkSection.parentElement : roundHolder.querySelector('.stream-content');
                if (!_streamElDone) _streamElDone = roundHolder.querySelector('.body');
                if (_streamElDone && !_streamElDone.querySelector('.live-reply-content')) {
                  var _replyElDone = document.createElement('div');
                  _replyElDone.className = 'live-reply-content';
                  _streamElDone.appendChild(_replyElDone);
                }
              }
              // Normal foreground completion — metrics will be displayed in the final render block below
              break;
            }
            try {
              const json = JSON.parse(data);
              // Handle SSE error events (e.g. HTTP 404 from provider)
              if (_nextIsError || json.status >= 400) {
                _nextIsError = false;
                const rawErrMsg = json.text || json.error?.message || `Error ${json.status || 'unknown'}`;
                console.error('Stream error:', rawErrMsg);
                if (spinner && spinner.element) spinner.destroy();
                // Orwell #872 (item A): NEVER render a raw HTTP status / provider error into the GM
                // body bubble in the game build — an "Error 400" reads to the player as a literal
                // Big Brother / producer message. The provider (notably deepseek-v4-pro) intermittently
                // 400s on continuation/tool rounds; the player must never see the machinery. Surface a
                // diegetic line instead; the finally still FORCE-reconciles this bubble to the persisted
                // fallback (the agent loop saves a friendly message). Outside the game build (the general
                // assistant) keep the informative error so misconfig stays debuggable.
                const errMsg = isGameBuild()
                  ? "Big Brother cuts to a brief technical interlude… hang tight, we'll be right back."
                  : rawErrMsg;
                typewriterInto(roundHolder.querySelector('.body'), errMsg);
                // ADR 0012 (GAP 2): keep the immediate live feedback, but mark the turn so the finally
                // FORCE-reconciles this bubble to the persisted fallback — the agent loop saves a
                // friendly message (not the raw "Error 503"), so the sender must end on the SAME
                // persisted text a peer/reload shows (no two-windows-different-text on errors).
                _streamHadError = true;
                break;
              }
              if (json.delta || json.type === 'tool_start' || json.type === 'tool_output' || json.type === 'tool_progress' || json.type === 'agent_step' || json.type === 'doc_stream_open' || json.type === 'doc_stream_delta' || json.type === 'research_progress') {
                clearResponseTimeout();
                clearProcessingProbe();
              }
              if (json.delta) {
                _cancelThinkingTimer();
                _removeThinkingSpinner();
                // P1 (OOBE cutover): the house-entry narration is now streaming — clear the inline
                // "finalizing" indicator so it gives way to the actual move-in prose.
                if (_orwellFinalizingActive) {
                  _orwellFinalizingActive = false;
                  try { if (window._orwellFinalizing) window._orwellFinalizing.end(); } catch (_) {}
                }
                // Text arrived after tools — connect thread line to this bubble
                const _threadAbove = roundHolder?.previousElementSibling;
                if (_threadAbove && _threadAbove.classList.contains('agent-thread') && !_threadAbove.classList.contains('has-bottom')) {
                  _threadAbove.classList.add('has-bottom');
                }
                // VLLM reasoning tokens: wrap in <think> tags for the thinking UI.
                // Stateful open/close (not a whole-message substring check) so each round
                // of a multi-round agent response gets its own <think>…</think> — otherwise
                // only round 1 is wrapped and rounds 2+ reasoning leaks into the answer.
                let _delta = json.delta;
                // F8: split the RAW delta by channel BEFORE the <think>-wrapping below, so the
                // reply buffer carries zero reasoning/markup and the accordion buffer carries raw
                // reasoning. The BODY render reads roundReplyText → reasoning can't leak into it.
                if (json.thinking) roundReasoningText += json.delta;
                else               roundReplyText += json.delta;
                if (json.thinking) {
                  if (!_thinkOpen) { _delta = '<think>' + _delta; _thinkOpen = true; }
                } else if (_thinkOpen) {
                  _delta = '</think>' + _delta; _thinkOpen = false;
                }
                const wasEmpty = !accumulated;
                accumulated += _delta;
                roundText += _delta;
                currentAccumulated = accumulated; // Update global tracker
                // First token arrived — switch stop button from processing to streaming
                if (wasEmpty && submitBtn && !_isBg) {
                  submitBtn.dataset.phase = 'receiving';
                }

                // Update background map if running in background
                if (_isBg) {
                  var bgEntry = _backgroundStreams.get(streamSessionId);
                  if (bgEntry) bgEntry.accumulated = accumulated;
                  continue; // Skip all DOM writes
                }

                // --- Text-fence doc streaming (for models that don't use native tool calls) ---
                if (!_docFenceOpened && documentModule && roundText.includes('```create_document\n')) {
                  const fenceIdx = roundText.indexOf('```create_document\n');
                  const afterFence = roundText.slice(fenceIdx + '```create_document\n'.length);
                  const fenceLines = afterFence.split('\n');
                  if (fenceLines.length >= 1 && fenceLines[0].trim()) {
                    _docFenceOpened = true;
                    const title = fenceLines[0].trim();
                    // Keep in sync with backend _KNOWN_LANGS in src/tool_implementations.py
                    const knownLangs = ['python','py','javascript','js','typescript','ts','html','css','json','yaml','bash','sql','rust','go','java','c','cpp','markdown','text','plain','ruby','swift','kotlin','php','email','csv','xml','toml','ini'];
                    const isLang = fenceLines.length >= 2 && knownLangs.includes(fenceLines[1].trim().toLowerCase());
                    const lang = isLang ? fenceLines[1].trim() : '';
                    _docFenceContentStart = fenceIdx + '```create_document\n'.length + title.length + 1 + (isLang ? fenceLines[1].length + 1 : 0);
                    documentModule.streamDocOpen(title, lang);
                  }
                }
                if (_docFenceOpened && _docFenceContentStart > 0 && documentModule) {
                  let raw = roundText.slice(_docFenceContentStart);
                  const closeIdx = raw.indexOf('\n```');
                  if (closeIdx >= 0) raw = raw.slice(0, closeIdx);
                  documentModule.streamDocDelta(raw);
                }

                // Detect thinking-in-progress:
                // 1. Normal: <think>...no closing tag yet
                // 2. Malformed: <think></think>\n...text but no second </think> yet
                // 3. Qwen3.5: "Thinking Process:" without <think> tags
                let hasUnclosedThink = markdownModule.hasUnclosedThinkTag(roundText);
                // Detect non-tag thinking patterns: "Thinking:", "Thinking Process:", Gemma-style reasoning
                // These patterns don't use <think> tags, so we simulate unclosed thinking during streaming
                const _replyPrefixes = ['Hey', 'Hi ', 'Hi!', 'Hello', 'Sure', 'Yes', 'No ', 'No,', 'Yo', 'OK', 'Here', 'Absolutely', 'Of course', 'Great', 'Alright', 'Thanks', 'Welcome', 'Good ', "I'm happy", "I'd be"];
                if (!hasUnclosedThink && !/<(?:think(?:ing)?|thought)(?:\s+[^>]*)?>|<\|channel>thought/i.test(roundText)) {
                  const _trimmedRT = roundText.trimStart();
                  const _isReasoning = markdownModule.startsWithReasoningPrefix(_trimmedRT);
                  if (_isReasoning) {
                    // Check if we can see a reply boundary yet (newline then reply pattern)
                    const _lines = _trimmedRT.split('\n');
                    let _replyFound = false;
                    for (let li = 1; li < _lines.length; li++) {
                      const _l = _lines[li].trim();
                      if (!_l) continue;
                      if (_replyPrefixes.some(rp => _l.startsWith(rp))) {
                        _replyFound = true;
                        break;
                      }
                    }
                    if (!_replyFound) {
                      // Also check within-line: "reasoning text.Reply text"
                      const _inlineReply = _replyPrefixes.some(rp => {
                        const rx = new RegExp('[.!?]\\s*' + rp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
                        const m = rx.exec(_trimmedRT);
                        return m && m.index > 20;
                      });
                      if (!_inlineReply) hasUnclosedThink = true;
                    }
                  }
                }
                if (!hasUnclosedThink && /^<(?:think(?:ing)?|thought)(?:\s+[^>]*)?>\s*<\/(?:think(?:ing)?|thought)>/i.test(roundText)) {
                  // Empty <think></think> — the model likely put thinking outside the tags
                  const afterEmpty = roundText.replace(/^<(?:think(?:ing)?|thought)(?:\s+[^>]*)?>\s*<\/(?:think(?:ing)?|thought)>/i, '').trim();
                  const closeTags = (afterEmpty.match(/<\/(?:think(?:ing)?|thought)>/gi) || []).length;
                  if (closeTags === 0 && afterEmpty.length > 0) {
                    hasUnclosedThink = true; // still waiting for real closing tag
                  }
                }
                // Detect false close: <think>short</think> where real thinking follows untagged
                // Only applies when there's a second </think> later (model leaked thinking outside tags)
                // Do NOT trigger if the text after </think> contains tool calls (that's real content)
                if (!hasUnclosedThink && isThinking) {
                  const _thinkMatch = roundText.match(/<(?:think(?:ing)?|thought)(?:\s+[^>]*)?>([\s\S]*?)<\/(?:think(?:ing)?|thought)>/i);
                  const _thinkLen = _thinkMatch ? _thinkMatch[1].trim().length : 0;
                  if (_thinkLen < 20) {
                    const _afterClose = roundText.replace(/<(?:think(?:ing)?|thought)(?:\s+[^>]*)?>([\s\S]*?)<\/(?:think(?:ing)?|thought)>/i, '').trim();
                    // Only keep waiting if there's trailing text that looks like thinking (not tool calls)
                    const _hasToolCall = /```(?:bash|python|web_search|read_file|write_file|create_document|edit_document|manage_|generate_image)/i.test(_afterClose);
                    const _hasOrphanClose = /<\/(?:think(?:ing)?|thought)>/i.test(_afterClose);
                    if (!_hasToolCall && (_hasOrphanClose || (Date.now() - thinkingStartTime) < 500)) {
                      hasUnclosedThink = true; // keep waiting for real </think>
                    }
                  }
                }

                // GAME BUILD (2026-06-20 owner ruling): the model's reasoning must be
                // CLEANLY SEPARATED from the public bubble — never mixed in. Reasoning
                // streams into a condensed, DEFAULT-COLLAPSED "Thinking" accordion
                // (debug-viewable, expandable) while the public bubble carries ONLY the
                // in-character narration. The reasoning is Vault-free (the model receives
                // no secret state) so showing it collapsed for debug is safe; the reply
                // render below still scrubs any reasoning/draft that bled into content.
                // The shared live-think path (immediately below) already builds a
                // collapsed accordion — both the game build and the non-game build use it.
                // An operator may fully hide the accordion via `body.hide-thinking`.
                if (isGameBuild() && document.body.classList.contains('hide-thinking') &&
                    (hasUnclosedThink || isThinking)) {
                  if (hasUnclosedThink) {
                    if (!isThinking) {
                      isThinking = true;
                      thinkingStartTime = Date.now();
                      if (spinner && spinner.element) spinner.destroy();
                    }
                    // Operator hid the accordion — render nothing, just wait.
                    uiModule.scrollHistory();
                    continue;
                  }
                  // Reasoning just closed — drop back to normal streaming for the reply.
                  isThinking = false;
                  if (spinner && spinner.element) spinner.destroy();
                  _renderStream();
                  _scheduleThinkingSpinner();
                  if (streamingTTS) window.aiTTSManager.streamingUpdate(roundText);
                  continue;
                }

                if (hasUnclosedThink && !isThinking) {
                  isThinking = true;
                  thinkingStartTime = Date.now();
                  if (spinner && spinner.element) spinner.destroy();

                  // Create a live thinking box — starts expanded so content streams visibly
                  var thinkBody = roundHolder.querySelector('.body');
                  var thinkContent = _ensureStreamLayout(thinkBody);
                  thinkContent.style.minHeight = '';
                  _liveThinkDomId = 'live-think-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
                  thinkContent.innerHTML = `
                    <div class="thinking-section">
                      <div class="thinking-header" data-thinking-id="${_liveThinkDomId}">
                        <div class="thinking-header-left"><span class="live-think-header-text">Thinking\u2026</span></div>
                        <span class="live-think-spinner-slot" style="flex-shrink:0;margin-left:auto;"></span>
                        <span class="live-think-timer" style="font-size:11px;opacity:0.4;font-variant-numeric:tabular-nums;margin-left:6px;margin-right:5px;"></span>
                        <span class="thinking-toggle live-think-toggle" id="${_liveThinkDomId}-toggle"></span>
                      </div>
                      <div class="thinking-content" id="${_liveThinkDomId}">
                        <div class="thinking-content-inner live-think-inner"></div>
                      </div>
                    </div>`;
                  _liveThinkSection = thinkContent.querySelector('.thinking-section');
                  _liveThinkContent = thinkContent.querySelector('.thinking-content');
                  _liveThinkInner = thinkContent.querySelector('.live-think-inner');
                  _liveThinkHeader = thinkContent.querySelector('.live-think-header-text');
                  _liveThinkSpinnerSlot = thinkContent.querySelector('.live-think-spinner-slot');
                  _liveThinkTimerEl = thinkContent.querySelector('.live-think-timer');
                  _liveThinkToggle = thinkContent.querySelector('.live-think-toggle');
                  // Live timer
                  var _thinkTimerStart = Date.now();
                  var _thinkTimerRAF = 0;
                  function _tickThinkTimer() {
                    if (!_liveThinkTimerEl || !_liveThinkTimerEl.isConnected) return;
                    var s = ((Date.now() - _thinkTimerStart) / 1000).toFixed(1);
                    _liveThinkTimerEl.textContent = s + 's';
                    _thinkTimerRAF = requestAnimationFrame(_tickThinkTimer);
                  }
                  _thinkTimerRAF = requestAnimationFrame(_tickThinkTimer);
                  // Whirlpool spinner
                  if (_liveThinkSpinnerSlot) {
                    var _wp = spinnerModule.createWhirlpool(12);
                    _wp.element.style.margin = '0';
                    _wp.element.style.width = '12px';
                    _wp.element.style.height = '12px';
                    _wp.element.style.transform = 'translateY(-1px)'; // align the whirlpool with the header text
                    _liveThinkSpinnerSlot.appendChild(_wp.element);
                  }
                } else if (hasUnclosedThink && isThinking) {
                  if (_liveThinkInner) {
                    // F8: prefer the dedicated reasoning buffer (channel-flagged thinking:true —
                    // raw, no tag-strip needed). Fall back to stripping roundText for models whose
                    // reasoning arrives inline/untagged on the CONTENT channel (then the reasoning
                    // sits in roundText, and roundReasoningText is empty).
                    var thinkText = roundReasoningText.trim()
                      ? roundReasoningText
                      : roundText
                          .replace(/<\/?(?:think(?:ing)?|thought)(?:\s+[^>]*)?>/gi, '')
                          .replace(/<\|channel>thought\s*\n?/gi, '')
                          .replace(/<\|channel>response\s*\n?/gi, '')
                          .replace(/<channel\|>/gi, '');
                    thinkText = thinkText.replace(/^\s*Thinking(?:\s+Process)?:\s*/i, '');
                    _liveThinkInner.innerHTML = markdownModule.mdToHtml(thinkText);
                    // Keep thinking box scrolled to bottom
                    var thinkBox = _liveThinkInner.closest('.thinking-content');
                    if (thinkBox) thinkBox.scrollTop = thinkBox.scrollHeight;
                  }
                  uiModule.scrollHistory();
                  continue;
                } else if (!hasUnclosedThink && isThinking) {
                  isThinking = false;
                  var _thinkTextLen = _liveThinkInner ? _liveThinkInner.textContent.trim().length : 0;

                  // If thinking was trivially short (< 20 chars), remove the section entirely
                  // Models sometimes emit <think>The</think> or similar noise
                  if (_thinkTextLen < 20 && _liveThinkSection) {
                    _liveThinkSection.remove();
                    _liveThinkSection = null;
                    _liveThinkContent = null;
                    _liveThinkInner = null;
                    _liveThinkHeader = null;
                    _liveThinkSpinnerSlot = null;
                    _liveThinkTimerEl = null;
                    _liveThinkToggle = null;
                    _liveThinkDomId = null;
                    // Fall through to normal streaming
                    if (spinner && spinner.element) spinner.destroy();
                    _renderStream();
                    _scheduleThinkingSpinner();
                    continue;
                  }

                  // Thinking ended — smooth transition: update header, pause, then collapse
                  // Stop live timer and spinner
                  cancelAnimationFrame(_thinkTimerRAF);
                  var elapsed = thinkingStartTime ? ((Date.now() - thinkingStartTime) / 1000).toFixed(1) : null;
                  // Embed thinking time in the <think> tag for persistence on reload
                  if (elapsed) {
                    accumulated = accumulated.replace(/<think>/i, '<think time="' + elapsed + '">');
                    roundText = roundText.replace(/<think>/i, '<think time="' + elapsed + '">');
                  }
                  if (_liveThinkHeader) _liveThinkHeader.textContent = 'View thinking process';
                  if (_liveThinkSpinnerSlot) _liveThinkSpinnerSlot.remove();
                  // Move timer to right side of header
                  if (_liveThinkTimerEl && elapsed) {
                    _liveThinkTimerEl.textContent = elapsed + 's';
                    _liveThinkTimerEl.style.marginLeft = 'auto';
                    _liveThinkTimerEl.style.marginRight = '5px';
                    var _hdrRow = _liveThinkTimerEl.closest('.thinking-header');
                    // Chevron furthest right, timer to its left — insert before
                    // the toggle (appending would put the timer after it).
                    if (_hdrRow) {
                      if (_liveThinkToggle && _liveThinkToggle.parentElement === _hdrRow)
                        _hdrRow.insertBefore(_liveThinkTimerEl, _liveThinkToggle);
                      else _hdrRow.appendChild(_liveThinkTimerEl);
                    }
                  }

                  // Assign stable IDs (for click-toggle handler in markdown.js)
                  var _thinkId = 'think-' + Date.now();
                  var _liveHdr = _liveThinkSection && _liveThinkSection.querySelector('.thinking-header');
                  if (_liveHdr) _liveHdr.dataset.thinkingId = _thinkId;
                  if (_liveThinkContent) _liveThinkContent.id = _thinkId;
                  if (_liveThinkToggle) _liveThinkToggle.id = _thinkId + '-toggle';

                  // Append a container for the reply text that follows thinking
                  var _streamEl = _liveThinkSection ? _liveThinkSection.parentElement : roundHolder.querySelector('.stream-content');
                  if (!_streamEl) _streamEl = roundHolder.querySelector('.body');
                  if (_streamEl) {
                    var _replyEl = document.createElement('div');
                    _replyEl.className = 'live-reply-content';
                    _streamEl.appendChild(_replyEl);
                  }

                  // Render any reply text that arrived with the closing </think> token
                  _renderStream();
                } else {
                  // Normal streaming
                  if (spinner && spinner.element) spinner.destroy();
                  _renderStream();
                  _scheduleThinkingSpinner();
                  // Feed streaming TTS with accumulated text
                  if (streamingTTS) window.aiTTSManager.streamingUpdate(roundText);
                }
              } else if (json.type === 'research_progress') {
                if (_isBg) continue; // Skip DOM updates in background
                _researchingStreamIds.add(streamSessionId);
                // Highlight research button while running
                var _rToggle = document.getElementById('research-toggle-btn');
                if (_rToggle) _rToggle.classList.add('research-running');
                // Request notification permission on first research event
                if ('Notification' in window && Notification.permission === 'default') {
                  Notification.requestPermission();
                }
                // Mark session as researching in sidebar
                var _rSid = sessionModule && sessionModule.getCurrentSessionId();
                if (_rSid && sessionModule.markResearching) sessionModule.markResearching(_rSid);
                const rp = json.data;
                // Start research timer + synapse on first progress event
                if (!_researchTimerEl && spinner && spinner.element) {
                  _researchStartTime = rp.started_at ? rp.started_at * 1000 : Date.now();
                  _researchAvgDuration = rp.avg_duration || null;
                  _researchTimerEl = document.createElement('div');
                  _researchTimerEl.className = 'research-timer';
                  // Styles in .research-timer CSS class
                  spinner.element.parentNode.insertBefore(_researchTimerEl, spinner.element.nextSibling);
                  _researchTimerInterval = setInterval(() => {
                    if (!_researchTimerEl) return;
                    var elapsed = Math.floor((Date.now() - _researchStartTime) / 1000);
                    var mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
                    var ss = String(elapsed % 60).padStart(2, '0');
                    var txt = mm + ':' + ss;
                    if (_researchAvgDuration) {
                      var avgM = String(Math.floor(_researchAvgDuration / 60)).padStart(2, '0');
                      var avgS = String(Math.round(_researchAvgDuration % 60)).padStart(2, '0');
                      txt += ' / avg ' + avgM + ':' + avgS;
                    }
                    _researchTimerEl.textContent = txt;
                  }, 1000);
                  // Synapse visualization — insert right above the timer so
                  // it sits between the spinner message and the timer line.
                  try {
                    _researchSynapse = createResearchSynapse(spinner.element.parentNode, {
                      query: holder._researchQuery || rp.query || '',
                      startedAt: _researchStartTime,
                    });
                    // Move it to live between spinner and timer
                    if (_researchSynapse.element && _researchTimerEl) {
                      spinner.element.parentNode.insertBefore(_researchSynapse.element, _researchTimerEl);
                    }
                  } catch (e) { console.warn('synapse init failed', e); }
                }
                if (_researchSynapse) {
                  _researchSynapse.setPhase(rp.phase, rp);
                  if (typeof rp.round === 'number') _researchSynapse.setRound(rp.round);
                  if (typeof rp.total_sources === 'number') _researchSynapse.setSourceCount(rp.total_sources);
                  if (rp.phase === 'error') _researchSynapse.complete();
                }
                if (spinner && spinner.element) {
                  if (rp.phase === 'probing') {
                    spinner.updateMessage(`Verifying model: ${rp.model || '?'}`);
                  } else if (rp.phase === 'planning') {
                    spinner.updateMessage('Analyzing question & planning research strategy');
                  } else if (rp.phase === 'searching') {
                    const q = rp.queries ? `${rp.queries} queries` : '';
                    const s = rp.total_sources ? ` · ${rp.total_sources} sources` : '';
                    spinner.updateMessage(`Round ${rp.round || '?'}: Searching${q ? ' (' + q + ')' : ''}${s}`);
                  } else if (rp.phase === 'reading') {
                    spinner.updateMessage(rp.title ? `Reading: ${rp.title}` : `Round ${rp.round || '?'}: Reading ${rp.new_sources || ''} pages · ${rp.total_sources || 0} sources total`);
                  } else if (rp.phase === 'analyzing') {
                    spinner.updateMessage(`Round ${rp.round || '?'}: Analyzing ${rp.total_findings || 0} findings`);
                  } else if (rp.phase === 'writing') {
                    spinner.updateMessage(`Writing report · ${rp.total_sources || 0} sources`);
                  } else if (rp.phase === 'error') {
                    spinner.updateMessage(rp.message || 'Search error');
                  }
                }
              } else if (json.type === 'research_sources') {
                if (_isBg) {
                  // Store sources HTML in background map
                  if (json.data && json.data.length > 0) {
                    _sourcesHtml = _buildSourcesBox(json.data, 'research');
                    var bgE = _backgroundStreams.get(streamSessionId);
                    if (bgE) bgE.sourcesHtml = _sourcesHtml;
                  }
                  // Clear researching indicator for this background session
                  if (sessionModule && sessionModule.clearResearching) sessionModule.clearResearching(streamSessionId);
                  continue;
                }
                // Research done — clean up timer, show sources box, then spinner for LLM response
                _clearResearchTimer();
                holder._researchSources = json.data;
                var _rSid2 = sessionModule && sessionModule.getCurrentSessionId();
                if (_rSid2 && sessionModule.clearResearching) sessionModule.clearResearching(_rSid2);
                if (json.data && json.data.length > 0) {
                  _sourcesData = json.data; _sourcesType = 'research';
                  _sourcesHtml = _buildSourcesBox(json.data, 'research');
                }
                if (document.hidden) {
                  _notifyResearchComplete(_rSid2 || '', holder._researchQuery || '');
                }
              } else if (json.type === 'research_findings') {
                if (_isBg) {
                  var bgEf = _backgroundStreams.get(streamSessionId);
                  if (bgEf) bgEf.findingsData = json.data;
                  continue;
                }
                if (json.data && json.data.length > 0) {
                  _findingsData = json.data;
                }
              } else if (json.type === 'research_done') {
                // Research complete — reload session to show the persisted report
                _clearResearchTimer();
                if (sessionModule && sessionModule.clearResearching) {
                  sessionModule.clearResearching(streamSessionId);
                }
                _researchingStreamIds.delete(streamSessionId);
                // Small delay then reload session history which includes the full report
                setTimeout(async () => {
                  // Don't yank the user back to this chat if they've navigated
                  // away (e.g. started a new chat) while research finished —
                  // just refresh the sidebar so the report shows when they return.
                  if (sessionModule.getCurrentSessionId && sessionModule.getCurrentSessionId() === streamSessionId) {
                    await sessionModule.selectSession(streamSessionId);
                  } else {
                    await sessionModule.loadSessions();
                  }
                }, 500);
                continue;
              } else if (json.type === 'web_sources') {
                if (_isBg) {
                  if (json.data && json.data.length > 0) {
                    _sourcesHtml = _buildSourcesBox(json.data, 'web');
                    var bgE2 = _backgroundStreams.get(streamSessionId);
                    if (bgE2) bgE2.sourcesHtml = _sourcesHtml;
                  }
                  continue;
                }
                // Web search done — store sources for final render (don't render mid-stream)
                holder._webSources = json.data;
                if (json.data && json.data.length > 0) {
                  _sourcesData = json.data; _sourcesType = 'web';
                  _sourcesHtml = _buildSourcesBox(json.data, 'web');
                }
              } else if (json.type === 'model_fallback') {
                // Model went offline — switched to fallback
                var _fbData = json.data || {};
                uiModule.showToast(
                  `Model ${_fbData.old_model || '?'} offline — switched to ${_fbData.new_model || '?'}`,
                  5000
                );
                // Update the model picker to reflect the new model
                if (sessionModule && sessionModule.updateModelPicker) {
                  sessionModule.updateModelPicker();
                }
                continue;
              } else if (json.type === 'model_info') {
                // Update role label with model name as soon as we know it
                if (!_isBg && holder) {
                  const roleEl = holder.querySelector('.role');
                  if (roleEl) {
                    holder._requestedModel = json.requested_model || json.model || holder._requestedModel;
                    holder._actualModel = json.model || holder._actualModel || holder._requestedModel;
                    if (json.suffix) holder._roleSuffix = json.suffix;
                    // Prepend character name if sent by server or set locally
                    var _charName = json.character_name || (presetsModule.getCharacterName ? presetsModule.getCharacterName() : '');
                    if (_charName) holder._characterName = _charName;
                    _setRoleModelLabel(roleEl, holder._requestedModel, holder._actualModel, {
                      suffix: holder._roleSuffix,
                      characterName: holder._characterName,
                    });
                  }
                }
              } else if (json.type === 'fallback') {
                // The selected model failed and another provider answered. Make
                // it visible so a misconfigured provider is never silently
                // masked under the selected model's name.
                if (!_isBg) {
                  var _selM = _shortModel(json.selected_model || '');
                  var _ansM = _shortModel(json.answered_by || '');
                  uiModule.showToast('⚠ ' + _selM + ' failed — answered by ' + _ansM, 6000);
                  if (holder) {
                    var _rEl = holder.querySelector('.role');
                    if (_rEl) {
                      var _tsS = _rEl.querySelector('.role-timestamp');
                      // C14/immersion: in the game build the sender is the show, never a
                      // model name — even a provider fallback stays diegetic (the toast above
                      // still surfaces the misconfig out-of-fiction). _setRoleModelLabel below
                      // re-labels to "Big Brother" and strips the tooltip.
                      if (!isGameBuild()) {
                        _rEl.textContent = _ansM + ' (fallback) ';
                        _rEl.title = (json.selected_model || '') + ' failed' +
                          (json.reason ? ': ' + json.reason : '') + ' — answered by ' + (json.answered_by || '');
                      }
                      _applyModelColor(_rEl, json.answered_by);
                      if (_tsS) _rEl.appendChild(_tsS);
                      holder._requestedModel = json.selected_model || holder._requestedModel || modelName;
                      const _hasResolvedActual = holder._actualModel && !_sameModelName(holder._actualModel, holder._requestedModel);
                      holder._actualModel = _hasResolvedActual ? holder._actualModel : (json.answered_by || holder._actualModel || holder._requestedModel);
                      _setRoleModelLabel(_rEl, holder._requestedModel, holder._actualModel, {
                        suffix: holder._roleSuffix,
                        characterName: holder._characterName,
                        reason: json.reason,
                      });
                    }
                  }
                }
              } else if (json.type === 'rounds_exhausted') {
                // The agent hit the per-turn step limit while still working.
                // Offer a Continue button instead of stalling silently.
                // NOTE: append to the chat-history container (bottom), NOT the
                // message body — the body innerHTML is re-rendered at stream
                // finalize, which would wipe a note placed inside it.
                const _chatBox = document.getElementById('chat-history');
                if (!_isBg && _chatBox) {
                  // Drop any prior box so repeated cap-hits each get a fresh
                  // Continue at the bottom (multiple continues in a row).
                  const _old = _chatBox.querySelector('.rounds-exhausted');
                  if (_old) _old.remove();
                  const note = document.createElement('div');
                  note.className = 'stopped-indicator rounds-exhausted';
                  const label = document.createElement('span');
                  label.className = 'rounds-exhausted-label';
                  label.textContent = `Reached the ${json.rounds || ''}-step limit — not finished.`;
                  note.appendChild(label);
                  const contBtn = document.createElement('button');
                  contBtn.className = 'continue-btn';
                  contBtn.title = 'Continue the task';
                  contBtn.textContent = 'Continue ▸';
                  const _holder = currentHolder;
                  contBtn.addEventListener('click', () => {
                    note.remove();
                    _hideUserBubble = true;
                    _pendingContinue = _holder;
                    handleChatSubmit(null, 'You hit the step limit before finishing — the task is not complete. Continue from exactly where you left off and keep going until it is done. Do NOT repeat work already done.');
                  });
                  note.appendChild(contBtn);
                  _chatBox.appendChild(note);
                  try { note.scrollIntoView({ block: 'end', behavior: 'smooth' }); } catch (_) { uiModule.scrollHistory && uiModule.scrollHistory(); }
                }
              } else if (json.type === 'truncated') {
                // F-S4-D: the reply was cut off by the model's OUTPUT token cap (finish_reason "length"),
                // not the step limit — it stopped mid-sentence. Offer a Continue affordance (mirrors
                // rounds_exhausted) so the player can resume instead of the truncation passing silently.
                // Appended to the chat-history container (bottom), NOT the message body — the body is
                // re-rendered at stream finalize, which would wipe a note placed inside it.
                const _chatBox = document.getElementById('chat-history');
                if (!_isBg && _chatBox) {
                  const _old = _chatBox.querySelector('.response-truncated');
                  if (_old) _old.remove();
                  const note = document.createElement('div');
                  note.className = 'stopped-indicator response-truncated';
                  const label = document.createElement('span');
                  label.className = 'rounds-exhausted-label';
                  label.textContent = 'The response was cut off before it finished.';
                  note.appendChild(label);
                  const contBtn = document.createElement('button');
                  contBtn.className = 'continue-btn';
                  contBtn.title = 'Continue the response';
                  contBtn.textContent = 'Continue ▸';
                  const _holder = currentHolder;
                  contBtn.addEventListener('click', () => {
                    note.remove();
                    _hideUserBubble = true;
                    _pendingContinue = _holder;
                    handleChatSubmit(null, 'Your previous response was cut off before it finished. Continue from exactly where you left off — do NOT repeat what you already wrote.');
                  });
                  note.appendChild(contBtn);
                  _chatBox.appendChild(note);
                  try { note.scrollIntoView({ block: 'end', behavior: 'smooth' }); } catch (_) { uiModule.scrollHistory && uiModule.scrollHistory(); }
                }
              } else if (json.type === 'model_actual') {
                if (!_isBg && holder) {
                  holder._requestedModel = json.requested_model || holder._requestedModel || modelName;
                  holder._actualModel = json.model || holder._actualModel || holder._requestedModel;
                  _setRoleModelLabel(holder.querySelector('.role'), holder._requestedModel, holder._actualModel, {
                    suffix: holder._roleSuffix,
                    characterName: holder._characterName,
                  });
                }
              } else if (json.type === 'attachments') {
                if (_isBg) continue;
                // Update user bubble — replace file chips with image previews
                const _ub = document.querySelector('#chat-history .msg-user:last-of-type');
                if (_ub) {
                  const _aw = _ub.querySelector('.attach-cards');
                  if (_aw) {
                    for (const _att of json.data) {
                      const _isImg = (_att.mime || '').startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i.test(_att.name || '');
                      if (_isImg && _att.id) {
                        // Skip if we already have a preview for this file id —
                        // on a regenerate the original user bubble keeps its
                        // photo and the backend re-emits the attachment event
                        // for the same id; without this guard we'd append a
                        // duplicate (which visually pushes the real photo off).
                        const _existingPreview = _aw.querySelector('[data-file-id="' + _att.id + '"]');
                        if (_existingPreview) {
                          if (_att.vision_model && !_existingPreview.querySelector('.attach-vision-model')) {
                            const _vl = document.createElement('div');
                            _vl.className = 'attach-vision-model';
                            _vl.textContent = 'Vision: ' + String(_att.vision_model).split('/').pop();
                            const _name = _existingPreview.querySelector('.attach-image-name');
                            if (_name) _existingPreview.insertBefore(_vl, _name);
                            else _existingPreview.appendChild(_vl);
                          }
                          continue;
                        }
                        const _card = _aw.querySelector('.attach-card[data-name="' + (_att.name || '').replace(/"/g, '\\"') + '"]');
                        const _iw = document.createElement('div');
                        _iw.className = 'attach-image-preview';
                        _iw.dataset.fileId = _att.id;
                        _iw.style.cursor = 'pointer';
                        _iw.onclick = () => window.open(API_BASE + '/api/upload/' + _att.id, '_blank');
                        const _im = document.createElement('img');
                        _im.src = API_BASE + '/api/upload/' + _att.id;
                        _im.alt = _att.name || 'Image';
                        _im.style.cssText = 'max-width:300px;max-height:200px;border-radius:6px;display:block;';
                        _iw.appendChild(_im);
                        if (_att.vision_model) {
                          const _vl = document.createElement('div');
                          _vl.className = 'attach-vision-model';
                          _vl.textContent = 'Vision: ' + String(_att.vision_model).split('/').pop();
                          _iw.appendChild(_vl);
                        }
                        if (_att.name) {
                          const _nm = document.createElement('div');
                          _nm.className = 'attach-image-name';
                          _nm.textContent = _att.name;
                          _iw.appendChild(_nm);
                        }
                        if (_card) _card.replaceWith(_iw); else _aw.appendChild(_iw);
                      } else {
                        const _card = _aw.querySelector('.attach-card[data-name="' + (_att.name || '').replace(/"/g, '\\"') + '"]');
                        if (_card && _att.id) {
                          _card.dataset.fileId = _att.id;
                          _card.style.cursor = 'pointer';
                          _card.onclick = () => window.open(API_BASE + '/api/upload/' + _att.id, '_blank');
                        }
                      }
                    }
                  }
                  // Caption / OCR text is no longer rendered as an inline
                  // collapsible on the user bubble — the user can view/edit
                  // it via the "Caption" button on the photo thumbnail.
                }
              } else if (json.type === 'rag_sources') {
                if (_isBg) continue;
                holder._ragSources = json.data;
              } else if (json.type === 'memories_used') {
                if (_isBg) continue;
                holder._memoriesUsed = json.data;
              } else if (json.type === 'compacted') {
                if (!_isBg) {
                  uiModule.showToast('Context compacted — older messages summarized');
                }
              } else if (json.type === 'metrics') {
                metrics = json.data;
                if (!_isBg && holder && metrics) {
                  holder._requestedModel = metrics.requested_model || holder._requestedModel || modelName;
                  holder._actualModel = metrics.model || holder._actualModel || holder._requestedModel;
                }
                if (_isBg) {
                  var bgM = _backgroundStreams.get(streamSessionId);
                  if (bgM) bgM.metrics = json.data;
                  continue;
                }

              } else if (json.type === 'message_saved') {
                // Wire the persisted DB id onto the just-streamed bubble so it
                // can be edited/deleted immediately, without reloading the chat.
                if (_isBg) continue;
                _sawMessageSaved = true;   // BUG 2: the turn persisted a message — not the empty-turn case
                if (currentHolder && json.id) currentHolder.dataset.dbId = json.id;
                // ADR 0012 §2.2/§3.3: adopt the SERVER-minted timestamp so every window (sender,
                // observer, a late reload) renders the IDENTICAL time string instead of each window's
                // own `new Date()` (which drifts). Overwrite the speculative role-timestamp the bubble
                // was created with; the settled render (reload/addMessage) is already server-sourced.
                if (json.ts && currentHolder) _applyServerTimestamp(currentHolder, json.ts);

              } else if (json.type === 'canonical_session') {
                // ADR 0012 §2.4: the loser-of-the-bind window — it POSTed under its own per-tab id but
                // the authoritative run lives under the canonical game session. The server has already
                // fanned this run's buffer to us; we just need to RE-KEY this window onto canonical so
                // its SSE/HUD/reconcile follow the shared game. Defensive belt — the sessions.js
                // canonical ladder converges most windows BEFORE they POST; this catches one that
                // didn't. Record it and converge AFTER the stream settles (a mid-stream selectSession
                // would reload history out from under the live bubble); _adoptCanonicalAfterStream is
                // consumed in the finally.
                if (_isBg) continue;
                if (json.id) _adoptCanonicalAfterStream = json.id;

              } else if (json.type === 'tool_start') {
                if (_isBg) continue;
                _cancelThinkingTimer();
                _removeThinkingSpinner();
                // Force-close thinking if still open — tools are real content, not thinking
                if (isThinking) {
                  isThinking = false;
                  cancelAnimationFrame(_thinkTimerRAF);
                  var _elapsed2 = thinkingStartTime ? ((Date.now() - thinkingStartTime) / 1000).toFixed(1) : null;
                  if (_liveThinkHeader) _liveThinkHeader.textContent = 'View thinking process';
                  if (_liveThinkTimerEl) _liveThinkTimerEl.textContent = _elapsed2 ? _elapsed2 + 's' : '';
                  if (_liveThinkSpinnerSlot) _liveThinkSpinnerSlot.remove();
                  // Assign stable IDs
                  var _thinkId2 = 'think-' + Date.now();
                  var _liveHdr2 = _liveThinkSection && _liveThinkSection.querySelector('.thinking-header');
                  if (_liveHdr2) _liveHdr2.dataset.thinkingId = _thinkId2;
                  if (_liveThinkContent) _liveThinkContent.id = _thinkId2;
                  if (_liveThinkToggle) _liveThinkToggle.id = _thinkId2 + '-toggle';
                }
                _renderStream();
                // --- Finalize current text bubble (only once per round) ---
                if (!roundFinalized) {
                  roundFinalized = true;
                  if (spinner && spinner.element) spinner.destroy();
                  const dt = stripToolBlocks(roundReplyText);  // F8: reply-only (reasoning → accordion)
                  // L6c (supersedes L6b): a round that produced VISIBLE narration is the player's
                  // dialogue (the casting interviewer's lines, a scene beat) — KEEP it even when a
                  // tool follows. Only a truly-EMPTY tool-only round is hidden. The old L6b rule hid
                  // every intermediate round in the game build, which structurally lost a multi-line
                  // interview ("4 answers go away" — prod casting loop). `dt` is reply-only (reasoning
                  // → accordion) and game-build scrubbed by processWithThinking (scrubReasoningPreamble
                  // strips planning preambles / raw npc:<id>), so a planning round still scrubs down
                  // (often to empty → hidden) without losing real narration. Game + non-game identical.
                  if (dt.trim()) {
                    var _body3 = roundHolder.querySelector('.body');
                    var _contentEl3 = _ensureStreamLayout(_body3);
                    _contentEl3.style.minHeight = '';  // clear streaming inflate
                    _contentEl3.innerHTML = markdownModule.processWithThinking(markdownModule.squashOutsideCode(dt));
                    if (window.hljs) roundHolder.querySelectorAll('pre code').forEach((b) => window.hljs.highlightElement(b));
                  } else {
                    roundHolder.style.display = 'none';
                  }
                }

                // Track tool name for contextual spinner labels
                _lastToolName = json.tool || '';

                // ADR 0011 — drop pure context-read beats in the game build (see orwellToolBeats):
                // they change nothing the player witnessed and otherwise stack as a wall of identical
                // "Production notes" chips on a long / concurrent-re-ground turn. No chip, no thread
                // node; currentToolBubble=null so the paired tool_output is skipped (the next real
                // beat re-arms it). The non-game build is unaffected.
                if (orwellBeatIsSilent(json.tool) && isGameBuild()) {
                  currentToolBubble = null;
                  continue;
                }

                // --- Thread timeline: group tools in a thread container ---
                let cmd = json.command || '';
                const chatBox = document.getElementById('chat-history');
                // Find existing thread to append to — check last few children
                // (agent_step may insert an empty msg-ai between tool rounds)
                let threadWrap = null;
                for (let ci = chatBox.children.length - 1; ci >= Math.max(0, chatBox.children.length - 5); ci--) {
                  const child = chatBox.children[ci];
                  if (child.classList.contains('agent-thread')) {
                    threadWrap = child;
                    break;
                  }
                  // Skip hidden (empty) bubbles and thinking spinners
                  if (child.style.display === 'none' || child.classList.contains('agent-thinking-dots')) continue;
                  // Stop if we hit a visible message bubble (has real content between tools)
                  if (child.classList.contains('msg')) break;
                }
                if (threadWrap) {
                  // Continuing an existing thread — remove has-bottom (agent_step may have set it
                  // expecting text, but we got more tools instead)
                  threadWrap.classList.remove('has-bottom');
                } else {
                  threadWrap = document.createElement('div');
                  threadWrap.className = 'agent-thread';
                  // Extend line up to connect to chat bubble above (if there is one)
                  const _prevSib = chatBox.lastElementChild;
                  const _hasBubbleAbove = _prevSib && (_prevSib.classList.contains('msg') && _prevSib.style.display !== 'none');
                  const _hasThreadAbove = _prevSib && _prevSib.classList.contains('agent-thread');
                  if (_hasBubbleAbove || _hasThreadAbove || (roundText.trim() && roundHolder && roundHolder.style.display !== 'none')) {
                    threadWrap.classList.add('has-top');
                  }
                  chatBox.appendChild(threadWrap);
                }
                threadWrap.classList.add('streaming');
                const _beat = _orwellToolBeats[json.tool];
                const toolLabel = _beat || _toolLabels[json.tool.toLowerCase()] || json.tool;
                if (_beat) cmd = '';  // production machinery: never show raw args
                const node = document.createElement('div')
                node.className = 'agent-thread-node running';
                const cmdHtml = cmd ? `<pre class="agent-thread-cmd">${esc(cmd)}</pre>` : '';
                node.innerHTML = `<div class="agent-thread-dot"></div><div class="agent-thread-header"><span class="agent-thread-icon">\u25B6</span><span class="agent-thread-tool">${esc(toolLabel)}</span><span class="agent-thread-wave">▁▂▃</span></div><div class="agent-thread-content">${cmdHtml}</div>`;
                // Expand/collapse via delegated click handler (init at module bottom).
                threadWrap.appendChild(node);
                // ADR 0011 — cap the rail (backstop; a normal turn never hits it). Keep the most
                // recent ORWELL_MAX_VISIBLE_BEATS nodes; drop older overflow. The running node is the
                // newest (never dropped); the dropped ones are solidified (timers cleared on
                // tool_output — we clear defensively anyway).
                const _railNodes = threadWrap.querySelectorAll('.agent-thread-node');
                for (let _ri = 0; _ri < _railNodes.length - ORWELL_MAX_VISIBLE_BEATS; _ri++) {
                  const _oldN = _railNodes[_ri];
                  if (_oldN._waveInterval) clearInterval(_oldN._waveInterval);
                  if (_oldN._elapsedTicker) clearInterval(_oldN._elapsedTicker);
                  _oldN.remove();
                }
                currentToolBubble = node;
                // Animate the wave
                const waveEl = node.querySelector('.agent-thread-wave');
                if (waveEl) {
                  const waveFrames = ['▁▂▃', '▂▃▄', '▃▄▅', '▄▅▆', '▅▆▇', '▆▅▄', '▅▄▃', '▄▃▂'];
                  let waveIdx = 0;
                  node._waveInterval = setInterval(() => {
                    waveIdx = (waveIdx + 1) % waveFrames.length;
                    waveEl.textContent = waveFrames[waveIdx];
                  }, 100);
                }
                // Smooth per-second "cooking" timer — ticks every second (not
                // just on the 2s backend heartbeat) so a long-running tool
                // always shows visible motion and never reads as frozen.
                node._startTime = Date.now();
                node._elapsedTicker = setInterval(() => {
                  const hdr2 = node.querySelector('.agent-thread-header');
                  if (!hdr2) return;
                  let el2 = hdr2.querySelector('.agent-thread-elapsed');
                  if (!el2) {
                    el2 = document.createElement('span');
                    el2.className = 'agent-thread-elapsed';
                    // Sits on the LEFT, right after the icon.
                    const icon = hdr2.querySelector('.agent-thread-icon');
                    if (icon && icon.nextSibling) hdr2.insertBefore(el2, icon.nextSibling);
                    else hdr2.appendChild(el2);
                  }
                  const s = (Date.now() - node._startTime) / 1000;
                  // Hundredths so it visibly counts sub-second (1.00, 1.05, …).
                  el2.textContent = s < 60 ? `${s.toFixed(2)}s` : `${Math.floor(s / 60)}m ${(s % 60).toFixed(2).padStart(5, '0')}s`;
                }, 50);
                uiModule.scrollHistory();

              } else if (json.type === 'tool_progress') {
                // Long-running subprocess (bash, python) is still in
                // flight — refresh the running tool card with the
                // elapsed-time + tail of its stdout/stderr so the
                // user doesn't stare at a blind "Running…" spinner.
                if (_isBg) continue;
                if (!currentToolBubble) continue;
                // The per-second ticker (started in tool_start) owns the
                // elapsed display; here we just surface the live output tail.
                const tailStr = (json.tail || '').trim();
                if (tailStr) {
                  let tailEl = currentToolBubble.querySelector('.agent-thread-tail');
                  if (!tailEl) {
                    tailEl = document.createElement('pre');
                    tailEl.className = 'agent-thread-tail';
                    tailEl.style.cssText = 'margin:4px 0 0;padding:6px 8px;font-size:11px;background:rgba(0,0,0,0.18);border-radius:4px;max-height:140px;overflow:auto;white-space:pre-wrap;opacity:0.85;';
                    const content = currentToolBubble.querySelector('.agent-thread-content');
                    if (content) content.appendChild(tailEl);
                  }
                  tailEl.textContent = tailStr;
                  tailEl.scrollTop = tailEl.scrollHeight;
                }
                uiModule.scrollHistory();

              } else if (json.type === 'tool_output') {
                if (_isBg) continue;
                // --- Update the current thread node ---
                if (currentToolBubble) {
                  // Stop wave animation + the per-second cooking ticker
                  if (currentToolBubble._waveInterval) {
                    clearInterval(currentToolBubble._waveInterval);
                    currentToolBubble._waveInterval = null;
                  }
                  if (currentToolBubble._elapsedTicker) {
                    clearInterval(currentToolBubble._elapsedTicker);
                    currentToolBubble._elapsedTicker = null;
                  }
                  const ok = (json.exit_code === 0 || json.exit_code == null);
                  let cmd = json.command || '';
                  let outHtml = '';
                  if (json.output && json.output.trim()) {
                    outHtml = `<details class="agent-tool-output"><summary>Output</summary><pre>${esc(json.output)}</pre></details>`;
                  }
                  // File-write diff (write_file): show a before/after unified diff.
                  let diffHtml = '';
                  if (json.diff && json.diff.text) {
                    const d = json.diff;
                    // Collapsed summary: filename + +adds (green) / −dels (red).
                    const stat = [
                      d.new_file ? '<span class="diff-stat-new">new</span>' : '',
                      d.added ? `<span class="diff-stat-add">+${d.added}</span>` : '',
                      d.removed ? `<span class="diff-stat-del">−${d.removed}</span>` : '',
                    ].filter(Boolean).join(' ');
                    const rows = d.text.split('\n').map(line => {
                      let cls = 'diff-ctx', text = line;
                      if (line.startsWith('+++') || line.startsWith('---')) cls = 'diff-meta';
                      else if (line.startsWith('@@')) cls = 'diff-hunk';
                      // Drop the leading diff marker (+/-/space) — the row colour
                      // already encodes add/del, and keeping it doubles up with
                      // markdown "- " bullets (reads as "+-"/"--").
                      else if (line.startsWith('+')) { cls = 'diff-add'; text = line.slice(1); }
                      else if (line.startsWith('-')) { cls = 'diff-del'; text = line.slice(1); }
                      else if (line.startsWith(' ')) { text = line.slice(1); }
                      return `<span class="${cls}">${esc(text) || '&nbsp;'}</span>`;
                    }).join('');  // spans are display:block — a literal \n here would double-space the diff
                    diffHtml = `<details class="agent-tool-output agent-tool-diff"><summary><span class="diff-file">${esc(d.file || 'diff')}</span> <span class="diff-summary-stats">${stat}</span></summary><pre class="diff-pre">${rows}</pre></details>`;
                  }
                  // For file edits the "command" is the raw JSON args — redundant
                  // next to the diff, so hide it when we have a diff to show.
                  const _beatOut = _orwellToolBeats[json.tool];
                  if (_beatOut) { cmd = ''; outHtml = ''; }  // game beats: label + status only, no raw JSON
                  // C20: surface the engine's pending decision (or clear it) to the confirm
                  // guardrail. Vault-free AdvanceView only; fail-open on any parse trouble.
                  if (json.tool === 'advanceGame' || json.tool === 'submitDecision') {
                    try {
                      const _adv = JSON.parse(json.output || '{}');
                      window.dispatchEvent(new CustomEvent('orwell:pending', { detail: { pending: _adv && _adv.pending ? _adv.pending : null } }));
                    } catch (_) {}
                  }
                  // G15: every game-MUTATING tool result nudges the panels through THE one
                  // debounced dispatcher (platform.js orwellGameChanged) — post-action UI
                  // refreshes event-driven instead of waiting out a 20–30s poll. (E65's
                  // inline dispatch was nested inside the advanceGame/submitDecision branch
                  // above, so the lifecycle tools it keyed on could never reach it.)
                  // runCompetition rides along: it is the single outcome authority, and a
                  // comp result moves exactly what the status HUD shows (HOH/veto/phase).
                  // FEJS-3: the trailing 8 also move public state the panels read — debounced.
                  if (ok && ['advanceGame', 'submitDecision', 'recordInteraction', 'createCharacter', 'updateCasting', 'manageSandbox', 'runCompetition', 'moveTo', 'moveHouseguest', 'makeDeal', 'markHouseguestMet', 'turnIn', 'surfaceInformationTo', 'diaryRoom', 'recordImageBeat'].includes(json.tool)) {
                    if (window.orwellGameChanged) window.orwellGameChanged('tool:' + json.tool);
                    if (json.tool === 'createCharacter') {
                      // E65: a season RESTART opens a FRESH chat (armed only by reset-progress /
                      // next-season); NO-OP for the initial onboarding — it stays ONE conversation.
                      if (window._orwellFreshSession) window._orwellFreshSession();
                      // P1 (OOBE cutover): paint the inline "finalizing" indicator — createCharacter
                      // → house-entry is a heavy beat that must never read as frozen (cleared by the
                      // first narration token in the json.delta path, with a finally-block safety net).
                      try { if (window._orwellFinalizing) { _orwellFinalizingActive = true; window._orwellFinalizing.begin(); } } catch (_) {}
                    }
                  }
                  const cmdHtml2 = (cmd && !(json.diff && json.diff.text)) ? `<pre class="agent-thread-cmd">${esc(cmd)}</pre>` : '';
                  // L7: a node is only EXPANDABLE when it has real content (command,
                  // output, or diff). A production beat (and any tool that returned
                  // nothing) has an empty content area, so rendering a chevron +
                  // collapsible affordance is a worthless click target. Render the
                  // chevron + content div ONLY when there is something to expand;
                  // otherwise mark the node --flat (a plain label, no expander).
                  const _expandHtml = `${cmdHtml2}${outHtml}${diffHtml}`;
                  const _hasExpand = !!_expandHtml.trim();
                  const _chevron2 = _hasExpand ? '<span class="agent-thread-chevron">\u25B6</span>' : '';
                  const _contentDiv2 = _hasExpand ? `<div class="agent-thread-content">${_expandHtml}</div>` : '';
                  // Preserve the user's .open choice across the innerHTML
                  // rewrite \u2014 otherwise expanding a running tool collapses
                  // it as soon as the result lands, forcing the user to
                  // click again. Click handling is delegated (see init at
                  // bottom of file) so no per-node listener needed.
                  const _wasOpen = _hasExpand && currentToolBubble.classList.contains('open');
                  currentToolBubble.className = 'agent-thread-node' + (ok ? '' : ' error') + (_hasExpand ? '' : ' agent-thread-node--flat') + (_wasOpen ? ' open' : '');
                  // L42: in the game build, show the beat's PUBLIC OUTCOME (Vault-free, from the tool
                  // result) instead of a generic "done" \u2014 "\ud83d\uddf3\ufe0f Troy is evicted (7-1)", "\ud83c\udfc6 Maya wins HOH".
                  const _outcome = (_beatOut && ok) ? orwellBeatOutcome(json.tool, json.output) : null;
                  const _toolText = _outcome || _beatOut || json.tool;
                  const _statusHtml = _outcome ? '' : `<span class="agent-thread-status">${ok ? 'done' : 'failed'}</span>`;
                  currentToolBubble.innerHTML = `<div class="agent-thread-dot"></div><div class="agent-thread-header"><span class="agent-thread-icon">${ok ? '\u2713' : '\u2717'}</span><span class="agent-thread-tool">${esc(_toolText)}</span>${_statusHtml}${_chevron2}</div>${_contentDiv2}`;
                  // Reset so thinking spinner between tools says "Thinking" not the old tool's label
                  _lastToolName = '';
                  uiModule.scrollHistory();
                }
                // --- Render generated images inline ---
                if (json.image_url) {
                  _producedVisibleOutput = true;  // BUG 2: an image IS a real turn artifact
                  const chatBox = document.getElementById('chat-history');
                  chatBox.appendChild(_buildImageBubble(json.image_url, json.image_prompt, json.image_model, json.image_size, json.image_quality, json.image_id));
                  uiModule.scrollHistory();
                  // Notify gallery to refresh if open
                  window.dispatchEvent(new CustomEvent('gallery-refresh'));
                }
                // --- Render browser screenshots in tool output ---
                if (json.screenshot && currentToolBubble) {
                  const contentEl = currentToolBubble.querySelector('.agent-thread-content');
                  if (contentEl) {
                    const screenshotSrc = chatRenderer.safeToolScreenshotSrc(json.screenshot);
                    if (screenshotSrc) {
                      const details = document.createElement('details');
                      details.className = 'agent-tool-output';
                      const summary = document.createElement('summary');
                      summary.textContent = 'Screenshot';
                      const img = document.createElement('img');
                      img.src = screenshotSrc;
                      img.style.cssText = 'max-width:100%;border-radius:6px;margin-top:6px;border:1px solid var(--border)';
                      details.appendChild(summary);
                      details.appendChild(img);
                      contentEl.appendChild(details);
                    }
                  }
                }
                // --- Reload sessions after manage_session tool (delete, rename, etc.) ---
                // Debounce so bulk deletes don't fire loadSessions per call
                if (json.tool === 'manage_session' && sessionModule) {
                  if (window._manageSessionTimer) clearTimeout(window._manageSessionTimer);
                  window._manageSessionTimer = setTimeout(() => sessionModule.loadSessions(), 1000);
                }
                // --- Live-refresh the calendar after manage_calendar (add/edit/delete) ---
                // so a new event shows without the user hard-refreshing. Debounced
                // so a batch of event creates only triggers one refetch.
                if (json.tool === 'manage_calendar') {
                  if (window._manageCalTimer) clearTimeout(window._manageCalTimer);
                  window._manageCalTimer = setTimeout(
                    () => window.dispatchEvent(new CustomEvent('calendar-refresh')), 600);
                }
                // --- Live-refresh Memories after manage_memory changes ---
                if (json.tool === 'manage_memory') {
                  if (window._manageMemoryTimer) clearTimeout(window._manageMemoryTimer);
                  window._manageMemoryTimer = setTimeout(
                    () => window.dispatchEvent(new CustomEvent('memory-refresh')), 600);
                }
                // --- Apply UI control actions embedded in tool_output ---
                if (json.ui_event) {
                  chatStream.handleUIControl(json);
                }

                // Schedule a thinking spinner between tool rounds (short delay so
                // agent_step in the same SSE chunk can cancel it before it shows)
                _scheduleThinkingSpinner();
                uiModule.scrollHistory();

              } else if (json.type === 'doc_stream_open') {
                if (_isBg) {
                  // Store for replay when user returns to this session
                  var bgDocOpen = _backgroundStreams.get(streamSessionId);
                  if (bgDocOpen) {
                    bgDocOpen._docTitle = json.title || '';
                    bgDocOpen._docLang = json.language || '';
                    bgDocOpen._docContent = '';
                  }
                  continue;
                }
                if (documentModule) {
                  documentModule.streamDocOpen(json.title || '', json.language || '');
                }

              } else if (json.type === 'doc_stream_delta') {
                if (_isBg) {
                  var bgDocDelta = _backgroundStreams.get(streamSessionId);
                  if (bgDocDelta) bgDocDelta._docContent = json.content || '';
                  continue;
                }
                if (documentModule) {
                  documentModule.streamDocDelta(json.content || '');
                }

              } else if (json.type === 'doc_update') {
                // doc_update means the server already saved the doc to DB.
                if (_isBg) continue;
                if (documentModule) {
                  documentModule.handleDocUpdate(json);
                }

              } else if (json.type === 'doc_suggestions') {
                if (_isBg) continue;
                if (documentModule && documentModule.handleDocSuggestions) {
                  documentModule.handleDocSuggestions(json);
                }

              } else if (json.type === 'ui_control') {
                if (_isBg) continue;
                chatStream.handleUIControl(json.data || {});

              } else if (json.type === 'orwell_pending') {
                // F14 (#1013): the SURFACE-THE-PENDING belt. The engine is waiting on a player-owned
                // decision (e.g. the eviction goodbye/vote card), but the model narrated past it
                // WITHOUT calling submitDecision/advanceGame — so the per-tool `orwell:pending` seam at
                // the tool-result path never fired and the card would otherwise wait out the poll. The
                // server-side belt detected the open player pending post-turn and emits it here so the
                // card SURFACES immediately. This only SURFACES the decision card — it never picks the
                // player's tone/vote (the player still resolves it through the card's engine-direct POST).
                if (_isBg) continue;
                try {
                  const _p = (json.pending && json.pending.kind) ? json.pending : null;
                  window.dispatchEvent(new CustomEvent('orwell:pending', { detail: { pending: _p } }));
                } catch (_) {}

              } else if (json.type === 'ask_user') {
                if (_isBg) continue;
                _producedVisibleOutput = true;  // BUG 2: an ask_user prompt IS a real turn artifact
                // The agent posed a multiple-choice question; the turn has ended.
                // Render clickable options at the bottom of the history. The
                // user's pick is sent as the next message and the agent resumes.
                _cancelThinkingTimer();
                _removeThinkingSpinner();
                const _aq = json.data || {};
                const _opts = Array.isArray(_aq.options) ? _aq.options : [];
                if (_aq.question && _opts.length) {
                  const chatBox = document.getElementById('chat-history');
                  // Drop any prior unanswered card so only the latest shows.
                  chatBox.querySelectorAll('.ask-user-card').forEach(n => n.remove());
                  const card = document.createElement('div');
                  card.className = 'ask-user-card';
                  const multi = !!_aq.multi;
                  // Group the choices for assistive tech and label the group with
                  // the question (set below); make the card focusable so it can be
                  // moved to when it appears.
                  card.setAttribute('role', 'group');
                  card.tabIndex = -1;
                  // Render any emoji in agent-supplied text through the app's
                  // pipeline: escape, then svgify to monochrome theme-tinted
                  // glyphs (project rule: never colorful emoji; respects the
                  // "Text-only Emojis" setting like the rest of the chat).
                  const _emo = (s) => svgifyEmoji(uiModule.esc(String(s)));

                  // Header row holds the close (×) to dismiss the affordances and
                  // just type a reply instead.
                  const head = document.createElement('div');
                  head.className = 'ask-user-head';
                  const closeBtn = document.createElement('button');
                  closeBtn.type = 'button';
                  closeBtn.className = 'modal-close ask-user-close';
                  closeBtn.setAttribute('aria-label', 'Dismiss question');
                  closeBtn.textContent = '×';
                  closeBtn.addEventListener('click', () => {
                    card.remove();
                    const mi = uiModule.el('message');
                    if (mi) mi.focus();
                  });
                  head.appendChild(closeBtn);
                  card.appendChild(head);

                  // Render the question inside the card so it's self-contained:
                  // some models call ask_user without first narrating the question
                  // as assistant text, in which case the card would otherwise show
                  // bare options with no prompt.
                  if (_aq.question) {
                    const q = document.createElement('div');
                    q.className = 'ask-user-question';
                    q.id = `ask-user-q-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
                    q.innerHTML = _emo(_aq.question);
                    card.appendChild(q);
                    // Label the choice group with the question for screen readers.
                    card.setAttribute('aria-labelledby', q.id);
                  } else {
                    card.setAttribute('aria-label', 'Question from the assistant');
                  }

                  const list = document.createElement('div');
                  list.className = 'ask-user-options';
                  card.appendChild(list);

                  const _send = (text) => {
                    if (!text) return;
                    // Remove the card once answered — the choice is sent as a
                    // normal user message (and the question persists as the
                    // assistant text above), so the affordances are spent.
                    card.remove();
                    handleChatSubmit(null, text); // the picked option is sent as a normal user message
                  };

                  _opts.forEach((opt, i) => {
                    const label = (opt && opt.label) ? String(opt.label) : String(opt || '');
                    if (!label) return;
                    const descr = (opt && opt.description) ? String(opt.description) : '';
                    const row = document.createElement(multi ? 'label' : 'button');
                    row.className = 'ask-user-option';
                    if (multi) {
                      const cb = document.createElement('input');
                      cb.type = 'checkbox';
                      cb.value = label;
                      row.appendChild(cb);
                    }
                    const txt = document.createElement('span');
                    txt.className = 'ask-user-option-label';
                    txt.innerHTML = _emo(label);
                    row.appendChild(txt);
                    if (descr) {
                      const d = document.createElement('span');
                      d.className = 'ask-user-option-desc';
                      d.innerHTML = _emo(descr);
                      row.appendChild(d);
                    }
                    if (!multi) {
                      row.type = 'button';
                      row.addEventListener('click', () => _send(label));
                    }
                    list.appendChild(row);
                  });

                  // Free-text "Other" — type a custom answer + send (Enter or →).
                  const other = document.createElement('div');
                  other.className = 'ask-user-other';
                  const otherInput = document.createElement('input');
                  otherInput.type = 'text';
                  otherInput.className = 'styled-prompt-input ask-user-other-input';
                  otherInput.placeholder = multi ? 'Other (added to selection)…' : 'Other… (type your own answer)';
                  otherInput.setAttribute('aria-label', multi ? 'Add a custom option' : 'Type a custom answer');
                  const otherSend = document.createElement('button');
                  otherSend.type = 'button';
                  otherSend.className = 'confirm-btn confirm-btn-primary ask-user-other-send';
                  otherSend.setAttribute('aria-label', 'Send answer');
                  otherSend.textContent = multi ? 'Send selection' : 'Send';
                  const _submit = () => {
                    const free = otherInput.value.trim();
                    if (multi) {
                      const picked = Array.from(card.querySelectorAll('.ask-user-option input:checked')).map(c => c.value);
                      if (free) picked.push(free);
                      if (picked.length) _send(picked.join(', '));
                    } else if (free) {
                      _send(free);
                    }
                  };
                  otherSend.addEventListener('click', _submit);
                  otherInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                      e.preventDefault();
                      _submit();
                    }
                  });
                  other.appendChild(otherInput);
                  other.appendChild(otherSend);
                  card.appendChild(other);

                  chatBox.appendChild(card);
                  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                  // Move focus to the card so keyboard/screen-reader users land on
                  // the question + choices when it appears.
                  try { card.focus(); } catch (_) {}
                }

              } else if (json.type === 'plan_update') {
                if (_isBg) continue;
                // Agent wrote back to the plan (ticked a step / revised). Update
                // the stored plan + live-refresh the docked plan window.
                const _pu = (json.data && json.data.plan) ? json.data.plan : '';
                if (_pu) _setStoredPlan(_pu);

              } else if (json.type === 'agent_step') {
                if (_isBg) continue;
                _cancelThinkingTimer();
                _removeThinkingSpinner();
                _renderStream();
                // L6c (supersedes L6b): a NEW agent round is starting. Hide the previous bubble
                // ONLY if it rendered no visible narration (a pure tool-only round); a round that
                // produced real narration (the interviewer's line, a scene beat) PERSISTS. The old
                // rule hid every intermediate round, losing a multi-line interview ("4 answers go
                // away"). `roundReplyText` still holds the closing round here (reset is later, ~2706).
                if (roundHolder && !stripToolBlocks(roundReplyText).trim()) {
                  roundHolder.style.display = 'none';
                  // #834: this round's bubble is being hidden. If it was the turn's only visible
                  // header (no later visible bubble has taken over yet), the turn currently has NO
                  // visible header — flag it so the NEXT bubble is promoted to header + timestamp.
                  if (!roundHolder.classList.contains('msg-continuation')) turnHeaderShown = false;
                }
                // Mark thread as connected to bubble below
                const _activeThread = document.querySelector('.agent-thread.streaming');
                if (_activeThread) {
                  _activeThread.classList.add('has-bottom');
                }
                // --- New round: create fresh AI bubble with spinner ---
                currentToolBubble = null;
                roundFinalized = false;
                isThinking = false;
                _docFenceOpened = false;
                _docFenceContentStart = -1;
                const box = document.getElementById('chat-history');
                const newWrap = document.createElement('div');
                // #834: when no visible turn-header exists yet (round 0 was a hidden tool-call), this
                // bubble is the FIRST VISIBLE one — promote it to the header (role + timestamp, NOT a
                // continuation) so the received message carries a timestamp. Otherwise it's a normal
                // continuation. Mirrors the reload path's first-visible logic in chatRenderer.js.
                const _isTurnHeader = !turnHeaderShown;
                newWrap.className = 'msg msg-ai streaming' + (_isTurnHeader ? '' : ' msg-continuation');
                // Add model name label
                const newRole = document.createElement('div');
                newRole.className = 'role';
                const metaS = sessionModule.getSessions().find(s => s.id === streamSessionId);
                const _roundRequested = holder?._requestedModel || metaS?.model;
                const _roundActual = holder?._actualModel || _roundRequested;
                // C14/immersion: a continuation round in the game build is still the show —
                // never the raw model name as the sender.
                newRole.textContent = isGameBuild() ? 'Orwell' : (_modelRouteLabel(_roundRequested, _roundActual) || '');
                _applyModelColor(newRole, _roundActual);
                // #834: a promoted header bubble carries the timestamp (matches the initial holder +
                // the reload path). roleTimestamp() with no arg falls back to "now" — correct for a
                // live turn. Continuation rounds keep no per-round timestamp (unchanged).
                if (_isTurnHeader) {
                  newRole.appendChild(chatRenderer.roleTimestamp());
                  turnHeaderShown = true;
                }
                newWrap.appendChild(newRole);
                const newBody = document.createElement('div');
                newBody.className = 'body';
                newWrap.appendChild(newBody);
                box.appendChild(newWrap);
                roundHolder = newWrap;
                roundText = '';
                roundReplyText = '';        // F8: keep the split buffers in lockstep with roundText
                roundReasoningText = '';
                // Destroy any previous spinner before creating new one
                if (spinner && spinner.element) spinner.destroy();
                // Show spinner while waiting for text (skip for research — has its own progress)
                if (!_researchingStreamIds.has(streamSessionId)) {
                  spinner = spinnerModule.create(_inProgressLabel('Generating response'), 'right', 'wave');
                  newBody.appendChild(spinner.createElement());
                  spinner.start();
                }
                if (streamingTTS) window.aiTTSManager._streamSentencesSent = 0;
                uiModule.scrollHistory();
              } else if (json.type === 'budget_exceeded') {
                if (_isBg) continue;
                _producedVisibleOutput = true;  // BUG 2: the budget notice IS a visible turn artifact
                _cancelThinkingTimer();
                _removeThinkingSpinner();
                const budgetDiv = document.createElement('div');
                budgetDiv.style.cssText = 'font-size:11px;opacity:0.6;font-style:italic;padding:4px 8px;margin:4px 0;';
                budgetDiv.textContent = `Tool budget reached (${json.used}/${json.limit} calls). Agent stopped.`;
                const chatBox = document.getElementById('chat-history');
                chatBox.appendChild(budgetDiv);

              } else if (json.type === 'teacher_takeover') {
                if (_isBg) continue;
                _cancelThinkingTimer();
                _removeThinkingSpinner();
                // Finalize any in-flight bubble so the takeover banner
                // separates student attempt from teacher attempt.
                if (spinner && spinner.element) { try { spinner.destroy(); } catch(_){} spinner = null; }
                const chatBox = document.getElementById('chat-history');
                const banner = document.createElement('div');
                banner.className = 'teacher-takeover-banner';
                banner.style.cssText = 'margin:10px 0;padding:8px 12px;border-left:3px solid #c08a3e;background:rgba(192,138,62,0.08);font-size:12px;color:var(--fg);border-radius:4px;';
                const teacherName = json.teacher_model || 'teacher';
                const why = json.student_failure ? ` &mdash; <span style="opacity:0.7">${esc(json.student_failure)}</span>` : '';
                banner.innerHTML = `<strong>Teacher takeover:</strong> escalating to <code>${esc(teacherName)}</code>${why}`;
                chatBox.appendChild(banner);
                // Reset round bubble state so the teacher's first text starts a new bubble
                roundHolder = null;
                roundText = '';
                roundReplyText = '';        // F8: keep the split buffers in lockstep with roundText
                roundReasoningText = '';
                roundFinalized = false;
                currentToolBubble = null;
                uiModule.scrollHistory();

              } else if (json.type === 'skill_saved') {
                if (_isBg) continue;
                const chatBox = document.getElementById('chat-history');
                const note = document.createElement('div');
                note.className = 'skill-saved-note';
                note.style.cssText = 'margin:6px 0;padding:6px 10px;border-left:3px solid #4a8a4a;background:rgba(74,138,74,0.07);font-size:12px;color:var(--fg);border-radius:4px;';
                note.innerHTML = `<strong>Skill learned:</strong> <code>${esc(json.name || '')}</code>${json.category ? ` <span style="opacity:0.6">[${esc(json.category)}]</span>` : ''}`;
                chatBox.appendChild(note);
                uiModule.scrollHistory();

              } else if (json.type === 'escalation_failed' || json.type === 'skill_save_failed') {
                if (_isBg) continue;
                const chatBox = document.getElementById('chat-history');
                const note = document.createElement('div');
                note.className = 'escalation-failed-note';
                note.style.cssText = 'margin:6px 0;padding:6px 10px;border-left:3px solid #8a4a4a;background:rgba(138,74,74,0.07);font-size:12px;color:var(--fg);border-radius:4px;';
                const label = json.type === 'escalation_failed' ? 'Teacher could not solve it' : 'Skill not saved';
                note.innerHTML = `<strong>${label}:</strong> <span style="opacity:0.75">${esc(json.reason || '')}</span>`;
                chatBox.appendChild(note);
                uiModule.scrollHistory();

              } else if (json.error) {
                // --- Backend error (timeout, connection issue, etc.) ---
                console.error('Stream error from backend:', json.error);
                if (_isBg) continue;
                _producedVisibleOutput = true;  // BUG 2: a surfaced error IS visible recourse already
                if (spinner && spinner.element) spinner.destroy();
                const errDiv = document.createElement('div');
                errDiv.style.cssText = 'color: var(--color-error); font-style: italic; padding: 4px 0;';
                errDiv.textContent = `[Error: ${json.error}]`;
                roundHolder.querySelector('.body').appendChild(errDiv);
                uiModule.scrollHistory();
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e);
            }
          }
        }
      }

      if (!_streamSawDone) {
        throw new Error('Stream closed before completion');
      }

      _renderStream();
      _cancelThinkingTimer();
      _removeThinkingSpinner();
      // Stop any thread pulse animations
      document.querySelectorAll('.agent-thread.streaming').forEach(t => t.classList.remove('streaming'));
      // --- Final render (skip if stream was ever backgrounded or currently in background) ---
      // Remove streaming class from all round bubbles
      holder.classList.remove('streaming');
      if (roundHolder && roundHolder !== holder) roundHolder.classList.remove('streaming');

      const _isBgFinal = (sessionModule.getCurrentSessionId() !== streamSessionId) || _backgroundStreams.has(streamSessionId);
      if (!_isBgFinal) {
        finalMeta = sessionModule.getSessions().find(s => s.id === sessionModule.getCurrentSessionId());
        const _finalActualModel = metrics?.model || holder._actualModel || finalMeta?.model;
        const _finalRequestedModel = metrics?.requested_model || holder._requestedModel || finalMeta?.model || _finalActualModel;
        // Prepend character name if set
        var _charNameFinal = presetsModule.getCharacterName ? presetsModule.getCharacterName() : '';
        const roleEl = holder.querySelector('.role');
        if (roleEl) {
          _setRoleModelLabel(roleEl, _finalRequestedModel, _finalActualModel, {
            suffix: holder._roleSuffix,
            characterName: _charNameFinal || holder._characterName,
          });
        }
        holder.dataset.raw = accumulated;

        // Anti-stall: a turn that ran tools but ended with essentially no
        // final prose usually means the model stopped mid-task (the case
        // where you had to type "did you finish?"). Offer a one-click
        // Continue that resumes exactly where it left off — reuses the same
        // resume mechanism as the user-stop "[Message interrupted]" button.
        try {
          const _usedTools = holder.querySelector('.agent-thread-node');
          const _proseLen = (accumulated || '').replace(/<[^>]*>/g, '').trim().length;
          if (_usedTools && _proseLen < 24 && !holder.querySelector('.agent-continue-btn')) {
            const _stall = document.createElement('div');
            _stall.className = 'stopped-indicator';
            const _lbl = document.createElement('span');
            _lbl.style.cssText = 'font-style:italic;opacity:0.7;';
            _lbl.textContent = 'Paused mid-task';
            _stall.appendChild(_lbl);
            const _cont = document.createElement('button');
            _cont.className = 'continue-btn agent-continue-btn';
            _cont.title = 'Continue — pick up where it left off';
            _cont.textContent = '▸';
            _cont.addEventListener('click', () => {
              _stall.remove();
              handleChatSubmit(null, 'Continue — you stopped before finishing. Pick up exactly where you left off and complete the task.');
            });
            _stall.appendChild(_cont);
            (holder.querySelector('.body') || holder).appendChild(_stall);
          }
        } catch (_) {}

        // Clear streaming minHeight lock
        const _streamContent = roundHolder.querySelector('.stream-content');
        if (_streamContent) _streamContent.style.minHeight = '';

        // Finalize the last round's bubble — flatten stream-content wrapper for clean DOM.
        // F8: finalize the BODY from the reply-only buffer; reasoning lives in the accordion
        // already, so no extraction is needed (the old garbled-<think>/prefix dance is gone).
        const finalDisplay = stripToolBlocks(roundReplyText);
        if (finalDisplay.trim()) {
          var _body4 = roundHolder.querySelector('.body');
          // Preserve sources expanded state before final render
          var _wasExpanded = _sourcesExpanded || !!(_body4 && _body4.querySelector('.sources-content.expanded'));

          // If thinking was collapsed in-place during streaming, a reply container exists.
          var _liveReplyEl = _body4 && _body4.querySelector('.live-reply-content');
          var _finalReply = _liveReplyEl ? finalDisplay.trim() : '';
          if (_liveReplyEl && _finalReply) {
            // Render reply into the live-reply container (thinking bar already showing).
            // #762: the live thinking accordion is ALREADY in the DOM (its own caret).
            // If the reply buffer still carries a leftover inline <think> block,
            // processWithThinking would emit a SECOND accordion here — two stacked
            // thinking bars with two carets (different size/orientation). Drop any
            // leftover think block from the reply BEFORE rendering so exactly one
            // accordion (the live one above) remains; the caret is single + neutral.
            var _replySrc = _finalReply;
            if (/<think/i.test(_replySrc)) {
              _replySrc = (markdownModule.extractThinkingBlocks(_replySrc).content || '').trim();
            }
            // GAME BUILD: route through processWithThinking so the L6b reply-scrub runs —
            // the public bubble must never carry a reasoning preamble that bled into the
            // reply text (the thinking accordion already holds the reasoning separately).
            var _replyHtml = isGameBuild()
              ? markdownModule.processWithThinking(markdownModule.squashOutsideCode(_replySrc))
              : markdownModule.mdToHtml(markdownModule.squashOutsideCode(_replySrc));
            _liveReplyEl.innerHTML = _replyHtml;
            _liveReplyEl.classList.remove('live-reply-content');
            if (_sourcesData) {
              var _srcEl = document.createElement('div');
              _srcEl.innerHTML = _buildSourcesBox(_sourcesData, _sourcesType, _wasExpanded);
              _body4.insertBefore(_srcEl.firstChild || _srcEl, _body4.firstChild);
            }
            if (_findingsData) _body4.insertAdjacentHTML('beforeend', chatRenderer.buildFindingsBox(_findingsData));
          } else {
            // Full re-render (reply empty or no live-reply container)
            _body4.innerHTML = (_sourcesData ? _buildSourcesBox(_sourcesData, _sourcesType, _wasExpanded) : '')
              + markdownModule.processWithThinking(markdownModule.squashOutsideCode(finalDisplay))
              + (_findingsData ? chatRenderer.buildFindingsBox(_findingsData) : '');
          }
        } else if (_sourcesHtml) {
          var _body4b = roundHolder.querySelector('.body');
          var _wasExpanded2 = _sourcesExpanded || !!(_body4b && _body4b.querySelector('.sources-content.expanded'));
          _body4b.innerHTML = _sourcesData ? _buildSourcesBox(_sourcesData, _sourcesType, _wasExpanded2) : _sourcesHtml;
        } else if (roundHolder !== holder) {
          // Check if there's thinking content worth showing
          const _thinkingOnly = markdownModule.extractThinkingBlocks(roundText);
          if (_thinkingOnly.thinkingBlocks?.length && !_thinkingOnly.content) {
            // Show thinking in a collapsed section even if no visible reply text
            const _body4c = roundHolder.querySelector('.body');
            if (_body4c) _body4c.innerHTML = markdownModule.processWithThinking(roundText);
          } else {
            roundHolder.style.display = 'none';
            // Thread above expected a bubble below — remove has-bottom since bubble is hidden
            const _lastThread = roundHolder.previousElementSibling;
            if (_lastThread && _lastThread.classList.contains('agent-thread')) {
              _lastThread.classList.remove('has-bottom');
            }
          }
        }


        if (window.hljs) {
          roundHolder.querySelectorAll('pre code').forEach((block) => {
            window.hljs.highlightElement(block);
          });
        }
        if (markdownModule.renderMermaid) markdownModule.renderMermaid(roundHolder);

        uiModule.scrollHistory();
        // Render RAG sources if present
        if (holder._ragSources && holder._ragSources.length) {
          const details = document.createElement('details');
          details.className = 'rag-sources';
          const summary = document.createElement('summary');
          summary.textContent = `Sources (${holder._ragSources.length} documents)`;
          details.appendChild(summary);
          holder._ragSources.forEach(src => {
            const item = document.createElement('div');
            item.className = 'rag-source-item';
            const _esc = uiModule.esc;
            item.innerHTML = `<strong>${_esc(src.filename)}</strong> <span class="rag-similarity">${(src.similarity * 100).toFixed(1)}%</span><div class="rag-snippet">${_esc(src.snippet)}</div>`;
            details.appendChild(item);
          });
          holder.querySelector('.body').appendChild(details);
        }

        // Hide first bubble if it has no visible text content (e.g. agent went straight to tools)
        if (holder !== roundHolder && holder.style.display !== 'none') {
          const _hBody = holder.querySelector('.body');
          const _hText = _hBody ? _hBody.textContent.trim() : '';
          if (!_hText) holder.style.display = 'none';
        }

        // Attach footer to the last visible bubble (roundHolder for multi-round agent, holder for single)
        const footerTarget = (roundHolder && roundHolder !== holder && roundHolder.style.display !== 'none') ? roundHolder : holder;
        footerTarget.appendChild(createMsgFooter(footerTarget));
        // Capture any checklist this message produced as the current plan — both
        // the initial proposal AND restated progress during execution. Keeps the
        // stored plan (and the docked plan window) in sync with the latest state.
        if (accumulated && _CHECKLIST_RE.test(accumulated)) {
          _setStoredPlan(accumulated);
        }
        // Plan mode: the agent has proposed a plan — offer to approve & execute it.
        // Approving re-sends with plan_mode suppressed (full tools) for one turn.
        if (planTurn && accumulated.trim()) {
          const _planText = accumulated;
          const _runApproved = () => {
            _approveWrap.remove();
            _forcePlanOff = true;
            // Persist the approved plan for THIS chat so it's (a) re-sent and
            // pinned in context every execution turn, and (b) re-openable via the
            // plan-button menu. Do this BEFORE flipping the toggle, since the menu
            // intercept keys off a stored plan existing.
            _setStoredPlan(_planText);
            // Approving exits plan mode for good — turn it OFF directly (NOT via
            // the button's click, which would now open the plan menu instead of
            // toggling) so execution and every follow-up keep full write tools.
            try { if (window._setPlanMode) window._setPlanMode(false); } catch (_) {}
            // Show a clean bubble ("Approved the plan."); the full instruction goes to the model via the
            // headless override (no composer puppeteering).
            _displayOverride = 'Approved the plan.';
            handleChatSubmit(null, 'Approved — execute the plan. The full approved checklist is pinned '
              + 'for you under "## ACTIVE PLAN"; do NOT go looking for it in tasks, notes, or '
              + 'memory. Work through it in order, and after each step call the update_plan tool '
              + 'with the full checklist and that step marked `- [x]`. Do the next unchecked item '
              + 'until all are done.');
          };
          var _approveWrap = document.createElement('div');
          _approveWrap.className = 'plan-approve-bar';
          const _approveBtn = document.createElement('button');
          _approveBtn.type = 'button';
          _approveBtn.className = 'plan-approve-btn';
          _approveBtn.textContent = 'Approve & Run';
          _approveBtn.addEventListener('click', _runApproved);
          // Open the plan in a draggable, side-dockable window (reuses the
          // shared modal framework). Approving from the window runs it too.
          const _openBtn = document.createElement('button');
          _openBtn.type = 'button';
          _openBtn.className = 'plan-open-btn';
          _openBtn.textContent = 'Open in window';
          _openBtn.addEventListener('click', () => {
            planWindowModule.openPlanWindow(_planText, _runApproved);
          });
          _approveWrap.appendChild(_approveBtn);
          _approveWrap.appendChild(_openBtn);
          footerTarget.appendChild(_approveWrap);
        }
        // Add "View Report" link for completed research
        if (_researchingStreamIds.has(streamSessionId)) {
          _appendViewReportLink(footerTarget, streamSessionId);
        }
        // Also store raw on the footer target so copy/TTS work
        if (footerTarget !== holder) footerTarget.dataset.raw = accumulated;
        if (addAITTSButton && accumulated && window.aiTTSManager?._provider !== 'disabled' && window.aiTTSManager?.available) {
          addAITTSButton(footerTarget, accumulated);
        }
        // TTS auto-play: streaming mode flushes remaining text, non-streaming enqueues full message
        if (accumulated && window.aiTTSManager && window.aiTTSManager.autoPlay) {
          const ttsBtn = holder.querySelector('.ai-tts-button');
          if (ttsBtn) {
            var ICON_PLAY_TTS = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="6 3 20 12 6 21 6 3"/></svg>';
            var ICON_STOP_TTS = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>';
            const resetFn = () => {
              ttsBtn.innerHTML = ICON_PLAY_TTS;
              ttsBtn.classList.remove('playing', 'loading');
              ttsBtn.style.color = '#6b7280';
              ttsBtn.title = 'Read aloud';
            };
            if (streamingTTS) {
              // Flush remaining partial sentence and attach the real button
              window.aiTTSManager.streamingEnd(accumulated);
              window.aiTTSManager.streamingAttachButton(ttsBtn, resetFn);
              // If still playing sentences from the stream, show stop icon
              if (window.aiTTSManager.isPlaying || window.aiTTSManager._processing) {
                ttsBtn.innerHTML = ICON_STOP_TTS;
                ttsBtn.classList.add('playing');
                ttsBtn.style.color = '#ccc';
                ttsBtn.title = 'Stop';
              }
            } else {
              // Non-streaming fallback (autoPlay toggled mid-stream, etc.)
              window.aiTTSManager.enqueue(accumulated, ttsBtn, resetFn);
            }
          }
        }
        if (metrics) {
          displayMetrics(footerTarget, metrics);
        }
        // Attach variant navigation if this was a regeneration
        _attachVariantNav(footerTarget);

        // Merge with previous stopped message if this was a continue
        if (_pendingContinue) {
          const prevEl = _pendingContinue;
          _pendingContinue = null;
          const prevBody = prevEl.querySelector('.body');
          const newBody = footerTarget.querySelector('.body');
          if (prevBody && newBody && prevEl.parentNode) {
            // Merge: combine raw text with *(continued)* marker
            const oldRaw = prevEl.dataset.raw || '';
            const newRaw = footerTarget.dataset.raw || '';
            const mergedRaw = oldRaw + '\n\n*(continued)*\n\n' + newRaw;
            prevEl.dataset.raw = mergedRaw;
            // Re-render merged content
            prevBody.innerHTML = markdownModule.processWithThinking(
              markdownModule.squashOutsideCode(mergedRaw)
            );
            // Remove the new bubble and re-add footer to the merged one
            footerTarget.remove();
            const oldFooter = prevEl.querySelector('.msg-footer');
            if (oldFooter) oldFooter.remove();
            prevEl.appendChild(createMsgFooter(prevEl));
            if (window.hljs) {
              prevEl.querySelectorAll('pre code').forEach(block => window.hljs.highlightElement(block));
            }

            // Persist merge to server
            const sid = sessionModule.getCurrentSessionId();
            if (sid) {
              fetch(`${API_BASE}/api/session/${sid}/merge-last-assistant`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ separator: '\n\n*(continued)*\n\n' })
              }).catch(e => console.warn('merge-last-assistant failed:', e));
            }
          }
        }

        // BUG 2 (#985 P2-B) — the CLEAN-EMPTY-TURN terminal state. A [DONE] arrived with NO assistant
        // content (`accumulated === ''`), the server persisted nothing (`!_sawMessageSaved`, because its
        // `if full_response:` save is skipped when the final round only made a tool call), and the turn
        // produced no other visible artifact (no image / ask_user / budget / error). Pre-fix this hid the
        // empty bubble (the "no visible text" branch above) and NEVER offered recourse — the catch-based
        // _tryAutoRecover only fires on a THROWN error, and a clean [DONE] throws nothing. So the user's
        // message sat unanswered with no way forward. Render the SAME user-controlled Retry the
        // network-drop path builds (distinct copy: "no response" rather than "connection dropped"). Guard
        // against the user-cancel path (handled by the abort branch) and the continue/auto-recover path.
        const _turnWasCancelled = !!(currentAbort && currentAbort.signal && currentAbort.signal.aborted);
        // Guard: only when the holder is still IN the DOM. A continue-merge above can remove `holder`
        // (folding it into the prior bubble); rendering Retry into a detached node would be invisible.
        if (holder && holder.parentNode &&
            _isEmptyTurnNoSave({
              sawDone: _streamSawDone,
              sawSave: _sawMessageSaved,
              producedVisible: _producedVisibleOutput,
              accumulated,
              cancelled: _turnWasCancelled,
            })) {
          _renderStreamDropRetry(holder, streamSessionId, {
            label: "The narrator didn't respond. Your message was received — retry to continue.",
          });
        }
      } // end if (!_isBgFinal)

    } catch (err) {
      _renderStream();
      // Clean up any active spinner (e.g. "Generating response" during tool calls)
      if (spinner && spinner.element) spinner.destroy();
      _cancelThinkingTimer();
      _removeThinkingSpinner();
      document.querySelectorAll('.agent-thread.streaming').forEach(t => t.classList.remove('streaming'));
      // Check if this stream was running in background
      const _isBgCatch = (sessionModule.getCurrentSessionId() !== streamSessionId) || _backgroundStreams.has(streamSessionId);

      if (_isBgCatch) {
        // Error happened while backgrounded — update map, don't touch DOM
        console.error('Background stream error:', err);
        var bgErr = _backgroundStreams.get(streamSessionId);
        if (bgErr && bgErr.status === 'completed') {
          // [DONE] was already processed — this error is benign (e.g. reader.read() after close)
          // Don't override the completed status; just ensure the completed dot stays
          if (sessionModule && sessionModule.clearStreaming) {
            sessionModule.clearStreaming(streamSessionId);
          }
        } else if (bgErr) {
          bgErr.status = 'error';
          if (sessionModule && sessionModule.clearStreaming) {
            sessionModule.clearStreaming(streamSessionId);
          }
        }
      } else {
        // Stop streaming TTS on any error/abort
        if (streamingTTS && window.aiTTSManager) window.aiTTSManager.stop();

        if (currentAbort && currentAbort.signal.aborted) {
          const abortReason = currentAbort._reason || '';
          // Timeout-triggered aborts should remain visible instead of disappearing.
          if (timedOut || abortReason === 'timeout') {
            const timeoutMsg = _isAgent
              ? 'Agent response timed out. Try again, switch to a faster model, or reduce tool usage.'
              : 'Response timed out. Try again.';

            if (holder && !accumulated) {
              holder.querySelector('.body').innerHTML =
                `<div style="color: var(--color-error); font-style: italic; padding: 4px 0;">[${timeoutMsg}]</div>`;
            } else if (holder && accumulated) {
              const timeoutNote = document.createElement('div');
              timeoutNote.className = 'stopped-indicator';
              timeoutNote.innerHTML =
                `<span style="color: var(--color-error);">[${timeoutMsg}]</span>`;
              holder.querySelector('.body').appendChild(timeoutNote);
            }
            currentAbort = null;
            return;
          }

          if (abortReason === 'offline') {
            const offlineMsg = 'Endpoint offline — switch model or try again.';
            if (holder && !accumulated) {
              holder.querySelector('.body').innerHTML =
                `<div style="color: var(--color-error); font-style: italic; padding: 4px 0;">[${offlineMsg}]</div>`;
            } else if (holder && accumulated) {
              const offlineNote = document.createElement('div');
              offlineNote.className = 'stopped-indicator';
              offlineNote.innerHTML =
                `<span style="color: var(--color-error);">[${offlineMsg}]</span>`;
              holder.querySelector('.body').appendChild(offlineNote);
            }
            currentAbort = null;
            return;
          }

          if (abortReason === 'recovery') {
            const recoveryMsg = 'Streaming was interrupted after the tab went inactive. Partial output was preserved.';
            if (holder && !accumulated) {
              holder.querySelector('.body').innerHTML =
                `<div style="color: var(--color-error); font-style: italic; padding: 4px 0;">[${recoveryMsg}]</div>`;
            } else if (holder && accumulated) {
              const recoveryNote = document.createElement('div');
              recoveryNote.className = 'stopped-indicator';
              recoveryNote.innerHTML =
                `<span style="color: var(--color-error);">[${recoveryMsg}]</span>`;
              holder.querySelector('.body').appendChild(recoveryNote);
            }
            currentAbort = null;
            return;
          }

          // User-initiated stop (or browser navigation abort).
          // Stopped before any text arrived — keep the bubble as a
          // "Cancelled by user" record (so it survives a refresh).
          if (holder && !accumulated) {
            _renderCancelledBubble(holder);
          }

          // But just in case the stop button didn't render it, render it here
          if (holder && accumulated && !currentHolder) {
            holder.dataset.raw = accumulated;
            holder.querySelector('.body').innerHTML = markdownModule.processWithThinking(
              markdownModule.squashOutsideCode(accumulated)
            );

            if (window.hljs) {
              holder.querySelectorAll('pre code').forEach((block) => {
                window.hljs.highlightElement(block);
              });
            }

            const stoppedIndicator = document.createElement('div');
            stoppedIndicator.className = 'stopped-indicator';
            const stoppedLabel = document.createElement('span');
            stoppedLabel.textContent = '[Message interrupted]';
            stoppedIndicator.appendChild(stoppedLabel);
            const continueBtn = document.createElement('button');
            continueBtn.className = 'continue-btn';
            continueBtn.title = 'Continue';
            continueBtn.textContent = '\u25B8';
            continueBtn.addEventListener('click', () => {
              stoppedIndicator.remove();
              _hideUserBubble = true;
              _pendingContinue = holder;
              const cutoff = accumulated;
              handleChatSubmit(null, 'Your previous response was interrupted. It ended with:\n\n' + cutoff.slice(-500) + '\n\nDo NOT repeat what you already said. Continue exactly from where you were cut off.');
            });
            stoppedIndicator.appendChild(continueBtn);
            holder.querySelector('.body').appendChild(stoppedIndicator);

            // Tell server to mark this message as stopped
            const _sid2 = sessionModule.getCurrentSessionId();
            if (_sid2) fetch(`${API_BASE}/api/session/${_sid2}/mark-stopped`, { method: 'POST' }).catch(e => console.warn('mark-stopped failed:', e));

            if (!holder.querySelector('.msg-footer')) {
              holder.appendChild(createMsgFooter(holder));
            }

            uiModule.scrollHistory();
          }

          // Now clear the abort controller
          currentAbort = null;
        } else {
          console.error(err);
          // Stream died with a tool node still spinning. Its per-node tickers
          // (_elapsedTicker 50ms / _waveInterval 100ms) are normally cleared in
          // `tool_output`, which will never arrive now — without this sweep they
          // fire forever on the orphaned node (and auto-recover compounds it per
          // nudge). Safe here: auto-recover's new send is deferred 200ms, so no
          // fresh running nodes exist yet.
          document.querySelectorAll('.agent-thread-node.running').forEach(node => {
            if (node._waveInterval) { clearInterval(node._waveInterval); node._waveInterval = null; }
            if (node._elapsedTicker) { clearInterval(node._elapsedTicker); node._elapsedTicker = null; }
            node.classList.remove('running');
          });
          // Stream died unexpectedly — the "silently died" case. Re-engage the
          // model immediately (no wait) with a completion handshake, up to the
          // cap. Only auto-recover from connection-class failures; deterministic
          // errors (unsupported tools, 4xx/5xx, parse failures) surface right away
          // instead of burning the nudge budget on a guaranteed-to-fail retry.
          if (!(_isRecoverableStreamErr(err) && _tryAutoRecover(holder, accumulated, streamSessionId))) {
            const errorHolder = document.querySelector('.msg-ai:last-of-type .body');
            if (errorHolder) {
              let errMsg = `Error: ${err.message}`;
              // Add hint for tool-call errors
              if (err.message && (err.message.includes('tool') || err.message.includes('auto'))) {
                errMsg += '\n\nThis model may not support tools — try switching to Chat mode.';
              }
              typewriterInto(errorHolder, errMsg);
            }
          }
        }
      }
    } finally {
      clearResponseTimeout();
      clearProcessingProbe();
      // #615: a mid-stream engine-tool error (e.g. a 409 stale-beat) can throw out of the reader
      // loop with a tool node still in `.running`. `tool_output` (which normally clears that node's
      // 50ms _elapsedTicker / 100ms _waveInterval) never arrives, so the ticker fires forever on the
      // orphaned node. The catch's `else` branch sweeps it, but only on the surfaced-error path —
      // a thrown error that is caught/handled elsewhere (or any unexpected exit) skips it. Sweep
      // here unconditionally as the backstop: clearing an already-cleared ticker is a no-op, and by
      // finally-time this turn's reader has ended so any still-`.running` node is genuinely orphaned.
      try {
        document.querySelectorAll('.agent-thread-node.running').forEach(node => {
          if (node._waveInterval) { clearInterval(node._waveInterval); node._waveInterval = null; }
          if (node._elapsedTicker) { clearInterval(node._elapsedTicker); node._elapsedTicker = null; }
          node.classList.remove('running');
        });
      } catch (_) {}
      // TX-2: a background-completed stream can leave isStreaming true and the never-cancelled
      // _textPauseTimer then mounts an orphan "Thinking" spinner into the now-FOREGROUND session.
      // Cancel the pending spinner timer + sweep any spinner unconditionally here — both are
      // idempotent no-ops when nothing is pending, so this is safe on every exit path.
      try { _cancelThinkingTimer(); _removeThinkingSpinner(); } catch (_) {}
      // P1 (OOBE cutover): safety net — never leave the "finalizing" indicator stuck if the turn
      // ended (or errored) without any narration token to clear it.
      if (_orwellFinalizingActive) {
        _orwellFinalizingActive = false;
        try { if (window._orwellFinalizing) window._orwellFinalizing.end(); } catch (_) {}
      }
      // Streaming done — let screen readers announce the settled response.
      const _chatLogDone = document.getElementById('chat-history');
      if (_chatLogDone) _chatLogDone.setAttribute('aria-busy', 'false');
      // Staged-comp / forced-advance fix (audit 2026-06-20): a SILENT server-side advance (the FE's
      // error-correction when the model under-calls advanceGame) progresses the engine onto a NEW
      // player pending but emits NO visible tool result — so the per-tool G15 seam above never fires
      // and the decision card never arms in the open page (pre-fix it re-armed only on a reload). Nudge
      // THE shared dispatcher at turn-end so orwellDecision's rearmFromStatus pulls gameStatus.pending
      // and arms the card. Debounced + idempotent (coalesces with any per-tool dispatch this turn);
      // a no-op outside the game build (orwellGameChanged is undefined there).
      if (window.orwellGameChanged) window.orwellGameChanged('turn-settled');
      // ADR 0008 fix (audit 2026-06-21): the foreground reader loop has ENDED, so clear _streamSessionId.
      // It was set on stream START (~L603) and previously NEVER reset, so hasActiveStream() stayed
      // permanently true for this session — which made flushPendingReconcile's softReloadHistory re-defer
      // FOREVER (the chat.js:3619 `if (hasActiveStream(sessionId))` guard). Net effect: a tab that had sent
      // even one turn could NEVER live-reconcile a peer's concurrent write to that session until a reload
      // (the two-tabs-streaming-concurrently residual the ADR-0008 live verification found). Guarded to
      // `=== streamSessionId` so a newer stream's session isn't cleared by a late-settling old finally;
      // a backgrounded stream stays covered by _backgroundStreams in hasActiveStream.
      if (_streamSessionId === streamSessionId) _streamSessionId = null;
      // ADR 0008: read-your-writes. The turn has persisted, so reconcile the sender's optimistic
      // bubbles to the authoritative {id, seq} log (the adopt pass is cheap + flicker-free; it only
      // rebuilds if a PEER also wrote during this turn). Was: the sender never re-fetched, so its DOM
      // was a permanent local guess that drifted from other tabs. Deferred so the finally settles first.
      // (Now that _streamSessionId is cleared above, the setTimeout(0) callback sees hasActiveStream=false
      // and the deferred reconcile actually rebuilds.)
      // ADR 0012 (GAP 2): an error turn rendered the raw model error live, but the agent loop persists
      // a friendly fallback. Force the reconcile below to do a CONTENT rebuild (not just the id adopt)
      // so the sender's settled bubble becomes the SAME persisted text a peer/reload shows. softReload
      // is async + the fallback persists right before [DONE], so it's on disk by the time this runs.
      // softReloadHistory self-guards the forced rebuild (it only fires when the server actually has an
      // assistant message to converge to) so a hard fail that persisted NOTHING keeps its live error
      // feedback — we don't need the client to have observed the message_saved event (which a same-chunk
      // error→[DONE] can skip past the break).
      if (_streamHadError) _forceRebuild.add(streamSessionId);
      // ADR 0012 (GAP 1): a PEER's run-started arrived for this session while THIS stream was in
      // flight, so the observer's `!hasActiveStream` guard deferred the live attach. Our stream has
      // now settled (_streamSessionId cleared above ⇒ hasActiveStream is false), so RE-ATTEMPT the
      // attach: subscribe() replays the peer run's buffer then live-tails, mirroring its turn in
      // lockstep instead of waiting on a later poll (the transient one-window-behind ±1). CHAINED
      // after the reconcile's softReloadHistory settles, so the peer's user turn is adopted first and
      // its reply attaches on top (matching sessionSync's "rebuild lands before the live bubble"
      // ordering). flushPendingPeerResume is a no-op in the common case (no peer resume deferred).
      try {
        setTimeout(() => {
          try {
            Promise.resolve(flushPendingReconcile(streamSessionId)).then(function () {
              try { flushPendingPeerResume(streamSessionId); } catch (_) {}
            });
          } catch (_) {}
        }, 0);
      } catch (_) {}
      // ADR 0012 §2.4: a loser-of-the-bind window POSTed under its own per-tab id but the run lived
      // under the canonical game session (server `canonical_session` event). Now that the stream has
      // settled, converge onto canonical so this window's history/SSE/HUD re-key onto the shared game
      // (a mid-stream selectSession would have reloaded history out from under the live bubble). Only
      // when we're actually on a different id, so it's a no-op for the already-converged common case.
      if (_adoptCanonicalAfterStream &&
          sessionModule.getCurrentSessionId &&
          sessionModule.getCurrentSessionId() !== _adoptCanonicalAfterStream) {
        try { setTimeout(() => { try { sessionModule.selectSession(_adoptCanonicalAfterStream, { keepSidebar: true }); } catch (_) {} }, 0); } catch (_) {}
      }
      // Always clean up research tracking regardless of background state
      _researchingStreamIds.delete(streamSessionId);
      if (_researchingStreamIds.size === 0) {
        var _rToggleCleanup = document.getElementById('research-toggle-btn');
        if (_rToggleCleanup) _rToggleCleanup.classList.remove('research-running');
      }

      // Only reset UI state if still on the stream's session and was never backgrounded
      const _isBgFinally = (sessionModule.getCurrentSessionId() !== streamSessionId) || _backgroundStreams.has(streamSessionId);

      if (!_isBgFinally) {
        // Reset button to idle state
        updateSubmitButton('idle', submitBtn);

        // Re-enable message input; on mobile blur to dismiss keyboard.
        // J4-01: if a decision card is showing, focus it instead of the composer —
        // the post-stream cleanup must not steal focus from a binding decision the
        // player needs to act on. The composer is re-focused when the card is
        // confirmed or dismissed (the confirm handler calls box.focus()).
        if (messageInput) {
          messageInput.disabled = false;
          if (isNarrow()) {
            messageInput.blur();
          } else {
            var _pendingCard = document.getElementById('orwell-decision-card');
            if (_pendingCard) {
              try { _pendingCard.focus(); } catch (_) {}
            } else {
              messageInput.focus();
            }
          }
        }

        // Clear tracking variables
        currentAccumulated = '';
        currentHolder = null;
        currentSpinner = null;
        _researchingStreamIds.delete(streamSessionId);
        // Clear research-running highlight if no more active research
        if (_researchingStreamIds.size === 0) {
          var _rToggle2 = document.getElementById('research-toggle-btn');
          if (_rToggle2) _rToggle2.classList.remove('research-running');
        }
        _clearResearchTimer();

        // Re-enable research button and auto-untoggle after use
        // (skip if clarification round — keep toggle on for follow-up)
        const _el = uiModule.el;
        const _researchBtn = _el('research-toggle-btn');
        const _researchToggle = _el('research-toggle');
        if (_researchToggle && _researchToggle.checked) {
          _researchToggle.checked = false;
          Storage.setToggle('research', false);
        }
        if (_researchBtn) {
          _researchBtn.disabled = false;
          _researchBtn.classList.remove('active');
          _researchBtn.style.display = 'none';
        }
        // Also sync overflow and tool sidebar buttons
        const _overflowRes = _el('overflow-research-btn');
        if (_overflowRes) _overflowRes.classList.remove('active');
        const _toolRes = _el('tool-research-btn');
        if (_toolRes) _toolRes.classList.remove('active');

        // #985 P2-A: the turn has settled and `updateSubmitButton('idle')` above cleared `isStreaming`,
        // so DRAIN the next queued send (FIFO, one at a time). Deferred past this finally so the reconcile
        // / peer-resume chains settle first and the flushed send re-enters cleanly. A no-op when empty.
        try { setTimeout(() => { try { _flushSendOutbox(); } catch (_) {} }, 0); } catch (_) {}
      } else {
        // #971 — the turn settled while BACKGROUNDED, so the idle reset above was skipped and the button
        // (and the `isStreaming` flag) can be stranded on Stop for whatever session is now in the
        // foreground. Reconcile it to the true state: if this window is in fact looking at the settled
        // session, the button repairs to Send/upload-file; a still-live foreground stream is untouched.
        // Deferred so any selectSession/reconcile racing this finally settles first.
        try { setTimeout(() => { try { _syncSubmitButtonState(); } catch (_) {} }, 0); } catch (_) {}
      }

      // Research clarification timeout — if user doesn't reply within 5 min, show timeout
      if (holder && holder._roleSuffix === 'Research' && !_researchingStreamIds.has(streamSessionId)) {
        var _timeoutSessionId = streamSessionId;
        var _timeoutTimer = setTimeout(async function() {
          // Check if research_pending is still active (user hasn't replied)
          try {
            var _box = document.getElementById('chat-history');
            if (_box && sessionModule.getCurrentSessionId() === _timeoutSessionId) {
              var _timeoutMsg = document.createElement('div');
              _timeoutMsg.className = 'msg msg-ai';
              _timeoutMsg.innerHTML = '<div class="role">Orwell</div><div class="body" style="opacity:0.6;font-style:italic;">Research clarification timed out. Toggle research again to start over.</div>';
              _box.appendChild(_timeoutMsg);
              uiModule.scrollHistory();
            }
          } catch(_te) {}
        }, 5 * 60 * 1000);
        // Cancel timeout if user sends a message
        var _origSubmit = window._researchTimeoutTimer;
        if (_origSubmit) clearTimeout(_origSubmit);
        window._researchTimeoutTimer = _timeoutTimer;
      }

      // Release Web Lock
      if (_webLockRelease) {
        _webLockRelease();
        _webLockRelease = null;
      }

      // Refresh session list after a delay (picks up auto-generated names)
      setTimeout(() => {
        if (sessionModule && sessionModule.loadSessions) {
          sessionModule.loadSessions();
        }
      }, 3000);
    }
  }

  // ── #985 P2-A: SEND OUTBOX — enqueue + flush ────────────────────────────────
  /**
   * Enqueue a Send made WHILE a turn is streaming. Paints the optimistic bubble NOW (pending shape:
   * clientMsgId, no dbId/seq → floats to the tail per #992), captures the text in the FIFO, clears the
   * composer (the words are safely held in the queue, never lost), and routes the freshness seam — so
   * nothing is dropped and the queue flushes in order when the current turn settles. Mirrors the
   * optimistic-bubble + composer-clear contract of the normal send path so a queued send is
   * indistinguishable from an in-line one once it reconciles.
   */
  function _enqueueSend(text) {
    const clientMsgId = 'c-' + ((window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : (Date.now() + '-' + Math.random().toString(36).slice(2)));
    // Paint the optimistic bubble immediately (pending: clientMsgId, NO dbId/seq).
    let bubbleEl = null;
    try {
      bubbleEl = chatRenderer.addMessage('user', text, null, null);
      if (bubbleEl) {
        bubbleEl.dataset.clientMsgId = clientMsgId;
        bubbleEl.classList.add('msg-pending');
      }
      if (uiModule.setAutoScroll) uiModule.setAutoScroll(true);
      if (uiModule.scrollHistory) uiModule.scrollHistory();
    } catch (_) { /* a paint failure must not strand the text — it's still captured in the queue below */ }
    _sendOutbox.push({ clientMsgId, text, bubbleEl });
    // Clear the composer — the text is now held in the outbox (+ bubble), so it is safe (and expected:
    // the player is free to compose the next message). Mirror the normal-send composer reset.
    try {
      const mi = uiModule.el('message');
      if (mi) {
        mi.value = '';
        mi.style.height = '';
        mi.dispatchEvent(new Event('input'));
      }
      if (window._orwellComposerDraftClear) window._orwellComposerDraftClear();
    } catch (_) {}
  }

  /**
   * Flush the next queued send IN ORDER once the current turn has settled (called from the stream-end
   * finally). ONE in flight at a time: it dispatches a single headless send that re-uses the queued
   * item's already-painted bubble + its clientMsgId (idempotent / at-most-once), and the NEXT item is
   * picked up by that send's own stream-end finally — so the queue drains strictly FIFO, one turn per
   * settle, with no double-send. Guards: never while a stream is live (would race the in-flight turn),
   * never re-entrant. A no-op when the outbox is empty (the overwhelming common case).
   */
  // The flush dispatcher — defaults to a headless `handleChatSubmit`. Indirected through a swappable
  // ref so the FIFO/idempotency browser gate can spy the dispatch without a real LLM stream; in
  // production it IS `handleChatSubmit`, so behaviour is byte-identical.
  let _outboxDispatch = (text, opts) => handleChatSubmit(null, text, opts);
  function _flushSendOutbox() {
    if (_flushingOutbox) return;
    if (isStreaming) return;            // a turn is in flight — its finally will re-attempt the flush
    if (_sendOutbox.length === 0) return;
    const item = _sendOutbox.shift();
    if (!item) return;
    // If the queued bubble was somehow removed from the DOM (a destructive reload before flush), fall
    // back to letting the send paint a fresh one — the text is never lost.
    const bubbleAttached = item.bubbleEl && item.bubbleEl.isConnected;
    _flushingOutbox = true;
    try {
      Promise.resolve(
        _outboxDispatch(item.text, {
          queuedClientMsgId: item.clientMsgId,
          queuedBubbleEl: bubbleAttached ? item.bubbleEl : null,
        })
      ).catch(() => {}).finally(() => { _flushingOutbox = false; });
    } catch (_) {
      _flushingOutbox = false;
    }
  }

  /**
   * Abort current chat request
   */
  // stopServer=true ONLY for an explicit user Stop. The run is now DETACHED
  // (survives tab close / navigation), so the generic abort used by cleanup
  // paths (session switch, delete, reader teardown on tab close) must NOT stop
  // the server run — otherwise closing the tab would kill the background task,
  // defeating the whole point. Only the Stop button cancels the server run.
  export function abortCurrentRequest(stopServer = false) {
    if (currentAbort) {
      currentAbort.abort();
      // Don't set to null here - let catch block handle it
    }
    if (stopServer) {
      try {
        const _sid = _streamSessionId
          || (window.sessionModule && window.sessionModule.getCurrentSessionId && window.sessionModule.getCurrentSessionId());
        if (_sid) {
          fetch(`/api/chat/stop/${encodeURIComponent(_sid)}`, { method: 'POST', credentials: 'same-origin' }).catch(() => {});
        }
      } catch (_) {}
    }
  }

  // ── Stall watchdog ──────────────────────────────────────────────
  // Auto-recover a turn whose stream died (connection drop) or went silent:
  // preserve the partial, then re-submit a completion handshake by reusing the
  // existing continue/resume path. Returns false at the cap so the caller can
  // surface the failure instead of nudging forever.
  // Only auto-recover from connection-class failures (the genuine "silently
  // died" case). Deterministic errors — unsupported tools, HTTP 4xx/5xx, JSON
  // parse failures — will fail identically on retry, so surfacing them
  // immediately is both more honest and avoids wasting the nudge budget.
  function _isRecoverableStreamErr(err) {
    if (!err) return false;
    if (err.name === 'TypeError') return true;   // fetch/reader network failure
    const m = (err.message || '').toLowerCase();
    if (/\btool\b|unsupported|json|parse|\b4\d\d\b|\b5\d\d\b/.test(m)) return false;
    return /network|fetch|connection|reset|closed|aborted|stream|tim(?:e|ed)\s?out|econn|eof/.test(m);
  }

  function _tryAutoRecover(holder, accumulated, sessionId) {
    const tail = (accumulated || '').slice(-400);
    // PRODUCED NOTHING: the stream died before any token. Do NOT silently auto-resend — the old path
    // puppeteered the composer with a "stream dropped" prompt and `.send-btn.click()`, which frequently
    // stranded that text in the box (the click landed while the button was still in Stop mode). Surface
    // an honest, user-controlled Retry instead. Not gated by the auto-nudge cap (it's a human click).
    if (!tail) {
      _renderStreamDropRetry(holder, sessionId);
      return true; // handled — the caller must not also render a generic "stream closed" error
    }
    // PARTIAL TEXT: a mid-stream cut. Continuing is genuinely useful, so auto-continue ONCE — but via a
    // HEADLESS send (no composer write, no synthetic click, no stop/send race). Gated by the cap.
    if (_autoNudges >= _AUTO_NUDGE_CAP) return false;
    _autoNudges++;
    if (holder) {
      holder.dataset.raw = accumulated;
      try {
        holder.querySelector('.body').innerHTML =
          markdownModule.processWithThinking(markdownModule.squashOutsideCode(accumulated));
      } catch (_) {}
    }
    const prompt = `The stream dropped before you finished. It ended with:\n\n${tail}\n\nIf the task is fully complete, reply with just: DONE. Otherwise continue exactly where you left off and finish it — do not repeat what you already wrote.`;
    // Defer so the dead stream's `finally` (currentAbort / isStreaming / holder cleanup) runs first.
    setTimeout(() => {
      if (sessionId && sessionModule.getCurrentSessionId() !== sessionId) return; // wrong chat now — drop it
      handleChatSubmit(null, prompt, { hideUserBubble: true, pendingContinue: holder, autoContinue: true });
    }, 50);
    return true;
  }

  // A visible, user-controlled retry for a stream that died before producing anything — the honest
  // replacement for the old composer-puppeteering auto-resend. The Retry button does a HEADLESS send
  // (the user's original message is already persisted server-side, so this just re-engages the model).
  // BUG 2 (#985 P2-B): the SAME control also serves the clean-empty-turn terminal state (a [DONE] with
  // no narration + no save) — passing `opts.label` swaps the message; the Retry mechanism is identical.
  function _renderStreamDropRetry(holder, sessionId, opts) {
    opts = opts || {};
    const target = holder && (holder.querySelector('.body') || holder);
    if (!target || target.querySelector('.stream-drop-retry')) return;
    // BUG 2: the empty-turn holder was hidden by the finalize ("no visible text" branch) — make it
    // visible again so the Retry control the player needs is actually on screen.
    if (holder && holder.style && holder.style.display === 'none') holder.style.display = '';
    const note = document.createElement('div');
    note.className = 'stream-drop-retry';
    note.style.cssText = 'display:flex;align-items:center;gap:8px;opacity:0.85;font-style:italic;';
    const label = document.createElement('span');
    label.textContent = opts.label || 'Connection dropped before any reply.';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'continue-btn';
    btn.textContent = 'Retry';
    btn.addEventListener('click', () => {
      if (sessionId && sessionModule.getCurrentSessionId() !== sessionId) return; // wrong chat now
      note.remove();
      handleChatSubmit(null, "Your previous reply didn't come through — please answer my last message.",
        { hideUserBubble: true, pendingContinue: holder });
    });
    note.appendChild(label);
    note.appendChild(btn);
    target.appendChild(note);
  }

  // (Removed FEJS-6: the dead stall-banner machinery + the deliberately-disabled
  // _startStallWatchdog/_stopStallWatchdog. The server-side stall detector +
  // auto-continue loop-breaker supersede the old "still working?" banner; see
  // CLAUDE.md "Front-end client conventions".)

  /** Show a "Cancelled by user" record in `holder` and persist an empty
   *  assistant placeholder server-side so the turn survives a refresh.
   *  Called from both abort paths when no tokens had streamed yet. */
  function _renderCancelledBubble(holder) {
    if (!holder) return;
    holder.dataset.raw = '';
    const body = holder.querySelector('.body');
    if (body) {
      body.innerHTML = '';
      const indicator = document.createElement('div');
      indicator.className = 'stopped-indicator';
      const label = document.createElement('span');
      label.style.fontStyle = 'italic';
      label.style.opacity = '0.7';
      label.textContent = '[Cancelled by user]';
      indicator.appendChild(label);
      body.appendChild(indicator);
    }
    if (typeof createMsgFooter === 'function' && !holder.querySelector('.msg-footer')) {
      holder.appendChild(createMsgFooter(holder));
    }
    // Persist as an assistant message with stopped+cancelled metadata so the
    // chat-history loader renders the same indicator after a refresh.
    // Include the model name so the bubble header still shows which model
    // was running when the user hit Stop.
    const sid = sessionModule.getCurrentSessionId();
    if (sid) {
      let modelName = '';
      try { modelName = sessionModule.getCurrentModel?.() || ''; } catch {}
      // Fallback: pull from the holder's existing meta (the streaming
      // placeholder usually has the model set in the header already).
      if (!modelName) {
        modelName = holder.dataset.model
          || holder.querySelector('.msg-header .msg-model')?.textContent
          || '';
      }
      fetch(`${API_BASE}/api/session/${sid}/inject_messages`, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{
            role: 'assistant',
            content: '',
            metadata: { stopped: true, cancelled: true, model: modelName },
          }],
        }),
      }).catch(() => {});
    }
  }

  /**
   * Detach current stream to run in background instead of aborting.
   * Called when user switches sessions mid-stream.
   */
  export function detachCurrentStream(sessionId) {
    if (!isStreaming || !currentAbort) {
      // Not streaming — fall through to abort
      abortCurrentRequest();
      return;
    }
    // Store background stream state
    _backgroundStreams.set(sessionId, {
      status: 'running',
      accumulated: currentAccumulated,
      sourcesHtml: '',
      findingsData: null,
      abortCtrl: currentAbort,
      query: currentHolder ? (currentHolder._researchQuery || '') : '',
      metrics: null,
    });
    // Mark session with pulsing dot in sidebar
    if (sessionModule && sessionModule.markStreaming) {
      sessionModule.markStreaming(sessionId);
    }
    // Clear local state WITHOUT aborting the fetch
    currentAbort = null;
    isStreaming = false;
    currentHolder = null;
    currentAccumulated = '';
    // Reset submit button so the new chat is ready to send
    const submitBtn = document.querySelector('.send-btn');
    if (submitBtn) updateSubmitButton('idle', submitBtn);
  }

  // _notifyStreamComplete and _insertStreamDoneToast now in chatStream.js
  var _notifyStreamComplete = chatStream.notifyStreamComplete;
  var _insertStreamDoneToast = chatStream.insertStreamDoneToast;

  /**
   * Cross-device sync: re-render the conversation for `sessionId` from saved
   * history WITHOUT the heavy, draft-clearing selectSession path. Used when
   * another device adds a message to the session this device is viewing. No-op
   * if it isn't the open session, or if this device is mid-stream/resume for it
   * (its own live view is authoritative). Preserves the message input; only
   * touches #chat-history, and only auto-scrolls if already near the bottom.
   */
  // ADR 0008: sessions that DIVERGED while a stream was in flight — reconciled when it ends.
  const _pendingReconcile = new Set();
  // ADR 0012 (GAP 1 — the ±1 cross-tab live-attach lag): a PEER's run-started arrived for the
  // canonical session while THIS window's OWN POST stream for that same session was still in flight,
  // so the observer's `!hasActiveStream(id)` guard suppressed the live `resumeStream` attach. The peer
  // run is durable (chained as the current `_RUNS[canonical]`, still `has_run` within the evict grace),
  // so we DON'T drop the invitation — we record it here and RE-ATTEMPT the attach the moment our own
  // stream settles (the finally below). subscribe() replays the peer run's buffer (or its tail) then
  // live-tails, so the deferred attach mirrors the peer turn in lockstep instead of waiting on a later
  // poll/reconcile (the transient one-window-behind offset the 50× smoke caught).
  const _pendingPeerResume = new Set();
  // ADR 0012 (GAP 2): sessions whose NEXT softReloadHistory must FORCE the seq-ordered rebuild even if
  // the rendered id-order looks "converged". The error path adopts the live error bubble to the
  // persisted message's {id, seq} (so the divergence check passes) but its CONTENT is still the raw
  // "Error 503", not the persisted friendly fallback — only a content rebuild makes the sender match
  // the peer. The convergence short-circuit is about avoiding flicker on a NORMAL turn; on an error we
  // accept the one rebuild to guarantee identical settled text.
  const _forceRebuild = new Set();
  function _historyMsgText(msg) {
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) return msg.content.filter(p => p.type === 'text').map(p => p.text).join('\n').trim();
    return '';
  }
  function _isSkippableUserPrompt(text) {
    const t = (text || '').trim();
    return t === 'Continue where you left off' || t.startsWith('Your message was cut off.') ||
      t.startsWith('Your previous response was interrupted.') ||
      t.includes('[Instruction: Rewrite') || t.includes('[Instruction: Explain') ||
      // OOBE hand-off cues are the producers reaching out — never the player's own words.
      // sendHiddenCue() hides them live; on a history reload / cross-device load the persisted
      // user turn must stay hidden too, or it surfaces as a "You" bubble and breaks immersion
      // (UX audit J1-03). Match the "(Production cue …)" envelope.
      t.toLowerCase().startsWith('(production cue');
  }
  function _serverMsgId(msg) { return msg.id || (msg.metadata && msg.metadata._db_id) || null; }

  /**
   * BUG 1 (ADR 0008 — render BY the authoritative seq, never by arrival order).
   *
   * The server assigns a monotonic `seq` per session (UNIQUE(session_id, seq)); the FE log is a
   * replica of that total order. Every live insert (optimistic user send, stream holder, peer
   * resume holder) is necessarily append-to-bottom because seq isn't known until the row persists —
   * so two turns whose persistence interleaves (a peer write racing the local turn, two windows)
   * could sit in ARRIVAL order, not seq order. Reconcile (`softReloadHistory`) rebuilds in seq order
   * but only when DIVERGED and only when idle, leaving a visible out-of-seq window mid-stream.
   *
   * The structural fix: a single seq read (`_msgSeq`) + a single non-destructive reorder
   * (`_reorderBySeq`) that the reconcile's ADOPT PASS runs on every reconcile attempt (it runs even
   * while a stream is in flight — the `hasActiveStream` early-return is AFTER the adopt pass). A
   * bubble that has been stamped with `data-seq` is moved into ascending-seq position WITHOUT a DOM
   * wipe, reordering ONLY among the seq'd bubbles' own slots; bubbles with NO seq yet (a still-pending
   * optimistic send, the LIVE streaming holder, an un-adopted orphan) and non-`.msg` nodes (tool
   * threads) never move — so the live holder is never torn from its threads. Idempotent: a no-op when
   * already ordered (the overwhelming common case). This makes it STRUCTURALLY impossible for an adopted
   * bubble to remain out of seq order relative to server truth.
   */
  export function _msgSeq(el) {
    if (!el || !el.dataset || el.dataset.seq == null || el.dataset.seq === '') return null;
    const n = Number(el.dataset.seq);
    return Number.isFinite(n) ? n : null;
  }

  /** Insert `el` into `box` at its `data-seq` position: before the first existing `.msg` whose seq
   * is strictly greater. No seq on `el` (a pending/optimistic send) ⇒ append to bottom (the newest
   * local turn). Used at the live insert sites so a bubble that DOES know its seq lands ordered. */
  export function _insertBySeq(box, el) {
    if (!box || !el) return;
    const s = _msgSeq(el);
    if (s == null) { box.appendChild(el); return; }
    const kids = box.querySelectorAll('.msg');
    for (let i = 0; i < kids.length; i++) {
      if (kids[i] === el) continue;
      const ks = _msgSeq(kids[i]);
      if (ks != null && ks > s) { box.insertBefore(el, kids[i]); return; }
    }
    box.appendChild(el);
  }

  /** Non-destructive in-place reorder of the SEQ'D message bubbles in `#chat-history` to ascending
   * `data-seq`. DELIBERATELY CONSERVATIVE: it reorders ONLY the `.msg[data-seq]` bubbles among
   * themselves, reassigning them into the very DOM SLOTS those seq'd bubbles already occupy. Everything
   * else — no-seq bubbles (a still-pending optimistic send, the LIVE streaming holder, an un-adopted
   * orphan) AND non-`.msg` nodes (`.agent-thread` tool groups, decision cards, notices) — stays exactly
   * where it is, so a mid-stream reconcile can never tear the live holder away from its tool threads or
   * disturb thread `has-top`/`has-bottom` adjacency. A persisted bubble that landed out of arrival-vs-seq
   * order (a peer write racing the local turn, two interleaved `message_saved`s) is moved into its seq
   * slot WITHOUT a DOM wipe. Idempotent: zero churn when already ordered. Returns the count of bubbles
   * actually moved so callers/tests can detect a real correction. */
  export function _reorderBySeq(box) {
    if (!box) return 0;
    // The slots: the current DOM positions held by seq'd bubbles. We only ever permute WITHIN these.
    const seqd = Array.from(box.querySelectorAll('.msg')).filter(el => _msgSeq(el) != null);
    if (seqd.length < 2) return 0;
    const wantOrder = seqd.slice().sort((a, b) => {
      const as = _msgSeq(a), bs = _msgSeq(b);
      if (as !== bs) return as - bs;          // ascending seq
      return seqd.indexOf(a) - seqd.indexOf(b); // seq tie → preserve current relative order (stable)
    });
    // Already ordered? (common case — bail with zero churn).
    let same = true;
    for (let i = 0; i < seqd.length; i++) { if (wantOrder[i] !== seqd[i]) { same = false; break; } }
    if (same) return 0;
    // Reorder WITHIN the seq'd slots only: drop an empty placeholder where each seq'd bubble currently
    // sits (preserving the exact slot positions among all the OTHER, untouched nodes), detach the seq'd
    // bubbles, then fill the placeholders in ascending-seq order. No-seq bubbles (the live streaming
    // holder, a pending optimistic send) and non-`.msg` nodes (tool threads, cards) never move — their
    // surrounding placeholders are swapped under them.
    const marks = seqd.map(() => document.createComment('seq-slot'));
    for (let i = 0; i < seqd.length; i++) box.replaceChild(marks[i], seqd[i]);
    let moved = 0;
    for (let i = 0; i < marks.length; i++) {
      if (wantOrder[i] !== seqd[i]) moved += 1;   // this slot's occupant changed
      box.replaceChild(wantOrder[i], marks[i]);
    }
    return moved;
  }

  /**
   * BUG 2 (#985 P2-B): the CLEAN-EMPTY-TURN predicate — pure so it can be gated without a live stream.
   * True iff the stream ended cleanly (a `[DONE]`, not a thrown drop), persisted NO message
   * (`!sawSave`), produced NO other visible artifact (`!producedVisible` — image/ask_user/budget/error),
   * had NO assistant content (`accumulated` blank), and was NOT user-cancelled. That is the
   * "backend produced no turn" state the FE must surface with a user-controlled Retry — distinct from
   * a network drop (thrown error ⇒ the existing `_tryAutoRecover`/`_renderStreamDropRetry` path) and
   * from a reasoning-only turn (non-blank `accumulated`, handled by the thinking-display branch).
   */
  export function _isEmptyTurnNoSave({ sawDone, sawSave, producedVisible, accumulated, cancelled } = {}) {
    return !!sawDone && !sawSave && !producedVisible && !cancelled &&
      (accumulated == null || String(accumulated).trim() === '');
  }

  /**
   * F5 (dedup hardening): count the message bubbles that SHOULD map 1:1 to a persisted server message
   * — i.e. exclude rows that are intentionally hidden (display:none): a tool-only continuation round
   * (chat.js ~2780) and a skippable production-cue user bubble. Those have no server counterpart, so
   * they must not inflate the count. Everything else visible (a real user bubble, a real AI bubble, and
   * crucially an ORPHANED continuation/finalize bubble) counts. softReloadHistory compares this to the
   * server's visible-message count to detect an orphan a pure id-order check is blind to. Pure (DOM in,
   * number out) and exported so the reconcile contract is unit-testable without a live stream.
   */
  export function _visibleMsgCount(box) {
    if (!box) return 0;
    let n = 0;
    box.querySelectorAll('.msg').forEach((el) => {
      // A bubble explicitly hidden via inline style is an intermediate/skipped row with no
      // server message — don't count it. (Hidden via class is rare; the live hide uses style.display.)
      const hidden = (el.style && el.style.display === 'none');
      if (hidden) return;
      // #836 / "never eat a message": an UN-ADOPTED optimistic send (clientMsgId, no dbId yet) is a
      // legitimate PENDING user bubble, NOT an orphan — its persisted row simply hasn't reached THIS
      // /api/history snapshot (canonical-vs-per-tab adoption, an SSE reconcile racing the just-committed
      // row, or a non-persisted/incognito turn). Excluding it from the divergence count means it never
      // forces a destructive rebuild on its own; combined with the rebuild-time preservation in
      // softReloadHistory it can never be ERASED. The next reload adopts it once its row appears.
      if (_isPendingOptimisticBubble(el)) return;
      n += 1;
    });
    return n;
  }

  /** #836 — a still-pending optimistic user send: carries a clientMsgId but has not yet been adopted
   * (no dbId). Mirrors the sessions.js `wouldWipe` guard — such a bubble must SURVIVE any reconcile so
   * "what I typed goes in the bubble, verbatim, every time" can never be violated by the rebuild. */
  export function _isPendingOptimisticBubble(el) {
    return !!(el && el.dataset && el.dataset.clientMsgId && !el.dataset.dbId);
  }

  /**
   * ADR 0008 — render-and-reconcile to the authoritative seq-ordered log.
   *
   * The chat conversation is a FE-replicated log; the audit (S3-RACE) proved two tabs diverge
   * under concurrent writes because the sender was optimistic-only and a busy tab dropped the
   * peer's events. This reconciles every tab to the server's `seq` total order WITHOUT a blanket
   * full rebuild:
   *   1. ADOPT PASS — stamp the canonical {id, seq} onto already-rendered bubbles (matching by db
   *      id OR the optimistic client-temp id). Gives the sender read-your-writes with zero churn.
   *   2. DIVERGENCE CHECK — if the rendered id order already equals the server seq order, return
   *      (no flicker in the overwhelming common case).
   *   3. Only when DIVERGED: defer if a stream is live (don't stomp it), else do the clean
   *      seq-ordered rebuild — identical to a manual reload, which the audit proved converges.
   */
  export async function softReloadHistory(sessionId) {
    if (!sessionId) return;
    const isCurrent = () => !sessionModule || !sessionModule.getCurrentSessionId ||
      sessionModule.getCurrentSessionId() === sessionId;
    if (!isCurrent()) return;

    let data;
    try {
      const res = await fetch(`${API_BASE}/api/history/${sessionId}`);
      if (!res.ok) return;
      data = await res.json();
    } catch (_) { return; }
    if (!isCurrent()) return;

    const box = document.getElementById('chat-history');
    if (!box) return;
    const modelName = data.model || null;
    // Authoritative seq-ordered log (the API orders by seq), minus the continuation/instruction
    // prompts the live view never shows.
    const visible = (data.history || [])
      .filter(m => !(m.role === 'user' && _isSkippableUserPrompt(_historyMsgText(m))));

    // 1) ADOPT PASS — no DOM churn.
    const byId = new Map(), byClient = new Map();
    box.querySelectorAll('.msg').forEach((el) => {
      if (el.dataset.dbId) byId.set(el.dataset.dbId, el);
      if (el.dataset.clientMsgId) byClient.set(el.dataset.clientMsgId, el);
    });
    for (const msg of visible) {
      const sid = _serverMsgId(msg);
      const cid = msg.metadata && msg.metadata.client_msg_id;
      const el = (sid && byId.get(sid)) || (cid && byClient.get(cid)) || null;
      if (el) {
        if (sid) { el.dataset.dbId = sid; byId.set(sid, el); }
        if (msg.seq != null) el.dataset.seq = String(msg.seq);
      }
    }

    // BUG 1 — REORDER PASS (non-destructive). Now that every matched bubble carries its authoritative
    // `data-seq`, move any that are out of seq order back into place WITHOUT a DOM wipe. This runs on
    // EVERY reconcile attempt — including the "converged"/early-return common case below AND while a
    // stream is in flight (the `hasActiveStream` early-return is further down), so a bubble that was
    // appended out of arrival-vs-seq order (a peer write racing the local turn, two interleaved
    // `message_saved`s) is corrected the instant its seq is known, not only when a destructive rebuild
    // finally fires. Idempotent: zero churn when already ordered. A still-pending optimistic send (no
    // seq) keeps its place at the tail — exactly where the newest local turn belongs.
    _reorderBySeq(box);

    // 2) DIVERGENCE CHECK — rendered id order vs. server seq order.
    // ADR 0012 (GAP 2): an error turn forces ONE content rebuild — the error bubble may already carry
    // the persisted message's {id, seq} (so the id-order is "converged") while showing the raw error
    // text, not the persisted fallback. Consume the one-shot flag so subsequent reloads are normal.
    // SELF-GUARD: only honor the force when the server actually has at least as many messages as are
    // rendered — i.e. there IS a persisted message to converge to. A hard fail that persisted NOTHING
    // (server has fewer messages) keeps its live error bubble rather than the rebuild erasing it.
    let _forced = _forceRebuild.delete(sessionId);
    const renderedCount = box.querySelectorAll('.msg').length;
    if (_forced && visible.length < renderedCount) _forced = false;
    const renderedIds = Array.from(box.querySelectorAll('.msg[data-db-id]')).map((el) => el.dataset.dbId);
    const serverIds = visible.map(_serverMsgId).filter(Boolean);
    // F5 (dedup hardening): the id-order check alone is BLIND to a db-id-LESS ORPHAN bubble — a
    // continuation/round bubble (multi-round agent turn) or a resume finalize-in-place bubble that
    // never received its data-db-id. Such an orphan is invisible to `renderedIds` (which selects only
    // `.msg[data-db-id]`), so the rendered id-order could equal the server seq-order ("converged")
    // WHILE an extra duplicate bubble sits on screen → the dup survived every reload (issue #873 / F5).
    // Count VISIBLE message bubbles (excluding the hidden tool-only / production-cue rows, which are
    // display:none and have no server counterpart) and require it to equal the server's visible-message
    // count. A mismatch means an orphan (or a missing bubble) is present → NOT converged → rebuild to
    // the authoritative log, which collapses the orphan with ZERO net churn on the already-correct case.
    const orphanFree = _visibleMsgCount(box) === visible.length;
    const converged = orphanFree &&
      renderedIds.length === serverIds.length &&
      renderedIds.every((v, i) => v === serverIds[i]);
    if (converged && !_forced) { _pendingReconcile.delete(sessionId); return; }

    // 3) DIVERGED (or forced) — defer past a live stream, else rebuild to the authoritative order.
    if (hasActiveStream(sessionId)) {
      _pendingReconcile.add(sessionId);
      if (_forced) _forceRebuild.add(sessionId);   // re-arm the one-shot force for the deferred flush
      return;
    }
    _pendingReconcile.delete(sessionId);

    // #836 / "never eat a message": before we blow away the DOM, RESCUE any still-pending optimistic
    // user bubble (clientMsgId, no dbId) whose persisted row is ABSENT from this server snapshot — so the
    // authoritative rebuild can NEVER erase what the player just typed. A bubble whose client_msg_id IS
    // present in `visible` is re-rendered from the server log below (no rescue needed); only the un-adopted
    // pending sends are carried across, then normal adoption reconciles them when their row appears.
    const _serverClientIds = new Set(
      visible.map(m => m.metadata && m.metadata.client_msg_id).filter(Boolean)
    );
    const _pendingToPreserve = Array.from(box.querySelectorAll('.msg'))
      .filter(el => _isPendingOptimisticBubble(el) && !_serverClientIds.has(el.dataset.clientMsgId));

    const nearBottom = (box.scrollHeight - box.scrollTop - box.clientHeight) < 120;
    const prevScrollTop = box.scrollTop;
    box.classList.add('no-animate');
    box.innerHTML = '';
    for (const msg of visible) {
      const meta = msg.metadata ? { ...msg.metadata, _fromHistory: true } : { _fromHistory: true };
      chatRenderer.addMessage(msg.role, markdownModule.renderContent(_historyMsgText(msg)), modelName, meta);
    }
    // Re-append the rescued pending sends after the authoritative log (they are the newest turn — the row
    // the server hasn't surfaced yet). They keep their clientMsgId so the next reload's adopt pass claims
    // them with zero churn the moment /api/history carries their persisted row.
    for (const el of _pendingToPreserve) box.appendChild(el);
    box.classList.remove('no-animate');
    if (nearBottom) {
      if (uiModule.scrollHistoryInstant) uiModule.scrollHistoryInstant();
      else if (uiModule.scrollHistory) uiModule.scrollHistory();
    } else {
      // Reader was scrolled up — keep their place (new content was appended below).
      box.scrollTop = prevScrollTop;
    }
  }

  /** ADR 0008: flush a reconcile deferred because a stream was in flight (called at stream end).
   * Returns the softReloadHistory promise so callers can sequence work AFTER the rebuild settles
   * (the GAP-1 peer-resume chains on it so the peer's user turn is adopted before its reply attaches). */
  export function flushPendingReconcile(sessionId) {
    const id = sessionId || (sessionModule && sessionModule.getCurrentSessionId && sessionModule.getCurrentSessionId());
    if (!id) return Promise.resolve();
    // Always run once at stream end: the adopt pass alone (cheap, no churn) gives the sender
    // read-your-writes even when nothing diverged; if it DID diverge, this does the rebuild.
    _pendingReconcile.delete(id);
    try { return Promise.resolve(softReloadHistory(id)).catch(function () {}); } catch (_) { return Promise.resolve(); }
  }

  /**
   * ADR 0012 (GAP 1): note a peer's run-started that we couldn't attach to LIVE because our own
   * stream was in flight, so the stream-end finally can RE-ATTEMPT the attach. Called from
   * sessionSync's run-started handler. Idempotent (a Set); no-op if no resume seam exists.
   */
  export function deferPeerResume(sessionId) {
    if (!sessionId) return;
    _pendingPeerResume.add(sessionId);
  }

  /**
   * ADR 0012 (GAP 1): flush a peer-resume deferred because OUR stream was in flight (called at
   * stream end). Now that our stream has settled, attach to the canonical run so we mirror the peer's
   * turn LIVE. resumeStream's own guards make this safe + idempotent: it no-ops if another reader is
   * already live for the session (hasActiveStream) and replays a just-finished run's buffer within the
   * evict grace; if the run is already gone, softReloadHistory has the settled message anyway.
   */
  export function flushPendingPeerResume(sessionId) {
    const id = sessionId || (sessionModule && sessionModule.getCurrentSessionId && sessionModule.getCurrentSessionId());
    if (!id) return;
    if (!_pendingPeerResume.has(id)) return;
    _pendingPeerResume.delete(id);
    // Only attach if we're still viewing this session and nothing else is already rendering it live.
    const onIt = !sessionModule || !sessionModule.getCurrentSessionId ||
                 sessionModule.getCurrentSessionId() === id;
    if (!onIt) return;
    if (hasActiveStream(id)) return;          // a newer stream took over — it owns the render
    try { resumeStream(id); } catch (_) {}
  }

  /**
   * Live-resume a chat run still streaming detached on the server (#2539).
   *
   * On session re-entry, GET /api/chat/resume/{id} replays the run's buffer then
   * streams live; reply tokens render as they arrive. On completion a plain text
   * reply is finalized in place (canonical bubble via chatRenderer.addMessage, no
   * reload); a "rich" reply (tool calls, sources, doc streaming, multi-round) is
   * reloaded from the DB so its full render stays faithful. Returns true if it
   * attached, false to let the caller fall back to spinner+poll.
   */
  export async function resumeStream(sessionId) {
    if (!sessionId) return false;
    if (hasActiveStream(sessionId)) return false;

    let res;
    try {
      res = await fetch(`${API_BASE}/api/chat/resume/${sessionId}`);
    } catch (e) {
      return false;
    }
    if (!res.ok || !res.body) return false;

    const box = document.getElementById('chat-history');
    if (!box) return false;

    // Block duplicate re-attach attempts while this reader is live. A dedicated
    // set (not _backgroundStreams) so checkBackgroundStream doesn't mistake this
    // for a same-tab POST stream and spawn its own spinner+poll on re-entry.
    _resumingStreams.add(sessionId);

    const holder = document.createElement('div');
    holder.className = 'msg msg-ai';
    const meta = sessionModule.getSessions().find(s => s.id === sessionId);
    const roleLabel = _senderLabel(_shortModel(meta && meta.model));
    // ADR 0012 §2.2: the live bubble is created with a placeholder time, then RE-STAMPED from the
    // SERVER-minted timestamp the moment the replayed message_saved event arrives (serverTs below), so
    // an observer re-attaching to a live run reads the IDENTICAL time string as the sender and the
    // history reload — not its own `new Date()` at attach time.
    const roleTs = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    holder.innerHTML = '<div class="role">' + uiModule.esc(roleLabel) +
      ' <span class="role-timestamp">' + roleTs + '</span></div>' +
      '<div class="body"><div class="stream-content"></div></div>';
    _applyModelColor(holder.querySelector('.role'), meta && meta.model);
    const contentDiv = holder.querySelector('.stream-content');
    box.appendChild(holder);

    const spinner = spinnerModule.create(_inProgressLabel('Generating response...'), 'right');
    holder.querySelector('.body').appendChild(spinner.createElement());
    spinner.start();
    uiModule.scrollHistory();

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let replyText = '';      // public reply deltas
    let reasoningText = '';  // reasoning deltas (thinking:true) — kept OUT of the bubble
    let gotDelta = false;
    let leftSession = false;
    let metricsData = null;
    // ADR 0012 §2.2: the SERVER-minted message timestamp, captured off the replayed message_saved
    // event so the finalize renders the identical time string the sender/history do (not a local
    // attach-time `new Date()`).
    let serverTs = null;
    // F5 (dedup hardening): the SERVER-minted DB id, captured off the replayed message_saved event.
    // Stamped onto the finalized-in-place bubble below so the resumed reply carries its {db id} —
    // otherwise the finalize creates a db-id-LESS orphan that softReloadHistory's adopt pass cannot
    // match and its divergence check ignored, so a later reload left a DUPLICATE bubble (the audit's
    // "resume finalize-in-place can leave a db-id-less duplicate bubble"). With the id stamped, the
    // adopt pass matches it with ZERO churn — the streamed bubble keeps its single entrance.
    let savedDbId = null;
    // "Rich" responses (tool calls, sources, doc streaming, multi-round) need the
    // full canonical render, which is rebuilt from the saved DB record on reload.
    // Plain text replies can be finalized in place without a reload.
    let rich = false;

    const cleanup = () => {
      try { spinner.destroy(); } catch (_) {}
      _resumingStreams.delete(sessionId);
    };

    // Canonical combined source: reasoning wrapped in a CLOSED <think> block (so it renders
    // in the default-collapsed accordion and can NEVER leak into the public bubble) followed
    // by the clean reply. This is the SAME shape the primary stream path and the history
    // reload use, routed through the SAME renderer (processWithThinking) — so an observer tab
    // that re-attaches to a live run renders reasoning identically instead of dumping it raw
    // into the bubble. That divergence WAS the cross-session "reasoning leaks" hot mess.
    const _combined = () => {
      const reply = stripToolBlocks(replyText);
      return reasoningText.trim()
        ? '<think>' + reasoningText + '</think>\n\n' + reply
        : reply;
    };
    const renderDelta = () => {
      contentDiv.innerHTML = markdownModule.processWithThinking(
        markdownModule.squashOutsideCode(_combined())
      );
      uiModule.scrollHistory();
    };

    try {
      readLoop:
      while (true) {
        // User left this session: stop rendering, the run continues server-side.
        if (sessionModule.getCurrentSessionId &&
            sessionModule.getCurrentSessionId() !== sessionId) {
          leftSession = true;
          try { await reader.cancel(); } catch (_) {}
          break;
        }
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop();
        for (const part of parts) {
          const line = part.split('\n').find(l => l.startsWith('data: '));
          if (!line) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') {
            try { await reader.cancel(); } catch (_) {}
            break readLoop;
          }
          let json;
          try { json = JSON.parse(payload); } catch (_) { continue; }
          if (json.delta) {
            // Route reasoning (thinking:true) to its own buffer so it lands in the collapsed
            // accordion, exactly like the primary stream path — never raw into the bubble.
            if (json.thinking) reasoningText += json.delta;
            else replyText += json.delta;
            if (!gotDelta) { gotDelta = true; try { spinner.destroy(); } catch (_) {} }
            renderDelta();
          } else if (json.type === 'doc_stream_open') {
            rich = true;
            if (documentModule) documentModule.streamDocOpen(json.title || '', json.lang || '');
          } else if (json.type === 'doc_stream_delta') {
            rich = true;
            if (documentModule && json.delta) documentModule.streamDocDelta(json.delta);
          } else if (json.type === 'metrics') {
            metricsData = json.data || metricsData;
          } else if (json.type === 'message_saved') {
            // ADR 0012 §2.2: the run's persisted-message signal is in the replay buffer — capture its
            // server timestamp and re-stamp the live bubble so this observer reads the same time as
            // every other window. (json.id is the DB id; the finalize/reload carries it forward.)
            if (json.ts) { serverTs = json.ts; _applyServerTimestamp(holder, serverTs); }
            // F5 (dedup hardening): also capture the DB id so the finalize-in-place below stamps
            // data-db-id onto the canonical bubble (zero-churn adopt on a later reload, no duplicate).
            if (json.id) { savedDbId = json.id; holder.dataset.dbId = json.id; }
          } else if (json.type === 'tool_start' || json.type === 'tool_output' ||
                     json.type === 'tool_progress' || json.type === 'agent_step' ||
                     json.type === 'web_sources' || json.type === 'rag_sources' ||
                     json.type === 'research_progress' || json.type === 'research_sources' ||
                     json.type === 'research_findings' || json.type === 'research_done') {
            rich = true;
          }
        }
      }
    } catch (e) {
      // Network drop or parse failure: fall through to the reload below.
    }

    cleanup();
    if (leftSession) { if (holder.parentNode) holder.remove(); return true; }

    const onThisSession = sessionModule.getCurrentSessionId &&
                          sessionModule.getCurrentSessionId() === sessionId;

    // Plain text reply: finalize in place. Replace the live bubble with a
    // canonical single message (markdown + footer actions + metrics) using the
    // same renderer history does. No history refetch, no end-of-stream flicker.
    // Pass the canonical <think>-wrapped source so addMessage's processWithThinking
    // splits reasoning → accordion and reply → bubble (matching the live render above).
    if (onThisSession && !rich && replyText.trim()) {
      if (holder.parentNode) holder.remove();
      const model = meta && meta.model;
      const meta_ = metricsData ? Object.assign({ model }, metricsData) : { model };
      // ADR 0012 §2.2: carry the server timestamp onto the canonical bubble so the finalize renders
      // the identical time string as the sender's bubble and the history reload (chatRenderer.addMessage
      // → roleTimestamp(metadata.timestamp)). Absent ⇒ roleTimestamp falls back to "now" (prior behavior).
      if (serverTs) meta_.timestamp = serverTs;
      // F5 (dedup hardening): carry the DB id so the finalized bubble is data-db-id-stamped (addMessage
      // reads metadata._db_id). A later softReloadHistory then ADOPTS this bubble (id match) with ZERO
      // churn instead of leaving it an unmatchable orphan beside the canonical reload render (duplicate).
      if (savedDbId) meta_._db_id = savedDbId;
      chatRenderer.addMessage('assistant', _combined(), model, meta_);
      uiModule.scrollHistory();
      return true;
    }

    // Rich response (tools, sources, docs, multi-round) or user moved on:
    // reload from the DB for the full canonical render.
    if (holder.parentNode) holder.remove();
    if (onThisSession) sessionModule.selectSession(sessionId);
    else sessionModule.loadSessions();
    return true;
  }

  /**
   * Check for background streams when switching to a session.
   * Called after history loads on session switch.
   */
  export function checkBackgroundStream(sessionId) {
    if (!sessionId || !_backgroundStreams.has(sessionId)) return;
    var entry = _backgroundStreams.get(sessionId);

    if (entry.status === 'completed') {
      // Response is already saved to DB and will appear in history — just clean up
      _backgroundStreams.delete(sessionId);
      return;
    }

    if (entry.status === 'error') {
      _backgroundStreams.delete(sessionId);
      var box = document.getElementById('chat-history');
      if (box) {
        var errHolder = document.createElement('div');
        errHolder.className = 'msg msg-ai';
        errHolder.innerHTML = '<div class="body"><i style="color: var(--color-error);">[Background stream encountered an error]</i></div>';
        box.appendChild(errHolder);
      }
      return;
    }

    if (entry.status === 'running') {
      // Stream is still active — show a clean spinner, poll until done,
      // then reload history to show the final saved response.
      var box = document.getElementById('chat-history');
      if (!box) return;

      // Replay any doc content that was streamed in the background
      if (entry._docTitle != null && documentModule) {
        documentModule.streamDocOpen(entry._docTitle, entry._docLang || '');
        if (entry._docContent) {
          documentModule.streamDocDelta(entry._docContent);
        }
      }

      var holder = document.createElement('div');
      holder.className = 'msg msg-ai';
      var meta = sessionModule.getSessions().find(function(s) { return s.id === sessionId; });
      var roleLabel = _senderLabel(_shortModel(meta && meta.model));
      var roleTs = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
      holder.innerHTML = '<div class="role">' + uiModule.esc(roleLabel) + ' <span class="role-timestamp">' + roleTs + '</span></div><div class="body"></div>';
      _applyModelColor(holder.querySelector('.role'), meta && meta.model);

      var bodyDiv = holder.querySelector('.body');
      var spinner = spinnerModule.create(_inProgressLabel('Response streaming in background'), 'right');
      bodyDiv.appendChild(spinner.createElement());
      spinner.start();

      box.appendChild(holder);
      uiModule.scrollHistory();

      // Poll map until stream finishes, then reload history
      var pollId = setInterval(function() {
        if (sessionModule.getCurrentSessionId() !== sessionId) {
          clearInterval(pollId);
          spinner.destroy();
          if (holder.parentNode) holder.remove();
          return;
        }
        // Update doc content while polling
        var curPoll = _backgroundStreams.get(sessionId);
        if (curPoll && curPoll._docContent && documentModule) {
          documentModule.streamDocDelta(curPoll._docContent);
        }
        if (!curPoll || curPoll.status !== 'running') {
          clearInterval(pollId);
          spinner.destroy();
          if (holder.parentNode) holder.remove(); // Remove entire holder, not just spinner
          _backgroundStreams.delete(sessionId);
          // Reload session to show the completed response — but only if the user
          // is still on it; don't yank them back from a new chat they opened.
          if (sessionModule.getCurrentSessionId && sessionModule.getCurrentSessionId() === sessionId) {
            sessionModule.selectSession(sessionId);
          } else {
            sessionModule.loadSessions();
          }
        }
      }, 500);
    }
  }

  // Tag short single-line code blocks with .pre-compact so the CSS can
  // render the Run/Edit/Copy buttons as a slim row that doesn't make a
  // 1-line bash block taller than its own contents.
  function _markCompactPre(pre) {
    const code = pre.querySelector('code');
    if (!code) return;
    const txt = code.textContent || '';
    // Count visible lines — ignore trailing newline (common with fenced
    // blocks) and treat any empty extra line as not a real second line.
    const lines = txt.replace(/\n+$/, '').split('\n');
    const compact = lines.length <= 1 && txt.length < 200;
    pre.classList.toggle('pre-compact', compact);
  }
  function _scanCompactPres(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('pre').forEach(_markCompactPre);
  }
  // Global observer so any <pre> added anywhere in the app (chat stream,
  // chat re-renders, document library chat previews, slash commands,
  // research previews, etc.) gets tagged without each call site needing
  // to remember.
  (function _initCompactPreObserver() {
    if (window._cmpPreObserverWired) return;
    window._cmpPreObserverWired = true;
    _scanCompactPres(document.body);
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.tagName === 'PRE') _markCompactPre(n);
          if (n.querySelectorAll) _scanCompactPres(n);
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  })();

  /**
   * Initialize event listeners
   */
  export function initListeners() {
    // Global event delegation for copy-code buttons
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.copy-code');
      if (!btn) return;
      e.stopPropagation();
      const code = btn.getAttribute('data-code');
      if (code && uiModule) {
        uiModule.copyToClipboard(code);
        // Visual feedback: swap the icon to a checkmark (regular size)
        // and add .copied which the CSS uses to flash green + pulse.
        // For slim/.pre-compact buttons the label text comes from a
        // CSS ::before — swap it via data-state so we don't break the
        // text-button layout.
        const origHTML = btn.innerHTML;
        const isCompact = !!btn.closest('pre.pre-compact');
        if (!isCompact) {
          btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        }
        btn.classList.add('copied');
        btn.dataset.state = 'copied';
        setTimeout(() => {
          if (!isCompact) btn.innerHTML = origHTML;
          btn.classList.remove('copied');
          delete btn.dataset.state;
        }, 1500);
      }
    });

    // Run code button delegation
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.run-code');
      if (!btn) return;
      e.stopPropagation();
      if (codeRunnerModule) codeRunnerModule.run(btn);
    });

    // Edit code button delegation — toggle contentEditable on the code element
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.edit-code');
      if (!btn) return;
      e.stopPropagation();
      const pre = btn.closest('pre');
      if (!pre) return;
      const codeEl = pre.querySelector('code');
      if (!codeEl) return;
      const isEditing = codeEl.contentEditable !== 'false' && codeEl.contentEditable !== 'inherit';
      if (isEditing) {
        // Save: exit edit mode, update data-code on copy/run buttons
        codeEl.contentEditable = 'false';
        codeEl.classList.remove('editing');
        pre.classList.remove('editing');
        const newCode = codeEl.textContent;
        const copyBtn = pre.querySelector('.copy-code');
        if (copyBtn) copyBtn.setAttribute('data-code', newCode);
        const runBtn = pre.querySelector('.run-code');
        if (runBtn) runBtn.setAttribute('data-code', newCode);
        // Swap icon back to pencil
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
        btn.title = 'Edit';
        btn.classList.remove('active');
      } else {
        // Enter edit mode. Firefox (especially on mobile) historically lacks
        // contentEditable="plaintext-only" — setting it there leaves the block
        // non-editable, so the tap "just gets a checkmark" with no way to type.
        // Fall back to "true" when plaintext-only didn't take.
        try { codeEl.contentEditable = 'plaintext-only'; } catch (_) { /* unsupported value */ }
        if (codeEl.contentEditable !== 'plaintext-only') codeEl.contentEditable = 'true';
        codeEl.classList.add('editing');
        pre.classList.add('editing');
        // preventScroll keeps the page from jumping to the codeblock when
        // focusing the editable on mobile — the browser would otherwise
        // scroll it into view above the keyboard, which reads as "auto-
        // scroll triggered by clicking Edit".
        try { codeEl.focus({ preventScroll: true }); } catch (_) { codeEl.focus(); }
        // Swap icon to checkmark
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        btn.title = 'Done editing';
        btn.classList.add('active');
      }
    });

    // Tapping a code block body (not its buttons) toggles the overlay
    // copy/edit/run buttons, which otherwise cover the text on mobile.
    document.addEventListener('click', (e) => {
      if (e.target.closest('.copy-code, .edit-code, .run-code')) return;
      const pre = e.target.closest('pre');
      if (!pre || !pre.querySelector('.copy-code')) return;
      // Don't hide while editing — the buttons (incl. the Done checkmark) matter.
      if (pre.classList.contains('editing')) return;
      pre.classList.toggle('buttons-hidden');
    });

    // Position copy/run buttons top or bottom based on viewport position
    // — DESKTOP ONLY. On mobile this was constantly retriggering on tap
    // (synthetic mouseenter) and made the buttons jump, so the user's
    // finger landed on the moved target. Keep them pinned at the top on
    // touch — no auto-repositioning.
    document.addEventListener('mouseenter', (e) => {
      if (window.matchMedia('(max-width: 768px)').matches) return;
      const pre = e.target.closest ? e.target.closest('pre') : null;
      if (!pre || pre.dataset.btnPosComputed) return;
      const rect = pre.getBoundingClientRect();
      const threshold = window.innerHeight * 0.35;
      const isBottom = rect.top < threshold;
      const copyBtn = pre.querySelector('.copy-code');
      if (copyBtn) copyBtn.classList.toggle('bottom', isBottom);
      const editBtn = pre.querySelector('.edit-code');
      if (editBtn) editBtn.classList.toggle('bottom', isBottom);
      const runBtn = pre.querySelector('.run-code');
      if (runBtn) runBtn.classList.toggle('bottom', isBottom);
      pre.dataset.btnPosComputed = '1';
    }, true);

    // #971 — reconcile the composer button whenever a game mutation lands. A backgrounded stream that
    // finished on another surface (or a peer-resumed run) can leave THIS window's button stuck on Stop;
    // `orwell:gamechanged` (the debounced freshness seam, fired on every mutating tool result + the
    // cross-device push) is the natural moment to repair it to the true streaming/idle state. Idempotent
    // (a no-op when the button already matches), and never disturbs a genuinely live foreground stream.
    window.addEventListener('orwell:gamechanged', () => {
      try { _syncSubmitButtonState(); } catch (_) {}
    });

    // Tab suspension recovery: when user tabs back in, check if stream froze
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      // #971 — on tab return, FIRST repair a button left stuck on Stop by a stream that settled while
      // the tab was hidden/backgrounded (the `_isBgFinally` path never reset it). Cheap + idempotent;
      // runs even when not streaming, so the stuck-Stop case recovers the moment the user looks back.
      try { _syncSubmitButtonState(); } catch (_) {}
      if (!isStreaming) return;

      // Stream claims to be running — check if reader is actually alive
      const staleSince = Date.now() - _lastReaderActivity;
      if (staleSince < 20000) return; // Active recently, probably fine

      // Reader hasn't produced data in 5+ seconds after tab resume.
      // Give it a short grace period then recover.
      console.warn('[tab-recovery] Stream appears frozen (no activity for ' + Math.round(staleSince/1000) + 's). Recovering...');

      setTimeout(() => {
        // Re-check — maybe the reader woke up during the grace period
        if (!isStreaming) return;
        const stillStale = Date.now() - _lastReaderActivity;
        if (stillStale < 5000) return; // Came back to life

        console.warn('[tab-recovery] Stream confirmed dead. Aborting and reloading session.');

        // Abort the frozen stream, but preserve the visible bubble.
        if (currentAbort) {
          currentAbort._reason = 'recovery';
          currentAbort.abort();
        }
        isStreaming = false;

        // Release Web Lock
        if (_webLockRelease) {
          _webLockRelease();
          _webLockRelease = null;
        }

        // Reset UI state
        var _submitBtn = document.getElementById('submit');
        updateSubmitButton('idle', _submitBtn);
        var _msgInput = document.getElementById('message');
        if (_msgInput) _msgInput.disabled = false;
      }, 2000); // 2 second grace period
    });

    // On mobile, fade out welcome text when keyboard opens to prevent overlap
    if (isNarrow()) {
      const msgInput = document.getElementById('message');
      if (msgInput) {
        msgInput.addEventListener('focus', () => {
          const ws = document.getElementById('welcome-screen');
          if (ws && !ws.classList.contains('hidden')) {
            ws.classList.add('kb-hidden');
          }
        });
        msgInput.addEventListener('blur', () => {
          const ws = document.getElementById('welcome-screen');
          if (ws && !ws.classList.contains('hidden')) {
            // Delay re-show so tapping within chatbox doesn't flash
            setTimeout(() => {
              if (document.activeElement !== msgInput) {
                ws.classList.remove('kb-hidden');
              }
            }, 200);
          }
        });
      }
      // Smooth viewport resize when keyboard opens/closes
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => {
          document.documentElement.style.setProperty('--vh', window.visualViewport.height + 'px');
        });
        document.documentElement.style.setProperty('--vh', window.visualViewport.height + 'px');
      }
    }

    // If the browser discarded and restored this tab, reload the current session
    // so the user sees the server-saved partial response instead of a blank page
    if (document.wasDiscarded) {
      console.warn('[tab-recovery] Tab was discarded by browser — reloading session');
      setTimeout(() => {
        var _sid = sessionModule && sessionModule.getCurrentSessionId();
        if (_sid) sessionModule.selectSession(_sid);
      }, 500);
    }
  }

  /**
   * Regenerate response: truncate history to the user message before this AI message,
   * then re-submit that user message.
   */
  /**
   * Edit a user message: show an input, truncate to before it, resubmit the edited text.
   */
  export async function editUserMessage(userMsgElement) {
    const box = document.getElementById('chat-history');
    const allMsgs = Array.from(box.querySelectorAll('.msg'));
    const msgIndex = allMsgs.indexOf(userMsgElement);
    if (msgIndex < 0) return;

    const bodyEl = userMsgElement.querySelector('.body');
    const currentText = bodyEl ? bodyEl.textContent.trim().replace(/\s*\[\d+ attachment\(s\)\]$/, '') : '';

    // Replace body with an editable textarea
    const editor = document.createElement('textarea');
    editor.className = 'edit-textarea';
    editor.value = currentText;
    editor.rows = Math.max(2, currentText.split('\n').length);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex; gap:6px; margin-top:4px;';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'edit-save-btn';
    saveBtn.textContent = 'Send';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'edit-cancel-btn';
    cancelBtn.textContent = 'Cancel';
    btnRow.appendChild(saveBtn);
    btnRow.appendChild(cancelBtn);

    const originalHTML = bodyEl.innerHTML;
    bodyEl.innerHTML = '';
    bodyEl.appendChild(editor);
    bodyEl.appendChild(btnRow);
    editor.focus();

    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      bodyEl.innerHTML = originalHTML;
    });

    saveBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const newText = editor.value.trim();
      if (!newText) return;

      const sessionId = sessionModule.getCurrentSessionId();
      if (!sessionId) return;

      const keepCount = msgIndex;
      try {
        await fetch(`${API_BASE}/api/session/${sessionId}/truncate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keep_count: keepCount })
        });

        // Remove DOM elements from msgIndex onward
        for (let i = allMsgs.length - 1; i >= msgIndex; i--) {
          allMsgs[i].remove();
        }

        // Submit the edited text (headless — no composer puppeteering)
        handleChatSubmit(null, newText);
      } catch (err) {
        console.error('Edit failed:', err);
        if (uiModule) uiModule.showError('Edit failed: ' + err.message);
        bodyEl.innerHTML = originalHTML;
      }
    });

    // Also submit on Enter (without shift)
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        saveBtn.click();
      }
    });
  }

  /**
   * Resend a user message — truncates history to that point and resubmits.
   */
  export async function resendUserMessage(userMsgElement) {
    const box = document.getElementById('chat-history');
    const allMsgs = Array.from(box.querySelectorAll('.msg'));
    const msgIndex = allMsgs.indexOf(userMsgElement);
    if (msgIndex < 0) return;

    // Prefer dataset.raw (stripped original user text) over .body.textContent
    // — the latter slurps the rendered "View image description" collapsible
    // content too, which would then be sent back as the user's question and
    // the AI would reply to that gibberish instead of the actual prompt.
    const bodyEl = userMsgElement.querySelector('.body');
    let text = (userMsgElement.dataset.raw || (bodyEl ? bodyEl.textContent : '') || '').trim();
    text = text.replace(/\s*\[\d+ attachment\(s\)\]$/, '');

    // Collect file_ids attached to this user message so the resend re-carries
    // the photos / docs (and the chat handler picks up the user-edited OCR
    // text cached server-side under those file ids).
    const _attachEls = userMsgElement.querySelectorAll('[data-file-id]');
    let _ids = Array.from(_attachEls).map(el => el.dataset.fileId).filter(Boolean);
    if (!_ids.length) {
      const _imgs = userMsgElement.querySelectorAll('.attach-image-preview img, .attach-card img');
      for (const _im of _imgs) {
        const _m = (_im.getAttribute('src') || '').match(/\/api\/upload\/([A-Za-z0-9_\-]+)/);
        if (_m && _m[1] && !_ids.includes(_m[1])) _ids.push(_m[1]);
      }
    }

    // Rescue: legacy bubbles may have stored the filename as the message
    // content (artifact of earlier broken resends). Don't re-send that as
    // the user prompt if we still have the file attached. Loosen the regex
    // to cover real-world camera/screenshot names with spaces, parens,
    // multi-dots: "Screen Shot 2026-05-28 at 4.05.32 PM.png", "IMG (1).JPG".
    if (text && _ids.length && /^[^\n\r]{1,200}\.(png|jpe?g|gif|webp|svg|bmp|heic|heif)$/i.test(text)) {
      text = '';
    }
    // Empty text + no attachments → tell the user instead of silently bailing.
    // The common case is a regen during a pre-upload race where the bubble
    // never had an `[data-file-id]` to scrape.
    if (!text && !_ids.length) {
      if (uiModule?.showError) uiModule.showError('Nothing to resend — message has no text and no attachments yet (try again after the upload finishes).');
      return;
    }

    const sessionId = sessionModule.getCurrentSessionId();
    if (!sessionId) return;

    // Truncate backend to keep everything before this user message
    const keepCount = msgIndex;
    try {
      await fetch(`${API_BASE}/api/session/${sessionId}/truncate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keep_count: keepCount })
      });

      // Drop the AI replies after the user message but KEEP the user bubble
      // itself (so its photo stays visible). Then suppress the new user
      // bubble that send would otherwise add — same pattern as regenerate.
      let sibling = userMsgElement.nextSibling;
      while (sibling) {
        const next = sibling.nextSibling;
        sibling.remove();
        sibling = next;
      }
      _hideUserBubble = true;
      _pendingRegenAttachments = _ids;

      // Resubmit (headless — no composer puppeteering)
      handleChatSubmit(null, text);
    } catch (err) {
      console.error('Resend failed:', err);
      if (uiModule) uiModule.showError('Resend failed: ' + err.message);
    }
  }

  export async function regenerateFrom(aiMsgElement) {
    const box = document.getElementById('chat-history');
    const allMsgs = Array.from(box.querySelectorAll('.msg'));
    const aiIndex = allMsgs.indexOf(aiMsgElement);
    if (aiIndex < 0) return;

    // Find the preceding user message
    let userIndex = -1;
    let userText = '';
    let userMsgEl = null;
    for (let i = aiIndex - 1; i >= 0; i--) {
      if (allMsgs[i].classList.contains('msg-user')) {
        userIndex = i;
        userMsgEl = allMsgs[i];
        // Prefer dataset.raw (set by addMessage with the stripped, original
        // user text) over the rendered body's textContent — the latter
        // pulls in the "View image description" collapsible content too,
        // duplicating the OCR text on regen.
        const bodyEl = userMsgEl.querySelector('.body');
        userText = (userMsgEl.dataset.raw || (bodyEl ? bodyEl.textContent : '') || '').trim();
        userText = userText.replace(/\s*\[\d+ attachment\(s\)\]$/, '');
        break;
      }
    }

    if (userIndex < 0) {
      if (uiModule) uiModule.showError('Could not find the user message to regenerate');
      return;
    }

    // Collect any file_ids attached to the original user message so the
    // regenerated send re-uses them. Without this the AI is regenerated on
    // text alone — photos (and the user-edited OCR text cached server-side
    // under that file_id) would be silently dropped.
    const _attachEls = userMsgEl ? userMsgEl.querySelectorAll('[data-file-id]') : [];
    let _regenIds = Array.from(_attachEls).map(el => el.dataset.fileId).filter(Boolean);
    // Fallback for bubbles rendered before the data-file-id stamp landed:
    // sniff the file id straight out of any `.attach-image-preview img`
    // src URLs (matches /api/upload/<id>). Otherwise an older bubble would
    // regen with zero attachments and the photo would be lost from the
    // resulting message even though the file still exists on disk.
    if (!_regenIds.length && userMsgEl) {
      const _imgs = userMsgEl.querySelectorAll('.attach-image-preview img, .attach-card img');
      for (const _im of _imgs) {
        const _m = (_im.getAttribute('src') || '').match(/\/api\/upload\/([A-Za-z0-9_\-]+)/);
        if (_m && _m[1] && !_regenIds.includes(_m[1])) _regenIds.push(_m[1]);
      }
    }
    _pendingRegenAttachments = _regenIds;

    // Rescue: earlier-version regens (before the dataset.raw fix) stored the
    // photo's filename as the user-message content. On a follow-up regen,
    // that filename would be sent back as the literal user prompt, so the
    // AI thinks the question is "blue_night_preview.jpg" and replies "that's
    // an image file". If userText is just a bare image filename and we have
    // attachments, drop it so the OCR text (or the image bytes for vision
    // models) is what the model actually sees.
    if (userText && _pendingRegenAttachments.length &&
        /^[^\n\r]{1,200}\.(png|jpe?g|gif|webp|svg|bmp|heic|heif)$/i.test(userText.trim())) {
      userText = '';
    }

    // A photo-only message has empty user text — regen must still proceed,
    // because the attachments themselves are the message. Bail only if there
    // is no text AND no attachments to send.
    if (!userText && !_pendingRegenAttachments.length) {
      if (uiModule) uiModule.showError('Nothing to regenerate — the user message has no text and no attachments');
      return;
    }

    const sessionId = sessionModule.getCurrentSessionId();
    if (!sessionId) return;

    // Save current response as a variant
    const oldRaw = aiMsgElement.dataset.raw || aiMsgElement.querySelector('.body')?.textContent || '';
    const oldHtml = aiMsgElement.querySelector('.body')?.innerHTML || '';
    let variants = [];
    try { variants = JSON.parse(aiMsgElement.dataset.variants || '[]'); } catch(_) {}
    if (variants.length === 0) {
      // First regen — save the original as variant 0
      variants.push({ raw: oldRaw, html: oldHtml, label: 'original' });
    }

    const keepCount = userIndex;

    try {
      await fetch(`${API_BASE}/api/session/${sessionId}/truncate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keep_count: keepCount })
      });

      for (let i = allMsgs.length - 1; i > aiIndex; i--) {
        allMsgs[i].remove();
      }

      // Remove the AI message from DOM — it will be replaced by the new streaming response
      // But first, stash the variants data so we can transfer it to the new element
      _pendingVariants = variants;
      _pendingVariantLabel = 'regen';
      aiMsgElement.remove();

      _hideUserBubble = true;
      handleChatSubmit(null, userText); // headless regen — no composer puppeteering

    } catch (err) {
      console.error('Regenerate failed:', err);
      if (uiModule) uiModule.showError('Regenerate failed: ' + err.message);
    }
  }

  // Pending variants from a regeneration — transferred to new streaming element
  let _pendingVariants = null;
  let _pendingVariantLabel = null;
  // File-ids carried over from the original user message during a regen, so
  // photos / OCR overrides survive into the new send. Consumed once.
  let _pendingRegenAttachments = null;

  /**
   * Called after streaming completes to attach variant navigation if this was a regen.
   */
  function _attachVariantNav(msgElement) {
    if (!_pendingVariants) return;
    const variants = _pendingVariants;
    _pendingVariants = null;

    // Add the new response as the latest variant
    const newRaw = msgElement.dataset.raw || msgElement.querySelector('.body')?.textContent || '';
    const newHtml = msgElement.querySelector('.body')?.innerHTML || '';
    const varLabel = _pendingVariantLabel || 'regen';
    _pendingVariantLabel = null;
    variants.push({ raw: newRaw, html: newHtml, label: varLabel });

    msgElement.dataset.variants = JSON.stringify(variants);
    msgElement.dataset.variantIndex = String(variants.length - 1);

    _renderVariantNav(msgElement, variants, variants.length - 1);

    // Persist variants to server
    const sid = sessionModule.getCurrentSessionId();
    if (sid) {
      fetch(`${API_BASE}/api/session/${sid}/update-last-meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metadata: { variants: variants, variantIndex: variants.length - 1 } })
      }).catch(e => console.warn('update-last-meta (variants) failed:', e));
    }
  }

  const _VARIANT_ICONS = { regen: '\u21BB', shorter: '\u2702', simpler: '?', original: '\u25CB' };
  function _variantTagText(label) {
    return _VARIANT_ICONS[label] || _VARIANT_ICONS['original'];
  }

  function _renderVariantNav(msgElement, variants, currentIdx) {
    // Remove existing nav if any
    const old = msgElement.querySelector('.variant-nav');
    if (old) old.remove();

    if (variants.length < 2) return;

    const nav = document.createElement('span');
    nav.className = 'variant-nav';
    nav.addEventListener('click', (e) => e.stopPropagation());

    // Label showing what this variant is
    // Divider
    const divider = document.createElement('span');
    divider.className = 'variant-divider';
    divider.textContent = '|';
    nav.appendChild(divider);

    // Label
    const curVariant = variants[currentIdx];
    const tagLabel = document.createElement('span');
    tagLabel.className = 'variant-tag' + (curVariant?.label === 'shorter' ? ' variant-tag-scissors' : '');
    tagLabel.textContent = _variantTagText(curVariant?.label);
    nav.appendChild(tagLabel);

    // < button
    const prevBtn = document.createElement('button');
    prevBtn.className = 'variant-btn';
    prevBtn.textContent = '<';
    prevBtn.disabled = currentIdx === 0;
    prevBtn.addEventListener('click', (e) => { e.stopPropagation(); _switchVariant(msgElement, variants, currentIdx - 1); });
    nav.appendChild(prevBtn);

    // Clickable number for current index (click left number = go left, right = go right)
    const numLeft = document.createElement('button');
    numLeft.className = 'variant-num';
    numLeft.textContent = String(currentIdx + 1);
    numLeft.disabled = currentIdx === 0;
    numLeft.addEventListener('click', (e) => { e.stopPropagation(); _switchVariant(msgElement, variants, currentIdx - 1); });
    nav.appendChild(numLeft);

    const slash = document.createElement('span');
    slash.className = 'variant-slash';
    slash.textContent = '/';
    nav.appendChild(slash);

    const numRight = document.createElement('button');
    numRight.className = 'variant-num';
    numRight.textContent = String(variants.length);
    numRight.disabled = currentIdx === variants.length - 1;
    numRight.addEventListener('click', (e) => { e.stopPropagation(); _switchVariant(msgElement, variants, currentIdx + 1); });
    nav.appendChild(numRight);

    // > button
    const nextBtn = document.createElement('button');
    nextBtn.className = 'variant-btn';
    nextBtn.textContent = '>';
    nextBtn.disabled = currentIdx === variants.length - 1;
    nextBtn.addEventListener('click', (e) => { e.stopPropagation(); _switchVariant(msgElement, variants, currentIdx + 1); });
    nav.appendChild(nextBtn);

    // Insert into the .role header
    const roleEl = msgElement.querySelector('.role');
    if (roleEl) {
      roleEl.appendChild(nav);
    } else {
      msgElement.appendChild(nav);
    }
  }

  function _switchVariant(msgElement, variants, newIdx) {
    if (newIdx < 0 || newIdx >= variants.length) return;
    const v = variants[newIdx];
    const body = msgElement.querySelector('.body');
    if (body) body.innerHTML = v.html;
    msgElement.dataset.raw = v.raw;
    msgElement.dataset.variantIndex = String(newIdx);
    if (window.hljs) {
      msgElement.querySelectorAll('pre code').forEach(block => window.hljs.highlightElement(block));
    }
    _renderVariantNav(msgElement, variants, newIdx);

    // Persist selected variant to server
    const sid = sessionModule.getCurrentSessionId();
    if (sid) {
      fetch(`${API_BASE}/api/session/${sid}/update-last-meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metadata: { variantIndex: newIdx } })
      }).catch(e => console.warn('update-last-meta (variantIndex) failed:', e));
    }
  }

  export async function forkFrom(aiMsgElement) {
    const box = document.getElementById('chat-history');
    const allMsgs = Array.from(box.querySelectorAll('.msg'));
    const aiIndex = allMsgs.indexOf(aiMsgElement);
    if (aiIndex < 0) return;

    const sessionId = sessionModule.getCurrentSessionId();
    if (!sessionId) return;

    const keepCount = aiIndex + 1;

    try {
      const res = await fetch(`${API_BASE}/api/session/${sessionId}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keep_count: keepCount }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      await sessionModule.loadSessions();
      await sessionModule.selectSession(data.id);
      if (uiModule) uiModule.showToast(`Forked → ${data.name}`);
    } catch (err) {
      console.error('Fork failed:', err);
      if (uiModule) uiModule.showError('Fork failed: ' + err.message);
    }
  }

  /**
   * Check for pending/completed research after page refresh or session switch.
   * If research is still running, show a spinner and poll until done.
   * If research is done, fetch result and render it.
   */
  export async function checkPendingResearch(sessionId) {
    if (!sessionId) return;
    // #1035 (F-8): deep research is a DROPPED vertical under the game build (trigger_research /
    // manage_research are not in the keep-set), so /api/research/status can only ever 404 here —
    // this poll fired once per session-select and spammed ~one 404 per turn. Skip it in the game
    // build; the full inherited workspace (ORWELL_GAME_BUILD=0) still polls normally.
    if (document.body && document.body.hasAttribute('data-game-build')) return;
    try {
      const res = await fetch(`${API_BASE}/api/research/status/${sessionId}`);
      if (!res.ok) return; // 404 = no research for this session
      const data = await res.json();

      if (data.status === 'done') {
        // Fetch and render the completed result
        _notifyResearchComplete(sessionId, data.query || '');
        if (sessionModule && sessionModule.clearResearching) sessionModule.clearResearching(sessionId);
        const resultRes = await fetch(`${API_BASE}/api/research/result/${sessionId}`, { method: 'POST' });
        if (resultRes.ok) {
          const resultData = await resultRes.json();
          if (resultData.result) {
            // Skip if history already has a research message for this session
            if (document.querySelector(`#chat-history .msg-ai[data-research-session="${sessionId}"]`)) return;

            var srcBox = '';
            if (resultData.sources && resultData.sources.length > 0) {
              srcBox = _buildSourcesBox(resultData.sources, 'research');
            }
            var findingsBox = chatRenderer.buildFindingsBox(resultData.raw_findings);
            var cleanResult = resultData.result;
            // Build DOM directly to avoid double-processing through addMessage
            chatRenderer.hideWelcomeScreen();
            var _box = document.getElementById('chat-history');
            if (_box) {
              var _wrap = document.createElement('div');
              _wrap.className = 'msg msg-ai';
              _wrap.dataset.researchSession = sessionId;
              var _role = document.createElement('div');
              _role.className = 'role';
              var _meta = sessionModule.getSessions().find(function(s) { return s.id === sessionId; });
              _role.textContent = _shortModel(_meta?.model);
              _applyModelColor(_role, _meta?.model);
              _role.appendChild(chatRenderer.roleTimestamp());
              var _body = document.createElement('div');
              _body.className = 'body';
              _body.innerHTML = srcBox + markdownModule.processWithThinking(
                markdownModule.squashOutsideCode(cleanResult)
              ) + findingsBox;
              _wrap.dataset.raw = cleanResult;
              _wrap.appendChild(_role);
              _wrap.appendChild(_body);
              _wrap.appendChild(chatRenderer.createMsgFooter(_wrap));
              _appendViewReportLink(_wrap, sessionId);
              _box.appendChild(_wrap);
              if (window.hljs) _wrap.querySelectorAll('pre code').forEach(function(b) { window.hljs.highlightElement(b); });
              uiModule.scrollHistory();
            }
          }
        }
        return;
      }

      if (data.status !== 'running') return;

      // Don't show reconnect UI if we've already switched away
      if (sessionModule.getCurrentSessionId() !== sessionId) return;

      // Research is still running — show reconnect UI with spinner
      const box = document.getElementById('chat-history');
      if (!box) return;

      const holder = document.createElement('div');
      holder.className = 'msg msg-ai research-reconnect';
      holder.dataset.researchSession = sessionId;
      const roleTs = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
      const agentMeta = sessionModule.getSessions().find(s => s.id === sessionModule.getCurrentSessionId());
      const agentModelLabel = _senderLabel(_shortModel(agentMeta?.model));
      holder.innerHTML = `<div class="role">${uiModule.esc(agentModelLabel)} <span class="role-timestamp">${roleTs}</span></div><div class="body"></div>`;
      _applyModelColor(holder.querySelector('.role'), agentMeta?.model);
      box.appendChild(holder);

      const bodyDiv = holder.querySelector('.body');
      const spinner = spinnerModule.create('Reconnecting to research...', 'right');
      bodyDiv.appendChild(spinner.createElement());
      spinner.start();

      // Update spinner with current progress if available
      function updateSpinnerFromProgress(progress) {
        if (!progress || !progress.phase) return;
        const rp = progress;
        if (rp.phase === 'probing') {
          spinner.updateMessage(`Verifying model: ${rp.model || '?'}`);
        } else if (rp.phase === 'planning') {
          spinner.updateMessage('Analyzing question & planning research strategy');
        } else if (rp.phase === 'searching') {
          const q = rp.queries ? `${rp.queries} queries` : '';
          const s = rp.total_sources ? ` · ${rp.total_sources} sources` : '';
          spinner.updateMessage(`Round ${rp.round || '?'}: Searching${q ? ' (' + q + ')' : ''}${s}`);
        } else if (rp.phase === 'reading') {
          spinner.updateMessage(rp.title ? `Reading: ${rp.title}` : `Round ${rp.round || '?'}: Reading ${rp.new_sources || ''} pages · ${rp.total_sources || 0} sources total`);
        } else if (rp.phase === 'analyzing') {
          spinner.updateMessage(`Round ${rp.round || '?'}: Analyzing ${rp.total_findings || 0} findings`);
        } else if (rp.phase === 'writing') {
          spinner.updateMessage(`Writing report · ${rp.total_sources || 0} sources`);
        }
      }

      updateSpinnerFromProgress(data.progress);
      _researchingStreamIds.add(sessionId);
      if (sessionModule && sessionModule.markResearching) sessionModule.markResearching(sessionId);

      // Restore research timer from started_at
      if (data.started_at && spinner && spinner.element) {
        _researchStartTime = data.started_at * 1000;
        _researchAvgDuration = data.avg_duration || null;
        _researchTimerEl = document.createElement('div');
        _researchTimerEl.className = 'research-timer';
        _researchTimerEl.style.cssText = 'font-size:0.8em; opacity:0.6; margin-top:4px; font-family:var(--mono, monospace);';
        spinner.element.parentNode.insertBefore(_researchTimerEl, spinner.element.nextSibling);
        _researchTimerInterval = setInterval(() => {
          if (!_researchTimerEl) return;
          var elapsed = Math.floor((Date.now() - _researchStartTime) / 1000);
          var mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
          var ss = String(elapsed % 60).padStart(2, '0');
          var txt = mm + ':' + ss;
          if (_researchAvgDuration) {
            var avgM = String(Math.floor(_researchAvgDuration / 60)).padStart(2, '0');
            var avgS = String(Math.round(_researchAvgDuration % 60)).padStart(2, '0');
            txt += ' / avg ' + avgM + ':' + avgS;
          }
          _researchTimerEl.textContent = txt;
        }, 1000);
        // Reconnect synapse — seed it with whatever progress is already known
        try {
          _researchSynapse = createResearchSynapse(spinner.element.parentNode, {
            query: data.query || '',
            startedAt: _researchStartTime,
          });
          if (_researchSynapse.element && _researchTimerEl) {
            spinner.element.parentNode.insertBefore(_researchSynapse.element, _researchTimerEl);
          }
          if (data.progress) {
            _researchSynapse.setPhase(data.progress.phase, data.progress);
            if (typeof data.progress.round === 'number') _researchSynapse.setRound(data.progress.round);
            if (typeof data.progress.total_sources === 'number') _researchSynapse.setSourceCount(data.progress.total_sources);
          }
        } catch (e) { console.warn('synapse reconnect failed', e); }
      }

      // Poll for completion
      const pollInterval = setInterval(async () => {
        // Stop polling if user switched to a different session
        if (sessionModule.getCurrentSessionId() !== sessionId) {
          clearInterval(pollInterval);
          spinner.destroy();
          _clearResearchTimer();
          if (holder.parentNode) holder.remove();
          _researchingStreamIds.delete(sessionId);
          if (_researchingStreamIds.size === 0) {
            var _rToggleP = document.getElementById('research-toggle-btn');
            if (_rToggleP) _rToggleP.classList.remove('research-running');
          }
          return;
        }
        try {
          const pollRes = await fetch(`${API_BASE}/api/research/status/${sessionId}`);
          if (!pollRes.ok) {
            clearInterval(pollInterval);
            spinner.destroy();
            _clearResearchTimer();
            _researchingStreamIds.delete(sessionId);
            if (sessionModule && sessionModule.clearResearching) sessionModule.clearResearching(sessionId);
            return;
          }
          const pollData = await pollRes.json();
          updateSpinnerFromProgress(pollData.progress);
          if (_researchSynapse && pollData.progress) {
            _researchSynapse.setPhase(pollData.progress.phase, pollData.progress);
            if (typeof pollData.progress.round === 'number') _researchSynapse.setRound(pollData.progress.round);
            if (typeof pollData.progress.total_sources === 'number') _researchSynapse.setSourceCount(pollData.progress.total_sources);
          }

          if (pollData.status !== 'running') {
            clearInterval(pollInterval);
            spinner.destroy();
            _clearResearchTimer();
            _researchingStreamIds.delete(sessionId);
            if (sessionModule && sessionModule.clearResearching) sessionModule.clearResearching(sessionId);

            if (pollData.status === 'done') {
              _notifyResearchComplete(sessionId, data.query || '');
              const rRes = await fetch(`${API_BASE}/api/research/result/${sessionId}`, { method: 'POST' });
              if (rRes.ok) {
                const rData = await rRes.json();
                if (rData.result) {
                  var srcHtml = '';
                  if (rData.sources && rData.sources.length > 0) {
                    srcHtml = _buildSourcesBox(rData.sources, 'research');
                  }
                  var findingsHtml = chatRenderer.buildFindingsBox(rData.raw_findings);
                  bodyDiv.innerHTML = srcHtml + markdownModule.processWithThinking(
                    markdownModule.squashOutsideCode(rData.result)
                  ) + findingsHtml;
                  holder.dataset.raw = rData.result;
                  _appendViewReportLink(holder, sessionId);
                  if (window.hljs) {
                    holder.querySelectorAll('pre code').forEach(b => window.hljs.highlightElement(b));
                  }
                }
              }
            } else {
              bodyDiv.innerHTML = '<i style="color: var(--color-error);">[Research ' + pollData.status + ']</i>';
            }
          }
        } catch (e) {
          console.error('Research poll error:', e);
        }
      }, 2000);
    } catch (e) {
      // No research pending, that's fine
    }
  }

  /** Set a display override for the next user message bubble */
  export function setDisplayOverride(text) {
    _displayOverride = text;
  }

  /** Hide the user bubble for the next submit (e.g. continue after stop) */
  export function setHideUserBubble() {
    _hideUserBubble = true;
  }

  /**
   * Submit a HIDDEN production cue (no user bubble, no lingering composer text).
   *
   * The OOBE hand-off cues — the producers' opener (_orwellOpenGameAfterCasting) and the
   * post-photo resume (_orwellResumeAfterPhoto) — used to set #message.value then submit.
   * handleChatSubmit reads the value SYNCHRONOUSLY at call time (the `const msg =
   * el('message').value` capture near the top), but only CLEARS the textarea later, AFTER
   * several awaits (session materialize, upload, …). For that gap the cue text sat VISIBLE
   * in the composer — an ugly flash of an engine instruction the player should never read.
   *
   * This seam closes the gap: hide the bubble, write the cue, fire the submit (which captures
   * the value synchronously), then clear #message.value RIGHT AWAY in the same tick — the
   * submit already has the text, so clearing now never races it. Fail-open: any hiccup leaves
   * the composer usable (and never leaves a half-typed cue behind).
   */
  export function sendHiddenCue(text) {
    const box = uiModule.el ? uiModule.el('message') : document.getElementById('message');
    if (!box || typeof text !== 'string') return false;
    try {
      // Headless send: the cue goes straight to the model — no composer write, no synchronous-capture
      // race, no immediate-clear dance. The producers reach out with no player bubble.
      handleChatSubmit(null, text, { hideUserBubble: true });
      return true;
    } catch (_) {
      // Never leave the hide-bubble flag armed for a real next turn if the cue blew up.
      _hideUserBubble = false;
      try { box.value = ''; } catch (__) {}
      return false;
    }
  }

  /** Set the AI element to merge with the next streamed response (continue after stop) */
  export function setPendingContinue(el) {
    _pendingContinue = el;
  }

  /**
   * Delete an AI message and its preceding user message from the conversation.
   */
  export async function deleteMessage(msgElement) {
    const box = document.getElementById('chat-history');
    const allMsgs = Array.from(box.querySelectorAll('.msg'));
    const clickedIndex = allMsgs.indexOf(msgElement);
    if (clickedIndex < 0) return;

    // No early-out on a missing session: an output shown before any model was
    // selected (issue #1428) has no session/persisted rows, but its "x" must
    // still remove it. We only need the session id for the server-side delete
    // below; without one we fall back to removing the DOM.
    const sessionId = sessionModule.getCurrentSessionId();

    const clickedIsUser = msgElement.classList.contains('msg-user');

    // Find the user+AI pair
    let userIndex = -1;
    let aiIndex = -1;
    if (clickedIsUser) {
      userIndex = clickedIndex;
      // Find the following AI message
      for (let i = clickedIndex + 1; i < allMsgs.length; i++) {
        if (allMsgs[i].classList.contains('msg-ai') && !allMsgs[i].classList.contains('msg-continuation')) {
          aiIndex = i;
          break;
        }
        if (allMsgs[i].classList.contains('msg-user')) break; // next user msg, no AI response
      }
    } else {
      // If clicked on a continuation, walk back to the main AI message
      let mainAiIndex = clickedIndex;
      if (allMsgs[mainAiIndex].classList.contains('msg-continuation')) {
        for (let i = mainAiIndex - 1; i >= 0; i--) {
          if (allMsgs[i].classList.contains('msg-ai') && !allMsgs[i].classList.contains('msg-continuation')) {
            mainAiIndex = i;
            break;
          }
        }
      }
      aiIndex = mainAiIndex;
      // Find the preceding user message
      for (let i = aiIndex - 1; i >= 0; i--) {
        if (allMsgs[i].classList.contains('msg-user')) {
          userIndex = i;
          break;
        }
      }
    }

    // Collect DB message IDs and DOM elements to remove
    const msgIds = [];
    const domToRemove = [];

    // Add the user message if found
    if (userIndex >= 0) {
      domToRemove.push(allMsgs[userIndex]);
      const uid = allMsgs[userIndex].dataset.dbId;
      if (uid) msgIds.push(uid);
    }

    // Add the AI message if found
    if (aiIndex >= 0) {
      domToRemove.push(allMsgs[aiIndex]);
      const aid = allMsgs[aiIndex].dataset.dbId;
      if (aid) msgIds.push(aid);

      const aiEl = allMsgs[aiIndex];
      // Also remove agent-thread elements BETWEEN user and AI
      if (userIndex >= 0) {
        let between = allMsgs[userIndex].nextElementSibling;
        while (between && between !== aiEl) {
          domToRemove.push(between);
          between = between.nextElementSibling;
        }
      }
      // Walk forward from the AI element to remove continuations and tool bubbles
      let sibling = aiEl.nextElementSibling;
      while (sibling) {
        if (sibling.classList.contains('msg-user') ||
            (sibling.classList.contains('msg-ai') && !sibling.classList.contains('msg-continuation'))) {
          break;
        }
        domToRemove.push(sibling);
        sibling = sibling.nextElementSibling;
      }
    }

    if (!msgIds.length || !sessionId) {
      // No persisted rows to delete (no DB IDs, or no session at all — e.g. an
      // error output shown before a model was selected, #1428). Just remove the
      // DOM so the "x" works regardless.
      domToRemove.forEach(el => el.remove());
      if (uiModule) uiModule.showToast('Message deleted');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/session/${sessionId}/delete-messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg_ids: msgIds })
      });
      if (!res.ok) throw new Error('Server error ' + res.status);
      domToRemove.forEach(el => el.remove());
      if (uiModule) uiModule.showToast('Message deleted');
    } catch (err) {
      console.error('Delete failed:', err);
      if (uiModule) uiModule.showError('Delete failed: ' + err.message);
    }
  }

  /**
   * Edit an AI message inline. Makes the body contentEditable, saves to DB on confirm.
   */
  export async function editAIMessage(msgElement) {
    const body = msgElement.querySelector('.body');
    if (!body) return;

    const isEditing = body.contentEditable === 'true' || body.contentEditable === 'plaintext-only';
    if (isEditing) return; // already editing

    const originalRaw = msgElement.dataset.raw || body.textContent || '';

    // Create editable textarea overlay
    const textarea = document.createElement('textarea');
    textarea.className = 'msg-edit-textarea';
    textarea.value = originalRaw;
    textarea.style.width = '100%';
    textarea.style.minHeight = Math.max(100, body.offsetHeight) + 'px';
    body.style.display = 'none';
    body.parentNode.insertBefore(textarea, body.nextSibling);
    textarea.focus();

    // Add save/cancel bar
    const bar = document.createElement('div');
    bar.className = 'msg-edit-bar';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'msg-edit-save';
    saveBtn.textContent = 'Save';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'msg-edit-cancel';
    cancelBtn.textContent = 'Cancel';
    bar.appendChild(saveBtn);
    bar.appendChild(cancelBtn);
    textarea.parentNode.insertBefore(bar, textarea.nextSibling);

    function cleanup() {
      textarea.remove();
      bar.remove();
      body.style.display = '';
    }

    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      cleanup();
    });

    saveBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const newContent = textarea.value;
      if (newContent === originalRaw) { cleanup(); return; }

      const msgId = msgElement.dataset.dbId;
      if (!msgId) { if (uiModule) uiModule.showError('Cannot edit: message ID not found'); cleanup(); return; }

      const sessionId = sessionModule.getCurrentSessionId();
      if (!sessionId) { cleanup(); return; }

      try {
        const res = await fetch(`${API_BASE}/api/session/${sessionId}/edit-message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ msg_id: msgId, content: newContent }),
        });
        if (!res.ok) throw new Error('Server error ' + res.status);

        // Re-render body with markdown
        body.innerHTML = markdownModule.processWithThinking(markdownModule.squashOutsideCode(newContent));
        msgElement.dataset.raw = newContent;

        // Add edited indicator if not already present
        if (!msgElement.querySelector('.edited-indicator')) {
          const indicator = document.createElement('div');
          indicator.className = 'edited-indicator';
          indicator.textContent = '[Message edited]';
          body.parentNode.insertBefore(indicator, body.nextSibling);
        }

        cleanup();
        if (uiModule) uiModule.showToast('Message edited');
      } catch (err) {
        console.error('Edit failed:', err);
        if (uiModule) uiModule.showError('Edit failed: ' + err.message);
      }
    });
  }

  /**
   * Rewrite the AI's last response with a specific instruction.
   * Uses the lightweight /api/rewrite endpoint — no tools, no agent loop.
   * Just rewrites the text of the last AI bubble.
   */
  export async function rewriteWith(aiMsgElement, instruction) {
    const sessionId = sessionModule.getCurrentSessionId();
    if (!sessionId) return;

    // Get the original text from the AI bubble
    const oldRaw = aiMsgElement.dataset.raw || aiMsgElement.querySelector('.body')?.textContent || '';
    const oldHtml = aiMsgElement.querySelector('.body')?.innerHTML || '';

    if (!oldRaw.trim()) {
      if (uiModule) uiModule.showError('No text to rewrite');
      return;
    }

    // Save current response as a variant
    let variants = [];
    try { variants = JSON.parse(aiMsgElement.dataset.variants || '[]'); } catch(_) {}
    if (variants.length === 0) {
      variants.push({ raw: oldRaw, html: oldHtml, label: 'original' });
    }

    // Determine label from instruction
    let varLabel = 'rewrite';
    if (instruction.includes('shorter')) varLabel = 'shorter';
    else if (instruction.includes('simpler')) varLabel = 'simpler';

    // Clear the bubble and show a whirlpool spinner while we wait for the
    // rewrite (replaces the old "Rewriting..." text).
    const bodyEl = aiMsgElement.querySelector('.body');
    let _rwSpin = null;
    if (bodyEl) {
      bodyEl.innerHTML = '';
      _rwSpin = spinnerModule.createWhirlpool(18);
      _rwSpin.element.style.margin = '4px 0';
      bodyEl.appendChild(_rwSpin.element);
    }
    // Stop + detach the spinner (called once real content starts rendering, and
    // on the failure path so it never spins forever).
    const _killRwSpin = () => { if (_rwSpin) { try { _rwSpin.destroy(); } catch (_) {} _rwSpin = null; } };

    try {
      const res = await fetch(`${API_BASE}/api/rewrite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          original_text: oldRaw,
          instruction: instruction,
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let newText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') continue;
          try {
            const data = JSON.parse(payload);
            // The endpoint streams `event: error\ndata: {error,status}` on
            // failure — surface it instead of silently hanging on "Rewriting…".
            if (data.error) {
              throw new Error(data.error || ('HTTP ' + (data.status || 500)));
            }
            // Reasoning tokens (vLLM --reasoning-parser: Qwen3 / DeepSeek-R1)
            // arrive as separate {delta, thinking:true} chunks. They are NOT
            // the rewrite — fold them away so they don't pollute the result.
            if (data.thinking) continue;
            if (data.delta) {
              newText += data.delta;
              _killRwSpin();
              if (bodyEl) {
                bodyEl.innerHTML = markdownModule.processWithThinking(
                  markdownModule.squashOutsideCode(newText)
                );
              }
            }
          } catch (e) {
            if (e instanceof Error && e.message) throw e;  // re-throw real errors
            /* ignore JSON parse noise */
          }
        }
      }

      // Strip any thinking markup from the answer. A reasoning model may emit
      // an inline <think>…</think> block, a bare </think> (no opener), or — when
      // its reasoning came via reasoning_content — a stray leading <think> that
      // never closes (so it would otherwise hide the whole answer). Peel all of
      // those off so what's left is just the rewritten text.
      const _stripThink = (t) => {
        t = markdownModule.normalizeThinkingMarkup(t || '');
        t = t.replace(/<(?:think(?:ing)?|thought)(?:\s+[^>]*)?>[\s\S]*?<\/(?:think(?:ing)?|thought)>/gi, '');   // complete blocks
        if (/<\/(?:think(?:ing)?|thought)>/i.test(t)) t = t.replace(/^[\s\S]*?<\/(?:think(?:ing)?|thought)>/i, '');  // reasoning w/o opener
        return t.replace(/<\/?(?:think(?:ing)?|thought)(?:\s+[^>]*)?>/gi, '').trim();        // any orphan tag
      };
      newText = _stripThink(newText);

      // Nothing left after stripping (or an empty stream) → real failure, not a
      // blank bubble.
      if (!newText.trim()) {
        throw new Error('model returned no rewritten text');
      }

      // Update the element's raw text
      if (newText) {
        aiMsgElement.dataset.raw = newText;
        // Final render with proper markdown
        if (bodyEl) {
          bodyEl.innerHTML = markdownModule.processWithThinking(
            markdownModule.squashOutsideCode(newText)
          );
        }

        // Save the new response as a variant
        variants.push({ raw: newText, html: bodyEl ? bodyEl.innerHTML : '', label: varLabel });
        aiMsgElement.dataset.variants = JSON.stringify(variants);
        aiMsgElement.dataset.variantIndex = String(variants.length - 1);

        // Persist variant metadata to server
        try {
          await fetch(`${API_BASE}/api/session/${sessionId}/update-last-meta`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ metadata: { variants: variants, variantIndex: variants.length - 1 } }),
          });
        } catch (_) {}

        // Re-render variant navigation
        _renderVariantNav(aiMsgElement, variants, variants.length - 1);
      }

      if (uiModule) uiModule.scrollHistory();

    } catch (err) {
      console.error('Rewrite failed:', err);
      _killRwSpin();
      // Restore original content on failure
      if (bodyEl) bodyEl.innerHTML = oldHtml;
      if (uiModule) uiModule.showError('Rewrite failed: ' + err.message);
    }
  }

  /**
   * Continue the AI's response from where it left off.
   */
  export async function continueFrom(aiMsgElement) {
    const sessionId = sessionModule.getCurrentSessionId();
    if (!sessionId) return;

    handleChatSubmit(null, 'Continue from where you left off.'); // headless — no composer puppeteering
  }

  // Open a chat attachment in the right place: images → Gallery editor; PDFs &
  // text/code/markdown → Documents viewer; anything else → raw file. A given
  // upload's imported document is reused (cached by upload id) so clicking it
  // again re-opens the same doc instead of making duplicates.
  const _attachDocCache = new Map();  // upload id -> doc id
  function _attachLang(name) {
    const m = (name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    const ext = m ? m[1] : '';
    const map = { md:'markdown', markdown:'markdown', js:'javascript', ts:'typescript',
      jsx:'javascript', tsx:'typescript', py:'python', rb:'ruby', go:'go', rs:'rust',
      java:'java', c:'c', cpp:'cpp', h:'c', hpp:'cpp', cs:'csharp', php:'php', html:'html',
      htm:'html', css:'css', scss:'scss', json:'json', yaml:'yaml', yml:'yaml', sh:'bash',
      bash:'bash', sql:'sql', csv:'csv', xml:'xml' };
    return map[ext] || '';
  }
  async function openAttachment(att, isImage) {
    if (!att || !att.id) return;
    const id = att.id, name = att.name || '', mime = att.mime || '';
    const url = `${API_BASE}/api/upload/${id}`;

    // Game build (feature 0032): the Gallery image editor is removed — open
    // attached images in a new tab instead.
    if (isImage) {
      window.open(url, '_blank');
      return;
    }

    const isPdf = mime === 'application/pdf' || /\.pdf$/i.test(name);
    const TEXT_EXT = /\.(txt|md|markdown|js|ts|jsx|tsx|py|rb|go|rs|java|c|cpp|h|hpp|cs|php|html?|css|scss|sass|less|json|ya?ml|toml|ini|conf|env|sh|bash|sql|csv|tsv|xml|log|vue|svelte)$/i;
    const isTextDoc = TEXT_EXT.test(name) || /^text\//.test(mime);
    if (!isPdf && !isTextDoc) { window.open(url, '_blank'); return; }  // binary/unknown → raw

    // Reuse the doc we already imported for this upload, if it still loads.
    const cached = _attachDocCache.get(id);
    if (cached) {
      try {
        documentModule.openPanel && documentModule.openPanel();
        await documentModule.loadDocument(cached);
        return;
      } catch (_) { _attachDocCache.delete(id); }
    }

    // Need a session to attach the doc to (bare-session fallback, same as compose).
    let sid = '';
    try { sid = sessionModule.getCurrentSessionId() || ''; } catch (_) {}
    if (!sid) {
      try {
        const _fd = new FormData();
        _fd.append('name', name || 'Attachment');
        _fd.append('skip_validation', 'true');
        const r = await fetch(`${API_BASE}/api/session`, { method: 'POST', body: _fd, credentials: 'same-origin' });
        if (r.ok) { const d = await r.json(); if (d && d.id) { sid = d.id; if (sessionModule.loadSessions) await sessionModule.loadSessions(); } }
      } catch (_) {}
    }

    try {
      let doc;
      if (isPdf) {
        // import-pdf wants a fresh file upload — re-fetch the stored blob and post it.
        const blob = await (await fetch(url)).blob();
        const fd = new FormData();
        fd.append('file', blob, name || 'document.pdf');
        if (sid) fd.append('session_id', sid);
        const res = await fetch(`${API_BASE}/api/documents/import-pdf`, { method: 'POST', body: fd, credentials: 'same-origin' });
        if (!res.ok) throw new Error('import-pdf ' + res.status);
        doc = await res.json();
      } else {
        const text = await (await fetch(url)).text();
        const res = await fetch(`${API_BASE}/api/document`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sid || null, title: name.replace(/\.[^.]+$/, '') || 'Document', content: text, language: _attachLang(name) }),
        });
        if (!res.ok) throw new Error('document ' + res.status);
        doc = await res.json();
      }
      if (doc && doc.id) {
        _attachDocCache.set(id, doc.id);
        documentModule.openPanel && documentModule.openPanel();
        if (documentModule.injectFreshDoc) documentModule.injectFreshDoc(doc);
        else await documentModule.loadDocument(doc.id);
      }
    } catch (e) {
      console.error('open attachment as document failed', e);
      import('./ui.js').then(m => m.showError && m.showError('Could not open attachment')).catch(() => {});
      window.open(url, '_blank');  // fallback so the file is still reachable
    }
  }

  // Public API
  const chatModule = {
    init,
    initListeners,
    openAttachment,
    addMessage: chatRenderer.addMessage,
    displayMetrics: chatRenderer.displayMetrics,
    handleChatSubmit,
    abortCurrentRequest,
    detachCurrentStream,
    checkBackgroundStream,
    resumeStream,
    hideWelcomeScreen: chatRenderer.hideWelcomeScreen,
    showWelcomeScreen: chatRenderer.showWelcomeScreen,
    checkPendingResearch,
    getImageCost: chatRenderer.getImageCost,
    setDisplayOverride,
    setHideUserBubble,
    sendHiddenCue,
    // Shared so EVERY history-render path (chat.js softReloadHistory + sessions.js session/archive
    // loads) filters the same engine/onboarding control prompts — incl. "(Production cue …)". The
    // lists drifted before (chat.js had the cue case, sessions.js didn't) and leaked cues as "You"
    // bubbles; this is the one source of truth so that can't recur.
    isSkippableUserPrompt: _isSkippableUserPrompt,
    setPendingContinue,
    regenerateFrom,
    forkFrom,
    editUserMessage,
    editAIMessage,
    resendUserMessage,
    deleteMessage,
    rewriteWith,
    continueFrom,
    _appendViewReportLink,
    hasActiveStream,
    softReloadHistory,
    flushPendingReconcile,
    deferPeerResume,
    flushPendingPeerResume,
    _visibleMsgCount,   // F5 (dedup hardening): exposed for the reconcile-orphan browser gate
    _msgSeq,            // BUG 1 (ADR 0008 seq order): exposed for the render-order browser gate
    _insertBySeq,       // BUG 1: insert-by-seq choke point
    _reorderBySeq,      // BUG 1: non-destructive seq reorder (the reconcile corrector)
    _isEmptyTurnNoSave, // BUG 2 (#985 P2-B): clean-empty-turn predicate (browser gate)
    _renderStreamDropRetry, // BUG 2: the user-controlled Retry control (browser gate)
    _enqueueSend,       // #985 P2-A: enqueue a send-while-streaming into the outbox (browser gate)
    _flushSendOutbox,   // #985 P2-A: drain the outbox FIFO at turn settle (browser gate)
    _sendOutbox,        // #985 P2-A: the in-memory FIFO (inspected by the browser gate)
    _isStreaming: () => isStreaming, // #985 P2-A: read the live streaming flag in the browser gate
    _setOutboxDispatch: (fn) => { _outboxDispatch = fn; }, // #985 P2-A: swap the flush dispatcher (browser gate)
    _syncSubmitButtonState,  // #971: reconcile the composer button to the true streaming state (browser gate)
    _foregroundStreamLive,   // #971: "is a turn genuinely streaming in the foreground" predicate (browser gate)
    _inProgressLabel,        // #986: the unified in-progress spinner label helper (browser gate)
    // #971 (browser gate only): force the internal stream flags so the button state machine can be
    // exercised across the {composer text × streaming} matrix without a real network stream. Test-only;
    // never called by app code. `sid` (the streaming session id) lets a test simulate a foreground vs.
    // backgrounded/settled run.
    _setStreamStateForTest: ({ streaming, hasAbort, sid } = {}) => {
      isStreaming = !!streaming;
      currentAbort = hasAbort ? (currentAbort || new AbortController()) : null;
      if (sid !== undefined) _streamSessionId = sid;
    },
  };

  // Single delegated handler for tool-call fold/expand. One listener on
  // document.body covers every .agent-thread-node — running, completed,
  // streaming, history-rendered, compare-mode, all of them. Re-attaching
  // per-node listeners on every innerHTML rewrite was the source of the
  // "needs many clicks" bug.
  if (!window.__orwell_thread_click_bound) {
    document.body.addEventListener('click', (e) => {
      const header = e.target.closest('.agent-thread-header');
      if (!header) return;
      const node = header.closest('.agent-thread-node');
      if (!node) return;
      // L7: flat nodes (no expandable content) are plain labels — never toggle.
      if (node.classList.contains('agent-thread-node--flat')) return;
      node.classList.toggle('open');
    });
    window.__orwell_thread_click_bound = true;
  }

  export default chatModule;
  window.chatModule = chatModule;
