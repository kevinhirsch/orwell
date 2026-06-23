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
  function ensureCss() {
    if (document.getElementById("orwell-cast-pin-css")) return;
    var st = document.createElement("style");
    st.id = "orwell-cast-pin-css";
    st.textContent = "" +
      "#orwell-cast-pin { display: none; margin: var(--space-2, .4rem) var(--space-2, .4rem) 0;" +
      "  padding: var(--space-2, .4rem) var(--space-3, .55rem);" +
      "  background: color-mix(in srgb, var(--panel, #111) 70%, transparent);" +
      "  color: var(--fg, #9cdef2); border: 1px solid var(--border, #355a66); border-radius: 10px;" +
      "  font-family: 'Fira Code', ui-monospace, monospace; font-size: var(--fs-xs, .72rem); }" +
      // header wraps at a narrow rail width so the title + buttons never overlap.
      "#orwell-cast-pin .ocp-hd { display: flex; align-items: center; gap: .4rem;" +
      "  flex-wrap: wrap; margin-bottom: .35rem; }" +
      "#orwell-cast-pin .ocp-ttl { flex: 1 1 auto; min-width: 0; font-weight: 600; letter-spacing: .03em;" +
      "  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" +
      "  color: color-mix(in srgb, var(--fg, #9cdef2) 80%, var(--panel, #111)); }" +
      "#orwell-cast-pin .ocp-btn { flex: 0 0 auto; background: rgba(255,255,255,.06);" +
      "  border: 1px solid var(--border, #355a66);" +
      "  color: inherit; cursor: pointer; border-radius: 6px; font: inherit; font-size: .68rem;" +
      "  min-height: 24px; padding: 0 .45rem; opacity: .8; }" +
      "#orwell-cast-pin .ocp-btn:hover, #orwell-cast-pin .ocp-btn:focus-visible { opacity: 1;" +
      "  background: rgba(255,255,255,.12); }" +
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
      "#orwell-cast-pin .ocp-face img { width: 100%; height: 100%; object-fit: cover; }" +
      // L16: evicted houseguests render grayscale; active/jury stay full color.
      "#orwell-cast-pin .ocp-face.ocp-evicted img { filter: grayscale(1); }" +
      "#orwell-cast-pin .ocp-face .ocp-ph { font-size: 1.1rem; opacity: .45; }" +
      "#orwell-cast-pin .ocp-foot { margin-top: .3rem; opacity: .6; }";
    document.head.appendChild(st);
  }

  function ensureEl() {
    var el = document.getElementById(ID);
    if (el) return el;
    ensureCss();
    el = document.createElement("section");
    el.id = ID;
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", "Cast");
    el.innerHTML =
      '<div class="ocp-hd">' +
        '<span class="ocp-ttl">Cast</span>' +
        '<button type="button" class="ocp-btn" data-act="open" title="Open the full cast window">Open</button>' +
        '<button type="button" class="ocp-btn" data-act="unpin" title="Un-pin back to a floating window">Un-pin</button>' +
      '</div>' +
      '<div class="ocp-portraits" data-role="portraits"></div>' +
      '<div class="ocp-foot" data-role="foot"></div>';
    // Mount into the 0054 gadget rail (its content-driven visibility shows the rail
    // when a gadget has content). Fall back to the sidebar, then body.
    var rail = document.getElementById("gadget-rail-body");
    var sidebar = document.getElementById("sidebar");
    if (rail) rail.appendChild(el);
    else if (sidebar) sidebar.appendChild(el);
    else document.body.appendChild(el);
    el.querySelector('[data-act="open"]').addEventListener("click", openFullWindow);
    el.querySelector('[data-act="unpin"]').addEventListener("click", function () { setPinned(false); });
    return el;
  }

  function openFullWindow() {
    // Re-open the full cast window without un-pinning (a quick peek).
    if (typeof window._orwellCastEnsure === "function") window._orwellCastEnsure();
  }

  function faceHtml(hg) {
    var evicted = hg && hg.status === "evicted"; // L16
    var inner = (hg && hg.portrait)
      ? '<img loading="lazy" alt="' + esc(hg.name) + '" src="' + esc(hg.portrait) + '">'
      : '<span class="ocp-ph">👤</span>';
    return '<div class="ocp-face' + (evicted ? " ocp-evicted" : "") + '">' + inner + "</div>";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function render(data) {
    var el = ensureEl();
    if (!isPinned()) { el.style.display = "none"; return; }
    var roster = (data && Array.isArray(data.roster)) ? data.roster : [];
    if (!roster.length) { el.style.display = "none"; return; }

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
    faces.innerHTML = ordered.map(faceHtml).join("") || '<div class="ocp-face"><span class="ocp-ph">👤</span></div>';

    var present = roster.filter(function (h) { return !h.status || h.status === "active"; }).length;
    var foot = el.querySelector('[data-role="foot"]');
    foot.textContent = present + " in the house";

    // adaptive cadence while portraits are still landing
    var total = (data && typeof data.portraitsTotal === "number") ? data.portraitsTotal : null;
    var have = (data && typeof data.portraitsPresent === "number") ? data.portraitsPresent : null;
    var generating = !!(data && data.imagesAvailable) && total != null && have != null && total > have;
    _pollDelay = generating ? FAST_POLL_MS : POLL_MS;

    el.style.display = "block";
  }

  function refresh() {
    if (!isPinned()) { var el = document.getElementById(ID); if (el) el.style.display = "none"; return Promise.resolve(); }
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
    var el = ensureEl();
    if (on) {
      // pinning DOCKS the roster: close the floating cast window if open, render the gadget
      if (window._orwellCastClose) window._orwellCastClose();
      refresh().then(schedule);
    } else {
      el.style.display = "none";
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
