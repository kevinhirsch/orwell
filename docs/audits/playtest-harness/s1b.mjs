// State 1 (cont.) — Settings (all tabs) + the forced onboarding states (engine-down F5, welcome).
import { launch, newCtx, DEFECT_SCAN, BASE } from './rig.mjs';
import { writeFileSync, mkdirSync } from 'fs';
const HERE = new URL('.', import.meta.url).pathname;
mkdirSync(HERE + 'shots', { recursive: true });
const TABSEL = '.settings-tab, .settings-nav button, [role=tab], #settings-modal [data-tab], .settings-sidebar button, .settings-menu button';

const b = await launch();
try {
  for (const device of ['desktop', 'mobile']) {
    const ctx = await newCtx(b, device, { auth: true });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 200)));
    await page.goto(BASE + '/', { waitUntil: 'load', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    // Clear the onboarding overlay (it inerts the page) so Settings is reachable.
    await page.evaluate(() => { const ob = document.getElementById('orwell-onboarding'); if (ob) ob.remove(); document.querySelectorAll('[inert]').forEach(n => { try { n.inert = false; } catch (_) {} }); });
    if (device !== 'desktop') { await page.click('#hamburger-btn').catch(() => {}); await page.waitForTimeout(500); }
    const opened = await page.evaluate(() => { const g = document.getElementById('user-bar-settings'); if (g) { g.click(); return 'gear'; } if (window.settingsModule?.open) { window.settingsModule.open(); return 'module'; } return null; });
    await page.waitForTimeout(1300);
    const tabs = await page.evaluate((sel) => Array.from(document.querySelectorAll(sel)).map((el, i) => ({ i, id: el.id, text: (el.innerText || '').trim().slice(0, 24), data: el.getAttribute('data-tab') })).filter(t => t.text || t.data || t.id), TABSEL);
    writeFileSync(`${HERE}shots/s1-settings-${device}-tabs.json`, JSON.stringify({ opened, tabs }, null, 2));
    await page.screenshot({ path: `${HERE}shots/s1-settings-${device}.png`, fullPage: true }).catch(() => {});
    for (const t of tabs) {
      try {
        await page.evaluate(({ sel, i }) => { document.querySelectorAll(sel)[i]?.click(); }, { sel: TABSEL, i: t.i });
        await page.waitForTimeout(700);
        const tag = (t.text || t.data || t.id || ('tab' + t.i)).replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '');
        const report = await page.evaluate(DEFECT_SCAN);
        writeFileSync(`${HERE}shots/s1-settings-${device}-${tag}.json`, JSON.stringify(report, null, 2));
        await page.screenshot({ path: `${HERE}shots/s1-settings-${device}-${tag}.png`, fullPage: true }).catch(() => {});
        console.log(`[settings/${device}/${tag}] overflow=${report.docOverflow ? 'YES' : 'no'} offscreen=${(report.offscreen || []).length} taps<min=${(report.taps || []).length} smells=${(report.smells || []).length}`);
        for (const o of (report.offscreen || []).slice(0, 4)) console.log(`     > overflow ${o.tag}.${o.cls} +${o.overBy}px "${o.text}"`);
      } catch (e) { console.log('  tab err', t.i, String(e.message).slice(0, 80)); }
    }
    if (errs.length) console.log(`[settings/${device}] pageerrors:`, errs.slice(0, 4));
    await ctx.close();
  }
  // Forced onboarding states via the deterministic seams (desktop + mobile).
  for (const device of ['desktop', 'mobile']) {
    for (const [tag, seam] of [['darkhouse', '_orwellOnboardingMount'], ['welcome', '_orwellWelcomeMount']]) {
      const ctx = await newCtx(b, device, { auth: true });
      const page = await ctx.newPage();
      await page.goto(BASE + '/', { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(1500);
      await page.evaluate(() => { const ob = document.getElementById('orwell-onboarding'); if (ob) ob.remove(); document.querySelectorAll('[inert]').forEach(n => { try { n.inert = false; } catch (_) {} }); });
      await page.evaluate((s) => { if (typeof window[s] === 'function') window[s](); }, seam);
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${HERE}shots/s1-onboarding-${tag}-${device}.png`, fullPage: true }).catch(() => {});
      await ctx.close();
    }
  }
} finally { await b.close(); }
console.log('STATE1B DONE');
