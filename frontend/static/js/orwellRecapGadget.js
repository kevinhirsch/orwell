// Orwell "Catch Me Up" gadget (M4-3, audit C2) — the player's way to ASK for a recap.
//
// The engine's dailyRecap/seasonRecap are model-called SILENT beats (orwellToolBeats.js
// ORWELL_SILENT_BEATS) — the narrator pulls them to GROUND itself, never to render engine
// text at the player. There was no way for the PLAYER to say "catch me up." This gadget is
// that affordance, and it obeys ADR 0003 to the letter: it NEVER renders engine text. Clicking
// it sends a PREFILLED PLAYER PROSE TURN ("Previously, in the house…") through the exact same
// chat send path as typed input (window.chatModule.handleChatSubmit) — a visible player turn, so
// streaming / status / queueing all inherit. The narrator answers in narration (and may pull the
// silent recap beats to ground that answer); nothing here parses or displays a tool payload.
//
//   • GET /api/orwell/state → { started, ... } — shown only while a season is live (works
//     pre-noms AND post-eviction — any live beat; hidden pre-game / during casting).
//
// Vault-free by construction: it reads only `started` and sends fixed player prose. Fail-open
// everywhere: no gadget on empty / error / pre-game.
(function () {
  "use strict";

  const POLL_MS = 30000;
  const ID = "orwell-recap";
  // The prefilled PLAYER turn. Diegetic, player-voiced — a shortcut for typing the same ask, so
  // the narrator recaps in prose (ADR 0003). Kept as the module's single source of truth so the
  // browser-smoke click-through and any future hint copy stay in lock-step with what is sent.
  const RECAP_PROSE = "Previously, in the house… catch me up — remind me where things stand right now.";

  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn, { once: true })
      : fn();

  let timer = null;
  let _failures = 0;
  let _gadget = null;
  function _pollDelay() { return Math.min(POLL_MS * Math.pow(2, _failures), 120000); }

  async function getJSON(url) {
    const r = await fetch(url, { credentials: "same-origin" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  // Send the recap request as a NORMAL, VISIBLE player turn — the exact send path typed input
  // uses (no headless/hidden flags), so the optimistic bubble, streaming, status and the
  // send-while-streaming queue all inherit. If the send seam isn't up yet, fail open (no-op).
  function _askForRecap() {
    try {
      if (window.chatModule && typeof window.chatModule.handleChatSubmit === "function") {
        window.chatModule.handleChatSubmit(null, RECAP_PROSE);
      }
    } catch (_) { /* fail open — the composer is always the manual way in */ }
  }

  // #640: compose the OrwellGadget kit (the .og-* card chrome). Only this gadget's own inner CSS
  // (the intro line + the ask button) stays here; the card shell + header are the kit's.
  function ensureEl() {
    let el = document.getElementById(ID);
    if (el) return el;
    if (!document.getElementById("orwell-recap-css")) {
      const st = document.createElement("style");
      st.id = "orwell-recap-css";
      st.textContent = `
        #orwell-recap .orecap-line {
          margin: 0 0 .45rem;
          color: color-mix(in srgb, var(--fg, #9cdef2) 72%, var(--panel, #111));
        }
        #orwell-recap .orecap-ask {
          display: inline-flex; align-items: center; gap: .35rem;
          width: 100%; justify-content: center;
          min-height: 30px; padding: 0 .6rem;
          background: rgba(255,255,255,.06);
          border: 1px solid var(--border, #355a66); border-radius: 8px;
          color: inherit; font: inherit; cursor: pointer; opacity: .9;
        }
        #orwell-recap .orecap-ask:hover, #orwell-recap .orecap-ask:focus-visible {
          opacity: 1; background: rgba(255,255,255,.12);
        }`;
      document.head.appendChild(st);
    }
    // 0054: dock into the control-room gadget rail (after the retrospective, beside the recap kin).
    _gadget = window.OrwellGadgetKit.create({
      id: ID, title: "Catch Me Up", icon: "\u{1F4D6}", ariaLabel: "Catch Me Up",
    });
    const body = _gadget.ensure("orwell-retro");
    body.innerHTML =
      `<p class="orecap-line">Lost the thread? Ask Production for a recap of the season so far.</p>` +
      `<button type="button" class="orecap-ask" data-role="ask">` +
      `<span aria-hidden="true">⏮</span><span>Previously, on the season…</span></button>`;
    const btn = body.querySelector("[data-role='ask']");
    if (btn) btn.addEventListener("click", _askForRecap);
    return _gadget.el;
  }

  function render(state) {
    // Show ONLY while a season is live (started truthy). Pre-game / casting → unmounted; if a
    // prior render already built it, hide that node (fail-open, no stale card).
    const live = !!(state && state.started);
    if (!live) {
      const existing = document.getElementById(ID);
      if (existing && _gadget) _gadget.hide();
      return;
    }
    ensureEl();
    _gadget.show();
  }

  async function tick() {
    try {
      if (document.hidden) return; // a hidden tab polls nothing (C18)
      const state = await getJSON("/api/orwell/state");
      render(state || null);
      _failures = 0;
    } catch (_) {
      _failures += 1;
      if (window.OrwellReport) window.OrwellReport.fail("recap", "state-poll", _); // G11: fail open, never silent
      render(null); // fail OPEN: the gadget simply isn't there
    } finally {
      if (timer) clearTimeout(timer);
      timer = setTimeout(tick, _pollDelay());
    }
  }

  function refreshNow() { _failures = 0; tick(); }

  // Test/debug seam (browser smoke): force-mount + read the prose that would be sent.
  window._orwellRecapEnsure = function () { ensureEl(); if (_gadget) _gadget.show(); return document.getElementById(ID); };
  window._orwellRecapProse = function () { return RECAP_PROSE; };
  window._orwellRecapAsk = _askForRecap;

  ready(() => {
    // Only under the game build (the reduced surface) — the full workspace skips the gadget.
    if (document.body && document.body.dataset.gameBuild !== "1") return;
    tick();
    // Refresh on the shared game-changed signal (platform.js dispatches it after every engine-
    // mutating turn) so the gadget appears the moment a season starts and clears at season end.
    window.addEventListener("orwell:gamechanged", refreshNow);
    window.addEventListener("beforeunload", () => timer && clearTimeout(timer));
  });
})();
