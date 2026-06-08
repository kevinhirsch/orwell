export type OutwardChannel = "player" | "admin/God Mode";

/**
 * A tool exposed to an outward channel. `readsVault` is the literal `false`: the
 * type itself forbids registering a Vault-reading tool in these registries, so
 * the capability allowlist cannot grow a Vault reader without a compile error.
 */
export interface ToolDescriptor {
  name: string;
  channel: OutwardChannel;
  readsVault: false;
  description: string;
}

export const PLAYER_TOOLS: readonly ToolDescriptor[] = [
  // Onboarding + per-moment narration framing (Vault-free game-session port).
  { name: "createCharacter", channel: "player", readsVault: false, description: "Run OOBE and start a new game; returns the Vault-free game state." },
  { name: "getGameState", channel: "player", readsVault: false, description: "Current Vault-free game state: phase, the player's card, and the house roster (names)." },
  { name: "getMomentPrompt", channel: "player", readsVault: false, description: "The managed system prompt to inject for the current moment (persona + framing; Vault-free)." },
  { name: "getVisibleStateFor", channel: "player", readsVault: false, description: "Visible events + the player's own knowledge." },
  { name: "renderScene", channel: "player", readsVault: false, description: "Narrate a moment from the visible projection." },
  { name: "askProducers", channel: "player", readsVault: false, description: "Direct interrogation; never confirms/denies Vault content." },
  { name: "endOfSessionSummary", channel: "player", readsVault: false, description: "Confirms only that updated save(s) exist." },
  // Action tools (0009): request in, Vault-free result out (engine performs them).
  { name: "recordInteraction", channel: "player", readsVault: false, description: "Record a player-witnessed interaction; returns its id." },
  { name: "resolveCompetition", channel: "player", readsVault: false, description: "Engine-decided outcome only — no stats, rankings, or Vault reasoning." },
  { name: "surfaceInformationTo", channel: "player", readsVault: false, description: "Move a hidden fact into knowledge via a recorded in-game pathway." },
];

export const ADMIN_TOOLS: readonly ToolDescriptor[] = [
  { name: "inspectNonVaultState", channel: "admin/God Mode", readsVault: false, description: "Inspect non-Vault game state." },
  { name: "overrideMechanic", channel: "admin/God Mode", readsVault: false, description: "Override a non-Vault mechanic in the sandbox." },
];

export function toolsFor(channel: OutwardChannel): readonly ToolDescriptor[] {
  return channel === "player" ? PLAYER_TOOLS : ADMIN_TOOLS;
}
