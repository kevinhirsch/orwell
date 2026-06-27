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
  // A RESOLVED binding is cached for 4s (a restart's unbind is still picked up within the window). But
  // while the game is bound NOWHERE yet — the common cold-start: a season exists but no window has
  // bound a canonical chat, or a peer hasn't yet sent the first framed turn that binds it — re-poll
  // FAST so a peer DISCOVERS the binding within a few hundred ms of the other window's first send, not
  // up to a full 1.5s tick later. The realtime-mirror window is only as long as ONE stream; a coarse
  // discovery poll subscribes the peer AFTER the sender already settled (the live mirror can't engage;
  // B sat blank then popped a late reconcile). R2 / ship-gate F5.
  var _CANON_TTL_MS = 4000;
  var _CANON_UNBOUND_TTL_MS = 350;
  function refreshCanonical() {
    if (!gameBuildOn()) { _canon = { id: null, at: 0, inflight: false }; return; }
    var now = Date.now();
    var ttl = _canon.id ? _CANON_TTL_MS : _CANON_UNBOUND_TTL_MS;
    if (_canon.inflight || (now - _canon.at) < ttl) return;
    _canon.inflight = true;
    try {
      fetch(API_BASE + '/api/orwell/game-session', { credentials: 'same-origin' })
        .then(function (r) { return r && r.ok ? r.json() : null; })
        .then(function (j) {
          var prev = _canon.id;
          _canon = { id: (j && j.sessionId) || null, at: Date.now(), inflight: false };
          // R2 (F5 realtime mirror): the canonical id just resolved to a NEW value. Don't wait for the
          // next 1.5s tick to (re)bind the SSE channel — bind NOW so this window is listening on the
          // canonical channel BEFORE the next peer turn (it then receives the run-started invitation
          // and live-attaches during the stream). tick() is idempotent (no-op if already on this id).
          if (_canon.id && _canon.id !== prev) { try { tick(); } catch (_) {} }
        })
        .catch(function () { _canon = { id: null, at: Date.now(), inflight: false }; });
    } catch (_) { _canon = { id: null, at: Date.now(), inflight: false }; }
  }
  function canonicalSession() { return _canon.id; }
  // Drop the cached canonical id on a game change (e.g. a next-season unbind) so the next tick
  // re-resolves instead of staying pinned to a stale id. We only LISTEN (platform.js's debounced
  // orwell:gamechanged is the ONE g15 dispatcher — we never dispatch it).
  try {
    window.addEventListener('orwell:gamechanged', function () {
      _canon = { id: null, at: 0, inflight: false };
      // R2: a game just bound/changed — re-resolve the canonical id and (re)bind the SSE channel
      // PROMPTLY (refreshCanonical re-ticks on a new id) so this window subscribes to the new canonical
      // channel right away instead of lagging a tick behind.
      try { refreshCanonical(); } catch (_) {}
    });
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
      // canonical channel. Converge its VIEW onto the canonical session first (so the live attach +
      // reconcile land where the player sees them). When we ARE already on the session, convergeView is
      // a no-op and this is byte-identical to the original same-tab fast path.
      convergeView(id).then(function () {
        // R2 (F5 realtime mirror) — ATTACH THE LIVE STREAM FIRST, reconcile AFTER. The old order ran
        // softReloadHistory (a full /api/history fetch + DOM rebuild) BEFORE resume, so a peer sat
        // blank through the whole fetch+rebuild and only painted the turn when that late reconcile
        // popped — through the non-incremental rebuild renderer, not a live stream. Resuming FIRST
        // makes the peer mount the SHARED incremental renderer and paint the sender's tokens DURING the
        // stream. softReloadHistory then runs as the SETTLE reconcile: it adopts the resumed bubble by
        // its {id, seq} with zero churn (it carries data-db-id from the replayed message_saved) and
        // DEFERS past the live resume (hasActiveStream includes _resumingStreams), so it can never yank
        // the live bubble.
        if (isWatchedSession(id) && cm.resumeStream) {
          // ADR 0012 (GAP 1): if OUR OWN POST stream is in flight for this same (canonical) session,
          // resuming now would double-render our own run — DEFER the peer attach and let chat.js's
          // stream-end finally re-attempt it the moment our stream settles. When we're idle, attach
          // immediately. resumeStream/hasActiveStream are the double-resume guard (no-op if a reader
          // already owns the live render for `id`).
          if (cm.hasActiveStream && cm.hasActiveStream(id)) {
            if (cm.deferPeerResume) cm.deferPeerResume(id);
          } else {
            try { cm.resumeStream(id); } catch (_) {}
          }
        }
        // Reconcile the just-persisted user turn. softReloadHistory is idempotent + seq-aware and
        // defers past the now-active resume, so this is a cheap adopt that lands the user bubble in
        // order without disturbing the live reply.
        return Promise.resolve(cm.softReloadHistory && cm.softReloadHistory(id));
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
