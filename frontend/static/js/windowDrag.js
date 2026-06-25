// Shared window-drag helper. Replaces the duplicated mousedown / mousemove
// / mouseup + snap-to-top fullscreen + left/right edge dock patterns that
// were copy-pasted across calendar.js, tasks.js, gallery.js, emailLibrary.js,
// documentLibrary.js, theme.js. Behavior stays identical to the old per-file
// copies — each callsite provides its own enter/exit-fullscreen callbacks
// since the CSS class + inline styles differ per modal.
//
// API:
//   makeWindowDraggable(modal, { content, header, ...options })
//     modal:           the wrapping .modal element (or a standalone pane)
//     content:         the element being moved (usually .modal-content)
//     header:          the drag handle (usually .modal-header)
//     fsClass:         optional class name representing "fullscreen" state
//     onEnterFullscreen: optional () => void — called when cursor releases
//                        near the top edge (within SNAP_PX). Caller is
//                        responsible for adding fsClass + applying inline
//                        styles that produce the fullscreen layout.
//     onExitFullscreen:  optional (cx, cy) => void — called mid-drag when
//                        the cursor leaves the fullscreen "unsnap" band
//                        (down > UNSNAP_PX OR near either horizontal edge
//                        in dock-snap range). Caller restores windowed
//                        inline styles centered around the cursor.
//     skipSelector:    CSS selector for elements inside `header` whose
//                        clicks should NOT start a drag (close button,
//                        form fields, etc). Default: 'button, input, select'
//     onDragEnd:       optional (state) => void — fires after mouseup
//                        WHEN no snap was committed. state = { rect } so
//                        callers can persist the final position.
//     enableTouch:     bool — also wire touchstart/touchmove/touchend
//                        with the same drag (no fs/dock on touch). Default
//                        true on desktop, irrelevant on mobile (mobileSkip).
//     mobileSkip:      drag is disabled below this viewport width.
//                        Default 768. Set to 0 to never skip.
//     enableDock:      DEPRECATED / no-op (#794 follow-up). The left/right
//                        edge-snap dock that this once toggled is RETIRED — a
//                        drag never docks a window to a side edge anymore. The
//                        option is still accepted (callers may pass it) but has
//                        no effect; windows always drag freely.
//     enableFullscreen: bool — enable top-edge fullscreen snap.
//                        Default true when onEnterFullscreen is supplied.

import { clearRightDock } from './modalSnap.js';
import { makeWindowResizable } from './windowResize.js';

// Registry of content elements that have been manually positioned (dragged).
// On every viewport resize we clamp them back inside the visible area so
// a window the player moved to the corner doesn't fall off-screen when the
// browser is resized smaller.
const _draggedElements = new Set();

function _clampToViewport(el) {
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let changed = false;
  let left = parseFloat(el.style.left) || r.left;
  let top = parseFloat(el.style.top) || r.top;
  const w = r.width || 200;
  const h = r.height || 100;
  if (left + w > vw) { left = Math.max(0, vw - w); changed = true; }
  if (top + h > vh) { top = Math.max(0, vh - h); changed = true; }
  if (left < 0) { left = 0; changed = true; }
  if (top < 0) { top = 0; changed = true; }
  if (changed) { el.style.left = left + 'px'; el.style.top = top + 'px'; }
}

let _resizeTimer = null;
window.addEventListener('resize', () => {
  // Debounce so we only clamp once the resize gesture settles.
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    for (const el of _draggedElements) {
      // Only clamp if the element is fixed-positioned (i.e. has been dragged).
      if (el.isConnected && getComputedStyle(el).position === 'fixed') {
        _clampToViewport(el);
      } else if (!el.isConnected) {
        _draggedElements.delete(el);
      }
    }
  }, 120);
});

const SNAP_PX = 6;        // cursor distance from top edge for fullscreen snap
const UNSNAP_PX = 24;     // cursor distance from top before fullscreen exits
// #794 follow-up: DOCK_EDGE_PX + _leftNavWidth() (the left/right edge-snap
// geometry) were removed along with the retired edge-snap dock. The only snap
// gesture left is the top-edge fullscreen one (SNAP_PX / UNSNAP_PX above).

