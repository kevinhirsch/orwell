// State 2 — live casting interview driver (deepseek-v4-pro, real chat).
// Plays a consistent human-authored player persona through the in-chat producer interview,
// capturing each beat + leak check + engine casting state. Single window (parity hunt is State 3).
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
const HERE = new URL('.', import.meta.url).pathname;
const SHOTS = HERE + 'shots/s2/'; mkdirSync(SHOTS, { recursive: true });
const sec = Object.fromEntries(readFileSync(HERE + '.secrets.env', 'utf8').split('\n').filter(Boolean)
  .filter(l => !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const BASE = 'http://127.0.0.1:7000';
// Machinery-leak regex over the RENDERED (thinking-stripped) body — a leak HERE is the bug.
const LEAK_RE = /\b(engine|advanceGame|advance the game|game state|game status|submitDecision|runCompetition|updateCasting|createCharacter|getGameState|getMomentPrompt|pending decision|tool call|the player has|let me (check|record|see|try)|next beat|casting\.known|moment prompt|npc:\d)\b/i;

// A consistent, human-authored PLAYER persona (allowed — the player authors their own; NOT a legacy/NPC name).
const PERSONA = [
  "Hey — I'm Devon Hale, 29, a paramedic out of Tucson. Ten years staying calm while everyone else loses it, so a house full of strangers and cameras doesn't rattle me.",
  "My game's social but watchful: I make people feel safe, keep a read on the room, and I never swing first. Loyalty I earn I keep — loyalty I'm handed, I test.",
  "One real thing? I'm the youngest of five. I learned early that the quiet kid who listens ends up holding everyone's secrets. That's honestly the whole strategy.",
  "I'll win HOH when I have to, not just because I can — float near power, never advertise it. And I'd rather sit next to someone I can beat than a friend I'd feel sick about cutting.",
  "I'm ready. Put me in the house.",
  "Lock it in — let's go meet the house.",
];

const log = [];
function rec(o) { log.push(o); console.log(JSON.stringify(o).slice(0, 320)); writeFileSync(SHOTS + 'log.json', JSON.stringify(log, null, 2)); }

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.request.post(BASE + '/api/auth/login', { data: { username: sec.ADMIN_USER, password: sec.ADMIN_PW } });
const page = await ctx.newPage();
page.on('pageerror', e => rec({ t: 'pageerror', v: String(e.message).slice(0, 160) }));

async function status() { return ctx.request.get(BASE + '/api/orwell/state').then(r => r.json()).catch(() => ({})); }
async function visibleGM() {
  return page.evaluate(() => {
    const e = document.querySelectorAll('#chat-history .msg-ai'); const el = e[e.length - 1]; if (!el) return '';
    const c = el.cloneNode(true); c.querySelectorAll('.thinking-content,.thinking,[class*=thinking],.msg-footer').forEach(n => n.remove());
    return (c.innerText || '').replace(/\s+/g, ' ').trim();
  });
}
async function waitDone(t = 200000) {
  const t0 = Date.now(); let last = -1, stable = 0;
  while (Date.now() - t0 < t) {
    await page.waitForTimeout(1500);
    const info = await page.evaluate(() => {
      const e = document.querySelectorAll('#chat-history .msg-ai'); const el = e[e.length - 1];
      if (!el) return { len: 0, done: false, ph: true, n: e.length };
      const c = el.cloneNode(true); c.querySelectorAll('.thinking-content,.thinking,[class*=thinking],.msg-footer').forEach(n => n.remove());
      const txt = (c.innerText || '').trim();
      return { len: txt.length, done: !!el.querySelector('.msg-footer'), ph: /^(thinking|still|generating)/i.test(txt) || txt.length < 8, n: e.length };
    });
    if (info.done && !info.ph) { await page.waitForTimeout(800); return info; }
    if (!info.ph && info.len > 40 && info.len === last) { if (++stable >= 6) return info; } else stable = 0;
    last = info.len;
  }
  return { timeout: true };
}
async function dismissHeadshot() {
  for (const sel of ['[data-headshot-skip]', 'button:has-text("Skip")', 'button:has-text("skip")', '.hs-skip', 'button:has-text("Not now")']) {
    const loc = page.locator(sel).first();
    if (await loc.count().catch(() => 0)) { await loc.click({ timeout: 2000 }).catch(() => {}); return sel; }
  }
  return null;
}
async function send(text) {
  await page.fill('#message', text);
  await page.waitForTimeout(300);
  const mode = await page.evaluate(() => document.querySelector('.send-btn')?.getAttribute('data-mode'));
  if (mode === 'send') await page.click('.send-btn').catch(() => {}); else await page.keyboard.press('Enter');
}

await page.goto(BASE + '/', { waitUntil: 'load', timeout: 30000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(3500);
// dismiss welcome modal → opens producers + fires the hidden kickoff
const go = page.locator('[data-ob-welcome-go]').first();
const welcomed = await go.count().catch(() => 0) ? (await go.click().catch(() => {}), true) : false;
rec({ t: 'welcome', clicked: welcomed });
await page.screenshot({ path: SHOTS + '00-after-welcome.png', fullPage: true }).catch(() => {});

// Turn 0: the producers reach out first — wait for the opener.
await waitDone();
let gm = await visibleGM(); let st = await status();
rec({ turn: 0, gm: gm.slice(0, 600), leak: (gm.match(LEAK_RE) || [null])[0], casting: st.casting, started: st.started, moment: st.moment });
await page.screenshot({ path: SHOTS + 'turn-00.png', fullPage: true }).catch(() => {});

for (let i = 0; i < PERSONA.length; i++) {
  st = await status();
  if (st.started === true) { rec({ note: 'game started before persona turn ' + (i + 1) }); break; }
  const hs = await dismissHeadshot();
  await send(PERSONA[i]);
  await page.waitForTimeout(1500);
  const w = await waitDone();
  const hs2 = await dismissHeadshot();
  gm = await visibleGM(); st = await status();
  rec({ turn: i + 1, sent: PERSONA[i].slice(0, 70), gm: gm.slice(0, 600), leak: (gm.match(LEAK_RE) || [null])[0], casting: st.casting, started: st.started, headshotBox: hs || hs2, wait: w.timeout ? 'TIMEOUT' : 'ok' });
  await page.screenshot({ path: SHOTS + `turn-${String(i + 1).padStart(2, '0')}.png`, fullPage: true }).catch(() => {});
}
st = await status();
rec({ final: true, started: st.started, moment: st.moment, casting: st.casting, houseCount: (st.house || []).length, house: (st.house || []).map(h => h.name) });
await page.screenshot({ path: SHOTS + 'final.png', fullPage: true }).catch(() => {});
console.log('S2 DONE');
await b.close();
