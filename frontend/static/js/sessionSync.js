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

  // #985 (P2-C): are we in the reduced game build? The cross-device peer-resume fix is scoped to
  // the game build only — a non-game chat keeps byte-identical per-tab behavior.
  function gameBuildOn() {
    try {
      var b = window.document && window.document.body;
      return !!(b && (b.dataset && b.dataset.gameBuild === '1' || (b.hasAttribute && b.hasAttribute('data-game-build'))));
    } catch (_) { return false; }
  }

  // #985 (P2-C): the bound CANONICAL game session — the id the server keys a framed run on and
  // publishes `run-started` to (chat_routes.py `run_key = ctx.canonical_session or session`). A peer
  // whose per-tab `currentSession()` hasn't yet converged to this id would otherwise subscribe to the
  // WRONG channel and never receive the invitation. We resolve it via the SAME endpoint the
  // convergence ladder uses (sessions.js `_resolveCanonicalGameSession` → GET /api/orwell/game-session
  // → {sessionId}); READ-ONLY (no FE write, no sessions.js edit). Short-TTL cached so the 1.5s tick
  // doesn't refetch every beat, while a restart's server-side unbind is picked up within the window.
  // Best-effort + fail-open: any failure (pre-game, no game bound, fetch error) resolves null and the
  // caller falls back to the per-tab session — the original behavior.
  var _canon = { id: null, at: 0, inflight: false };
  var _CANON_TTL_MS = 4000;
  function refreshCanonical() {
    if (!gameBuildOn()) { _canon = { id: null, at: 0, inflight: false }; return; }
    var now = Date.now();
    if (_canon.inflight || (now - _canon.at) < _CANON_TTL_MS) return;
    _canon.inflight = true;
    try {
      fetch(API_BASE + '/api/orwell/game-session', { credentials: 'same-origin' })
        .then(function (r) { return r && r.ok ? r.json() : null; })
        .then(function (j) { _canon = { id: (j && j.sessionId) || null, at: Date.now(), inflight: false }; })
        .catch(function () { _canon = { id: null, at: Date.now(), inflight: false }; });
    } catch (_) { _canon = { id: null, at: Date.now(), inflight: false }; }
  }
  function canonicalSession() { return _canon.id; }
  // Drop the cached canonical id on a game change (e.g. a next-season unbind) so the next tick
  // re-resolves instead of staying pinned to a stale id. We only LISTEN (platform.js's debounced
  // orwell:gamechanged is the ONE g15 dispatcher — we never dispatch it).
  try {
    window.addEventListener('orwell:gamechanged', function () { _canon = { id: null, at: 0, inflight: false }; });
  } catch (_) {}

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

  // #985 (P2-C): is an incoming event's session one WE should accept? We accept the per-tab session
  // we're viewing (the original rule) AND — in the game build — the bound CANONICAL game session,
  // even when our per-tab `currentSession()` hasn't yet converged to it. The published `run-started`
  // for a framed turn rides the canonical id (chat_routes.py); an un-converged peer that only matched
  // `currentSession()` dropped it and never resumed (the "no response on this client" bug). Returns
  // false when neither matches, so a foreign session's event is still ignored.
  function isWatchedSession(id) {
    if (!id) return false;
    if (id === currentSession()) return true;
    return gameBuildOn() && id === canonicalSession();
  }

  // #985 (P2-C): bring this window's VIEW onto the canonical game session before we reconcile/resume
  // its run. An un-converged peer is subscribed to the canonical channel (so it heard the invitation)
  // but its per-tab view is elsewhere; selecting the canonical session is exactly the convergence the
  // ladder/onboarding would have done (we call sessionModule's own selectSession — a READ of its API,
  // never an edit). Best-effort + idempotent: selectSession no-ops if we're already on it. Returns the
  // selectSession promise (or a resolved promise) so the caller can sequence the reconcile after it.
  function convergeView(id) {
    if (id === currentSession()) return Promise.resolve();
    var sm = window.sessionModule;
    if (!sm || !sm.selectSession) return Promise.resolve();
    try { return Promise.resolve(sm.selectSession(id)).catch(function () {}); }
    catch (_) { return Promise.resolve(); }
  }

  // ADR 0008: coalesce a burst of events into one reconcile (softReloadHistory is idempotent).
  var _recTimers = {};
  function scheduleReconcile(id) {
    var cm = chat();
    if (!cm || !cm.softReloadHistory) return;
    if (_recTimers[id]) return;                 // already scheduled — fold this event in
    _recTimers[id] = setTimeout(function () {
      delete _recTimers[id];
      // Reconcile when this is the session we're viewing OR the canonical game session we're
      // subscribed to (converge the view first so the rebuild lands where the player can see it).
      if (id === currentSession()) { try { cm.softReloadHistory(id); } catch (_) {} return; }
      if (gameBuildOn() && id === canonicalSession()) {
        convergeView(id).then(function () { try { cm.softReloadHistory(id); } catch (_) {} });
      }
    }, 120);
  }

  function handle(type, data) {
    var id = data && data.session;
    // Board/layout pings are not chat — handle them before the chat-session gate (they ride the
    // canonical session; the player is on it during the game). Messenger model: NO spectator/lockout.
    if (type === 'game-updated') { notifyGameUpdated(); return; }
    if (type === 'layout-changed') { dispatchLayoutChanged(data); return; }
    if (!isWatchedSession(id)) return;       // not the session we're viewing or the canonical game run
    var cm = chat();
    if (!cm) return;

    // ADR 0008: process EVERY chat event. The old code bailed here on hasActiveStream(id) — but that
    // gate could not tell "my own echo" from "the OTHER tab's real write", so a streaming tab DROPPED
    // the peer's events and never reconciled (the S3-RACE divergence). softReloadHistory is now
    // id/seq-aware: it adopts our own optimistic bubbles with zero churn, defers past a live stream,
    // and rebuilds only when genuinely diverged — so reconciling on our own echo is a cheap no-op.
    if (type === 'run-started') {
      // #985 (P2-C): a peer whose per-tab view hasn't converged still receives this invitation on the
      // canonical channel. Converge its VIEW onto the canonical session first (so the reconcile +
      // live attach land where the player sees them), then reconcile the just-persisted user turn and
      // attach to the live reply. When we ARE already on the session, convergeView is a no-op and this
      // is byte-identical to the original same-tab fast path.
      convergeView(id).then(function () {
        // A device sent a message: reconcile its (just-persisted) user turn, then — if WE are idle —
        // attach to the live reply. Sequential so the rebuild lands before the live bubble appends.
        return Promise.resolve(cm.softReloadHistory && cm.softReloadHistory(id));
      }).then(function () {
        // Still on (or converged onto) this session, and resume is available.
        if (!isWatchedSession(id) || !cm.resumeStream) return;
        // ADR 0012 (GAP 1 — the ±1 cross-tab live-attach lag): if WE are mid-stream for this same
        // (canonical) session — our OWN concurrent POST is in flight — `hasActiveStream(id)` is true,
        // so we MUST NOT resume now (that would double-render our own run). But the peer's run is
        // durable (it chained as the current `_RUNS[canonical]`, still resumable within the evict
        // grace), so DON'T drop the invitation: defer it, and chat.js's stream-end finally RE-ATTEMPTS
        // the attach the moment our stream settles → we mirror the peer's turn LIVE instead of catching
        // up only on a later poll/reconcile (the one-window-behind offset the 50× smoke caught). When
        // we're idle, attach immediately (the original fast path). resumeStream/hasActiveStream are the
        // double-resume guard: resumeStream no-ops if a reader already owns the live render for `id`.
        if (cm.hasActiveStream && cm.hasActiveStream(id)) {
          if (cm.deferPeerResume) cm.deferPeerResume(id);
        } else {
          cm.resumeStream(id);
        }
      });
    } else if (type === 'message-added') {
      scheduleReconcile(id);
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
          // Reconnect only if `target` is STILL the channel we want (the per-tab session or the
          // canonical game session) and the socket is still closed — otherwise tick() will rebind.
          if (desiredSession() === target && (!es || es.readyState === 2)) connect(target);
        }, wait);
      }
    };
  }

  // #985 (P2-C): which session's event channel should we be subscribed to? In the game build, the
  // CANONICAL game session when one is bound — that is where the framed run publishes `run-started`,
  // so a peer subscribes there REGARDLESS of whether its per-tab `currentSession()` has converged yet
  // (the root cause of "no response on this client"). Otherwise — pre-game, no game bound, or the full
  // workspace build — the per-tab session, exactly as before. Fail-open: a null canonical id falls
  // back to the per-tab session, so we never lose the original subscription.
  function desiredSession() {
    if (gameBuildOn()) {
      var canon = canonicalSession();
      if (canon) return canon;
    }
    return currentSession();
  }

  // Follow the open session: (re)bind the stream whenever the DESIRED channel changes. In the game
  // build we keep the canonical id fresh (best-effort, short-TTL cached) so a freshly-bound game is
  // picked up within a tick.
  function tick() {
    refreshCanonical();
    var id = desiredSession();
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
