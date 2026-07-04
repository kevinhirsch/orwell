// mirror_toolturn_parity.mjs — the SETTLED two-window parity gate for a TOOL-RICH (multi-round)
// turn — the class mirror_live_parity.mjs never exercises. That gate's fake model only ever streams
// a single-round plain-text reply; real game turns are almost always tool-rich
// (advanceGame/recordInteraction/whereabouts…), so the agent-loop MULTI-ROUND path and the
// observer's resumeStream `rich=true` path (chat.js ~4607–4653: rich replies discard the live holder
// and fall back to a full `sessionModule.selectSession` reload) were UNTESTED by the mirror gate.
// That is exactly the class the user's "duplicating messages" report lives in (H1/H2 of the mirror
// audit).
//
// Drives a real two-round tool-call turn against `fake_model_server.mjs` FAKE_SCRIPT=toolturn (round
// 1: narration + a streamed `whereabouts` tool_calls delta, finish_reason "tool_calls"; round 2: the
// final reply, finish_reason "stop" — see that file's header). Window A sends the turn through the
// real composer; window B is the passive peer. After BOTH windows settle, asserts:
//
//   1. Each window's VISIBLE `.msg` bubble count equals the server's EXPECTED bubble count — NOT a
//      raw 1-bubble-per-message count (a tool-rich message with N non-empty narration rounds
//      legitimately renders as N bubbles on reload — chatRenderer.addMessage's "Agent multi-bubble
//      reconstruction", chatRenderer.js ~1929/L6c — sharing one data-db-id; chat.js's
//      `_expectedVisibleBubbleCount` computes the same oracle this test mirrors). An orphan bubble
//      (extra) or a missing one both fail this.
//   2. The two windows' settled transcripts are byte-identical (`diffTranscripts`).
//   3. No non-trivial bubble TEXT repeats within a single window's own transcript (a literal
//      "duplicated the LLM's message" symptom a count-only check can miss if one dup replaces one
//      drop).
//
// Run via run_mirror_gate.sh (MIRROR_TOOLTURN=1) or standalone against an already-standing stack
// booted with FAKE_SCRIPT=toolturn:
//   node docs/audits/playtest-harness/mirror_toolturn_parity.mjs
import { chromium, openMirrorWindow, sendTurn, drainMirror, transcriptOf,
  diffTranscripts, engineSnapshot, pub, writeJson } from './mirrorlib.mjs';

const HERE = new URL('.', import.meta.url).pathname;
const OUT = HERE + 'shots/mirror-toolturn/';
const TURN = process.env.MIRROR_TURN || "(I glance around the room, curious who's nearby.)";
const A_SETTLE_MS = parseInt(process.env.MIRROR_TOOLTURN_A_SETTLE_MS || '45000', 10);
const B_SETTLE_MS = parseInt(process.env.MIRROR_TOOLTURN_B_SETTLE_MS || '30000', 10);

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const A = await openMirrorWindow(browser, 'A');
const B = await openMirrorWindow(browser, 'B');

const e0 = { A: pub(await engineSnapshot(A.ctx)), B: pub(await engineSnapshot(B.ctx)) };
console.log(`CP0: started A=${e0.A.started} B=${e0.B.started} beat=${e0.A.beatSeq}/${e0.B.beatSeq}`);
if (e0.A.started === false || e0.B.started === false) {
  console.error('\n*** PRECONDITION UNMET: game is not STARTED in both windows.');
  await A.ctx.close(); await B.ctx.close(); await browser.close();
  process.exit(2);
}

const sendWall = Date.now();
console.log(`\nCP1 A sends a tool-rich turn @${sendWall}: ${JSON.stringify(TURN)}`);
await sendTurn(A.page, TURN);

// Wait for A to run BOTH rounds to completion: the tool thread finishes (no `.running` node) AND the
// round-2 reply settles (a footer on the last AI bubble, non-placeholder text, SSE eof).
const reasonA = await waitToolTurnSettled(A.page, A_SETTLE_MS);
const aSettleWall = Date.now();
console.log(`   A settled: ${reasonA} @${aSettleWall} (+${aSettleWall - sendWall}ms)`);

