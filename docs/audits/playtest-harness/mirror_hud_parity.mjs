// mirror_hud_parity.mjs — the EXECUTABLE RED GATE for ship-gate F5's STATUS/GADGET half (feature
// 0064 §B/D instant cross-window HUD parity): a complement to mirror_live_parity.mjs (which gates
// the CHAT-RENDER half, R2 / ADR 0015).
//
// THE INVARIANT (F5, the status/gadget half):
//   Given two windows on one started game,
//   When a chat turn in window A MUTATES engine state,
//   Then the server publishes `game-updated` to the user's windows,
//   And window B's HUD reflects the new state within HUD_PARITY_BUDGET_MS (≤2000ms; target
//     sub-second) — driven by the SERVER PUSH, NOT B's 20–30s poll,
//   And no Vault data crosses (the push carries no state body; each window re-fetches its own
//     Vault-free projection).
//
// WHY THIS EXISTS (the gap on the base branch):
//   The 0064 server-push (`game-updated`) is fired from only THREE orwell_routes.py endpoints
//   (decision + the two self-eviction routes) — NEVER from the chat-turn path. So a chat turn whose
//   agent-loop tools mutate engine state (markHouseguestMet / advanceGame / recordInteraction / the
//   0055 _auto_record_scene belt) refreshes ONLY the SENDER's own HUD (chat.js → the g15 dispatcher,
//   client-side). Peer windows get NO push and stay stale until their own poll. Observed live:
//   window A "1 of 15 met", window B "0 of 15".
//
// HOW IT MEASURES (push, not poll — the load-bearing distinction):
//   The 0064 SSE `game-updated` is the ONLY thing that routes through sessionSync.js
//   `notifyGameUpdated()` → `window.orwellGameChanged('sync:game-updated')` → the debounced
//   `orwell:gamechanged` window event. The HUD panels' 20–30s poll is a SEPARATE setInterval that
//   re-fetches WITHOUT dispatching `orwell:gamechanged`. So a B-side `orwell:gamechanged` carrying
//   reason `sync:game-updated` is, by construction, the SERVER PUSH landing — never the poll. The
//   gate taps that event (wall-clocked) plus B's off-cycle `/api/orwell/{state,status}` re-fetches,
//   and times the first one from A's send. RED ⇒ B never receives the push (it would only converge on
//   its slow poll); GREEN ⇒ B's HUD reconciles within budget off the push.
//
// Key-free + deterministic (the fake streamed model). The turn mutates via the 0055 _auto_record_scene
// belt (a long player turn with no model write tool ⇒ ensure_turn_recorded → recordInteraction ⇒ a
// committed engine mutation ⇒ beatSeq bump). The gate CONFIRMS the mutation (engine beatSeq
// before/after) and only then asserts the parity budget — so a non-mutating turn can never produce a
// false GREEN.
//
// Run via run_mirror_gate.sh with MIRROR_HUD=1 (boots engine + fake model + FE + a STARTED game), or
// against an already-standing stack:  node docs/audits/playtest-harness/mirror_hud_parity.mjs
import { chromium, openMirrorWindow, sendTurn, waitSettled, engineSnapshot, pub, writeJson } from './mirrorlib.mjs';

const HERE = new URL('.', import.meta.url).pathname;
const OUT = HERE + 'shots/mirror-hud/';
// A LONG player turn so the 0055 belt fires (ensure_turn_recorded needs >= 80 chars of narration; a
// substantive player line yields a long stub-echo reply → a committed recordInteraction).
const TURN = process.env.MIRROR_HUD_TURN ||
  "(I make a real point of going around the room and introducing myself to every single person here, one by one, learning their names and shaking hands.)";
const HUD_PARITY_BUDGET_MS = parseInt(process.env.HUD_PARITY_BUDGET_MS || '2000', 10);
const B_WAIT_MS = parseInt(process.env.MIRROR_HUD_B_WAIT_MS || '15000', 10);

// A B-side tap: record every `orwell:gamechanged` (with its reason + wall) and every off-cycle HUD
// re-fetch of /api/orwell/{state,status}. Installed BEFORE app JS so we catch the first push.
const HUD_TAP = `(() => {
  if (window.__hud) return;
  const H = { changed: [], hudFetch: [] };
  window.__hud = H;
  window.addEventListener('orwell:gamechanged', (e) => {
    H.changed.push({ wall: Date.now(), reason: (e && e.detail && e.detail.reason) || '' });
  });
  const _fetch = window.fetch;
  window.fetch = function (input, init) {
    const url = (typeof input === 'string' ? input : (input && input.url)) || '';
    if (/\\/api\\/orwell\\/(state|status|moment)/.test(url)) H.hudFetch.push({ wall: Date.now(), url: url.replace(/^https?:\\/\\/[^/]+/, '') });
    return _fetch.apply(this, arguments);
  };
})()`;

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const A = await openMirrorWindow(browser, 'A');
// Window B installs the HUD tap on top of the mirror tap (openMirrorWindow already added the latter).
const B = await openMirrorWindow(browser, 'B', { extraInit: HUD_TAP });

