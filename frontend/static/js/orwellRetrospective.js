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
  let _lastRecap = null; // last-good recap (perf/resilience): a transient recap-poll blip must not blank the open panel
  let _lastSig = null; // J5-10 (TRANS-3): signature of the last render, to skip redundant rebuilds

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
    // J5-10 (TRANS-3): the recap is terminal/immutable once the season is finished — re-rendering
    // the whole body on every 30s poll snapped the reader's scroll to the top and dropped keyboard/
    // SR focus to <body>. Skip the rebuild when nothing changed; only a real change (the Vault
    // unseal) re-renders. The full body teardown then happens at most twice (recap, then unsealed).
    const sig = JSON.stringify({ w: recap.winner && recap.winner.name, wk: recap.weeksPlayed,
      h: (recap.highlights || []).length, u: !!unsealed, p: recap.placement, m: recap.margin });
    if (sig === _lastSig && _body.childNodes.length) { showPanel(true); return; }
    _lastSig = sig;
    _body.replaceChildren();

    // J5-09: the winner is the panel's apex — give it real typographic weight, not the same
    // 13px/0.9 as a mid-season highlight line.
    if (recap.winner) _body.appendChild(el("div", "margin-bottom:10px;font-size:1.1rem;font-weight:700;letter-spacing:-0.02em", "👑 " + recap.winner.name + " won the season (week " + recap.weeksPlayed + ")."));

    // J5-18: the player's OWN result is the payoff for the most common outcome (a losing player) —
    // the panel headlined only the winner. Surface the player's placement (and, if they sat in the
    // Final 2, the jury margin) with real weight, right under the crown. Route-provided & PUBLIC
    // (placement + margin are post-season facts); absent ⇒ silently skipped (fail-open).
    if (recap.placement) {
      // winner | runner-up | jury | evicted — winner is already the apex line above, so don't double it.
      const PLACE = {
        "runner-up": "You finished 2nd — runner-up.",
        jury: "You finished in the jury.",
        evicted: "You were evicted before jury.",
      };
      const line = PLACE[recap.placement];
      if (line) {
        const result = el("div",
          "margin-bottom:10px;padding:8px 10px;border-radius:8px;font-size:1rem;font-weight:600;background:var(--accent-soft, rgba(109,74,255,0.14));border-left:3px solid var(--accent, #6d4aff)",
          line);
        // Finalists lost (or won) the jury by a margin — name it. margin = winner's lead in votes.
        if (recap.placement === "runner-up" && typeof recap.margin === "number" && recap.margin > 0) {
          result.appendChild(el("div", "margin-top:4px;font-size:0.85rem;font-weight:400;opacity:0.85",
            "Lost the jury vote by " + recap.margin + (recap.margin === 1 ? " vote." : " votes.")));
        }
        _body.appendChild(result);
      }
    }

    const list = el("ul", "margin:6px 0;padding-left:18px;opacity:0.85");
    for (const h of (recap.highlights || []).slice(-12)) list.appendChild(el("li", "", h));
    _body.appendChild(list);

    const vaultWrap = el("div", "margin-top:8px");
    if (unsealed) {
      // J5-07: a real section heading (was <strong>, invisible to SR heading navigation — WCAG 1.3.1).
      // UX-4: the bare leading emoji is decorative — give an explicit accessible name
      // (emoji stripped) so a screen reader reads the heading, not "lock …".
      const _vaultHd = el("h3", "margin:4px 0 4px;font-size:inherit", "🔓 The Untold Story");
      _vaultHd.setAttribute("aria-label", "The Untold Story");
      vaultWrap.appendChild(_vaultHd);
      if (unsealed.twists && unsealed.twists.length) {
        const t = el("div", "margin:4px 0;opacity:0.9");
        t.textContent = unsealed.twists.map((x) =>
          x.firedWeek ? `a ${x.kind} fired in week ${x.firedWeek}` : `a ${x.kind} was sealed but never fired`,
        ).join(" · ");
        vaultWrap.appendChild(t);
      }
      // S6-3 (audit): hiddenStory[].type can be a raw internal pathway id (e.g.
      // "overheard:offscreen:strategy:…"); never surface it verbatim — show its leading channel
      // segment in prose. Clean enum values ("confessional", "overheard") pass through unchanged.
      const humanizeStoryType = (t) => {
        const head = String(t || "").split(/[:|/]/)[0].replace(/[_-]+/g, " ").trim().toLowerCase();
        return head || "note";
      };
      // J5-09 (SOCIAL-3): the per-voter "who really voted against you" reveal is the signature
      // secret-ballot payoff — render it FIRST (right under the twists), not buried beneath the
      // up-to-40-line confessional dump.
      // E12: eviction ballots were anonymous all season ("a vote to evict …"); the retrospective is
      // the ONE place per-voter attribution unseals. Names only (the data pairs id+name; a raw id is never rendered).
      if (unsealed.evictionVotes && unsealed.evictionVotes.length) {
        const _votesHd = el("h3", "display:block;margin:12px 0 4px;font-size:inherit", "🗳 How the votes really fell");
        _votesHd.setAttribute("aria-label", "How the votes really fell");  // UX-4: decorative emoji
        vaultWrap.appendChild(_votesHd);
        const votes = el("ul", "margin:6px 0;padding-left:18px;opacity:0.85;font-size:12.5px");
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
      const story = el("ul", "margin:6px 0;padding-left:18px;opacity:0.85;font-size:12.5px");
      for (const h of (unsealed.hiddenStory || []).slice(-40)) {
        // J5-11: prose annotation, not "[bracketed]" metadata that reads as a debug log.
        const lbl = humanizeStoryType(h.type);
        story.appendChild(el("li", "", lbl.charAt(0).toUpperCase() + lbl.slice(1) + " — " + h.content));
      }
      vaultWrap.appendChild(story);
    } else {
      const open = el("button", [
        // J5-08: contrast — #fff on the purple accent passes 4.5:1 (the computed --on-accent is dark
        // ink tuned for the brand RED, which fails on this purple). And lift to the 44px tap floor.
        "margin-top:4px", "padding:10px 14px", "border-radius:8px", "cursor:pointer", "min-height:44px",
        "background:var(--accent, #6d4aff)", "color:#fff", "border:none", "font-size:13px", "font-family:inherit", "font-weight:600",
      ].join(";"), "🔐 Open the Untold Story");
      open.setAttribute("aria-label", "Open the Untold Story");  // UX-4: decorative lock emoji
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
    if (document.hidden) { timer = setTimeout(tick, _pollDelay()); return; }
    if (_win && _win.setLoading) _win.setLoading(true); // non-blocking refresh hint over the last recap
    try {
      const state = await getJSON("/api/orwell/state");
      if (!state || !state.started) { _lastRecap = null; render(null); unsealed = null; _failures = 0; return; }
      const data = await getJSON("/api/orwell/recap");
      _lastRecap = data ? data.recap : null;
      render(_lastRecap);
      _failures = 0;
    } catch (_) {
      _failures += 1;
      if (window.OrwellReport) window.OrwellReport.fail("retrospective", "recap-poll", _); // G11: fail open, never silent
      // Reuse the last-good recap so a transient blip never blanks an open retrospective; only an
      // honest "no game / not finished" (the try-branch above) clears it. A new game clears it via
      // the started:false branch, so a stale finished-season panel can never linger across a reset.
      if (_lastRecap) render(_lastRecap); else render(null);
    } finally {
      if (_win && _win.setLoading) _win.setLoading(false);
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
