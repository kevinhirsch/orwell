import type { EntityId } from "../../domain/ids";
import type { NarrativePort, NarrationContext, NarrationMode, SceneFidelity } from "../../ports/NarrativePort";
import { VisibleStateService } from "../../services/VisibleStateService";
import type { VisibleState } from "../../services/VisibleStateService";
import { SummaryService } from "../../services/SummaryService";
import { toPlayerCompetitionView } from "../../domain/competition";
import type { PlayerCompetitionView } from "../../domain/competition";
import { pathwayLabel } from "../../domain/humanize";
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
  /**
   * Resolve a houseguest id → PUBLIC display name (non-Vault: names are public roster facts).
   * Optional because the pure in-memory composition has no live roster; the live registry wires
   * it from the session so player-facing prose never echoes a raw `npc:N` id.
   */
  private nameResolver?: (id: EntityId) => string | undefined;
  setNameResolver(fn: (id: EntityId) => string | undefined): void {
    this.nameResolver = fn;
  }

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

  /** Assemble the narration context from an ALREADY-computed visible projection (no re-fetch).
   *  Byte-identical to `assembleNarrationContext` — factored out so a caller that already holds the
   *  projection (the checkpoint's vault-leak sweep) does not pay the O(events) witness scan again. */
  private contextFrom(vs: VisibleState, mode: NarrationMode, fidelity?: SceneFidelity): NarrationContext {
    return {
      forEntity: this.player,
      mode,
      visibleEvents: vs.visibleEvents,
      knowledge: vs.knowledge,
      ...(fidelity ? { fidelity } : {}),
    };
  }

  /** The exact context handed to the narrative layer — provably Vault-free. */
  assembleNarrationContext(mode: NarrationMode = "scene", fidelity?: SceneFidelity): NarrationContext {
    return this.contextFrom(this.visible.getVisibleStateFor(this.player), mode, fidelity);
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
    // Resolve the target to a NAME — never echo the raw `npc:N` id into player-facing prose
    // (a real immersion break the play-through caught). Falls back to a generic noun when the
    // name can't be resolved (e.g. the resolver is unwired or returns an id-shaped string).
    let who: string | undefined;
    if (target) {
      const resolved = this.nameResolver?.(target);
      who = resolved && !/^(npc:|player\b)/.test(resolved) ? resolved : "that houseguest";
    }
    const focus = who ? `your read on ${who}` : "the energy in the room";
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
    return this.renderLogFrom(this.visible.getVisibleStateFor(this.player));
  }

  /** `renderLog` over an ALREADY-computed projection (no re-fetch) — byte-identical. */
  private renderLogFrom(vs: VisibleState): string {
    const roster = this.visible.publicRoster();
    // The pathway is internal plumbing (`overheard:offscreen:…`, `told-by:npc:3`) — never echo it
    // raw into a player-facing log; render a friendly source label instead (audit R4-03). Content
    // is already scrubbed by the visible projection.
    return [
      ...vs.visibleEvents.map((e) => `[${e.ts}] ${e.type}: ${e.content}`),
      ...vs.knowledge.map((k) => `[${k.ts}] known (${pathwayLabel(k.pathway, roster)}): ${k.content}`),
    ].join("\n");
  }

  /**
   * The Vault-leak sweep surface (feature 0031 checkpoint): EVERY player-facing rendering that could
   * carry event/knowledge content, concatenated so the orchestrator's fail-closed checkpoint can scan
   * it for any unsanctioned hidden content. It computes the player's visible projection ONCE and renders
   * all four surfaces from it — BYTE-IDENTICAL to rendering each independently (the projection is a pure,
   * deterministic function of the current stores), but paying the O(events) witness-filter + roster scrub
   * a single time instead of four. The set of surfaces (and their exact string forms) is unchanged, so
   * the leak-detection guarantee is preserved exactly — no player/admin surface may ever carry Vault data.
   */
  vaultLeakSweep(): string {
    const vs = this.visible.getVisibleStateFor(this.player);
    const context = this.contextFrom(vs, "scene");
    return [
      this.renderLogFrom(vs),          // produce("player-visible log")
      this.narrator.narrate(context),  // produce("scene narration")
      JSON.stringify(context),         // assembleNarrationContext("scene")
      JSON.stringify(vs),              // getVisibleState()
    ].join("\n---\n");
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
