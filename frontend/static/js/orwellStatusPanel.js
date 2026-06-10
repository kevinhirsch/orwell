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
import { isNarrow } from './platform.js';

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
  let _mobileParkedOnce = false;  // C26: auto-parked to the dock on mobile this session

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
    // A3: announcements happen via the dedicated delta announcer below — a live region
    // on a root that toggles display:none and swaps every field per poll announces
    // nothing useful (either silence or a full re-read with no sense of what changed).
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
        #orwell-status .os-row .os-k { color: color-mix(in srgb, var(--fg, #9cdef2) 78%, var(--panel, #111)); min-width: 4.2em; }
        #orwell-status .os-row .os-v { flex: 1; }
        #orwell-status .os-noms { color: var(--red, #e06c75); }
        /* Offline dot (U5): the feed reconnecting, not gone — last-known stays visible. */
        #orwell-status .os-stale { color: #e0a500; margin-left: .35rem; font-size: .7em; vertical-align: middle; }
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
        #orwell-status .os-hg.os-out { color: color-mix(in srgb, var(--fg, #9cdef2) 62%, var(--panel, #111)); text-decoration: line-through; }
        #orwell-status .os-hg .os-seat { opacity: .6; font-size: .78em; text-decoration: none; }
        /* C26/M1: on phones the panel is a full-width top sheet under the header —
           never a free-floating box over the chat or composer. Drag is disabled
           (windowDrag's default mobile cutoff) so it can't be stranded off-screen. */
        @media (max-width: 768px) {
          #orwell-status {
            left: 0 !important; right: 0 !important; top: 44px !important;
            width: auto !important; max-width: none !important;
            border-radius: 0 0 12px 12px; border-left: none; border-right: none;
            max-height: 38vh; overflow: auto;
          }
        }
      </style>
      <div class="os-hdr" title="Drag to move">
        <span class="os-ttl"><span id="os-week">Week —</span><span class="os-phase" id="os-phase"></span><span class="os-stale" id="os-stale" hidden title="Reconnecting to the feed…" aria-label="feed offline">●</span></span>
        <button type="button" class="os-min" title="Minimize" aria-label="Minimize">–</button>
      </div>
      <div class="os-you" id="os-you">You<span class="os-badge" id="os-you-badge" hidden></span></div>
      <div class="os-row"><span class="os-k">HOH</span><span class="os-v" id="os-hoh">—</span></div>
      <div class="os-row"><span class="os-k">Noms</span><span class="os-v os-noms" id="os-noms">—</span></div>
      <div class="os-row"><span class="os-k">Veto</span><span class="os-v" id="os-veto">—</span></div>
      <div class="os-roster-h" id="os-roster-h">The house</div>
      <div class="os-roster" id="os-roster"></div>
      <div id="os-announce" aria-live="polite" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);"></div>`;
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

  // V3: engine phase enums are internal vocabulary — the HUD speaks the show's.
  const PHASE_LABELS = {
    "setup": "Move-in day", "premiere": "Premiere", "hoh-competition": "HOH competition",
    "nominations": "Nominations", "veto-competition": "Veto competition",
    "veto-ceremony": "Veto ceremony", "eviction": "Eviction night",
    "final-eviction": "Final eviction", "finale": "The finale", "jury": "Jury",
    "social": "A day in the house",
  };
  const phaseLabel = (p) => PHASE_LABELS[p] || String(p || "").replace(/-/g, " ");

  // A3: announce only what CHANGED, in show terms — never a full re-read per poll.
  let _last = { phase: null, hoh: null, noms: null, veto: null };
  function announceDeltas(el, st, names) {
    const a = el.querySelector("#os-announce");
    if (!a) return;
    const msgs = [];
    const cur = {
      phase: phaseLabel(st.phase),
      hoh: names.hoh, noms: names.noms, veto: names.veto,
    };
    if (_last.phase !== null) {
      if (cur.phase !== _last.phase) msgs.push(cur.phase + ".");
      if (cur.hoh !== _last.hoh && cur.hoh !== "—") msgs.push("Head of Household: " + cur.hoh + ".");
      if (cur.noms !== _last.noms && cur.noms !== "—") msgs.push("On the block: " + cur.noms + ".");
      if (cur.veto !== _last.veto && cur.veto !== "—") msgs.push("Veto: " + cur.veto + ".");
    }
    _last = cur;
    if (msgs.length) a.textContent = msgs.join(" ");
  }

  function render(st) {
    const el = ensurePanel();
    // No active game (engine reports week 0 / setup) → genuinely hide (not a hiccup).
    if (!st || typeof st.week !== "number" || st.week < 1) {
      _shown = false;
      _failures = 0;
    markStale(false);
      hidePanel();
      return;
    }
    _shown = true;
    const name = (c) => (c && c.name) || "—";
    el.querySelector("#os-week").textContent = "Week " + st.week;
    el.querySelector("#os-phase").textContent = phaseLabel(st.phase);
    el.querySelector("#os-hoh").textContent = name(st.hoh);
    const noms = Array.isArray(st.nominees) ? st.nominees.map((n) => n.name).filter(Boolean) : [];
    el.querySelector("#os-noms").textContent = noms.length ? noms.join(", ") : "—";
    const veto = st.veto || {};
    const vetoText = veto.used
      ? "used" + (veto.holder ? " · " + veto.holder.name : "")
      : (veto.holder ? veto.holder.name : "—");
    el.querySelector("#os-veto").textContent = vetoText;
    announceDeltas(el, st, {
      hoh: name(st.hoh),
      noms: noms.length ? noms.join(", ") : "—",
      veto: vetoText,
    });
    if (st._state !== undefined) renderRoster(el, st, st._state);
    // Keep the data fresh, but if the player minimized it to the dock, leave it parked.
    // C26/M1: on a phone, first appearance parks in the chip dock (chat stays
    // unobstructed); the dock chip restores it as a full-width top sheet.
    if (isNarrow() && !_mobileParkedOnce && !isMinimized()) {
      _mobileParkedOnce = true;
      el.style.display = "block";
      try { modalManager.minimize(ID); return; } catch (_) {}
    }
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

  // True once we've shown a real game at least once this session. Lets a transient engine
  // hiccup keep the last-known panel up (U5) instead of vanishing the player's only readout.
  let _shown = false;

  // C18: a hidden tab polls nothing; consecutive failures back the poll off (max 2 min).
  let _failures = 0;
  function _pollDelay() { return Math.min(POLL_MS * Math.pow(2, _failures), 120000); }

  function markStale(on) {
    const el = document.getElementById("orwell-status");
    const dot = el && el.querySelector("#os-stale");
    if (dot) dot.hidden = !on;
  }

  async function refresh() {
    let st;
    try {
      st = await fetchStatus();
    } catch (_) {
      // ENGINE HICCUP (not "no game"): if we've shown the panel, keep the last-known
      // values up and flag the feed as reconnecting — don't blink the readout out.
      _failures += 1;
      if (_shown) markStale(true);
      else hidePanel();
      return;
    }
    markStale(false);
    // Fold the roster in (best-effort, never blocks the ceremony rows on /state).
    st._state = (await fetchState()) || null;
    render(st);
  }

  // Seam for the headless browser gate: build + show the panel on demand.
  window._orwellStatusEnsure = () => { const el = ensurePanel(); el.style.display = "block"; return true; };

  function start() {
    refresh();
    if (timer) clearInterval(timer);
    const tick = async () => {
      if (!document.hidden) await refresh();  // C18: no polling in a hidden tab
      timer = setTimeout(tick, _pollDelay());
    };
    timer = setTimeout(tick, _pollDelay());
  }

  // Let onboarding (or any flow that changes the game) trigger an immediate refresh.
  window.orwellRefreshStatus = refresh;
  window.addEventListener("orwell:gamechanged", refresh);

  ready(start);
})();
