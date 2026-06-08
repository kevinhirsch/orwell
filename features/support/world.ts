import { setWorldConstructor, setDefaultTimeout, World } from "@cucumber/cucumber";
import type { IWorldOptions } from "@cucumber/cucumber";
import type { Sandbox, VaultDatum } from "../../tests/support/sandbox";
import type { ToolDescriptor } from "../../src/surfaces/tools/registry";
import type { GameEvent, Visibility, EntityId } from "../../src/domain/event";
import type { SocialGraph } from "../../src/engine/gossip";
import type { SeasonResult } from "../../src/engine/simulation";
import type { RichnessMetrics } from "../../src/engine/richness";

// dependency-cruiser (architecture step) can take a few seconds on a cold cache.
setDefaultTimeout(60_000);

export class BbWorld extends World {
  sandbox!: Sandbox;
  lastOutput = "";
  lastView: unknown;
  specific?: VaultDatum;
  surfaced?: { content: string };
  question = "";
  tools: readonly ToolDescriptor[] = [];

  // Feature 0002 scratch state.
  firstEvent?: GameEvent;
  secondEvent?: GameEvent;
  hiddenEvent?: GameEvent;
  offscreen?: GameEvent[];
  npc?: EntityId;
  factContent?: string;
  classification?: Visibility;

  // Gossip-diffusion scratch state.
  graph?: SocialGraph;
  gossipNodes?: EntityId[];
  gossipOrigin?: EntityId;
  factId?: string;
  gossipOriginal?: string;

  // Behavioral-fidelity (0003) scratch state.
  season?: SeasonResult;
  metrics?: RichnessMetrics;

  constructor(options: IWorldOptions) {
    super(options);
  }
}

setWorldConstructor(BbWorld);
