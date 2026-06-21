// State 3 (concurrency) — LOOPED concurrent-write race (races are intermittent; one pass proves nothing).
// Persistent 2 tabs on the same game; each iteration fires SIMULTANEOUS turns in both, then checks parity.
// Flags ANY iteration with: engine divergence, msg-count mismatch, body divergence, JS errors, unrecovered 409.
import { newCtx, engineSnapshot, BASE } from './rig.mjs';
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
const HERE = new URL('.', import.meta.url).pathname;
const SHOTS = HERE + 'shots/s3raceloop/'; mkdirSync(SHOTS, { recursive: true });
const N = parseInt(process.env.RACE_N || '10', 10);
function pub(s) { const g = s.state || {}, st = s.status || {}; return { started: g.started, moment: g.moment, week: g.week, beatSeq: g.beatSeq, phase: st.phase, hoh: (st.hoh && st.hoh.name) || st.hoh || null, pending: (st.pending && st.pending.kind) || null }; }
async function send(page, text) { await page.fill('#message', text); await page.waitForTimeout(150); const m = await page.evaluate(() => document.querySelector('.send-btn')?.getAttribute('data-mode')); if (m === 'send') await page.click('.send-btn').catch(() => {}); else await page.keyboard.press('Enter'); }
async function waitDone(page, t = 160000) { const t0 = Date.now(); let last = -1, stable = 0; while (Date.now() - t0 < t) { await page.waitForTimeout(1500); const info = await page.evaluate(() => { const e = document.querySelectorAll('#chat-history .msg-ai'); const el = e[e.length - 1]; if (!el) return { len: 0, done: false, ph: true }; const c = el.cloneNode(true); c.querySelectorAll('.thinking-content,.thinking,[class*=thinking],.msg-footer').forEach(n => n.remove()); const txt = (c.innerText || '').trim(); return { len: txt.length, done: !!el.querySelector('.msg-footer'), ph: /^(thinking|still|generating)/i.test(txt) || txt.length < 8 }; }); if (info.done && !info.ph) { await page.waitForTimeout(700); return; } if (!info.ph && info.len > 40 && info.len === last) { if (++stable >= 6) return; } else stable = 0; last = info.len; } }
async function snap(page) { return page.evaluate(() => { const msgs = document.querySelectorAll('#chat-history .msg').length; const body = (document.body.innerText || '').replace(/\s+/g, ' ').trim(); return { msgs, body, jsErrors: (window.__audit && window.__audit.errors || []).length }; }); }
const A_LINES = ["(I drift into the kitchen and say hey to whoever's around.)", "(I check in with someone on the couch.)", "(I grab water and chat with anyone nearby.)", "(I wander the common room, making small talk.)", "(I lean on the counter and joke with whoever's there.)"];
const B_LINES = ["(I hang back and just watch the room for a beat.)", "(I post up by the wall, listening.)", "(I take a slow lap around the living room.)", "(I find a quiet corner and read the vibe.)", "(I sit on the arm of the couch and observe.)"];

const b = await chromium.launch();
const net = { A: [], B: [] };
async function win(tag) { const ctx = await newCtx(b, 'desktop', { auth: true }); const page = await ctx.newPage(); page.on('response', r => { const s = r.status(); if (s >= 400) net[tag].push({ it: -1, status: s, url: (r.url().split('7000')[1] || r.url()).slice(0, 60) }); }); await page.goto(BASE + '/', { waitUntil: 'load', timeout: 30000 }); await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(3500); await page.evaluate(() => { const o = document.getElementById('orwell-onboarding'); if (o) o.remove(); document.querySelectorAll('[inert]').forEach(n => { try { n.inert = false; } catch (_) {} }); }); await page.waitForTimeout(500); return { ctx, page }; }
const A = await win('A'); const B = await win('B');
const results = [];
let curNetA = 0, curNetB = 0;
for (let i = 0; i < N; i++) {
  const before = { A: pub(await engineSnapshot(A.ctx)), B: pub(await engineSnapshot(B.ctx)) };
  await Promise.all([send(A.page, A_LINES[i % A_LINES.length]), send(B.page, B_LINES[i % B_LINES.length])]);
  await Promise.all([waitDone(A.page), waitDone(B.page)]);
  await Promise.all([A.page.waitForTimeout(7000), B.page.waitForTimeout(7000)]);
  const after = { A: pub(await engineSnapshot(A.ctx)), B: pub(await engineSnapshot(B.ctx)) };
  const sA = await snap(A.page), sB = await snap(B.page);
  const new409A = net.A.filter(x => x.status === 409).length - curNetA; curNetA = net.A.filter(x => x.status === 409).length;
  const new409B = net.B.filter(x => x.status === 409).length - curNetB; curNetB = net.B.filter(x => x.status === 409).length;
  const r = { it: i + 1, engineConverged: JSON.stringify(after.A) === JSON.stringify(after.B), beatA: after.A.beatSeq, beatB: after.B.beatSeq, moment: after.A.moment, pending: after.A.pending, msgsA: sA.msgs, msgsB: sB.msgs, msgsMatch: sA.msgs === sB.msgs, bodyIdentical: sA.body === sB.body, jsErrA: sA.jsErrors, jsErrB: sB.jsErrors, h409A: new409A, h409B: new409B };
  r.PROBLEM = (!r.engineConverged || !r.msgsMatch || !r.bodyIdentical || r.jsErrA > 0 || r.jsErrB > 0);
  results.push(r);
  writeFileSync(SHOTS + 'raceloop.json', JSON.stringify(results, null, 2));
  console.log((r.PROBLEM ? '*** PROBLEM ' : 'ok ') + `it ${r.it}/${N}: converged=${r.engineConverged} beat=${r.beatA}/${r.beatB} msgs=${r.msgsA}/${r.msgsB}(match=${r.msgsMatch}) bodyId=${r.bodyIdentical} jsErr=${r.jsErrA}/${r.jsErrB} 409=${r.h409A}/${r.h409B} moment=${r.moment} pending=${r.pending}`);
  if (r.PROBLEM) { await A.page.screenshot({ path: SHOTS + `problem-it${r.it}-A.png`, fullPage: true }).catch(() => {}); await B.page.screenshot({ path: SHOTS + `problem-it${r.it}-B.png`, fullPage: true }).catch(() => {}); }
}
const problems = results.filter(r => r.PROBLEM).length;
console.log(`\nSUMMARY: ${N} iterations, ${problems} with a parity PROBLEM. total 409: A=${curNetA} B=${curNetB}`);
console.log('S3RACELOOP DONE');
await A.ctx.close(); await B.ctx.close(); await b.close();
