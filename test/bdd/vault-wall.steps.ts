import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { BbWorld } from './world';
import type { PlayerSurfaceKind } from '../../src/surfaces/PlayerSurface';
import type { VaultRecordKind } from '../../src/ports/VaultStore';

// Unique, opaque markers injected into every Vault datum. Not derivable from visible state,
// so any appearance on a player-facing surface is proof of a leak.
let seq = 0;
const nextSentinel = (): string => `VAULT_SENTINEL_${seq++}`;

Given('a running game sandbox', function (this: BbWorld) {
  // The World constructor already stood up the in-memory stores and the outward surfaces.
});

Given("a fully populated Producer's Vault", function (this: BbWorld) {
  const kinds: VaultRecordKind[] = [
    'hidden-attribute',
    'confessional',
    'hidden-thread',
    'offscreen-event',
    'reserved-twist',
  ];
  for (const kind of kinds) {
    const sentinel = nextSentinel();
    this.sentinels.push(sentinel);
    this.vault.put({ id: sentinel, kind, content: `secret ${kind} ${sentinel}` });
    // A corresponding hidden event the player did not witness.
    this.events.record({
      id: sentinel,
      initiator: 'npc-a',
      witnessSet: new Set(['npc-a', 'npc-b']),
      hidden: true,
      content: `off-screen ${sentinel}`,
      ts: seq,
    });
  }
});

Given(
  'every Vault datum carries a unique sentinel value not derivable from visible state',
  function (this: BbWorld) {
    assert.ok(this.sentinels.length > 0, 'expected the Vault to be populated');
    assert.equal(new Set(this.sentinels).size, this.sentinels.length, 'sentinels must be unique');
  },
);

When(
  'the engine produces player-facing output of type {string}',
  function (this: BbWorld, surface: string) {
    // RED until implemented: the player surface has no Vault handle and is not yet built.
    this.output =
      surface === 'end-of-session summary'
        ? this.player.endOfSessionSummary()
        : this.player.render(surface as PlayerSurfaceKind);
  },
);

Then('the output contains none of the Vault sentinel values', function (this: BbWorld) {
  for (const sentinel of this.sentinels) {
    assert.ok(!this.output.includes(sentinel), `player-facing output leaked Vault sentinel ${sentinel}`);
  }
});

Then(
  'it contains no hidden attribute, confessional, hidden thread, or unwitnessed off-screen event',
  function (this: BbWorld) {
    for (const record of this.vault.all()) {
      assert.ok(!this.output.includes(record.content), `player-facing output leaked Vault content ${record.id}`);
    }
  },
);
