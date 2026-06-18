// Orwell presence strip (feature 0049 / C28) — the AMBIENT ground for lingering play.
//
// Renders the engine's Vault-free whereabouts() — the player's room, who is in it, and who is
// one room over — as a light, dismissible strip. It AUGMENTS the chat and never replaces it
// (ADR 0003 §4/§7): there is no click-to-move, no button that starts a scene or advances the
// game — the player still mills, asks "who's here?", and talks in PROSE, and the engine grounds
// the narration. Fail-open everywhere: no strip on empty/error/pre-game.
//
//   • GET /api/orwell/state        → gate on an active game (started)
//   • GET /api/orwell/whereabouts  → { room, present[], nearby[{room, present[]}] } | null
//
// Dismissing hides the strip until the player's ROOM changes (new ground re-surfaces it) —
// ambient information, never a nag.
(function () {
  "use strict";

  const POLL_MS = 25000;
  const ID = "orwell-presence";
  const DISMISS_KEY = "orwell-presence-dismissed-room";
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

  function roomLabel(room) {
    // "living-room" → "Living room" (the engine's ids are kebab-case room names).
    // A lone trailing letter is a room identifier, not a word ("bedroom-b"), so it
    // must read "Bedroom B", not "Bedroom b" — sentence case otherwise.
    const s = String(room || "").replace(/-/g, " ").trim();
    if (!s) return s;
    return s
      .split(" ")
      .map((w, i) =>
        w.length === 1
          ? w.toUpperCase()
          : i === 0
            ? w.charAt(0).toUpperCase() + w.slice(1)
            : w)
      .join(" ");
  }

  function ensureEl() {
    let el = document.getElementById(ID);
    if (el) return el;
    // Sidebar chrome, NOT a floating strip (user verdict): a fixed bottom-center bar
    // covered the composer/chat. Dock it in #sidebar next to the game gadgets, mirroring
    // #orwell-status / #orwell-social (ruling #3/E64/H5) — static flow, full sidebar
    // width, no z-index, in the sidebar drawer on mobile like every other section.
    if (!document.getElementById("orwell-presence-css")) {
      const st = document.createElement("style");
      st.id = "orwell-presence-css";
      st.textContent = `
        #orwell-presence {
          display: none;
          margin: var(--space-2) var(--space-2) 0;
          padding: var(--space-2) var(--space-3);
          background: color-mix(in srgb, var(--panel, #111) 70%, transparent);
          color: var(--fg, #9cdef2);
          border: 1px solid var(--border, #355a66); border-radius: 10px;
          font-family: 'Fira Code', ui-monospace, monospace;
          font-size: var(--fs-xs); line-height: 1.5;
        }
        #orwell-presence .opres-hd {
          color: color-mix(in srgb, var(--fg, #9cdef2) 78%, var(--panel, #111));
          margin: 0 0 .3rem; font-weight: 600; letter-spacing: .03em;
        }
        #orwell-presence .opres-body { overflow-wrap: anywhere; }`;
      document.head.appendChild(st);
    }
    el = document.createElement("section");
    el.id = ID;
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.innerHTML = `<div class="opres-hd">Where you are</div>` +
      `<div class="opres-body" data-role="text"></div>`;
    // Mount inside the sidebar, beside the other game gadgets (the status HUD /
    // "Wants a word"). Fall back to the session list, then the sidebar, then body.
    // 0054: prefer the control-room gadget rail (under the other gadgets when present).
    const rail = document.getElementById("gadget-rail-body");
    const sidebar = document.getElementById("sidebar");
    const anchor = document.getElementById("orwell-status");
    if (rail && anchor && anchor.parentElement === rail) rail.insertBefore(el, anchor.nextSibling);
    else if (rail) rail.appendChild(el);
    else if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(el, anchor.nextSibling);
    else if (sidebar) sidebar.appendChild(el);
    else document.body.appendChild(el);
    return el;
  }

  function render(w) {
    const el = ensureEl();
    if (!w || !w.room) { el.style.display = "none"; return; }
    el.dataset.room = w.room;

    const names = (list) => list.map((p) => p.name).join(", ");
    const here = w.present && w.present.length ? "with " + names(w.present) : "alone";
    const nearby = (w.nearby || [])
      .filter((n) => n.present && n.present.length)
      .map((n) => roomLabel(n.room) + " (" + names(n.present) + ")")
      .join(" · ");
    el.querySelector("[data-role='text']").textContent =
      "📍 " + roomLabel(w.room) + " — " + here + (nearby ? "  ·  nearby: " + nearby : "");
    el.style.display = "block";
  }

  async function tick() {
    try {
      if (document.hidden) return; // a hidden tab polls nothing (C18)
      const state = await getJSON("/api/orwell/state");
      if (!state || !state.started) { render(null); return; }
      const data = await getJSON("/api/orwell/whereabouts");
      render(data ? data.whereabouts : null);
      _failures = 0;
    } catch (_) {
      _failures += 1;
      if (window.OrwellReport) window.OrwellReport.fail("presence", "whereabouts-poll", _); // G11: fail open, never silent
      render(null); // fail OPEN: the strip simply isn't there
    } finally {
      timer = setTimeout(tick, _pollDelay());
    }
  }

  ready(() => {
    // Only under the game build (the reduced surface) — the full workspace skips the strip.
    if (document.body && document.body.dataset.gameBuild !== "1") return;
    tick();
    window.addEventListener("beforeunload", () => timer && clearTimeout(timer));
  });
})();
