/**
 * Player-facing projection of a competition result.
 *
 * Legacy Vault-Wall rule: results are delivered as OUTCOMES — never stat scores,
 * ratings, or relative rankings. The projection below structurally cannot carry
 * stats: it only accepts a competition type and a winner label, so there is no
 * field through which a score could leak.
 */
export interface PlayerCompetitionView {
  type: string;
  outcome: string;
}

export function toPlayerCompetitionView(input: {
  type: string;
  winnerLabel: string;
}): PlayerCompetitionView {
  return {
    type: input.type,
    outcome: `${input.winnerLabel} won the ${input.type} competition.`,
  };
}
