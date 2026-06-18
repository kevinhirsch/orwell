// Core operational scenes — populated home base, settings, theme picker.
import { launch, capture } from './lib.mjs';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:7000';

const settleHome = async (page) => {
  // let the status HUD + sidebar roster settle
  await page.waitForTimeout(2500);
};

const openSettings = (tab) => async (page) => {
  await page.waitForTimeout(2000);
  await page.click('#user-bar-settings').catch(() => {});
  await page.waitForTimeout(600);
  if (tab) {
    await page.click(`#settings-modal [data-settings-tab='${tab}']`).catch(() => {});
    await page.waitForTimeout(500);
  }
};

const browser = await launch();
try {
  await capture(browser, { name: 'state3-home', base: BASE, path: '/', settle: 4000, prepare: settleHome });
  await capture(browser, { name: 'settings-account', base: BASE, path: '/', settle: 3500, prepare: openSettings('account') });
  await capture(browser, { name: 'settings-ai', base: BASE, path: '/', settle: 3500, prepare: openSettings('ai') });
  await capture(browser, { name: 'settings-appearance', base: BASE, path: '/', settle: 3500, prepare: openSettings('appearance') });
  await capture(browser, { name: 'settings-system', base: BASE, path: '/', settle: 3500, prepare: openSettings('system') });
  await capture(browser, { name: 'settings-shortcuts', base: BASE, path: '/', settle: 3500, prepare: openSettings('shortcuts') });
  await capture(browser, { name: 'theme-picker', base: BASE, path: '/', settle: 3500, prepare: async (page) => {
    await page.waitForTimeout(2000);
    await page.click('#tool-theme-btn').catch(() => {});
    await page.waitForTimeout(600);
  }});
} finally {
  await browser.close();
}
console.log('coreScenes done');
