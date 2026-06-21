// Extended temporal / two-window / device-matrix capture rig for the Orwell audit.
// Builds on docs/audits/playtest-harness/lib.mjs (DEFECT_SCAN reused) and adds:
//  - real device descriptors (mobile DPR3 + touch), not just a CSS resize
//  - video recording -> ffmpeg filmstrip (perceive motion, not a single frame)
//  - a pre-load MutationObserver + console/error/network instrument (transient lifecycle)
//  - engine ground-truth snapshots at each checkpoint
//  - two-window parity (same- or cross-identity) with structural + optional pixel A/B diff
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'fs';
import { execFileSync } from 'child_process';

const HERE = new URL('.', import.meta.url).pathname;
export const BASE = process.env.BASE_URL || 'http://127.0.0.1:7000';
export const ENGINE = process.env.ENGINE_URL || 'http://127.0.0.1:8765';

const secPath = new URL('./.secrets.env', import.meta.url).pathname;
export const sec = existsSync(secPath)
  ? Object.fromEntries(readFileSync(secPath, 'utf8').split('\n').filter(Boolean)
      .filter(l => !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }))
  : {};

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
export const DEVICES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  mobile:  { viewport: { width: 390, height: 844 },  deviceScaleFactor: 3, isMobile: true,  hasTouch: true, userAgent: IPHONE_UA },
  android: { viewport: { width: 360, height: 800 },  deviceScaleFactor: 3, isMobile: true,  hasTouch: true },
  narrow:  { viewport: { width: 320, height: 720 },  deviceScaleFactor: 2, isMobile: true,  hasTouch: true },
};

// Reused verbatim from lib.mjs — pure-DOM defect scan (overflow / offscreen / copy smells / undersized taps).
export const DEFECT_SCAN = `(() => {
  const vw = document.documentElement.clientWidth;
  const docOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth
    ? { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth } : null;
  const offscreen = []; const seen = new Set();
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
    if (r.right > vw + 1 && cs.position !== 'fixed') {
      const key = el.tagName + '.' + (el.className && el.className.toString ? el.className.toString().slice(0,40) : '');
      if (seen.has(key)) continue; seen.add(key);
      offscreen.push({ tag: el.tagName, cls: (el.className||'').toString().slice(0,60), id: el.id||'',
        right: Math.round(r.right), vw, overBy: Math.round(r.right - vw), text: (el.innerText||'').trim().slice(0,40) });
    }
  }
  const smells = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n; const reSmell = [ [/ [,.;:!?]/, 'space-before-punct'], [/\\(\\s/, 'space-after-open-paren'],
    [/\\s\\)/, 'space-before-close-paren'], [/  +/, 'double-space'], [/\\bFR-\\d|\\bNFR-\\d/, 'spec-jargon'] ];
  while ((n = walker.nextNode())) {
    const t = n.nodeValue; if (!t || !t.trim()) continue;
    const p = n.parentElement; if (!p) continue;
    const cs = getComputedStyle(p); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    for (const [re, label] of reSmell) { if (re.test(t)) { smells.push({ label, text: t.trim().slice(0,80), parent: p.tagName + (p.id?'#'+p.id:'') }); break; } }
  }
  const taps = [];
  for (const el of document.querySelectorAll('button, [role=button], a.list-item, select, .settings-tab, .send-btn, input')) {
    const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (r.height < 24 || r.width < 16) taps.push({ tag: el.tagName, id: el.id||'', cls:(el.className||'').toString().slice(0,40),
      w: Math.round(r.width), h: Math.round(r.height), label: (el.getAttribute('aria-label')||el.title||el.innerText||'').trim().slice(0,30) });
  }
  return { vw, docOverflow, offscreen: offscreen.slice(0,40), smells: smells.slice(0,40), taps: taps.slice(0,40) };
})()`;