// B is the passive peer: give it the same settle window (its own tool-thread + reply must land too).
const reasonB = await waitToolTurnSettled(B.page, B_SETTLE_MS);
const bSettleWall = Date.now();
console.log(`   B settled: ${reasonB} @${bSettleWall} (+${bSettleWall - sendWall}ms)`);

// Extra grace: both windows' own reconcile passes (softReloadHistory adopt/rebuild) run on a short
// debounce after the stream ends — let them land before taking the SETTLED snapshot.
await A.page.waitForTimeout(2000); await B.page.waitForTimeout(2000);

const sessionIdA = await A.page.evaluate(() => (window.sessionModule && window.sessionModule.getCurrentSessionId && window.sessionModule.getCurrentSessionId()) || null);
const sessionIdB = await B.page.evaluate(() => (window.sessionModule && window.sessionModule.getCurrentSessionId && window.sessionModule.getCurrentSessionId()) || null);
const histA = await fetchHistory(A.page, sessionIdA);
const histB = await fetchHistory(B.page, sessionIdB);

const tA = await transcriptOf(A.page), tB = await transcriptOf(B.page);
const domDiff = diffTranscripts(tA, tB);
const mA = await drainMirror(A.page), mB = await drainMirror(B.page);
const e1 = { A: pub(await engineSnapshot(A.ctx)), B: pub(await engineSnapshot(B.ctx)) };

const visibleCountA = tA.length;
const visibleCountB = tB.length;
const serverVisibleA = histA.visibleCount;
const serverVisibleB = histB.visibleCount;

const dupA = findDupedText(tA);
const dupB = findDupedText(tB);

const checks = {
  aCountMatchesServer: visibleCountA === serverVisibleA,
  bCountMatchesServer: visibleCountB === serverVisibleB,
  transcriptsIdentical: domDiff.identical,
  noDupTextInA: dupA.length === 0,
  noDupTextInB: dupB.length === 0,
  sessionIdsShared: !!sessionIdA && sessionIdA === sessionIdB,
};
const PASS = Object.values(checks).every(Boolean);

const report = {
  meta: { turn: TURN, sendWall, reasonA, reasonB, aSettleWall, bSettleWall, sessionIdA, sessionIdB },
  engine: { converged: JSON.stringify(e1.A) === JSON.stringify(e1.B), beat: [e1.A.beatSeq, e1.B.beatSeq] },
  counts: { visibleCountA, serverVisibleA, visibleCountB, serverVisibleB },
  duplicates: { A: dupA, B: dupB },
  transcriptDiff: domDiff.identical ? null : domDiff.firstDivergence,
  checks, PASS,
};
writeJson(OUT + 'mirror-toolturn-report.json', report);
writeJson(OUT + 'transcript-A.json', tA);
writeJson(OUT + 'transcript-B.json', tB);
writeJson(OUT + 'history-A.json', histA.raw);
writeJson(OUT + 'history-B.json', histB.raw);
writeJson(OUT + 'film-A.json', mA.film);
writeJson(OUT + 'film-B.json', mB.film);
await A.page.screenshot({ path: OUT + 'A.png', fullPage: true }).catch(() => {});
await B.page.screenshot({ path: OUT + 'B.png', fullPage: true }).catch(() => {});

console.log('\n──── MIRROR TOOL-TURN (multi-round) PARITY GATE ────');
console.log(`A visible bubbles=${visibleCountA} vs server visible=${serverVisibleA} → ${checks.aCountMatchesServer}`);
console.log(`B visible bubbles=${visibleCountB} vs server visible=${serverVisibleB} → ${checks.bCountMatchesServer}`);
console.log(`transcripts identical A vs B        → ${checks.transcriptsIdentical}`);
if (!checks.transcriptsIdentical) console.log(`   first divergence: ${JSON.stringify(domDiff.firstDivergence)}`);
console.log(`no duplicated bubble text in A       → ${checks.noDupTextInA}${dupA.length ? '  DUPES: ' + JSON.stringify(dupA) : ''}`);
console.log(`no duplicated bubble text in B       → ${checks.noDupTextInB}${dupB.length ? '  DUPES: ' + JSON.stringify(dupB) : ''}`);
console.log(`both windows on the same session id  → ${checks.sessionIdsShared} (A=${sessionIdA} B=${sessionIdB})`);
console.log(`\nVERDICT: ${PASS ? 'PASS — no duplication/orphans across two windows on a tool-rich turn' : 'FAIL — see counts/dupes/transcript above'}`);
console.log(`artifacts: ${OUT}`);

