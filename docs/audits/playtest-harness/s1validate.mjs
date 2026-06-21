// State 1 — post-fix validation re-capture (S1-2 avatar 204, S1-A remember row, S1-B version, S1-C FOUC).
import { launch, captureSurface } from './rig.mjs';
const b = await launch();
try {
  for (const device of ['desktop', 'mobile']) {
    await captureSurface(b, { name: 's1v-login', device, path: '/login', auth: false, video: false, settle: 1100 });
  }
  // S1-2: landing net log must no longer contain a /avatar 404 (204 is <400 → absent from the >=400 net log).
  await captureSurface(b, { name: 's1v-landing', device: 'desktop', path: '/', auth: true, video: false, settle: 1800 });
  // S1-C: narrow landing with high-fps video → check f-001 luminance is now DARK (was 255 white).
  await captureSurface(b, { name: 's1v-landing', device: 'narrow', path: '/', auth: true, video: true, fps: 12, recordMs: 1200, settle: 1400 });
} finally { await b.close(); }
console.log('S1V DONE');
