// Interactive roleplay session daemon. Keeps the browser + chat session alive so
// the auditor can play a consistent persona turn-by-turn through the REAL front end.
//   protocol (file mailbox):
//     write  /tmp/play/req.json  = {"n":<int>,"text":"<player line>"}
//     daemon sends it in agent mode, waits for the GM reply, then writes
//     /tmp/play/resp.json = {"n":<int>,"gm":"<visible message>","leak":<str|null>,
//                            "status":{week,phase,hoh,noms,pending},"shot":"turnNN.png"}
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { chromium } from 'playwright';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:7000';
const SHOTS = new URL('./shots/play/', import.meta.url).pathname;
const REQ = '/tmp/play/req.json', RESP = '/tmp/play/resp.json';
const sec = Object.fromEntries(readFileSync(new URL('./.secrets.env', import.meta.url), 'utf8')
  .split('\n').filter(Boolean).map(l => l.split('=').map(s => s.trim())).map(([k, ...v]) => [k, v.join('=')]));
const LEAK_RE = /\b(engine|advanceGame|advance the game|game state|game status|submitDecision|runCompetition|getGameState|pending decision|tool call|the player has|let me (check|record|see what|try)|next beat)\b/i;

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.request.post(BASE + '/api/auth/login', { data: { username: sec.ADMIN_USER, password: sec.ADMIN_PW } });
const page = await ctx.newPage();
await page.goto(BASE + '/', { waitUntil: 'load', timeout: 30000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(3500);
await page.click('#sidebar-new-chat-btn').catch(() => {});
await page.waitForTimeout(1800);

async function send(text) {
  await page.fill('#message', text);
  await page.waitForTimeout(300);
  const mode = await page.evaluate(() => document.querySelector('.send-btn')?.getAttribute('data-mode'));
  if (mode === 'send') await page.click('.send-btn').catch(() => {}); else await page.keyboard.press('Enter');
}
async function waitDone(t = 160000) {
  // Done = the completion footer (tok/s) rendered on the last GM message AND its
  // visible text isn't a "Thinking…/Generating…" placeholder. Fallback: substantial
  // non-placeholder text stable for several polls. (The old length-only heuristic
  // latched onto the "Thinking ▅▄▃" placeholder and captured mid-stream.)
  const t0 = Date.now(); let last = -1, stable = 0;
  while (Date.now() - t0 < t) {
    await page.waitForTimeout(1200);
    const info = await page.evaluate(() => {
      const e = document.querySelectorAll('#chat-history .msg-ai'); const el = e[e.length - 1];
      if (!el) return { len: 0, done: false, placeholder: true };
      const c = el.cloneNode(true);
      c.querySelectorAll('.thinking-content,.thinking,[class*=thinking],.msg-footer').forEach(n => n.remove());
      const txt = (c.innerText || '').trim();
      const done = !!el.querySelector('.msg-footer');
      const placeholder = /^(thinking|still waiting|generating)/i.test(txt) || txt.length < 8;
      return { len: txt.length, done, placeholder };
    });
    if (info.done && !info.placeholder) { await page.waitForTimeout(600); return; }
    if (!info.placeholder && info.len > 40 && info.len === last) { if (++stable >= 6) return; } else stable = 0;
    last = info.len;
  }
}
async function resolveCards() {  // answer any decision card / ask_user that blocks the chat
  const dc = await page.$('#orwell-decision-card');
  if (dc) {
    const title = await page.evaluate(() => (document.querySelector('#orwell-decision-card .odec-title')?.innerText || ''));
    const opts = await page.$$('#orwell-decision-card .odec-opt');
    const pick = /nominat/i.test(title) ? 2 : 1;
    for (let i = 0; i < pick && i < opts.length; i++) { await opts[i].click(); await page.waitForTimeout(120); }
    const ta = await page.$('#orwell-decision-card textarea'); if (ta) await ta.fill('You played hard. No hard feelings.').catch(() => {});
    await page.click('#orwell-decision-card .odec-confirm').catch(() => {});
    return 'decision-card:' + title;
  }
  return null;
}
async function status() { return ctx.request.get(BASE + '/api/orwell/status').then(r => r.json()).catch(() => ({})); }

let lastN = 0;
console.log('DAEMON READY');
for (;;) {
  await page.waitForTimeout(900);
  if (!existsSync(REQ)) continue;
  let req; try { req = JSON.parse(readFileSync(REQ, 'utf8')); } catch { continue; }
  if (!req || req.n <= lastN || !req.text) continue;
  lastN = req.n;
  await send(req.text);
  await page.waitForTimeout(1200);
  await waitDone();
  await page.waitForTimeout(2000);
  const card = await resolveCards();
  if (card) { await page.waitForTimeout(1500); }
  const vis = await page.evaluate(() => {
    const e = document.querySelectorAll('#chat-history .msg-ai'); const el = e[e.length - 1]; if (!el) return '';
    const c = el.cloneNode(true); c.querySelectorAll('.thinking-content,.thinking,[class*=thinking],.msg-footer').forEach(n => n.remove());
    return (c.innerText || '').replace(/\s+/g, ' ').trim();
  });
  const st = await status();
  const shot = `turn-${String(lastN).padStart(2, '0')}.png`;
  await page.screenshot({ path: SHOTS + shot, fullPage: true }).catch(() => {});
  writeFileSync(RESP, JSON.stringify({ n: lastN, gm: vis, leak: (vis.match(LEAK_RE) || [null])[0],
    card, status: { week: st.week, phase: st.phase, hoh: st.hoh?.name || null,
      noms: (st.nominees || []).map(x => x.name), pending: st.pending?.kind || null }, shot }));
  console.log(`turn ${lastN} done — ${st.week}/${st.phase}` + (card ? ` [${card}]` : ''));
}
