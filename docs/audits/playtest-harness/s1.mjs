// State 1 — Initial Instantiation driver: login, zero-data landing, two-window parity.
// (Settings tabs handled in a second pass once selectors are confirmed from the DOM dump.)
import { launch, captureSurface, twoWindowParity } from './rig.mjs';

const b = await launch();
try {
  // 1) Login (unauthenticated) — desktop + mobile, video to catch the password clear-glyph (S1-4) + any transient.
  for (const device of ['desktop', 'mobile']) {
    await captureSurface(b, { name: 's1-login', device, path: '/login', auth: false, video: true, recordMs: 1500, settle: 1200 });
  }
  // 2) Zero-data landing (authed; fresh engine => no active game => onboarding overlay) — matrix incl. 320px reflow.
  for (const device of ['desktop', 'mobile', 'narrow']) {
    await captureSurface(b, { name: 's1-landing', device, path: '/', auth: true, video: true, recordMs: 2800, settle: 2000 });
  }
  // 3) Two-window SAME-identity parity on the landing — the garbage-hunt floor (must be frame+log identical).
  await twoWindowParity(b, { name: 's1-landing-parity', device: 'desktop', path: '/', identity: 'same', settle: 2000, recordMs: 1500 });
  await twoWindowParity(b, { name: 's1-landing-parity', device: 'mobile', path: '/', identity: 'same', settle: 2000, recordMs: 1500 });
} finally {
  await b.close();
}
console.log('STATE1A DONE');
