// State 3 — core-loop narration FIDELITY driver (single clean window; re-verify S3-CORE engine-bypass + B4 invention).
// Each turn: render GM, leak-check, engine truth (phase/hoh/noms/pending/beatSeq), invented-name check vs roster,
// and whether the engine ADVANCED. The S3-CORE oracle: a narrated comp/ceremony OUTCOME must match engine state.
import { newCtx, engineSnapshot, BASE } from './rig.mjs';
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
const HERE = new URL('.', import.meta.url).pathname;
const SHOTS = HERE + 'shots/s3core/'; mkdirSync(SHOTS, { recursive: true });
const LEAK_RE = /\b(engine|advanceGame|advance the game|game state|game status|submitDecision|runCompetition|getGameState|getMomentPrompt|pending decision|tool call|the player has|let me (check|record|see|try)|next beat|npc:\d)\b/i;
const EXCLUDE = new Set(['Vincent', 'Julie', 'Big', 'Brother', 'Production', 'Devon', 'Hale', 'Head', 'Household', 'Power', 'Veto', 'Diary', 'Room', 'Los', 'Angeles']);
function pub(s) { const g = s.state || {}, st = s.status || {}; return { started: g.started, moment: g.moment, week: g.week, beatSeq: g.beatSeq, phase: st.phase, hoh: (st.hoh && st.hoh.name) || st.hoh || null, noms: (st.nominees || []).map(x => x.name), pending: (st.pending && st.pending.kind) || null }; }
const rosterOf = s => new Set((s.state.house || []).map(h => h.name));

const b = await chromium.launch();
const ctx = await newCtx(b, 'desktop', { auth: true });
const page = await ctx.newPage();
const log = []; function rec(o) { log.push(o); console.log(JSON.stringify(o).slice(0, 320)); writeFileSync(SHOTS + 'log.json', JSON.stringify(log, null, 2)); }
page.on('pageerror', e => rec({ t: 'pageerror', v: String(e.message).slice(0, 150) }));
await page.goto(BASE + '/', { waitUntil: 'load', timeout: 30000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(3500);
await page.evaluate(() => { const o = document.getElementById('orwell-onboarding'); if (o) o.remove(); document.querySelectorAll('[inert]').forEach(n => { try { n.inert = false; } catch (_) {} }); });

async function visibleGM() { return page.evaluate(() => { const e = document.querySelectorAll('#chat-history .msg-ai'); const el = e[e.length - 1]; if (!el) return ''; const c = el.cloneNode(true); c.querySelectorAll('.thinking-content,.thinking,[class*=thinking],.msg-footer').forEach(n => n.remove()); return (c.innerText || '').replace(/\s+/g, ' ').trim(); }); }
async function waitDone(t = 200000) { const t0 = Date.now(); let last = -1, stable = 0; while (Date.now() - t0 < t) { await page.waitForTimeout(1500); const info = await page.evaluate(() => { const e = document.querySelectorAll('#chat-history .msg-ai'); const el = e[e.length - 1]; if (!el) return { len: 0, done: false, ph: true }; const c = el.cloneNode(true); c.querySelectorAll('.thinking-content,.thinking,[class*=thinking],.msg-footer').forEach(n => n.remove()); const txt = (c.innerText || '').trim(); return { len: txt.length, done: !!el.querySelector('.msg-footer'), ph: /^(thinking|still|generating)/i.test(txt) || txt.length < 8 }; }); if (info.done && !info.ph) { await page.waitForTimeout(800); return; } if (!info.ph && info.len > 40 && info.len === last) { if (++stable >= 6) return; } else stable = 0; last = info.len; } }
async function resolveCard() {
  const dc = await page.$('#orwell-decision-card'); if (!dc) return null;
  const title = await page.evaluate(() => document.querySelector('#orwell-decision-card .odec-title')?.innerText || '');
  const opts = await page.$$('#orwell-decision-card .odec-opt'); const pick = /nominat/i.test(title) ? 2 : 1;
  for (let i = 0; i < pick && i < opts.length; i++) { await opts[i].click().catch(() => {}); await page.waitForTimeout(150); }
  const ta = await page.$('#orwell-decision-card textarea'); if (ta) await ta.fill('You played a strong game. No hard feelings — good luck out there.').catch(() => {});
  await page.click('#orwell-decision-card .odec-confirm').catch(() => {});
  return 'CARD[' + title.slice(0, 44) + ']';
}
async function send(text) { await page.fill('#message', text); await page.waitForTimeout(200); const m = await page.evaluate(() => document.querySelector('.send-btn')?.getAttribute('data-mode')); if (m === 'send') await page.click('.send-btn').catch(() => {}); else await page.keyboard.press('Enter'); }

const LINES = ["(I lock in and give this competition everything I've got.)", "(I take in what just happened and get my read on where the house stands.)", "(I make my move based on where things are right now.)", "(I have a quiet word with someone I think I can work with.)", "(I play the moment in front of me — calm, watching, present.)"];
const snap0 = await engineSnapshot(ctx); const roster = rosterOf(snap0);
rec({ turn: 0, state: pub(snap0), rosterCount: roster.size });
for (let i = 0; i < 14; i++) {
  const before = pub(await engineSnapshot(ctx));
  let card = await resolveCard();
  if (!card) await send(LINES[i % LINES.length]);
  await page.waitForTimeout(1500);
  await waitDone();
  const card2 = await resolveCard(); if (card2) { await page.waitForTimeout(2000); await waitDone(); }
  const gm = await visibleGM();
  const after = pub(await engineSnapshot(ctx));
  const invented = [...new Set((gm.match(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g) || []))].filter(n => { const f = n.split(' ')[0]; return !EXCLUDE.has(f) && !roster.has(n); });
  rec({ turn: i + 1, card: card || card2 || null, leak: (gm.match(LEAK_RE) || [null])[0], invented: invented.slice(0, 6), phase: after.phase, hoh: after.hoh, noms: after.noms, pending: after.pending, beat: after.beatSeq, advanced: JSON.stringify(before) !== JSON.stringify(after), gm: gm.slice(0, 380) });
  await page.screenshot({ path: SHOTS + `turn-${String(i + 1).padStart(2, '0')}.png`, fullPage: true }).catch(() => {});
  if (after.moment === 'post-season' || after.phase === 'finale') { rec({ note: 'reached ' + after.moment + '/' + after.phase }); break; }
}
console.log('S3CORE DONE');
await b.close();
