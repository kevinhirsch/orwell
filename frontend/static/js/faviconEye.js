// faviconEye.js — the SINGLE owner of the <link rel="icon"> href (issue: blinking favicon).
//
// The surveillance eye blinks in the browser tab, in lockstep with the on-screen
// hero/login eye. Browsers won't ANIMATE an SVG/GIF favicon, so we blink by
// swapping the icon href between an open-eye SVG (outline + pupil) and a
// closed-lid SVG (filled almond) for ~120ms per blink, on the SHARED eyeBlink.js
// cadence (randomized ~7-10s + occasional double-blink).
//
// THE CRUX — one controller, no fighting mutators. The favicon link historically
// had TWO independent writers: the accent-color updater (index.html head ~:76)
// and the per-route swap (index.html head ~:219). Each wrote `href` directly, so
// a blink would fight accent/route and vice-versa. This module becomes the SINGLE
// writer: it holds the current { accent, route, blinkState } and renders the href
// from all three. The accent/route updaters now set STATE here instead of writing
// href — so the blink never clobbers accent/route and accent/route never clobber
// the blink.
//
// Because the accent + route updaters are INLINE head scripts that run before this
// module loads, they stash their intent on window.__orwellFaviconState (a plain
// object) AND call the setters if we're already up. On init we adopt whatever they
// stashed. Fail-soft throughout: any error just leaves the static favicon alone.
//
// prefers-reduced-motion: never schedule a blink (eye holds its stare).
// document.hidden: pause blinking while the tab is backgrounded (no wasted timers).

import { BLINK_MIN_MS, BLINK_MAX_MS } from './eyeBlink.js';

const DEFAULT_ACCENT = '#e06c75';
const DOUBLE_BLINK_CHANCE = 0.22; // mirror eyeBlink.js: ~1 in 5 is a double
const BLINK_CLOSED_MS = 120;      // how long the lid stays shut per close
const DOUBLE_GAP_MS = 110;        // gap between the two closes of a double-blink

// The open eye: outline almond + filled pupil. Mirrors the default favicon
// (index.html :6) and the hero .welcome-eye open path (index.html ~:1157).
function openEyeSvg(ac) {
  return "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>" +
    "<path d='M2 16Q9 7 16 7Q23 7 30 16Q23 25 16 25Q9 25 2 16Z' fill='none' stroke='" + ac + "' stroke-width='2.5' stroke-linejoin='round'/>" +
    "<circle cx='16' cy='16' r='4.5' fill='" + ac + "'/>" +
    "</svg>";
}

// The closed lid: the same almond, FILLED — the hero .welcome-eye-lid path
// (index.html ~:1157). At 16px this reads as a shut eye.
function closedEyeSvg(ac) {
  return "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>" +
    "<path d='M2 16Q9 7 16 7Q23 7 30 16Q23 25 16 25Q9 25 2 16Z' fill='" + ac + "' stroke='" + ac + "' stroke-width='2.5' stroke-linejoin='round'/>" +
    "</svg>";
}

function dataUri(svg) {
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch (_) { return false; }
}

