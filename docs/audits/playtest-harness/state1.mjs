// State 1 — initial instantiation / zero-data landing (engine up, no game).
import { launch, capture } from './lib.mjs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:7000';
const browser = await launch();
try {
  // The landing: chat shell with the onboarding overlay auto-mounting.
  // Generous settle — the module graph + onboarding route() probe take a beat.
  await capture(browser, { name: 'state1-landing', base: BASE, path: '/', settle: 5000 });
} finally {
  await browser.close();
}
console.log('state1 done');
