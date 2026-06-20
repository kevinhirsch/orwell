// OrwellWindow — THE window kit (Lane F / F-1; DWE audit Phase 2).
//
// One base class + one CSS family (.ow-window / .ow-titlebar / .ow-controls /
// .ow-body + state modifiers) that every panel, modal, and popover composes —
// replacing the per-panel reimplementations the 2026-06-11 DWE audit censused
// (3 drag engines, 7 geometry-key schemes, 6 chrome builders, 5+ Escape paths,
// 2 z escalators). The kit OWNS, in one place:
//
//   • registration: OrwellSlots (placement) + modalManager (minimize/dock chip)
//   • drag (windowDrag) with an EXPLICIT clamp — never trust cursor physics
//   • one z-authority for the window band (modals stay above; banner above all)
//     + click-to-front + a visible focused state (audit F9)
//   • minimize-to-dock with the ruling-#19 fly-out toward the dock and a
//     fly-away on close; open keeps the E97 fade+scale; prefers-reduced-motion
//     strips ALL of it (audit F4)
//   • ONE geometry-persistence scheme: the slot offset, clamped at restore
//     (S11/E91) — kit windows never mint their own position keys (audit F5)
//   • focus management: focus-return to the opener on close (audit F8),
//     keyboard move on the titlebar — arrows move, Shift+arrows resize where
//     enabled, Home re-docks to the slot base (audit F10)
//   • Escape participation through ui.js's single arbiter (audit F7): menus
//     dismiss first, then the top kit window parks/closes, then modals
//   • teardown: one AbortController; destroy() leaves no listeners, no node
//
// Migration waves (Lane F / F-2) move each existing surface onto this class
// and DELETE its bespoke code in the same PR. New windows MUST compose the kit
// (the F-3 ratchet pins it).
import * as Modals from './modalManager.js';
import { makeWindowDraggable } from './windowDrag.js';
import { makeWindowResizable } from './windowResize.js';

const Z_BASE = 500;          // the window band: above the legacy panel stamps
const Z_CEIL = 980;          //   (modalManager's 300s), below modals (1000+)
let _zTop = Z_BASE;
const _stack = [];           // open, un-minimized kit windows, bottom → top

const REDUCED = () =>
  !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

