// Orwell onboarding — one continuous, guided OOBE flow (P1 redesign).
//
// The flow, in order:
//   1. Settings → the player enters their LLM info (provider/key/model). The MODEL GATE (J4)
//      below holds the flow until a feed is configured — production literally cannot speak
//      without one.
//   2. A WELCOME MODAL — kept as its own modal (NOT folded into the chat) — greets the player
//      and points them at their first task: securing a cast photo.
//   3. The houseguest IMAGE step is the player's FIRST interaction (orwellHeadshot.js mounts the
//      casting card; orwellChatGate.js LOCKS the chat until a photo is secured). The card makes
//      the upload-or-generate choice explicit; the chat input is disabled with a clear reason.
//   4. The moment the photo is confirmed, the PRODUCERS reach out FIRST — a hidden kickoff
//      (no player bubble) opens the casting interview so the player never types the opening word.
//   5. The casting interview proceeds in the chat (the engine's character-creation moment prompt
//      + incremental updateCasting → createCharacter).
//   6. House entry + a light-touch guided first week (the engine premiere + the agent-loop pacing).
//
// This module's remaining jobs:
//   • J4 (model gate): no chat model configured → a game-framed holding card ("Production needs a
//     feed source") — the interview literally cannot speak without one.
//   • F5 (engine down): the dark-house holding card instead of a generic workspace welcome.
//   • F7 (fresh season): the FIRST seat-taking of a new interview opens a fresh chat session so a
//     dead season's transcript never rides along as narrator context.
//   • The WELCOME MODAL (its own modal) shown once per account pre-game, before the image step.
//   • The PRODUCERS-OPEN kickoff after the photo is secured.
//
// On a non-game build an unreachable engine never blocks the normal chat (fail open).
(function () {
  "use strict";

  const SEAT_TAKEN_KEY = "orwell-interview-open"; // sessionStorage: one fresh-session per interview

  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn, { once: true })
      : fn();

  // P1 OOBE overhaul (item 3): while an onboarding step is on screen (the welcome modal
  // OR the cast-photo window), SUPPRESS the welcome splash's rotating gameplay tips + the
  // "house is waiting" tagline so they don't bleed through behind the surface. CSS in
  // game-trim.css hides #welcome-tip / #welcome-sub while body.ow-onboarding is set. (The
  // image-step window separately sets body.ow-casting-headshot-open, also covered there.)
  function setOnboardingActive(on) {
    try { document.body.classList.toggle("ow-onboarding", !!on); } catch (_) {}
  }

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
        #orwell-onboarding .ob-steps { text-align: left; margin: 1rem 0 .2rem; padding: 0; list-style: none;
          font-size: .8rem; line-height: 1.6; opacity: .85; }
        #orwell-onboarding .ob-steps li { margin: .15rem 0; }
        #orwell-onboarding .ob-steps .ob-step-n { display: inline-block; width: 1.4rem; font-weight: 700;
          color: var(--brand-color, var(--red, #e06c75)); }
        #orwell-onboarding .ob-hold-actions { display: flex; gap: .6rem; justify-content: center; margin-top: 1.1rem; flex-wrap: wrap; }
        #orwell-onboarding .ob-btn {
          font: inherit; font-size: .82rem; padding: .45rem .9rem; border-radius: 8px; cursor: pointer;
          background: transparent; color: var(--fg, #9cdef2);
          border: 1px solid var(--border, #355a66);
        }
        #orwell-onboarding .ob-btn:hover { border-color: var(--fg, #9cdef2); }
        #orwell-onboarding .ob-btn-primary {
          background: var(--brand-color, var(--red, #e06c75)); color: var(--bg, #111);
          border-color: transparent; font-weight: 600;
        }
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

  // F5/J4: a blocking production notice — the holding modal (it carries no data entry; it blocks
  // because the game genuinely cannot proceed). Re-probes quietly and dissolves back into the flow
  // the moment the blocker clears.
  //
  // A blocking notice must never be a TRAP: the page behind it is inert, so any remedy the
  // card's copy names must be operable FROM the card, and there is always an explicit way
  // out (a dismiss button + Escape). The J4 card once told the admin "Open Settings" while
  // inerting the Settings button — a real operator was deadlocked on a fresh install with
  // no model configured. The way out is one-shot per mount: dismissing stops the re-probe
  // and stays dismissed until the next page load (route() runs on load only), so an
  // operator mid-configuration is never re-blocked by the poller.
  function mountHolding(title, sub, readyAgain, actions) {
    if (document.getElementById("orwell-onboarding")) return;
    const el = buildOverlay();
    // Tag a blocking HOLDING card (vs. the welcome modal) so the model-config
    // auto-advance (orwell:models-changed) can clear it immediately instead of
    // waiting on the 5s re-probe. The welcome modal carries no such tag, so the
    // auto-advance never yanks a welcome the player is reading.
    el.setAttribute("data-ob-holding", "");
    const card = el.querySelector(".ob-card");
    card.setAttribute("tabindex", "-1");
    card.innerHTML = `
      <div class="ob-hold">
        <h1>${title}</h1>
        <p class="ob-hold-sub">${sub}</p>
        <div class="ob-hold-actions"></div>
      </div>`;
    let timer = null;
    const dismiss = () => {
      if (timer) clearInterval(timer);
      uninertBackground();
      el.remove();
    };
    // Expose the dismiss so the auto-advance can tear this card down cleanly.
    el._obDismiss = dismiss;
    const row = card.querySelector(".ob-hold-actions");
    (actions || []).forEach((a) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ob-btn" + (a.primary ? " ob-btn-primary" : "");
      b.textContent = a.label;
      // Dismiss FIRST: the action's target (e.g. the Settings modal) must not open behind
      // the overlay's inert wall.
      b.addEventListener("click", () => { dismiss(); try { a.onClick && a.onClick(); } catch (_) {} });
      row.appendChild(b);
    });
    const d = document.createElement("button");
    d.type = "button";
    d.className = "ob-btn";
    d.setAttribute("data-ob-dismiss", "");
    d.textContent = "Continue anyway";
    d.addEventListener("click", dismiss);
    row.appendChild(d);
    el.addEventListener("keydown", (e) => { if (e.key === "Escape") dismiss(); });
    document.body.appendChild(el);
    inertBackground(el);
    trapFocus(el);
    try { card.focus(); } catch (_) {}
    timer = setInterval(async () => {
      try {
        if (await readyAgain()) {
          dismiss();
          route();
        }
      } catch (_) { /* still blocked */ }
    }, 5000);
  }

  // ── The WELCOME MODAL (kept as its OWN modal — never folded into the chat) ──────────────
  // Shown once per account, pre-game, AFTER the model is configured and BEFORE the image step.
  // It greets the player, frames the show, and lays out the first-run sequence, then hands off
  // to the image step (the casting card + the chat lock are already in place underneath). Unlike
  // the holding cards this is NOT a blocker — it is the welcome — so dismissing it ("Let's go")
  // simply proceeds. Per-user persisted so it greets once, not every reload.
  const WELCOME_KEY = "orwell-welcome-seen";

  function welcomeKey() {
    return WELCOME_KEY + ":" + ((document.body && document.body.dataset.user) || "");
  }
  function welcomeSeen() {
    try { return localStorage.getItem(welcomeKey()) === "1"; } catch (_) { return false; }
  }
  function markWelcomeSeen() {
    try { localStorage.setItem(welcomeKey(), "1"); } catch (_) {}
  }

  function mountWelcome(onProceed) {
    if (document.getElementById("orwell-onboarding")) return;
    const el = buildOverlay();
    el.setAttribute("aria-label", "Welcome to Big Brother");
    const card = el.querySelector(".ob-card");
    card.setAttribute("tabindex", "-1");
    card.innerHTML = `
      <div class="ob-hold">
        <h1>Welcome to the house</h1>
        <p class="ob-hold-sub">You're cast on <b>Big Brother</b>. One house, sixteen strangers,
          one winner — and production is watching everything.</p>
        <p class="ob-hold-sub">First up: your cast photo. The producers are due any minute for
          your casting interview.</p>
        <div class="ob-hold-actions"></div>
      </div>`;
    const row = card.querySelector(".ob-hold-actions");
    const dismiss = () => {
      markWelcomeSeen();
      uninertBackground();
      el.remove();
      // The welcome modal is gone; the cast-photo WINDOW keeps the splash suppressed via
      // its own body flag, so clearing ow-onboarding here is safe (the window re-asserts it).
      setOnboardingActive(false);
      try { onProceed && onProceed(); } catch (_) {}
    };
    const go = document.createElement("button");
    go.type = "button";
    go.className = "ob-btn ob-btn-primary";
    go.setAttribute("data-ob-welcome-go", "");
    go.textContent = "Add my cast photo";
    go.addEventListener("click", dismiss);
    row.appendChild(go);
    el.addEventListener("keydown", (e) => { if (e.key === "Escape") dismiss(); });
    document.body.appendChild(el);
    setOnboardingActive(true); // suppress the splash tip/tagline while the welcome is up
    inertBackground(el);
    trapFocus(el);
    try { go.focus(); } catch (_) {}
  }

  // The remedy the J4 card names: the workspace's own settings trigger. Called AFTER
  // dismiss so the modal never opens behind the inert wall.
  //
  // L2 (OOBE play-through): #rail-settings only un-hides the sidebar and scrolls — it does
  // NOT open the settings modal (see app.js). Clicking it left the player back at the chat
  // with no settings UI. The button that actually opens Settings is the user-bar gear
  // (#user-bar-settings → settingsModule.open()), so prefer it; fall back to a direct module
  // open if exposed, then to the rail button as a last resort.
  function openSettings() {
    const gear = document.getElementById("user-bar-settings");
    if (gear) { gear.click(); return; }
    try { if (window.settingsModule && window.settingsModule.open) { window.settingsModule.open(); return; } } catch (_) {}
    const rail = document.getElementById("rail-settings");
    if (rail) rail.click();
  }

  // Seam for the headless browser gate: mount the dark-house holding card on demand.
  window._orwellOnboardingMount = function () {
    mountHolding("The house is dark",
      "Big Brother will return. The game engine isn't reachable right now — this screen will clear the moment the feeds come back.",
      async () => { try { return !!(await fetchState()); } catch (_) { return false; } });
  };

  // Seam for the headless browser gate: mount the welcome modal on demand.
  window._orwellWelcomeMount = function () { mountWelcome(); };

  // L2: is the caller an admin? The J4 card offers "Open Settings → Add Models" only to
  // operators who can actually fix it. The old gate read `window._isAdmin`, which nothing in
  // the app ever sets — so the button never rendered even for admins. Probe the real signal
  // (/api/auth/status.is_admin). Fail closed (no button) when the probe is unavailable, so a
  // non-admin is never handed a control they can't act on; the dismiss is always there.
  async function isAdmin() {
    try {
      const r = await fetch("/api/auth/status", { credentials: "same-origin" });
      if (!r.ok) return false;
      const d = await r.json();
      return !!(d && d.is_admin);
    } catch (_) { return false; }
  }

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

  // F7: a brand-new interview opens a FRESH chat session so a dead/reset season's transcript never
  // rides along as narrator context. Runs ONCE per interview (sessionStorage marker). There is NO
  // composer prefill any more — the image step is the player's first interaction and the producers
  // open the conversation (the old casting-seat pre-prompt has been removed).
  function openFreshInterviewSession() {
    let seated = false;
    try { seated = sessionStorage.getItem(SEAT_TAKEN_KEY) === "1"; } catch (_) {}
    if (seated) return;
    try { sessionStorage.setItem(SEAT_TAKEN_KEY, "1"); } catch (_) {}
    try {
      const nb = document.getElementById("sidebar-new-chat-btn") || document.getElementById("rail-new-session");
      if (nb) nb.click();
    } catch (_) {}
  }

  // L5 → P1: the casting cutover. Securing the cast photo is the player's FIRST step
  // (orwellHeadshot.js calls this on finalize); the PRODUCERS open the show — the player never
  // types the opening word. We auto-send ONE kickoff with the user bubble HIDDEN, so the first
  // VISIBLE message in the chat is the producers reaching out, not a player line. The model (under
  // the pre-game/casting moment prompt) finalizes casting if needed (createCharacter) and narrates
  // the producers' reach-out. This is a deliberate, scoped departure from "the player owns the
  // first keypress" — only at this single handoff, game-build only, fired once. Guards: never
  // override the player's own typing or an in-flight stream, and never fire if a started game's
  // conversation is already underway.
  const OPEN_GAME_LINE =
    "(Production cue — begin the casting interview now. Reach out to me first, in character as the " +
    "producers; do not wait for me to speak.)";
  let _openSent = false;
  window._orwellOpenGameAfterCasting = function () {
    const gameBuild = document.body && document.body.hasAttribute("data-game-build");
    if (!gameBuild || _openSent) return;
    _openSent = true;
    // The photo is now secured — make sure the chat is unlocked before the kickoff sends.
    try { if (window._orwellChatGate && window._orwellChatGate.notePhotoSecured) window._orwellChatGate.notePhotoSecured(); } catch (_) {}
    // Give the headshot card's teardown a beat, then auto-send through the normal submit path
    // (the same seam chat.js uses for its own programmatic sends), with the user bubble hidden so
    // the producers appear to reach out first.
    setTimeout(() => {
      try {
        const box = document.getElementById("message");
        if (!box) { _openSent = false; return; }
        if (box.value.trim()) return;                 // the player is mid-thought — don't stomp it
        if (window.chatModule && window.chatModule.hasActiveStream && window.chatModule.hasActiveStream()) {
          _openSent = false; return;                  // a turn is already running — let it finish
        }
        // Hide the kickoff bubble so the FIRST thing the player sees is the producers' message.
        try { if (window.chatModule && window.chatModule.setHideUserBubble) window.chatModule.setHideUserBubble(); } catch (_) {}
        box.value = OPEN_GAME_LINE;
        box.dispatchEvent(new Event("input", { bubbles: true }));
        if (window.chatModule && typeof window.chatModule.handleChatSubmit === "function") {
          window.chatModule.handleChatSubmit({ preventDefault() {} });
        } else {
          // No send seam available — fall back to a focused composer so the player can nudge it.
          box.focus();
        }
      } catch (_) { _openSent = false; /* fail open — the composer is still the way in */ }
    }, 250);
  };

  // E65: a season RESTART (season 2+) opens a FRESH chat session so the dead season's transcript
  // never rides as narrator context (F7's page-load-only fence, now event-driven too). The seat
  // marker resets so a future pre-game state runs the casting flow again.
  //
  // P1 (OOBE conversation split): this MUST NOT fire for the INITIAL first-season onboarding.
  // There the casting interview is the legitimate lead-in and must flow into the game in the SAME
  // conversation — firing here split the one onboarding into TWO chats (the hidden kickoff cue +
  // the producer's opener in session A, the rest of the interview + house entry in an auto-titled
  // session B), blanked #chat-history, and flickered the chat list. The createCharacter tool fires
  // at the end of EVERY interview (initial AND restart), so chat.js can't tell them apart on its
  // own. The distinguisher is engine state at the trigger: a true restart is requested while a game
  // is ALREADY started (reset-progress / next-season — they call `markRestart()` right before this);
  // the initial onboarding runs entirely from `started === false` and never arms it.
  //
  // So this seam is a NO-OP unless a restart was explicitly armed. The genuine restart entry points
  // (settings.js, orwellNewSeason.js) arm it and open the fresh session at THEIR trigger — clearing
  // the dead transcript before casting re-opens — and the redundant chat.js createCharacter call
  // that follows finds the flag disarmed and does nothing. The seam stays referenced from chat.js
  // (the createCharacter success path) so a future engine-driven restart can still arm it.
  window._orwellMarkRestart = () => { try { window._orwellRestartArmed = true; } catch (_) {} };
  window._orwellFreshSession = () => {
    // Initial first-season onboarding: NOT a restart — keep it ONE continuous conversation,
    // never blank/switch the chat (the casting interview IS the lead-in into the game).
    if (!window._orwellRestartArmed) return;
    try { window._orwellRestartArmed = false; } catch (_) {}
    try { sessionStorage.removeItem(SEAT_TAKEN_KEY); } catch (_) {}
    // FE-render #7: the fresh-session click (createDirectChat) blanks #chat-history + shows the
    // welcome splash WHILE the still-finalizing tool beat / casting card is re-painting the old
    // transcript. For one beat the transition reads as "the chat lost my conversation". Mark the
    // transition so showWelcomeScreen suppresses the splash until the swap settles (it only
    // suppresses while the OLD transcript still has bubbles — a genuinely empty new session still
    // gets its welcome once this clears). Self-clearing so nothing stays stuck.
    try {
      window._orwellCastingTransition = true;
      clearTimeout(window._orwellCastingTransitionTimer);
      window._orwellCastingTransitionTimer = setTimeout(() => { window._orwellCastingTransition = false; }, 1500);
    } catch (_) {}
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
        // pointed at setup — and a BUTTON that actually goes there (the copy's remedy must
        // be operable from the card; the page behind it is inert). Re-probe and continue.
        const admin = await isAdmin();
        mountHolding("Production needs a feed source",
          "No chat model is configured yet, so the house can't speak. " +
          (admin ? "Open Settings → Add Models (or type /setup) to connect one — casting begins the moment a feed is live."
                 : "Ask your administrator to connect a model — casting begins the moment a feed is live."),
          anyModelConfigured,
          admin ? [{ label: "Open Settings", primary: true, onClick: openSettings }] : []);
        return;
      }
      // Pre-game with a model configured: open the fresh interview session (F7), then run the
      // guided sequence — the WELCOME MODAL first (once per account), which hands off to the image
      // step. The chat is already locked by orwellChatGate.js until a photo is secured; the casting
      // card (orwellHeadshot.js) is the image step itself.
      openFreshInterviewSession();
      if (!welcomeSeen()) {
        mountWelcome(); // its own modal; on "Add my cast photo" it dissolves into the image step
      }
    } catch (_) {
      // Engine unreachable: on the game build that's a dark house, not a silent skip (F5).
      if (gameBuild) window._orwellOnboardingMount();
    }
  }

  // P1 OOBE auto-advance: the whole flow must move WITHOUT a manual page reload. The
  // route() above ran once on load; re-run it agentically on the signals that change what
  // the flow should show — chiefly when the player configures an LLM model in Settings.
  //
  //   Settings → LLM  →  welcome modal  →  image (required)  →  producers reach out first
  //
  // models.js fires orwell:models-changed on the none→some transition. When it lands and a
  // blocking holding card (e.g. "Production needs a feed source") is still up, clear it
  // immediately (don't wait on its 5s re-probe) and re-evaluate so the welcome modal opens
  // right away. A welcome modal already showing carries no holding tag, so it's left alone.
  function _reRouteAfterModelConfig() {
    const open = document.getElementById("orwell-onboarding");
    if (open && open.hasAttribute("data-ob-holding")) {
      try { if (typeof open._obDismiss === "function") open._obDismiss(); else open.remove(); } catch (_) {}
      try { uninertBackground(); } catch (_) {}
    }
    route();
  }
  window.addEventListener("orwell:models-changed", _reRouteAfterModelConfig);

  ready(route);
})();
