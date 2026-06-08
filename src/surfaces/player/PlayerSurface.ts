import type { EntityId } from "../../domain/ids";
import type { NarrativePort, NarrationContext, NarrationMode, SceneFidelity } from "../../ports/NarrativePort";
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
  assembleNarrationContext(mode: NarrationMode = "scene", fidelity?: SceneFidelity): NarrationContext {
    const vs = this.visible.getVisibleStateFor(this.player);
    return {
      forEntity: this.player,
      mode,
      visibleEvents: vs.visibleEvents,
      knowledge: vs.knowledge,
      ...(fidelity ? { fidelity } : {}),
    };
  }

  /**
   * Render a scene at a player-directed fidelity (0012). Fidelity rides along in
   * the Vault-free narration context and shapes the narration only — it never
   * touches events or knowledge, so ground truth is identical at any fidelity.
   */
  renderScene(fidelity: SceneFidelity): string {
    return this.narrator.narrate(this.assembleNarrationContext("scene", fidelity));
  }

  /**
   * A social read (0012): an honest, character-appropriate sense of the room or a
   * houseguest, sourced ONLY from the visible projection (witnessed events + the
   * player's own knowledge) and pathway-free hunches. It may HINT that something
   * is shifting off-screen (from suspicion presence) but never names an off-screen
   * event and never carries Vault data — it cannot, as it reads no Vault source.
   */
  socialRead(target?: EntityId): string {
    const vs = this.visible.getVisibleStateFor(this.player);
    const suspicions = this.visible.suspicionsFor(this.player);
    const focus = target ? `your read on ${target}` : "the energy in the room";
    // Hint is derived from suspicion COUNT only — never suspicion content — so no
    // off-screen event can be named and no sentinel can ride out.
    const hint = suspicions.length > 0
      ? " Something feels unsettled — you can't name it, but the house isn't telling you everything."
      : " Nothing feels out of place right now.";
    return `Reading ${focus}: you've witnessed ${vs.visibleEvents.length} moment(s) and know ${vs.knowledge.length} thing(s) for certain.${hint}`;
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