// ── the one CSS family ────────────────────────────────────────────────────
// The window FRAME (bg / border / radius / shadow) and the titlebar TYPE
// (size / weight / tracking) come from the shared --win-* tokens defined
// once in style.css :root (Lane G4) — the SAME tokens the legacy modal
// family (.modal-content / .modal-header h4) consumes, so kit windows and
// the settings/theme/tool modals paint one visual language and per-theme
// overrides (the 0052 house presets, the frost layer) hit both families at
// once. The fallbacks below only cover style.css not having loaded. The
// titlebar COLOR stays var(--fg) by design — see the :root token note
// (the modal family's var(--red) header fails AA on some palettes).
function ensureCss() {
  if (document.getElementById('ow-window-css')) return;
  const st = document.createElement('style');
  st.id = 'ow-window-css';
  st.textContent = `
    .ow-window {
      position: fixed; z-index: ${Z_BASE};
      min-width: 180px; max-width: 64vw;
      background: var(--win-bg, var(--panel, #111)); color: var(--fg, #9cdef2);
      border: 1px solid var(--win-border, var(--border, #355a66));
      border-radius: var(--win-radius, 10px);
      box-shadow: var(--win-shadow, 0 8px 32px rgba(0,0,0,.45));
      font-size: var(--fs-sm, .8rem); line-height: 1.45;
      /* NB (A6): do NOT clip the frost by hiding overflow on this root — combined with the
         10px border-radius it clips the rounded-corner pointer region and defeats the L11
         corner-resize grab (which arms 2px from the corner; CI browser-smoke caught it). The
         frosted-top cohesion instead rides the L34 frost rules in style.css: this .ow-window
         ROOT carries the single backdrop-filter, and the .ow-titlebar is transparent with NO
         filter of its own — so the whole window frosts as one continuous glass surface. (A6
         FIXED 2026-06-19: the titlebar previously carried its OWN backdrop-filter, which
         re-blurred the root's already-frosted glass and composited the top strip to a
         mismatched shade — the "frost breaks at the top" band. Never re-add a child filter or
         a blind overflow clip here.) */
    }
    /* L11: once a window carries an explicit height (the player resized it, or a
       persisted size was restored), let it become a flex column so the body
       grows to fill it instead of staying pinned to its content height. The
       windowResize helper sets inline width/height + maxWidth/maxHeight:none. */
    .ow-window.window-resizing, .ow-window[style*="height"] {
      display: flex; flex-direction: column;
    }
    .ow-window.window-resizing > .ow-body, .ow-window[style*="height"] > .ow-body {
      flex: 1 1 auto; max-height: none;
    }
    .ow-window.ow-focused {
      border-color: color-mix(in srgb, var(--accent, #e06c75) 65%, var(--win-border, var(--border, #355a66)));
      box-shadow: 0 12px 36px rgba(0,0,0,.5);
    }
    .ow-titlebar {
      display: flex; align-items: center; gap: .4rem;
      padding: .45rem .55rem .35rem .7rem;
      cursor: move; user-select: none; -webkit-user-select: none;
      border-radius: var(--win-radius, 10px) var(--win-radius, 10px) 0 0;
    }
    .ow-titlebar:focus-visible { outline: 2px solid var(--accent, #e06c75); outline-offset: -2px; }
    .ow-title {
      flex: 1; min-width: 0;
      font-size: var(--win-titlebar-fs, 1rem);
      font-weight: var(--win-titlebar-weight, 600);
      letter-spacing: var(--win-titlebar-ls, -0.03em);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .ow-controls { display: flex; gap: 2px; flex-shrink: 0; }
    /* .ow-dismiss: non-window dismissible surfaces (strips, banners, panels —
       ruling-#3/#4-class chrome) adopt the SAME control affordance without
       becoming windows (audit F6 tail). */
    .ow-controls button, .ow-dismiss {
      min-width: 24px; min-height: 24px; padding: 0;
      display: inline-flex; align-items: center; justify-content: center;
      border: none; background: none; color: inherit; cursor: pointer;
      opacity: .6; border-radius: 6px; font: inherit; font-size: var(--fs-sm, .8rem);
    }
    .ow-controls button:hover, .ow-controls button:focus-visible,
    .ow-dismiss:hover, .ow-dismiss:focus-visible { opacity: 1; background: rgba(255,255,255,.08); }
    .ow-body { padding: .4rem .7rem .6rem; overflow: auto; max-height: min(70vh, 560px); }
    /* ── A7 [ruling #19] — the Windows-7 fly-out family ───────────────────────
       The animation CONTRACT exposes DISTINCT minimize vs. close keyframes, both
       DRIVEN (not pure transitions) so the CSS itself names the two motions; the
       JS sets the fly vector via --ow-fly-x/-y. open keeps the E97 fade+scale.
       prefers-reduced-motion strips ALL of it (the @media block below). */
    @keyframes ow-open { from { opacity: 0; transform: scale(.96); } to { opacity: 1; transform: scale(1); } }
    @keyframes ow-minimize {
      from { opacity: 1; transform: translate(0, 0) scale(1); }
      to   { opacity: 0; transform: translate(var(--ow-fly-x, 0), var(--ow-fly-y, 0)) scale(.12); }
    }
    @keyframes ow-close {
      from { opacity: 1; transform: scale(1); }
      to   { opacity: 0; transform: scale(.9); }
    }
    .ow-anim-open { animation: ow-open .18s ease-out; }
    /* pronounced Win7 easing on the minimize fly-out; a quicker fade on close */
    .ow-anim-minimize { animation: ow-minimize .27s cubic-bezier(.5,-0.2,.4,1) forwards; }
    .ow-anim-close { animation: ow-close .18s cubic-bezier(.45,.05,.55,.95) forwards; }
    @media (prefers-reduced-motion: reduce) {
      .ow-anim-open, .ow-anim-minimize, .ow-anim-close { animation: none; }
    }
    /* ── 0054 Phase 2 — DOCKED kit mode ───────────────────────────────────────
       A docked window mounts its WHOLE element as a child of #gadget-rail-body
       (full-content "docked kit mode", not a compact summary). It opts OUT of the
       slot geometry system entirely: static flow position, no drag, no resize, no
       fixed z — so F5's ONE-position-system invariant holds (docked = NO geometry,
       never a second scheme). The rail owns visibility (content-driven), order
       (drag-reorder), collapse, and the single mobile drawer. The titlebar frost
       (L34) and the .ow-* chrome family ride along unchanged. */
    .ow-window.ow-docked {
      position: static !important; z-index: auto !important;
      width: auto !important; max-width: none !important; min-width: 0 !important;
      left: auto !important; top: auto !important; right: auto !important; bottom: auto !important;
      transform: none !important;
      margin: var(--space-2, .4rem) 0 0; box-shadow: none;
      display: flex; flex-direction: column;
    }
    .ow-window.ow-docked > .ow-titlebar { cursor: default; }
    .ow-window.ow-docked > .ow-body { max-height: none; }
    /* the dock/undock toggle reads as a quieter control than min/close */
    .ow-controls .ow-dock { font-size: .9rem; }
    /* ── loading affordance (perf/resilience) ─────────────────────────────────
       A NON-blocking refresh indicator the kit owns: a window opens IMMEDIATELY
       with its last-good (or placeholder) content and shows a thin top progress
       sliver + a quiet titlebar "·refreshing" hint while a slow /state fill is in
       flight — never a blank 30-45s hang. Purely additive overlay: it never hides
       the body, so a reused last-good snapshot stays visible underneath. reduced-
       motion stills the sliver to a static tint. */
    .ow-window.ow-loading > .ow-body { position: relative; }
    .ow-window.ow-loading > .ow-body::before {
      content: ""; position: absolute; left: 0; right: 0; top: 0; height: 2px;
      background: linear-gradient(90deg,
        transparent, var(--accent, #e06c75) 40%, var(--accent, #e06c75) 60%, transparent);
      background-size: 240% 100%; animation: ow-load-sweep 1.1s linear infinite;
      pointer-events: none; z-index: 2;
    }
    .ow-title .ow-load-hint {
      margin-left: .4rem; font-size: .7em; font-weight: 400; opacity: .55;
      letter-spacing: 0; white-space: nowrap;
    }
    @keyframes ow-load-sweep {
      from { background-position: 120% 0; } to { background-position: -120% 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      .ow-window.ow-loading > .ow-body::before {
        animation: none; background: var(--accent, #e06c75); opacity: .5;
      }
    }
  `;
  document.head.appendChild(st);
}