// The controller. Owns the link href and the { accent, route, blinkState }.
const controller = (function () {
  let accent = DEFAULT_ACCENT;
  // route holds optional non-eye route SVG inner markup (calendar/notes/…). When
  // set, the favicon is that route glyph and we do NOT blink (it isn't an eye).
  let routeInner = null;
  let routeIsEye = true;
  let closed = false; // blinkState: true while the lid is shut

  let blinkTimer = 0;
  let closeTimer = 0;
  let started = false;
  let stopped = false;

  function linkEl() {
    let fav = document.querySelector("link[rel='icon']");
    if (!fav) {
      fav = document.createElement('link');
      fav.rel = 'icon';
      fav.type = 'image/svg+xml';
      (document.head || document.documentElement).appendChild(fav);
    }
    return fav;
  }

  // Render the href from the FULL current state. The ONLY place href is written.
  function render() {
    try {
      const fav = linkEl();
      if (routeInner && !routeIsEye) {
        // A non-eye route glyph owns the favicon; no blink applies.
        fav.href = dataUri("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>" + routeInner + "</svg>");
        return;
      }
      fav.href = dataUri(closed ? closedEyeSvg(accent) : openEyeSvg(accent));
    } catch (_) { /* fail-soft: leave the static favicon */ }
  }

  function setAccent(ac) {
    if (!ac) return;
    accent = ac;
    render();
  }

  // The per-route updater calls this. `inner` null/undefined => the eye (root
  // path), which blinks. A non-null inner is a route glyph (no blink).
  function setRoute(inner, isEye) {
    routeInner = inner || null;
    routeIsEye = isEye !== false ? !routeInner : false;
    // When inner is null we are on the eye route; resume blinking eligibility.
    if (!routeInner) routeIsEye = true;
    render();
    reschedule();
  }

  function setBlink(isClosed) {
    closed = !!isClosed;
    render();
  }

  function canBlink() {
    return routeIsEye && !routeInner && !prefersReducedMotion() && !documentHidden();
  }

  function documentHidden() {
    try { return document.hidden === true; } catch (_) { return false; }
  }

  function clearTimers() {
    if (blinkTimer) { window.clearTimeout(blinkTimer); blinkTimer = 0; }
    if (closeTimer) { window.clearTimeout(closeTimer); closeTimer = 0; }
  }

  // One blink: close → (after BLINK_CLOSED_MS) open. A double-blink does it twice.
  function blinkOnce() {
    if (stopped || !canBlink()) { setBlink(false); return; }
    const isDouble = Math.random() < DOUBLE_BLINK_CHANCE;
    setBlink(true);
    closeTimer = window.setTimeout(() => {
      setBlink(false);
      if (isDouble && canBlink()) {
        closeTimer = window.setTimeout(() => {
          if (!canBlink()) { setBlink(false); return; }
          setBlink(true);
          closeTimer = window.setTimeout(() => setBlink(false), BLINK_CLOSED_MS);
        }, DOUBLE_GAP_MS);
      }
    }, BLINK_CLOSED_MS);
    schedule();
  }

  function schedule() {
    if (stopped) return;
    const delay = BLINK_MIN_MS + Math.random() * (BLINK_MAX_MS - BLINK_MIN_MS);
    blinkTimer = window.setTimeout(blinkOnce, delay);
  }

  // (Re)evaluate whether we should be blinking — used on visibility/route change.
  function reschedule() {
    clearTimers();
    setBlink(false);
    if (!stopped && canBlink()) schedule();
  }

  function start() {
    if (started) return;
    started = true;
    stopped = false;
    // Adopt any state the inline head updaters stashed before we loaded.
    try {
      const pre = window.__orwellFaviconState;
      if (pre) {
        if (pre.accent) accent = pre.accent;
        if (pre.routeInner != null) { routeInner = pre.routeInner; routeIsEye = false; }
      }
    } catch (_) {}
    render();
    // Pause/resume on tab visibility — no wasted timers when backgrounded.
    try {
      document.addEventListener('visibilitychange', reschedule);
    } catch (_) {}
    // Reduced-motion can change at runtime; re-evaluate if so.
    try {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      const onChange = () => reschedule();
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    } catch (_) {}
    reschedule();
  }

  function stop() {
    stopped = true;
    clearTimers();
    setBlink(false);
  }

  return { setAccent, setRoute, setBlink, start, stop,
    // test/inspection helpers (no behavior)
    _state: () => ({ accent, routeInner, routeIsEye, closed }) };
})();

// Publish early so the inline head updaters (which run before this module) can
// route through us. They already stash to window.__orwellFaviconState as a
// fallback; if we're up, they call these directly.
if (typeof window !== 'undefined') {
  window.OrwellFaviconEye = controller;
}

// Boot.
function boot() { controller.start(); }
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}

export default controller;
export { openEyeSvg, closedEyeSvg };
