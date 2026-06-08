import type {
  GameSession, CreateCharacterReq, GameStateView, MomentPromptReq, MomentPromptView,
  RunCompetitionReq, CompetitionResultView,
} from "../../ports/GameSession";
import { startNewGame, hashSeed, isPlausibleArchetype } from "../../engine/characterFactory";
import type { GameHouse, StrategyStyle } from "../../engine/characterFactory";
import { buildSystemPrompt, momentForPhase } from "../../engine/momentPrompts";
import { resolveCompetition, CompetitionIntents } from "../../domain/competitionOutcome";
import type { CompetitionType, Competitor } from "../../domain/competitionOutcome";
import { SeededRandom } from "../random/SeededRandom";

const COMP_TYPES: ReadonlySet<string> = new Set<CompetitionType>([
  "endurance", "physical", "puzzle", "quiz", "memory", "mental", "social",
]);

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

  runCompetition(req: RunCompetitionReq): CompetitionResultView {
    const type = (COMP_TYPES.has(req.type ?? "") ? req.type : "endurance") as CompetitionType;
    if (!this.house) {
      return { started: false, type, week: 0, phase: this.phase, winner: null };
    }
    // The whole house competes by default; the engine reads its OWN stats (never the caller's).
    const all = [this.house.player, ...this.house.npcs];
    const ids = req.participantIds?.length ? new Set(req.participantIds) : null;
    const pool = ids ? all.filter((h) => ids.has(h.id)) : all;
    const field = pool.length >= 2 ? pool : all;
    const competitors: Competitor[] = field.map((h) => ({
      id: h.id,
      stats: h.character.stats,
      emotionalState: "soul" in h ? h.soul.emotionalState : 0.5,
    }));
    // Deterministic per moment so a given week/phase/type resolves the same way.
    const rng = new SeededRandom(hashSeed(`${this.week}:${this.phase}:${type}`));
    const { winner } = resolveCompetition(competitors, type, new CompetitionIntents(), rng);
    const w = field.find((h) => h.id === winner)!;
    return { started: true, type, week: this.week, phase: this.phase, winner: { id: w.id, name: w.name } };
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
