// Orwell onboarding — the casting-interview gate (feature 0050).
//
// Character creation IS the game's first scene: a producer-led casting interview conducted
// in the main chat (the engine injects the interview moment prompt pre-game; the model ends
// it by calling createCharacter with the player's distilled answers). On boot, if the engine
// reports no active game, this overlays a gate card — "the producers will see you now" —
// whose primary action dissolves into the chat and hands the player to the producer.
//
// House rule (ADR 0003): we PREFILL the composer and focus it; the player sends the first
// line themselves — never auto-send or fabricate a turn.
//
// A QUICK-START fallback (name-only form → POST /api/orwell/new-game) stays available so a
// player with no working model is never dead-ended (audit J4); the interview is the primary path.
//
// It FAILS OPEN: if the engine is unreachable it never shows, so the chat is never blocked.
(function () {
  "use strict";

  const SEAT_TAKEN_KEY = "orwell-interview-open"; // sessionStorage: don't re-block a reload mid-interview

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
    el.setAttribute("aria-label", "Your casting interview");
    el.innerHTML = `
      <style>
        #orwell-onboarding {
          position: fixed; inset: 0; z-index: 99999;
          display: flex; align-items: center; justify-content: center;
          background: color-mix(in srgb, var(--bg, #282c34) 88%, black);
          font-family: 'Fira Code', ui-monospace, monospace;
        }
        #orwell-onboarding .ob-card {
          width: 440px; max-width: 92vw;
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
        #orwell-onboarding button.primary {
          margin-top: .4rem; width: 100%; padding: .7rem; cursor: pointer;
          background: var(--send-btn-bg, var(--red, #e06c75)); color: #fff;
          border: none; border-radius: 8px; font-family: inherit; font-weight: 600; font-size: .92rem;
        }
        #orwell-onboarding button[disabled] { opacity: .6; cursor: default; }
        #orwell-onboarding .ob-alt { margin-top: 1rem; font-size: .75rem; opacity: .6; text-align: center; }
        #orwell-onboarding .ob-alt a { color: inherit; cursor: pointer; text-decoration: underline; }
        #orwell-onboarding #ob-quick { display: none; margin-top: .8rem; }
        #orwell-onboarding #ob-quick.open { display: block; }
        #orwell-onboarding label { display: block; font-size: .8rem; opacity: .8; margin: .7rem 0 .3rem; }
        #orwell-onboarding input {
          width: 100%; padding: .6rem .7rem; box-sizing: border-box;
          background: var(--input-bg, rgba(255,255,255,.05)); color: var(--fg, #fff);
          border: 1px solid var(--input-border, var(--border, #355a66)); border-radius: 8px;
          font-family: inherit; font-size: .9rem;
        }
        #orwell-onboarding .err { margin-top: .8rem; font-size: .8rem; color: var(--red, #e06c75); min-height: 1em; }
      </style>
      <div class="ob-card">
        <h1>Casting is now in session</h1>
        <p class="sub">Big Brother is watching — and the producers want to meet you. Take a seat
          for your casting interview: tell them who you are, what your game is, and what you're
          here to win. When it ends, the house gets cast around you and the season begins.</p>
        <button type="button" class="primary" id="ob-interview">The producers will see you now</button>
        <div class="ob-alt">In a hurry? <a id="ob-quick-link">Skip the interview — quick start</a></div>
        <form id="ob-quick">
          <label for="ob-name">Your houseguest's name</label>
          <input id="ob-name" name="name" autocomplete="off" placeholder="e.g. Alex" />
          <button type="submit" class="primary" id="ob-submit">Enter the house</button>
        </form>
        <div class="err" id="ob-err" aria-live="polite"></div>
      </div>`;
    return el;
  }

  /** Dissolve into the chat and hand the player to the producer (prefill, never auto-send). */
  function takeASeat(el) {
    try { sessionStorage.setItem(SEAT_TAKEN_KEY, "1"); } catch (_) {}
    el.remove();
    const box = document.getElementById("message");
    if (box) {
      box.value = "I take my seat for the casting interview.";
      box.dispatchEvent(new Event("input", { bubbles: true }));
      box.focus();
    }
  }

  function mount() {
    if (document.getElementById("orwell-onboarding")) return;
    const el = buildOverlay();
    document.body.appendChild(el);
    const err = el.querySelector("#ob-err");

    el.querySelector("#ob-interview").addEventListener("click", () => takeASeat(el));
    el.querySelector("#ob-interview").focus();

    el.querySelector("#ob-quick-link").addEventListener("click", () => {
      el.querySelector("#ob-quick").classList.add("open");
      el.querySelector("#ob-name").focus();
    });

    // Quick start: the legacy minimal path — name only, straight into the house.
    el.querySelector("#ob-quick").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = el.querySelector("#ob-name").value.trim();
      if (!name) { err.textContent = "Please enter a name."; return; }
      const btn = el.querySelector("#ob-submit");
      btn.disabled = true; err.textContent = "Casting the house…";
      try {
        const r = await fetch("/api/orwell/new-game", {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerName: name }),
        });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || ("HTTP " + r.status));
        }
        el.remove(); // dissolve into the chat — the main chat is now in-character
        // Nudge the status HUD to pick up the freshly-started game immediately.
        window.dispatchEvent(new Event("orwell:gamechanged"));
      } catch (e2) {
        err.textContent = "Couldn't start the game: " + e2.message;
        btn.disabled = false;
      }
    });
  }

  ready(async () => {
    try {
      const st = await fetchState();
      if (st && st.started === false) {
        // Mid-interview reloads keep the chat front and center (the gate already did its job).
        let seated = false;
        try { seated = sessionStorage.getItem(SEAT_TAKEN_KEY) === "1"; } catch (_) {}
        if (!seated) mount();
      } else if (st && st.started === true) {
        try { sessionStorage.removeItem(SEAT_TAKEN_KEY); } catch (_) {}
      }
    } catch (_) {
      // Engine unreachable → fail open; never block the normal chat.
    }
  });
})();
