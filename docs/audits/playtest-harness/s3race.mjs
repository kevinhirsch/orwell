// State 3 (concurrency) — CONCURRENT-WRITE race: two tabs on the SAME game send turns at once.
// Stress-tests the per-user serialization (HttpMcpServer.enqueue) + beatSeq/409 stale-guard.
// Looks for: 409 stale-beat reconciles, lost updates, divergence, render garbage. Both must converge.
import { newCtx, engineSnapshot, BASE } from './rig.mjs';
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
const HERE = new URL('.', import.meta.url).pathname;
const SHOTS = HERE + 'shots/s3race/'; mkdirSync(SHOTS, { recursive: true });
function pub(s) { const g = s.state || {}, st = s.status || {}; return { started: g.started, moment: g.moment, week: g.week, beatSeq: g.beatSeq, houseCount: (g.house || []).length, phase: st.phase, hoh: (st.hoh && st.hoh.name) || st.hoh || null, pending: (st.pending && st.pending.kind) || null }; }
async function send(page, text) { await page.fill('#message', text); await page.waitForTimeout(200); const m = await page.evaluate(() => document.querySelector('.send-btn')?.getAttribute('data-mode')); if (m === 'send') await page.click('.send-btn').catch(() => {}); else await page.keyboard.press('Enter'); }
async function waitDone(page, t = 200000) { const t0 = Date.now(); let last = -1, stable = 0; while (Date.now() - t0 < t) { await page.waitForTimeout(1500); const info = await page.evaluate(() => { const e = document.querySelectorAll('#chat-history .msg-ai'); const el = e[e.length - 1]; if (!el) return { len: 0, done: false, ph: true }; const c = el.cloneNode(true); c.querySelectorAll('.thinking-content,.thinking,[class*=thinking],.msg-footer').forEach(n => n.remove()); const txt = (c.innerText || '').trim(); return { len: txt.length, done: !!el.querySelector('.msg-footer'), ph: /^(thinking|still|generating)/i.test(txt) || txt.length < 8 }; }); if (info.done && !info.ph) { await page.waitForTimeout(800); return; } if (!info.ph && info.len > 40 && info.len === last) { if (++stable >= 6) return; } else stable = 0; last = info.len; } }
async function hud(page) { return page.evaluate(() => { const msgs = document.querySelectorAll('#chat-history .msg').length; const body = (document.body.innerText || '').replace(/\s+/g, ' ').trim(); const lastAi = (() => { const e = document.querySelectorAll('#chat-history .msg-ai'); const el = e[e.length - 1]; if (!el) return null; const c = el.cloneNode(true); c.querySelectorAll('.thinking-content,.thinking,[class*=thinking],.msg-footer').forEach(n => n.remove()); return (c.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 140); })(); return { msgs, lastAi, body, jsErrors: (window.__audit && window.__audit.errors || []).slice(0, 6) }; }); }

const b = await chromium.launch();
const net = { A: [], B: [] };
async function win(tag) {
  const ctx = await newCtx(b, 'desktop', { auth: true });
  const page = await ctx.newPage();
  page.on('response', r => { const s = r.status(); if (s === 409 || s >= 400) net[tag].push({ status: s, url: r.url().split('7000')[1] || r.url(), body: '' }); });
  await page.goto(BASE + '/', { waitUntil: 'load', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3500);
  await page.evaluate(() => { const o = document.getElementById('orwell-onboarding'); if (o) o.remove(); document.querySelectorAll('[inert]').forEach(n => { try { n.inert = false; } catch (_) {} }); });
  await page.waitForTimeout(600);
  return { ctx, page };
}
const A = await win('A'); const B = await win('B');
const base = { A: pub(await engineSnapshot(A.ctx)), B: pub(await engineSnapshot(B.ctx)) };
console.log('BASELINE:', JSON.stringify(base));

// CONCURRENT writes — fire both sends essentially simultaneously.
await Promise.all([
  send(A.page, "(I head into the kitchen to introduce myself to whoever's in there.)"),
  send(B.page, "(I post up in the living room and just watch the house for a minute.)"),
]);
console.log('both sends fired');
await Promise.all([waitDone(A.page), waitDone(B.page)]);
await Promise.all([A.page.waitForTimeout(8000), B.page.waitForTimeout(8000)]); // settle + cross-tab sync

const after = { A: pub(await engineSnapshot(A.ctx)), B: pub(await engineSnapshot(B.ctx)) };
const hA = await hud(A.page), hB = await hud(B.page);
await A.page.screenshot({ path: SHOTS + 'after-A.png', fullPage: true }); await B.page.screenshot({ path: SHOTS + 'after-B.png', fullPage: true });
const out = {
  baseline: base, after,
  engineConverged: JSON.stringify(after.A) === JSON.stringify(after.B),
  beatSeqA: after.A.beatSeq, beatSeqB: after.B.beatSeq,
  msgsA: hA.msgs, msgsB: hB.msgs, msgsMatch: hA.msgs === hB.msgs,
  bodyIdentical: hA.body === hB.body,
  http409: { A: net.A.filter(x => x.status === 409).length, B: net.B.filter(x => x.status === 409).length },
  http4xx: { A: net.A.map(x => x.status + ' ' + x.url).slice(0, 8), B: net.B.map(x => x.status + ' ' + x.url).slice(0, 8) },
  jsErrA: hA.jsErrors, jsErrB: hB.jsErrors,
  aLastAi: hA.lastAi, bLastAi: hB.lastAi,
};
writeFileSync(SHOTS + 'race.json', JSON.stringify(out, null, 2));
console.log('RESULT:', JSON.stringify({ engineConverged: out.engineConverged, beatA: out.beatSeqA, beatB: out.beatSeqB, msgsA: out.msgsA, msgsB: out.msgsB, msgsMatch: out.msgsMatch, http409: out.http409, jsErrA: out.jsErrA.length, jsErrB: out.jsErrB.length }));
await A.ctx.close(); await B.ctx.close(); await b.close();
console.log('S3RACE DONE');
