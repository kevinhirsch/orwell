// OrwellMenu / OrwellPopover — THE anchored-surface + action-menu kit (#1638 / KM-W10).
//
// The direct sibling of OrwellWindow (the floating-window kit) and OrwellSheet (the
// bottom-sheet kit). Where those own windows and sheets, this file owns the ~14 bespoke
// dropdown / menu / popover surfaces that each re-invent anchoring, dismissal, keyboard nav
// and a11y. It collapses all of that into ONE anchoring engine, ONE dismiss seat, ONE roving
// keyboard contract, and ONE a11y contract — exactly as OrwellWindow did for windows.
//
// It ships as ONE file exposing TWO layered seams on `window`:
//
//   • OrwellPopoverKit — the base ANCHORED-SURFACE primitive. Owns the single flip/shift
//     positioning engine (viewport-clamped, position:fixed), dismissal through the shared
//     escMenuStack seat (outside-click + the ui.js Escape arbiter, which drains menus FIRST),
//     optional focus-trap + focus-return, the z-layer, and teardown. Content is arbitrary
//     (Node | string | builder) — it serves the rich pickers (emoji / color / model / provider)
//     and info popovers. .open() / .closeAll() / .openCount().
//
//   • OrwellMenuKit — built ON OrwellPopover. Adds the declarative item model, real
//     role="menu"/"menuitem" + roving-tabindex keyboard nav (Up/Down/Home/End/typeahead/
//     Enter/Space/→←-for-submenus/Esc), separators, danger/disabled/checkbox items, submenus,
//     descriptions, a render() escape hatch, and aria-haspopup/aria-expanded wiring on the
//     trigger. It serves every true action menu. .open() / .attach() / .closeAll() / .openCount().
//
// OWNER RULING (#1638, 2026-07-15): menus stay ANCHORED on mobile — NO bottom-sheet reflow.
// The `sheetOnNarrow` option is accepted + documented but is a DEFERRED NO-OP: this kit anchors
// on EVERY viewport (the detent/sheet handoff to OrwellSheet may be wired later behind the flag,
// but it is OUT of Workflow-2 scope). The Ctrl+K command palette is EXCLUDED from this kit — it
// stays a centered modal, never an anchored menu.
//
// Vault-free by construction: the kit only paints chrome + tracks anchor geometry — it never
// touches game state. g15: it never fires the game-changed freshness event (the single dispatcher
// stays in platform.js); menus don't mutate game state, so there is nothing to broadcast.
//
// Read first: orwellWindow.js (kit shape, ensureCss, clamp, focus-return, AbortController),
// orwellSheet.js (the focus-trap), escMenuStack.js (bindMenuDismiss — the dismiss seat).

import { bindMenuDismiss } from './escMenuStack.js';
import { isNarrow } from './platform.js';

// One menu band, ABOVE the modal tier — a provider menu opened inside the Settings modal
// (z 1001) must sit above it; the Escape arbiter already dismisses menus before modals. This
// replaces the current z zoo (adm-provider 100 / msg-overflow 100 / ctx 250 / model-picker 300
// / dropdown 1000 / emoji 10000).
const Z_MENU = 1100;

const REDUCED = () =>
  !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

