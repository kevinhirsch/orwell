// Orwell social surface (feature 0036 / C10) — the player-facing UI for NPC approaches
// over the engine's Vault-free routes (the Diary Room lives in the sidebar —
// orwellDiaryRoom.js). Built as a self-contained,
// fail-open sibling to orwellStatusPanel.js: it only shows while a game is in progress,
// renders ONLY what the routes return, and never disturbs the chat if the engine is down.
//
//   • GET  /api/orwell/state        → gate on an active game (started)
//   • GET  /api/orwell/initiatives  → houseguests who want to approach (name + pretext)
//
// Vault-free by construction (the engine withholds all hidden state); fail-open everywhere.
//
// Like the settings panel it is a real moveable window: drag it by its header, minimize it,
// and it remembers both across reloads. A few houseguests may want you at once (a living
// house, not a crowd), the NPC is framed as the one approaching (they initiated), and an
// approach you act on or dismiss STAYS gone across a refresh (until a new game), so the
// surface never nags about something you already handled.
import * as modalManager from "./modalManager.js";
import { isNarrow } from './platform.js';

(function () {
  "use strict";

  const POLL_MS = 20000;
  const ID = "orwell-social";
  const MAX_APPROACHES = 3;            // a few houseguests may want you at once — a living house (U7)
  // E71: dismissals are scoped per user (and cleared per game via orwell:gamechanged),
  // so one account's waved-off approaches never bleed into another's session.
  const DISMISS_KEY = "orwell-social-dismissed:" +
    ((document.body && document.body.dataset.user) || "");
  const ICON = "<svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2'/><circle cx='9' cy='7' r='4'/><path d='M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75'/></svg>";
  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn, { once: true })
      : fn();

  // E60: the engine ships a coarse categorical MOTIVE (bond | probe) — never the number, never a
  // canned pretext line — and the chip varies its framing by that enum: a "bond" approach reads as
  // a warm overture, a "probe" reads as someone sizing the player up. The GM voices the real scene
  // in the chat; this is just how the chip carries the difference. Unknown/absent motive falls back
  // to the neutral copy. Copy lives here (one place), not scattered inline.
  const MOTIVE_FRAMING = {
    bond:  { pretext: "wants to talk game with you",   cls: "osoc-motive-bond",  hint: "A friendly overture" },
    probe: { pretext: "has been sizing up your game",  cls: "osoc-motive-probe", hint: "They're feeling you out" },
  };
  const MOTIVE_FALLBACK = { pretext: "wants a word with you", cls: "osoc-motive-neutral", hint: "Hear them out" };

  // E89 belt: NO approach renders before the house has actually started PLAYING — the first
  // ceremony (the week-1 HOH result) must have resolved. The engine's E89 gate already returns an
  // empty list pre-first-ceremony; this is the FE's own belt, so even if the engine FAILS OPEN and
  // ships approaches early (a "wants a word with you" at the premiere), the UI still shows nothing.
  // Derived from /api/orwell/state alone: pre-ceremony beats are setup/premiere/character-creation
  // and the week-1 HOH competition itself; once noms (or any later beat / a later week) is reached,
  // the first ceremony has resolved.
  function firstCeremonyResolved(st) {
    if (!st || !st.started) return false;
    const week = typeof st.week === "number" ? st.week : 1;
    if (week > 1) return true; // a second HOH week ⇒ the first ceremony is long resolved
    const phase = String(st.phase || st.moment || "").toLowerCase();
    const preCeremony =
      phase === "" ||
      phase.indexOf("setup") >= 0 ||
      phase.indexOf("premiere") >= 0 ||
      phase.indexOf("character-creation") >= 0 ||
      phase.indexOf("casting") >= 0 ||
      phase.indexOf("hoh") >= 0; // the opening HOH COMPETITION is still pre-first-ceremony
    return !preCeremony;
  }
  let _ceremonyResolved = false; // last-known belt state, refreshed each poll from /state

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

  // F-2 wave 1 (DWE audit): the panel COMPOSES the window kit — chrome, drag,
  // minimize-to-dock, Escape, focus, persistence, and animations all come from
  // OrwellWindow (orwellWindow.js). This module keeps only what is social:
  // the approaches content, the poll loop, and the E60/E89 framing rules.
  let _win = null;
  function ensureUI() {
    let el = document.getElementById(ID);
    if (el) return el;
    const content = document.createElement("div");
    content.innerHTML = `
      <style>
        #orwell-social {
          width: 240px; display: none;
          font-family: 'Fira Code', ui-monospace, monospace; font-size: .74rem;
        }
        #orwell-social .osoc-hd { color: color-mix(in srgb, var(--fg, #9cdef2) 78%, var(--panel, #111)); margin: .15rem 0 .3rem; letter-spacing: .03em; }
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
          font-size: .9rem; line-height: 1; padding: .2rem .35rem; min-width: 24px; min-height: 24px;
        }
        /* E60: the chip's framing VARIES by the engine's coarse motive — a warm overture (bond)
           reads differently from someone sizing the player up (probe). A left accent rail carries
           the difference without leaking any number. */
        #orwell-social .osoc-chip.osoc-motive-bond  { border-left: 3px solid color-mix(in srgb, #4caf50 70%, var(--border, #355a66)); }
        #orwell-social .osoc-chip.osoc-motive-probe { border-left: 3px solid color-mix(in srgb, #e0a96c 70%, var(--border, #355a66)); }
        #orwell-social .osoc-chip.osoc-motive-neutral { border-left: 3px solid var(--border, #355a66); }
        #orwell-social .osoc-chip.osoc-chip-pending {
          border-color: var(--accent, #e06c75); opacity: .85;
        }
        #orwell-social .osoc-chip.osoc-chip-pending .osoc-go b {
          color: var(--accent, #e06c75);
        }
        /* C26/M1 + F3: phones — a full-width sheet whose POSITION the slot
           engine's sheet host owns (no per-panel top/left pins; the host
           stacks every visible sheet so two can never overlap). */
        @media (max-width: 768px) {
          #orwell-social {
            width: auto !important; max-width: none !important;
            border-radius: 0 0 12px 12px; border-left: none; border-right: none;
            max-height: 38vh; overflow: auto;
          }
        }
      </style>
      <div class="osoc-body">
        <div class="osoc-hd" id="osoc-appr-hd" style="display:none">Wants a word</div>
        <div id="osoc-appr"></div>
      </div>`;
    // E88 (ruling #4): the Diary Room is NOT here — it is a standing sidebar
    // button + a composer mode (orwellDiaryRoom.js). This panel is approaches only.
    _win = window.OrwellWindowKit.create({
      id: ID, title: "The House", icon: ICON,
      slot: "top-right", slotKey: "social", role: "complementary",
      // An ambient HUD parks (minimize); the game decides when it exists, so it
      // carries no close — a CAPABILITY of the one kit cluster, not bespoke chrome.
      minimizable: true, closable: false, draggable: true,
      content,
    });
    _win.open();
    return document.getElementById(ID);
  }

  // --- Approaches -------------------------------------------------------

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
    // E89 belt: before the first ceremony resolves, render NOTHING — even if the engine fails open
    // and hands us approaches at the premiere. The belt comes from the last /state poll.
    const allowed = _ceremonyResolved
      ? (Array.isArray(list) ? list : [])
      : [];
    const items = allowed
      .filter((it) => it && it.houseguest && it.houseguest.id && !dismissed.has(it.houseguest.id))
      .slice(0, MAX_APPROACHES); // a few may want you at once (U7)
    wrap.innerHTML = "";
    hd.style.display = items.length ? "block" : "none";
    for (const it of items) {
      const id = it.houseguest.id;
      const name = it.houseguest.name || "A houseguest";
      // E60: the engine ships a coarse MOTIVE (bond | probe), never a canned pretext line; the chip
      // VARIES its framing (copy + class + tooltip) by that enum — the GM voices the real scene.
      const framing = (it.motive && MOTIVE_FRAMING[it.motive]) || MOTIVE_FALLBACK;
      const pretext = it.pretext || framing.pretext;
      const chip = document.createElement("div");
      chip.className = "osoc-chip " + framing.cls;
      if (it.motive) chip.dataset.motive = it.motive;
      if (id === pendingApproachId) chip.classList.add("osoc-chip-pending");
      const go = document.createElement("button");
      go.type = "button";
      go.className = "osoc-go";
      go.title = framing.hint + " — prefills the composer";
      go.setAttribute("aria-label", "Hear " + name + " out (" + framing.hint + ")");
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

  // E60/E89 test seam (headless browser keep-set): drive the belt + motive framing WITHOUT a live
  // engine. `resolved` sets the FE belt; `list` is fed to renderApproaches exactly as a (possibly
  // fail-open) initiatives payload would be — so the smoke can prove the belt suppresses chips even
  // when approaches arrive early, and that bond/probe motives render distinct chips once it opens.
  window._orwellSocialDriveApproaches = (resolved, list) => {
    ensureUI();
    _ceremonyResolved = !!resolved;
    dismissed = new Set(); // a clean slate so the smoke isn't suppressed by prior dismissals
    renderApproaches(list || []);
    const wrap = document.getElementById("osoc-appr");
    const chips = wrap ? [...wrap.querySelectorAll(".osoc-chip")] : [];
    return {
      count: chips.length,
      motives: chips.map((c) => c.dataset.motive || null),
      classes: chips.map((c) => (c.className.match(/osoc-motive-\w+/) || [null])[0]),
    };
  };
  window._orwellFirstCeremonyResolved = (st) => firstCeremonyResolved(st);


  // --- Poll loop ----------------------------------------------------------------

  async function refresh() {
    let st;
    try {
      st = await getJSON("/api/orwell/state");
    } catch (_) {
      // ENGINE HICCUP (not "no game"): keep a shown panel up (U5) — just don't refresh
      // approaches. Only hide when we've never shown it (nothing to keep).
      if (window.OrwellReport) window.OrwellReport.fail("social", "state-poll", _); // G11: fail open, never silent
      _failures += 1;
      if (!_shown) hidePanel();
      return;
    }
    _failures = 0;
    if (!(st && st.started)) {
      _shown = false;
      _ceremonyResolved = false;
      hidePanel(); // genuinely no game
      return;
    }
    _shown = true;
    // E89 belt: track whether the first ceremony has resolved, from /state alone.
    _ceremonyResolved = firstCeremonyResolved(st);
    const el = ensureUI();
    // Keep approaches fresh, but if the player parked it in the dock, leave it there.
    // C26/M1: on a phone, first appearance parks in the chip dock (chat stays
    // unobstructed); the dock chip restores it as a full-width top sheet.
    if (isNarrow() && !_mobileParkedOnce && !isMinimized()) {
      _mobileParkedOnce = true;
      el.style.display = "block";
      try { if (_win) { _win.minimize(); return; } } catch (_) {}
    }
    if (!isMinimized()) el.style.display = "block";
    // E89 belt: don't even ask for approaches before the first ceremony resolves — and if the
    // engine fails open, renderApproaches([]) still suppresses everything against the belt.
    if (!_ceremonyResolved) { renderApproaches([]); return; }
    try {
      const data = await getJSON("/api/orwell/initiatives");
      renderApproaches(data && data.initiatives);
    } catch (_) {
      // initiatives hiccup: leave the existing chips, never blank them on a transient error
      if (window.OrwellReport) window.OrwellReport.fail("social", "initiatives-poll", _); // G11: fail open, never silent
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
