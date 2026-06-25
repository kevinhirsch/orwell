// Orwell engine-status banner — VISIBLE error reporting when the game engine has a problem.
// The in-character "live feeds are down" chat line keeps players in the show, but the operator (and
// a confused player) needs an honest, out-of-character signal that something is actually broken. This
// is that signal: a top-of-viewport banner driven by /api/orwell/health with two severities:
//   • RED   — the engine is unreachable (connection refused / timeout / wrong URL);
//   • AMBER — the engine is up but a recent tool call FAILED (`lastError`: a technical problem like a
//     corrupt-save 500 or a failing action), naming the tool + reason so it's actionable.
// Fail-open (if its own fetch fails, it shows the warning), no deps beyond the notice kit.
//
// #642 (owner add-on): the banner is a first-class OrwellNotice kit consumer — a "system-notice"
// kind at the "top-banner" placement, so it shares the kit's chrome, ONE dismiss affordance (the
// 44px .on-dismiss), role/aria-live=alert semantics, reduced-motion-safe slide-in, and the
// body-inset compensation (now kit-owned: --on-banner-inset). It KEEPS its top-anchored,
// full-width placement (a global outage signal, not an above-composer affordance) and the
// dismissed-key behaviour (re-show only when the message changes; reset on healthy). The G8
// busy/creating hold + the reconnecting/holding variants are unchanged.
(function () {
  "use strict";

  const POLL_MS = 15000;
  const NOTICE_ID = "orwell-engine-status";
  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn, { once: true })
      : fn();

  let timer = null;
  let dismissedKey = null; // the exact message the user dismissed — reshow only if it changes
  let _notice = null;      // the OrwellNotice kit instance (lazily created on first show)

  // Lazily create the kit notice (top-banner system-notice). Fail-open: with the kit absent the
  // module simply does nothing (no banner) rather than throwing.
  function ensureNotice() {
    if (_notice) return _notice;
    if (!window.OrwellNoticeKit) return null;
    _notice = window.OrwellNoticeKit.create({
      id: NOTICE_ID,
      kind: "system-notice",
      placement: "top-banner",
      severity: "error",
      role: "alert",                 // preserve the assertive announcement
      title: "",
      // NOT dismissible: this is an honest outage signal, never a "wave it away" affordance. It
      // already auto-hides the moment the engine reports healthy (see hide()), so a manual × would
      // only let a confused player bury a real problem. The dismissed-key plumbing below is now
      // inert (nothing sets dismissedKey), kept only so show()/hide() read uniformly.
      dismissible: false,
      persistDismiss: false,
    });
    return _notice;
  }

  let _lastReason = "";

  function show(kind, title, reason) {
    if (dismissedKey && dismissedKey === reason) return; // already waved off this exact problem
    const n = ensureNotice();
    if (!n) return;
    _lastReason = reason;
    const severity = kind === "down" ? "error" : "warn";
    // #763: pass the icon EXPLICITLY through the kit's `icon` channel (a semantic key from the
    // kit's ONE monochrome set — never a glyph baked into the title). "down" reads as a hard
    // error, a "degraded"/reconnecting state as a warning — the same mono SVG family every other
    // notice/banner uses, so BOTH engine-status banners share ONE icon language (no colour-emoji
    // beside a mono symbol). The title strings stay glyph-free text. (Passing it explicitly rather
    // than leaning on the system-notice severity auto-derive makes the kit's `icon` slot the single,
    // legible source of the banner icon — consistent with the dock / #764 notice icons.)
    const icon = kind === "down" ? "error" : "warn";
    // Mount (idempotent) then re-skin in place — a state transition (down → reconnecting) reuses
    // the same element (no flicker) and re-measures the body inset for the new copy.
    n.show();
    n.update({ severity: severity, icon: icon, title: title, body: reason });
  }
  function hide() {
    dismissedKey = null; // healthy again — a future problem should always reshow
    if (_notice) _notice.hide();
  }

  // #764/#763: titles carry NO baked-in glyph anymore — the icon flows through the OrwellNotice
  // kit's dedicated `icon` channel (a monochrome SVG glyph rendered into .on-icon), so engine-status
  // shares ONE icon language with every other notice/banner (the old satellite/warning/clapperboard
  // emoji baked into the title string mixed colour emoji with the kit's mono symbols). #763 makes
  // that icon EXPLICIT (a semantic key per kind: error=down, warn=degraded) rather than implicit via
  // the system-notice severity auto-derive — the kit's `icon` slot is the single legible source.

  // G8: while createCharacter is in flight (health reports busy:"creating"), a slow or even
  // timed-out engine probe is casting being finalized — NOT an outage. Hold in-fiction (amber),
  // never the red "engine unavailable" banner.
  function showHolding() {
    show("degraded", "Production is building the house…", "Casting is being finalized — the live feeds return in a moment.");
  }

  // Issue 1: a brief, transient outage is being retried — show a SOFT amber "reconnecting…"
  // line (it recovers on its own) instead of the hard red "engine unavailable".
  function showReconnecting() {
    show("degraded", "Reconnecting to Big Brother…", "The live feeds blinked — restoring the connection.");
  }

  async function refresh() {
    try {
      const r = await fetch("/api/orwell/health", { credentials: "same-origin" });
      if (!r.ok) { show("down", "Big Brother engine unavailable.", "The app couldn't reach the game service. The show can't load until it's back."); return; }
      const d = await r.json();
      const busy = !!(d && d.busy === "creating"); // G8: createCharacter in flight
      const reconnecting = !!(d && d.reconnecting); // Issue 1: transient outage being retried
      if (!d || !d.engine) {
        if (busy) { showHolding(); return; } // a probe timeout DURING creation is not an outage
        if (reconnecting) { showReconnecting(); return; } // a momentary blip — recovering, not down
        const reason = (d && d.error ? "Reason: " + d.error + " " : "") + (d && d.engineUrl ? "(" + d.engineUrl + ") " : "");
        show("down", "Big Brother engine unavailable.", reason + "The show can't load until it's back.");
      } else if (d.lastError && d.lastError.error) {
        if (busy) { showHolding(); return; } // mid-creation hiccups hold in-fiction too
        // Engine reachable, but a recent call failed — a technical problem worth reporting honestly.
        const le = d.lastError;
        show("degraded", "Big Brother engine reported a problem.", (le.tool ? le.tool + ": " : "") + le.error);
      } else {
        hide();
      }
    } catch (_) {
      // The FE route itself failed — surface the most likely truth rather than going silent.
      if (window.OrwellReport) window.OrwellReport.fail("engine-status", "health-fetch", _); // G11: fail open, never silent
      show("down", "Big Brother engine unavailable.", "The app couldn't reach the game service.");
    }
  }

  function start() {
    refresh();
    if (timer) clearInterval(timer);
    timer = setInterval(refresh, POLL_MS);
  }

  window.orwellRefreshEngineStatus = refresh;
  window.addEventListener("orwell:gamechanged", refresh);
  ready(start);
})();
