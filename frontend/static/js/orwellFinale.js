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
// fail-open everywhere. Composes the window kit (Lane F wave 2); modalManager is
// only consulted for the minimized state the poll loop must respect.
import * as modalManager from "./modalManager.js";

(function () {
  "use strict";

  const POLL_FAST_MS = 5000;       // a finale is staging — poll briskly
  const POLL_SLOW_MS = 45000;      // no finale yet — a light heartbeat (E67/C18)
  const ID = "orwell-finale";
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
  let _staging = false;            // a finale is currently live (drives the poll cadence)
  let _failures = 0;               // C18-style backoff on consecutive errors
  let _nextSeasonWarmed = false;   // 0065 Phase 1: the finale-day next-season char-data warm fired once
  function _pollDelay() {
    const base = _staging ? POLL_FAST_MS : POLL_SLOW_MS;
    return Math.min(base * Math.pow(2, _failures), 120000);
  }

  async function getJSON(url) {
    const r = await fetch(url, { credentials: "same-origin" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
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

  // F-2 wave 2 (DWE audit): the panel COMPOSES the window kit — chrome, drag,
  // minimize-to-dock, Escape, focus, and persistence come from OrwellWindow.
  // This module keeps only the finale content: stage, finalists, reveals, and
  // the composer-prefill move buttons.
  let _win = null;
  function ensureUI() {
    let el = document.getElementById(ID);
    if (el) return el;
    const content = document.createElement("div");
    content.innerHTML = `
      <style>
        #orwell-finale {
          width: 240px; display: none;
          /* #733: use the OrwellWindow kit TYPE (sans --ow-ui-font + the --ow-fs-body preset)
             so the Finale window reads consistent with every other kit window (cast roster,
             settings) — no bespoke mono/.74rem. The .ow-window root already supplies these, so
             this just affirms the inheritance; the numeric vote TALLY keeps --mono below (a
             tabular figure is the one place mono is intentional). */
          font-family: var(--ow-ui-font); font-size: var(--ow-fs-body, .875rem);
        }
        #orwell-finale .ofin-stage { opacity: .6; margin: 0 0 .4rem; letter-spacing: .03em; }
        #orwell-finale .ofin-final {
          display: flex; justify-content: space-between; gap: .4rem; margin-bottom: .5rem;
        }
        #orwell-finale .ofin-fin {
          flex: 1; text-align: center; background: rgba(255,255,255,.05);
          border: 1px solid var(--border, #355a66); border-radius: 8px; padding: .3rem .25rem;
        }
        #orwell-finale .ofin-fin b { display: block; color: var(--fg, #9cdef2); }
        /* #733: the numeric vote tally stays MONO (a tabular figure) — the one intentional
           mono use; the rest of the window now rides the kit's --ow-ui-font (above). */
        #orwell-finale .ofin-fin .ofin-tally { font-family: var(--mono, monospace); font-size: 1.1rem; opacity: .9; }
        #orwell-finale .ofin-hd { opacity: .6; margin: .5rem 0 .25rem; letter-spacing: .03em; }
        #orwell-finale .ofin-reveal { margin: .2rem 0; opacity: .9; }
        #orwell-finale .ofin-reveal b { color: var(--fg, #9cdef2); }
        #orwell-finale .ofin-move { margin-top: .5rem; }
        /* #775 element-kit migration: the finale move buttons now compose .ow-btn
           .ow-btn-secondary (the kit owns frosted chrome — ONE source of truth). This
           bespoke rule keeps ONLY the finale-specific LAYOUT (full-width, left-aligned
           list look, vertical rhythm) + the Normal-tier (non-glass) fallback chrome.
           The selector is intentionally un-prefixed (no #orwell-finale id) so the kit's
           body.theme-frosted .ow-btn rule wins on the glass tiers; the frosted-only
           chrome override below is retired (the kit supplies it). */
        .ofin-btn {
          /* J5-13: lift to the project tap floor (was ~27px) and bump the label off .74rem so the
             time-pressured finale move buttons are tappable + legible on coarse pointers. */
          width: 100%; cursor: pointer; border-radius: 8px; padding: .45rem .6rem; margin: .2rem 0; min-height: 44px;
          background: rgba(255,255,255,.05); color: inherit; border: 1px solid var(--border, #355a66);
          font-family: inherit; font-size: .82rem; text-align: left;
          /* the kit centers content; the finale list look is left-aligned full-width */
          justify-content: flex-start;
        }
        #orwell-finale .ofin-btn:hover { border-color: var(--accent, #e06c75); }
        /* E67/C26 + F3: phones — a full-width top sheet whose POSITION the slot
           engine's sheet host owns (no per-panel pins; two visible sheets stack,
           never overlap). */
        @media (max-width: 768px) {
          #orwell-finale {
            width: auto !important; max-width: none !important;
            border-radius: 0 0 12px 12px; border-left: none; border-right: none;
            max-height: 42vh; overflow: auto;
          }
        }
        /* #725: soften the inner var(--border) strokes (finalist cards, move buttons) to the
           low-opacity WHITE hairline on the light glass — Apple defines glass by lensing, not a
           hard dark line. The :hover accent rim on the move buttons stays (transient interaction). */
        body.theme-frosted #orwell-finale .ofin-fin {
          border-color: rgba(255,255,255,0.14);
        }
      </style>
      <div class="ofin-stage" id="ofin-stage"></div>
      <div class="ofin-hd" id="ofin-asking" hidden></div>
      <div class="ofin-final" id="ofin-final"></div>
      <div class="ofin-hd" id="ofin-reveal-hd" style="display:none">The votes</div>
      <div id="ofin-reveals"></div>
      <div class="ofin-move" id="ofin-move"></div>
      <div id="ofin-announce" aria-live="polite" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);"></div>`;
    // The kit owns chrome, drag, dock, Escape, focus, and the ONE position
    // system (the clamped slot offset "finale" — the F5 dual-persistence era is
    // over; wave 1 shipped the stale-key cleanup, retired here).
    _win = window.OrwellWindowKit.create({
      // #780: monochrome icon language — no full-color emoji in the titlebar (the kit
      // renders `title` verbatim). The glyph is the mono SVG `icon` slot.
      id: ID, title: "The Finale", icon: ICON,
      slot: "top-left", slotKey: "finale", role: "complementary",
      // An ambient HUD parks (minimize); the finale exists while one is staging,
      // so it carries no close — a capability of the one kit cluster.
      minimizable: true, closable: false, draggable: true,
      // 0054 Phase 2: dockable into the control-room rail (default floating — a one-
      // line owner flip to defaultDocked:true). Docked, it rides the rail's single
      // mobile drawer + content-driven visibility (it self-hides when not staging).
      dockable: true, defaultDocked: false,
      content,
    });
    _win.open();
    return document.getElementById(ID);
  }

  // Prefill the composer (never auto-send) — the chat agent reads it and calls submitDecision.
  function prefill(text) {
    const box = document.getElementById("message");
    if (!box) return;
    box.value = text;
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.focus();
  }

  // GADGET-15: mirror orwellDeals.js's `nameMapFrom`/`otherParty` pattern — resolve a NamedRef's
  // id against the roster (the SAME /state payload refresh() already fetches) before falling
  // back to the generic "A houseguest", instead of showing the fallback on every row whenever a
  // ref's own `name` wasn't populated at write time (finalist cards, vote reveals, vote buttons).
  function nameMapFrom(st) {
    const m = Object.create(null);
    if (!st || typeof st !== "object") return m;
    const p = st.player;
    if (p && typeof p === "object" && p.id != null && p.name) m[String(p.id)] = String(p.name);
    const house = Array.isArray(st.house) ? st.house : [];
    for (const hg of house) {
      if (hg && typeof hg === "object" && hg.id != null && hg.name) m[String(hg.id)] = String(hg.name);
    }
    return m;
  }
  // The roster map from the LAST /state fetch (refresh() refreshes it every poll, alongside the
  // finale fetch) — nameOf() reads it directly so render()'s own signature/call sites stay
  // untouched (a source-pinned convention gate matches `function render(finale) {` verbatim).
  let _nameById = Object.create(null);
  function nameOf(ref) {
    if (ref && ref.name) return ref.name;
    if (ref && ref.id != null && _nameById[String(ref.id)]) return _nameById[String(ref.id)];
    return "A houseguest";
  }
  // -1 = not yet rendered this page load. The FIRST render (live OR after a refresh) syncs
  // the count WITHOUT announcing — otherwise a reload mid-finale re-announced every vote
  // already on screen through the aria-live region (reload-persistence audit). Only reveals
  // that land DURING this page session are announced.
  let _lastRevealCount = -1;
  // A11Y-3: the stage label is NO LONGER its own aria-live region (#ofin-stage re-announced the
  // UNCHANGED stage name every ~5s poll during jury questioning, drowning out the streamed Q&A /
  // vote reveals on the SAME-priority hidden #ofin-announce region). Instead we announce a stage
  // CHANGE once, through the one hidden #ofin-announce region — tracking the last announced stage
  // so a re-poll of the same stage stays silent. null = nothing announced yet this page session;
  // the first render syncs WITHOUT announcing (mirrors _lastRevealCount), so a reload mid-finale
  // never re-announces the stage already on screen.
  let _lastStage = null;

  function render(finale) {
    const el = ensureUI();
    // 0054 Phase 2: docked, clear the inline display so the .ow-docked flex-column
    // rule applies (an inline `block` would break the kit's docked layout — the rail
    // shows it via content-driven visibility). Floating, show as a block as before.
    const _wasHidden = !el.style.display || el.style.display === "none";
    if (_win && _win.isDocked && _win.isDocked()) el.style.display = "";
    else if (!isMinimized()) el.style.display = "block";
    // #780 (finale opens flush top-left, clipped): the finale's content CSS defaults to
    // `display:none`, so the slot restack at open() SKIPS it (an invisible entry is not
    // stacked) and it sits at the CSS-default 0,0 — its red traffic-light clipped under
    // the viewport edge. The moment it becomes visible, re-run the slot stack so it
    // anchors to its `top-left` base (below the banner, past the sidebar). Idempotent.
    if (_wasHidden && el.style.display && el.style.display !== "none") {
      try { window.OrwellSlots && window.OrwellSlots.restackAll && window.OrwellSlots.restackAll(); } catch (_) {}
    }

    const finalists = Array.isArray(finale.finalists) ? finale.finalists : [];
    const reveals = Array.isArray(finale.reveals) ? finale.reveals : [];
    const stageLabel = STAGE_LABEL[finale.stage] || "The finale";
    document.getElementById("ofin-stage").textContent = stageLabel;
    // GADGET-9: name WHICH juror is asking during the "questions" stage — the engine already
    // projects it (`GameSession.ts` `asking: NamedRef | null`), but nothing in this panel ever
    // read it, so the per-juror mechanic CLAUDE.md calls out ("takes one question per juror") had
    // no visible progress readout at all.
    const askingEl = document.getElementById("ofin-asking");
    if (askingEl) {
      const askingName = finale.asking ? nameOf(finale.asking) : "";
      if (askingName) { askingEl.textContent = "Asking: " + askingName; askingEl.hidden = false; }
      else { askingEl.hidden = true; }
    }
    // A11Y-3: announce a stage TRANSITION (not the unchanged stage on every poll) through the one
    // hidden #ofin-announce region, alongside any fresh vote reveals below. Skip the very first
    // sync of this page session (mirrors _lastRevealCount) so a reload mid-finale never re-announces.
    const stageChanged = _lastStage !== null && finale.stage !== _lastStage;
    _lastStage = finale.stage;

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
      t.setAttribute("aria-label", String(tally[f.id] || 0) + " votes"); // J5-14: the bare number has no accessible meaning
      card.appendChild(b); card.appendChild(t); finWrap.appendChild(card);
    }

    // The reveal, in the order the engine read it (revealed votes only). New reveals
    // are ANNOUNCED politely (E67): the vote reading is the season's loudest moment.
    // A11Y-3: a stage TRANSITION rides the SAME hidden polite region (announced once, on change),
    // so a screen reader hears "Jury questions." once — never re-read every poll — and the fresh
    // vote reveals join the same announcement when both land together.
    const ann = document.getElementById("ofin-announce");
    if (ann) {
      const parts = [];
      if (stageChanged) parts.push(stageLabel + ".");
      if (_lastRevealCount >= 0 && reveals.length > _lastRevealCount) {
        reveals.slice(_lastRevealCount)
          .forEach((r) => parts.push(nameOf(r.juror) + " votes for " + nameOf(r.votedFor) + "."));
      }
      if (parts.length) ann.textContent = parts.join(" ");
    }
    _lastRevealCount = reveals.length;
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
      btn.type = "button"; btn.className = "ow-btn ow-btn-secondary ofin-btn"; btn.textContent = label;
      // A11Y-10: visible label keeps the emoji/arrow; the accessible name strips leading glyphs so
      // a screen reader reads "Vote for X", not "ballot box with ballot Vote for X".
      btn.setAttribute("aria-label", label.replace(/^[^\p{L}\p{N}]+/u, "").trim() || label);
      btn.addEventListener("click", () => prefill(text));
      move.appendChild(btn);
    };
    if (playerIsFinalist && finale.stage === "statements") {
      addBtn("✍ Give your opening statement", "I give my opening statement to the jury: ");
    } else if (playerIsFinalist && finale.stage === "questions") {
      // #616: prefill the HUMAN label, not the raw kebab id (e.g. "discredit-rival") — the id is
      // machinery and must never land in the player's visible composer.
      for (const a of APPEALS) addBtn("→ " + a.label, `I answer the jury by making my "${a.label}" case.`);
    } else if (!playerIsFinalist && finale.stage === "vote") {
      for (const f of finalists) addBtn("🗳 Vote for " + nameOf(f), `I cast my jury vote for ${nameOf(f)}.`);
    }
  }

  async function refresh() {
    // Issue 2: GATE the finale poll on a STARTED game. Pre-game there is no finale to stage, and
    // hitting /finale before casting only logged `[orwell] finale failed: no active game` every
    // poll. /state is the cheap, always-available game-active read every panel shares.
    let st;
    try {
      st = await getJSON("/api/orwell/state");
      if (!st || st.started === false) { _staging = false; _failures = 0; hidePanel(); return; }
    } catch (_) {
      // /state itself failed (an engine blip): don't escalate to a finale fetch — back off and hide.
      _failures += 1;
      hidePanel();
      return;
    }
    let finale = null;
    if (_win && _win.setLoading) _win.setLoading(true); // non-blocking refresh hint over the last reveals
    try {
      const data = await getJSON("/api/orwell/finale");
      finale = data && data.finale;
      _failures = 0;
    } catch (_) {
      _failures += 1; // engine down → fail open (hide) + back the poll off (E67)
      if (window.OrwellReport) window.OrwellReport.fail("finale", "finale-poll", _); // G11: fail open, never silent
      finale = null;
    } finally {
      if (_win && _win.setLoading) _win.setLoading(false);
    }
    _staging = !!finale;
    // 0065 Phase 1 — FINALE DAY BEGINS: the instant a finale starts staging (the current season is
    // nearing its close), kick the NEXT season's char-data warm so the deep cast profiles are warming
    // in advance of when they're needed. Fire-and-forget + idempotent server-side (the endpoint just
    // ARMS a background poll that lands once the player confirms the next season). Once per finale.
    if (_staging && !_nextSeasonWarmed) {
      _nextSeasonWarmed = true;
      _warmNextSeason();
    }
    if (!finale) { hidePanel(); return; }
    // GADGET-15: resolve names against the SAME /state roster already fetched above (public
    // NamedRef-shaped facts — no extra call, no Vault data).
    _nameById = nameMapFrom(st);
    render(finale);
  }

  // 0065 Phase 1: fire the finale-day next-season char-data warm. Best-effort, fail-open; the server
  // endpoint is idempotent (a re-fire is a no-op while the poll is armed). Images are a SEPARATE warm
  // fired at the next-season confirm (orwellNewSeason.js), gated off this one finishing.
  function _warmNextSeason() {
    try {
      fetch("/api/orwell/prewarm-next-season", { method: "POST", credentials: "same-origin" }).catch(() => {});
    } catch (_) {}
  }

  function start() {
    refresh();
    if (timer) clearTimeout(timer);
    const tick = async () => {
      if (!document.hidden) await refresh(); // E67/C18: a hidden tab polls nothing
      timer = setTimeout(tick, _pollDelay());
    };
    timer = setTimeout(tick, _pollDelay());
  }

  // Seam for the headless gate (F3 and the finale's own F-2 wave): build + show on demand.
  window._orwellFinaleEnsure = () => {
    const el = ensureUI();
    if (_win && _win.isDocked && _win.isDocked()) el.style.display = "";
    else if (!isMinimized()) el.style.display = "block";
    // #780: re-anchor once visible (see render()) so the headless/explicit show lands on
    // the slot base rather than the clipped CSS-default 0,0.
    if (el.style.display && el.style.display !== "none") {
      try { window.OrwellSlots && window.OrwellSlots.restackAll && window.OrwellSlots.restackAll(); } catch (_) {}
    }
    return true;
  };
  window.orwellRefreshFinale = refresh;
  window.addEventListener("orwell:gamechanged", refresh);
  ready(start);
})();