// CP0 — both windows on the SAME started game (shared canonical session) or the mirror can't engage.
const e0 = { A: pub(await engineSnapshot(A.ctx)), B: pub(await engineSnapshot(B.ctx)) };
console.log(`CP0: started A=${e0.A.started} B=${e0.B.started} beat=${e0.A.beatSeq}/${e0.B.beatSeq} houseA=${e0.A.houseCount}`);
if (e0.A.started === false || e0.B.started === false) {
  console.error('\n*** PRECONDITION UNMET: game is not STARTED in both windows — seed a started season first.');
  await A.ctx.close(); await B.ctx.close(); await browser.close();
  process.exit(2);
}

// CP-warm — reach STEADY STATE first (the real scenario): A sends a WARM-UP framed turn so the
// canonical game session BINDS (apply_game_framing binds on the first framed turn) and BOTH windows
// converge + subscribe to that canonical SSE channel. Without this, the FIRST framed turn binds the
// canonical id mid-turn and the end-of-turn push races AHEAD of the peers' not-yet-existing
// subscription (publish-to-zero-subscribers) — a first-turn artifact, NOT the steady-state bug this
// gate targets (two windows already in the game; A sends; B must reconcile off the push). The live
// repro (window A "1 of 15 met" / window B "0 of 15") is exactly steady state.
console.log('\nCP-warm: A sends a warm-up turn to bind the canonical session + converge both windows…');
await sendTurn(A.page, "(I take a slow breath and look around the room, just getting my bearings for a second.)");
await waitSettled(A.page);
// Let both windows discover the now-bound canonical id and subscribe their SSE to it (sessionSync's
// canonical-discovery poll + bind). Generous settle so the RED/GREEN signal is the PUSH, not a
// not-yet-subscribed peer.
await B.page.waitForTimeout(5000);
await A.page.evaluate(() => { try { window.__hud = { changed: [], hudFetch: [] }; } catch (_) {} });
await B.page.evaluate(() => { if (window.__hud) { window.__hud.changed = []; window.__hud.hudFetch = []; } });
const eWarm = pub(await engineSnapshot(A.ctx));
console.log(`   canonical bound, both subscribed; beat now ${eWarm.beatSeq}`);

// CP1 — A sends ONE mutating turn; B is the passive HUD mirror (steady state).
const sendWall = Date.now();
console.log(`\nCP1 A sends @${sendWall}: ${JSON.stringify(TURN)}`);
await sendTurn(A.page, TURN);
const reasonA = await waitSettled(A.page);
const aSettleWall = Date.now();
console.log(`   A settled: ${reasonA} @${aSettleWall} (+${aSettleWall - sendWall}ms)`);

// Wait for B's first PUSH-DRIVEN reconcile (an `orwell:gamechanged` carrying the sync:game-updated
// reason — the 0064 server-push, never the poll), or a bounded timeout.
const bPush = await waitForBPush(B.page, sendWall, B_WAIT_MS);

// Confirm the turn actually MUTATED the engine (beatSeq bump) — a non-mutating turn is not a valid
// test of HUD PARITY (and must not yield a false GREEN). Give the fire-and-forget 0055 belt a moment
// to commit before we read the after-snapshot.
await A.page.waitForTimeout(2500);
const e1 = { A: pub(await engineSnapshot(A.ctx)), B: pub(await engineSnapshot(B.ctx)) };
// Mutation = the MEASURED turn advanced the beat beyond the POST-WARM-UP baseline (not e0, which
// predates the warm-up turn) — so the warm-up's own mutation can't mask a measured no-op.
const mutated = (typeof e1.A.beatSeq === 'number' && typeof eWarm.beatSeq === 'number')
  ? e1.A.beatSeq > eWarm.beatSeq : false;

