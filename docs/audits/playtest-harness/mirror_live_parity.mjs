// mirror_live_parity.mjs — the EXECUTABLE RED GATE for ADR 0012 §3.3 / ship-gate F5 /
// refactor-roadmap R0+R2: two windows on ONE game must render a streaming turn as REALTIME
// MIRRORS — same LIVE render behaviour, within a bounded lag — not merely converge at settle.
//
// WHY THIS EXISTS (the gap mirror_filmstrip.mjs leaves open):
//   mirror_filmstrip.mjs captures BOTH windows' DOM filmstrips but its verdict only diffs the
//   *settled* transcript (diffTranscripts) — it summarises the live filmstrip, never diffs it
//   A-vs-B. So it reports "lockstep PASS" while the LIVE stream grinds. This gate diffs the live
//   render BEHAVIOUR during streaming, which is exactly where the two FE paths diverge:
//     - the SENDER window (the one that POSTed) renders deltas through createStreamRenderer —
//       finalized markdown blocks are FROZEN, only the growing tail re-renders, new tokens fade in
//       (streamingRenderer.js); few unmounts, a live ".thinking-section" accordion mounts early.
//     - the MIRROR window (resumeStream) full-innerHTML-repaints the WHOLE bubble on EVERY delta
//       (renderDelta: `contentDiv.innerHTML = processWithThinking(_combined())`); every delta
//       unmounts+remounts the entire content subtree, and reasoning is inlined as a closed <think>
//       block instead of a live accordion.
//   Same shared token stream, two different live render engines = the two-window "scratch and
//   grind". The settled text is identical (both rebuild from /api/history), which is why it
//   "winds up the same" — and why a settled-transcript gate is blind to it.
//
// THE INVARIANT (red until refactor-roadmap R2 unifies the live render path; then this is a
// permanent CI gate, ADR 0008 "two-tab concurrent-write parity gate" / R0):
//   During A's streaming turn, B's live render must MIRROR A's — comparable DOM-mutation churn
//   (neither window repaints an order of magnitude more than the other) and the same live
//   thinking-affordance — and converge within MIRROR_LAG_BUDGET_MS.
//
// Validates against the deterministic fake model (no live key) — model-independent FE-sync/render
// layer, so the gate is reproducible and CI-fast. Run via run_mirror_gate.sh (boots engine + fake
// model + FE + a started game), or against an already-standing stack:
//   node docs/audits/playtest-harness/mirror_live_parity.mjs
import { chromium, openMirrorWindow, sendTurn, waitSettled, drainMirror, transcriptOf,
  diffTranscripts, engineSnapshot, pub, writeJson } from './mirrorlib.mjs';

const HERE = new URL('.', import.meta.url).pathname;
const OUT = HERE + 'shots/mirror-live/';
const TURN = process.env.MIRROR_TURN || "(I drift into the kitchen, lean on the counter, and say hey to whoever's around.)";
// Tunables (env-overridable). Defaults are CALIBRATED from the first real run (see report).
const LAG_BUDGET_MS = parseInt(process.env.MIRROR_LAG_BUDGET_MS || '2500', 10);
const B_SETTLE_MS = parseInt(process.env.MIRROR_B_SETTLE_MS || '30000', 10);

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const A = await openMirrorWindow(browser, 'A');
const B = await openMirrorWindow(browser, 'B');

// CP0 — both windows must already be on the SAME started game (shared canonical session) or the
// mirror can't engage. A casting/pre-game session keys per-tab by design (not a bug) — skip then.
const e0 = { A: pub(await engineSnapshot(A.ctx)), B: pub(await engineSnapshot(B.ctx)) };
const baseDiff = diffTranscripts(await transcriptOf(A.page), await transcriptOf(B.page));
console.log(`CP0: started A=${e0.A.started} B=${e0.B.started} beat=${e0.A.beatSeq}/${e0.B.beatSeq} baseIdentical=${baseDiff.identical}`);
if (e0.A.started === false || e0.B.started === false) {
  console.error('\n*** PRECONDITION UNMET: game is not STARTED in both windows — the live mirror only');
  console.error('    engages on a started game (casting keys per-tab). Seed a started season first.');
  await A.ctx.close(); await B.ctx.close(); await browser.close();
  process.exit(2);
}

