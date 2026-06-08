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
          width: 420px; max-width: 92vw;
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
      </style>
      <form class="ob-card" id="ob-form">
        <h1>Welcome to the house</h1>
        <p class="sub">Big Brother is watching. Create your houseguest to begin — the rest of the
          house is cast for you, and every conversation from here is in-character.</p>
        <label for="ob-name">Your houseguest's name</label>
        <input id="ob-name" name="name" autocomplete="off" required placeholder="e.g. Alex" />
        <div class="row">
          <div>
            <label for="ob-arche">Archetype <span style="opacity:.5">(optional)</span></label>
            <input id="ob-arche" name="archetype" autocomplete="off" placeholder="strategist…" />
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

  function mount() {
    if (document.getElementById("orwell-onboarding")) return;
    const el = buildOverlay();
    document.body.appendChild(el);
    const form = el.querySelector("#ob-form");
    const btn = el.querySelector("#ob-submit");
    const err = el.querySelector("#ob-err");
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
        el.remove(); // dissolve into the chat — the main chat is now in-character
      } catch (e2) {
        err.textContent = "Couldn't start the game: " + e2.message;
        btn.disabled = false;
      }
    });
  }

  ready(async () => {
    try {
      const st = await fetchState();
      if (st && st.started === false) mount();
    } catch (_) {
      // Engine unreachable → fail open; never block the normal chat.
    }
  });
})();
