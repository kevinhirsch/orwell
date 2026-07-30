/**
 * #1792 — The Producer Read: ExchangeAccounting.
 *
 * A pure, Vault-free computation of what the player gained and what the NPC
 * gained from a single recorded interaction. NO imports of VaultStore,
 * SoulProvider, RelationshipModel, or any hidden-state type — structurally
 * incapable of reading hidden state.
 *
 * playerGained = the player's knowledge-id set GREW (ids in `after` not in
 * `beforeIds`, keyed `factId ?? id`).
 * npcGained   = derived from event.kind and content ONLY — NEVER reads NPC
 *               knowledge (that would need Vault). A strategy/gossip/alliance/
 *               betrayal kind means the player disclosed something.
 * asymmetry   = pure comparison of the two booleans.
 */

/** Vault-free accounting for a single interaction exchange. */
export interface ExchangeAccounting {
  playerGained: boolean;
  npcGained: boolean;
  /** Optional Vault-free summary string for what the player gained. */
  playerGainedSummary?: string;
  /** Optional Vault-free summary string for what the NPC gained. */
  npcGainedSummary?: string;
  /**
   * Who came out ahead in informational terms.
   * - "even" — both gained or neither gained.
   * - "player-ahead" — only the player gained.
   * - "npc-ahead" — only the NPC gained.
   */
  asymmetry?: 'even' | 'player-ahead' | 'npc-ahead';
}

/** Interaction kinds that imply the player disclosed information. */
const DISCLOSURE_KINDS: ReadonlySet<string> = new Set([
  'strategy', 'gossip', 'alliance', 'betrayal',
]);

/**
 * Compute the ExchangeAccounting for a single recorded interaction.
 *
 * @param event      The recorded event — uses `content` and optional `kind`.
 * @param beforeIds  The set of knowledge fact ids (factId ?? id) the player
 *                   held BEFORE the interaction was committed.
 * @param after      The player's knowledge facts AFTER the interaction.
 *                   Each fact is keyed by `factId ?? id`.
 * @returns          The ExchangeAccounting result, or a zero-value record
 *                   when the interaction is not substantive.
 */
export function computeExchangeAccounting(
  event: { content: string; kind?: string },
  beforeIds: ReadonlySet<string>,
  after: ReadonlyArray<{ id: string; factId?: string }>,
): ExchangeAccounting {
  // Determine if the player gained new facts.
  const afterIds = new Set(after.map((f) => f.factId ?? f.id));
  let playerGained = false;
  for (const id of afterIds) {
    if (!beforeIds.has(id)) {
      playerGained = true;
      break;
    }
  }

  // Determine if the NPC gained (the player disclosed).
  // NEVER reads NPC knowledge — only the event's own kind/content.
  const kind = event.kind ?? '';
  const npcGained = DISCLOSURE_KINDS.has(kind);

  // Player-gained summary (Vault-free: just a generic description).
  const playerGainedSummary = playerGained
    ? 'You learned something you did not know before.'
    : undefined;

  // NPC-gained summary (Vault-free: derived from the event kind).
  const npcGainedSummary = npcGained
    ? `You disclosed your ${kind} to them.`
    : undefined;

  // Asymmetry — pure boolean comparison.
  const asymmetry: 'even' | 'player-ahead' | 'npc-ahead' =
    playerGained === npcGained
      ? 'even'
      : playerGained
        ? 'player-ahead'
        : 'npc-ahead';

  return { playerGained, npcGained, playerGainedSummary, npcGainedSummary, asymmetry };
}

/**
 * Convert an ExchangeAccounting fact into a second-person Vault-free string for the moment prompt.
 * Never states a hidden number or asserts a trust/threat delta — only voices the Vault-free fields
 * (ADR 0003: facts to voice, never scripts to recite).
 */
export function producerReadPrompt(acc: ExchangeAccounting): string {
  const parts: string[] = [];

  if (acc.playerGained && acc.npcGained) {
    parts.push("You both walked away knowing more than before.");
  } else if (acc.playerGained && !acc.npcGained) {
    parts.push("You got more than you gave.");
  } else if (!acc.playerGained && acc.npcGained) {
    parts.push("You gave a little more than you got.");
  } else {
    parts.push("The exchange was a measured draw — no real advantage either way.");
  }

  if (acc.asymmetry === "player-ahead") {
    parts.push("The informational imbalance tipped your way.");
  } else if (acc.asymmetry === "npc-ahead") {
    parts.push("They read you a little more clearly than you read them.");
  }

  return parts.join(" ");
}
