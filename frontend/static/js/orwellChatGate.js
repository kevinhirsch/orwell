// orwellChatGate.js — RETIRED hard gate (OOBE re-sequence, 2026-06-20). Now a fail-open no-op.
//
// HISTORY: this module used to HARD-LOCK the composer pre-game until the player secured a cast
// photo (the photo-FIRST onboarding). The OOBE re-sequence reversed that: the WELCOME opens the
// casting interview, the producers ask about the photo, and the photo box appears MID-interview as
// an OPTIONAL/skippable step (orwellHeadshot.js). The photo no longer gates the chat or
// createCharacter, so there is nothing left for this gate to lock.
//
// We KEEP the module loading (it's referenced from chat.js / app.js / orwellOnboarding.js via the
// public `window._orwellChatGate` surface — blocked()/recompute()/notePhotoSecured()) but make it
// INERT: `recompute()` never raises the photo lock (it's a no-op), `blocked()` always returns false,
// and the visual-lock machinery (applyLock / the MutationObserver re-assert) is no longer driven.
// Retiring the lock here — rather than ripping the module out — keeps every caller working unchanged
// and leaves the interview usable the instant the welcome is dismissed.
//
// Everything is fail-open by construction: the chat is NEVER blocked by this module again.
(function () {
  "use strict";

  const GATE_REASON = "Add your cast photo to begin";

  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn, { once: true })
      : fn();

  function isGameBuild() {
    return !!(typeof document !== "undefined" && document.body &&
      document.body.hasAttribute("data-game-build"));
  }

  async function jget(url) {
    try {
      const r = await fetch(url, { credentials: "same-origin" });
      return r.ok ? await r.json() : null;
    } catch (_) { return null; }
  }

  // The single, conservative gate flag. STARTS false (fail open) and is only ever raised by a
  // positive "pre-game + game-build + no image yet" probe. Anything we can't confirm clears it.
  let _blocked = false;

  function isBlocked() { return _blocked === true; }

  // Apply (or release) the visual lock on the composer: disable the textarea + send button,
  // swap the placeholder to the reason, and show an inline note above the input bar. Idempotent
  // and fully reversible — releasing restores the original placeholder and re-enables the input
  // (unless an active stream is using it, which chat.js manages independently).
  let _savedPlaceholder = null;

  function box() { return document.getElementById("message"); }
  function sendBtn() { return document.querySelector(".send-btn"); }

  function ensureCss() {
    if (document.getElementById("orwell-chat-gate-css")) return;
    const s = document.createElement("style");
    s.id = "orwell-chat-gate-css";
    // Theme-token driven (every house theme + frost) — no hard-coded colors.
    // P1 OOBE overhaul: the redundant banner note is GONE. The ONE clear instruction
    // now lives in the cast-photo WINDOW (orwellHeadshot.js); the composer keeps only a
    // minimal disabled-state placeholder. So no banner-vs-card-vs-placeholder duplication.
    s.textContent =
      "body.ow-chat-gated #message { opacity: .6; cursor: not-allowed; }" +
      "body.ow-chat-gated .send-btn { opacity: .45; cursor: not-allowed; pointer-events: none; }";
    document.head.appendChild(s);
  }

  function applyLock() {
    ensureCss();
    document.body.classList.add("ow-chat-gated");
    const b = box();
    if (b) {
      if (_savedPlaceholder === null) _savedPlaceholder = b.getAttribute("placeholder") || "";
      b.setAttribute("placeholder", GATE_REASON);
      b.setAttribute("aria-disabled", "true");
      b.disabled = true;
    }
    const sb = sendBtn();
    if (sb) { sb.disabled = true; sb.setAttribute("aria-disabled", "true"); }
    armReassert();
  }

  // The composer is re-rendered/re-enabled by several chat + session paths (a fresh-session click,
  // idle button states, the welcome splash). While the gate is up, a MutationObserver re-asserts
  // the disabled state the instant anything clears it — so the lock cannot be silently undone by an
  // unrelated re-render. Torn down on release. (CSS `pointer-events:none` on .send-btn is a second
  // belt for the button; the textarea needs the attribute re-applied to truly block typing/Enter.)
  let _observer = null;
  function armReassert() {
    if (_observer) return;
    try {
      _observer = new MutationObserver(() => {
        if (!_blocked) return;
        const b = box();
        if (b && !b.disabled) { b.disabled = true; b.setAttribute("aria-disabled", "true"); }
        if (b && b.getAttribute("placeholder") !== GATE_REASON) b.setAttribute("placeholder", GATE_REASON);
        const sb = sendBtn();
        if (sb && !sb.disabled) { sb.disabled = true; sb.setAttribute("aria-disabled", "true"); }
      });
      // Watch the whole input bar: the textarea + send button are re-created on session switches,
      // so observing the subtree (attributes + childList) catches both in-place and replaced nodes.
      const bar = document.querySelector(".chat-input-bar") || document.body;
      _observer.observe(bar, { subtree: true, attributes: true, childList: true,
        attributeFilter: ["disabled", "placeholder"] });
    } catch (_) { _observer = null; }
  }
  function disarmReassert() {
    if (_observer) { try { _observer.disconnect(); } catch (_) {} _observer = null; }
  }

  function releaseLock() {
    disarmReassert();
    document.body.classList.remove("ow-chat-gated");
    const b = box();
    if (b) {
      if (_savedPlaceholder !== null) { b.setAttribute("placeholder", _savedPlaceholder); _savedPlaceholder = null; }
      b.removeAttribute("aria-disabled");
      // Only RE-ENABLE; never force-disable here (an active stream owns disabled state).
      b.disabled = false;
    }
    const sb = sendBtn();
    if (sb) { sb.disabled = false; sb.removeAttribute("aria-disabled"); }
  }

  // OOBE re-sequence (2026-06-20): the photo lock is RETIRED. recompute() is now a fail-open no-op —
  // it NEVER raises the lock. It always releases (setBlocked(false)) so that if any prior state had
  // the lock up (e.g. a cached page mid-migration), it is cleared, and the chat is usable the
  // instant the welcome is dismissed. The cast photo is now an optional MID-interview step, so there
  // is no pre-game window to block. Kept async with the same signature for every existing caller.
  async function recompute() {
    setBlocked(false);
  }

  function setBlocked(v) {
    const next = !!v;
    if (next === _blocked) {
      // Even when the flag is unchanged, re-assert the lock UI if the composer re-rendered.
      if (next) applyLock();
      return;
    }
    _blocked = next;
    if (next) applyLock(); else releaseLock();
  }

  // The image step calls this the instant a photo is finalized so the unlock is immediate and never
  // waits on the next poll (the headshot studio dispatches `orwell:avatarchanged` on finalize).
  function notePhotoSecured() { setBlocked(false); }

  if (typeof window !== "undefined") {
    window._orwellChatGate = {
      blocked: isBlocked,
      reason: function () { return GATE_REASON; },
      recompute: recompute,
      notePhotoSecured: notePhotoSecured,
    };
    // Re-derive on the signals that change the gate: the player finalizing a photo
    // (avatarchanged), the game starting/restarting (gamechanged), and on load.
    window.addEventListener("orwell:avatarchanged", recompute);
    window.addEventListener("orwell:gamechanged", recompute);
    // 0064: the cast photo is server-authoritative (per-user), so it can be secured on ANOTHER
    // device. While this tab is BLOCKED, poll lightly so the gate releases once the synced
    // finalized-state lands here even if no event reached this tab (the headshot window does the
    // same). Only runs while gated — a no-op once the chat is open.
    setInterval(function () { if (isBlocked()) recompute(); }, 4000);
    ready(recompute);
  }
})();