// Explicit viewport clamp (audit note on norm c: never rely on cursor physics).
function clampPos(left, top, w, h) {
  const margin = 4;
  return {
    left: Math.max(margin, Math.min(window.innerWidth - Math.max(w, 60) - margin, left)),
    top: Math.max(margin, Math.min(window.innerHeight - Math.min(h, 200) - margin, top)),
  };
}

function flyTargetRect() {
  // Where minimize flies to: the window's own dock chip if rendered, else the
  // dock, else the sidebar's bottom corner (the dock's home).
  const dock = document.getElementById('minimized-dock');
  if (dock && dock.getBoundingClientRect().height > 0) return dock.getBoundingClientRect();
  const sb = document.getElementById('sidebar');
  if (sb) { const r = sb.getBoundingClientRect(); return { left: r.left + 16, top: r.bottom - 48, width: 32, height: 24 }; }
  return { left: 16, top: window.innerHeight - 48, width: 32, height: 24 };
}

// ── parked-state persistence (G5 refresh-persistence audit F2 / Lane G16) ──
// Parked means parked: modalManager's minimized registry is in-memory, so a
// refresh used to snap every parked window back open (and lose its dock
// chip). The kit persists a per-window parked flag — keyed per user,
// mirroring the slot-offset scheme ('orwell-slot-offset:<key>:<user>') —
// set on minimize(), cleared on a dock restore and on close/teardown.
// open() consults it and mounts a previously-parked window DIRECTLY into
// the dock (chip rendered, panel hidden, no open animation — no flash, no
// raise, no focus steal).
function parkedKey(id) {
  return 'orwell-win-parked:' + id + ':' + ((document.body && document.body.dataset.user) || '');
}
function loadParked(id) {
  try { return localStorage.getItem(parkedKey(id)) === '1'; } catch (_) { return false; }
}
function saveParked(id, on) {
  try {
    if (on) localStorage.setItem(parkedKey(id), '1');
    else localStorage.removeItem(parkedKey(id));
  } catch (_) {}
}

// ── docked-state persistence (0054 Phase 2) ───────────────────────────────
// Per-window, per-user — mirroring orwellCastPin's 'orwell-cast-pinned:<user>'
// key pattern so docked-vs-floating survives a reload exactly like the rail's
// other persisted layout. Default is floating unless `defaultDocked` flips it.
function dockedKey(id) {
  return 'orwell-' + id + '-docked:' + ((document.body && document.body.dataset.user) || '');
}
function loadDocked(id, dflt) {
  try {
    const v = localStorage.getItem(dockedKey(id));
    if (v === '1') return true;
    if (v === '0') return false;
  } catch (_) {}
  return !!dflt;
}
function saveDocked(id, on) {
  try { localStorage.setItem(dockedKey(id), on ? '1' : '0'); } catch (_) {}
}

// ── 0064 Part F: cross-device layout sync ──────────────────────────────────
// A live registry of open kit windows by id, so a remote layout change (from
// another of the user's devices, delivered via the canonical session's SSE
// channel → orwellLayoutSync.js) can be applied to the matching window. Capture
// works the other way: each local geometry/state change emits an
// `orwell:window-layout` CustomEvent that orwellLayoutSync debounces into a
// PATCH /api/orwell/layout. Self-echo is suppressed both by an `origin` token
// (in the sync module) and by the `_applyingRemote` guard here (so applying a
// remote change never re-emits it). Fail-open everywhere: with the sync module
// absent, the kit behaves exactly as before (localStorage-only).
const _byId = new Map();

function emitWindowLayout(id, state) {
  if (!id || !state) return;
  try { window.dispatchEvent(new CustomEvent('orwell:window-layout', { detail: { id, state } })); } catch (_) {}
}

// The seam orwellLayoutSync calls to apply a remote change to a live window.
function applyRemoteLayout(id, state) {
  const w = _byId.get(id);
  if (w && typeof w._applyLayout === 'function') { w._applyLayout(state); return true; }
  return false;
}
try { window._orwellApplyRemoteLayout = applyRemoteLayout; } catch (_) {}

// Seed a synced layout (from another device, via orwellLayoutSync) into the kit. The kit owns its
// OWN persistence keys (audit F5 / the F-3 ratchet: ONE position system) — so the geometry/state
// keys are written HERE, through the kit's existing helpers, never minted by the sync module. We
// pre-write min/dock/size so the kit's existing restore lands them at first mount, stash the blob
// for seed-on-open, and apply to any already-open window now.
function seedLayout(windows) {
  const w = windows || {};
  try { window._orwellLayoutSeed = window._orwellLayoutSeed || {}; } catch (_) {}
  Object.keys(w).forEach((id) => {
    const st = w[id] || {};
    try { window._orwellLayoutSeed[id] = Object.assign(window._orwellLayoutSeed[id] || {}, st); } catch (_) {}
    if (typeof st.minimized === 'boolean') saveParked(id, st.minimized);   // kit's own parked key
    if (typeof st.docked === 'boolean') saveDocked(id, st.docked);         // kit's own docked key
    if (typeof st.w === 'number' && typeof st.h === 'number') {
      try { localStorage.setItem('winsize-' + id, JSON.stringify({ w: Math.round(st.w), h: Math.round(st.h) })); } catch (_) {}
    }
    applyRemoteLayout(id, st);  // a live window catches up immediately
  });
}
try { window._orwellSeedLayout = seedLayout; } catch (_) {}

