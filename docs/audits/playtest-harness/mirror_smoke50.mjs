// mirror_smoke50.mjs — the 50× concurrent two-window "mirror" smoke loop.
//
// A single clean pass proves nothing about a race. This holds TWO persistent windows on the SAME
// game and, each iteration, fires a turn in BOTH windows NEAR-SIMULTANEOUSLY (the concurrent-write
// scenario that produces the mirror "garbage"), lets both settle + cross-sync, then asserts parity:
//   - engine converged (same beatSeq / phase / pending across both windows)
//   - settled transcripts BYTE-IDENTICAL (the mirror invariant)
//   - no unrecovered HTTP 409 (stale-beat must reconcile, not strand a window)
//   - no JS errors
// Repeats N times (default 50). Aggregates pass/fail; on the FIRST divergence it dumps that
// iteration's full filmstrip + SSE timeline for BOTH windows and the transcript diff, then keeps
// going to gather the failure rate. Exits NON-ZERO if any iteration diverged.
//
// Works on the stub narrator (concurrent error/echo turns still exercise the merge/sync paths) and
// on a live key. Tune iterations with MIRROR_N; per-turn settle budget with MIRROR_SETTLE_MS.
//
//   MIRROR_N=50 node docs/audits/playtest-harness/mirror_smoke50.mjs
//   MIRROR_N=5  node docs/audits/playtest-harness/mirror_smoke50.mjs   # quick stub-mode check
import { chromium, openMirrorWindow, sendTurn, waitSettled, drainMirror, transcriptOf, diffTranscripts, engineSnapshot, pub, writeJson } from './mirrorlib.mjs';

const HERE = new URL('.', import.meta.url).pathname;
const OUT = HERE + 'shots/mirror50/';
const N = parseInt(process.env.MIRROR_N || '50', 10);
const SYNC_WAIT = parseInt(process.env.MIRROR_SYNC_WAIT_MS || '8000', 10);

// Two disjoint, low-stakes line pools so the windows act DIFFERENTLY (a real concurrent race,
// not the same text twice). Roles only — no game-entity names.
const A_LINES = ["(I drift into the kitchen and say hey to whoever's around.)", "(I check in with someone on the couch.)", "(I grab water and chat with anyone nearby.)", "(I wander the common room making small talk.)", "(I lean on the counter and joke with whoever's there.)"];
const B_LINES = ["(I hang back and just watch the room for a beat.)", "(I post up by the wall, listening.)", "(I take a slow lap around the living room.)", "(I find a quiet corner and read the vibe.)", "(I sit on the arm of the couch and observe.)"];

const browser = await chromium.launch();
const A = await openMirrorWindow(browser, 'A');
const B = await openMirrorWindow(browser, 'B');

const results = [];
let prev409A = 0, prev409B = 0;
const count409 = (net) => net.filter((x) => x.status === 409).length;

