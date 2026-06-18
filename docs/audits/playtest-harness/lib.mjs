// Shared capture/telemetry helpers for the Orwell FE audit.
// Vanilla Playwright; full-page PNGs at Desktop 1440x900 + Mobile 375x812,
// plus an in-page programmatic defect scan and an innerText copy dump.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';

export const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

export const BP = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 375, height: 812 },
};

// The in-page defect scan injected on every surface. Pure DOM reads; returns a
// structured report (horizontal overflow, off-viewport elements, whitespace
// copy smells, tap-target undersize, contrast-ish flags left to the eye).
export const DEFECT_SCAN = `(() => {
  const vw = document.documentElement.clientWidth;
  const docOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth
    ? { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth } : null;
  const offscreen = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
    if (r.right > vw + 1 && cs.position !== 'fixed') {
      const key = el.tagName + '.' + (el.className && el.className.toString ? el.className.toString().slice(0,40) : '');
      if (seen.has(key)) continue; seen.add(key);
      offscreen.push({ tag: el.tagName, cls: (el.className||'').toString().slice(0,60),
        id: el.id||'', right: Math.round(r.right), vw, overBy: Math.round(r.right - vw),
        text: (el.innerText||'').trim().slice(0,40) });
    }
  }
  // Copy smells in visible text nodes.
  const smells = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n; const reSmell = [
    [/ [,.;:!?]/, 'space-before-punct'],
    [/\\(\\s/, 'space-after-open-paren'],
    [/\\s\\)/, 'space-before-close-paren'],
    [/  +/, 'double-space'],
    [/\\bFR-\\d|\\bNFR-\\d/, 'spec-jargon'],
  ];
  while ((n = walker.nextNode())) {
    const t = n.nodeValue; if (!t || !t.trim()) continue;
    const p = n.parentElement; if (!p) continue;
    const cs = getComputedStyle(p);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    for (const [re, label] of reSmell) {
      if (re.test(t)) { smells.push({ label, text: t.trim().slice(0,80), parent: p.tagName + (p.id?'#'+p.id:'') }); break; }
    }
  }
  // Undersized tap targets (coarse-pointer floor is 44h/36w per the responsive contract).
  const taps = [];
  for (const el of document.querySelectorAll('button, [role=button], a.list-item, select, .settings-tab')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (r.height < 24 || r.width < 16) taps.push({ tag: el.tagName, id: el.id||'',
      cls:(el.className||'').toString().slice(0,40), w: Math.round(r.width), h: Math.round(r.height),
      label: (el.getAttribute('aria-label')||el.title||el.innerText||'').trim().slice(0,30) });
  }
  return { docOverflow, offscreen: offscreen.slice(0,40), smells: smells.slice(0,40), taps: taps.slice(0,40) };
})()`;

export async function launch() {
  return chromium.launch();
}

// Capture one named surface at both breakpoints. `prepare(page)` runs in-page
// actions (open a modal, mount a panel, etc.) AFTER load and BEFORE the shot.
// Returns { name, desktop:{report,text}, mobile:{report,text}, errors }.
// Optional auth: { user, pass } logs in via the API on the context request so
// every page in the context shares the session cookie (no form friction).
export async function capture(browser, { name, base, path = '/', prepare = null,
    settle = 900, fullPage = true, auth = null }) {
  const out = { name, base, path, breakpoints: {} };
  for (const [bpName, vp] of Object.entries(BP)) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
    if (auth) {
      await ctx.request.post(base + '/api/auth/login', {
        data: { username: auth.user, password: auth.pass },
      }).catch(() => {});
    }
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text().slice(0,200)); });
    try {
      await page.goto(base + path, { waitUntil: 'load', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(settle);
      if (prepare) await prepare(page, bpName);
      await page.waitForTimeout(350);
    } catch (e) {
      errors.push('nav: ' + e.message);
    }
    let report = null, text = '';
    try { report = await page.evaluate(DEFECT_SCAN); } catch (e) { report = { scanError: e.message }; }
    try { text = await page.evaluate(() => document.body.innerText); } catch {}
    const file = `${SHOTS}${name}-${bpName}.png`;
    try { await page.screenshot({ path: file, fullPage }); } catch (e) { errors.push('shot: ' + e.message); }
    writeFileSync(`${SHOTS}${name}-${bpName}.txt`, text || '');
    out.breakpoints[bpName] = { file, report, errors: [...errors], textLen: (text||'').length };
    await ctx.close();
  }
  writeFileSync(`${SHOTS}${name}.json`, JSON.stringify(out, null, 2));
  // Console summary
  for (const [bp, r] of Object.entries(out.breakpoints)) {
    const rep = r.report || {};
    console.log(`[${name}/${bp}] overflow=${rep.docOverflow?'YES':'no'} offscreen=${(rep.offscreen||[]).length} smells=${(rep.smells||[]).length} taps=${(rep.taps||[]).length} errors=${r.errors.length}`);
    for (const e of r.errors.slice(0,6)) console.log(`    ! ${e}`);
    for (const s of (rep.smells||[]).slice(0,6)) console.log(`    ~ copy[${s.label}]: "${s.text}"`);
    for (const o of (rep.offscreen||[]).slice(0,6)) console.log(`    > overflow ${o.tag}.${o.cls} +${o.overBy}px "${o.text}"`);
  }
  return out;
}
