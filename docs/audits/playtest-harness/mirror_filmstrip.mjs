// mirror_filmstrip.mjs — the "Messenger mirror" two-window verification harness (single run).
//
// Opens TWO browser windows on the SAME game, drives ONE turn from window A, and records for
// BOTH windows, timestamp-aligned on a shared wall clock:
//   (a) the streamed SSE token timeline (every /api/chat_stream delta, reply + reasoning + tool
//       + finish + done) — captured via a fetch tee installed before any app script; and
//   (b) a DOM filmstrip (MutationObserver log of #chat-history).
// It then emits a DIFF REPORT: are the two windows' SETTLED rendered transcripts byte-identical?
// If not, where do they FIRST diverge (message index + char offset + context), and at what time?
//
// Window B is the MIRROR — it never sends; it must converge to A's transcript via the FE's
// cross-tab/cross-device sync (orwell:gamechanged poll + the 0064 server-push + 0065 beatSeq).
//
// Validates end-to-end against the STUB narrator (no live key) — the divergence diff works on
// stub/error/echo text exactly as on live narration. With a live key the same run exercises real
// streamed narration. See the env contract in the header doc.
//
//   node docs/audits/playtest-harness/mirror_filmstrip.mjs
//   MIRROR_TURN="(I wander into the kitchen and say hey.)" node docs/audits/playtest-harness/mirror_filmstrip.mjs
import { chromium, openMirrorWindow, sendTurn, waitSettled, drainMirror, transcriptOf, diffTranscripts, streamReplyText, streamReasoningText, engineSnapshot, pub, writeJson, BASE } from './mirrorlib.mjs';

const HERE = new URL('.', import.meta.url).pathname;
const OUT = HERE + 'shots/mirror/';
const TURN = process.env.MIRROR_TURN || "(I drift into the kitchen, lean on the counter, and say hey to whoever's around — just getting a read on the room.)";
const SYNC_WAIT = parseInt(process.env.MIRROR_SYNC_WAIT_MS || '12000', 10); // let B's poll + server-push settle

const browser = await chromium.launch();
const A = await openMirrorWindow(browser, 'A');
const B = await openMirrorWindow(browser, 'B');

// CP0 — baseline: both windows on the same game must already match.
const e0 = { A: pub(await engineSnapshot(A.ctx)), B: pub(await engineSnapshot(B.ctx)) };
const t0 = { A: await transcriptOf(A.page), B: await transcriptOf(B.page) };
const base = diffTranscripts(t0.A, t0.B);
console.log(`CP0 baseline: engineMatch=${JSON.stringify(e0.A) === JSON.stringify(e0.B)} transcriptIdentical=${base.identical} n=${JSON.stringify(base.n)} beat=${e0.A.beatSeq}/${e0.B.beatSeq}`);
if (!base.identical) console.log('   baseline divergence:', JSON.stringify(base.firstDivergence));

// CP1 — drive one turn from A; B is the passive mirror.
const sendWall = Date.now();
console.log(`\nCP1 sending turn from A @${sendWall}: ${JSON.stringify(TURN)}`);
await sendTurn(A.page, TURN);
const reasonA = await waitSettled(A.page);
console.log(`   A settled: ${reasonA}`);
// Give B time to receive the sync push + poll and re-render.
await B.page.waitForTimeout(SYNC_WAIT);
const reasonB = await waitSettled(B.page, 30000).catch(() => 'timeout');
console.log(`   B settled: ${reasonB}`);

// Capture both rails.
const mA = await drainMirror(A.page), mB = await drainMirror(B.page);
const tA = await transcriptOf(A.page), tB = await transcriptOf(B.page);
const e1 = { A: pub(await engineSnapshot(A.ctx)), B: pub(await engineSnapshot(B.ctx)) };

// DIFF — the settled rendered transcript (the mirror invariant).
const domDiff = diffTranscripts(tA, tB);

// If the LIVE mirror diverged, reload B to CLASSIFY the divergence: does the persisted
// conversation reconcile (render-layer / transient) or stay split (data-layer / persistent)?
let reloadDiff = null;
if (!domDiff.identical) {
  try {
    await B.page.reload({ waitUntil: 'load', timeout: 30000 });
    await B.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await B.page.waitForTimeout(4500);
    await B.page.evaluate(() => { const o = document.getElementById('orwell-onboarding'); if (o) o.remove(); document.querySelectorAll('[inert]').forEach((n) => { try { n.inert = false; } catch (_) {} }); });
    await B.page.waitForTimeout(800);
    const tBr = await transcriptOf(B.page);
    reloadDiff = diffTranscripts(tA, tBr);
    console.log(`   B reload-reconcile: identical=${reloadDiff.identical} (n=${JSON.stringify(reloadDiff.n)})`);
  } catch (e) { reloadDiff = { error: String(e).slice(0, 120) }; }
}
// DIFF — the streamed token text (only A streams; B should arrive at the same text post-sync).
const replyA = streamReplyText(mA.sse), reasoningA = streamReasoningText(mA.sse);
const replyB = streamReplyText(mB.sse); // usually empty (B didn't stream) — informational

await A.page.screenshot({ path: OUT + 'A.png', fullPage: true }).catch(() => {});
await B.page.screenshot({ path: OUT + 'B.png', fullPage: true }).catch(() => {});

