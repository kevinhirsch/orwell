import type {
  GameSession, CreateCharacterReq, GameStateView, MomentPromptReq, MomentPromptView,
} from "../../ports/GameSession";
import { startNewGame, hashSeed, isPlausibleArchetype } from "../../engine/characterFactory";
import type { GameHouse, StrategyStyle } from "../../engine/characterFactory";
import { buildSystemPrompt, momentForPhase } from "../../engine/momentPrompts";

/**
 * Engine-side implementation of the Vault-free game-session port. It runs the
 * OOBE (the one human-authored profile) and holds the active house, then projects
 * it to a Vault-free view: the player's own authored card plus a name-only house
 * roster — NO stats, NO souls, NO archetypes, NO hidden attributes cross the wall.
 *
 * Lives on the ENGINE side (like `EngineCommandsAdapter`); the outward MCP server
 * depends on the `GameSession` port, never on this class or the prompt module.
 */
export class GameSessionAdapter implements GameSession {
  private house: GameHouse | null = null;
  private week = 0;
  private phase = "setup";

  createCharacter(req: CreateCharacterReq): GameStateView {
    const seed = req.seed ?? hashSeed(req.playerName);
    const archetype = req.archetype && isPlausibleArchetype(req.archetype) ? req.archetype : undefined;
    const strategyStyle = req.strategyStyle as StrategyStyle | undefined;
    this.house = startNewGame({ seed, playerName: req.playerName, archetype, strategyStyle });
    this.week = 1;
    this.phase = "premiere";
    return this.view();
  }

  getGameState(): GameStateView {
    return this.view();
  }

  getMomentPrompt(req: MomentPromptReq): MomentPromptView {
    const view = this.view();
    const moment = req.moment ?? view.moment;
    return { moment, systemPrompt: buildSystemPrompt(moment, view) };
  }

  /** The Vault-free projection. Player card = authored persona (no numeric stats); NPCs = name + status only. */
  private view(): GameStateView {
    if (!this.house) {
      return { started: false, week: 0, phase: this.phase, moment: "character-creation", player: null, house: [] };
    }
    const p = this.house.player;
    return {
      started: true,
      week: this.week,
      phase: this.phase,
      moment: momentForPhase(this.phase),
      player: {
        id: p.id,
        name: p.name,
        archetype: p.character.archetype,
        strategyStyle: p.character.strategyStyle,
      },
      house: this.house.npcs.map((n) => ({ id: n.id, name: n.name, status: "active" })),
    };
  }
}
