// Game-surface scenes — cast roster, finale panel, decision card, social, diary room, status HUD.
import { launch, capture } from './lib.mjs';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:7000';

const settle = (ms) => (p) => p.waitForTimeout(ms);

const browser = await launch();
try {
  // Cast roster window (real game roster of 15 NPCs + player).
  await capture(browser, { name: 'game-cast', base: BASE, path: '/', settle: 4000, prepare: async (p) => {
    await p.waitForTimeout(1500);
    await p.evaluate(() => window._orwellCastEnsure && window._orwellCastEnsure());
    await p.waitForTimeout(1200);
  }});

  // Finale panel (kit window) — projection is null mid-season; capture the panel chrome/empty.
  await capture(browser, { name: 'game-finale', base: BASE, path: '/', settle: 3500, prepare: async (p) => {
    await p.waitForTimeout(1500);
    await p.evaluate(() => window._orwellFinaleEnsure && window._orwellFinaleEnsure());
    await p.waitForTimeout(1000);
  }});

  // Decision card — nominations pending (real component, role-named options).
  await capture(browser, { name: 'game-decision-noms', base: BASE, path: '/', settle: 3500, prepare: async (p) => {
    await p.waitForTimeout(1500);
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('orwell:pending', { detail: { pending: {
      kind: 'nominations', pick: 2, prompt: 'As Head of Household, name two houseguests for eviction.',
      options: [ {id:'npc:1',name:'Sofia Marshall'}, {id:'npc:2',name:'Frankie Paul'},
                 {id:'npc:3',name:'Cesar Duran'}, {id:'npc:4',name:'A Houseguest'} ] }}})));
    await p.waitForTimeout(800);
  }});

  // Social "The House" sidebar section with two pending approaches.
  await capture(browser, { name: 'game-social', base: BASE, path: '/', settle: 3500, prepare: async (p) => {
    await p.waitForTimeout(1500);
    await p.evaluate(() => {
      window._orwellSocialEnsure && window._orwellSocialEnsure();
      window._orwellSocialDriveApproaches && window._orwellSocialDriveApproaches(true, [
        { houseguest: { id: 'npc:1', name: 'Sofia Marshall' }, motive: 'bond' },
        { houseguest: { id: 'npc:2', name: 'Frankie Paul' }, motive: 'probe' } ]);
    });
    await p.waitForTimeout(800);
  }});

  // Diary Room composer mode.
  await capture(browser, { name: 'game-diary', base: BASE, path: '/', settle: 3500, prepare: async (p) => {
    await p.waitForTimeout(1500);
    await p.evaluate(() => window._orwellOpenDiaryRoom && window._orwellOpenDiaryRoom());
    await p.waitForTimeout(700);
  }});

  // Status HUD expanded (explicit ensure).
  await capture(browser, { name: 'game-statushud', base: BASE, path: '/', settle: 3500, prepare: async (p) => {
    await p.waitForTimeout(2000);
    await p.evaluate(() => window._orwellStatusEnsure && window._orwellStatusEnsure());
    await p.waitForTimeout(800);
  }});
} finally {
  await browser.close();
}
console.log('gameScenes done');
