// Per-device window/HUD layout sync (feature 0064-F → ADR 0017 / WS Phase-1).
//
// The OrwellWindow kit windows (cast, finale, retrospective, …) persist their open/minimized/
// docked state + size + position PER DEVICE in localStorage. This module keys that layout by
// (user, deviceId): geometry is remembered PER DEVICE and is NOT synced cross-device — only the
// SAME device's other tabs mirror each other (ADR 0017 supersedes 0064-F; owner call 2026-07-09).
//
//   • LOAD   — GET /api/orwell/layout?deviceId=…, pre-write the kit's own localStorage keys (so the
//              kit's existing restore lands min/dock/size from the first mount) and apply to any
//              open window; expose the blob as window._orwellLayoutSeed for the kit's seed-on-open.
//   • CAPTURE— the kit dispatches `orwell:window-layout` {id, state} on every geometry/state
//              change; we debounce a PATCH /api/orwell/layout (open/min/dock immediate, geometry
//              settles), stamped with our per-tab ORIGIN and our per-device DEVICE-ID. When the WS
//              transport is live the same PATCH rides `OrwellWs.sendLayout` (fire-and-forget per-
//              device LWW, §5) instead of HTTP; flag-off / socket-down ⇒ the HTTP path unchanged.
//   • APPLY  — sessionSync (HTTP/SSE) OR the WS `layout` down-frame re-dispatches a peer
//              `layout-changed` as `orwell:layout-changed` {windowId, state, origin}; we ignore our
//              own ORIGIN echo and apply the rest via the kit's window._orwellApplyRemoteLayout
//              (which guards against re-emitting). The WS leg additionally scopes the apply to THIS
//              device by deviceId (a different device's echo is dropped — per-device, §5/case d).
//
// TWO DISTINCT TOKENS (ADR 0017 §5, not interchangeable):
//   • DEVICE-ID — stable per-device (localStorage; survives reload; shared across a device's tabs).
//                 The persist/fan-out bucket. Empty (private-mode) ⇒ the legacy per-user scope.
//   • ORIGIN    — per-tab (in-memory). Self-echo suppression only; never selects the bucket.
//
// Purely additive + fail-open: with the engine/route unavailable it does nothing and the kit
// behaves exactly as before (localStorage-only, per-device).
(function () {
  'use strict';

  var API_BASE = (typeof window !== 'undefined' && window.API_BASE) || '';
  // A per-tab token so this tab ignores the echo of its own PATCH (there is no stream to key
  // self-echo on, unlike a chat run).
  var ORIGIN = 'low-' + Math.random().toString(36).slice(2) + Date.now().toString(36);

  // A STABLE per-device token (localStorage — survives reload, shared across the device's tabs;
  // distinct from the per-tab ORIGIN). Keys the per-device layout bucket so a desktop and a phone
  // keep independent arrangements (ADR 0017 §5). Private mode / no localStorage ⇒ '' (empty), which
  // the store's migration resolves to the legacy per-user bucket (back-compat).
  var DEVICE_KEY = 'orwell-device-id';
  var _deviceId = null;
  function deviceId() {
    if (_deviceId !== null) return _deviceId;
    try {
      var v = window.localStorage.getItem(DEVICE_KEY);
      if (!v) {
        v = 'dev_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        window.localStorage.setItem(DEVICE_KEY, v);
      }
      _deviceId = v;
    } catch (_) {
      _deviceId = '';   // fall back to the legacy per-user bucket (migration handles it)
    }
    return _deviceId;
  }

  // Is the WS transport live? (flag-gated, fail-soft — false ⇒ the HTTP path, byte-identical to
  // pre-WS behavior.) Robust to load order: OrwellWs may not have installed yet.
  function wsActive() {
    try { return !!(window.OrwellWs && window.OrwellWs.isActive && window.OrwellWs.isActive()); }
    catch (_) { return false; }
  }

  // Hand a synced layout to the kit. The kit OWNS its persistence keys (audit F5 / the F-3 ratchet:
  // one position system) — so this module NEVER writes geometry/dock localStorage itself; it routes
  // through orwellWindow.js's _orwellSeedLayout (pre-write + seed-on-open + apply-to-open). With the
  // kit absent it falls back to remembering the seed only (no kit ⇒ no windows to place anyway).
  function rememberSeedOnly(windows) {
    try {
      window._orwellLayoutSeed = window._orwellLayoutSeed || {};
      Object.keys(windows || {}).forEach(function (id) {
        window._orwellLayoutSeed[id] = Object.assign(window._orwellLayoutSeed[id] || {}, windows[id] || {});
      });
    } catch (_) {}
  }

  function seedFrom(windows) {
    if (window._orwellSeedLayout) { try { window._orwellSeedLayout(windows || {}); } catch (_) {} }
    else rememberSeedOnly(windows || {});
    // #637/#638: NON-kit consumers (the gadget rail's ORDER, the panel SIDE, game-POPUP dismiss)
    // also live in this synced blob under synthetic ids. The kit ignores those fields (no matching
    // window), so re-dispatch the whole blob as a local apply event they can read. Origin-free: a
    // SEED apply is the durable store landing, not a peer echo, so every device applies it.
    try {
      var w = windows || {};
      Object.keys(w).forEach(function (id) {
        window.dispatchEvent(new CustomEvent('orwell:layout-seed', { detail: { windowId: id, state: w[id] || {} } }));
      });
    } catch (_) {}
  }

  function load() {
    try {
      // GET the (user, deviceId) layout — the deviceId query scopes the read to THIS device (the
      // server falls back to the legacy per-user record on first read of a new device). Empty
      // deviceId ⇒ the legacy per-user scope (back-compat).
      var dev = deviceId();
      var url = API_BASE + '/api/orwell/layout' + (dev ? ('?deviceId=' + encodeURIComponent(dev)) : '');
      fetch(url, { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { if (d && d.windows) seedFrom(d.windows); })
        .catch(function () {});
    } catch (_) {}
  }

  // ── CAPTURE: kit change → debounced PATCH ────────────────────────────────
  var _pending = {};   // id -> merged partial awaiting flush
  var _timers = {};
  function flush(id) {
    var st = _pending[id];
    delete _pending[id];
    if (_timers[id]) { clearTimeout(_timers[id]); delete _timers[id]; }
    if (!st) return;
    var dev = deviceId();
    // WS Phase-1 (ADR 0017 §5): when the socket is live, layout PATCHes ride the `layout` channel
    // (fire-and-forget per-device LWW) instead of HTTP. The frame carries BOTH the per-device
    // deviceId (bucket) and the per-tab origin (self-echo). Flag-off / socket-down / send-failed ⇒
    // the HTTP path below, byte-identical to pre-WS behavior.
    if (wsActive()) {
      try {
        if (window.OrwellWs.sendLayout({ windowId: id, state: st, deviceId: dev, origin: ORIGIN })) return;
      } catch (_) { /* fall through to HTTP */ }
    }
    try {
      fetch(API_BASE + '/api/orwell/layout', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ windowId: id, state: st, origin: ORIGIN, deviceId: dev }),
      }).catch(function () {});
    } catch (_) {}
  }
  window.addEventListener('orwell:window-layout', function (e) {
    var d = e && e.detail;
    if (!d || !d.id || !d.state) return;
    _pending[d.id] = Object.assign(_pending[d.id] || {}, d.state);
    rememberSeedOnly({ [d.id]: d.state });  // keep our own seed current for a later re-open (no LS write)
    if (_timers[d.id]) clearTimeout(_timers[d.id]);
    // State flips (open/min/dock) sync immediately; geometry settles after the gesture.
    var immediate = ('open' in d.state) || ('minimized' in d.state) || ('docked' in d.state);
    var id = d.id;
    _timers[id] = setTimeout(function () { flush(id); }, immediate ? 0 : 350);
  });

  // ── APPLY: peer change (via sessionSync) → kit ───────────────────────────
  window.addEventListener('orwell:layout-changed', function (e) {
    var d = e && e.detail;
    if (!d || !d.windowId || !d.state) return;
    if (d.origin && d.origin === ORIGIN) return;   // our own echo — ignore
    seedFrom({ [d.windowId]: d.state });   // kit pre-writes its own keys + applies to an open window
  });

  // ── APPLY (WS leg): a `layout` down-frame → the SAME `orwell:layout-changed` local event ──
  // When the socket is live the server fans a per-device layout change to THIS device's OTHER tabs
  // as a `layout` down-frame (§5). We scope the apply to our own device by deviceId (a different
  // device's echo is dropped — geometry is per-device), then re-dispatch the EXACT
  // `orwell:layout-changed` event the SSE path produces, so the origin self-echo drop + the kit /
  // non-kit (gadget rail / panel / notice) apply are byte-identical across both transports.
  function onWsLayoutFrame(frame) {
    var d = frame && frame.d;
    if (!d || !d.windowId || !d.state) return;
    var mine = deviceId();
    // Per-device scope (case d): only the SAME device's tabs apply. If we have a deviceId and the
    // frame names a different one, it is not for us. (The server already scopes the fan-out; this is
    // the belt-and-suspenders client guard the test plan requires.)
    if (mine && d.deviceId && d.deviceId !== mine) return;
    try {
      window.dispatchEvent(new CustomEvent('orwell:layout-changed',
        { detail: { windowId: d.windowId, state: d.state, origin: d.origin || '' } }));
    } catch (_) {}
  }
  function registerWsLayout() {
    if (!(window.OrwellWs && typeof window.OrwellWs.onFrame === 'function')) return false;
    window.OrwellWs.onFrame('layout', onWsLayoutFrame);
    return true;
  }
  // Robust to load order: register now if OrwellWs is present, else on ws-ready (mirrors platform.js).
  if (!registerWsLayout()) window.addEventListener('orwell:ws-ready', registerWsLayout, { once: true });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