export class OrwellWindow {
  /**
   * opts: { id, title, icon, slot='top-right', slotKey=null, role='complementary',
   *         draggable=true, minimizable=true, closable=true, resizable=true,
   *         minWidth=240, minHeight=160,
   *         content (Node|string), focus=false, onClose, onMinimize, onRestore,
   *         dockable=false, defaultDocked=false, onDock }
   *
   * 0054 Phase 2 — DOCKED kit mode. A `dockable` window renders a dock/undock
   * toggle in its titlebar and persists the choice per user (`orwell-<id>-docked:
   * <user>`). Docked, the whole window mounts as a child of `#gadget-rail-body`
   * (full-content "docked kit mode"): NO position:fixed, NO drag, NO resize, NO
   * slot-key (it OPTS OUT of the slot-offset geometry system — F5's one-position-
   * system invariant holds: docked = no geometry, never a second scheme), and NO
   * minimize-to-dock (the rail owns visibility/order/collapse/mobile-drawer). The
   * default is FLOATING (set `defaultDocked:true` to flip — a one-line owner choice).
   *
   * L11: every kit window is user-resizeable from any EDGE and any CORNER on
   * desktop (the shared windowResize helper — edge-proximity grips, not injected
   * handles), with the chosen size persisted per window under the kit's one
   * `winsize-<id>` key (the same clamped scheme the settings/tool modals use).
   * Mobile (≤768px, the sheet/drawer tier) skips edge-resize by design — the
   * sheet host owns the geometry there. Opt a window out with resizable:false.
   */
  constructor(opts) {
    this.o = Object.assign({ slot: 'top-right', role: 'complementary',
      draggable: true, minimizable: true, closable: true, resizable: true,
      minWidth: 240, minHeight: 160, focus: false,
      dockable: false, defaultDocked: false }, opts);
    if (!this.o.id || !this.o.title) throw new Error('OrwellWindow needs id + title');
    this.ac = new AbortController();
    this.opener = null;
    this.el = null;
    this._slot = null;
    // 0054 Phase 2: docked-vs-floating is resolved per OPEN (the toggle close()s
    // then open()s, so the kit rebuilds in the chosen mode). Seed from persistence.
    this._docked = this.o.dockable && loadDocked(this.o.id, this.o.defaultDocked);
  }