// ── the one CSS family (injected fallback) ─────────────────────────────────────────────
// Built by STRING CONCATENATION, never a backtick template (the notice-kit footgun the sheet
// kit documents). Literal fallbacks cover before style.css loads; the linked stylesheet carries
// the SAME rules in its `.ow-menu` region (kept in lock-step) so the 0052 house themes + the
// #738 light-glass fold paint the menus for free. Tokenized on the shared --win-* / --ow-*
// families the window/sheet kits consume — one visual language, no bespoke hexes.
function ensureCss() {
  if (document.getElementById('ow-menu-css')) return;
  var st = document.createElement('style');
  st.id = 'ow-menu-css';
  st.textContent =
    ':root { --ow-z-menu: ' + Z_MENU + '; }' +
    // ── the base anchored surface ─────────────────────────────────────────────────────
    '.ow-popover {' +
    '  position: fixed; z-index: var(--ow-z-menu, 1100);' +
    '  box-sizing: border-box; min-width: 180px; max-width: min(92vw, 360px);' +
    '  background: var(--win-bg, var(--panel, #111)); color: var(--fg, #9cdef2);' +
    '  border: 1px solid var(--win-border, var(--border, #355a66));' +
    '  border-radius: var(--ow-menu-radius, 10px);' +
    '  box-shadow: var(--win-shadow, 0 8px 32px rgba(0,0,0,.45));' +
    '  font-family: var(--ow-ui-font); font-size: var(--ow-fs-body, .875rem); line-height: 1.4;' +
    '  overflow: auto; overscroll-behavior: contain;' +
    '  animation: ow-menu-in .13s ease-out; }' +
    '.ow-popover:focus { outline: none; }' +
    '.ow-popover:focus-visible { outline: 2px solid var(--ow-ios-blue, #0a84ff); outline-offset: -2px; }' +
    '@keyframes ow-menu-in { from { opacity: 0; transform: scale(.97); } to { opacity: 1; transform: scale(1); } }' +
    // ── the role=menu list ────────────────────────────────────────────────────────────
    '.ow-menu { padding: 6px; display: flex; flex-direction: column; }' +
    '.ow-menu-item {' +
    '  display: flex; align-items: center; gap: .5rem; width: 100%;' +
    '  padding: 7px 10px; border-radius: 7px; box-sizing: border-box;' +
    '  background: none; border: none; color: inherit; font: inherit; text-align: left;' +
    '  cursor: pointer; white-space: nowrap; -webkit-user-select: none; user-select: none; }' +
    '.ow-menu-item:hover, .ow-menu-item.ow-active {' +
    '  background: color-mix(in srgb, var(--fg, #fff) 8%, transparent); }' +
    // the focus ring is the NEUTRAL iOS-blue — NEVER the theme red/accent (#729: glass chrome
    // carries no accent HUE).
    '.ow-menu-item.ow-active:focus-visible, .ow-menu-item:focus-visible {' +
    '  outline: 2px solid var(--ow-ios-blue, #0a84ff); outline-offset: -2px; }' +
    // disabled: dimmed + inert on EVERY path (never focusable, never selectable).
    '.ow-menu-item[aria-disabled="true"] { opacity: .4; cursor: default; pointer-events: none; }' +
    // destructive rows keep the sanctioned danger red (spec §3.2).
    '.ow-menu-item-danger { color: var(--red, #e06c75); }' +
    '.ow-menu-icon {' +
    '  flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;' +
    '  width: 1.15em; height: 1.15em; }' +
    '.ow-menu-icon svg { width: 100%; height: 100%; }' +
    '.ow-menu-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }' +
    '.ow-menu-item-sub { display: block; margin-top: 1px; font-size: .82em; opacity: .7; white-space: normal; }' +
    '.ow-menu-shortcut {' +
    '  flex: 0 0 auto; margin-left: 1.25rem; opacity: .55; font-size: .85em; font-variant-numeric: tabular-nums; }' +
    '.ow-menu-check { flex: 0 0 auto; width: 1.1em; text-align: center; }' +
    '.ow-menu-submenu-caret { flex: 0 0 auto; margin-left: auto; opacity: .6; }' +
    '.ow-menu-sep { height: 1px; margin: 5px 6px; background: color-mix(in srgb, var(--fg, #fff) 14%, transparent); }' +
    '.ow-menu-section {' +
    '  padding: 6px 10px 3px; font-size: .72rem; text-transform: uppercase; letter-spacing: .04em; opacity: .55; }' +
    // ── tap targets & motion ────────────────────────────────────────────────────────────
    // Coarse-pointer floor: 44px rows (WCAG 2.5.5 / HIG); shortcut hints hide on coarse. The
    // desktop density (~30px rows) is unchanged on fine pointers.
    '@media (pointer: coarse) { .ow-menu-item { min-height: 44px; } .ow-menu-shortcut { display: none; } }' +
    '@media (prefers-reduced-motion: reduce) { .ow-popover { animation: none; } }' +
    // ── glass / a11y tiers (the #738 item-5 fold, centralized) ──────────────────────────
    // Frosted: the surface rides the shared light-glass material so it is not a dark opaque box
    // in the light theme; the ink flips to the neutral chrome dark ink (#16191f).
    '@media (prefers-reduced-transparency: no-preference) {' +
    '  body.theme-frosted .ow-popover {' +
    '    background-color: var(--ow-glass-light-color, rgba(255,255,255,.6));' +
    '    -webkit-backdrop-filter: blur(18px) saturate(180%); backdrop-filter: blur(18px) saturate(180%);' +
    '    color: #16191f; } }' +
    // reduced-transparency → an opaque fill (no blur); prefers-contrast/forced-colors → a hard rim.
    '@media (prefers-reduced-transparency: reduce) {' +
    '  .ow-popover { -webkit-backdrop-filter: none !important; backdrop-filter: none !important;' +
    '    background: var(--win-bg, var(--panel, #111)) !important; } }' +
    '@media (prefers-contrast: more), (forced-colors: active) {' +
    '  .ow-popover { border-color: var(--fg) !important; border-width: 2px; } }';
  document.head.appendChild(st);
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// OrwellPopover — the base anchored surface.
// ─────────────────────────────────────────────────────────────────────────────────────────
const _openPopovers = new Set();

export class OrwellPopover {
  /**
   * opts: {
   *   id?, anchor (REQUIRED), content (Node|string|(popover)=>Node),
   *   placement='bottom' ('bottom'|'top'|'auto'), align='start' ('start'|'end'|'center'),
   *   offset=6, matchAnchorWidth=false, minWidth=180, maxWidth?, maxHeight?,
   *   focusTrap=false, returnFocus=true, sheetOnNarrow='auto' (DEFERRED no-op — see owner ruling),
   *   role='dialog' (OrwellMenu overrides to 'menu'), ariaLabel (REQUIRED when role='dialog'),
   *   className?, dismissOnScroll=true, onOpen?, onClose?, submenuOf? (parent .ow-popover el)
   * }
   */
  constructor(opts) {
    this.o = Object.assign({
      placement: 'bottom', align: 'start', offset: 6,
      matchAnchorWidth: false, minWidth: 180,
      focusTrap: false, returnFocus: true,
      // OWNER RULING (#1638): DEFERRED no-op — the kit anchors on every viewport (no sheet handoff).
      sheetOnNarrow: 'auto',
      role: 'dialog', dismissOnScroll: true,
    }, opts || {});
    if (!this.o.anchor) throw new Error('OrwellPopover needs an anchor');
    // RESOLVED design point: a dialog-role surface REQUIRES an accessible name.
    if (this.o.role === 'dialog' && !this.o.ariaLabel) {
      throw new Error('OrwellPopover role="dialog" requires an ariaLabel (accessible name)');
    }
    this.ac = new AbortController();
    this.el = null;
    this.opener = null;
    this._done = false;
    this._raf = 0;
    this._close = null;
    this._onViewport = () => this._reflow();
  }

  _build() {
    ensureCss();
    var el = document.createElement('div');
    el.className = 'ow-popover' + (this.o.className ? ' ' + this.o.className : '');
    el.setAttribute('data-ow-popover', '');
    // Ancestry link: a submenu surface is a body-level SIBLING of its parent surface, so the
    // parent's outside-click predicate must still treat it (and any deeper descendant) as "inside"
    // the parent boundary — otherwise clicking into a submenu dismisses the ancestor before the
    // child's selection handler runs. Store the parent surface so the predicate can walk up.
    if (this.o.submenuOf) el._owParentPopover = this.o.submenuOf;
    el.setAttribute('role', this.o.role);
    if (this.o.ariaLabel) el.setAttribute('aria-label', this.o.ariaLabel);
    // the surface is the spawn/focus target — tabindex=-1 keeps it OUT of the Tab order and
    // (:focus rule) ring-free on mount; a keyboard user reaches the items, not the frame.
    el.setAttribute('tabindex', '-1');
    var c = this.o.content;
    if (typeof c === 'function') { try { c = c(this); } catch (_) { c = null; } }
    if (c instanceof Node) el.appendChild(c);
    else if (typeof c === 'string') el.innerHTML = c;
    this.el = el;
    return el;
  }

  open(opener) {
    if (this.el && this.el.isConnected) return this;
    if (this.ac.signal.aborted) this.ac = new AbortController();
    this._done = false;
    this.opener = opener || this.o.anchor || document.activeElement || null;
    var self = this;
    var el = this.el || this._build();
    // Mount hidden/off-screen so the natural size can be measured before placing (the
    // sessions.js:644 pattern).
    el.style.visibility = 'hidden';
    el.style.left = '-9999px';
    el.style.top = '0px';
    document.body.appendChild(el);
    // ONE dismiss seat: escMenuStack wires BOTH the deferred outside-click listener AND the
    // Escape-stack entry in one call, and stashes the idempotent close() on el._dismiss so bulk
    // removers cooperate. The isOutside predicate treats the ANCHOR as "inside" so the trigger's
    // own click toggles rather than double-fires. NO consumer writes its own document click
    // listener for dismissal again.
    // "inside" is ancestry-aware: the clicked surface counts as inside when it IS this surface or
    // descends from it through the _owParentPopover chain (a body-level submenu of this surface, or
    // a deeper nested submenu). Without this, a click into a descendant submenu satisfies the
    // ancestor's outside-click predicate and closes it before the child's handler runs.
    function isWithinPopoverTree(target) {
      var surface = target && target.closest ? target.closest('[data-ow-popover]') : null;
      while (surface) {
        if (surface === el) return true;
        surface = surface._owParentPopover || null;
      }
      return false;
    }
    this._close = bindMenuDismiss(el, function () { self._teardown('dismiss'); }, function (ev) {
      return !isWithinPopoverTree(ev.target) && !(self.o.anchor && self.o.anchor.contains(ev.target));
    });
    this.reposition();
    el.style.visibility = '';
    _openPopovers.add(this);
    if (this.o.focusTrap) this._trapFocus();
    try { el.focus({ preventScroll: true }); } catch (_) {}
    // Re-run positioning on resize/scroll (rAF-debounced); dismissOnScroll closes instead when
    // the anchor scrolls out of the viewport.
    window.addEventListener('resize', this._onViewport, { signal: this.ac.signal });
    window.addEventListener('scroll', this._onViewport, { capture: true, passive: true, signal: this.ac.signal });
    if (typeof this.o.onOpen === 'function') { try { this.o.onOpen(this); } catch (_) {} }
    return this;
  }

  // ── the SINGLE flip/shift positioning engine (replaces every bespoke variant) ──────────
  reposition() {
    var el = this.el, anchor = this.o.anchor;
    if (!el || !anchor || !anchor.isConnected) return this;
    // A submenu places to the SIDE of its parent surface (the same clamp philosophy, cross-axis
    // horizontal) rather than below its row.
    if (this.o.submenuOf && this.o.submenuOf.isConnected) return this._repositionSubmenu();
    var vw = window.innerWidth, vh = window.innerHeight, m = 8;
    var a = anchor.getBoundingClientRect();
    if (this.o.matchAnchorWidth) el.style.width = a.width + 'px';
    if (this.o.minWidth) el.style.minWidth = this.o.minWidth + 'px';
    if (this.o.maxWidth) el.style.maxWidth = this.o.maxWidth + 'px';
    el.style.maxHeight = '';                                   // reset to measure natural size
    var r = el.getBoundingClientRect();
    var w = r.width, h = r.height, off = this.o.offset;
    // 1. main axis (placement): try the preferred side; FLIP to the opposite when it overflows
    //    that edge AND the opposite side has more room. 'auto' picks the side with more room.
    var below = vh - a.bottom - off - m;
    var above = a.top - off - m;
    var side;
    if (this.o.placement === 'top') side = (above >= h || above >= below) ? 'top' : 'bottom';
    else if (this.o.placement === 'auto') side = (below >= above) ? 'bottom' : 'top';
    else side = (below >= h || below >= above) ? 'bottom' : 'top';
    var avail = side === 'top' ? above : below;
    // honor the documented maxHeight option: the effective cap is the SMALLER of the available
    // viewport space and the caller's maxHeight (viewport-fitting otherwise unchanged).
    if (this.o.maxHeight) avail = Math.min(avail, this.o.maxHeight);
    // 2. fit: cap max-height to the available space; the body scrolls internally (never run off
    //    the bottom — the emoji-picker height-cap generalized).
    if (h > avail) {
      el.style.maxHeight = Math.max(80, avail) + 'px';
      r = el.getBoundingClientRect(); h = r.height;
    }
    var top = side === 'top' ? (a.top - off - h) : (a.bottom + off);
    // 3. cross axis (align): start→leading edge, end→trailing edge, center→centered; then SHIFT
    //    the whole surface inward so it never crosses the viewport margin.
    var left;
    if (this.o.align === 'end') left = a.right - w;
    else if (this.o.align === 'center') left = a.left + (a.width - w) / 2;
    else left = a.left;
    left = Math.max(m, Math.min(left, vw - w - m));
    top = Math.max(m, Math.min(top, vh - h - m));
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
    el.dataset.owPlacement = side;
    return this;
  }

  _repositionSubmenu() {
    var el = this.el, parent = this.o.submenuOf, row = this.o.anchor;
    var vw = window.innerWidth, vh = window.innerHeight, m = 8;
    el.style.maxHeight = '';
    if (this.o.minWidth) el.style.minWidth = this.o.minWidth + 'px';
    var p = parent.getBoundingClientRect();
    var a = row.getBoundingClientRect();
    var r = el.getBoundingClientRect();
    var w = r.width, h = r.height;
    // prefer the right of the parent surface; flip to the left when it would overflow.
    var left = p.right - 2;
    if (left + w > vw - m && (p.left - w) >= m) left = p.left - w + 2;
    var top = a.top - 6;
    if (h > vh - 2 * m) { el.style.maxHeight = (vh - 2 * m) + 'px'; r = el.getBoundingClientRect(); h = r.height; }
    left = Math.max(m, Math.min(left, vw - w - m));
    top = Math.max(m, Math.min(top, vh - h - m));
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
    el.dataset.owPlacement = 'submenu';
    return this;
  }

  // dismissOnScroll policy (single + clear): reposition-in-view on every scroll/resize; CLOSE
  // when the anchor leaves the viewport.
  _reflow() {
    if (this._raf) return;
    var self = this;
    this._raf = (window.requestAnimationFrame || function (fn) { return setTimeout(fn, 60); })(function () {
      self._raf = 0;
      if (!self.el || !self.el.isConnected) return;
      var anchor = self.o.anchor;
      if (self.o.dismissOnScroll && anchor && (!anchor.isConnected || self._anchorOffscreen(anchor))) {
        self._teardown('scroll');
        return;
      }
      self.reposition();
    });
  }

  _anchorOffscreen(anchor) {
    var a = anchor.getBoundingClientRect();
    return a.bottom < 0 || a.top > window.innerHeight || a.right < 0 || a.left > window.innerWidth;
  }

  _trapFocus() {
    var self = this;
    this.el.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var all = self.el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      var f = Array.prototype.filter.call(all, function (n) {
        return !n.disabled && (n.offsetParent !== null || n === document.activeElement);
      });
      if (!f.length) { e.preventDefault(); return; }
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }, { signal: this.ac.signal });
  }

  _returnFocus() {
    var opener = this.opener;
    if (typeof window._owReturnFocus === 'function') {
      try { window._owReturnFocus(opener, document.body); return; } catch (_) {}
    }
    if (opener && opener.isConnected && typeof opener.focus === 'function') {
      try { opener.focus(); } catch (_) {}
    }
  }

  _teardown(reason) {
    if (this._done) return;
    this._done = true;
    var el = this.el;
    _openPopovers.delete(this);
    // release the escMenuStack seat + the deferred outside-click listener (idempotent).
    try { if (typeof this._close === 'function') this._close(); } catch (_) {}
    try { this.ac.abort(); } catch (_) {}
    try { if (el && el.isConnected) el.remove(); } catch (_) {}
    if (this.o.returnFocus) this._returnFocus();
    if (typeof this.o.onClose === 'function') { try { this.o.onClose(reason); } catch (_) {} }
  }

  close(reason) { this._teardown(reason || 'api'); return this; }
  isOpen() { return !!(this.el && this.el.isConnected && !this._done); }

  setContent(content) {
    if (!this.el) return this;
    this.el.innerHTML = '';
    if (typeof content === 'function') { try { content = content(this); } catch (_) { content = null; } }
    if (content instanceof Node) this.el.appendChild(content);
    else if (typeof content === 'string') this.el.innerHTML = content;
    this.reposition();
    return this;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// OrwellMenu — the action-menu layer (built ON OrwellPopover).
// ─────────────────────────────────────────────────────────────────────────────────────────
const _openMenus = new Set();

export class OrwellMenu {
  /**
   * opts: {
   *   anchor (REQUIRED trigger — also gets aria-haspopup='menu' + aria-expanded),
   *   items (REQUIRED — array | () => array; re-evaluated each open),
   *   placement, align, offset, matchAnchorWidth, minWidth, className, sheetOnNarrow,
   *   ariaLabel, role='menu', onSelect(item, ev)?, onOpen?, onClose?,
   *   submenuOf? / _parentRow? (internal, for a cascading submenu)
   * }
   *
   * item model (flat array — the kit renders + wires each):
   *   { id?, label, icon?, onSelect(item, ev)?, danger?, disabled?, checked?, shortcut?,
   *     submenu?: () => items[], keepOpen?, description?, render?: (rowEl, item) => void }
   *   { separator: true }                 → .ow-menu-sep
   *   { label: 'Section', header: true }  → .ow-menu-section  (non-interactive; `section` also ok)
   */
  constructor(opts) {
    this.o = Object.assign({ placement: 'bottom', align: 'start', offset: 6, role: 'menu' }, opts || {});
    if (!this.o.anchor) throw new Error('OrwellMenu needs an anchor');
    if (!this.o.items) throw new Error('OrwellMenu needs items');
    this.pop = null;
    this.parent = this.o.parent || null;      // set when THIS is a submenu
    this._items = [];                          // [{ item, el, enabled, label }]
    this._active = -1;
    this._typeBuf = '';
    this._typeAt = 0;
    this._submenu = null;                      // the open child submenu, if any
    this.ac = new AbortController();
  }

  _resolveItems(src) {
    var items = (typeof src === 'function') ? src() : src;
    return Array.isArray(items) ? items : [];
  }

  _buildList() {
    var self = this;
    var list = document.createElement('div');
    list.className = 'ow-menu';
    this._items = [];
    this._resolveItems(this.o.items).forEach(function (it) {
      if (!it) return;
      if (it.separator) {
        var sep = document.createElement('div');
        sep.className = 'ow-menu-sep';
        sep.setAttribute('role', 'separator');
        list.appendChild(sep);
        return;
      }
      if (it.header || it.section) {
        var h = document.createElement('div');
        h.className = 'ow-menu-section';
        h.setAttribute('role', 'presentation');
        h.textContent = it.label || '';
        list.appendChild(h);
        return;
      }
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'ow-menu-item' + (it.danger ? ' ow-menu-item-danger' : '');
      var disabled = !!it.disabled;
      var hasCheck = (it.checked !== undefined && it.checked !== null);
      // real menu semantics: role=menuitem (or menuitemcheckbox when `checked` is defined).
      row.setAttribute('role', hasCheck ? 'menuitemcheckbox' : 'menuitem');
      row.setAttribute('aria-disabled', disabled ? 'true' : 'false');
      row.setAttribute('tabindex', '-1');
      if (hasCheck) row.setAttribute('aria-checked', it.checked ? 'true' : 'false');
      if (it.submenu) { row.setAttribute('aria-haspopup', 'menu'); row.setAttribute('aria-expanded', 'false'); }

      if (typeof it.render === 'function') {
        // ESCAPE HATCH: custom row content (the sort menu's Tidy row, logo rows). The row stays a
        // real menuitem — keyboard + aria + wiring below still apply.
        try { it.render(row, it); } catch (_) {}
      } else {
        if (hasCheck) {
          var ck = document.createElement('span');
          ck.className = 'ow-menu-check';
          ck.setAttribute('aria-hidden', 'true');
          ck.textContent = it.checked ? '✓' : '';
          row.appendChild(ck);
        }
        if (it.icon) {
          var ic = document.createElement('span');
          ic.className = 'ow-menu-icon';
          ic.setAttribute('aria-hidden', 'true');
          if (it.icon instanceof Node) ic.appendChild(it.icon);
          else ic.innerHTML = String(it.icon);
          row.appendChild(ic);
        }
        var lab = document.createElement('span');
        lab.className = 'ow-menu-label';
        lab.textContent = it.label || '';
        if (it.description) {
          var sub = document.createElement('span');
          sub.className = 'ow-menu-item-sub';
          sub.textContent = it.description;
          lab.appendChild(sub);
        }
        row.appendChild(lab);
        if (it.shortcut) {
          var sc = document.createElement('span');
          sc.className = 'ow-menu-shortcut';
          sc.setAttribute('aria-hidden', 'true');
          sc.textContent = it.shortcut;
          row.appendChild(sc);
        }
        if (it.submenu) {
          var ca = document.createElement('span');
          ca.className = 'ow-menu-submenu-caret';
          ca.setAttribute('aria-hidden', 'true');
          ca.textContent = '›';                          // ›
          row.appendChild(ca);
        }
      }

      var rec = { item: it, el: row, enabled: !disabled, label: (it.label || '').toLowerCase() };
      self._items.push(rec);
      // Wiring — a disabled item is INERT on every path (pointer + keyboard + typeahead): the CSS
      // pointer-events:none blocks pointer entirely; these guards belt the keyboard/programmatic paths.
      row.addEventListener('click', function (ev) {
        ev.preventDefault();
        if (rec.enabled === false) return;
        if (it.submenu) { self._openSubmenu(rec); return; }
        self._activate(rec, ev);
      }, { signal: self.ac.signal });
      row.addEventListener('mousemove', function () {
        if (rec.enabled === false) return;
        self._moveTo(self._items.indexOf(rec), false);
      }, { signal: self.ac.signal });
      list.appendChild(row);
    });
    return list;
  }

  open(opener) {
    // Idempotent: a second open() while already open must not orphan the live popover.
    if (this.isOpen()) return this;
    // A prior close() aborted this.ac; the row listeners (_buildList) and the keyboard listener
    // below both bind on this.ac.signal, so a reopen MUST attach them on a FRESH controller or
    // they silently never bind. Reset it before any listener wiring.
    if (this.ac.signal.aborted) this.ac = new AbortController();
    var self = this;
    var anchor = this.o.anchor;
    var list = this._buildList();
    // trigger a11y: aria-haspopup + aria-expanded toggled automatically.
    if (anchor) { anchor.setAttribute('aria-haspopup', 'menu'); anchor.setAttribute('aria-expanded', 'true'); }
    this.pop = new OrwellPopover({
      id: this.o.id,
      anchor: anchor,
      content: list,
      role: this.o.role,                  // 'menu'
      ariaLabel: this.o.ariaLabel || 'Menu',
      placement: this.o.placement, align: this.o.align, offset: this.o.offset,
      matchAnchorWidth: this.o.matchAnchorWidth, minWidth: this.o.minWidth, className: this.o.className,
      submenuOf: this.o.submenuOf,
      focusTrap: false,                   // menus manage focus via roving; Tab closes (APG menu-button)
      returnFocus: true,
      dismissOnScroll: this.o.dismissOnScroll !== undefined ? this.o.dismissOnScroll : true,
      onClose: function (reason) { self._onPopClose(reason); },
    });
    var el = this.pop._build();
    el.setAttribute('aria-orientation', 'vertical');
    el.addEventListener('keydown', function (e) { self._onKeydown(e); }, { signal: this.ac.signal });
    this.pop.open(opener || anchor);
    _openMenus.add(this);
    // roving init: the surface holds focus; the first ENABLED item takes tabindex=0 (all others
    // -1). Nothing is focused yet — the first ArrowDown lands on the first enabled item.
    this._initRoving();
    if (typeof this.o.onOpen === 'function') { try { this.o.onOpen(this); } catch (_) {} }
    return this;
  }

  _initRoving() {
    var first = this._firstEnabled();
    this._items.forEach(function (rec, idx) { rec.el.setAttribute('tabindex', idx === first ? '0' : '-1'); });
    this._active = -1;
  }

  _firstEnabled() { for (var i = 0; i < this._items.length; i++) if (this._items[i].enabled) return i; return -1; }
  _lastEnabled() { for (var i = this._items.length - 1; i >= 0; i--) if (this._items[i].enabled) return i; return -1; }

  _move(dir) {
    var n = this._items.length; if (!n) return;
    if (this._active < 0) { this._moveTo(dir > 0 ? this._firstEnabled() : this._lastEnabled()); return; }
    var i = this._active;
    for (var step = 0; step < n; step++) {
      i = (i + dir + n) % n;
      if (this._items[i].enabled) { this._moveTo(i); return; }
    }
  }

  _moveTo(i, focus) {
    if (i < 0 || !this._items[i] || !this._items[i].enabled) return;
    this._items.forEach(function (rec, idx) {
      rec.el.setAttribute('tabindex', idx === i ? '0' : '-1');
      rec.el.classList.toggle('ow-active', idx === i);
    });
    this._active = i;
    if (focus !== false) { try { this._items[i].el.focus(); } catch (_) {} }
  }

  _typeahead(ch) {
    var now = Date.now();
    if (now - this._typeAt > 500) this._typeBuf = '';        // reset after the idle window
    this._typeAt = now;
    this._typeBuf += ch.toLowerCase();
    var n = this._items.length;
    var start = this._active < 0 ? -1 : this._active;
    for (var off = 1; off <= n; off++) {
      var i = (start + off + n) % n;
      var rec = this._items[i];
      if (rec.enabled && rec.label.indexOf(this._typeBuf) === 0) { this._moveTo(i); return; }
    }
  }

  _activate(rec, ev) {
    var it = rec.item;
    var stayOpen = !!it.keepOpen;
    if (typeof it.onSelect === 'function') {
      try { if (it.onSelect(it, ev) === false) stayOpen = true; } catch (_) {}
    }
    if (typeof this.o.onSelect === 'function') { try { this.o.onSelect(it, ev); } catch (_) {} }
    if (stayOpen) {
      // P1-A (#1656): a kept-open checkbox/toggle row whose onSelect just mutated `it.checked` would
      // otherwise keep its STALE aria-checked + ✓ indicator until the menu is closed and reopened.
      // Read the item's current checked state BACK and reflect it onto THIS row now. A non-checkbox
      // kept-open row (no menuitemcheckbox role) is untouched.
      this._syncCheckState(rec);
      return;
    }
    // P1-B (#1656): a terminal selection inside a submenu must collapse the ENTIRE menu tree, not
    // just the child surface — otherwise the ancestor menu(s) stay open and the root trigger keeps
    // aria-expanded="true". Close self, then every ancestor via the `parent` linkage _openSubmenu
    // records. (A top-level menu has no parent, so this closes only itself — unchanged behavior.)
    this._closeTree('select');
  }

  // Re-sync a checkbox row's DOM (aria-checked + the ✓ indicator) to the item's current `checked`.
  // Inert for a non-checkbox row (built without the menuitemcheckbox role).
  _syncCheckState(rec) {
    var row = rec && rec.el;
    if (!row || row.getAttribute('role') !== 'menuitemcheckbox') return;
    var on = !!rec.item.checked;
    row.setAttribute('aria-checked', on ? 'true' : 'false');
    var ck = row.querySelector('.ow-menu-check');
    if (ck) ck.textContent = on ? '✓' : '';
  }

  // Collapse this menu and its whole ancestor chain (child-first, capturing each parent BEFORE the
  // close so the cascade's _submenu bookkeeping stays consistent). Used only on a terminal select;
  // kept-open items never reach here, so keepOpen still leaves the tree standing.
  _closeTree(reason) {
    var node = this, guard = 0;
    while (node && guard++ < 64) {
      var up = node.parent;
      try { node.close(reason); } catch (_) {}
      node = up;
    }
  }

  _openSubmenu(rec) {
    if (this._submenu) { try { this._submenu.close('reopen'); } catch (_) {} this._submenu = null; }
    var self = this;
    rec.el.setAttribute('aria-expanded', 'true');
    var child = new OrwellMenu({
      anchor: rec.el,
      items: rec.item.submenu,
      submenuOf: this.pop && this.pop.el,       // place to the SIDE of this surface
      ariaLabel: rec.item.label || 'Submenu',
      minWidth: this.o.minWidth,
      onSelect: this.o.onSelect,
      parent: this,
      onClose: function () {
        try { rec.el.setAttribute('aria-expanded', 'false'); } catch (_) {}
        if (self._submenu === child) self._submenu = null;
      },
    });
    this._submenu = child;
    child.open(rec.el);
  }

  _onKeydown(e) {
    var k = e.key;
    if (k === 'ArrowDown') { e.preventDefault(); this._move(1); }
    else if (k === 'ArrowUp') { e.preventDefault(); this._move(-1); }
    else if (k === 'Home') { e.preventDefault(); this._moveTo(this._firstEnabled()); }
    else if (k === 'End') { e.preventDefault(); this._moveTo(this._lastEnabled()); }
    else if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
      e.preventDefault();
      var rec = this._items[this._active];
      if (rec && rec.enabled) { if (rec.item.submenu) this._openSubmenu(rec); else this._activate(rec, e); }
    }
    else if (k === 'ArrowRight') {
      var r2 = this._items[this._active];
      if (r2 && r2.enabled && r2.item.submenu) { e.preventDefault(); this._openSubmenu(r2); }
    }
    else if (k === 'ArrowLeft') {
      // ← closes a submenu and returns to its parent row; at the top level it is a no-op.
      if (this.parent) { e.preventDefault(); e.stopPropagation(); this.close('left'); }
    }
    else if (k === 'Tab') {
      // Tab closes the menu and lets focus proceed (ARIA APG menu-button pattern).
      this.close('tab');
    }
    // Escape is NOT handled here — it is routed through the escMenuStack seat: the ui.js arbiter
    // calls dismissTopMenu() FIRST, popping the top menu (a submenu before its parent) and
    // returning focus to the opener. Handling it here would race the arbiter.
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      this._typeahead(k);
    }
  }

  _onPopClose(reason) {
    if (this._submenu) { try { this._submenu.close('parent'); } catch (_) {} this._submenu = null; }
    var anchor = this.o.anchor;
    if (anchor && !this.o.submenuOf) anchor.setAttribute('aria-expanded', 'false');
    _openMenus.delete(this);
    try { this.ac.abort(); } catch (_) {}
    if (typeof this.o.onClose === 'function') { try { this.o.onClose(reason); } catch (_) {} }
  }

  close(reason) { if (this.pop) this.pop.close(reason || 'api'); return this; }
  isOpen() { return !!(this.pop && this.pop.isOpen()); }
  get el() { return this.pop && this.pop.el; }
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// The two seams every consumer + the headless gate use (mirror OrwellWindowKit / OrwellSheetKit).
// ─────────────────────────────────────────────────────────────────────────────────────────
window.OrwellPopoverKit = {
  open: function (opts) { return new OrwellPopover(opts).open(); },
  closeAll: function () { Array.from(_openPopovers).forEach(function (p) { try { p.close('closeAll'); } catch (_) {} }); },
  openCount: function () { return _openPopovers.size; },
  Popover: OrwellPopover,
  isNarrow: isNarrow,      // exposed for consumers; the sheet handoff itself is a DEFERRED no-op
};

