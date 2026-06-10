// Orwell engine-status banner — VISIBLE error reporting when the game engine has a problem.
// The in-character "live feeds are down" chat line keeps players in the show, but the operator (and
// a confused player) needs an honest, out-of-character signal that something is actually broken. This
// is that signal: a small fixed banner that appears ONLY when /api/orwell/health reports the engine
// unreachable, naming the concrete reason (connection refused / timeout / wrong URL) so it's
// actionable. Self-contained, fail-open (if its own fetch fails, it simply shows the warning), no deps.
(function () {
  "use strict";

  const POLL_MS = 15000;
  const ID = "orwell-engine-status";
  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn, { once: true })
      : fn();

  let timer = null;

  function ensureBanner() {
    let el = document.getElementById(ID);
    if (el) return el;
    el = document.createElement("div");
    el.id = ID;
    el.setAttribute("role", "alert");
    el.innerHTML = `
      <style>
        #${ID} {
          position: fixed; top: 0; left: 0; right: 0; z-index: 11000; display: none;
          background: #7f1d1d; color: #fff; font-family: 'Fira Code', ui-monospace, monospace;
          font-size: .76rem; line-height: 1.4; padding: .5rem .8rem; text-align: center;
          box-shadow: 0 2px 10px rgba(0,0,0,.4);
        }
        #${ID} b { letter-spacing: .03em; }
        #${ID} .oes-reason { opacity: .85; }
        #${ID} .oes-x {
          position: absolute; right: .5rem; top: .35rem; cursor: pointer; border: none;
          background: none; color: inherit; opacity: .7; font-size: 1rem; line-height: 1; padding: 0 .3rem;
        }
        #${ID} .oes-x:hover { opacity: 1; }
      </style>
      <span><b>⚠ Big Brother engine unavailable.</b> <span class="oes-reason"></span></span>
      <button type="button" class="oes-x" title="Dismiss" aria-label="Dismiss">×</button>`;
    document.body.appendChild(el);
    el.querySelector(".oes-x").addEventListener("click", () => { el.style.display = "none"; });
    return el;
  }

  function show(reason, url) {
    const el = ensureBanner();
    const detail = [reason, url ? `(${url})` : ""].filter(Boolean).join(" ");
    el.querySelector(".oes-reason").textContent =
      (detail || "The game engine isn't responding.") + " The show can't load until it's back.";
    el.style.display = "block";
  }
  function hide() {
    const el = document.getElementById(ID);
    if (el) el.style.display = "none";
  }

  async function refresh() {
    try {
      const r = await fetch("/api/orwell/health", { credentials: "same-origin" });
      if (!r.ok) { show("The app couldn't reach the game service.", ""); return; }
      const d = await r.json();
      if (d && d.engine) hide();
      else show(d && d.error ? "Reason: " + d.error : "", d && d.engineUrl);
    } catch (_) {
      // The FE route itself failed — surface the most likely truth rather than going silent.
      show("The app couldn't reach the game service.", "");
    }
  }

  function start() {
    refresh();
    if (timer) clearInterval(timer);
    timer = setInterval(refresh, POLL_MS);
  }

  window.orwellRefreshEngineStatus = refresh;
  window.addEventListener("orwell:gamechanged", refresh);
  ready(start);
})();
