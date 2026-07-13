// mirrorlib.mjs — shared helpers for the "Messenger mirror" two-window verification harness.
//
// The mirror problem: two browser windows open on the SAME game must render a BYTE-IDENTICAL
// transcript in lockstep. This lib captures, per window and timestamp-aligned:
//   (a) the streamed SSE token timeline — EVERY delta from /api/chat_stream, via a fetch tee
//       installed BEFORE any app script (addInitScript), so it is provider/stub-agnostic; and
//   (b) a DOM filmstrip — a MutationObserver log of the chat container (#chat-history), each
//       record timestamped against a shared wall clock so two windows' streams align.
//
// Both capture rails write to window.__mirror, drained into JSON by the caller. The diff logic
// (transcriptOf / firstDivergence) operates on the SETTLED rendered transcript so it works on
// stub / error / echo text exactly as on live narration.
//
// Reuses rig.mjs for context/auth/engine-snapshot; this file only adds the SSE+filmstrip tap
// and the divergence diff. No app code is touched — everything is injected init script.
import { chromium } from 'playwright';
import { newCtx, engineSnapshot, BASE, ENGINE } from './rig.mjs';
import { mkdirSync, writeFileSync } from 'fs';

export { chromium, newCtx, engineSnapshot, BASE, ENGINE };

// ── the in-page tap (installed via addInitScript, before any app JS) ─────────────────────────
// Records, on a SHARED wall clock (Date.now()), so two windows' timelines are comparable:
//   __mirror.sse[]   — one entry per parsed SSE `data:` line of a /api/chat_stream response
//                      { t, wall, kind, thinking, delta, type, raw } (raw clipped)
//   __mirror.film[]  — one entry per relevant mutation under #chat-history
//                      { t, wall, ev:'mount'|'unmount'|'char', ... node descriptor }
//   __mirror.errors[]— JS errors / unhandled rejections
// The fetch tee clones the streamed ReadableStream so the app sees the bytes UNCHANGED.
export const MIRROR_TAP = `(() => {
  if (window.__mirror) return;
  const t0 = performance.now();
  const M = { t0Wall: Date.now(), sse: [], film: [], errors: [] };
  window.__mirror = M;
  const now = () => Math.round(performance.now() - t0);
  const clip = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…[+' + (s.length - n) + ']' : s; };

  // (a) SSE token timeline — tee the chat_stream response body.
  const _fetch = window.fetch;
  window.fetch = function (input, init) {
    const url = (typeof input === 'string' ? input : (input && input.url)) || '';
    const p = _fetch.apply(this, arguments);
    if (!/\\/api\\/chat_stream/.test(url)) return p;
    return p.then((res) => {
      try {
        if (!res.body) return res;
        const reqAt = now();
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        const parseLine = (line) => {
          line = line.trim();
          if (!line.startsWith('data:')) return;
          const body = line.slice(5).trim();
          if (!body || body === '[DONE]') { M.sse.push({ t: now(), wall: Date.now(), kind: 'done', raw: body }); return; }
          let j = null; try { j = JSON.parse(body); } catch (_) {}
          const rec = { t: now(), wall: Date.now(), kind: 'data', raw: clip(body, 400) };
          if (j && typeof j === 'object') {
            if ('delta' in j) { rec.kind = j.thinking ? 'reasoning' : 'reply'; rec.delta = String(j.delta || ''); rec.thinking = !!j.thinking; }
            else if (j.type) { rec.kind = j.type; rec.type = j.type; if (j.tool) rec.tool = j.tool; if (j.round != null) rec.round = j.round; if (j.reason) rec.reason = j.reason; }
          }
          M.sse.push(rec);
        };
        const tee = new ReadableStream({
          start(controller) {
            (function pump() {
              reader.read().then(({ done, value }) => {
                if (done) { M.sse.push({ t: now(), wall: Date.now(), kind: 'eof', reqAt }); controller.close(); return; }
                try { buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf('\\n')) >= 0) { parseLine(buf.slice(0, i)); buf = buf.slice(i + 1); } } catch (_) {}
                controller.enqueue(value);
                pump();
              }).catch((e) => { M.sse.push({ t: now(), wall: Date.now(), kind: 'tee-error', msg: String(e).slice(0, 120) }); try { controller.error(e); } catch (_) {} });
            })();
          }
        });
        return new Response(tee, { status: res.status, statusText: res.statusText, headers: res.headers });
      } catch (e) { M.sse.push({ t: now(), wall: Date.now(), kind: 'tee-setup-error', msg: String(e).slice(0, 120) }); return res; }
    });
  };

  // (b) DOM filmstrip — mount/unmount/char mutations under the chat container.
  const desc = (el) => ({ tag: el.tagName, id: el.id || '', cls: (el.className && el.className.toString ? el.className.toString() : '').slice(0, 90), text: clip((el.innerText || el.nodeValue || '').trim(), 80) });
  const chatRoot = () => document.getElementById('chat-history') || document.body;
  const obs = new MutationObserver((muts) => {
    const t = now(), wall = Date.now();
    for (const m of muts) {
      if (m.type === 'childList') {
        for (const n of m.addedNodes) if (n.nodeType === 1) M.film.push({ t, wall, ev: 'mount', ...desc(n) });
        for (const n of m.removedNodes) if (n.nodeType === 1) M.film.push({ t, wall, ev: 'unmount', ...desc(n) });
      } else if (m.type === 'characterData') {
        const p = m.target.parentElement; M.film.push({ t, wall, ev: 'char', text: clip(String(m.target.nodeValue || '').trim(), 80), parent: p ? (p.tagName + (p.id ? '#' + p.id : '')) : '' });
      }
    }
    if (M.film.length > 12000) M.film.splice(0, M.film.length - 12000);
  });
  const start = () => { const root = chatRoot(); obs.observe(root === document.body ? document.body : root, { childList: true, subtree: true, characterData: true }); };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  // Re-target onto #chat-history once it exists (SPA mounts it late).
  let retargets = 0;
  const iv = setInterval(() => { const r = document.getElementById('chat-history'); if (r) { try { obs.disconnect(); obs.observe(r, { childList: true, subtree: true, characterData: true }); } catch (_) {} clearInterval(iv); } if (++retargets > 60) clearInterval(iv); }, 250);

  window.addEventListener('error', (e) => M.errors.push({ t: now(), msg: String(e.message), src: (e.filename || '') + ':' + (e.lineno || '') }));
  window.addEventListener('unhandledrejection', (e) => M.errors.push({ t: now(), msg: 'unhandledrejection: ' + String(e.reason).slice(0, 200) }));
})()`;