  _build() {
    ensureCss();
    const docked = this._docked;
    const el = document.createElement('div');
    el.id = this.o.id;
    el.className = 'ow-window' + (docked ? ' ow-docked' : '');
    el.setAttribute('data-ow-window', '');
    if (docked) el.setAttribute('data-ow-docked', '');
    el.setAttribute('role', this.o.role);
    el.setAttribute('aria-label', this.o.title);
    const tb = document.createElement('div');
    tb.className = 'ow-titlebar';
    tb.setAttribute('tabindex', '0');
    tb.title = (this.o.draggable && !docked) ? 'Drag to move · arrows to nudge' : '';
    const title = document.createElement('span');
    title.className = 'ow-title';
    title.textContent = this.o.title;
    const controls = document.createElement('div');
    controls.className = 'ow-controls';
    // 0054 Phase 2: the dock/undock toggle (only on dockable windows). It flips the
    // persisted flag and re-opens in the other mode — ONE position system, so a
    // mode change is a teardown + rebuild, never a live geometry mutation.
    if (this.o.dockable) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ow-dock';
      const docked = this._docked;
      b.setAttribute('aria-label', docked ? 'Float this window' : 'Dock to the control room');
      b.title = docked ? 'Float (undock from the control room)' : 'Dock to the control room';
      b.textContent = docked ? '⇱' : '⇲';  // undock (pop out) vs. dock (tuck in)
      b.addEventListener('click', (e) => { e.stopPropagation(); this.toggleDock(); }, { signal: this.ac.signal });
      controls.appendChild(b);
    }
    // Minimize-to-dock is a FLOATING affordance; a docked window lives in the rail
    // and never minimizes to the chip dock (the rail owns its visibility/collapse).
    if (this.o.minimizable && !this._docked) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ow-min';
      b.setAttribute('aria-label', 'Minimize'); b.title = 'Minimize';
      b.textContent = '–';
      b.addEventListener('click', (e) => { e.stopPropagation(); this.minimize(); }, { signal: this.ac.signal });
      controls.appendChild(b);
    }
    if (this.o.closable) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ow-close';
      b.setAttribute('aria-label', 'Close'); b.title = 'Close';
      b.textContent = '×';
      b.addEventListener('click', (e) => { e.stopPropagation(); this.close(); }, { signal: this.ac.signal });
      controls.appendChild(b);
    }
    tb.appendChild(title); tb.appendChild(controls);
    const body = document.createElement('div');
    body.className = 'ow-body';
    if (this.o.content instanceof Node) body.appendChild(this.o.content);
    else if (typeof this.o.content === 'string') body.innerHTML = this.o.content;
    el.appendChild(tb); el.appendChild(body);
    this.el = el; this.titlebar = tb; this.body = body;

    // 0054 Phase 2: a docked window opts OUT of drag, resize, slot geometry, the
    // raise/z-band, and the keyboard-move handler — it is static rail flow, and the
    // rail owns its placement. Everything below the guard is FLOATING-only chrome.
    if (docked) return el;

    // click-to-front (capture so any inner click raises first) — audit F9
    el.addEventListener('pointerdown', () => this.raise(), { capture: true, signal: this.ac.signal });

    // keyboard move / resize / re-dock on the titlebar — audit F10
    tb.addEventListener('keydown', (e) => this._onTitlebarKey(e), { signal: this.ac.signal });

    if (this.o.draggable) {
      makeWindowDraggable(el, {
        content: el, header: tb,
        enableDock: false, enableFullscreen: false, enableResize: false,
        skipSelector: 'button, input, select, textarea',
        onDragEnd: ({ rect }) => this._persist(rect),
      });
    }
    // (resize capture for 0064 is wired in the makeWindowResizable call below)
    // L11: pointer edge/corner resize from the kit — every .ow-* window inherits
    // it (sane min/max, clamped to the viewport, persisted under winsize-<id>).
    // mobileSkip 768 keeps the sheet/drawer tier untouched. Its capture-phase
    // mousedown pre-empts the titlebar drag only when the grab lands on a border.
    if (this.o.resizable) {
      makeWindowResizable(el, {
        mobileSkip: 768,
        minWidth: this.o.minWidth, minHeight: this.o.minHeight,
        storageKey: 'winsize-' + this.o.id,
        isLocked: () => this.isMinimized(),
        // 0064: capture a user resize for cross-device sync (suppressed while APPLYING a remote one).
        onResizeEnd: ({ rect }) => {
          if (this._applyingRemote) return;
          emitWindowLayout(this.o.id, { w: Math.round(rect.width), h: Math.round(rect.height) });
        },
      });
    }
    return el;
  }

  _persist(rect) {
    // ONE scheme: the slot offset, clamped at restore (S11). Clamp at SAVE too.
    const c = clampPos(rect.left, rect.top, rect.width, rect.height);
    if (c.left !== rect.left || c.top !== rect.top) {
      this.el.style.left = c.left + 'px'; this.el.style.top = c.top + 'px';
      rect = this.el.getBoundingClientRect();
    }
    if (this._slot) this._slot.saveDragOffset(rect);
    // 0064: capture the new position for cross-device sync (not while applying a remote change).
    if (!this._applyingRemote) emitWindowLayout(this.o.id, { x: Math.round(rect.left), y: Math.round(rect.top) });
  }

  /** 0064: apply a layout change that arrived from another of the user's devices. Sets
   *  `_applyingRemote` so the resulting state changes don't re-emit (no echo loop). Floating
   *  geometry only (docked windows have no geometry — F5). Fail-open; never throws. */
  _applyLayout(state) {
    if (!state || typeof state !== 'object') return;
    this._applyingRemote = true;
    try {
      if (typeof state.docked === 'boolean' && this.o.dockable && state.docked !== this._docked) {
        this.toggleDock();
      }
      if (typeof state.minimized === 'boolean' && !this._docked) {
        if (state.minimized && !this.isMinimized()) this.minimize();
        else if (!state.minimized && this.isMinimized()) this.restore();
      }
      // Don't yank geometry out from under an ACTIVE local resize (spec F: defer during a live
      // gesture). min/dock still apply; the geometry re-syncs on the gesture's own end-emit.
      const gestureActive = document.body.classList.contains('window-resizing-active');
      if (this.el && !this._docked && !gestureActive) {
        if (typeof state.w === 'number' && typeof state.h === 'number') {
          this.el.style.width = Math.max(this.o.minWidth, Math.min(state.w, window.innerWidth)) + 'px';
          this.el.style.height = Math.max(this.o.minHeight, Math.min(state.h, window.innerHeight)) + 'px';
          this.el.style.maxWidth = 'none'; this.el.style.maxHeight = 'none';
          try { localStorage.setItem('winsize-' + this.o.id, JSON.stringify({ w: Math.round(state.w), h: Math.round(state.h) })); } catch (_) {}
        }
        if (typeof state.x === 'number' && typeof state.y === 'number') {
          const r = this.el.getBoundingClientRect();
          const c = clampPos(state.x, state.y, r.width, r.height);
          this.el.style.left = c.left + 'px'; this.el.style.top = c.top + 'px';
          this.el.style.right = 'auto'; this.el.style.bottom = 'auto'; this.el.style.transform = 'none';
          if (this._slot) this._slot.saveDragOffset(this.el.getBoundingClientRect());
        }
      }
    } catch (_) {}
    this._applyingRemote = false;
  }

  // Re-anchor + clamp this window into the CURRENT viewport (the global resize
  // listener calls this for every open, un-minimized, non-docked window). Cheap:
  // one rect read, at most a few style writes. Docked windows are skipped by the
  // caller (the rail owns them); minimized ones are skipped too (hidden, no point).
  //   1. slotted windows re-run the slot re-clamp (restackSlot already clamps,
  //      post-#345) so they re-anchor + clamp into the new viewport;
  //   2. a floating/dragged window clamps its raw left/top via clampPos;
  //   3. a window now LARGER than the viewport shrinks to fit (viewport − 8),
  //      respecting its own minWidth/minHeight, then re-clamps its position.
  _reclamp() {
    if (!this.el || this._docked || this.isMinimized()) return;
    if (this.el.style.display === 'none') return;
    // 3. Shrink-to-fit FIRST so the post-shrink size drives the position clamp.
    const r0 = this.el.getBoundingClientRect();
    const maxW = window.innerWidth - 8;
    const maxH = window.innerHeight - 8;
    if (r0.width > maxW) {
      this.el.style.width = Math.max(this.o.minWidth, maxW) + 'px';
      this.el.style.maxWidth = 'none';
    }
    if (r0.height > maxH) {
      this.el.style.height = Math.max(this.o.minHeight, maxH) + 'px';
      this.el.style.maxHeight = 'none';
    }
    // 1. Slotted: let the slot engine re-anchor + clamp (it runs clampPos itself).
    if (this._slot) { this._slot.restack(); }
    // 2. Clamp this window's own position into the viewport. clampPos only guarantees
    //    a SLIVER stays on-screen (≥200px of a tall window's top); on a viewport SHRINK
    //    we want the WHOLE window in view whenever it now fits, so pull left/top back so
    //    the right/bottom edges land inside too (never past the 4px margin on either side).
    const m = 4;
    const r = this.el.getBoundingClientRect();
    let left = Math.max(m, Math.min(window.innerWidth - r.width - m, r.left));
    let top = Math.max(m, Math.min(window.innerHeight - r.height - m, r.top));
    if (left < m) left = m;   // wider than the viewport (already min-clamped above) — pin left
    if (top < m) top = m;     // taller than the viewport — pin top
    if (Math.abs(left - r.left) > 0.5 || Math.abs(top - r.top) > 0.5) {
      this.el.style.left = left + 'px'; this.el.style.top = top + 'px';
      this.el.style.right = 'auto'; this.el.style.bottom = 'auto'; this.el.style.transform = 'none';
    }
  }

  _onTitlebarKey(e) {
    const STEP = 16;
    const dirs = { ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0], ArrowUp: [0, -STEP], ArrowDown: [0, STEP] };
    if (e.key === 'Home' && this._slot && this.o.slotKey) {
      e.preventDefault();
      try { localStorage.removeItem('orwell-slot-offset:' + this.o.slotKey + ':' + ((document.body && document.body.dataset.user) || '')); } catch (_) {}
      this._slot.restack();
      return;
    }
    const d = dirs[e.key];
    if (!d) return;
    e.preventDefault();
    const r = this.el.getBoundingClientRect();
    if (e.shiftKey && this.o.resizable) {
      const w = Math.max(200, Math.min(window.innerWidth - 8, r.width + d[0]));
      const h = Math.max(120, Math.min(window.innerHeight - 8, r.height + d[1]));
      this.el.style.width = w + 'px'; this.el.style.height = h + 'px';
      return;
    }
    const c = clampPos(r.left + d[0], r.top + d[1], r.width, r.height);
    this.el.style.left = c.left + 'px'; this.el.style.top = c.top + 'px';
    this.el.style.right = 'auto'; this.el.style.bottom = 'auto'; this.el.style.transform = 'none';
    this._persist(this.el.getBoundingClientRect());
  }

  open(opener) {
    if (this.el && this.el.isConnected) { this.restore(); return this; }
    this.opener = opener || document.activeElement || null;
    // A prior _teardown() aborted this.ac; a fresh open (incl. the dock toggle's
    // re-open) needs a live controller so _build's listeners actually attach.
    if (this.ac.signal.aborted) this.ac = new AbortController();
    const el = this._build();
    _byId.set(this.o.id, this);                                            // 0064: live registry for remote apply
    if (!this._applyingRemote) emitWindowLayout(this.o.id, { open: true }); // 0064: capture open state
    // 0054 Phase 2: a docked window mounts straight into #gadget-rail-body (the
    // rail owns visibility/order/collapse/mobile-drawer). NO slot register, NO
    // dock-chip register, NO z-band raise — docked = no geometry, the F5 invariant
    // holds. The consuming panel's own content-driven display:none decides when the
    // rail shows it (its existing MutationObserver). Body fallback if no rail yet.
    if (this._docked) {
      const railBody = document.getElementById('gadget-rail-body');
      (railBody || document.body).appendChild(el);
      if (this.o.focus) this.titlebar.focus();
      return this;
    }
    document.body.appendChild(el);
    if (window.OrwellSlots) {
      this._slot = window.OrwellSlots.register(el, this.o.slot,
        { key: this.o.slotKey || null, draggable: this.o.draggable });
    }
    Modals.register(this.o.id, {
      label: this.o.title, icon: this.o.icon || '',
      restoreFn: () => this._afterDockRestore(),
      closeFn: () => this._teardown(),
    });
    // F2 (G5 audit / G16): a window the player parked stays parked across a
    // refresh — mount straight into the minimized state (dock chip, panel
    // hidden; no open animation, no raise, no focus steal), exactly as if the
    // minimize had happened this page-life. The dock chip (or an explicit
    // restore) brings it back and durably un-parks it.
    if (this.o.minimizable && loadParked(this.o.id)) {
      this._displayBeforeMin = el.style.display;
      Modals.minimize(this.o.id);
      el.style.display = 'none';
      return this;
    }
    if (!REDUCED()) { el.classList.add('ow-anim-open'); setTimeout(() => el.classList.remove('ow-anim-open'), 220); }
    this.raise();
    if (this.o.focus) this.titlebar.focus();
    // 0064 Part F: apply a synced layout seed from another device once layout settles. min/dock/size
    // also restore via localStorage (the kit's existing load); this additionally covers POSITION and
    // keeps a just-opened window consistent with a change made elsewhere while it was closed.
    try {
      const seed = window._orwellLayoutSeed && window._orwellLayoutSeed[this.o.id];
      if (seed) requestAnimationFrame(() => { if (this.el) this._applyLayout(seed); });
    } catch (_) {}
    return this;
  }

  raise() {
    if (!this.el || this._docked) return;  // a docked window has no z-band / focus stack
    if (_zTop >= Z_CEIL) { // renormalize the band
      _zTop = Z_BASE;
      for (const w of _stack) { w.el.style.zIndex = String(++_zTop); }
    }
    this.el.style.zIndex = String(++_zTop);
    const i = _stack.indexOf(this);
    if (i !== -1) _stack.splice(i, 1);
    _stack.push(this);
    for (const w of _stack) w.el && w.el.classList.toggle('ow-focused', w === this);
  }

  minimize() {
    if (!this.el || this._docked) return;  // docked windows live in the rail, no chip dock
    saveParked(this.o.id, true); // F2 (G16): parked means parked — survive a refresh
    if (!this._applyingRemote) emitWindowLayout(this.o.id, { minimized: true });  // 0064
    const i = _stack.indexOf(this);
    if (i !== -1) _stack.splice(i, 1);
    this.el.classList.remove('ow-focused');
    // Capture the pre-minimize inline display so restore can put it BACK —
    // clearing to '' would fall through to a consumer's own CSS (e.g. a panel
    // whose stylesheet defaults to display:none), reproducing the F1 bug class
    // one layer up.
    this._displayBeforeMin = this.el.style.display;
    const done = () => {
      this.el.classList.remove('ow-anim-minimize');
      this.el.style.removeProperty('--ow-fly-x'); this.el.style.removeProperty('--ow-fly-y');
      Modals.minimize(this.o.id);            // chip renders; F1 makes the dock visible
      this.el.style.display = 'none';        // kit windows aren't .modal — hide explicitly
      try { this.o.onMinimize && this.o.onMinimize(); } catch (_) {}
    };
    if (REDUCED()) { done(); return; }
    // A7 [ruling #19]: the Win7 fly-out — scale-down + translate along the path to
    // the dock row, driven by the dedicated ow-minimize keyframe (the fly vector is
    // handed to it via --ow-fly-x/-y so the keyframe owns the motion, one contract).
    const from = this.el.getBoundingClientRect();
    const to = flyTargetRect();
    const dx = (to.left + (to.width || 32) / 2) - (from.left + from.width / 2);
    const dy = (to.top + (to.height || 24) / 2) - (from.top + from.height / 2);
    this.el.style.setProperty('--ow-fly-x', dx + 'px');
    this.el.style.setProperty('--ow-fly-y', dy + 'px');
    this.el.classList.add('ow-anim-minimize');
    setTimeout(done, 280);
  }

  _afterDockRestore() {
    // modalManager.restore removed .hidden/.modal-minimized and stamped ITS z —
    // re-show (the exact pre-minimize inline display, never '' — see minimize),
    // then re-assert the kit band so stacking stays one authority.
    this.el.style.display = this._displayBeforeMin || '';
    // F2 (G16): a window that mounted straight into the dock (boot-parked)
    // never had a real pre-minimize display captured, and '' can fall through
    // to a consumer stylesheet's display:none (the finale defaults hidden) —
    // a dock restore must always yield a VISIBLE window.
    if (getComputedStyle(this.el).display === 'none') this.el.style.display = 'block';
    saveParked(this.o.id, false); // F2 (G16): an explicit restore un-parks durably
    if (!this._applyingRemote) emitWindowLayout(this.o.id, { minimized: false });  // 0064
    this.el.style.transform = ''; this.el.style.opacity = '';
    if (this._slot) this._slot.restack();
    this.raise();
    try { this.o.onRestore && this.o.onRestore(); } catch (_) {}
  }

  restore() { if (!this._docked) Modals.restore(this.o.id); }

  /** True while this window is parked in the dock (modalManager's registry). */
  isMinimized() { return !this._docked && Modals.isMinimized(this.o.id); }

  /** True while this window is rendered docked into the gadget rail (0054 Phase 2). */
  isDocked() { return !!this._docked; }

  /** Show/hide the non-blocking refresh affordance (perf/resilience). A window opens
   *  immediately with its last-good/placeholder content; while a slow /state fill is in
   *  flight the body shows a thin top sliver and the titlebar a quiet "·refreshing" hint —
   *  the underlying content is NEVER hidden, so a reused last-good snapshot stays readable.
   *  Idempotent and safe before/after open() (it no-ops if the chrome isn't built yet). */
  setLoading(on) {
    if (!this.el) return;
    this.el.classList.toggle('ow-loading', !!on);
    const title = this.titlebar && this.titlebar.querySelector('.ow-title');
    if (!title) return;
    let hint = title.querySelector('.ow-load-hint');
    if (on && !hint) {
      hint = document.createElement('span');
      hint.className = 'ow-load-hint';
      hint.textContent = '· refreshing';
      hint.setAttribute('aria-live', 'polite');
      title.appendChild(hint);
    } else if (!on && hint) {
      hint.remove();
    }
  }

  /** Toggle docked↔floating: persist the flag, tear down, and re-open in the new
   *  mode. ONE position system (F5) — a mode change is a rebuild, never a live
   *  geometry mutation. A docked window registers no dock chip, so close() here
   *  just tears it down directly. */
  toggleDock() {
    if (!this.o.dockable) return;
    const next = !this._docked;
    saveDocked(this.o.id, next);
    if (!this._applyingRemote) emitWindowLayout(this.o.id, { docked: next });  // 0064
    const opener = this.opener;
    // A dock toggle is a RE-HOME, not a dismissal: suppress the consumer's onClose
    // (it resets the module's _win reference — which we keep, since it's the same
    // instance) and Modals.unregister so the re-open is clean. The _rehoming guard
    // makes _teardown skip onClose; we still abort listeners + drop the old node.
    this._rehoming = true;
    try {
      if (this._docked) this._teardown();
      else Modals.close(this.o.id);  // closeFn → _teardown() (guarded)
    } finally { this._rehoming = false; }
    this._docked = next;
    // Re-open immediately in the new mode (no fly animation — it's a re-home, not a
    // dismissal). A docked window self-gates visibility; a floated one raises.
    this.open(opener);
    try { this.o.onDock && this.o.onDock(next); } catch (_) {}
    return this;
  }

  close() {
    if (!this.el) return;
    // A docked window isn't in modalManager — tear it down directly (no chip, no
    // fly-to-dock: it lives in the rail flow).
    if (this._docked) { this._teardown(); return; }
    const finish = () => Modals.close(this.o.id);   // closeFn → _teardown()
    if (REDUCED()) { finish(); return; }
    // A7 [ruling #19]: scale+fade fly-away on close (the dedicated ow-close keyframe).
    this.el.classList.add('ow-anim-close');
    setTimeout(finish, 190);
  }

  _teardown() {
    const i = _stack.indexOf(this);
    if (i !== -1) _stack.splice(i, 1);
    _byId.delete(this.o.id);  // 0064: drop from the live registry
    saveParked(this.o.id, false); // F2 (G16): a closed window forgets its parked state
    this.ac.abort();
    const opener = this.opener;
    if (this.el) { this.el.remove(); this.el = null; }
    // A dock-toggle re-home keeps the same instance + the module's _win reference,
    // so skip the consumer's onClose reset and the focus-return (open() refocuses).
    if (this._rehoming) return;
    // 0064: a genuine close (not a dock re-home) syncs the closed state to other devices.
    if (!this._applyingRemote) emitWindowLayout(this.o.id, { open: false, minimized: false });
    try { this.o.onClose && this.o.onClose(); } catch (_) {}
    // audit F8: focus returns to the opener
    if (opener && opener.isConnected && typeof opener.focus === 'function') {
      try { opener.focus(); } catch (_) {}
    }
  }

  destroy() { this._teardown(); Modals.unregister(this.o.id); }
}

