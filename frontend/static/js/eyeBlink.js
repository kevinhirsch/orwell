// eyeBlink.js — the ONE shared blink mechanism for the Orwell hero eye (#801).
//
// Wherever the watching eye appears — the in-app welcome/threshold hero AND the
// login page hero — its eyelid should blink on a randomized ~7-10s cadence: a
// quick natural blink (fast close→open), slightly randomized so it's never
// metronomic, with an occasional double-blink for realism / creepiness.
//
// DRY: this module + eyeBlink.css are the single mechanism both heroes use. The
// CSS owns the LOOK of one blink (the lid sweep keyframes); this JS owns the
// RHYTHM (when, single vs double). An author marks the lid element with
// [data-eye-lid] (inside an .eye-blink-wrap) and calls startEyeBlink(lid) — or
// just autoBlinkAll(), which finds every [data-eye-lid] on the page.
//
// prefers-reduced-motion: NO blink is ever scheduled (and the CSS hard-freezes
// the lid open too) — never a seizure risk.

const MIN_MS = 7000;   // shortest gap between blinks  (~7s)
const MAX_MS = 10000;  // longest gap between blinks   (~10s)
const DOUBLE_BLINK_CHANCE = 0.22;  // ~1 in 5 blinks is a double

export const BLINK_MIN_MS = MIN_MS;
export const BLINK_MAX_MS = MAX_MS;

function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch (_) { return false; }
}

function _randDelay() {
  return MIN_MS + Math.random() * (MAX_MS - MIN_MS);
}

// Start the randomized blink loop on a single lid element. Returns a stop()
// handle. Idempotent per element (a second call is a no-op while one is live).
export function startEyeBlink(lid, opts = {}) {
  if (!lid || lid._eyeBlinkActive) return () => {};
  if (prefersReducedMotion()) return () => {};

  lid._eyeBlinkActive = true;
  const minMs = Number(opts.minMs) || MIN_MS;
  const maxMs = Number(opts.maxMs) || MAX_MS;
  const doubleChance = opts.doubleChance == null ? DOUBLE_BLINK_CHANCE : opts.doubleChance;
  let timer = 0;
  let stopped = false;

  function blinkOnce() {
    if (stopped) return;
    const isDouble = Math.random() < doubleChance;
    const cls = isDouble ? 'eye-blinking-double' : 'eye-blinking';
    // Restart the one-shot animation cleanly each time.
    lid.classList.remove('eye-blinking', 'eye-blinking-double');
    // force reflow so re-adding the class re-triggers the keyframe
    void lid.offsetWidth;
    lid.classList.add(cls);
    const clear = () => lid.classList.remove(cls);
    lid.addEventListener('animationend', clear, { once: true });
    schedule();
  }

  function schedule() {
    if (stopped) return;
    const delay = minMs + Math.random() * (maxMs - minMs);
    timer = window.setTimeout(blinkOnce, delay);
  }

  schedule();

  return function stop() {
    stopped = true;
    lid._eyeBlinkActive = false;
    if (timer) window.clearTimeout(timer);
    lid.classList.remove('eye-blinking', 'eye-blinking-double');
  };
}

// Find every lid on the page and start blinking it. Safe to call repeatedly
// (e.g. after the hero re-renders) — already-running lids are skipped.
export function autoBlinkAll(root = document) {
  const lids = root.querySelectorAll('[data-eye-lid]');
  const stops = [];
  lids.forEach((lid) => stops.push(startEyeBlink(lid)));
  return () => stops.forEach((s) => s());
}

// Auto-init on load so a plain <script type="module" src=".../eyeBlink.js">
// "just works" for either hero. Re-scan once more shortly after, in case the
// hero mounts a tick later (the welcome hero can re-render its wordmark).
if (typeof window !== 'undefined') {
  const boot = () => {
    autoBlinkAll();
    window.setTimeout(() => autoBlinkAll(), 1200);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
  // Re-scan when the in-app welcome wordmark re-renders (it swaps its innerHTML
  // for incognito/name changes, which can replace the lid element).
  window.addEventListener('orwell:welcome-rerendered', () => autoBlinkAll());
  window.OrwellEyeBlink = { startEyeBlink, autoBlinkAll, BLINK_MIN_MS, BLINK_MAX_MS };
}
