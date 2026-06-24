// Orwell account avatar (feature G27) — paints the user's finalized casting headshot into the
// little circle profile pic(s): the sidebar user bar (#user-bar-avatar) and the Settings
// account card (#settings-account-avatar). When no avatar image exists we paint an INTENTIONAL
// default: the app's initial-letter (if app.js has set one) shows through, otherwise an
// Apple-style monochrome person glyph (#760). It updates the moment a headshot is finalized,
// via the `orwell:avatarchanged` event. Fail-open, Vault-safe (reads only the user's own
// /api/orwell/avatar).
(function () {
  "use strict";

  const TARGETS = ["user-bar-avatar", "settings-account-avatar"];

  // Apple-style monochrome person glyph (SF-symbol "person.fill" silhouette), inline so the
  // empty circle never reads as a broken image. currentColor → inherits the circle's --fg ink;
  // a soft opacity keeps it a quiet, intentional placeholder rather than a hard mark.
  const PERSON_GLYPH =
    '<svg class="ow-avatar-glyph" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">' +
    '<circle cx="12" cy="8.2" r="4"/>' +
    '<path d="M12 14c-4.2 0-7.5 2.4-7.5 5.6 0 .8.6 1.4 1.4 1.4h12.2c.8 0 1.4-.6 1.4-1.4 0-3.2-3.3-5.6-7.5-5.6z"/>' +
    "</svg>";

  function ensureCss() {
    if (document.getElementById("orwell-avatar-css")) return;
    const s = document.createElement("style");
    s.id = "orwell-avatar-css";
    // .ow-has-avatar: a finalized headshot fills the circle (hide any glyph/initial via font-size:0).
    // .ow-avatar-glyph: the monochrome default — centered, fills the circle, quiet opacity.
    s.textContent =
      ".user-bar-avatar.ow-has-avatar,.ow-has-avatar{background-size:cover;background-position:center;font-size:0}" +
      ".ow-has-avatar .ow-avatar-glyph{display:none}" +
      ".ow-avatar-glyph{width:62%;height:62%;display:block;opacity:0.55;color:var(--fg)}";
    document.head.appendChild(s);
  }

  // Does the circle already carry a real initial letter (painted by app.js)?
  function hasInitial(el) {
    const t = (el.textContent || "").trim();
    return t.length > 0;
  }

  // Paint the no-headshot default: keep the initial if present, else inject the person glyph.
  function applyDefault(el) {
    el.style.backgroundImage = "";
    el.classList.remove("ow-has-avatar");
    if (hasInitial(el)) {
      // app.js set an initial letter — let it show; ensure no stale glyph lingers.
      const g = el.querySelector(".ow-avatar-glyph");
      if (g) g.remove();
      return;
    }
    if (!el.querySelector(".ow-avatar-glyph")) el.innerHTML = PERSON_GLYPH;
  }

  async function apply() {
    let present = false;
    try {
      const r = await fetch("/api/orwell/avatar", { credentials: "same-origin", cache: "no-store" });
      // 200 = an avatar PNG is present; 204 = none set (S1-2). Treat only a real
      // 200 as present so the no-avatar case stays a clean no-op.
      present = r.status === 200;
    } catch (_) { present = false; }
    const url = present ? "/api/orwell/avatar?t=" + Date.now() : null;
    TARGETS.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (url) {
        const g = el.querySelector(".ow-avatar-glyph");
        if (g) g.remove();
        el.style.backgroundImage = `url("${url}")`;
        el.classList.add("ow-has-avatar");
      } else {
        applyDefault(el);
      }
    });
  }

  window.OrwellAvatar = { refresh: apply };
  // A finalized headshot dispatches this — the circle updates immediately.
  window.addEventListener("orwell:avatarchanged", apply);

  const boot = () => { ensureCss(); apply(); setTimeout(apply, 1200); }; // re-apply after app.js paints the initial
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
