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

  // Player experience (0020) scratch state.
  portraitHg?: Houseguest;
  portraitSeed?: number;

  // Consequence & memory (0023) scratch state.
  consequence?: import("../../src/engine/consequence").ConsequenceEngine;
  reloaded?: import("../../src/engine/consequence").ConsequenceEngine;
  relBefore?: import("../../src/engine/relationships").EdgeSignals;
  threatBefore?: number;
  snap?: import("../../src/engine/consequence").MemorySnapshot;
  noms?: Eid[];

  // Per-user sandboxes (0021) scratch state.
  registry?: import("../../src/composition/registry").GameSessionRegistry;
  userASnapshot?: string;

  // Soul storage & recall (0024) scratch state.
  soul?: import("../../src/adapters/engine/SoulStore").SoulStore;
  recalled?: import("../../src/ports/SoulProvider").Memory[];
  archViolations?: unknown[];
  hiddenMemory?: string;

  // Reserve twists (0025) scratch state.
  reserve?: import("../../src/engine/reserveTwists").ReserveTwist[];
  fires?: import("../../src/engine/reserveTwists").TwistEvent[];
  visibleBefore?: number;
  twistEventId?: string;

  // Temperature & emotional constants (0028) scratch state.
  baseWinRate?: number;
  spikedMod?: number;
  settledMod?: number;
  surfacingRate?: number;
  tempRolls?: number[];
  compResultObj?: import("../../src/domain/competitionOutcome").CompetitionResult;

  // Game orchestrator & integrity watcher (0031) scratch state.
  orchestrator?: import("../../src/composition/orchestrator").Orchestrator;
  watcher?: import("../../src/composition/gameWatcher").GameWatcher;
  fakeClock?: import("../../src/adapters/time/FakeClock").FakeClock;
  advanceResult?: import("../../src/composition/orchestrator").AdvanceResult;
  hiddenBefore?: number;
  health?: import("../../src/composition/orchestrator").HealthRecord;
  stateA?: string;
  stateB?: string;

  // Live weekly progression & decision seam (0034) scratch state.
  livePlayer?: import("../../src/adapters/mcp/McpServer").McpServer;
  /** The user key the current live scenario operates on (shared restart step). */
  liveUser?: string;
  lastAdvance?: import("../../src/ports/GameSession").AdvanceView;
  beatsBeforeStop?: number;
  liveRefused?: boolean;
  liveWeekA?: number;
  liveWeekB?: number;
  livePhaseA?: string;
  livePhaseB?: string;

  // Live jury-vote choreography (0037) scratch state.
  finaleViews?: import("../../src/ports/GameSession").AdvanceView[];
  finaleViewsA?: import("../../src/ports/GameSession").AdvanceView[];
  finaleViewsB?: import("../../src/ports/GameSession").AdvanceView[];
  livePlayerB?: import("../../src/adapters/mcp/McpServer").McpServer;
  juryFinalists?: [Eid, Eid];
  juryRunMode?: "manner" | "dominance";
  mannerShareRespected?: number;
  mannerShareBetrayed?: number;
  domWinRate?: number;
  finaleSentinels?: string[];

  // Durable game persistence (0030) scratch state.
  saveDir?: string;
  registry2?: import("../../src/composition/registry").GameSessionRegistry;
  viewBefore?: import("../../src/ports/GameSession").GameStateView;
  viewAfter?: import("../../src/ports/GameSession").GameStateView;
  viewAfterB?: import("../../src/ports/GameSession").GameStateView;
  savedSnap?: import("../../src/engine/sessionSnapshot").SessionSnapshot;
  resumedSnap?: import("../../src/engine/sessionSnapshot").SessionSnapshot;
  durableSentinel?: string;

  // Relationship math (0026) scratch state.
  relThreatAfterBetrayal?: number;
  relEdgeBefore?: import("../../src/engine/relationshipConstants").EdgeSignals;
  relConfLow?: number;
  feels?: number[];
  harsherConstants?: import("../../src/engine/relationshipConstants").RelationshipConstants;

  // NarrativePort LLM adapter (0027) scratch state.
  narrator?: import("../../src/ports/StreamingNarrativePort").StreamingNarrativePort;
  narrationCtx?: import("../../src/ports/NarrativePort").NarrationContext;
  narrationFull?: string;
  narrationChunks?: string[];
  narrationOut?: string;
  engineWinnerBefore?: string;
  narratorEnv?: Record<string, string | undefined>;
  narratorCfg?: import("../../src/adapters/narrative/narratorConfig").NarratorConfig;

  // Competition eligibility (0005) scratch state.
  week?: WeekState;
  special?: boolean;
  eligible?: EntityId[];
  selectable?: EntityId[];
  voters?: EntityId[];
  veto?: VetoDraw;
  rel?: RelationshipModel;

  // Promise & deal tracking (0039) scratch state.
  ledger?: import("../../src/engine/deals").DealLedger;
  dealRel?: RelationshipModel;
  madeDeal?: import("../../src/domain/deal").Deal;
  dealJuryDemerits?: Array<{ wronged: EntityId; breaker: EntityId }>;
  dealReveals?: Array<{ wronged: EntityId; breaker: EntityId; witnessSet: EntityId[] }>;
  dealTrustBefore?: number;
  dealThreatBefore?: number;
  dealVault?: VaultDatum;

  // NPC confessionals (0040) scratch state.
  confRel?: RelationshipModel;
  confessor?: EntityId;
  confessional?: import("../../src/engine/confessionals").Confessional;
  confSoul?: import("../../src/adapters/engine/SoulStore").SoulStore;
  confUserSandbox?: import("../../src/composition/registry").UserSandbox;
  confSandboxA?: import("../../src/composition/registry").UserSandbox;
  confSandboxB?: import("../../src/composition/registry").UserSandbox;

  // Endgame structure (0045) scratch state.
  egSession?: import("../../src/adapters/engine/GameSessionAdapter").GameSessionAdapter;
  egState?: import("../../src/engine/liveSeason").LiveSeasonState;
  egCtx?: import("../../src/engine/liveSeason").SeasonCtx;
  egWeek?: import("../../src/domain/eligibility").WeekState;
  egVetoFieldOk?: boolean;
  egEmptyElectorate?: boolean;
  egFinished?: boolean;
  egSawFinalEviction?: boolean;
  egPending?: import("../../src/engine/liveSeason").PendingDecision;
  egIllegalRefused?: boolean;
  egEvictee?: Eid;

  // Eviction night live (0047) scratch state.
  enRegistry?: import("../../src/composition/registry").GameSessionRegistry;
  enUser?: string;
  enSandbox?: import("../../src/composition/registry").UserSandbox;
  enViews?: import("../../src/ports/GameSession").AdvanceView[];
  enRevealOrderA?: string;
  enRevealOrderB?: string;
  enSentinel?: string;
  enWarmLean?: number;
  enColdLean?: number;
  enResumedEvictee?: string;
  enOriginalEvictee?: string;

  // Player eviction & the juror's seat (0046) scratch state.
  peRegistry?: import("../../src/composition/registry").GameSessionRegistry;
  peUser?: string;
  peSandbox?: import("../../src/composition/registry").UserSandbox;
  peView?: import("../../src/ports/GameSession").GameStateView;
  peWitnessedAtEviction?: number;
  peSentinel?: string;
  peSawJurorVote?: boolean;

  // House presence & lingering play (0049) scratch state.
  hpRegistry?: import("../../src/composition/registry").GameSessionRegistry;
  hpUser?: string;
  hpSandbox?: import("../../src/composition/registry").UserSandbox;
  hpRegistryA?: import("../../src/composition/registry").GameSessionRegistry;
  hpUserA?: string;
  hpSandboxA?: import("../../src/composition/registry").UserSandbox;
  hpViolations?: string[];
  hpTrailA?: string[];
  hpTrailB?: string[];
  hpWhereabouts?: import("../../src/ports/GameSession").WhereaboutsView;
  hpSentinel?: string;
  hpEventId?: string;
  hpOverheardFact?: import("../../src/domain/knowledge").KnowledgeFact;
  hpGateSamples?: number;
  hpGateHits?: number;
  hpClock?: { t: number };
  hpOrch?: import("../../src/composition/orchestrator").Orchestrator;
  hpBefore?: { week: number; phase: string; kind: string };
  hpEventsBefore?: number;

  // Live reserve twists (0025/B53) scratch state.
  twistRegistry?: import("../../src/composition/registry").GameSessionRegistry;
  twistUser?: string;
  twistSandbox?: import("../../src/composition/registry").UserSandbox;
  twistSentinel?: string;
  twistTrace?: {
    reveals: number[];
    hohWinsByWeek: Map<number, string[]>;
    evictionsByWeek: Map<number, number>;
    preRevealSweeps: string[];
  };
  twistFinal?: import("../../src/ports/GameSession").AdvanceView;

  // Character evolution & season arc (0041) scratch state.
  evoSoul?: import("../../src/engine/characterFactory").Soul;
  evoStart?: { state: number; volatility: number };
  evoSpiked?: number;
  evoSoulStore?: import("../../src/adapters/engine/SoulStore").SoulStore;
  evoCompCalm?: number;
  evoCompRattled?: number;
  evoNomsCalm?: [Eid, Eid];
  evoNomsRattled?: [Eid, Eid];
  evoHoh?: Eid;
  evoCharStart?: Map<string, string>;
  evoArcA?: number[];
  evoArcB?: number[];

  // The casting interview (0050) scratch state.
  castSession?: import("../../src/adapters/engine/GameSessionAdapter").GameSessionAdapter;
  castView?: import("../../src/ports/GameSession").GameStateView;
  castPrompt?: string;
  castRestoredPlayer?: import("../../src/engine/characterFactory").PlayerCharacter;
  castStatus?: import("../../src/ports/GameSession").CastingStatusView;
  castResumed?: import("../../src/adapters/engine/GameSessionAdapter").GameSessionAdapter;
  castError?: Error;

  constructor(options: IWorldOptions) {
    super(options);
  }
}

setWorldConstructor(BbWorld);
