import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { BbWorld } from "../support/world";
import type { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import type { RelationshipModel } from "../../src/engine/relationships";
import type { EntityId } from "../../src/domain/ids";

/**
 * Feature 0105 — drive-anchored suspicion. Role-only (a schemer, a rival, a safe floater). Reuses the
 * 0086 Background ("…live drive layer enabled"), "the drive layer is disabled", and 0085's
 * "…jury calibration is unchanged" steps, and reads the same shared world fields they populate.
 */

// The drive steps (drives.steps.ts) store the live session/rel/ids under these keys.
interface SharedDriveWorld {
  dwSession?: GameSessionAdapter;
  dwRel?: RelationshipModel;
  dwIds?: EntityId[];
}
interface SWorld extends SharedDriveWorld {
  swSubject?: EntityId;
  swRival?: EntityId;
  swSuspects?: string[];
}
const sw = (w: BbWorld): SWorld => w as unknown as SWorld;
const DRIVE_MARKERS = /keeping a close eye on|sizing up|watching their back|wary feeling about/;
const suspectsOf = (s: GameSessionAdapter, id: EntityId): string[] => (s.npcVoice(id) as { suspects: string[] }).suspects;
const nameOf = (s: GameSessionAdapter, id: EntityId): string =>
  s.snapshot().house!.npcs.find((n) => n.id === id)?.name ?? "";

Given("a houseguest reads a rival as a threat", function (this: BbWorld) {
  const { dwSession: s, dwRel: rel, dwIds: ids } = sw(this);
  rel!.edge(ids![0]!, ids![1]!).threat = 0.85;
  s!.campaignTick();
  sw(this).swSubject = ids![0]!;
  sw(this).swRival = ids![1]!;
});

Given("a safe, under-the-radar houseguest", function (this: BbWorld) {
  const { dwSession: s, dwRel: rel, dwIds: ids } = sw(this);
  for (const o of ids!.filter((x) => x !== ids![0])) { rel!.edge(ids![0]!, o).threat = 0.1; rel!.edge(ids![0]!, o).affinity = 0.2; }
  s!.campaignTick();
  sw(this).swSubject = ids![0]!;
});

When("their voicing is read", function (this: BbWorld) {
  sw(this).swSuspects = suspectsOf(sw(this).dwSession!, sw(this).swSubject!);
});

Then("their suspicions name that rival", function (this: BbWorld) {
  const rivalName = nameOf(sw(this).dwSession!, sw(this).swRival!);
  const hunch = sw(this).swSuspects!.find((x) => DRIVE_MARKERS.test(x));
  assert.ok(hunch, "a drive-derived suspicion appears");
  assert.ok(hunch!.includes(rivalName), `the suspicion names the rival (${hunch})`);
});

Then("the suspicion is a behavioral hunch, not a number or a stated plan", function (this: BbWorld) {
  const hunch = sw(this).swSuspects!.find((x) => DRIVE_MARKERS.test(x))!;
  assert.ok(!/[0-9]/.test(hunch), "no number");
  assert.ok(!/campaign|intensity|motivation/i.test(hunch), "no plan/machinery word");
});

Then("their voicing carries no drive-derived suspicion", function (this: BbWorld) {
  assert.ok(!sw(this).swSuspects!.some((x) => DRIVE_MARKERS.test(x)), "no manufactured suspicion");
});

Then("it contains no drive number, no campaign, and no stated motive", function (this: BbWorld) {
  const blob = JSON.stringify(sw(this).swSuspects!);
  assert.ok(!/[0-9]/.test(blob), "no number in the suspicions");
  assert.ok(!/campaign|intensity|motivation|self-preserve|lay-low|win-power/i.test(blob), "no plan/motive content");
});

Then("no houseguest's voicing carries a drive-derived suspicion", function (this: BbWorld) {
  const s = sw(this).dwSession!;
  const ids = s.snapshot().house!.npcs.map((n) => n.id);
  for (const id of ids) {
    assert.ok(!suspectsOf(s, id).some((x) => DRIVE_MARKERS.test(x)), "no drive suspicion when the layer is off");
  }
});
