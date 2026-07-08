// M3-1 — the room strip (idea 1): a slim strip of portrait chips for who is in the player's
// CURRENT room, mounted directly above the composer. AUGMENTS the chat (ADR 0003 §4/§7): the
// chips are INERT — no click-to-act, no scene-starting affordance (M3-6 adds the dossier door
// later). The player still mills and talks in PROSE; this is a visual "who's here" ground,
// mirroring the "Where You Are" rail gadget (orwellPresence.js) but as faces, not names, and
// scoped to ROOM presence only (no nearby rooms).
//
// #642: composes the OrwellNotice kit (window.OrwellNoticeKit) for its above-composer anchor —
// the ONE stacked zone every such affordance shares (the convention gate test_on_notice_kit.py
// forbids a NEW module from hand-rolling its own DOM anchor beside the composer bar). kind:
// "guide" (the ambient, title-less, low-key skin orwellChatHint.js also uses) with dismissible:
// false — this is a persistent ambient strip, never a dismissible notice. Only this module's OWN
// inner CSS (the chip grid) stays here; the card shell/anchor/stacking/theming are the kit's.
//
// Renders ONLY the Vault-free whereabouts().present roster (id/name), the public roster's
// portrait/status facets (0051), the public ceremony roles (M2-2 badges), and the observable
// `asleep` set (ADR 0006) — never a stat, relationship, or hidden element.
//
//   • GET /api/orwell/state        → { started, asleep: [{id,name}] } — gates + turned-in set
//   • GET /api/orwell/whereabouts  → { whereabouts: { room, present:[{id,name}] } } | null
//   • GET /api/orwell/roster       → { roster: [{id,name,status,portrait}] } — portrait lookup
//   • GET /api/orwell/status       → the public ceremony board — OrwellMonogram.rolesFrom()
//
// Fail-open everywhere: any fetch failure or pre-game collapses the strip (no chips, no error).
(function () {
  "use strict";

  const POLL_MS = 25000;
  const ID = "orwell-room-strip";
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

  // ── the pure diff helper (node-unit-tested) ─────────────────────────────────────────
  // "Dimming on exit": a chip that drops out of `present` is NOT removed immediately — it is
  // held for ONE more render cycle at a dimmed "leaving" phase, then dropped. Pure (no DOM/
  // fetch/closures over module state) so a node harness can drive it directly against the
  // PREVIOUS chip map.
  //   prev: Map<key, { person, phase: 'here'|'leaving' }> (the chip map from the last render)
  //   present: array of { id?, name }  — this cycle's whereabouts().present
  // Returns { chips: [{ key, person, phase }], next: Map } — `chips` is display order (everyone
  // HERE first, then anyone LEAVING); `next` is the chip map to pass in as `prev` next cycle.
  function _diffPresence(prev, present) {
    const keyOf = (p) =>
      (p && p.id != null && p.id !== "" ? "id:" + p.id : "nm:" + String((p && p.name) || ""));
    const list = Array.isArray(present) ? present : [];
    const next = new Map();
    const currentKeys = new Set();
    list.forEach((p) => {
      const k = keyOf(p);
      currentKeys.add(k);
      next.set(k, { person: p, phase: "here" });
    });
    const leavingKeys = [];
    (prev || new Map()).forEach((entry, k) => {
      if (currentKeys.has(k)) return; // still here — the fresh "here" entry above wins
      if (entry && entry.phase === "here") {
        next.set(k, { person: entry.person, phase: "leaving" }); // just left — one dimmed cycle
        leavingKeys.push(k);
      }
      // phase === "leaving" already ⇒ its grace cycle is over; drop (not carried into `next`)
    });
    const chips = list.map((p) => ({ key: keyOf(p), person: p, phase: "here" }));
    leavingKeys.forEach((k) => chips.push({ key: k, person: next.get(k).person, phase: "leaving" }));
    return { chips, next };
  }

  function firstName(full) { return String(full || "").trim().split(/\s+/)[0] || ""; }

  // Only the chip grid — the card shell/anchor/dismiss/animation/theming are the kit's (#642).
  function ensureCss() {
    if (document.getElementById("orwell-room-strip-css")) return;
    const st = document.createElement("style");
    st.id = "orwell-room-strip-css";
    st.textContent = `
      #orwell-room-strip .ors-row {
        display: flex; gap: 10px; align-items: flex-start; flex-wrap: nowrap;
        overflow-x: auto; overflow-y: hidden;
        -webkit-overflow-scrolling: touch; scrollbar-width: thin;
      }
      #orwell-room-strip .ors-chip {
        flex: 0 0 auto; width: 52px; display: flex; flex-direction: column;
        align-items: center; gap: 3px; transition: opacity .6s ease;
      }
      #orwell-room-strip .ors-chip-leaving { opacity: .35; }
      #orwell-room-strip .ors-face-wrap {
        width: 40px; height: 40px; border-radius: 10px; overflow: hidden;
        box-shadow: 0 1px 3px rgba(0,0,0,.35);
      }
      #orwell-room-strip .ors-face-wrap .ow-mono-face { border-radius: 10px; }
      #orwell-room-strip .ors-moon {
        position: absolute; left: -2px; top: -2px; font-size: .58rem; line-height: 1;
        background: rgba(10,14,20,.78); border-radius: 50%; padding: 2px 3px;
      }
      #orwell-room-strip .ors-name {
        font-size: .65rem; line-height: 1.15; text-align: center; max-width: 52px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .82;
      }
      @media (max-width: 480px) {
        #orwell-room-strip .ors-row { gap: 6px; }
        #orwell-room-strip .ors-chip { width: 42px; }
        #orwell-room-strip .ors-face-wrap { width: 32px; height: 32px; }
        #orwell-room-strip .ors-name { display: none; }
      }
    `;
    document.head.appendChild(st);
  }

  // The kit notice instance (a title-less "guide"-kind card — the ambient look orwellChatHint.js
  // also uses). Built lazily; mounted/unmounted per render (never shown empty — DoD: collapses
  // gracefully pre-game, never a hollow bordered box).
  let _notice = null;
  function ensureNotice() {
    if (_notice) return _notice;
    if (!window.OrwellNoticeKit) return null; // kit not loaded yet — fail open, try again next tick
    _notice = window.OrwellNoticeKit.create({
      id: ID, kind: "guide", title: "", role: "group",
      dismissible: false, persistDismiss: false,
    });
    return _notice;
  }

  function titleFor(person, opts) {
    let t = (person && person.name) || "";
    if (opts && opts.asleep) t += " — turned in for the night";
    if (opts && opts.leaving) t += " — just left the room";
    return t;
  }

  // The one shared face builder — composes OrwellMonogram.face() (M2-2) so a portrait-less
  // houseguest reads as the designed monogram, never a flat placeholder, and a public ceremony
  // role composites its badge exactly as the cast window/decision cards do.
  function faceFor(person, rosterById, roles, asleep) {
    const rc = person && person.id != null ? rosterById.get(person.id) : null;
    const card = {
      id: (person && (person.id != null ? person.id : person.name)) || "?",
      name: person && person.name,
      status: (rc && rc.status) || "active",
      portrait: rc ? rc.portrait : null,
    };
    const role = roles ? (roles[card.id] || (person && roles[person.name]) || null) : null;
    const faceEl = window.OrwellMonogram
      ? window.OrwellMonogram.face(card, { role: role, alt: card.name })
      : document.createElement("span");
    if (asleep) {
      faceEl.insertAdjacentHTML(
        "beforeend",
        '<span class="ors-moon" aria-hidden="true" title="Turned in for the night">🌙</span>',
      );
    }
    return faceEl;
  }

  let _chipState = new Map(); // the room's chip map, carried across renders

  // ctx: { room, present, roster, roles, asleep } — or null/incomplete to collapse the strip.
  function render(ctx) {
    const notice = ensureNotice();
    if (!notice) return;
    if (!ctx || !ctx.room || !Array.isArray(ctx.present)) {
      _chipState = new Map();
      if (notice.isShown()) notice.hide(); // pre-game / no room ⇒ fully unmounted, never a hollow card
      return;
    }

    const { chips, next } = _diffPresence(_chipState, ctx.present);
    _chipState = next;
    if (!chips.length) {
      if (notice.isShown()) notice.hide();
      return;
    }

    const rosterById = new Map();
    (ctx.roster || []).forEach((h) => { if (h && h.id != null) rosterById.set(h.id, h); });
    const asleepIds = new Set();
    (ctx.asleep || []).forEach((p) => {
      if (!p) return;
      if (p.id != null) asleepIds.add(p.id);
      if (p.name) asleepIds.add(p.name);
    });

    ensureCss();
    const body = notice.ensure(); // mounts (idempotent) into the shared above-composer zone
    if (notice.el) {
      // Title-less ambient strip (mirrors orwellChatHint.js): no heading row, just the chips.
      const head = notice.el.querySelector(".on-head");
      if (head) head.style.display = "none";
      if (!notice.el.hasAttribute("aria-label")) {
        notice.el.setAttribute("aria-label", "Who's in the room with you");
      }
    }

    const row = document.createElement("div");
    row.className = "ors-row";
    chips.forEach((c) => {
      const leaving = c.phase === "leaving";
      const asleep = asleepIds.has(c.person && c.person.id) || asleepIds.has(c.person && c.person.name);

      const chip = document.createElement("div");
      chip.className = "ors-chip" + (leaving ? " ors-chip-leaving" : "");
      chip.title = titleFor(c.person, { asleep: asleep, leaving: leaving });

      const faceWrap = document.createElement("div");
      faceWrap.className = "ors-face-wrap";
      faceWrap.appendChild(faceFor(c.person, rosterById, ctx.roles, asleep));
      chip.appendChild(faceWrap);

      const label = document.createElement("span");
      label.className = "ors-name";
      label.textContent = firstName(c.person && c.person.name);
      chip.appendChild(label);

      row.appendChild(chip);
    });
    body.innerHTML = "";
    body.appendChild(row);
  }

  async function tick() {
    try {
      if (document.hidden) return; // a hidden tab polls nothing (C18)
      const state = await getJSON("/api/orwell/state");
      if (!state || !state.started) { render(null); _failures = 0; return; }
      const whereData = await getJSON("/api/orwell/whereabouts");
      const w = whereData ? whereData.whereabouts : null;
      if (!w || !w.room) { render(null); _failures = 0; return; }

      // Portraits + role badges are enhancements over the bare NamedRef chips — a failure on
      // either never blanks the strip (it just falls back to designed monograms/no badge).
      let roster = [];
      try {
        const rosterData = await getJSON("/api/orwell/roster");
        roster = (rosterData && Array.isArray(rosterData.roster)) ? rosterData.roster : [];
      } catch (_) { /* fall back to monograms */ }
      let roles = {};
      try {
        const statusData = await getJSON("/api/orwell/status");
        roles = (window.OrwellMonogram && statusData) ? window.OrwellMonogram.rolesFrom(statusData) : {};
      } catch (_) { /* fall back to no role badges */ }

      render({ room: w.room, present: w.present, roster: roster, roles: roles, asleep: state.asleep });
      _failures = 0;
    } catch (_) {
      _failures += 1;
      if (window.OrwellReport) window.OrwellReport.fail("roomstrip", "poll", _); // G11: fail open, never silent
      render(null); // fail OPEN: the strip simply isn't there
    } finally {
      if (timer) clearTimeout(timer);
      timer = setTimeout(tick, _pollDelay());
    }
  }

  // An immediate refresh that resets the poll cadence — driven by the shared game-changed signal.
  function refreshNow() {
    _failures = 0;
    tick();
  }

  ready(() => {
    // Only under the game build (the reduced surface) — the full workspace skips the strip.
    if (document.body && document.body.dataset.gameBuild !== "1") return;
    tick();
    // LISTEN only — the one shared debounced dispatcher lives in platform.js (g15). This module
    // never dispatches `orwell:gamechanged` itself.
    window.addEventListener("orwell:gamechanged", refreshNow);
    window.addEventListener("beforeunload", () => timer && clearTimeout(timer));
  });
})();
