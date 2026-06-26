// Orwell status panel — the game's standing readout, docked in the sidebar (E64).
//
// Polls the engine's public ceremony status (week / phase / HOH / nominees / veto)
// via GET /api/orwell/status and renders a permanent section inside #sidebar
// whenever a game is in progress. It shows ONLY ceremony-level public facts the
// engine projects — no stats, souls, or hidden state ever reach it (the Vault
// Wall holds on the engine side). It FAILS OPEN: if the engine is unreachable or
// no game is running, the section simply hides and never disturbs the chat.
//
// RULING (#3 / E64): this is not a window. No drag, no saved position, no
// minimize dock, no z-index — it is sidebar chrome, full sidebar width, below
// the session list; on mobile it lives in the sidebar drawer like everything
// else. Collapsible in place; the collapsed state persists per user+game (E71).
import { onNarrowChange } from './platform.js';

(function () {
  "use strict";

  const POLL_MS = 20000;
  const ID = "orwell-status";
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

  // E71: panel client state is keyed per user + game (the player's name is the
  // closest stable public game discriminator the FE holds), so one account's
  // collapse/dismiss state never leaks into another's, or into season 2.
  let _gameKey = "";
  function storageKey(base) {
    return base + ":" + _gameKey;
  }

  // F1 (G5 refresh-persistence audit / Lane G16): the collapse used to be
  // WRITTEN under the full per-user+game key but RESTORED under a half-built
  // one — _gameKey was only assigned mid-render (renderRoster), AFTER
  // ensurePanel()'s one-time boot read, so the persisted value was unreachable
  // forever and the E71 "persists per user+game" promise was silently broken.
  // The key is now derived from the payloads in hand BEFORE the panel build
  // (render() assigns it ahead of ensurePanel()), and the persisted collapse
  // re-applies whenever the key changes (game change / season 2) — E71
  // scoping intact.
  function computeGameKey(state) {
    return ((state && state.player && state.player.name) || "") + ":" +
           ((document.body && document.body.dataset.user) || "");
  }
  let _applyCollapsed = null;     // ensurePanel's setCollapsed, exposed for re-application
  let _collapseKeyApplied = null; // the _gameKey whose persisted collapse was last applied
  function reapplyPersistedCollapse() {
    if (!_applyCollapsed || _collapseKeyApplied === _gameKey) return;
    _collapseKeyApplied = _gameKey;
    try {
      _applyCollapsed(localStorage.getItem(storageKey("orwell-status-collapsed")) === "1");
    } catch (_) {}
  }

  // The player's OWN ceremony role from PUBLIC facts (HOH / on the block / veto) — derived by
  // id-comparison, never a "safe/target" read (0020). Returns "" when the player is just a
  // houseguest, or their out-of-game seat ("Evicted" / "Jury") when they're out.
  // #556 (launch-blocker): after an IN-SESSION next-season hand-off (S1→S2 with no page reload),
  // the engine's player.status could still read "evicted"/"jury" from the prior season, so an
  // ACTIVE player was falsely badged EVICTED for the whole new season (S1→S2 was only ever clean
  // because it involved a page reload). A player can only legitimately be out once an eviction has
  // actually happened THIS season: the season is finished, week > 1, or at least one houseguest is
  // already out. A pristine live season (not finished, week ≤ 1, nobody out) ⇒ the seat is stale.
  function seatStale(status, state) {
    const finished = !!(status && status.finished);
    const week = (status && typeof status.week === "number") ? status.week : 0;
    const house = (state && Array.isArray(state.house)) ? state.house : [];
    const anyOut = house.some((h) => h && h.status && h.status !== "active");
    return !(finished || week > 1 || anyOut);
  }

  function selfBadge(status, state) {
    const me = state && state.player && state.player.id;
    const seat = state && state.player && state.player.status;
    if (seat === "evicted") return seatStale(status, state) ? "" : "EVICTED"; // #556
    if (seat === "jury") return seatStale(status, state) ? "" : "JURY";
    if (!me || !status) return "";
    const idOf = (c) => (c && typeof c === "object" ? c.id : c);
    if (idOf(status.hoh) === me) return "HOH";
    const noms = Array.isArray(status.nominees) ? status.nominees.map(idOf) : [];
    if (noms.includes(me)) return "ON THE BLOCK";
    const veto = status.veto || {};
    if (idOf(veto.holder) === me) return "VETO";
    return "";
  }

  // #640: compose the OrwellGadget kit (collapsible). The kit owns the card shell, the
  // collapsible header (role=button + chevron + the persisted/synced collapse), and the rail
  // mount. This panel's DYNAMIC header line (Week N / phase / time-of-day / stale-dot) renders
  // into the kit's TITLE slot — so the live readout still reads as the card title, exactly as
  // before — and everything else renders in the body. Only this gadget's own inner CSS stays here.
  let _gadget = null;
  function ensurePanel() {
    let el = document.getElementById(ID);
    if (el) return el;
    if (!document.getElementById("orwell-status-css")) {
      const st = document.createElement("style");
      st.id = "orwell-status-css";
      st.textContent = `
        /* the dynamic header line (Week / phase / tod / rest), rendered into the kit title slot */
        #orwell-status .os-ttl { display: flex; align-items: baseline; gap: .4rem; flex: 1; min-width: 0; flex-wrap: wrap; }
        #orwell-status .os-phase { opacity: .65; font-weight: 400; text-transform: capitalize; }
        #orwell-status .os-tod { opacity: .85; font-weight: 400; font-size: .92em; }
        #orwell-status .os-rest { opacity: .6; font-weight: 400; font-style: italic; margin-left: .45em; font-size: .9em; }
        #orwell-status .os-row { display: flex; gap: .4rem; }
        #orwell-status .os-row .os-k { color: color-mix(in srgb, var(--fg, #9cdef2) 78%, var(--panel, #111)); min-width: 4.2em; }
        #orwell-status .os-row .os-v { flex: 1; }
        #orwell-status .os-noms { color: var(--red, #e06c75); }
        /* #759: NO accent hue on TEXT while glass is on. On the light glass material the
           nominees line must read as the same neutral dark chrome ink the rest of the glass
           HUD uses (#16191f) — not var(--red), which washes to an illegible light grey on
           the light glass (~2.2:1). The flash highlight (.os-changed) is a NON-text effect
           and is untouched. Normal (non-glass) tier keeps the accent. */
        body.theme-frosted #orwell-status .os-noms { color: #16191f; }
        /* TRANS-3: a brief delta highlight when a power row CHANGES (HOH / noms / veto /
           phase) so a ceremony reveal is never a silent text swap. Theme-token driven. */
        #orwell-status .os-changed {
          animation: os-row-flash 1.6s ease-out 1;
          border-radius: 4px;
        }
        @keyframes os-row-flash {
          0%   { background: color-mix(in srgb, var(--accent, #9cdef2) 42%, transparent); }
          100% { background: transparent; }
        }
        @media (prefers-reduced-motion: reduce) {
          /* No motion — a static tint that lingers then is cleared by the JS timeout. */
          #orwell-status .os-changed {
            animation: none;
            background: color-mix(in srgb, var(--accent, #9cdef2) 22%, transparent);
          }
        }
        /* Offline dot (U5): the feed reconnecting, not gone — last-known stays visible. */
        #orwell-status .os-stale { color: #e0a500; margin-left: .35rem; font-size: .7em; vertical-align: middle; }
        /* Memory wall (C21): the roster a real houseguest can see. Public facts only. */
        #orwell-status .os-you { margin: .35rem 0 .1rem; font-weight: 600; }
        #orwell-status .os-you .os-badge {
          display: inline-block; margin-left: .4rem; padding: 0 .4em; border-radius: .5em;
          font-size: .72em; font-weight: 700; letter-spacing: .02em;
          background: var(--accent, var(--red, #e06c75)); color: var(--on-accent, #fff);
        }
        /* #955: the house TALLY only — "The House · N/N". The per-person name list was removed
           from the status panel (it duplicated the cast PHOTO gallery, which is now the single
           roster surface). This header keeps the at-a-glance attrition count; the names + faces
           live in the Cast Photos gadget (#orwell-cast), which docks under the night gadget. */
        #orwell-status .os-roster-h { opacity: .55; font-size: max(.8em, 11px); margin: .4rem 0 .15rem; }
        /* F4: the clean terminal/post-season state — shown instead of stale ceremony rows once the
           season is over (finished). */
        #orwell-status .os-done { margin: .2rem 0 .15rem; font-weight: 600; }
        #orwell-status .os-done .os-winner { color: var(--accent, var(--red, #e06c75)); }
        /* #759: same rule for the season WINNER name on the light glass — neutral dark ink,
           never the accent (which is illegible on the light glass). Non-glass tier keeps it. */
        body.theme-frosted #orwell-status .os-done .os-winner { color: #16191f; }
        /* J3-07/J3-08 (wayfinding): the PREMIERE objective + progress — the persistent answer to
           "why hasn't HOH started, and how far am I?". Shown only during the premiere (it is the
           current objective); the count is the player-mental-model NPC figure ("X of 15"). */
        #orwell-status .os-premiere { margin: .2rem 0 .25rem; }
        #orwell-status .os-prem-obj { font-weight: 600; }
        #orwell-status .os-prem-obj .os-prem-count {
          margin-left: .4rem; font-weight: 700;
          color: var(--accent, #9cdef2);
        }
        #orwell-status .os-prem-left { opacity: .7; font-size: .9em; margin-top: .1rem; }`;
      document.head.appendChild(st);
    }

    // Compose the kit (collapsible). persistCollapsed:false — this panel keeps its OWN E71
    // per-user+GAME collapse key (a richer scoping than the kit's per-user); the kit renders the
    // chevron + role=button header + toggle wiring + DOM state, and delegates persistence here.
    // 0054: the kit mounts into the rail (sidebar → body fallback). NB: this panel's legacy
    // fallback anchored after #sessions-section; the kit's fallback is the sidebar root — both
    // land it in the sidebar when there's no rail, which is all the E64 placement requires.
    _gadget = window.OrwellGadgetKit.create({
      id: ID, title: "House Status", ariaLabel: "Game status",
      collapsible: true, persistCollapsed: false,
      // E71: this panel owns a richer per-user+GAME collapse key than the kit's per-user one — so
      // it persists in the kit's onCollapse hook (fired on every header toggle), keyed to _gameKey.
      onCollapse: (on) => {
        try { localStorage.setItem(storageKey("orwell-status-collapsed"), on ? "1" : ""); } catch (_) {}
      },
    });
    const body = _gadget.ensure();
    el = _gadget.el;
    // The DYNAMIC header line (Week / phase / tod / stale-dot) renders into the kit TITLE slot —
    // so the live readout still reads as the card title exactly as before. Replace the static title.
    const titleSlot = el.querySelector(".og-title");
    titleSlot.classList.add("os-ttl");
    titleSlot.removeAttribute("role"); titleSlot.removeAttribute("aria-level");
    titleSlot.innerHTML =
      '<span id="os-week">Week —</span>' +
      '<span class="os-phase" id="os-phase"></span>' +
      '<span class="os-tod" id="os-tod" hidden title="Time of day in the house"></span>' +
      '<span class="os-stale" id="os-stale" hidden title="Reconnecting to the feed…" aria-label="feed offline">●</span>';
    body.innerHTML = `
        <div class="os-done" id="os-done" hidden>Season complete<span id="os-done-winner"></span></div>
        <div class="os-premiere" id="os-premiere" hidden>
          <div class="os-prem-obj">Meet the house<span class="os-prem-count" id="os-prem-count"></span></div>
          <div class="os-prem-left" id="os-prem-left" hidden></div>
        </div>
        <div class="os-ceremony" id="os-ceremony">
          <div class="os-you" id="os-you">You<span class="os-badge" id="os-you-badge" hidden></span><span class="os-rest" id="os-you-rest" hidden title="How rested you are — your own read"></span></div>
          <div class="os-row"><span class="os-k">HOH</span><span class="os-v" id="os-hoh">—</span></div>
          <div class="os-row"><span class="os-k">Noms</span><span class="os-v os-noms" id="os-noms">—</span></div>
          <div class="os-row"><span class="os-k">Veto</span><span class="os-v" id="os-veto">—</span></div>
        </div>
        <div class="os-roster-h" id="os-roster-h" role="heading" aria-level="3">The House</div>
        <div id="os-announce" aria-live="polite" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);"></div>`;

    // Collapse persistence stays E71 per user+game — the kit drives the DOM (class + chevron +
    // aria-expanded/label) AND fires onCollapse above, which writes the per-game key. So this
    // setter is just _gadget.setCollapsed; a header toggle, a boot restore, and a season re-apply
    // all flow through the one path (and persist the right key).
    const setCollapsed = (on) => _gadget.setCollapsed(!!on);
    try {
      if (localStorage.getItem(storageKey("orwell-status-collapsed")) === "1") setCollapsed(true);
    } catch (_) {}
    // F1: the read above ran under the key render() computed BEFORE this build;
    // expose the setter + record the key so a later key change re-applies.
    _applyCollapsed = setCollapsed;
    _collapseKeyApplied = _gameKey;
    return el;
  }

  function hidePanel() {
    const el = document.getElementById(ID);
    if (el) el.style.display = "none";
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

  // ADR 0006 — the in-game clock. A simple time-of-day graphic (no 12/24h), morning → late night.
  const TOD_LABELS = {
    "morning": "🌅 Morning", "afternoon": "🌞 Afternoon", "evening": "🌆 Evening",
    "night": "🌙 Night", "late-night": "🌌 Late night",
  };
  const todLabel = (t) => TOD_LABELS[t] || "";

  // A3: announce only what CHANGED, in show terms — never a full re-read per poll.
  let _last = { phase: null, hoh: null, noms: null, veto: null };

  // TRANS-3 (#627): the power-transition / ceremony reveal used to land as a silent
  // textContent swap (no crown drop, no row flash) — when the narrator under-calls
  // the change degraded to an invisible flip. Give the CHANGED HUD row a brief delta
  // highlight (the delta is already computed for the SR announce). The CSS is
  // prefers-reduced-motion-gated: a static tint with no motion under `reduce`.
  function flashRow(el, sel) {
    try {
      const node = el.querySelector(sel);
      if (!node) return;
      node.classList.remove("os-changed");
      void node.offsetWidth;            // restart the animation if it fires again quickly
      node.classList.add("os-changed");
      const clear = () => node.classList.remove("os-changed");
      node.addEventListener("animationend", clear, { once: true });
      setTimeout(clear, 2200);          // belt-and-suspenders (reduced-motion never fires animationend)
    } catch (_) {}
  }

  function announceDeltas(el, st, names) {
    const a = el.querySelector("#os-announce");
    if (!a) return;
    const msgs = [];
    const cur = {
      phase: phaseLabel(st.phase),
      hoh: names.hoh, noms: names.noms, veto: names.veto,
    };
    if (_last.phase !== null) {
      if (cur.phase !== _last.phase) { msgs.push(cur.phase + "."); flashRow(el, "#os-phase"); }
      if (cur.hoh !== _last.hoh && cur.hoh !== "—") { msgs.push("Head of Household: " + cur.hoh + "."); flashRow(el, "#os-hoh"); }
      if (cur.noms !== _last.noms && cur.noms !== "—") { msgs.push("On the block: " + cur.noms + "."); flashRow(el, "#os-noms"); }
      if (cur.veto !== _last.veto && cur.veto !== "—") { msgs.push("Veto: " + cur.veto + "."); flashRow(el, "#os-veto"); }
    }
    _last = cur;
    if (msgs.length) a.textContent = msgs.join(" ");
  }

  function render(st) {
    if (st && st._state !== undefined) _gameKey = computeGameKey(st._state); // F1: key before the build
    const el = ensurePanel();
    reapplyPersistedCollapse();
    // No active game (engine reports week 0 / setup) → genuinely hide (not a hiccup).
    if (!st || typeof st.week !== "number" || st.week < 1) {
      _shown = false;
      _failures = 0;
      markStale(false);
      try { document.body.dataset.gameActive = ""; } catch (_) {} // E93: pre-game is OOC
      hidePanel();
      return;
    }
    _shown = true;
    try { document.body.dataset.gameActive = "1"; } catch (_) {} // E93: the record is live
    const name = (c) => (c && c.name) || "—";

    // F4(b): gate the rendered state on started && !finished. Once the season is OVER (the engine's
    // public over-signal), the live ceremony rows are stale — render a clean terminal state ("Season
    // complete — winner: <name>") instead of a frozen "Week N / Phase". The winner is the Vault-free
    // broadcast winner the status projection now carries.
    const done = !!st.finished;
    const ceremonyEl = el.querySelector("#os-ceremony");
    const doneEl = el.querySelector("#os-done");
    if (done) {
      el.querySelector("#os-week").textContent = "Season complete";
      el.querySelector("#os-phase").textContent = "";
      { const t = el.querySelector("#os-tod"); if (t) t.hidden = true; } // ADR 0006: no clock post-season
      if (ceremonyEl) ceremonyEl.hidden = true;
      const w = st.winner && st.winner.name;
      if (doneEl) {
        doneEl.hidden = false;
        doneEl.querySelector("#os-done-winner").innerHTML =
          w ? ' — winner: <span class="os-winner">' + esc(w) + "</span>" : "";
      }
      // F-NEW-11: the highest-stakes event must reach SR users — announce the result once
      // through the dedicated polite announcer (the winner is injected via innerHTML into a
      // non-live node, so without this the season's end is silent). Guard on a change so a
      // re-poll of the same finished state doesn't re-announce every cadence.
      if (_last.done !== true) {
        const a = el.querySelector("#os-announce");
        if (a) a.textContent = w ? ("Season complete. The winner is " + w + ".") : "Season complete.";
      }
      _last = { phase: null, hoh: null, noms: null, veto: null, done: true }; // reset deltas; result announced above
      if (st._state !== undefined) renderRoster(el, st, st._state);
      el.style.display = "block";
      return;
    }
    if (ceremonyEl) ceremonyEl.hidden = false;
    if (doneEl) doneEl.hidden = true;

    el.querySelector("#os-week").textContent = "Week " + st.week;
    el.querySelector("#os-phase").textContent = phaseLabel(st.phase);
    // ADR 0006: the in-game clock (opt-in engine side; absent ⇒ the chip simply stays hidden).
    { const todEl = el.querySelector("#os-tod"); const tod = todLabel(st.timeOfDay);
      if (todEl) { if (tod) { todEl.textContent = tod; todEl.hidden = false; } else todEl.hidden = true; } }
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
    el.style.display = "block";
  }

  // J3-07/J3-08 (wayfinding): the PREMIERE objective + "X of 15 met" progress — the persistent,
  // player-facing answer to "why hasn't HOH started, and how far am I?". Read from the engine's
  // Vault-free `premiere` projection (PremiereIntrosView on getGameState). Shown ONLY during the
  // premiere (it is the current objective) and hidden the moment it completes / the first HOH begins.
  // metCount/total both include the player (they ARE met), so the player-mental-model figure is the
  // NPC-only count (met-1 of total-1) to read as "X of 15". Public facets only — names + counts,
  // never a number about a houseguest, a soul, or a standing.
  function renderPremiere(el, state) {
    const wrap = el.querySelector("#os-premiere");
    if (!wrap) return;
    const prem = state && state.premiere;
    if (!prem || typeof prem !== "object" || prem.complete) { wrap.hidden = true; return; }
    const total = Number(prem.total) - 1;     // NPCs only
    const met = Number(prem.metCount) - 1;    // NPCs the player has met
    if (!(total > 0) || !(met >= 0)) { wrap.hidden = true; return; }
    const countEl = el.querySelector("#os-prem-count");
    if (countEl) countEl.textContent = met + " of " + total + " met";
    // The still-to-meet names (the same observable roster facets the engine exposes) — so the panel
    // names the gap, not just a count. Bounded list; falls back to the count alone if absent.
    const leftEl = el.querySelector("#os-prem-left");
    if (leftEl) {
      const names = Array.isArray(prem.remaining)
        ? prem.remaining.map((fi) => fi && fi.houseguest && fi.houseguest.name).filter(Boolean)
        : [];
      if (names.length) {
        leftEl.textContent = "Still to meet: " + names.join(", ");
        leftEl.hidden = false;
      } else {
        leftEl.hidden = true;
      }
    }
    wrap.hidden = false;
  }

  // The head-count tally + the player's own public role badge. From getGameState().house[] + the
  // ceremony status. No numbers. #955: the per-person NAME LIST was removed — it duplicated the
  // cast PHOTO gallery (#orwell-cast), which is now the single roster surface. This keeps only the
  // at-a-glance attrition count ("The House · N/N"), the premiere objective, the self badge, and
  // the player's own rest cue.
  function renderRoster(el, st, state) {
    renderPremiere(el, state);
    const badgeEl = el.querySelector("#os-you-badge");
    const badge = selfBadge(st, state);
    if (badge) { badgeEl.textContent = badge; badgeEl.hidden = false; }
    else { badgeEl.hidden = true; }

    // ADR 0006 §Principle 5: the player's OWN qualitative tiredness — a cue (never a number), and only
    // ever the player's own (no NPC's). Absent ⇒ hidden (the clock isn't running).
    const restEl = el.querySelector("#os-you-rest");
    if (restEl) {
      const rest = state && state.player && state.player.restStatus;
      if (rest) { restEl.textContent = "· " + rest; restEl.hidden = false; }
      else { restEl.hidden = true; }
    }

    // E71: key panel state to this user's game (same derivation as render()'s
    // pre-build assignment — computeGameKey is the single source, F1).
    _gameKey = computeGameKey(state);

    // #955: the house TALLY ("The House · N/N") — the at-a-glance attrition count. The names + faces
    // are the cast PHOTO gallery's job now (#orwell-cast), so this no longer renders a name list.
    const headEl = el.querySelector("#os-roster-h");
    const house = state && Array.isArray(state.house) ? state.house : null;
    if (!house) { headEl.style.display = "none"; return; }
    headEl.style.display = "";

    // player (if still active) counts as a houseguest, so the count matches the cast gallery's
    // active/total reading. No number about any houseguest crosses — just the head count.
    const playerActive = state.player && state.player.status === "active";
    const total = house.length + 1; // player + NPCs
    const activeCount = house.filter((h) => h.status === "active").length + (playerActive ? 1 : 0);
    headEl.textContent = "The House · " + activeCount + "/" + total;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // True once we've shown a real game at least once this session. Lets a transient engine
  // hiccup keep the last-known panel up (U5) instead of vanishing the player's only readout.
  let _shown = false;

  // C18: a hidden tab polls nothing; consecutive failures back the poll off (max 2 min).
  // E68: a SUCCESS resets the backoff — one blip must not degrade a live game to 2-minute polls.
  let _failures = 0;
  function _pollDelay() { return Math.min(POLL_MS * Math.pow(2, _failures), 120000); }

  function markStale(on) {
    const el = document.getElementById(ID);
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
      if (window.OrwellReport) window.OrwellReport.fail("status-panel", "status-poll", _); // G11: fail open, never silent
      _failures += 1;
      if (_shown) markStale(true);
      else hidePanel();
      return;
    }
    _failures = 0; // E68: recovered — poll at full cadence again
    // G11 follow-up: a successful status poll is a confirmed engine contact — latch it so
    // any LATER fetch failure is reported as a genuine outage (INFO), not a startup race.
    if (window.OrwellReport && window.OrwellReport.markConnected) window.OrwellReport.markConnected();
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
  // F4(a): a turn elsewhere (run start/end) dispatches orwell:gamechanged — reconcile the HUD at
  // once instead of waiting out the ≤20s poll. Reset the backoff and re-arm the cadence so the next
  // scheduled poll counts from this fresh fetch (cancel/re-arm), not the stale in-flight tick.
  window.addEventListener("orwell:gamechanged", () => {
    _failures = 0;
    if (timer) { clearTimeout(timer); timer = null; }
    start(); // start() refetches immediately, then re-arms the poll from now
  });
  // The sidebar drawer handles narrow layouts; nothing to repark (E64). Kept as a
  // no-op subscription so a future narrow-specific treatment has its hook.
  onNarrowChange(() => {});

  ready(start);
})();
