// orwellPwReveal.js — the kit's canonical password show/hide toggle wiring (#1638, G3).
//
// The `.ow-pw-field` / `.ow-pw-reveal` LOOK is a pure-CSS treatment in style.css (ELEMENT KIT
// region). This tiny, idempotent, fail-open helper is the ONE place a field wires the toggle
// behavior, so no consumer re-implements it: it wraps an existing `.ow-input`/`.ow-field` in an
// `.ow-pw-field`, inserts the trailing `.ow-pw-reveal` eye button (both stacked glyphs — the CSS
// swaps them by `[aria-pressed]`), and binds click → flip the input's `type` password↔text, toggle
// `aria-pressed`, swap the `aria-label` Show↔Hide, and refocus the input.
//
// OWNER RULING 2026-07-15: Workflow-2 scope standardizes the EXISTING login.html toggle only; the
// in-app secret fields (search / endpoint API keys, admin env) KEEP their bare type=password with
// NO reveal. This helper is the kit primitive's wiring so a field CAN adopt it later — it is loaded
// but not called on any in-app field in this lane. Login keeps its own inline `wireToggle` (it is a
// standalone page that mirrors the kit rather than linking it) but adopts the same classes +
// aria-pressed contract.
(function () {
  "use strict";

  // The eye glyph pair — reused verbatim from login.html so the whole product uses ONE eye.
  // eye-open (iris circle) = the REVEALED state; eye-closed (slashed) = the MASKED state.
  var EYE_OPEN =
    '<svg class="ow-pw-eye ow-pw-eye-open" width="18" height="18" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>' +
    '<circle cx="12" cy="12" r="3"/></svg>';
  var EYE_CLOSED =
    '<svg class="ow-pw-eye ow-pw-eye-closed" width="18" height="18" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>' +
    '<line x1="8" y1="16" x2="16" y2="8"/><line x1="8" y1="8" x2="16" y2="16"/></svg>';

  function attach(inputEl) {
    try {
      if (!inputEl || inputEl.nodeType !== 1) return null;
      // idempotent: if already wrapped, return the existing button.
      var existing = inputEl.closest && inputEl.closest(".ow-pw-field");
      if (existing) return existing.querySelector(".ow-pw-reveal");

      var wrap = document.createElement("div");
      wrap.className = "ow-pw-field";
      var parent = inputEl.parentNode;
      if (!parent) return null;
      parent.insertBefore(wrap, inputEl);
      wrap.appendChild(inputEl);

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ow-pw-reveal";
      btn.setAttribute("aria-pressed", "false");
      btn.setAttribute("aria-label", "Show password");
      btn.innerHTML = EYE_OPEN + EYE_CLOSED; // CSS shows the right one per [aria-pressed]
      wrap.appendChild(btn);

      btn.addEventListener("click", function (e) {
        e.preventDefault();
        var show = inputEl.type === "password";
        inputEl.type = show ? "text" : "password";
        btn.setAttribute("aria-pressed", show ? "true" : "false");
        btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
        inputEl.focus();
      });
      // keep the on-screen keyboard open on mobile — tapping the eye must not blur the field.
      btn.addEventListener("touchstart", function (e) { e.preventDefault(); }, { passive: false });

      return btn;
    } catch (err) {
      // fail-open: a reveal that fails to wire leaves the field a plain, usable password input.
      try { console.warn("[ow-pw-reveal] attach failed", err); } catch (_e) {}
      return null;
    }
  }

  window.OrwellPwReveal = { attach: attach };
})();
