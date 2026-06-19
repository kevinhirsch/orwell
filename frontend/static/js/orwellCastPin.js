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
  function isPinned() { return lsGet(pinKey()) === "1"; }

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
      "#orwell-cast-pin .ocp-hd { display: flex; align-items: center; gap: .4rem; margin-bottom: .35rem; }" +
      "#orwell-cast-pin .ocp-ttl { flex: 1; font-weight: 600; letter-spacing: .03em;" +
      "  color: color-mix(in srgb, var(--fg, #9cdef2) 80%, var(--panel, #111)); }" +
      "#orwell-cast-pin .ocp-btn { background: rgba(255,255,255,.06); border: 1px solid var(--border, #355a66);" +
      "  color: inherit; cursor: pointer; border-radius: 6px; font: inherit; font-size: .68rem;" +
      "  min-height: 24px; padding: 0 .45rem; opacity: .8; }" +
      "#orwell-cast-pin .ocp-btn:hover, #orwell-cast-pin .ocp-btn:focus-visible { opacity: 1;" +
      "  background: rgba(255,255,255,.12); }" +
      "#orwell-cast-pin .ocp-portraits { display: flex; gap: .4rem; }" +
      "#orwell-cast-pin .ocp-face { flex: 1 1 0; min-width: 0; aspect-ratio: 1 / 1; border-radius: 8px;" +
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

    // Two small portraits side by side: prefer two ACTIVE houseguests (the live
    // house), portraits first, then fill from whoever remains.
    var active = roster.filter(function (h) { return !h.status || h.status === "active"; });
    var pool = active.length ? active : roster;
    var withFace = pool.filter(function (h) { return h.portrait; });
    var pick = withFace.concat(pool.filter(function (h) { return !h.portrait; })).slice(0, 2);

    var faces = el.querySelector('[data-role="portraits"]');
    faces.innerHTML = pick.map(faceHtml).join("") || '<div class="ocp-face"><span class="ocp-ph">👤</span></div>';

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
    if (on) lsSet(pinKey(), "1"); else lsDel(pinKey());
    var el = ensureEl();
    if (on) {
      // pinning DOCKS the roster: close the floating cast window if open, render the gadget
      if (window._orwellCastClose) window._orwellCastClose();
      refresh().then(schedule);
    } else {
      el.style.display = "none";
      if (_timer) { clearTimeout(_timer); _timer = null; }
      // un-pinning floats it back: re-open the full window (idempotent — the seam
      // restores it if already open).
      if (typeof window._orwellCastEnsure === "function") window._orwellCastEnsure();
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
})();
