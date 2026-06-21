// State 3 — TRANSIENT-vs-PERSISTENT diagnostic for the cross-tab chat divergence.
// Reproduce the divergence with concurrent writes, then RELOAD both tabs: if they converge
// -> the live FE merge is unsound but the persisted conversation is intact (render-layer);
// if they still differ -> the server stored divergent conversations (data-layer).
import { newCtx, engineSnapshot, BASE } from './rig.mjs';
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
const HERE = new URL('.', import.meta.url).pathname;
const SHOTS = HERE + 'shots/s3rec/'; mkdirSync(SHOTS, { recursive: true });
async function msgList(page) {
  return page.evaluate(() => [...document.querySelectorAll('#chat-history .msg')].map((el, i) => {
    const cls = [...el.classList].filter(c => c.startsWith('msg')).join(',');
    const id = el.id || el.dataset.id || el.dataset.messageId || el.getAttribute('data-msg-id') || el.getAttribute('data-mid') || '';
    const c = el.cloneNode(true); c.querySelectorAll('.thinking-content,.thinking,[class*=thinking],.msg-footer').forEach(n => n.remove());
    return { i, cls, id, t: (c.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 48) };
  }));
}
async function send(page, text) { await page.fill('#message', text); await page.waitForTimeout(150); const m = await page.evaluate(() => document.querySelector('.send-btn')?.getAttribute('data-mode')); if (m === 'send') await page.click('.send-btn').catch(() => {}); else await page.keyboard.press('Enter'); }
async function waitDone(page, t = 160000) { const t0 = Date.now(); let last = -1, stable = 0; while (Date.now() - t0 < t) { await page.waitForTimeout(1500); const info = await page.evaluate(() => { const e = document.querySelectorAll('#chat-history .msg-ai'); const el = e[e.length - 1]; if (!el) return { len: 0, done: false, ph: true }; const c = el.cloneNode(true); c.querySelectorAll('.thinking-content,.thinking,[class*=thinking],.msg-footer').forEach(n => n.remove()); const txt = (c.innerText || '').trim(); return { len: txt.length, done: !!el.querySelector('.msg-footer'), ph: /^(thinking|still|generating)/i.test(txt) || txt.length < 8 }; }); if (info.done && !info.ph) { await page.waitForTimeout(700); return; } if (!info.ph && info.len > 40 && info.len === last) { if (++stable >= 6) return; } else stable = 0; last = info.len; } }
async function reloadP(page) { await page.reload({ waitUntil: 'load', timeout: 30000 }); await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(4500); await page.evaluate(() => { const o = document.getElementById('orwell-onboarding'); if (o) o.remove(); document.querySelectorAll('[inert]').forEach(n => { try { n.inert = false; } catch (_) {} }); }); await page.waitForTimeout(800); }
const txts = l => JSON.stringify(l.map(m => m.cls + '|' + m.t));

const b = await chromium.launch();
async function win() { const ctx = await newCtx(b, 'desktop', { auth: true }); const page = await ctx.newPage(); await page.goto(BASE + '/', { waitUntil: 'load', timeout: 30000 }); await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(3500); await page.evaluate(() => { const o = document.getElementById('orwell-onboarding'); if (o) o.remove(); document.querySelectorAll('[inert]').forEach(n => { try { n.inert = false; } catch (_) {} }); }); await page.waitForTimeout(600); return { ctx, page }; }
const A = await win(); const B = await win();
const base = { A: await msgList(A.page), B: await msgList(B.page) };
const baseMatch = txts(base.A) === txts(base.B);
// reproduce: concurrent writes (a couple of rounds to make the divergence likely)
for (let k = 0; k < 2; k++) {
  await Promise.all([send(A.page, k ? "(I keep chatting in the kitchen.)" : "(I slip into the kitchen and start a conversation.)"), send(B.page, k ? "(I drift to the couch, still watching.)" : "(I linger by the doorway and watch.)")]);
  await Promise.all([waitDone(A.page), waitDone(B.page)]);
  await Promise.all([A.page.waitForTimeout(7000), B.page.waitForTimeout(7000)]);
}
const live = { A: await msgList(A.page), B: await msgList(B.page) };
const liveMatch = txts(live.A) === txts(live.B);
await A.page.screenshot({ path: SHOTS + 'live-A.png', fullPage: true }); await B.page.screenshot({ path: SHOTS + 'live-B.png', fullPage: true });
// reload both -> does it reconcile?
await Promise.all([reloadP(A.page), reloadP(B.page)]);
const after = { A: await msgList(A.page), B: await msgList(B.page) };
const afterMatch = txts(after.A) === txts(after.B);
const eng = { A: (await engineSnapshot(A.ctx)).state, B: (await engineSnapshot(B.ctx)).state };
const out = { baseMatch, baseN: [base.A.length, base.B.length], liveMatch, liveN: [live.A.length, live.B.length], afterReloadMatch: afterMatch, afterN: [after.A.length, after.B.length], engineBeat: [eng.A.beatSeq, eng.B.beatSeq], live, after };
writeFileSync(SHOTS + 'reconcile.json', JSON.stringify(out, null, 2));
console.log('baseMatch:', baseMatch, 'N:', out.baseN);
console.log('LIVE after concurrent writes: match=', liveMatch, 'N=', out.liveN);
console.log('AFTER RELOAD: match=', afterMatch, 'N=', out.afterN, 'engineBeat=', out.engineBeat);
if (!liveMatch) { console.log('--- live A ---'); live.A.forEach(m => console.log(m.i, m.cls, '|', m.t)); console.log('--- live B ---'); live.B.forEach(m => console.log(m.i, m.cls, '|', m.t)); }
if (!afterMatch) { console.log('--- after-reload A ---'); after.A.forEach(m => console.log(m.i, m.cls, '|', m.t)); console.log('--- after-reload B ---'); after.B.forEach(m => console.log(m.i, m.cls, '|', m.t)); }
console.log('VERDICT:', !liveMatch ? (afterMatch ? 'TRANSIENT — live tabs diverge under concurrent writes, RELOAD RECONCILES (render-layer; persisted convo intact)' : 'PERSISTENT — diverges EVEN AFTER RELOAD (data-layer divergence)') : 'no divergence reproduced this run');
await A.ctx.close(); await B.ctx.close(); await b.close();
console.log('S3REC DONE');
