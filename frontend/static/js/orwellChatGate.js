// orwellChatGate.js — the OOBE "secure your cast photo first" HARD GATE (P1 onboarding).
//
// The redesigned onboarding makes the houseguest IMAGE the player's FIRST interaction: pre-game,
// before a single chat message can be sent, the player must secure SOME cast photo (upload one or
// generate one). Until they do, the chat input + send affordance are LOCKED and the composer says
// why ("Add your cast photo to begin"). The image step is intentionally first; only once it is
// secured do the producers reach out and the casting interview begins.
//
// This module owns ONE thing: the gate STATE + the visual lock. It is the single source of truth
// `chat.js` consults (`window._orwellChatGate.blocked()`) so every send path — the send button,
// Enter-to-send, and any programmatic submit — is covered by one guard. It is intentionally
// permissive by DEFAULT (fails OPEN): it only ever blocks when it has POSITIVELY confirmed a
// pre-game, game-build, image-not-yet-secured state. An unreachable engine, a non-game build, a
// started season, or any probe error all leave the chat fully usable.
//
// The producers' auto-open (orwellHeadshot → _orwellOpenGameAfterCasting) fires only AFTER the
// image is finalized, so by then the gate is already open — the hidden kickoff is never blocked.
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
    s.textContent =
      "body.ow-chat-gated #message { opacity: .6; cursor: not-allowed; }" +
      "body.ow-chat-gated .send-btn { opacity: .45; cursor: not-allowed; pointer-events: none; }" +
      ".ow-chat-gate-note { margin: var(--space-2, .5rem) auto 0; max-width: 640px;" +
      "  padding: var(--space-2, .5rem) var(--space-3, .7rem);" +
      "  background: color-mix(in srgb, var(--brand-color, var(--accent, #4a9)) 12%, transparent);" +
      "  border: 1px solid color-mix(in srgb, var(--brand-color, var(--accent, #4a9)) 40%, transparent);" +
      "  border-radius: 10px; color: color-mix(in srgb, var(--fg) 90%, transparent);" +
      "  font-size: var(--fs-sm, .82rem); line-height: 1.45; display: flex; gap: .5rem; align-items: baseline; }" +
      ".ow-chat-gate-note .ow-cg-ico { flex: none; }" +
      ".ow-chat-gate-note b { font-weight: 700; }";
    document.head.appendChild(s);
  }

  function mountNote() {
    if (document.getElementById("orwell-chat-gate-note")) return;
    const bar = document.querySelector(".chat-input-bar");
    if (!bar || !bar.parentNode) return;
    ensureCss();
    const note = document.createElement("div");
    note.id = "orwell-chat-gate-note";
    note.className = "ow-chat-gate-note";
    note.setAttribute("role", "note");
    note.innerHTML =
      '<span class="ow-cg-ico">\u{1F4F7}</span>' +
      "<span><b>" + GATE_REASON + ".</b> Upload a photo of yourself or generate one with AI — " +
      "securing a cast photo is your first step. The chat unlocks the moment it's set, and the " +
      "producers will reach out.</span>";
    bar.parentNode.insertBefore(note, bar);
  }

  function unmountNote() {
    const n = document.getElementById("orwell-chat-gate-note");
    if (n) n.remove();
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
    mountNote();
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
    unmountNote();
  }

  // Positively (re)compute the gate from the live state. Conservative: only blocks on a confirmed
  // pre-game game-build with no image secured yet. Everything else — non-game build, engine down,
  // started season, probe error — OPENS the gate.
  async function recompute() {
    if (!isGameBuild()) { setBlocked(false); return; }
    const st = await jget("/api/orwell/state");
    // Pre-game is the ONLY gated window. A null/unreadable state ⇒ don't block (fail open).
    const preGame = !!(st && st.started === false);
    if (!preGame) { setBlocked(false); return; }
    const intake = await jget("/api/orwell/portrait/intake");
    const secured = !!(intake && intake.finalized === true);
    setBlocked(!secured);
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
    ready(recompute);
  }
})();