const hudB = await B.page.evaluate(() => window.__hud || { changed: [], hudFetch: [] });
const firstPushMs = bPush ? (bPush.wall - sendWall) : null;
// THE PARITY LAG: B's HUD reconcile relative to A's SETTLE — i.e. the moment A's OWN HUD reflects the
// change (A refreshes its own HUD client-side at settle via the g15 dispatcher) vs the moment B's
// does (off the push). This is the A↔B gap the live repro showed (A "1 of 15 met" while B stayed "0
// of 15"). Measuring from A's SETTLE, not from send, is correct: the mutation (the 0055 belt) only
// COMMITS at end-of-turn, so a streamed turn's whole duration is not parity latency — the push-to-peer
// delay is. A push that lands at/before A's settle is zero lag (clamped at 0).
const aSettleMs = aSettleWall - sendWall;
const parityLagMs = bPush ? Math.max(0, bPush.wall - aSettleWall) : null;
// DIAGNOSTIC only: B's first HUD re-fetch after the send. The status panel polls on a few-second
// cadence, so a fetch within budget can be a poll OR a push — it CANNOT distinguish them. The
// load-bearing, push-ONLY signal is `bReceivedPush` (the `sync:game-updated` orwell:gamechanged
// event, dispatched ONLY by the 0064 SSE), which is what actually triggers every HUD panel to
// reconcile. So this is reported, not gated.
const firstHudFetch = (hudB.hudFetch || []).find((f) => f.wall >= sendWall);
const firstHudFetchMs = firstHudFetch ? (firstHudFetch.wall - sendWall) : null;

const checks = {
  turnMutatedEngine: mutated,                                                    // precondition: the measured turn committed a mutation
  bReceivedPush: bPush != null,                                                  // B got the 0064 game-updated push (the push-ONLY signal, never the poll)
  parityWithinBudget: parityLagMs != null && parityLagMs <= HUD_PARITY_BUDGET_MS, // B's HUD reconciles within the budget of A's (the push fires the panel reconcile)
};
const PASS = Object.values(checks).every(Boolean);

const report = {
  meta: { turn: TURN, sendWall, reasonA, budgetMs: HUD_PARITY_BUDGET_MS, model: process.env.FAKE_MODEL_ID || 'fake/echo-stream' },
  engine: { beatWarmBaseline: eWarm.beatSeq, beatAfter: e1.A.beatSeq, mutated, convergedBeat: [e1.A.beatSeq, e1.B.beatSeq] },
  timing: { aSettleMs, firstPushMs, parityLagMs },
  bPush: { firstPushReason: bPush ? bPush.reason : null, firstPushMs, parityLagMs, allChanged: hudB.changed, firstHudFetchMs, hudFetch: hudB.hudFetch },
  checks, PASS,
};
writeJson(OUT + 'mirror-hud-report.json', report);
await A.page.screenshot({ path: OUT + 'A.png', fullPage: true }).catch(() => {});
await B.page.screenshot({ path: OUT + 'B.png', fullPage: true }).catch(() => {});

console.log('\n──── MIRROR HUD-PARITY GATE (F5 status/gadget half · 0064 §B/D) ────');
console.log(`turn mutated the engine        : beat ${eWarm.beatSeq} → ${e1.A.beatSeq} → ${checks.turnMutatedEngine}  (false ⇒ not a valid parity test — the measured turn changed nothing)`);
console.log(`B received the game-updated push: reason=${bPush ? bPush.reason : 'NONE'} @+${firstPushMs == null ? 'n/a' : firstPushMs + 'ms'} (A settled @+${aSettleMs}ms) → ${checks.bReceivedPush}  (false ⇒ NO push reached B — it would only converge on its 20–30s poll)`);
console.log(`B↔A parity lag within budget    : ${parityLagMs == null ? 'n/a' : parityLagMs + 'ms'} (budget ${HUD_PARITY_BUDGET_MS}ms; B's reconcile vs A's settle) → ${checks.parityWithinBudget}`);
console.log(`(diag) B first HUD re-fetch     : +${firstHudFetchMs == null ? 'n/a' : firstHudFetchMs + 'ms'}  (poll-confounded — not gated; the push above fires the panel reconcile)`);
console.log(`\nVERDICT: ${PASS ? "PASS — B's HUD mirrors A's mutation off the server push, within budget" : 'FAIL — B did not reconcile off a push within budget (stale until its poll) — F5 status/gadget half'}`);
console.log(`artifacts: ${OUT}`);

await A.ctx.close(); await B.ctx.close(); await browser.close();
process.exit(PASS ? 0 : 1);

// ── helpers ──
// Poll B's HUD tap until the first `orwell:gamechanged` carrying the 0064 push reason
// (sync:game-updated) lands AFTER `sinceWall`. That reason is dispatched ONLY by sessionSync.js's
// notifyGameUpdated on a server `game-updated` SSE — by construction it is the push, not the poll.
async function waitForBPush(page, sinceWall, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const hit = await page.evaluate((since) => {
      const c = (window.__hud && window.__hud.changed) || [];
      return c.find((e) => e.wall >= since && /sync:game-updated/.test(e.reason || '')) || null;
    }, sinceWall);
    if (hit) return hit;
    await page.waitForTimeout(100);
  }
  return null;
}
