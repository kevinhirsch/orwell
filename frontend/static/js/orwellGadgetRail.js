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
})();
