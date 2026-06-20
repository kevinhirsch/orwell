// Orwell "New season" surface (feature 0057, chunk 3) — the persistent post-season hand-off.
//
// The MOMENT the engine reports the season is over (moment === "post-season"), a persistent
// panel appears and STAYS PUT until the player actually starts the next season. It offers:
//   • KEEP the houseguest (the same person returns to a brand-new cast — 0056) vs RECREATE
//     (run casting from scratch) → POST /api/orwell/next-season {keep, confirm:true};
//   • the per-season PORTRAIT (keep / upload / regenerate) via the shared headshot studio
//     (G26/G27 — OrwellHeadshotStudio.mount).
// This SUBSUMES the 0056 FE keep/recreate UX.
//
// A gentle in-reunion nudge points the player at the button if they linger (the chip in the
// gadget rail / a soft pulse) so the path forward is never hidden.
//
// Built on the OrwellWindow kit (Lane F) — one window class, .ow-* family, slot placement,
// minimize-to-dock, Escape participation. Game-build gated; Vault-free (only public state +
// the player's own portrait). Fails OPEN: any error just leaves the chat untouched.
(function () {
  "use strict";

  function gameBuild() {
    return !!(document.body && document.body.hasAttribute("data-game-build"));
  }
  if (!gameBuild()) return;

  const WIN_ID = "orwell-new-season";
  const POLL_MS = 15000;
  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn, { once: true })
      : fn();

  let _win = null;       // the live OrwellWindow instance, or null
  let _busy = false;     // a next-season call is in flight
  let _timer = null;
  let _open = false;     // whether we believe the panel should be shown

  async function jget(url) {
    try {
      const r = await fetch(url, { credentials: "same-origin" });
      return r.ok ? r.json() : null;
    } catch (_) { return null; }
  }

  // The post-season gate: the engine's terminal state. moment === "post-season" is the same
  // signal the season retrospective / the engine's own gate uses (0048). We read it from the
  // Vault-free /state projection — never anything secret.
  async function isPostSeason() {
    const st = await jget("/api/orwell/state");
    return !!(st && st.started && st.moment === "post-season");
  }

  // ── the panel body ─────────────────────────────────────────────────────────
  function buildBody() {
    const wrap = document.createElement("div");
    wrap.className = "ons-body";
    if (!document.getElementById("orwell-new-season-css")) {
      const s = document.createElement("style");
      s.id = "orwell-new-season-css";
      s.textContent = `
        .ons-body { font-size: 13px; line-height: 1.5; max-width: 360px; }
        .ons-body .ons-lead { opacity: .9; margin-bottom: 10px; }
        .ons-body .ons-choices { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
        .ons-body .ons-btn { font: inherit; font-size: 12.5px; font-weight: 600;
          padding: 8px 14px; border-radius: 8px; cursor: pointer; border: 1px solid transparent;
          min-height: 36px; }
        .ons-body .ons-btn-primary { background: var(--accent, var(--accent-primary, #6d4aff)); color: #fff; }
        .ons-body .ons-btn-ghost { background: transparent; color: var(--fg, #cfd8e3);
          border-color: var(--border, #355a66); }
        .ons-body .ons-btn[disabled] { opacity: .55; cursor: default; }
        .ons-body .ons-hint { opacity: .6; font-size: 11.5px; margin-top: 6px; }
        .ons-body .ons-portrait { margin-top: 12px; padding-top: 10px;
          border-top: 1px solid var(--border, #355a66); }
        .ons-body .ons-portrait-h { font-size: 12px; opacity: .75; margin-bottom: 6px; font-weight: 600; }
        .ons-body .ons-msg { font-size: 12px; opacity: .8; margin-top: 8px; min-height: 1.2em; }
        .ons-body .ons-msg.ons-err { color: var(--red, #e06c75); opacity: 1; }`;
      document.head.appendChild(s);
    }

    wrap.innerHTML = `
      <div class="ons-lead">The season is over. When you're ready, walk back into a brand-new
        house — bring this houseguest back, or recast from scratch.</div>
      <div class="ons-choices">
        <button type="button" class="ons-btn ons-btn-primary" data-keep="1">Keep this houseguest</button>
        <button type="button" class="ons-btn ons-btn-ghost" data-keep="0">Recast from scratch</button>
      </div>
      <div class="ons-hint">Keep = the same person, a new cast. Recast = the casting interview runs again.</div>
      <div class="ons-portrait">
        <div class="ons-portrait-h">This season's portrait</div>
        <div class="ons-portrait-studio" id="ons-portrait-studio"></div>
      </div>
      <div class="ons-msg" id="ons-msg"></div>`;

    // The per-season portrait: keep / upload / regenerate via the shared studio (G26/G27).
    try {
      const studioHost = wrap.querySelector("#ons-portrait-studio");
      if (studioHost && window.OrwellHeadshotStudio && window.OrwellHeadshotStudio.mount) {
        window.OrwellHeadshotStudio.mount(studioHost, {});
      } else if (studioHost) {
        studioHost.textContent = "Portrait studio unavailable.";
      }
    } catch (_) {}

    const msg = wrap.querySelector("#ons-msg");
    const setMsg = (t, err) => { msg.textContent = t || ""; msg.classList.toggle("ons-err", !!err); };
    const buttons = wrap.querySelectorAll(".ons-btn");
    const setBusy = (b) => { _busy = b; buttons.forEach((btn) => { btn.disabled = b; }); };

    buttons.forEach((btn) => {
      btn.addEventListener("click", () => startNextSeason(btn.dataset.keep === "1", setMsg, setBusy));
    });
    return wrap;
  }

  async function startNextSeason(keep, setMsg, setBusy) {
    if (_busy) return;
    setBusy(true);
    setMsg(keep ? "Bringing your houseguest back…" : "Opening casting for a new houseguest…");
    try {
      const r = await fetch("/api/orwell/next-season", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keep: !!keep, confirm: true }),
      });
      const d = r.ok ? await r.json() : null;
      if (!r.ok || !d) {
        const err = (d && d.error) || "Couldn't start the next season — try again.";
        setMsg(err, true);
        setBusy(false);
        return;
      }
      // The new season committed. Tear the panel down, open a FRESH chat session (so the dead
      // season's transcript never rides as narrator context — E65), and let every surface refresh
      // through THE one shared dispatcher (platform.js orwellGameChanged — G15: never an ad-hoc
      // CustomEvent). The avatar refresh rides the same wave (the cast/portrait surfaces re-read).
      // This is a genuine season RESTART — arm the fresh-session split (the initial first-season
      // onboarding never reaches here, so it stays ONE continuous conversation).
      destroy();
      try { window._orwellMarkRestart && window._orwellMarkRestart(); } catch (_) {}
      try { window._orwellFreshSession && window._orwellFreshSession(); } catch (_) {}
      try { window.orwellGameChanged && window.orwellGameChanged("next-season"); } catch (_) {}
    } catch (e) {
      if (window.OrwellReport) window.OrwellReport.fail("new-season", "next-season", e);
      setMsg("The producers couldn't reach you — try again.", true);
      setBusy(false);
    }
  }

  // ── lifecycle ────────────────────────────────────────────────────────────
  function show() {
    if (_win || document.getElementById(WIN_ID)) { _open = true; return; }
    if (!(window.OrwellWindowKit && window.OrwellWindowKit.create)) return; // kit not loaded
    _open = true;
    _win = window.OrwellWindowKit.create({
      id: WIN_ID,
      // Cohesive window-title contract: emoji + a single space + a Title-Case name
      // (matches the Cast 🎬 / Finale 🏆 / Retrospective 📼 windows). ✨ = a fresh
      // start (distinct from the Cast clapperboard, which the dock chip keeps below).
      title: "✨ A New Season",
      icon: "🎬",
      slot: "bottom-right",
      slotKey: "new-season",
      // Persistent: stays until the next season starts. Not closable; minimizable so the player
      // can tuck it away and keep lingering in the reunion, then bring it back from the dock.
      closable: false,
      minimizable: true,
      draggable: true,
      content: buildBody(),
    });
    _win.open();
    nudge();
  }

  function destroy() {
    _open = false;
    try { if (_win) _win.destroy(); } catch (_) {}
    _win = null;
    const stray = document.getElementById(WIN_ID);
    if (stray && stray.remove) stray.remove();
  }

  // Gentle in-reunion nudge: a soft pulse on the window (or its dock chip) so the path forward
  // is never hidden if the player lingers. Reduced-motion safe (animation simply no-ops).
  function nudge() {
    try {
      if (!_win || !_win.el) return;
      _win.el.animate && _win.el.animate(
        [{ boxShadow: "0 0 0 0 transparent" },
         { boxShadow: "0 0 0 4px color-mix(in srgb, var(--accent, #6d4aff) 35%, transparent)" },
         { boxShadow: "0 0 0 0 transparent" }],
        { duration: 1400, iterations: 1 });
    } catch (_) {}
  }

  async function refresh() {
    const post = await isPostSeason();
    if (post && !_open) show();
    else if (!post && _open) destroy();
  }

  function start() {
    refresh();
    if (_timer) clearInterval(_timer);
    const tick = async () => {
      if (!document.hidden) await refresh();
      _timer = setTimeout(tick, POLL_MS);
    };
    _timer = setTimeout(tick, POLL_MS);
  }

  window.addEventListener("orwell:gamechanged", refresh);
  // Seam for the headless gate / tests.
  window._orwellNewSeasonShow = show;
  window._orwellNewSeasonRefresh = refresh;

  ready(start);
})();
