// Orwell Memory Wall (feature M4-2 — the knowledge journal) — the flagship "what you know" surface.
//
// Big Brother is an information game, and until now the player's OWN knowledge — everything they've
// witnessed, been told, or overheard (getVisibleStateFor.knowledge / sealedFromHouse / the 0002
// belief layer) — had no player-facing surface (audit C1). This is that surface: a standing sidebar
// button (beside Cast, shown while a game is active) opens a kit window listing what the player
// legitimately knows, grouped by the houseguest each fact is about, each fact tagged with HOW they
// learned it ("Deja told you", "You overheard", "You saw this yourself").
//
// VAULT-FREE BY CONSTRUCTION (CLAUDE.md — "the player forms their own reads, NEVER a number"): it
// renders ONLY what GET /api/orwell/knowledge returns, and that route drops every hidden-state number
// (confidence / distortion / hops) AND the undistorted origin of a distorted belief (originalContent)
// SERVER-SIDE — so no weight, threat read, or origin-truth can reach this window. A secondhand /
// distorted belief renders AS the player's belief, attributed to its source, NEVER truth-flagged: the
// player judges reliability themselves from WHO told them and whether they saw it firsthand.
//
// ADR 0003 (the conversation is the game): this AUGMENTS the chat — a companion reference the player
// glances at — it never replaces an interaction. Facts still ENTER knowledge through play (talking,
// listening, being told); this only reflects the store the engine keeps. Content-driven (an empty
// journal shows a designed empty state), game-build gated, fail-open everywhere.
//
// ENGINE GAPS this v1 builds around (filed as engine-side spec items — see the route + the agent
// report): no QUALITATIVE confidence BAND (the raw number is refused FE-side) and no per-fact WEEK
// attribution, so grouping is by HOUSEGUEST, not by week; graded within-belief certainty ("fairly
// sure" vs "barely") awaits the engine exposing a `confidenceBand` word. The firsthand-vs-secondhand
// split + the named source ARE the qualitative reliability signal today.
(function () {
  "use strict";

  const BTN_ID = "sidebar-memory-btn";
  const PANEL_ID = "orwell-memory";
  const POLL_MS = 30000;
  const GATE_POLL_MS = 20000;

  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn, { once: true })
      : fn();

  let _open = false;
  let _timer = null;       // the ONE journal poll timer (self-rescheduling)
  let _gateTimer = null;   // the button show/hide gate poll
  let _failures = 0;
  let _win = null;
  function _pollDelay() { return Math.min(POLL_MS * Math.pow(2, _failures), 120000); }

  // WS Phase-1 (§4): when the multiplexed socket is live the server PUSHES a `state`
  // frame on every board change; platform.js relays it to the one `orwell:gamechanged`
  // dispatcher, which drives the OPEN-panel edge refresh (the existing gamechanged
  // listener). The BUTTON gate reconciles on the ws-active/ws-inactive transitions —
  // WS binds only to a STARTED game, so its liveness tracks the same started-state the
  // gate polls for. So we cancel BOTH periodic TIMERS in WS mode and stay edge-triggered
  // (fail-soft: any doubt ⇒ keep polling). The fallback/SSE path is unchanged and still polls.
  function _wsActive() {
    try { return !!(window.OrwellWs && window.OrwellWs.isActive && window.OrwellWs.isActive()); }
    catch (_) { return false; }
  }

  async function getJSON(url) {
    const r = await fetch(url, { credentials: "same-origin" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  // The pathway KIND (from the Vault-free route) → a calm, player-facing source label. This mirrors
  // the engine's own domain `pathwayLabel` (src/domain/humanize.ts). `firsthand` marks what the player
  // KNOWS (saw it / their own note) vs. a secondhand BELIEF (told / overheard / gossip) — the belief
  // rows render as attributed claims, never truth. NO number appears in any label.
  const SOURCE_META = {
    witnessed: { glyph: "\u{1F441}", label: "You saw this yourself", firsthand: true },  // eye
    diary:     { glyph: "\u{1F4D3}", label: "Your diary-room note",   firsthand: true },  // notebook
    told:      { glyph: "\u{1F5E3}", label: "told you",               firsthand: false }, // speaking head (name-prefixed)
    overheard: { glyph: "\u{1F442}", label: "You overheard this",     firsthand: false }, // ear
    gossip:    { glyph: "\u{1F300}", label: "Word around the house",  firsthand: false }, // cyclone
    other:     { glyph: "•",    label: "You picked this up",      firsthand: false },
  };

  function sourceMeta(src) {
    const s = (src && typeof src === "object") ? src : {};
    const meta = SOURCE_META[s.kind] || SOURCE_META.other;
    // "told" carries the teller's public name when the route resolved it.
    if (s.kind === "told") {
      const who = (typeof s.who === "string" && s.who.trim()) ? s.who.trim() : "A houseguest";
      return { glyph: meta.glyph, label: `${who} told you`, firsthand: false };
    }
    return { glyph: meta.glyph, label: meta.label, firsthand: !!(s.firsthand ?? meta.firsthand) };
  }

  // --- the sidebar button (standing chrome, game-gated) -------------------------

  function ensureButton() {
    let btn = document.getElementById(BTN_ID);
    if (btn) return btn;
    // Beside Cast (the DoD anchor); fall back through the standing game chrome if Cast isn't in yet.
    const anchor = document.getElementById("sidebar-cast-btn")
      || document.getElementById("sidebar-diary-room-btn")
      || document.getElementById("sidebar-search-btn")
      || document.getElementById("sidebar-new-chat-btn");
    if (!anchor || !anchor.parentElement) return null;
    btn = document.createElement("div");
    btn.className = "list-item";
    btn.id = BTN_ID;
    btn.setAttribute("role", "button");
    btn.setAttribute("tabindex", "0");
    btn.title = "What You Know — your memory of the house";
    // WCAG 4.1.2 + the H4 rail twin: a real accessible name (the rail mirror clones this).
    btn.setAttribute("aria-label", "What You Know — your memory of the house");
    btn.style.display = "none"; // shown while a game is active (refreshGate)
    // The FIRST child must be the svg icon — the H4 rail mirror clones it into the collapsed rail.
    btn.innerHTML = `
      <svg class="sidebar-action-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
      <span class="grow">What You Know</span>`;
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
      if (!r.ok) return; // transient hiccup — leave the button as it was (fail-open)
      const st = await r.json();
      if (!st || typeof st.started !== "boolean") return; // ambiguous → leave as-is
      const live = !!st.started;
      btn.style.display = live ? "" : "none";
      if (!live && _open) togglePanel(false);
    } catch (_) { /* engine hiccup: leave the button as it was */ }
  }

  // --- the kit window -----------------------------------------------------------

  function ensureCss() {
    if (document.getElementById("orwell-memory-css")) return;
    const st = document.createElement("style");
    st.id = "orwell-memory-css";
    st.textContent = `
      #orwell-memory { width: min(380px, 92vw); font-family: var(--ow-ui-font); }
      #orwell-memory .omw-intro { font-size: .74rem; opacity: .62; line-height: 1.4; margin: 0 0 .5rem; }
      #orwell-memory .omw-group { margin: 0 0 .7rem; }
      #orwell-memory .omw-group-hd {
        font-weight: 600; color: var(--fg, #9cdef2); font-size: .82rem;
        letter-spacing: -.01em; margin: 0 0 .3rem; padding-bottom: .18rem;
        border-bottom: 1px solid var(--border, #355a66);
      }
      body.theme-frosted #orwell-memory .omw-group-hd { border-bottom-color: rgba(255,255,255,.14); }
      /* one fact line — the glyph + known/belief rail box wrapping a shared OrwellFactLine row
         (the fact's text + qualitative source line + belief italic all come from that renderer). */
      #orwell-memory .omw-fact {
        display: flex; align-items: flex-start; gap: .4rem; margin: .28rem 0;
        background: rgba(255,255,255,.05); border: 1px solid var(--border, #355a66);
        border-left: 3px solid var(--border, #355a66); border-radius: 8px; padding: .3rem .45rem;
      }
      body.theme-frosted #orwell-memory .omw-fact { border-color: rgba(255,255,255,.14); border-left-color: rgba(255,255,255,.14); }
      /* firsthand = something you KNOW (solid rail); belief = something you were TOLD (dashed, italic) */
      #orwell-memory .omw-known  { border-left-color: color-mix(in srgb, #4caf50 55%, var(--border, #355a66)); }
      #orwell-memory .omw-belief { border-left-style: dashed; border-left-color: color-mix(in srgb, #d0a24a 60%, var(--border, #355a66)); }
      #orwell-memory .omw-glyph { flex: 0 0 auto; opacity: .8; font-size: .82rem; line-height: 1.4; }
      /* the shared row fills the box beside the glyph; it owns the text/source layout + belief italic. */
      #orwell-memory .omw-fact .ofl-row { flex: 1; min-width: 0; padding: 0; border-bottom: none; }
      #orwell-memory .omw-empty { opacity: .7; font-size: .8rem; line-height: 1.5; padding: .4rem 0; }
      @media (max-width: 768px) { #orwell-memory { width: auto !important; max-width: none !important; } }
    `;
    document.head.appendChild(st);
  }

  function ensurePanel() {
    let el = document.getElementById(PANEL_ID);
    if (el) return el;
    ensureCss();
    const content = document.createElement("div");
    content.innerHTML = `
      <p class="omw-intro">Everything you've learned in the house — what you saw, what you were told,
        what you overheard. What someone <em>told</em> you is only their word for it.</p>
      <div class="omw-list" id="omw-list"></div>
      <div class="omw-empty" id="omw-empty" style="display:none"></div>`;
    _win = window.OrwellWindowKit.create({
      id: PANEL_ID, title: "What You Know",
      // #780 monochrome titlebar glyph (mono svg — the kit renders `title` verbatim, `icon` as the glyph).
      icon: "<svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M4 19.5A2.5 2.5 0 0 1 6.5 17H20'/><path d='M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z'/></svg>",
      slot: "top-left", slotKey: "memory", role: "complementary",
      minimizable: true, closable: true, draggable: true,
      dockable: true, defaultDocked: false,
      content,
      onClose: () => {
        _win = null; _open = false;
        if (_timer) { clearTimeout(_timer); _timer = null; }
      },
      onDock: () => { if (_open) refresh(); },
    });
    _win.open(document.getElementById(BTN_ID) || undefined);
    return document.getElementById(PANEL_ID);
  }

  // --- render -------------------------------------------------------------------
  // Group the player's facts by the houseguest each is ABOUT (the engine gap on per-fact WEEK means
  // houseguest is the grouping axis for v1; chronological order is preserved within a group by the
  // route's array order). A subject-less fact ("word around the house", a house event) falls into a
  // trailing "Around the house" section.

  const AROUND = "Around the house";

  function groupBySubject(items) {
    const order = [];            // subject names in first-seen order (houseguests first, AROUND last)
    const byName = new Map();
    for (const it of items) {
      const name = (it.subject && it.subject.name) ? String(it.subject.name) : AROUND;
      if (!byName.has(name)) { byName.set(name, []); order.push(name); }
      byName.get(name).push(it);
    }
    // Keep "Around the house" at the bottom, houseguests in first-seen order above it.
    order.sort((a, b) => (a === AROUND ? 1 : 0) - (b === AROUND ? 1 : 0));
    return order.map((name) => ({ name, facts: byName.get(name) }));
  }

  // Build ONE fact line by composing the shared OrwellFactLine row (M4-1's renderer, owned by the
  // dossier lane) — it owns the fact text + the qualitative source line + the belief italic. The
  // Memory Wall wraps that row with its own glyph + the known/belief rail box, its scannability
  // affordance. A belief is an attributed claim, never truth-flagged: the source label + the
  // italic/dashed rail carry that it's "what you heard", with no verified/false marker and no number.
  function factLine(item) {
    const meta = sourceMeta(item.source);
    const row = document.createElement("div");
    row.className = "omw-fact " + (meta.firsthand ? "omw-known" : "omw-belief");
    row.title = meta.firsthand ? "Something you know firsthand" : "Something you were told — their word for it";
    const glyph = document.createElement("span");
    glyph.className = "omw-glyph"; glyph.setAttribute("aria-hidden", "true");
    glyph.textContent = meta.glyph;
    // meta.label is ALREADY qualitative ("You saw this yourself", "Nominee told you") — never a number.
    const body = window.OrwellFactLine.row({
      text: String(item.content || ""),
      source: meta.label,
      belief: !meta.firsthand,
    });
    row.appendChild(glyph); row.appendChild(body);
    return row;
  }

  function render(items) {
    ensurePanel();
    const list = document.getElementById("omw-list");
    const empty = document.getElementById("omw-empty");
    if (!list || !empty) return 0;
    list.innerHTML = "";
    const facts = Array.isArray(items) ? items : [];
    if (!facts.length) {
      list.style.display = "none";
      empty.style.display = "";
      empty.textContent = "You haven't learned anything yet. Talk to people, listen in — the things you pick up will show up here, and you'll remember them for the whole season.";
      return 0;
    }
    empty.style.display = "none";
    list.style.display = "";
    for (const g of groupBySubject(facts)) {
      const sec = document.createElement("div");
      sec.className = "omw-group";
      const hd = document.createElement("div");
      hd.className = "omw-group-hd"; hd.textContent = g.name;
      sec.appendChild(hd);
      for (const it of g.facts) sec.appendChild(factLine(it));
      list.appendChild(sec);
    }
    return facts.length;
  }

  // Test/headless drive seam (mirrors _orwellDealsDrive): render without a live engine.
  window._orwellMemoryEnsure = () => { ensurePanel(); return true; };
  window._orwellMemoryDrive = (items) => render(items || []);

  async function refresh() {
    if (!_open) return;
    let data;
    try {
      data = await getJSON("/api/orwell/knowledge");
    } catch (_) {
      if (window.OrwellReport) window.OrwellReport.fail("memory", "knowledge-poll", _); // G11: fail open, never silent
      _failures += 1;
      return; // keep the last-good window up through a transient hiccup
    }
    _failures = 0;
    render((data && data.items) || []);
  }

  function scheduleNextPoll() {
    if (_timer) clearTimeout(_timer);
    const tick = async () => {
      if (!document.hidden && _open) await refresh();
      // In WS mode the `state` push (via orwell:gamechanged) drives the open-panel edge
      // refresh — don't re-arm the periodic timer, just stay edge-triggered.
      if (!_wsActive()) _timer = setTimeout(tick, _pollDelay());
    };
    if (!_wsActive()) _timer = setTimeout(tick, _pollDelay());
  }

  function togglePanel(show) {
    if (show) {
      ensurePanel();
      _open = true;
      refresh().then(scheduleNextPoll);
    } else {
      _open = false;
      if (_timer) { clearTimeout(_timer); _timer = null; }
      if (_win) { try { _win.close(); } catch (_) {} }
    }
  }

  window.orwellRefreshMemory = () => { if (_open) refresh(); };
  window.addEventListener("orwell:gamechanged", () => { if (_open) refresh(); });

  // The button show/hide gate poll — armed only while NOT in WS mode (in WS mode the
  // ws-active/ws-inactive transitions reconcile the button; see _wsActive above).
  function startGate() {
    if (_gateTimer) clearInterval(_gateTimer);
    if (!_wsActive()) _gateTimer = setInterval(() => { if (!document.hidden) refreshGate(); }, GATE_POLL_MS);
  }

  ready(() => {
    if (document.body && document.body.dataset.gameBuild !== "1") return; // game-build gated
    refreshGate();
    startGate();
    // WS Phase-1 (§4/§6): cancel the periodic polls the instant the socket goes live;
    // resume polling if it falls back to SSE. reconcile the button once on each transition
    // (the gate poll is suspended in WS mode), and resume the open-panel journal poll on
    // downgrade. startGate/scheduleNextPoll only re-arm while !_wsActive(), so re-running
    // them after a downgrade restores the cadence.
    window.addEventListener("orwell:ws-active", () => {
      refreshGate();
      if (_gateTimer) { clearInterval(_gateTimer); _gateTimer = null; }
      if (_timer) { clearTimeout(_timer); _timer = null; }
    });
    window.addEventListener("orwell:ws-inactive", () => {
      _failures = 0;
      refreshGate();
      startGate();
      if (_open) refresh().then(scheduleNextPoll);
    });
    window.addEventListener("beforeunload", () => {
      if (_timer) clearTimeout(_timer);
      if (_gateTimer) clearInterval(_gateTimer);
    });
  });
})();
