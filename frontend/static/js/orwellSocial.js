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
// and it remembers both across reloads. A few houseguests may want you at once (a living
// house, not a crowd), the NPC is framed as the one approaching (they initiated), and an
// approach you act on or dismiss STAYS gone across a refresh (until a new game), so the
// surface never nags about something you already handled.
import { makeWindowDraggable } from "./windowDrag.js";
import * as modalManager from "./modalManager.js";

(function () {
  "use strict";

  const POLL_MS = 20000;
  const ID = "orwell-social";
  const MAX_APPROACHES = 3;            // a few houseguests may want you at once — a living house (U7)
  const POS_KEY = "orwell-social-pos";
  const DISMISS_KEY = "orwell-social-dismissed";
  const ICON = "<svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2'/><circle cx='9' cy='7' r='4'/><path d='M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75'/></svg>";
  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn, { once: true })
      : fn();

  let timer = null;
  // C18: a hidden tab polls nothing; consecutive failures back the poll off (max 2 min).
  let _failures = 0;
  function _pollDelay() { return Math.min(POLL_MS * Math.pow(2, _failures), 120000); }
  let _mobileParkedOnce = false;  // C26: auto-parked to the dock on mobile this session
  let pendingApproachId = null;  // approach prefilled but not yet sent
  let _shown = false;  // shown a real game this session (U5: keep last-known on a hiccup)

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
        #orwell-social .osoc-hd { color: color-mix(in srgb, var(--fg, #9cdef2) 78%, var(--panel, #111)); margin: .55rem 0 .3rem; letter-spacing: .03em; }
        #orwell-social .osoc-chip {
          display: flex; align-items: center; gap: .35rem; margin: .25rem 0;
          background: rgba(255,255,255,.05); border: 1px solid var(--border, #355a66);
          border-radius: 8px; padding: .25rem .4rem;
        }
        #orwell-social .osoc-chip .osoc-go {
          flex: 1; cursor: pointer; text-align: left;
          border: none; background: none; color: inherit; font: inherit; padding: 0;
        }
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
        /* C26/M1: phones — a full-width sheet under the status panel's slot, never a
           floating box over the composer. No touch drag (default mobile cutoff). */
        @media (max-width: 768px) {
          #orwell-social {
            left: 0 !important; right: 0 !important; top: 44px !important;
            width: auto !important; max-width: none !important;
            border-radius: 0 0 12px 12px; border-left: none; border-right: none;
            max-height: 38vh; overflow: auto;
          }
        }
        #orwell-dr-modal {
          position: fixed; inset: 0; z-index: 10000; display: none;
          align-items: center; justify-content: center; background: rgba(0,0,0,.55);
        }
        #orwell-dr-modal .osoc-box {
          width: 420px; max-width: 92vw; max-height: 90vh; overflow: auto; background: var(--panel, #111); color: var(--fg, #9cdef2);
          border: 1px solid var(--border, #355a66); border-radius: 12px; padding: 1rem;
          font-family: 'Fira Code', ui-monospace, monospace;
        }
        #orwell-dr-modal .osoc-drhdr { cursor: move; user-select: none; }
        #orwell-dr-modal h3 { margin: 0 0 .3rem; font-size: .95rem; }
        #orwell-dr-modal .osoc-note { color: color-mix(in srgb, var(--fg, #9cdef2) 80%, var(--panel, #111)); font-size: .72rem; margin-bottom: .6rem; }
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
      enableDock: false, enableFullscreen: false, enableResize: false,
      onDragEnd: ({ rect }) => {
        try { localStorage.setItem(POS_KEY, JSON.stringify({ left: rect.left, top: rect.top })); } catch (_) {}
      },
    });
    makeWindowDraggable(modal, {
      content: modal.querySelector(".osoc-box"), header: modal.querySelector(".osoc-drhdr"),
      enableDock: false, enableFullscreen: false, enableResize: false,
    });
    return el;
  }

  // --- Diary Room ---------------------------------------------------------------

  let _drReturnFocus = null; // give focus back where the player was (A11Y-2)

  function openDR() {
    const m = document.getElementById("orwell-dr-modal");
    const t = document.getElementById("osoc-dr-text");
    if (!m) return;
    _drReturnFocus = document.activeElement;
    t.value = "";
    document.getElementById("osoc-dr-send").disabled = false;
    // Re-center the dialog each open (a prior drag may have left it elsewhere).
    const box = m.querySelector(".osoc-box");
    if (box) { box.style.left = ""; box.style.top = ""; box.style.position = ""; box.style.transform = ""; box.style.margin = ""; }
    m.style.display = "flex";
    // A11Y-2: a real dialog — Escape closes, Tab cycles inside the box.
    if (!m._orwellA11yWired) {
      m._orwellA11yWired = true;
      m.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { e.preventDefault(); closeDR(); return; }
        if (e.key !== "Tab") return;
        const f = m.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      });
    }
    t.focus();
  }
  function closeDR() {
    const m = document.getElementById("orwell-dr-modal");
    if (m) m.style.display = "none";
    if (_drReturnFocus && typeof _drReturnFocus.focus === "function") {
      try { _drReturnFocus.focus(); } catch (_) {}
    }
    _drReturnFocus = null;
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

  // The NPC INITIATED the approach (socialInitiatives = who wants the player now), so the
  // prefill frames them coming to the player — not the player pulling them aside (U6). Varied
  // so it doesn't read as one canned line; the player still sends it themselves.
  const _APPROACH_LINES = [
    (n) => `${n} catches my eye and drifts over — I turn to hear them out.`,
    (n) => `${n} pulls me aside; I give them my attention.`,
    (n) => `${n} sidles up wanting a word. I bite. "What's up?"`,
    (n) => `${n} flags me down — I stop and see what they want.`,
  ];

  function startScene(name, id) {
    // "Acting" on an approach starts a scene the normal way: prefill the composer and focus it,
    // so the player sends it themselves (we never auto-send or fabricate a turn).
    const box = document.getElementById("message");
    if (!box) return;
    const line = _APPROACH_LINES[Math.floor(Math.random() * _APPROACH_LINES.length)];
    box.value = line(name);
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
      .slice(0, MAX_APPROACHES); // a few may want you at once (U7)
    wrap.innerHTML = "";
    hd.style.display = items.length ? "block" : "none";
    for (const it of items) {
      const id = it.houseguest.id;
      const name = it.houseguest.name || "A houseguest";
      const pretext = it.pretext || "wants a word with you";
      const chip = document.createElement("div");
      chip.className = "osoc-chip";
      if (id === pendingApproachId) chip.classList.add("osoc-chip-pending");
      const go = document.createElement("button");
      go.type = "button";
      go.className = "osoc-go";
      go.title = "Hear them out — prefills the composer";
      go.setAttribute("aria-label", "Hear " + name + " out");
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

  // Seam for the headless browser gate: build + show the social panel on demand.
  window._orwellSocialEnsure = () => { const el = ensureUI(); el.style.display = "block"; return true; };

  // Seam for the headless browser gate (and future flows): open the Diary Room on demand.
  window._orwellOpenDiaryRoom = () => { ensureUI(); openDR(); };

  // --- Poll loop ----------------------------------------------------------------

  async function refresh() {
    let st;
    try {
      st = await getJSON("/api/orwell/state");
    } catch (_) {
      // ENGINE HICCUP (not "no game"): keep a shown panel up (U5) — just don't refresh
      // approaches. Only hide when we've never shown it (nothing to keep).
      _failures += 1;
      if (!_shown) hidePanel();
      return;
    }
    _failures = 0;
    if (!(st && st.started)) {
      _shown = false;
      hidePanel(); // genuinely no game
      return;
    }
    _shown = true;
    const el = ensureUI();
    // Keep approaches fresh, but if the player parked it in the dock, leave it there.
    // C26/M1: on a phone, first appearance parks in the chip dock (chat stays
    // unobstructed); the dock chip restores it as a full-width top sheet.
    if (window.innerWidth <= 768 && !_mobileParkedOnce && !isMinimized()) {
      _mobileParkedOnce = true;
      el.style.display = "block";
      try { modalManager.minimize(ID); return; } catch (_) {}
    }
    if (!isMinimized()) el.style.display = "block";
    try {
      const data = await getJSON("/api/orwell/initiatives");
      renderApproaches(data && data.initiatives);
    } catch (_) {
      // initiatives hiccup: leave the existing chips, never blank them on a transient error
    }
  }

  function start() {
    ensureUI();
    refresh();
    if (timer) clearInterval(timer);
    const tick = async () => {
      if (!document.hidden) await refresh();  // C18: no polling in a hidden tab
      timer = setTimeout(tick, _pollDelay());
    };
    timer = setTimeout(tick, _pollDelay());
  }

  window.orwellRefreshSocial = refresh;
  // A new game starts a clean slate — forget who we waved off in the last one.
  window.addEventListener("orwell:gamechanged", () => { clearDismissed(); refresh(); });
  ready(start);
})();
