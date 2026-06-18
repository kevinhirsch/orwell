// Drive the game like the real world: the LLM plays THROUGH the front-end UI,
// the engine is the real world, every beat is screenshotted, decisions are made
// on the on-screen decision card. Debugs each turn.
import { readFileSync, writeFileSync } from 'fs';
import { chromium } from 'playwright';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:7000';
const MAX_TURNS = parseInt(process.env.MAX_TURNS || '40', 10);
const SHOTS = new URL('./shots/game/', import.meta.url).pathname;
const sec = Object.fromEntries(readFileSync(new URL('./.secrets.env', import.meta.url), 'utf8')
  .split('\n').filter(Boolean).map(l => l.split('=').map(s => s.trim())).map(([k, ...v]) => [k, v.join('=')]));
const ENGINE_TOOLS = new Set(['advanceGame','runCompetition','getGameState','gameStatus','submitDecision',
  'recordInteraction','surfaceInformationTo','socialRead','getVisibleStateFor','askProducers']);

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.request.post(BASE + '/api/auth/login', { data: { username: sec.ADMIN_USER, password: sec.ADMIN_PW } });
const page = await ctx.newPage();

// Capture engine tool calls the LLM makes, by sniffing the SSE deltas in-page.
const toolCalls = [];
page.on('response', () => {}); // no-op; we read tools from the engine status deltas below
await page.addInitScript(() => {
  window.__tools = [];
  const of = window.fetch;
  window.fetch = async function (u, o) {
    const r = await of.apply(this, arguments);
    try {
      if (String(u).includes('/api/chat_stream')) {
        const clone = r.clone(); const reader = clone.body.getReader(); const dec = new TextDecoder(); let buf = '';
        (async () => { for (;;) { const { done, value } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true }); let i;
          while ((i = buf.indexOf('\n\n')) >= 0) { const ln = buf.slice(0, i); buf = buf.slice(i + 2);
            const m = ln.match(/^data: (.*)$/s); if (!m || m[1] === '[DONE]') continue;
            try { const j = JSON.parse(m[1]); if (j.type === 'tool_start' && j.tool) window.__tools.push(j.tool); } catch {} } } })();
      }
    } catch {}
    return r;
  };
});

