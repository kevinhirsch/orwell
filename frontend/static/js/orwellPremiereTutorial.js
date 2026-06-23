// orwellPremiereTutorial.js — L31 (FE half): the premiere is a light, hand-held tutorial.
//
// The engine already drives the structured premiere (a built-in introductions round + a gentler
// first-week cadence — L31 engine half, momentPrompts). This is the FE framing: a QUIET, ONE-TIME,
// DISMISSIBLE card that orients a brand-new player to the weekly rhythm the first time they play —
// the player never has to PROMPT for it (ledger L31). It never replaces the chat (the interview /
// premiere happens IN the chat); it just sets expectations beside it.
//
// Shows ONLY when: the game build is on, a season has started, it is WEEK 1 (the premiere week), and
// the player has not dismissed it before. Per-user dismiss persists (the E71 per-user-key pattern),
// so it appears once per account, not once per session. Reads the same Vault-free /api/orwell/state +
// /status projections the season-progress HUD does; refreshes on `orwell:gamechanged`.
//
// Provenance: docs/audits/2026-06-19-live-debug-issues.md item L31 (structured premiere + tutorial).

(function () {
  "use strict";

  function isGameBuild() {
    return !!(typeof document !== "undefined" && document.body &&
      document.body.hasAttribute("data-game-build"));
  }

  // E71 per-user dismiss key — one account's dismissal never bleeds into another's.
  function dismissKey() {
    return "orwell-premiere-tutorial-dismissed:" +
      ((document.body && document.body.dataset.user) || "");
  }
  // #638: the SYNCED layout-store id for this popup's dismiss state (the source of truth that
  // survives reload, crosses devices, and mirrors between two windows). localStorage stays the
  // offline/seed fallback. `_syncedDismissed` is the latest synced value seen this session.
  var POPUP_ID = "popup:premiere-tutorial";
  var _syncedDismissed = false;
  function hasDismissed() {
    if (_syncedDismissed) return true;
    try { return localStorage.getItem(dismissKey()) === "1"; } catch (_) { return false; }
  }
  function markDismissed() {
    try { localStorage.setItem(dismissKey(), "1"); } catch (_) {}
    // #638: fan the dismiss out as a synced, last-write-wins field via the 0064 layout seam.
    if (!_applyingSynced) {
      try {
        window.dispatchEvent(new CustomEvent("orwell:window-layout",
          { detail: { id: POPUP_ID, state: { dismissed: true } } }));
      } catch (_) {}
    }
  }

  // #638: apply a synced dismiss arriving from the layout store (initial seed OR a peer window) —
  // remember it, write the local fallback (without re-emitting), and close the card live if shown.
  var _applyingSynced = false;
  function applySyncedDismiss() {
    if (_syncedDismissed) { removeTutorial(); return; }
    _syncedDismissed = true;
    _applyingSynced = true;   // suppress the re-emit while WE land a remote/seed dismiss
    try {
      try { localStorage.setItem(dismissKey(), "1"); } catch (_) {}
      var card = document.getElementById("orwell-premiere-tutorial");
      if (card) dismiss(card);   // mirror the close in this window (no re-emit — guarded)
      else removeTutorial();
    } finally { _applyingSynced = false; }
  }
  function _onSyncedLayout(e) {
    var d = e && e.detail;
    if (!d || d.windowId !== POPUP_ID || !d.state) return;
    if (d.state.dismissed === true) applySyncedDismiss();
  }

  function jgetSafe(url) {
    return fetch(url, { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  // The first week is the premiere window: week 1 and not yet post-season / finished.
  function isPremiereWeek(status, state) {
    const started = (status && status.started !== false && typeof status.week === "number" && status.week >= 1) ||
                    (state && state.started === true);
    if (!started) return false;
    const week = (status && status.week) || (state && state.week) || 0;
    const moment = (state && state.moment) || "";
    if (moment === "post-season") return false;
    return week === 1;
  }

  function ensureCss() {
    if (document.getElementById("orwell-premiere-tutorial-css")) return;
    const st = document.createElement("style");
    st.id = "orwell-premiere-tutorial-css";
    // Theme-token driven (works across every house theme + frost) — no hard-coded colors.
    st.textContent =
      ".orwell-premiere-tutorial { margin: var(--space-2, .5rem) auto; max-width: 640px;" +
      "  padding: var(--space-3, .7rem) var(--space-4, .9rem);" +
      "  background: color-mix(in srgb, var(--fg) 5%, transparent);" +
      "  border: 1px dashed color-mix(in srgb, var(--fg) 30%, transparent); border-radius: 12px;" +
      "  color: color-mix(in srgb, var(--fg) 86%, transparent); font-size: var(--fs-sm, .82rem);" +
      "  line-height: 1.5; }" +
      ".orwell-premiere-tutorial .opt-hd { display: flex; align-items: baseline; gap: .5rem; margin-bottom: .3rem; }" +
      ".orwell-premiere-tutorial .opt-ttl { font-weight: 700; letter-spacing: .02em; }" +
      ".orwell-premiere-tutorial .opt-rhythm { font-weight: 600;" +
      "  color: color-mix(in srgb, var(--fg) 72%, transparent); }" +
      ".orwell-premiere-tutorial .opt-dismiss { margin-left: auto; flex-shrink: 0; cursor: pointer;" +
      "  background: color-mix(in srgb, var(--fg) 9%, transparent);" +
      "  border: 1px solid color-mix(in srgb, var(--fg) 24%, transparent); color: inherit;" +
      "  border-radius: 8px; font: inherit; font-size: .72rem; font-weight: 600; min-height: 36px;" + // J4-15: project tap floor
      "  padding: 0 .75rem; }" +
      ".orwell-premiere-tutorial .opt-dismiss:hover, .orwell-premiere-tutorial .opt-dismiss:focus-visible {" +
      "  background: color-mix(in srgb, var(--fg) 16%, transparent); }" +
      ".orwell-premiere-tutorial-out { opacity: 0; transition: opacity .2s ease; }" +
      // J2-20: respect prefers-reduced-motion (consistent with orwellCast.js's portrait guard).
      "@media (prefers-reduced-motion: reduce) { .orwell-premiere-tutorial-out { transition: none; } }";
    document.head.appendChild(st);
  }

  let _mounted = false;

  function dismiss(card) {
    markDismissed();
    card.classList.add("orwell-premiere-tutorial-out");
    setTimeout(function () { if (card.isConnected) card.remove(); }, 220);
  }

  function mount() {
    if (_mounted) return;
    if (!isGameBuild() || hasDismissed()) return;
    if (document.getElementById("orwell-premiere-tutorial")) { _mounted = true; return; }
    // Sit it just above the chat input, the same anchor the OOC hint uses (composer guidance).
    const bar = document.querySelector(".chat-input-bar");
    if (!bar || !bar.parentNode) return;
    ensureCss();

    const card = document.createElement("section");
    card.id = "orwell-premiere-tutorial";
    card.className = "orwell-premiere-tutorial";
    card.setAttribute("role", "note");
    // J2-12: the tutorial is injected after the premiere narration, so screen-reader users never
    // hear about the journey's key expectation-setter. A polite live region announces it on insert
    // WITHOUT stealing focus (the card stays a non-intrusive note per ADR 0003).
    card.setAttribute("aria-live", "polite");
    card.innerHTML =
      '<div class="opt-hd">' +
        '<span class="opt-ttl">Welcome to the house — premiere week</span>' +
        '<button type="button" class="opt-dismiss" title="Won\'t show again" aria-label="Close guide — won\'t show again">Close guide</button>' +
      '</div>' +
      '<div>Talk to anyone, wander any room — the house keeps playing around you. ' +
      'You\'ll need to cross paths with all fifteen houseguests before Production calls the first HOH competition.</div>' +
      '<div class="opt-rhythm">' +
        '<span aria-hidden="true">\u{1F3C6}</span> HOH → ' +
        '<span aria-hidden="true">\u{1F528}</span> Nominations → ' +
        '<span aria-hidden="true">\u{1F48E}</span> Veto → ' +
        '<span aria-hidden="true">\u{1F5F3}️</span> Eviction.' +
      '</div>';
    bar.parentNode.insertBefore(card, bar);
    _mounted = true;
    card.querySelector(".opt-dismiss").addEventListener("click", function () { dismiss(card); });
  }

  // J5-16 (J4-27): the card is content-gated to week 1 but was only ever MOUNTED — never removed.
  // Once the season advanced it kept rendering its "premiere week" banner all the way to the finale.
  // Actively remove it whenever the game is no longer in the premiere window.
  function removeTutorial() {
    const card = document.getElementById("orwell-premiere-tutorial");
    if (card) card.remove();
    _mounted = false;
  }

  async function refresh() {
    if (!isGameBuild()) return;
    const status = await jgetSafe("/api/orwell/status");
    const state = await jgetSafe("/api/orwell/state");
    if (isPremiereWeek(status, state)) {
      if (!hasDismissed()) mount();
    } else {
      removeTutorial();
    }
  }

  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn, { once: true })
      : fn();

  if (typeof window !== "undefined") {
    ready(refresh);
    window.addEventListener("orwell:gamechanged", refresh);
    // #638: the synced dismiss seam (initial GET /layout seed + a peer window / device).
    window.addEventListener("orwell:layout-seed", _onSyncedLayout);
    window.addEventListener("orwell:layout-changed", _onSyncedLayout);
    // A new season resets the per-user gate only if the player un-dismissed; otherwise stays retired.
    window.addEventListener("orwell:gamechanged", function () { _mounted = false; });
    // Test/debug seam for the headless gate.
    window._orwellPremiereTutorial = { refresh: refresh, isPremiereWeek: isPremiereWeek };
  }
})();