await A.ctx.close(); await B.ctx.close(); await browser.close();
process.exit(PASS ? 0 : 1);

// ── helpers ──

// Settled = the tool thread finished (no `.agent-thread-node.running`) AND the last AI bubble carries
// a footer with non-placeholder text AND the SSE stream reported eof/done. The OBSERVER window never
// fetches /api/chat_stream itself (it mirrors via resumeStream + the settled reconcile), so its
// __mirror.sse never reports eof — for it, settle on TEXT STABILITY (last AI bubble non-placeholder,
// no running tool node, unchanged for ~3s) instead of waiting out the whole timeout.
async function waitToolTurnSettled(page, timeoutMs) {
  const t0 = Date.now();
  let last = -1, stable = 0;
  while (Date.now() - t0 < timeoutMs) {
    await page.waitForTimeout(500);
    const info = await page.evaluate(() => {
      const sseDone = (window.__mirror && window.__mirror.sse || []).some((s) => s.kind === 'eof' || s.kind === 'done');
      const running = document.querySelectorAll('.agent-thread-node.running').length;
      const errShown = !!document.querySelector('#chat-history .msg-system');
      const ai = document.querySelectorAll('#chat-history .msg-ai');
      const el = ai[ai.length - 1];
      if (!el) return { done: false, ph: true, running, sseDone, errShown, len: 0 };
      const c = el.cloneNode(true); c.querySelectorAll('.thinking-content,.thinking,[class*=thinking],.msg-footer').forEach((n) => n.remove());
      const txt = (c.innerText || '').trim();
      return { len: txt.length, done: !!el.querySelector('.msg-footer'), ph: /^(thinking|still|generating)/i.test(txt) || txt.length < 8, running, sseDone, errShown };
    });
    if (info.errShown && info.sseDone) return 'error-or-no-model';
    if (info.sseDone && info.running === 0 && info.done && !info.ph) return 'settled';
    if (info.sseDone && info.running === 0 && info.len > 8) { await page.waitForTimeout(600); return 'sse-eof-idle'; }
    // Observer path: no own SSE — settle when the rendered turn is stable for 6 consecutive polls.
    if (!info.ph && info.running === 0 && info.len > 8 && info.len === last) {
      if (++stable >= 6) return 'stable';
    } else stable = 0;
    last = info.len;
  }
  return 'timeout';
}

// Fetch /api/history/{id} from IN-PAGE (reuses the browser's session cookie) and compute the same
// "visible" filter softReloadHistory applies (drop skippable user prompts) so the count is the exact
// oracle chat.js's own dedup-hardening check (`_visibleMsgCount` vs server `visible.length`) uses.
async function fetchHistory(page, sessionId) {
  if (!sessionId) return { visibleCount: 0, raw: null };
  return page.evaluate(async (id) => {
    const res = await fetch(`/api/history/${id}`);
    if (!res.ok) return { visibleCount: 0, raw: null };
    const data = await res.json();
    const cm = window.chatModule || {};
    const isSkippable = cm.isSkippableUserPrompt || (() => false);
    const textOf = (m) => {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) return m.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
      return '';
    };
    const visible = (data.history || []).filter((m) => !(m.role === 'user' && isSkippable(textOf(m))));
    // Use the SAME oracle chat.js's own reconcile uses (_expectedVisibleBubbleCount) so a
    // legitimately multi-bubble tool-rich message isn't flagged as an orphan. Falls back to a
    // raw 1:1 count if the browser-exposed helper isn't present (older build / non-game chat).
    const visibleCount = cm._expectedVisibleBubbleCount
      ? cm._expectedVisibleBubbleCount(visible)
      : visible.length;
    return { visibleCount, raw: data };
  }, sessionId);
}

// A non-trivial (>12 char) bubble text that appears MORE THAN ONCE in one window's own transcript —
// the literal "duplicated the LLM's message" symptom.
function findDupedText(transcript) {
  const seen = new Map();
  for (const m of transcript) {
    const t = (m.text || '').trim();
    if (t.length < 12) continue;
    seen.set(t, (seen.get(t) || 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([text, n]) => ({ text: text.slice(0, 80), n }));
}
