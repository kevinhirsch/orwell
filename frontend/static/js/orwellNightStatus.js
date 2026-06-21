// Orwell "Nightfall" gadget (ADR 0006 / feature 0066) — the at-a-glance read of the in-game night.
//
// Renders the engine's Vault-free time-of-day + who has TURNED IN for the night (state.asleep), so the
// player can SEE the house thin out as it gets late — the visible face of the nightly sleep economy
// (the cost of going to bed early / the reward of being a night owl). AUGMENTS the chat, never replaces
// it (ADR 0003): no click-to-act, no bedtime button — the player turns in by SAYING so in prose; the
// engine grounds the narration. Present ONLY while the in-game clock is running (the ORWELL_TIME_OF_DAY
// feature is on, per the settings switch); silent otherwise.
//
//   • GET /api/orwell/state → { started, timeOfDay, asleep: [{ id, name }], ... }
//
// Fail-open everywhere: no gadget on empty / error / pre-game / clock-off.
(function () {
  "use strict";

  const POLL_MS = 25000;
  const ID = "orwell-night";
  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn, { once: true })
      : fn();

  let timer = null;
  let _failures = 0;
  function _pollDelay() { return Math.min(POLL_MS * Math.pow(2, _failures), 120000); }

  async function getJSON(url) {
    const r = await fetch(url, { credentials: "same-origin" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  // The phase emoji IS the at-a-glance indicator (morning → late-night) — mirrors orwellStatusPanel.
  const TOD = {
    "morning": ["🌅", "Morning"],
    "afternoon": ["🌞", "Afternoon"],
    "evening": ["🌆", "Evening"],
    "night": ["🌙", "Night"],
    "late-night": ["🌌", "Late night"],
  };

  function ensureEl() {
    let el = document.getElementById(ID);
    if (el) return el;
    if (!document.getElementById("orwell-night-css")) {
      const st = document.createElement("style");
      st.id = "orwell-night-css";
      st.textContent = `
        #orwell-night {
          display: none;
          margin: var(--space-2) var(--space-2) 0;
          padding: var(--space-2) var(--space-3);
          background: color-mix(in srgb, var(--panel, #111) 70%, transparent);
          color: var(--fg, #9cdef2);
          border: 1px solid var(--border, #355a66); border-radius: 10px;
          font-family: 'Fira Code', ui-monospace, monospace;
          font-size: var(--fs-xs); line-height: 1.5;
        }
        #orwell-night .onight-hd {
          color: color-mix(in srgb, var(--fg, #9cdef2) 78%, var(--panel, #111));
          margin: 0 0 .3rem; font-weight: 600; letter-spacing: .03em;
          display: flex; align-items: center; gap: .4rem;
        }
        #orwell-night .onight-body { overflow-wrap: anywhere; }
        #orwell-night .onight-label { opacity: .6; }
        #orwell-night .onight-quiet { opacity: .6; font-style: italic; }`;
      document.head.appendChild(st);
    }
    el = document.createElement("section");
    el.id = ID;
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.setAttribute("aria-label", "Nightfall");
    el.innerHTML = `<div class="onight-hd" data-role="head"></div>` +
      `<div class="onight-body" data-role="body"></div>`;
    // 0054: prefer the control-room gadget rail, beside the other ambient house gadgets (presence).
    const rail = document.getElementById("gadget-rail-body");
    const sidebar = document.getElementById("sidebar");
    const anchor = document.getElementById("orwell-presence") || document.getElementById("orwell-status");
    if (rail && anchor && anchor.parentElement === rail) rail.insertBefore(el, anchor.nextSibling);
    else if (rail) rail.appendChild(el);
    else if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(el, anchor.nextSibling);
    else if (sidebar) sidebar.appendChild(el);
    else document.body.appendChild(el);
    return el;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function firstName(full) { return String(full || "").trim().split(/\s+/)[0] || ""; }

  function render(state) {
    const el = ensureEl();
    const tod = state && state.started ? state.timeOfDay : null;
    // Only while the in-game clock is actually running (the feature is on); otherwise the gadget is silent.
    if (!tod || !TOD[tod]) { el.style.display = "none"; el.removeAttribute("title"); return; }
    const [emoji, label] = TOD[tod];

    // HEADER: the phase indicator (emoji + label).
    el.querySelector("[data-role='head']").innerHTML =
      '<span aria-hidden="true">' + emoji + "</span><span>" + esc(label) + "</span>";

    // BODY: who has turned in for the night (Vault-free; the engine's observable `asleep` list).
    const asleep = Array.isArray(state.asleep) ? state.asleep : [];
    const body = el.querySelector("[data-role='body']");
    if (!asleep.length) {
      body.innerHTML = '<span class="onight-quiet">The whole house is still up.</span>';
      el.removeAttribute("title");
    } else {
      const names = asleep.map((p) => esc(firstName(p.name))).filter(Boolean).join(", ");
      body.innerHTML = '<span class="onight-label">Turned in (' + asleep.length + "):</span> " + names;
      el.setAttribute(
        "title",
        asleep.length + (asleep.length === 1 ? " houseguest has" : " houseguests have") + " turned in for the night",
      );
    }
    el.style.display = "block";
  }

  async function tick() {
    try {
      if (document.hidden) return; // a hidden tab polls nothing (C18)
      const state = await getJSON("/api/orwell/state");
      render(state || null);
      _failures = 0;
    } catch (_) {
      _failures += 1;
      if (window.OrwellReport) window.OrwellReport.fail("night", "state-poll", _); // G11: fail open, never silent
      render(null); // fail OPEN: the gadget simply isn't there
    } finally {
      if (timer) clearTimeout(timer);
      timer = setTimeout(tick, _pollDelay());
    }
  }

  function refreshNow() { _failures = 0; tick(); }

  ready(() => {
    // Only under the game build (the reduced surface) — the full workspace skips the gadget.
    if (document.body && document.body.dataset.gameBuild !== "1") return;
    tick();
    // Refresh on the shared game-changed signal (platform.js dispatches it after every engine-mutating
    // turn) so the house thins the moment the clock rolls and houseguests turn in.
    window.addEventListener("orwell:gamechanged", refreshNow);
    window.addEventListener("beforeunload", () => timer && clearTimeout(timer));
  });
})();
