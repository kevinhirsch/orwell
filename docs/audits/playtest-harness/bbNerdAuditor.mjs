// Big Brother Nerd Auditor — interactive live-play daemon.
//
// A persistent browser + chat session, driven turn-by-turn over a file mailbox,
// so a human-or-agent "auditor" can play a CONSISTENT persona through the REAL
// front end and log EVERYTHING the auditor cares about, per turn:
//   - the player-visible GM message (thinking stripped) — the text he "gets back"
//   - the hidden reasoning (captured separately, secondary — a leak HERE is minor)
//   - the GADGET RAIL statuses: the rendered HUD (#gadget-rail-body, #os-* status
//     panel, #orwell-presence) AND the engine truth behind them (parity check)
//   - the full engine snapshot (/api/orwell/{state,status,moment}) as ground truth
//   - machinery-leak + invented-houseguest checks (the two worst bug classes)
//   - a full-page screenshot
//
// It is the same family as playSession.mjs (README §4) but captures the gadget
// rail + engine truth richly and SURFACES binding decision cards instead of
// auto-resolving them (a BB expert makes his own noms/veto/evict calls).
//
// Mailbox protocol (write req, then wait for resp-<n>.json):
//   req  /tmp/play/req.json
//     {"n":N,"action":"meet"}                       -> click "Meet the producers", capture the opener
//     {"n":N,"action":"newchat"}                    -> start a fresh chat session (picks up live moment)
//     {"n":N,"action":"snap"}                       -> just re-capture (no send)
//     {"n":N,"text":"<in-character player line>"}   -> send a chat turn
//     {"n":N,"card":{"picks":[i,...],"text":"..."}} -> resolve the OPEN decision card
//   resp /tmp/play/resp-<n>.json (+ resp.json mirror): the rich capture below.
//
// Run from the git-ignored .audit-telemetry/ sandbox (reads ./.secrets.env;
// node_modules symlinked to the global playwright; PLAYWRIGHT_BROWSERS_PATH set).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:7000';
const ENGINE = process.env.ENGINE_URL || 'http://127.0.0.1:8765';
const MBOX = process.env.MBOX || '/tmp/play';
const SHOTS = new URL('./shots/play/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
mkdirSync(MBOX, { recursive: true });
const REQ = `${MBOX}/req.json`;

const sec = Object.fromEntries(readFileSync(new URL('./.secrets.env', import.meta.url), 'utf8')
  .split('\n').filter(Boolean).filter(l => !l.startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

// Machinery leak in the PLAYER-VISIBLE body = the bug (tool/engine names, operator asides).
const LEAK_RE = /\b(engine|advanceGame|advance the game|game state|game status|submitDecision|runCompetition|recordInteraction|updateCasting|createCharacter|getGameState|getMomentPrompt|markHouseguestMet|surfaceInformationTo|pending decision|tool call|the player has|let me (check|record|see|try)|next beat|moment prompt|beatSeq|npc:\d)\b/i;
// Tokens that look like a "First Last" pair but are NOT an invented houseguest.
const NAME_STOP = new Set(['Big', 'Brother', 'Head', 'Household', 'Power', 'Veto', 'Diary', 'Room', 'Have', 'Nots', 'Final', 'Jury',
  'Los', 'Angeles', 'New', 'York', 'And', 'But', 'If', 'The', 'You', 'Your', 'When', 'Then', 'After', 'Before', 'House', 'Guest']);

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.request.post(BASE + '/api/auth/login', { data: { username: sec.ADMIN_USER, password: sec.ADMIN_PW } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e.message).slice(0, 200)));
page.on('console', m => { if (m.type() === 'error') pageErrors.push('console.error: ' + m.text().slice(0, 180)); });
await page.goto(BASE + '/', { waitUntil: 'load', timeout: 30000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(3500);

async function send(text) {
  await page.fill('#message', text);
  await page.waitForTimeout(300);
  const mode = await page.evaluate(() => document.querySelector('.send-btn')?.getAttribute('data-mode'));
  if (mode === 'send') await page.click('.send-btn').catch(() => {}); else await page.keyboard.press('Enter');
}

// Done = the streaming completion footer (tok/s) on the last GM message AND a
// non-placeholder body. (The length-stable heuristic latches the "Thinking…" placeholder.)
async function waitDone(t = 220000) {
  const t0 = Date.now(); let last = -1, stable = 0;
  while (Date.now() - t0 < t) {
    await page.waitForTimeout(1500);
    const info = await page.evaluate(() => {
      const e = document.querySelectorAll('#chat-history .msg-ai'); const el = e[e.length - 1];
      if (!el) return { len: 0, done: false, ph: true };
      const c = el.cloneNode(true);
      c.querySelectorAll('.thinking-content,.thinking,[class*=thinking],.msg-footer').forEach(n => n.remove());
      const txt = (c.innerText || '').trim();
      return { len: txt.length, done: !!el.querySelector('.msg-footer'), ph: /^(thinking|still|generating)/i.test(txt) || txt.length < 8 };
    });
    if (info.done && !info.ph) { await page.waitForTimeout(700); return { ok: true }; }
    if (!info.ph && info.len > 40 && info.len === last) { if (++stable >= 6) return { ok: true, soft: true }; } else stable = 0;
    last = info.len;
  }
  return { ok: false, timeout: true };
}

// The casting headshot/portrait studio is NOT a binding game decision — auto-skip it
// (the auditor just wants to play). We DO record that it appeared.
async function dismissHeadshot() {
  for (const sel of ['#hs-skip', '[data-headshot-skip]', '.hs-skip', 'button:has-text("Skip for now")',
    'button:has-text("Skip")', 'button:has-text("Not now")', 'button:has-text("Maybe later")', 'button:has-text("Use default")']) {
    const loc = page.locator(sel).first();
    if (await loc.count().catch(() => 0)) { await loc.click({ timeout: 1500 }).catch(() => {}); return sel; }
  }
  return null;
}

async function readBody() {
  return page.evaluate(() => {
    const e = document.querySelectorAll('#chat-history .msg-ai'); const el = e[e.length - 1];
    if (!el) return { gm: '', thinking: '', footer: '' };
    const c = el.cloneNode(true);
    const think = [...el.querySelectorAll('.thinking-content,.thinking,[class*=thinking]')].map(n => (n.innerText || '').trim()).join(' · ');
    const footer = (el.querySelector('.msg-footer')?.innerText || '').replace(/\s+/g, ' ').trim();
    c.querySelectorAll('.thinking-content,.thinking,[class*=thinking],.msg-footer').forEach(n => n.remove());
    return { gm: (c.innerText || '').replace(/\s+/g, ' ').trim(), thinking: think.slice(0, 1200), footer };
  });
}

// The rendered gadget rail: the whole rail innerText + the structured status panel
// (#os-*) + presence (#orwell-presence). This is what the FE SHOWS the player.
async function readGadgets() {
  return page.evaluate(() => {
    const txt = el => (el && el.innerText || '').replace(/\s+/g, ' ').trim();
    const q = s => document.querySelector(s);
    const railBody = q('#gadget-rail-body') || q('#sidebar');
    const t = id => (q(id)?.textContent || '').trim();
    return {
      railText: txt(railBody).slice(0, 1200),
      status: { week: t('#os-week'), phase: t('#os-phase'), tod: t('#os-tod'),
        hoh: t('#os-hoh'), noms: t('#os-noms'), veto: t('#os-veto') },
      presence: txt(q('#orwell-presence')).slice(0, 600),
      wantsWord: txt(q('#orwell-social') || q('[data-gadget="wants-word"]') || q('.orwell-wants-word')).slice(0, 600),
      decisionCardVisible: !!q('#orwell-decision-card'),
    };
  });
}

async function readCard() {
  const dc = await page.$('#orwell-decision-card'); if (!dc) return null;
  return page.evaluate(() => {
    const root = document.querySelector('#orwell-decision-card');
    const title = (root.querySelector('.odec-title')?.innerText || '').trim();
    const sub = (root.querySelector('.odec-sub,.odec-desc,.odec-prompt')?.innerText || '').trim();
    const options = [...root.querySelectorAll('.odec-opt')].map((o, i) => ({ i, label: (o.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80) }));
    return { title, sub: sub.slice(0, 240), options, hasTextarea: !!root.querySelector('textarea') };
  });
}

async function resolveCard({ picks = [], text = '' }) {
  const opts = await page.$$('#orwell-decision-card .odec-opt');
  for (const i of picks) { if (opts[i]) { await opts[i].click().catch(() => {}); await page.waitForTimeout(150); } }
  if (text) { const ta = await page.$('#orwell-decision-card textarea'); if (ta) await ta.fill(text).catch(() => {}); }
  await page.click('#orwell-decision-card .odec-confirm').catch(() => {});
}

async function engineSnap() {
  const get = (p, host = BASE) => ctx.request.get(host + p, { timeout: 9000 }).then(r => r.json()).catch(e => ({ __err: String(e).slice(0, 80) }));
  const state = await get('/api/orwell/state'); const status = await get('/api/orwell/status');
  const moment = await get('/api/orwell/moment'); const health = await get('/health', ENGINE);
  return {
    moment: state.moment ?? status.moment ?? moment.moment, started: state.started,
    casting: state.casting || null,
    week: status.week, phase: status.phase, timeOfDay: status.timeOfDay,
    hoh: status.hoh?.name || status.hoh || null,
    noms: (status.nominees || []).map(x => x.name || x),
    veto: status.veto ? (status.veto.holder?.name || status.veto.holder || status.veto.used) : null,
    pending: status.pending?.kind || null,
    beatSeq: state.beatSeq ?? status.beatSeq,
    houseCount: (state.house || []).length,
    house: (state.house || []).map(h => h.name),
    embeddings: health.embeddings?.provider,
  };
}

async function capture(n, sent, extra = {}) {
  await page.waitForTimeout(400);
  const headshot = await dismissHeadshot();
  if (headshot) await page.waitForTimeout(800);
  const { gm, thinking, footer } = await readBody();
  const gadgets = await readGadgets();
  const card = await readCard();
  const engine = await engineSnap();
  const roster = new Set(engine.house || []);
  const invented = [...new Set((gm.match(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g) || []))]
    .filter(nm => { const f = nm.split(' ')[0]; return !NAME_STOP.has(f) && !roster.has(nm); }).slice(0, 8);
  const shot = `turn-${String(n).padStart(2, '0')}.png`;
  await page.screenshot({ path: SHOTS + shot, fullPage: true }).catch(() => {});
  const errs = pageErrors.splice(0);
  const resp = { n, sent, ...extra, gm, thinking, footer, leak: (gm.match(LEAK_RE) || [null])[0],
    invented, headshotBox: headshot, card, gadgets, engine, errors: errs, shot };
  writeFileSync(`${MBOX}/resp-${n}.json`, JSON.stringify(resp, null, 2));
  writeFileSync(`${MBOX}/resp.json`, JSON.stringify(resp, null, 2));
  console.log(`turn ${n} [${sent.slice(0, 40)}] -> ${engine.moment}/${engine.phase} hoh=${engine.hoh} noms=${(engine.noms || []).join('/')} pending=${engine.pending}` +
    (resp.leak ? ` LEAK:${resp.leak}` : '') + (invented.length ? ` INVENTED:${invented.join(',')}` : '') + (card ? ` CARD:${card.title}` : ''));
}

let lastN = 0;
console.log('BB-NERD-AUDITOR DAEMON READY');
for (;;) {
  await page.waitForTimeout(800);
  if (!existsSync(REQ)) continue;
  let req; try { req = JSON.parse(readFileSync(REQ, 'utf8')); } catch { continue; }
  if (!req || req.n <= lastN) continue;
  lastN = req.n;
  let sent = '';
  try {
    if (req.action === 'meet') {
      // Current OOBE (orwellOnboarding.js): the SETUP WIZARD modal (#orwell-onboarding[data-ob-setup])
      // mounts pre-game; its "Start casting" button [data-ob-setup-start] fires the producers' hidden
      // kickoff. It is DISABLED until a narrator model resolves — poll for it enabled, then click.
      let clicked = false;
      for (let i = 0; i < 30; i++) {
        const btn = page.locator('[data-ob-setup-start]').first();
        if (await btn.count().catch(() => 0)) {
          if (!(await btn.isDisabled().catch(() => true))) { await btn.click().catch(() => {}); clicked = true; break; }
        }
        await page.waitForTimeout(1000);
      }
      sent = clicked ? '[start casting]' : '[start casting BUTTON-NOT-READY]';
      await page.waitForTimeout(2500); await waitDone();
    } else if (req.action === 'newchat') {
      await page.click('#sidebar-new-chat-btn').catch(() => {});
      sent = '[new chat]'; await page.waitForTimeout(2500);
    } else if (req.action === 'snap') {
      sent = '[snap]';
    } else if (req.card) {
      await resolveCard(req.card);
      sent = `[card picks=${(req.card.picks || []).join(',')}${req.card.text ? ' +text' : ''}]`;
      await page.waitForTimeout(1800); await waitDone();
    } else if (req.text) {
      await send(req.text); sent = req.text;
      await page.waitForTimeout(1500); const w = await waitDone();
      if (w.timeout) sent += ' [WAIT-TIMEOUT]';
    }
  } catch (e) { pageErrors.push('drive: ' + String(e.message).slice(0, 160)); }
  await capture(lastN, sent);
}