// Injected via addInitScript BEFORE any app script: timestamped mount/unmount of transient elements + JS errors.
export const INSTRUMENT = `(() => {
  const t0 = performance.now(); const log = []; const errs = [];
  window.__audit = { log, errors: errs, t0Wall: Date.now() };
  const SEL = '.toast,.banner,[class*=toast],[class*=modal],[class*=overlay],[class*=card],[class*=accordion],[class*=thinking],#orwell-decision-card,.msg-ooc-producer,.welcome-message,[class*=welcome],[class*=spinner],[class*=loading],[class*=onboard],[class*=headshot],[class*=casting]';
  const d = (el) => ({ tag: el.tagName, id: el.id||'', cls: (el.className&&el.className.toString?el.className.toString():'').slice(0,90), text: (el.innerText||'').trim().slice(0,70) });
  const hit = (el) => el && el.nodeType===1 && ((el.matches&&el.matches(SEL)) || (el.querySelector&&el.querySelector(SEL)));
  const obs = new MutationObserver((muts) => {
    const t = Math.round(performance.now()-t0);
    for (const m of muts) { for (const n of m.addedNodes) if (hit(n)) log.push({t, ev:'mount', ...d(n)});
      for (const n of m.removedNodes) if (hit(n)) log.push({t, ev:'unmount', ...d(n)}); }
    if (log.length>6000) log.splice(0, log.length-6000);
  });
  const start = () => { if (document.body) obs.observe(document.body, { childList:true, subtree:true }); };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  window.addEventListener('error', e => errs.push({ t: Math.round(performance.now()-t0), msg: String(e.message), src: (e.filename||'')+':'+(e.lineno||'') }));
  window.addEventListener('unhandledrejection', e => errs.push({ t: Math.round(performance.now()-t0), msg: 'unhandledrejection: ' + String(e.reason).slice(0,200) }));
})()`;

export async function launch() { return chromium.launch(); }

export async function engineSnapshot(ctx) {
  const get = (p, host = BASE) => ctx.request.get(host + p, { timeout: 8000 }).then(r => r.json()).catch(e => ({ __err: String(e).slice(0,80) }));
  return { state: await get('/api/orwell/state'), status: await get('/api/orwell/status'),
    moment: await get('/api/orwell/moment'), engineHealth: await get('/health', ENGINE) };
}

export async function newCtx(browser, device, { video = false, auth = true, user = null } = {}) {
  const dev = DEVICES[device]; if (!dev) throw new Error('unknown device ' + device);
  const opts = { ...dev };
  if (video) { mkdirSync(HERE + 'video/', { recursive: true }); opts.recordVideo = { dir: HERE + 'video/', size: dev.viewport }; }
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript(INSTRUMENT);
  if (auth) {
    const creds = user ? { username: user.user, password: user.pass } : { username: sec.ADMIN_USER, password: sec.ADMIN_PW };
    await ctx.request.post(BASE + '/api/auth/login', { data: creds }).catch(() => {});
  }
  return ctx;
}

function wirePage(page, sink) {
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) sink.console.push({ type: m.type(), text: m.text().slice(0, 300) }); });
  page.on('pageerror', e => sink.console.push({ type: 'pageerror', text: String(e.message).slice(0, 300) }));
  page.on('requestfailed', r => sink.net.push({ status: 'FAILED', method: r.method(), url: r.url().slice(0, 170), err: r.failure()?.errorText }));
  page.on('response', r => { const s = r.status(); if (s >= 400) sink.net.push({ status: s, method: r.request().method(), url: r.url().slice(0, 170) }); });
}

async function dumpPage(page, ctx) {
  let report = null, text = '', audit = { log: [], errors: [] };
  try { report = await page.evaluate(DEFECT_SCAN); } catch (e) { report = { scanError: String(e.message) }; }
  try { text = await page.evaluate(() => document.body.innerText); } catch {}
  try { audit = await page.evaluate(() => ({ log: window.__audit?.log || [], errors: window.__audit?.errors || [] })); } catch {}
  const snap = await engineSnapshot(ctx);
  return { report, text, audit, snap };
}

