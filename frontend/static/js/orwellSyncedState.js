// OrwellSyncedState — the kit-agnostic synced-UI-state substrate (DWE #643).
//
// The 0064 window-layout kit proved a pattern for "a piece of UI state that PERSISTS across
// sessions AND mirrors in realtime across a device's other windows, by construction." Five
// consumers already hand-roll that pattern over a DOM-event convention:
//
//     CAPTURE — dispatch `orwell:window-layout` {id, state}  → orwellLayoutSync debounces a
//               PATCH /api/orwell/layout (or, WS-live, OrwellWs.sendLayout), stamped per-tab
//               `origin` + per-device `deviceId`. Persist + per-device LWW live THERE.
//     SEED    — orwellLayoutSync dispatches `orwell:layout-seed` {windowId, state} on the initial
//               GET, on the durable store landing, AND on every peer change (SSE `layout-changed`
//               or the WS `layout` down-frame, own-`origin` echo already dropped). This is the ONE
//               inbound seam.
//
// Each of orwellWindow / orwellGadget / orwellGadgetRail / orwellNotice / sidebar-layout re-implements
// the same emit-on-change + listen-`orwell:layout-seed` boilerplate, each slightly differently — the
// PO ruling (#643) is to formalize it ONCE so the pending kits (#640 gadget, #658 settings-card,
// #659 tabs) inherit persistence + realtime mirror WITHOUT re-deriving the plumbing.
//
// This module is that formalization. It is a THIN ergonomic layer on top of the existing event
// convention — it owns NO transport, NO deviceId/origin/LWW, NO server contract (all of that stays
// in orwellLayoutSync.js + orwell_layout.py, untouched). A consumer registers a key with an `apply`
// callback and gets a handle whose `.set(partial)` emits the EXACT `orwell:window-layout` event
// orwellLayoutSync already captures — so adoption is byte-identical on the wire, and any kit that
// routes its capture through `.set` and its restore through `apply` is synced by construction.
//
// Vault-free by construction: only UI geometry/prefs flow through here, bounded to the field
// vocabulary orwell_layout.py whitelists (bools + x/y/w/h + side + order). The g15 single-dispatcher
// rule is honored — this module NEVER mints `orwell:gamechanged` (it doesn't touch game state).
//
// Fail-open: with orwellLayoutSync absent, `.set` is a no-op emit and `apply` simply never fires —
// the consumer keeps whatever local-only fallback it has, exactly like the layout kit today.
(function () {
  'use strict';

  // key -> the LIVE entry { apply, coerce } for the currently-registered consumer. A FRESH object per
  // register() (its identity is the dispose guard). dispose() removes the key here.
  var registry = {};
  // key -> the last-known merged state for the key. This SURVIVES dispose and precedes registration,
  // so it is the single source of "restore" state: a seed that lands before any consumer registers, a
  // consumer's own set(), and — crucially — the state left behind by a disposed consumer so a REMOUNT
  // (register → dispose → re-register) restores instead of falling back to defaults. handle.get()
  // reads it; register() fires apply() from it.
  var known = {};

  function _merge(a, b) {
    var out = {};
    if (a) { for (var k in a) if (Object.prototype.hasOwnProperty.call(a, k)) out[k] = a[k]; }
    if (b) { for (var j in b) if (Object.prototype.hasOwnProperty.call(b, j)) out[j] = b[j]; }
    return out;
  }

  function _hasState(key) {
    return known[key] && Object.keys(known[key]).length > 0;
  }

  // Route an inbound seed/remote-change for `key`: always fold it into the persistent known-state (so
  // it survives even if no consumer is registered yet / right now), and apply it to a live consumer.
  function _route(key, state) {
    known[key] = _merge(known[key], state);
    var entry = registry[key];
    if (entry && typeof entry.apply === 'function') {
      try { entry.apply(_merge(known[key], null), { key: key }); } catch (_) {}
    }
  }

  // The ONE inbound seam: every durable landing + realtime peer change arrives here, already
  // transport-normalized and own-echo-suppressed by orwellLayoutSync. We just fan it to the right key.
  try {
    window.addEventListener('orwell:layout-seed', function (e) {
      var d = e && e.detail;
      if (!d || !d.windowId) return;
      _route(d.windowId, d.state || {});
    });
  } catch (_) {}

  // register(key, { apply, coerce }) -> handle
  //   key    — the synced-state id (the layout store's windowId; also the LWW bucket). Kits SHOULD
  //            namespace their ids (e.g. "gadget:<id>", "settings:<id>", "tab:<group>") so two kits
  //            never collide on one bucket — the store merges per-field, so a collision would cross
  //            two consumers' fields.
  //   apply  — apply(state, meta) — called with the merged persisted state on the initial restore
  //            and on every realtime peer change. NEVER called for this tab's own `.set` (that goes
  //            out as capture; the server drops our own-origin echo), so `apply` is re-entrancy-safe.
  //   coerce — optional (partial) -> partial normalizer applied before emit. Omit ⇒ identity, which
  //            keeps `.set` byte-identical to a raw `orwell:window-layout` dispatch.
  function register(key, opts) {
    if (typeof key !== 'string' || !key) throw new Error('OrwellSyncedState.register: a string key is required');
    opts = opts || {};
    // A FRESH entry object per register(). Its identity is the dispose guard: reusing the prior object
    // would make an OLD (disposed) handle and the NEW handle share one `entry`, so `registry[key] ===
    // entry` would be true for BOTH and a stale handle's dispose() would delete the LIVE registration
    // (killing future seed routing to the new consumer). A distinct object makes the stale handle's
    // guard false, so its dispose() is a no-op. The persistent state lives in `known[key]`, not on the
    // entry, so it survives dispose + re-register.
    var entry = { apply: opts.apply, coerce: (typeof opts.coerce === 'function') ? opts.coerce : null };
    registry[key] = entry;

    // RESTORE — the contract is "apply fires on initial restore." Fire it synchronously from the
    // persistent known-state whenever there IS state to restore, covering BOTH:
    //   (a) a seed that landed before this registration (initial GET race); AND
    //   (b) state left behind by a PRIOR registration (a remount: register → dispose → re-register).
    // Guarded against an empty {} so a first-ever registration of a never-seen key fires no no-op apply.
    if (typeof entry.apply === 'function' && _hasState(key)) {
      try { entry.apply(_merge(known[key], null), { key: key }); } catch (_) {}
    }

    // A disposed handle is INERT: set()/get() must no-op so a stale handle cannot dispatch capture
    // events or read state after it left the registry. Since this substrate gates the kits, that leak
    // must not exist.
    var disposed = false;
    var handle = {
      key: key,
      // The last-known state for the key (defensive copy). Inert once disposed.
      get: function () { return disposed ? {} : _merge(known[key], null); },
      // Persist a partial + mirror it. Emits the EXACT event orwellLayoutSync captures, so this
      // inherits per-device persistence, LWW, and realtime two-window mirror with zero transport code.
      set: function (partial) {
        if (disposed) return handle;
        if (!partial || typeof partial !== 'object') return handle;
        var state = entry.coerce ? entry.coerce(partial) : partial;
        if (!state || typeof state !== 'object') return handle;
        known[key] = _merge(known[key], state);
        try {
          window.dispatchEvent(new CustomEvent('orwell:window-layout', { detail: { id: key, state: state } }));
        } catch (_) {}
        return handle;
      },
      // Idempotent: mark the handle inert BEFORE unregistering so no in-flight closure can revive it.
      // Only drop the registry slot if it still points at OUR entry (a re-register may have replaced
      // it). `known[key]` deliberately survives so a later remount can restore.
      dispose: function () {
        if (disposed) return;
        disposed = true;
        if (registry[key] === entry) delete registry[key];
      },
    };
    return handle;
  }

  try {
    window.OrwellSyncedState = { register: register };
  } catch (_) {}
})();
