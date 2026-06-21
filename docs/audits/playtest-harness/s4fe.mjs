// State 4 — FE endgame SURFACE capture (retrospective window) + DOM Vault scan + edge probes.
// The engine sandbox (auditadmin) is FINISHED (fast-forwarded). Capture the rendered retrospective,
// scan its DOM for numeric/soul leaks, and probe: (a) FE /retrospective payload, (b) session rejoin
// (reload reconciles a finished game), (c) the desync the fast-forward created (test artifact — note it).
import { newCtx, BASE } from './rig.mjs';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
const HERE = new URL('.', import.meta.url).pathname, SHOTS = HERE + 'shots/s4/'; mkdirSync(SHOTS, { recursive: true });
const NUM_LEAK = /"(physical|mental|social|trust|affinity|threat|emotional|volatility|aptitude)"\s*:\s*-?\d/;
const b = await chromium.launch();
const ctx = await newCtx(b, 'desktop', { auth: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));

// (a) FE /retrospective payload — proves the FE projection is finished + Vault-free.
const api = await page.request.get(BASE + '/retrospective').catch(() => null);
let recap = null; if (api && api.ok()) recap = await api.json().catch(() => null);
const recapRaw = JSON.stringify(recap || {});
console.log('FE /retrospective: ok=' + (api && api.ok()) + ' finished=' + (recap && recap.finished) + ' winner=' + (recap && recap.winner && recap.winner.name));
console.log('  recap numeric-leak:', NUM_LEAK.test(recapRaw) ? 'LEAK ' + (recapRaw.match(NUM_LEAK) || [''])[0] : 'CLEAN');
console.log('  recap keys:', Object.keys(recap || {}).join(','));

await page.goto(BASE + '/', { waitUntil: 'load', timeout: 30000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(3500);
await page.evaluate(() => { const o = document.getElementById('orwell-onboarding'); if (o) o.remove(); document.querySelectorAll('[inert]').forEach(n => { try { n.inert = false; } catch (_) {} }); });
await page.waitForTimeout(2500);

// Is the retrospective surface present? (It renders when recap.finished.)
const retro = await page.evaluate(() => {
  const sel = ['#orwell-retrospective', '.orwell-retrospective', '[data-window=retrospective]', '[id*=retro i]', '[class*=retro i]'];
  for (const s of sel) { const el = document.querySelector(s); if (el && el.offsetParent !== null) return { sel: s, text: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 600) }; }
  // maybe minimized into the gadget rail / a launcher chip
  const chip = [...document.querySelectorAll('button,.ow-chip,[role=button]')].find(e => /retrospect|season recap|producer.?s vault|unseal/i.test(e.innerText || ''));
  return chip ? { sel: 'CHIP', text: (chip.innerText || '').slice(0, 120) } : null;
});
console.log('\nRetrospective surface:', retro ? (retro.sel + ' → ' + retro.text.slice(0, 160)) : 'NOT VISIBLE (may need finished-game reconcile)');

// Try to open the window/chip and screenshot.
await page.evaluate(() => {
  const chip = [...document.querySelectorAll('button,.ow-chip,[role=button]')].find(e => /retrospect|season recap|producer.?s vault|unseal/i.test(e.innerText || ''));
  if (chip) chip.click();
}).catch(() => {});
await page.waitForTimeout(1500);
// "Open the Producer's Vault" button to unseal.
await page.evaluate(() => {
  const v = [...document.querySelectorAll('button,[role=button]')].find(e => /producer.?s vault|unseal|open the vault/i.test(e.innerText || ''));
  if (v) v.click();
}).catch(() => {});
await page.waitForTimeout(2000);
await page.screenshot({ path: SHOTS + 'fe-retro.png', fullPage: true }).catch(() => {});

// DOM-wide Vault scan of whatever rendered.
const domLeak = await page.evaluate(() => {
  const txt = document.body.innerText || '';
  const re = /\b(trust|affinity|threat|physical|mental|social|volatility|aptitude)\s*[:=]\s*-?\d/i;
  const idLeak = /\bnpc:\d+\b/.test(txt);
  return { numeric: re.test(txt) ? (txt.match(re) || [''])[0] : null, npcId: idLeak };
});
console.log('Rendered-DOM scan: numeric=' + (domLeak.numeric || 'CLEAN') + ' npcId=' + domLeak.npcId);

// (b) Session rejoin — reload a finished game, confirm it still loads clean (no crash).
await page.reload({ waitUntil: 'load' }).catch(() => {});
await page.waitForTimeout(3500);
const afterReload = await page.evaluate(() => ({ hasChat: !!document.querySelector('#chat-history'), bodyLen: (document.body.innerText || '').length, err: !!document.querySelector('.fatal-error,.error-screen') }));
console.log('Session rejoin (reload finished game): hasChat=' + afterReload.hasChat + ' bodyLen=' + afterReload.bodyLen + ' errorScreen=' + afterReload.err);
console.log('JS errors:', errs.length, errs.slice(0, 3));
writeFileSync(SHOTS + 'fe.json', JSON.stringify({ recapFinished: recap && recap.finished, recapLeak: NUM_LEAK.test(recapRaw), retro, domLeak, afterReload, errs }, null, 2));
console.log('S4FE-DONE');
await b.close();