function filmstrip(name, device, videoPath, fps) {
  if (!videoPath || !existsSync(videoPath)) return [];
  const fdir = `${HERE}shots/${name}-${device}-frames`; mkdirSync(fdir, { recursive: true });
  try { execFileSync('ffmpeg', ['-y', '-i', videoPath, '-vf', `fps=${fps}`, `${fdir}/f-%03d.png`], { stdio: 'ignore' }); }
  catch (e) { return [{ err: String(e.message).slice(0, 120) }]; }
  return readdirSync(fdir).filter(f => f.endsWith('.png')).sort();
}

// Capture one named surface on one device, with optional video + motion dwell.
export async function captureSurface(browser, { name, device = 'desktop', path = '/', auth = true, user = null,
    prepare = null, settle = 1200, video = false, fps = 8, recordMs = 0 }) {
  mkdirSync(HERE + 'shots', { recursive: true });
  const ctx = await newCtx(browser, device, { video, auth, user });
  const page = await ctx.newPage();
  const sink = { console: [], net: [] }; wirePage(page, sink);
  let snapBefore = null;
  try {
    await page.goto(BASE + path, { waitUntil: 'load', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(settle);
    snapBefore = await engineSnapshot(ctx);
    if (prepare) await prepare(page, device);
    await page.waitForTimeout(400);
  } catch (e) { sink.console.push({ type: 'nav', text: String(e.message) }); }
  if (recordMs > 0) await page.waitForTimeout(recordMs);
  const { report, text, audit, snap } = await dumpPage(page, ctx);
  const png = `${HERE}shots/${name}-${device}.png`;
  try { await page.screenshot({ path: png, fullPage: true }); } catch (e) { sink.console.push({ type: 'shot', text: String(e.message) }); }
  writeFileSync(`${HERE}shots/${name}-${device}.txt`, text || '');
  let videoPath = null; if (video) { try { videoPath = await page.video().path(); } catch {} }
  await ctx.close();
  const frames = video ? filmstrip(name, device, videoPath, fps) : [];
  const out = { name, device, path, vw: report?.vw, report, console: sink.console, net: sink.net,
    mutations: audit.log, jsErrors: audit.errors, snapBefore, snapAfter: snap, png, video: videoPath, frames, textLen: (text || '').length };
  writeFileSync(`${HERE}shots/${name}-${device}.json`, JSON.stringify(out, null, 2));
  console.log(`[${name}/${device}] vw=${report?.vw} overflow=${report?.docOverflow ? 'YES' : 'no'} offscreen=${(report?.offscreen || []).length} smells=${(report?.smells || []).length} taps<min=${(report?.taps || []).length} console=${sink.console.length} net>=400=${sink.net.length} mutations=${audit.log.length} jsErr=${audit.errors.length} frames=${frames.length}`);
  for (const e of sink.console.slice(0, 8)) console.log(`   ! ${e.type}: ${e.text}`);
  for (const o of (report?.offscreen || []).slice(0, 6)) console.log(`   > overflow ${o.tag}.${o.cls} +${o.overBy}px "${o.text}"`);
  for (const n of dedupeNet(sink.net).slice(0, 8)) console.log(`   net ${n.status} ${n.method} ${n.url}${n.n>1?'  (x'+n.n+')':''}`);
  return out;
}

function dedupeNet(net) {
  const m = new Map();
  for (const r of net) { const k = r.status + ' ' + r.url; if (!m.has(k)) m.set(k, { ...r, n: 0 }); m.get(k).n++; }
  return [...m.values()].sort((a, b) => b.n - a.n);
}

// Two synchronized windows on one clock. identities: 'same' (both admin) or [userA,userB].
// Captures both, then emits a structural (+ optional pixel) A/B diff.
export async function twoWindowParity(browser, { name, device = 'desktop', path = '/', identity = 'same',
    users = null, settle = 1500, recordMs = 0, video = false }) {
  mkdirSync(HERE + 'shots', { recursive: true });
  const mk = async (tag, user) => {
    const ctx = await newCtx(browser, device, { video, auth: true, user });
    const page = await ctx.newPage(); const sink = { console: [], net: [] }; wirePage(page, sink);
    await page.goto(BASE + path, { waitUntil: 'load', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(settle);
    return { ctx, page, sink, tag };
  };
  const wA = await mk('A', identity === 'same' ? null : users?.[0]);
  const wB = await mk('B', identity === 'same' ? null : users?.[1]);
  if (recordMs > 0) { await Promise.all([wA.page.waitForTimeout(recordMs), wB.page.waitForTimeout(recordMs)]); }
  const A = await dumpPage(wA.page, wA.ctx); const B = await dumpPage(wB.page, wB.ctx);
  const pngA = `${HERE}shots/${name}-${device}-A.png`, pngB = `${HERE}shots/${name}-${device}-B.png`;
  await wA.page.screenshot({ path: pngA, fullPage: true }).catch(() => {});
  await wB.page.screenshot({ path: pngB, fullPage: true }).catch(() => {});
  await wA.ctx.close(); await wB.ctx.close();
  // structural diff
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const tA = norm(A.text), tB = norm(B.text);
  let firstDiff = null;
  if (tA !== tB) { let i = 0; while (i < tA.length && i < tB.length && tA[i] === tB[i]) i++; firstDiff = { at: i, a: tA.slice(Math.max(0, i - 30), i + 50), b: tB.slice(Math.max(0, i - 30), i + 50) }; }
  // optional pixel diff
  let pixel = null;
  try {
    const { PNG } = await import('pngjs'); const pixelmatch = (await import('pixelmatch')).default;
    const a = PNG.sync.read(readFileSync(pngA)), b = PNG.sync.read(readFileSync(pngB));
    const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
    const diff = new PNG({ width: w, height: h });
    const crop = (img) => { if (img.width === w && img.height === h) return img; const o = new PNG({ width: w, height: h }); PNG.bitblt(img, o, 0, 0, w, h, 0, 0); return o; };
    const ca = crop(a), cb = crop(b);
    const nd = pixelmatch(ca.data, cb.data, diff.data, w, h, { threshold: 0.1 });
    writeFileSync(`${HERE}shots/${name}-${device}-DIFF.png`, PNG.sync.write(diff));
    pixel = { mismatchedPx: nd, totalPx: w * h, pct: +(100 * nd / (w * h)).toFixed(3), sizeA: [a.width, a.height], sizeB: [b.width, b.height] };
  } catch (e) { pixel = { skipped: String(e.message).slice(0, 100) }; }
  const out = { name, device, identity, path, textIdentical: tA === tB, firstDiff,
    mutationsA: A.audit.log.length, mutationsB: B.audit.log.length,
    sharedStateA: pubState(A.snap), sharedStateB: pubState(B.snap), pixel,
    consoleA: wA.sink.console.length, consoleB: wB.sink.console.length, pngA, pngB };
  writeFileSync(`${HERE}shots/${name}-${device}-PARITY.json`, JSON.stringify({ ...out, A: A.snap, B: B.snap }, null, 2));
  console.log(`[PARITY ${name}/${device}/${identity}] textIdentical=${out.textIdentical} pixelMismatch=${pixel?.pct ?? pixel?.skipped}% mutA=${out.mutationsA} mutB=${out.mutationsB}`);
  if (firstDiff) console.log(`   first text divergence @${firstDiff.at}:\n     A: …${firstDiff.a}…\n     B: …${firstDiff.b}…`);
  return out;
}

function pubState(snap) {
  const s = snap?.status || {};
  return { week: s.week, phase: s.phase, hoh: s.hoh?.name || null, noms: (s.nominees || []).map(x => x.name), pending: s.pending?.kind || null };
}