await page.goto(BASE + '/', { waitUntil: 'load', timeout: 30000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(3500);

// FRESH chat session — the door-created game leaves a casting-interview session
// whose history biases the model to keep casting. A clean session gets the live
// in-game moment prompt with no stale context.
await page.click('#sidebar-new-chat-btn').catch(() => {});
await page.waitForTimeout(1800);

// Robust send: typing flips .send-btn from "newchat" to "send"; click it (Enter
// can be swallowed right after a new-chat click).
async function send(text) {
  await page.fill('#message', text);
  await page.waitForTimeout(350);
  const mode = await page.evaluate(() => document.querySelector('.send-btn')?.getAttribute('data-mode'));
  if (mode === 'send') await page.click('.send-btn').catch(() => {});
  else await page.keyboard.press('Enter');
}

async function engineStatus() {
  return ctx.request.get(BASE + '/api/orwell/status').then(r => r.json()).catch(() => ({}));
}
async function engineState() {
  return ctx.request.get(BASE + '/api/orwell/state').then(r => r.json()).catch(() => ({}));
}
async function waitStreamDone(timeoutMs = 110000) {
  // GM reply stabilises (last assistant message length unchanged) then settle.
  let last = -1, stable = 0; const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await page.waitForTimeout(1200);
    const len = await page.evaluate(() => {
      const els = document.querySelectorAll('#chat-history .msg-ai');
      const el = els[els.length - 1]; return el ? (el.innerText || '').length : 0;
    });
    if (len > 0 && len === last) { if (++stable >= 4) return; } else stable = 0;
    last = len;
  }
}
async function handleDecisionCard() {
  // If the structured decision card is up, resolve it through the UI.
  const card = await page.$('#orwell-decision-card');
  if (!card) return null;
  await page.waitForTimeout(400);
  const info = await page.evaluate(() => {
    const c = document.getElementById('orwell-decision-card');
    const opts = [...c.querySelectorAll('.odec-opt')];
    return { kind: c.getAttribute('data-kind') || '', n: opts.length,
      title: (c.querySelector('.odec-title')?.innerText || '').trim(),
      opts: opts.map(o => (o.innerText || '').trim()) };
  });
  // pick count: nominations=2 else 1; tones/intents are single-pick
  const pick = /nominat/i.test(info.title) ? 2 : 1;
  const optEls = await page.$$('#orwell-decision-card .odec-opt');
  for (let i = 0; i < pick && i < optEls.length; i++) { await optEls[i].click(); await page.waitForTimeout(150); }
  // optional goodbye text
  const ta = await page.$('#orwell-decision-card textarea');
  if (ta) await ta.fill('Genuinely a pleasure — play with honor.').catch(() => {});
  await page.screenshot({ path: SHOTS + `decision-${info.kind || info.title.slice(0,12).replace(/\W+/g,'')}.png`, fullPage: true }).catch(() => {});
  await page.click('#orwell-decision-card .odec-confirm').catch(() => {});
  await page.waitForTimeout(1500);
  return info;
}

// Answer the agent's inline ask_user card (the model's own decision UI). Clicking
// an option auto-sends the label, which triggers the next GM turn.
async function handleAskUser() {
  const card = await page.$('.ask-user-card');
  if (!card) return null;
  const info = await page.evaluate(() => {
    const c = document.querySelector('.ask-user-card');
    const opts = [...c.querySelectorAll('.ask-user-option')].map(o => (o.innerText || '').trim());
    const q = (c.querySelector('.ask-user-question')?.innerText || '').trim();
    return { q, opts };
  });
  // Strategy: play to win / move the game forward — prefer compete/use/vote-ish.
  const els = await page.$$('.ask-user-option');
  let idx = 0;
  const pref = info.opts.findIndex(o => /compete|use it|evict|vote|yes|accept|target|nominate/i.test(o));
  if (pref >= 0) idx = pref;
  await page.screenshot({ path: SHOTS + `ask-${Date.now()%100000}.png`, fullPage: true }).catch(() => {});
  if (els[idx]) await els[idx].click();
  await page.waitForTimeout(1200);
  return { ...info, chose: info.opts[idx] };
}

// Fourth-wall leak detector — the GM must NEVER expose the machinery to the player.
const LEAK_RE = /\b(engine|advanceGame|advance the game|game state|game status|submitDecision|runCompetition|getGameState|pending decision|tool call|tool result|the tool|let me (check|try advanc)|i'?ll lock that in|exit_code)\b/i;

const dbg = [];
let prevSig = '', stall = 0;
// In-character player voice — a real houseguest never says "engine"/"advance"/"tool".
const NUDGES = [
  "Okay, I'm ready — let's get the next competition going. I'm playing to win.",
  "Take me into whatever's next — a comp, a ceremony, the vote, whatever the house is on.",
  "Let's keep the week moving. Put me in the middle of the next big moment.",
  "I'm ready for what's next — let's push to the next thing that matters.",
];
let nudge = "Alright — I'm Avery Quinn, and I came to win. Let's get this season going: walk me through " +
            "move-in and the first Head of Household fight, and where I land in it. When something's my " +
            "call to make, put it to me straight.";

for (let t = 1; t <= MAX_TURNS; t++) {
  const before = await engineStatus();
  await page.evaluate(() => { window.__tools = []; });

  // ── perform ONE action this turn ──
  let actedVia = 'nudge';
  const cardOpen = await page.$('#orwell-decision-card');
  const askOpen = await page.$('.ask-user-card');
  let structured = null, asked = null;
  if (cardOpen) { structured = await handleDecisionCard(); actedVia = 'decision-card'; await send('Locked in. What happens?'); }
  else if (askOpen) { asked = await handleAskUser(); actedVia = 'ask_user'; }   // click auto-sends
  else { await send(nudge); }

  await page.waitForTimeout(1500);
  await waitStreamDone();
  await page.waitForTimeout(2500); // let status poll surface any pending + HUD update

  const tools = await page.evaluate(() => window.__tools || []);
  const engineTools = tools.filter(x => ENGINE_TOOLS.has(x));
  // Split the VISIBLE narration (what the player reads) from the collapsible
  // .thinking-content reasoning, so a leak in the player-facing message is judged
  // separately from a leak in hidden reasoning.
  const vis = await page.evaluate(() => {
    const els = document.querySelectorAll('#chat-history .msg-ai');
    const el = els[els.length - 1]; if (!el) return { msg: '', think: '' };
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.thinking-content, .thinking, [class*="thinking"], .msg-footer').forEach(n => n.remove());
    return { msg: (clone.innerText || '').replace(/\s+/g, ' ').trim(),
      think: [...el.querySelectorAll('.thinking-content')].map(n => n.innerText).join(' ').replace(/\s+/g, ' ').slice(0, 300) };
  });
  const narration = vis.msg;
  await page.screenshot({ path: SHOTS + `turn-${String(t).padStart(2,'0')}.png`, fullPage: true }).catch(() => {});

  const after = await engineStatus();
  const gs = await engineState();
  const D = { n: t, actedVia,
    phaseBefore: `${before.week}/${before.phase}`, phaseAfter: `${after.week}/${after.phase}`,
    hoh: after.hoh?.name || null, nominees: (after.nominees || []).map(n => n.name),
    veto: after.veto || null, pending: after.pending?.kind || null,
    engineTools, calledEngine: engineTools.length > 0,
    narration: narration.slice(0, 220), narrationLen: narration.length,
    structured: structured ? (structured.kind || structured.title) : null,
    askUser: asked ? { q: asked.q.slice(0,80), opts: asked.opts, chose: asked.chose } : null,
    leak: (vis.msg.match(LEAK_RE) || [null])[0],          // CRITICAL: player-visible message
    thinkLeak: (vis.think.match(LEAK_RE) || [null])[0],   // secondary: hidden reasoning
    activeCount: (gs.house || []).filter(h => h.status === 'active').length + (gs.player?.status === 'active' ? 1 : 0),
    playerStatus: gs.player?.status };
  dbg.push(D);
  console.log(`\n── TURN ${t} [${actedVia}] | ${D.phaseBefore}→${D.phaseAfter} HOH=${D.hoh} noms=[${D.nominees}] pending=${D.pending} active=${D.activeCount}`);
  console.log(`   engineTools=[${engineTools.join(',')}] narr(${narration.length}): ${narration.slice(0,140)}`);
  if (D.leak) console.log(`   ⚠️  VISIBLE LEAK: "${D.leak}" in the player-facing message`);
  else if (D.thinkLeak) console.log(`   · (reasoning-only mention: "${D.thinkLeak}" — hidden from player)`);
  if (asked) console.log(`   ask_user: "${asked.q.slice(0,70)}" opts=[${asked.opts}] → chose "${asked.chose}"`);
  if (structured) console.log(`   decision-card: ${structured.kind || structured.title} opts=[${structured.opts}]`);
  writeFileSync(SHOTS + 'debug.json', JSON.stringify(dbg, null, 2));

  if (gs.finished || after.phase === 'finished' || gs.player?.status === 'evicted') {
    console.log(`\n=== GAME OVER phase=${after.phase} playerStatus=${gs.player?.status} winner=${gs.winner?.name||gs.winner||'?'} active=${D.activeCount} ===`);
    dbg.push({ end: true, phase: after.phase, playerStatus: gs.player?.status, winner: gs.winner || null });
    break;
  }
  const sig = `${after.week}/${after.phase}/${after.pending?.kind||''}/${(after.nominees||[]).length}`;
  if (sig === prevSig && actedVia === 'nudge' && !D.calledEngine) { if (++stall >= 5) { console.log('\n=== STALLED — no progress ==='); dbg.push({ stalled: true, at: sig }); break; } }
  else stall = 0;
  prevSig = sig;
  nudge = NUDGES[t % NUDGES.length];
}
writeFileSync(SHOTS + 'debug.json', JSON.stringify(dbg, null, 2));
await b.close();
console.log('\n===== UI GAME LOOP DONE: ' + dbg.length + ' records =====');
