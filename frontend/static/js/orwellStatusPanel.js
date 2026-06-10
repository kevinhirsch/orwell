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
// it remembers where you put it. Minimize sends it to the shared chip dock — the
// same "fly-out" strip every other minimized tool lands in — instead of collapsing
// in place, and the dock chip restores it.
import { makeWindowDraggable } from "./windowDrag.js";
import * as modalManager from "./modalManager.js";

(function () {
  "use strict";

  const POLL_MS = 20000;
  const ID = "orwell-status";
  const POS_KEY = "orwell-status-pos";
  const ICON = "<svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect x='3' y='3' width='18' height='18' rx='2'/><path d='M3 9h18M9 21V9'/></svg>";
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

  // The roster (C21): names + status only — Vault-free, exactly what a houseguest sees on
  // the memory wall. Best-effort: if /state fails the panel still shows the ceremony rows.
  async function fetchState() {
    try {
      const r = await fetch("/api/orwell/state", { credentials: "same-origin" });
      if (!r.ok) return null;
      return await r.json();
    } catch (_) { return null; }
  }

  // The player's OWN ceremony role from PUBLIC facts (HOH / on the block / veto) — derived by
  // id-comparison, never a "safe/target" read (0020). Returns "" when the player is just a
  // houseguest, or their out-of-game seat ("Evicted" / "Jury") when they're out.
  function selfBadge(status, state) {
    const me = state && state.player && state.player.id;
    const seat = state && state.player && state.player.status;
    if (seat === "evicted") return "EVICTED";
    if (seat === "jury") return "JURY";
    if (!me || !status) return "";
    const idOf = (c) => (c && typeof c === "object" ? c.id : c);
    if (idOf(status.hoh) === me) return "HOH";
    const noms = Array.isArray(status.nominees) ? status.nominees.map(idOf) : [];
    if (noms.includes(me)) return "ON THE BLOCK";
    const veto = status.veto || {};
    if (idOf(veto.holder) === me) return "VETO";
    return "";
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

  // True while the dock holds this panel minimized — the poll loop must not force it
  // back open on the next tick.
  function isMinimized() {
    try { return modalManager.isMinimized && modalManager.isMinimized(ID); } catch (_) { return false; }
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
        #orwell-status .os-row { display: flex; gap: .4rem; }
        #orwell-status .os-row .os-k { opacity: .6; min-width: 4.2em; }
        #orwell-status .os-row .os-v { flex: 1; }
        #orwell-status .os-noms { color: var(--red, #e06c75); }
        /* Memory wall (C21): the roster a real houseguest can see. Public facts only. */
        #orwell-status .os-you { margin: .45rem 0 .1rem; font-weight: 600; }
        #orwell-status .os-you .os-badge {
          display: inline-block; margin-left: .4rem; padding: 0 .4em; border-radius: .5em;
          font-size: .72em; font-weight: 700; letter-spacing: .02em;
          background: var(--accent, var(--red, #e06c75)); color: #fff;
        }
        #orwell-status .os-roster-h { opacity: .55; font-size: .8em; margin: .5rem 0 .15rem; }
        #orwell-status .os-roster { display: flex; flex-direction: column; gap: .05rem; }
        #orwell-status .os-hg { display: flex; justify-content: space-between; gap: .5rem; }
        #orwell-status .os-hg.os-out { opacity: .45; text-decoration: line-through; }
        #orwell-status .os-hg .os-seat { opacity: .6; font-size: .78em; text-decoration: none; }
      </style>
      <div class="os-hdr" title="Drag to move">
        <span class="os-ttl"><span id="os-week">Week —</span><span class="os-phase" id="os-phase"></span></span>
        <button type="button" class="os-min" title="Minimize" aria-label="Minimize">–</button>
      </div>
      <div class="os-you" id="os-you">You<span class="os-badge" id="os-you-badge" hidden></span></div>
      <div class="os-row"><span class="os-k">HOH</span><span class="os-v" id="os-hoh">—</span></div>
      <div class="os-row"><span class="os-k">Noms</span><span class="os-v os-noms" id="os-noms">—</span></div>
      <div class="os-row"><span class="os-k">Veto</span><span class="os-v" id="os-veto">—</span></div>
      <div class="os-roster-h" id="os-roster-h">The house</div>
      <div class="os-roster" id="os-roster"></div>`;
    document.body.appendChild(el);

    // Restore where the player last left it.
    restorePosition(el);

    // Register with the shared minimized-window dock so the minimize button parks the
    // panel as a chip in the same fly-out strip as every other tool. restoreFn brings
    // it back; closeFn hides it entirely (the chip's ×).
    try {
      modalManager.register(ID, {
        label: "Status",
        icon: ICON,
        restoreFn: () => { el.style.display = "block"; },
        closeFn: () => { el.style.display = "none"; },
      });
    } catch (_) {}
    el.querySelector(".os-min").addEventListener("click", () => {
      try { modalManager.minimize(ID); } catch (_) {}
      // The HUD isn't a `.modal`, so the dock's `.hidden` class is overridden by its
      // inline display — hide it explicitly. restoreFn / the poll-loop guard bring it back.
      el.style.display = "none";
    });

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

  // Fully hide the panel and clear any dock chip — used when no game is running or the
  // engine is unreachable, so a stale "Status" chip never lingers in the fly-out.
  function hidePanel() {
    const el = document.getElementById(ID);
    if (!el) return;
    if (isMinimized()) { try { modalManager.restore(ID); } catch (_) {} }
    el.style.display = "none";
  }

  function render(st) {
    const el = ensurePanel();
    // No active game (engine reports week 0 / setup) → hide and keep polling.
    if (!st || typeof st.week !== "number" || st.week < 1) {
      hidePanel();
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
    if (st._state !== undefined) renderRoster(el, st, st._state);
    // Keep the data fresh, but if the player minimized it to the dock, leave it parked.
    if (!isMinimized()) el.style.display = "block";
  }

  // The memory wall: who's still in, who's gone, the attrition count, and the player's own
  // public role badge. All from getGameState().house[] + the ceremony status. No numbers.
  function renderRoster(el, st, state) {
    const badgeEl = el.querySelector("#os-you-badge");
    const badge = selfBadge(st, state);
    if (badge) { badgeEl.textContent = badge; badgeEl.hidden = false; }
    else { badgeEl.hidden = true; }

    const rosterEl = el.querySelector("#os-roster");
    const headEl = el.querySelector("#os-roster-h");
    const house = state && Array.isArray(state.house) ? state.house : null;
    if (!house) { rosterEl.innerHTML = ""; headEl.style.display = "none"; return; }
    headEl.style.display = "";

    // player (if still active) + NPCs, active first then evicted in eviction order.
    const playerActive = state.player && state.player.status === "active";
    const total = house.length + 1; // player + NPCs
    const activeCount = house.filter((h) => h.status === "active").length + (playerActive ? 1 : 0);
    headEl.textContent = "The house · " + activeCount + "/" + total;

    const out = house.filter((h) => h.status !== "active");
    const rows = [];
    house.filter((h) => h.status === "active").forEach((h) => {
      rows.push('<div class="os-hg"><span>' + esc(h.name) + "</span></div>");
    });
    out.forEach((h, i) => {
      const seat = h.status === "jury" ? "jury" : (i + 1) + (["th","st","nd","rd"][(i + 1) % 10] || "th") + " out";
      rows.push('<div class="os-hg os-out"><span>' + esc(h.name) +
        '</span><span class="os-seat">' + esc(seat) + "</span></div>");
    });
    rosterEl.innerHTML = rows.join("");
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  async function refresh() {
    try {
      const st = await fetchStatus();
      // Fold the roster in (best-effort, never blocks the ceremony rows on /state).
      st._state = (await fetchState()) || null;
      render(st);
    } catch (_) {
      // Engine down / no game → hide, fail open.
      hidePanel();
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