for (let i = 0; i < N; i++) {
  const itAt = Date.now();
  // Reset the in-page SSE/film buffers so each iteration's timeline is isolated.
  await A.page.evaluate(() => { if (window.__mirror) { window.__mirror.sse = []; window.__mirror.film = []; window.__mirror.errors = []; } });
  await B.page.evaluate(() => { if (window.__mirror) { window.__mirror.sse = []; window.__mirror.film = []; window.__mirror.errors = []; } });

  // CONCURRENT writes — both windows act near-simultaneously.
  await Promise.all([sendTurn(A.page, A_LINES[i % A_LINES.length]), sendTurn(B.page, B_LINES[i % B_LINES.length])]);
  await Promise.all([waitSettled(A.page), waitSettled(B.page)]);
  // Let cross-tab sync (poll + server-push + beatSeq reconcile) settle on both.
  await Promise.all([A.page.waitForTimeout(SYNC_WAIT), B.page.waitForTimeout(SYNC_WAIT)]);

  const e = { A: pub(await engineSnapshot(A.ctx)), B: pub(await engineSnapshot(B.ctx)) };
  const t = { A: await transcriptOf(A.page), B: await transcriptOf(B.page) };
  const diff = diffTranscripts(t.A, t.B);
  const mErrA = (await A.page.evaluate(() => (window.__mirror && window.__mirror.errors || []).length));
  const mErrB = (await B.page.evaluate(() => (window.__mirror && window.__mirror.errors || []).length));
  const n409A = count409(A.net) - prev409A; prev409A = count409(A.net);
  const n409B = count409(B.net) - prev409B; prev409B = count409(B.net);

  const r = {
    it: i + 1, at: itAt,
    engineConverged: JSON.stringify(e.A) === JSON.stringify(e.B),
    beat: [e.A.beatSeq, e.B.beatSeq], phase: e.A.phase, pending: e.A.pending,
    transcriptIdentical: diff.identical, msgs: diff.n, msgsMatch: diff.n[0] === diff.n[1],
    jsErr: [mErrA, mErrB], h409: [n409A, n409B],
  };
  r.PROBLEM = (!r.engineConverged || !r.transcriptIdentical || mErrA > 0 || mErrB > 0);
  results.push(r);
  writeJson(OUT + 'smoke50.json', { N, completed: results.length, results });

  const tag = r.PROBLEM ? '*** DIVERGE' : 'ok';
  console.log(`${tag} it ${r.it}/${N}: engineConverged=${r.engineConverged} transcriptIdentical=${r.transcriptIdentical} msgs=${r.msgs[0]}/${r.msgs[1]} beat=${r.beat[0]}/${r.beat[1]} 409=${n409A}/${n409B} jsErr=${mErrA}/${mErrB} phase=${r.phase} pending=${r.pending}`);

  if (r.PROBLEM) {
    // Dump the diverging iteration's full evidence (both windows).
    const dir = OUT + `diverge-it${r.it}/`;
    const mA = await drainMirror(A.page), mB = await drainMirror(B.page);
    writeJson(dir + 'diff.json', diff);
    writeJson(dir + 'transcript-A.json', t.A);
    writeJson(dir + 'transcript-B.json', t.B);
    writeJson(dir + 'sse-A.json', mA.sse);
    writeJson(dir + 'sse-B.json', mB.sse);
    writeJson(dir + 'film-A.json', mA.film);
    writeJson(dir + 'film-B.json', mB.film);
    await A.page.screenshot({ path: dir + 'A.png', fullPage: true }).catch(() => {});
    await B.page.screenshot({ path: dir + 'B.png', fullPage: true }).catch(() => {});
    if (diff.firstDivergence) console.log('   first divergence:', JSON.stringify(diff.firstDivergence));
    console.log(`   evidence dumped: ${dir}`);
  }
}

const problems = results.filter((r) => r.PROBLEM).length;
const summary = {
  N, problems, clean: problems === 0,
  byKind: {
    engineDiverged: results.filter((r) => !r.engineConverged).length,
    transcriptDiverged: results.filter((r) => !r.transcriptIdentical).length,
    jsErrors: results.filter((r) => r.jsErr[0] > 0 || r.jsErr[1] > 0).length,
    unrecovered409: results.filter((r) => r.h409[0] > 0 || r.h409[1] > 0).length,
  },
  liveKey: !!process.env.ORWELL_TEST_OPENROUTER_KEY, model: process.env.ORWELL_TEST_MODEL || '(stub/unset)',
};
writeJson(OUT + 'smoke50.json', { ...summary, results });
console.log(`\n──── SMOKE50 SUMMARY ────`);
console.log(`${N} iterations, ${problems} with a parity PROBLEM.`);
console.log(`  engine diverged: ${summary.byKind.engineDiverged} · transcript diverged: ${summary.byKind.transcriptDiverged} · jsErrors: ${summary.byKind.jsErrors} · 409 seen: ${summary.byKind.unrecovered409}`);
console.log(`verdict: ${problems === 0 ? 'CLEAN — 50× concurrent mirror held lockstep' : 'DIVERGENCE — see shots/mirror50/diverge-it*/'}`);
console.log('MIRROR SMOKE50 DONE');

await A.ctx.close(); await B.ctx.close(); await browser.close();
process.exit(problems === 0 ? 0 : 1);
