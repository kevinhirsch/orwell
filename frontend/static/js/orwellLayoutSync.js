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
    if (window._orwellSeedLayout) { try { window._orwellSeedLayout(windows || {}); return; } catch (_) {} }
    rememberSeedOnly(windows || {});
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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
