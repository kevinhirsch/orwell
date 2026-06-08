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
(function () {
  "use strict";

  const POLL_MS = 20000;
  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn, { once: true })
      : fn();

  let timer = null;
  const dismissed = new Set(); // approach ids the player waved off this session

  async function getJSON(url) {
    const r = await fetch(url, { credentials: "same-origin" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
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
        #orwell-dr-modal {
          position: fixed; inset: 0; z-index: 10000; display: none;
          align-items: center; justify-content: center; background: rgba(0,0,0,.55);
        }
        #orwell-dr-modal .osoc-box {
          width: 420px; max-width: 92vw; background: var(--panel, #111); color: var(--fg, #9cdef2);
          border: 1px solid var(--border, #355a66); border-radius: 12px; padding: 1rem;
          font-family: 'Fira Code', ui-monospace, monospace;
        }
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
      <button class="osoc-dr" id="osoc-dr-open">📔 Diary Room</button>
      <div class="osoc-hd" id="osoc-appr-hd" style="display:none">Wants a word</div>
      <div id="osoc-appr"></div>`;
    document.body.appendChild(el);

    const modal = document.createElement("div");
    modal.id = "orwell-dr-modal";
    modal.innerHTML = `
      <div class="osoc-box" role="dialog" aria-modal="true" aria-label="Diary Room">
        <h3>Diary Room</h3>
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
    return el;
  }

  // --- Diary Room ---------------------------------------------------------------

  function openDR() {
    const m = document.getElementById("orwell-dr-modal");
    const t = document.getElementById("osoc-dr-text");
    if (!m) return;
    t.value = "";
    document.getElementById("osoc-dr-send").disabled = false;
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

  function startScene(name) {
    // "Acting" on an approach starts a scene the normal way: prefill the composer and focus it,
    // so the player sends it themselves (we never auto-send or fabricate a turn).
    const box = document.getElementById("message");
    if (!box) return;
    box.value = `I pull ${name} aside for a quiet word.`;
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.focus();
  }

  function renderApproaches(list) {
    const wrap = document.getElementById("osoc-appr");
    const hd = document.getElementById("osoc-appr-hd");
    if (!wrap) return;
    const items = (Array.isArray(list) ? list : []).filter(
      (it) => it && it.houseguest && it.houseguest.id && !dismissed.has(it.houseguest.id),
    );
    wrap.innerHTML = "";
    hd.style.display = items.length ? "block" : "none";
    for (const it of items) {
      const name = it.houseguest.name || "A houseguest";
      const pretext = it.pretext || "wants a word with you";
      const chip = document.createElement("div");
      chip.className = "osoc-chip";
      const go = document.createElement("span");
      go.className = "osoc-go";
      go.title = "Pull them aside";
      go.innerHTML = `<b></b> <span class="osoc-pre"></span>`;
      go.querySelector("b").textContent = name;
      go.querySelector(".osoc-pre").textContent = pretext;
      go.addEventListener("click", () => { startScene(name); dismissed.add(it.houseguest.id); renderApproaches(list); });
      const x = document.createElement("button");
      x.className = "osoc-x"; x.title = "Dismiss"; x.textContent = "×";
      x.addEventListener("click", () => { dismissed.add(it.houseguest.id); renderApproaches(list); });
      chip.appendChild(go); chip.appendChild(x);
      wrap.appendChild(chip);
    }
  }

  // --- Poll loop ----------------------------------------------------------------

  async function refresh() {
    const el = document.getElementById("orwell-social");
    let active = false;
    try {
      const st = await getJSON("/api/orwell/state");
      active = !!(st && st.started);
    } catch (_) {
      active = false; // engine down → fail open (hide)
    }
    if (!active) {
      if (el) el.style.display = "none";
      return;
    }
    ensureUI().style.display = "block";
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
  window.addEventListener("orwell:gamechanged", refresh);
  ready(start);
})();
