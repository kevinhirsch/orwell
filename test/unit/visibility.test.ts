import { describe, it, expect } from 'vitest';
import { classify, PLAYER, type GameEvent } from '../../src/domain/types';

describe('visibility.classify', () => {
  const event: GameEvent = {
    id: 'e1',
    initiator: 'npc-a',
    witnessSet: new Set(['npc-a', PLAYER]),
    hidden: false,
    content: 'a witnessed moment',
    ts: 0,
  };

  it('is VISIBLE to an entity in the witness set', () => {
    expect(classify(event, PLAYER)).toBe('VISIBLE');
  });

  it('is HIDDEN to an entity outside the witness set', () => {
    expect(classify(event, 'npc-z')).toBe('HIDDEN');
  });
});
