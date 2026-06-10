// Orwell finale surface (feature 0037 / C11) — the player-facing view of the staged jury vote,
// over the engine's Vault-free /api/orwell/finale route. A self-contained, fail-open sibling to
// orwellSocial.js: it shows ONLY while a finale is staging, renders ONLY what the route returns
// (finalists, stage, and the votes revealed SO FAR — never a pre-reveal tally or the winner), and
// never disturbs the chat if the engine is down. The binding finale decisions still flow through the
// chat agent's submitDecision seam; this panel just visualizes the reveal and offers composer-prefill
// shortcuts for the player's turn (mirroring how orwellSocial surfaces approaches).
//
//   • GET /api/orwell/finale → { finale: { stage, finalists[], asking, reveals[] } | null }
//
// Vault-free by construction (the engine withholds leans/tallies/manner/the pre-reveal winner);
// fail-open everywhere. No new module deps beyond the existing windowDrag + modalManager.
import { makeWindowDraggable } from "./windowDrag.js";
import * as modalManager from "./modalManager.js";

(function () {
  "use strict";

  const POLL_MS = 5000;            // the finale is live — poll briskly
  const ID = "orwell-finale";
  const POS_KEY = "orwell-finale-pos";
  const PLAYER_ID = "player";
  const ICON = "<svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M6 9H4.5a2.5 2.5 0 0 1 0-5H6'/><path d='M18 9h1.5a2.5 2.5 0 0 0 0-5H18'/><path d='M4 22h16'/><path d='M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22'/><path d='M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22'/><path d='M18 2H6v7a6 6 0 0 0 12 0V2Z'/></svg>";
  const STAGE_LABEL = { statements: "Opening statements", questions: "Jury questions", vote: "The jury votes", reveal: "The votes are read" };
  const APPEALS = [
    { id: "own-game", label: "Own my game" },
    { id: "mend", label: "Mend fences" },
    { id: "connect", label: "Connect personally" },
    { id: "discredit-rival", label: "Question my rival" },
  ];
  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn, { once: true })
      : fn();

  let timer = null;

  async function getJSON(url) {
    const r = await fetch(url, { credentials: "same-origin" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  function restorePosition(el) {
    try {
      const pos = JSON.parse(localStorage.getItem(POS_KEY) || "null");
      if (pos && typeof pos.left === "number" && typeof pos.top === "number") {
        el.style.left = pos.left + "px"; el.style.top = pos.top + "px"; el.style.right = "auto";
      }
    } catch (_) {}
  }

  function isMinimized() {
    try { return modalManager.isMinimized && modalManager.isMinimized(ID); } catch (_) { return false; }
  }
  function hidePanel() {
    const el = document.getElementById(ID);
    if (!el) return;
    if (isMinimized()) { try { modalManager.restore(ID); } catch (_) {} }
    el.style.display = "none";
  }

  function ensureUI() {
    let el = document.getElementById(ID);
    if (el) return el;
    el = document.createElement("div");
    el.id = ID;
    el.innerHTML = `
      <style>
        #orwell-finale {
          /* E91/S11: positioned by the top-left SLOT (orwellSlots.js). */
          position: fixed; z-index: 9000;
          width: 240px; max-width: 64vw; display: none;
          background: var(--panel, #111); color: var(--fg, #9cdef2);
          border: 1px solid var(--border, #355a66); border-radius: 10px;
          padding: .6rem .7rem; box-shadow: 0 10px 30px rgba(0,0,0,.35);
          font-family: 'Fira Code', ui-monospace, monospace; font-size: .74rem; line-height: 1.45;
        }
        #orwell-finale .ofin-hdr {
          display: flex; align-items: baseline; gap: .4rem; margin-bottom: .5rem;
          font-weight: 600; letter-spacing: .03em; cursor: move; user-select: none;
        }
        #orwell-finale .ofin-ttl { flex: 1; min-width: 0; opacity: .85; }
        #orwell-finale .ofin-min {
          cursor: pointer; border: none; background: none; color: inherit;
          opacity: .55; font-size: 1rem; line-height: 1; padding: 0 .15rem; font-family: inherit;
        }
        #orwell-finale .ofin-min:hover { opacity: .9; }
        #orwell-finale .ofin-stage { opacity: .6; margin: 0 0 .4rem; letter-spacing: .03em; }
        #orwell-finale .ofin-final {
          display: flex; justify-content: space-between; gap: .4rem; margin-bottom: .5rem;
        }
        #orwell-finale .ofin-fin {
          flex: 1; text-align: center; background: rgba(255,255,255,.05);
          border: 1px solid var(--border, #355a66); border-radius: 8px; padding: .3rem .25rem;
        }
        #orwell-finale .ofin-fin b { display: block; color: var(--fg, #9cdef2); }
        #orwell-finale .ofin-fin .ofin-tally { font-size: 1.1rem; opacity: .9; }
        #orwell-finale .ofin-hd { opacity: .6; margin: .5rem 0 .25rem; letter-spacing: .03em; }
        #orwell-finale .ofin-reveal { margin: .2rem 0; opacity: .9; }
        #orwell-finale .ofin-reveal b { color: var(--fg, #9cdef2); }
        #orwell-finale .ofin-move { margin-top: .5rem; }
        #orwell-finale .ofin-btn {
          width: 100%; cursor: pointer; border-radius: 8px; padding: .3rem .5rem; margin: .2rem 0;
          background: rgba(255,255,255,.05); color: inherit; border: 1px solid var(--border, #355a66);
          font-family: inherit; font-size: .74rem; text-align: left;
        }
        #orwell-finale .ofin-btn:hover { border-color: var(--accent, #e06c75); }
      </style>
      <div class="ofin-hdr" title="Drag to move">
        <span class="ofin-ttl">🏆 The Finale</span>
        <button type="button" class="ofin-min" title="Minimize" aria-label="Minimize">–</button>
      </div>
      <div class="ofin-stage" id="ofin-stage"></div>
      <div class="ofin-final" id="ofin-final"></div>
      <div class="ofin-hd" id="ofin-reveal-hd" style="display:none">The votes</div>
      <div id="ofin-reveals"></div>
      <div class="ofin-move" id="ofin-move"></div>`;
    document.body.appendChild(el);
    if (window.OrwellSlots) window.OrwellSlots.register(el, "top-left", { key: "finale" });

    restorePosition(el);
    try {
      modalManager.register(ID, {
        label: "The Finale", icon: ICON,
        restoreFn: () => { el.style.display = "block"; },
        closeFn: () => { el.style.display = "none"; },
      });
    } catch (_) {}
    el.querySelector(".ofin-min").addEventListener("click", () => {
      try { modalManager.minimize(ID); } catch (_) {}
      el.style.display = "none";
    });
    makeWindowDraggable(el, {
      content: el, header: el.querySelector(".ofin-hdr"),
      enableDock: false, enableFullscreen: false, enableResize: false, mobileSkip: 0,
      onDragEnd: ({ rect }) => {
        try { localStorage.setItem(POS_KEY, JSON.stringify({ left: rect.left, top: rect.top })); } catch (_) {}
      },
    });
    return el;
  }

  // Prefill the composer (never auto-send) — the chat agent reads it and calls submitDecision.
  function prefill(text) {
    const box = document.getElementById("message");
    if (!box) return;
    box.value = text;
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.focus();
  }

  function nameOf(ref) { return (ref && ref.name) || "A houseguest"; }

  function render(finale) {
    const el = ensureUI();
    if (!isMinimized()) el.style.display = "block";

    const finalists = Array.isArray(finale.finalists) ? finale.finalists : [];
    const reveals = Array.isArray(finale.reveals) ? finale.reveals : [];
    document.getElementById("ofin-stage").textContent = STAGE_LABEL[finale.stage] || "The finale";

    // Finalists + a tally of the REVEALED votes only (never a pre-reveal total or the winner).
    const tally = {};
    for (const r of reveals) { const id = r.votedFor && r.votedFor.id; if (id) tally[id] = (tally[id] || 0) + 1; }
    const finWrap = document.getElementById("ofin-final");
    finWrap.innerHTML = "";
    for (const f of finalists) {
      const card = document.createElement("div");
      card.className = "ofin-fin";
      const b = document.createElement("b"); b.textContent = nameOf(f);
      const t = document.createElement("span"); t.className = "ofin-tally"; t.textContent = String(tally[f.id] || 0);
      card.appendChild(b); card.appendChild(t); finWrap.appendChild(card);
    }

    // The reveal, in the order the engine read it (revealed votes only).
    const revWrap = document.getElementById("ofin-reveals");
    document.getElementById("ofin-reveal-hd").style.display = reveals.length ? "block" : "none";
    revWrap.innerHTML = "";
    for (const r of reveals) {
      const line = document.createElement("div");
      line.className = "ofin-reveal";
      line.innerHTML = "<b></b> votes for <b></b>";
      const bs = line.querySelectorAll("b");
      bs[0].textContent = nameOf(r.juror); bs[1].textContent = nameOf(r.votedFor);
      revWrap.appendChild(line);
    }

    // The player's turn (composer-prefill shortcuts; the chat agent submits the binding decision).
    const playerIsFinalist = finalists.some((f) => f && f.id === PLAYER_ID);
    const move = document.getElementById("ofin-move");
    move.innerHTML = "";
    const addBtn = (label, text) => {
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "ofin-btn"; btn.textContent = label;
      btn.addEventListener("click", () => prefill(text));
      move.appendChild(btn);
    };
    if (playerIsFinalist && finale.stage === "statements") {
      addBtn("✍ Give your opening statement", "I give my opening statement to the jury: ");
    } else if (playerIsFinalist && finale.stage === "questions") {
      for (const a of APPEALS) addBtn("→ " + a.label, `I answer the jury by making my "${a.id}" case.`);
    } else if (!playerIsFinalist && finale.stage === "vote") {
      for (const f of finalists) addBtn("🗳 Vote for " + nameOf(f), `I cast my jury vote for ${nameOf(f)}.`);
    }
  }

  async function refresh() {
    let finale = null;
    try {
      const data = await getJSON("/api/orwell/finale");
      finale = data && data.finale;
    } catch (_) {
      finale = null; // engine down → fail open (hide)
    }
    if (!finale) { hidePanel(); return; }
    render(finale);
  }

  function start() {
    refresh();
    if (timer) clearInterval(timer);
    timer = setInterval(refresh, POLL_MS);
  }

  window.orwellRefreshFinale = refresh;
  window.addEventListener("orwell:gamechanged", refresh);
  ready(start);
})();
