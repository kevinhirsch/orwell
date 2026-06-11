// Orwell cast roster (feature 0051 / C-FE) — a "who is who" reference panel.
//
// A standing sidebar button (alongside New Chat / Search / Diary Room, shown while a game is
// active) opens a roster panel: each houseguest's persisted portrait (or a graceful placeholder
// when none), their name, and their current status (active / jury / evicted). Evicted houseguests
// stay on the roster, visually dimmed.
//
// Vault-free by construction: it renders ONLY what GET /api/orwell/roster returns — name, status,
// and a portrait ref — which the route builds from the engine's Vault-free public projection. No
// stat, relationship, or hidden element ever reaches this surface. ADR 0003: it AUGMENTS the chat
// (a companion reference), never replaces an interaction; the game plays identically with no
// portraits (the placeholder + name + status card). Fail-open everywhere.
(function () {
  "use strict";

  const BTN_ID = "sidebar-cast-btn";
  const PANEL_ID = "orwell-cast";
  const POLL_MS = 30000;

  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn, { once: true })
      : fn();

  let _open = false;
  let _timer = null;
  let _imagesAvailable = false;

  async function getJSON(url) {
    const r = await fetch(url, { credentials: "same-origin" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // --- the sidebar button (standing chrome, game-gated) -------------------------

  function ensureButton() {
    let btn = document.getElementById(BTN_ID);
    if (btn) return btn;
    // Anchor next to the Diary Room button if present, else Search, else New Chat.
    const anchor = document.getElementById("sidebar-diary-room-btn")
      || document.getElementById("sidebar-search-btn")
      || document.getElementById("sidebar-new-chat-btn");
    if (!anchor || !anchor.parentElement) return null;
    btn = document.createElement("div");
    btn.className = "list-item";
    btn.id = BTN_ID;
    btn.setAttribute("role", "button");
    btn.setAttribute("tabindex", "0");
    btn.title = "Cast — the houseguests";
    btn.style.display = "none"; // shown while a game is active
    btn.innerHTML = `
      <svg class="sidebar-action-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      <span class="grow">Cast</span>`;
    const open = () => togglePanel(true);
    btn.addEventListener("click", open);
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
    anchor.parentElement.insertBefore(btn, anchor.nextSibling);
    return btn;
  }

  async function refreshGate() {
    const btn = ensureButton();
    if (!btn) return;
    try {
      const r = await fetch("/api/orwell/state", { credentials: "same-origin" });
      const st = r.ok ? await r.json() : null;
      const live = !!(st && st.started);
      btn.style.display = live ? "" : "none";
      if (!live && _open) togglePanel(false);
    } catch (_) { /* engine hiccup: leave the button as it was (fail-open) */ }
  }

  // --- the panel ----------------------------------------------------------------

  // G10 (DWE / Lane G): the roster COMPOSES the window kit — it is a companion
  // reference (its own doc-comment), so it is a normal non-modal window: kit
  // titlebar (close + minimize), drag, slot placement, Escape-parks, dock chip,
  // and the one visual language. The old bespoke full-screen modal scrim and
  // hidden-attribute toggling are gone (an author display:flex rule silently
  // defeated that attribute — the close button never worked; root cause
  // recorded in the Lane G ledger).
  let _win = null;
  function ensurePanel() {
    let el = document.getElementById(PANEL_ID);
    if (el) return el;
    const content = document.createElement("div");
    content.innerHTML = `
      <style>
        #orwell-cast {
          width: min(560px, 92vw);
          font-family: 'Fira Code', ui-monospace, monospace;
        }
        #orwell-cast .oc-grid {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
          gap: .7rem;
        }
        #orwell-cast .oc-hg { text-align: center; }
        #orwell-cast .oc-portrait {
          width: 100%; aspect-ratio: 1 / 1; border-radius: 10px; overflow: hidden;
          background: rgba(255,255,255,.05); border: 1px solid var(--border, #355a66);
          display: flex; align-items: center; justify-content: center;
        }
        #orwell-cast .oc-portrait img { width: 100%; height: 100%; object-fit: cover; }
        #orwell-cast .oc-ph { font-size: 1.6rem; opacity: .45; }
        #orwell-cast .oc-name { margin-top: .35rem; font-size: .78rem; line-height: 1.25; word-break: break-word; }
        #orwell-cast .oc-name b { color: var(--fg, #9cdef2); }
        #orwell-cast .oc-status {
          margin-top: .15rem; font-size: .66rem; letter-spacing: .04em; opacity: .65; text-transform: uppercase;
        }
        #orwell-cast .oc-hg.oc-out { opacity: .5; }
        #orwell-cast .oc-hg.oc-out .oc-portrait img { filter: grayscale(1); }
        #orwell-cast .oc-empty { opacity: .65; font-size: .8rem; line-height: 1.5; padding: .4rem 0; }
        #orwell-cast .oc-actions { margin-top: .8rem; display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; }
        #orwell-cast .oc-backfill {
          cursor: pointer; font: inherit; font-size: .74rem; letter-spacing: .03em;
          color: inherit; background: rgba(255,255,255,.06);
          border: 1px solid var(--border, #355a66); border-radius: 8px;
          padding: .4rem .7rem; min-height: 32px;
        }
        #orwell-cast .oc-backfill:hover:not(:disabled) { background: rgba(255,255,255,.12); }
        #orwell-cast .oc-backfill:disabled { opacity: .5; cursor: default; }
        #orwell-cast .oc-backfill-note { font-size: .72rem; opacity: .65; line-height: 1.4; }
        /* Narrow: the slot engine's sheet host owns the position; just fit. */
        @media (max-width: 768px) {
          #orwell-cast { width: auto !important; max-width: none !important; }
        }
      </style>
      <div class="oc-grid" id="oc-grid"></div>
      <div class="oc-empty" id="oc-empty" style="display:none"></div>
      <div class="oc-actions" id="oc-actions" style="display:none">
        <button type="button" class="oc-backfill" id="oc-backfill">Generate cast portraits</button>
        <span class="oc-backfill-note" id="oc-backfill-note"></span>
      </div>`;
    _win = window.OrwellWindowKit.create({
      id: PANEL_ID, title: "🎬 The Cast",
      icon: "<svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><circle cx='9' cy='7' r='4'/><path d='M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2'/></svg>",
      slot: "top-left", slotKey: "cast", role: "complementary",
      minimizable: true, closable: true, draggable: true,
      content,
      onClose: () => {
        _win = null; _open = false;
        if (_timer) { clearInterval(_timer); _timer = null; }
      },
    });
    _win.open(document.getElementById(BTN_ID) || undefined);
    const el2 = document.getElementById(PANEL_ID);
    el2.querySelector("#oc-backfill").addEventListener("click", requestBackfill);
    return el2;
  }

  function statusLabel(s) {
    if (s === "jury") return "Jury";
    if (s === "evicted") return "Evicted";
    return "In the house";
  }

  // --- the G9 manual lever: backfill missing portraits -------------------------
  // Shown only when a provider is configured (imagesAvailable) AND active houseguests
  // still show placeholders — e.g. a season created before 0051 shipped, or a prior
  // generation run that failed. POSTs the debounced backfill route; never blocks.

  async function requestBackfill() {
    const el = ensurePanel();
    const btn = el.querySelector("#oc-backfill");
    const note = el.querySelector("#oc-backfill-note");
    btn.disabled = true;
    note.textContent = "Requesting…";
    try {
      const r = await fetch("/api/orwell/portraits/backfill", {
        method: "POST", credentials: "same-origin",
      });
      const data = r.ok ? await r.json() : null;
      if (data && data.kicked) {
        const n = Array.isArray(data.missing) ? data.missing.length : 0;
        note.textContent = "Generating " + n + " portrait" + (n === 1 ? "" : "s") +
          " in the background — they'll appear here as they land.";
      } else if (data && !data.available) {
        note.textContent = "No image model is configured — the game plays on without portraits.";
      } else if (data && !(data.missing || []).length) {
        note.textContent = "Nothing missing — every active houseguest has a portrait.";
      } else {
        note.textContent = "A generation run started recently — give it a few minutes, then try again.";
      }
    } catch (_) {
      if (window.OrwellReport) window.OrwellReport.fail("cast", "backfill-post", _); // G11: fail open, never silent
      note.textContent = "The portrait service is offline right now.";
    }
    // Re-enable after a beat (the server debounces regardless — this just avoids mashing).
    setTimeout(() => { btn.disabled = false; }, 5000);
  }

  function render(data) {
    const el = ensurePanel();
    const grid = el.querySelector("#oc-grid");
    const empty = el.querySelector("#oc-empty");
    const roster = (data && Array.isArray(data.roster)) ? data.roster : [];
    _imagesAvailable = !!(data && data.imagesAvailable);

    grid.innerHTML = "";
    const actions = el.querySelector("#oc-actions");
    if (!roster.length) {
      empty.style.display = "";
      empty.textContent = "The cast hasn't moved in yet.";
      if (actions) actions.style.display = "none";
      return;
    }
    empty.style.display = "none";

    // G9: offer the retry lever when a provider is configured but active houseguests
    // still show placeholders (pre-0051 seasons / failed generation runs).
    const missing = roster.filter(
      (hg) => (!hg.status || hg.status === "active") && !hg.portrait
    );
    if (actions) {
      actions.style.display = (_imagesAvailable && missing.length) ? "" : "none";
      // G20: standing completeness copy — the background reconciler verifies and
      // retries the set; this row reports the live remainder (server counters when
      // present, the rendered roster otherwise).
      if (_imagesAvailable && missing.length) {
        const note = el.querySelector("#oc-backfill-note");
        const total = (data && typeof data.portraitsTotal === "number") ? data.portraitsTotal : null;
        const present = (data && typeof data.portraitsPresent === "number") ? data.portraitsPresent : null;
        if (note) note.textContent = "Generating " + missing.length + " remaining…" +
          (total != null && present != null ? " (" + present + "/" + total + " done)" : "");
      }
    }

    // Active first (player flagged), then jury, then evicted — keeps the live house on top.
    const order = { active: 0, jury: 1, evicted: 2 };
    const sorted = roster.slice().sort((a, b) =>
      (order[a.status] ?? 3) - (order[b.status] ?? 3));

    for (const hg of sorted) {
      const card = document.createElement("div");
      const out = hg.status && hg.status !== "active";
      card.className = "oc-hg" + (out ? " oc-out" : "");
      const portrait = hg.portrait
        ? `<img src="${esc(hg.portrait)}" alt="${esc(hg.name)}" loading="lazy"
              onerror="this.parentElement.innerHTML='<span class=&quot;oc-ph&quot;>👤</span>'">`
        : `<span class="oc-ph">👤</span>`;
      card.innerHTML = `
        <div class="oc-portrait">${portrait}</div>
        <div class="oc-name"><b>${esc(hg.name)}</b>${hg.isPlayer ? " (you)" : ""}</div>
        <div class="oc-status">${esc(statusLabel(hg.status))}</div>`;
      grid.appendChild(card);
    }
  }

  async function refreshRoster() {
    try {
      const data = await getJSON("/api/orwell/roster");
      render(data);
    } catch (_) {
      // Fail open: keep whatever's shown; an empty first load shows the empty-state copy.
      if (window.OrwellReport) window.OrwellReport.fail("cast", "roster-fetch", _); // G11: fail open, never silent
      const el = document.getElementById(PANEL_ID);
      if (el && !el.querySelector("#oc-grid").children.length) {
        el.querySelector("#oc-empty").style.display = "";
        el.querySelector("#oc-empty").textContent = "The cast list is offline right now.";
      }
    }
  }

  function togglePanel(open) {
    if (open) {
      const existed = !!document.getElementById(PANEL_ID);
      const el = ensurePanel();
      _open = true;
      // G16/F2 (refresh-persistence audit): when ensurePanel() just MOUNTED the
      // window and the kit honored a persisted parked flag (the player parked it
      // last page-life), it lives in the dock — leave it parked; its dock chip
      // restores it. An explicit toggle on an ALREADY-LIVE minimized window
      // still restores, exactly as before. (The display write matters too:
      // modalManager's launcher-agnostic observer treats any un-hide of a
      // minimized window as a restore, which would silently un-park it.)
      const bootParked = !existed && _win && _win.isMinimized && _win.isMinimized();
      if (!bootParked) {
        el.style.display = "block";
        if (_win) { _win.restore(); _win.raise(); }
      }
      refreshRoster();
      if (_timer) clearInterval(_timer);
      _timer = setInterval(() => { if (_open && !document.hidden) refreshRoster(); }, POLL_MS);
    } else if (_win) {
      _win.close(); // kit close: fly-away, teardown, focus-return (onClose resets state)
    }
  }

  // Seam for the headless gate (mirrors the other panels).
  window._orwellCastEnsure = () => { togglePanel(true); return true; };

  // Public hooks (mirrors the other orwell panels): refresh on a game change.
  window.orwellRefreshCast = () => { if (_open) refreshRoster(); };
  window.addEventListener("orwell:gamechanged", () => { refreshGate(); if (_open) refreshRoster(); });

  ready(() => {
    refreshGate();
    setInterval(refreshGate, 20000);
  });
})();
