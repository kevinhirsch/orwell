// signinTransition.js — the macOS sign-in transition (phase b: the app reveal).
//
// THE EFFECT: on a SUCCESSFUL login the login screen fades to 0 and navigates
// here (phase a, login.html). On the app's FIRST reveal, the persistent surfaces
// slide in from their ADJACENT edges, macOS-style — the nav sidebar from the
// left, the gadget rail / dock from the right, the top conversation bar from the
// top, the composer from the bottom — and the chat/main content does a soft
// fade+scale-in. The four edges are subtly STAGGERED so it reads as the desktop
// assembling itself, not one block popping in.
//
// FIRST-MOUNT ONLY (the #752 stability rule). The entrance is a one-shot reveal,
// NOT a persistent-surface animation: it must NEVER replay on the 20-30s poll, an
// `orwell:gamechanged` refresh, or a reload-while-authed. That is guaranteed by
// construction:
//   • The trigger is `window.__orwellSigninEntrance`, captured + CONSUMED once in
//     index.html's head (it reads `ody-signin-transition` from sessionStorage and
//     removeItem()s it immediately). login.html only sets that flag on a genuine
//     sign-in, right before it navigates here.
//   • A reload-while-authed does NOT re-run login.html, so the flag is absent →
//     this module is an inert no-op.
//   • The animation is a pure CSS keyframe applied via a body class that is
//     REMOVED on animationend. It touches no persisted geometry and is decoupled
//     from the freshness poll / gamechanged dispatcher entirely.
//
// prefers-reduced-motion: NO slide. The surfaces are revealed instantly (the
// body class is never added; if motion is allowed mid-flight the media query in
// CSS also neutralises the transforms). Apple Liquid Glass accessibility rule.

const ENTRANCE_CLASS = 'signin-entrance';

function _prefersReducedMotion() {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  catch (_) { return false; }
}

/** True exactly once per login→app hand-off (the flag is consumed in the head). */
export function isSigninEntrance() {
  return typeof window !== 'undefined' && window.__orwellSigninEntrance === true;
}

let _played = false;

/** Play the macOS sign-in entrance — ONCE, and only when we arrived from a fresh
 *  login (isSigninEntrance()). Call this at the app-reveal seam (when the loader
 *  fades out). Idempotent: a second call is a no-op (defends against any double
 *  invocation). Fail-soft: any error leaves the app fully visible. */
export function playSigninEntrance() {
  try {
    if (_played) return;
    if (!isSigninEntrance()) return;        // not a fresh login → never animate
    _played = true;
    // Consume the global too, so even a stray re-import can't replay it.
    try { window.__orwellSigninEntrance = false; } catch (_) {}

    if (_prefersReducedMotion()) return;    // instant reveal — no slide (a11y)

    const body = document.body;
    if (!body) return;
    body.classList.add(ENTRANCE_CLASS);

    // Remove the class once the staggered keyframes finish so the surfaces fall
    // back to their normal (persisted-geometry) state — the animation leaves no
    // residue and can never re-trigger on a later restack/refresh. We listen for
    // the LAST surface's animationend, with a safety timeout in case a surface is
    // absent (e.g. the rail is hidden outside the game) and never fires.
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      body.classList.remove(ENTRANCE_CLASS);
    };
    // The longest stagger + duration in CSS is ~0.62s; give it headroom.
    const safety = setTimeout(finish, 1100);
    body.addEventListener('animationend', function onEnd(e) {
      // Only react to the entrance animations (names start with 'signin-').
      if (e.animationName && e.animationName.indexOf('signin-') === 0) {
        clearTimeout(safety);
        body.removeEventListener('animationend', onEnd);
        finish();
      }
    });
  } catch (_) { /* fail-soft: app stays fully visible */ }
}