// CP1 — A sends one turn; B is the passive mirror. Capture both filmstrips around the stream.
const sendWall = Date.now();
console.log(`\nCP1 A sends @${sendWall}: ${JSON.stringify(TURN)}`);
await sendTurn(A.page, TURN);
const reasonA = await waitSettled(A.page);
const aSettleWall = Date.now();
// B mirrors live (resumeStream) — wait until it reaches A's settled text (or a bounded timeout).
const aText = lastAiText(await transcriptOf(A.page));
const bConvergeWall = await waitForBText(B.page, aText, B_SETTLE_MS);
const reasonB = bConvergeWall ? 'converged' : 'timeout';
console.log(`   A settled: ${reasonA} @${aSettleWall} (+${aSettleWall - sendWall}ms)`);
console.log(`   B ${reasonB}${bConvergeWall ? ` @${bConvergeWall} (+${bConvergeWall - sendWall}ms)` : ` after ${B_SETTLE_MS}ms`}`);

const mA = await drainMirror(A.page), mB = await drainMirror(B.page);
const tA = await transcriptOf(A.page), tB = await transcriptOf(B.page);
const domDiff = diffTranscripts(tA, tB);
const e1 = { A: pub(await engineSnapshot(A.ctx)), B: pub(await engineSnapshot(B.ctx)) };

// ── the live render-behaviour signature (THE thing a settled diff is blind to) ──
const endWall = Math.max(aSettleWall, bConvergeWall || aSettleWall);
const sigA = behaviorSignature(mA.film, sendWall, endWall);
const sigB = behaviorSignature(mB.film, sendWall, endWall);
const aSettleMs = aSettleWall - sendWall;
const mirrorLagMs = bConvergeWall ? (bConvergeWall - aSettleWall) : null; // how far B trails A's settle

// Settled parity is a DIAGNOSTIC, not a gate: the windows DO converge given a grace (both rebuild
// from /api/history) — that is exactly why a settled-transcript gate is blind to the live grind.
await A.page.waitForTimeout(1500); await B.page.waitForTimeout(1500);
const settledDiff = diffTranscripts(await transcriptOf(A.page), await transcriptOf(B.page));

// ── the verdict: B must mirror A's LIVE stream — render DURING A's turn, through the SAME
// incremental renderer, within a bounded lag — not sit blank then pop a late reconcile. ──
const checks = {
  bRenderedTheTurn: bConvergeWall != null,                                            // B showed it at all
  bStartsDuringAStream: sigB.firstAiRenderMs != null && sigB.firstAiRenderMs < aSettleMs, // live, not blank-then-pop
  bUsesIncrementalRenderer: sigA.liveStreamStructure && sigB.liveStreamStructure,     // same live render engine (R2)
  lagWithinBudget: mirrorLagMs != null && mirrorLagMs <= LAG_BUDGET_MS,
};
const PASS = Object.values(checks).every(Boolean);

const report = {
  meta: { turn: TURN, sendWall, reasonA, reasonB, model: process.env.FAKE_MODEL_ID || 'fake/echo-stream', lagBudgetMs: LAG_BUDGET_MS },
  engine: { converged: JSON.stringify(e1.A) === JSON.stringify(e1.B), beat: [e1.A.beatSeq, e1.B.beatSeq] },
  settledDiagnostic: { identicalAfterGrace: settledDiff.identical, atSettleDiff: domDiff.identical, firstDivergence: settledDiff.firstDivergence || null },
  liveBehaviour: { A: sigA, B: sigB, aSettleMs, mirrorLagMs },
  checks, PASS,
};
writeJson(OUT + 'mirror-live-report.json', report);
writeJson(OUT + 'film-A.json', mA.film);
writeJson(OUT + 'film-B.json', mB.film);
await A.page.screenshot({ path: OUT + 'A.png', fullPage: true }).catch(() => {});
await B.page.screenshot({ path: OUT + 'B.png', fullPage: true }).catch(() => {});

