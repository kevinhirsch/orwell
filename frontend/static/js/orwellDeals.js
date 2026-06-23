// Orwell deals surface (feature 0039 — the player's tracked promises) — SIDEBAR CHROME, a
// self-contained, fail-open sibling to orwellSocial.js / orwellStatusPanel.js.
//
// Big Brother is promises kept and broken. The engine already projects the player's OWN deals,
// Vault-free, on the game-state route (GameStateView.deals — DealLedger.forParty(PLAYER)): the
// FACT and status only (parties, kind, terms, open|kept|broken), NEVER a relationship number and
// NEVER an NPC-to-NPC deal (those stay sealed in the Vault). That projection had no consumer — the
// player could promise someone the world in chat but had nowhere to GLANCE at what they were on
// the hook for. This is that glance, and nothing more: a read-only tracker.
//
//   • GET the game-state route → { started, deals: [{ id, parties[], kind, terms, status }] }
//
// AUGMENTS the chat, never replaces it (ADR 0003): deals are still STRUCK in conversation (the
// GM's make-a-deal lever); this panel only reflects the ledger the engine keeps. Content-driven
// (it shows nothing when the player holds no deals — no empty box), game-build gated, fail-open.

(function () {
  "use strict";

  const POLL_MS = 20000;
  const ID = "orwell-deals";
  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn, { once: true })
      : fn();

  let timer = null;
  let _failures = 0;
  let _shown = false; // kept a real game's panel up through a transient hiccup (U5)
  function _pollDelay() { return Math.min(POLL_MS * Math.pow(2, _failures), 120000); }

  // The engine's deal kinds (src/ports/GameSession.ts MakeDealReq.kind) → player-facing label.
  // No number, no lean — just what KIND of promise it is.
  const KIND_LABEL = {
    "safety": "Safety",
    "vote": "Vote",
    "final-two": "Final 2",
    "target-other": "Shared target",
  };
  // The status carries the whole drama: a promise still live, one honored, one betrayed.
  // F-NEW-12: each status carries a non-color GLYPH alongside its label, so open-vs-kept
  // is distinguished by shape (not the green-vs-blue border alone) for protan/deutan + SR
  // users (WCAG 1.4.1 / 4.1.3). The glyph is decorative-redundant to the text label.
  const STATUS_META = {
    open:   { cls: "odl-open",   tag: "active",  glyph: "•", hint: "Still standing" },
    kept:   { cls: "odl-kept",   tag: "kept",    glyph: "✓", hint: "Honored" },
    broken: { cls: "odl-broken", tag: "broken",  glyph: "✕", hint: "Broken" },
  };

  async function getJSON(url) {
    const r = await fetch(url, { credentials: "same-origin" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  function hidePanel() {
    const el = document.getElementById(ID);
    if (el) el.style.display = "none";
  }

  // Sidebar chrome, mirroring orwellSocial.js's ensure/mount pattern (ruling #3/E64): a <section>
  // in the control-room gadget rail (0054), display CONTENT-DRIVEN by render().
  function ensureSection() {
    let el = document.getElementById(ID);
    if (el) return el;
    el = document.createElement("section");
    el.id = ID;
    el.setAttribute("aria-label", "Your deals");
    el.innerHTML = `
      <style>
        #orwell-deals {
          display: none;
          margin: var(--space-2) var(--space-2) 0;
          padding: var(--space-2) var(--space-3);
          background: color-mix(in srgb, var(--panel, #111) 70%, transparent);
          color: var(--fg, #9cdef2);
          border: 1px solid var(--border, #355a66); border-radius: 10px;
          font-family: 'Fira Code', ui-monospace, monospace;
          font-size: var(--fs-xs); line-height: 1.5;
        }
        #orwell-deals .odl-hd {
          color: color-mix(in srgb, var(--fg, #9cdef2) 78%, var(--panel, #111));
          margin: 0 0 .35rem; font-weight: 600; letter-spacing: .03em;
        }
        #orwell-deals .odl-row {
          display: flex; align-items: flex-start; gap: .4rem; margin: .3rem 0;
          background: rgba(255,255,255,.05); border: 1px solid var(--border, #355a66);
          border-radius: 8px; padding: .3rem .45rem;
          border-left: 3px solid var(--border, #355a66);
        }
        /* the status drives the left accent rail — no number leaks, just kept / open / broken */
        #orwell-deals .odl-open   { border-left-color: color-mix(in srgb, #4caf50 70%, var(--border, #355a66)); }
        #orwell-deals .odl-kept   { border-left-color: color-mix(in srgb, #2196f3 70%, var(--border, #355a66)); opacity: .85; }
        #orwell-deals .odl-broken { border-left-color: color-mix(in srgb, #e0564a 75%, var(--border, #355a66)); opacity: .7; }
        #orwell-deals .odl-body { flex: 1; min-width: 0; }
        #orwell-deals .odl-who { color: var(--fg, #9cdef2); font-weight: 600; }
        #orwell-deals .odl-kind {
          font-size: .68rem; opacity: .7; text-transform: uppercase; letter-spacing: .04em;
        }
        #orwell-deals .odl-terms {
          opacity: .82; margin-top: .1rem; white-space: normal; overflow-wrap: anywhere;
        }
        #orwell-deals .odl-tag {
          flex: 0 0 auto; font-size: .62rem; text-transform: uppercase; letter-spacing: .05em;
          opacity: .65; padding-top: .1rem;
        }
        #orwell-deals .odl-broken .odl-terms { text-decoration: line-through; }
      </style>
      <div class="odl-hd" role="heading" aria-level="3"><span aria-hidden="true">🤝 </span>Your deals</div>
      <div id="odl-list"></div>`;
    // Mount into the control-room gadget rail (0054), under the status panel; fall back to the
    // sidebar (then body) — never floating, never document.body first.
    const rail = document.getElementById("gadget-rail-body");
    const sidebar = document.getElementById("sidebar");
    const status = document.getElementById("orwell-status");
    const anchor = status || document.getElementById("sessions-section");
    if (rail && anchor && anchor.parentElement === rail) {
      rail.insertBefore(el, anchor.nextSibling);
    } else if (rail) {
      rail.appendChild(el);
    } else if (anchor && anchor.parentElement) {
      anchor.parentElement.insertBefore(el, anchor.nextSibling);
    } else if (sidebar) {
      sidebar.appendChild(el);
    } else {
      document.body.appendChild(el);
    }
    return el;
  }

  // The other party (deals are always player + one houseguest); never render the player's own row.
  function otherParty(deal) {
    const ps = Array.isArray(deal.parties) ? deal.parties : [];
    const them = ps.find((p) => p && p.id !== "player");
    return (them && them.name) || "A houseguest";
  }

  function render(deals) {
    const el = ensureSection();
    const list = Array.isArray(deals) ? deals : [];
    const wrap = document.getElementById("odl-list");
    wrap.innerHTML = "";
    if (!list.length) { el.style.display = "none"; return; } // content-driven: no deals, no box
    // Live promises first, then settled ones (kept/broken) for the record.
    const order = { open: 0, kept: 1, broken: 2 };
    const sorted = list.slice().sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
    for (const d of sorted) {
      const meta = STATUS_META[d.status] || STATUS_META.open;
      const row = document.createElement("div");
      row.className = "odl-row " + meta.cls;
      row.title = meta.hint;
      const body = document.createElement("div");
      body.className = "odl-body";
      const who = document.createElement("span");
      who.className = "odl-who"; who.textContent = otherParty(d);
      const kind = document.createElement("span");
      kind.className = "odl-kind"; kind.textContent = " · " + (KIND_LABEL[d.kind] || d.kind || "Deal");
      const terms = document.createElement("div");
      terms.className = "odl-terms"; terms.textContent = d.terms || "";
      body.appendChild(who); body.appendChild(kind);
      if (d.terms) body.appendChild(terms);
      const tag = document.createElement("span");
      tag.className = "odl-tag"; tag.textContent = (meta.glyph ? meta.glyph + " " : "") + meta.tag;
      row.appendChild(body); row.appendChild(tag);
      wrap.appendChild(row);
    }
    el.style.display = "block";
  }

  // Test/headless seam: drive the panel without a live engine (mirrors _orwellSocialDrive…).
  window._orwellDealsEnsure = () => { ensureSection(); return true; };
  window._orwellDealsDrive = (deals) => { render(deals || []); const w = document.getElementById("odl-list"); return w ? w.querySelectorAll(".odl-row").length : 0; };

  async function refresh() {
    let st;
    try {
      st = await getJSON("/api/orwell/state");
    } catch (_) {
      if (window.OrwellReport) window.OrwellReport.fail("deals", "state-poll", _); // G11: fail open, never silent
      _failures += 1;
      if (!_shown) hidePanel(); // only hide if we never had a game up
      return;
    }
    _failures = 0;
    if (!(st && st.started)) { _shown = false; hidePanel(); return; }
    _shown = true;
    render(st.deals);
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

  window.orwellRefreshDeals = refresh;
  window.addEventListener("orwell:gamechanged", refresh);
  ready(() => {
    if (document.body && document.body.dataset.gameBuild !== "1") return; // game-build gated
    start();
    window.addEventListener("beforeunload", () => timer && clearTimeout(timer));
  });
})();