const report = {
  meta: { turn: TURN, sendWall, syncWaitMs: SYNC_WAIT, base: BASE, reasonA, reasonB, liveKey: !!process.env.ORWELL_TEST_OPENROUTER_KEY, model: process.env.ORWELL_TEST_MODEL || '(stub/unset)' },
  cp0_baseline: { engineMatch: JSON.stringify(e0.A) === JSON.stringify(e0.B), engine: e0, diff: base },
  cp1_afterTurn: {
    engineMatch: JSON.stringify(e1.A) === JSON.stringify(e1.B), engine: e1,
    transcriptIdentical: domDiff.identical, msgCount: domDiff.n, firstDivergence: domDiff.firstDivergence || null,
    streamedReplyChars: replyA.length, streamedReasoningChars: reasoningA.length, bStreamedChars: replyB.length,
    reloadReconcile: reloadDiff ? { identical: reloadDiff.identical, n: reloadDiff.n, classification: reloadDiff.identical ? 'TRANSIENT (render-layer; reload reconciles — live cross-tab chat sync gap)' : 'PERSISTENT (data-layer; diverges even after reload)' } : null,
  },
  sseTimeline: { A: summarizeSse(mA), B: summarizeSse(mB) },
  filmstrip: { A: summarizeFilm(mA.film), B: summarizeFilm(mB.film) },
  jsErrors: { A: mA.errors, B: mB.errors },
  net: { A: A.net, B: B.net },
};
writeJson(OUT + 'mirror-report.json', report);
// Full timelines (large) — separate files so the report stays glanceable.
writeJson(OUT + 'sse-A.json', mA.sse);
writeJson(OUT + 'sse-B.json', mB.sse);
writeJson(OUT + 'film-A.json', mA.film);
writeJson(OUT + 'film-B.json', mB.film);
writeJson(OUT + 'transcript-A.json', tA);
writeJson(OUT + 'transcript-B.json', tB);

// ── verdict ──
console.log('\n──── MIRROR DIFF REPORT ────');
console.log(`engine converged:      ${report.cp1_afterTurn.engineMatch}  (beat A=${e1.A.beatSeq} B=${e1.B.beatSeq})`);
console.log(`transcript identical:  ${domDiff.identical}  (msgs A=${domDiff.n[0]} B=${domDiff.n[1]})`);
console.log(`A streamed:            reply=${replyA.length} chars, reasoning=${reasoningA.length} chars, sseEvents=${mA.sse.length}`);
console.log(`B streamed:            reply=${replyB.length} chars, sseEvents=${mB.sse.length} (mirror — expected ~0 stream, converges via sync)`);
console.log(`JS errors:             A=${mA.errors.length} B=${mB.errors.length}`);
if (!domDiff.identical) {
  const d = domDiff.firstDivergence;
  console.log('\n*** TRANSCRIPTS DIVERGE ***');
  if (d.reason) console.log(`  ${d.reason} at message ${d.msgIndex}: A=${JSON.stringify(d.a)} B=${JSON.stringify(d.b)}`);
  else {
    console.log(`  first divergence at message ${d.msgIndex} (cls A=${d.cls[0]} B=${d.cls[1]}), char offset ${d.charOffset}:`);
    console.log(`    A: …${d.a}…`);
    console.log(`    B: …${d.b}…`);
  }
  // timestamp-align: when did A vs B last mutate the chat?
  console.log(`  A last chat mutation @t=${lastMutT(mA.film)}ms (wall ${lastMutWall(mA.film)}), B @t=${lastMutT(mB.film)}ms (wall ${lastMutWall(mB.film)})`);
  if (reloadDiff) console.log(`  classification: ${reloadDiff.identical ? 'TRANSIENT — reload reconciles (render-layer cross-tab chat-sync gap; engine + persisted convo intact)' : 'PERSISTENT — diverges even after reload (data-layer)'}`);
}
console.log(`\nartifacts: ${OUT}`);
console.log('MIRROR FILMSTRIP DONE');

await A.ctx.close(); await B.ctx.close(); await browser.close();
process.exit(domDiff.identical ? 0 : 1);

// ── helpers ──
function summarizeSse(m) {
  const byKind = {}; for (const s of m.sse) byKind[s.kind] = (byKind[s.kind] || 0) + 1;
  const finish = m.sse.filter((s) => s.kind === 'finish').map((s) => s.reason);
  const tools = m.sse.filter((s) => s.type === 'tool_start' || s.type === 'tool_output' || s.kind === 'tool_call_delta').map((s) => s.tool).filter(Boolean);
  return { events: m.sse.length, byKind, finishReasons: finish, tools, firstWall: m.sse[0]?.wall || null, lastWall: m.sse[m.sse.length - 1]?.wall || null };
}
function summarizeFilm(film) {
  const byEv = {}; for (const f of film) byEv[f.ev] = (byEv[f.ev] || 0) + 1;
  return { mutations: film.length, byEv, firstWall: film[0]?.wall || null, lastWall: film[film.length - 1]?.wall || null };
}
function lastMutT(film) { return film.length ? film[film.length - 1].t : null; }
function lastMutWall(film) { return film.length ? film[film.length - 1].wall : null; }
