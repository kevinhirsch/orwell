// Cross-device window/HUD layout sync (feature 0064, Part F).
//
// The OrwellWindow kit windows (cast, finale, retrospective, …) persist their open/minimized/
// docked state + size + position PER DEVICE in localStorage. This module makes that layout a
// synced, per-user blob so every device shows the same arrangement:
//
//   • LOAD   — GET /api/orwell/layout, pre-write the kit's own localStorage keys (so the kit's
//              existing restore lands min/dock/size from the first mount) and apply to any open
//              window; expose the blob as window._orwellLayoutSeed for the kit's seed-on-open.
//   • CAPTURE— the kit dispatches `orwell:window-layout` {id, state} on every geometry/state
//              change; we debounce a PATCH /api/orwell/layout (open/min/dock immediate, geometry
//              settles), stamped with our per-tab ORIGIN.
//   • APPLY  — sessionSync re-dispatches a peer `layout-changed` as `orwell:layout-changed`
//              {windowId, state, origin}; we ignore our own ORIGIN echo and apply the rest via the
//              kit's window._orwellApplyRemoteLayout (which guards against re-emitting).
//
// Purely additive + fail-open: with the engine/route unavailable it does nothing and the kit
// behaves exactly as before (localStorage-only, per-device).
(function () {
  'use strict';

  var API_BASE = (typeof window !== 'undefined' && window.API_BASE) || '';
  // A per-tab token so this device ignores the echo of its own PATCH (there is no stream to key
  // self-echo on, unlike a chat run).
  var ORIGIN = 'low-' + Math.random().toString(36).slice(2) + Date.now().toString(36);

  function userKey() { return (document.body && document.body.dataset.user) || ''; }

  // Land a server window-state into the kit's OWN localStorage keys, so the kit's existing restore
  // (loadParked / loadDocked / winsize) shows the synced state from the first mount. Position (x,y)
  // is slot-relative and can't be a pre-written key — the kit's seed-on-open applies it instead.
  function prewriteLS(id, st) {
    if (!id || !st) return;
    try {
      var u = userKey();
      if (typeof st.minimized === 'boolean') {
        if (st.minimized) localStorage.setItem('orwell-win-parked:' + id + ':' + u, '1');
        else localStorage.removeItem('orwell-win-parked:' + id + ':' + u);
      }
      if (typeof st.docked === 'boolean') {
        localStorage.setItem('orwell-' + id + '-docked:' + u, st.docked ? '1' : '0');
      }
      if (typeof st.w === 'number' && typeof st.h === 'number') {
        localStorage.setItem('winsize-' + id, JSON.stringify({ w: Math.round(st.w), h: Math.round(st.h) }));
      }
    } catch (_) {}
  }

  function rememberSeed(id, st) {
    try {
      window._orwellLayoutSeed = window._orwellLayoutSeed || {};
      window._orwellLayoutSeed[id] = Object.assign(window._orwellLayoutSeed[id] || {}, st);
    } catch (_) {}
  }

  function applyToOpen(id, st) {
    try { if (window._orwellApplyRemoteLayout) window._orwellApplyRemoteLayout(id, st); } catch (_) {}
  }

  function seedFrom(windows) {
    var w = windows || {};
    Object.keys(w).forEach(function (id) {
      var st = w[id] || {};
      rememberSeed(id, st);
      prewriteLS(id, st);     // so the kit's own restore is right from the first mount
      applyToOpen(id, st);    // and any already-open window catches up now
    });
  }

  function load() {
    try {
      fetch(API_BASE + '/api/orwell/layout', { credentials: 'same-origin' })
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
    try {
      fetch(API_BASE + '/api/orwell/layout', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ windowId: id, state: st, origin: ORIGIN }),
      }).catch(function () {});
    } catch (_) {}
  }
  window.addEventListener('orwell:window-layout', function (e) {
    var d = e && e.detail;
    if (!d || !d.id || !d.state) return;
    _pending[d.id] = Object.assign(_pending[d.id] || {}, d.state);
    rememberSeed(d.id, d.state);  // keep our own seed current for a later re-open
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
    rememberSeed(d.windowId, d.state);
    prewriteLS(d.windowId, d.state);
    applyToOpen(d.windowId, d.state);
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