console.log('\n──── MIRROR LIVE-PARITY GATE ────');
console.log(`B rendered the turn           : ${checks.bRenderedTheTurn}`);
console.log(`B starts DURING A's stream    : A firstRender=${sigA.firstAiRenderMs}ms · A settled=${aSettleMs}ms · B firstRender=${sigB.firstAiRenderMs}ms → ${checks.bStartsDuringAStream}  (false ⇒ B sat blank, then popped a late reconcile)`);
console.log(`B uses A's live renderer      : A incrementalStream=${sigA.liveStreamStructure} · B incrementalStream=${sigB.liveStreamStructure} → ${checks.bUsesIncrementalRenderer}  (false ⇒ B never mounts the streaming container — full-repaint/reconcile)`);
console.log(`mirror lag                    : ${mirrorLagMs == null ? 'n/a' : mirrorLagMs + 'ms'}  (budget ${LAG_BUDGET_MS}ms) → ${checks.lagWithinBudget}`);
console.log(`diagnostics                   : A unmounts=${sigA.unmounts}/mounts=${sigA.mounts} accordion@${sigA.firstThinkMs}ms · B unmounts=${sigB.unmounts}/mounts=${sigB.mounts} accordion@${sigB.firstThinkMs}ms · settled-identical(after grace)=${settledDiff.identical}`);
console.log(`\nVERDICT: ${PASS ? 'PASS — two windows mirror the live stream' : 'FAIL — windows DIVERGE during streaming (B is not a realtime mirror)'}`);
console.log(`artifacts: ${OUT}`);

await A.ctx.close(); await B.ctx.close(); await browser.close();
process.exit(PASS ? 0 : 1);

// ── helpers ──
function lastAiText(transcript) {
  const ai = transcript.filter((m) => /msg-ai/.test(m.cls));
  return ai.length ? ai[ai.length - 1].text : '';
}
// Poll B until its last AI bubble reaches `target` text (normalized) — i.e. B finished mirroring.
async function waitForBText(page, target, timeoutMs) {
  const want = (target || '').replace(/\s+/g, ' ').trim();
  if (!want) return Date.now();
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const got = await page.evaluate(() => {
      const e = document.querySelectorAll('#chat-history .msg-ai');
      const el = e[e.length - 1];
      if (!el) return '';
      const c = el.cloneNode(true);
      c.querySelectorAll('.thinking-content,.thinking,[class*=thinking],.msg-footer,.role').forEach((n) => n.remove());
      return (c.innerText || '').replace(/\s+/g, ' ').trim();
    });
    // tolerate trailing-whitespace / streaming-cursor: B has converged once it CONTAINS A's text.
    if (got && (got === want || got.includes(want) || want.includes(got) && got.length >= want.length * 0.95)) return Date.now();
    await page.waitForTimeout(120);
  }
  return null;
}
// The live render-behaviour signature over the streaming window [sendWall, endWall].
// Full-innerHTML-repaint (renderDelta) => an unmount+mount burst of the content subtree PER delta
// => high unmount churn. Incremental (createStreamRenderer) freezes blocks => few unmounts, mostly
// char mutations. A live thinking accordion mounts ".thinking-section/.thinking-content/.live-think".
function behaviorSignature(film, sendWall, endWall) {
  const win = (film || []).filter((f) => f.wall >= sendWall - 300 && f.wall <= endWall + 300);
  const unmounts = win.filter((f) => f.ev === 'unmount').length;
  const mounts = win.filter((f) => f.ev === 'mount').length;
  const chars = win.filter((f) => f.ev === 'char').length;
  // AI-content render events (mount/char under the assistant message — not the user's own bubble).
  const aiish = (f) => /msg-ai|thinking|live-think|stream-content|streaming|live-reply|\bbody\b/i.test((f.cls || '') + '|' + (f.parent || ''));
  const aiEvents = win.filter((f) => (f.ev === 'mount' || f.ev === 'char') && aiish(f));
  const firstAiRenderMs = aiEvents.length ? (aiEvents[0].wall - sendWall) : null;
  const lastAiRenderMs = aiEvents.length ? (aiEvents[aiEvents.length - 1].wall - sendWall) : null;
  const thinkMounts = win.filter((f) => f.ev === 'mount' && /think/i.test(f.cls || ''));
  // The incremental sender renderer (createStreamRenderer + _ensureStreamLayout) mounts these live
  // streaming containers; the mirror's full-innerHTML-repaint (renderDelta) never does.
  const liveStreamStructure = win.some((f) => f.ev === 'mount' && /streaming|stream-content|live-reply-content/i.test(f.cls || ''));
  return {
    unmounts, mounts, chars,
    firstAiRenderMs, lastAiRenderMs,
    renderSpreadMs: (firstAiRenderMs != null && lastAiRenderMs != null) ? (lastAiRenderMs - firstAiRenderMs) : null,
    liveAccordion: thinkMounts.length > 0,
    firstThinkMs: thinkMounts.length ? (thinkMounts[0].wall - sendWall) : null,
    liveStreamStructure,
    window: [0, endWall - sendWall],
  };
}
