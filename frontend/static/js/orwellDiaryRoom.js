// Orwell Diary Room — a standing sidebar button + a COMPOSER MODE (E88, ruling #4).
//
// The Diary Room is not a window. The entry point is a permanent sidebar nav
// button (alongside New Chat / Search) that shows while a game is active;
// clicking it puts the CHAT COMPOSER into Diary-Room mode: a visible
// in-composer indicator, a private placeholder, and the send intercepted to
// POST /api/orwell/diary-room (the player's own OOC knowledge — no in-game
// pathway to any houseguest). Exit on send, Escape, or the indicator's ×.
// Chat-first per ADR 0003: the confessional is typed where everything else is.
(function () {
  "use strict";

  const BTN_ID = "sidebar-diary-room-btn";
  const PILL_ID = "orwell-dr-pill";
  // UX-7: the pill's `role="status"` live region only announces on a CONTENT mutation, not a
  // display-style toggle — so entering DR mode (a consequential OOC-channel switch) was
  // structurally silent to screen readers. This label text is (re-)injected into the pill's
  // first child on every enterDRMode(), forcing the mutation the live region needs to fire.
  const DR_ENTRY_LABEL = "\u{1F4D4} Diary Room — private & out-of-character; the house never hears this.";
  let drMode = false;
  let _returnPlaceholder = null;

  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn, { once: true })
      : fn();

  function composerBox() { return document.getElementById("message"); }
  function composerForm() { return document.getElementById("chat-form") || (composerBox() && composerBox().form); }

  // --- the sidebar button (standing chrome, game-gated) -------------------------

  function ensureButton() {
    let btn = document.getElementById(BTN_ID);
    if (btn) return btn;
    const search = document.getElementById("sidebar-search-btn");
    if (!search || !search.parentElement) return null;
    btn = document.createElement("div");
    btn.className = "list-item";
    btn.id = BTN_ID;
    btn.setAttribute("role", "button");
    btn.setAttribute("tabindex", "0");
    btn.title = "Diary Room — private & out-of-character";
    btn.style.display = "none"; // shown while a game is active
    btn.innerHTML = `
      <svg class="sidebar-action-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
      <span class="grow">Diary Room</span>`;
    const enter = () => enterDRMode();
    btn.addEventListener("click", enter);
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); enter(); }
    });
    search.parentElement.insertBefore(btn, search.nextSibling);
    return btn;
  }

  async function refreshGate() {
    const btn = ensureButton();
    if (!btn) return;
    try {
      const r = await fetch("/api/orwell/state", { credentials: "same-origin" });
      const st = r.ok ? await r.json() : null;
      btn.style.display = st && st.started ? "" : "none";
      if (!(st && st.started) && drMode) exitDRMode();
    } catch (_) { /* engine hiccup: leave the button as it was (fail-open) */ }
  }

  // --- the composer mode ---------------------------------------------------------

  // #655 — the pill MUST mount directly above the VISIBLE composer (.chat-input-bar), not
  // relative to #chat-form. The real submit form (#chat-form) is a HIDDEN, EMPTY element
  // (style="display:none") that sits AFTER .chat-input-bar — the send button targets it via
  // form="chat-form". Anchoring the pill on that form dropped it BELOW the composer, off the
  // bottom of the page. On mobile (small viewport + on-screen keyboard) the pill was then
  // never visible, so tapping the affordance looked like a no-op — the reported "the Diary
  // Room doesn't open." Anchor on the input bar so the pill always appears right above where
  // the player types, on every viewport.
  function composerBar() {
    return document.querySelector(".chat-input-bar") || composerForm();
  }

  function ensurePill() {
    let pill = document.getElementById(PILL_ID);
    if (pill) return pill;
    const anchor = composerBar();
    if (!anchor || !anchor.parentElement) return null;
    pill = document.createElement("div");
    pill.id = PILL_ID;
    pill.setAttribute("role", "status");
    // #738 item 22 (owner ruling "tone down to a hint"): the confessional pill's BULK
    // chrome is neutralised — its fill/border/ink live in style.css (#orwell-dr-pill) so the
    // glass theme can swap the bulk to the ONE shared colourless light-glass material, keeping
    // only a WHISPER of rose as a thin edge. Only LAYOUT stays inline here (no rose fill).
    // NOTE: that thin rose EDGE is a SANCTIONED DIEGETIC EXCEPTION to the general "no accent on
    // chrome" rule — the confessional's in-world signature, owner-ruled and recorded in
    // docs/decisions/PO-DECISIONS-LOG.md (2026-07-11). It is NOT a leak: it stays a bounded edge
    // (never a fill), scoped to this one surface. Do not strip it in a glass-legibility sweep, and
    // do not widen it. Pin: tests/test_738_glass_polish_8_13_22.py::test_dr_pill_keeps_a_bounded_rose_hint.
    pill.style.cssText = "display:none;align-items:center;gap:6px;margin:0 0 4px;" +
      "padding:3px 10px;border-radius:999px;width:fit-content;font-size:var(--fs-xs);";
    // UX-7: the label starts EMPTY — enterDRMode() injects DR_ENTRY_LABEL on every entry, which is
    // the content mutation the role="status" live region needs to actually announce the mode switch
    // (a pure display:none -> flex toggle never fires aria-live).
    pill.innerHTML = `<span></span>
      <button type="button" id="orwell-dr-exit" class="ow-btn ow-btn-plain" aria-label="Leave the Diary Room" title="Leave the Diary Room"
        style="color:inherit;font-size:1em;min-width:44px;min-height:44px;padding:0 2px;">×</button>`;
    anchor.parentElement.insertBefore(pill, anchor);
    pill.querySelector("#orwell-dr-exit").addEventListener("click", exitDRMode);
    return pill;
  }

  // G17 (refresh-persistence audit F5): the composer-draft module persists the DR flag
  // WITH the draft — it must hear every mode change the moment it happens, so a
  // confessional-in-progress can never be stored as (or restored into) house-bound text.
  function notifyModeChange() {
    try { window.dispatchEvent(new CustomEvent("orwell:drmode", { detail: { active: drMode } })); } catch (_) {}
  }

  // #655 — on a narrow viewport the Diary-Room affordance lives in the sidebar drawer (or its
  // icon-rail mirror). Tapping it used to leave the drawer OPEN, covering the composer that
  // just entered DR mode — so the player saw nothing happen ("it doesn't open"). Close the
  // mobile drawer so the in-composer DR pill + placeholder are actually visible.
  function closeMobileSidebar() {
    try {
      if (!window.matchMedia || !window.matchMedia("(max-width: 768px)").matches) return;
      const sb = document.getElementById("sidebar");
      if (sb && !sb.classList.contains("hidden")) sb.classList.add("hidden");
      const backdrop = document.getElementById("sidebar-backdrop");
      if (backdrop) backdrop.classList.remove("visible");
      if (typeof window.syncRailSide === "function") window.syncRailSide();
    } catch (_) { /* fail-open: opening DR mode must never throw */ }
  }

  function enterDRMode() {
    // #655 — make the open path RELIABLE (was flaky): the composer form/pill may not exist yet
    // when the affordance is tapped (a race on fresh load / right after a game starts). Wire the
    // composer and build the pill on demand; if the composer box still isn't in the DOM, defer
    // one frame and retry ONCE rather than silently no-op'ing (the old `return` was the flake).
    wireComposer();
    const box = composerBox();
    const pill = ensurePill();
    if (!box || !pill) {
      if (!enterDRMode._retried) {
        enterDRMode._retried = true;
        requestAnimationFrame(() => { enterDRMode._retried = false; enterDRMode(); });
      }
      return;
    }
    drMode = true;
    // UX-7: re-inject the label text (even if unchanged) so the role="status" live region
    // mutates on EVERY entry, not just the first mount — this is the announcement itself.
    const label = pill.firstElementChild;
    if (label) label.textContent = DR_ENTRY_LABEL;
    pill.style.display = "flex";
    document.body.classList.add("orwell-dr-mode");
    closeMobileSidebar();
    _returnPlaceholder = box.placeholder;
    box.placeholder = "Tell the producers what you're really thinking…";
    box.focus();
    notifyModeChange();
  }

  function exitDRMode() {
    const box = composerBox();
    const pill = document.getElementById(PILL_ID);
    drMode = false;
    if (pill) pill.style.display = "none";
    document.body.classList.remove("orwell-dr-mode");
    if (box && _returnPlaceholder !== null) { box.placeholder = _returnPlaceholder; _returnPlaceholder = null; }
    notifyModeChange();
  }

  async function submitDR(entry) {
    const r = await fetch("/api/orwell/diary-room", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry }),
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
  }

  // Capture-phase interception: in DR mode the send is a confessional, never a chat
  // turn — the chat pipeline (and the agent) must not see it.
  function wireComposer() {
    const form = composerForm();
    const box = composerBox();
    if (!form || form._orwellDRWired || !box) return;
    form._orwellDRWired = true;
    form.addEventListener("submit", async (e) => {
      if (!drMode) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const entry = (box.value || "").trim();
      if (!entry) { box.focus(); return; }
      const pill = document.getElementById(PILL_ID);
      // F-NEW-8: a confessional POST can exceed Doherty's 400ms; show an in-flight cue and
      // guard against a double-submit (the capture-phase handler can re-fire on a fast second
      // Enter). _drSubmitting gates re-entry; the pill text signals the recording is in flight.
      if (form._drSubmitting) return;
      form._drSubmitting = true;
      const _label = pill && pill.firstElementChild;
      if (_label) { pill.setAttribute("aria-live", "polite"); _label.textContent = "📔 Recording…"; }
      try {
        await submitDR(entry);
        box.value = "";
        box.dispatchEvent(new Event("input", { bubbles: true }));
        if (pill) {
          pill.setAttribute("aria-live", "polite"); // success is non-urgent (reset if a prior error escalated)
          pill.firstElementChild.textContent = "📔 Recorded ✓ — between you and the producers.";
          setTimeout(exitDRMode, 900);
        } else { exitDRMode(); }
      } catch (_) {
        // A11Y-4: a failed confessional is actionable — announce assertively so it isn't deferred
        // behind the chat stream and lost (the player thinks their strategy note was recorded).
        if (pill) {
          pill.setAttribute("aria-live", "assertive");
          pill.firstElementChild.textContent = "📔 The Diary Room camera glitched — try again.";
        }
      } finally {
        // F-NEW-8: release the in-flight gate so a retry (after an error) can submit again.
        form._drSubmitting = false;
      }
    }, true);
    box.addEventListener("keydown", (e) => {
      if (drMode && e.key === "Escape") { e.preventDefault(); exitDRMode(); }
    });
  }

  // The one seam every flow uses (smoke gate, future prompts): enter the composer mode.
  window._orwellOpenDiaryRoom = () => { ensureButton(); wireComposer(); enterDRMode(); return true; };
  window._orwellDiaryRoomActive = () => drMode;

  // WS Phase-1 (§4): when the multiplexed socket is live the server PUSHES a `state`
  // frame on every board change; platform.js relays it to the one `orwell:gamechanged`
  // dispatcher, which already re-runs refreshGate below. So we stand the 30s gate poll
  // down in WS mode and stay edge-triggered (fail-soft: any doubt ⇒ keep polling). The
  // fallback/SSE path is unchanged and still polls.
  function _wsActive() {
    try { return !!(window.OrwellWs && window.OrwellWs.isActive && window.OrwellWs.isActive()); }
    catch (_) { return false; }
  }
  let _gateTimer = null;
  function startGatePoll() {
    if (_gateTimer) { clearInterval(_gateTimer); _gateTimer = null; }
    // Re-arm the periodic gate poll ONLY while WS is inactive (byte-identical to before when off).
    if (!_wsActive()) _gateTimer = setInterval(() => { if (!document.hidden) refreshGate(); }, 30000);
  }

  function start() {
    ensureButton();
    wireComposer();
    refreshGate();
    window.addEventListener("orwell:gamechanged", refreshGate);
    startGatePoll();
    // WS Phase-1 (§4/§6): cancel the periodic poll the instant the socket goes live; resume
    // polling if it falls back to SSE (startGatePoll re-arms only while !_wsActive()).
    window.addEventListener("orwell:ws-active", () => { if (_gateTimer) { clearInterval(_gateTimer); _gateTimer = null; } });
    window.addEventListener("orwell:ws-inactive", () => { refreshGate(); startGatePoll(); });
  }

  ready(start);
})();
