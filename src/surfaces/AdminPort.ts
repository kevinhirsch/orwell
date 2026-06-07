import type { EventStore } from '../ports/EventStore';
import { NotImplementedError } from './PlayerSurface';

/**
 * Administrator / God Mode. Inspects NON-Vault state only — walled from the Vault even for
 * the admin (spoilers ruin the game). Like PlayerSurface, it has no Vault handle by
 * construction.
 *
 * STUB. Implementer (feature 0001): return non-Vault state only.
 */
export class AdminPort {
  constructor(private readonly events: EventStore) {}

  inspect(_query: string): unknown {
    throw new NotImplementedError('AdminPort.inspect');
  }
}
