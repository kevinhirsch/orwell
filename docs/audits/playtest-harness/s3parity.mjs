// State 3 (concurrency) — two-window SAME-identity parity on the LIVE game.
// CP1: both tabs load the same game -> engine truth + HUD + chat must be identical.
// CP2: drive ONE chat turn in tab A -> tab B must sync (SSE/beatSeq) with no garbage.
import { newCtx, engineSnapshot, BASE } from './rig.mjs';
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
const HERE = new URL('.', import.meta.url).pathname;
const SHOTS = HERE + 'shots/s3par/'; mkdirSync(SHOTS, { recursive: true });

function pub(snap) {
  const s = snap.status || {}, g = snap.state || {};
  return { started: g.started, moment: g.moment, week: g.week, beatSeq: g.beatSeq, houseCount: (g.house || []).length,
    phase: s.phase, hoh: (s.hoh && s.hoh.name) || s.hoh || null, noms: (s.nominees || []).map(x => x.name), pending: (s.pending && s.pending.kind) || null };
}
async function hud(page) {
  return page.evaluate(() => {
    const sel = '#orwell-status-panel, [class*="status-panel"], [class*="gadget-rail"], [class*="orwell-cast"]';
    const rail = [...document.querySelectorAll(sel)].map(e => (e.innerText || '').replace(/\s+/g, ' ').trim()).join(' || ').slice(0, 600);
    const msgs = document.querySelectorAll('#chat-history .msg').length;
    const lastAi = (() => { const e = document.querySelectorAll('#chat-history .msg-ai'); const el = e[e.length - 1]; if (!el) return null; const c = el.cloneNode(true); c.querySelectorAll('.thinking-content,.thinking,[class*=thinking],.msg-footer').forEach(n => n.remove()); return (c.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160); })();
    return { rail, msgs, lastAi, body: (document.body.innerText || '').replace(/\s+/g, ' ').trim(),
      mutations: (window.__audit && window.__audit.log || []).length, jsErrors: (window.__audit && window.__audit.errors || []).slice(0, 6) };
  });
}
function firstDiff(a, b) { if (a === b) return null; let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return { at: i, a: a.slice(Math.max(0, i - 25), i + 45), b: b.slice(Math.max(0, i - 25), i + 45) }; }
async function send(page, text) { await page.fill('#message', text); await page.waitForTimeout(300); const m = await page.evaluate(() => document.querySelector('.send-btn')?.getAttribute('data-mode')); if (m === 'send') await page.click('.send-btn').catch(() => {}); else await page.keyboard.press('Enter'); }
async function waitDone(page, t = 180000) {
  const t0 = Date.now(); let last = -1, stable = 0;
  while (Date.now() - t0 < t) {
    await page.waitForTimeout(1500);
    const info = await page.evaluate(() => { const e = document.querySelectorAll('#chat-history .msg-ai'); const el = e[e.length - 1]; if (!el) return { len: 0, done: false, ph: true }; const c = el.cloneNode(true); c.querySelectorAll('.thinking-content,.thinking,[class*=thinking],.msg-footer').forEach(n => n.remove()); const txt = (c.innerText || '').trim(); return { len: txt.length, done: !!el.querySelector('.msg-footer'), ph: /^(thinking|still|generating)/i.test(txt) || txt.length < 8 }; });
    if (info.done && !info.ph) { await page.waitForTimeout(800); return; }
    if (!info.ph && info.len > 40 && info.len === last) { if (++stable >= 6) return; } else stable = 0;
    last = info.len;
  }
}

const b = await chromium.launch();
async function win() {
  const ctx = await newCtx(b, 'desktop', { video: false, auth: true });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'load', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3500);
  await page.evaluate(() => { const o = document.getElementById('orwell-onboarding'); if (o) o.remove(); document.querySelectorAll('[inert]').forEach(n => { try { n.inert = false; } catch (_) {} }); });
  await page.waitForTimeout(800);
  return { ctx, page };
}
const A = await win(); const B = await win();

// CP1 — both loaded, same identity.
const [eA1, eB1] = [pub(await engineSnapshot(A.ctx)), pub(await engineSnapshot(B.ctx))];
const [hA1, hB1] = [await hud(A.page), await hud(B.page)];
await A.page.screenshot({ path: SHOTS + 'cp1-A.png', fullPage: true }); await B.page.screenshot({ path: SHOTS + 'cp1-B.png', fullPage: true });
const cp1 = { engineMatch: JSON.stringify(eA1) === JSON.stringify(eB1), eA: eA1, eB: eB1, railMatch: hA1.rail === hB1.rail, msgsA: hA1.msgs, msgsB: hB1.msgs, bodyIdentical: hA1.body === hB1.body, bodyDiff: firstDiff(hA1.body, hB1.body), jsErrA: hA1.jsErrors, jsErrB: hB1.jsErrors };
console.log('CP1 same-identity:', JSON.stringify({ engineMatch: cp1.engineMatch, railMatch: cp1.railMatch, msgsA: cp1.msgsA, msgsB: cp1.msgsB, bodyIdentical: cp1.bodyIdentical, diff: cp1.bodyDiff }));

// MUTATE in A, observe B (cross-tab SSE/beatSeq propagation).
await send(A.page, "(Just taking in the premiere — who's actually in the room right now? Want a read before anything starts.)");
await A.page.waitForTimeout(2000);
await waitDone(A.page);
await B.page.waitForTimeout(8000); // let SSE push + B's poll settle

const [eA2, eB2] = [pub(await engineSnapshot(A.ctx)), pub(await engineSnapshot(B.ctx))];
const [hA2, hB2] = [await hud(A.page), await hud(B.page)];
await A.page.screenshot({ path: SHOTS + 'cp2-A.png', fullPage: true }); await B.page.screenshot({ path: SHOTS + 'cp2-B.png', fullPage: true });
const cp2 = { engineMatch: JSON.stringify(eA2) === JSON.stringify(eB2), eA: eA2, eB: eB2,
  msgsA: hA2.msgs, msgsB: hB2.msgs, chatSynced: hA2.msgs === hB2.msgs, aLastAi: hA2.lastAi, bLastAi: hB2.lastAi,
  bSyncedLast: hA2.lastAi === hB2.lastAi, bMutations: hB2.mutations, bJsErr: hB2.jsErrors };
console.log('CP2 after turn in A:', JSON.stringify({ engineMatch: cp2.engineMatch, msgsA: cp2.msgsA, msgsB: cp2.msgsB, chatSynced: cp2.chatSynced, bSyncedLast: cp2.bSyncedLast, beatA: eA2.beatSeq, beatB: eB2.beatSeq, bJsErr: cp2.bJsErr }));
writeFileSync(SHOTS + 'parity.json', JSON.stringify({ cp1, cp2 }, null, 2));
await A.ctx.close(); await B.ctx.close(); await b.close();
console.log('S3PARITY DONE');
