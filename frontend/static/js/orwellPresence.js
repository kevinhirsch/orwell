// Orwell "Where you are" gadget (feature 0049 / C28 / L26+L14) — the AMBIENT ground for
// lingering play.
//
// Renders the engine's Vault-free whereabouts() — the player's room + who's with them, and the
// VISIBLE adjacent rooms (the engine only ever returns the player's room + rooms one step away,
// so this is fog-of-war by construction). It AUGMENTS the chat and never replaces it
// (ADR 0003 §4/§7): no click-to-move, no button that starts a scene or advances the game — the
// player still mills, asks "who's here?", and talks in PROSE; the engine grounds the narration.
//
//   • GET /api/orwell/state        → gate on an active game (started)
//   • GET /api/orwell/whereabouts  → { whereabouts: { room, present[], nearby[{room, present[]}] } } | null
//
// L26 redesign:
//   HEADER = the room you're in + who's with you, FIRST NAMES — "Kitchen — Keith, John, Joe"
//            (or "Kitchen — alone" when no one is present).
//   BODY   = the VISIBLE nearby rooms from your perspective — each room that HAS people, with its
//            houseguests' first names — "Living Room: Mary, Sam". Empty/out-of-view rooms are
//            omitted entirely; "No one nearby." when nothing adjacent has anyone.
//
// L14 (subsumed): FIRST names only, disambiguated as "First L." when two distinct people across
// the WHOLE current view share a first name (so the same person reads consistently everywhere).
// See _displayNames — the single name-formatting helper (node-unit-tested in
// test_l26_whereabouts.py).
//
// Fail-open everywhere: no gadget on empty/error/pre-game.
(function () {
  "use strict";

  const POLL_MS = 25000;
  const ID = "orwell-presence";
  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn, { once: true })
      : fn();

  let timer = null;
  let _failures = 0;
  let _lastAnnounced = null; // A11Y-1: last SR-announced header line, to announce only on change
  function _pollDelay() { return Math.min(POLL_MS * Math.pow(2, _failures), 120000); }

  async function getJSON(url) {
    const r = await fetch(url, { credentials: "same-origin" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  function roomLabel(room) {
    // "living-room" → "Living Room" (the engine's ids are kebab-case room names).
    // A lone trailing letter is a room identifier, not a word ("bedroom-b"), so it
    // must read "Bedroom B", not "Bedroom b" — title case otherwise.
    const s = String(room || "").replace(/-/g, " ").trim();
    if (!s) return s;
    return s
      .split(" ")
      .map((w) =>
        w.length === 1
          ? w.toUpperCase()
          : w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  // ── the single name-formatting helper (L14, unit-tested) ───────────────────
  // Given the WHOLE current whereabouts view (the present list plus every nearby room's present
  // list), format a person's display name as a FIRST name only — disambiguating any first name
  // shared by 2+ DISTINCT people anywhere in the view as "First L." (the last name's initial),
  // so the same person reads consistently everywhere. Self-contained — only String/Array/Map
  // primitives — so a node harness can extract and exercise it directly.
  //
  //   people: array of { id?, name } from every visible list (present + all nearby).
  //   returns: { format(person) → string }.
  function _displayNames(people) {
    const list = Array.isArray(people) ? people : [];
    const firstOf = (full) => String(full || "").trim().split(/\s+/)[0] || "";
    const initialOf = (full) => {
      const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
      return parts.length > 1 ? parts[parts.length - 1].charAt(0).toUpperCase() : "";
    };
    // identity key: prefer a stable id; else the full name (so one person listed in two rooms
    // is counted ONCE, while two same-named strangers with no id are still two people).
    const idOf = (p) =>
      (p && p.id != null && p.id !== "" ? "id:" + p.id : "nm:" + String((p && p.name) || ""));

    // Count DISTINCT people per first name across the whole view.
    const peopleByFirst = new Map();   // first → Set<identity key>
    for (const p of list) {
      const f = firstOf(p && p.name);
      if (!f) continue;
      if (!peopleByFirst.has(f)) peopleByFirst.set(f, new Set());
      peopleByFirst.get(f).add(idOf(p));
    }

    function format(p) {
      const f = firstOf(p && p.name);
      if (!f) return String((p && p.name) || "").trim();
      const distinct = peopleByFirst.get(f);
      if (distinct && distinct.size > 1) {
        const init = initialOf(p && p.name);
        return init ? f + " " + init : f;  // no last name to split on ⇒ bare first name
      }
      return f;
    }
    return { format };
  }

  // Flatten every visible person (present + all nearby) into one list — the dedup scope.
  function _allPeople(w) {
    const out = [];
    ((w && w.present) || []).forEach((p) => out.push(p));
    ((w && w.nearby) || []).forEach((n) => ((n && n.present) || []).forEach((p) => out.push(p)));
    return out;
  }

  function ensureEl() {
    let el = document.getElementById(ID);
    if (el) return el;
    // Sidebar chrome, NOT a floating strip (user verdict): a fixed bottom-center bar
    // covered the composer/chat. Dock it in #sidebar next to the game gadgets, mirroring
    // #orwell-status / #orwell-social (ruling #3/E64/H5) — static flow, full sidebar
    // width, no z-index, in the sidebar drawer on mobile like every other section.
    if (!document.getElementById("orwell-presence-css")) {
      const st = document.createElement("style");
      st.id = "orwell-presence-css";
      st.textContent = `
        #orwell-presence {
          display: none;
          margin: var(--space-2) var(--space-2) 0;
          padding: var(--space-2) var(--space-3);
          background: color-mix(in srgb, var(--panel, #111) 70%, transparent);
          color: var(--fg, #9cdef2);
          border: 1px solid var(--border, #355a66); border-radius: 10px;
          font-family: 'Fira Code', ui-monospace, monospace;
          font-size: var(--fs-xs); line-height: 1.5;
        }
        #orwell-presence .opres-hd {
          color: color-mix(in srgb, var(--fg, #9cdef2) 78%, var(--panel, #111));
          margin: 0 0 .3rem; font-weight: 600; letter-spacing: .03em;
          overflow-wrap: anywhere;
        }
        #orwell-presence .opres-body { overflow-wrap: anywhere; }
        #orwell-presence .opres-room { display: block; }
        #orwell-presence .opres-room .opres-r {
          color: color-mix(in srgb, var(--fg, #9cdef2) 70%, var(--panel, #111));
        }
        #orwell-presence .opres-quiet { opacity: .6; font-style: italic; }`;
      document.head.appendChild(st);
    }
    el = document.createElement("section");
    el.id = ID;
    // A11Y-1: do NOT make the root a live region — re-writing head/body every 25s poll would
    // re-announce the unchanged room to a screen reader 2-3x/min. A dedicated hidden child gets
    // only the CHANGED header string (the #os-announce delta pattern from orwellStatusPanel).
    el.innerHTML = `<div class="opres-hd" data-role="head"></div>` +
      `<div class="opres-body" data-role="body"></div>` +
      `<span data-role="announce" aria-live="polite" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);"></span>`;
    // Mount inside the sidebar, beside the other game gadgets (the status HUD /
    // "Wants a word"). Fall back to the session list, then the sidebar, then body.
    // 0054: prefer the control-room gadget rail (under the other gadgets when present).
    const rail = document.getElementById("gadget-rail-body");
    const sidebar = document.getElementById("sidebar");
    const anchor = document.getElementById("orwell-status");
    if (rail && anchor && anchor.parentElement === rail) rail.insertBefore(el, anchor.nextSibling);
    else if (rail) rail.appendChild(el);
    else if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(el, anchor.nextSibling);
    else if (sidebar) sidebar.appendChild(el);
    else document.body.appendChild(el);
    return el;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function render(w) {
    const el = ensureEl();
    if (!w || !w.room) { el.style.display = "none"; _lastAnnounced = null; return; }
    el.dataset.room = w.room;

    // One dedup scope across the whole visible view (present + every nearby room).
    const names = _displayNames(_allPeople(w));
    const join = (list) => (list || []).map((p) => names.format(p)).filter(Boolean).join(", ");

    // HEADER: the room you're in + who's with you (first names) — or "alone".
    const present = Array.isArray(w.present) ? w.present : [];
    const here = present.length ? join(present) : "alone";
    const headLine = roomLabel(w.room) + " — " + here;
    el.querySelector("[data-role='head']").textContent = headLine;
    // A11Y-1: announce ONLY when the line actually changed (not on every poll).
    if (headLine !== _lastAnnounced) {
      const ann = el.querySelector("[data-role='announce']");
      if (ann) ann.textContent = headLine;
      _lastAnnounced = headLine;
    }

    // BODY: the VISIBLE nearby rooms that HAVE people, each with first names.
    const rooms = (Array.isArray(w.nearby) ? w.nearby : [])
      .filter((n) => n && n.present && n.present.length);
    const body = el.querySelector("[data-role='body']");
    if (!rooms.length) {
      body.innerHTML = '<span class="opres-quiet">No one nearby.</span>';
    } else {
      body.innerHTML = rooms
        .map((n) =>
          '<span class="opres-room"><span class="opres-r">' + esc(roomLabel(n.room)) +
          ':</span> ' + esc(join(n.present)) + "</span>")
        .join("");
    }
    el.style.display = "block";
  }

  async function tick() {
    try {
      if (document.hidden) return; // a hidden tab polls nothing (C18)
      const state = await getJSON("/api/orwell/state");
      if (!state || !state.started) { render(null); return; }
      const data = await getJSON("/api/orwell/whereabouts");
      render(data ? data.whereabouts : null);
      _failures = 0;
    } catch (_) {
      _failures += 1;
      if (window.OrwellReport) window.OrwellReport.fail("presence", "whereabouts-poll", _); // G11: fail open, never silent
      render(null); // fail OPEN: the gadget simply isn't there
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
    // Only under the game build (the reduced surface) — the full workspace skips the gadget.
    if (document.body && document.body.dataset.gameBuild !== "1") return;
    tick();
    // Refresh on the shared game-changed signal (platform.js dispatches it after every
    // engine-mutating turn) so the room/co-presence updates the moment the player moves.
    window.addEventListener("orwell:gamechanged", refreshNow);
    window.addEventListener("beforeunload", () => timer && clearTimeout(timer));
  });
})();