// Escape participation (audit F7): ui.js's single arbiter calls this between
// the menu stack and the modal pass. Top kit window parks (minimizable) or
// closes; returns true when it consumed the key.
export function dismissTop() {
  for (let i = _stack.length - 1; i >= 0; i--) {
    const w = _stack[i];
    if (!w.el || !w.el.isConnected || w.el.style.display === 'none') { _stack.splice(i, 1); continue; }
    if (w.o.minimizable) w.minimize(); else w.close();
    return true;
  }
  return false;
}

export function stackIds() { return _stack.map((w) => w.o.id); }

// ── viewport re-clamp on browser resize (DWE windowing tail) ───────────────
// The kit clamps on open/drag/resize, and the slot engine re-clamps every entry
// on its own 'resize' listener (post-#345). The remaining gap: a FLOATING/dragged
// kit window had no path to re-clamp when the BROWSER viewport shrinks, so it could
// strand partially off-screen until touched. ONE global, rAF-debounced listener
// over the open-window stack closes it — for every OPEN, un-minimized, non-docked
// window: re-anchor + clamp (slotted via restackSlot, floating via clampPos) and
// shrink any window now larger than the viewport to fit. Cheap (one frame coalesces
// a resize-drag burst, no per-window listeners to tear down) and it leaves docked
// windows (the rail owns them) and minimized ones (hidden) alone.
let _reclampRaf = 0;
function reclampOpenWindows() {
  _reclampRaf = 0;
  // Snapshot: _reclamp() may write styles that re-enter the slot observer; iterate
  // a copy so a concurrent splice (a window closing mid-pass) can't skip entries.
  for (const w of _stack.slice()) {
    try { w._reclamp(); } catch (_) {}
  }
}
function onViewportResize() {
  if (_reclampRaf) return;
  _reclampRaf = (window.requestAnimationFrame || ((fn) => setTimeout(fn, 120)))(reclampOpenWindows);
}
window.addEventListener('resize', onViewportResize);

// The .ow-* family is page-global chrome (the .ow-dismiss affordance is used by
// non-window surfaces that may render before any window exists) — inject at load.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", ensureCss, { once: true });
} else {
  ensureCss();
}

// The seam every consumer + the headless gate use.
window.OrwellWindowKit = {
  create: (opts) => new OrwellWindow(opts),
  dismissTop,
  stackIds,
};