window.OrwellMenuKit = {
  open: function (opts) { return new OrwellMenu(opts).open(); },
  // attach(trigger, buildItems, opts?) — wire the trigger's click to open/close a menu, keeping
  // aria-expanded/aria-haspopup in sync. buildItems may be a static array OR a () => items[] fn
  // re-evaluated on each open (session/model menus rebuild).
  attach: function (trigger, buildItems, opts) {
    if (!trigger) throw new Error('OrwellMenuKit.attach needs a trigger element');
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    var current = null;
    var userOnClose = opts && opts.onClose;
    function isOpen() { return !!(current && current.isOpen()); }
    function openMenu() {
      // Idempotent: a repeated open() returns the live menu instead of orphaning it behind a
      // second controller.
      if (isOpen()) return current;
      var menu = new OrwellMenu(Object.assign({}, opts || {}, {
        anchor: trigger,
        items: buildItems,
        // COMPOSE the internal cleanup with the caller's onClose so BOTH run on close (the merged
        // object's onClose would otherwise silently replace the caller's callback).
        onClose: function (reason) {
          if (current === menu) current = null;
          if (typeof userOnClose === 'function') userOnClose(reason);
        },
      }));
      menu.open(trigger);
      current = menu;
      return current;
    }
    trigger.addEventListener('click', function (e) {
      e.preventDefault();
      if (isOpen()) { current.close('toggle'); current = null; }
      else openMenu();
    });
    return { open: openMenu, close: function () { if (current) { current.close('api'); current = null; } }, isOpen: isOpen };
  },
  closeAll: function () { Array.from(_openMenus).forEach(function (m) { try { m.close('closeAll'); } catch (_) {} }); },
  openCount: function () { return _openMenus.size; },
  Menu: OrwellMenu,
};

// Inject the CSS at load (the .ow-menu / .ow-popover family is page-global chrome, like the
// sibling kits) so a surface can open before style.css finishes loading.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ensureCss, { once: true });
} else {
  ensureCss();
}
