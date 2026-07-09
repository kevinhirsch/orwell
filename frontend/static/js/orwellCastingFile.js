// Orwell "Your Casting File" gadget (feature 0050 / road-to-market M4-5) — the at-a-glance read
// of where the casting interview stands, straight from the engine's Vault-free casting-status
// projection.
//
// Audit C5: the engine tracks casting coverage (GameSessionAdapter.view() carries `casting`
// PRE-GAME — a CastingStatusView), but nothing surfaced it, so the interview flew blind: the
// player couldn't SEE which building blocks were on file and which the producers still needed.
// This is that glance, and nothing more — a read-only progress card:
//
//   • GET /api/orwell/state → { started, casting: { known: {field: value}, missing: [...] } }
//
// It reads ONLY the four player-facing casting-file fields (name / backstory / motivation /
// headshot), never the derived casting-sheet mapping (archetype / strategyStyle) or any hidden
// state — the Vault Wall holds at the surface. Each row shows captured (✓) vs. still-to-come (…).
//
// AUGMENTS the chat, never replaces it (ADR 0003): casting answers are still GIVEN in the
// interview conversation (the producers ask, the player answers, the model records via
// updateCasting); this card only reflects the file the engine keeps.
//
// Lifecycle: it appears DURING casting (state present, pre-game, a `casting` projection on file)
// and DISAPPEARS at season start — once `started` flips true the pre-game view no longer carries
// `casting`, so the row hides cleanly (no empty shell). Game-build gated, content-driven,
// fail-open everywhere (engine down / 404 / no-sandbox ⇒ the gadget simply isn't there, no
// console spam). Freshness rides the shared `orwell:gamechanged` signal (g15) — never an ad-hoc
// dispatch.
(function () {
  "use strict";

  const POLL_MS = 20000;
  const ID = "orwell-casting-file";
  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn, { once: true })
      : fn();

  let timer = null;
  let _failures = 0;
  function _pollDelay() { return Math.min(POLL_MS * Math.pow(2, _failures), 120000); }

  // The four PLAYER-FACING casting-file rows, in the interview's own order. Each maps to exactly
  // ONE canonical casting field (src/engine/castingIntake.ts CASTING_COVERAGE). This whitelist is
  // the Vault Wall at the surface: the gadget reads ONLY these keys off `casting.known` — never the
  // derived casting-sheet mapping (`archetype` / `strategyStyle`), the private strategy, persona
  // fields, or anything hidden. Add a row here (never a blanket dump of `known`).
  const ROWS = [
    { field: "playerName", label: "Name" },
    { field: "backstory", label: "Backstory" },
    { field: "motivation", label: "Motivation" },
    { field: "castPhoto", label: "Headshot" },
  ];

  async function getJSON(url) {
    const r = await fetch(url, { credentials: "same-origin" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  function hidePanel() {
    const el = document.getElementById(ID);
    if (el) el.style.display = "none";
  }

  // #640: compose the OrwellGadget kit (the .og-* card chrome + the rail mount + content-driven
  // visibility). The card shell + header ("🎬 Your Casting File") are the kit's; only this gadget's
  // own inner CSS (the file-row treatment) stays here. Display is CONTENT-DRIVEN by render().
  let _gadget = null;
  function ensureSection() {
    let el = document.getElementById(ID);
    if (el) return el;
    if (!document.getElementById("orwell-casting-file-css")) {
      const st = document.createElement("style");
      st.id = "orwell-casting-file-css";
      st.textContent = `
        #orwell-casting-file .ocf-row {
          display: flex; align-items: center; gap: .5rem; margin: .25rem 0;
        }
        #orwell-casting-file .ocf-mark {
          flex: 0 0 auto; width: 1.1em; text-align: center; font-weight: 700;
        }
        /* status by SHAPE, not colour alone (WCAG 1.4.1): ✓ captured vs … still to come */
        #orwell-casting-file .ocf-done .ocf-mark {
          color: color-mix(in srgb, #4caf50 75%, var(--fg, #9cdef2));
        }
        #orwell-casting-file .ocf-pending { opacity: .6; }
        #orwell-casting-file .ocf-pending .ocf-mark { opacity: .7; }
        #orwell-casting-file .ocf-label { flex: 1 1 auto; min-width: 0; }`;
      document.head.appendChild(st);
    }
    // Mount into the control-room gadget rail (0054), at the top of the stack during casting.
    _gadget = window.OrwellGadgetKit.create({
      id: ID, title: "Your Casting File", icon: "🎬", ariaLabel: "Your casting file",
    });
    const body = _gadget.ensure();
    body.innerHTML = `<div id="ocf-list"></div>`;
    return _gadget.el;
  }

  // True when a field is captured — its key is present (non-empty) in the engine's `known` map.
  // We only ever ASK about the four whitelisted keys; `known` may also hold derived fields, but
  // those are never read here (Vault Wall at the surface).
  function isCaptured(known, field) {
    return !!(known && typeof known === "object" &&
      typeof known[field] === "string" && known[field].trim().length > 0);
  }

  function render(casting) {
    // "Disappears at season start": the pre-game view carries `casting`; once the season starts
    // the projection drops it. No casting object ⇒ hide the row (no empty shell).
    if (!casting || typeof casting !== "object") {
      if (_gadget) _gadget.hide(); else hidePanel();
      return;
    }
    ensureSection();
    const known = casting.known;
    const wrap = document.getElementById("ocf-list");
    wrap.innerHTML = "";
    for (const { field, label } of ROWS) {
      const done = isCaptured(known, field);
      const row = document.createElement("div");
      row.className = "ocf-row " + (done ? "ocf-done" : "ocf-pending");
      const mark = document.createElement("span");
      mark.className = "ocf-mark"; mark.setAttribute("aria-hidden", "true");
      mark.textContent = done ? "✓" : "…";
      const name = document.createElement("span");
      name.className = "ocf-label"; name.textContent = label;
      // The accessible status rides on the row (SR reads label + state, not just the glyph).
      row.setAttribute("aria-label", label + (done ? " — recorded" : " — still to come"));
      row.appendChild(mark); row.appendChild(name);
      wrap.appendChild(row);
    }
    _gadget.show();
  }

  // Test/headless seam: drive the panel without a live engine (mirrors _orwellDealsDrive…).
  window._orwellCastingFileEnsure = () => { ensureSection(); return true; };
  window._orwellCastingFileDrive = (casting) => {
    render(casting || null);
    const w = document.getElementById("ocf-list");
    return w ? w.querySelectorAll(".ocf-row").length : 0;
  };

  async function refresh() {
    let st;
    try {
      st = await getJSON("/api/orwell/state");
    } catch (_) {
      if (window.OrwellReport) window.OrwellReport.fail("casting-file", "state-poll", _); // G11: fail open, never silent
      _failures += 1;
      render(null); // fail OPEN: the gadget simply isn't there
      return;
    }
    _failures = 0;
    // Show ONLY during casting: a pre-game state (started !== true) that still carries a `casting`
    // projection. A started game (or a no-sandbox {started:false} with no casting) hides it.
    render(st && st.started !== true ? st.casting : null);
  }

  function start() {
    refresh();
    if (timer) clearInterval(timer);
    const tick = async () => {
      if (!document.hidden) await refresh(); // C18: a hidden tab polls nothing
      timer = setTimeout(tick, _pollDelay());
    };
    timer = setTimeout(tick, _pollDelay());
  }

  window.orwellRefreshCastingFile = refresh;
  window.addEventListener("orwell:gamechanged", refresh);
  ready(() => {
    if (document.body && document.body.dataset.gameBuild !== "1") return; // game-build gated
    start();
    window.addEventListener("beforeunload", () => timer && clearTimeout(timer));
  });
})();
