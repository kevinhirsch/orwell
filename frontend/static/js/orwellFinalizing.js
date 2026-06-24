// Orwell casting → house-entry "finalizing" indicator (P1 OOBE conversation-split fix).
//
// The casting interview ends with a HEAVY cutover: createCharacter finalizes the houseguest
// (persona/backstory/soul datastore), then the engine narrates the house entry. During that
// gap the chat used to look frozen — the player saw the composer go quiet and a late response
// they couldn't catch arrive. This module paints a small, on-brand, INLINE indicator inside
// #chat-history (NOT a blocking modal — the transcript stays fully visible) the moment the
// finalize begins, and clears it the instant the house-entry narration starts streaming.
//
// It is purely cosmetic and fails open: any DOM trouble just leaves the chat untouched. It is
// driven from chat.js's tool stream:
//   • _orwellFinalizing.begin()  — createCharacter success (the cutover starts)
//   • _orwellFinalizing.end()    — the first assistant narration token after begin, and as a
//                                  safety net when the stream completes.
(function () {
  "use strict";

  const ID = "orwell-finalizing";

  function ensureCss() {
    if (document.getElementById("orwell-finalizing-css")) return;
    const s = document.createElement("style");
    s.id = "orwell-finalizing-css";
    // On-brand: matches the onboarding card / .ow-* family (monospace, brand accent, panel chrome)
    // and the agent-thread "running" pulse so it reads as production machinery, not an error.
    s.textContent = `
      #${ID} {
        display: flex; align-items: center; gap: .7rem;
        margin: .6rem 0; padding: .7rem .9rem;
        border: 1px solid var(--border, #355a66); border-radius: 10px;
        background: color-mix(in srgb, var(--panel, #111) 92%, var(--brand-color, var(--red, #e06c75)) 8%);
        color: var(--fg, #9cdef2);
        font-family: var(--mono, monospace); font-size: .82rem; line-height: 1.4;
        animation: ow-finalizing-in .25s ease-out;
      }
      #${ID} .ow-fin-dot {
        flex: 0 0 auto; width: .7rem; height: .7rem; border-radius: 50%;
        background: var(--brand-color, var(--red, #e06c75));
        box-shadow: 0 0 0 0 color-mix(in srgb, var(--brand-color, var(--red, #e06c75)) 60%, transparent);
        animation: ow-finalizing-pulse 1.4s ease-in-out infinite;
      }
      #${ID} .ow-fin-text { flex: 1 1 auto; }
      #${ID} .ow-fin-text b { font-weight: 600; }
      #${ID} .ow-fin-sub { display: block; opacity: .65; font-size: .76rem; margin-top: .15rem; }
      @keyframes ow-finalizing-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
      @keyframes ow-finalizing-pulse {
        0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--brand-color, var(--red, #e06c75)) 55%, transparent); }
        70% { box-shadow: 0 0 0 .5rem color-mix(in srgb, var(--brand-color, var(--red, #e06c75)) 0%, transparent); }
        100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--brand-color, var(--red, #e06c75)) 0%, transparent); }
      }
      /* J5-12: the pulse runs unbounded (until the first narration token, 30–60s on a slow model) —
         strip the entrance + the infinite pulse for prefers-reduced-motion (WCAG 2.2.2). The dot
         stays a static colour indicator, still meaningful. */
      @media (prefers-reduced-motion: reduce) {
        #${ID} { animation: none; }
        #${ID} .ow-fin-dot { animation: none; }
      }`;
    document.head.appendChild(s);
  }

  function begin() {
    try {
      const box = document.getElementById("chat-history");
      if (!box) return;
      if (document.getElementById(ID)) return; // already showing
      ensureCss();
      const el = document.createElement("div");
      el.id = ID;
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      el.innerHTML =
        '<span class="ow-fin-dot" aria-hidden="true"></span>' +
        '<span class="ow-fin-text"><b>Production is finalizing your casting…</b>' +
        '<span class="ow-fin-sub">Settling you into the house — hang tight.</span></span>';
      box.appendChild(el);
      // Keep it in view without yanking the player away from earlier transcript.
      try { el.scrollIntoView({ block: "end", behavior: "smooth" }); } catch (_) {}
    } catch (_) { /* fail open — the chat is unaffected */ }
  }

  function end() {
    try {
      const el = document.getElementById(ID);
      if (el) el.remove();
    } catch (_) {}
  }

  window._orwellFinalizing = { begin: begin, end: end };
})();
