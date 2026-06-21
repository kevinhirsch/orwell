// Orwell headshot studio (features G26/G27/G28) — the player's OWN portrait + account avatar.
//
// Make your houseguest's portrait (and your account profile pic) from a photo of yourself:
//   • exact  — your photo, cropped to your face, used as-is (no AI);
//   • studio — AI recreates you in the house style; you GENERATE 3 OPTIONS AT A TIME and pick
//              one, regenerate for a fresh set (indefinitely), or upload a different photo.
// Finalizing sets it as your houseguest portrait AND your account avatar (the circle updates at
// once, via `orwell:avatarchanged`).
//
// The STUDIO (`window.OrwellHeadshotStudio.mount(bodyEl)`) is reusable — the pre-game casting
// card mounts it (game-build, state.started===false), and Settings → Account mounts the same
// thing (G28). Vault-safe: only the player's own image, never game state. Fail-open.
(function () {
  "use strict";

  const ID = "orwell-headshot";
  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn, { once: true })
      : fn();

  async function jget(url) {
    try { const r = await fetch(url, { credentials: "same-origin" }); return r.ok ? r.json() : null; }
    catch (_) { return null; }
  }

  function ensureCss() {
    if (document.getElementById("orwell-headshot-css")) return;
    const s = document.createElement("style");
    s.id = "orwell-headshot-css";
    s.textContent = `
      /* P1 OOBE overhaul: the pre-game casting headshot is a PROPER OrwellWindow (composes the
         .ow-* kit). It GATES the chat, so it is mounted non-dismissable (no close/minimize) and
         stays put until a photo is secured.
         0064 placement fix: it is the FOCUSED onboarding gate, so it docks as a centered dialog,
         NOT floating at the top-right slot anchor. The slot system writes inline
         left/top/right/bottom/transform to stack panels; we override every one with !important
         (inline non-important loses to important CSS) so the window pins viewport-centered
         regardless of the slot math. The old rule pinned only the left edge (left:50% with no
         important transform), which the slot stomped to transform:none and dropped the recenter —
         that floated it mid-screen at the wrong place. The full transform now centers it. */
      #${ID} {
        width: 480px; max-width: min(92vw, 480px);
        left: 50% !important; right: auto !important;
        top: max(12vh, var(--ow-headshot-top-clear, 88px)) !important; bottom: auto !important;
        transform: translateX(-50%) !important;
        z-index: 1000;  /* above the welcome splash + slotted HUD, below true modals */
      }
      #${ID} > .ow-body { max-height: min(62vh, calc(100vh - var(--ow-headshot-top-clear, 120px))); }
      /* the ONE instruction lives in the window body — no duplicate banner/placeholder copy */
      #${ID} .hs-lead { margin: 0 0 10px; font-size: 12.5px; line-height: 1.5;
        color: color-mix(in srgb, var(--fg, #cfd8e3) 88%, transparent); }
      #${ID} .hs-lead b { font-weight: 700; }
      /* the studio body — shared by the casting window AND Settings (scoped to the class) */
      .ow-headshot-studio { font-size: 13px; }
      .ow-headshot-studio .hs-msg { opacity: .75; font-size: 12px; }
      .ow-headshot-studio .hs-actions { display: flex; gap: 8px; align-items: center; margin-top: 10px; flex-wrap: wrap; }
      .ow-headshot-studio .hs-btn { font: inherit; font-size: 12.5px; padding: 6px 12px; border-radius: 8px; cursor: pointer;
        background: var(--brand-color, var(--accent, #4a9)); color: var(--bg, #111); border: 1px solid transparent; font-weight: 600; }
      .ow-headshot-studio .hs-btn[disabled] { opacity: .5; cursor: default; }
      .ow-headshot-studio .hs-btn-ghost { background: transparent; color: var(--fg, #cfd8e3); border-color: var(--border, #355a66); font-weight: 400; }
      .ow-headshot-studio .hs-preview { width: 92px; height: 92px; border-radius: 8px; flex: none;
        border: 1px solid var(--border, #355a66); background: #0d0f14 center/cover no-repeat;
        display: flex; align-items: center; justify-content: center; font-size: 28px; opacity: .85; }
      .ow-headshot-studio .hs-row { display: flex; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
      .ow-headshot-studio .hs-opts { flex: 1; min-width: 220px; display: flex; flex-direction: column; gap: 8px; }
      /* The file control is a themed BUTTON (a <label for>) over a visually-hidden native
         input — the bare OS "Choose File / No file chosen" text otherwise clipped to
         "No fil…chosen" on mobile (UX audit J1-08). The input keeps its id/handler/accept/
         aria and stays operable; selection state shows in the preview thumbnail. */
      .ow-headshot-studio .hs-file-native { position: absolute; width: 1px; height: 1px;
        overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
      .ow-headshot-studio .hs-filebtn { display: inline-flex; align-items: center; align-self: flex-start; }
      /* SR-only live region for portrait status ("Generating…", "Upload failed", offline) — J1-27. */
      .ow-headshot-studio .hs-live { position: absolute; width: 1px; height: 1px; overflow: hidden;
        clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
      .ow-headshot-studio .hs-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 6px 0 2px; }
      /* Portrait tiles are real <button>s (keyboard/SR operable — UX audit J1-26); reset native chrome. */
      .ow-headshot-studio .hs-cand { position: relative; aspect-ratio: 1; border-radius: 8px; overflow: hidden; cursor: pointer;
        border: 2px solid transparent; background: #0d0f14 center/cover no-repeat;
        padding: 0; margin: 0; font: inherit; width: 100%; -webkit-appearance: none; appearance: none; }
      .ow-headshot-studio .hs-cand.sel { border-color: var(--brand-color, var(--accent, #4a9)); }
      .ow-headshot-studio .hs-cand img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .ow-headshot-studio .hs-cand:focus-visible, .ow-headshot-studio .hs-libpick:focus-visible {
        outline: 2px solid var(--brand-color, var(--accent, #4a9)); outline-offset: 2px; }
      .ow-headshot-studio .hs-lib { margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--border, #355a66); }
      .ow-headshot-studio .hs-libstrip { display: flex; gap: 8px; flex-wrap: wrap; }
      .ow-headshot-studio .hs-libitem { position: relative; width: 56px; height: 56px; border-radius: 8px; overflow: hidden;
        border: 2px solid transparent; background: #0d0f14 center/cover no-repeat; flex: none; }
      .ow-headshot-studio .hs-libitem.cur { border-color: var(--brand-color, var(--accent, #4a9)); }
      .ow-headshot-studio .hs-libpick { position: absolute; inset: 0; padding: 0; margin: 0; border: none;
        background: none; cursor: pointer; -webkit-appearance: none; appearance: none; }
      .ow-headshot-studio .hs-libitem img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .ow-headshot-studio .hs-libdel { position: absolute; top: 1px; right: 1px; width: 16px; height: 16px; line-height: 14px;
        border-radius: 50%; border: none; cursor: pointer; font-size: 12px; padding: 0; z-index: 1;
        background: rgba(0,0,0,.6); color: #fff; opacity: 0; transition: opacity .12s; }
      /* keyboard/touch users have no hover — reveal the delete on focus-within too. */
      .ow-headshot-studio .hs-libitem:hover .hs-libdel,
      .ow-headshot-studio .hs-libitem:focus-within .hs-libdel { opacity: 1; }
      @media (prefers-reduced-motion: reduce) { .ow-headshot-studio .hs-libdel { transition: none; } }`;
    document.head.appendChild(s);
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  // ── the reusable studio: mount the state machine into any container ─────────
  // opts.onSummary(text) — optional, for a host that shows a status chip (the casting card).
  function buildStudio(body, opts) {
    ensureCss();
    opts = opts || {};
    body.classList.add("ow-headshot-studio");

    const st = { file: null, fileUrl: null, candidates: [], selected: null, busy: false, library: [] };
    let _msg = "";
    let status = { present: false, finalized: false, mode: null };
    // J1-27: a singleton SR live region on <body> (survives render()'s innerHTML rebuilds) so
    // portrait status — "Generating 3 studio options…", "Upload failed", "photo service offline" —
    // is announced to screen readers, not just shown visually in the rebuilt .hs-msg nodes.
    let _live = document.getElementById("hs-live-region");
    if (!_live) {
      _live = document.createElement("div");
      _live.id = "hs-live-region";
      _live.setAttribute("role", "status");
      _live.setAttribute("aria-live", "polite");
      _live.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;";
      document.body.appendChild(_live);
    }
    const msg = (m) => { _msg = m || ""; try { _live.textContent = m || ""; } catch (_) {} };
    const setBusy = (b) => { st.busy = b; render(); };
    const summary = (t) => { try { opts.onSummary && opts.onSummary(t); } catch (_) {} };
    // L3: the host card must stay open while options/results are showing — generated
    // photos should never collapse out of view. The host passes this; Settings doesn't.
    const ensureOpen = () => { try { opts.ensureOpen && opts.ensureOpen(); } catch (_) {} };
    // L4: on the pre-game casting card, picking a headshot DISMISSES the picker and hands
    // off into the game (the host unmounts the card + opens the producers' first turn).
    // Returns true when the host took over, so we skip painting the "finalized" state that
    // would keep covering the logo. Settings → Account passes nothing and stays in place.
    const handoff = () => { try { return !!(opts.onFinalized && opts.onFinalized()); } catch (_) { return false; } };
    // OOBE re-sequence (2026-06-20): on the pre-game casting box ONLY, the photo is OPTIONAL — the
    // host wires onSkip to record {status:"skipped"} + resume the interview. Settings → Account
    // passes nothing, so no skip affordance renders there (the avatar is a real, kept choice there).
    const canSkip = typeof opts.onSkip === "function";
    const skip = () => { try { opts.onSkip && opts.onSkip(); } catch (_) {} };
    function avatarChanged() { try { window.dispatchEvent(new CustomEvent("orwell:avatarchanged")); } catch (_) {} }

    async function upload(mode) {
      if (!st.file) return false;
      setBusy(true);
      try {
        const fd = new FormData(); fd.append("file", st.file); fd.append("mode", mode);
        const r = await fetch("/api/orwell/portrait/intake", { method: "POST", credentials: "same-origin", body: fd });
        const d = r.ok ? await r.json() : null;
        st.busy = false;
        if (!d || !d.ok) { msg(d && d.error ? d.error : "That image couldn't be used — try another."); render(); return false; }
        return true;
      } catch (e) {
        if (window.OrwellReport) window.OrwellReport.fail("headshot", "upload", e);
        st.busy = false; msg("Upload failed — the photo service is offline."); render(); return false;
      }
    }

    async function useExact() {
      const ok = await upload("exact");
      if (ok) { avatarChanged(); st.candidates = []; st.selected = null; await refreshStatus(); }
    }

    async function studioGenerate() {
      if (st.file) { const ok = await upload("reference"); if (!ok) return; st.file = null; }
      setBusy(true); msg("Generating 3 studio options…");
      try {
        const r = await fetch("/api/orwell/portrait/studio/generate", { method: "POST", credentials: "same-origin" });
        const d = r.ok ? await r.json() : null;
        st.busy = false;
        if (d && d.generated > 0) { st.candidates = d.candidates; st.selected = null; msg("Pick your favorite — or generate 3 more."); ensureOpen(); }
        else { msg((d && d.reason) || "Couldn't generate options — check the image model in Settings."); }
      } catch (e) {
        if (window.OrwellReport) window.OrwellReport.fail("headshot", "studio", e);
        st.busy = false; msg("The photo service is offline right now.");
      }
      render();
    }

    async function finalizeSelected() {
      if (st.selected === null || st.selected === undefined) return;
      setBusy(true);
      try {
        const r = await fetch("/api/orwell/portrait/studio/finalize", {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ index: st.selected }) });
        const d = r.ok ? await r.json() : null;
        st.busy = false;
        if (d && d.ok) {
          avatarChanged(); st.candidates = []; st.selected = null;
          if (handoff()) return; // L4: picker dismissed, game taking over — don't repaint
          await refreshStatus();
        } else { msg("Couldn't set that option — try again."); render(); }
      } catch (e) { st.busy = false; msg("The photo service is offline right now."); render(); }
    }

    async function removeAll() {
      try { await fetch("/api/orwell/portrait/intake", { method: "DELETE", credentials: "same-origin" }); } catch (_) {}
      st.file = null; st.fileUrl = null; st.candidates = []; st.selected = null;
      avatarChanged(); msg("Removed."); await refreshStatus();
    }

    async function refreshStatus() {
      status = (await jget("/api/orwell/portrait/intake")) || status;
      const lib = await jget("/api/orwell/portrait/library");
      st.library = (lib && lib.headshots) || [];
      // G32: a generated-but-unpicked photoset must survive a refresh/new session. The
      // candidate images persist server-side (intake reports the count) — rebuild the picker
      // from that count so the options reappear, instead of dropping to the upload chooser.
      if (!status.finalized && (status.candidates || 0) > 0 && !st.candidates.length) {
        st.candidates = Array.from({ length: status.candidates },
          (_, i) => ({ index: i, ref: "/api/orwell/portrait/studio/candidate/" + i }));
        ensureOpen(); // L3: restored options reappear expanded, never tucked away
      }
      render();
    }

    // G30: pick a cached headshot — it becomes the current avatar + season portrait.
    async function selectFromLibrary(id) {
      setBusy(true);
      try {
        const r = await fetch("/api/orwell/portrait/library/select", {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
        st.busy = false;
        if (r.ok) {
          avatarChanged(); status.finalized = true;
          if (handoff()) return; // L4: picking a cached headshot hands off into the game too
          await refreshStatus();
        } else { msg("Couldn't use that one — try again."); render(); }
      } catch (e) { st.busy = false; msg("The photo service is offline right now."); render(); }
    }
    async function deleteFromLibrary(id) {
      try { await fetch("/api/orwell/portrait/library/" + encodeURIComponent(id), { method: "DELETE", credentials: "same-origin" }); } catch (_) {}
      await refreshStatus();
    }

    // The cached-headshots strip — shown above every state so a past portrait is always one tap away.
    function libraryHtml() {
      if (!st.library.length) return "";
      return `<div class="hs-lib"><div class="hs-msg" style="margin-bottom:6px">Your headshots — tap one to use it</div>
        <div class="hs-libstrip">${st.library.map((h) =>
          `<div class="hs-libitem${h.current ? " cur" : ""}">
             <button type="button" class="hs-libpick" data-pick="${esc(h.id)}" aria-pressed="${h.current ? "true" : "false"}" aria-label="${h.current ? "Current headshot" : "Use this saved headshot"}"><img src="${esc(h.ref)}" alt=""></button><button type="button" class="hs-libdel" data-del="${esc(h.id)}" title="Remove" aria-label="Remove headshot">×</button></div>`).join("")}</div></div>`;
    }
    function wireLibrary() {
      body.querySelectorAll("[data-pick]").forEach((d) => d.addEventListener("click", (e) => {
        if (e.target && e.target.closest("[data-del]")) return; // the × handles itself
        selectFromLibrary(d.dataset.pick);
      }));
      body.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", (e) => {
        e.stopPropagation(); deleteFromLibrary(b.dataset.del);
      }));
    }

    function render() {
      summary(status.finalized ? "set ✓" : (st.candidates.length ? "pick an option" : "make your portrait"));
      if (st.busy) { body.innerHTML = `<div class="hs-msg">${esc(_msg || "Working…")}</div>`; return; }
      const lib = libraryHtml();

      if (status.finalized) {
        // Auto-hand-off: if the gate ever renders an ALREADY-finalized headshot — set on this
        // device, set on another device/tab, or already set on a reload — dismiss the picker and
        // open the game, instead of leaving the "set" card stuck open over the chat. (A fresh set
        // via finalizeSelected/selectFromLibrary already hands off; this also covers the
        // mount/refresh-with-already-set path, which is what left it stuck.) In Settings → Account
        // no onFinalized is wired, so handoff() is a no-op and the set card stays put to manage it.
        if (handoff()) return;
        body.innerHTML = lib + `
          <div class="hs-row">
            <div class="hs-preview" style="background-image:url('/api/orwell/avatar?t=${Date.now()}')"></div>
            <div class="hs-opts"><div>Your headshot is set — it's your houseguest portrait and your profile pic.</div>
              <div class="hs-actions">
                <button type="button" class="hs-btn hs-btn-ghost" id="hs-redo">Make another</button>
                <button type="button" class="hs-btn hs-btn-ghost" id="hs-remove">Remove</button>
                <span class="hs-msg">${esc(_msg)}</span>
              </div></div></div>`;
        body.querySelector("#hs-redo").addEventListener("click", () => { status.finalized = false; render(); });
        body.querySelector("#hs-remove").addEventListener("click", removeAll);
        wireLibrary();
        return;
      }

      if (st.candidates.length) {
        body.innerHTML = lib + `
          <div>${esc(_msg || "Pick your favorite — or generate 3 more.")}</div>
          <div class="hs-grid">${st.candidates.map((c, _n) =>
            `<button type="button" class="hs-cand${st.selected === c.index ? " sel" : ""}" data-i="${c.index}" aria-pressed="${st.selected === c.index ? "true" : "false"}" aria-label="Portrait option ${_n + 1}"><img src="${esc(c.ref)}" alt=""></button>`).join("")}</div>
          <div class="hs-actions">
            <button type="button" class="hs-btn" id="hs-use" ${st.selected === null ? "disabled" : ""}>Use this one</button>
            <button type="button" class="hs-btn hs-btn-ghost" id="hs-more">Generate 3 more</button>
            <button type="button" class="hs-btn hs-btn-ghost" id="hs-new">Upload a different photo</button>
          </div>`;
        body.querySelectorAll(".hs-cand").forEach((d) => d.addEventListener("click", () => { st.selected = parseInt(d.dataset.i, 10); render(); }));
        body.querySelector("#hs-use").addEventListener("click", finalizeSelected);
        body.querySelector("#hs-more").addEventListener("click", studioGenerate);
        body.querySelector("#hs-new").addEventListener("click", () => { st.candidates = []; st.selected = null; st.file = null; render(); });
        wireLibrary();
        return;
      }

      const previewBg = st.fileUrl ? `style="background-image:url('${st.fileUrl}')"` : "";
      body.innerHTML = lib + `
        <div class="hs-msg" style="margin-bottom:8px">${st.library.length ? "…or make a new one from a photo of yourself." : "Make your houseguest's portrait — and your profile pic — from a photo of yourself."}</div>
        <div class="hs-row">
          <div class="hs-preview" ${previewBg}>${st.fileUrl ? "" : "👤"}</div>
          <div class="hs-opts">
            <label class="hs-btn hs-btn-ghost hs-filebtn" for="hs-file">${st.file ? "Choose a different photo" : "Choose a photo of yourself"}</label>
            <input type="file" id="hs-file" class="hs-file-native" accept="image/*" aria-label="Choose a photo of yourself">
            <div class="hs-actions">
              <button type="button" class="hs-btn" id="hs-studio" ${st.file ? "" : "disabled"}>Make AI studio portraits</button>
              <button type="button" class="hs-btn hs-btn-ghost" id="hs-exact" ${st.file ? "" : "disabled"}>Use photo as-is</button>
              ${canSkip ? `<button type="button" class="hs-btn hs-btn-ghost" id="hs-skip">Skip for now</button>` : ""}
            </div>
            <div class="hs-msg" id="hs-msg2">${esc(_msg)}</div>
          </div></div>`;
      const fi = body.querySelector("#hs-file");
      fi.addEventListener("change", () => {
        st.file = fi.files && fi.files[0];
        if (st.fileUrl) { try { URL.revokeObjectURL(st.fileUrl); } catch (_) {} }
        st.fileUrl = st.file ? URL.createObjectURL(st.file) : null;
        render();
      });
      body.querySelector("#hs-studio").addEventListener("click", studioGenerate);
      body.querySelector("#hs-exact").addEventListener("click", useExact);
      // OOBE re-sequence: the optional "Skip for now" — only on the pre-game casting box (onSkip set).
      const skipBtn = body.querySelector("#hs-skip");
      if (skipBtn) skipBtn.addEventListener("click", skip);
      wireLibrary();
    }

    refreshStatus();
    return { refresh: refreshStatus };
  }

  // expose the reusable studio for Settings → Account (G28)
  window.OrwellHeadshotStudio = { mount: buildStudio };

  // ── the pre-game casting WINDOW (composes the .ow-* kit) ─────────────────────
  // OOBE re-sequence (2026-06-20): the cast-photo box is a PROPER OrwellWindow that pops up
  // MID-interview, right after the producers ask about the photo (route() gates on
  // state.casting.missing including "castPhoto" + a rendered producer turn). It is OPTIONAL:
  // the player uploads/generates a photo OR clicks "Skip for now"; either way it records the
  // step, the box disappears, and the interview resumes. The chat is NOT locked behind it
  // (orwellChatGate.js no longer hard-locks for the photo). The window keeps no close/minimize
  // chrome (the in-body "Skip for now" + finalize are the two exits) and stays centered.
  const CAST_ICON =
    "<svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' " +
    "stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>" +
    "<path d='M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z'/>" +
    "<circle cx='12' cy='13' r='3.5'/></svg>";

  let _win = null; // the kit window instance (one at a time)

  function buildBody() {
    const body = document.createElement("div");
    // The ONE clear instruction — consolidated here, in the window. OOBE re-sequence: the photo
    // is OPTIONAL and the producers just asked about it, so the copy frames it as a quick,
    // skippable step rather than a hard prerequisite.
    const lead = document.createElement("p");
    lead.className = "hs-lead";
    lead.innerHTML =
      "<b>Your cast photo.</b> Upload a photo of yourself or generate one with AI — or skip " +
      "for now and add one later. Either way the interview picks right back up.";
    const studioHost = document.createElement("div");
    body.appendChild(lead);
    body.appendChild(studioHost);
    return { body, studioHost };
  }

  function mount() {
    if (_win || document.getElementById(ID)) return;
    if (!window.OrwellWindowKit || !window.OrwellWindowKit.create) return; // kit not ready → fail open
    ensureCss();
    const { body, studioHost } = buildBody();
    // L1: while the casting window is mounted, drop the welcome-screen's 30vh composer
    // lift so the composer docks normally (never hangs mid-screen) and the splash tips
    // are suppressed underneath. The flag is scoped to the game build in game-trim.css.
    try { document.body.classList.add("ow-casting-headshot-open"); } catch (_) {}
    // Compose the kit. No close/minimize chrome — the two EXITS are in the body (finalize a photo
    // or "Skip for now"), so there is no half-open dead state. It is a centered dialog-style box
    // (CSS pins it horizontally-centered), not draggable/resizable. The kit owns the chrome,
    // titlebar, focus, and the .ow-* family.
    _win = window.OrwellWindowKit.create({
      id: ID, title: "Your Cast Photo", icon: CAST_ICON,
      slot: "top-right", slotKey: "castphoto", role: "dialog",
      minimizable: false, closable: false, draggable: false, resizable: false,
      minWidth: 320, minHeight: 240,
      content: body, focus: true,
    });
    _win.open();
    // Mount the reusable studio into the window body.
    buildStudio(studioHost, {
      // No persistent "set ✓" chip in the casting window — the titlebar carries the title and the
      // window hands off on finalize/skip, so nothing lingers above the composer.
      onSummary: function () {},
      ensureOpen: function () {},        // a window is always "open" — nothing to expand
      onFinalized: onCastingHeadshotChosen, // record {uploaded} + resume the interview
      onSkip: onCastingPhotoSkipped,        // OOBE re-sequence: record {skipped} + resume (pre-game box only)
    });
  }

  // OOBE re-sequence (2026-06-20): the player finalized their cast photo MID-interview. The photo is
  // OPTIONAL and does NOT gate the chat or createCharacter — so this no longer "opens the game".
  // Instead: record the photo step with the engine (POST /api/orwell/casting/photo {status:"uploaded"}
  // — idempotent; a sibling lane builds the route), tear the box down, then fire the RESUME cue so
  // the producers acknowledge and continue the interview. Returns true so the studio stops
  // repainting its own "finalized" state behind the teardown.
  function onCastingHeadshotChosen() {
    teardownWindow();
    recordPhotoStep("uploaded");
    try {
      if (window._orwellResumeAfterPhoto) window._orwellResumeAfterPhoto();
    } catch (_) { /* fail open — the chat composer is still the way in */ }
    return true;
  }

  // Record the cast-photo step with the engine so it leaves state.casting.missing on every device.
  // Idempotent + fail-open: the photo is optional, so a failed POST must never wedge the interview —
  // the engine also drops "castPhoto" from `missing` once the portrait intake is finalized, so an
  // uploaded photo still clears even if this call hiccups. The resume cue fires regardless.
  function recordPhotoStep(status) {
    try {
      fetch("/api/orwell/casting/photo", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: status }),
      }).then(() => {
        // Nudge every surface to re-read state.casting (the box closes everywhere on the next route).
        try { if (window.orwellGameChanged) window.orwellGameChanged("casting-photo:" + status); } catch (_) {}
      }).catch(function () {});
    } catch (_) { /* fail open */ }
  }

  // OOBE re-sequence: the player chose to SKIP the cast photo. Same shape as the finalize path but
  // records {status:"skipped"} — the engine drops "castPhoto" from `missing`, so the box closes and
  // never re-prompts. Then resume the interview. (No portrait was set; the player can still add one
  // later via Settings → Account.)
  function onCastingPhotoSkipped() {
    teardownWindow();
    recordPhotoStep("skipped");
    try {
      if (window._orwellResumeAfterPhoto) window._orwellResumeAfterPhoto();
    } catch (_) { /* fail open */ }
    return true;
  }

  function teardownWindow() {
    if (_win) { try { _win.destroy(); } catch (_) {} _win = null; }
    const el = document.getElementById(ID);
    if (el) el.remove();
  }

  function unmount() {
    teardownWindow();
    try { document.body.classList.remove("ow-casting-headshot-open"); } catch (_) {}
  }

  // OOBE re-sequence (2026-06-20): is there a rendered producer turn yet? The photo box must follow
  // the producers' question, never precede it — so we only reveal it once an assistant turn is on
  // screen (chatRenderer uses .msg.msg-ai). Mirrors orwellOnboarding._conversationHasAssistantTurn.
  function _conversationHasAssistantTurn() {
    try {
      const hist = document.getElementById("chat-history");
      if (hist && hist.querySelector(".msg.msg-ai")) return true;
    } catch (_) {}
    return false;
  }

  // OOBE re-sequence: the box reveals MID-interview, so route() must be able to fire even when the
  // box is NOT yet mounted (the opener has to render first). This flag keeps the background poll
  // alive through the whole pre-game window (set true while pre-game, false once a season starts),
  // so the box pops the moment the producer turn lands even if no event reaches this tab.
  let _maybePregame = true;

  async function route() {
    const gameBuild = document.body && document.body.hasAttribute("data-game-build");
    if (!gameBuild) { _maybePregame = false; return; }
    const st = await jget("/api/orwell/state");
    // Track the pre-game window for the background poll: keep polling while pre-game (so a not-yet-
    // mounted box can still appear after the opener), stop once the game is underway. A null/
    // unreadable state keeps polling (fail toward checking again), but never blocks anything.
    _maybePregame = !(st && st.started === true);
    // OOBE re-sequence: the photo box is pre-game ONLY, and it is no longer the FIRST step / a hard
    // gate — it is a mid-interview, OPTIONAL box. Reveal it only when ALL hold:
    //   • pre-game (started === false), AND
    //   • the engine still wants the cast-photo step — state.casting.missing includes "castPhoto"
    //     (the engine is the authority; once the FE POSTs uploaded/skipped, the step leaves
    //     `missing` and every device closes the box), AND
    //   • a producer turn has already rendered (.msg.msg-ai) so the box FOLLOWS the producers'
    //     question and never auto-mounts at page load before the interview opens.
    // Anything else (started season, no casting object, castPhoto handled, no producer turn yet)
    // ⇒ the box is closed. Drive it from the SYNCED canonical state, not per-tab local state.
    if (!(st && st.started === false)) { unmount(); return; }
    const casting = st && st.casting;
    const missing = (casting && Array.isArray(casting.missing)) ? casting.missing : [];
    const photoWanted = missing.indexOf("castPhoto") !== -1;
    if (!photoWanted) {
      // The cast-photo step is handled (uploaded or skipped, here or on another device) — close the
      // box everywhere. Don't re-fire any cue: the resume cue fires once at finalize/skip time.
      unmount();
      return;
    }
    if (!_conversationHasAssistantTurn()) {
      // The producers haven't reached out yet — don't pop the box before the question. We'll
      // re-route on orwell:gamechanged (and the light poll) once the opener renders.
      unmount();
      return;
    }
    mount();
  }

  window.addEventListener("orwell:gamechanged", route);
  // 0064: a photo finalized on THIS or ANOTHER device flips intake.finalized — re-route so the gate
  // closes everywhere. `avatarchanged` fires locally on finalize; the cross-device path is the
  // canonical-session sync re-dispatching `orwell:gamechanged` on a `game-updated` ping, plus the
  // light poll below catches the case where no event reaches this tab.
  window.addEventListener("orwell:avatarchanged", route);
  // A bounded background re-check. It must do two jobs now: (1) close the box everywhere within a
  // few seconds when the photo step is handled on another device (the old job), AND (2) OPEN the box
  // once the producer turn renders during the pre-game interview, even if no event reaches this tab
  // (the new mid-interview reveal). So it re-routes while the box is mounted OR while we're still in
  // the pre-game window. Cheap state reads; a no-op once the season is underway (_maybePregame false).
  setInterval(function () {
    if (_win || document.getElementById(ID) || _maybePregame) { route(); }
  }, 4000);
  ready(route);
})();