export function makeWindowDraggable(modal, options = {}) {
  const content = options.content;
  const header = options.header;
  if (!content || !header) return;
  const fsClass = options.fsClass || null;
  const onEnterFullscreen = options.onEnterFullscreen || null;
  const onExitFullscreen = options.onExitFullscreen || null;
  const enableFullscreen = options.enableFullscreen !== false && !!onEnterFullscreen;
  const onDragEnd = options.onDragEnd || null;
  const onDragStart = options.onDragStart || null;
  const skipSelector = options.skipSelector || 'button, input, select';
  const mobileSkip = (typeof options.mobileSkip === 'number') ? options.mobileSkip : 768;
  const enableTouch = options.enableTouch !== false;
  // options.enableDock is accepted for back-compat but is a no-op now (#794
  // follow-up) — the left/right edge-snap dock is retired, so we never read it.

  // R2 (audit resp-F4): below the mobileSkip tier the drag is disabled (the mousedown/touchstart
  // handlers early-return), so don't paint an INLINE cursor:move — it would beat the responsive CSS
  // and lie on touch. Leave the cursor to CSS there (the kit sets it to default ≤768). Desktop keeps
  // the inline move cursor exactly as before.
  if (!(mobileSkip > 0 && window.innerWidth <= mobileSkip)) header.style.cursor = 'move';
  header.style.userSelect = 'none';

  // Edge/corner resize. Every draggable window also becomes resizable — the
  // same gesture a native desktop window uses (grab an edge or corner, drag).
  // Skipped on mobile (windows are full-screen sheets there) and while the
  // window is fullscreen-snapped or docked. Wired here so all ~12 callsites
  // get it without per-file changes.
  if (options.enableResize !== false) {
    const _dockClasses = ['modal-right-docked', 'modal-left-docked'];
    makeWindowResizable(content, {
      modal,
      mobileSkip,
      minWidth: options.minWidth,
      minHeight: options.minHeight,
      isLocked: () => (fsClass && modal && modal.classList.contains(fsClass))
        || (modal && _dockClasses.some((c) => modal.classList.contains(c))),
      storageKey: options.resizeStorageKey
        || (modal && modal.id ? 'winsize-' + modal.id
          : (content.id ? 'winsize-' + content.id : null)),
    });
  }

  // #794 follow-up (owner-approved): the left/right EDGE-SNAP dock is RETIRED for
  // free dragging. It hijacked a drag at release — dropping a window with the
  // cursor within 60px of a side edge force-re-anchored it into a full-height
  // docked side panel (pos:fixed, pinned to the edge, body pushed), so the window
  // did NOT stay where the user dropped it, and the dock was sticky (un-dock
  // needed an 80px pull-away). That fought the basic expectation: "pull a window
  // in any direction and drop it where you let go." Owner ruling (verbatim
  // intent): "I don't actually need the snapping if it's a problem — we could
  // probably drop the whole thing." So a drag NEVER arms an edge-dock controller
  // now (makeEdgeDockController is no longer called from this drag path): every
  // window drags freely and stays exactly where released (still viewport-clamped
  // on resize, never re-anchored). The top-edge FULLSCREEN snap (a separate
  // gesture, opt-in via onEnterFullscreen) is untouched.
  //
  // modalSnap.js stays imported only for the NON-drag dock flows other modules
  // drive directly (modalManager minimize/restore: suspendDock/resumeDock;
  // remembered-dock-on-open: applyEdgeDock) plus clearRightDock, which _startDrag
  // uses to gracefully peel a remembered-docked window back to free-floating when
  // it is grabbed. None of those CREATE a dock from a drag, so the interference
  // is gone while minimize/restore keep working.

  // Per-drag state, reset on mousedown.
  let dragging = false;
  let startX = 0, startY = 0;
  let startLeft = 0, startTop = 0;
  let snapHint = null;
  // Whether the pointer actually moved beyond a small threshold this drag.
  // Used to suppress the synthetic click the browser fires on mouseup —
  // header click handlers (e.g. "collapse expanded card / back to list")
  // would otherwise fire after a drag and collapse the modal contents.
  let movedDuringDrag = false;
  const MOVE_THRESHOLD = 4;

  const _showSnapHint = (on) => {
    // Top-edge fullscreen hint. Side hints come from the dock controllers.
    if (!on) {
      if (snapHint) { snapHint.remove(); snapHint = null; }
      return;
    }
    if (snapHint) return;
    snapHint = document.createElement('div');
    snapHint.className = 'modal-snap-hint';
    snapHint.style.cssText =
      'position:fixed;left:0;top:0;right:0;bottom:0;' +
      'background:color-mix(in srgb, var(--accent-primary, #60a5fa) 12%, transparent);' +
      'border:2px dashed color-mix(in srgb, var(--accent-primary, #60a5fa) 60%, transparent);' +
      'z-index:9998;pointer-events:none;';
    document.body.appendChild(snapHint);
  };

  const _enterFs = () => {
    if (!onEnterFullscreen) return;
    if (fsClass && modal && modal.classList.contains(fsClass)) return;
    onEnterFullscreen();
  };
  const _exitFs = (cx, cy) => {
    if (!onExitFullscreen) return;
    if (fsClass && modal && !modal.classList.contains(fsClass)) return;
    onExitFullscreen(cx, cy);
    // After exit, re-anchor the drag offsets to the new windowed rect so
    // the drag continues smoothly from the cursor's position.
    const r = content.getBoundingClientRect();
    startX = cx; startY = cy;
    startLeft = r.left; startTop = r.top;
  };

  const _isFullscreen = () => fsClass && modal && modal.classList.contains(fsClass);

  const _startDrag = (cx, cy) => {
    dragging = true;
    _draggedElements.add(content);
    if (modal) modal.classList.add('modal-dragging');
    // #794 follow-up: with drag-time edge-snap retired, the ONLY way a window can
    // still carry a dock class is a NON-drag path (modalManager's remembered-dock
    // on open / restore). If the user grabs such a docked window, peel it back to
    // a free-floating window centred on the cursor BEFORE the drag pins geometry —
    // otherwise it would drag with a stale full-height width + a body push. This
    // makes "grab a docked window and drag it" behave like grabbing any window.
    if (modal && (modal.classList.contains('modal-right-docked')
                  || modal.classList.contains('modal-left-docked'))) {
      try { clearRightDock(modal, cx, cy); } catch (_) {}
    }
    // Cancel any in-flight open animation so we don't pin a mid-animation
    // rect and then jump once the animation settles.
    try {
      content.getAnimations()
        .filter(a => a.playState !== 'finished')
        .forEach(a => a.cancel());
    } catch (_) {}
    const rect = content.getBoundingClientRect();
    if (onDragStart) {
      try { onDragStart({ rect, cx, cy }); } catch (_) {}
    }
    startX = cx; startY = cy;
    startLeft = rect.left; startTop = rect.top;
    // Pin position so the drag follows the cursor instead of fighting a
    // centering transform / margin. Inline styles win unless CSS uses
    // !important (the fullscreen rules do, by design).
    content.style.position = 'fixed';
    content.style.left = startLeft + 'px';
    content.style.top = startTop + 'px';
    content.style.transform = 'none';
    content.style.margin = '0';
  };

  const _onMove = (cx, cy) => {
    if (!dragging) return;
    // #794 follow-up: the left/right edge-snap dock is retired (rightDock/leftDock
    // are always null), so the only snap left here is the TOP-edge fullscreen one.
    // Fullscreen state: unsnap only on a downward drag (cy > UNSNAP_PX). There is
    // no side-dock to flip into anymore, so dragging a fullscreen window sideways
    // simply keeps it fullscreen until the cursor drops below the unsnap band.
    if (_isFullscreen()) {
      if (cy > UNSNAP_PX) _exitFs(cx, cy);
      return;
    }
    // Windowed: just follow the cursor — drops exactly where released. No edge
    // re-anchoring in any direction.
    if (Math.abs(cx - startX) > MOVE_THRESHOLD || Math.abs(cy - startY) > MOVE_THRESHOLD) {
      movedDuringDrag = true;
    }
    content.style.left = (startLeft + cx - startX) + 'px';
    content.style.top = (startTop + cy - startY) + 'px';
    // Top-edge fullscreen hint only (the lone surviving snap gesture).
    const inTopBand = cy <= SNAP_PX;
    _showSnapHint(enableFullscreen && inTopBand);
  };

  const _onEnd = (cx, cy) => {
    if (!dragging) return;
    dragging = false;
    if (modal) modal.classList.remove('modal-dragging');
    _showSnapHint(false);
    // The only release-time snap left is the TOP-edge fullscreen (opt-in via
    // onEnterFullscreen). Side edges no longer dock — the window stays where
    // it was dropped.
    if (enableFullscreen && typeof cy === 'number' && cy <= SNAP_PX) {
      _enterFs();
      return;
    }
    if (onDragEnd) {
      const r = content.getBoundingClientRect();
      try { onDragEnd({ rect: r }); } catch (_) {}
    }
  };

  header.addEventListener('mousedown', (e) => {
    if (mobileSkip > 0 && window.innerWidth <= mobileSkip) return;
    if (skipSelector && e.target.closest(skipSelector)) return;
    e.preventDefault();
    movedDuringDrag = false;
    _startDrag(e.clientX, e.clientY);
    const onMove = (ev) => _onMove(ev.clientX, ev.clientY);
    const onUp = (ev) => {
      _onEnd(ev.clientX, ev.clientY);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      // If the pointer actually moved, swallow the synthetic click the
      // browser fires next — otherwise a header click handler (collapse
      // expanded card / "back to list") runs and undoes the drag intent.
      if (movedDuringDrag) {
        const swallow = (clickEv) => {
          clickEv.stopPropagation();
          clickEv.preventDefault();
        };
        header.addEventListener('click', swallow, { capture: true, once: true });
        // Safety: if no click fires (some browsers), drop the listener.
        setTimeout(() => header.removeEventListener('click', swallow, { capture: true }), 50);
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  if (enableTouch) {
    header.addEventListener('touchstart', (e) => {
      if (mobileSkip > 0 && window.innerWidth <= mobileSkip) return;
      if (skipSelector && e.target.closest(skipSelector)) return;
      const t = e.touches[0];
      if (!t) return;
      movedDuringDrag = false;
      _startDrag(t.clientX, t.clientY);
      const onMove = (ev) => {
        const tt = ev.touches[0];
        if (tt) _onMove(tt.clientX, tt.clientY);
      };
      const onEnd = (ev) => {
        const tt = (ev.changedTouches && ev.changedTouches[0]) || null;
        _onEnd(tt ? tt.clientX : null, tt ? tt.clientY : null);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);
        document.removeEventListener('touchcancel', onEnd);
      };
      document.addEventListener('touchmove', onMove, { passive: true });
      document.addEventListener('touchend', onEnd);
      document.addEventListener('touchcancel', onEnd);
    }, { passive: true });
  }
}
