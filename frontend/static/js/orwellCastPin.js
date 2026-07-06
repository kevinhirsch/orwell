// Orwell cast-pin rail gadget (live-debug L12) — the cast roster, DOCKED.
//
// L12 lets the player PIN the floating cast window into the right-side control-room
// gadget rail (0054) as a COMPACT gadget — two small portraits side by side plus a
// "Cast" affordance to re-open the full window — and UN-PIN it back to a floating
// window. The pinned state persists per user (localStorage 'orwell-cast-pinned:<user>'),
// so it survives a reload exactly like the rail's other persisted layout.
//
// Vault-free by construction: it renders ONLY GET /api/orwell/roster (name / status /
// a portrait ref — the engine's public projection). Mounts into #gadget-rail-body so the
// 0054 rail's content-driven visibility shows the rail whenever the gadget has content;
// when un-pinned the gadget sets display:none (no content) and the rail hides if empty.
//
// L16 pairs here too: an ACTIVE houseguest's portrait is full color, an EVICTED one is
// grayscale — the same eviction-only monochrome rule the cast roster uses.
(function () {
  "use strict";
  function gameBuild() { return !!(document.body && document.body.hasAttribute("data-game-build")); }
  if (!gameBuild()) return; // never in the full inherited workspace

  var ID = "orwell-cast-pin";
  var POLL_MS = 30000;
  var FAST_POLL_MS = 4000;
  var _timer = null;
  var _pollDelay = POLL_MS;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (_) {} }
  function pinKey() {
    return "orwell-cast-pinned:" + ((document.body && document.body.dataset.user) || "");
  }
  function _isNarrow() {
    try { return window.matchMedia("(max-width: 768px)").matches; } catch (_) { return false; }
  }
  // #656 — the Cast Photos gadget was missing on mobile: a phone player can't comfortably
  // pin the floating cast window into the rail (windows are a desktop affordance), so the
  // gadget — which only mounts/shows while pinned — never appeared. Fix: on a NARROW viewport
  // the gadget DOCKS BY DEFAULT so it self-mounts and renders in the rail, UNLESS the player
  // explicitly un-pinned it ("0"). Tri-state storage keeps desktop untouched: "1" = pinned,
  // "0" = explicitly un-pinned, absent = undecided (desktop: floating; mobile: auto-docked).
  function isPinned() {
    var v = lsGet(pinKey());
    if (v === "1") return true;
    if (v === "0") return false;        // explicit un-pin wins on every viewport
    return _isNarrow();                  // undecided: docked on mobile, floating on desktop
  }

  function getJSON(url) {
    return fetch(url, { credentials: "same-origin" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  // ── the compact gadget element (lives in the rail body) ────────────────────
  // #640: compose the OrwellGadget kit (the .og-* card chrome + the rail mount + content-driven
  // visibility + the header action buttons). Only this gadget's own inner CSS (the portrait grid)
  // stays here; the card shell + header ("👥 Cast" + Open / Un-pin actions) are the kit's.
  function ensureCss() {
    if (document.getElementById("orwell-cast-pin-css")) return;
    var st = document.createElement("style");
    st.id = "orwell-cast-pin-css";
    st.textContent = "" +
      // #554: a scrollable responsive grid (target ~4 across) rendering the FULL cast —
      // active, jury AND evicted — instead of just two portraits. Capped height so the
      // gadget stays compact in the rail; the grid scrolls when the cast overflows.
      "#orwell-cast-pin .ocp-portraits { display: grid;" +
      "  grid-template-columns: repeat(auto-fill, minmax(40px, 1fr)); gap: .35rem;" +
      "  max-height: 188px; overflow-y: auto; overscroll-behavior: contain;" +
      "  padding-right: 2px; }" +
      "#orwell-cast-pin .ocp-face { min-width: 0; aspect-ratio: 1 / 1; border-radius: 8px;" +
      "  overflow: hidden; background: rgba(255,255,255,.05); border: 1px solid var(--border, #355a66);" +
      "  display: flex; align-items: center; justify-content: center; }" +
      // #725 — under the glass theme the hard dark var(--border) hairline reads as a heavy
      // ink rim that fights the frosted, luminous look of the windows/notices. Soften it to
      // the same soft white hairline (rgba(255,255,255,0.14)) the glass kits use, so the
      // portrait tiles lift off the frosted card instead of being boxed in dark ink. The
      // Normal tier keeps its solid var(--border) (the rule above) untouched.
      "body.theme-frosted #orwell-cast-pin .ocp-face { border-color: rgba(255,255,255,0.14); }" +
      "#orwell-cast-pin .ocp-face img { width: 100%; height: 100%; object-fit: cover; }" +
      // L16: evicted houseguests render grayscale; active/jury stay full color.
      "#orwell-cast-pin .ocp-face.ocp-evicted img { filter: grayscale(1); }" +
      // #771 — the placeholder is a MONOCHROME inline SVG silhouette (currentColor), kit
      // glyph language, not an off-brand color emoji. Sized to the tiny rail face.
      "#orwell-cast-pin .ocp-face .ocp-ph { display: flex; align-items: center; justify-content: center; opacity: .42; }" +
      "#orwell-cast-pin .ocp-face .ocp-ph svg { width: 56%; height: 56%; }" +
      "#orwell-cast-pin .ocp-foot { margin-top: .3rem; opacity: .6; }" +
      // #740 — anti-overlap belt: the cast-pin gadget is a RAIL gadget (it mounts into
      // #gadget-rail-body and flows in the rail column, which clears the composer by
      // construction). But the OrwellGadget kit mount has a body-level fallback
      // (#gadget-rail-body -> #sidebar -> document.body), so a degraded DOM could orphan it
      // onto <body>. An orphaned card must NEVER become a floating tile sitting over the
      // composer: keep it in normal flow (a docked card, not a fixed/floating one) whenever
      // it is NOT inside the rail body. In the normal case the gadget IS in the rail and
      // this selector simply never matches.
      "#orwell-cast-pin:not(#gadget-rail-body > #orwell-cast-pin) { position: static !important; }";
    document.head.appendChild(st);
  }

  var _gadget = null;
  function ensureEl() {
    var el = document.getElementById(ID);
    if (el) return el;
    ensureCss();
    _gadget = window.OrwellGadgetKit.create({ id: ID, title: "Cast", icon: "👥", role: "group", ariaLabel: "Cast" });
    var body = _gadget.ensure();
    _gadget.addAction({ label: "Open", title: "Open the full cast window", dataset: { act: "open" }, onClick: openFullWindow });
    _gadget.addAction({ label: "Un-pin", title: "Un-pin back to a floating window", dataset: { act: "unpin" }, onClick: function () { setPinned(false); } });
    body.innerHTML =
      '<div class="ocp-portraits" data-role="portraits"></div>' +
      '<div class="ocp-foot" data-role="foot"></div>';
    return _gadget.el;
  }

  function openFullWindow() {
    // Re-open the full cast window without un-pinning (a quick peek).
    if (typeof window._orwellCastEnsure === "function") window._orwellCastEnsure();
  }

  // #771 — monochrome silhouette glyph (currentColor) shared by every placeholder face,
  // matching the kit's inline-SVG icon language (no color emoji).
  var OCP_SILHOUETTE =
    '<span class="ocp-ph" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/>' +
    '<path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></svg></span>';

  function faceHtml(hg) {
    var evicted = hg && hg.status === "evicted"; // L16
    var name = hg && hg.name;
    var inner = (hg && hg.portrait)
      ? '<img loading="lazy" alt="' + esc(name) + '" src="' + esc(hg.portrait) + '">'
      : OCP_SILHOUETTE;
    // GADGET-4: a hover title + aria-label on the FACE wrapper — `alt` only helps screen readers
    // (and only once the image has loaded), so a sighted mouse user had zero way to identify a
    // ~40px tile (or an unloaded/placeholder one) without reopening the full cast window.
    var name_attrs = name ? ' title="' + esc(name) + '" aria-label="' + esc(name) + '"' : "";
    return '<div class="ocp-face' + (evicted ? " ocp-evicted" : "") + '"' + name_attrs + ">" + inner + "</div>";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function render(data) {
    var el = ensureEl();
    if (!isPinned()) { _gadget.hide(); return; }
    var roster = (data && Array.isArray(data.roster)) ? data.roster : [];
    if (!roster.length) { _gadget.hide(); return; }

    // #554: render the FULL cast as a scrollable grid (active first, then jury/evicted —
    // never drop later boots). The grid is height-capped + scrolls, so the gadget stays
    // compact in the rail while still showing everyone.
    function rank(h) {
      var s = h && h.status;
      if (!s || s === "active") return 0;
      if (s === "jury") return 1;
      return 2; // evicted / other
    }
    var ordered = roster.slice().sort(function (a, b) { return rank(a) - rank(b); });

    var faces = el.querySelector('[data-role="portraits"]');
    faces.innerHTML = ordered.map(faceHtml).join("") || '<div class="ocp-face">' + OCP_SILHOUETTE + "</div>";

    var present = roster.filter(function (h) { return !h.status || h.status === "active"; }).length;
    var foot = el.querySelector('[data-role="foot"]');
    foot.textContent = present + " in the house";

    // adaptive cadence while portraits are still landing
    var total = (data && typeof data.portraitsTotal === "number") ? data.portraitsTotal : null;
    var have = (data && typeof data.portraitsPresent === "number") ? data.portraitsPresent : null;
    var generating = !!(data && data.imagesAvailable) && total != null && have != null && total > have;
    _pollDelay = generating ? FAST_POLL_MS : POLL_MS;

    _gadget.show();
  }

  function refresh() {
    if (!isPinned()) { if (_gadget) _gadget.hide(); else { var el = document.getElementById(ID); if (el) el.style.display = "none"; } return Promise.resolve(); }
    return getJSON("/api/orwell/roster").then(render).catch(function (e) {
      if (window.OrwellReport) window.OrwellReport.fail("castpin", "roster-fetch", e);
      // fail open: keep whatever's shown
    });
  }

  function schedule() {
    if (_timer) { clearTimeout(_timer); _timer = null; }
    if (!isPinned()) return;
    _timer = setTimeout(function () {
      _timer = null;
      if (!document.hidden) refresh().then(schedule); else schedule();
    }, _pollDelay);
  }

  // ── the pin toggle (the cast window calls this; the gadget owns it) ─────────
  // The rail's own MutationObserver watches gadget display, so flipping the
  // gadget's display re-syncs the rail visibility — no gamechanged dispatch
  // needed (which would route through the cast window's engine-gate).
  function setPinned(on) {
    // #656 — store an EXPLICIT un-pin ("0") rather than deleting the key, so the choice
    // sticks on mobile (where absent ⇒ auto-docked). "1" = pinned, "0" = explicitly off.
    lsSet(pinKey(), on ? "1" : "0");
    ensureEl();
    if (on) {
      // pinning DOCKS the roster: close the floating cast window if open, render the gadget
      if (window._orwellCastClose) window._orwellCastClose();
      refresh().then(schedule);
    } else {
      _gadget.hide();
      if (_timer) { clearTimeout(_timer); _timer = null; }
      // un-pinning floats it back: re-open the full window (idempotent — the seam restores
      // it if already open). On a narrow viewport windows aren't a comfortable affordance,
      // so a mobile un-pin just hides the gadget (no floating window pops up).
      if (!_isNarrow() && typeof window._orwellCastEnsure === "function") window._orwellCastEnsure();
    }
  }

  // public seam the cast window's pin button uses
  window.OrwellCastPin = {
    isPinned: isPinned,
    setPinned: setPinned,
    toggle: function () { setPinned(!isPinned()); },
  };

  // boot + game-changed: if pinned, hydrate the gadget and start polling
  function boot() {
    if (isPinned()) { ensureEl(); refresh().then(schedule); }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else { boot(); }
  window.addEventListener("orwell:gamechanged", function () {
    if (isPinned()) refresh().then(schedule);
  });
  // #656 — crossing the mobile breakpoint flips the undecided default (docked on narrow):
  // re-hydrate so the gadget mounts/shows when entering a narrow viewport.
  window.addEventListener("resize", function () {
    if (isPinned()) { ensureEl(); refresh().then(schedule); }
    else { var el = document.getElementById(ID); if (el) el.style.display = "none"; }
  });
})();
