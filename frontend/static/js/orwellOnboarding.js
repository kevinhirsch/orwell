// Orwell onboarding — first-class character creation folded into the MAIN app.
//
// On boot, if the engine reports no active game, this overlays a character-creation
// screen before the chat (it is NOT a separate page — it lives in the main app and
// dissolves into the chat once a houseguest exists). It uses only the Vault-free
// /api/orwell endpoints. It FAILS OPEN: if the engine is unreachable it never shows,
// so the normal chat is never blocked.
(function () {
  "use strict";

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
    el.setAttribute("aria-label", "Create your houseguest");
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
        #orwell-onboarding p.sub { margin: 0 0 1.1rem; font-size: .82rem; opacity: .7; line-height: 1.5; }
        #orwell-onboarding label { display: block; font-size: .8rem; opacity: .8; margin: .7rem 0 .3rem; }
        #orwell-onboarding input {
          width: 100%; padding: .6rem .7rem; box-sizing: border-box;
          background: var(--input-bg, rgba(255,255,255,.05)); color: var(--fg, #fff);
          border: 1px solid var(--input-border, var(--border, #355a66)); border-radius: 8px;
          font-family: inherit; font-size: .9rem;
        }
        #orwell-onboarding .row { display: flex; gap: .6rem; }
        #orwell-onboarding .row > div { flex: 1; }
        #orwell-onboarding button {
          margin-top: 1.2rem; width: 100%; padding: .7rem; cursor: pointer;
          background: var(--send-btn-bg, var(--red, #e06c75)); color: #fff;
          border: none; border-radius: 8px; font-family: inherit; font-weight: 600; font-size: .92rem;
        }
        #orwell-onboarding button[disabled] { opacity: .6; cursor: default; }
        #orwell-onboarding .err { margin-top: .8rem; font-size: .8rem; color: var(--red, #e06c75); min-height: 1em; }
        #orwell-onboarding .ob-chips { display: flex; flex-wrap: wrap; gap: .3rem; margin-top: .35rem; }
        #orwell-onboarding .ob-chip {
          cursor: pointer; font: inherit; font-size: .72rem; padding: .15rem .55rem; margin: 0;
          width: auto; border-radius: 999px; border: 1px solid var(--border, #355a66);
          background: rgba(255,255,255,.05); color: inherit;
        }
        #orwell-onboarding .ob-hold { text-align: center; padding: .4rem 0 .2rem; }
        #orwell-onboarding .ob-hold .ob-hold-sub { opacity: .7; font-size: .82rem; margin: .5rem 0 0; line-height: 1.5; }
      </style>
      <form class="ob-card" id="ob-form">
        <h1>Welcome to the house</h1>
        <p class="sub">Big Brother is watching. Create your houseguest to begin — the rest of the
          house is cast for you, and every conversation from here is in-character.
          Your strengths are drawn from who you are: like every houseguest, balanced — never
          invincible. The house plays fair, and so does the game.</p>
        <label for="ob-name">Your houseguest's name</label>
        <input id="ob-name" name="name" autocomplete="off" required placeholder="e.g. Alex" />
        <div class="row">
          <div>
            <label for="ob-arche">Archetype <span style="opacity:.5">(optional — these shape your hidden strengths)</span></label>
            <input id="ob-arche" name="archetype" autocomplete="off" placeholder="mastermind…" />
            <div class="ob-chips" id="ob-arche-chips" aria-label="Archetype suggestions"></div>
          </div>
          <div>
            <label for="ob-style">Strategy <span style="opacity:.5">(optional)</span></label>
            <input id="ob-style" name="style" autocomplete="off" placeholder="social…" />
          </div>
        </div>
        <button type="submit" id="ob-submit">Enter the house</button>
        <div class="err" id="ob-err" aria-live="polite"></div>
      </form>`;
    return el;
  }

  // A11Y-1: aria-modal is a PROMISE to assistive tech that the rest of the page is
  // inert — enforce it. Tab cycles inside the card; everything behind the scrim is
  // inert (unfocusable, unclickable) until the overlay resolves. Without this a
  // keyboard/screen-reader player tabbed straight out into a dead chat on their
  // very first screen.
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
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  function mount() {
    if (document.getElementById("orwell-onboarding")) return;
    const el = buildOverlay();
    document.body.appendChild(el);
    inertBackground(el);
    trapFocus(el);
    const form = el.querySelector("#ob-form");
    const btn = el.querySelector("#ob-submit");
    const err = el.querySelector("#ob-err");
    // Canonical archetypes (engine: characterFactory ARCHETYPES) as one-tap suggestions —
    // free text is still allowed; canonical words also steer the hidden stat derivation.
    const ARCHETYPES = ["mastermind", "social-butterfly", "comp-beast", "villain", "underdog",
      "flirt", "loyalist", "wildcard", "analyst", "hothead", "peacemaker", "floater"];
    const chipWrap = el.querySelector("#ob-arche-chips");
    if (chipWrap) {
      ARCHETYPES.forEach((a) => {
        const c = document.createElement("button");
        c.type = "button"; c.className = "ob-chip"; c.textContent = a;
        c.addEventListener("click", () => {
          const inp = el.querySelector("#ob-arche");
          inp.value = a; inp.dispatchEvent(new Event("input", { bubbles: true }));
        });
        chipWrap.appendChild(c);
      });
    }
    el.querySelector("#ob-name").focus();

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = el.querySelector("#ob-name").value.trim();
      if (!name) { err.textContent = "Please enter a name."; return; }
      btn.disabled = true; err.textContent = "Casting the house…";
      try {
        const body = { playerName: name };
        const a = el.querySelector("#ob-arche").value.trim();
        const s = el.querySelector("#ob-style").value.trim();
        if (a) body.archetype = a;
        if (s) body.strategyStyle = s;
        const r = await fetch("/api/orwell/new-game", {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || ("HTTP " + r.status));
        }
        uninertBackground();
        el.remove(); // dissolve into the chat — the main chat is now in-character
        // F7: a NEW SEASON gets a NEW chat session — the prior transcript (a finished or
        // reset season) must never ride along as context for the narrator.
        try {
          const nb = document.getElementById("sidebar-new-chat-btn") || document.getElementById("rail-new-session");
          if (nb) nb.click();
        } catch (_) {}
        // Nudge the status HUD to pick up the freshly-started game immediately.
        window.dispatchEvent(new Event("orwell:gamechanged"));
      } catch (e2) {
        err.textContent = "Couldn't start the game: " + e2.message;
        btn.disabled = false;
      }
    });
  }

  // Seam for the headless browser gate (and future flows): mount on demand.
  window._orwellOnboardingMount = mount;

  // J4: "is any chat model configured?" — the game cannot speak without one, and the old
  // flow let the player author a houseguest then dead-end at "No model selected".
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

  // F5: the engine is down on a GAME build — show the house, dark, instead of silently
  // dropping the player into a generic workspace welcome.
  function mountHolding(title, sub, readyAgain) {
    if (document.getElementById("orwell-onboarding")) return;
    const el = buildOverlay();
    const card = el.querySelector(".ob-card");
    card.innerHTML = `
      <div class="ob-hold">
        <h1>${title}</h1>
        <p class="ob-hold-sub">${sub}</p>
      </div>`;
    document.body.appendChild(el);
    inertBackground(el);
    trapFocus(el);
    // Re-probe quietly; dissolve back into the flow the moment the blocker clears.
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

  async function route() {
    const gameBuild = document.body && document.body.hasAttribute("data-game-build");
    try {
      const st = await fetchState();
      if (!st || st.started !== false) return; // game running (or unreadable): normal chat
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
      mount();
    } catch (_) {
      // Engine unreachable: on the game build that's a dark house, not a silent skip (F5).
      if (gameBuild) mountHolding("The house is dark",
        "Big Brother will return. The game engine isn't reachable right now — this screen will clear the moment the feeds come back.",
        async () => { try { return !!(await fetchState()); } catch (_) { return false; } });
    }
  }

  ready(route);
})();
