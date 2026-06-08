// Orwell status panel — a compact, Vault-free HUD for the live Big Brother game.
//
// Polls the engine's public ceremony status (week / phase / HOH / nominees / veto)
// via GET /api/orwell/status and pins a small panel to the corner whenever a game
// is in progress. It shows ONLY ceremony-level public facts the engine projects —
// no stats, souls, or hidden state ever reach it (the Vault Wall holds on the
// engine side). It FAILS OPEN: if the engine is unreachable or no game is running,
// the panel simply hides and never disturbs the normal chat.
//
// Like the settings panel it is a real moveable window: drag it by its header and
// it remembers where you put it; minimize it to just the week/phase line. Both the
// position and the minimized state persist across reloads (localStorage).
import { makeWindowDraggable } from "./windowDrag.js";

(function () {
  "use strict";

  const POLL_MS = 20000;
  const POS_KEY = "orwell-status-pos";
  const MIN_KEY = "orwell-status-min";
  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn, { once: true })
      : fn();

  let timer = null;

  async function fetchStatus() {
    const r = await fetch("/api/orwell/status", { credentials: "same-origin" });
    if (!r.ok) throw new Error("status " + r.status);
    return r.json();
  }

  function restorePosition(el) {
    try {
      const pos = JSON.parse(localStorage.getItem(POS_KEY) || "null");
      if (pos && typeof pos.left === "number" && typeof pos.top === "number") {
        el.style.left = pos.left + "px";
        el.style.top = pos.top + "px";
        el.style.right = "auto";
      }
    } catch (_) {}
  }

  function setMinimized(el, on) {
    el.classList.toggle("os-collapsed", on);
    const btn = el.querySelector(".os-min");
    if (btn) { btn.textContent = on ? "+" : "–"; btn.title = on ? "Expand" : "Minimize"; }
    try { localStorage.setItem(MIN_KEY, on ? "1" : "0"); } catch (_) {}
  }

  function ensurePanel() {
    let el = document.getElementById("orwell-status");
    if (el) return el;
    el = document.createElement("div");
    el.id = "orwell-status";
    el.setAttribute("aria-live", "polite");
    el.innerHTML = `
      <style>
        #orwell-status {
          position: fixed; top: 64px; right: 14px; z-index: 9000;
          width: 220px; max-width: 60vw; display: none;
          background: var(--panel, #111); color: var(--fg, #9cdef2);
          border: 1px solid var(--border, #355a66); border-radius: 10px;
          padding: .7rem .8rem; box-shadow: 0 10px 30px rgba(0,0,0,.35);
          font-family: 'Fira Code', ui-monospace, monospace; font-size: .76rem; line-height: 1.5;
        }
        #orwell-status .os-hdr {
          display: flex; align-items: baseline; gap: .4rem;
          margin-bottom: .4rem; font-weight: 600; letter-spacing: .03em;
          cursor: move; user-select: none;
        }
        #orwell-status .os-ttl { display: flex; align-items: baseline; gap: .4rem; flex: 1; min-width: 0; }
        #orwell-status .os-hdr .os-phase { opacity: .65; font-weight: 400; text-transform: capitalize; }
        #orwell-status .os-min {
          cursor: pointer; border: none; background: none; color: inherit;
          opacity: .55; font-size: 1rem; line-height: 1; padding: 0 .15rem; margin-left: auto;
          font-family: inherit;
        }
        #orwell-status .os-min:hover { opacity: .9; }
        #orwell-status.os-collapsed { margin-bottom: 0; }
        #orwell-status.os-collapsed .os-hdr { margin-bottom: 0; }
        #orwell-status.os-collapsed .os-row { display: none; }
        #orwell-status .os-row { display: flex; gap: .4rem; }
        #orwell-status .os-row .os-k { opacity: .6; min-width: 4.2em; }
        #orwell-status .os-row .os-v { flex: 1; }
        #orwell-status .os-noms { color: var(--red, #e06c75); }
      </style>
      <div class="os-hdr" title="Drag to move">
        <span class="os-ttl"><span id="os-week">Week —</span><span class="os-phase" id="os-phase"></span></span>
        <button type="button" class="os-min" title="Minimize" aria-label="Minimize">–</button>
      </div>
      <div class="os-row"><span class="os-k">HOH</span><span class="os-v" id="os-hoh">—</span></div>
      <div class="os-row"><span class="os-k">Noms</span><span class="os-v os-noms" id="os-noms">—</span></div>
      <div class="os-row"><span class="os-k">Veto</span><span class="os-v" id="os-veto">—</span></div>`;
    document.body.appendChild(el);

    // Restore where the player last left it + whether it was minimized.
    restorePosition(el);
    try { if (localStorage.getItem(MIN_KEY) === "1") setMinimized(el, true); } catch (_) {}

    el.querySelector(".os-min").addEventListener("click", () =>
      setMinimized(el, !el.classList.contains("os-collapsed")));

    // A real moveable window: drag by the header, no dock/fullscreen/resize (it is a
    // small fixed-size HUD), and remember the final position. The minimize button is a
    // <button>, so the default skipSelector keeps a click on it from starting a drag.
    makeWindowDraggable(el, {
      content: el,
      header: el.querySelector(".os-hdr"),
      enableDock: false,
      enableFullscreen: false,
      enableResize: false,
      mobileSkip: 0,
      onDragEnd: ({ rect }) => {
        try { localStorage.setItem(POS_KEY, JSON.stringify({ left: rect.left, top: rect.top })); } catch (_) {}
      },
    });
    return el;
  }

  function render(st) {
    const el = ensurePanel();
    // No active game (engine reports week 0 / setup) → hide and keep polling.
    if (!st || typeof st.week !== "number" || st.week < 1) {
      el.style.display = "none";
      return;
    }
    const name = (c) => (c && c.name) || "—";
    el.querySelector("#os-week").textContent = "Week " + st.week;
    el.querySelector("#os-phase").textContent = st.phase || "";
    el.querySelector("#os-hoh").textContent = name(st.hoh);
    const noms = Array.isArray(st.nominees) ? st.nominees.map((n) => n.name).filter(Boolean) : [];
    el.querySelector("#os-noms").textContent = noms.length ? noms.join(", ") : "—";
    const veto = st.veto || {};
    el.querySelector("#os-veto").textContent = veto.used
      ? "used" + (veto.holder ? " · " + veto.holder.name : "")
      : (veto.holder ? veto.holder.name : "—");
    el.style.display = "block";
  }

  async function refresh() {
    try {
      render(await fetchStatus());
    } catch (_) {
      // Engine down / no game → hide, fail open.
      const el = document.getElementById("orwell-status");
      if (el) el.style.display = "none";
    }
  }

  function start() {
    refresh();
    if (timer) clearInterval(timer);
    timer = setInterval(refresh, POLL_MS);
  }

  // Let onboarding (or any flow that changes the game) trigger an immediate refresh.
  window.orwellRefreshStatus = refresh;
  window.addEventListener("orwell:gamechanged", refresh);

  ready(start);
})();
