// Orwell season retrospective (feature 0048 / C17) — the post-season payoff surface.
//
// While a season is live this module shows NOTHING (the Wall is absolute; the /retrospective
// route 404s by the engine's terminal-state gate). Once a winner is crowned it offers:
//   • the season RECAP — arc highlights straight from the event record (never chat memory), and
//   • "Open the Producer's Vault" — the unsealed hidden story: the off-screen scheming, the
//     private confessionals, and the twist that never fired.
//
// Fail-open, render-only (route payloads verbatim), game-build gated. The panel AUGMENTS the
// reunion chat (the model hosts it via seasonRecap/seasonRetrospective levers); nothing here
// progresses the game.
//
// Lane F migration (2026-06-19): this panel COMPOSES the window kit — chrome, drag, minimize,
// Escape, focus, and the ONE position system (the clamped slot offset "retro") come from
// OrwellWindow; the old bespoke fixed-position + ow-dismiss banner are gone. 0054 Phase 2: it is
// DOCKABLE — the player can tuck it into the control-room rail (post-season only); the dock flag
// persists. Content-driven visibility: the panel self-display:none while live so the rail's
// observer hides it, and shows once the season is finished.
(function () {
  "use strict";

  const POLL_MS = 30000;
  const ID = "orwell-retro";
  const ICON = "📼";
  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn, { once: true })
      : fn();

  let timer = null;
  let _failures = 0;
  function _pollDelay() { return Math.min(POLL_MS * Math.pow(2, _failures), 180000); }
  let unsealed = null; // cached after the player opens the Vault

  async function getJSON(url) {
    const r = await fetch(url, { credentials: "same-origin" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  function el(tag, css, text) {
    const e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // The kit owns chrome/drag/dock/Escape/focus + the ONE position system (slotKey
  // "retro"); this module owns only the recap body (which it re-renders each tick).
  let _win = null;
  let _body = null;
  function ensurePanel() {
    let panel = document.getElementById(ID);
    if (panel) return panel;
    const content = document.createElement("div");
    content.innerHTML = `
      <style>
        #orwell-retro { width: min(380px, 92vw); font-size: 13px; line-height: 1.5; }
        #orwell-retro .oretro-body { display: block; }
        @media (max-width: 768px) {
          #orwell-retro { width: auto !important; max-width: none !important; }
        }
      </style>
      <div class="oretro-body" data-role="body"></div>`;
    _win = window.OrwellWindowKit.create({
      id: ID, title: "📼 The Season, Watched Back", icon: ICON,
      // top-right slot: the retrospective must NOT share a slot with the post-season
      // "New season" window (bottom-right) — post-season both are open, and stacking
      // two windows in one corner shoved the second off-screen. Distinct slots ⇒ no
      // shared stack (the slot stacking offset is also viewport-clamped in orwellSlots).
      slot: "top-right", slotKey: "retro", role: "complementary",
      minimizable: true, closable: true, draggable: true,
      // 0054 Phase 2: dockable into the control-room rail (default floating — a one-
      // line owner flip to defaultDocked:true if the feature doc's lean is preferred).
      dockable: true, defaultDocked: false,
      content,
      onClose: () => {
        // Dismissing the floating panel for the session (mirrors the old ow-dismiss).
        try { sessionStorage.setItem("orwell-retro-dismissed", "1"); } catch (_) {}
        _win = null; _body = null;
      },
    });
    _win.open();
    panel = document.getElementById(ID);
    _body = panel.querySelector('[data-role="body"]');
    return panel;
  }

  // Show/hide via the panel root's own display (content-driven for the rail's observer).
  function showPanel(on) {
    const panel = document.getElementById(ID);
    if (!panel) return;
    if (_win && _win.isMinimized && _win.isMinimized()) return; // parked: leave it
    panel.style.display = on ? "" : "none";
  }

  function render(recap) {
    if (!recap || !recap.finished) { showPanel(false); return; }
    if (sessionStorage.getItem("orwell-retro-dismissed") === "1") { showPanel(false); return; }
    ensurePanel();
    if (!_body) return;
    _body.replaceChildren();

    if (recap.winner) _body.appendChild(el("div", "margin-bottom:6px;opacity:0.9", "👑 " + recap.winner.name + " won the season (week " + recap.weeksPlayed + ")."));

    const list = el("ul", "margin:6px 0;padding-left:18px;opacity:0.85");
    for (const h of (recap.highlights || []).slice(-12)) list.appendChild(el("li", "", h));
    _body.appendChild(list);

    const vaultWrap = el("div", "margin-top:8px");
    if (unsealed) {
      vaultWrap.appendChild(el("strong", "", "🔓 The Producer's Vault"));
      if (unsealed.twists && unsealed.twists.length) {
        const t = el("div", "margin:4px 0;opacity:0.9");
        t.textContent = unsealed.twists.map((x) =>
          x.firedWeek ? `a ${x.kind} fired in week ${x.firedWeek}` : `a ${x.kind} was sealed but never fired`,
        ).join(" · ");
        vaultWrap.appendChild(t);
      }
      const story = el("ul", "margin:6px 0;padding-left:18px;opacity:0.8;font-size:12.5px");
      for (const h of (unsealed.hiddenStory || []).slice(-40)) {
        story.appendChild(el("li", "", "[" + h.type + "] " + h.content));
      }
      vaultWrap.appendChild(story);
      // E12: eviction ballots were anonymous all season ("a vote to evict …"); the retrospective is
      // the ONE place per-voter attribution unseals — the "who really voted against you" payoff.
      // Names only (the data pairs id+name; a raw id is never rendered).
      if (unsealed.evictionVotes && unsealed.evictionVotes.length) {
        vaultWrap.appendChild(el("strong", "display:block;margin-top:8px", "🗳 How the votes really fell"));
        const votes = el("ul", "margin:6px 0;padding-left:18px;opacity:0.8;font-size:12.5px");
        for (const wk of unsealed.evictionVotes) {
          const against = (wk.votes || [])
            .filter((v) => v.votedFor && wk.evictee && v.votedFor.id === wk.evictee.id)
            .map((v) => v.voter && v.voter.name).filter(Boolean);
          const who = against.length ? against.join(", ") : "no one on the record";
          votes.appendChild(el("li", "",
            `Week ${wk.week}: ${(wk.evictee && wk.evictee.name) || "—"} was sent out by ${who}.`));
        }
        vaultWrap.appendChild(votes);
      }
    } else {
      const open = el("button", [
        "margin-top:4px", "padding:6px 10px", "border-radius:8px", "cursor:pointer",
        "background:var(--accent, #6d4aff)", "color:#fff", "border:none", "font-size:12.5px",
      ].join(";"), "🔐 Open the Producer's Vault");
      open.addEventListener("click", async () => {
        try {
          const data = await getJSON("/api/orwell/retrospective");
          unsealed = data.retrospective || null;
          render(recap);
        } catch (_) {
          if (window.OrwellReport) window.OrwellReport.fail("retrospective", "vault-open", _); // G11: fail open, never silent
          open.textContent = "The Vault would not open — try again";
        }
      });
      vaultWrap.appendChild(open);
      vaultWrap.appendChild(el("div", "opacity:0.6;font-size:11.5px;margin-top:3px",
        "The hidden story they never showed you — scheming, confessionals, the twist that never fired."));
    }
    _body.appendChild(vaultWrap);
    showPanel(true);
  }

  async function tick() {
    try {
      if (document.hidden) return;
      const state = await getJSON("/api/orwell/state");
      if (!state || !state.started) { render(null); unsealed = null; return; }
      const data = await getJSON("/api/orwell/recap");
      render(data ? data.recap : null);
      _failures = 0;
    } catch (_) {
      _failures += 1;
      if (window.OrwellReport) window.OrwellReport.fail("retrospective", "recap-poll", _); // G11: fail open, never silent
      render(null); // fail OPEN: no panel on error
    } finally {
      timer = setTimeout(tick, _pollDelay());
    }
  }

  // Seam for the headless gate (mirrors the other panels): build + show on demand.
  window._orwellRetroEnsure = () => { ensurePanel(); return true; };

  ready(() => {
    if (document.body && document.body.dataset.gameBuild !== "1") return;
    tick();
    window.addEventListener("beforeunload", () => timer && clearTimeout(timer));
  });
})();
