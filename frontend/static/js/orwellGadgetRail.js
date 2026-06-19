// orwellGadgetRail (0054) — the control-room gadget rail.
//
// A right-side collapsible column that hosts the live house HUD (the status panel, "wants a
// word", and "where you are" gadgets mount INTO #gadget-rail-body instead of the nav sidebar).
// Game-build only; shown only while a season is active. Collapses to a thin icon strip on
// desktop and slides over as a drawer on narrow. The side can be swapped with the nav sidebar.
// State (collapsed / side / — not the mobile open flag) persists in localStorage.
(function () {
  "use strict";
  function gameBuild() { return !!(document.body && document.body.hasAttribute("data-game-build")); }
  if (!gameBuild()) return;  // never in the full inherited workspace

  var COLLAPSE_KEY = "orwell-gadget-rail-collapsed";
  var SIDE_KEY = "orwell-gadget-side";
  var rail = document.getElementById("gadget-rail");
  var opener = document.getElementById("gadget-rail-open");
  if (!rail) return;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } }

  // ── restore persisted layout ──────────────────────────────────────────────
  function applyCollapsed(c) {
    rail.setAttribute("data-collapsed", c ? "true" : "false");
    var t = document.getElementById("gadget-rail-toggle");
    if (t) { t.setAttribute("aria-expanded", c ? "false" : "true");
      t.title = c ? "Expand the control room" : "Collapse the control room"; }
  }
  function applySide(side) {
    if (side === "left") document.body.setAttribute("data-gadget-side", "left");
    else document.body.removeAttribute("data-gadget-side");
  }
  applyCollapsed(lsGet(COLLAPSE_KEY) === "1");
  applySide(lsGet(SIDE_KEY) === "left" ? "left" : "right");

  // ── controls ────────────────────────────────────────────────────────────
  function toggleCollapsed() {
    var c = rail.getAttribute("data-collapsed") !== "true";
    applyCollapsed(c); lsSet(COLLAPSE_KEY, c ? "1" : "0");
  }
  function expand() { applyCollapsed(false); lsSet(COLLAPSE_KEY, "0"); }
  function toggleSide() {
    var left = document.body.getAttribute("data-gadget-side") !== "left";
    applySide(left ? "left" : "right"); lsSet(SIDE_KEY, left ? "left" : "right");
  }
  function openDrawer() { rail.classList.add("grail-open"); if (opener) opener.setAttribute("hidden", ""); }
  function closeDrawer() { rail.classList.remove("grail-open"); _refreshOpener(); }

  var _toggle = document.getElementById("gadget-rail-toggle");
  if (_toggle) _toggle.addEventListener("click", toggleCollapsed);
  var _swap = document.getElementById("gadget-rail-swap");
  if (_swap) _swap.addEventListener("click", toggleSide);
  var _close = document.getElementById("gadget-rail-close");
  if (_close) _close.addEventListener("click", closeDrawer);
  if (opener) opener.addEventListener("click", openDrawer);
  rail.querySelectorAll("[data-grail-expand]").forEach(function (b) {
    b.addEventListener("click", function () {
      // on desktop the strip expands the column; on mobile the body is already open
      expand();
    });
  });
  // tap outside the drawer closes it (mobile). Escape dismissal flows through ui.js's
  // single arbiter (the F3 ratchet forbids per-surface Escape handlers) — the × button +
  // tap-outside cover the drawer's close paths.
  document.addEventListener("click", function (e) {
    if (!rail.classList.contains("grail-open")) return;
    if (rail.contains(e.target) || (opener && opener.contains(e.target))) return;
    closeDrawer();
  });

  // ── visibility is CONTENT-DRIVEN (robust; no status-fetch race) ────────────
  // The HUD gadgets self-gate: they set display:none when they have nothing to show and
  // display:block when a game is live. The rail shows exactly when at least one gadget
  // has visible content (a child whose OWN computed display isn't none — that holds even
  // while the rail itself is hidden), and hides when the rail is empty. This is what the
  // browser-smoke keep-set drives (it injects chips, then expects the rail visible).
  var body = document.getElementById("gadget-rail-body");
  function _isNarrow() { return window.matchMedia("(max-width: 768px)").matches; }
  function _hasContent() {
    if (!body) return false;
    return Array.prototype.some.call(body.children, function (c) {
      try { return getComputedStyle(c).display !== "none"; } catch (_) { return false; }
    });
  }
  function _refreshOpener() {
    if (!opener) return;
    var show = !rail.hasAttribute("hidden") && _isNarrow() && !rail.classList.contains("grail-open");
    if (show) opener.removeAttribute("hidden"); else opener.setAttribute("hidden", "");
  }
  function syncVisibility() {
    if (_hasContent()) rail.removeAttribute("hidden");
    else { rail.setAttribute("hidden", ""); rail.classList.remove("grail-open"); }
    _refreshOpener();
  }
  if (body && window.MutationObserver) {
    var _obs = new MutationObserver(function () { syncVisibility(); });
    _obs.observe(body, { childList: true, subtree: true, attributes: true,
      attributeFilter: ["style", "class", "hidden"] });
  }
  window.addEventListener("orwell:gamechanged", syncVisibility);
  window.addEventListener("resize", _refreshOpener);
  setInterval(syncVisibility, 4000);  // belt-and-suspenders fallback
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncVisibility, { once: true });
  } else { syncVisibility(); }

  // ── L13: drag-reorder the rail gadgets (persisted, keyboard-accessible) ─────
  // The gadgets self-mount into #gadget-rail-body and lay out by CSS `order`. To
  // let the player reorder them, each gadget gets a small drag handle (a real
  // button — keyboard-focusable, with arrow-key reorder) and the chosen order
  // persists per-user under 'orwell-gadget-order:<user>'. We override `order`
  // inline from the saved sequence; unsaved/new gadgets fall in after, by their
  // base CSS order. Reordering never touches a gadget's own content or focus.
  function _orderKey() {
    return "orwell-gadget-order:" + ((document.body && document.body.dataset.user) || "");
  }
  function loadOrder() {
    try { var v = JSON.parse(lsGet(_orderKey()) || "null"); return Array.isArray(v) ? v : []; }
    catch (_) { return []; }
  }
  function saveOrder(ids) { lsSet(_orderKey(), JSON.stringify(ids)); }

  function gadgets() {
    if (!body) return [];
    return Array.prototype.filter.call(body.children, function (c) { return c.id; });
  }

  // Apply the persisted order as inline `order` (saved ids first, in saved order;
  // everything else after, preserving its base CSS order via a high offset).
  function applyOrder() {
    var saved = loadOrder();
    var list = gadgets();
    list.forEach(function (el) {
      var i = saved.indexOf(el.id);
      // saved gadgets: 1..N; unsaved: 100+ (keeps them after, in DOM/base order)
      el.style.order = String(i === -1 ? 100 : i + 1);
    });
  }

  // The current visual order of gadget ids (by computed `order`, then DOM order).
  function currentOrderIds() {
    var list = gadgets();
    return list
      .map(function (el, idx) { return { id: el.id, ord: parseFloat(getComputedStyle(el).order) || 0, idx: idx }; })
      .sort(function (a, b) { return a.ord - b.ord || a.idx - b.idx; })
      .map(function (e) { return e.id; });
  }

  // Persist + apply a new full order (the public seam + the drop/keyboard paths).
  function reorder(ids) {
    var present = gadgets().map(function (el) { return el.id; });
    // keep only real gadget ids, then append any present gadget the caller omitted
    var clean = ids.filter(function (id) { return present.indexOf(id) !== -1; });
    present.forEach(function (id) { if (clean.indexOf(id) === -1) clean.push(id); });
    saveOrder(clean);
    applyOrder();
  }

  // Move one gadget id before/after another (keyboard + drop helper).
  function moveRelative(dragId, targetId, after) {
    var order = currentOrderIds();
    var from = order.indexOf(dragId);
    if (from === -1) return;
    order.splice(from, 1);
    var to = order.indexOf(targetId);
    if (to === -1) to = order.length;
    order.splice(after ? to + 1 : to, 0, dragId);
    reorder(order);
  }
  function nudge(id, dir) {
    var order = currentOrderIds();
    var i = order.indexOf(id);
    if (i === -1) return;
    var j = i + dir;
    if (j < 0 || j >= order.length) return;
    var tmp = order[i]; order[i] = order[j]; order[j] = tmp;
    reorder(order);
  }

  var DRAG_MIME = "text/orwell-gadget";
  var _dragId = null;

  function decorate(el) {
    if (!el || !el.id || el.querySelector(":scope > .grail-drag")) return;
    var handle = document.createElement("button");
    handle.type = "button";
    handle.className = "grail-drag";
    handle.setAttribute("draggable", "true");
    handle.setAttribute("aria-label", "Reorder this gadget (drag, or arrow keys)");
    handle.title = "Drag to reorder · ↑/↓ to move";
    handle.textContent = "⠿";
    handle.addEventListener("dragstart", function (e) {
      _dragId = el.id;
      el.classList.add("grail-dragging");
      try { e.dataTransfer.setData(DRAG_MIME, el.id); e.dataTransfer.effectAllowed = "move"; } catch (_) {}
    });
    handle.addEventListener("dragend", function () {
      el.classList.remove("grail-dragging");
      _dragId = null;
      Array.prototype.forEach.call(body.children, function (c) { c.classList.remove("grail-drop-into"); });
    });
    // keyboard reorder (accessible): arrows move the gadget; focus is preserved.
    handle.addEventListener("keydown", function (e) {
      if (e.key === "ArrowUp") { e.preventDefault(); nudge(el.id, -1); handle.focus(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); nudge(el.id, 1); handle.focus(); }
    });
    el.insertBefore(handle, el.firstChild);

    // the gadget is a drop target for another gadget's handle
    el.addEventListener("dragover", function (e) {
      if (_dragId == null || _dragId === el.id) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = "move"; } catch (_) {}
      el.classList.add("grail-drop-into");
    });
    el.addEventListener("dragleave", function () { el.classList.remove("grail-drop-into"); });
    el.addEventListener("drop", function (e) {
      el.classList.remove("grail-drop-into");
      var id = _dragId;
      try { id = e.dataTransfer.getData(DRAG_MIME) || _dragId; } catch (_) {}
      if (!id || id === el.id) return;
      e.preventDefault();
      // drop AFTER the target if the pointer is in its lower half, else before
      var r = el.getBoundingClientRect();
      moveRelative(id, el.id, e.clientY > r.top + r.height / 2);
    });
  }

  function ensureDragCss() {
    if (document.getElementById("grail-drag-css")) return;
    var st = document.createElement("style");
    st.id = "grail-drag-css";
    st.textContent =
      ".gadget-rail-body > * { position: relative; }" +
      // the grip lives bottom-left so it never overlaps a gadget's own header
      // controls (the status HUD chevron, the cast-pin buttons — all top-right).
      // Revealed on gadget hover / keyboard focus so it stays unobtrusive.
      ".grail-drag { position: absolute; bottom: 2px; left: 2px; z-index: 2;" +
      "  width: 22px; height: 22px; min-width: 22px; padding: 0; line-height: 1;" +
      "  display: inline-flex; align-items: center; justify-content: center;" +
      "  border: none; background: transparent; color: var(--fg, #9cdef2); opacity: 0;" +
      "  cursor: grab; border-radius: 5px; font-size: .85rem; transition: opacity .12s ease; }" +
      ".gadget-rail-body > *:hover > .grail-drag, .grail-drag:focus-visible { opacity: .6; }" +
      ".grail-drag:hover, .grail-drag:focus-visible { opacity: .95 !important; background: color-mix(in srgb, var(--fg) 14%, transparent); }" +
      ".grail-drag:active { cursor: grabbing; }" +
      ".grail-dragging { opacity: .5; }" +
      ".grail-drop-into { outline: 2px dashed color-mix(in srgb, var(--accent, #e06c75) 70%, transparent); outline-offset: -2px; }" +
      // the collapsed icon-strip has no gadgets to reorder; hide the handle there
      ".gadget-rail[data-collapsed=\"true\"] .grail-drag { display: none; }";
    document.head.appendChild(st);
  }

  function decorateAll() {
    if (!body) return;
    ensureDragCss();
    gadgets().forEach(decorate);
    applyOrder();
  }

  // keep handles + order applied as gadgets mount/unmount
  if (body && window.MutationObserver) {
    var _reobs = new MutationObserver(function () { decorateAll(); });
    _reobs.observe(body, { childList: true });
  }
  window.addEventListener("orwell:gamechanged", decorateAll);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", decorateAll, { once: true });
  } else { decorateAll(); }

  // public seam (the headless gate + any future control surface)
  window.OrwellGadgetRail = {
    reorder: reorder,
    currentOrder: currentOrderIds,
  };
})();
