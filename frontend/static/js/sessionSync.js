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

  // 0064 §B/D: a board-changed ping — tell the game HUDs (status / decision card / roster /
  // whereabouts / finale / gadget rail) to reconcile NOW instead of waiting on their ~2s poll.
  // Route through the ONE sanctioned dispatcher (platform.js's debounced window.orwellGameChanged,
  // per the G15 single-dispatcher invariant); each HUD re-reads the engine's authoritative state.
  function notifyGameUpdated() {
    try { if (window.orwellGameChanged) window.orwellGameChanged('sync:game-updated'); } catch (_) {}
  }

  // 0064 Part F: a window/HUD layout change from another device — re-dispatch it as a DOM event the
  // layout-sync module applies (it filters its own echo by `origin`). Vault-free: ids + geometry only.
  function dispatchLayoutChanged(data) {
    try { window.dispatchEvent(new CustomEvent('orwell:layout-changed', { detail: data || {} })); } catch (_) {}
  }

  function handle(type, data) {
    var id = data && data.session;
    // Board/layout pings are not chat — handle them before the chat-session gate (they ride the
    // canonical session; the player is on it during the game). Messenger model: NO spectator/lockout.
    if (type === 'game-updated') { notifyGameUpdated(); return; }
    if (type === 'layout-changed') { dispatchLayoutChanged(data); return; }
    if (!id || id !== currentSession()) return;       // not the session we're viewing
    var cm = chat();
    if (!cm) return;
    if (cm.hasActiveStream && cm.hasActiveStream(id)) return; // our own activity — ignore the echo

    if (type === 'run-started') {
      // Another device sent a message: show it, then attach to the live reply.
      Promise.resolve(cm.softReloadHistory && cm.softReloadHistory(id)).then(function () {
        if (id === currentSession() && cm.resumeStream && !(cm.hasActiveStream && cm.hasActiveStream(id))) {
          cm.resumeStream(id);
        }
      });
    } else if (type === 'message-added') {
      if (cm.softReloadHistory) cm.softReloadHistory(id);
    }
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
    es.addEventListener('game-updated', function (e) { handle('game-updated', parse(e)); });   // 0064 §B/D
    es.addEventListener('layout-changed', function (e) { handle('layout-changed', parse(e)); }); // 0064 F
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
