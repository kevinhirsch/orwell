// Orwell social surface (feature 0036 / C10) — the player-facing UI for NPC approaches
// and the Diary Room, over the engine's Vault-free routes. Built as a self-contained,
// fail-open sibling to orwellStatusPanel.js: it only shows while a game is in progress,
// renders ONLY what the routes return, and never disturbs the chat if the engine is down.
//
//   • GET  /api/orwell/state        → gate on an active game (started)
//   • GET  /api/orwell/initiatives  → houseguests who want to approach (name + pretext)
//   • POST /api/orwell/diary-room   → the player's private, OOC confessional
//
// Vault-free by construction (the engine withholds all hidden state); fail-open everywhere.
//
// Like the settings panel it is a real moveable window: drag it by its header, minimize it,
// and it remembers both across reloads. Only ONE houseguest pulls you aside at a time (more
// realistic than a crowd), and an approach you act on or dismiss STAYS gone across a refresh
// (until a new game), so the surface never nags about something you already handled.
import { makeWindowDraggable } from "./windowDrag.js";
import * as modalManager from "./modalManager.js";

(function () {
  "use strict";

  const POLL_MS = 20000;
  const ID = "orwell-social";
  const MAX_APPROACHES = 1;            // one person pulls you aside at a time — not a crowd
  const POS_KEY = "orwell-social-pos";
  const DISMISS_KEY = "orwell-social-dismissed";
  const ICON = "<svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2'/><circle cx='9' cy='7' r='4'/><path d='M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75'/></svg>";
  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn, { once: true })
      : fn();

  let timer = null;
  let pendingApproachId = null;  // approach prefilled but not yet sent

  // Approaches the player has acted on or waved off. Persisted so a refresh (or a sent
  // scene) doesn't resurrect a handled approach; cleared when a new game begins.
  function loadDismissed() {
    try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]")); } catch (_) { return new Set(); }
  }
  let dismissed = loadDismissed();
  function dismiss(id) {
    dismissed.add(id);
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...dismissed])); } catch (_) {}
  }
  function clearDismissed() {
    dismissed = new Set();
    pendingApproachId = null;
    try { localStorage.removeItem(DISMISS_KEY); } catch (_) {}
  }

  async function getJSON(url) {
    const r = await fetch(url, { credentials: "same-origin" });
    if (!r.ok) throw new Error("HTTP " + r.status);
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

  // True while the dock holds this panel minimized — the poll loop must not reopen it.
  function isMinimized() {
    try { return modalManager.isMinimized && modalManager.isMinimized(ID); } catch (_) { return false; }
  }
  // Hide the panel and clear any dock chip (no active game / engine down) so no stale
  // "The House" chip lingers in the fly-out.
  function hidePanel() {
    const el = document.getElementById(ID);
    if (!el) return;
    if (isMinimized()) { try { modalManager.restore(ID); } catch (_) {} }
    el.style.display = "none";
  }

  function ensureUI() {
    let el = document.getElementById("orwell-social");
    if (el) return el;
    el = document.createElement("div");
    el.id = "orwell-social";
    el.innerHTML = `
      <style>
        #orwell-social {
          position: fixed; top: 210px; right: 14px; z-index: 9000;
          width: 220px; max-width: 60vw; display: none;
          background: var(--panel, #111); color: var(--fg, #9cdef2);
          border: 1px solid var(--border, #355a66); border-radius: 10px;
          padding: .6rem .7rem; box-shadow: 0 10px 30px rgba(0,0,0,.35);
          font-family: 'Fira Code', ui-monospace, monospace; font-size: .74rem; line-height: 1.45;
        }
        #orwell-social .osoc-hdr {
          display: flex; align-items: baseline; gap: .4rem; margin-bottom: .5rem;
          font-weight: 600; letter-spacing: .03em; cursor: move; user-select: none;
        }
        #orwell-social .osoc-ttl { flex: 1; min-width: 0; opacity: .8; }
        #orwell-social .osoc-min {
          cursor: pointer; border: none; background: none; color: inherit;
          opacity: .55; font-size: 1rem; line-height: 1; padding: 0 .15rem; font-family: inherit;
        }
        #orwell-social .osoc-min:hover { opacity: .9; }
        #orwell-social .osoc-dr {
          width: 100%; cursor: pointer; border-radius: 8px; padding: .35rem .5rem;
          background: var(--accent, #e06c75); color: #fff; border: none; font-weight: 600;
          font-family: inherit; font-size: .76rem;
        }
        #orwell-social .osoc-hd { opacity: .6; margin: .55rem 0 .3rem; letter-spacing: .03em; }
        #orwell-social .osoc-chip {
          display: flex; align-items: center; gap: .35rem; margin: .25rem 0;
          background: rgba(255,255,255,.05); border: 1px solid var(--border, #355a66);
          border-radius: 8px; padding: .25rem .4rem;
        }
        #orwell-social .osoc-chip .osoc-go { flex: 1; cursor: pointer; }
        #orwell-social .osoc-chip .osoc-go b { color: var(--fg, #9cdef2); }
        #orwell-social .osoc-chip .osoc-x {
          cursor: pointer; opacity: .55; border: none; background: none; color: inherit;
          font-size: .9rem; line-height: 1; padding: 0 .2rem;
        }
        #orwell-social .osoc-chip.osoc-chip-pending {
          border-color: var(--accent, #e06c75); opacity: .85;
        }
        #orwell-social .osoc-chip.osoc-chip-pending .osoc-go b {
          color: var(--accent, #e06c75);
        }
        #orwell-dr-modal {
          position: fixed; inset: 0; z-index: 10000; display: none;
          align-items: center; justify-content: center; background: rgba(0,0,0,.55);
        }
        #orwell-dr-modal .osoc-box {
          width: 420px; max-width: 92vw; background: var(--panel, #111); color: var(--fg, #9cdef2);
          border: 1px solid var(--border, #355a66); border-radius: 12px; padding: 1rem;
          font-family: 'Fira Code', ui-monospace, monospace;
        }
        #orwell-dr-modal .osoc-drhdr { cursor: move; user-select: none; }
        #orwell-dr-modal h3 { margin: 0 0 .3rem; font-size: .95rem; }
        #orwell-dr-modal .osoc-note { opacity: .65; font-size: .72rem; margin-bottom: .6rem; }
        #orwell-dr-modal textarea {
          width: 100%; min-height: 96px; resize: vertical; box-sizing: border-box;
          background: rgba(255,255,255,.05); color: inherit; border: 1px solid var(--border, #355a66);
          border-radius: 8px; padding: .5rem; font-family: inherit; font-size: .8rem;
        }
        #orwell-dr-modal .osoc-row { display: flex; gap: .5rem; justify-content: flex-end; margin-top: .6rem; }
        #orwell-dr-modal button { cursor: pointer; border-radius: 8px; padding: .4rem .8rem; font-family: inherit; }
        #orwell-dr-modal .osoc-cancel { background: transparent; color: inherit; border: 1px solid var(--border, #355a66); }
        #orwell-dr-modal .osoc-send { background: var(--accent, #e06c75); color: #fff; border: none; font-weight: 600; }
      </style>
      <div class="osoc-hdr" title="Drag to move">
        <span class="osoc-ttl">The House</span>
        <button type="button" class="osoc-min" title="Minimize" aria-label="Minimize">–</button>
      </div>
      <div class="osoc-body">
        <button class="osoc-dr" id="osoc-dr-open">📔 Diary Room</button>
        <div class="osoc-hd" id="osoc-appr-hd" style="display:none">Wants a word</div>
        <div id="osoc-appr"></div>
      </div>`;
    document.body.appendChild(el);

    const modal = document.createElement("div");
    modal.id = "orwell-dr-modal";
    modal.innerHTML = `
      <div class="osoc-box" role="dialog" aria-modal="true" aria-label="Diary Room">
        <div class="osoc-drhdr" title="Drag to move"><h3>Diary Room</h3></div>
        <div class="osoc-note">Private &amp; out-of-character — the house never hears this.</div>
        <textarea id="osoc-dr-text" placeholder="Tell the producers what you're really thinking…"></textarea>
        <div class="osoc-row">
          <button class="osoc-cancel" id="osoc-dr-cancel">Cancel</button>
          <button class="osoc-send" id="osoc-dr-send">Record</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    el.querySelector("#osoc-dr-open").addEventListener("click", openDR);
    modal.querySelector("#osoc-dr-cancel").addEventListener("click", closeDR);
    modal.addEventListener("click", (e) => { if (e.target === modal) closeDR(); });
    modal.querySelector("#osoc-dr-send").addEventListener("click", submitDR);

    // Restore where the player left the panel.
    restorePosition(el);
    // Minimize → park as a chip in the shared dock (the fly-out of minimized windows),
    // alongside every other tool, instead of collapsing in place.
    try {
      modalManager.register(ID, {
        label: "The House",
        icon: ICON,
        restoreFn: () => { el.style.display = "block"; },
        closeFn: () => { el.style.display = "none"; },
      });
    } catch (_) {}
    el.querySelector(".osoc-min").addEventListener("click", () => {
      try { modalManager.minimize(ID); } catch (_) {}
      // Not a `.modal`, so hide explicitly (inline display beats the dock's `.hidden`).
      el.style.display = "none";
    });

    // Moveable window: drag the panel by its header (no dock/fullscreen/resize — it is a
    // small HUD); the Diary-Room dialog drags by its title bar. Buttons are skipped by the
    // default skipSelector, so the minimize click never starts a drag.
    makeWindowDraggable(el, {
      content: el, header: el.querySelector(".osoc-hdr"),
      enableDock: false, enableFullscreen: false, enableResize: false, mobileSkip: 0,
      onDragEnd: ({ rect }) => {
        try { localStorage.setItem(POS_KEY, JSON.stringify({ left: rect.left, top: rect.top })); } catch (_) {}
      },
    });
    makeWindowDraggable(modal, {
      content: modal.querySelector(".osoc-box"), header: modal.querySelector(".osoc-drhdr"),
      enableDock: false, enableFullscreen: false, enableResize: false, mobileSkip: 0,
    });
    return el;
  }

  // --- Diary Room ---------------------------------------------------------------

  function openDR() {
    const m = document.getElementById("orwell-dr-modal");
    const t = document.getElementById("osoc-dr-text");
    if (!m) return;
    t.value = "";
    document.getElementById("osoc-dr-send").disabled = false;
    // Re-center the dialog each open (a prior drag may have left it elsewhere).
    const box = m.querySelector(".osoc-box");
    if (box) { box.style.left = ""; box.style.top = ""; box.style.position = ""; box.style.transform = ""; box.style.margin = ""; }
    m.style.display = "flex";
    t.focus();
  }
  function closeDR() {
    const m = document.getElementById("orwell-dr-modal");
    if (m) m.style.display = "none";
  }
  async function submitDR() {
    const t = document.getElementById("osoc-dr-text");
    const send = document.getElementById("osoc-dr-send");
    const entry = (t.value || "").trim();
    if (!entry) { t.focus(); return; }
    send.disabled = true;
    try {
      const r = await fetch("/api/orwell/diary-room", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry }),
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      // Brief confirmation, then close — the entry is the player's own private knowledge.
      send.textContent = "Recorded ✓";
      setTimeout(() => { closeDR(); send.textContent = "Record"; }, 750);
    } catch (_) {
      send.textContent = "Try again";
      send.disabled = false;
      setTimeout(() => { send.textContent = "Record"; }, 1500);
    }
  }

  // --- Approaches ---------------------------------------------------------------

  function startScene(name, id) {
    // "Acting" on an approach starts a scene the normal way: prefill the composer and focus it,
    // so the player sends it themselves (we never auto-send or fabricate a turn).
    const box = document.getElementById("message");
    if (!box) return;
    box.value = `I pull ${name} aside for a quiet word.`;
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.focus();
    pendingApproachId = id;
  }

  // When the player actually sends a message, dismiss the pending approach so
  // the chip clears — the scene has been initiated, no need to keep it.
  function onMessageSend() {
    if (pendingApproachId !== null) {
      dismiss(pendingApproachId);
      pendingApproachId = null;
      // Re-render using the last fetched list (next poll will update naturally).
      const wrap = document.getElementById("osoc-appr");
      const hd = document.getElementById("osoc-appr-hd");
      if (wrap) { wrap.innerHTML = ""; if (hd) hd.style.display = "none"; }
    }
  }
  // Hook into the send button and Enter-to-submit on the composer.
  const _wireComposer = () => {
    const form = document.getElementById("chat-form") || document.querySelector("form");
    if (form && !form._orwellSocialWired) {
      form._orwellSocialWired = true;
      form.addEventListener("submit", onMessageSend);
    }
    const btn = document.getElementById("send-btn") || document.querySelector("[id$='-send']");
    if (btn && !btn._orwellSocialWired) {
      btn._orwellSocialWired = true;
      btn.addEventListener("click", onMessageSend);
    }
  };

  function renderApproaches(list) {
    const wrap = document.getElementById("osoc-appr");
    const hd = document.getElementById("osoc-appr-hd");
    if (!wrap) return;
    _wireComposer();
    const items = (Array.isArray(list) ? list : [])
      .filter((it) => it && it.houseguest && it.houseguest.id && !dismissed.has(it.houseguest.id))
      .slice(0, MAX_APPROACHES); // only one houseguest pulls you aside at a time
    wrap.innerHTML = "";
    hd.style.display = items.length ? "block" : "none";
    for (const it of items) {
      const id = it.houseguest.id;
      const name = it.houseguest.name || "A houseguest";
      const pretext = it.pretext || "wants a word with you";
      const chip = document.createElement("div");
      chip.className = "osoc-chip";
      if (id === pendingApproachId) chip.classList.add("osoc-chip-pending");
      const go = document.createElement("span");
      go.className = "osoc-go";
      go.title = "Pull them aside — prefills the composer";
      go.innerHTML = `<b></b> <span class="osoc-pre"></span>`;
      go.querySelector("b").textContent = name;
      go.querySelector(".osoc-pre").textContent = pretext;
      // Clicking "go" prefills but does NOT dismiss immediately — the chip
      // stays until the player actually sends the message or hits the X.
      // This prevents the frustrating cycle where three quick clicks dismiss
      // all approaches before a single message is written.
      go.addEventListener("click", () => { startScene(name, id); renderApproaches(list); });
      const x = document.createElement("button");
      x.className = "osoc-x"; x.title = "Skip (dismiss)"; x.textContent = "×";
      x.addEventListener("click", () => {
        if (pendingApproachId === id) pendingApproachId = null;
        dismiss(id);
        renderApproaches(list);
      });
      chip.appendChild(go); chip.appendChild(x);
      wrap.appendChild(chip);
    }
  }

  // --- Poll loop ----------------------------------------------------------------

  async function refresh() {
    let active = false;
    try {
      const st = await getJSON("/api/orwell/state");
      active = !!(st && st.started);
    } catch (_) {
      active = false; // engine down → fail open (hide)
    }
    if (!active) {
      hidePanel();
      return;
    }
    const el = ensureUI();
    // Keep approaches fresh, but if the player parked it in the dock, leave it there.
    if (!isMinimized()) el.style.display = "block";
    try {
      const data = await getJSON("/api/orwell/initiatives");
      renderApproaches(data && data.initiatives);
    } catch (_) {
      renderApproaches([]); // no chips on error — never block
    }
  }

  function start() {
    ensureUI();
    refresh();
    if (timer) clearInterval(timer);
    timer = setInterval(refresh, POLL_MS);
  }

  window.orwellRefreshSocial = refresh;
  // A new game starts a clean slate — forget who we waved off in the last one.
  window.addEventListener("orwell:gamechanged", () => { clearDismissed(); refresh(); });
  ready(start);
})();
