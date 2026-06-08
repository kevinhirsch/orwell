import { setWorldConstructor, setDefaultTimeout, World } from "@cucumber/cucumber";
import type { IWorldOptions } from "@cucumber/cucumber";
import type { Sandbox, VaultDatum } from "../../tests/support/sandbox";
import type { ToolDescriptor } from "../../src/surfaces/tools/registry";
import type { GameEvent, Visibility, EntityId } from "../../src/domain/event";
import type { SocialGraph } from "../../src/engine/gossip";
import type { SeasonResult } from "../../src/engine/simulation";
import type { RichnessMetrics } from "../../src/engine/richness";
import type { GameHouse, Houseguest } from "../../src/engine/characterFactory";
import type { WeekState, VetoDraw } from "../../src/domain/eligibility";
import type { RelationshipModel } from "../../src/engine/relationships";
import type { Competitor, CompetitionType, CompetitionIntents, CompetitionResult } from "../../src/domain/competitionOutcome";
import type { GameState } from "../../src/domain/saveState";
import type { SaveStore, SaveRef } from "../../src/ports/SaveStore";
import type { RandomnessSource } from "../../src/ports/RandomnessSource";
import type { Day } from "../../src/engine/schedule";
import type { McpServer } from "../../src/adapters/mcp/McpServer";
import type { SeasonOutcome, SeasonHouseguest } from "../../src/engine/season";
import type { EntityId as Eid } from "../../src/domain/ids";

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
  seed?: number;

  // Outcomes by stats + temperature (0006) scratch state.
  variables?: string[];
  rollA?: Record<string, number>;
  rollB?: Record<string, number>;
  field?: Competitor[];
  type?: CompetitionType;
  target?: string;
  equivId?: string;
  winRates?: Record<string, number>;
  intents?: CompetitionIntents;
  result?: CompetitionResult;

  // Persistence non-degradation (0007) scratch state.
  gameState?: GameState;
  store?: SaveStore;
  rng?: RandomnessSource;
  loaded?: GameState;
  early?: GameState;
  late?: GameState;
  snapshots?: GameState[];
  saveRef?: SaveRef;
  saveRef2?: SaveRef;

  // Daily-event invariant (0008) scratch state.
  day?: Day;
  weekDays?: Day[];
  scheduleDays?: Day[];

  // MCP tool boundary (0009) scratch state.
  mcpPlayer?: McpServer;
  mcpAdmin?: McpServer;
  server?: McpServer;
  toolResult?: unknown;
  ack?: { eventId: string };

  // Weekly loop orchestration (0011) scratch state.
  roster?: SeasonHouseguest[];
  outcome?: SeasonOutcome;
  outcome2?: SeasonOutcome;
  chosenReplacement?: Eid;
  playerState?: { active: Eid[]; hoh: Eid };

  // Conversation & scene system (0012) scratch state.
  approaches?: Eid[];
  expression?: { mode: string; content?: string };
  compressed?: string;
  full?: string;
  groundTruthBefore?: string;
  pendingBefore?: unknown;
  sceneEventId?: string;

  // Diary Room (0013) scratch state.
  beat?: string;
  publicStmt?: string;
  drStmt?: string;
  npcActedOn?: string[];

  // Jury & endgame (0014) scratch state.
  juryRel?: { trust: number; affinity: number; threat: number };
  juryWinner?: Eid;
  juryWinner2?: Eid;
  finaleScript?: { statements: Eid[]; questions: Array<{ juror: Eid; finalist: Eid }>; revealOrder: Eid[] };

  // Replayability & naming (0004) scratch state.
  house?: GameHouse;
  housesBySeed?: Record<string, Houseguest[]>;

  // Character creation / OOBE (0015) scratch state.
  player?: import("../../src/engine/characterFactory").PlayerCharacter;
  house2?: GameHouse;
  oobeRejected?: boolean;
  privateFact?: string;
  oobeKnowledge?: import("../../src/ports/KnowledgeService").KnowledgeService;

  // God Mode / admin (0016) scratch state.
  sandbox2?: Sandbox;
  twist?: VaultDatum;
  revealRejected?: boolean;

  // Relationship model (0017) scratch state.
  relTrustBefore?: number;
  relBondBefore?: number;
  relConfBefore?: number;
  labelParanoid?: string;
  labelTrusting?: string;

  // Narrative & moment orchestration (0018) scratch state.
  gsView?: import("../../src/ports/GameSession").GameStateView;
  gsMoment?: string;

  // Agent-driven play loop (0019) scratch state.
  decisionCtx?: import("../../src/engine/decisions").DecisionContext;
  pending?: import("../../src/engine/decisions").PendingResult;
  decisionResult?: import("../../src/engine/decisions").DecisionResult;
  decisionRejected?: boolean;
  compResult?: { winner: { id: string; name: string } | null };
  bondBaseline?: number;

  // Competition eligibility (0005) scratch state.
  week?: WeekState;
  special?: boolean;
  eligible?: EntityId[];
  selectable?: EntityId[];
  voters?: EntityId[];
  veto?: VetoDraw;
  rel?: RelationshipModel;

  constructor(options: IWorldOptions) {
    super(options);
  }
}

setWorldConstructor(BbWorld);
