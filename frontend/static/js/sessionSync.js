// Cross-device live sync for the chat.
//
// Every device that is viewing a session opens an SSE connection to
// /api/chat/events/{session}. When any device starts a run or saves a message,
// the server broadcasts a lightweight event and this listener reconciles the
// view (load the new message from history, attach to the live reply) WITHOUT
// disturbing the local draft or an in-flight local stream.
//
// Purely additive: it reuses chatModule.softReloadHistory / resumeStream /
// hasActiveStream and sessionModule.getCurrentSessionId. If those aren't present
// it simply does nothing, so it can never break normal chat.
(function () {
  'use strict';

  var API_BASE = (typeof window !== 'undefined' && window.API_BASE) || '';
  var es = null;
  var boundSession = null;
  var retry = 0;

  function chat() { return window.chatModule || null; }
  function currentSession() {
    var sm = window.sessionModule;
    return sm && sm.getCurrentSessionId ? sm.getCurrentSessionId() : null;
  }

  function parse(e) { try { return JSON.parse(e.data); } catch (_) { return {}; } }

  function handle(type, data) {
    var id = data && data.session;
    if (!id || id !== currentSession()) {
      // 0064: a game-updated ping is board state, not chat — reconcile the HUDs even if the
      // change rode the canonical session while we're viewing a different chat (rare). The HUD
      // pollers read the engine's authoritative projection, so this only removes the ~2s lag.
      if (type === 'game-updated') notifyGameUpdated(id);
      return;
    }
    var cm = chat();
    if (!cm) return;

    if (type === 'game-updated') {
      // 0064 §B.3 — the engine board changed on another device (a binding decision, a self-evict,
      // an advance). Tell the HUDs to reconcile NOW instead of waiting on their poll. Vault-free:
      // the payload is the session id + change type only; each HUD re-reads the authoritative state.
      notifyGameUpdated(id);
      return;
    }

    if (cm.hasActiveStream && cm.hasActiveStream(id)) return; // our own activity — ignore the echo

    if (type === 'run-started') {
      // 0064: another device is DRIVING the game turn. We are a live spectator — watch the reply
      // unfold, but the composer stays locked (one reasoning chain per game). Show the new user
      // message, enter spectator mode, attach to the live reply, then release the lock when it ends.
      Promise.resolve(cm.softReloadHistory && cm.softReloadHistory(id)).then(function () {
        if (id !== currentSession()) return;
        if (cm.hasActiveStream && cm.hasActiveStream(id)) return; // we became the driver — never spectate ourselves
        try { if (cm.enterSpectatorMode) cm.enterSpectatorMode(id); } catch (_) {}
        if (cm.resumeStream) {
          Promise.resolve(cm.resumeStream(id)).then(function () {
            // The other device's run has ended (resumeStream resolves on terminal). Free our
            // composer so this device can drive the NEXT turn.
            try { if (cm.exitSpectatorMode) cm.exitSpectatorMode(); } catch (_) {}
          });
        }
      });
    } else if (type === 'message-added') {
      if (cm.softReloadHistory) cm.softReloadHistory(id);
    }
  }

  // 0064: fan a board-changed signal out to the game HUDs (status / decision card / roster /
  // whereabouts / finale / gadget rail). They listen for `orwell:gamechanged` already, so route
  // through the ONE sanctioned dispatcher (platform.js's debounced window.orwellGameChanged helper
  // — never an ad-hoc dispatch, per the G15 single-dispatcher invariant); every HUD re-reads the
  // engine's authoritative projection on it. Best-effort; polling remains the correctness floor.
  function notifyGameUpdated(id) {
    try {
      if (window.orwellGameChanged) window.orwellGameChanged('sync:game-updated');
    } catch (_) {}
  }

  function disconnect() {
    if (es) { try { es.close(); } catch (_) {} es = null; }
    boundSession = null;
  }

  function connect(id) {
    disconnect();
    if (!id) return;
    boundSession = id;
    try {
      es = new EventSource(API_BASE + '/api/chat/events/' + encodeURIComponent(id));
    } catch (_) { es = null; return; }
    es.addEventListener('connected', function () { retry = 0; });
    es.addEventListener('run-started', function (e) { handle('run-started', parse(e)); });
    es.addEventListener('message-added', function (e) { handle('message-added', parse(e)); });
    es.addEventListener('game-updated', function (e) { handle('game-updated', parse(e)); });
    es.onerror = function () {
      // EventSource auto-reconnects on transient drops. Only if it hard-closes
      // (readyState CLOSED) do we re-establish, with capped backoff.
      if (es && es.readyState === 2) {
        var wait = Math.min(30000, 1000 * Math.pow(2, retry++));
        var target = id;
        setTimeout(function () {
          if (currentSession() === target && (!es || es.readyState === 2)) connect(target);
        }, wait);
      }
    };
  }

  // Follow the open session: (re)bind the stream whenever it changes.
  function tick() {
    var id = currentSession();
    if (id !== boundSession) {
      if (id) connect(id); else disconnect();
    }
  }

  function start() {
    setInterval(tick, 1500);
    tick();
    window.addEventListener('beforeunload', disconnect);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
