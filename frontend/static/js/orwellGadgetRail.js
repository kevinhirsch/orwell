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

  // ── show only while a season is live (mirrors the gadgets' own gating) ─────
  var _started = false;
  function _isNarrow() { return window.matchMedia("(max-width: 768px)").matches; }
  function _refreshOpener() {
    // the floating opener is only meaningful on narrow with a live game and the drawer closed
    if (!opener) return;
    var show = _started && _isNarrow() && !rail.classList.contains("grail-open");
    if (show) opener.removeAttribute("hidden"); else opener.setAttribute("hidden", "");
  }
  function setStarted(on) {
    _started = !!on;
    if (_started) rail.removeAttribute("hidden"); else { rail.setAttribute("hidden", ""); rail.classList.remove("grail-open"); }
    _refreshOpener();
  }
  async function refreshGate() {
    try {
      var r = await fetch("/api/orwell/status", { credentials: "same-origin" });
      if (!r.ok) return;
      var st = await r.json();
      setStarted(!!(st && (st.started || st.phase) && st.phase !== "setup"));
    } catch (_) { /* fail closed: leave hidden */ }
  }
  window.addEventListener("orwell:gamechanged", refreshGate);
  window.addEventListener("resize", _refreshOpener);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refreshGate, { once: true });
  } else { refreshGate(); }
})();
