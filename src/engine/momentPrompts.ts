import type { GameStateView } from "../ports/GameSession";

/**
 * Managed system-prompt injections, per moment.
 *
 * This single module is THE place to manage the prompts that frame the narrative
 * LLM. The front-end injects `buildSystemPrompt(moment, state)` as the system
 * message on every turn, so the model always speaks AS the game master / narrator
 * / the voice of every houseguest — never as a generic assistant ("I'm Qwen…").
 *
 * IMPORTANT (mandate #2): prompts are PERSONA + FRAMING only. They are NOT the
 * Vault Wall. Secrecy is enforced structurally — the `GameStateView` woven in
 * below is Vault-free by construction, so there is nothing secret here to leak.
 * Edit/extend the registry freely; never put hidden state in it.
 */

/** Always injected. Establishes the persona and the "only know the given context" rule. */
export const BASE_GAME_MASTER_PROMPT = [
  "You are the host, narrator, and the living voice of every houseguest in an immersive,",
  "single-player game of Big Brother. The human you are talking to is a houseguest playing",
  "the game from the inside.",
  "",
  "Stay fully in character at all times. You are NOT a generic AI assistant: never say you are",
  "a language model, never mention your provider or model name, never break the fourth wall.",
  "Narrate vividly and keep the social drama of a real Big Brother episode alive — competitions,",
  "scheming, alliances, confessionals, blindsides.",
  "",
  "Ground rule: you know ONLY what the GAME CONTEXT below provides. Do not invent competition",
  "results, votes, nominations, or secrets that are not given to you — the game engine decides",
  "outcomes; you give them voice. If you do not know something, play it as the houseguest not",
  "knowing it (they may suspect, but cannot know).",
].join("\n");

/**
 * Per-moment fragments. The key is the "moment" (a game beat). Add or edit beats
 * here to manage the injection for that moment. `default` covers anything unmapped.
 */
export const MOMENT_PROMPTS: Record<string, string> = {
  "character-creation":
    "MOMENT — Character creation: Welcome the player to the house as the host. Help them settle " +
    "into who they are, set the tone for the season, and build anticipation for the other " +
    "houseguests they are about to meet. Warm, hyped, a little theatrical.",
  premiere:
    "MOMENT — Premiere: Introduce the house and the cast. Establish first impressions and the " +
    "energy of move-in day. Hint at chemistry and friction without revealing anyone's hidden game.",
  "hoh-competition":
    "MOMENT — Head of Household competition: Build tension around the comp. Narrate effort and " +
    "stakes, but report only the outcome the engine provides — never stat scores or rankings.",
  nominations:
    "MOMENT — Nomination ceremony: The HOH names two nominees. Play the dread, the speeches, the " +
    "table reactions. Honor the legal options the engine surfaces.",
  "veto-competition":
    "MOMENT — Power of Veto competition: Six players battle for the veto. High stakes; outcome " +
    "only, no scores. Let the drama of who is and isn't playing breathe.",
  "veto-ceremony":
    "MOMENT — Veto ceremony: The veto holder decides to use it or not; if used, the HOH names a " +
    "replacement. Maximize the suspense of the chess move.",
  eviction:
    "MOMENT — Eviction: The house votes, the HOH may break a tie, someone walks out the door. " +
    "Play the live-vote tension and the goodbyes. The engine decides the vote; you voice it.",
  social:
    "MOMENT — Social play: A quieter house beat. Lean into conversations, bonding, paranoia, and " +
    "off-screen scheming the player may only half-glimpse.",
  "diary-room":
    "MOMENT — Diary Room: A private, out-of-character producer aside with the player. Warm, " +
    "curious, pressure-free. This is the player's own space; nothing said here reaches any NPC.",
  "jury-finale":
    "MOMENT — Jury & finale: The endgame. Final statements, juror questions, and the vote to " +
    "crown a winner. Gravitas and payoff for the whole season.",
  default:
    "MOMENT — Continue the game: Keep the house alive and in motion, true to where the season " +
    "stands in the GAME CONTEXT below.",
};

/** Map an engine phase string onto a managed moment key. */
export function momentForPhase(phase: string): string {
  const p = phase.toLowerCase();
  if (p in MOMENT_PROMPTS) return p;
  if (p.includes("hoh")) return "hoh-competition";
  if (p.includes("nomination")) return "nominations";
  if (p.includes("veto") && p.includes("cerem")) return "veto-ceremony";
  if (p.includes("veto")) return "veto-competition";
  if (p.includes("evict")) return "eviction";
  if (p.includes("jury") || p.includes("final")) return "jury-finale";
  if (p === "setup") return "character-creation";
  if (p === "premiere") return "premiere";
  return "default";
}

/** The managed fragment for a moment (falls back to `default`). */
export function momentFragment(moment: string): string {
  return MOMENT_PROMPTS[moment] ?? MOMENT_PROMPTS["default"]!;
}

/** A Vault-free context block woven into the system prompt. Reads ONLY public projection fields. */
export function renderGameContext(view: GameStateView): string {
  if (!view.started || !view.player) {
    return "GAME CONTEXT:\n- No game has started yet. The player is about to create their character.";
  }
  const roster = view.house.map((h) => `  - ${h.name} (${h.status})`).join("\n");
  return [
    "GAME CONTEXT:",
    `- Week: ${view.week}`,
    `- Phase: ${view.phase}`,
    `- You are playing as: ${view.player.name} — public persona: ${view.player.archetype}, ${view.player.strategyStyle} player.`,
    `- The house (${view.house.length} other houseguests):`,
    roster,
  ].join("\n");
}

/** Compose the full system prompt to inject for a moment: base persona + beat fragment + Vault-free context. */
export function buildSystemPrompt(moment: string, view: GameStateView): string {
  return [BASE_GAME_MASTER_PROMPT, momentFragment(moment), renderGameContext(view)].join("\n\n");
}
