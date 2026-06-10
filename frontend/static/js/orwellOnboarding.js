// Orwell onboarding — the casting interview lives in the CHAT (feature 0050).
//
// There is NO data-entry modal: character creation is the game's first scene. Pre-game,
// the server frames every chat turn as the producer's casting interview (the engine's
// character-creation moment prompt), the producer asks, the player answers, and the model
// records each answer with updateCasting — the ENGINE tracks what's captured and what the
// next step is, so the interview can be none, half, or fully done and always resumes.
//
// This module's remaining jobs:
//   • J4 (model gate): no chat model configured → a game-framed holding card ("Production
//     needs a feed source") — the interview literally cannot speak without one.
//   • F5 (engine down): the dark-house holding card instead of a generic workspace welcome.
//   • F7 (fresh season): the FIRST seat-taking of a new interview opens a fresh chat
//     session so a dead season's transcript never rides along as narrator context.
//   • Hand-off: pre-game with everything ready, PREFILL the composer (never auto-send —
//     ADR 0003: the player owns the first keypress) and let the chat do the rest.
//
// On a non-game build an unreachable engine never blocks the normal chat (fail open).
(function () {
  "use strict";

  const SEAT_TAKEN_KEY = "orwell-interview-open"; // sessionStorage: one fresh-session+prefill per interview

  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn, { once: true })
      : fn();

  async function fetchState() {
    const r = await fetch("/api/orwell/state", { credentials: "same-origin" });
    if (!r.ok) throw new Error("state " + r.status);
    return r.json();
  }

  function buildOverlay() {
    const el = document.createElement("div");
    el.id = "orwell-onboarding";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Big Brother production notice");
    el.innerHTML = `
      <style>
        #orwell-onboarding {
          position: fixed; inset: 0; z-index: 99999;
          display: flex; align-items: center; justify-content: center;
          background: color-mix(in srgb, var(--bg, #282c34) 88%, black);
          font-family: 'Fira Code', ui-monospace, monospace;
        }
        #orwell-onboarding .ob-card {
          width: 420px; max-width: 92vw; max-height: 90vh; overflow: auto;
          background: var(--panel, #111); color: var(--fg, #9cdef2);
          border: 1px solid var(--border, #355a66); border-radius: 12px;
          padding: 1.6rem 1.6rem 1.4rem; box-shadow: 0 20px 60px rgba(0,0,0,.45);
        }
        #orwell-onboarding h1 {
          font-size: 1.5rem; font-weight: 600; letter-spacing: .04em; margin: 0 0 .25rem;
          background: linear-gradient(135deg, var(--brand-color, var(--red, #e06c75)),
            color-mix(in srgb, var(--brand-color, var(--red, #e06c75)) 60%, var(--fg, #fff)));
          -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
        }
        #orwell-onboarding .ob-hold { text-align: center; padding: .4rem 0 .2rem; }
        #orwell-onboarding .ob-hold .ob-hold-sub { opacity: .7; font-size: .82rem; margin: .5rem 0 0; line-height: 1.5; }
      </style>
      <div class="ob-card"></div>`;
    return el;
  }

  // A11Y-1: aria-modal is a PROMISE to assistive tech that the rest of the page is
  // inert — enforce it. Tab stays inside the card; everything behind the scrim is
  // inert (unfocusable, unclickable) until the overlay resolves.
  let _inerted = [];
  function inertBackground(except) {
    _inerted = [];
    Array.from(document.body.children).forEach((n) => {
      if (n === except || n.tagName === "SCRIPT" || n.tagName === "STYLE") return;
      if (!n.inert) { n.inert = true; _inerted.push(n); }
    });
  }
  function uninertBackground() {
    _inerted.forEach((n) => { try { n.inert = false; } catch (_) {} });
    _inerted = [];
  }
  function trapFocus(el) {
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const f = el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!f.length) { e.preventDefault(); return; } // nothing focusable → focus stays on the card
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  // F5/J4: a blocking production notice — the only modal left in onboarding (it carries
  // no data entry; it blocks because the game genuinely cannot proceed). Re-probes
  // quietly and dissolves back into the flow the moment the blocker clears.
  function mountHolding(title, sub, readyAgain) {
    if (document.getElementById("orwell-onboarding")) return;
    const el = buildOverlay();
    const card = el.querySelector(".ob-card");
    card.setAttribute("tabindex", "-1");
    card.innerHTML = `
      <div class="ob-hold">
        <h1>${title}</h1>
        <p class="ob-hold-sub">${sub}</p>
      </div>`;
    document.body.appendChild(el);
    inertBackground(el);
    trapFocus(el);
    try { card.focus(); } catch (_) {}
    const t = setInterval(async () => {
      try {
        if (await readyAgain()) {
          clearInterval(t);
          uninertBackground();
          el.remove();
          route();
        }
      } catch (_) { /* still blocked */ }
    }, 5000);
  }

  // Seam for the headless browser gate: mount the dark-house holding card on demand.
  window._orwellOnboardingMount = function () {
    mountHolding("The house is dark",
      "Big Brother will return. The game engine isn't reachable right now — this screen will clear the moment the feeds come back.",
      async () => { try { return !!(await fetchState()); } catch (_) { return false; } });
  };

  // J4: "is any chat model configured?" — the interview cannot speak without one, and the
  // old flow let the player author a houseguest then dead-end at "No model selected".
  async function anyModelConfigured() {
    try {
      const r = await fetch("/api/models", { credentials: "same-origin" });
      if (!r.ok) return true; // can't tell → don't block the flow on a probe
      const d = await r.json();
      // /api/models shape: { items: [{ models: [...] , offline }] } per endpoint group.
      const items = (d && Array.isArray(d.items)) ? d.items : [];
      return items.some((it) => Array.isArray(it.models) && it.models.length > 0 && !it.offline);
    } catch (_) { return true; }
  }

  // Hand the player to the producer — in the chat, no modal. Runs ONCE per interview
  // (sessionStorage marker): opens a fresh chat session (F7 — a finished or reset season's
  // transcript must never ride along as narrator context for the new one), then PREFILLS
  // the composer so the player's own Enter starts the interview. Never auto-sends.
  function takeASeat() {
    let seated = false;
    try { seated = sessionStorage.getItem(SEAT_TAKEN_KEY) === "1"; } catch (_) {}
    if (seated) return; // mid-interview reload: the conversation is already underway
    try { sessionStorage.setItem(SEAT_TAKEN_KEY, "1"); } catch (_) {}
    try {
      const nb = document.getElementById("sidebar-new-chat-btn") || document.getElementById("rail-new-session");
      if (nb) nb.click();
    } catch (_) {}
    setTimeout(() => {
      const box = document.getElementById("message");
      if (box && !box.value.trim()) {
        box.value = "I take my seat for the casting interview.";
        box.dispatchEvent(new Event("input", { bubbles: true }));
        box.focus();
      }
    }, 400); // after the fresh-session click settles
  }

  // E65: a season restart (createCharacter success mid-session) opens a FRESH chat
  // session so the dead season's transcript never rides as narrator context (F7's
  // page-load-only fence, now event-driven too). The seat marker resets so a future
  // pre-game state runs the casting flow again.
  window._orwellFreshSession = () => {
    try { sessionStorage.removeItem(SEAT_TAKEN_KEY); } catch (_) {}
    try {
      const nb = document.getElementById("sidebar-new-chat-btn") || document.getElementById("rail-new-session");
      if (nb) nb.click();
    } catch (_) {}
  };

  async function route() {
    const gameBuild = document.body && document.body.hasAttribute("data-game-build");
    try {
      const st = await fetchState();
      if (!st || st.started !== false) {
        // A season is running (or the state is unreadable): the NEXT reset begins a new
        // interview, so clear the seat marker.
        try { sessionStorage.removeItem(SEAT_TAKEN_KEY); } catch (_) {}
        return;
      }
      if (!(await anyModelConfigured())) {
        // Sequence the prerequisite (J4): production needs a feed source first. Admins get
        // pointed at setup; everyone else knows what to ask for. Re-probe and continue.
        mountHolding("Production needs a feed source",
          "No chat model is configured yet, so the house can't speak. " +
          (window._isAdmin ? "Open Settings → Add Models (or type /setup) to connect one — casting begins the moment a feed is live."
                           : "Ask your administrator to connect a model — casting begins the moment a feed is live."),
          anyModelConfigured);
        return;
      }
      takeASeat();
    } catch (_) {
      // Engine unreachable: on the game build that's a dark house, not a silent skip (F5).
      if (gameBuild) window._orwellOnboardingMount();
    }
  }

  ready(route);
})();
