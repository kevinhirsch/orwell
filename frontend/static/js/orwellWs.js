// ============================================================================
// orwellWs.js — WebSocket Phase-1 CLIENT transport (ADR 0017 / docs/design/
// websocket-phase1-protocol.md).  Browser ↔ FE, Hop 1 only.
// ============================================================================
//
// ONE multiplexed socket per tab for the ONE canonical session it resolves to.
// This module owns the WIRE: the hello/bind/ack handshake (§2), the `chat`
// replay-then-tail `subscribe{fromSeq}` (§3), the `state`/`hud`/`layout`/`notice`
// down-frames (§4/§5), the `turn`/`decision` up-frames (§3.5), the heartbeat
// pong, reconnect with a gap cursor, and — critically — the PERMANENT SSE/poll
// FALLBACK negotiation gated by the `ORWELL_WS_TRANSPORT` flag (§6).
//
// It does NOT render anything and it does NOT decide game state.  It is a dumb,
// fail-soft frame pipe:
//   • incoming `event` frames on `chat`      → handed to chat.js (the reasoning
//     split + the ONE incremental renderer live there — §3.4, ADR 0015);
//   • incoming `state`/`hud` frames          → handed to platform.js, which is
//     the ONE caller of `window.orwellGameChanged('ws:state')` (§4, g15);
//   • incoming `layout`/`notice` frames      → handed to the layout/notice code.
// Strict `ch` routing (a `hud` frame NEVER reaches the chat buffers, a `chat`
// delta NEVER reaches the layout store) is the whole point of the multiplex —
// see test_ws_multiplex_isolation.py.
//
// Written as a plain IIFE (no import/export) so it is (a) executable as a
// side-effect ES module — `import './orwellWs.js'` runs it — and (b) evaluable
// directly in a Node harness with stubbed globals for the behavioral tests
// (the same shape sessionSync.js uses).
//
// FAIL-SOFT IS LAW.  Any error, any blocked upgrade, the flag off, or the
// non-game build ⇒ we stay/enter fallback mode and the EXISTING SSE + poll
// stack (sessionSync.js, orwellStatusPanel.js, orwellPresence.js) carries the
// game unchanged.  The socket is an optimization, never a dependency.
(function () {
  "use strict";

  if (typeof window === "undefined") return;
  if (window.OrwellWs) return; // idempotent — never double-install

  // ── config / feature flag (§6) ──────────────────────────────────────────
  var API_BASE = window.API_BASE || "";
  var PROTOCOL = 1;
  var HELLO_TIMEOUT_MS = 3000;   // ~3s to first `ack` (§6 negotiation)
  var RECONNECT_BASE_MS = 500;
  var RECONNECT_MAX_MS = 15000;
  var RECONNECT_GIVEUP = 6;      // consecutive failed reconnects → permanent fallback
  // Fallback→WS RECOVERY backoff (the turn-on gate — see `_maybeUpgradeFromFallback`). A window that
  // booted before the game was live sits in fallback; it re-attempts the WS upgrade on
  // `orwell:gamechanged`, spaced by a growing backoff so a genuinely-blocked upgrade never storms.
  var UPGRADE_BACKOFF_MIN_MS = 8000;
  var UPGRADE_BACKOFF_MAX_MS = 60000;

  // `ORWELL_WS_TRANSPORT` (default OFF in Phase 1 — zero-risk default, §6). The
  // server injects it; we read it defensively from either a global or a body
  // data-attribute. Absent/false ⇒ the client never even attempts the upgrade.
  function _flagOn() {
    try {
      if (window.ORWELL_WS_TRANSPORT === true || window.ORWELL_WS_TRANSPORT === 1 ||
          window.ORWELL_WS_TRANSPORT === "1" || window.ORWELL_WS_TRANSPORT === "true") return true;
      var b = window.document && window.document.body;
      if (b && b.dataset && (b.dataset.wsTransport === "1" || b.dataset.wsTransport === "true")) return true;
    } catch (_) {}
    return false;
  }

  // The transport is a GAME-build concern (the mirror/HUD it ports live only
  // there). The full workspace build never attempts it.
  function _gameBuild() {
    try {
      var b = window.document && window.document.body;
      return !!(b && b.dataset && b.dataset.gameBuild === "1");
    } catch (_) { return false; }
  }

  // The tab's own chat-session id — the id this tab would POST under today
  // (§2.1 `perTabId`). It is only an INPUT to the server's bind target; the
  // server DERIVES the resolution branch itself (§2.2), never from us.
  function _perTabId() {
    try {
      var sm = window.sessionModule;
      return (sm && sm.getCurrentSessionId && sm.getCurrentSessionId()) || null;
    } catch (_) { return null; }
  }

  function _wsUrl() {
    var loc = window.location;
    var scheme = (loc && loc.protocol === "https:") ? "wss:" : "ws:";
    var host = (loc && loc.host) || "";
    // API_BASE may be an absolute http(s) origin in some embeds; normalize it.
    if (/^https?:\/\//i.test(API_BASE)) {
      return API_BASE.replace(/^http/i, "ws").replace(/\/$/, "") + "/api/ws/session";
    }
    return scheme + "//" + host + "/api/ws/session";
  }

  // ── state ───────────────────────────────────────────────────────────────
  var _mode = "idle";            // idle | negotiating | ws | fallback
  var _sock = null;
  var _cid = 0;
  var _pending = {};             // cid → { resolve, reject, t }
  var _canonicalId = null;
  var _live = false;
  var _beatSeq = 0;              // last-seen engine beatSeq (0065)
  var _highestChatSeq = -1;      // highest `chat` event.seq rendered (reconnect cursor)
  var _chatSubscribed = false;
  var _fallbackReason = null;    // WHY we fell back — only "pregame-not-live" is recoverable (see _goFallback)
  var _helloTimer = null;
  var _reconnectFails = 0;
  var _reconnectTimer = null;
  var _closingForGood = false;
  var _lastUpgradeAttempt = 0;                    // ms of the last fallback→WS upgrade attempt
  var _upgradeBackoffMs = UPGRADE_BACKOFF_MIN_MS; // grows per failed upgrade, caps at MAX; reset on activate

  // per-channel handler registries — strict `ch` routing (§ multiplex).
  var _handlers = { chat: [], state: [], hud: [], layout: [], notice: [] };

  function _nextCid() { _cid += 1; return "c_" + _cid.toString(36); }

  function _emitWindow(name, detail) {
    try { window.dispatchEvent(new CustomEvent(name, { detail: detail || {} })); } catch (_) {}
  }

  // ── public: handler registration ────────────────────────────────────────
  function onFrame(ch, fn) {
    if (!_handlers[ch] || typeof fn !== "function") return;
    if (_handlers[ch].indexOf(fn) === -1) _handlers[ch].push(fn);
  }
  function offFrame(ch, fn) {
    if (!_handlers[ch]) return;
    var i = _handlers[ch].indexOf(fn);
    if (i !== -1) _handlers[ch].splice(i, 1);
  }
  function _emit(ch, frame) {
    var list = _handlers[ch];
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      try { list[i](frame); } catch (_) { /* one bad handler never wedges the pipe */ }
    }
  }

  // ── the frame router — dispatch STRICTLY by `ch` (the multiplex wall) ────
  // Exposed as `_handleFrame` so a test can feed an interleaved frame sequence
  // straight in (case c) without a live socket.
  function _handleFrame(frame) {
    if (!frame || typeof frame !== "object") return;
    switch (frame.t) {
      case "ping":
        _send({ t: "pong" });
        return;
      case "pong":
        return;
      case "ack":
        _onAck(frame);
        return;
      case "error":
        _onError(frame);
        return;
      case "event":
        // `event` frames are the ONLY frames that carry `ch`-scoped stream data.
        // Route by `ch`; a non-`chat` frame can never reach the chat buffers.
        if (frame.ch === "chat") {
          if (typeof frame.seq === "number" && frame.seq > _highestChatSeq) _highestChatSeq = frame.seq;
          _emit("chat", frame);
        } else if (_handlers[frame.ch]) {
          _emit(frame.ch, frame);
        }
        return;
      case "state":
        if (frame.d && typeof frame.d.beatSeq === "number") _noteBeat(frame.d.beatSeq);
        _emit("state", frame);
        return;
      case "hud":
        if (frame.d && typeof frame.d.beatSeq === "number") _noteBeat(frame.d.beatSeq);
        _emit("hud", frame);
        return;
      case "layout":
        _emit("layout", frame);
        return;
      case "notice":
        _emit("notice", frame);
        return;
      default:
        return; // unknown frame type — ignore, never crash the pipe
    }
  }

  function _noteBeat(b) { if (typeof b === "number" && b > _beatSeq) _beatSeq = b; }

  function _onAck(frame) {
    var cid = frame.cid;
    var d = frame.d || {};
    // Handshake ack (hello/bind): carries canonicalId/live/beatSeq (§2.3).
    if (cid && _pending[cid] && _pending[cid].t === "hello") {
      var p = _pending[cid]; delete _pending[cid];
      _canonicalId = d.canonicalId || _canonicalId;
      _live = d.live !== false;
      _noteBeat(d.beatSeq);
      if (d.adopted) {
        // We lost the bind race and adopted a different canonical id (§2.3) —
        // re-point the view WITHOUT a settle-time reload (that reload was #1086).
        _emitWindow("orwell:ws-adopted", { canonicalId: _canonicalId });
      }
      try { p.resolve(frame); } catch (_) {}
      return;
    }
    // Subscribe ack (§3.1): `ch:"chat"`, d:{fromSeq, headSeq} — sent BEFORE any
    // `event` frame on the channel, so the client knows the [fromSeq..headSeq]
    // replay window.
    if (cid && _pending[cid]) {
      var q = _pending[cid]; delete _pending[cid];
      if (frame.ch === "chat") _chatSubscribed = true;
      try { q.resolve(frame); } catch (_) {}
      return;
    }
    // A generic up-frame ack (turn/decision accepted, §3.5) with an unmatched
    // cid — nothing to resolve, ignore.
  }

  function _onError(frame) {
    var cid = frame.cid;
    var d = frame.d || {};
    // A `cid`-tagged error rejects the matching pending promise (§1.2) so the
    // caller (a turn/decision/subscribe/hello) fails the RIGHT request.
    if (cid && _pending[cid]) {
      var p = _pending[cid]; delete _pending[cid];
      // stale-beat: the engine refused a 0065 CAS BEFORE any write. Surface the
      // fresh beatSeq so the caller reconciles + retries (§3.5).
      if (d.code === "stale-beat" && typeof d.beatSeq === "number") _noteBeat(d.beatSeq);
      var err = new Error(d.code || "ws-error");
      err.code = d.code; err.detail = d;
      try { p.reject(err); } catch (_) {}
    }
    // forbidden / not-bound at the handshake ⇒ this socket can't serve the game;
    // fail soft to the SSE stack rather than leaving the user stuck. A refusal is a permanent
    // cause (not pre-game) — recovery won't re-attempt it.
    if (d.code === "forbidden" || d.code === "not-bound") {
      _goFallback("handshake");
    }
  }

  // ── send helpers ────────────────────────────────────────────────────────
  function _send(frame) {
    try {
      if (_sock && _sock.readyState === 1) { _sock.send(JSON.stringify(frame)); return true; }
    } catch (_) {}
    return false;
  }

  // request/response: allocate a cid, register the pending promise, send. Gated on the
  // socket being OPEN (not on `_mode`): the handshake `hello`/`subscribe` legitimately
  // fire during `negotiating`, before we flip to `ws`. Callers of the up-frames
  // (sendTurn/sendDecision) additionally gate on isActive() at their call site.
  function _request(t, ch, d, tag) {
    return new Promise(function (resolve, reject) {
      if (!_sock || _sock.readyState !== 1) { reject(new Error("ws-not-open")); return; }
      var cid = _nextCid();
      _pending[cid] = { resolve: resolve, reject: reject, t: tag || t };
      var frame = { t: t, cid: cid, d: d || {} };
      if (ch) frame.ch = ch;
      if (!_send(frame)) { delete _pending[cid]; reject(new Error("ws-send-failed")); }
    });
  }

  // ── the handshake (§2) ──────────────────────────────────────────────────
  function _hello(perTabId) {
    return _request("hello", null, { perTabId: perTabId, protocol: PROTOCOL }, "hello");
  }

  // Re-resolve the canonical id (§2.3 `bind`) — dropped + re-issued on every
  // `orwell:gamechanged` (the ONE g15 dispatcher). A rebind ALWAYS re-arms the
  // lightweight state/hud push edges (fire-and-forget, idempotent — the server dedups per
  // channel key), but it re-points the `chat` channel ONLY when the canonical id actually
  // CHANGED (a genuine re-resolve: adoption, or a season-reset unbind).
  //
  // Why the guard is load-bearing: `orwell:gamechanged` fires on EVERY game mutation —
  // including MID-TURN (each game-mutating tool result dispatches it). A blind
  // `_subscribeChat(0)` here would, on every one of those, tear down the in-flight chat
  // tail and full-replay the whole buffer from seq 0 — racing the live stream (a duplicate
  // replay), and at the casting→started settle, a rebind that resolves onto a DIFFERENT/empty
  // canonical would swap the subscription off the session carrying the just-streamed reply and
  // strip it (the #1085/#1086 window-collapse / reply-strip class, now over WS). On a same-id
  // gamechanged we keep the existing subscription + its cursor untouched, so the live tail is
  // never interrupted. `_rebinding` coalesces overlapping gamechanged rebinds into one bind — and
  // is held across the ENTIRE operation (the bind AND the conditional `_subscribeChat(0)`), released
  // only once the whole chain settles. If it were released at the bind ack (before the chat
  // subscribe's own ack sets `_chatSubscribed=true`), a second gamechanged could re-enter while
  // `_chatSubscribed` is still false and fire a SECOND full-history chat subscribe on the same id —
  // exactly the double-replay this fix prevents.
  var _rebinding = null;
  function rebind() {
    if (_mode !== "ws") return Promise.reject(new Error("ws-not-active"));
    if (_rebinding) return _rebinding; // a rebind is already in flight — never stack a second
    var prevCanonical = _canonicalId;
    var prevChatSubscribed = _chatSubscribed;
    var op = _request("bind", null, { perTabId: _perTabId() }, "hello").then(function (ack) {
      // The socket dropped during the bind (onclose flipped us to negotiating) — the reconnect
      // path re-arms every channel from its own onopen; don't subscribe a dead sock.
      if (_mode !== "ws") return ack;
      // Always re-arm the state/hud edges (the HUD push keystone — test_ws_statehud_subscribe).
      _subscribeEdges();
      if (!_live) return ack;
      // Re-point chat ONLY on a genuine canonical change (or if it was never subscribed).
      // `_onAck` has already updated `_canonicalId` from the bind ack by the time this runs.
      // Returning the subscribe promise keeps `_rebinding` held until the chat `ack` lands
      // (which sets `_chatSubscribed=true`), so a re-entrant gamechanged can't double-subscribe.
      if (_canonicalId !== prevCanonical || !prevChatSubscribed) {
        _chatSubscribed = false;
        return _subscribeChat(0); // full history on the newly-resolved id (a real re-point)
      }
      return ack;                 // same id → the in-flight chat tail stays intact
    });
    // Release the coalescing guard (success AND failure) only after the WHOLE chain settles —
    // never mid-operation. Guarded so a teardown that already cleared `_rebinding` and started a
    // fresh rebind isn't clobbered by this stale settle.
    var release = function () { if (_rebinding === settled) _rebinding = null; };
    var settled = op.then(function (v) { release(); return v; },
                          function (e) { release(); throw e; });
    _rebinding = settled;
    return settled;
  }

  // ── the chat channel subscribe (§3.1) ───────────────────────────────────
  // A fresh window sends fromSeq:0 (full replay); a reconnecting socket sends
  // fromSeq = highest rendered seq + 1 (replay only the gap, then live-tail).
  function _subscribeChat(fromSeq) {
    var from = (typeof fromSeq === "number") ? fromSeq : (_highestChatSeq + 1);
    if (from < 0) from = 0;
    return _request("subscribe", "chat", { fromSeq: from }, "subscribe");
  }

  // ── the state/hud EDGE channels (§4) — the HUD push keystone ─────────────
  // These are the lightweight edge pings that make every WS HUD push reach the
  // browser. A `subscribe{ch:"state"|"hud"}` is what ARMS the server's continuous
  // `session_events → state/hud` bridge (`_run_state_channel`, ws_routes.py:273);
  // without it that bridge is never spawned, the only `state` frame a client ever
  // sees is the one-shot inline one from the decision handler, and platform.js's
  // correct `state`/`hud` → `orwellGameChanged` bridge STARVES (no push edge).
  //
  // Unlike `chat`, the server answers a state/hud subscribe with NO success `ack`
  // (only an `error{not-bound|forbidden}` on refusal — ws_routes.py:334), so these
  // are FIRE-AND-FORGET, NOT a request/response promise: a `_request` here would
  // register a pending that never resolves and leak forever. They carry no
  // `fromSeq`/replay semantics — just an empty `d` (§4). A refusal still routes
  // through `_onError`'s forbidden/not-bound → fallback leg (the socket is broken).
  var EDGE_CHANNELS = ["state", "hud"];
  function _subscribeEdges() {
    for (var i = 0; i < EDGE_CHANNELS.length; i++) {
      // A cid for the protocol shape (§3.1 `{t,ch,cid,...}`; echoed on a refusal
      // error) but NO pending promise — success never acks.
      _send({ t: "subscribe", ch: EDGE_CHANNELS[i], cid: _nextCid(), d: {} });
    }
  }

  // ── public up-frames (§3.5) ─────────────────────────────────────────────
  // Both ride the `chat` channel; both MUST carry expectedBeatSeq (0065 CAS) —
  // default to the last-seen beatSeq when the caller didn't pin one.
  function _beatFor(explicit) {
    var b = (typeof explicit === "number") ? explicit : _beatSeq;
    return (typeof b === "number" && b > 0) ? b : undefined;
  }
  function sendTurn(payload) {
    payload = payload || {};
    return _request("turn", "chat", {
      message: payload.message,
      clientMsgId: payload.clientMsgId,
      expectedBeatSeq: _beatFor(payload.expectedBeatSeq),
      attachments: payload.attachments || [],
      mode: payload.mode || "agent"
    }, "turn");
  }
  function sendDecision(payload) {
    payload = payload || {};
    // Carry the FULL decision body (kind + kind-specific fields — vote/save/use/intent/
    // statement/appeal/confirmed/choice…) VERBATIM so the server relay reconstructs the SAME
    // body the HTTP POST /api/orwell/decision handler receives (ws_routes `_handle_decision`
    // strips the two sync-spine tokens back out and forwards the rest to submit_decision). The
    // engine requires `kind` — a fixed {pendingId,choice,target} shape would drop it and be
    // refused `unknown-kind`. The explicit pendingId/choice/target still round-trip through the
    // spread (superset — back-compatible). `expectedBeatSeq` defaults to the last-seen beatSeq
    // (0065 CAS) when the caller didn't pin one; `idempotencyKey` (snake_case `idempotency_key`
    // accepted too) rides its own normalized slot the server pulls out.
    var d = {};
    for (var k in payload) {
      if (!Object.prototype.hasOwnProperty.call(payload, k)) continue;
      if (k === "expectedBeatSeq" || k === "idempotencyKey" || k === "idempotency_key") continue;
      if (payload[k] === undefined) continue;
      d[k] = payload[k];
    }
    d.expectedBeatSeq = _beatFor(payload.expectedBeatSeq);
    var idem = payload.idempotencyKey || payload.idempotency_key;
    if (idem) d.idempotencyKey = idem;
    return _request("decision", "chat", d, "decision");
  }
  // layout is fire-and-forget per-device LWW (§5) — no cid/ack.
  function sendLayout(d) { return _send({ t: "layout", ch: "layout", d: d || {} }); }

  // ── negotiation + lifecycle (§6) ────────────────────────────────────────
  function _clearHelloTimer() { if (_helloTimer) { clearTimeout(_helloTimer); _helloTimer = null; } }

  // `reason` records WHY we fell back so recovery can be gated by CAUSE (see
  // `_maybeUpgradeFromFallback`): only a `"pregame-not-live"` fallback (the canonical id wasn't a
  // live game yet) is worth re-attempting on `orwell:gamechanged`. A `"proxy"` (blocked upgrade /
  // dead route), `"handshake"` (refused / closed before ack), or `"reconnect-exhausted"` fallback is
  // PERMANENT — retrying it would just re-pay the hello timeout on every eligible gamechanged.
  function _goFallback(reason) {
    if (_mode === "fallback") return;
    _mode = "fallback";
    _fallbackReason = reason || _fallbackReason || "handshake";
    _chatSubscribed = false;
    _rebinding = null;
    _clearHelloTimer();
    _closingForGood = true;
    try { if (_sock) _sock.close(); } catch (_) {}
    _sock = null;
    // Hand the resume cursor forward for a mid-session WS→SSE downgrade (§6):
    // the SSE resume path replays the run buffer from 0 and the client discards
    // the already-rendered prefix up to `fromSeq`; `beatSeq` keeps the next
    // turn's expectedBeatSeq CAS correct across the downgrade.
    _emitWindow("orwell:ws-inactive", {
      mode: "fallback",
      fromSeq: _highestChatSeq + 1,
      beatSeq: _beatSeq
    });
  }

  function _activate() {
    _mode = "ws";
    _reconnectFails = 0;
    // A live socket clears the fallback-recovery backoff so a FUTURE drop-to-fallback re-attempts
    // promptly rather than inheriting a grown interval.
    _upgradeBackoffMs = UPGRADE_BACKOFF_MIN_MS;
    _lastUpgradeAttempt = 0;
    _fallbackReason = null;   // live now — a future fallback records its own fresh cause
    _emitWindow("orwell:ws-active", { canonicalId: _canonicalId, beatSeq: _beatSeq });
  }

  // Fallback→WS RECOVERY (the turn-on gate). `_goFallback()` is otherwise PERMANENT: a window that
  // booted pre-game (no live canonical yet ⇒ the hello ack returns `live:false` ⇒ `_goFallback`) would
  // NEVER upgrade even after the season starts. Two windows opened at different lifecycle points would
  // then sit on DIFFERENT transports (WS vs SSE) — the exact split that breaks two-window mirror parity
  // and risks the #1085/#1086 reply-strip on turn-on. So on every `orwell:gamechanged` a fallback window
  // re-attempts a REAL connect (not `rebind()`, which early-returns in fallback), gated on: the flag +
  // game build being on (dormancy preserved — flag off ⇒ never attempt), and a growing backoff having
  // elapsed (storm guard while a genuinely-blocked upgrade keeps failing). The full handshake resolves +
  // liveness-validates the canonical id SERVER-SIDE before any subscribe (bind-before-subscribe), so a
  // still-not-live game just returns `live:false` and falls back again until the next eligible change.
  function _maybeUpgradeFromFallback() {
    if (_mode !== "fallback") return;
    if (!_flagOn() || !_gameBuild()) return;   // flag off / non-game build ⇒ stay in fallback (dormant)
    // Gate by CAUSE: only a pre-game-not-live fallback recovers. A proxy/handshake/exhaustion
    // fallback is permanent — retrying it just re-pays the hello timeout on every gamechanged.
    if (_fallbackReason !== "pregame-not-live") return;
    var now = (typeof Date !== "undefined" && Date.now) ? Date.now() : +new Date();
    if (now - _lastUpgradeAttempt < _upgradeBackoffMs) return;  // within the backoff window — skip
    _lastUpgradeAttempt = now;
    _upgradeBackoffMs = Math.min(UPGRADE_BACKOFF_MAX_MS, _upgradeBackoffMs * 2);
    _mode = "idle";            // re-open the start() gate for a genuine reconnect attempt
    _closingForGood = false;
    start();                   // resolves the canonical id LIVE before subscribing; live:false ⇒ back to fallback
  }

  function _connect() {
    _mode = "negotiating";
    _closingForGood = false;
    var perTabId = _perTabId();
    var sock;
    try {
      sock = new WebSocket(_wsUrl());
    } catch (_) { _goFallback("proxy"); return; }
    _sock = sock;

    // ~3s upgrade budget: no `ack` in time ⇒ blocked proxy / dead route ⇒
    // permanent fallback (§6). We never hang the player on a wedged upgrade.
    _clearHelloTimer();
    _helloTimer = setTimeout(function () {
      if (_mode !== "ws") { try { sock.close(); } catch (_) {} _goFallback("proxy"); }
    }, HELLO_TIMEOUT_MS);

    sock.onopen = function () {
      _hello(perTabId).then(function () {
        _clearHelloTimer();
        if (!_live) {
          // Bound to a not-yet-live id (§2.4) — pre-game / casting hasn't produced a live
          // canonical game yet. Fall soft to SSE, but mark the cause RECOVERABLE: once the
          // season starts, the next `orwell:gamechanged` upgrades this window to WS (§6 turn-on).
          _emitWindow("orwell:ws-dead", { canonicalId: _canonicalId });
          _goFallback("pregame-not-live");
          return;
        }
        _activate();
        // Fresh window ⇒ full replay from 0; a reconnect resumes from the gap.
        _subscribeChat(_reconnectFails > 0 || _highestChatSeq >= 0 ? _highestChatSeq + 1 : 0)
          .catch(function () { /* subscribe refused — chat stays on the SSE fallback */ });
        // Arm the state/hud push edge too (§4). This runs on EVERY successful
        // handshake — a fresh connect AND a reconnect (both re-enter this onopen) —
        // so a dropped socket re-arms all three channels, not just chat.
        _subscribeEdges();
      }).catch(function () { _clearHelloTimer(); _goFallback("handshake"); });
    };

    sock.onmessage = function (ev) {
      var frame;
      try { frame = JSON.parse(ev.data); } catch (_) { return; }
      _handleFrame(frame);
    };

    sock.onerror = function () { /* onclose drives the retry/fallback decision */ };

    sock.onclose = function () {
      _sock = null;
      _chatSubscribed = false;
      _rebinding = null;
      _clearHelloTimer();
      if (_closingForGood) return;
      if (_mode === "ws") {
        // We were live — reconnect with the gap cursor (fromSeq = highest+1) and
        // resume the buffered tail (§3.3 monotonicity). Bounded retries; past the
        // cap we downgrade to SSE permanently (§6).
        _mode = "negotiating";
        _reconnectFails += 1;
        if (_reconnectFails > RECONNECT_GIVEUP) { _goFallback("reconnect-exhausted"); return; }
        var wait = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(2, _reconnectFails - 1));
        if (_reconnectTimer) clearTimeout(_reconnectTimer);
        _reconnectTimer = setTimeout(function () { if (!_closingForGood) _connect(); }, wait);
      } else {
        // Never got live (closed before ack) ⇒ fallback.
        _goFallback("handshake");
      }
    };
  }

  function start() {
    if (_mode !== "idle") return;
    if (!_flagOn() || !_gameBuild()) {
      // Flag off or non-game build ⇒ pure fallback, the zero-risk default (§6). Not a recoverable
      // cause — `_maybeUpgradeFromFallback`'s flag/gameBuild gate already blocks it, but record it.
      _mode = "fallback";
      _fallbackReason = "flag-off";
      _emitWindow("orwell:ws-inactive", { mode: "fallback", reason: "flag-off" });
      return;
    }
    _connect();
  }

  // Re-resolve on a game change (season reset unbinds the canonical id). We only
  // LISTEN for the ONE g15 dispatcher's event — we never dispatch it (§4).
  try {
    window.addEventListener("orwell:gamechanged", function () {
      if (_mode === "ws") { try { rebind(); } catch (_) {} }
      else if (_mode === "fallback") { try { _maybeUpgradeFromFallback(); } catch (_) {} }
    });
  } catch (_) {}

  try {
    window.addEventListener("beforeunload", function () {
      _closingForGood = true;
      try { if (_sock) _sock.close(); } catch (_) {}
    });
  } catch (_) {}

  // ── public surface ──────────────────────────────────────────────────────
  window.OrwellWs = {
    onFrame: onFrame,
    offFrame: offFrame,
    sendTurn: sendTurn,
    sendDecision: sendDecision,
    sendLayout: sendLayout,
    rebind: rebind,
    isActive: function () { return _mode === "ws" && !!_sock && _sock.readyState === 1; },
    isFallback: function () { return _mode === "fallback"; },
    mode: function () { return _mode; },
    isChatSubscribed: function () { return _chatSubscribed; },
    canonicalId: function () { return _canonicalId; },
    lastBeatSeq: function () { return _beatSeq; },
    highestChatSeq: function () { return _highestChatSeq; },
    // test seam: feed a frame straight through the router (no live socket).
    _handleFrame: _handleFrame,
    // test seam: force negotiation start (start() is auto-called on ready).
    _start: start
  };

  // Announce availability so load-order-independent consumers (platform.js's
  // state/hud bridge) can register even if they evaluated first.
  _emitWindow("orwell:ws-ready", {});

  // Auto-start once the DOM (and thus body[data-game-build]) is known.
  if (window.document && window.document.readyState === "loading") {
    window.document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
