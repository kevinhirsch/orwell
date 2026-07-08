// Orwell onboarding — one continuous, guided OOBE flow (P1 redesign; OOBE re-sequence 2026-06-20;
// setup-wizard + premature-start fix 2026-06-23).
//
// The flow, in order:
//   1. Settings → the player enters their LLM info (provider/key/model). The MODEL GATE (J4)
//      below holds the flow until a feed is configured — production literally cannot speak
//      without one. OpenRouter is the default provider; deepseek-v4-pro the OOB narrator model and
//      gemini-2.5-flash-image the OOB portrait model (src/settings.py DEFAULT_SETTINGS).
//   2. The SETUP WIZARD (mountSetup) — its own modal — shows on EVERY fresh game/season. The only
//      welcome copy is the framing line "Production needs the feeds"; the rest is feed/model SETUP
//      borrowed from the Settings model controls (a model summary + a "Choose models" door into
//      Settings). The season begins ONLY on the explicit "Start casting" button — NOT when a feed
//      is probed (the premature-start fix). "Start casting" opens the fresh interview session AND
//      fires the producers' hidden kickoff — the producers reach out FIRST.
//   3. The casting interview proceeds in the chat (the engine's character-creation moment prompt
//      + incremental updateCasting → createCharacter). The producers ask about the CAST PHOTO
//      first; only THEN does the in-chat photo upload box pop up (orwellHeadshot.js) — it follows
//      the producers' question and is OPTIONAL/skippable (it never gates the chat or createCharacter).
//   4. House entry + a light-touch guided first week (the engine premiere + the agent-loop pacing).
//
// OOBE re-sequence (2026-06-20): the OLD flow was photo-FIRST and HARD-LOCKED the chat until a
// photo was secured. That is reversed here: the welcome opens the interview, the producers ask
// about the photo, and the photo box appears MID-interview (engine-gated on state.casting.missing
// including "castPhoto") and is skippable. The chat is no longer locked for the photo.
//
// This module's remaining jobs:
//   • J4 (model gate): no chat model configured → a game-framed holding card ("Production needs a
//     feed source") — the interview literally cannot speak without one.
//   • F5 (engine down): the dark-house holding card instead of a generic workspace welcome.
//   • F7 (fresh season): the FIRST seat-taking of a new interview opens a fresh chat session so a
//     dead season's transcript never rides along as narrator context.
//   • The WELCOME MODAL (its own modal) shown on EVERY fresh game/season pre-game; on dismiss it
//     opens the fresh interview session and fires the PRODUCERS-OPEN kickoff.
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

  // #709 (owner directive): the onboarding modals are RECREATED on the OrwellWindow KIT — the same
  // kit settings.js uses (window.OrwellWindowKit.create({ modal:true })). The kit OWNS the glass
  // chrome (the frosted `body.theme-frosted .ow-window` material + neutral rim), the kit SANS font
  // (--ow-ui-font — retiring the orphaned hard-pinned mono font-family a font audit should
  // have caught), the centered modal placement, the backdrop scrim, the inert background, the
  // focus-trap + aria-modal, the focus-into-dialog, and Escape participation (via ui.js's single
  // arbiter → dismissTop → close). So the bespoke dark `--panel` card, the red h1 gradient, the red
  // step-numbers, the mono pin, and the hand-rolled inert/trap are all GONE — replaced by the kit.
  //
  // The CONTENT styles below (the centered hold layout, the legible sub copy, the step list) are the
  // only CSS this module still owns; they carry NO accent hue (neutral --fg) so nothing reintroduces
  // red on any tier — the kit chrome is colorless by design (#729). The CTAs compose the element kit
  // (.ow-btn / .ow-btn-secondary / .ow-btn-prominent) which brings its own legible glass styling +
  // focus ring. We keep the legacy `.ob-card` / `ob-btn` class HOOKS (additive) so existing JS/tests
  // that select them keep working.
  function ensureContentCss() {
    if (document.getElementById("ob-content-css")) return;
    const st = document.createElement("style");
    st.id = "ob-content-css";
    st.textContent = `
      #orwell-onboarding .ob-hold { text-align: center; padding: .2rem 0; }
      /* J2-11: an explicit ~82% of --fg so the sub copy clears 4.5:1 on every house theme. */
      #orwell-onboarding .ob-hold .ob-hold-sub { color: color-mix(in srgb, var(--fg, #fff) 82%, transparent);
        font-size: var(--ow-fs-body, .875rem); margin: .5rem 0 0; line-height: 1.5; }
      #orwell-onboarding h1 { font-size: var(--ow-fs-title, 1.5rem); font-weight: 600; letter-spacing: -0.02em;
        margin: 0 0 .25rem; color: var(--fg, #fff); }
      #orwell-onboarding .ob-steps { text-align: left; margin: 1rem 0 .2rem; padding: 0; list-style: none;
        font-size: .85rem; line-height: 1.6; color: color-mix(in srgb, var(--fg, #fff) 88%, transparent); }
      #orwell-onboarding .ob-steps li { margin: .15rem 0; }
      /* Neutral step-numbers (no --red/--brand-color anywhere — the kit chrome is colorless). */
      #orwell-onboarding .ob-steps .ob-step-n { display: inline-block; width: 1.4rem; font-weight: 700;
        color: var(--fg, #fff); }
      #orwell-onboarding .ob-hold-actions { display: flex; gap: .6rem; justify-content: center;
        margin-top: 1.1rem; flex-wrap: wrap; }
      /* Desktop weight: the kit window is auto-sized to content; give it a confident min-width on wide
         screens (mobile/narrow keeps the kit's max-width:64vw clamp). */
      @media (min-width: 1024px) {
        #orwell-onboarding .ob-card { min-width: 480px; }
        #orwell-onboarding h1 { font-size: var(--ow-fs-title-lg, 1.85rem); }
      }
    `;
    document.head.appendChild(st);
  }

  // Build an onboarding modal ON THE WINDOW KIT and open it. Returns { el, card, win }:
  //   • el   — the kit window element; carries id="orwell-onboarding" (the dedupe guard + every
  //            `getElementById("orwell-onboarding")` / `data-ob-*` selector keep working).
  //   • card — the kit .ow-body, ALSO tagged `.ob-card` (legacy hook) — the content host.
  //   • win  — the OrwellWindow instance (so the caller can win.close()).
  // The kit's modal:true gives scrim + inert + focus-trap + aria-modal + center + Escape; we pass an
  // onClose so the caller's dismiss runs whether the user hits Escape or our own buttons. The card is
  // a BLOCKING dialog: not minimizable (a scrim'd modal in a dock chip is nonsense), not draggable/
  // resizable (it's centered + transient), and persistLayout:false so it always re-centers.
  function buildOverlay(opts) {
    ensureContentCss();
    const o = opts || {};
    const card = document.createElement("div");
    card.className = "ob-card";          // legacy hook; the kit hosts it as the .ow-body content
    card.setAttribute("tabindex", "-1");
    const win = window.OrwellWindowKit.create({
      id: "orwell-onboarding",
      title: o.title || "Big Brother production notice",
      modal: true,                       // scrim + inert background + focus-trap + aria-modal + Escape (kit-owned)
      minimizable: false,                // a blocking dialog never tucks to a dock chip
      closable: !!o.closable,            // no kit × by default — the way out is our own dismiss button + Escape
      draggable: false,
      resizable: false,
      persistLayout: false,              // always re-center; never carry a dragged offset
      content: card,
      onClose: () => { try { o.onClose && o.onClose(); } catch (_) {} },
    });
    win.open(document.activeElement);
    const el = win.el;                   // the kit sets el.id = "orwell-onboarding"
    return { el, card, win };
  }

  // A11Y belt: the kit's modal:true already inerts the background + traps focus + sets aria-modal
  // (it generalized THIS module's old welcome-modal pattern onto the kit). These thin helpers stay as
  // a defensive supplement (and to keep the no-trap source-pins literal): uninertBackground() is
  // idempotent and harmless when the kit already cleaned up. We no longer hand-roll the trap.
  let _inerted = [];
  function uninertBackground() {
    // Clear our own (belt) inert set AND sweep any lingering inert on the page's top-level children
    // (defensive: if the kit's teardown raced, no node is left unfocusable).
    _inerted.forEach((n) => { try { n.inert = false; } catch (_) {} });
    _inerted = [];
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
    let timer = null;
    let _down = false;
    // Single dismiss path: stop the poller, belt-clean inert, and close the kit window. Routed
    // through the kit's onClose so Escape (ui.js arbiter → dismissTop → close) and our own buttons
    // all converge here. Guarded so the close→onClose→close re-entry is a no-op.
    const dismiss = () => {
      if (_down) return; _down = true;
      if (timer) clearInterval(timer);
      uninertBackground();           // kit already un-inerts on teardown; belt-and-suspenders
      // destroy() is the SYNCHRONOUS teardown: it removes the scrim + un-inerts + drops the window
      // node immediately (no 190ms close animation), so the way-out is instant and leaves zero
      // residue — the no-trap contract (and the smoke's "dismiss like a person, then proceed").
      try { win.destroy(); } catch (_) {}
    };
    const { el, card, win } = buildOverlay({
      // Audit dedupe (TRANS-4/RESP-14/IA-22): the holding card rendered `title` TWICE — once in the
      // kit titlebar and again as the card's own <h1> hero ("The house is dark" appeared as both a
      // small titlebar label and the big heading). The <h1> is the intended styled hero, so let the
      // titlebar fall through to buildOverlay's generic framing ("Big Brother production notice")
      // instead — matching the setup wizard's framing-title + specific-H1 pattern, with no dupe.
      // (aria-label still names the dialog via the kit's framing title.)
      // Escape routes through the kit (ui.js arbiter → dismissTop → close → onClose). Converge it on
      // our dismiss so the poller stops + cleanup runs once (the _down guard makes re-entry a no-op).
      onClose: () => { if (!_down) { _down = true; if (timer) clearInterval(timer); uninertBackground(); } },
    });
    // Tag a blocking HOLDING card (vs. the welcome modal) so the model-config
    // auto-advance (orwell:models-changed) can clear it immediately instead of
    // waiting on the 5s re-probe. The welcome modal carries no such tag, so the
    // auto-advance never yanks a welcome the player is reading.
    el.setAttribute("data-ob-holding", "");
    card.innerHTML = `
      <div class="ob-hold">
        <h1>${title}</h1>
        <p class="ob-hold-sub">${sub}</p>
        <div class="ob-hold-actions"></div>
      </div>`;
    // Expose the dismiss so the auto-advance can tear this card down cleanly.
    el._obDismiss = dismiss;
    const row = card.querySelector(".ob-hold-actions");
    (actions || []).forEach((a) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ow-btn " + (a.primary ? "ow-btn-prominent ob-btn ob-btn-primary" : "ow-btn-secondary ob-btn");
      b.textContent = a.label;
      // Dismiss FIRST: the action's target (e.g. the Settings modal) must not open behind
      // the overlay's inert wall.
      b.addEventListener("click", () => { dismiss(); try { a.onClick && a.onClick(); } catch (_) {} });
      row.appendChild(b);
    });
    const d = document.createElement("button");
    d.type = "button";
    d.className = "ow-btn ow-btn-secondary ob-btn";
    d.setAttribute("data-ob-dismiss", "");
    d.textContent = "Go in anyway"; // CONT-1: in-fiction dismiss (was the OOC "Continue anyway")
    d.addEventListener("click", dismiss);
    row.appendChild(d);
    // Escape is owned by the kit (ui.js single arbiter → dismissTop → close → onClose), but keep an
    // explicit "Escape" listener on the card as a belt so a focused-card keypress always dismisses.
    el.addEventListener("keydown", (e) => { if (e.key === "Escape") dismiss(); });
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
  // Shown on EVERY fresh game/season, pre-game, AFTER the model is configured. It greets the
  // player, frames the show, then on dismiss opens the fresh interview session AND fires the
  // producers' hidden kickoff (the producers reach out first). Unlike the holding cards this is
  // NOT a blocker — it is the welcome — so dismissing it ("Let's go") simply proceeds.
  //
  // OOBE re-sequence (2026-06-20): the welcome now shows on every fresh game/season, not once per
  // account. The per-user seen-marker still prevents it re-showing on every page RELOAD within the
  // same pre-game session (set on dismiss); the restart/new-season/reset entry points CLEAR the
  // marker (via clearWelcomeSeen() in _orwellMarkRestart) so a brand-new season greets again. The
  // first-ever game shows it with the marker unset.
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
  // OOBE re-sequence: a fresh game/season must greet again. The restart entry points clear the
  // per-user marker so route()'s `!welcomeSeen()` re-shows the welcome for the new season. Kept
  // server-agnostic (it's a local reload-debounce only; the authoritative pre-game signal is the
  // engine's `started === false`), so clearing it never desyncs cross-device casting state.
  function clearWelcomeSeen() {
    try { localStorage.removeItem(welcomeKey()); } catch (_) {}
  }

  // ── The SETUP WIZARD (pre-game) ──────────────────────────────────────────────────────────
  // Replaces the old verbose welcome modal. The ONLY welcome copy is the framing line
  // "Production needs the feeds" (per the owner request) — everything else is feed/model SETUP,
  // borrowed from the Settings model controls. It is the single pre-game gate after a feed exists:
  // it shows which models will run the season (the OOB defaults — deepseek-v4-pro narrator,
  // gemini-2.5-flash-image portraits), lets the player open the real Settings model controls to
  // pick their OpenRouter models, and ONLY starts the season on an explicit "Start casting".
  //
  // PREMATURE-START FIX: the casting kickoff used to fire the instant a feed was probed (the
  // orwell:models-changed auto-advance ran straight to the welcome→kickoff), so the season began
  // before the player could choose their models. Now the kickoff fires ONLY from this wizard's
  // "Start casting" button; adding/changing a feed merely re-renders the wizard's model summary
  // (and enables Start once a chat model resolves). The player owns the moment the game begins.
  //
  // M2-1 (audit B1): the first screen leads with the SHOW, never the plumbing — raw provider/model
  // ids ("z-ai/glm-5.2") read as debug chrome above the fantasy. Humanize an id for display
  // ("Narrator: GLM 5.2"); the RAW id stays visible only inside the real Settings model controls
  // (the "Production settings" door). Display-only — resolution still uses the raw id everywhere.
  function humanizeModelId(id) {
    if (!id) return "";
    const seg = String(id).split("/").pop().split(":")[0];
    const CAPS = {
      glm: "GLM", gpt: "GPT", deepseek: "DeepSeek", qwen: "Qwen", gemini: "Gemini",
      llama: "Llama", claude: "Claude", seedream: "Seedream", mistral: "Mistral",
      flash: "Flash", image: "Image", pro: "Pro", mini: "Mini", nano: "Nano", chat: "Chat",
    };
    return seg.split("-").map((t) => {
      const k = t.toLowerCase();
      if (CAPS[k]) return CAPS[k];
      if (/^v?\d/.test(k)) return k.toUpperCase();
      return t.charAt(0).toUpperCase() + t.slice(1);
    }).join(" ");
  }

  // The model summary is read from the same projections the chatbox + Settings use
  // (GET /api/default-chat for the narrator, GET /api/auth/settings for image_model), so what the
  // wizard shows is exactly what will run — no parallel source of truth.
  async function _setupModelSummary() {
    let chat = "", image = "";
    try {
      const r = await fetch("/api/default-chat", { credentials: "same-origin" });
      if (r.ok) { const d = await r.json(); chat = (d && (d.model || d.default_model)) || ""; }
    } catch (_) {}
    try {
      const r = await fetch("/api/auth/settings", { credentials: "same-origin" });
      if (r.ok) { const d = await r.json(); image = (d && (d.image_model || (d.settings && d.settings.image_model))) || ""; }
    } catch (_) {}
    return { chat, image };
  }

  function mountSetup(onProceed) {
    if (document.getElementById("orwell-onboarding")) return;
    let _down = false;
    const { el, card, win } = buildOverlay({
      title: "Big Brother production setup",
      // Escape / kit teardown routes here too — run the same dismiss (markWelcomeSeen + bridge +
      // onProceed). _down guards the close→onClose→close re-entry so it fires once.
      onClose: () => { if (!_down) dismiss(); },
    });
    el.setAttribute("data-ob-setup", ""); // tag so the model-change re-render can find + refresh it
    // The framing line + a compact model summary borrowed from Settings. "Auto-detect" is shown for
    // an empty image_model (which resolves to the gemini default at generation time).
    // M2-1 (audit B1): the cold open leads with the SHOW FANTASY — one h1, one primary CTA
    // ("Enter the house"). The model summary is demoted to one humanized production line
    // (never a raw provider/model id — humanizeModelId), and the config door is a quiet
    // "Production settings" link under the CTA, not a peer button.
    card.innerHTML = `
      <div class="ob-hold">
        <h1>Welcome to the Big Brother house</h1>
        <p class="ob-hold-sub">Sixteen strangers sealed inside, every camera live — and one of the
          sixteen is you. Step in and casting begins; the producers reach out first.</p>
        <div class="ob-setup-models" aria-live="polite">
          <p class="ob-hold-sub ob-setup-feeds">This season's production feeds —
            <span class="ob-setup-chat">Narrator: <b>…</b></span> ·
            <span class="ob-setup-image">Portraits: <b>…</b></span></p>
        </div>
        <div class="ob-hold-actions"></div>
      </div>`;
    const row = card.querySelector(".ob-hold-actions");

    // Refresh the model summary + the Start button's enabled state. Start gates on a configured
    // FEED (the same anyModelConfigured() signal route() uses to mount this wizard) — NOT on
    // /api/default-chat resolving a concrete id. A feed guarantees the chat dispatch can resolve a
    // narrator model at turn time (the fallback chain → first enabled endpoint), and the two probes
    // can legitimately disagree (the default model may not be a literal catalog id yet). The chat
    // summary is display-only; an unresolved id shows "resolving…" but never blocks Start.
    let _startBtn = null;
    let _startHint = null;
    // M1-6 (audit A6): the gated CTA must never sit silently disabled — while Start waits
    // on a feed, a visible hint says WHY and a poll re-probes (the models-changed event can
    // race a settings write, which left the button dead for 30s+ with no cue). The gate
    // itself is honest and stays: no narrator feed ⇒ the house cannot speak, so Start does
    // not fail-open — it explains and keeps checking.
    let _startPoll = null;
    let _startPollT0 = 0;
    const _stopStartPoll = () => { if (_startPoll) { clearInterval(_startPoll); _startPoll = null; } };
    const refresh = async () => {
      const [{ chat, image }, hasFeed] = await Promise.all([_setupModelSummary(), anyModelConfigured()]);
      const chatEl = card.querySelector(".ob-setup-chat b");
      const imgEl = card.querySelector(".ob-setup-image b");
      // M2-1: humanized display only — the raw id never renders on the first screen.
      if (chatEl) chatEl.textContent = humanizeModelId(chat) || (hasFeed ? "resolving from your feed…" : "— connect a feed —");
      if (imgEl) imgEl.textContent = humanizeModelId(image) || "Auto-detect (Gemini)";
      if (_startBtn) {
        _startBtn.disabled = !hasFeed;
        _startBtn.title = hasFeed ? "" : "Connect a feed in Settings first — the house can't speak without a narrator model.";
      }
      if (_startHint) {
        if (hasFeed) {
          _startHint.hidden = true;
          _stopStartPoll();
        } else {
          const waited = _startPollT0 ? Math.round((Date.now() - _startPollT0) / 1000) : 0;
          _startHint.hidden = false;
          _startHint.textContent = waited > 45
            ? "Still no narrator feed — open Production settings and connect one (Enter unlocks the moment it lands)."
            : "Start unlocks once a narrator feed connects — checking…";
          if (!_startPoll) {
            _startPollT0 = Date.now();
            _startPoll = setInterval(refresh, 2500);
          }
        }
      }
    };
    // Re-render when the player connects/changes a feed in Settings (no premature kickoff — this
    // only updates the summary + enables Start). Cleaned up on dismiss so it never leaks.
    const onModels = () => { refresh(); };
    window.addEventListener("orwell:models-changed", onModels);

    const dismiss = () => {
      if (_down) return; _down = true;
      _stopStartPoll(); // M1-6: never leak the feed re-probe past the card
      try { window.removeEventListener("orwell:models-changed", onModels); } catch (_) {}
      markWelcomeSeen();
      uninertBackground();
      // R7 (audit anim-F4): BRIDGE the welcome→cast-photo-box handoff. Removing the welcome overlay
      // un-hides the empty-state splash (brand + tagline) for the ~120-180ms before the box mounts,
      // a visible flash. A transient body class keeps the splash suppressed across that gap; the box
      // clears it on mount (then its own ow-casting-headshot-open continues the suppression), and a
      // fallback timer clears it if the box never mounts (photo already handled / no producer turn).
      try {
        document.body.classList.add("ow-onboarding-bridge");
        clearTimeout(window._owOnboardingBridgeTimer);
        window._owOnboardingBridgeTimer = setTimeout(function () {
          try { document.body.classList.remove("ow-onboarding-bridge"); } catch (_) {}
        }, 4000);
      } catch (_) {}
      // destroy() = synchronous teardown: removes the scrim + un-inerts + drops the node immediately
      // (no 190ms close animation), so the handoff to onProceed never races a lingering scrim.
      try { win.destroy(); } catch (_) {}
      // Dismissing the setup wizard via "Start casting" IS the proceed — onProceed opens the fresh
      // interview session and fires the producers' kickoff. The photo box appears MID-interview
      // (after the producers ask), not before, so there is no separate "image step" to hand off to.
      setOnboardingActive(false);
      try { onProceed && onProceed(); } catch (_) {}
    };

    // "Production settings" opens the REAL Settings model controls (the elements this wizard
    // borrows from) so the player can pick their OpenRouter narrator/portrait models. It does NOT dismiss
    // the wizard or start the game — Settings opens OVER it; on return the orwell:models-changed
    // re-render reflects the new pick and Start enables.
    //
    // #870: Settings (modal:true) and this wizard (modal:true) are now coordinated by the kit's
    // modal STACK. Opening Settings PUSHES it onto the stack and inerts the wizard beneath while
    // Settings is the live top; closing Settings POPS it and restores the wizard as the live,
    // interactive top. No manual inert dance — the old "uninert, open, re-inert on a 50ms timer"
    // hack was the symptom of the missing stack coordinator (it deadlocked when the two modals'
    // inert sets and scrims collided). Just open Settings; the stack does the rest.
    const go = document.createElement("button");
    go.type = "button";
    go.className = "ow-btn ow-btn-prominent ob-btn ob-btn-primary";
    go.setAttribute("data-ob-setup-start", "");
    go.textContent = "Enter the house"; // M2-1: the one cold-open CTA (was "Start casting")
    go.disabled = true; // enabled by refresh() once a narrator model resolves (avoids the async race)
    go.addEventListener("click", () => { if (!go.disabled) dismiss(); });
    row.appendChild(go);

    // M2-1: the config door DEMOTED to a quiet link under the CTA (was a peer button). Same
    // behavior: opens the REAL Settings model controls over the wizard (the kit's modal stack
    // coordinates inert/scrim — #870); raw model ids live THERE, never on this screen.
    const choose = document.createElement("button");
    choose.type = "button";
    choose.className = "ob-prod-settings-link";
    choose.setAttribute("data-ob-choose-models", "");
    choose.textContent = "Production settings";
    choose.addEventListener("click", () => {
      try { openSettings(); } catch (_) {}
    });
    row.appendChild(choose);
    _startBtn = go;
    // M1-6: the why-is-Start-disabled cue, under the button row (refresh() owns its text).
    const hint = document.createElement("div");
    hint.className = "ob-start-hint";
    hint.hidden = true;
    row.insertAdjacentElement("afterend", hint);
    _startHint = hint;

    // Escape is owned by the kit (ui.js arbiter → dismissTop → close → onClose → dismiss); keep an
    // explicit card listener as a belt so a focused-card keypress always dismisses.
    el.addEventListener("keydown", (e) => { if (e.key === "Escape") dismiss(); });
    setOnboardingActive(true); // suppress the splash tip/tagline while the wizard is up
    // The kit already appended the window, inerted the background, trapped focus, and landed
    // focus on the ring-free window root on open(). #837: keep focus on the ring-free card
    // root on spawn rather than stealing it to the primary CTA — auto-focusing the Start
    // button would paint a focus ring the player never keyboard-asked for. A Tab still
    // reaches Start (and rings, as keyboard intent should).
    try { card.focus({ preventScroll: true }); } catch (_) {}
    refresh(); // populate the model summary + Start enabled-state
  }

  // The remedy the J4 card names: the workspace's own settings trigger. Called AFTER
  // dismiss so the modal never opens behind the inert wall.
  //
  // L2 (OOBE play-through): #rail-settings only un-hides the sidebar and scrolls — it does
  // NOT open the settings modal (see app.js). Clicking it left the player back at the chat
  // with no settings UI. The button that actually opens Settings is the user-bar gear
  // (#user-bar-settings → settings.js open()), so prefer it; fall back to the rail button
  // as a last resort. (FEJS-2: dropped a dead `window.settingsModule` fallback — settings.js
  // exports an ES-module default that is never attached to window, so it could never fire.)
  function openSettings() {
    const gear = document.getElementById("user-bar-settings");
    if (gear) { gear.click(); return; }
    const rail = document.getElementById("rail-settings");
    if (rail) rail.click();
  }

  // Seam for the headless browser gate: mount the dark-house holding card on demand.
  window._orwellOnboardingMount = function () {
    mountHolding("The house is dark",
      "Big Brother will return. The live feeds are down for a moment — this screen will clear the instant they're back.",
      async () => { try { return !!(await fetchState()); } catch (_) { return false; } });
  };

  // Seam for the headless browser gate: mount the welcome modal on demand.
  window._orwellWelcomeMount = function () { mountSetup(); };

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

  // F7 + 0064: open the interview in the user's CANONICAL game chat so every device converges on the
  // SAME conversation (the existing cross-device live-sync then keeps both screens in sync) — instead
  // of each device starting its own parallel casting interview (the two-device bug). Runs ONCE per
  // interview per tab (sessionStorage marker). There is NO composer prefill — the image step is the
  // player's first interaction and the producers open the conversation.
  //
  // Fail-open at every step: any hiccup falls back to the old behavior (open a fresh local chat; the
  // server binds THAT session as canonical on its first framed casting turn, so the next device
  // resolves and converges onto it).
  // ADR 0012 §3.3 — converge this window onto the user's CANONICAL game chat. Resolves the bound id
  // (GET /api/orwell/game-session) and, if it is a known session, OPENS it (never a second chat) so
  // every device shares ONE game and its live run mirrors in lockstep. Returns true if a canonical
  // chat was resolved (whether or not we had to switch to it), false if nothing is bound yet. This is
  // the shared kernel of the casting-phase convergence; route() also calls it on the started-season
  // branch so a window opened FRESH mid-game (the live two-window split-brain) joins the shared game.
  async function _convergeOnCanonicalGame() {
    const sm = window.sessionModule;
    let bound = null;
    try {
      const r = await fetch("/api/orwell/game-session", { credentials: "same-origin" });
      if (r.ok) bound = (await r.json()).sessionId || null;
    } catch (_) { /* fail open */ }
    if (!bound) return false;
    if (sm && sm.selectSession) {
      try {
        const known = !sm.getSessions || (sm.getSessions() || []).some((s) => s && s.id === bound);
        if (known && !(sm.getCurrentSessionId && sm.getCurrentSessionId() === bound)) {
          await sm.selectSession(bound);
        }
      } catch (_) { /* fall through */ }
    }
    return true;
  }

  async function openFreshInterviewSession() {
    let seated = false;
    try { seated = sessionStorage.getItem(SEAT_TAKEN_KEY) === "1"; } catch (_) {}
    if (seated) return;
    try { sessionStorage.setItem(SEAT_TAKEN_KEY, "1"); } catch (_) {}

    // 1+2) A canonical game session already bound (e.g. another device opened it)? Open it — the
    // convergence; never a second chat.
    if (await _convergeOnCanonicalGame()) return;

    // 3) Nothing bound (or it's gone): open a fresh chat as before. The server binds this session
    //    as canonical on its first framed (casting) turn, so the next device converges onto it.
    try {
      const nb = document.getElementById("sidebar-new-chat-btn") || document.getElementById("rail-new-session");
      if (nb) nb.click();
    } catch (_) {}
  }

  // L5 → P1 → OOBE re-sequence (2026-06-20): the casting cutover. The PRODUCERS open the show — the
  // player never types the opening word. We auto-send ONE kickoff with the user bubble HIDDEN, so
  // the first VISIBLE message in the chat is the producers reaching out, not a player line. The
  // model (under the pre-game/casting moment prompt) opens the interview, and — per the new
  // sequence — asks about the CAST PHOTO first (the photo box pops up after that question lands).
  //
  // OOBE re-sequence: this kickoff now fires when the WELCOME is dismissed (route()'s onProceed),
  // NOT after the photo is secured. The photo is no longer the first step — the interview is, and
  // the photo box appears mid-interview. (orwellHeadshot.js no longer calls this on finalize; it
  // fires the SEPARATE _orwellResumeAfterPhoto cue instead.)
  //
  // This is a deliberate, scoped departure from "the player owns the first keypress" — only at this
  // single handoff, game-build only, fired once. Guards: never override the player's own typing or
  // an in-flight stream, and never fire if a started game's conversation is already underway.
  const OPEN_GAME_LINE =
    "(Production cue — begin the casting interview now. Reach out to me first, in character as the " +
    "producers; do not wait for me to speak.)";
  // 0064 §D — the kickoff must fire ONCE PER GAME, not once per device. A second device that already
  // received the producers' opener (via the canonical session's live sync) must NOT fire its own.
  // DOM belt: only open the cue when the conversation is genuinely empty (no assistant turn yet); a
  // second device finding the opener already there simply renders it and joins live.
  function _conversationHasAssistantTurn() {
    try {
      const hist = document.getElementById("chat-history");
      if (hist && hist.querySelector(".msg.msg-ai")) return true;   // chatRenderer uses .msg-ai
    } catch (_) {}
    return false;
  }
  // #968 — a transient, Vault-free "the producers are getting the house ready" indicator. Cast
  // seeding/pre-warm is kicked fire-and-forget when Settings closes (_orwellWarm("prewarm-cast")
  // below); with NO player-visible signal the setup reads as FROZEN. This surfaces a NON-BLOCKING,
  // advisory toast off the prewarm response (counts/flags only — never any cast content). It is purely
  // advisory: the engine's deterministic floor stands if no model is wired (the response then reports
  // warmed:false and we simply don't trumpet a warm). Rendered via the OrwellNotice kit's ephemeral
  // toast (auto-dismissing, out of the chat flow); fail-soft (no kit ⇒ silent no-op). This is NOT a
  // game-change signal — it never dispatches orwell:gamechanged (the g15 single dispatcher in
  // platform.js owns that).
  const _SEEDING_NOTICE_ID = "orwell-seeding-indicator";
  let _seedingNotice = null;
  function _orwellShowSeedingIndicator(resp) {
    // Vault-free read: resp is {warmed, count, alreadyWarmed?} from prewarm-cast (counts + flags only).
    // We only show the advisory when seeding actually engaged (warmed). A deterministic-floor-only run
    // (no model wired ⇒ warmed:false) shows nothing — there is nothing to wait on.
    if (!resp || !resp.warmed) return;
    try {
      if (!(window.OrwellNoticeKit && typeof window.OrwellNoticeKit.create === "function")) return;
      // Reuse one card across re-route()s (the prewarm endpoint is idempotent and may be hit again);
      // a re-show with the same id keeps the single card and re-arms its auto-dismiss (no flicker).
      if (!_seedingNotice) {
        _seedingNotice = window.OrwellNoticeKit.create({
          id: _SEEDING_NOTICE_ID,
          kind: "toast",                 // ephemeral, out of the chat flow, auto-dismissing
          placement: "toast",
          severity: "info",
          icon: "info",
          dismissible: true,
          persistDismiss: false,         // advisory + transient — never write a "dismissed forever" bit
          autoDismissMs: 6000,           // a brief, non-blocking heads-up
        });
      }
      // Counts-only body: a houseguest count is Vault-free roster scale, never identity/content.
      const n = (resp.count | 0);
      const tail = n > 0 ? (" (" + n + " houseguests)") : "";
      _seedingNotice.setBody("Producers are getting the house ready…" + tail);
      _seedingNotice.show();             // idempotent: re-arms the timer if already up
    } catch (_) { /* advisory only — never block onboarding on the indicator */ }
  }

  // 0065 — cast pre-warm triggers (fire-and-forget; the server endpoints are idempotent). AUTHOR WARM
  // fires the instant a model is selectable (route(), before the interview); PORTRAIT WARM fires at the
  // first interview turn (the producers' opener) and the server holds it until authoring fully finishes.
  // #968: the AUTHOR WARM (prewarm-cast) response carries {warmed, count} — surface the advisory
  // seeding indicator off it so the setup never reads as frozen. The fetch stays best-effort.
  // #1035 (F-10) — DEDUP the AUTHOR-WARM trigger. route() fires _orwellWarm("prewarm-cast")
  // and re-fires on every orwell:models-changed (_reRouteAfterModelConfig), so a single pre-game
  // load kicked prewarm-cast TWICE (~28s apart). The server endpoint is idempotent (no duplicate
  // authoring), but the redundant request traffic is wasteful. A per-load once-guard collapses the
  // pre-game author-warm to a single fire; it is CLEARED on a genuine restart/new-season
  // (_orwellMarkRestart) so the next season re-warms its fresh cast.
  let _authorWarmKicked = false;
  function _resetAuthorWarmGuard() { _authorWarmKicked = false; }
  function _orwellWarm(path) {
    try {
      if (path === "prewarm-cast") {
        if (_authorWarmKicked) return;   // already kicked this pre-game pass — the endpoint is idempotent
        _authorWarmKicked = true;
      }
      const p = fetch("/api/orwell/" + path, { method: "POST", credentials: "same-origin" });
      if (path === "prewarm-cast") {
        p.then((r) => (r && r.ok ? r.json() : null))
          .then((resp) => { _orwellShowSeedingIndicator(resp); })
          .catch(() => {});
      } else {
        p.catch(() => {});
      }
    } catch (_) {}
  }

  let _openSent = false;
  window._orwellOpenGameAfterCasting = async function () {
    const gameBuild = document.body && document.body.hasAttribute("data-game-build");
    if (!gameBuild || _openSent) return;
    // Once-per-game: a producer opener already present (e.g. another device fired it and it synced
    // here) means we must never fire a second one.
    if (_conversationHasAssistantTurn()) { _openSent = true; return; }
    // #987 — DUPLICATE EMPTY "Casting interview" session guard. A FRESH surface (a 2nd tab/device, or a
    // reloaded tab) boots pre-game and routes through here; if it fires the kickoff cue, the hidden-cue
    // send MATERIALIZES a NEW per-tab session row (name "Casting interview", mode=null, 0 msgs) BEFORE
    // loadSessions()'s canonical-game ladder re-points to the REAL bound session — orphaning that new
    // row (0 msgs, mode=null, lastAccessed==createdAt). So: if a canonical game is ALREADY bound,
    // CONVERGE onto it and BAIL — never send the cue, never materialize a second per-tab identity.
    // _convergeOnCanonicalGame() returns true whenever a bound id resolves (its `known` flag only gates
    // the in-place selectSession, NOT the boolean return), so guarding on its result is reliable even
    // before the session is in getSessions(). Mark _openSent so a later re-route can't re-fire. This
    // ADDS a canonical-exists guard and keeps the existing _openSent / SEAT_TAKEN_KEY guards intact.
    try {
      if (await _convergeOnCanonicalGame()) { _openSent = true; return; }
    } catch (_) { /* fail open — fall through to the normal kickoff if the probe hiccups */ }
    if (_openSent) return;                                   // a concurrent path claimed the opener while we awaited
    if (_conversationHasAssistantTurn()) { _openSent = true; return; } // or an opener synced in mid-await
    _openSent = true;
    // 0065 PORTRAIT WARM: the interview is opening (the first turn) — kick the portrait warm. The server
    // HOLDS it until author warm has fully finished, so faces are never shot from a half-authored store.
    _orwellWarm("warm-portraits");
    // #967 (live re-fix) — the opener used to fire ONCE after a 250ms timeout: if a stream was settling
    // at that single tick (line 644 set `_openSent = false; return`) OR the send seam (`window.chatModule`)
    // wasn't ready yet, the cue was DROPPED with no reschedule and the chat sat silent — the player had to
    // speak first (the salvaged cold-start log: n_ai_msgs=0, the player sent the opening line). On a real
    // cold start the casting framing + prewarm POST + session materialization routinely leave a stream
    // busy / chatModule not-yet-bound at exactly 250ms. The #969 fix gave the RESUME cue a backoff retry
    // but left this OPENER single-shot. So mirror that retry here: when the turn is busy OR the send seam
    // isn't ready, DON'T drop — re-schedule with backoff until it settles, capped, and fail open to the
    // composer only after exhausting the rungs. The `_openSent` once-guard makes a retry idempotent.
    _sendCueWithBackoff({
      line: OPEN_GAME_LINE,
      // BUG FIX (item 6 — composer hangs mid-page): clear the welcome-active state at send time so the
      // composer DOCKS at the bottom immediately instead of staying lifted ~30vh up the page.
      onBeforeSend: () => { try { if (window.chatModule && window.chatModule.hideWelcomeScreen) window.chatModule.hideWelcomeScreen(); } catch (_) {} },
      // The opener is once-per-game (0064): if a producer opener arrived (synced from a peer) mid-retry,
      // stand down rather than fire a second one.
      shouldAbort: () => _conversationHasAssistantTurn(),
      // Clear the sent latch so a later re-route can try again — but ONLY if we never sent. (A genuine
      // send leaves the latch set by the helper; this re-arm fires only on the give-up branch.)
      onGiveUp: () => { _openSent = false; },
    });
  };

  // #967/#969 (shared) — fire a hidden producer cue ROBUSTLY: a single 250ms-then-drop send is the exact
  // bug both issues hit live (the cue is lost if a stream is settling OR `window.chatModule` isn't bound
  // yet at the one tick). This helper RE-SCHEDULES with backoff while the turn is busy OR the send seam
  // isn't ready, capped, and fails open to a focused composer only after exhausting the rungs. It is the
  // common kernel for the OPENER (#967) and the post-photo RESUME (#969). It NEVER stomps the player
  // (a typed composer or a `shouldAbort()` true ⇒ stand down). Fail-open by construction.
  const _CUE_MAX_ATTEMPTS = 8;     // ~250ms settle + up to 8 backoff rungs (400…3200ms) before failing open
  function _sendCueWithBackoff(opts) {
    const o = opts || {};
    const line = o.line;
    let _done = false;             // local per-call latch (in addition to the caller's once-guard)
    const composerBusy = () => {
      try {
        const box = document.getElementById("message");
        if (box && box.value.trim()) return true;   // the player is mid-thought — never stomp it
      } catch (_) {}
      return false;
    };
    const streamBusy = () => {
      try {
        return !!(window.chatModule && window.chatModule.hasActiveStream && window.chatModule.hasActiveStream());
      } catch (_) { return false; }
    };
    // The send seam (chat.js) is READY when chatModule exposes a programmatic send. On a fresh cold-start
    // load the IIFE may run this before chat.js has assigned window.chatModule — treat that as transient
    // (reschedule), NOT a permanent drop to box.focus() (the old bug).
    const seamReady = () => {
      try {
        return !!(window.chatModule
          && (typeof window.chatModule.sendHiddenCue === "function"
              || typeof window.chatModule.handleChatSubmit === "function"));
      } catch (_) { return false; }
    };
    const fire = () => {
      if (_done) return;
      const box = document.getElementById("message");
      if (!box) { _done = true; return; }           // no composer at all — nothing more to do
      _done = true;
      try { o.onBeforeSend && o.onBeforeSend(); } catch (_) {}
      try {
        if (window.chatModule && typeof window.chatModule.sendHiddenCue === "function") {
          // Send via the hidden-cue seam: hides the user bubble AND clears the composer synchronously so
          // the cue text never lingers visibly.
          window.chatModule.sendHiddenCue(line);
        } else if (window.chatModule && typeof window.chatModule.handleChatSubmit === "function") {
          // Legacy fallback: best-effort hide + submit (may flash the cue for a beat).
          try { if (window.chatModule.setHideUserBubble) window.chatModule.setHideUserBubble(); } catch (_) {}
          box.value = line;
          box.dispatchEvent(new Event("input", { bubbles: true }));
          window.chatModule.handleChatSubmit({ preventDefault() {} });
        } else {
          // No send seam even after the retries — fall back to a focused composer so the player can nudge
          // it (the give-up branch; the caller re-arms its once-guard via onGiveUp).
          box.focus();
          try { o.onGiveUp && o.onGiveUp(); } catch (_) {}
        }
      } catch (_) {
        try { o.onGiveUp && o.onGiveUp(); } catch (__) {}  // fail open — the composer is still the way in
      }
    };
    const attempt = (n) => {
      if (_done) return;
      try {
        if (composerBusy()) {                         // the player started typing — yield entirely
          _done = true;
          try { o.onGiveUp && o.onGiveUp(); } catch (_) {}
          return;
        }
        if (o.shouldAbort && o.shouldAbort()) {       // an opener already arrived (peer-synced) etc.
          _done = true;
          return;                                     // stood down on purpose — do NOT re-arm/give up
        }
        // A turn is still running OR the send seam isn't bound yet — DON'T drop; re-schedule with backoff
        // until it settles. Fail open to the composer only after exhausting the rungs.
        if (streamBusy() || !seamReady()) {
          if (n + 1 < _CUE_MAX_ATTEMPTS) {
            setTimeout(() => attempt(n + 1), 400 * (n + 1));
          } else {
            fire();                                   // last rung: fire anyway (best-effort / give-up)
          }
          return;
        }
        fire();
      } catch (_) { /* fail open */ }
    };
    setTimeout(() => attempt(0), 250);                // attempt 0 keeps the original 250ms settle beat
  }

  // OOBE re-sequence (2026-06-20): the post-photo RESUME cue. After the player finalizes or skips
  // the cast photo (orwellHeadshot.js tears the box down and calls this), nudge the producers to
  // acknowledge and CONTINUE the interview — so the conversation resumes smoothly instead of
  // sitting silent after the box disappears. Mirrors the open-game kickoff: hidden user bubble,
  // synchronous composer clear, game-build only, never over the player's own typing or an
  // in-flight stream. Unlike the opener this may fire AFTER the conversation is already underway
  // (the producers asked about the photo, the box came and went), so it does NOT bail on an
  // existing assistant turn — but it DOES bail if the player is mid-thought or a stream is running.
  const RESUME_AFTER_PHOTO_LINE =
    "(Production cue — the cast photo step is done; acknowledge it briefly, in character as the " +
    "producers, and continue the casting interview.)";
  // #969 — the resume cue used to fire ONCE after a 250ms timeout and then bail SILENTLY (no retry,
  // no deferred re-fire) if a stream was still in flight or the composer was busy at that tick. In the
  // OOBE sequence the photo box appears right after the producers' "send us a photo" turn, so that
  // turn's stream is often STILL SETTLING at the 250ms tick → the cue was dropped → the player had to
  // type "continue". An EARLIER retry pass (#969 first cut) covered `streamBusy` but STILL dropped the
  // cue permanently when the send seam (`window.chatModule`) wasn't bound yet (it fell straight to
  // box.focus() and latched sent) — so on a live finalize where the seam was momentarily unavailable the
  // resume never fired and the player again had to type "continue". The robust fix routes BOTH the opener
  // (#967) and this resume through the shared `_sendCueWithBackoff` kernel, which re-schedules on a busy
  // stream OR an unready seam (capped, fail-open) so neither cue is ever single-shot-dropped. The
  // `_resumeSent` once-guard makes a retry idempotent so it can never double-fire if the stream ends
  // between attempts.
  let _resumeSent = false;
  window._orwellResumeAfterPhoto = function () {
    const gameBuild = document.body && document.body.hasAttribute("data-game-build");
    if (!gameBuild || _resumeSent) return;
    _resumeSent = true;            // claim it up front; the helper's own per-call latch governs the send
    _sendCueWithBackoff({
      line: RESUME_AFTER_PHOTO_LINE,
      // Unlike the opener this may legitimately fire AFTER the conversation is underway (the producers
      // asked about the photo, the box came and went), so it does NOT abort on an existing assistant turn.
      // Re-arm only on a genuine give-up (player typed / no seam ever) so a later trigger can retry.
      onGiveUp: () => { _resumeSent = false; },
    });
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
  window._orwellMarkRestart = () => {
    try { window._orwellRestartArmed = true; } catch (_) {}
    // #1035 (F-10): a new season has a fresh cast — re-arm the author-warm so route() warms it once.
    try { _resetAuthorWarmGuard(); } catch (_) {}
    // OOBE re-sequence (2026-06-20): a restart/new-season/reset begins a FRESH casting flow, so the
    // welcome must greet again. Both genuine restart entry points (settings.js reset-progress and
    // orwellNewSeason.js next-season) call this, so clearing the per-user seen-marker here covers
    // them centrally — route() then re-shows the welcome (`!welcomeSeen()`) for the new season. The
    // initial first-season onboarding never calls markRestart, and the marker is already unset there.
    try { clearWelcomeSeen(); } catch (_) {}
  };
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
    // M1-7 (audit t-3): title the fresh season chat BY SEASON ("Season N") instead of
    // leaving every restart named by its casting smalltalk ("Casting interview" forever in
    // the sidebar). Best-effort: wait for the new-chat click to land a session id, read the
    // live season number, rename once. needs_auto_name() then skips a custom-named session,
    // so the title sticks.
    (async () => {
      try {
        const before = window.sessionModule && window.sessionModule.getCurrentSessionId
          ? window.sessionModule.getCurrentSessionId() : null;
        let sid = null;
        for (let i = 0; i < 10; i++) {
          await new Promise((r) => setTimeout(r, 200));
          const cur = window.sessionModule && window.sessionModule.getCurrentSessionId
            ? window.sessionModule.getCurrentSessionId() : null;
          if (cur && cur !== before) { sid = cur; break; }
        }
        if (!sid) return;
        const r = await fetch("/api/orwell/season", { credentials: "same-origin" });
        if (!r.ok) return;
        const season = ((await r.json()) || {}).season;
        if (!season || season < 1) return;
        await fetch(`/api/session/${sid}`, {
          method: "PATCH", credentials: "same-origin",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ name: "Season " + season }).toString(),
        });
        if (window.sessionModule && window.sessionModule.loadSessions) window.sessionModule.loadSessions();
      } catch (_) { /* best-effort — the auto-namer remains the fallback */ }
    })();
  };

  // Audit welcome-splash bleed-through: a started season is authoritative — the "Type /setup …"
  // splash must never ghost through behind the live game. Hide it (independent of history length)
  // and mark the shared flag so models.js won't rewrite the "/setup" copy back into welcome-sub.
  function _hideWelcomeForStartedGame() {
    try { window._orwellGameStarted = true; } catch (_) {}
    try {
      if (window.chatModule && typeof window.chatModule.hideWelcomeScreen === "function") {
        window.chatModule.hideWelcomeScreen();
      } else {
        const ws = document.getElementById("welcome-screen");
        const cc = document.getElementById("chat-container");
        if (ws) ws.classList.add("hidden");
        if (cc) cc.classList.remove("welcome-active");
      }
    } catch (_) {}
  }

  // Mid-session the season can flip started (casting → game). Re-check on the debounced
  // game-change signal (g15 single dispatcher — we only LISTEN, never dispatch) so a window
  // that was pre-game when it loaded still clears the splash the moment its season begins.
  async function _hideWelcomeIfStarted() {
    try {
      const st = await fetchState();
      if (st && st.started !== false) _hideWelcomeForStartedGame();
    } catch (_) {}
  }

  async function route() {
    const gameBuild = document.body && document.body.hasAttribute("data-game-build");
    // A STALE per-user welcome marker — one left by a prior game that a BACKEND/host factory reset
    // wiped (those resets run server-side and never reach the FE restart hooks in settings.js /
    // orwellNewSeason.js) — is cleared below so the welcome greets the new season. The "is this a
    // genuinely fresh season?" signal is the engine's empty intake + no rendered producer turn (see
    // the clear-gate in route()), NOT the per-tab seat flag — that flag is set by route() itself on
    // every pre-game load, so it skipped the welcome on a same-tab reload after a host reset (Thing 1).
    try {
      const st = await fetchState();
      if (!st || st.started !== false) {
        // A season is running (or the state is unreadable): the NEXT reset begins a new
        // interview, so clear the seat marker.
        try { sessionStorage.removeItem(SEAT_TAKEN_KEY); } catch (_) {}
        // Audit FLOW/TRANS/IA (welcome-splash bleed-through): the "Type /setup … Production
        // needs a feed source" welcome splash is gated only on chat-history length
        // (chatRenderer.hideWelcomeScreen fires on first bubble render). A started season that
        // hasn't rendered a bubble yet in THIS window (fresh tab, second device, cross-device
        // reconnect) left the splash mounted and ghosting through behind the live game/decision
        // cards. A season being started is authoritative: hide the splash regardless of history
        // length. Set a shared flag so models.js won't repopulate the "/setup" copy either.
        try { if (st && st.started !== false) _hideWelcomeForStartedGame(); } catch (_) {}
        // ADR 0012 §3.3 — generalize the casting-only convergence to every IN-GAME load: a window
        // opened fresh mid-game (new tab, second device, cleared storage) must JOIN the one bound
        // game chat, not sit on its own per-tab session and fork a parallel game (the live two-window
        // split-brain). Best-effort; the sessions.js canonical ladder is the primary belt — this just
        // makes the convergence fire reliably at app boot for a started season too.
        if (st && st.started !== false) { try { await _convergeOnCanonicalGame(); } catch (_) {} }
        return;
      }
      if (!(await anyModelConfigured())) {
        // Sequence the prerequisite (J4): production needs a feed source first. Admins get
        // pointed at setup — and a BUTTON that actually goes there (the copy's remedy must
        // be operable from the card; the page behind it is inert). Re-probe and continue.
        const admin = await isAdmin();
        mountHolding("No feed connected yet",
          "The house can't speak until a feed is live. " +
          (admin ? "Open Settings → Add Models to connect one — casting begins the moment the feed is up."
                 : "Ask your administrator to connect one — casting begins the moment the feed is up."),
          anyModelConfigured,
          admin ? [{ label: "Open Settings", primary: true, onClick: openSettings }] : []);
        return;
      }
      // Pre-game with a model configured: open the fresh interview session (F7), then show the
      // SETUP WIZARD (on EVERY fresh game/season). The wizard is the pre-game gate: dismissing it
      // via "Start casting" IS the proceed — onProceed opens the fresh interview session
      // (idempotent: the SEAT_TAKEN_KEY one-shot makes the second call a no-op) and fires the
      // producers' kickoff, so the interview opens AFTER the player confirms their models (NOT
      // automatically when a feed is probed — the premature-start fix). The chat is no longer
      // locked for the photo; the photo box appears mid-interview once the producers ask.
      await openFreshInterviewSession();
      // 0065 AUTHOR WARM: a model is configured and the season hasn't started — pre-seed + deeply author
      // the cast in the background NOW, before the interview, so it is fully authored before any portrait.
      _orwellWarm("prewarm-cast");
      const onProceed = async () => {
        try { await openFreshInterviewSession(); } catch (_) {}
        try { if (window._orwellOpenGameAfterCasting) window._orwellOpenGameAfterCasting(); } catch (_) {}
      };
      // A genuinely FRESH casting (the engine intake is empty — `casting.known` has no captured
      // fields) that this tab session never opened is a NEW season (incl. one begun by a backend/
      // host factory reset, which the FE restart hooks can't see). Clear any stale per-user welcome
      // marker so the !welcomeSeen() check below greets again. Gate on whether the interview has
      // actually begun (a rendered producer turn) — NOT the per-tab seat flag: route() sets that flag
      // on every pre-game load, so a same-tab reload after a host reset kept it true and skipped the
      // welcome (Thing 1). The conversation-emptiness signal is server-truth + DOM: a fresh reset has
      // an empty intake AND no assistant turn ⇒ greet again; a mid-interview reload has an assistant
      // turn ⇒ keep the marker and never re-pop.
      const _intakeEmpty = !!(st && st.casting && Object.keys(st.casting.known || {}).length === 0);
      if (_intakeEmpty && !_conversationHasAssistantTurn() && welcomeSeen()) {
        try { clearWelcomeSeen(); } catch (_) {}
      }
      if (!welcomeSeen()) {
        mountSetup(onProceed); // the pre-game setup wizard; "Start casting" opens the interview
      } else {
        // Already greeted this pre-game session (a reload mid-OOBE): don't re-show the welcome, but
        // still ensure the producers' kickoff has had its chance to open the interview (idempotent —
        // _openSent + the empty-conversation belt guard against a double opener).
        try { if (window._orwellOpenGameAfterCasting) window._orwellOpenGameAfterCasting(); } catch (_) {}
      }
    } catch (_) {
      // Engine unreachable: on the game build that's a dark house, not a silent skip (F5).
      if (gameBuild) window._orwellOnboardingMount();
    }
  }

  // P1 OOBE auto-advance: the whole flow must move WITHOUT a manual page reload. The
  // route() above ran once on load; re-run it agentically on the signals that change what
  // the flow should show — chiefly when the player connects an LLM feed in Settings.
  //
  //   Settings → LLM feed  →  SETUP WIZARD (confirm models)  →  "Start casting"  →
  //                           producers reach out first  →  photo box mid-interview (optional)
  //
  // models.js fires orwell:models-changed on the none→some transition. When it lands and a
  // blocking holding card (e.g. "Production needs the feeds") is still up, clear it immediately
  // (don't wait on its 5s re-probe) and re-evaluate so the setup wizard opens right away. A setup
  // wizard already showing carries no holding tag, so it's left alone — and it re-renders its own
  // model summary via its internal listener WITHOUT starting the season (the premature-start fix).
  function _reRouteAfterModelConfig() {
    const open = document.getElementById("orwell-onboarding");
    if (open && open.hasAttribute("data-ob-holding")) {
      // #925: prefer the holding card's own dismiss (it routes through win.destroy() → the kit
      // teardown that removes BOTH the window AND its modal scrim). The bare `open.remove()`
      // fallback dropped only the window NODE and stranded the [data-ow-scrim] backdrop — a
      // full-viewport orphan that then intercepts every click (the gear becomes unclickable). So
      // the fallback now also sweeps any matching scrim so no path here can orphan one.
      try {
        if (typeof open._obDismiss === "function") {
          open._obDismiss();
        } else {
          open.remove();
          try {
            document.querySelectorAll('[data-ow-scrim="orwell-onboarding"]')
              .forEach(function (s) { s.remove(); });
          } catch (_) {}
        }
      } catch (_) {}
      try { uninertBackground(); } catch (_) {}
    }
    route();
  }
  window.addEventListener("orwell:models-changed", _reRouteAfterModelConfig);
  // Clear the welcome splash the moment a season begins mid-session (casting → game), not only at boot.
  window.addEventListener("orwell:gamechanged", _hideWelcomeIfStarted);

  ready(route);
})();
