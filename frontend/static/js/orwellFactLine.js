// OrwellFactLine — M4-1's shared fact-line renderer, ONE small component for "a fact the
// player holds + where it came from": the main text, and a lighter pathway/source line
// beneath it. The dossier window (M4-1) is the first consumer; the Memory Wall (M4-2, a
// PARALLEL agent) consumes the same contract for its knowledge journal — this module ships
// FIRST so both land on one row shape instead of two near-identical hand-rolled ones.
//
// Deliberately dependency-light and render-only (no fetch, no game-state reads, no engine
// calls): every caller has ALREADY resolved its own Vault-free `text` + `source` strings —
// this module only lays them out. That keeps the Vault-freedom of any consuming surface a
// property of WHAT IT PASSES IN, provable by reading the caller, not this file.
//
//   OrwellFactLine.row({ text, source, belief })
//     text    — the fact/beat's player-facing content (already-scrubbed prose).
//     source  — a short, ALREADY-QUALITATIVE pathway/source line ("You witnessed this",
//               "Deja told you — secondhand", "Conversation"). NEVER a raw number: a
//               caller with a confidence/distortion value must translate it to words
//               (e.g. "sounds sure" / "you're not certain") before handing it here — this
//               component has no numeric formatting path at all, so it cannot leak one.
//     belief  — optional bool: true marks the row as a BELIEF (secondhand/uncertain —
//               distorted gossip, M4-2) rather than firsthand certainty. Purely a style
//               hook (italic content + a quieter tone); still zero numbers.
//
// Returns a detached DOM node; the caller appends it. Idempotent CSS injection.
(function () {
  "use strict";

  function ensureCss() {
    if (document.getElementById("ofl-css")) return;
    const st = document.createElement("style");
    st.id = "ofl-css";
    st.textContent = `
      .ofl-row {
        padding: .38rem .1rem; border-bottom: 1px solid var(--border, #355a66);
      }
      .ofl-row:last-child { border-bottom: none; }
      .ofl-text {
        font-size: .82rem; line-height: 1.4; color: var(--fg, #9cdef2);
        overflow-wrap: anywhere;
      }
      /* a BELIEF (secondhand/uncertain — the M4-2 gossip surface) reads as reported speech,
         never asserted fact — italics is the ENTIRE signal; still no number anywhere. */
      .ofl-row.ofl-belief .ofl-text { font-style: italic; opacity: .92; }
      .ofl-source {
        margin-top: .12rem; font-size: .68rem; letter-spacing: .02em; opacity: .6;
      }
      body.theme-frosted .ofl-row { border-color: rgba(255,255,255,0.14); }
    `;
    document.head.appendChild(st);
  }

  function row(opts) {
    ensureCss();
    const o = opts || {};
    const el = document.createElement("div");
    el.className = "ofl-row" + (o.belief ? " ofl-belief" : "");
    const text = document.createElement("div");
    text.className = "ofl-text";
    text.textContent = o.text == null ? "" : String(o.text);
    el.appendChild(text);
    if (o.source) {
      const src = document.createElement("div");
      src.className = "ofl-source";
      src.textContent = String(o.source);
      el.appendChild(src);
    }
    return el;
  }

  window.OrwellFactLine = { ensureCss, row };
})();
