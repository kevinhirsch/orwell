import type { EntityId } from "../../domain/ids";
import type { NarrativePort, NarrationContext, NarrationMode } from "../../ports/NarrativePort";
import { VisibleStateService } from "../../services/VisibleStateService";
import { SummaryService } from "../../services/SummaryService";
import { toPlayerCompetitionView } from "../../domain/competition";
import type { PlayerCompetitionView } from "../../domain/competition";
import { InterrogationHandler } from "./InterrogationHandler";

export type PlayerSurfaceType =
  | "scene narration"
  | "NPC dialogue"
  | "system message"
  | "player-visible log"
  | "end-of-session summary";

/**
 * Everything the player sees flows through here, and everything here is sourced
 * from the visible projection (`VisibleStateService`) or fixed strings. There is
 * no dependency edge from this module to the Vault.
 */
export class PlayerSurface {
  private readonly interrogation = new InterrogationHandler();

  constructor(
    private readonly player: EntityId,
    private readonly visible: VisibleStateService,
    private readonly narrator: NarrativePort,
    private readonly summary: SummaryService,
  ) {}

  /** The player's visible projection (witnessed events + their knowledge). */
  getVisibleState() {
    return this.visible.getVisibleStateFor(this.player);
  }

  /** The exact context handed to the narrative layer — provably Vault-free. */
  assembleNarrationContext(mode: NarrationMode = "scene"): NarrationContext {
    const vs = this.visible.getVisibleStateFor(this.player);
    return {
      forEntity: this.player,
      mode,
      visibleEvents: vs.visibleEvents,
      knowledge: vs.knowledge,
    };
  }

  produce(surface: PlayerSurfaceType): string {
    switch (surface) {
      case "scene narration":
        return this.narrator.narrate(this.assembleNarrationContext("scene"));
      case "NPC dialogue":
        return this.narrator.narrate(this.assembleNarrationContext("dialogue"));
      case "system message":
        return this.renderSystemMessage();
      case "player-visible log":
        return this.renderLog();
      case "end-of-session summary":
        return this.summary.endOfSession();
      default: {
        const _exhaustive: never = surface;
        throw new Error(`Unknown player surface: ${String(_exhaustive)}`);
      }
    }
  }

  renderLog(): string {
    const vs = this.visible.getVisibleStateFor(this.player);
    return [
      ...vs.visibleEvents.map((e) => `[${e.ts}] ${e.type}: ${e.content}`),
      ...vs.knowledge.map((k) => `[${k.ts}] known (${k.pathway}): ${k.content}`),
    ].join("\n");
  }

  renderSystemMessage(): string {
    const vs = this.visible.getVisibleStateFor(this.player);
    return `Day update. You witnessed ${vs.visibleEvents.length} event(s); you know ${vs.knowledge.length} fact(s).`;
  }

  /** Competition results are delivered as outcomes; stats cannot be passed in. */
  competitionResult(input: { type: string; winnerLabel: string }): PlayerCompetitionView {
    return toPlayerCompetitionView(input);
  }

  ask(question: string): string {
    return this.interrogation.ask(question);
  }
}