// ── window lifecycle ─────────────────────────────────────────────────────────────────────────
// Open one window on the live game with the mirror tap installed BEFORE app scripts run. `extraInit`
// (an optional init-script source string) is installed alongside the mirror tap — used by the HUD
// parity gate to add a `orwell:gamechanged` / HUD-fetch tap, before any app JS runs.
export async function openMirrorWindow(browser, tag, { device = 'desktop', user = null, extraInit = null } = {}) {
  const ctx = await newCtx(browser, device, { auth: true, user });
  await ctx.addInitScript(MIRROR_TAP);
  if (extraInit) await ctx.addInitScript(extraInit);
  const page = await ctx.newPage();
  const net = [];
  page.on('response', (r) => { const s = r.status(); if (s >= 400) net.push({ status: s, url: (r.url().split('7000')[1] || r.url()).slice(0, 80) }); });
  page.on('pageerror', (e) => net.push({ status: 'pageerror', url: String(e.message).slice(0, 120) }));
  await page.goto(BASE + '/', { waitUntil: 'load', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3500);
  // Clear onboarding / inert overlays so the composer is reachable.
  await page.evaluate(() => { const o = document.getElementById('orwell-onboarding'); if (o) o.remove(); document.querySelectorAll('[inert]').forEach((n) => { try { n.inert = false; } catch (_) {} }); });
  await page.waitForTimeout(500);
  return { ctx, page, tag, net };
}

// Send a turn through the real composer (UI path, not an API shortcut).
export async function sendTurn(page, text) {
  await page.fill('#message', text);
  await page.waitForTimeout(150);
  const mode = await page.evaluate(() => document.querySelector('.send-btn')?.getAttribute('data-mode'));
  if (mode === 'send') await page.click('.send-btn').catch(() => {});
  else await page.keyboard.press('Enter');
}

// Wait until the last AI bubble has settled (footer present, non-placeholder, length stable) OR
// a stream error / no-model notice rendered (so stub mode terminates fast). Returns the reason.
export async function waitSettled(page, t = 180000) {
  const t0 = Date.now(); let last = -1, stable = 0;
  while (Date.now() - t0 < t) {
    await page.waitForTimeout(1200);
    const info = await page.evaluate(() => {
      const sseDone = (window.__mirror && window.__mirror.sse || []).some((s) => s.kind === 'eof');
      const errShown = !!document.querySelector('#chat-history .msg-system');
      const e = document.querySelectorAll('#chat-history .msg-ai');
      const el = e[e.length - 1];
      if (!el) return { len: 0, done: false, ph: true, sseDone, errShown };
      const c = el.cloneNode(true); c.querySelectorAll('.thinking-content,.thinking,[class*=thinking],.msg-footer').forEach((n) => n.remove());
      const txt = (c.innerText || '').trim();
      // `ph` = the last .msg-ai is a LIVE PLACEHOLDER, not settled reply text. Besides the classic
      // "thinking…"/short-stub cases, this includes the animated TOOL-BEAT status ("The house is in
      // motion ▂▃▄", orwellToolBeats.js): while a turn runs, the last .msg-ai can briefly BE that beat
      // chip with its animated block-bar spinner (▁▂▃▄▅▆▇█, U+2581–2588) — chars that NEVER occur in a
      // settled reply. Treating that as settled made waitSettled return a premature `sse-eof` and
      // capture the SPINNER as A's text, so waitForBText then chased placeholder text that B (correctly
      // mirroring the real reply) never matched → a host-speed-dependent false red (issue #1560). So a
      // spinner/beat placeholder is `ph`, and the `sse-eof` shortcut below is gated on `!ph` — settle is
      // recorded only once the last .msg-ai holds real, non-placeholder reply text.
      const ph = /^(thinking|still|generating)/i.test(txt) || /[\u2581-\u2588]/.test(txt) || txt.length < 8;
      return { len: txt.length, done: !!el.querySelector('.msg-footer'), ph, sseDone, errShown };
    });
    if (info.errShown && info.sseDone) return 'error-or-no-model';
    if (info.done && !info.ph) { await page.waitForTimeout(700); return 'settled'; }
    if (info.sseDone && !info.ph && (info.len > 8 || info.errShown)) { await page.waitForTimeout(900); return 'sse-eof'; }
    if (!info.ph && info.len > 40 && info.len === last) { if (++stable >= 6) return 'stable'; } else stable = 0;
    last = info.len;
  }
  return 'timeout';
}

// Drain the in-page mirror tap (sse + filmstrip + errors) for a window.
export async function drainMirror(page) {
  return page.evaluate(() => {
    const M = window.__mirror || { sse: [], film: [], errors: [], t0Wall: 0 };
    return { t0Wall: M.t0Wall, sse: M.sse, film: M.film, errors: M.errors };
  });
}

// The SETTLED rendered transcript of the chat container — the thing that must be byte-identical
// across windows. Per-message {cls,id,text}; reasoning/footer stripped (those are per-window UI
// chrome, not the shared transcript). Works identically on live, stub, echo, or error text.
//
// M4-6 (ceremony slates): `.ow-cslate` cards are TOP-LEVEL siblings of `.msg` in #chat-history
// (a beat's designed full-width card, inserted beside the compact tool-thread chip) — included
// here in document order so the SAME byte-identity diff below (diffTranscripts) also catches a
// slate divergence between two mirrored windows (wrong kind/names/kicker/badge/grayscale), not
// just message-bubble text. No new harness: this is the one shared transcript snapshot every
// mirror script (`mirror_toolturn_parity.mjs` and friends) already asserts on.
export async function transcriptOf(page) {
  return page.evaluate(() => {
    const nodes = [...document.querySelectorAll('#chat-history .msg, #chat-history .ow-cslate')];
    return nodes.map((el, i) => {
      if (el.classList.contains('ow-cslate')) {
        const kind = el.getAttribute('data-ow-cslate') || '';
        const kicker = (el.querySelector('.ow-cslate-kicker') || {}).textContent || '';
        const names = (el.querySelector('.ow-cslate-names') || {}).textContent || '';
        const line = (el.querySelector('.ow-cslate-line') || {}).textContent || '';
        const badge = el.querySelector('.ow-mono-badge');
        const badgeRole = badge ? [...badge.classList].find((c) => c.startsWith('ow-mono-badge-')) || 'badge' : '';
        const grayscale = !!el.querySelector('.ow-mono-evicted');
        const text = [kicker, names, line, badgeRole, grayscale ? 'grayscale' : ''].join(' | ').replace(/\\s+/g, ' ').trim();
        return { i, cls: 'ow-cslate:' + kind, id: '', text };
      }
      const cls = [...el.classList].filter((c) => c.startsWith('msg')).join(',');
      const id = el.id || el.dataset.id || el.dataset.messageId || el.getAttribute('data-msg-id') || el.getAttribute('data-mid') || '';
      const c = el.cloneNode(true);
      c.querySelectorAll('.thinking-content,.thinking,[class*=thinking],.msg-footer,.role').forEach((n) => n.remove());
      return { i, cls, id, text: (c.innerText || '').replace(/\\s+/g, ' ').trim() };
    });
  });
}

// Vault-free public engine projection (parity oracle).
export function pub(snap) {
  const g = snap.state || {}, s = snap.status || {};
  return { started: g.started, moment: g.moment, week: g.week, beatSeq: g.beatSeq, houseCount: (g.house || []).length, phase: s.phase, hoh: (s.hoh && s.hoh.name) || s.hoh || null, noms: (s.nominees || []).map((x) => x.name || x), pending: (s.pending && s.pending.kind) || null };
}

// ── the diff ─────────────────────────────────────────────────────────────────────────────────
// Compare two settled transcripts. Returns whether they are byte-identical and, if not, the FIRST
// point of divergence (message index + intra-message char offset + a context window). Also serves
// the SSE timeline (reply-channel concatenation) so a token-stream divergence can be located too.
export function diffTranscripts(a, b) {
  const joinT = (t) => t.map((m) => m.cls + '␟' + m.text).join('⁣'); // unit-sep + invisible-sep
  const sa = joinT(a), sb = joinT(b);
  if (sa === sb) return { identical: true, n: [a.length, b.length] };
  // locate first diverging message
  let mi = 0; while (mi < a.length && mi < b.length && (a[mi].cls === b[mi].cls && a[mi].text === b[mi].text)) mi++;
  const ma = a[mi], mb = b[mi];
  let detail = null;
  if (ma && mb) {
    const ta = ma.text, tb = mb.text; let ci = 0; while (ci < ta.length && ci < tb.length && ta[ci] === tb[ci]) ci++;
    detail = { msgIndex: mi, cls: [ma.cls, mb.cls], charOffset: ci, a: ta.slice(Math.max(0, ci - 30), ci + 60), b: tb.slice(Math.max(0, ci - 30), ci + 60) };
  } else {
    detail = { msgIndex: mi, reason: 'message-count mismatch', a: ma || null, b: mb || null };
  }
  return { identical: false, n: [a.length, b.length], firstDivergence: detail };
}

// Concatenate the reply-channel deltas of an SSE timeline into the streamed text (what the body
// rendered). Used to diff the token STREAM (not just the settled DOM) between windows.
export function streamReplyText(sse) {
  return (sse || []).filter((s) => s.kind === 'reply').map((s) => s.delta || '').join('');
}
export function streamReasoningText(sse) {
  return (sse || []).filter((s) => s.kind === 'reasoning').map((s) => s.delta || '').join('');
}

import { dirname } from 'path';
export function writeJson(path, obj) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(obj, null, 2)); }
