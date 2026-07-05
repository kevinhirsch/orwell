import type {
  GameSession, CreateCharacterReq, GameStateView, MomentPromptReq, MomentPromptView,
  RunCompetitionReq, CompetitionResultView, PublicGameStatus,
  AdvanceView, SubmitDecisionReq, PendingDecisionView, NamedRef, SocialInitiative, PlayerTaglineView,
  FinaleView, EvictionView, MakeDealReq, DealView, FormAllianceReq, JoinAllianceReq, AllianceView, WhereaboutsView, HouseguestMoveResult,
  SeasonRecapView, RetrospectiveView, NpcVoiceView, ConfideResult, SealedFact,
  ExposeSecretReq, ExposeResult, TradeSecretReq, TradeResult, SecretLeverDescriptor,
  UpdateCastingReq, CastingStatusView, PortraitPromptEntry, HouseguestCard,
  PreSeedCastReq, PreSeedCastView,
  PreSeedNextSeasonReq, PreSeedNextSeasonView,
  RecordCastProfileReq, RecordCastProfileResult, FinaleFastForwardView,
  RecordCastIdentityReq, RecordCastIdentityResult, ProposedCastIdentityFacets,
  WorldSnapshotView, RecordWorldSnapshotReq, RecordWorldSnapshotResult,
  PremiereIntrosView, FirstImpressionView,
  StateDeltaView, DeltaEventView,
} from "../../ports/GameSession";
import { randomBytes } from "node:crypto";
import { humanizeIds, humanizeForRetrospective } from "./humanize";
import { singlePickId } from "./decisionFields";
import type { GameEvent } from "../../domain/event";
import { assignRooms, zoneFor, type MovementIntent, type MovementPull } from "../../engine/presence";
import { moodWord } from "../../engine/voice";
import { NO_NPC_PATHWAY } from "../../engine/diaryRoom";
import { driveSuspicion } from "../../engine/suspicion";
import {
  formCampaigns, advanceCampaign, replan, campaignTilt, CAMPAIGN,
  deriveDrive, ownBallotLean, ARCHETYPE_AGGRESSION,
  type Campaign, type CampaignActor, type Influence, type Drive,
} from "../../engine/campaigns";
import { whisperConspicuousPairings } from "../../engine/houseSuspicion";
import { runJuryHouseStretch } from "../../engine/juryHouse";
import { JURY_HOUSE } from "../../engine/juryHouseConstants";
import type { KnowledgeService } from "../../ports/KnowledgeService";
import type { EventStore } from "../../ports/EventStore";
import { PRESENCE, PRIVACY, MOVEMENT_INTENT } from "../../engine/presenceConstants";
import { dayOfWeek } from "../../engine/houseEvents";
import { HOUSE_SIGHTLINE, areVisible, isPrivateRoom, roomDisplayName, resolveRoom, WALKABLE_ROOMS, zonesFor } from "../../domain/house";
import type { Room, Zone, Occupancy } from "../../domain/house";
import type { RandomnessSource } from "../../ports/RandomnessSource";
import type { CastingIntake } from "../../engine/castingIntake";
import { castingStatusOf, emptyIntake, ignoredCastingKeys, intakeIsEmpty, mergeCastingUpdate, overwrittenScalars } from "../../engine/castingIntake";
import { DealLedger } from "../../engine/deals";
import type { BindingAction, Deal } from "../../engine/deals";
import { AllianceStore, allianceTieBoost, allianceFavor, willingMembers, pickAllianceName, sameMembers, ALLIANCE } from "../../engine/alliances";
import type { Alliance } from "../../engine/alliances";
import { involvedConfessionals, recordConfessionalToSoul, selectRecentForConfessional } from "../../engine/confessionals";
import type { ConfessionalContext } from "../../engine/confessionals";
import { rankApproaches } from "../../engine/conversation";
import { DECISION } from "../../engine/decisionConstants";
import type { EvictionManner } from "../../engine/jury";
import type { NarrativePort } from "../../ports/NarrativePort";

/** Player public standing — the only axis the snarky hero tagline (0033) keys on. Vault-free. */
type Standing = "pre-game" | "hoh" | "nominee" | "veto-holder" | "houseguest";

/**
 * Curated, state-aware snarky Big Brother taglines (0033). Anti-sycophantic: a weak standing is
 * ribbed, not flattered. These are also the FAIL-OPEN fallback when no real narrator is wired (the
 * live narrator is a stub today) — so the hero line is always good, never a JSON dump, never blank.
 */
const SNARKY_TAGLINES: Record<Standing, string> = {
  "pre-game": "Sixteen strangers, one house, zero privacy — ready to lie to everyone you haven't met yet?",
  hoh: "Head of Household: for one week the whole house adores you and means none of it.",
  nominee: "On the block and on camera. Smile — someone you trusted put you here.",
  "veto-holder": "You're holding the veto, so suddenly everybody remembers your name.",
  houseguest: "Another day in the house. Trust no one — especially the ones being nice.",
};

const TAGLINE_INSTRUCTION =
  "Write ONE biting Big Brother welcome line for the player at this moment. One sentence, no spoilers, no quotes.";

/** First line, trimmed, length-capped — a hero line is one short line. */
function oneLine(s: string): string {
  return (s.split("\n")[0] ?? "").trim().slice(0, 120);
}

/**
 * Is `s` a reasonable, real-sounding two-token human name? The structural gate on an LLM-authored
 * replacement display name (`recordCastProfile.name`): exactly two whitespace-separated tokens, each a
 * plausible capitalized name part (optional hyphen/apostrophe compound, e.g. "O'Neil"), 2–12 chars, with at least one
 * vowel and no run of 4+ consecutive consonants. Rejects fantasy/gibberish ("Nerighrengeinen
 * Herneingenenin"); accepts "Marcus Webb", "Priya Anand", "Mary-Kate O'Neil". Vault-free, pure.
 */
export function isReasonableName(s: string): boolean {
  const tokens = s.trim().split(/\s+/);
  if (tokens.length !== 2) return false;
  const tokenRe = /^[A-Z][a-z]*([-'][A-Z]?[a-z]+)?$/;
  const vowelRe = /[aeiouy]/i;
  const consonantRunRe = /[bcdfghjklmnpqrstvwxz]{4,}/i;
  for (const token of tokens) {
    if (token.length < 2 || token.length > 12) return false;
    if (!tokenRe.test(token)) return false;
    if (!vowelRe.test(token)) return false;
    if (consonantRunRe.test(token)) return false;
  }
  return true;
}

/** Order-sensitive id-list equality (0065 Part E ceremony-diff): same length + same ids in order. */
function sameIds(a: readonly EntityId[], b: readonly EntityId[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
/** Reject empty/over-long output and the Echo stub's context dump (so we fall open to the template). */
function isUsableTagline(s: string): boolean {
  return s.length > 0 && s.length <= 120 && !/[{}]/.test(s) && !/forEntity|visibleEvents|systemPrompt/i.test(s);
}
import { buildPortraitPrompt, buildCastPortraitPrompts, physicalFacetToAppearance } from "../../engine/portraitPrompts";
import { STYLE_ANCHOR_VARIANTS } from "../../engine/imageConstants";
import { startNewGame, hashSeed, isPlausibleArchetype, strengthTier, dispositionOf, archetypeMenace } from "../../engine/characterFactory";
import type { GameHouse, StrategyStyle, Soul, HiddenElement } from "../../engine/characterFactory";
import { evolveEmotion, arcNote, offscreenEmotion } from "../../engine/emotionalArc";
import type { EmotionalEvent } from "../../engine/emotionalArc";
import type { SoulProvider } from "../../ports/SoulProvider";
import type { InteractionType } from "../../engine/relationships";
import {
  CEREMONY_IMPACTS, EVICTION_MANNER_SCALE, RELATIONSHIP_CONSTANTS, clamp01, scaleImpact,
} from "../../engine/relationshipConstants";
import type { CeremonyAct } from "../../engine/relationshipConstants";
import { notorietyBias, recognitionFor } from "../../engine/notoriety";
import type { NotorietySummary, OpenSetSeasonOutcome } from "../../engine/notoriety";
import {
  deriveTrajectory, decayTrajectory, STEADY,
  type Trajectory, type FoldSignal,
} from "../../engine/trajectory";
import { TRAJECTORY_CONSTANTS } from "../../engine/trajectoryConstants";
import { buildSystemPrompt, momentForPhase, renderStoryFacts, renderSurfacedFacts } from "../../engine/momentPrompts";
import { producerForSeed, renderProducerVoice, type Producer } from "../../engine/producerPersona";
import { buildWorldSnapshot, renderZeitgeist, hasZeitgeist, ZEITGEIST, type WorldSnapshot, type ZeitgeistSlice } from "../../engine/zeitgeist";
import type { CompetitionType, Intent } from "../../domain/competitionOutcome";
import { strain as triggerStrain, shouldFire, eruptionEvent } from "../../engine/triggers";
import { TRIGGER, type EruptionKind } from "../../engine/triggerConstants";
import { SeededRandom } from "../random/SeededRandom";
import { PLAYER } from "../../domain/ids";
import type { EntityId } from "../../domain/ids";
import { EngineRefusal, StaleBeatError } from "../../domain/errors";
import { RelationshipModel, relationshipLabel, currentReadOf } from "../../engine/relationships";
import type { Stats } from "../../engine/season";
import {
  newLiveSeason, advance as advanceBeat, applyDecision, autoDecision, recordDealBetrayal, peekCompetition, COMP_INTENTS, deriveNpcCompIntent, GOODBYE_TONES,
  firstCeremonyBeatResolved,
  requestSelfEviction as requestSelfEvict, cancelSelfEviction as cancelSelfEvict, applySelfEviction, playerHasLeft,
  advanceClock, advanceClockPerConversation, playerTurnIn, playerRestDeficit, npcRestDeficit, isInertBeat,
  type LiveSeasonState, type SeasonCtx, type BeatEvent, type DecisionInput, type PendingDecision, type GoodbyeTone,
  type FinaleProgress, type EvictionProgress,
} from "../../engine/liveSeason";
import { restStatusFor, TIME_OF_DAY_LABEL, DAY_START, WAKE_HOUR, awakeSet, bedtimeDepthFor, socialSwayScale, CONFLICT_BEDTIME_DRAIN, BEDTIME_DEPTH_FLOOR, accrueFatigue, combinedRestDeficit, conversationHours, CLOCK, type ConversationKind } from "../../engine/timeOfDay";
import { APPROACH_GATE } from "../../engine/decisionConstants";
import { FINALE_APPEALS, type FinaleAppeal } from "../../engine/jury";
import { loadReserveTwists } from "../../engine/reserveTwists";
import {
  generateCastDeepLayer, deepProfileToVaultContent, generateDeepProfile, deriveStoryThreads,
  defaultTriggerConditionFor, triggerMet, sourceWindowClosed, threadRumor,
  storyThreadToRetrospectiveProse,
  type SeasonPosition,
} from "../../engine/deepProfile";
import { THREAD } from "../../engine/threadConstants";
import {
  loadSeededRelationships, TIE_AFFINITY_BIAS, SHOWMANCE_SPARK_BIAS,
  DEFAULT_TIE_BUDGET, DEFAULT_SHOWMANCE_BUDGET, nextShowmanceStage,
  preGameTieToRetrospectiveProse, showmanceToRetrospectiveProse,
} from "../../engine/seededRelationships";
import type { SeededRelationships } from "../../engine/seededRelationships";
import { surfaceSeededTies } from "../../engine/seededTieSurfacing";
import type { SurfacedTie } from "../../engine/seededTieSurfacing";
import type { DeepProfile, StoryThread } from "../../engine/deepProfile";
import {
  generateDiversityLayer, repairDiversityLayer, privateOrientationToVaultContent, showmancePlausible,
} from "../../engine/diversity";
import type { ProposedIdentityFacets } from "../../engine/diversity";
import { nameGenderOf, pickGivenNameFor } from "../../engine/data/nameGender";
import type { Orientation, GenderPresentation } from "../../engine/diversityConstants";
import { ALL_ETHNICITIES } from "../../engine/diversityConstants";
import { foldHiddenImpact } from "../../engine/consequence";
import {
  decideConfidence, disclosureMotive, disclosureTier, discloseTrue, fabricate,
  type ConfidenceSignals,
} from "../../engine/confidence";
import { CONFIDENCE, type DisclosureTier } from "../../engine/confidenceConstants";
import {
  severityOf, leverageStrength, leverageDealBoost, dealAcceptance, exposeOutcome,
  tradeValue, tradeDealBoost, tradeOutcome, bluffBelieved,
  type LeverageSignals, type TradeSignals,
} from "../../engine/leverage";
import { LEVERAGE, SECRET_TRADE } from "../../engine/leverageConstants";
import {
  rankPlayerBoundThreads, dripBudget, recencyFromAge, relationshipReads,
  type PlayerBoundThread, type RankedThread,
} from "../../engine/secretPacing";
import { SECRET_PACING } from "../../engine/secretPacingConstants";
import { derivedLoyalty } from "../../engine/blocs";
import type { ReserveTwist, TwistKind } from "../../engine/reserveTwists";
import type { CeremonyState, SessionCore, TrackedSighting } from "../../engine/sessionSnapshot";
import { cloneSession, fastClone } from "../../engine/sessionSnapshot";

const COMP_TYPES: ReadonlySet<string> = new Set<CompetitionType>([
  "endurance", "physical", "puzzle", "quiz", "memory", "mental", "social",
]);

/**
 * A READABLE category label for a hidden record's machine kind/type, for the post-season retrospective
 * (0048). The FE renders each unsealed row as "[type] content", so a raw slug (`hidden-thread`,
 * `seeded-relationship`, `offscreen-event`) becomes a debug tag; this maps it to plain words instead.
 * Pure / Vault-free (a category name reveals nothing). Unknown kinds fall back to a de-slugged title.
 */
const RETROSPECTIVE_LABELS: Readonly<Record<string, string>> = {
  "hidden-thread": "Secret thread",
  "seeded-relationship": "Hidden tie",
  "hidden-attribute": "Hidden side",
  confessional: "Confessional",
  "offscreen-event": "Off-screen",
  gossip: "Whisper",
  conversation: "Off-screen",
  scheme: "Off-screen",
};
function retrospectiveLabel(kind: string): string {
  if (RETROSPECTIVE_LABELS[kind]) return RETROSPECTIVE_LABELS[kind]!;
  // Fallback: de-slug an unmapped kind ("some-kind" → "Some kind") so no raw machine slug ever shows.
  const words = kind.replace(/[:_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Hidden";
}

/**
 * #996 — a houseguest's hidden story threads are derived from THREE distinct sources (2–3 secrets, the
 * weakness, the first true goal). Labeling them all "Secret thread" stacked 4–5 contradictory "secrets"
 * in the dump. Derive the row label from the thread's SOURCE CLASS instead — read off the premise tag
 * (`secret —` / `weakness —` / `true goal —`, set at derive time in `deriveStoryThreads`), matching the
 * prose naturalization in `storyThreadToRetrospectiveProse` ("Secretly… / Their blind spot… / Their real
 * game…"). So the rows read as {2–3 secrets + 1 blind-spot + 1 real-game}, not 5 "secrets". Vault-free
 * (a category label reveals nothing); a missing/unknown tag falls back to "Secret thread" (the prior
 * behavior). Label-only — the thread content/derivation is untouched.
 */
function storyThreadLabel(premise: string): string {
  if (premise.startsWith("weakness")) return "Blind spot";
  if (premise.startsWith("true goal")) return "Real game";
  return "Secret thread";
}

/**
 * The MUTUAL off-screen interaction verbs (mirroring the public `RICH_VERBS` phrasing in
 * `src/engine/offscreen.ts`). A scene recorded as `A <verb> B` and its counterpart `B <verb> A` are the
 * SAME mutual happening seen from each side — the dump should show it ONCE (#842). Render-time
 * recognition of PUBLIC content only (no engine coupling, no Vault data); kept local + ordered
 * longest-first so a contained phrase can't shadow a longer one.
 */
const MUTUAL_OFFSCREEN_VERBS: readonly string[] = [
  "formed an alliance with",
  "gossiped about the house with",
  "talked strategy with",
  "quietly turned on",
  "grew close to",
  "clashed with",
  "bonded with",
];

/**
 * Coalesce the unsealed dump rows for readability (#841/#842) — a PURE render-time pass that NEVER
 * changes what the engine recorded (no event/RNG touch), only what the operator is shown:
 *   - #841: drop a byte-identical `{type, content}` row (keep the first occurrence);
 *   - #842: collapse a SYMMETRIC off-screen pair (`A <mutual-verb> B` + `B <mutual-verb> A`, ignoring any
 *           ` — detail` tail) into ONE row — the same mutual scene from each side.
 * Order-stable: the first row of any duplicate/mirror set is kept in place.
 */
function coalesceDumpRows(
  rows: ReadonlyArray<{ type: string; content: string; ts?: number }>,
): Array<{ type: string; content: string; ts?: number }> {
  const out: Array<{ type: string; content: string; ts?: number }> = [];
  const seenExact = new Set<string>();
  const seenMutual = new Set<string>();
  for (const r of rows) {
    // #841 — exact duplicate.
    const exactKey = `${r.type} ${r.content}`;
    if (seenExact.has(exactKey)) continue;
    seenExact.add(exactKey);
    // #842 — symmetric mutual off-screen scene. Strip a trailing " — detail" before matching the pair so
    // two mirrored scenes with different flavor tails still coalesce on the parties + verb.
    const core = r.content.replace(/\s+—\s.*$/, "").trim();
    let mutualKey: string | null = null;
    for (const verb of MUTUAL_OFFSCREEN_VERBS) {
      const at = core.indexOf(` ${verb} `);
      if (at <= 0) continue;
      const a = core.slice(0, at).trim();
      const b = core.slice(at + verb.length + 2).trim();
      if (!a || !b) continue;
      const pair = [a, b].sort();
      mutualKey = `${r.type} ${verb} ${pair[0]} ${pair[1]}`;
      break;
    }
    if (mutualKey) {
      if (seenMutual.has(mutualKey)) continue;
      seenMutual.add(mutualKey);
    }
    out.push(r.ts !== undefined ? { type: r.type, content: r.content, ts: r.ts } : { type: r.type, content: r.content });
  }
  return out;
}

/**
 * A fresh entropy seed for a game created WITHOUT an explicit seed (E39/C7): a uint32 from
 * `crypto` randomness, persisted in the snapshot (`gameSeed`) so the season stays reproducible
 * AFTER creation. This is an adapter (not the pure core) — the one sanctioned place real
 * entropy enters; everything downstream still flows through the seeded `RandomnessSource`.
 */
function entropySeed(): number {
  return randomBytes(4).readUInt32LE(0);
}

/**
 * 0065 — the pre-game holding store for a PRE-WARMED cast (see `GameSessionAdapter.prewarm`). Holds
 * exactly the player-INDEPENDENT cast state that `createCharacter` would otherwise generate at finalize:
 * the NPC roster (with their PUBLIC facets + any AUTHORED enrichment), the HIDDEN deep layer, the derived
 * story threads, the sealed private orientations, the grounded skin tones, and the per-season portrait
 * style anchor. ENGINE-ONLY (it carries the hidden layer); persisted in the snapshot so a half-warmed
 * cast survives a restart.
 */
interface PrewarmCast {
  seed: number;
  npcs: GameHouse["npcs"];
  deepProfiles: Record<EntityId, DeepProfile>;
  storyThreads: StoryThread[];
  privateOrientations: Record<EntityId, Orientation>;
  groundedSkinTones: Record<EntityId, string>;
  portraitStyleAnchor: string;
}

/**
 * 0065 — the throwaway player name `preSeedCast` builds its temporary house with. The pre-warm cast is
 * player-INDEPENDENT, so this never reaches the warmed NPCs (their generation runs before any player
 * material) and the placeholder player is discarded the instant the cast is captured.
 */
const PREWARM_PLAYER_NAME = "(pre-warm)";

/**
 * Flatten untrusted FE text before it rides into a SYSTEM prompt (the C8 pattern): collapse ALL
 * whitespace (newlines/tabs/control chars that could forge a prompt line) into single spaces and cap the
 * length. Used by the 0062 zeitgeist write-back (`recordWorldSnapshot`) — the snapshot is non-secret
 * public flavor, but it is still player/FE-sourced text woven into the moment prompt.
 */
function sanitizeFlavor(s: string, max = 160): string {
  return s.replace(/\s+/g, " ").trim().slice(0, max);
}

/** The twist kinds the LIVE loop can actually run (0025/B53). The pool may hold more; only these load. */
const IMPLEMENTED_TWISTS: ReadonlySet<TwistKind> = new Set<TwistKind>(["double-eviction"]);

/**
 * 0085 B2 — whether the live campaign layer runs by DEFAULT. OFF unless `ORWELL_CAMPAIGNS=1` (the deploy
 * sets it; the calibration/UAT harness never does ⇒ every seeded gate is byte-identical). Read once at
 * module load, like the watcher cadence; a test overrides per-session via `setCampaignsEnabled`.
 */
const CAMPAIGNS_ENABLED_DEFAULT = process.env.ORWELL_CAMPAIGNS === "1";
/** 0107 Phase B — the binding-action kinds that count as a betrayal of a named co-ally. */
const ALLIANCE_ADVERSE = new Set(["nominate", "replace", "vote-evict"]);

/**
 * 0087 — whether the RELATIONSHIP-TRAJECTORY layer runs by DEFAULT. OFF unless `ORWELL_TRAJECTORIES=1`.
 * A DEDICATED flag (not a reuse of `ORWELL_CAMPAIGNS`) so calibration neutrality is provable in isolation:
 * with it unset, NO trajectory is computed, `natureWeights` is the identity, and every seeded gate
 * (juryReach/gradient/UAT) is byte-identical. The calibration/UAT harness never sets it; the live deploy
 * does. Read once at module load (like the watcher cadence + the campaign flag); a test overrides
 * per-session via `setTrajectoriesEnabled`.
 */
const TRAJECTORIES_ENABLED_DEFAULT = process.env.ORWELL_TRAJECTORIES === "1";

/**
 * 0091 — whether the TRIGGER-ERUPTION layer runs by DEFAULT. OFF unless `ORWELL_TRIGGERS=1`. A DEDICATED
 * flag (sibling to `ORWELL_CAMPAIGNS`/`ORWELL_TRAJECTORIES`) so calibration neutrality is provable in
 * isolation: with it unset, the orchestrator never runs the trigger check ⇒ ZERO draws on any rng ⇒ every
 * seeded gate (juryReach/gradient/UAT) is byte-identical (the load-bearing determinism guarantee). The
 * calibration/UAT harness never sets it; the live deploy does. Read once at module load; a test overrides
 * per-session via `setTriggersEnabled`.
 */
const TRIGGERS_ENABLED_DEFAULT = process.env.ORWELL_TRIGGERS === "1";
/**
 * 0092 — whether the SECRET-PACING DRIP runs by DEFAULT. OFF unless `ORWELL_SECRET_PACING=1`. A DEDICATED
 * flag (sibling to `ORWELL_CAMPAIGNS` / `ORWELL_TRAJECTORIES` / `ORWELL_SEEDED_TIE_SURFACING`) so
 * calibration neutrality is provable in isolation: with it unset, the pacing pass takes ZERO draws, 0060's
 * own flat surface-to-player path is the only one that runs, and every seeded gate (juryReach/gradient/UAT)
 * is byte-identical to the pre-feature build. The calibration/UAT harness never sets it; the live deploy
 * may. Read once at module load (like the watcher cadence + the sibling flags); a test overrides
 * per-session via `setSecretPacingEnabled`. Default-off until the cadence is tuned against the UAT.
 */
const SECRET_PACING_ENABLED_DEFAULT = process.env.ORWELL_SECRET_PACING === "1";
/**
 * 0006b (PO review 2026-06-28) — whether NPCs carry a derived COMPETITION INTENT by DEFAULT. OFF unless
 * `ORWELL_COMP_INTENT=1`. A DEDICATED flag (sibling to `ORWELL_CAMPAIGNS` etc.) so calibration neutrality
 * is provable in isolation: with it unset, `ctx().compIntentOf` is absent, every NPC "compete"s (the
 * pre-feature path), and every seeded gate (juryReach/gradient/UAT) is BYTE-IDENTICAL. The calibration/UAT
 * harness never sets it; the live deploy may. A test overrides per-session via `setCompIntentEnabled`.
 */
const COMP_INTENT_ENABLED_DEFAULT = process.env.ORWELL_COMP_INTENT === "1";
/**
 * 0110 (PO review 2026-06-28) — whether the eviction jury grudge folds on the evictee's DEDUCED belief
 * (process of elimination) instead of the true secret ballot. OFF unless `ORWELL_VOTE_DEDUCTION=1`. A
 * DEDICATED flag (sibling of the others) so calibration neutrality is provable in isolation: with it
 * unset, `ctx().voteDeduction` is false, the grudge folds the true `votesToEvict` exactly as before, no
 * deduction sub-rng is drawn, and every seeded gate (juryReach/gradient/UAT) is BYTE-IDENTICAL. The
 * calibration/UAT harness never sets it; the live deploy may. A test overrides via `setVoteDeductionEnabled`.
 */
const VOTE_DEDUCTION_ENABLED_DEFAULT = process.env.ORWELL_VOTE_DEDUCTION === "1";
/**
 * 0100 — whether the JURY-HOUSE grudge layer runs by DEFAULT. OFF unless `ORWELL_JURY_HOUSE=1`. A
 * DEDICATED flag (sibling to `ORWELL_CAMPAIGNS`/`ORWELL_TRAJECTORIES`) so calibration neutrality is
 * provable in isolation: with it unset NO jury-house stretch runs, NO draw is taken (the dedicated
 * stream never advances), and NO grudge is applied ⇒ the seeded `juryReach`/UAT spine is byte-identical
 * to today. The calibration/UAT harness never sets it; the live deploy does. Read once at module load
 * (like the campaign/trajectory flags); a test overrides per-session via `setJuryHouseEnabled`.
 */
const JURY_HOUSE_ENABLED_DEFAULT = process.env.ORWELL_JURY_HOUSE === "1";

/**
 * 0066 Phase-2 (#1125) — the three sleep-economy EXTENSIONS, each behind its OWN dedicated opt-in flag
 * (sibling to `ORWELL_CAMPAIGNS`/`ORWELL_TRAJECTORIES`/`ORWELL_JURY_HOUSE`), default OFF, so calibration
 * neutrality is provable for EACH in isolation (the brief: "each behind its own opt-in flag, byte-identical
 * when off"). All three only mean anything while the master clock is running (`ORWELL_TIME_OF_DAY`); each
 * gates ON TOP of it, and when its own flag is off its effect is the identity (scale 1 / meter 0 / no extra
 * advance) ⇒ every seeded gate (juryReach/gradient/UAT) is BYTE-IDENTICAL. None adds a draw to ANY rng —
 * the social-fatigue + multi-night terms are pure functions of already-decided state (no side-stream
 * needed; the main competition/vote/jury stream is never re-phased). A test flips each per-session.
 *
 *  1. `ORWELL_TIME_PER_CONVERSATION` — the per-conversation clock advance (the day's finite scheming time,
 *     felt turn-by-turn). Pacing-only; never rushes an engaged scene (clamps at late-night, never wraps).
 *  2. `ORWELL_SOCIAL_FATIGUE` — a tired houseguest sways the house LESS next day + a conflict drains them
 *     to an earlier bedtime (social, not just comps).
 *  3. `ORWELL_MULTI_NIGHT_FATIGUE` — the compounding multi-night fatigue meter (consecutive late nights
 *     stack a deeper deficit; rested nights recover).
 */
const PER_CONVERSATION_CLOCK_ENABLED_DEFAULT = process.env.ORWELL_TIME_PER_CONVERSATION === "1";
const SOCIAL_FATIGUE_ENABLED_DEFAULT = process.env.ORWELL_SOCIAL_FATIGUE === "1";
const MULTI_NIGHT_FATIGUE_ENABLED_DEFAULT = process.env.ORWELL_MULTI_NIGHT_FATIGUE === "1";

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
  /**
   * R3 — per-houseguest cache for the append-only soul arrays the snapshot export deep-clones every
   * turn (`memory`/`emotionalHistory`). Both are append-only (every off-screen scene pushes a note; the
   * arc samples grow each tick) — the ONLY in-place memory write is `replaceMemoryNote`, which now swaps
   * the array reference so this `(ref,len)`-keyed cache invalidates. Keyed by houseguest id, each entry
   * holds the LIVE source array ref + length + the produced clone. On the next export an UNCHANGED soul
   * (same ref, same length) reuses its clone by reference — O(1) — so the export re-clones only the
   * handful of souls actually touched that turn instead of every soul's full history (audit R3). The
   * cached clone is never mutated (a grown source rebuilds a NEW array), so a baseline snapshot that
   * still references the old clone keeps its point-in-time length — the non-degradation check stays
   * exact. Cleared on `restore` (the live houseguest objects are replaced wholesale).
   */
  private readonly soulCloneCache = new Map<EntityId, {
    memSrc: readonly string[]; memLen: number; memClone: string[];
    histSrc: readonly number[]; histLen: number; histClone: number[];
  }>();
  private week = 0;
  private phase = "setup";
  /**
   * The casting interview's incremental intake (0050). OOBE is no longer atomic: the producer
   * records answers as they land (`updateCasting`), this accumulates them pre-game, and
   * `createCharacter` finalizes FROM it. Snapshot-durable so a half-done interview survives a
   * restart (0030); cleared once the season starts.
   */
  private intake: CastingIntake = emptyIntake();
  // Public ceremony state for the status panel (0020). Vault-free: ids → public names only.
  private ceremony: CeremonyState = { nominees: [], vetoUsed: false };
  /**
   * The monotonic per-sandbox beat counter (feature 0065 Part A). Bumped exactly ONCE per committed
   * state mutation by the registry's commit funnel (`bumpBeatSeq`, called before the candidate
   * snapshot is exported), so it increments by one per beat / aux commit and stays stable on a no-op
   * (a no-op never fires `onPersist`). Persisted in the snapshot (restart-safe; co-versioned with the
   * save). Surfaced on every read/advance view; a mutating call may carry `expectedBeatSeq` and is
   * refused (`stale-beat`/409) when it no longer matches. A rolled-back commit restores the pre-commit
   * value through `restore` (the baseline snapshot carries it). NOT secret — a counter has no Vault
   * content, so it crosses the wall freely.
   */
  private beatSeq = 0;
  /**
   * The at-most-once idempotency cache (feature 0065 Part B) — a small bounded per-sandbox LRU
   * `idempotencyKey → AdvanceView` for `advanceGame`/`submitDecision`. A repeated key returns the
   * ORIGINAL view (its `beatSeq` included) WITHOUT advancing again, so a flaky-socket retry never
   * double-applies. Best-effort + in-memory (a restart drops it and degrades safely — Part A's
   * `expectedBeatSeq` still guards a double-apply); insertion-ordered so the oldest evicts first.
   */
  private readonly idempotencyCache = new Map<string, AdvanceView>();
  private static readonly IDEMPOTENCY_CACHE_MAX = 32;
  // The incremental weekly-loop state (0011); null until a game starts.
  private live: LiveSeasonState | null = null;
  /** Save-on-mutation hook (0030); the registry wires it to persist the user's snapshot. */
  private onPersist?: () => void;
  /**
   * R-BND (#628): the BACKGROUND persist hook for fail-soft FE-driven write-backs (0062 zeitgeist,
   * 0070 off-screen texture). These enrich PROSE only (no closed-set board change), so they must NOT
   * route through the commit funnel — that would bump the `beatSeq` the FE reconciles on and make a
   * background enrichment look like a board mutation (a phantom single-tab stale-409, the A-S3 fold-
   * drop). The registry wires this to invalidate the snapshot cache + blind-save (the next-season-warm
   * precedent), persisting durably WITHOUT a beat bump or integrity checkpoint. Absent on a standalone
   * adapter ⇒ the write-backs fall back to the ordinary `persist()` (still correct; just no game loop).
   */
  private onBackgroundPersist?: () => void;
  /** Beat-event sink (wired by the registry to record player-witnessed events into the EventStore). */
  private onEvent?: (ev: BeatEvent) => void;
  /** Tracked promises (0039). Player-party deals only here; NPC↔NPC deals live off-screen in the Vault. */
  private readonly deals = new DealLedger();
  /** 0107 — live NAMED alliances (engine-only, Vault-sealed). Empty unless the player/NPCs name one ⇒ the
   *  cement provider returns 0 for every pair ⇒ the seeded bloc/vote spine is byte-identical. */
  private readonly alliances = new AllianceStore();
  /**
   * Live NPC CAMPAIGNS (0085) — persistent strategic agendas. ENGINE-ONLY hidden strategy (targets/
   * plans/progress + the per-perspective `knownTo`): it never crosses any outward seam. Phase A holds
   * the field + persistence plumbing; Phase B populates it from the off-screen tick + feeds the tilt.
   */
  private campaigns: Campaign[] = [];
  /**
   * 0085 Phase B2 — whether the live campaign layer RUNS. DEFAULT OFF: the calibration/UAT harness
   * composes its runtime without enabling it, so every seeded gate (juryReach/gradient/UAT) is
   * BYTE-IDENTICAL; the live deploy enables it via `composeRuntime({ campaigns: true })`. When off,
   * no campaign forms/advances and `ctx().campaignTiltFor` is absent ⇒ the seeded vote is unchanged.
   */
  private campaignsEnabled = CAMPAIGNS_ENABLED_DEFAULT;
  /**
   * 0006b — whether NPCs carry a derived COMPETITION INTENT. DEFAULT OFF: the calibration/UAT harness
   * never enables it, so `ctx().compIntentOf` is absent and every NPC "compete"s ⇒ every seeded gate is
   * BYTE-IDENTICAL; the live deploy enables it via `ORWELL_COMP_INTENT=1` / `setCompIntentEnabled`.
   */
  private compIntentEnabled = COMP_INTENT_ENABLED_DEFAULT;
  /**
   * 0110 — whether the eviction jury grudge folds on the evictee's DEDUCED belief. DEFAULT OFF: the
   * calibration/UAT harness never enables it, so `ctx().voteDeduction` is false and the true `votesToEvict`
   * is folded ⇒ every seeded gate is BYTE-IDENTICAL; the live deploy enables it via `ORWELL_VOTE_DEDUCTION=1`.
   */
  private voteDeductionEnabled = VOTE_DEDUCTION_ENABLED_DEFAULT;
  /** The DEDICATED campaign rng tick counter — campaign draws fork off the game seed + this, never the
   * shared society/vote stream (the L21/L24 isolation), so even live campaigns don't re-phase calibration. */
  private campaignTickCount = 0;
  /**
   * 0100 — whether the JURY-HOUSE grudge layer RUNS. DEFAULT OFF: the calibration/UAT harness leaves it
   * off, so with it unset NO jury-house stretch runs, NO draw is taken, and NO grudge is applied ⇒ every
   * seeded gate (juryReach/gradient/UAT) is BYTE-IDENTICAL; the live deploy enables it. A test flips it
   * via `setJuryHouseEnabled`.
   */
  private juryHouseEnabled = JURY_HOUSE_ENABLED_DEFAULT;
  /**
   * 0066 Phase-2 (#1125) — the three sleep-economy extension flags, each DEFAULT OFF (its dedicated env
   * default) and each self-gated: when off, its effect is the identity so the seeded calibration spine is
   * BYTE-IDENTICAL (proven per-extension by the dedicated neutrality tests). All three also require the
   * master clock (`timeOfDayEnabled`). A test flips each via its `set*Enabled` setter.
   *   1. per-conversation clock advance · 2. NPC next-day social fatigue · 3. compounding multi-night meter.
   */
  private perConversationClockEnabled = PER_CONVERSATION_CLOCK_ENABLED_DEFAULT;
  private socialFatigueEnabled = SOCIAL_FATIGUE_ENABLED_DEFAULT;
  private multiNightFatigueEnabled = MULTI_NIGHT_FATIGUE_ENABLED_DEFAULT;
  /** The DEDICATED jury-house rng tick counter — jury-house draws fork off the game seed + this, NEVER the
   * orchestrator's shared society/competition/vote stream, so even with the layer ON the main house's seeded
   * outcomes stay in phase (only the hidden finale lean changes). Persisted so the stream is restart-stable. */
  private juryHouseTickCount = 0;
  /**
   * 0086 — every active houseguest's current DRIVE (motivation + intensity), keyed by id. Computed each
   * campaignTick (sticky — carried from the prior tick), engine-only + Vault-sealed, never projected. The
   * loudest promote to campaigns; the quiet `target` ones add only a small own-ballot lean to their owner's
   * vote. Empty unless the campaign layer is enabled ⇒ no drives ⇒ no lean ⇒ calibration byte-identical.
   */
  private drives: Map<EntityId, Drive> = new Map();
  /**
   * 0087 — whether the RELATIONSHIP-TRAJECTORY layer RUNS. DEFAULT OFF (the dedicated `ORWELL_TRAJECTORIES`
   * flag): when off, no momentum is computed, the off-screen tick passes no `trajectoryOf` ⇒ `natureWeights`
   * is the identity, and every seeded gate is BYTE-IDENTICAL (the calibration-neutrality guarantee). Per
   * instance; a test flips it via `setTrajectoriesEnabled`.
   */
  private trajectoriesEnabled = TRAJECTORIES_ENABLED_DEFAULT;
  /**
   * 0087 — the hidden MOMENTUM per directed pair, keyed `a->b`. VAULT-CLASS hidden engine state (mandate
   * #2): it appears on NO player- or admin-facing projection — it reaches the player only as the KINDS of
   * off-screen scenes the arc produces (overheard/told). Persisted in the snapshot so an arc resumes
   * mid-curdle (0007/0030); absent on a pre-0087 save ⇒ every pair resumes at `steady`/0.
   */
  private trajectories: Map<string, Trajectory> = new Map();
  /**
   * 0087 — the tiny per-pair ring buffer of recent FOLD signals (the last `recencyWindow`), from which
   * `deriveTrajectory` reads the arc's current direction. Engine-only; Vault-free (each entry is a signed
   * bond/threat DELTA + a betrayal flag derived from the scene's nature, never a raw edge number). Persisted
   * beside `trajectories` so a restored game derives the same phase; absent on a pre-0087 save ⇒ empty.
   */
  private trajectoryFolds: Map<string, FoldSignal[]> = new Map();
  /** Records a one-off witnessed event (deal made/broken) and returns its id. Wired by the registry. */
  private onPlayerEvent?: (content: string, witnessSet: EntityId[], type?: string) => string | undefined;
  /** Optional narrator for the snarky tagline (0033); none ⇒ the curated state-aware fallback. */
  private narrator?: NarrativePort;
  /**
   * ENGINE-ONLY dynamic soul (0024) wired into the LIVE sandbox (the 0041 linchpin). When present,
   * consequential beats + off-screen scenes `recordToSoul` so each NPC's arc deepens and their voice
   * can be grounded by `recall`. Optional — standalone adapters (onboarding/tests) still evolve the
   * house's emotional state (modulating competitions) without the recall index.
   */
  private soul?: SoulProvider;
  /** Per-moment tagline cache (regenerate when week/phase/standing changes, not per page load). */
  private readonly taglineCache = new Map<string, string>();
  /**
   * Who is in which room (0049) — every ACTIVE houseguest, exactly one room; the evicted are
   * NOWHERE. Seeded at game start, re-assigned by the off-screen tick (`presenceTick`); grounds
   * witnessing, overhearing, and the player's `whereabouts()` read.
   */
  private presence: Map<EntityId, Room> | null = null;
  /**
   * Room TENURE (L21/L24) — consecutive presence ticks each houseguest has held their CURRENT room
   * (0 = moved this tick). Bumped/reset in `presenceTick` alongside `presence`; grounds scene
   * continuity in `whereabouts()` so the narrator voices who has lingered vs. who just arrived.
   */
  private presenceTenure: Map<EntityId, number> | null = null;
  /**
   * The CALIBRATION-NEUTRAL base occupancy (L21/L24). The off-screen society pairs co-present NPCs to
   * generate hidden scenes whose relationship folds feed (downstream) nominations/votes — so the
   * society's occupancy is calibration-LOAD-BEARING. To keep the seeded competition/vote outcomes
   * BYTE-IDENTICAL to the pre-personality build, the society reads THIS base assignment (the un-weighted
   * 0049 movement, exactly as before L21/L24) via `societyOccupancy()`, while the player-facing positions
   * (`this.presence`, used by `whereabouts`/witnessing) carry the personality-weighted result. The two
   * differ only in WHICH room NPCs roam to — the player never observes the hidden society's pairing, so
   * there is no observable contradiction (one place at a time still holds for everything the player sees).
   */
  private presenceBase: Map<EntityId, Room> | null = null;
  /**
   * The presence-tick COUNTER (L21/L24 isolation). Movement randomness rides a DEDICATED stream forked
   * off the game seed + this counter (`presenceTick`) — never the orchestrator's shared per-user stream
   * that drives the off-screen society + relationship folds + votes — so personality-weighted movement
   * can never perturb the seeded competition/vote calibration (`tests/property/juryReach`). Persisted, so
   * the movement trajectory stays reproducible across a restart. Advances ONCE per `presenceTick`.
   */
  private presenceTickCount = 0;
  /**
   * SEATED sub-zones (issue #792 — the PO ruling: sub-zones are SEATED into `assignRooms`, not computed
   * on-read). Each houseguest in a zoned big room (backyard/lounge) holds a per-id sub-zone here — the
   * player-facing weighted view — so a long stay can organically DRIFT corner-to-corner and two bonded
   * houseguests can CLUSTER into one corner (affinity-weighted, like the room-level clustering). Seeded
   * from the deterministic `zoneFor` on a fresh seat (the on-read helper becomes the seeding fallback),
   * then evolved on the DEDICATED movement stream (never the shared spine) so it is calibration-neutral.
   * Persisted tenure-style beside `presence` (0007 — only-forward); absent on a pre-feature save ⇒ the
   * next tick seats everyone fresh (no error). Vault-free presence projection, never Vault content.
   */
  private presenceZone: Map<EntityId, Zone> | null = null;
  /**
   * TRACKED OCCUPANCY (0077 Phase 2 — the privacy payoff): the PLAYER's beliefs about who is behind a
   * CLOSED door. NOT the live map — acquired knowledge: a sighting lands only when the player WITNESSES
   * a houseguest head into a private room (their origin was in the player's eyeshot), keyed by the
   * subject. It carries a pathway + confidence (the 0002 model applied to position), goes STALE with age
   * (NEVER read off the secret live position — that would leak that they left), decays out past the
   * horizon, and is CORRECTED early when the player next sees the subject somewhere visible. Persisted
   * (0007 — acquired knowledge accumulates), Vault-free (position, never the scene's content).
   */
  private trackedSightings: Map<EntityId, TrackedSighting> | null = null;
  /** The game's seed (B60/E12): per-moment rng keys off it — two same-named games never share streams. */
  private gameSeed: number | null = null;
  /** The per-season style anchor for portrait prompts (0051): seeded at cast time, stable through the season. */
  private portraitStyleAnchor: string | null = null;
  /**
   * The move-in zeitgeist snapshot (feature 0062): the ONE frozen, shared real-world flavor the cast
   * moved in WITH — captured once at season creation, FROZEN, persisted, and recalled all season. It
   * colors BOTH the player's moment prompts AND the off-screen society/gossip prompts (§5) and goes
   * stale as the weeks pass (§7). OUTWARD-SAFE public flavor (§6) — never a Vault handle, never a game
   * input. Null pre-game / when no snapshot was captured (the §8 fail-soft skip).
   */
  private worldSnapshot: WorldSnapshot | null = null;
  /**
   * The PRODUCER persona's seed (producer-persona feature). The producer is a REAL generated
   * character — as deep a persona as any houseguest, built by the same `CharacterFactory` machinery —
   * but OFF-CAMERA: no headshot, never one of the 16, never in the roster/portraits/whereabouts. The
   * casting interview voices it CONSISTENTLY. It must be stable BEFORE the season starts (the interview
   * is pre-game) AND through the game, so its seed is established LAZILY the first time it's needed
   * (pre-game) via real entropy, PERSISTED in the snapshot, and reused at `createCharacter`. Same seed
   * → same producer (reproducible across turns and a restart). Null until first established.
   */
  private producerSeed: number | null = null;
  /** Memoized producer for `producerSeed` (rebuilt on restore / when the seed is first set). */
  private producerCache: Producer | null = null;
  /**
   * 0070 — the additive prose texture layer: model-voiced content indexed by event id.
   * Persisted (serialized to/from `SessionCore.textureOverrides`). Absent on pre-0070 saves.
   */
  private textureOverrides: Map<string, string> = new Map();
  /**
   * 0070 — the event ids of the off-screen scenes recorded in the most recent tick, in order.
   * Used by `getOffscreenSceneSkeletons` to return a Vault-free summary. TRANSIENT (not persisted —
   * refreshed on each tick, empty between ticks). The event store remains the source of truth.
   */
  private lastTickOffscreenIds: string[] = [];

  // ─── PREMIERE meet-everyone tracker (feature #380 follow-on) — NEW BLOCK ─────────────────────────
  /**
   * The houseguests the player has been INTRODUCED to during the premiere. The STRUCTURAL guarantee
   * that every NPC is met before the first HOH does NOT rely on the model to remember (it failed — it
   * skipped people): the engine tracks who's met here, surfaces "who's left to introduce" into the
   * premiere moment prompt, and exposes a `complete` gate. The player is implicitly met (they ARE the
   * player); only NPCs accumulate here. Seeded empty at move-in; persisted (0030) so a half-done
   * premiere resumes; cleared once the premiere is over. PUBLIC ids only — no Vault data.
   */
  private premiereMet: Set<EntityId> = new Set();
  /**
   * A1 (ship-blocker, "the phantom-houseguest root") — the DURABLE, never-cleared superset of
   * `premiereMet`: every houseguest id the player has EVER been introduced to (by name, in narration
   * they witnessed) this season. Unlike `premiereMet` (vestigial-cleared once the premiere ends,
   * §above), this set is the permanent name-lock signal: `recordCastProfile`'s PUBLIC NAME acceptance
   * (below) refuses to rename any houseguest already in this set, no matter when or how many times an
   * async authoring write-back later arrives. This closes the race where deep cast-authoring
   * (`recordCastProfile`, an FE-driven write-back that can complete asynchronously — during the
   * premiere, or even later via the authoring backfill) renamed a houseguest AFTER the player had
   * already met them under the seeded floor name, so the GM appeared to "correct" the player about the
   * game's own prior words. Populated in lockstep with `premiereMet` (the same structural
   * introduction event); reset to empty at every season start alongside it. PUBLIC ids only.
   */
  private introducedNames: Set<EntityId> = new Set();
  // ─────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * The live relationship model drives NPC decisions (threat/trust). The registry
   * injects the SAME instance the consequence fold writes to, so the player's actions
   * shape how the house nominates and votes over time. Standalone (tests/onboarding)
   * it owns a fresh model — the loop still runs, just without cross-fold history.
   */
  constructor(private readonly rel: RelationshipModel = new RelationshipModel(0.5)) {}

  /** Feature 0088 — per-NPC current-read anchor bonds (Vault-only; persisted in snapshot). */
  private readAnchors = new Map<EntityId, number>();

  /** Wire a persistence callback invoked after every mutation (durable save, 0030). */
  setOnPersist(fn: () => void): void {
    this.onPersist = fn;
  }

  /** R-BND (#628): wire the non-committing background-persist hook (durable save, no beatSeq bump). */
  setOnBackgroundPersist(fn: () => void): void {
    this.onBackgroundPersist = fn;
  }

  /**
   * R-BND (#628): persist a fail-soft FE-driven enrichment WITHOUT bumping the closed-set `beatSeq`.
   * Routes through the background hook (invalidate + blind save) when composed in the registry; falls
   * back to the ordinary `persist()` on a standalone adapter (no game loop ⇒ nothing to desync).
   */
  private backgroundPersist(): void {
    (this.onBackgroundPersist ?? this.onPersist)?.();
  }

  /**
   * The ONE restart door (audit E1/D1/R1): when composed in the registry, a CONFIRMED
   * `createCharacter` over a started game is delegated here — the registry routes it through the
   * same `resetUser` the admin reset uses (orchestrator baseline forgotten, dead season's saves
   * rotated, a clean sandbox) and season 2 is created in the fresh sandbox. Standalone adapters
   * (tests/onboarding fixtures with no registry) keep the legacy in-place restart.
   */
  private onRestart?: (req: CreateCharacterReq) => GameStateView;

  setOnRestart(fn: (req: CreateCharacterReq) => GameStateView): void {
    this.onRestart = fn;
  }

  /**
   * 0065 (advance-warm) — the NEXT-season warm delegate, wired by the registry (mirrors `onRestart`).
   * `preSeedCast` warms onto THIS adapter's pre-game store and is refused while a season runs; the
   * next-season warm must instead land in a per-user buffer that OUTLIVES the cutover rotation (this
   * adapter is discarded at reset). The registry owns that buffer + the scratch generation/authoring,
   * so the adapter just routes the call out. Absent on a standalone adapter (tests/fixtures) — there
   * the call falls back to an in-process detached generation (no buffer to survive, but fully testable).
   */
  private onNextSeasonWarm?: (req: PreSeedNextSeasonReq) => PreSeedNextSeasonView;

  setOnNextSeasonWarm(fn: (req: PreSeedNextSeasonReq) => PreSeedNextSeasonView): void {
    this.onNextSeasonWarm = fn;
  }

  /**
   * One persisted commit per player mutation (audit E3): a beat used to fire `onPersist` mid-method
   * (a broken deal inside the tally) and again at the end — and since the commit hook can SWAP the
   * sandbox on a fault, the old instance kept executing against rolled-back state. Mutations run
   * inside `inOneCommit`, which defers every interior `persist()` to a single hook call at the end;
   * a refused commit then throws OUT of the mutation (nothing narrates a beat that never happened).
   */
  private persistDepth = 0;
  private persistDeferred = false;

  private persist(): void {
    if (this.persistDepth > 0) {
      this.persistDeferred = true;
      return;
    }
    this.onPersist?.();
  }

  private inOneCommit<T>(fn: () => T): T {
    this.persistDepth++;
    let out: T;
    try {
      out = fn();
    } finally {
      this.persistDepth--;
    }
    if (this.persistDepth === 0 && this.persistDeferred) {
      this.persistDeferred = false;
      this.onPersist?.(); // may throw (a refused/failed commit) — AFTER all state mutation (E3)
    }
    return out;
  }

  /** The current monotonic beat counter (0065 Part A) — surfaced on every read/advance view. */
  beatSeqNow(): number {
    return this.beatSeq;
  }

  /**
   * Bump the beat counter (0065 Part A) — the registry's commit funnel calls this exactly ONCE per
   * committed mutation, BEFORE the candidate snapshot is exported, so the new value is persisted. A
   * commit that is then refused/rolled back is restored from the baseline snapshot (which carries the
   * pre-commit value), so a refused write never leaves the counter advanced. (Bumping here, not inside
   * `persist`, keeps an interior deferred `persist` from double-counting one logical commit.)
   */
  bumpBeatSeq(): void {
    this.beatSeq++;
    this.captureBeatCheckpoint();
  }

  /**
   * 0065 Part E — seed the delta ring's BASELINE checkpoint at the CURRENT `beatSeq` (the resumed value),
   * capturing the current event-log length + board. The registry calls this once after a resume finishes
   * loading the events (`restore` clears the ring; the events arrive AFTER it), so the very FIRST delta a
   * resumed session serves — keyed on the resumed `beatSeq` — can slice its tail instead of full-refreshing
   * forever. A no-op if a checkpoint for the current beat already exists (a fresh game's first commit
   * captured it). Vault-free (ids/counts only).
   */
  seedDeltaBaseline(): void {
    if (!this.beatCheckpoints.has(this.beatSeq)) this.captureBeatCheckpoint();
  }

  /**
   * 0065 Part E — snapshot the lightweight board state AT the new `beatSeq` so the delta feed can later
   * slice the event tail (O(Δ)) and diff the ceremony WITHOUT re-deriving "what existed then". Called
   * once per committed mutation (right after the counter bumps), the events for this commit are already
   * recorded, so `count()` here is the event-log length AS OF this beat. Bounded to the last
   * `DELTA_WINDOW` beats (the oldest checkpoint evicts) so a busy season's ring stays small; a token
   * older than the retained window correctly full-refreshes. Vault-free (ids/counts only).
   */
  private captureBeatCheckpoint(): void {
    const eventCount = this.deltaSource?.count() ?? this.record?.events().length ?? 0;
    this.beatCheckpoints.set(this.beatSeq, {
      eventCount,
      week: this.week,
      phase: this.phase,
      ...(this.ceremony.hoh !== undefined ? { hoh: this.ceremony.hoh } : {}),
      nominees: [...this.ceremony.nominees],
      ...(this.ceremony.vetoHolder !== undefined ? { vetoHolder: this.ceremony.vetoHolder } : {}),
      vetoUsed: this.ceremony.vetoUsed,
      finished: !!this.live?.finished,
      ...(this.live?.winner !== undefined ? { winner: this.live.winner } : {}),
    });
    // Evict the oldest beyond the window (insertion-ordered Map ⇒ the first key is the oldest).
    while (this.beatCheckpoints.size > GameSessionAdapter.DELTA_WINDOW) {
      const oldest = this.beatCheckpoints.keys().next().value as number | undefined;
      if (oldest === undefined) break;
      this.beatCheckpoints.delete(oldest);
    }
  }

  /**
   * Compare-and-swap stale-write guard (0065 Part A). When a mutating call supplies `expectedBeatSeq`
   * and it no longer matches the committed `beatSeq`, the board moved under it (the 0064 queued-turn
   * case) — refuse BEFORE any mutation with a typed `stale-beat` conflict carrying the CURRENT counter
   * and the Vault-free current board, so the caller can re-ground immediately. `undefined` ⇒ opt out
   * (byte-identical to the pre-0065 path). The board is the same ceremony-level public status
   * `gameStatus()` exposes — no Vault content.
   */
  private guardBeatSeq(expected: number | undefined): void {
    if (expected !== undefined && expected !== this.beatSeq) {
      throw new StaleBeatError(this.beatSeq, this.gameStatus());
    }
  }

  /** 0065 Part B — remember an `AdvanceView` under its idempotency key (bounded LRU; oldest evicts). */
  private rememberIdempotent(key: string, view: AdvanceView): AdvanceView {
    const isNew = !this.idempotencyCache.has(key);
    this.idempotencyCache.delete(key); // re-insert at the tail (insertion-ordered = LRU)
    this.idempotencyCache.set(key, view);
    while (this.idempotencyCache.size > GameSessionAdapter.IDEMPOTENCY_CACHE_MAX) {
      const oldest = this.idempotencyCache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.idempotencyCache.delete(oldest);
    }
    // PERSIST-9 — the cache is populated AFTER the commit's persist already fired (the funnel defers the
    // hook to `inOneCommit`'s tail, which runs before this remember), so the snapshot that just saved
    // MISSED this entry. Durably re-persist NOW (only for a genuinely new entry, so a pure replay adds no
    // I/O) so at-most-once survives a restart/LRU-unload that lands right after this progression. Best-
    // effort + fail-soft: a persist hiccup must never turn an already-committed progression into an error.
    if (isNew) {
      try {
        this.persist();
      } catch {
        /* the cache is a durability optimization; a persist failure must not break the committed view */
      }
    }
    return view;
  }

  /** Wire the beat-event sink (the registry records each as a player-witnessed event). */
  setOnEvent(fn: (ev: BeatEvent) => void): void {
    this.onEvent = fn;
  }

  /** Wire the one-off witnessed-event recorder (deal made/broken reveals, 0039). */
  setOnPlayerEvent(fn: (content: string, witnessSet: EntityId[], type?: string) => string | undefined): void {
    this.onPlayerEvent = fn;
  }

  /** Wire a narrator for the snarky tagline (0033). Without one, the curated fallback is used. */
  setNarrator(narrator: NarrativePort): void {
    this.narrator = narrator;
  }

  /** Wire the engine-only soul store (0041) so the live loop deepens souls + can recall (0024). */
  setSoul(soul: SoulProvider): void {
    this.soul = soul;
  }

  /** Reserve-twist slots for a new game (0016 knob: the admin sets the COUNT, never the content). */
  private twistCount = 2;

  setTwistCount(n: number): void {
    this.twistCount = Math.max(0, Math.floor(n));
  }

  /** Vault audit-copy hook (0025/B53): the registry seals the loaded twists into the engine's Vault. */
  private onSeal?: (reserve: readonly ReserveTwist[]) => void;

  setOnSeal(fn: (reserve: readonly ReserveTwist[]) => void): void {
    this.onSeal = fn;
  }

  /**
   * Deep-profile seal hook (feature 0058): the registry seals each NPC's HIDDEN profile + story
   * threads into the engine's Vault AND indexes them into the soul for full-fidelity recall (L27b) —
   * exactly the seam `setOnSeal` uses for reserve twists. Engine-only: the sealed content is a secret
   * (off the player AND admin), so it rides this hook, never an outward projection.
   */
  private onSealProfiles?: (
    profiles: ReadonlyArray<{ id: EntityId; profile: DeepProfile }>,
    threads: readonly StoryThread[],
  ) => void;

  setOnSealProfiles(
    fn: (profiles: ReadonlyArray<{ id: EntityId; profile: DeepProfile }>, threads: readonly StoryThread[]) => void,
  ): void {
    this.onSealProfiles = fn;
  }

  /**
   * RE-seal ONE houseguest's authored profile + threads (L28b write-back) — REPLACING that subject's
   * prior Vault records (idempotent, no duplication), unlike `onSealProfiles` which appends the cast at
   * birth. Engine-only by construction (the registry wires it to the Vault via `replaceHidden`).
   */
  private onResealProfile?: (id: EntityId, profile: DeepProfile, threads: readonly StoryThread[]) => void;

  setOnResealProfile(fn: (id: EntityId, profile: DeepProfile, threads: readonly StoryThread[]) => void): void {
    this.onResealProfile = fn;
  }

  /**
   * The engine-only HIDDEN deep layer (0058) — the §3 secrets/goals/weakness/Day-1 perception per NPC
   * and the derived story threads. NEVER projected (the view/npcVoice/portrait paths never read this);
   * sealed into the Vault at seal time and persisted through the Vault snapshot. Kept here so the
   * thread-activation fold (`activateThread`) and the Day-1 edge seeding can read them in-process.
   */
  private deepProfiles: Record<EntityId, DeepProfile> = {};
  private storyThreads: StoryThread[] = [];

  /**
   * 0065 — the engine-side pre-game holding store for a PRE-WARMED cast. Before the casting interview
   * ends, `preSeedCast` generates the player-INDEPENDENT cast (composition + diversity + deep layer)
   * off the season seed into here; the FE then authors it deeply (`recordCastProfile` lands HERE
   * pre-game), and the portrait prompts read it. When `createCharacter` finalizes it ADOPTS this
   * finished cast (the SAME seed) instead of regenerating the thin seeded floor — so portraits, shot
   * from the warmed store, match the finished person. Null until a warm happens; cleared on adoption.
   * Durable (0030): a warmed-but-not-finalized cast survives a restart. ENGINE-ONLY — it holds the
   * hidden deep layer + private orientations (sealed at warm time; never projected).
   */
  private prewarm: PrewarmCast | null = null;

  /**
   * 0065 (advance-warm) — the per-user NEXT-season holding store, mirrored onto the LIVE sandbox so it
   * is DURABLE (it persists in this sandbox's snapshot and survives an engine restart mid-finale). The
   * registry owns the working/scratch copy + the cutover adoption; this field is the durable mirror it
   * writes through `holdNextSeasonWarm` (and reads back via `takeNextSeasonWarm` on a resume). It is
   * INVISIBLE to active play — no view/projection/portrait/moment path reads it — exactly like `prewarm`.
   * Cleared at the cutover (the registry adopts it into the fresh sandbox, then drops the buffer). Holds
   * the hidden deep layer (engine-only, like `prewarm`); the snapshot never crosses the wall.
   */
  private nextSeasonWarm: PrewarmCast | null = null;

  /**
   * The engine-only HIDDEN seeded relationship layer (0059): sparse pre-game ties + showmances, sealed
   * off the player AND admin. NEVER projected (no view/npcVoice/portrait/moment path reads it); sealed
   * into the Vault at seed time and persisted in the snapshot. The admin may set the per-season COUNT
   * budget (0016-style) — never the content.
   */
  private seededRels: SeededRelationships = { ties: [], showmances: [] };
  private tieBudget = DEFAULT_TIE_BUDGET;
  private showmanceBudget = DEFAULT_SHOWMANCE_BUDGET;

  /**
   * 0059 §5 — the per-season count of pre-game TIES that have surfaced TO THE PLAYER (the L40-style hard
   * cap, `SEEDED_TIE_SURFACING.maxPlayerSurfacesPerSeason`). Persisted (monotonic within a season; reset
   * by a fresh `createCharacter`). Only ever advanced by `advanceSeededTies`, and only when the flag is on.
   */
  private playerTieSurfaceCount = 0;
  /** 0059 §5 — the subjects of ties already surfaced to the player, so a tie never re-spends the cap. */
  private surfacedTieSubjects = new Set<EntityId>();
  /**
   * 0059 §5 — a DEDICATED scheduler tick counter for the tie-surfacing rng (off the game seed). Varies the
   * dedicated stream each tick WITHOUT ever touching the shared society/vote stream (calibration spine).
   * Bumped per `advanceSeededTies` call (only when the opt-in flag is on). Persisted so the stream is
   * stable across a restart. Distinct from `presenceTickCount` so the two dedicated streams never alias.
   */
  private tieScheduleTickCount = 0;

  /**
   * 0059 §5 — the tie-surfacing SEAMS (the session holds no events/knowledge handle, exactly like the
   * 0060 thread scheduler). `onTieSurfaceToPlayer` lands the Vault-free observation in the player's
   * knowledge through an anchored `told-by` pathway (the registry wires the in-game pathway); it returns
   * whether the player came to hold it. NPC↔NPC diffusion is done in-helper against the `knowledge`
   * handed to `advanceSeededTies`. Nothing crosses but the observable read "they seem unusually close"
   * (never the sealed `nature`). Unwired ⇒ the to-player surfacing is simply skipped (NPC-side only).
   */
  private onTieSurfaceToPlayer?: (subject: EntityId, observation: string) => boolean;

  setOnTieSurfaceToPlayer(fn: (subject: EntityId, observation: string) => boolean): void {
    this.onTieSurfaceToPlayer = fn;
  }

  /**
   * The engine-only HIDDEN private-orientation map (feature 0063): the orientation of each houseguest
   * who holds it PRIVATELY (closeted / not-yet-out). NEVER projected — no view/npcVoice/portrait/moment
   * path reads it; sealed into the Vault at cast time (via `onSealPrivateOrientations`) and persisted in
   * the snapshot. It surfaces to the player ONLY through a modeled 0002 pathway, exactly as a 0058 secret
   * does. PUBLIC (out) orientations are NOT here — they ride on the Character as `outOrientation`.
   */
  private privateOrientations: Record<EntityId, Orientation> = {};

  /**
   * The ethnicity-grounded skin-tone cue per NPC id (feature 0063) — set by `seedDiversity`, read by
   * `seedDeepProfiles` to ground `physicalCharacteristics.skinTone` so the text and the portrait agree
   * with the guaranteed heritage. PUBLIC, Vault-free (it's a complexion phrase, already on the card);
   * transient (re-derivable from the ethnicity facet), so it is NOT separately persisted.
   */
  private groundedSkinTones: Record<EntityId, string> = {};

  /**
   * #1140 — RE-PICKED display names per NPC id (a given-name token swapped to match the final gender
   * presentation; surname kept). Computed by `seedDiversity` but APPLIED to `n.character.name` only AFTER
   * `seedDeepProfiles` (via `applyDiversityRenames`): the deep layer keys its sub-streams off `hg.name`
   * (`deepProfile.ts`), so renaming the Character before it runs would shift the deep profile / Day-1
   * perception / story threads — and therefore the seeded vote/jury outcomes. Deferring the write keeps the
   * deep layer (and the whole outcome stream) byte-identical with the rename on vs. off. Transient
   * (re-derivable from the diversity layer); not separately persisted — the renamed name lives on the
   * byte-stable Character once applied.
   */
  private pendingRenames: Record<EntityId, string> = {};

  /**
   * Seal hook for the HIDDEN private orientations (feature 0063) — the registry writes the Vault audit
   * copy + recall index, exactly like `onSealProfiles`. Engine-only: a private orientation is a secret
   * (off the player AND admin), so it rides this hook, never an outward projection.
   */
  private onSealPrivateOrientations?: (entries: ReadonlyArray<{ id: EntityId; orientation: Orientation }>) => void;

  setOnSealPrivateOrientations(fn: (entries: ReadonlyArray<{ id: EntityId; orientation: Orientation }>) => void): void {
    this.onSealPrivateOrientations = fn;
  }
  private onSealSeededRels?: (rels: SeededRelationships) => void;

  setOnSealSeededRels(fn: (rels: SeededRelationships) => void): void {
    this.onSealSeededRels = fn;
  }

  /**
   * 0059/L40 — fired when a seeded showmance crosses into `visible`: the registry wires this to record
   * a PLAYER-witnessed (public, non-hidden) house event, so the player learns of the romance through a
   * real pathway (0002) and the narrator may voice it. Engine-only seam (the adapter holds no events).
   */
  private onShowmanceSurfaced?: (sm: { a: EntityId; b: EntityId; aName: string; bName: string }) => void;

  setOnShowmanceSurfaced(fn: (sm: { a: EntityId; b: EntityId; aName: string; bName: string }) => void): void {
    this.onShowmanceSurfaced = fn;
  }

  /**
   * 0060 §4.2 — the surfacing seams the thread scheduler uses (NPC↔NPC gossip vs. a rare to-the-player
   * pathway). The adapter holds NO events/knowledge handle, so it hands the registry a Vault-SAFE
   * paraphrase (never the premise — `threadRumor` keyed by source class) and the registry runs the
   * 0038 gossip diffusion / 0002 `surfaceInformationTo` (with genuine content lineage, E9). Returns
   * whether the surfacing actually reached the player (so the scheduler can count it for restraint).
   */
  private onThreadGossip?: (origin: EntityId, rumor: string, subject: EntityId) => void;
  private onThreadSurfaceToPlayer?: (subject: EntityId, rumor: string) => boolean;

  setOnThreadGossip(fn: (origin: EntityId, rumor: string, subject: EntityId) => void): void {
    this.onThreadGossip = fn;
  }

  setOnThreadSurfaceToPlayer(fn: (subject: EntityId, rumor: string) => boolean): void {
    this.onThreadSurfaceToPlayer = fn;
  }

  /** 0075 — wire the confidence-recording pathway (the composition root owns the KnowledgeService). */
  setOnConfide(fn: (npcId: EntityId, content: string, confidence: number) => boolean): void {
    this.onConfide = fn;
  }

  /** 0093/0099 — wire the player's own knowledge reader (validate a wielded factId; resolve its subject).
   *  A0: `pathway` rides along (additive) so the knowledge-wall manifest can select the Diary-Room-tagged
   *  facts — the class provably sealed from the whole house. */
  setPlayerKnowledgeReader(fn: () => ReadonlyArray<{ id: string; content: string; subject?: EntityId; factId?: string; pathway?: string }>): void {
    this.playerKnowledgeReader = fn;
  }

  /** 0093/0099 — wire the in-game pathway that surfaces an exposed/traded secret into a houseguest's knowledge. */
  setOnSurfaceToHouseguest(fn: (npcId: EntityId, content: string, subject: EntityId | undefined, pathway: string, confidence: number) => boolean): void {
    this.onSurfaceToHouseguest = fn;
  }

  /**
   * 0060 §3 (`nominated-twice`) — engine-only, hidden bookkeeping: the DISTINCT weeks each houseguest
   * has been on the block, accrued each schedule tick from the live ceremony nominees. Persisted in the
   * snapshot so the count survives a restart (0030); never projected. Absent on pre-0060 saves (rebuilt
   * from the current ceremony onward — at worst a thread waits one extra block to ripen, never leaks).
   */
  private nominationWeeks: Record<EntityId, number[]> = {};
  /** 0060 — the count of threads that have ever SURFACED this season (the hard restraint cap, §5). */
  private surfacedThreadCount = 0;
  /**
   * 0104 — the returning player's accumulated season-over-season NOTORIETY, set ONLY when the player
   * chose to come back as the SAME character (the diegetic opt-in, R4 — the registry hands it in via
   * `setNotoriety` on a `keepCharacter` restart). Null on a fresh / new-character / no-prior-season
   * game ⇒ `seedFirstImpressions` folds NO bias and is BYTE-IDENTICAL (the calibration-neutrality
   * guarantee). It is a bounded OPEN-SET summary — never a Vault read, never a number to the player.
   * Folded ONCE at `seedFirstImpressions`; thereafter it is just the move-in edges. Not persisted on
   * THIS session (it lives at the account level in the `UserNotorietyStore`); held only to seed day one.
   */
  private notoriety: NotorietySummary | null = null;
  /**
   * 0091 — whether the TRIGGER-ERUPTION layer RUNS. DEFAULT OFF (the dedicated `ORWELL_TRIGGERS` flag):
   * when off, the orchestrator never calls `runTriggerEruptions` ⇒ ZERO draws on any rng ⇒ every seeded
   * gate is byte-identical (the calibration-neutrality guarantee). Per instance; a test flips it via
   * `setTriggersEnabled`.
   */
  private triggersEnabled = TRIGGERS_ENABLED_DEFAULT;
  /**
   * 0091 — the per-season count of volatile triggers that have FIRED (sibling to `surfacedThreadCount`).
   * MONOTONIC; the hard `eruptionCapPerSeason` reads it so a few-per-season pacing holds and a reload never
   * re-opens the cap (0007/0030). ENGINE-ONLY (a count carries no Vault content). Reset to 0 on a season
   * restart, like `surfacedThreadCount`.
   */
  private eruptionCount = 0;
  /** 0091 — the DEDICATED trigger-rng tick counter: the trigger check forks off the game seed + this, never
   *  the shared society/vote stream, so even with the layer ON the seeded calibration spine is untouched.
   *  Bumped once per `runTriggerEruptions`. Persisted so the dedicated stream stays reproducible (absent ⇒ 0). */
  private triggerTickCount = 0;
  /**
   * 0092 — the secret-pacing drip's hidden weekly bookkeeping (engine-only; the pace is per-WEEK, not a
   * per-tick probability). `pacingDripWeek` is the week `pacingDripCount` is FOR — a new week resets the
   * count to 0; `pacingDripCount` is how many player-bound drips have fired this week (the hard weekly
   * ceiling `SECRET_PACING.maxDripsPerWeek`); `pacingTickCount` is the DEDICATED rng's tick counter (so
   * the seeded eligibility stream is reproducible and never aliases another dedicated stream). Persisted
   * so the cadence + anti-spam survive a restart and the pace RESUMES (never resets). Absent on saves
   * with pacing off / pre-0092 ⇒ 0 (non-degradation; the season cap `surfacedThreadCount` still binds).
   */
  private pacingDripWeek = 0;
  private pacingDripCount = 0;
  private pacingTickCount = 0;
  /**
   * 0092 — per-thread, the WEEK that thread last dripped toward the player (so the already-told penalty +
   * the no-re-spam rule survive a restart). A thread's id ⇒ the last week it edged toward the player.
   * Persisted alongside the counter above (siblings to 0060's `surfacedThreadCount`). Engine-only.
   */
  private pacingLastDrippedWeek: Record<string, number> = {};
  /**
   * 0075 — what each houseguest has CONFIDED to the player, by id. The tier is MONOTONIC for a true
   * confidence (never re-told at a lower tier than already reached); `truthful: false` marks a lie
   * (engine-side only — never a player-facing tell). Persisted in the snapshot so a restored game
   * remembers exactly what the player has been told (non-degradation, 0007/0030).
   */
  private confideState: Record<EntityId, { tier: DisclosureTier; truthful: boolean }> = {};
  /** 0075 — the per-season count of lies told TO the player (the hard `CONFIDENCE.maxLiesPerSeason` cap). */
  private lieCount = 0;
  /**
   * 0075 — the in-game pathway that records a confidence as the player's knowledge (set by the
   * composition root, like `onThreadSurfaceToPlayer`). The houseguest is the teller (`told-by:<id>`):
   * the engine writes the belief through `surfaceInformationTo` (0002) so it is correctly the
   * player's knowledge, not Vault content. Returns whether the player came to hold the belief.
   */
  private onConfide?: (npcId: EntityId, content: string, confidence: number) => boolean;

  /**
   * Features 0093 + 0099 — secrets as power. Per learned `factId` the player has WIELDED, a monotonic
   * `usedAs` marker (`leverage` | `exposed` | `traded`) so a secret can't be re-wielded after it's spent
   * (exposing makes it public; trading widens who knows). Persisted (non-degradation, 0007/0030) so a
   * restored game remembers exactly which secrets the player has spent. Engine-only — never projected.
   */
  private secretUsedAs: Record<string, "leverage" | "exposed" | "traded"> = {};
  /** 0093 — the per-season count of exposes (the hard `LEVERAGE.maxExposesPerSeason` cap). Persisted. */
  private exposeCount = 0;
  /** 0099 — the per-season count of trades (the hard `SECRET_TRADE.maxTradesPerSeason` cap). Persisted. */
  private tradeCount = 0;
  /** deception — the per-season count of the PLAYER's bluffs (the `LEVERAGE.maxPlayerBluffsPerSeason` cap). Persisted. */
  private playerBluffCount = 0;
  /**
   * deception — the PASSIVE LIE-CATCH ledger (owner direction): per NPC who BELIEVED a player BLUFF, the
   * subject(s) the player lied about. When a genuine contradicting pathway later reaches that NPC (the
   * REAL truth about the same subject — an honest expose/trade), the bluff is caught and the bluffer takes
   * a betrayal-grade, recoverable hit from that NPC. Engine-only; persisted (non-degradation, 0007/0030).
   */
  private playerBluffBelief: Record<EntityId, EntityId[]> = {};
  /**
   * 0093/0099 — the player's own KNOWLEDGE reader (wired by the composition root, like the npc-knowledge
   * providers): returns the player's learned facts so the lever can VALIDATE that a wielded `factId` is
   * one the player legitimately holds (the Vault bright line — a non-learned secret is rejected, no
   * Vault-minting) and resolve which houseguest it is about. Returns [] when unwired.
   */
  private playerKnowledgeReader?: () => ReadonlyArray<{ id: string; content: string; subject?: EntityId; factId?: string; pathway?: string }>;
  /**
   * 0093/0099 — surface a fact INTO another houseguest's (or the house's) knowledge through the in-game
   * pathway (wired by the composition root, mirroring `onConfide`). The player is the teller for an
   * expose/trade (`told-by:player` / `overheard`): the engine records the witnessed pathway event so the
   * recipient correctly comes to KNOW the secret — never a Vault read. Returns whether it surfaced.
   */
  private onSurfaceToHouseguest?: (npcId: EntityId, content: string, subject: EntityId | undefined, pathway: string, confidence: number) => boolean;
  /** 0066 Phase-2: per-NIGHT conflict tally per houseguest (cleared at each new day). A character conflict
   *  drains the people in it ⇒ they turn in earlier tonight. In-memory + ephemeral (a mid-day reload simply
   *  resets it); only ever populated on the clock-ON path, so the calibration spine is unaffected. */
  private nightConflicts = new Map<EntityId, number>();

  /**
   * The season record providers (0048/B56): the full event record + the Vault's hidden records,
   * wired by the registry. The recap reads only the PUBLIC record; the retrospective reads the
   * hidden side and is gated on the finished terminal state in `seasonRetrospective`.
   */
  private record?: {
    events: () => GameEvent[];
    hidden: () => ReadonlyArray<{ kind: string; content: string }>;
  };

  setRecordProviders(p: {
    events: () => GameEvent[];
    hidden: () => ReadonlyArray<{ kind: string; content: string }>;
  }): void {
    this.record = p;
  }

  /**
   * 0065 Part E — the delta feed's O(Δ) providers, wired by the registry. `count` is the O(1) event-log
   * length (used to anchor each beat checkpoint at commit time). `visibleEventsSince(fromCount)` returns
   * the PLAYER-VISIBLE events appended AT OR AFTER `fromCount` — the registry slices the immutable log
   * tail (O(Δ)) and runs the SAME witness-filter + roster scrub the player surface uses, so the delta is
   * Vault-free by construction and never re-scans the whole log. Absent on a standalone adapter (no
   * registry) ⇒ the delta degrades to a full refresh (it cannot fetch a Vault-safe tail without them).
   */
  private deltaSource?: {
    count: () => number;
    visibleEventsSince: (fromCount: number) => DeltaEventView[];
  };

  setDeltaProviders(p: {
    count: () => number;
    visibleEventsSince: (fromCount: number) => DeltaEventView[];
  }): void {
    this.deltaSource = p;
  }

  /**
   * 0065 Part E — a per-turn beat checkpoint ring: `beatSeq → { eventCount, ceremony/board snapshot,
   * finished/winner }` captured at each `bumpBeatSeq` (the single commit funnel). The delta looks up the
   * checkpoint AT `sinceBeatSeq` to slice the event tail (O(Δ)) and diff the ceremony — so it never
   * re-derives "what existed then" by scanning. Bounded (the last `DELTA_WINDOW` beats); a token older
   * than the oldest retained checkpoint (or after a restart, which starts the ring empty) ⇒ a full
   * refresh, never a guessed partial delta. NOT persisted — it is a process-local read accelerator; on a
   * resume the FE's last-seen token resets too, so an unknown token correctly full-refreshes.
   */
  private readonly beatCheckpoints = new Map<number, {
    eventCount: number;
    week: number;
    phase: string;
    hoh?: EntityId;
    nominees: EntityId[];
    vetoHolder?: EntityId;
    vetoUsed: boolean;
    finished: boolean;
    winner?: EntityId;
  }>();
  private static readonly DELTA_WINDOW = 64;

  /**
   * 0065 Part E — an OPTIONAL diagnostic seam (Vault-free, no behavior change): reports how many tail
   * events the last `stateDelta` MATERIALIZED, so a complexity test can assert the work is bounded by Δ
   * (never O(events)). Off by default; set only in tests. It carries a count, never any event content.
   */
  private deltaScanProbe?: (scanned: number) => void;

  setDeltaScanProbe(fn: ((scanned: number) => void) | undefined): void {
    this.deltaScanProbe = fn;
  }

  /** Per-NPC knowledge readers (B65), wired by the registry from the KnowledgeService. `known` carries
   *  the originating `sourceEventId` (#843) so the Vault dump can join a gossip/surfacing breadcrumb
   *  event back to the real belief it lodged — voicing only ever reads `content`, so this is additive. */
  private npcKnowledge?: {
    known: (id: EntityId) => ReadonlyArray<{ content: string; sourceEventId?: string }>;
    suspicions: (id: EntityId) => ReadonlyArray<{ content: string }>;
  };

  setNpcKnowledgeProviders(p: {
    known: (id: EntityId) => ReadonlyArray<{ content: string; sourceEventId?: string }>;
    suspicions: (id: EntityId) => ReadonlyArray<{ content: string }>;
  }): void {
    this.npcKnowledge = p;
  }

  /** Caps so a long season's voicing context stays tight (prefer removing context — ADR 0003). */
  private static readonly VOICE_KNOWS_CAP = 20;
  private static readonly VOICE_SUSPECTS_CAP = 8;

  /** Resolve a houseguest id by id, else exact name, else an UNAMBIGUOUS first name (audit 2026-06-18
   *  — the model calls npcVoice with a name as often as an id; tolerate both, but never guess between
   *  two people who share a first name). Returns null when unknown/ambiguous. */
  private resolveHouseguestVoiceId(key: string): EntityId | null {
    if (!this.house) return null;
    const npcs = this.house.npcs;
    if (npcs.some((n) => n.id === key)) return key as EntityId;
    const k = key.trim().toLowerCase();
    const byName = npcs.filter((n) => n.name.toLowerCase() === k);
    if (byName.length === 1) return byName[0]!.id;
    const byFirst = npcs.filter((n) => n.name.toLowerCase().split(" ")[0] === k);
    return byFirst.length === 1 ? byFirst[0]!.id : null;
  }

  /**
   * The knowledge-bounded voicing projection for ONE active houseguest (B65 / ADR 0003 §8). The
   * model is HANDED a bounded person: their stable public persona (byte-stable, B61), their room +
   * co-presence (0049), what THEY legitimately know (0002 — which they may, in character, choose
   * to reveal: that is the game), their hunches, and ORGANIC stances (labels through their own
   * disposition — never a number). Everything any OTHER houseguest privately knows, the Vault,
   * and the souls stay out by construction — the model cannot voice what this NPC never learned.
   */
  npcVoice(idOrName: EntityId): NpcVoiceView | null {
    if (!this.house) return null;
    // Name-tolerant lookup (audit 2026-06-18): the narration model reliably calls this with a
    // NAME ("Griffin Suarez") instead of the id ("npc:8"); a strict id-only match returned null and
    // the model then narrated the dead call out loud to the player ("the voice report didn't come
    // back"). Resolve by id first, then exact name, then an unambiguous first-name — so a sensible
    // call always lands and never leaks a backstage miss into the fiction.
    const rid = this.resolveHouseguestVoiceId(idOrName);
    const npc = rid ? this.house.npcs.find((n) => n.id === rid) : undefined;
    if (!npc) return null;
    const id = npc.id;
    const seat = this.seatOf(id);
    // NARR-7 (#542): a JURY/EVICTED seat is still VOICED — at the finale the prompt directs the
    // model to stage all 9 jurors questioning the finalists, so a null voice anchor forced the model
    // to FABRICATE juror biographies that contradict their seeded selves. The persona block below is
    // the SAME byte-stable PUBLIC facets an active houseguest exposes (archetype/biography/demeanor/
    // heritage…) — all freely on the public card all season — so this is no Vault widening: only
    // whereabouts (a live in-house field) goes null, since a juror is no longer in the house.
    const isActive = seat === "active";

    const room = isActive ? (this.presence?.get(id) ?? null) : null;
    const present: NamedRef[] = [];
    if (room && this.presence) {
      for (const [other, where] of this.presence) {
        if (where === room && other !== id) present.push({ id: other, name: this.nameOf(other) });
      }
    }
    const evicted = new Set(this.live?.evictionOrder ?? []);
    const others = [this.house.player.id, ...this.house.npcs.map((n) => n.id)]
      .filter((h) => h !== id && !evicted.has(h));
    return {
      houseguest: { id, name: npc.name },
      seat,
      persona: {
        archetype: npc.character.archetype,
        strategyStyle: npc.character.strategyStyle,
        background: npc.character.background,
        age: npc.character.age,
        presentation: npc.character.presentation,
        // L28: voice them in their STORED observable register (blunt / deadpan / anxious…), not a default.
        ...(npc.character.demeanor !== undefined ? { demeanor: npc.character.demeanor } : {}),
        // 0058: voice the STORED biography, never invent (and drift) it. Public facet only — the hidden
        // deep profile is never on this projection (the §8 wall).
        ...(npc.character.biography !== undefined ? { biography: npc.character.biography } : {}),
        // L29 single physical descriptor (appearance/physicalCharacteristics consistency): the STRUCTURED
        // facet is the ONE source of truth the portrait + narration share; the prose `appearance` rides
        // ONLY as the pre-0058 fallback — NEVER both at once (they were independently generated and could
        // contradict on build/skin/hair). When the facet is present it alone is voiced.
        ...(npc.character.physicalCharacteristics !== undefined
          ? { physicalCharacteristics: npc.character.physicalCharacteristics }
          : npc.character.appearance !== undefined ? { appearance: npc.character.appearance } : {}),
        // 0063: voice the PUBLIC identity facets — heritage, gender presentation, and a PUBLICLY-OUT
        // orientation only. A PRIVATELY-held orientation is NEVER here (it's Vault-sealed; the houseguest
        // would never lead with it until a pathway surfaces it, §5). One true facet, never the character.
        ...(npc.character.ethnicity !== undefined ? { ethnicity: npc.character.ethnicity } : {}),
        ...(npc.character.genderPresentation !== undefined ? { genderPresentation: npc.character.genderPresentation } : {}),
        ...(npc.character.outOrientation !== undefined ? { outOrientation: npc.character.outOrientation } : {}),
        // 0084: voice them in their STORED voice fingerprint — how THIS houseguest talks, all season. A
        // PUBLIC, byte-stable facet (no Vault, no number); absent only on a pre-0084 save.
        ...(npc.character.voice !== undefined ? { voice: npc.character.voice } : {}),
      },
      // 0084: the current MOOD as a Vault-safe affect word, derived live from the soul on two timescales
      // (acute + marinated baseline). ACTIVE houseguests only (a juror is out of the house); observable
      // carriage only — never a number, never the hidden cause.
      ...(isActive ? (() => {
        const s = this.soulObj(id);
        return s ? { mood: moodWord(s.emotionalState, s.volatility, s.emotionalHistory) } : {};
      })() : {}),
      whereabouts: room ? { room, present } : null,
      knows: (this.npcKnowledge?.known(id) ?? [])
        .slice(-GameSessionAdapter.VOICE_KNOWS_CAP)
        .map((f) => this.humanize(f.content)),
      suspects: (() => {
        const base = (this.npcKnowledge?.suspicions(id) ?? [])
          .slice(-GameSessionAdapter.VOICE_SUSPECTS_CAP)
          .map((f) => this.humanize(f.content));
        // 0105: a houseguest's DRIVE (0086) gives them a specific, Vault-safe suspicion — the wary
        // threat-READ behind the sealed plan, surfaced as a behavioral hunch so the narrator has someone
        // specific to voice them watching (anchoring the 0084 mood). Present ONLY when the drive layer is
        // live (⇒ campaigns off ⇒ no drive ⇒ this is absent ⇒ byte-identical projection). The PLAN, the
        // intensity, the campaign never cross — only the hunch the houseguest would act out anyway.
        if (isActive) {
          const drv = this.drives.get(id);
          const hunch = drv ? driveSuspicion(drv, drv.target !== undefined ? this.nameOf(drv.target) : undefined) : null;
          if (hunch && !base.includes(hunch)) base.push(hunch);
        }
        return base;
      })(),
      stances: others.map((other) => ({
        toward: { id: other, name: this.nameOf(other) },
        stance: relationshipLabel(this.rel.edge(id, other), dispositionOf(npc.character.archetype)),
      })),
      // 0075: the Vault-safe emergent confidence hint (reason + warmth word only) — present ONLY for an
      // ACTIVE houseguest the player has earned a confidence from, and only when the scene precipitates it.
      ...(isActive ? (() => { const m = this.mayConfideFor(npc); return m ? { mayConfide: m } : {}; })() : {}),
      // 0088: the living CURRENT read of the player — a Vault-safe carriage word + drift word, derived
      // live from the evolving NPC→player edge (distinct from the frozen dayOnePerception). ACTIVE only;
      // the anchor is Vault-only (persisted in the snapshot, never crossed). Sibling of 0084's `mood`.
      ...(isActive && this.house ? (() => {
        const playerId = this.house!.player.id;
        const edge = this.rel.edge(id, playerId);
        const disp = dispositionOf(npc.character.archetype);
        const soul = this.soulObj(id);
        const anchor = this.readAnchors.get(id);
        const read = currentReadOf(edge, disp, soul?.emotionalState, anchor);
        return { currentRead: read };
      })() : {}),
    };
  }

  /**
   * A0 — the knowledge-wall manifest: the player's private disclosures that are sealed from the house,
   * for the front-end narration guard to enforce (no houseguest may voice what no pathway ever gave
   * them). Vault-free by construction — it reads the PLAYER's OWN knowledge (never a Vault read, never
   * an NPC's hidden layer). It surfaces ONLY the Diary-Room-tagged facts: the class provably sealed
   * from the WHOLE house (`NO_NPC_PATHWAY` — an OOC channel with no in-game pathway to ANY npc, ever),
   * so `knownTo` is empty and the guard's rule is absolute with zero false positives. Non-diary player
   * knowledge is deliberately NOT surfaced here: a player-witnessed secret can legitimately diffuse
   * NPC-to-NPC as gossip, so a blunt content scrub would fight the very pathway model that makes it
   * legal — that class is enforced through the per-NPC `npcVoice.knows` manifest instead.
   */
  sealedFromHouse(): SealedFact[] {
    if (!this.house) return [];
    const facts = this.playerKnowledgeReader?.() ?? [];
    const out: SealedFact[] = [];
    for (const f of facts) {
      if (f.pathway !== NO_NPC_PATHWAY) continue;
      const content = this.humanize(f.content).trim();
      if (content) out.push({ content, knownTo: [] });
    }
    return out;
  }

  /**
   * The portrait prompt for one houseguest by id (0051) — Vault-free. Built from PUBLIC appearance
   * facets only (appearance/age/presentation) + the per-season style anchor. Returns null when no
   * game is started or the id is unknown. No stats, soul, or hidden element ever reaches the prompt.
   */
  getPortraitPrompt(id: EntityId): { houseguestId: string; name: string; prompt: string } | null {
    if (!this.house || !this.portraitStyleAnchor) return null;
    const npc = this.house.npcs.find((n) => n.id === id);
    const subject = id === this.house.player.id ? this.house.player : npc;
    if (!subject) return null;
    // #529: the human authors no look, so the player's appearance stays empty — NEVER improvise a
    // player portrait from a name hash. With no authored appearance (and no structured facet), there
    // is nothing to draw, so emit no prompt at all rather than a fabricated one.
    if (id === this.house.player.id
      && !subject.character.appearance
      && subject.character.physicalCharacteristics === undefined) {
      return null;
    }
    return buildPortraitPrompt(
      subject.id,
      subject.name,
      {
        appearance: subject.character.appearance,
        age: subject.character.age,
        presentation: subject.character.presentation,
        ...(subject.character.physicalCharacteristics !== undefined
          ? { physicalCharacteristics: subject.character.physicalCharacteristics } : {}),
        // 0063: feed the PUBLIC diversity + personality facets so the shot is uniquely this person — the
        // heritage (an authentic likeness), how they present, and their observable demeanor (vibe/energy).
        // A PRIVATE orientation is NEVER read here (it lives in the engine-only map, not on the Character),
        // so it can never enter a prompt — the §5 Vault rule holds by construction.
        ...(subject.character.ethnicity !== undefined ? { ethnicity: subject.character.ethnicity } : {}),
        ...(subject.character.genderPresentation !== undefined ? { genderPresentation: subject.character.genderPresentation } : {}),
        ...(subject.character.demeanor !== undefined ? { demeanor: subject.character.demeanor } : {}),
      },
      this.portraitStyleAnchor,
    );
  }

  /**
   * The deep-profile write-back seam (feature 0058 / ledger L28b) — the FE producer-LLM authors a
   * houseguest's rich §3 profile and writes it BACK here so the ENGINE becomes the airtight source of
   * truth (mirrors the 0051 portrait handshake). NOW LIVE: it validates (non-player-mirroring),
   * SPLITS across the Vault Wall (PUBLIC biography/physical facet → the byte-stable Character; HIDDEN
   * secrets/goals/weakness/Day-1 perception → the engine-only deep layer + the Vault), re-derives the
   * story threads, re-seeds the NPC→player edge from the new Day-1 read, and re-indexes for full
   * recall — REPLACING the seeded floor for that houseguest (idempotent; no stale/duplicated records).
   *
   * The split is ENFORCED by construction: the result reports PUBLIC and HIDDEN field NAMES on separate
   * lists and NEVER echoes a hidden value — so the seam can never become a wall leak (§8). Any field the
   * author omits keeps its prior (seeded) value, so the profile always stays complete.
   */
  recordCastProfile(req: RecordCastProfileReq): RecordCastProfileResult {
    // 0065: the authored profile lands on the PRE-WARMED cast pre-game (the cast is generated before the
    // player finishes the interview — `preSeedCast` → `prewarm`), or on the live house once a season is
    // running (e.g. a season-2 re-author). Same split/seal logic either way; the only difference is which
    // store holds the cast + which name guards the non-mirroring check (the live player, or the intake name).
    const ctx = this.house
      ? {
        npcs: this.house.npcs, playerName: (this.house.player.name ?? "").trim(), prewarm: false,
        profiles: this.deepProfiles,
        getThreads: (): StoryThread[] => this.storyThreads,
        setThreads: (t: StoryThread[]): void => { this.storyThreads = t; },
      }
      : this.prewarm
      ? {
        npcs: this.prewarm.npcs, playerName: (this.intake.playerName ?? "").trim(), prewarm: true,
        profiles: this.prewarm.deepProfiles,
        getThreads: (): StoryThread[] => this.prewarm!.storyThreads,
        setThreads: (t: StoryThread[]): void => { this.prewarm!.storyThreads = t; },
      }
      : null;
    if (!ctx) return { accepted: false, publicFields: [], hiddenFields: [], reason: "no game started" };
    const target = ctx.npcs.find((n) => n.id === req.houseguestId);
    if (!target) return { accepted: false, publicFields: [], hiddenFields: [], reason: "unknown houseguest" };

    // Validate — non-player-mirroring (L28 + the anti-sycophancy mandate #3): the cast is INDEPENDENT
    // of the player, so NEITHER the authored PUBLIC material NOR the hidden STORYLINE material (secrets,
    // true goals, weakness) may be built around the player — an NPC's drama must not echo the player's
    // name. This is the airtight guard: even if an authoring model ignores the prompt and weaves the
    // player into an NPC's secret/goal/weakness, the engine refuses it here so no player-centric story
    // material is ever sealed. The Day-1 read of the player is the ONE legitimately player-facing field
    // and is excluded from this check (the engine owns its seeded value regardless). Vault-safe: the
    // refusal echoes no authored value. (A short player name is ignored to avoid false positives.)
    const playerName = ctx.playerName;
    const mentionsPlayer = (text: string): boolean =>
      playerName.length >= 3 && text.toLowerCase().includes(playerName.toLowerCase());
    const publicText = `${req.biography ?? ""} ${req.physicalCharacteristics ? Object.values(req.physicalCharacteristics).join(" ") : ""}`;
    const storylineText = `${(req.secrets ?? []).join(" ")} ${(req.trueGoals ?? []).join(" ")} ${req.weakness ?? ""}`;
    if (mentionsPlayer(publicText) || mentionsPlayer(storylineText)) {
      return { accepted: false, publicFields: [], hiddenFields: [], reason: "authored profile mirrors the player" };
    }

    // CROSS-CHARACTER guard (RCA hardening, mirrors `mentionsPlayer`): authored HIDDEN storyline prose
    // (secrets / true goals / weakness / Day-1 read) may name an NPC's OWN ex / colleague / rival from
    // BEFORE the house (a genuinely-external person the engine doesn't model) — that is legitimate and
    // stays. What it must NOT do is name ANOTHER CURRENT houseguest: the engine models inter-houseguest
    // dynamics through the relationship layer, not through one NPC's authored secret, so a cross-character
    // claim baked into a sealed thread ("npc:5's secret is that they're plotting with <peer name>") would
    // be an ungrounded board assertion the engine never produced (anti-sycophancy #3). We strip any
    // storyline FIELD that names a peer (fall back to the seeded floor for that field — the profile stays
    // complete) rather than failing the whole call. Word-boundary match on each OTHER houseguest's current
    // display name (length floor like the player guard, to avoid false positives on a one-syllable name).
    const peerNames = ctx.npcs
      .filter((n) => n.id !== target.id)
      .map((n) => (n.name ?? "").trim())
      .filter((nm) => nm.length >= 3);
    const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const mentionsOtherHouseguest = (text: string): boolean => {
      if (!text) return false;
      return peerNames.some((nm) => new RegExp(`\\b${escapeRe(nm)}\\b`, "i").test(text));
    };
    // Sanitize each authored HIDDEN storyline field: drop it (⇒ fall back to the seeded floor below) when it
    // names another current houseguest. An ARRAY field is dropped wholesale if ANY element names a peer (a
    // single cross-character line poisons the field; the seeded floor is coherent and complete). `undefined`
    // means "the author supplied nothing" AND "the author supplied a peer-naming value we refuse" alike — the
    // `next` merge already treats `undefined` as "keep the prior/floor value", so this is the natural fallback.
    const safeSecrets = req.secrets !== undefined && !req.secrets.some(mentionsOtherHouseguest) ? req.secrets : undefined;
    const safeGoals = req.trueGoals !== undefined && !req.trueGoals.some(mentionsOtherHouseguest) ? req.trueGoals : undefined;
    const safeWeakness = req.weakness !== undefined && !mentionsOtherHouseguest(req.weakness) ? req.weakness : undefined;
    const safePerception = req.dayOnePerception !== undefined && !mentionsOtherHouseguest(req.dayOnePerception)
      ? req.dayOnePerception : undefined;

    // Field NAMES only — never the values (a hidden value must never ride out on the result, §8). The hidden
    // list reports what was actually SEALED, so a peer-naming field that was refused above is not listed.
    const publicFields = (["biography", "physicalCharacteristics"] as const).filter((f) => req[f] !== undefined) as string[];
    const hiddenFields = ([
      ["secrets", safeSecrets], ["trueGoals", safeGoals], ["weakness", safeWeakness], ["dayOnePerception", safePerception],
    ] as const).filter(([, v]) => v !== undefined).map(([f]) => f);

    // (0) PUBLIC NAME — the LLM-authored, real-sounding replacement display name. Accept it ONLY if it is a
    // reasonable two-token human name AND it does not collide (case-insensitive) with any OTHER current
    // houseguest or the player; otherwise the seeded corpus name (the deterministic floor) simply stands.
    // A rejected name NEVER fails the whole call — the rest of the authored profile still applies.
    //
    // A1 (ship-blocker, "the phantom-houseguest root"): a PUBLIC name is structurally FROZEN the instant
    // the player has been introduced to this houseguest (`introducedNames`, populated by
    // `markHouseguestMet`) — never on the prewarm/pre-game path (that set is always empty pre-game).
    // `recordCastProfile` is an FE-driven write-back that can complete ASYNCHRONOUSLY relative to
    // premiere narration (deep cast-authoring kicked off in the background at season start, or an even
    // later authoring backfill) — without this guard a late-arriving authored name silently RENAMES a
    // houseguest the player already met and was told the name of, and the GM then reads as "correcting"
    // the player about the game's own prior words. This is enforced HERE, structurally, not by timing
    // the FE's background call — the smaller, surgical fix over trying to serialize an inherently
    // best-effort background task ahead of narration.
    if (req.name !== undefined && this.introducedNames.has(target.id)) {
      // Silently drop — mirrors the cross-character guard's per-field drop above: the rest of the
      // authored profile still applies, only the name is refused so the seeded/already-shown name stands.
    } else if (req.name !== undefined) {
      const name = req.name.trim();
      const collides = name.toLowerCase() === ctx.playerName.toLowerCase()
        || ctx.npcs.some((n) => n.id !== target.id && (n.name ?? "").trim().toLowerCase() === name.toLowerCase());
      if (isReasonableName(name) && !collides) {
        target.name = name;
        publicFields.push("name");
      }
    }

    // (1) PUBLIC fold onto the byte-stable Character — these cross to the player.
    // OCCUPATION/VOCATION LOCKSTEP (#849): the public `vocation` is the job the player reads — and the
    // hidden secret STAKE is keyed off it (deepProfile's `sectorOf(vocation)`). The authoring LLM can
    // re-write the public cover (biography → a NEW occupation) without re-grounding `vocation`, leaving
    // the seeded hidden stakes keyed to the OLD job (the Producer's-Vault audit: a "court reporter" bio
    // over business-owner stakes). So when the author supplies a new `vocation`, fold it onto the public
    // Character FIRST — in lockstep with the biography — so both public facets agree AND the seeded-floor
    // re-derive below (step 2) reads the corrected occupation. A blank/non-string value is ignored (the
    // seeded `vocation` stands). Trim to a clean noun phrase; the cast-mirror guard already ran above on
    // the biography (the occupation noun is too short to meaningfully mirror a player name).
    const priorVocation = target.character.vocation;
    if (typeof req.vocation === "string" && req.vocation.trim().length > 0) {
      target.character.vocation = req.vocation.trim();
      if (target.character.vocation !== priorVocation) publicFields.push("vocation");
    }
    // Did the occupation the player infers actually change? Drives the hidden-stake re-ground in step 2.
    const occupationChanged = target.character.vocation !== priorVocation;
    if (req.biography !== undefined) target.character.biography = req.biography;
    if (req.physicalCharacteristics !== undefined) {
      target.character.physicalCharacteristics = req.physicalCharacteristics;
      // 0063 RE-GROUND (the "olive-skin collapse" fix, 2026-06-23): the FE authoring LLM re-authors the
      // WHOLE physicalCharacteristics block — including skinTone — but it is NOT given the houseguest's
      // guaranteed heritage, so it reliably defaults skinTone to a generic "olive" and silently discards
      // the engine's ethnicity-grounded, diversity-floored complexion. The diversity floor is an ENGINE
      // GUARANTEE (text + portrait must agree with the seeded heritage, 0063 §3.2), so the engine — not
      // the LLM — owns skinTone: overwrite the authored value back to the grounded cue. Prefer the live
      // `groundedSkinTones` map (set by seedDiversity); fall back to deriving it from the houseguest's
      // own ethnicity label (covers a post-restart author when the transient map is empty). The LLM still
      // authors all the OTHER facets (build/hair/features/mark/style/ageLook) freely.
      const grounded = this.groundedSkinTones[target.id]
        ?? ALL_ETHNICITIES.find((e) => e.heritage === target.character.ethnicity)?.skinTone;
      if (grounded) target.character.physicalCharacteristics.skinTone = grounded;
    }
    // #1067 — MARK the season-start floor→authored UPGRADE of the PUBLIC deep-profile facets. The seeded
    // floor (`seedDeepProfiles`) sets `biography`/`physicalCharacteristics`/`vocation` to a placeholder and
    // the orchestrator persists it as the byte-stable baseline; this write-back replaces them with a richer
    // authored version. Replacing a byte-stable Character facet would otherwise read as DEGRADATION at the
    // 0031 checkpoint (the live-verify's "integrity checkpoint failed (degradation)" refusals — #1067) even
    // though it ACCRETES detail. The provenance flag (persisted in the snapshot, read by `isSuperset`) makes
    // the upgrade a SANCTIONED one-way transition — never a hole in non-degradation: once authored, the bio
    // is byte-stable forever and a later thinning is still refused. Set whenever a public facet is authored.
    if (req.biography !== undefined || req.physicalCharacteristics !== undefined
        || (typeof req.vocation === "string" && req.vocation.trim().length > 0)) {
      target.character.deepProfileAuthored = true;
    }

    // (2) HIDDEN: merge the authored fields over the prior profile so it stays complete. The prior is
    // the seeded floor (always present after seedDeepProfiles; regenerate deterministically if missing).
    // The author supplies the Day-1 read as PROSE only — the engine KEEPS the calibrated seeded leans
    // (anti-sycophancy: the LLM authors flavor, never the hidden weights; this also preserves the
    // net-zero perception balance the juryReach gate depends on). Only the read TEXT is authored.
    // The CHARACTER-CONDITIONED seeded floor (P1): coherent off the target's own archetype/vocation/age
    // (never the player). The narrative text rides a DEDICATED sub-stream (#392 RNG-isolation), matching
    // the cast-layer key so the fallback agrees with it.
    const seededFloor = (): DeepProfile => generateDeepProfile(
      new SeededRandom(hashSeed(`${this.gameSeed ?? 0}:deep-hidden:${target.name}`)),
      undefined,
      target.character,
      hashSeed(`${this.gameSeed ?? 0}:deep-narrative:${target.name}`),
    );
    // #849 RE-GROUND: when the occupation changed, the EXISTING seeded floor (in `ctx.profiles`) was
    // composed off the OLD vocation, so its secrets/goals/weakness cohere with the WRONG job. Re-derive
    // the floor off the now-corrected `target.character` so any hidden field the author leaves to the
    // engine reads like the occupation the player will infer. The re-derive is TEXT-ONLY by construction:
    // vocation feeds only deepProfile's isolated narrative stream (#392), so the calibrated Day-1 leans
    // are byte-identical — and we carry the PRIOR `dayOnePerception` across regardless, so the move-in
    // NPC→player edge (the juryReach calibration) is provably untouched.
    const prior: DeepProfile | undefined = ctx.profiles[target.id];
    const prev: DeepProfile = occupationChanged
      ? { ...seededFloor(), dayOnePerception: (prior ?? seededFloor()).dayOnePerception }
      : (prior ?? seededFloor());
    const next: DeepProfile = {
      secrets: safeSecrets ?? prev.secrets,
      trueGoals: safeGoals ?? prev.trueGoals,
      weakness: safeWeakness ?? prev.weakness,
      dayOnePerception: safePerception !== undefined
        ? { ...prev.dayOnePerception, read: safePerception }
        : prev.dayOnePerception,
    };
    ctx.profiles[target.id] = next;

    // (3) Re-derive THIS source's story threads (replace), deterministic off the name. The NPC→player
    // edge keeps its seeded lean (the engine owns the numbers — see above), so no edge re-seed here.
    const thrRng = new SeededRandom(hashSeed(`${this.gameSeed ?? 0}:deep-thread-authored:${target.name}`));
    ctx.setThreads(ctx.getThreads().filter((t) => t.sourceId !== target.id)
      .concat(deriveStoryThreads(thrRng, target.id, next)));

    // (4) Full-fidelity recall (L27b): replace the prior deep-profile note in the authoritative soul
    // memory (engine-only; never crosses) so the authored detail is recall-able in full and persists +
    // re-indexes on restore. Also index it NOW for same-session recall.
    // The note to REPLACE is the one ACTUALLY stored — the genuine prior profile (`prior`), NOT the
    // possibly re-grounded floor in `prev`: when the occupation changed, `prev` is the re-derived floor
    // and would not match the stored note, so we'd leak a stale old-vocation note (a non-degradation
    // regression). Anchoring on `prior` keeps the swap idempotent. (`prior` undefined ⇒ nothing to
    // replace, so the new note is appended below — same as a first-time seal.)
    const oldNote = deepProfileToVaultContent(target.id, prior ?? prev);
    const newNote = deepProfileToVaultContent(target.id, next);
    const idx = target.soul.memory.lastIndexOf(oldNote);
    if (idx >= 0) {
      // R3 — the ONLY in-place same-length memory write. Swap the array REFERENCE (not just the slot)
      // so the snapshot clone cache's `(ref,len)` reuse key invalidates and the authored note is not
      // lost behind a stale clone. The replacement is content-preserving in spirit (re-derived authored
      // detail, never a deletion), so non-degradation still holds.
      target.soul.memory = target.soul.memory.slice();
      target.soul.memory[idx] = newNote;
    } else {
      target.soul.memory.push(newNote);
    }
    this.soul?.recordToSoul(target.id, newNote);

    // (5) Re-seal into the Vault — REPLACING this subject's prior profile + thread records (idempotent).
    this.onResealProfile?.(target.id, next, ctx.getThreads().filter((t) => t.sourceId === target.id));

    // PERSIST. A pre-game authored profile lands on `prewarm` (durable pre-game state). A LIVE authored
    // profile (#1067) is a SEASON-START FE-driven enrichment of byte-stable IDENTITY facets, exactly like
    // the 0062 `recordWorldSnapshot` zeitgeist write-back: it must persist DURABLY but must NOT bump the
    // closed-set `beatSeq` or run the integrity checkpoint. Previously the live path persisted NOTHING here
    // and relied on a later, unrelated player-turn commit to flush it — which (a) could silently drop the
    // write if no commit followed, and (b) made that commit's checkpoint compare the authored biography
    // against the floor baseline and REFUSE the whole turn as degradation (the live-verify's "integrity
    // checkpoint failed (degradation)" losses). Routing through `backgroundPersist` blind-saves the upgrade
    // without a checkpoint (like the zeitgeist), and the `deepProfileAuthored` provenance flag lets the NEXT
    // genuine player-turn commit's `isSuperset` recognize the floor→authored facet change as a sanctioned
    // upgrade rather than a regression. Non-degradation is intact: the flag permits exactly the one-way
    // floor→authored transition and the bio is byte-stable forever after.
    if (ctx.prewarm) this.persist();
    else this.backgroundPersist();

    return { accepted: true, publicFields: [...publicFields], hiddenFields: [...hiddenFields], reason: "authored profile sealed (live)" };
  }

  /**
   * The AI-driven cast-identity write-back (issue #544 — the deferred AI half of the 0063 diversity floor).
   * The FE producer-LLM PROPOSES the whole cast's DESCRIPTIVE identity facets (heritage / gender
   * presentation / orientation / disclosure / age) targeting U.S.-population rates; this RUNS them through
   * the engine's `repairDiversityLayer` (the SAME floors/caps/weighted-expectation as the seeded floor), so
   * even a lazy/biased/monochrome proposal is REPAIRED to a realistic cast before anything folds. The PUBLIC
   * facets fold onto the byte-stable Characters; `skinTone` is RE-GROUNDED from the FINAL heritage (the PR
   * #527 hinge, so text + portrait agree); each PRIVATE orientation is rebuilt + re-sealed into the Vault.
   *
   * Lands on the PRE-WARMED cast pre-game (the common case — replaces the seeded identity floor BEFORE deep
   * authoring shoots portraits) or the live house once a season runs (same fold either way). Idempotent. The
   * HARD BOUNDARY: only descriptive identity facets are touched — NEVER a hidden game weight (the seeded
   * Day-1 read / competition leans stay engine-owned; anti-sycophancy #3 + the juryReach calibration depend
   * on the net-zero-balanced seed). Calibration-neutral: the layer rides the SAME isolated descriptive
   * sub-streams as the floor, never a competition/vote input (the #338 golden test stays the proof). With NO
   * proposal the engine never receives this call and the deterministic floor stands.
   */
  recordCastIdentity(req: RecordCastIdentityReq): RecordCastIdentityResult {
    // Resolve the target cast + its seed: the live house (a season is running) or the pre-warmed holding
    // store (the common pre-game case). Same fold logic either way; only the npcs/seed/maps differ. (Mirrors
    // the recordCastProfile ctx split.)
    const ctx = this.house && this.gameSeed !== null
      ? {
        npcs: this.house.npcs, seed: this.gameSeed, prewarm: false,
        setPrivate: (m: Record<EntityId, Orientation>): void => { this.privateOrientations = m; },
        setGrounded: (id: EntityId, tone: string): void => { this.groundedSkinTones[id] = tone; },
      }
      : this.prewarm
      ? {
        npcs: this.prewarm.npcs, seed: this.prewarm.seed, prewarm: true,
        setPrivate: (m: Record<EntityId, Orientation>): void => { this.prewarm!.privateOrientations = m; },
        setGrounded: (id: EntityId, tone: string): void => { this.prewarm!.groundedSkinTones[id] = tone; },
      }
      : null;
    if (!ctx) return { accepted: false, applied: 0, reason: "no cast to fold identity onto" };

    // Map the LOOSE port facets → the engine's STRICT proposal shape. Unrecognized values are dropped HERE
    // (and again, defensively, inside repairDiversityLayer) so the engine never trusts a bad value — the
    // floors/caps then guarantee realism regardless. The proposal is DESCRIPTIVE-ONLY by type: there is no
    // field on it for a hidden weight, so a model can never author the Day-1 read / competition leans.
    const known = new Set(ctx.npcs.map((n) => n.id));
    const proposed: Record<EntityId, ProposedIdentityFacets> = {};
    for (const [rawId, raw] of Object.entries(req.facets ?? {})) {
      const id = rawId as EntityId;
      if (!known.has(id) || typeof raw !== "object" || raw === null) continue;
      const f = raw as ProposedCastIdentityFacets;
      const one: ProposedIdentityFacets = {};
      if (typeof f.ethnicity === "string" && f.ethnicity.trim()) one.ethnicity = f.ethnicity.trim();
      if (f.genderPresentation === "man" || f.genderPresentation === "woman" || f.genderPresentation === "nonbinary") {
        one.genderPresentation = f.genderPresentation;
      }
      if (typeof f.orientation === "string" && f.orientation.trim()) one.orientation = f.orientation.trim() as Orientation;
      if (typeof f.out === "boolean") one.out = f.out;
      if (typeof f.age === "number" && Number.isFinite(f.age)) one.age = f.age;
      if (Object.keys(one).length > 0) proposed[id] = one;
    }

    // Validate + REPAIR the whole-cast proposal against the proportional targets (diversityConstants.ts).
    // Off the SAME dedicated, isolated sub-stream the floor uses (forked off the cast seed via hashSeed
    // inside repairDiversityLayer) — never the shared house/competition/vote stream. An EMPTY proposal makes
    // this byte-identical to the seeded floor (the deterministic no-model path).
    const layer = repairDiversityLayer(ctx.seed, ctx.npcs, proposed);

    // PUBLIC fold — onto the byte-stable Character (mirrors seedDiversity's fold). `skinTone` comes from the
    // FINAL (possibly repaired) heritage, so text + portrait agree (the PR #527 / 0063 §3.2 hinge). The
    // engine — not the model — owns skinTone here too.
    let applied = 0;
    for (const n of ctx.npcs) {
      const pub = layer.public[n.id];
      if (!pub) continue;
      n.character.ethnicity = pub.ethnicity;
      n.character.genderPresentation = pub.genderPresentation;
      // A houseguest may have FLIPPED out↔private on a re-fold: set the public out facet when present, and
      // CLEAR it otherwise (a now-private orientation must never linger on the public Character).
      if (pub.outOrientation !== undefined) n.character.outOrientation = pub.outOrientation;
      else delete n.character.outOrientation;
      n.character.age = pub.age;
      ctx.setGrounded(n.id, pub.skinTone);
      if (n.character.physicalCharacteristics) n.character.physicalCharacteristics.skinTone = pub.skinTone;
      // #1140 — apply the gender-coherent re-pick directly: a recordCastIdentity fold lands on an
      // ALREADY-BUILT cast (the name-keyed deep layer is already seeded), so there's no re-seeding to defer —
      // writing the name now closes the UNCAPPED, UNFLAGGED AI-override hole (a proposal could flip the facet
      // off the name and leave the portrait rendering the name's gender). The given-name token is swapped to
      // the final presentation, surname kept, so name + portrait + narration read the same gender. (The
      // display name lives on the Houseguest wrapper — `n.name` — not on the static Character.)
      if (pub.name !== undefined) n.name = pub.name;
      if (proposed[n.id]) applied++;
    }

    // HIDDEN — rebuild the AUTHORITATIVE private-orientation map (engine-only; the in-memory map drives
    // 0059 showmance eligibility + persists in the snapshot, never the Vault audit copy). The private-
    // orientation soul note is PER-HOUSEGUEST idempotent: for every NPC, drop any STALE prior note (a re-fold
    // may CHANGE the orientation, or flip private→public), then add the current note iff the NPC is now
    // private. This keeps recall lossless without piling up duplicate/stale notes (non-degradation: the note
    // is replaced in spirit, never silently dropped — the current truth is always present).
    const nextPrivate: Record<EntityId, Orientation> = { ...layer.privateOrientations };
    ctx.setPrivate(nextPrivate);
    const PRIVATE_NOTE_PREFIX = "private-orientation ";
    for (const n of ctx.npcs) {
      const orientation = nextPrivate[n.id];
      const note = orientation ? privateOrientationToVaultContent(n.id, orientation) : null;
      const stale = n.soul.memory.some((m) => m.startsWith(`${PRIVATE_NOTE_PREFIX}${n.id}:`) && m !== note);
      if (!stale && (note === null || n.soul.memory.includes(note))) continue; // already correct — no change
      // Swap the array REFERENCE (R3 clone-cache invalidation) and rewrite this NPC's private-orientation
      // note: keep all OTHER memory, drop this NPC's stale private note, append the current one (if private).
      n.soul.memory = n.soul.memory.filter((m) => !m.startsWith(`${PRIVATE_NOTE_PREFIX}${n.id}:`));
      if (note) {
        n.soul.memory.push(note);
        this.soul?.recordToSoul(n.id, note);
      }
    }
    // Re-seal the current private orientations into the Vault (engine-only audit copy; idempotent replace by
    // the private-orientation Vault id, so a re-fold overwrites rather than duplicates).
    const entries = Object.entries(nextPrivate).map(([id, orientation]) => ({ id: id as EntityId, orientation }));
    if (entries.length) this.onSealPrivateOrientations?.(entries);

    // A pre-game fold lands on `prewarm`, which is durable state — persist it. A LIVE fold (a season-2
    // re-author) is the SAME class as the #1067 `recordCastProfile` upgrade: it re-grounds byte-stable
    // public facets (e.g. `physicalCharacteristics.skinTone`) and re-seals the private orientation, so it
    // must persist DURABLY without a beatSeq bump or the integrity checkpoint — route it through
    // `backgroundPersist` (which re-seeds the non-degradation baseline) just like the profile write-back,
    // rather than relying on an unrelated later commit (which would refuse the skinTone change as degradation).
    if (ctx.prewarm) this.persist();
    else this.backgroundPersist();

    return { accepted: true, applied };
  }

  /** The season's public arc from the event record (0048) — Vault-free, stores-not-memory. */
  seasonRecap(): SeasonRecapView {
    const events = this.record?.events() ?? [];
    // The structural filter: ceremony beats land as `season:` events; deals/betrayal reveals are
    // their own recorded types. All player-witnessed by construction — this is the public record.
    const highlights = events
      .filter((e) => !e.hidden && (e.id.startsWith("season:") || e.type === "deal" || e.type === "betrayal"))
      .map((e) => e.content);
    return {
      started: this.house !== null,
      finished: !!this.live?.finished,
      winner: this.named(this.live?.winner),
      weeksPlayed: this.week,
      highlights,
      evicted: (this.live?.evictionOrder ?? []).map((id) => ({ id, name: this.nameOf(id) })),
      deals: this.deals.forParty(PLAYER).map((d) => this.dealView(d)),
      ...(this.alliances.forMember(PLAYER).length ? { alliances: this.playerAllianceViews() } : {}),
    };
  }

  /**
   * The Vault unsealing (0048 §1) — the Wall's ONE sanctioned exception, and THE GATE lives here:
   * a live (or unstarted) season returns null, enforced by the terminal state in code, never by
   * prompt. Post-season it returns the real story: every hidden event (off-screen scheming, NPC
   * confessionals, gossip) plus the producer's sealed twists — fired and unfired alike.
   */
  seasonRetrospective(): RetrospectiveView | null {
    if (!this.live?.finished) return null; // the structural gate: no finished season, no unsealing
    return this.buildVaultUnseal();
  }

  /**
   * DEBUG producer's vault — the owner-ruled OVERRIDE of mandate #2 (admin/God Mode is otherwise
   * walled from the Vault). This unseals the LIVE hidden layer for operator debugging WITHOUT the
   * post-season `finished` gate above: the ONE sanctioned LIVE Vault reveal, admin-channel only and
   * fired only behind an explicit FE "unseal" action, so it can never spoil a game by accident. It
   * reuses the retrospective render below, so every row is the same scrubbed, name-resolved plain
   * data (no raw ids/slugs). Returns null only when there is no game at all.
   */
  producerVaultDump(): RetrospectiveView | null {
    if (!this.live) return null;
    return this.buildVaultUnseal();
  }

  /** The shared Vault-unseal render used by BOTH the post-season retrospective and the debug dump. */
  private buildVaultUnseal(): RetrospectiveView {
    if (!this.live) throw new Error("buildVaultUnseal called without a live season");
    const nameOf = (id: EntityId): string => this.nameOf(id);
    const events = this.record?.events() ?? [];
    // #843 — a gossip/surfacing event's CONTENT is an internal breadcrumb (`gossip <pathway> reaches
    // <to>` / `surfaced to <entity> via <pathway>`), not the belief itself. Join each back to the
    // KnowledgeFact it lodged (by `sourceEventId`) so the dump shows the real, name-resolvable
    // paraphrase. Build the index ONCE from every houseguest's known facts (the recipient holds it).
    const beliefByEvent = new Map<string, string>();
    if (this.npcKnowledge && this.house) {
      for (const hg of [this.house.player, ...this.house.npcs]) {
        for (const f of this.npcKnowledge.known(hg.id)) {
          if (f.sourceEventId && !beliefByEvent.has(f.sourceEventId)) beliefByEvent.set(f.sourceEventId, f.content);
        }
      }
    }
    // The FE renders each row as "[type] content", so `type` must be a READABLE label (not a raw kind
    // slug) and `content` clean, name-resolved prose — this is the Wall's ONE sanctioned reveal, shown
    // readably (audit: the live dump leaked "[hidden-thread] story-thread thread:npc:8:0 …").
    const hiddenStory: Array<{ type: string; content: string; ts?: number }> = events
      .filter((e) => e.hidden)
      .map((e) => {
        // For a gossip/surfacing breadcrumb, prefer the joined belief (the concrete paraphrase) over the
        // internal "reaches <to>" plumbing; fall back to the scrubbed breadcrumb if no fact joined (#843).
        const belief = (e.type === "gossip" || e.type === "surfacing") ? beliefByEvent.get(e.id) : undefined;
        // #852 — carry the event's monotonic time marker so the dump can order chronologically.
        return { type: retrospectiveLabel(e.type), content: this.retroScrub(belief ?? e.content), ts: e.ts };
      });
    // The structured hidden layers (threads + seeded relationships) render from the IN-MEMORY objects,
    // not their engine-only Vault audit strings — so every id is a NAME and no machine slug crosses. They
    // are therefore SKIPPED below when iterating the Vault records (rendered here once, readably, instead).
    for (const t of this.storyThreads) {
      // #996 — label by SOURCE CLASS (secret → "Secret thread", weakness → "Blind spot", goal → "Real
      // game"), not a flat "Secret thread", so a houseguest's {secrets + weakness + goal} threads don't all
      // read as stacked contradictory secrets. The class is read off the premise tag; the prose body is
      // already class-naturalized by `storyThreadToRetrospectiveProse`.
      hiddenStory.push({ type: storyThreadLabel(t.premise), content: storyThreadToRetrospectiveProse(t, nameOf) });
    }
    // #847 — the deep profile's secrets / true-goals / weakness are ALSO the source of the secret
    // threads above (each thread is derived from one of them), so re-rendering the deep-profile blob would
    // print the same secret TWICE. The threads are the canonical, live (status-bearing) representation of
    // those three; the deep profile uniquely carries the houseguest's DAY-ONE READ OF THE PLAYER, which no
    // thread carries. So render the deep profile here as exactly that one non-duplicated, labeled line
    // (from the IN-MEMORY structured object, never the raw Vault string) — and skip its Vault record below.
    for (const [id, profile] of Object.entries(this.deepProfiles)) {
      const read = profile.dayOnePerception?.read?.trim();
      if (read) hiddenStory.push({ type: "Hidden side", content: `${nameOf(id)} — day-one read of you: ${read}` });
    }
    for (const tie of this.seededRels.ties) {
      hiddenStory.push({ type: "Hidden tie", content: preGameTieToRetrospectiveProse(tie, nameOf) });
    }
    for (const s of this.seededRels.showmances) {
      hiddenStory.push({ type: "Hidden tie", content: showmanceToRetrospectiveProse(s, nameOf) });
    }
    for (const r of this.record?.hidden() ?? []) {
      // Rendered structurally elsewhere: twists via `twists` below; threads + seeded relationships from
      // the structured objects above (their raw Vault strings carry ids/slugs we must not echo).
      if (r.kind === "reserved-twist" || r.kind === "hidden-thread" || r.kind === "seeded-relationship") continue;
      // #846/#847 — the deep-profile `hidden-attribute` blob is rendered structurally above (its day-one
      // read) and its secrets/goals/weakness live in the threads, so SKIP the raw blob to avoid the
      // semicolon run-on AND the double-printed secret. Other `hidden-attribute` records (e.g. a private
      // orientation) are NOT deep profiles — they keep rendering normally.
      if (r.kind === "hidden-attribute" && /^deep-profile\b/.test(r.content)) continue;
      hiddenStory.push({ type: retrospectiveLabel(r.kind), content: this.retroScrub(r.content) });
    }
    const fired = new Map((this.live.firedTwists ?? []).map((t) => [t.kind as string, t.beat]));
    const twists = (this.live.reserve ?? []).map((t) => ({
      kind: t.kind as string,
      firedWeek: fired.get(t.kind) ?? null,
    }));
    // E12: the weekly secret ballots unseal HERE — and only here, behind the same terminal gate.
    const evictionVotes = (this.live.voteRecord ?? []).map((r) => ({
      week: r.week,
      evictee: { id: r.evictee, name: this.nameOf(r.evictee) },
      votes: Object.entries(r.voteOf).map(([voter, votedFor]) => ({
        voter: { id: voter as EntityId, name: this.nameOf(voter as EntityId) },
        votedFor: { id: votedFor, name: this.nameOf(votedFor) },
      })),
    }));
    // SG7/#1030: the finale jury vote unseals HERE — per-juror attribution, mirroring `evictionVotes`,
    // behind the same terminal gate. Read the already-tallied finale votes off the live state (juror →
    // finalist); never recomputed. Absent until the finale's vote stage has set `finale.votes`.
    const finale = this.live.finale;
    const juryVotes = finale?.votes
      ? {
          finalists: finale.finalists.map((id) => this.named(id)!),
          votes: Object.entries(finale.votes).map(([juror, votedFor]) => ({
            juror: this.named(juror as EntityId)!,
            votedFor: this.named(votedFor as EntityId)!,
          })),
        }
      : undefined;
    // #852 — order the dump CHRONOLOGICALLY. Pre-season setup (threads, seeded ties, the day-one reads,
    // sealed orientations) carries no event time marker, so it sorts FIRST (as setup); the live hidden
    // layer then follows by its monotonic `ts`. A stable sort keeps same-`ts` rows in assembly order.
    // (Week GROUPING is intentionally not attempted: events carry a monotonic tick, not a week number, so
    // reconstructing week boundaries here would be fragile — chronological order is the robust win.)
    const TS_FLOOR = Number.NEGATIVE_INFINITY;
    const ordered = hiddenStory
      .map((row, i) => ({ row, i }))
      .sort((a, b) => (a.row.ts ?? TS_FLOOR) - (b.row.ts ?? TS_FLOOR) || a.i - b.i)
      .map((x) => x.row);
    // #841/#842 — a pure render-time coalesce: drop byte-identical rows and collapse a symmetric
    // off-screen pair (A↔B) into one. After the chronological sort, the kept row is the EARLIEST.
    // Never changes what was recorded — only what the operator sees.
    return {
      winner: this.live.winner ? this.named(this.live.winner) : null,
      hiddenStory: coalesceDumpRows(ordered),
      twists,
      evictionVotes,
      ...(juryVotes ? { juryVotes } : {}),
    };
  }

  /**
   * ADMIN fast-forward to the finale (L38) — the dev-only "finish my season so the post-season
   * retrospective unseals" lever. It DRIVES the existing deterministic loop: it loops `advanceGame`,
   * and whenever the loop stops on a PLAYER pending decision it auto-resolves it with the loop's OWN
   * legal NPC policy (`autoDecision` — the same rulebook the live game already uses, no second one),
   * until a winner is crowned (or the game is already finished). The player can legitimately lose on
   * the way — that is fine, the season still finishes for the rest, and the retrospective opens.
   *
   * VAULT-FREE BY CONSTRUCTION: it reads NO Vault state and returns NO Vault content — only PUBLIC
   * ceremony facts (the crowned winner's NAME, weeks, the player's seat). It does NOT touch
   * `seasonRetrospective`'s gate: that still fires ONLY post-finale through its own code path — this
   * just makes the live season reach the terminal state legitimately. BOUNDED: a hard max-iterations
   * guard means it can never spin forever (a stuck loop returns the unfinished summary, never hangs).
   *
   * Engine-side, ADMIN-channel only (wired through `AdminPort.advanceToFinale`, never the player
   * channel). Each beat still flows through the normal `commit` (consequence fold + persistence),
   * so the finished season is GENUINE — the integrity is preserved absolutely.
   */
  advanceToFinale(): FinaleFastForwardView {
    if (!this.house || !this.live) {
      return { finished: false, winnerName: null, weeks: this.week, playerPlacement: "unknown", started: false };
    }
    // The loop is bounded: a full 16-cast season is well under a few thousand beats+decisions; the
    // cap is generously above that so a legitimately long game still finishes, but a wedged loop
    // (the engine somehow never advancing) can NEVER spin forever — it falls out with the current
    // (unfinished) summary instead of hanging the request.
    const MAX_ITERS = 20_000;
    for (let i = 0; i < MAX_ITERS && !this.live.finished; i++) {
      if (this.live.pending) {
        // Auto-resolve the player's pending with the loop's own legal NPC policy (no second rulebook,
        // B55/D12). `submitDecision` runs the SAME commit path a live decision does (folds + persist).
        const input = autoDecision(this.live, this.ctx(), this.beatRng());
        this.submitDecision(this.fromDecisionInput(input));
      } else {
        this.advanceGame();
      }
    }
    return this.fastForwardSummary();
  }

  /** Map the engine's internal `DecisionInput` (autoDecision's output) back onto the outward
   *  `SubmitDecisionReq` the adapter accepts — so the fast-forward drives the SAME `submitDecision`
   *  path a live player decision does (one decision rulebook; no bypass of validation or the fold). */
  private fromDecisionInput(input: DecisionInput): SubmitDecisionReq {
    switch (input.kind) {
      case "nominations":
        return { kind: "nominations", choice: [...input.choice] };
      case "veto-decision":
        return { kind: "veto-decision", use: input.use, ...(input.save ? { save: input.save } : {}) };
      case "comp-intent":
        return { kind: "comp-intent", intent: input.intent };
      case "comp-round":
        return { kind: "comp-round", intent: input.intent };
      case "houseguests-choice":
        return { kind: "houseguests-choice", vote: input.pick };
      case "replacement":
        return { kind: "replacement", replacement: input.replacement };
      case "eviction-vote":
        return { kind: "eviction-vote", vote: input.vote };
      case "tie-break":
        return { kind: "tie-break", vote: input.evict };
      case "final-eviction":
        return { kind: "final-eviction", vote: input.evict };
      case "goodbye-message":
        return { kind: "goodbye-message", vote: input.tone, ...(input.message ? { statement: input.message } : {}) };
      case "finale-statement":
        return { kind: "finale-statement", statement: input.statement };
      case "finale-answer":
        return { kind: "finale-answer", appeal: input.appeal };
      case "juror-question":
        return { kind: "juror-question", statement: input.question ?? "" };
      case "juror-vote":
        return { kind: "juror-vote", vote: input.vote };
      case "self-evict": // 0061: the auto-driver never produces a self-evict (it's a deliberate quit) — mapped for exhaustiveness.
        return { kind: "self-evict", confirmed: input.confirmed };
    }
  }

  /** The Vault-free fast-forward summary (L38): public ceremony facts ONLY — winner NAME, weeks,
   *  and the player's seat. No hidden state, no soul, no relationship number ever rides out. */
  private fastForwardSummary(): FinaleFastForwardView {
    const finished = !!this.live?.finished;
    const winner = this.live?.winner;
    const finalTwo = this.live?.finalTwo ?? null;
    const me = this.house?.player.id ?? PLAYER;
    let placement: FinaleFastForwardView["playerPlacement"] = "unknown";
    if (finished) {
      if (winner === me) placement = "winner";
      else if (finalTwo && finalTwo.includes(me)) placement = "runner-up";
      else placement = this.playerStatus() === "jury" ? "jury" : "evicted";
    }
    return {
      finished,
      winnerName: winner ? this.nameOf(winner) : null,
      weeks: this.week,
      playerPlacement: placement,
      started: this.house !== null,
    };
  }

  /** The durable session core (0030): the live house + week/phase/ceremony + loop, losslessly. */
  snapshot(): SessionCore {
    return {
      started: this.house !== null,
      // 0065 Part A — persist the monotonic beat counter so the CAS token is restart-safe (co-versioned
      // with the save). Conditional spread keeps a never-bumped (pre-game/legacy) snapshot byte-shaped
      // as before (absent ⇒ 0 on restore), so a pre-0065 save round-trips unchanged.
      ...(this.beatSeq > 0 ? { beatSeq: this.beatSeq } : {}),
      // PERSIST-9 — persist the at-most-once cache (insertion-ordered) so at-most-once survives a
      // restart AND the routine LRU unload/resume cycle. Conditional spread keeps an empty cache
      // (pre-game / no progression yet) byte-shaped as before (absent ⇒ empty on restore).
      ...(this.idempotencyCache.size > 0
        ? { idempotency: [...this.idempotencyCache.entries()] as Array<[string, AdvanceView]> }
        : {}),
      week: this.week,
      phase: this.phase,
      ceremony: { ...this.ceremony, nominees: [...this.ceremony.nominees] },
      // R3 — the house is the per-turn export's dominant cost (each houseguest's append-only
      // `soul.memory` is deep-cloned every turn). `cloneHouse` is byte-identical to `cloneSession`
      // (JSON round-trip) but shares the unchanged souls' clones by reference, so the export re-clones
      // only the souls touched this turn — not the whole, ever-growing history. See `soulCloneCache`.
      house: this.house ? this.cloneHouse(this.house) : null,
      live: this.live ? fastClone(this.live) : null,
      deals: this.deals.serialize(),
      // 0107: persist named alliances so they survive a restart (accumulate, never thin). Engine-only.
      ...(this.alliances.all().length ? { alliances: this.alliances.serialize() } : {}),
      // 0085: persist live campaigns so a multi-week agenda + its history survive a restart (accumulate,
      // never thin). Engine-only hidden strategy — already inside the never-outward snapshot.
      ...(this.campaigns.length ? { campaigns: this.campaigns.map((c) => ({ ...c, owners: [...c.owners], plan: [...c.plan], knownTo: [...c.knownTo] })) } : {}),
      ...(this.drives.size ? { drives: Object.fromEntries([...this.drives].map(([k, v]) => [k, { ...v }])) as Record<EntityId, Drive> } : {}),
      ...(this.campaignTickCount > 0 ? { campaignTickCount: this.campaignTickCount } : {}),
      // 0100 — the DEDICATED jury-house rng tick counter, persisted so the isolated grudge stream stays
      // reproducible across a restart (the accumulated grudge itself rides on `live.juryGrudge`). Absent ⇒
      // 0 on restore (byte-shaped as a pre-0100 save).
      ...(this.juryHouseTickCount > 0 ? { juryHouseTickCount: this.juryHouseTickCount } : {}),
      // 0087: persist the hidden relationship-trajectory momentum + its recent-fold ring buffers, so a
      // multi-week arc RESUMES mid-curdle (0007/0030) and ACCUMULATES, never thins. Vault-class hidden state
      // (no player/admin-visible number) — already inside the never-outward snapshot. Absent ⇒ byte-shaped
      // as a pre-0087 save (resume at steady/0).
      ...(this.trajectories.size ? { trajectories: Object.fromEntries([...this.trajectories].map(([k, v]) => [k, { ...v }])) } : {}),
      ...(this.trajectoryFolds.size ? { trajectoryFolds: Object.fromEntries([...this.trajectoryFolds].map(([k, v]) => [k, v.map((f) => ({ ...f }))])) } : {}),
      ...(this.presence ? { presence: Object.fromEntries(this.presence) as Record<EntityId, Room> } : {}),
      // L21/L24: the calibration-neutral base occupancy the off-screen society pairs on — persisted so the
      // society's positions stay reproducible across a restart and never reseed from the weighted view.
      ...(this.presenceBase ? { presenceBase: Object.fromEntries(this.presenceBase) as Record<EntityId, Room> } : {}),
      ...(this.presenceTenure ? { presenceTenure: Object.fromEntries(this.presenceTenure) as Record<EntityId, number> } : {}),
      // L21/L24: the dedicated movement stream's tick counter — persisted so the personality-weighted
      // movement trajectory stays reproducible across a restart (absent ⇒ 0).
      ...(this.presenceTickCount > 0 ? { presenceTickCount: this.presenceTickCount } : {}),
      // issue #792: the SEATED sub-zones (player-facing view) — persisted tenure-style so drift/cluster
      // history survives a restart (0007, only-forward) and never reseeds from scratch. Absent/empty ⇒
      // omitted (byte-identical to a pre-feature save; the next tick seats fresh). Vault-free position.
      ...(this.presenceZone && this.presenceZone.size > 0
        ? { presenceZone: Object.fromEntries(this.presenceZone) as Record<EntityId, Zone> }
        : {}),
      // 0077: the player's tracked closed-door beliefs — persisted so the privacy payoff accumulates
      // across a restart (0007). Absent/empty ⇒ omitted (byte-identical to a pre-0077 save).
       ...(this.trackedSightings && this.trackedSightings.size > 0
         ? { trackedSightings: Object.fromEntries(this.trackedSightings) as Record<EntityId, TrackedSighting> }
         : {}),
       // 0088: persist per-NPC current-read anchor bonds so drift reads warming/cooling/steady across
       // a restart. Vault-only (derived convenience — never a label, never crossed). Absent ⇒ steady.
       ...(this.readAnchors.size > 0 ? { readAnchors: Object.fromEntries(this.readAnchors) as Record<EntityId, number> } : {}),
       ...(this.gameSeed !== null ? { seed: this.gameSeed } : {}),
      // The producer persona's seed (producer-persona feature) — persisted so the SAME off-camera casting
      // producer is voiced across turns and a restart (it is established pre-game, before any season seed).
      ...(this.producerSeed !== null ? { producerSeed: this.producerSeed } : {}),
      ...(this.portraitStyleAnchor !== null ? { portraitStyleAnchor: this.portraitStyleAnchor } : {}),
      // PREMIERE (feature #380 follow-on): persist who the player has met so a half-done premiere
      // resumes after a restart (0030) — the producer never re-introduces someone or loses track of
      // who's still to meet. Public ids; absent once the premiere is over (the set is then empty).
      ...(this.premiereMet.size > 0 ? { premiereIntros: [...this.premiereMet] } : {}),
      // A1: the DURABLE name-lock companion to `premiereIntros` above — never cleared once the premiere
      // ends, so `recordCastProfile`'s name-race guard survives a restart. Public ids only.
      ...(this.introducedNames.size > 0 ? { introducedNames: [...this.introducedNames] } : {}),
      // 0062 — the FROZEN move-in zeitgeist snapshot persists so it is RECALLED (never re-searched) all
      // season and survives a restart byte-identical (§3/§9). Outward-safe public flavor (§6).
      ...(this.worldSnapshot ? { worldSnapshot: cloneSession(this.worldSnapshot) } : {}),
      // A half-done casting interview is durable state too (0050/0030).
      ...(intakeIsEmpty(this.intake) ? {} : { casting: cloneSession(this.intake) }),
      // 0065 — a pre-warmed (possibly FE-authored) cast is durable pre-game state: persist it so a
      // half-warmed cast resumes after a restart rather than re-warming from scratch. Cleared on adoption.
      ...(this.prewarm ? { prewarm: cloneSession(this.prewarm) } : {}),
      // 0065 (advance-warm) — the durable NEXT-season holding store mirror. Persisted so an advance-warm
      // begun during the finale survives an engine restart and is adopted at the cutover. Engine-only
      // (the snapshot never crosses the wall); cleared once the cutover consumes it.
      ...(this.nextSeasonWarm ? { nextSeasonWarm: cloneSession(this.nextSeasonWarm) } : {}),
      // 0058: the engine-only HIDDEN deep layer — persisted so an ACTIVATED thread stays activated and
      // the Day-1 perception re-seeds identically. ENGINE-ONLY (the snapshot never crosses the wall).
      ...(Object.keys(this.deepProfiles).length ? { deepProfiles: cloneSession(this.deepProfiles) } : {}),
      ...(this.storyThreads.length ? { storyThreads: cloneSession(this.storyThreads) } : {}),
      // 0060 — the scheduler's hidden bookkeeping (nominated-twice ledger + the season surfacing cap),
      // persisted so a driven thread stays driven and the cap is never re-opened by a reload.
      ...(Object.keys(this.nominationWeeks).length ? { nominationWeeks: cloneSession(this.nominationWeeks) } : {}),
      ...(this.surfacedThreadCount > 0 ? { surfacedThreadCount: this.surfacedThreadCount } : {}),
      // 0091 — the per-season trigger-eruption count (the hard cap) + the dedicated trigger-rng tick counter,
      // persisted so the cap is never re-opened by a reload and the dedicated stream stays reproducible
      // (0007/0030). The per-trigger fired/lastFiredWeek flags ride on the byte-stable house above. Absent ⇒
      // 0 (byte-shaped like a pre-0091 save / the layer off).
      ...(this.eruptionCount > 0 ? { eruptionCount: this.eruptionCount } : {}),
      ...(this.triggerTickCount > 0 ? { triggerTickCount: this.triggerTickCount } : {}),
      // 0092 — the secret-pacing drip's hidden weekly bookkeeping (the per-week drip counter + the
      // per-thread last-dripped week), persisted so the CADENCE and the no-re-spam penalty survive a
      // restart — the pace resumes, it never resets (non-degradation, 0007/0030). Each field is gated
      // INDEPENDENTLY on its own non-zero/non-empty value (never on a sibling), so the per-week context
      // is never silently dropped after the count lazily rolls to 0 on a new week. Absent when pacing is
      // off / nothing has dripped ⇒ start fresh (0/empty); the season cap above still binds either way.
      ...(this.pacingDripWeek > 0 ? { pacingDripWeek: this.pacingDripWeek } : {}),
      ...(this.pacingDripCount > 0 ? { pacingDripCount: this.pacingDripCount } : {}),
      ...(this.pacingTickCount > 0 ? { pacingTickCount: this.pacingTickCount } : {}),
      ...(Object.keys(this.pacingLastDrippedWeek).length ? { pacingLastDrippedWeek: cloneSession(this.pacingLastDrippedWeek) } : {}),
      // 0075 — the confidence ledger (what each houseguest has confided + the season lie count),
      // persisted so a restored game remembers exactly what the player was told and never re-opens the
      // lie cap or re-tells a secret at a lower tier (non-degradation, 0007/0030).
      ...(Object.keys(this.confideState).length ? { confideState: cloneSession(this.confideState) } : {}),
      ...(this.lieCount > 0 ? { confideLieCount: this.lieCount } : {}),
      // 0093/0099 — secrets as power: which learned secrets the player has SPENT (`usedAs`) + the per-
      // season expose/trade/bluff counts. Persisted so a restored game remembers a spent secret can't be
      // re-wielded and the season caps don't reopen (non-degradation, 0007/0030). Engine-only.
      ...(Object.keys(this.secretUsedAs).length ? { secretUsedAs: cloneSession(this.secretUsedAs) } : {}),
      ...(this.exposeCount > 0 ? { secretExposeCount: this.exposeCount } : {}),
      ...(this.tradeCount > 0 ? { secretTradeCount: this.tradeCount } : {}),
      ...(this.playerBluffCount > 0 ? { secretPlayerBluffCount: this.playerBluffCount } : {}),
      ...(Object.keys(this.playerBluffBelief).length ? { secretPlayerBluffBelief: cloneSession(this.playerBluffBelief) } : {}),
      ...(this.seededRels.ties.length || this.seededRels.showmances.length
        ? { seededRelationships: cloneSession(this.seededRels) } : {}),
      // 0059 §5 — the tie-surfacing scheduler's hidden bookkeeping: the season player-surface cap counter,
      // the subjects already surfaced to the player (so a tie never re-spends the cap), and the dedicated
      // stream's tick counter. Persisted so a discovered tie stays discovered, the cap is never re-opened
      // by a reload, and the dedicated rng stays reproducible across a restart (non-degradation, 0007).
      ...(this.playerTieSurfaceCount > 0 ? { playerTieSurfaceCount: this.playerTieSurfaceCount } : {}),
      ...(this.surfacedTieSubjects.size > 0 ? { surfacedTieSubjects: [...this.surfacedTieSubjects] } : {}),
      ...(this.tieScheduleTickCount > 0 ? { tieScheduleTickCount: this.tieScheduleTickCount } : {}),
      // 0063: the engine-only HIDDEN private-orientation map — persisted so a closeted houseguest's
      // sealed orientation survives a restart losslessly and never silently resets. ENGINE-ONLY (the
      // snapshot never crosses the wall). The PUBLIC facets ride on the persisted Character (byte-stable).
      ...(Object.keys(this.privateOrientations).length
        ? { privateOrientations: cloneSession(this.privateOrientations) } : {}),
      // 0070 — the additive prose texture layer: persisted so voiced scenes survive a restart
      // byte-identical (0030). Absent when no texture has been written back (pre-0070 saves).
      ...(this.textureOverrides.size > 0
        ? { textureOverrides: Object.fromEntries(this.textureOverrides) } : {}),
    };
  }

  /**
   * R3 — clone the house byte-identically to `cloneSession(house)` while reusing each UNCHANGED soul's
   * append-only array clones (`memory`/`emotionalHistory`) by reference. The per-turn export used to
   * JSON-serialize every houseguest's entire (ever-growing) memory every turn — the O(events) cost
   * behind the late-season latency (audit R3). Per houseguest only the small bounded parts (character +
   * soul scalars) are re-cloned each turn; the two big append-only arrays are re-sliced ONLY when their
   * live source grew (or was rewritten — `replaceMemoryNote` swaps the array ref, invalidating the
   * cache). An unchanged soul (same array ref + length) reuses its prior clone, so the export's
   * per-turn work tracks the souls TOUCHED this turn, not the total accumulated history.
   *
   * Correctness: a cached clone is NEVER mutated in place — a grown source produces a fresh array — so a
   * baseline snapshot still holding the old clone keeps its point-in-time length and the non-degradation
   * checkpoint stays exact (baseline vs candidate counts differ precisely by what grew). Every cloned
   * leaf is an immutable primitive (string/number), so sharing it across snapshots is safe.
   */
  private cloneHouse(house: GameHouse): GameHouse {
    return {
      player: this.cloneHouseguest(house.player),
      npcs: house.npcs.map((n) => this.cloneHouseguest(n)),
    } as GameHouse;
  }

  private cloneHouseguest<T extends GameHouse["player"] | GameHouse["npcs"][number]>(hg: T): T {
    const memSrc = hg.soul.memory;
    const histSrc = hg.soul.emotionalHistory ?? [];
    const cached = this.soulCloneCache.get(hg.id as EntityId);
    // Reuse the prior clone iff the live array is the SAME object at the SAME length (an append grows
    // the length; `replaceMemoryNote` swaps the reference) — otherwise re-slice and re-cache. A slice
    // is a faithful, independent clone of a `string[]`/`number[]` (immutable elements; no deep work).
    const memClone = cached && cached.memSrc === memSrc && cached.memLen === memSrc.length
      ? cached.memClone : memSrc.slice();
    const histClone = cached && cached.histSrc === histSrc && cached.histLen === histSrc.length
      ? cached.histClone : histSrc.slice();
    this.soulCloneCache.set(hg.id as EntityId, {
      memSrc, memLen: memSrc.length, memClone,
      histSrc, histLen: histSrc.length, histClone,
    });
    // Clone the houseguest WITHOUT re-cloning the two big append-only arrays (the whole point — they are
    // handled above). To stay BYTE-identical to `cloneSession(hg)` we must preserve the soul's ORIGINAL
    // key ORDER (JSON.stringify is order-sensitive), so we clone each key in place and merely SUBSTITUTE
    // the (reused-or-fresh) array clone for memory/emotionalHistory at their existing positions — never
    // reorder. `fastClone` handles every other small, bounded field (the static character + soul scalars).
    const soulSrc = hg.soul as unknown as Record<string, unknown>;
    const soul: Record<string, unknown> = {};
    for (const k in soulSrc) {
      if (!Object.prototype.hasOwnProperty.call(soulSrc, k)) continue;
      soul[k] = k === "memory" ? memClone
        : k === "emotionalHistory" ? histClone
        : fastClone(soulSrc[k]);
    }
    const hgSrc = hg as unknown as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k in hgSrc) {
      if (!Object.prototype.hasOwnProperty.call(hgSrc, k)) continue;
      out[k] = k === "soul" ? soul : fastClone(hgSrc[k]);
    }
    return out as unknown as T;
  }

  /** Rebuild the live session from a durable snapshot (0030) — resume instead of reset. */
  restore(core: SessionCore): void {
    // R3 — the live houseguest objects are replaced wholesale below, so the per-soul clone cache (keyed
    // on the OLD array references) must be dropped; a stale clone could otherwise be reused for a new
    // soul that happens to match a length, persisting the wrong history.
    this.soulCloneCache.clear();
    // 0065 Part A — resume the beat counter at the saved value (restart-safe CAS). Absent on a pre-0065
    // save ⇒ 0 (the next commit bumps it).
    this.beatSeq = core.beatSeq ?? 0;
    // PERSIST-9 — RESTORE the at-most-once cache instead of clearing it. An `AdvanceView` is plain JSON
    // (a player-witnessed progression view — no reference to a dead in-memory houseguest object, no Vault
    // content), so it round-trips safely; restoring it keeps at-most-once intact across a restart AND the
    // routine LRU sandbox-unload/resume cycle (both run through here). Before this, the clear defeated the
    // exact retry Part B exists for whenever the retry straddled an unload (a re-applied vote/nomination).
    // Absent (pre-fix / no progression yet) ⇒ empty, byte-identical to the old clear.
    this.idempotencyCache.clear();
    if (Array.isArray(core.idempotency)) {
      for (const entry of core.idempotency) {
        if (Array.isArray(entry) && typeof entry[0] === "string" && entry[1]) {
          this.idempotencyCache.set(entry[0], entry[1] as AdvanceView);
        }
      }
    }
    // 0065 Part E — the delta ring is a process-local read accelerator (not persisted); a resume starts
    // it empty, so the FE's pre-restart token (which also resets across a restart) correctly full-
    // refreshes rather than slicing against a window that no longer holds its checkpoint.
    this.beatCheckpoints.clear();
    this.house = core.house ? cloneSession(core.house) : null;
    this.week = core.week;
    this.phase = core.phase;
    this.ceremony = { ...core.ceremony, nominees: [...core.ceremony.nominees] };
    this.live = core.live ? cloneSession(core.live) : null;
    this.deals.load(core.deals ?? []);
    // 0107: restore named alliances (absent on pre-0107 saves ⇒ none).
    this.alliances.load(core.alliances ?? []);
    // 0085: restore live campaigns (absent on pre-0085 saves ⇒ none).
    this.campaigns = (core.campaigns ?? []).map((c) => ({ ...c, owners: [...c.owners], plan: [...c.plan], knownTo: [...c.knownTo] }));
    this.campaignTickCount = core.campaignTickCount ?? 0;
    // 0100: restore the dedicated jury-house rng tick counter (absent on pre-0100 saves ⇒ 0). The
    // accumulated grudge itself rides on `live.juryGrudge`, restored with the live state above.
    this.juryHouseTickCount = core.juryHouseTickCount ?? 0;
    // 0086: restore live drives (absent on pre-0086 saves ⇒ none ⇒ re-derived on the next campaign tick).
    this.drives = core.drives ? new Map(Object.entries(core.drives) as [EntityId, Drive][]) : new Map();
    // 0087: restore the hidden relationship-trajectory momentum + recent-fold ring buffers (absent on
    // pre-0087 saves ⇒ empty ⇒ every pair resumes at steady/0, byte-identical to a pre-feature load).
    this.trajectories = core.trajectories ? new Map(Object.entries(core.trajectories)) : new Map();
    this.trajectoryFolds = core.trajectoryFolds
      ? new Map(Object.entries(core.trajectoryFolds).map(([k, v]) => [k, v.map((f) => ({ ...f }))]))
      : new Map();
    // Pre-0049 saves carry no presence — migrate forward (the next tick seats everyone afresh).
    this.presence = core.presence ? new Map(Object.entries(core.presence) as [EntityId, Room][]) : null;
    // L21/L24: restore the calibration-neutral base occupancy (absent on pre-L21/L24 saves — the next tick
    // re-seeds it from the weighted positions, which `societyOccupancy` falls back to in the meantime).
    this.presenceBase = core.presenceBase ? new Map(Object.entries(core.presenceBase) as [EntityId, Room][]) : null;
    this.presenceTenure = core.presenceTenure ? new Map(Object.entries(core.presenceTenure) as [EntityId, number][]) : null;
    // L21/L24: restore the dedicated movement stream's tick counter (absent on older saves ⇒ 0).
    this.presenceTickCount = core.presenceTickCount ?? 0;
    // issue #792: restore the SEATED sub-zones (acquired drift/cluster history survives a restart). A
    // pre-feature save carries none ⇒ null ⇒ the next tick seats everyone fresh from `zoneFor`, NO error.
    this.presenceZone = core.presenceZone ? new Map(Object.entries(core.presenceZone) as [EntityId, Zone][]) : null;
    // 0077: restore the player's tracked closed-door beliefs (acquired knowledge survives a restart).
    this.trackedSightings = core.trackedSightings
      ? new Map(Object.entries(core.trackedSightings) as [EntityId, TrackedSighting][])
      : null;
    // 0088: restore per-NPC current-read anchor bonds (absent on pre-0088 saves ⇒ empty ⇒ drift "steady").
    this.readAnchors = core.readAnchors ? new Map(Object.entries(core.readAnchors) as [EntityId, number][]) : new Map();
    this.gameSeed = core.seed ?? null; // pre-B60 saves: fall back to the legacy name-keyed streams
    // The producer persona's seed (producer-persona feature): restore so the SAME off-camera casting
    // producer is voiced after a restart. Persisted on feature+ saves; on a started game that predates
    // it, fall back to the season seed (the producer becomes the season's producer, exactly as at cast
    // time). A fresh pre-interview session restores none and re-mints lazily on first need.
    this.producerSeed = core.producerSeed ?? core.seed ?? null;
    this.producerCache = null; // rebuilt from the (possibly new) seed on next read
    // 0051: restore the per-season portrait style anchor. On a legacy save that predates it, re-seed
    // from the game seed (so the look stays stable for a resumed game), or fall back to the first
    // variant when there's no seed either — either way the season looks like itself.
    this.portraitStyleAnchor = core.portraitStyleAnchor
      ?? (core.house
        ? (core.seed !== undefined
          ? STYLE_ANCHOR_VARIANTS[new SeededRandom(hashSeed(`${core.seed}:portrait-style`)).int(STYLE_ANCHOR_VARIANTS.length)]
          : STYLE_ANCHOR_VARIANTS[0])
        : null);
    this.intake = core.casting ? cloneSession(core.casting) : emptyIntake();
    // 0065 — restore a half-warmed (possibly FE-authored) cast so author/portrait warm resume rather than
    // re-warming from scratch. Engine-only; absent on all prior saves and once the season has started.
    this.prewarm = core.prewarm ? cloneSession(core.prewarm) : null;
    // 0065 (advance-warm) — restore the durable NEXT-season holding store mirror so an advance-warm begun
    // during the finale survives the restart and is still adopted at the cutover. Engine-only; absent on
    // all prior saves and once the cutover consumed it.
    this.nextSeasonWarm = core.nextSeasonWarm ? cloneSession(core.nextSeasonWarm) : null;
    // PREMIERE (feature #380 follow-on): restore who's been met so a half-done premiere resumes (0030).
    // Absent on a pre-feature save OR once the premiere is over ⇒ empty (no one outstanding to re-meet).
    this.premiereMet = new Set(core.premiereIntros ?? []);
    // A1: restore the DURABLE name-lock companion set. Absent on a pre-A1 save ⇒ empty (a save made
    // before this fix simply has no locked names yet; any houseguest introduced from here on locks
    // going forward exactly as a fresh season does — no regression, no false lock on old saves).
    this.introducedNames = new Set(core.introducedNames ?? []);
    // 0062 — restore the FROZEN move-in zeitgeist snapshot (recalled, never re-searched, §9). Persisted on
    // 0062+ saves; on a pre-0062 save WITH a seed, re-derive the deterministic `model-framed` snapshot off
    // the SAME seed hinge (seed-stable & player-independent, so it returns identically). Without a seed
    // (pre-B60 legacy) or a house, it stays absent — the game degrades to C32's per-reference behavior (§8).
    this.worldSnapshot = core.worldSnapshot
      ? cloneSession(core.worldSnapshot)
      : (core.house && core.seed !== undefined
        ? buildWorldSnapshot({ seed: core.seed, capturedFor: "move-in day" })
        : null);
    // 0058: restore the engine-only HIDDEN deep layer (secrets/goals/weakness/perception + thread
    // status). Persisted on 0058+ saves; on a pre-0058 (or twist-less legacy) save it is re-derived
    // deterministically from the seed + cast below — seed-stable & player-independent, so the floor
    // returns identically. The PUBLIC facets ride on the persisted Character (byte-stable), so they
    // are NOT re-derived here; only the hidden half + thread status are rehydrated.
    if (core.deepProfiles || core.storyThreads) {
      this.deepProfiles = core.deepProfiles ? cloneSession(core.deepProfiles) : {};
      this.storyThreads = core.storyThreads ? cloneSession(core.storyThreads) : [];
    } else if (core.house && core.seed !== undefined) {
      const layer = generateCastDeepLayer(core.seed, core.house.npcs);
      this.deepProfiles = layer.hidden;
      this.storyThreads = layer.threads;
    } else {
      this.deepProfiles = {};
      this.storyThreads = [];
    }
    // 0060 §3 back-compat: a thread restored from a pre-0060 save carries no structured `triggerCondition`
    // / `lifecycleWeek` — default them by source class / the live week (idempotent), so the scheduler has
    // a gate and the windows have a base. This is a NON-mutating re-derive (the byte-stable PUBLIC facets
    // are untouched); the hidden thread gains a field that was always implied by its prose trigger.
    for (const t of this.storyThreads) {
      if (t.triggerCondition === undefined) t.triggerCondition = defaultTriggerConditionFor(t);
      if (t.lifecycleWeek === undefined) t.lifecycleWeek = this.week;
    }
    // 0060 — restore the scheduler's hidden bookkeeping (nominated-twice ledger + the season cap). Absent
    // on pre-0060 saves ⇒ start fresh (rebuilt forward; the cap re-baselines to 0 — a benign, never-leaky
    // relaxation on a legacy resume, since pre-0060 saves carried no surfaced threads to over-count).
    this.nominationWeeks = core.nominationWeeks ? cloneSession(core.nominationWeeks) : {};
    this.surfacedThreadCount = core.surfacedThreadCount ?? 0;
    // 0091 — restore the per-season eruption count + dedicated trigger-rng tick counter (absent on pre-0091
    // saves / the layer off ⇒ 0). The per-trigger fired/lastFiredWeek flags are restored with the house above.
    this.eruptionCount = core.eruptionCount ?? 0;
    this.triggerTickCount = core.triggerTickCount ?? 0;
    // 0092 — restore the secret-pacing drip's weekly bookkeeping (absent on pacing-off / pre-0092 saves
    // ⇒ 0/empty, so the pace resumes from a clean slate and nothing re-spams; the season cap above still
    // binds). The pace RESUMES across a restart, it never resets (non-degradation).
    this.pacingDripWeek = core.pacingDripWeek ?? 0;
    this.pacingDripCount = core.pacingDripCount ?? 0;
    this.pacingTickCount = core.pacingTickCount ?? 0;
    this.pacingLastDrippedWeek = core.pacingLastDrippedWeek ? cloneSession(core.pacingLastDrippedWeek) : {};
    // 0075 — restore the confidence ledger (absent on pre-0075 saves ⇒ empty/zero, never re-confides
    // a secret the player already heard, the cap intact).
    this.confideState = core.confideState ? cloneSession(core.confideState) : {};
    this.lieCount = core.confideLieCount ?? 0;
    // 0093/0099 — restore the secrets-as-power ledger (absent on pre-0093 saves ⇒ empty/zero): which
    // secrets the player has spent + the per-season caps, so a spent secret stays spent across a restart.
    this.secretUsedAs = core.secretUsedAs ? cloneSession(core.secretUsedAs) : {};
    this.exposeCount = core.secretExposeCount ?? 0;
    this.tradeCount = core.secretTradeCount ?? 0;
    this.playerBluffCount = core.secretPlayerBluffCount ?? 0;
    this.playerBluffBelief = core.secretPlayerBluffBelief ? cloneSession(core.secretPlayerBluffBelief) : {};
    // 0063 — restore the engine-only HIDDEN private orientations (a closeted orientation must never
    // silently reset) FIRST, so the 0059 showmance re-derive below can read them for its eligibility gate.
    // Persisted on 0063+ saves; on a pre-0063 (or legacy) save with a seed, re-derive deterministically —
    // the diversity layer keys off the cast names + seed, so it returns identically (and the PUBLIC facets
    // already ride on the persisted Character, byte-stable). No re-seal on restore: the Vault already
    // holds the audit copy from cast time (idempotent).
    if (core.privateOrientations) {
      this.privateOrientations = cloneSession(core.privateOrientations);
    } else if (core.house && core.seed !== undefined && !core.house.npcs.some((n) => n.character.ethnicity)) {
      // Only re-derive for a TRULY pre-0063 cast (no ethnicity folded). A 0063 cast with an empty
      // private map simply had everyone publicly out — keep it empty, never invent a secret.
      this.privateOrientations = { ...generateDiversityLayer(core.seed, core.house.npcs).privateOrientations };
    } else {
      this.privateOrientations = {};
    }
    // 0059 — the seeded relationship layer persists explicitly (a showmance STAGE must never silently
    // reset on restore). Absent on pre-0059 saves ⇒ re-seed deterministically off the persisted seed,
    // gated by the 0063 showmance-eligibility predicate (which reads the just-restored identities).
    if (core.seededRelationships) {
      this.seededRels = cloneSession(core.seededRelationships);
    } else if (core.house && core.seed !== undefined) {
      this.seededRels = loadSeededRelationships(
        core.house.npcs, this.tieBudget, this.showmanceBudget,
        new SeededRandom(hashSeed(`${core.seed}:seeded-relationships`)),
        this.showmanceEligiblePredicate(),
      );
    } else {
      this.seededRels = { ties: [], showmances: [] };
    }
    // 0059 §5 — restore the tie-surfacing bookkeeping (absent on pre-§5 saves ⇒ zero/empty: the cap is
    // intact, no tie has surfaced, the dedicated stream restarts at 0). Never silently re-opens the cap.
    this.playerTieSurfaceCount = core.playerTieSurfaceCount ?? 0;
    this.surfacedTieSubjects = new Set(core.surfacedTieSubjects ?? []);
    this.tieScheduleTickCount = core.tieScheduleTickCount ?? 0;
    this.rebuildSoulIndex();
    this.wireDispositions(); // re-derive archetype dispositions from the persisted Character (B55)
    // 0070 — restore the prose texture layer (persisted so voiced scenes survive a restart byte-identical).
    // Absent on pre-0070 saves ⇒ empty (the deterministic template content simply stands, no regression).
    this.textureOverrides = core.textureOverrides ? new Map(Object.entries(core.textureOverrides)) : new Map();
    // lastTickOffscreenIds is TRANSIENT (never persisted) — starts empty on every restore; the FE
    // re-fans-out on the next off-screen tick.
    this.lastTickOffscreenIds = [];
  }

  /**
   * Rebuild the (derived) soul recall index from the persisted arc after a restore (0030/0041). The
   * AUTHORITATIVE arc lives in each houseguest's `soul.memory`/`emotionalHistory` (persisted
   * losslessly with the house); the vector index is re-derived so `recall` keeps working post-restart.
   */
  private rebuildSoulIndex(): void {
    if (!this.house || !this.soul) return;
    for (const hg of [this.house.player, ...this.house.npcs]) {
      for (const note of hg.soul.memory) this.soul.recordToSoul(hg.id, note);
    }
  }

  /** Engine/loop-internal: record the public ceremony facts the status panel projects. */
  updateCeremony(partial: Partial<CeremonyState>): void {
    this.ceremony = { ...this.ceremony, ...partial };
    this.persist();
  }

  private nameOf(id: EntityId): string {
    if (!this.house) return id;
    if (this.house.player.id === id) return this.house.player.name;
    return this.house.npcs.find((n) => n.id === id)?.name ?? id;
  }

  /**
   * PUBLIC roster name → outward name resolver (non-Vault: names are public). Returns undefined
   * for an id NOT on the live roster, so outward prose can fall back rather than echo a raw id.
   * Wired into the player surface (registry) so socialRead names the houseguest instead of "npc:N".
   */
  publicName(id: EntityId): string | undefined {
    if (!this.house) return undefined;
    if (this.house.player.id === id) return this.house.player.name;
    return this.house.npcs.find((n) => n.id === id)?.name;
  }

  /**
   * The PUBLIC house roster (id → public name) — non-Vault: names are public roster facts, nothing
   * else crosses. Wired into the outward `VisibleStateService` (registry) so player-facing event /
   * knowledge content names houseguests instead of echoing raw `npc:N` ids (audit R4-03 / C-01).
   * Empty before the house exists.
   */
  publicRoster(): { id: EntityId; name: string }[] {
    if (!this.house) return [];
    return [
      { id: this.house.player.id, name: this.house.player.name },
      ...this.house.npcs.map((n) => ({ id: n.id, name: n.name })),
    ];
  }

  private card(id?: EntityId): { id: EntityId; name: string } | null {
    return id ? { id, name: this.nameOf(id) } : null;
  }

  gameStatus(): PublicGameStatus {
    return {
      beatSeq: this.beatSeq, // 0065 Part A — the monotonic CAS token; Vault-free
      week: this.week,
      phase: this.phase,
      ...(this.timeOfDayEnabled && this.live?.timeOfDay ? { timeOfDay: this.live.timeOfDay, asleep: this.asleepNpcs() ?? [] } : {}), // ADR 0006: the public day-phase + who's turned in (observable)
      day: dayOfWeek(this.phase), // E58: the canonical beat→day index (hoh=1 … eviction=5), or null off-ladder
      hoh: this.card(this.ceremony.hoh),
      nominees: this.ceremony.nominees.map((id) => ({ id, name: this.nameOf(id) })),
      veto: {
        holder: this.card(this.ceremony.vetoHolder),
        used: this.ceremony.vetoUsed,
        // E35/audit C-03: the drawn six (the witnessed chip draw) — empty before the draw, so the
        // narrator names THESE exact players rather than inventing who competes. Read straight off
        // the live field (persisted, 0030); cleared with the rest of the week's ceremony state.
        players: (this.live?.vetoField ?? []).map((id) => ({ id, name: this.nameOf(id) })),
      },
      // The live pending (Vault-free legal options) so the decision card re-arms from engine truth
      // on reload — not the FE's process-local last-seen cache, which a FE restart wipes.
      pending: this.pendingView(),
      // F3: the same public over-signal + broadcast winner the AdvanceView/SeasonRecap expose, so a
      // status-only client learns the season ended (and who won) without separately hitting /state or
      // /recap — otherwise it hangs on the last ceremony state post-season. Vault-free (public winner).
      finished: !!this.live?.finished,
      winner: this.named(this.live?.winner),
      ...(this.alliances.forMember(PLAYER).length ? { alliances: this.playerAllianceViews() } : {}),
      // 0107 Phase B: alliances an NPC has pitched the player (aware of, not yet in) — accept via joinAlliance.
      ...(this.alliances.pitchesFor(PLAYER).length ? { alliancePitches: this.alliances.pitchesFor(PLAYER).map((a) => this.allianceView(a)) } : {}),
    };
  }

  /** The houseguests still in the game (player + non-evicted NPCs) — the legal references for an
   *  interaction (B39). Empty before a game starts. */
  livingIds(): EntityId[] {
    if (!this.house) return [];
    const evicted = new Set(this.live?.evictionOrder ?? []);
    return [this.house.player.id, ...this.house.npcs.filter((n) => !evicted.has(n.id)).map((n) => n.id)];
  }

  /** The houseguests presence tracks: the living, MINUS an evicted player (the evicted are nowhere). */
  private presenceActive(): EntityId[] {
    const evicted = new Set(this.live?.evictionOrder ?? []);
    return this.livingIds().filter((id) => !evicted.has(id));
  }

  /**
   * The room-assignment deps. `affinity` (allies drift together) + the HOH-room pull are always present;
   * the per-NPC MOVEMENT PERSONALITY (L21/L24) is included ONLY when `weighted` — it reads the static
   * CHARACTER `stats.social` and the dynamic SOUL `volatility` (facts the engine already holds) so a
   * social butterfly roams and seeks company while a low-social/settled one holds a room. The profile
   * NEVER draws rng; it only re-weights the move-gate threshold and the affinity pull (the L21/L24
   * isolation guarantee). No number crosses the Vault Wall — presence reads stay Vault-free.
   *
   * ONLY NPCs are personality-weighted — the PLAYER returns `null` (no profile). The player is a person
   * the engine never relocates (moved only by `movePlayer`), so weighting their movement is meaningless;
   * keeping them un-weighted ALSO makes the player's room identical in the weighted and base views, which
   * keeps the calibration-neutral base fully invariant to the personality constants (the NPCs cluster
   * around the same player room in both).
   */
  private presenceDeps(
    rng: RandomnessSource,
    weighted: boolean,
    sceneRoom?: Room | null,
    // issue #792: SEATED sub-zone output + the prior seating, supplied ONLY on the weighted, player-facing
    // pass (so zone drift/cluster draws ride the DEDICATED movement stream, never the shared spine).
    zonesOut?: Map<EntityId, Zone>,
    previousZones?: ReadonlyMap<EntityId, Zone> | null,
  ): Parameters<typeof assignRooms>[2] {
    const playerId = this.house?.player.id;
    return {
      rng,
      affinity: (a, b) => this.rel.edge(a, b).affinity,
      hoh: this.ceremony.hoh ?? null,
      // issue #792: seat sub-zones on the weighted pass only (calibration-neutral, dedicated stream).
      ...(zonesOut ? { zonesOut, previousZones: previousZones ?? null, zoneSalt: this.gameSeed ?? "" } : {}),
      // 0078: INTENTIONAL movement — supplied on BOTH passes (the base AND the weighted view). Unlike the
      // L21/L24 personality `movement` (calibration-NEUTRAL, weighted-only), intent is DELIBERATELY
      // calibration-load-bearing (owner ruling: location must affect play), so the off-screen society
      // (which pairs on the BASE occupancy) sees the same motivated clustering the player observes. The
      // PLAYER returns null (a person, never engine-driven by an agenda; `movePlayer` owns their moves),
      // which keeps the player's room identical in both views (the base pass pins them either way).
      intent: (id: EntityId) => (id === playerId ? null : this.movementIntentFor(id)),
      ...(weighted
        ? {
            movement: (id: EntityId) => (id === playerId ? null : {
              social: this.statsOf(id).social,
              // A live soul carries the current turbulence; fall back to the settled center (0.5) when
              // there is none (e.g. a standalone adapter without souls) so the term is a no-op there.
              volatility: this.soulObj(id)?.volatility ?? 0.5,
            }),
            // 0076: only the player-facing WEIGHTED pass holds present company in the live scene. The
            // calibration-neutral BASE pass NEVER gets a sceneRoom, so its shared-stream draw count is
            // byte-identical to the pre-0076 build (the juryReach spine is untouched).
            ...(sceneRoom ? { sceneRoom, sceneMoveProb: PRESENCE.companionMoveProb } : {}),
          }
        : {}),
    };
  }

  /**
   * A houseguest's MOTIVATED movement targets this tick (feature 0078) — WHERE their agenda points,
   * read off the directed relationship model (the same Vault-free edges presence already uses; no
   * number crosses the wall, and this draws NO rng). An NPC is drawn toward whoever they have a strong
   * CHARGED tie with — a bond to deepen OR a threat to WORK (any reason to seek them out) — and softly
   * AWAY from a pure danger they have no bond to leverage. Co-presence thus reflects agenda, not luck.
   *
   * The signal is a BOUNDED read of the existing edge signals (no new state): toward-pull rises with
   * `max(bondStrength, threat)` above the neutral baseline; a pull becomes `avoid` only when threat
   * clearly dominates the bond (a houseguest you fear and have nothing to gain from — you keep distance).
   * Returns only the meaningfully-charged others (a small set), so a typical tick steers an NPC toward
   * the one or two houseguests their game actually centers on, leaving the rest to seeded drift.
   */
  private movementIntentFor(id: EntityId): MovementIntent | null {
    if (!this.house) return null;
    const C = RELATIONSHIP_CONSTANTS;
    const neutralBond = (C.baseline.trust + C.baseline.affinity) / 2;
    const pulls: MovementPull[] = [];
    for (const other of this.presenceActive()) {
      if (other === id) continue;
      const e = this.rel.edge(id, other);
      const bond = this.rel.bondStrength(id, other); // trust+affinity, shaded by demonstrated loyalty
      const threat = e.threat;
      // Charge = how far the strongest signal sits above neutral. Bond and threat BOTH pull you toward
      // them (an ally to keep close, a rival to corner). Below-neutral on both ⇒ no agenda (skip).
      const bondCharge = Math.max(0, bond - neutralBond);
      const threatCharge = Math.max(0, threat - C.baseline.threat);
      const charge = Math.max(bondCharge, threatCharge);
      if (charge < MOVEMENT_INTENT.minCharge) continue; // not charged enough to bend movement — let drift rule
      // AVOID only when a real danger clearly outweighs any bond to work — you keep distance from a pure
      // threat, but you still CLOSE on a rival you can scheme against (a charged threat WITH some bond).
      const avoid = threatCharge >= bondCharge * MOVEMENT_INTENT.avoidThreatDominance && bondCharge < MOVEMENT_INTENT.workableBondFloor;
      pulls.push({ target: other, weight: charge, avoid });
    }
    return pulls.length ? pulls : null;
  }

  /**
   * The DEDICATED, isolated movement RNG stream (L21/L24). Forked off the GAME seed + the persisted
   * presence-tick counter, so it is fully reproducible AND completely separate from the orchestrator's
   * shared per-user stream that drives the off-screen society + relationship folds + competitions/votes.
   * Both the base and the personality-weighted assignment draw from THIS stream — never the shared one —
   * so the movement weighting cannot perturb the seeded competition/vote calibration.
   */
  private movementRng(): SeededRandom {
    const root = this.gameSeed ?? this.house?.player.name ?? "season";
    return new SeededRandom(hashSeed(`${root}:presence-move:${this.presenceTickCount}`));
  }

  /**
   * Re-seat the house for a new off-screen tick (0049): every active houseguest stays put or moves
   * to an ADJACENT room, clustered by affinity + personality (L21/L24). The orchestrator calls this
   * once per tick; lingering player turns never move the week — only the rooms.
   *
   * THE CALIBRATION INVARIANT (L21/L24 — the jury-reach root cause). The off-screen society pairs
   * CO-PRESENT NPCs, so its occupancy is calibration-LOAD-BEARING (it feeds relationship folds →
   * nominations/votes downstream). Before this feature, `presenceTick` drew its room rolls straight
   * from the orchestrator's SHARED per-user `rng` — so the move/room draws were part of the calibrated
   * spine, and every later shared-stream consumer (society/gossip/confessional/votes) saw a specific
   * sequence. To stay byte-identical to that spine, the BASE (un-weighted) assignment STILL draws from
   * the SHARED `rng`, with the exact same algorithm and draw count as before — so the shared stream is
   * advanced identically and the seeded competition/vote outcomes are byte-for-byte unchanged. (The
   * prior reverted attempt added EXTRA shared-stream draws for weighting; the first ship of this feature
   * over-corrected and drew NONE from the shared stream — both re-phased the spine and broke juryReach.)
   *
   * TWO assignments:
   *   • the BASE (un-weighted) occupancy — `presenceBase`, what `societyOccupancy()` feeds the society.
   *     Drawn from the SHARED `rng`, un-weighted, identical to the pre-L21/L24 build ⇒ INVARIANT to the
   *     personality constants AND byte-identical to the calibrated spine (proven by `movementStreamIsolation`
   *     + `juryReach`).
   *   • the personality-WEIGHTED occupancy — `presence`, the player-facing positions (`whereabouts`,
   *     witnessing). Drawn from a DEDICATED `movementRng()` stream (never the shared one), so however the
   *     weighting moves the house it cannot perturb calibration. The player never observes the hidden
   *     society's pairing, so one-place-at-a-time still holds for everything the player sees.
   */
  presenceTick(rng?: RandomnessSource): void {
    if (!this.house) return;
    // Advance the dedicated movement stream by one tick FIRST, so the WEIGHTED pass draws a fresh,
    // reproducible sub-stream (and a resumed game continues the deterministic sequence from the counter).
    this.presenceTickCount += 1;
    const me = this.house.player.id;
    const prev = this.presence;
    // The PLAYER's room is authoritative and IDENTICAL in both views — the player is never personality-
    // weighted (only NPCs are); they move only by their own `movePlayer`. So both passes pin the player at
    // the SAME real room; only NPC positions differ between the calibration-neutral base and the weighted view.
    const playerRoom = prev?.get(me) ?? null;
    // The base evolves from its OWN history (so it is INVARIANT to the personality constants — the society's
    // occupancy, and thus the seeded competition/vote outcomes, are byte-identical whether weighting is on
    // or off). Pre-L21/L24 saves have no separate base — seed it from the only positions we have.
    const prevBase = this.presenceBase ?? prev;

    // Compute one assignment for a given weighting. `weighted` ⇒ the DEDICATED movement stream (isolated
    // from calibration); un-weighted ⇒ the caller's SHARED `rng` (the calibrated spine the society reads),
    // falling back to the dedicated stream only when no shared rng is supplied (standalone/test callers).
    // issue #792: the weighted pass seats sub-zones into THIS map (drift reads the prior seating). The base
    // pass passes no `zonesOut` ⇒ seats nothing ⇒ draws nothing extra on the shared stream (calibration-safe).
    const nextZone = new Map<EntityId, Zone>();
    const assign = (previous: Occupancy | null, weighted: boolean): Map<EntityId, Room> => {
      const stream = weighted ? this.movementRng() : (rng ?? this.movementRng());
      // 0076: present company holds the player's live scene — but ONLY in the weighted, player-facing view
      // (the base pass stays calibration-neutral). No scene exists at premiere seating (no player room yet).
      const sceneRoom = weighted ? playerRoom : null;
      const zonesOut = weighted ? nextZone : undefined;
      const prevZones = weighted ? this.presenceZone : null;
      if (!previous) {
        // Premiere seating — the ONE time everyone (the player included) is placed at once.
        return assignRooms(this.presenceActive(), null, this.presenceDeps(stream, weighted, sceneRoom, zonesOut, prevZones));
      }
      // L21/L24: the PLAYER is a person — the engine NEVER auto-relocates them. Pin them (in BOTH views) at
      // their real room; the engine drives only the NPCs around the held player.
      const pinned = playerRoom ? new Map<EntityId, Room>([[me, playerRoom]]) : null;
      return assignRooms(this.presenceActive().filter((id) => id !== me), previous, this.presenceDeps(stream, weighted, sceneRoom, zonesOut, prevZones), pinned);
    };

    // The BASE draws from the SHARED `rng` FIRST — the same single un-weighted `assignRooms` call (same
    // active set, same `prev`, same pinned player) the pre-L21/L24 build made, so the shared stream is
    // advanced byte-identically to the calibrated spine.
    const nextBase = assign(prevBase, false);   // calibration spine — the society's occupancy
    const next = assign(prev, true);            // personality-weighted — the player's positions
    // The player's position is authoritative and identical in both views (never personality-weighted) —
    // force the base to agree with the weighted player room so a player overhear of an off-screen scene
    // reads the player's REAL room, and the two views never disagree about where the player is.
    const realPlayerRoom = next.get(me);
    if (realPlayerRoom) nextBase.set(me, realPlayerRoom);

    // L21/L24: room tenure (player-facing) — a houseguest who held their room this tick keeps
    // accumulating; a mover resets to 0. Grounds scene continuity in `whereabouts`.
    const tenure = new Map<EntityId, number>();
    for (const [id, room] of next) {
      const stayed = prev?.get(id) === room;
      tenure.set(id, stayed ? (this.presenceTenure?.get(id) ?? 0) + 1 : 0);
    }
    // issue #792: commit the freshly-seated sub-zones (player-facing view) BEFORE the tracked-sighting
    // observe loop, so a sighting into a zoned private room (the lounge) records this tick's seated zone.
    // `seatZones` only writes ids in zoned rooms, so a houseguest who left a zoned room simply drops out.
    this.presence = next;
    this.presenceBase = nextBase;
    this.presenceTenure = tenure;
    this.presenceZone = nextZone;
    // 0077: the player TRACKS any houseguest they watched head into a closed room this tick — their
    // origin was in the player's eyeshot. Pure read-side (no rng), so the calibration spine is untouched.
    const meRoom = next.get(me);
    if (prev && meRoom) {
      for (const [id, room] of next) {
        const from = prev.get(id);
        if (from && from !== room) this.observeMoveIntoPrivate(id, from, room, meRoom);
      }
    }
  }

  /**
   * The player DIRECTS their own movement (L21/L24 — the player is a person, not engine-relocated):
   * walk to a room they NAMED. The name is resolved FORGIVINGLY (`resolveRoom`) — case/space/hyphen-
   * insensitive, natural aliases ("living room"/"lounge", "backyard"/"yard", "HOH", "pantry"), and a
   * bare "bedroom" disambiguated to the player's current/adjacent bedroom — so a guessed room never
   * silently no-ops into the narrator's 5-retry "isn't mapping" loop (the real-log bug). Sets the
   * player's room, resets their tenure; the engine holds them there (NPCs drive around them) until the
   * next directed move. For a truly UNKNOWN name it leaves the player put and returns the current
   * whereabouts unchanged (the model knows the valid rooms from the moment prompt, so this is rare).
   * Returns the resulting whereabouts so the caller can voice the move. Vault-free.
   */
  movePlayer(room: string, expectedBeatSeq?: number): WhereaboutsView | null {
    // 0065 Part A — refuse a move computed against a superseded board BEFORE any mutation.
    this.guardBeatSeq(expectedBeatSeq);
    if (!this.house || !this.presence) return null;
    // 0106: during a whole-house event (a comp or a ceremony) the player is gathered with the house — they
    // cannot wander off into a side room until it resolves. Report the gathered scene unchanged (a no-op).
    if (this.houseEventInSession()) return this.whereabouts();
    const me = this.house.player.id;
    const here = this.presence.get(me) ?? null;
    // Forgiving resolution (Vault-free, deterministic): natural names → a canonical room id; the
    // player's current room sharpens an ambiguous "bedroom". An ambiguous result still moves (we take
    // the best-guess first candidate) rather than no-op — never a silent failure into a retry loop.
    const resolved = resolveRoom(room, here);
    const dest =
      resolved.kind === "ok" ? resolved.room
      : resolved.kind === "ambiguous" ? resolved.candidates[0]!
      : null;
    if (dest === null) return this.whereabouts(); // truly unknown — stay put, report where they are
    if (here === dest) return this.whereabouts(); // already there — nothing to move
    this.presence.set(me, dest);
    // L21/L24: the player's position is identical in both views — keep the calibration-neutral base in sync
    // so the society's player-overhears and `whereabouts` always agree about where the player is.
    this.presenceBase?.set(me, dest);
    (this.presenceTenure ??= new Map()).set(me, 0); // a fresh arrival
    this.persist();
    return this.whereabouts();
  }

  /**
   * ADR 0009 — RECORD a narrated houseguest relocation (the "fold" path: the model narrates the open
   * texture of who wanders where; the engine records it so the board agrees with the prose and there
   * is never a visible historic conflict). Mutates ONLY the open, player-facing `presence` map (and
   * that NPC's tenure) — NEVER `presenceBase`, the calibration-neutral baseline that feeds the seeded
   * off-screen society/comp/vote stream — so recording a move is byte-identical for every seeded
   * outcome (ADR 0005 split-authority; mandate #3). Vault-free.
   *
   * LEGAL-MOVES-ONLY (the ADR-0009 D3 contract): the return distinguishes a recorded move from an
   * IMPOSSIBLE claim the surface must instead catch BEFORE emission —
   *   • `moved`   — the houseguest is now in `room`;
   *   • `noop`    — already there (still consistent, nothing to persist);
   *   • `illegal` — an unknown/evicted houseguest, the PLAYER (their own agency is `movePlayer`), or an
   *                 unresolvable / non-walkable room (the diary room is a ceremony beat, never a
   *                 hangout). Never silently mutates on an illegal input.
   */
  recordHouseguestMove(id: EntityId, room: string): HouseguestMoveResult {
    if (!this.house || !this.presence) return { status: "illegal", whereabouts: this.whereabouts() };
    // The player directs their OWN movement (movePlayer); this path records a NARRATED NPC relocation.
    if (id === this.house.player.id) return { status: "illegal", whereabouts: this.whereabouts() };
    // Only an ACTIVE houseguest currently in the live house can be relocated (evicted ⇒ not in presence).
    const here = this.presence.get(id);
    if (here === undefined) return { status: "illegal", whereabouts: this.whereabouts() };
    // Forgiving resolution, then reject the unknown AND the non-walkable so the open occupancy stays
    // coherent (no one "hangs out" in the diary room — assignRooms/WALKABLE_ROOMS exclude it).
    const resolved = resolveRoom(room, here);
    const dest =
      resolved.kind === "ok" ? resolved.room
      : resolved.kind === "ambiguous" ? resolved.candidates[0]!
      : null;
    if (dest === null || !WALKABLE_ROOMS.includes(dest)) return { status: "illegal", whereabouts: this.whereabouts() };
    if (here === dest) return { status: "noop", whereabouts: this.whereabouts() };
    // OPEN set only — `presenceBase` is deliberately NOT touched (calibration neutrality, see above).
    this.presence.set(id, dest);
    (this.presenceTenure ??= new Map()).set(id, 0); // a fresh arrival
    // 0077: a NARRATED relocation the player can see into a closed room is tracked, same as a drift.
    const myRoom = this.presence.get(this.house.player.id);
    if (myRoom) this.observeMoveIntoPrivate(id, here, dest, myRoom);
    this.persist();
    return { status: "moved", whereabouts: this.whereabouts() };
  }

  /**
   * The player-facing occupancy ground truth (engine/registry wiring — never projected raw to the player).
   * Carries the personality-WEIGHTED NPC positions (L21/L24) — what the player observes via `whereabouts`
   * and what witnessing a player scene reads.
   */
  occupancy(): Occupancy | null {
    return this.presence;
  }

  /**
   * The houseguests still AWAKE right now (ADR 0006 — the diegetic bound, the SOCIAL half of the sleep
   * economy). When the clock is running, anyone past their character-driven bedtime has turned in for
   * the night and drops out of the living house; as the night thins the set shrinks toward the player +
   * the night owls. The PLAYER is awake unless THEY chose to turn in (never auto-slept — §Principle 6).
   * Returns `null` when the clock is OFF (or hasn't started) ⇒ "everyone is awake" ⇒ every caller below
   * is the IDENTITY ⇒ byte-identical to the pre-feature model (the seeded juryReach/UAT calibration spine
   * is unmoved). Pure read off the shared phase + the STATIC aptitudes (`bedtimeFor`): draws no rng, and
   * reads no soul/Vault number.
   */
  private awakeNow(): Set<EntityId> | null {
    if (!this.timeOfDayEnabled || !this.live?.timeOfDay || !this.house) return null;
    return new Set(
      awakeSet({
        active: this.presenceActive(),
        hour: this.live.nightDepth ?? WAKE_HOUR, // the clock-HOUR (8..32) — the 24-hour model (#1125)
        player: this.house.player.id,
        playerRetired: this.live.playerRetired ?? false,
        bedtimeOf: (id) => this.effectiveBedDepth(id), // chronotype bedtime HOUR, conflict-drained (0066 Phase-2)
      }),
    );
  }

  /**
   * The subset of `ids` still awake (ADR 0006) — the off-screen society pairs only houseguests who are
   * UP, so the night owls scheme on while the early-to-bed (and a turned-in player) miss it. The
   * orchestrator's off-screen tick routes the living NPCs through here. IDENTITY (a stable-order copy)
   * when the clock is off ⇒ the hidden society + its calibration spine are byte-identical.
   */
  awakeAmong(ids: readonly EntityId[]): EntityId[] {
    const awake = this.awakeNow();
    return awake ? ids.filter((id) => awake.has(id)) : [...ids];
  }

  /**
   * 0066 Phase-2 (Extension 2 — NPC next-day social fatigue): the off-screen fold-magnitude scale (≤1) for
   * a scene's INITIATOR — a tired houseguest sways the house LESS (reduced EFFECTIVENESS, never a
   * personality change; the scene's nature is unchanged). Returns 1 (NO scaling) unless the dedicated
   * social-fatigue flag is on (AND the clock is running) ⇒ the hidden society + its seeded calibration
   * spine are BYTE-IDENTICAL; reduced sway only on that live path, keyed off the same hidden rest deficit
   * the competition fold consumes. Pure — no rng. No number crosses the wall.
   */
  socialFoldScale(id: EntityId): number {
    if (!this.socialFatigueEnabled) return 1; // Extension 2 off ⇒ the off-screen fold is byte-identical
    return socialSwayScale(this.restDeficitOf(id));
  }

  /** The hidden rest deficit (0..1) a houseguest carries TODAY: tonight's immediate deficit (graded by how
   *  late they were up — conflict-drained when Extension 2 is on) plus, ONLY when Extension 3 is on, the
   *  compounding multi-night fatigue meter. 0 when the clock is off ⇒ byte-identical to the calibration
   *  spine. Feeds the comp fold (Phase-1) and the social sway (Extension 2). Pure — no rng. */
  private restDeficitOf(id: EntityId): number {
    if (!this.timeOfDayEnabled || !this.live?.timeOfDay) return 0;
    const immediate = id === PLAYER
      ? playerRestDeficit(this.live)
      : npcRestDeficit(this.live, this.statsOf(id), id, this.effectiveBedDepth(id));
    // Extension 3 (compounding multi-night meter): only ADD the accumulated meter when its own flag is
    // on; off ⇒ just the single-night immediate deficit (byte-identical to the Phase-1 comp term).
    if (!this.multiNightFatigueEnabled) return immediate;
    const fatigue = id === PLAYER ? (this.live.playerFatigue ?? 0) : (this.live.npcFatigue?.[id] ?? 0);
    return combinedRestDeficit(immediate, fatigue);
  }

  /** 0066 Phase-2 (Extension 3): roll every houseguest's multi-night fatigue meter at a genuine NIGHT-END
   *  (the player turned in, or the house ran to the bitter end). EMA: decay the prior, add the night just
   *  ended. Fires once per night. A NO-OP unless Extension 3 is enabled ⇒ the meter stays absent ⇒ 0 ⇒
   *  byte-identical. Pure — no rng. */
  private accrueNightFatigue(): void {
    if (!this.multiNightFatigueEnabled || !this.live || !this.house) return;
    const lastNight = (id: EntityId): number => id === PLAYER
      ? playerRestDeficit(this.live!)
      : npcRestDeficit(this.live!, this.statsOf(id), id, this.effectiveBedDepth(id));
    this.live.playerFatigue = accrueFatigue(this.live.playerFatigue ?? 0, lastNight(PLAYER));
    const next: Record<EntityId, number> = { ...(this.live.npcFatigue ?? {}) };
    for (const n of this.house.npcs) next[n.id] = accrueFatigue(next[n.id] ?? 0, lastNight(n.id));
    this.live.npcFatigue = next;
  }

  /** 0066 Phase-2: an NPC's effective turn-in HOUR tonight = their chronotype bedtime hour, pulled EARLIER
   *  by any conflicts they were in this night (Extension 2 — a fight drains you to bed). Floored at the
   *  early-evening hour. Drives both who is awake late (`awakeNow`) and their next-day sleep deficit,
   *  coherently. With Extension 2 off the conflict tally is never populated, so this is just the base
   *  chronotype bedtime hour ⇒ byte-identical. */
  private effectiveBedDepth(id: EntityId): number {
    const base = bedtimeDepthFor(this.statsOf(id), id); // clock-HOUR (24-hour model)
    const conflicts = this.nightConflicts.get(id) ?? 0;
    return Math.max(BEDTIME_DEPTH_FLOOR, base - CONFLICT_BEDTIME_DRAIN * conflicts);
  }

  /** Clear the per-night conflict tally at the moment the day rolls over (a fresh morning at the 8am wake) —
   *  tonight's fights don't follow anyone into tomorrow. Called right after the clock advances / the player
   *  turns in; a no-op mid-day (still the same night) and harmless at game start (empty). */
  private rollNightConflicts(): void {
    if (this.live?.timeOfDay === DAY_START && (this.live?.nightDepth ?? WAKE_HOUR) === WAKE_HOUR) this.nightConflicts.clear();
  }

  /**
   * The living houseguests who have TURNED IN for the night (ADR 0006) — the complement of the awake set
   * among the NPCs. Vault-free and OBSERVABLE (you'd see who's no longer around / an empty bed); the
   * bedtime DERIVATION stays hidden. `undefined` when the clock is off (dormant) ⇒ the projection omits
   * the field. The player is never listed — their own night is the `turnIn` lever + their rest cue.
   */
  private asleepNpcs(): NamedRef[] | undefined {
    const awake = this.awakeNow();
    if (!awake) return undefined;
    return this.presenceActive()
      .filter((id) => id !== PLAYER && !awake.has(id))
      .map((id) => ({ id, name: this.nameOf(id) }));
  }

  /**
   * The CALIBRATION-NEUTRAL occupancy the OFF-SCREEN SOCIETY pairs on (L21/L24). The society's co-present
   * pairing feeds relationship folds → (downstream) nominations/votes, so it must be INVARIANT to the
   * personality-movement constants — the base assignment is, which keeps the seeded competition/vote
   * outcomes byte-identical whether or not the weighting is enabled. Falls back to the weighted positions
   * for pre-L21/L24 saves (no base yet) or before the first tick.
   */
  societyOccupancy(): Occupancy | null {
    const base = this.presenceBase ?? this.presence;
    if (!base) return base;
    const awake = this.awakeNow();
    if (!awake) return base; // clock off ⇒ identity ⇒ byte-identical society + calibration spine
    // ADR 0006: asleep houseguests have left the floor for the night — drop them so the off-screen
    // society pairs (and overhears) only happen among those still up. A fresh map; `presenceBase` is never mutated.
    const up = new Map<EntityId, Room>();
    for (const [id, room] of base) if (awake.has(id)) up.set(id, room);
    return up;
  }

  /** Drop anyone presence still seats who is no longer active (the just-evicted are nowhere). */
  private prunePresence(): void {
    if (!this.presence) return;
    const active = new Set(this.presenceActive());
    for (const id of [...this.presence.keys()]) if (!active.has(id)) this.presence.delete(id);
    // L21/L24: prune the calibration-neutral base in lockstep so the society never pairs an evictee.
    if (this.presenceBase) for (const id of [...this.presenceBase.keys()]) if (!active.has(id)) this.presenceBase.delete(id);
    if (this.presenceTenure) for (const id of [...this.presenceTenure.keys()]) if (!active.has(id)) this.presenceTenure.delete(id);
    // 0077: forget a tracked sighting once its subject leaves the house (an evictee is nowhere).
    if (this.trackedSightings) for (const id of [...this.trackedSightings.keys()]) if (!active.has(id)) this.trackedSightings.delete(id);
  }

  /**
   * 0106 — is a whole-house EVENT the LIVE, unresolved beat (an EXCLUSIVE set-piece: a competition, or a
   * nomination / veto / eviction ceremony)? True while the event's player decision is pending (or a comp
   * is staging). For a COMPETITION it also returns the eligible competitor FIELD (the outgoing HOH sits
   * out the HOH comp; the veto is the drawn six). A PURE read of the live state — it never mutates the
   * seeded sim, so everything built on it is calibration-identical.
   */
  private houseEventInSession(): { kind: NonNullable<WhereaboutsView["houseEvent"]>["kind"]; field?: EntityId[] } | null {
    const s = this.live;
    if (!s) return null;
    if (s.competition) { // a staged comp is running ⇒ its real field is authoritative
      return { kind: s.competition.comp, field: [...s.competition.field] };
    }
    const p = s.pending;
    if (!p) return null;
    if (p.kind === "comp-intent" || p.kind === "comp-round") { // a comp surfaced but not yet staged
      if (p.comp === "veto-competition") return { kind: "veto-competition", field: s.vetoField ? [...s.vetoField] : [] };
      const finalThree = s.active.length === 3; // Final 3 lifts the outgoing-HOH restriction
      return { kind: "hoh-competition", field: s.active.filter((id) => finalThree || id !== s.outgoingHoh) };
    }
    if (p.kind === "nominations") return { kind: "nominations" };
    if (p.kind === "veto-decision" || p.kind === "replacement" || p.kind === "houseguests-choice") return { kind: "veto-ceremony" };
    if (p.kind === "eviction-vote" || p.kind === "tie-break" || p.kind === "final-eviction") return { kind: "eviction" };
    return null;
  }

  whereabouts(): WhereaboutsView | null {
    if (!this.house || !this.presence) return null;
    const me = this.house.player.id;
    const room = this.presence.get(me);
    if (!room) return null; // the player is nowhere (out of the house)
    // 0106: a whole-house EVENT (a comp or a ceremony) is an EXCLUSIVE set-piece — the whole house is
    // gathered, there are NO side rooms to slip into, and nobody is off scheming. For a comp the field is
    // split into competitors + spectators (the outgoing HOH among the watchers). A purely observational
    // override of the live presence read (it never touches the seeded sim).
    const ev = this.houseEventInSession();
    if (ev) {
      const named = (id: EntityId): NamedRef => ({ id, name: this.nameOf(id) });
      const others = this.livingIds().filter((id) => id !== me);
      const compSplit = ev.field
        ? (() => {
            const field = new Set(ev.field!);
            return {
              competing: others.filter((id) => field.has(id)).map(named),
              spectating: others.filter((id) => !field.has(id)).map(named), // incl. the outgoing HOH
              youAreCompeting: field.has(me),
            };
          })()
        : {};
      return {
        room,
        present: others.map(named),       // the whole house is gathered for the event
        nearby: [],                       // no side rooms during a whole-house event
        turnsHere: this.presenceTenure?.get(me) ?? 0,
        companions: others.map((id) => ({ ...named(id), turnsHere: 0 })),
        tracked: [],
        houseEvent: { kind: ev.kind, ...compSplit },
      };
    }
    // ADR 0006: as the night thins, houseguests who have turned in are no longer "around" — the house
    // empties for the player. `null` when the clock is off ⇒ everyone shows ⇒ byte-identical whereabouts.
    const awake = this.awakeNow();
    const isUp = (id: EntityId): boolean => !awake || awake.has(id);
    const inRoom = (r: Room): NamedRef[] => {
      const out: NamedRef[] = [];
      for (const [id, where] of this.presence!) {
        if (where === r && id !== me && isUp(id)) out.push({ id, name: this.nameOf(id) });
      }
      return out;
    };
    // The player's room + each room they have SIGHTLINE into (0077 Phase 2 — eyeshot, NOT raw
    // adjacency): the open public core sees across itself + into the hallway mouth, but a CLOSED door
    // (a bedroom, the bathroom/lounge, the HOH/storage/diary) is opaque — standing one room over no
    // longer leaks who is behind it. Who is behind a closed door is earned by watching, never ambient.
    const present = inRoom(room);
    // 0077: the TRACKED layer — who the player BELIEVES is behind a closed door (acquired by watching a
    // doorway), with age + a Vault-safe `stale` flag. NEVER the live map — the bedrooms stay blanks in
    // `nearby` (sightline). The player's own sub-zone rides along as flavor ("over by the pool").
    const now = this.trackedNow();
    const tracked = now.map((t) => ({
      id: t.id,
      name: this.nameOf(t.id),
      room: t.sighting.room,
      ...(t.sighting.zone ? { zone: t.sighting.zone } : {}),
      sinceTurns: t.age,
      stale: t.stale,
      pathway: t.sighting.pathway,
      confidence: t.sighting.confidence,
    }));
    // CONSPICUOUSNESS (two alone too long) is DERIVED from the same beliefs — Vault-free who/where/how-long.
    const conspicuous = this.conspicuousFrom(now);
    const myZone = this.seatedZone(me, room);
    return {
      room,
      ...(myZone ? { zone: myZone } : {}),
      present,
      nearby: (HOUSE_SIGHTLINE.get(room) ?? []).map((r) => ({ room: r, present: inRoom(r) })),
      // L21/L24: duration — the player's tenure in this room + each companion's, so the narrator
      // voices continuity (who has lingered with you vs. who just walked in) instead of resetting.
      turnsHere: this.presenceTenure?.get(me) ?? 0,
      companions: present.map((p) => ({ ...p, turnsHere: this.presenceTenure?.get(p.id) ?? 0 })),
      tracked,
      ...(conspicuous.length ? { conspicuous } : {}),
    };
  }

  /** 0077: a houseguest's live sub-zone in a zoned big room (Vault-free flavor); undefined elsewhere. */
  currentZone(id: EntityId): Zone | undefined {
    const r = this.presence?.get(id);
    return r ? this.seatedZone(id, r) : undefined;
  }

  /**
   * issue #792: a houseguest's SEATED sub-zone for the room they are in — the persisted seat from
   * `presenceTick` (enables drift + clustering). Falls back to the deterministic on-read `zoneFor`
   * (the seeding fallback) when no seat exists yet (a pre-feature save before the next tick re-seats, or
   * a read between game-start and the first tick). Validates the seat against the room's zones (a stale
   * cross-room seat ⇒ fall back), so the result is always a valid zone of `room` or undefined (un-zoned).
   */
  private seatedZone(id: EntityId, room: Room): Zone | undefined {
    const seat = this.presenceZone?.get(id);
    if (seat !== undefined && zonesFor(room).includes(seat)) return seat;
    return zoneFor(id, room, this.gameSeed ?? "");
  }

  /**
   * 0077: record a TRACKED sighting when the player WITNESSED `subject` head from `origin` into a closed
   * `dest`. "Witnessed" = the origin was in the player's eyeshot (or was the player's own room) — so a
   * houseguest who slips off down a hallway you can see becomes acquired knowledge, while one who was
   * already out of view does not. Pure, Vault-free, draws NO rng (calibration untouched).
   */
  private observeMoveIntoPrivate(subject: EntityId, origin: Room, dest: Room, playerRoom: Room): void {
    if (subject === this.house?.player.id || !isPrivateRoom(dest)) return;
    if (origin !== playerRoom && !areVisible(playerRoom, origin)) return; // the player didn't see them go
    (this.trackedSightings ??= new Map()).set(subject, {
      room: dest,
      zone: this.seatedZone(subject, dest),
      tick: this.presenceTickCount,
      pathway: `tracked:${subject}:${this.presenceTickCount}`,
      confidence: PRIVACY.trackedConfidence,
    });
  }

  /**
   * 0077: the player's CURRENT tracked beliefs — pruned of decayed (past-horizon) sightings, of subjects
   * no longer in the house, and of any the player has since DISPROVEN by seeing the subject somewhere
   * visible (a correcting pathway). Each carries its age + a `stale` flag derived from AGE ALONE — never
   * the secret live position (reading that would leak that they left). Mutates the persisted map lazily
   * (drops dead beliefs) so it never grows without bound. Vault-free.
   */
  private trackedNow(): Array<{ id: EntityId; sighting: TrackedSighting; age: number; stale: boolean }> {
    if (!this.trackedSightings || !this.presence) return [];
    const me = this.house?.player.id;
    const myRoom = me ? this.presence.get(me) : undefined;
    const out: Array<{ id: EntityId; sighting: TrackedSighting; age: number; stale: boolean }> = [];
    for (const [id, s] of [...this.trackedSightings]) {
      const age = this.presenceTickCount - s.tick;
      if (age > PRIVACY.trackedHorizonTicks || !this.presence.has(id)) { this.trackedSightings.delete(id); continue; }
      // A correcting pathway: the player can now SEE the subject (their room or a sightline-connected
      // room) ⇒ the closed-door belief is resolved by direct observation; drop it.
      const live = this.presence.get(id);
      if (myRoom && live && (live === myRoom || areVisible(myRoom, live))) { this.trackedSightings.delete(id); continue; }
      out.push({ id, sighting: s, age, stale: age >= PRIVACY.staleAfterTicks });
    }
    return out;
  }

  /**
   * 0077 CONSPICUOUSNESS — "two alone too long is a tell." A Vault-free read, DERIVED per call (never
   * stored — ADR 0002, like blocs 0043): a private room the player has tracked EXACTLY `conspicuousPairSize`
   * houseguests into, both sightings aged at least `conspicuousMinTenureTicks`, surfaces as "you saw A and
   * B slip into the lounge a while ago and haven't seen them come out." Names + room + "a while" — NEVER
   * the content of whatever they are doing in there (the scene stays sealed; earshot is rare/partial/muffled).
   */
  conspicuousReads(): string[] {
    return this.conspicuousFrom(this.trackedNow());
  }

  /** Pure conspicuousness derivation over an already-computed tracked-belief list (shared by `whereabouts`). */
  private conspicuousFrom(now: ReturnType<GameSessionAdapter["trackedNow"]>): string[] {
    const byRoom = new Map<Room, EntityId[]>();
    for (const t of now) {
      if (t.age < PRIVACY.conspicuousMinTenureTicks) continue;
      const list = byRoom.get(t.sighting.room) ?? [];
      list.push(t.id);
      byRoom.set(t.sighting.room, list);
    }
    const reads: string[] = [];
    for (const [room, who] of byRoom) {
      if (who.length !== PRIVACY.conspicuousPairSize) continue;
      const names = who.map((id) => this.nameOf(id));
      reads.push(`(You saw ${names.join(" and ")} slip into the ${roomDisplayName(room)} a while ago and haven't seen them come out.)`);
    }
    return reads;
  }

  /**
   * 0077 NPC-side increment — the HOUSE whispers about closed-door pairings. When two NPCs are
   * conspicuously holed up in a private room, a plausibly-positioned third houseguest notices and a
   * Vault-free POSITION suspicion (who/where, never the content) diffuses NPC-to-NPC and can reach the
   * player. Called once per off-screen tick by the orchestrator, AFTER all society/gossip work.
   *
   * CALIBRATION: runs on a DEDICATED rng (off the game seed + presence-tick counter — NEVER the shared
   * society/competition/vote stream the orchestrator passes), and the diffusion takes NO relationship
   * fold (`whisperConspicuousPairings` → `diffuseGossip` without `rel`/`subjects`). So it moves no edge
   * and consumes no shared draw ⇒ the seeded `juryReach` + gradient outcomes are byte-identical with
   * this on or off. Reads the WEIGHTED player-facing occupancy (what the house observably looks like).
   */
  whisperPairings(knowledge: KnowledgeService): void {
    if (!this.house || !this.presence) return;
    const player = this.house.player.id;
    const evicted = new Set(this.live?.evictionOrder ?? []);
    const awake = this.awakeNow();
    const npcs = this.house.npcs
      .map((n) => n.id)
      .filter((id) => !evicted.has(id) && (!awake || awake.has(id)));
    if (npcs.length < 2) return;
    // DEDICATED stream — zero touch to the orchestrator's shared per-user rng (the calibration spine).
    const rng = new SeededRandom(hashSeed(`house-suspicion:${this.gameSeed ?? ""}:${this.presenceTickCount}`));
    whisperConspicuousPairings({
      occupancy: this.presence,
      tenureOf: (id) => this.presenceTenure?.get(id) ?? 0,
      npcs,
      player,
      affinity: (a, b) => this.rel.edge(a, b).affinity,
      nameOf: (id) => this.nameOf(id),
      knowledge,
      rng,
    });
  }

  socialInitiatives(): SocialInitiative[] {
    if (!this.house) return [];
    // E89 (ruling #5): no approach fires before the house has actually started playing —
    // empty until the season's first ceremony beat (the week-1 HOH result) has resolved.
    // Structural engine gate; the FE's started-gate is only the belt.
    if (
      APPROACH_GATE.requireFirstCeremonyBeat &&
      (!this.live || !firstCeremonyBeatResolved(this.live))
    ) {
      return [];
    }
    const player = this.house.player.id;
    // B52/audit D5: an evicted houseguest can't pull you aside — only LIVING NPCs approach.
    const evicted = new Set(this.live?.evictionOrder ?? []);
    const npcIds0 = this.house.npcs.filter((n) => !evicted.has(n.id)).map((n) => n.id);
    // ADR 0006: a houseguest who has turned in for the night won't pull you aside at 3am — only those
    // still up approach. Identity when the clock is off ⇒ byte-identical approach ranking.
    const npcAwake = this.awakeNow();
    const npcIds = npcAwake ? npcIds0.filter((id) => npcAwake.has(id)) : npcIds0;
    // Deterministic per moment (the temperature roll cannot flip a clear relationship gap, 0012),
    // so the same week/phase reproduces the same approaches. The hidden drive NUMBER is NOT
    // surfaced — only the name + the coarse motive category (E60: the fact the GM voices in its
    // own words, never a canned pretext line), so no trust/threat read leaks across the wall.
    const rng = new SeededRandom(hashSeed(`approaches:${this.gameSeed ?? ""}:${this.week}:${this.phase}`));
    return rankApproaches(player, npcIds, this.rel, rng).slice(0, 3).map((a) => ({
      houseguest: { id: a.npc, name: this.nameOf(a.npc) },
      motive: a.motive,
    }));
  }

  /** The player's current public standing — Vault-free (ceremony facts only). */
  private standing(): Standing {
    if (!this.house) return "pre-game";
    const me = this.house.player.id;
    if (this.ceremony.hoh === me) return "hoh";
    if (this.ceremony.nominees.includes(me)) return "nominee";
    if (this.ceremony.vetoHolder === me) return "veto-holder";
    return "houseguest";
  }

  playerTagline(): PlayerTaglineView {
    const standing = this.standing();
    const key = `${this.week}|${this.phase}|${standing}`;
    const cached = this.taglineCache.get(key);
    if (cached !== undefined) return { text: cached };

    // The curated, state-aware line is both the default and the fail-open fallback.
    let text = SNARKY_TAGLINES[standing];
    if (this.narrator) {
      try {
        const line = oneLine(this.narrator.narrate({
          forEntity: this.house?.player.id ?? PLAYER,
          mode: "scene",
          visibleEvents: [],
          knowledge: [],
          systemPrompt: `${TAGLINE_INSTRUCTION} Standing: ${standing}. Week ${this.week}, phase ${this.phase}.`,
        }));
        if (isUsableTagline(line)) text = line; // else fail open to the curated line
      } catch {
        /* narrator error/timeout ⇒ keep the curated themed line (never blank, never blocking) */
      }
    }
    this.taglineCache.set(key, text);
    return { text };
  }

  // ─── PREMIERE meet-everyone (feature #380 follow-on) — NEW BLOCK ─────────────────────────────────
  /**
   * Is the game in the premiere moment (move-in, before the first HOH)? The tracker is meaningful ONLY
   * here — once the first HOH begins (`phase` leaves "premiere") there is nothing left to meet, so the
   * read methods return `null` and the (now-vestigial) set is lazily cleared so it never lingers in the
   * persisted snapshot. Never reads `live`/the advance path — purely the public phase.
   */
  private inPremiere(): boolean {
    return this.house !== null && this.phase === "premiere";
  }

  /** Lazily clear a stale tracker once the premiere is over (keeps the snapshot clean; idempotent). */
  private clearPremiereIfOver(): void {
    if (!this.inPremiere() && this.premiereMet.size > 0) {
      this.premiereMet.clear();
      this.persist();
    }
  }

  /** The OBSERVABLE public read of one active houseguest (PUBLIC facets only — no Vault, no numbers). */
  private firstImpressionOf(n: GameHouse["npcs"][number]): FirstImpressionView {
    // Exactly the Vault-free facets the roster card already exposes (B61/L28/#1140): archetype, strategy
    // style, background, age, presentation, demeanor, genderPresentation. NEVER the soul, hiddenElements,
    // or a number; gender PRESENTATION only (a private orientation stays Vault-sealed).
    return {
      houseguest: { id: n.id, name: n.name },
      met: this.premiereMet.has(n.id),
      ...(n.character.archetype !== undefined ? { archetype: n.character.archetype } : {}),
      ...(n.character.strategyStyle !== undefined ? { strategyStyle: n.character.strategyStyle } : {}),
      ...(n.character.background !== undefined ? { background: n.character.background } : {}),
      ...(n.character.age !== undefined ? { age: n.character.age } : {}),
      ...(n.character.presentation !== undefined ? { presentation: n.character.presentation } : {}),
      ...(n.character.demeanor !== undefined ? { demeanor: n.character.demeanor } : {}),
      ...(n.character.genderPresentation !== undefined ? { genderPresentation: n.character.genderPresentation } : {}),
    };
  }

  /**
   * The premiere's meet-everyone progress (feature #380 follow-on) — the engine-tracked, Vault-free
   * answer to "who's met, who's still to introduce?". Only ACTIVE NPCs count (the cast at move-in);
   * the player is implicitly met (counted in `metCount`/`total`), so `total` is the whole cast. The
   * narrator reads `remaining` to drive the next introduction; `complete` is the structural gate the
   * first HOH waits on. `null` outside the premiere.
   */
  premiereIntros(): PremiereIntrosView | null {
    this.clearPremiereIfOver();
    if (!this.house || !this.inPremiere()) return null;
    const activeNpcs = this.house.npcs.filter((n) => this.seatOf(n.id) === "active");
    const remaining: FirstImpressionView[] = [];
    const met: FirstImpressionView[] = [];
    for (const n of activeNpcs) {
      const fi = this.firstImpressionOf(n);
      (fi.met ? met : remaining).push(fi);
    }
    // +1 on both counts for the player (they ARE met — they're playing). total = the whole cast.
    return {
      complete: remaining.length === 0,
      metCount: met.length + 1,
      total: activeNpcs.length + 1,
      remaining,
      met,
    };
  }

  /**
   * Mark a houseguest as introduced/met during the premiere (feature #380 follow-on). The structural
   * tracker the producer drives so all 15 NPCs are met before the first HOH. Idempotent; a no-op for an
   * unknown houseguest, the player (auto-met), an evicted/departed seat, or once the premiere is over.
   * Persists (durable resume, 0030) and returns the resulting progress (or `null` outside the premiere).
   */
  markHouseguestMet(id: EntityId): PremiereIntrosView | null {
    this.clearPremiereIfOver();
    if (!this.house || !this.inPremiere()) return null;
    // Only a real, active NPC can be "met" — the player is implicitly met; an unknown/departed id is a no-op.
    const isActiveNpc = this.house.npcs.some((n) => n.id === id && this.seatOf(n.id) === "active");
    if (isActiveNpc && !this.premiereMet.has(id)) {
      this.premiereMet.add(id);
      // A1: the DURABLE name-lock companion — never cleared (unlike `premiereMet`). From this moment
      // the player has witnessed this houseguest's name; `recordCastProfile` must never change it.
      this.introducedNames.add(id);
      this.persist();
    }
    return this.premiereIntros();
  }
  // ─────────────────────────────────────────────────────────────────────────────────────────────────

  createCharacter(req: CreateCharacterReq): GameStateView {
    // 0056 — "keep the existing character": on a CONFIRMED restart with `keepCharacter`, capture the
    // prior player's AUTHORED fields HERE (the only point the prior season still exists, before any
    // reset) and fold them under the explicit req. The static CHARACTER is seed-independent, so re-
    // supplying these regenerates the SAME houseguest in the new season; explicit fields still win,
    // so the player may tweak on the way through. No hidden number is read.
    const carried = (this.house && req.confirmRestart && req.keepCharacter) ? this.carryOverFields() : null;
    // NAME-1 (#547): on ANY confirmed restart capture the dead season's cast names so the next season's
    // corpus-sampled cast avoids them (cross-season diversity). This is the only point the prior cast
    // still exists, before the reset; it rides `effReq` through `onRestart` into the fresh sandbox.
    const priorCastNames = (this.house && req.confirmRestart)
      ? this.priorSeasonNames(req.priorCastNames)
      : req.priorCastNames;
    const effReq: CreateCharacterReq = {
      ...(carried ?? {}),
      ...req,
      ...(carried ? { keepCharacter: false } : {}),
      ...(priorCastNames && priorCastNames.length ? { priorCastNames } : {}),
      // 0104 (R4) — signal a SAME-CHARACTER return so the registry folds this user's notoriety into the
      // new cast's day-one reads. Derived from `keepCharacter` here because the line above strips it to
      // false (the fresh session has no prior house to carry from, so the flag would otherwise be lost).
      ...(carried ? { carriesNotoriety: true } : {}),
    };
    // Non-degradation at its single most destructive point (B36/audit A2): an already-started game is
    // NEVER silently wiped. Without an explicit `confirmRestart`, a second createCharacter (a stray GM
    // call, a network caller) is a no-op returning the current state — the prior save is left intact.
    if (this.house) {
      // The no-op returns the PRIOR season's view — but now SIGNALS the refusal (audit R4-05) so the
      // caller can tell "created" from "left untouched". Without it the model read the unchanged view
      // as success and narrated a new season the engine never started.
      if (!req.confirmRestart) return {
        ...this.view(),
        createRefused: this.live?.finished ? "over" : "in-progress",
        createRefusedReason: this.live?.finished
          ? "a season already finished for this player — start a new game from the menu (a confirmed restart) before casting again"
          : "a season is already in progress for this player — it was left untouched; use the menu to restart rather than re-casting",
      };
      // A CONFIRMED restart routes through the ONE sanctioned door (audit E1/D1/R1): the registry's
      // reset delegate — the SAME hinge the admin reset uses — forgets the orchestrator baseline,
      // rotates the dead season's saves, and creates season 2 in a clean sandbox. Without that the
      // fresh week-1 snapshot read as a count regression against the finished season ⇒ a degradation
      // fault on every commit, nothing persisted, and the dead season resurrected on engine restart.
      if (this.onRestart) return this.onRestart({ ...effReq, confirmRestart: false });
      // Standalone (no registry composed — tests/onboarding fixtures): legacy in-place restart.
    }
    // Finalize FROM the interview's incremental intake (0050): everything updateCasting recorded
    // is the base; explicit args override field-by-field. OOBE can arrive half-done or fully done —
    // the one hard requirement is a name from SOMEWHERE.
    const merged = mergeCastingUpdate(this.intake, {
      ...effReq,
      ...(effReq.interviewNotes ? { interviewNotes: effReq.interviewNotes } : {}),
    });
    const playerName = merged.playerName;
    if (!playerName) {
      // Issue #1033 / F-2: the rejection MUST surface a clear reason. The name may have been written
      // under a synonym key (`name`) that the engine now aliases (issue #1033 / F-1) — if it STILL
      // isn't here, the intake genuinely has no name. Name the field explicitly so the GM re-asks and
      // records it with `updateCasting` rather than looping with no diagnosis (the message is the 400
      // body the FE surfaces).
      throw new EngineRefusal(
        "casting cannot finalize: no player name is on file — ask the player their name and record it with updateCasting(playerName) before createCharacter",
      );
    }
    // Completeness backstop (the mobile short-circuit fix, 0050): the forced FE finalize fires
    // `createCharacter("{}")` — empty args that pull the whole identity from a thin, name-only intake
    // (name+photo, no real interview), minting the default-archetype "floater with no stats." Refuse
    // that exact shape (typed) so the interview continues instead of silently minting a floater.
    // The guard fires ONLY when BOTH are true: (a) zero authored substance anywhere in `merged`
    // (cast photo is NOT substance), and (b) the explicit args carried no identity intent of their own
    // (no `playerName`/`seed`/`archetype`). That keeps every direct, intentional creation working — the
    // admin debug door (archetype), tests/fixtures (an explicit name+seed), and a real interview (which
    // arrives with backstory/motivation/persona substance) — and blocks only the empty-args bug path.
    const hasSubstance =
      !!merged.archetype ||
      !!merged.strategyStyle ||
      !!merged.backstory ||
      !!merged.motivation ||
      !!merged.personaArchetype ||
      !!merged.personaStrategyStyle ||
      !!merged.privateStrategy ||
      merged.interviewNotes.length > 0;
    const argsCarriedIdentity =
      !!effReq.playerName || effReq.seed !== undefined || !!effReq.archetype || !!effReq.strategyStyle;
    if (!hasSubstance && !argsCarriedIdentity) {
      return {
        ...this.view(),
        createRefused: "casting-incomplete",
        createRefusedReason:
          "the casting interview needs more than a name before the season can start — capture a backstory, a motivation, and how they'll play (updateCasting) and finalize again",
      };
    }
    // 0065 — ADOPT a pre-warmed cast. If `preSeedCast` already generated (and the FE deeply authored)
    // the cast during the interview, finalize ATOP it: reuse its seed so the warmed cast is the cast that
    // ships, and skip re-seeding the thin floor below. An explicit seed that DIFFERS discards the stale
    // warm (the caller asked for a specific cast); same/absent seed adopts.
    const adopt = this.prewarm && (effReq.seed === undefined || effReq.seed === this.prewarm.seed)
      ? this.prewarm : null;
    // E39/C7/D8: the DEFAULT seed is real entropy, persisted with the snapshot — the same player
    // name must never replay the byte-identical season (incl. its hidden elements and twist
    // schedule: a restarting player would replay secrets they already know). Explicit seeds stay
    // first-class for tests and replays. An adopted warm reuses its already-minted seed.
    const seed = adopt ? adopt.seed : (effReq.seed ?? entropySeed());
    this.gameSeed = seed; // B60/E12: every per-moment rng below keys off the GAME's seed
    // The producer persona (producer-persona feature): keep the producer the player has been interviewing
    // with if one was already established pre-game; otherwise bind it to the season seed so a direct
    // `createCharacter` (no prior interview, e.g. tests) still has a deterministic, reproducible producer.
    // Either way the off-camera producer is NEVER one of the 16 — it is not added to the house below.
    if (this.producerSeed === null) this.producerSeed = seed;
    this.producerCache = null;
    // 0051: draw ONE per-season portrait style anchor, seeded off the game seed — same seed always
    // draws the same anchor, so the house looks like itself across restarts and through the season.
    // (An adopted warm already drew it off the same seed — reuse it so it is byte-identical.)
    this.portraitStyleAnchor = adopt ? adopt.portraitStyleAnchor : STYLE_ANCHOR_VARIANTS[
      new SeededRandom(hashSeed(`${seed}:portrait-style`)).int(STYLE_ANCHOR_VARIANTS.length)
    ];
    // 0062 — capture the move-in zeitgeist snapshot ONCE, here, off the SAME season-seed hinge as the
    // cast, then FREEZE it (§3/§9). This is the deterministic `model-framed` fallback (the no-provider
    // path, §8) — reproducible-by-seed and byte-stable across every turn/restart; the FE may REPLACE it
    // with a real `web_search` capture via `recordWorldSnapshot` (FE-owned provider, like the 0051 image
    // port). It NEVER reaches the deterministic core — pure outward flavor (§6). `capturedFor` is the
    // in-fiction move-in marker; the snapshot freezes the house there for the whole season.
    this.worldSnapshot = buildWorldSnapshot({ seed, capturedFor: "move-in day" });
    const archetype = merged.archetype && isPlausibleArchetype(merged.archetype) ? merged.archetype : undefined;
    const strategyStyle = merged.strategyStyle as StrategyStyle | undefined;
    // Keep the player's RAW typed words as their public persona (narrative/display), even when they
    // don't match a canonical archetype/style — so the game master voices them as they described
    // themselves. The canonical `archetype`/`strategyStyle` above still drive hidden stats (0006).
    // The casting interview (0050) carries both halves: the canonical mapping in
    // `archetype`/`strategyStyle` and the player's OWN words in `personaArchetype`/`personaStrategyStyle`.
    this.house = startNewGame({
      seed, playerName, archetype, strategyStyle,
      ...(merged.personaArchetype ? { personaArchetype: merged.personaArchetype }
        : merged.archetype ? { personaArchetype: merged.archetype } : {}),
      ...(merged.personaStrategyStyle ? { personaStrategyStyle: merged.personaStrategyStyle }
        : merged.strategyStyle ? { personaStrategyStyle: merged.strategyStyle } : {}),
      ...(merged.backstory ? { backstory: merged.backstory } : {}),
      ...(merged.privateStrategy ? { privateStrategy: merged.privateStrategy } : {}),
      ...(merged.motivation ? { motivation: merged.motivation } : {}),
      ...(merged.interviewNotes.length ? { interviewNotes: merged.interviewNotes } : {}),
      // NAME-1 (#547): the corpus-sampled cast avoids prior seasons' names (bounded, fail-soft).
      ...(effReq.priorCastNames && effReq.priorCastNames.length ? { priorCastNames: effReq.priorCastNames } : {}),
    });
    // 0065 — when adopting a pre-warmed cast, keep the freshly-built PLAYER but swap in the warmed NPCs
    // (which carry any FE-authored §3 depth). The warmed NPCs are byte-identical to the floor
    // `startNewGame` just regenerated PLUS the authoring, so the seeded competition/vote calibration is
    // unchanged; only the authored prose/secrets differ. The cast is consumed — clear the holding store.
    if (adopt) this.house = { player: this.house.player, npcs: adopt.npcs };
    this.intake = emptyIntake(); // the interview is over — its material lives on the player now
    this.week = 1;
    this.phase = "premiere";
    // PREMIERE (feature #380 follow-on): start the meet-everyone tracker empty — nobody has been
    // introduced yet. The producer (driven by the premiere moment prompt's who's-left list) walks the
    // player through all 15 NPCs before the first HOH; `premiereMet` records who's been met. Persisted.
    this.premiereMet = new Set();
    // A1: a fresh season starts with no locked names either — the new cast has not been introduced yet.
    this.introducedNames = new Set();
    // Start the incremental weekly loop over the live house (player + NPCs).
    this.live = newLiveSeason([this.house.player.id, ...this.house.npcs.map((n) => n.id)]);
    // 0025/B53 — load + SEAL the reserve twists: seeded, rare, at most one armed week each, only
    // kinds the live loop implements. Engine-only: the schedule rides in the loop state (persisted,
    // 0030) and the registry writes the Vault audit copy. Invisible to player AND admin until fired.
    const reserve = loadReserveTwists(this.twistCount, new SeededRandom(hashSeed(`${seed}:twists`)))
      .filter((t) => IMPLEMENTED_TWISTS.has(t.kind))
      .filter((t, i, all) => all.findIndex((o) => o.fireAtBeat === t.fireAtBeat) === i); // one twist per week
    if (reserve.length > 0) {
      this.live.reserve = reserve;
      this.onSeal?.(reserve);
    }
    if (adopt) {
      // 0065 — adopt the warmed cast's already-sealed layers wholesale (the diversity floor + the §3
      // deep layer + threads were generated and sealed to the Vault at `preSeedCast` time, and the FE
      // may have authored over them). Re-running the seeders here would regenerate the thin floor and
      // CLOBBER the authoring, so they are SKIPPED — the warm is the source of truth from here.
      this.deepProfiles = adopt.deepProfiles;
      this.storyThreads = adopt.storyThreads;
      this.privateOrientations = adopt.privateOrientations;
      this.groundedSkinTones = adopt.groundedSkinTones;
      this.nominationWeeks = {};
      this.surfacedThreadCount = 0;
      this.eruptionCount = 0; // 0091 — a fresh season starts with no eruptions + an unspent cap
      this.triggerTickCount = 0;
      this.confideState = {};
      this.lieCount = 0;
      this.resetSecretPower(); // 0093/0099 — a fresh season has spent no secrets and an unspent cap
      this.resetTieSurfacing(); // 0059 §5 — a fresh season: no tie discovered, the player-surface cap unspent
      this.resetSecretPacing(); // 0092 — a fresh season: the weekly drip cadence + anti-spam start clean
      this.prewarm = null; // consumed
    } else {
      // 0063 — the casting diversity floor: deal the engine-GUARANTEED diversity layer off a DEDICATED
      // isolated sub-stream (never the shared house/competition stream — the #338 RNG-isolation lesson),
      // validate/repair to the four floors (BIPOC / gender balance / age spread / LGBTQ+), fold the PUBLIC
      // facets (ethnicity, gender presentation, an out orientation) onto each byte-stable Character, GROUND
      // physicalCharacteristics.skinTone from the ethnicity, and SEAL each private orientation into the
      // Vault. Done BEFORE seedDeepProfiles so the deep layer's skin-tone reads the grounded ethnicity.
      this.seedDiversity(seed);
      // 0058 — born deep: generate the cast's deterministic DEEP layer (the seeded floor + offline
      // fallback), then SPLIT it across the Vault Wall. The PUBLIC facets (biography + the structured
      // physical characteristics) fold onto each byte-stable Character; the HIDDEN profile + the derived
      // story threads are sealed engine-side (into the Vault + the recall index) via `onSealProfiles`.
      // Done BEFORE seedFirstImpressions so the Day-1 perception can seed the NPC→player edge.
      this.seedDeepProfiles(seed);
      // #1140 — NOW the name-keyed deep layer is fixed off the original names; apply the deferred gender-
      // coherent renames onto the byte-stable Character (no-op when nothing was renamed).
      this.applyDiversityRenames();
      // A stale warm whose seed didn't match an explicit one is discarded (the season is now started).
      this.prewarm = null;
    }
    // #1140 ∩ NAME-1 (#547): cross-season de-collision of the gender-coherent re-pick — run for BOTH the
    // adopt and plain branches with the SAME prior names, so a re-pick never reintroduces a prior-season
    // given name AND the warm-cast/plain-restart casts stay byte-identical (the diversity-layer rename is
    // prior-season-UNAWARE on purpose; this is where cross-season memory is restored). No-op without priors.
    this.decollidePriorNames(seed, effReq.priorCastNames);
    // Seed first impressions so NPC decisions are differentiated from move-in (without this,
    // empty relationships make every HOH nominate the same first-in-roster houseguests). These
    // are starting beliefs; the consequence fold (0023) evolves them as the player acts.
    this.seedFirstImpressions(seed);
    // 0059 — born with a few HIDDEN ties: seed the sparse pre-game ties + showmances (0–2 each, often
    // none), fold their small standing affinity bias on top of the move-in edges, and SEAL them into the
    // Vault (engine-only; invisible to player AND admin — they surface only organically). Done AFTER
    // first impressions so the bias rides the scattered baseline; persisted so a showmance never resets.
    this.seedSeededRelationships(seed);
    this.wireDispositions(); // archetype → disposition (B55): grudges stick, loyalists forgive
    // Move-in (0049): seat everyone somewhere (first assignment may place anyone anywhere). L21/L24:
    // seed BOTH views from the SAME premiere stream — the player-facing WEIGHTED positions (`presence`)
    // and the calibration-neutral BASE the off-screen society pairs on (`presenceBase`). The player's
    // room is forced identical in both (they are never personality-weighted).
    // issue #792: seat the initial sub-zones on the weighted premiere pass (no prior seating ⇒ fresh
    // deterministic seats from `zoneFor`, the seeding fallback); rides the premiere stream, not the spine.
    const premiereZone = new Map<EntityId, Zone>();
    this.presence = assignRooms(
      this.presenceActive(), null,
      this.presenceDeps(new SeededRandom(hashSeed(`${seed}:presence`)), true, null, premiereZone, null),
    );
    this.presenceZone = premiereZone;
    this.presenceBase = assignRooms(
      this.presenceActive(), null,
      this.presenceDeps(new SeededRandom(hashSeed(`${seed}:presence`)), false),
    );
    const meId = this.house!.player.id;
    // Post-0085 diagnostic fix: the player ENTERS into the social heart of the house (the living room),
    // never the seeded dead-end a premiere roll might drop them in (a passive player stranded in the
    // bathroom sees an empty house all season). Override the PLAYER's slot only — no rng draw changes, so
    // the NPC seating + the seeded society/calibration spine are byte-identical. They move by movePlayer next.
    this.presence.set(meId, "living-room");
    const pr = this.presence.get(meId);
    if (pr) this.presenceBase.set(meId, pr);
    this.persist(); // durable save (0030): a started game must survive a restart
    // 0051: attach the season-start portrait prompts — present ONLY on this response (the FE calls
    // the image API once at move-in and stores the results). Built from PUBLIC appearance facets
    // only (id/name/appearance/age/presentation) — never stats, soul, or hidden elements.
    return { ...this.view(), portraitPrompts: this.castPortraitPrompts() };
  }

  /**
   * 0056 — the prior player's AUTHORED, Vault-free fields: everything needed to recreate the SAME
   * static CHARACTER next season. The character is seed-independent (aptitudes = the authored
   * archetype's bias, appearance = hash of the authored name), so re-supplying these regenerates the
   * identical houseguest under a new cast. The dynamic SOUL is deliberately NOT carried — the new
   * season starts at move-in — but the ORIGINAL casting-interview material (motivation + notes) is
   * reconstructed from the seeded Soul memory so the new season's memory re-seeds identically. No
   * hidden number is read or returned.
   */
  private carryOverFields(): CreateCharacterReq {
    const p = this.house!.player;
    // The interview seeded Soul memory as "casting interview — <note>" entries (and one
    // "casting interview — why I came: <motivation>"); reconstruct the original notes, dropping the
    // motivation line (carried separately) and any non-casting memory accrued during the season.
    const PREFIX = "casting interview — ";
    const notes = (p.soul?.memory ?? [])
      .filter((m) => typeof m === "string" && m.startsWith(PREFIX) && !m.startsWith(`${PREFIX}why I came: `))
      .map((m) => m.slice(PREFIX.length));
    return {
      playerName: p.name,
      archetype: p.character.archetype,
      strategyStyle: p.character.strategyStyle,
      ...(p.persona?.archetype ? { personaArchetype: p.persona.archetype } : {}),
      ...(p.persona?.strategyStyle ? { personaStrategyStyle: p.persona.strategyStyle } : {}),
      ...(p.character.background ? { backstory: p.character.background } : {}),
      ...(p.privateStrategy ? { privateStrategy: p.privateStrategy } : {}),
      ...(p.motivation ? { motivation: p.motivation } : {}),
      ...(notes.length ? { interviewNotes: notes } : {}),
    };
  }

  /**
   * NAME-1 (#547) — the names the NEXT season's corpus-sampled cast should AVOID: the dead season's
   * full cast roster (player + NPCs) merged with any names already carried over from earlier seasons
   * (so the exclusion accumulates across a multi-season game). BOUNDED: capped at `MAX_PRIOR_NAMES`
   * (most-recent-wins) so it can never grow unbounded; the engine floor honors it fail-soft (it relaxes
   * the exclusion rather than starving the sampler when the corpus runs short). No hidden state is read.
   */
  private priorSeasonNames(carried?: readonly string[]): string[] {
    const MAX_PRIOR_NAMES = 240; // ~15 seasons of names — generous headroom, still bounded
    const names: string[] = [];
    if (this.house) {
      names.push(this.house.player.name);
      for (const n of this.house.npcs) names.push(n.name);
    }
    if (carried) names.push(...carried);
    // De-dup, keep the MOST RECENT (this season's roster first) within the cap.
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of names) {
      const name = (raw ?? "").trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push(name);
      if (out.length >= MAX_PRIOR_NAMES) break;
    }
    return out;
  }

  /**
   * Build the Vault-free cast portrait prompts (0051) from the PUBLIC house facets — the same
   * fields the visible projection exports on the HouseguestCard. No stats, no soul, no hidden
   * elements ever reach `buildCastPortraitPrompts`.
   */
  private castPortraitPrompts(roster?: GameHouse["npcs"], anchor?: string): PortraitPromptEntry[] {
    // 0065: pre-warm passes the NPC-only roster + the warmed anchor (no player exists yet); the live
    // path defaults to the whole house (player + NPCs). Same builder either way.
    const styleAnchor = anchor ?? this.portraitStyleAnchor;
    const everyone = roster ?? (this.house ? [this.house.player, ...this.house.npcs] : []);
    if (!styleAnchor || everyone.length === 0) return [];
    const publicCast = everyone.map((h) => ({
      id: h.id,
      name: h.name,
      appearance: h.character.appearance,
      age: h.character.age,
      presentation: h.character.presentation,
      // L29: the structured physical facet (0058) AUTHORS the face so it matches the person and never
      // drifts from the narration. PUBLIC by construction; falls back to the prose appearance if unseeded.
      ...(h.character.physicalCharacteristics !== undefined
        ? { physicalCharacteristics: h.character.physicalCharacteristics } : {}),
      // 0063: feed the PUBLIC diversity + personality facets — heritage, presentation, demeanor — so each
      // shot is visibly that unique person. A PRIVATE orientation is NOT a Character field, so it never
      // reaches here (the §5 Vault rule, enforced by construction + the portrait sentinel sweep).
      ...(h.character.ethnicity !== undefined ? { ethnicity: h.character.ethnicity } : {}),
      ...(h.character.genderPresentation !== undefined ? { genderPresentation: h.character.genderPresentation } : {}),
      ...(h.character.demeanor !== undefined ? { demeanor: h.character.demeanor } : {}),
    }));
    return buildCastPortraitPrompts(publicCast, styleAnchor);
  }

  /**
   * 0065 — the Vault-free public roster card for ONE houseguest: exactly the observable facets the
   * visible projection's `house` array ships (id/name/persona/age/presentation/diverse facets/the public
   * biography + physical facet). NO stats, soul, hidden elements, or relationship number. Shared by the
   * live `view()` mapping AND `preSeedCast` (the pre-warm roster) so the FE authors/shoots against the
   * same shape it will see at season start. `status` defaults to ACTIVE (pre-game everyone is in).
   */
  private castCard(n: GameHouse["npcs"][number], status: HouseguestCard["status"] = "active"): HouseguestCard {
    return {
      id: n.id, name: n.name, status,
      archetype: n.character.archetype,
      strategyStyle: n.character.strategyStyle,
      background: n.character.background,
      age: n.character.age,
      presentation: n.character.presentation,
      ...(n.character.vocation !== undefined ? { vocation: n.character.vocation } : {}),
      ...(n.character.hometown !== undefined ? { hometown: n.character.hometown } : {}),
      ...(n.character.demeanor !== undefined ? { demeanor: n.character.demeanor } : {}),
      ...(n.character.biography !== undefined ? { biography: n.character.biography } : {}),
      ...(n.character.physicalCharacteristics !== undefined
        ? { physicalCharacteristics: n.character.physicalCharacteristics }
        : n.character.appearance !== undefined ? { appearance: n.character.appearance } : {}),
      ...(n.character.ethnicity !== undefined ? { ethnicity: n.character.ethnicity } : {}),
      ...(n.character.genderPresentation !== undefined ? { genderPresentation: n.character.genderPresentation } : {}),
      ...(n.character.outOrientation !== undefined ? { outOrientation: n.character.outOrientation } : {}),
      // #1067: PUBLIC, Vault-free provenance — `true` once the FE deep-profile authoring landed for this
      // houseguest, otherwise absent (still on the seeded floor). NOT secret content; lets the FE backfill
      // target the still-floor cards.
      ...(n.character.deepProfileAuthored === true ? { authored: true } : {}),
    } as HouseguestCard;
  }

  /**
   * 0065 — pre-warm the cast. Generate the player-INDEPENDENT cast off the season seed into the
   * `prewarm` holding store BEFORE the interview ends, so the FE can deeply author it
   * (`recordCastProfile` lands on `prewarm` pre-game) and portraits read the FINISHED store. The whole
   * cast is deterministic off the seed (no player field is read), so this is safe the instant a model
   * is selectable. Idempotent (a second call returns the already-warmed cast); durable (0030). The
   * SAME seed is adopted by `createCharacter`, so the warmed cast is the cast that ships. Vault-free out.
   */
  preSeedCast(req: PreSeedCastReq): PreSeedCastView {
    // A season is already running (or crowned): casting is closed — refuse honestly, change nothing.
    if (this.house) {
      return { warmed: false, seed: this.gameSeed ?? 0, house: [], portraitPrompts: [],
        refused: this.live?.finished ? "over" : "in-progress" };
    }
    // Idempotent: a cast is already warmed. Re-warm only if an explicit seed DIFFERS (tests/replays);
    // otherwise return the existing warm so author/portrait warm never restart mid-flight.
    if (this.prewarm && (req.seed === undefined || req.seed === this.prewarm.seed)) {
      return {
        warmed: true, alreadyWarmed: true, seed: this.prewarm.seed,
        house: this.prewarm.npcs.map((n) => this.castCard(n)),
        portraitPrompts: this.castPortraitPrompts(this.prewarm.npcs, this.prewarm.portraitStyleAnchor),
      };
    }
    // Mint + persist the season seed NOW (E39/C7 entropy by default) so the warmed cast is reproducible
    // and `createCharacter` adopts THIS seed. An explicit seed stays first-class (tests/replays).
    const seed = req.seed ?? entropySeed();
    this.gameSeed = seed;
    if (this.producerSeed === null) this.producerSeed = seed; // keep the casting producer stable pre-game
    const portraitStyleAnchor = STYLE_ANCHOR_VARIANTS[
      new SeededRandom(hashSeed(`${seed}:portrait-style`)).int(STYLE_ANCHOR_VARIANTS.length)
    ]!;
    this.portraitStyleAnchor = portraitStyleAnchor;
    // Generate the cast by REUSING the exact live seeding path against a temporary house — so the warmed
    // seeded floor is BYTE-IDENTICAL to what `createCharacter` would produce un-warmed (no golden-test
    // drift). The NPC roster is player-independent: `generateHouse(rng)` runs fully BEFORE `runPlayerOOBE`
    // (which never consumes the rng), so these NPCs equal the ones `createCharacter` regenerates off the
    // same seed. The placeholder player is type-scaffolding ONLY — discarded below; `seedDiversity` /
    // `seedDeepProfiles` touch `npcs` exclusively, never the player.
    const temp = startNewGame({ seed, playerName: PREWARM_PLAYER_NAME });
    const npcs = temp.npcs;
    this.house = { player: temp.player, npcs };
    this.seedDiversity(seed);    // folds public diversity facets + seals private orientations to the Vault
    this.seedDeepProfiles(seed); // folds the §3 deep layer + seals the hidden profile/threads to the Vault
    this.applyDiversityRenames(); // #1140 — apply gender-coherent renames AFTER the name-keyed deep layer
    // Capture the finished cast into the holding store, then RESET back to a clean pre-game state (the
    // cast lives in `prewarm` from here; the live house does not exist until `createCharacter`).
    this.prewarm = {
      seed, npcs,
      deepProfiles: this.deepProfiles,
      storyThreads: this.storyThreads,
      privateOrientations: this.privateOrientations,
      groundedSkinTones: this.groundedSkinTones,
      portraitStyleAnchor,
    };
    this.house = null;
    this.deepProfiles = {};
    this.storyThreads = [];
    this.privateOrientations = {};
    this.groundedSkinTones = {};
    this.nominationWeeks = {};
    this.surfacedThreadCount = 0;
    this.eruptionCount = 0; // 0091 — a fresh season starts with no eruptions + an unspent cap
    this.triggerTickCount = 0;
    this.confideState = {};
    this.lieCount = 0;
    this.resetSecretPower(); // 0093/0099 — a warmed/fresh cast has spent no secrets, the caps unspent
    this.resetTieSurfacing(); // 0059 §5 — a warmed/fresh cast carries no tie-surfacing history
    this.resetSecretPacing(); // 0092 — a warmed/fresh cast carries no secret-pacing drip history
    this.persist(); // a warmed cast is durable pre-game state (0030)
    return {
      warmed: true, seed,
      house: npcs.map((n) => this.castCard(n)),
      portraitPrompts: this.castPortraitPrompts(npcs, portraitStyleAnchor),
    };
  }

  /**
   * 0065 (advance-warm) — pre-warm the NEXT season's cast DURING the current season's finale, into a
   * per-user HOLDING STORE that survives the cutover. `preSeedCast` is refused mid-season (it warms
   * onto THIS adapter, which is discarded at reset); this is its mid-season counterpart.
   *
   * When the registry has wired `onNextSeasonWarm`, the call routes OUT to the registry, which owns the
   * survivor buffer + the scratch generation/authoring. Standalone (no registry — tests/fixtures), this
   * falls back to a detached in-process generation so the seam is fully testable without a registry: a
   * throwaway scratch `GameSessionAdapter` runs the SAME `preSeedCast`/`recordCastProfile` machinery, and
   * its Vault-free view is returned. Either way the ACTIVE season (`this.house`, every projection) is
   * untouched — the warm never reads or writes the live game. Vault-free out.
   */
  preSeedNextSeason(req: PreSeedNextSeasonReq): PreSeedNextSeasonView {
    if (this.onNextSeasonWarm) return this.onNextSeasonWarm(req);
    // Standalone fallback: warm a detached scratch in process (no buffer to survive a reset here — that
    // is the registry's job — but the generation + authoring + Vault-free view are exercised identically).
    const scratch = new GameSessionAdapter();
    return scratch.warmNextSeasonScratch(req);
  }

  /**
   * 0065 (advance-warm) — the scratch-side warm used by the registry's per-user holding-store adapter
   * (and the standalone fallback above). The scratch is a FRESH adapter with no live house, so the
   * existing pre-game machinery applies verbatim: `preSeedCast` generates the player-INDEPENDENT cast
   * off a NEW seed into `this.prewarm`, and an optional `profile` deep-authors ONE houseguest of it via
   * `recordCastProfile` — both landing on the holding store, never on any live season. Returns the same
   * Vault-free roster shape `preSeedCast` does (no secret crosses; the scratch has no Vault hooks wired,
   * so the hidden layer simply rides in `this.prewarm` until the cutover re-seals it into the new sandbox).
   */
  warmNextSeasonScratch(req: PreSeedNextSeasonReq): PreSeedNextSeasonView {
    const warm = this.preSeedCast({ ...(req.seed !== undefined ? { seed: req.seed } : {}) });
    if (!warm.warmed) {
      // A scratch adapter has no live house, so preSeedCast cannot refuse "in-progress"/"over" — this is
      // purely defensive (a future refusal would surface as a Vault-free decline, never a throw).
      return { warmed: false, seed: warm.seed, house: [], portraitPrompts: [], refused: "no-active-season" };
    }
    let authored: RecordCastProfileResult | undefined;
    if (req.profile) authored = this.recordCastProfile(req.profile);
    return {
      warmed: true, seed: warm.seed,
      house: warm.house, portraitPrompts: warm.portraitPrompts,
      ...(warm.alreadyWarmed ? { alreadyWarmed: true } : {}),
      ...(authored ? { authored } : {}),
    };
  }

  /**
   * 0065 (advance-warm) — read the scratch adapter's holding store so the registry can (a) persist it on
   * the LIVE sandbox's snapshot for engine-restart durability and (b) hand it to the fresh sandbox at the
   * cutover. A deep clone (the registry must not alias the scratch's live arrays). Null until a warm runs.
   */
  exportHeldPrewarm(): PrewarmCast | null {
    return this.prewarm ? cloneSession(this.prewarm) : null;
  }

  /**
   * 0065 (advance-warm) — the registry writes the freshly-warmed next-season cast THROUGH the LIVE
   * sandbox so it is DURABLE (persisted in this sandbox's snapshot, surviving an engine restart). A deep
   * clone in; persisted on the next commit. Invisible to active play (no projection reads it). `null`
   * clears the durable mirror (e.g. after the cutover consumed it).
   */
  holdNextSeasonWarm(store: PrewarmCast | null): void {
    this.nextSeasonWarm = store ? cloneSession(store) : null;
  }

  /** 0065 (advance-warm) — the durable next-season warm mirror, deep-cloned out (rehydrates the registry's buffer on resume). Null if none. */
  takeNextSeasonWarm(): PrewarmCast | null {
    return this.nextSeasonWarm ? cloneSession(this.nextSeasonWarm) : null;
  }

  /**
   * 0065 (advance-warm) — inject a held next-season cast onto THIS (fresh, pre-game) sandbox's pre-game
   * store at the cutover, so the immediately-following `createCharacter` ADOPTS it exactly as it adopts a
   * same-session `preSeedCast` warm. Refused if a season is already running here (the cutover always
   * injects into a clean sandbox; this guards the invariant).
   *
   * The held cast was warmed on a DETACHED scratch adapter with NO Vault/soul hooks wired, so its hidden
   * layer was never sealed into a Vault or indexed for recall. The same-session `preSeedCast` warm seals
   * at warm time (this sandbox's hooks fire), and `createCharacter`'s adopt branch relies on that. So on a
   * cross-sandbox advance-warm we re-create that precondition HERE: seal the held hidden layer into THIS
   * fresh sandbox's Vault + re-index each NPC's deep-profile/orientation note into its soul recall — so
   * the 0048 retrospective unsealing + full-fidelity recall behave byte-identically to a same-session warm.
   */
  adoptHeldPrewarm(store: PrewarmCast): boolean {
    if (this.house) return false; // never overwrite a live season's cast
    const held = cloneSession(store);
    this.prewarm = held;
    // Seal the held hidden layer into THIS sandbox's Vault (engine-only audit copy) — the scratch sealed
    // nowhere. Idempotent into a fresh, empty Vault; mirrors what seedDeepProfiles/seedDiversity seal.
    this.onSealProfiles?.(
      Object.entries(held.deepProfiles).map(([id, profile]) => ({ id: id as EntityId, profile })),
      held.storyThreads,
    );
    const orientations = Object.entries(held.privateOrientations)
      .map(([id, orientation]) => ({ id: id as EntityId, orientation }));
    if (orientations.length) this.onSealPrivateOrientations?.(orientations);
    // Re-index each NPC's hidden notes into THIS sandbox's soul recall index (the scratch's soul.memory
    // arrays rode in on the cloned NPCs, but were indexed in the scratch's soul store, not here). The
    // notes are already PRESENT in each NPC's soul.memory; this only (re)indexes them for semantic recall.
    for (const n of held.npcs) {
      const profile = held.deepProfiles[n.id];
      if (profile) this.soul?.recordToSoul(n.id, deepProfileToVaultContent(n.id, profile));
      const orientation = held.privateOrientations[n.id];
      if (orientation) this.soul?.recordToSoul(n.id, privateOrientationToVaultContent(n.id, orientation));
    }
    return true;
  }

  /**
   * Record casting-interview answers as they land (0050). Any subset of fields, any number of
   * times pre-game; notes append, scalars overwrite. Persisted on every update so a half-done
   * interview survives a restart (0030). Once a season is running this is a no-op that returns
   * the (complete) status — a stray call can never disturb a live game.
   */
  updateCasting(req: UpdateCastingReq): CastingStatusView {
    // Season already running: casting is CLOSED. Refuse HONESTLY (audit R4-05) instead of the old
    // fake `ready:true` that recorded nothing yet looked like success — that silent success let the
    // model narrate a fresh casting interview post-season while the engine never started one. The
    // refusal names whether a season is live (`in-progress`) or already crowned (`over`).
    if (this.house) {
      return { known: {}, missing: [], next: null, ready: false, finalizable: false, refused: this.live?.finished ? "over" : "in-progress" };
    }
    const before = this.intake;
    // C8: which already-captured scalars this update replaces — computed against the PRIOR intake,
    // surfaced so the producer confirms the change rather than silently clobbering an answer.
    const overwrote = overwrittenScalars(before, req);
    // R4-01: keys that are NOT casting fields (a recording filed under `name`/`notes`/a typo would
    // otherwise vanish). Echo them so the producer re-files rather than stalling on a lost answer.
    const ignoredKeys = ignoredCastingKeys(req);
    this.intake = mergeCastingUpdate(this.intake, req);
    if (JSON.stringify(before) !== JSON.stringify(this.intake)) {
      this.persist(); // a half-done interview is durable state (0030)
    }
    const status = castingStatusOf(this.intake, overwrote);
    if (ignoredKeys.length > 0) status.ignoredKeys = ignoredKeys;
    return status;
  }

  /**
   * Realistic move-in reads (B55/audit C5+C6). Day one nobody KNOWS anyone: signals start near the
   * relationship BASELINE with a small seeded scatter (not uniform noise), the threat read leans on
   * the target's PUBLIC archetype menace (a comp-beast looks dangerous across the kitchen counter —
   * never their hidden numbers), and confidence sits BELOW the knowledge threshold, so every
   * day-one read is a HUNCH the season then firms or breaks. Deterministic per game.
   */
  private seedFirstImpressions(seed: number): void {
    const all = this.house ? [this.house.player, ...this.house.npcs] : [];
    const rng = new SeededRandom(hashSeed(`${seed}:relationships`));
    const { baseline, MOVE_IN } = RELATIONSHIP_CONSTANTS;
    const scatter = (): number => (rng.next() - 0.5) * 2 * MOVE_IN.spread;
    for (const a of all) for (const b of all) {
      if (a.id === b.id) continue;
      const e = this.rel.edge(a.id, b.id);
      e.trust = clamp01(baseline.trust + scatter());
      e.affinity = clamp01(baseline.affinity + scatter());
      e.threat = clamp01(baseline.threat + MOVE_IN.threatWeight * archetypeMenace(b.character.archetype) + scatter());
      e.confidence = MOVE_IN.confidence;
    }
    // 0058 §3: the AUTHORED Day-1 perception seeds the NPC→player edge — each NPC walks in already
    // reading the player as something (warm ally / undecided / threat), not from a blank slate. The
    // signed leans nudge the (already-scattered) move-in edge; the player NEVER sees a number — only
    // the later behavior. Hidden by construction (the leans live in the Vault-only deep profile).
    for (const n of this.house?.npcs ?? []) {
      const p = this.deepProfiles[n.id]?.dayOnePerception;
      if (!p) continue;
      const e = this.rel.edge(n.id, PLAYER);
      e.trust = clamp01(e.trust + MOVE_IN.spread * p.trustLean);
      e.affinity = clamp01(e.affinity + MOVE_IN.spread * p.affinityLean);
      e.threat = clamp01(e.threat + MOVE_IN.spread * p.threatLean);
    }
    // 0104 — a reputation that PRECEDES the player into a NEW cast. ONLY when the player returned as
    // the SAME character (the diegetic opt-in, R4) is `this.notoriety` set; otherwise this whole block
    // is skipped and the move-in edges are BYTE-IDENTICAL (the calibration-neutrality guarantee). The
    // bias rides a DEDICATED `:notoriety` sub-rng forked off the seed — NEVER the shared `:relationships`
    // stream above — so even with a notoriety folded, the move-in SCATTER of every edge is unchanged
    // (the only edges that move are the NPC→player ones, and only their direction tilts). Each NPC draws
    // ONE recognition level (R2: not everyone has heard about the player; some hold a distorted version),
    // then the bounded, archetype-shaded, signed direction nudges the NPC→player edge INSIDE the existing
    // `MOVE_IN.spread` envelope — never a number to the player, never a comp/vote roll, never the player's
    // OWN edges. The engine still owns every outcome magnitude (mandate #3). Folded once, here.
    if (this.notoriety) {
      const nrng = new SeededRandom(hashSeed(`${seed}:notoriety`));
      for (const n of this.house?.npcs ?? []) {
        const archetype = n.character.archetype;
        const recognition = recognitionFor(nrng); // ONE per-NPC awareness, applied across all signals
        const e = this.rel.edge(n.id, PLAYER);
        e.trust = clamp01(e.trust + MOVE_IN.spread * notorietyBias(this.notoriety, archetype, "trust", recognition));
        e.affinity = clamp01(e.affinity + MOVE_IN.spread * notorietyBias(this.notoriety, archetype, "affinity", recognition));
        e.threat = clamp01(e.threat + MOVE_IN.spread * notorietyBias(this.notoriety, archetype, "threat", recognition));
      }
    }
  }

  /**
   * 0058 — born deep. Generate the cast's DETERMINISTIC deep layer (the seeded floor + offline
   * fallback the live LLM author is validated against, ledger L28b) and SPLIT it across the Vault:
   *   • PUBLIC facets (biography + the structured physical characteristics) fold onto each byte-stable
   *     Character — they cross to the player and are guarded byte-stable (0007/0031);
   *   • the HIDDEN profile (2–3 secrets, true goals, weakness, Day-1 perception) + the derived story
   *     threads are kept ENGINE-ONLY here and sealed into the Vault + the recall index via the hook.
   * Deterministic per seed and player-INDEPENDENT (the layer keys off the cast's seeded names, never
   * the player's profile — same seed ⇒ same deep cast regardless of who the player is, L28).
   */
  /**
   * 0063 — the casting diversity floor. Deal the engine-GUARANTEED diversity layer off a DEDICATED
   * isolated sub-stream (forked off the seed via `hashSeed` inside `generateDiversityLayer` — NEVER the
   * shared house/competition/vote stream, the #338 RNG-isolation lesson), validate/repair to the four
   * floors, SPLIT across the Vault:
   *   • PUBLIC facets (ethnicity, gender presentation, an OUT orientation) fold onto each byte-stable
   *     Character — they cross to the player and are superset-guarded (0007/0031); the ethnicity ALSO
   *     grounds `physicalCharacteristics.skinTone` (applied in seedDeepProfiles, which runs next), so the
   *     text and the portrait agree;
   *   • each PRIVATE orientation (closeted / not-yet-out) is kept engine-only here and sealed into the
   *     Vault — it surfaces to the player ONLY via a 0002 pathway, never on any projection.
   * Deterministic per seed and player-INDEPENDENT (the sub-stream keys off the seeded cast names). The
   * diversity attributes are DESCRIPTIVE ONLY — never a competition/vote/outcome input.
   */
  private seedDiversity(seed: number): void {
    if (!this.house) return;
    // TEST SEAM (the #338 RNG-isolation golden test): `ORWELL_DISABLE_DIVERSITY=1` skips the entire
    // diversity layer. Because the layer runs on a DEDICATED sub-stream and folds ONLY descriptive
    // fields (never a competition/vote input), the public OUTCOME stream must be byte-identical with it
    // on vs. off — the golden test proves exactly that. Never set in production (the deploy default is on).
    if (process.env.ORWELL_DISABLE_DIVERSITY === "1") return;
    const layer = generateDiversityLayer(seed, this.house.npcs);
    // PUBLIC fold — onto the static Character (byte-stable from here on; superset-guarded).
    this.pendingRenames = {};
    for (const n of this.house.npcs) {
      const pub = layer.public[n.id];
      if (!pub) continue;
      n.character.ethnicity = pub.ethnicity;
      n.character.genderPresentation = pub.genderPresentation;
      if (pub.outOrientation !== undefined) n.character.outOrientation = pub.outOrientation;
      // The age-spread floor may have repaired the age into a short band (descriptive only — age is NOT a
      // competition/vote input, so this never perturbs the seeded outcome stream). Write it back so the
      // card, the ageLook (0058), and the portrait all agree with the guaranteed spread.
      n.character.age = pub.age;
      this.groundedSkinTones[n.id] = pub.skinTone;
      // If the structured physical facet already exists (e.g. on a re-run path), ground its skin tone
      // now; otherwise seedDeepProfiles applies the grounding when it builds the facet.
      if (n.character.physicalCharacteristics) n.character.physicalCharacteristics.skinTone = pub.skinTone;
      // #1140 — STASH the re-picked name (when the layer changed it to match the final gender presentation);
      // DON'T write it to the Character yet — applyDiversityRenames does that AFTER seedDeepProfiles so the
      // name-keyed deep layer (and the outcome stream it feeds) stays byte-identical. (See pendingRenames.)
      if (pub.name !== undefined) this.pendingRenames[n.id] = pub.name;
    }
    // HIDDEN — engine-only, sealed off the player AND admin (a private orientation is a secret).
    this.privateOrientations = { ...layer.privateOrientations };
    // Full-fidelity recall + persistence (L27b): record each private orientation into the NPC's
    // AUTHORITATIVE soul memory (engine-only — never crosses) so it persists losslessly with the house,
    // counts toward non-degradation (0007), and re-indexes on restore. Also index NOW for same-session.
    for (const [id, orientation] of Object.entries(layer.privateOrientations)) {
      const note = privateOrientationToVaultContent(id as EntityId, orientation);
      const n = this.house.npcs.find((x) => x.id === id);
      n?.soul.memory.push(note);
      this.soul?.recordToSoul(id as EntityId, note);
    }
    // Seal the private orientations into the Vault (engine-only audit copy, the §5 wall).
    const entries = Object.entries(layer.privateOrientations).map(([id, orientation]) => ({ id: id as EntityId, orientation }));
    if (entries.length) this.onSealPrivateOrientations?.(entries);
  }

  /**
   * #1140 — apply the deferred diversity RENAMES onto the byte-stable Character. Called AFTER
   * `seedDeepProfiles` so the name-keyed deep layer was seeded off the ORIGINAL drawn names (keeping the
   * deep profile / Day-1 perception / story threads — and the seeded outcome stream they feed —
   * byte-identical with the rename on vs. off). From here the renamed name is the houseguest's stable
   * public name. A no-op when no draft was renamed (the common case). Mirrors at both seed sites.
   */
  private applyDiversityRenames(): void {
    if (!this.house) return;
    for (const n of this.house.npcs) {
      const renamed = this.pendingRenames[n.id];
      // The display name lives on the Houseguest wrapper (`n.name`), not on the static Character.
      if (renamed) n.name = renamed;
    }
    this.pendingRenames = {};
  }

  /**
   * #1140 ∩ NAME-1 (#547) — cross-season de-collision of the gender-coherent re-pick. The diversity rename
   * (step 7.5 in `diversity.ts`) keeps given names unique WITHIN the cast but is prior-season-UNAWARE (so the
   * advance-warm and plain-restart paths, which adopt vs. re-seed, stay byte-identical there). This pass —
   * run in `createCharacter` for BOTH paths AFTER the cast is finalized, with the SAME `priorCastNames` — is
   * where cross-season memory is restored: any houseguest whose GIVEN name collides with a prior-season name
   * is re-picked to a SAME-GENDER name that avoids both the prior-season set AND the current cast. So a re-pick
   * never reintroduces a prior name, AND warm == plain (identical inputs ⇒ identical output). Deterministic
   * off a dedicated `:rename-decollide` sub-stream; a no-op when nothing collides (the common case).
   */
  private decollidePriorNames(seed: number, priorCastNames?: readonly string[]): void {
    if (!this.house || !priorCastNames || priorCastNames.length === 0) return;
    const priorGiven = new Set<string>();
    for (const full of priorCastNames) { const g = (full ?? "").trim().split(" ")[0]; if (g) priorGiven.add(g); }
    if (priorGiven.size === 0) return;
    const rng = new SeededRandom(hashSeed(`${seed}:rename-decollide`));
    // Avoid every given name currently in the cast AND every prior-season given name.
    const used = new Set<string>(priorGiven);
    for (const n of this.house.npcs) used.add(n.name.split(" ")[0]!);
    for (const n of this.house.npcs) {
      const parts = n.name.split(" ");
      const given = parts[0]!;
      if (!priorGiven.has(given)) continue; // no cross-season collision — keep the name
      // Re-pick a SAME-GENDER name (gender coherence holds through the de-collision). The stored facet is
      // always present after seedDiversity; the `nameGenderOf` fallback only covers a legacy missing facet
      // (and a unisex/legacy read maps to a nonbinary-coherent unisex pick — never a wrong-gender name).
      const facet = n.character.genderPresentation;
      const g: "man" | "woman" | "nonbinary" =
        facet ?? (nameGenderOf(given) === "man" ? "man" : nameGenderOf(given) === "woman" ? "woman" : "nonbinary");
      used.delete(given); // free the colliding given before picking the replacement
      const next = pickGivenNameFor(g, rng, used);
      used.add(next);
      n.name = parts.length > 1 ? `${next} ${parts.slice(1).join(" ")}` : next;
    }
  }

  private seedDeepProfiles(seed: number): void {
    if (!this.house) return;
    const layer = generateCastDeepLayer(seed, this.house.npcs);
    // PUBLIC fold — onto the static Character (byte-stable from here on; superset-guarded).
    for (const n of this.house.npcs) {
      const pub = layer.public[n.id];
      if (!pub) continue;
      n.character.biography = pub.biography;
      n.character.physicalCharacteristics = pub.physicalCharacteristics;
      // 0063: GROUND the skin tone from the houseguest's ethnicity identity facet, so the structured
      // physical characteristics (which drive BOTH the narration and the portrait, L29/L23) agree with
      // the heritage the cast was guaranteed — the text and the picture never contradict the identity.
      const grounded = this.groundedSkinTones[n.id];
      if (grounded) n.character.physicalCharacteristics.skinTone = grounded;
      // L29 single-source reconciliation (appearance/physicalCharacteristics consistency fix): the prose
      // `appearance` is the OLDER 0004 descriptor, generated from INDEPENDENT pools — it could contradict
      // the structured facet (different build/skin/hair/age-look). Re-derive it FROM the structured facet
      // (the SAME builder the portrait uses) so the persisted prose can never disagree with the source of
      // truth, and any pre-0058 fallback reader stays consistent. Done at generation, before the first
      // persist, so the static Character still round-trips byte-stable (0007).
      n.character.appearance = physicalFacetToAppearance(n.character.physicalCharacteristics);
    }
    // HIDDEN — engine-only, sealed off the player AND admin.
    this.deepProfiles = layer.hidden;
    this.storyThreads = layer.threads;
    // 0060 — a fresh season starts with no nomination history and an unspent surfacing cap.
    this.nominationWeeks = {};
    this.surfacedThreadCount = 0;
    // 0091 — a fresh season starts with no eruptions, an unspent cap, and a fresh trigger-rng stream.
    this.eruptionCount = 0;
    this.triggerTickCount = 0;
    // 0075 — a fresh season has heard no confidences and spent no lies.
    this.confideState = {};
    this.lieCount = 0;
    this.resetSecretPower(); // 0093/0099 — a fresh season has spent no secrets, the caps unspent
    // 0059 §5 — a fresh season: no tie discovered, the player-surface cap unspent, the stream at 0.
    this.resetTieSurfacing();
    // 0092 — a fresh season: the secret-pacing weekly cadence + anti-spam start clean.
    this.resetSecretPacing();
    // Full-fidelity recall (L27b): the authored hidden detail is recorded into each NPC's AUTHORITATIVE
    // soul memory (engine-only — soul memory never crosses the wall, B65) so it (a) persists losslessly
    // with the house, (b) is counted toward non-degradation (0007), and (c) is re-indexed on restore by
    // `rebuildSoulIndex` (which replays `soul.memory`) — so a detail established at cast time is
    // recall-able in full FOREVER, across restarts. Also indexed NOW for same-session recall.
    for (const n of this.house.npcs) {
      const profile = layer.hidden[n.id];
      if (!profile) continue;
      const note = deepProfileToVaultContent(n.id, profile);
      n.soul.memory.push(note);
      this.soul?.recordToSoul(n.id, note);
    }
    // Seal the HIDDEN profile + threads into the Vault (engine-only audit copy, the §8 wall).
    this.onSealProfiles?.(
      Object.entries(layer.hidden).map(([id, profile]) => ({ id: id as EntityId, profile })),
      layer.threads,
    );
  }

  /**
   * 0059 — seed the sparse HIDDEN relationship layer (pre-game ties + showmances) off a SIDE rng, fold
   * each pair's small standing affinity BIAS onto the (already-scattered) move-in edges, and SEAL the
   * layer into the Vault. Engine-only by construction (the bias is the ONLY observable — as later
   * behavior — and no tie/partner/stage is ever projected). Deterministic per seed + player-independent.
   */
  /**
   * 0063 (owner decision #3) — the orientation-aware showmance ELIGIBILITY predicate the 0059 seeder uses,
   * assembled from each NPC's PUBLIC gender presentation + their FULL orientation (the out facet on the
   * Character OR the engine-only private orientation). Engine-only by construction (it reads the private
   * map but never surfaces it). A QUEER showmance is a first-class plausible pairing; it never forces one.
   */
  private showmanceEligiblePredicate(): (a: EntityId, b: EntityId) => boolean {
    const identityOf = (id: EntityId): { orientation: Orientation; genderPresentation: GenderPresentation } | null => {
      const n = this.house?.npcs.find((x) => x.id === id);
      if (!n || !n.character.genderPresentation) return null;
      const orientation = (n.character.outOrientation as Orientation | undefined)
        ?? this.privateOrientations[id] ?? "straight";
      return { orientation, genderPresentation: n.character.genderPresentation };
    };
    return (a, b) => {
      const ia = identityOf(a); const ib = identityOf(b);
      if (!ia || !ib) return true; // unknown identity (pre-0063 cast) ⇒ no gating (back-compat)
      return showmancePlausible(ia, ib);
    };
  }

  /**
   * #840 — the gate the off-screen society (the orchestrator's `defaultApply` tick) uses so a LIVE
   * off-screen `showmance` scene obeys the SAME discipline the SEEDED layer (0059/0063) does:
   *
   *   • `plausible(a, b)` — orientation-aware eligibility (reuses `showmanceEligiblePredicate`): a live
   *     showmance only forms between an orientation-plausible pair (a queer showmance is first-class).
   *   • `hasActiveShowmance(id)` — whether the houseguest ALREADY holds an active (non-`resolved`,
   *     non-evicted) seeded showmance partner, so the off-screen tick never gives anyone a SECOND
   *     active showmance (the within-tick half of the one-partner cap lives in `richOffscreenStretch`).
   *
   * Engine-only by construction (it reads the Vault-sealed private orientations + seeded showmances but
   * surfaces neither — only the demotion's later BEHAVIOR is observable). The off-screen layer doesn't
   * mint a persistent showmance record, so "active partner" is sourced from the seeded showmance layer.
   */
  offscreenShowmanceGate(): { plausible: (a: EntityId, b: EntityId) => boolean; hasActiveShowmance: (id: EntityId) => boolean } {
    const plausible = this.showmanceEligiblePredicate();
    const evicted = new Set(this.live?.evictionOrder ?? []);
    const partnered = new Set<EntityId>();
    for (const s of this.seededRels.showmances) {
      if (s.stage === "resolved" || evicted.has(s.a) || evicted.has(s.b)) continue;
      partnered.add(s.a);
      partnered.add(s.b);
    }
    return { plausible, hasActiveShowmance: (id) => partnered.has(id) };
  }

  /** 0059 §5 — clear the tie-surfacing bookkeeping (a fresh season: nothing discovered, the cap unspent). */
  private resetTieSurfacing(): void {
    this.playerTieSurfaceCount = 0;
    this.surfacedTieSubjects = new Set();
    this.tieScheduleTickCount = 0;
  }

  /** 0093/0099 — clear the secrets-as-power ledger (a fresh season: no secret spent, every cap unspent). */
  private resetSecretPower(): void {
    this.secretUsedAs = {};
    this.exposeCount = 0;
    this.tradeCount = 0;
    this.playerBluffCount = 0;
    this.playerBluffBelief = {};
  }

  /** 0092 — clear the secret-pacing drip bookkeeping (a fresh season: the weekly counter + the per-thread
   *  last-dripped week start empty, so the cadence + anti-spam begin from scratch). */
  private resetSecretPacing(): void {
    this.pacingDripWeek = 0;
    this.pacingDripCount = 0;
    this.pacingTickCount = 0;
    this.pacingLastDrippedWeek = {};
  }

  private seedSeededRelationships(seed: number): void {
    if (!this.house) return;
    const rng = new SeededRandom(hashSeed(`${seed}:seeded-relationships`));
    this.seededRels = loadSeededRelationships(
      this.house.npcs, this.tieBudget, this.showmanceBudget, rng, this.showmanceEligiblePredicate());
    // Fold the small standing affinity bias between each seeded pair (both directions). NEVER a
    // deterministic advantage — just unconscious warmth a careful player reads only as behavior (§3).
    const bias = (a: EntityId, b: EntityId, amount: number): void => {
      this.rel.edge(a, b).affinity = clamp01(this.rel.edge(a, b).affinity + amount);
      this.rel.edge(b, a).affinity = clamp01(this.rel.edge(b, a).affinity + amount);
    };
    for (const t of this.seededRels.ties) bias(t.a, t.b, TIE_AFFINITY_BIAS);
    for (const s of this.seededRels.showmances) bias(s.a, s.b, SHOWMANCE_SPARK_BIAS);
    if (this.seededRels.ties.length || this.seededRels.showmances.length) {
      this.onSealSeededRels?.(this.seededRels);
    }
  }

  /**
   * 0059 / L40 — advance the seeded showmances by the pair's CURRENT mutual affinity (the off-screen
   * tick calls this after its scenes move the edges). A showmance climbs spark → bond → visible only as
   * the two genuinely grow close over weeks (never instant); it RESOLVES when one of the pair leaves.
   * Returns the pairs that JUST became `visible` — the PUBLIC moment the house notices — so the caller
   * can record a witnessed beat the player can see. Pre-`visible` stages stay Vault-sealed (no surface).
   */
  advanceShowmances(): Array<{ a: EntityId; b: EntityId; aName: string; bName: string }> {
    if (!this.house) return [];
    const evicted = new Set(this.live?.evictionOrder ?? []);
    const nameOf = (id: EntityId): string => this.house!.npcs.find((n) => n.id === id)?.name ?? id;
    const surfaced: Array<{ a: EntityId; b: EntityId; aName: string; bName: string }> = [];
    for (const s of this.seededRels.showmances) {
      if (s.stage === "resolved") continue;
      if (evicted.has(s.a) || evicted.has(s.b)) { s.stage = "resolved"; continue; }
      const mutual = Math.min(this.rel.edge(s.a, s.b).affinity, this.rel.edge(s.b, s.a).affinity);
      const next = nextShowmanceStage(s.stage, mutual);
      if (next !== s.stage) {
        s.stage = next;
        if (next === "visible") {
          const sm = { a: s.a, b: s.b, aName: nameOf(s.a), bName: nameOf(s.b) };
          surfaced.push(sm);
          this.onShowmanceSurfaced?.(sm); // record the PUBLIC house beat (engine-only seam)
        }
      }
    }
    return surfaced;
  }

  /**
   * 0059 §5 — whether the organic pre-game-TIE surfacing scheduler runs. OPT-IN, default OFF — exactly
   * like the ADR-0006 clock and the wall-clock watcher. When off (the default, and the state the seeded
   * juryReach / gradient / UAT sims run in) `advanceSeededTies` returns IMMEDIATELY: it draws nothing,
   * records nothing, and folds nothing, so the off-screen tick's draw count/order and every seeded
   * outcome are BYTE-IDENTICAL to the pre-feature build. The deploy turns it on for the texture; the
   * showmance arc (`advanceShowmances`) is unaffected by this flag (it ships in the 0059 core).
   */
  private static seededTieSurfacingOverride: boolean | null = null;

  /** Flip the 0059 §5 tie-surfacing scheduler at runtime (admin-only, via the composition delegate). `null` ⇒ env. */
  static setSeededTieSurfacingEnabled(enabled: boolean | null): void {
    GameSessionAdapter.seededTieSurfacingOverride = enabled;
  }

  private get seededTieSurfacingEnabled(): boolean {
    if (GameSessionAdapter.seededTieSurfacingOverride !== null) return GameSessionAdapter.seededTieSurfacingOverride;
    const v = process.env.ORWELL_SEEDED_TIE_SURFACING;
    return v === "1" || v === "true" || v === "on";
  }

  /**
   * 0059 §5 — the per-tick pre-game-TIE surfacing scheduler (the DEFERRED follow-on; mirrors 0058's
   * dormant-thread scheduler + 0077's `whisperPairings`). As a sealed tie's live edge genuinely warms
   * over weeks, a careful observer eventually NOTICES the pair are unusually close and a Vault-free
   * belief diffuses NPC↔NPC (0038); a chain reaching the player lands a player belief (0002), capped per
   * season. A freshly discovered tie shifts the observer's third-party read via the 0023 fold (§5).
   *
   * STRICTLY OPT-IN + CALIBRATION-NEUTRAL: returns `[]` immediately unless the flag is on (so the seeded
   * sims never enter it). When on, every roll is on a DEDICATED rng (off the game seed + a private tick
   * counter — NEVER the shared society/vote stream the orchestrator passes), the NPC↔NPC diffusion takes
   * NO relationship fold, and only the discovery fold (flag-gated) moves an edge. Nothing crosses but the
   * observable read "they seem unusually close" — never the sealed `nature`, never a banner.
   */
  advanceSeededTies(knowledge: KnowledgeService): SurfacedTie[] {
    if (!this.seededTieSurfacingEnabled) return []; // default OFF ⇒ fully inert (calibration spine untouched)
    if (!this.house || this.seededRels.ties.length === 0) return [];
    this.tieScheduleTickCount += 1;
    const evicted = new Set(this.live?.evictionOrder ?? []);
    const awake = this.awakeNow();
    const npcs = this.house.npcs
      .map((n) => n.id)
      .filter((id) => !evicted.has(id) && (!awake || awake.has(id)));
    if (npcs.length < 2) return [];
    // DEDICATED stream — keyed off the game seed + a PRIVATE tick counter (distinct from presenceTickCount
    // so the two dedicated streams never alias). Zero touch to the orchestrator's shared per-user rng.
    const rng = new SeededRandom(hashSeed(`seeded-tie-surfacing:${this.gameSeed ?? ""}:${this.tieScheduleTickCount}`));
    const surfaced = surfaceSeededTies({
      ties: this.seededRels.ties,
      npcs,
      player: this.house.player.id,
      affinity: (a, b) => this.rel.edge(a, b).affinity,
      nameOf: (id) => this.nameOf(id),
      knowledge,
      occupancy: this.presence ?? undefined,
      surfaceToPlayer: (subject, observation) => {
        const reached = this.onTieSurfaceToPlayer?.(subject, observation) ?? false;
        if (reached) { this.playerTieSurfaceCount += 1; this.surfacedTieSubjects.add(subject); }
        return reached;
      },
      // §5 consequence fold — the OBSERVER re-reads the pair as a hidden duo (a strategic realization):
      // their directed read of EACH of the pair moves by the 0023 `strategy` fold. Reuses foldHiddenImpact
      // (one fold implementation, zero drift); engine-only (moves a hidden edge — the player sees only the
      // observer's later behavior). Runs on a DEDICATED fold rng (never the shared stream).
      foldDiscovery: (observer, pair) => {
        const foldRng = new SeededRandom(hashSeed(`tie-discovery-fold:${this.gameSeed ?? ""}:${this.tieScheduleTickCount}:${observer}`));
        for (const member of pair) foldHiddenImpact(this.rel, foldRng, member, [observer], "strategy", [observer]);
      },
      alreadySurfacedToPlayer: (subject) => this.surfacedTieSubjects.has(subject),
      playerSurfaceCount: this.playerTieSurfaceCount,
      rng,
    });
    return surfaced;
  }

  /**
   * 0059 / L40 — the Vault-free projection of the PUBLIC showmances (stage `visible`): once a showmance
   * is visible the whole house knows it, so naming the pair is a public fact, not a Vault leak. This is
   * what lets the narrator voice romance for THESE pairs ONLY (the L40 restraint). Pre-visible (sealed)
   * showmances and the pre-game ties never appear here.
   */
  visibleShowmances(): Array<{ a: string; b: string }> {
    if (!this.house) return [];
    const nameOf = (id: EntityId): string => this.house!.npcs.find((n) => n.id === id)?.name ?? id;
    return this.seededRels.showmances
      .filter((s) => s.stage === "visible")
      .map((s) => ({ a: nameOf(s.a), b: nameOf(s.b) }));
  }

  /**
   * Activate ONE dormant story thread and FOLD its hidden weight (0058 §5) — reusing the 0023
   * consequence fold (`foldHiddenImpact`), NOT a parallel subsystem. The thread's source houseguest
   * acts toward the player (the witness/partner), moving the hidden relationship layer by the thread's
   * `weightImpact` interaction. Returns the activated thread (or undefined when none is dormant for
   * that source). The player sees only the later BEHAVIOR; no number, no premise ever crosses (§8).
   * This is the directly-callable activation+fold hook; the full automatic trigger/resolution scheduler
   * is LIVE in `scheduleStoryThreads` (feature 0060), wired into the off-screen tick — both share the
   * one `foldThreadActivation` step, zero drift.
   */
  activateThread(sourceId: EntityId, rng: RandomnessSource = new SeededRandom(hashSeed(`${this.gameSeed}:thread:${sourceId}`))): StoryThread | undefined {
    const thread = this.storyThreads.find((t) => t.sourceId === sourceId && t.status === "dormant");
    if (!thread) return undefined;
    this.foldThreadActivation(thread, rng);
    this.persist();
    return thread;
  }

  /** The shared activation step (0058 §5 / 0060 §4.1): flip dormant→active + fold the 0023 hidden weight.
   *  `activateThread` (the directly-callable hook) and the 0060 scheduler both go through here — one fold
   *  implementation, zero drift. NEVER persists itself (the scheduler batches one persist per tick). */
  private foldThreadActivation(thread: StoryThread, rng: RandomnessSource): void {
    thread.status = "active";
    thread.lifecycleWeek = this.week;
    // The source acts toward the player by the thread's nature — the hidden delta folds into the
    // relationship layer (engine-only). `toward: [PLAYER]` makes the player's read of the source move.
    foldHiddenImpact(this.rel, rng, thread.sourceId, [thread.sourceId, PLAYER], thread.weightImpact, [PLAYER]);
  }

  /**
   * 0092 — whether the SECRET-PACING DRIP runs. OPT-IN, default OFF — exactly like the ADR-0006 clock,
   * the campaign layer, the trajectory layer, and the 0059 §5 tie-surfacing scheduler. When off (the
   * default, and the state the seeded juryReach / gradient / UAT sims run in) `pacingDrip` returns
   * IMMEDIATELY: it draws nothing and routes nothing, so 0060's own flat surface path is the only one
   * that runs and every seeded outcome is BYTE-IDENTICAL to the pre-feature build. The deploy may turn
   * it on once the cadence is tuned. A test overrides per-session via `setSecretPacingEnabled`.
   */
  private static secretPacingOverride: boolean | null = null;

  /** The per-session override seam for the 0092 drip (a test flips it; reserved for a future admin toggle,
   *  like its `setCampaignsEnabled`/`setTrajectoriesEnabled` siblings — not yet wired to an admin tool).
   *  `null` ⇒ fall back to the `ORWELL_SECRET_PACING` env default. */
  static setSecretPacingEnabled(enabled: boolean | null): void {
    GameSessionAdapter.secretPacingOverride = enabled;
  }

  private get secretPacingEnabled(): boolean {
    if (GameSessionAdapter.secretPacingOverride !== null) return GameSessionAdapter.secretPacingOverride;
    return SECRET_PACING_ENABLED_DEFAULT;
  }

  /**
   * 0092 — how much the player has ALREADY caught wind of one thread's secret ∈ [0,1] (the already-told
   * penalty input; engine-only, never shown). Reads ONLY existing sealed state:
   *   • THIS thread's own state — whether it has already SURFACED (0060) or this pacing layer dripped it
   *     before. Either ⇒ the full 1.0 (the player already caught THIS secret; the drip moves on).
   *   • The SOURCE-level 0075 confidence — a source authors several DISTINCT threads, so a confidence on
   *     ANY one only DAMPENS their others (a fraction of the tier), never fully floors them. A LIE
   *     (`truthful: false`) contributes NOTHING — the player was deceived, so the real secret's payoff
   *     stays fully available (the "I knew it" lands hardest when you were lied to).
   * The MAX of the two — once a secret has reached the player by a real route, the drip moves ON
   * (anti-spam + non-degradation), but a single unrelated disclosure never permanently buries a source's
   * other secrets.
   */
  private threadAlreadyTold(thread: StoryThread): number {
    const tierFraction: Record<DisclosureTier, number> = { none: 0, tease: 0.4, partial: 0.7, full: 1 };
    const confided = this.confideState[thread.sourceId];
    // Only a TRUTHFUL confidence dampens; a lie leaves the real secret fully ripe. Source-level ⇒ a
    // fraction (it's a related, not the same, disclosure); the thread's OWN state below carries the full weight.
    const confidedTold = confided && confided.truthful
      ? tierFraction[confided.tier] * SECRET_PACING.confidedSourceFraction
      : 0;
    const ownTold = (thread.status === "surfaced" || thread.id in this.pacingLastDrippedWeek) ? 1 : 0;
    return Math.max(confidedTold, ownTold);
  }

  /**
   * 0092 — can the chosen 0060 pathway ACTUALLY deliver this drip (audit deliverability guard)? Mirrors
   * the conditions inside `surfaceThread`'s two branches: the `player` (confidant slip) channel needs the
   * to-player seam wired; the `gossip` channel needs a living NPC OTHER than the source to whisper it AND
   * the gossip seam wired. A drip only commits (spending the scarce weekly/season budget + setting the
   * anti-spam state) when its channel can deliver — never burn a season slot on a silent no-op (e.g. a
   * tension-ripe secret at Final-2 with no third party to carry it). The secret stays ripe for later.
   */
  private canDeliverDrip(sourceId: EntityId, channel: "player" | "gossip", pos: SeasonPosition): boolean {
    if (channel === "player") return this.onThreadSurfaceToPlayer !== undefined;
    const livingNpcs = (this.house?.npcs ?? [])
      .map((n) => n.id)
      .filter((id) => id !== sourceId && !pos.evicted.has(id));
    return livingNpcs.length > 0 && this.onThreadGossip !== undefined;
  }

  /**
   * Feature 0092 — the SECRET-PACING DRIP. Runs ONCE per bounded off-screen tick, BEFORE 0060's own
   * surface-to-player decision (`scheduleStoryThreads`), and PACES which sealed secret edges toward THIS
   * player and how fast. It is a thin scheduling/eligibility layer over 0060 — it adds NO new pathway:
   * a chosen drip crosses through 0060's EXISTING anchored organs (`surfaceThread` → the confidant slip
   * / `surfaceInformationTo` / the 0038 gossip chain), as the same Vault-safe belief 0060 already
   * produces. The engine owns the schedule (which secret is ripe, whether the weekly budget allows it,
   * whether the seeded eligibility roll passes); the model never selects or invents a secret (mandate #3).
   *
   * CALIBRATION (the load-bearing guarantee): returns `[]` immediately unless the flag is on, so the
   * seeded sims never enter it. When on, EVERY roll is on a DEDICATED rng (off the game seed + a private
   * tick counter — NEVER the shared society/competition/vote stream the orchestrator passes to
   * `scheduleStoryThreads`), and the only thing it changes is WHICH already-Wall-safe surface 0060 picks
   * and WHETHER the weekly budget allows it. The seeded comp/vote/jury spine is untouched.
   *
   * THE PACE: a per-WEEK budget (the heart of the feature), not a per-tick probability — a hard weekly
   * ceiling (`maxDripsPerWeek`) layered UNDER 0060's `maxSurfacedPerSeason` season cap. The weekly budget
   * can never push the season total past 0060's ceiling; it only SHAPES those scarce reveals into a
   * paced, relationship-weighted cadence (about one a week, about people the player is circling).
   */
  pacingDrip(): RankedThread[] {
    if (!this.secretPacingEnabled) return []; // default OFF ⇒ fully inert (the calibration spine untouched)
    if (!this.house || this.storyThreads.length === 0) return [];

    // Roll the per-WEEK counter over FIRST (a new live week resets the spent count to 0 — the cadence is
    // per-week), so the persisted bookkeeping never trails the live week. Then read the (now-synced) budget.
    if (this.pacingDripWeek !== this.week) { this.pacingDripWeek = this.week; this.pacingDripCount = 0; }
    const budget = dripBudget({ week: this.pacingDripWeek, spentThisWeek: this.pacingDripCount, currentWeek: this.week });
    // Two layered ceilings: the per-week budget (the pace) AND 0060's hard SEASON cap (the true ceiling on
    // total payoff). Either spent ⇒ no player-bound drip this tick (surplus ripe threads still play out
    // off-screen NPC↔NPC via 0060's own flat path — only the player-bound channel is paced here).
    if (!budget.allowed || this.surfacedThreadCount >= THREAD.maxSurfacedPerSeason) return [];

    const pos = this.seasonPosition();
    // The drip rides the SAME freshly-moved house 0060 reads; only ACTIVE threads whose source is still in
    // the house are eligible to edge toward the player (a dormant secret hasn't broken loose; an evicted
    // source's secret isn't slipping). Build each candidate's already-read, Vault-hidden ripeness inputs.
    const candidates: PlayerBoundThread[] = [];
    for (const thread of this.storyThreads) {
      if (thread.status !== "active") continue;
      if (sourceWindowClosed(thread, pos)) continue;
      // proximity + tension from the BOTH-WAY player↔source edges (the engine's own directed reads).
      const reads = relationshipReads(
        this.rel.edge(PLAYER, thread.sourceId),
        this.rel.edge(thread.sourceId, PLAYER),
      );
      candidates.push({
        id: thread.id,
        sourceId: thread.sourceId,
        proximity: reads.proximity,
        tension: reads.tension,
        recency: recencyFromAge(this.week - (thread.lifecycleWeek ?? this.week)),
        alreadyTold: this.threadAlreadyTold(thread),
      });
    }
    if (candidates.length === 0) return [];

    // Seed-stable ranking (pure; no rng) — most-ripe first, the relevance floor drops secrets about people
    // the player has no proximity AND no tension with (they keep churning off-screen, never edge over).
    const ranked = rankPlayerBoundThreads(candidates);
    if (ranked.length === 0) return [];
    const top = ranked[0]!;
    const channel: "player" | "gossip" = top.channel === "confidant" ? "player" : "gossip";
    // DELIVERABILITY guard (audit): a drip must only commit when its chosen 0060 pathway can ACTUALLY
    // deliver — the confidant slip needs the to-player seam wired; the gossip chain needs a living NPC
    // origin to whisper it. If the chosen channel can't deliver, the secret stays ripe (no budget/cap
    // burned on a reveal that reaches no one) — never spend a scarce season slot on a silent no-op.
    if (!this.canDeliverDrip(top.sourceId, channel, pos)) return [];

    // The DEDICATED stream — keyed off the game seed + the PRIVATE tick counter (distinct slug from every
    // other dedicated stream so they never alias). Bump the tick counter HERE, adjacent to the only rng it
    // keys (so the eligibility-roll stream is `one key per deliverable candidate`, gap-free + restart-
    // stable). Zero touch to the orchestrator's shared per-user rng (the calibration spine).
    this.pacingTickCount += 1;
    const rng = new SeededRandom(hashSeed(`secret-pacing:${this.gameSeed ?? ""}:${this.pacingTickCount}`));
    // A single bounded, seeded eligibility roll on the TOP candidate (a quiet tick — and a quiet week — is
    // intentional; the season cap is the true ceiling). On a miss nothing crosses; the secret stays ripe.
    if (rng.next() >= SECRET_PACING.dripEligibilityRate) return [];

    const thread = this.storyThreads.find((t) => t.id === top.id);
    if (!thread) return [];
    // Route the ripe secret into 0060's EXISTING surface-to-player path — proximity-ripe prefers the
    // confidant slip (a close source TELLS the player), tension-ripe prefers the gossip chain (a third
    // party brings it). Either way it is the unchanged anchored organ; the drip only CHOSE and PACED it.
    // It counts against 0060's season cap inside surfaceThread (surfacedThreadCount++), so the pace can
    // never add payoff past the season ceiling.
    this.surfaceThread(thread, pos, rng, channel);
    // Charge the weekly budget + record the per-thread last-dripped week (the anti-spam state). Persistence
    // is the orchestrator's batched commit (this rides its bounded tick) — no `persist()` here (R3).
    this.pacingDripCount += 1;
    this.pacingLastDrippedWeek[thread.id] = this.week;
    return [top];
  }

  /**
   * Feature 0060 — the per-tick story-thread SCHEDULER. Rides the EXISTING bounded off-screen tick
   * (`orchestrator.defaultApply`), runs AFTER the tick's society/gossip/confessional steps so it reads
   * the freshly-moved house, and walks each thread's lifecycle once:
   *
   *   dormant  & triggerCondition met & roll < activateProb    → activate (reuse the 0023 fold, §4.1)
   *   active   & roll < surfaceProb & under the season cap      → surface (reuse 0038 gossip / 0002, §4.2)
   *   surfaced / active beyond resolveAfterWeeks                → resolve (one final 0023 fold, §4.3)
   *   source evicted / expireAfterWeeks elapsed dormant         → expire  (record, never delete, §4.4)
   *
   * It AUTHORS nothing and adds NO parallel subsystem — it only decides WHICH transition fires. Every
   * roll is a seeded SIDE rng (`seed:thread-scheduler:…`), so it never perturbs the main house stream
   * (0007 byte-stability) and the same seed + trigger sequence ⇒ the same thread drama (§4.5). Restraint
   * is structural: a hard season SURFACING cap (§5), at most one activation + one surface per tick, and
   * NPC↔NPC surfacing far more common than to-the-player. The Vault Wall holds (§7): nothing crosses but
   * a class-keyed paraphrase belief — never the premise, never a number.
   */
  scheduleStoryThreads(rng: RandomnessSource): void {
    if (!this.house || this.storyThreads.length === 0) return;
    this.recordNominationWeeks();
    const pos = this.seasonPosition();

    // Back-compat (§3): a thread restored from a pre-0060 save has no structured condition / lifecycle
    // week — default them in place (idempotent), so the predicate has a gate and the windows have a base.
    for (const t of this.storyThreads) {
      if (t.triggerCondition === undefined) t.triggerCondition = defaultTriggerConditionFor(t);
      if (t.lifecycleWeek === undefined) t.lifecycleWeek = this.week;
    }

    let activations = 0;
    let surfaces = 0;
    // Seed-stable iteration order is the derive order (the array order); never re-sort. The per-thread
    // side rng keys off the game seed + thread id + the live (week, phase) — so the roll is deterministic
    // AND advances as the game's POSITION advances (a thread gets a fresh chance each beat the house
    // moves to), never perturbing the main house stream (0007 §4.5). Within one (week, phase) repeated
    // ticks reuse the same roll — natural restraint: a thread fires at most once per beat, not per tick.
    for (const thread of this.storyThreads) {
      const side = new SeededRandom(hashSeed(`${this.gameSeed ?? ""}:thread-scheduler:${thread.id}:${this.week}:${this.phase}`));
      if (thread.status === "dormant") {
        // §4.4 — a dormant thread whose window has closed (source evicted, or expireAfterWeeks elapsed
        // since seed without ever triggering) EXPIRES: recorded, never deleted (non-degradation, §7).
        if (sourceWindowClosed(thread, pos)
          || this.week - (thread.lifecycleWeek ?? 0) >= THREAD.expireAfterWeeks) {
          thread.status = "expired";
          thread.lifecycleWeek = this.week;
          continue;
        }
        // §4.1 — ripe + a bounded roll + under the per-tick activation cap ⇒ activate (reuse 0023).
        if (activations < THREAD.maxActivationsPerTick
          && triggerMet(thread, pos)
          && side.next() < THREAD.activateProb) {
          this.foldThreadActivation(thread, side);
          activations++;
        }
        continue;
      }
      if (thread.status === "active") {
        // §4.3 — an active thread that has burned down (active longer than resolveAfterWeeks without
        // surfacing) RESOLVES off-screen with one final bounded 0023 fold; OR the source has left.
        if (sourceWindowClosed(thread, pos)
          || this.week - (thread.lifecycleWeek ?? 0) >= THREAD.resolveAfterWeeks) {
          this.foldThreadResolution(thread, side);
          continue;
        }
        // §4.2 / §5 — surface this tick (bounded roll, the season cap not yet spent, under the per-tick
        // surface cap). Surfacing is belief-level: NPC↔NPC gossip the common path, to-the-player rarer.
        if (surfaces < THREAD.maxSurfacesPerTick
          && this.surfacedThreadCount < THREAD.maxSurfacedPerSeason
          && side.next() < THREAD.surfaceProb) {
          this.surfaceThread(thread, pos, side);
          surfaces++;
        }
        continue;
      }
    }
    // No `persist()` here: the scheduler runs INSIDE the orchestrator's bounded off-screen tick, whose
    // own commit exports + persists the candidate snapshot (which includes the mutated `storyThreads`).
    // Persisting again would force a redundant O(events) re-serialization on the hot tick (R3/spineHardening).
  }

  /** §4.3 — resolve an active/surfaced thread: one FINAL bounded 0023 fold (the closing beat), then inert. */
  private foldThreadResolution(thread: StoryThread, rng: RandomnessSource): void {
    foldHiddenImpact(this.rel, rng, thread.sourceId, [thread.sourceId, PLAYER], thread.weightImpact, [PLAYER]);
    thread.status = "resolved";
    thread.lifecycleWeek = this.week;
  }

  /**
   * §4.2 — surface an active thread through an in-game pathway ONLY (never exposition). NPC↔NPC is the
   * common case (a vague class-keyed paraphrase handed to the 0038 gossip engine); surfacing TO the
   * player is rarer (gated behind `surfaceToPlayerProb` AND a real modeled pathway via the registry's
   * `surfaceInformationTo`, E9). Either way it counts ONCE against the hard season cap (§5). What
   * crosses is a belief with source + confidence — never the premise, never a number (§7).
   *
   * FIDELITY by pathway (2026-06-20): when the source is a genuine CONFIDANT of the player — the
   * player→source bond (the engine's own trust+affinity read) sits at/above `THREAD.confidantBondThreshold`
   * — the player hears a FULLER, less-glossed version (`confidantThreadRumor`), the way a close ally
   * actually confides. A stranger's gossip stays the ordinary vague `threadRumor`. The fuller variant is
   * STILL Vault-safe: keyed only by the public source CLASS (the same `weakness`/`true goal`/secret
   * prefix the class gloss already uses), never the verbatim premise/trigger, never a number (§7).
   *
   * `force` (0092): the secret-pacing drip selects a ripe thread and forces its CHANNEL — `player` routes
   * straight to the existing to-player path (a confidant slip / anchored `surfaceInformationTo`), `gossip`
   * routes straight to the existing NPC↔NPC diffusion (a chain that may reach the player). It changes ONLY
   * which already-Wall-safe surface is chosen — NEVER the content (the same `threadRumor`/confidant
   * paraphrase) and never a number. Absent (the default + the flag-off path) ⇒ the seeded
   * `surfaceToPlayerProb` roll decides exactly as before, so 0060 is byte-identical when pacing is off.
   */
  private surfaceThread(
    thread: StoryThread, pos: SeasonPosition, rng: RandomnessSource, force?: "player" | "gossip",
  ): void {
    const name = this.nameOf(thread.sourceId);
    const rumor = threadRumor(thread, name);
    // Choose an NPC ORIGIN for the rumor: a living NPC other than the source (someone who'd whisper it).
    const livingNpcs = (this.house?.npcs ?? [])
      .map((n) => n.id)
      .filter((id) => id !== thread.sourceId && !pos.evicted.has(id));
    // The to-player decision: 0092 may FORCE the channel (the drip chose it), else the unchanged seeded
    // `surfaceToPlayerProb` roll. A forced `player` still requires the seam to be wired (the registry sets
    // it); a forced `gossip` skips the to-player branch entirely. Default ⇒ byte-identical to before.
    const toPlayer = force === "player"
      ? this.onThreadSurfaceToPlayer !== undefined
      : force === "gossip"
        ? false
        : rng.next() < THREAD.surfaceToPlayerProb && this.onThreadSurfaceToPlayer !== undefined;
    if (toPlayer && this.onThreadSurfaceToPlayer) {
      // Rare: a modeled pathway already reaches the player — surface a content-lineage-anchored belief
      // (E9). An unanchored attempt is correctly downgraded to a suspicion by 0002; either way the
      // thread is spent (it "surfaced" — the house's drama broke into the open). Fuller fidelity ONLY
      // when this is a close-relationship/confidant pathway (a confidant confides; a stranger glosses).
      const belief = this.isPlayerConfidant(thread.sourceId)
        ? this.confidantThreadRumor(thread, name)
        : rumor;
      this.onThreadSurfaceToPlayer(thread.sourceId, belief);
    } else if (livingNpcs.length > 0 && this.onThreadGossip) {
      // The common case: hand the paraphrase to the 0038 gossip engine to diffuse NPC↔NPC.
      const origin = livingNpcs[rng.int(livingNpcs.length)]!;
      this.onThreadGossip(origin, rumor, thread.sourceId);
    }
    thread.status = "surfaced";
    thread.lifecycleWeek = this.week;
    this.surfacedThreadCount++;
  }

  /**
   * Is the thread's source a genuine CONFIDANT of the player? (2026-06-20 — gates the higher-fidelity
   * surfacing.) Derived ONLY from the existing relationship model: the player's OWN read of the source
   * (`player→source`). When that bond — trust + affinity, the engine's directed read — sits at/above
   * `THREAD.confidantBondThreshold` (the `ally`-grade band), the source is someone the player is close
   * to, the kind of houseguest who CONFIDES rather than has their secret merely whispered about. This is
   * a pure engine read (no number crosses the wall — it only chooses WHICH Vault-safe paraphrase, never
   * exposes the value). A stranger (bond below the band) always gets the ordinary vague gloss.
   */
  private isPlayerConfidant(sourceId: EntityId): boolean {
    const e = this.rel.edge(PLAYER, sourceId);
    return e.trust + e.affinity >= THREAD.confidantBondThreshold;
  }

  /**
   * The FULLER (but still Vault-safe) paraphrase a CONFIDANT surfacing gives the player (2026-06-20):
   * a richer, less-glossed belief than `threadRumor`, reading like a close ally actually confiding —
   * "they told me, in confidence, that …". It is keyed ONLY by the public source CLASS (the same
   * `weakness`/`true goal`/secret prefix the existing class gloss reads — never the verbatim premise,
   * never the trigger, never a number, §7), so the no-leak sentinel sweep stays strict: the SECRET text
   * never crosses, only a fuller-textured BELIEF with a known source. The §7 leak gate verifies this.
   */
  private confidantThreadRumor(thread: StoryThread, name: string): string {
    // The public source CLASS only — the same rule the engine's class gloss uses (a prefix on the
    // premise label, NOT the secret body). No premise/trigger/number is read here.
    const fuller = thread.premise.startsWith("weakness")
      ? `there's a real soft spot in their game they keep covering for`
      : thread.premise.startsWith("true goal")
        ? `their plan in here runs deeper and quieter than they let the house believe`
        : `they're sitting on something heavy they've hidden from almost the whole house`;
    return `${name} confided in you — you came away believing ${fuller}`;
  }

  /** 0060 §3 (`nominated-twice`) — accrue the DISTINCT weeks each current nominee has been on the block. */
  private recordNominationWeeks(): void {
    for (const id of this.ceremony.nominees) {
      const weeks = (this.nominationWeeks[id] ??= []);
      if (!weeks.includes(this.week)) weeks.push(this.week);
    }
  }

  /**
   * Build the Vault-FREE season position the scheduler's predicates read (0060 §3). Every field is a
   * PUBLIC/engine-internal POSITION fact — never a thread premise. `cornered` is the bottom-quantile of
   * the living house by the engine's own bond read toward the player-side house (engine-internal, never
   * surfaced); `nominatedRepeatedly` reads the hidden nomination-week ledger above.
   */
  private seasonPosition(): SeasonPosition {
    const evicted = new Set(this.live?.evictionOrder ?? []);
    const livingNpcs = (this.house?.npcs ?? []).map((n) => n.id).filter((id) => !evicted.has(id));
    const livingCount = livingNpcs.length + (this.house && !evicted.has(this.house.player.id) ? 1 : 0);
    const powerHolders = new Set<EntityId>();
    if (this.ceremony.hoh) powerHolders.add(this.ceremony.hoh);
    if (this.ceremony.vetoHolder) powerHolders.add(this.ceremony.vetoHolder);
    // `cornered-socially`: a source's standing among the living house. Score each living NPC by how the
    // REST of the living house reads them (mean bondStrength of others' edges toward them); the bottom
    // quantile is "cornered". Pure engine read — never crosses the wall.
    const others = [...livingNpcs, ...(this.house ? [this.house.player.id] : [])];
    const standing = new Map<EntityId, number>();
    for (const id of livingNpcs) {
      let sum = 0; let n = 0;
      for (const o of others) {
        if (o === id) continue;
        const e = this.rel.edge(o, id);
        sum += e.trust + e.affinity - e.threat; n++;
      }
      standing.set(id, n > 0 ? sum / n : 0);
    }
    const ranked = [...standing.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    const cut = Math.max(1, Math.floor(ranked.length * THREAD.corneredBottomQuantile));
    const cornered = new Set(ranked.slice(0, cut));
    const nominatedRepeatedly = new Set<EntityId>(
      Object.entries(this.nominationWeeks)
        .filter(([, weeks]) => weeks.length >= THREAD.nominatedWeeksForRivalry)
        .map(([id]) => id as EntityId),
    );
    return {
      week: this.week,
      livingCount,
      nominees: new Set(this.ceremony.nominees),
      powerHolders,
      cornered,
      nominatedRepeatedly,
      evicted,
    };
  }

  /**
   * Wire each houseguest's relationship DISPOSITION from their public archetype (B55/audit C5): a
   * villain holds grudges (clash, sticky), a loyalist forgives (bond). Derived from the persisted
   * static Character, so a restore re-derives it — no extra serialization needed.
   */
  private wireDispositions(): void {
    if (!this.house) return;
    for (const hg of [this.house.player, ...this.house.npcs]) {
      this.rel.setDisposition(hg.id, dispositionOf(hg.character.archetype));
    }
  }

  // --- Live weekly loop (0011) ---------------------------------------------------

  /**
   * Whether the in-game time-of-day clock + sleep economy (ADR 0006) is engaged. OPT-IN, default OFF
   * — exactly like the wall-clock watcher (`ORWELL_WATCHER_TICK_MS`): when off, the clock never
   * advances, `timeOfDay` stays undefined, `restOf` returns 0, and every seeded outcome (the juryReach
   * calibration spine, the UAT) is byte-identical to the pre-feature model. The deploy turns it on.
   */
  /**
   * ADR 0006 runtime override for the in-game clock. The FE settings switch flips this through the admin
   * `setTimeOfDay` tool (via the composition delegate) — no engine restart. `null` ⇒ fall back to the
   * `ORWELL_TIME_OF_DAY` env default, so the seeded golden sims (which set neither) stay OFF and
   * byte-identical. Process-global + in-memory: a restart resets it to `null` and the FE re-applies the
   * persisted setting on boot.
   */
  private static timeOfDayOverride: boolean | null = null;

  /** Flip the ADR 0006 clock at runtime (admin-only, wired through the composition delegate). `null` ⇒ env. */
  static setTimeOfDayEnabled(enabled: boolean | null): void {
    GameSessionAdapter.timeOfDayOverride = enabled;
  }

  private get timeOfDayEnabled(): boolean {
    if (GameSessionAdapter.timeOfDayOverride !== null) return GameSessionAdapter.timeOfDayOverride;
    const v = process.env.ORWELL_TIME_OF_DAY;
    return v === "1" || v === "true" || v === "on";
  }

  /** Build the Vault-free season context the pure loop reads (stats + live relationships + mood). */
  private ctx(): SeasonCtx {
    return {
      player: PLAYER,
      statsOf: (id) => this.statsOf(id),
      rel: this.rel,
      // The LIVE soul emotional state (0041) feeds the competition modifier + the rattled-HOH read.
      emotionalOf: (id) => this.soulObj(id)?.emotionalState ?? 0.5,
      // The hidden REST deficit (ADR 0006): the player's from how late THEY stayed up last night, an
      // NPC's from the latest phase they were ACTUALLY awake last night (ENG-NEW-1 — the earlier of
      // their character bedtime and how far the night ran, not a static aptitude tax). Feeds the comp
      // fold only; never crosses the wall. DORMANT unless the clock is actually running (opt-in) ⇒
      // returns 0, so the seeded calibration spine (juryReach / UAT) is BYTE-IDENTICAL to the pre-feature model.
      restOf: (id) => {
        // Tonight's immediate (conflict-drained) deficit + the compounding multi-night fatigue meter.
        return this.restDeficitOf(id);
      },
      // Derived loyalty (0043): disposition (static CHARACTER) × current soul state — feeds the
      // emergent bloc term. Derived per read; never stored (decision 0002).
      loyaltyOf: (id) => {
        const hg = this.house
          ? (this.house.player.id === id ? this.house.player : this.house.npcs.find((n) => n.id === id))
          : undefined;
        if (!hg) return 0.55;
        return derivedLoyalty(dispositionOf(hg.character.archetype), hg.soul.emotionalState);
      },
      // 0107: the named-alliance cement into bloc detection — bounded, saturation-diluted; 0 for every
      // pair when no alliance is named ⇒ the seeded bloc/vote read is byte-identical (the calibration spine).
      allianceTie: (a, b) => allianceTieBoost(this.alliances.all(), a, b),
      // Static disposition (0044): gates which nomination tactic an HOH plays (pawn/backdoor/direct).
      dispositionOf: (id) => {
        const hg = this.house
          ? (this.house.player.id === id ? this.house.player : this.house.npcs.find((n) => n.id === id))
          : undefined;
        return hg ? dispositionOf(hg.character.archetype) : "neutral";
      },
      // Open deals binding the houseguest (0039 → 0044): the vote leans to honor; the ledger still
      // reconciles a break with its full betrayal consequence downstream.
      dealsOf: (id) => this.deals.open().filter((d) => d.condition.promisors.includes(id)),
      // 0085: the per-listener CAMPAIGN tilt — present ONLY when the campaign layer is enabled (off in
      // the calibration harness ⇒ absent ⇒ byte-identical). A campaign to evict `target` that `voter` is
      // AWARE of (knownTo) pushes their vote, scaled by owner persuasiveness × voter susceptibility ×
      // trust × progress (the engine tallies; narration only voices). Bounded; never crosses the wall.
      ...(this.campaignsEnabled ? { campaignTiltFor: (target, voter) => this.campaignTiltFor(target, voter) } : {}),
      // 0006b: NPCs carry a derived competition intent — present ONLY when enabled (off in the calibration
      // harness ⇒ absent ⇒ every NPC competes ⇒ byte-identical). Live-only strategic throw/play-safe.
      ...(this.compIntentEnabled ? { compIntentOf: (id: EntityId, field: readonly EntityId[]) => this.deriveCompIntent(id, field) } : {}),
      // 0110: fold the eviction jury grudge on the evictee's DEDUCED belief (process of elimination) —
      // present ONLY when enabled (off in the calibration harness ⇒ absent ⇒ true ballot folded ⇒ byte-identical).
      ...(this.voteDeductionEnabled ? { voteDeduction: true as const } : {}),
    };
  }

  /** Turn 0110 vote deduction on/off. Off by default — the calibration harness leaves it off. */
  setVoteDeductionEnabled(on: boolean): void { this.voteDeductionEnabled = on; }

  /** Turn the live campaign layer on/off (0085 B2). Off by default — the calibration harness leaves it off. */
  setCampaignsEnabled(on: boolean): void { this.campaignsEnabled = on; }

  /** Turn the NPC competition-intent layer on/off (0006b). Off by default — the calibration harness leaves it off. */
  setCompIntentEnabled(on: boolean): void { this.compIntentEnabled = on; }

  /**
   * 0006b — derive an NPC's competition intent (compete / throw / play-safe) for a comp over `field`.
   * Strategic and OCCASIONAL by construction (see COMP_INTENT_THRESHOLDS):
   *   • a NOMINEE always competes (fighting for their life);
   *   • a LAY-LOW houseguest (low archetype aggression) with a strongly-trusted ally ALSO in the field
   *     THROWS — hand the ally the power and keep their own head down;
   *   • a CAUTIOUS houseguest another competitor already reads as a real threat PLAYS SAFE — don't win
   *     the comp that paints a bigger target on you;
   *   • otherwise COMPETE.
   * Pure read of the live board + relationships (no rng, no Vault, no number crosses the wall).
   */
  private deriveCompIntent(id: EntityId, field: readonly EntityId[]): Intent {
    if (id === PLAYER) return "compete"; // the player declares their own approach
    const hg = this.house?.npcs.find((n) => n.id === id);
    if (!hg) return "compete";
    const others = field.filter((o) => o !== id);
    return deriveNpcCompIntent({
      aggression: ARCHETYPE_AGGRESSION[hg.character.archetype] ?? 0.5,
      nominee: this.live?.nominees?.includes(id) ?? false,
      hasOthers: others.length > 0,
      bestAllyBond: others.length ? Math.max(...others.map((o) => this.rel.bondStrength(id, o))) : 0,
      maxThreatOnMe: others.length ? Math.max(...others.map((o) => this.rel.edge(o, id).threat)) : 0,
    });
  }

  /** Turn the RELATIONSHIP-TRAJECTORY layer on/off (0087). Off by default — the calibration harness leaves
   *  it off (with it off the off-screen tick passes no `trajectoryOf` ⇒ the seeded spine is byte-identical). */
  setTrajectoriesEnabled(on: boolean): void { this.trajectoriesEnabled = on; }

  /** Whether the trajectory layer is live (0087) — the orchestrator reads this so it passes `trajectoryOf`
   *  ONLY when on (off ⇒ the off-screen call is byte-identical to the pre-feature stretch). */
  trajectoriesEnabledNow(): boolean { return this.trajectoriesEnabled; }

  // --- 0066 Phase-2 (#1125): the three sleep-economy extension flags (each default OFF) --------------

  /** Extension 1 — the per-conversation clock advance. Off by default — calibration leaves it off. */
  setPerConversationClockEnabled(on: boolean): void { this.perConversationClockEnabled = on; }
  /** Extension 2 — NPC next-day social fatigue (dampened sway + conflict-drained bedtime). Off by default. */
  setSocialFatigueEnabled(on: boolean): void { this.socialFatigueEnabled = on; }
  /** Extension 3 — the compounding multi-night fatigue meter. Off by default. */
  setMultiNightFatigueEnabled(on: boolean): void { this.multiNightFatigueEnabled = on; }

  /**
   * 0066 Phase-2 (Extension 1) — advance the clock a SMALL step as the player lingers/plays WITHIN a beat.
   * The orchestrator's per-turn off-screen tick calls this once per player TURN (debounced for aux tool
   * calls, E57/R5), so the day's finite scheming time is felt turn-by-turn. SELF-GATED: a NO-OP unless the
   * dedicated flag is on AND the master clock is running AND the clock has initialized (the first ceremony
   * beat starts the day). Pacing-only — it clamps at late-night and NEVER wraps the night without the
   * player's own `turnIn` (ADR 0003 / the lull rule), so it can never rush an engaged scene past their
   * bedtime decision. Off ⇒ nothing advances ⇒ byte-identical. No rng. (Persisted via the snapshot like
   * the per-beat clock.)
   */
  advanceClockPerConversation(opts?: { kind?: ConversationKind; proposedHours?: number }): void {
    if (!this.perConversationClockEnabled || !this.timeOfDayEnabled) return;
    if (!this.live || this.live.timeOfDay === undefined) return; // dormant until the per-beat clock starts the day
    // Extension 5 (LOOSE conversation durations, ADR 0005 for time): the felt duration is the scene KIND's
    // type-bounded commit of the LLM-proposed hours; absent a kind/proposal ⇒ the small per-conversation
    // floor (byte-identical to "no proposal"). Never 0, never a day-skip; the clock still clamps + never wraps.
    const hours = opts?.kind ? conversationHours(opts.kind, opts.proposedHours) : CLOCK.perConversationHours;
    advanceClockPerConversation(this.live, hours);
  }

  /**
   * The directed `a→b` arc's hidden TRAJECTORY (0087) — passed to the off-screen society's nature pick when
   * the layer is ON. Returns `STEADY` (no tilt) when the layer is off OR the pair has no momentum yet, so a
   * disabled layer / a fresh pair is the identity (byte-identical to today's `natureWeights`). VAULT-ONLY —
   * called only from the engine-side off-screen tick, never from any outward projection.
   */
  trajectoryOf(a: EntityId, b: EntityId): Trajectory {
    if (!this.trajectoriesEnabled) return STEADY;
    return this.trajectories.get(`${a}->${b}`) ?? STEADY;
  }

  /**
   * Fold one just-recorded off-screen scene into the directed `initiator→partner` arc's momentum (0087) —
   * called ENGINE-SIDE by the off-screen tick AFTER the relationship fold, ONLY when the layer is on. The
   * scene's NATURE is mapped to a Vault-free `FoldSignal` (a signed bond/threat delta from the SAME nature
   * IMPACT the fold applied + a betrayal flag — never a raw edge number), appended to the pair's tiny ring
   * buffer (capped to the recency window), and `deriveTrajectory` re-derives the phase + momentum. Pure +
   * deterministic (no rng): same history ⇒ same arc. No-op when the layer is off ⇒ nothing to persist and
   * the calibration spine is untouched.
   */
  recordTrajectoryFold(initiator: EntityId, partner: EntityId, type: InteractionType): void {
    if (!this.trajectoriesEnabled) return;
    const key = `${initiator}->${partner}`;
    const folds = this.trajectoryFolds.get(key) ?? [];
    folds.push(GameSessionAdapter.foldSignalFor(type));
    while (folds.length > TRAJECTORY_CONSTANTS.recencyWindow) folds.shift();
    this.trajectoryFolds.set(key, folds);
    this.trajectories.set(key, deriveTrajectory(folds, this.trajectories.get(key)));
  }

  /**
   * Decay every directed arc NOT fed this tick toward `steady` (0087) — mirrors 0026's edge neglect decay,
   * so an unfed arc reverts to a flat relationship at the same cadence. `touched` is the set of `a->b` keys
   * that folded a scene this tick (those keep their freshly-built momentum). Pure, no rng. No-op when the
   * layer is off. A pair whose momentum decays below the phase floor is dropped to `STEADY` and forgotten.
   */
  decayUntouchedTrajectories(touched: ReadonlySet<string>): void {
    if (!this.trajectoriesEnabled) return;
    for (const [key, traj] of this.trajectories) {
      if (touched.has(key)) continue;
      const next = decayTrajectory(traj);
      if (next.momentum <= 0 || next.phase === "steady") {
        this.trajectories.delete(key);
        this.trajectoryFolds.delete(key);
      } else {
        this.trajectories.set(key, next);
      }
    }
  }

  /**
   * Map an off-screen scene's NATURE to its Vault-free trajectory FOLD signal (0087). The signed deltas come
   * from the SAME `RELATIONSHIP_CONSTANTS.IMPACT` magnitudes the relationship fold applies — `bondDelta` is
   * the (affinity+trust)/2 move (+ warmer, − cooler), `threatDelta` the threat move — so the arc's direction
   * agrees with how the edge actually moved. `betrayal` flags the souring-momentum injector. Pure + static;
   * carries NO raw edge state (only the nature's constant shape), so it crosses no wall.
   */
  private static foldSignalFor(type: InteractionType): FoldSignal {
    const imp = RELATIONSHIP_CONSTANTS.IMPACT[type];
    const bondDelta = ((imp.affinity ?? 0) + (imp.trust ?? 0)) / 2;
    return { bondDelta, threatDelta: imp.threat ?? 0, betrayal: type === "betrayal" };
  }

  // ─── 0104 — SEASON-OVER-SEASON NOTORIETY (a reputation that precedes the player) ─────────────────

  /**
   * 0104 — hand this session the returning player's accumulated NOTORIETY so `seedFirstImpressions`
   * folds the day-one bias (the registry calls this on a `keepCharacter` restart — the diegetic
   * opt-in, R4). A NEW character / no prior season passes `null` (or never calls this) ⇒ no bias ⇒
   * byte-identical. MUST be set BEFORE `createCharacter` runs `seedFirstImpressions` (the registry's
   * restart hook sets it on the fresh sandbox before delegating the create). Vault-free in: a bounded
   * open-set summary, never a Vault read.
   */
  setNotoriety(summary: NotorietySummary | null): void { this.notoriety = summary; }

  /**
   * 0104 — the (Vault-free) notoriety the narrator may VOICE as a returning-cast callback (the
   * `legendBeats` gist — "word is you're not someone to cross", ADR 0003: facts to voice, never a
   * script, never the numbers). Returns null when the player did not return as the same character.
   * Only the gist crosses; the reputation FACETS / the day-one biases never leave the engine.
   */
  notorietySummary(): NotorietySummary | null { return this.notoriety; }

  /**
   * 0104 — build the OPEN-SET season outcome record the registry derives notoriety from, at the
   * season-end terminal. PURE projection of the live season's PUBLIC ceremony record (placement, the
   * player's comp wins, how each evictee read the PLAYER's role in their eviction, jury reach + the
   * finale vote share) — facts the player witnessed / the 0048 retrospective unseals. NO Vault handle,
   * NO soul, NO hidden edge crosses (R1). Returns null until a season has actually FINISHED.
   */
  openSetOutcome(): OpenSetSeasonOutcome | null {
    if (!this.house || !this.live?.finished) return null;
    const me = this.house.player.id;
    const castSize = 1 + this.house.npcs.length;
    // Numeric placement: winner = 1, runner-up = 2; otherwise from the eviction order (the later you
    // were evicted, the better the placement). The i-th (0-based) evictee placed `castSize - i`.
    const order = this.live.evictionOrder ?? [];
    let placement: number;
    if (this.live.winner === me) placement = 1;
    else if (this.live.finalTwo?.includes(me)) placement = 2;
    else {
      const idx = order.indexOf(me);
      placement = idx >= 0 ? castSize - idx : castSize; // never-evicted-but-not-a-finalist guard ⇒ worst
    }
    // The player's comp wins — the public-facts `resume` tally (HOH reigns + veto wins).
    const playerCompWins = this.live.resume?.[me] ?? 0;
    // How each evictee read the PLAYER's role in their eviction (open-set: `mannerByEvictee[evictee][PLAYER]`;
    // the player witnessed it / the retrospective unseals it). Only the categorical reads cross — never
    // the hidden edge numbers behind them.
    const manner = this.live.mannerByEvictee ?? {};
    const playerEvictionRoles: OpenSetSeasonOutcome["playerEvictionRoles"] = [];
    for (const evictee of Object.keys(manner)) {
      const m = manner[evictee]?.[me];
      if (m) playerEvictionRoles.push({ blindsided: m.blindsided, betrayed: m.betrayed, respected: m.respected });
    }
    const reachedFinalTwo = this.live.finalTwo?.includes(me) ?? false;
    // Reached the jury = a juror seat (one of the last 9 evictees) OR a finalist (a deeper run still counts).
    const jurors = new Set(order.slice(-9));
    const reachedJury = reachedFinalTwo || jurors.has(me);
    // The finale jury-vote share the player won (open-set ceremony fact) — only meaningful as a finalist.
    let juryVoteShare = 0;
    const votes = this.live.finale?.votes;
    if (reachedFinalTwo && votes) {
      const cast = Object.values(votes);
      const forMe = cast.filter((v) => v === me).length;
      juryVoteShare = cast.length > 0 ? forMe / cast.length : 0;
    }
    return { placement, castSize, playerCompWins, playerEvictionRoles, reachedJury, reachedFinalTwo, juryVoteShare };
  }

  // ─── 0091 — TRIGGER SECRETS & HOUSE-EVENT ERUPTIONS ─────────────────────────────────────────────

  /** Turn the trigger-eruption layer on/off (0091). OFF by default — the calibration harness leaves it off
   *  (off ⇒ the orchestrator never runs the check ⇒ ZERO draws ⇒ the seeded spine is byte-identical). */
  setTriggersEnabled(on: boolean): void { this.triggersEnabled = on; }

  /** Whether the trigger layer is live (0091) — the orchestrator reads this so it runs the check ONLY when
   *  on (off ⇒ no call, no draw, byte-identical calibration). */
  triggersEnabledNow(): boolean { return this.triggersEnabled; }

  /** Map a fired eruption to the erupter's soul fold (0041/0023). A `meltdown`/`showmance-detonation` is a
   *  spiral — `betrayed` deepens distress AND raises volatility, so the charge climbs further. A `blow-up`/
   *  `mask-slips` is a release — `calm` settles VOLATILITY (the arousal half of strain, via the 0028 family),
   *  so the wound-tight edge eases after venting even though the underlying distress (`emotionalState`) only
   *  mean-reverts at its usual cadence; this is the bounded "the storm passed" relaxation, never a reset. */
  private static eruptionEmotion(kind: EruptionKind): EmotionalEvent {
    return kind === "meltdown" || kind === "showmance-detonation" ? "betrayed" : "calm";
  }

  /**
   * 0091 — run the TRIGGER check this tick: for each plausibly-strained, co-present erupting houseguest,
   * evaluate `pressure(volatility × strain × precipitant)` and on a fire RECORD a Vault-safe public eruption
   * `house-event` (player-witnessed) + fold the soul/witness consequence. SELF-GATED by `triggersEnabled` ⇒
   * a no-op (ZERO draws on any rng) when off, so the orchestrator's shared society/vote stream is untouched
   * and the seeded calibration spine is byte-identical (the load-bearing guarantee). Runs on a DEDICATED
   * session side-rng (forked off the game seed + the trigger tick counter) — NEVER the shared tick stream.
   *
   * `precipitants` maps a houseguest id → the spark strength ∈ [0,1] of what JUST happened to them this tick
   * (a fresh conflict/betrayal scene, a nomination). NO precipitant ⇒ pressure 0 ⇒ no fire (the no-cold-open
   * guarantee: a trigger never fires out of a quiet stretch). The sealed `detail`/`volatility`/eruption-kind
   * never reach the recorded event or any projection — only the generic public eruption line does (mandate #2).
   *
   * `events` (the EventStore) is HANDED in by the orchestrator (the `whisperPairings(knowledge)` precedent —
   * the session owns the rng + house + rel; the store is the orchestrator's), so the eruption EVENT is
   * recorded here in the session, anti-repeat consulted against the live `house-event` history.
   */
  runTriggerEruptions(events: EventStore, precipitants: ReadonlyMap<EntityId, number>): void {
    if (!this.triggersEnabled || !this.house) return;
    if (this.eruptionCount >= TRIGGER.eruptionCapPerSeason) return; // season cap spent — no draws, no fire
    if (precipitants.size === 0) return; // no spark anywhere this tick ⇒ nothing to evaluate (no cold open)
    this.triggerTickCount += 1;
    // DEDICATED stream — zero touch to the orchestrator's shared per-user rng (the calibration spine).
    const rng = new SeededRandom(hashSeed(`${this.gameSeed ?? 0}:triggers:${this.triggerTickCount}`));
    const evicted = new Set(this.live?.evictionOrder ?? []);
    const awake = this.awakeNow();
    // A trigger only fires for a LIVING NPC who is co-present (still on the floor / awake) AND has a fresh
    // spark this tick — and we evaluate in a STABLE id order so the dedicated stream is deterministic.
    const candidates = this.house.npcs
      .filter((n) => !evicted.has(n.id) && (!awake || awake.has(n.id)) && (precipitants.get(n.id) ?? 0) > 0)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const n of candidates) {
      if (this.eruptionCount >= TRIGGER.eruptionCapPerSeason) break; // cap reached mid-tick
      const trig = n.character.hiddenElements.find((e) => e.kind === "trigger");
      // An armed trigger carries both the eruption kind + a numeric volatility (set together by `armTriggers`).
      if (!trig || trig.eruptionKind === undefined || typeof trig.volatility !== "number") continue;
      const eruptionKind = trig.eruptionKind;
      // The per-kind re-arm policy: a one-shot (a slipped mask) never re-fires; a re-armable kind waits out
      // the cooldown. A spent fuse is skipped WITHOUT drawing (keeps the dedicated stream tied to live fires).
      if (trig.fired) {
        if (TRIGGER.oneShotKinds.includes(eruptionKind)) continue;
        if (trig.lastFiredWeek !== undefined && this.week - trig.lastFiredWeek < TRIGGER.reArmCooldownWeeks) continue;
      }
      const strainNow = triggerStrain(n.soul);
      const precipitant = Math.min(1, Math.max(0, precipitants.get(n.id) ?? 0));
      if (!shouldFire({ volatility: trig.volatility, kind: eruptionKind }, strainNow, precipitant, rng)) continue;
      // FIRE — a Vault-safe PUBLIC eruption the player witnesses. The recorded content is a GENERIC pool line
      // (no name, no sealed wording, no number); the connection trigger → event stays Vault-side.
      const content = eruptionEvent(eruptionKind, events, rng, { week: this.week, phase: this.phase });
      events.record({
        id: `trigger:erupt:${this.gameSeed ?? 0}:${this.triggerTickCount}:${n.id}`,
        // The EventStore is the monotonic tick authority (B60/E12): any non-advancing ts is normalized to
        // last+1, so a deterministic placeholder keeps the record reproducible (never a wall clock).
        ts: 0,
        type: "house-event",
        initiator: n.id,
        witnessSet: [PLAYER, n.id], // player-witnessed ⇒ ordinary player knowledge (0002), never secret
        hidden: false,
        content,
      });
      // Durable consequence (0023/0041): the erupter's soul folds (charge spent or volatility raised), and
      // co-present witnesses' reads of them shift along the existing pathway (0026) — a real fold, no number.
      this.inflect(n.id, GameSessionAdapter.eruptionEmotion(eruptionKind));
      this.foldEruptionWitnesses(n.id, rng);
      // Mark the fuse spent (monotonic, persisted on the byte-stable house) + bump the season cap counter.
      trig.fired = true;
      trig.lastFiredWeek = this.week;
      this.eruptionCount += 1;
    }
  }

  /** 0091 — a public eruption shifts how the co-present house (and the player) reads the erupter: a small
   *  THREAT/CONFLICT fold along the existing relationship pathway (0026), drawn on the DEDICATED trigger rng
   *  (never the shared spine). The player is a witness like anyone — their read of the erupter moves, never a
   *  number shown. No-op if no one else is on the floor. */
  private foldEruptionWitnesses(erupter: EntityId, rng: SeededRandom): void {
    const room = this.presence?.get(erupter);
    const awake = this.awakeNow();
    const witnesses = this.livingIds().filter(
      (id) => id !== erupter && (!this.presence || !room || this.presence.get(id) === room) && (!awake || awake.has(id)),
    );
    for (const w of witnesses) {
      // Seeing someone blow up reads as conflict toward them (threat ▲, warmth ▼) — the society's own
      // `conflict` impact, directed witness → erupter. Drawn on the dedicated trigger rng only.
      this.rel.applyImpactDirected(w, erupter, RELATIONSHIP_CONSTANTS.IMPACT.conflict, rng);
    }
  }

  /**
   * The player's OWN declared campaign target (0085 C) — a player-level, OOC intent, exactly like a
   * Diary-Room strategy: it is the PLAYER'S knowledge with NO in-game pathway to any NPC. It NEVER seeds
   * or moves an NPC campaign (NPC formation reads only NPC threat/ally reads — `campaignActors` excludes
   * the player), so the house responds only to the player's ACTUAL recorded moves, never to their intent.
   */
  private playerCampaignTarget: EntityId | null = null;
  declarePlayerCampaign(target: EntityId): void { this.playerCampaignTarget = target; }
  /** Read back the player's declared campaign target (player-knowledge only; never an NPC pathway). */
  playerCampaignRead(): EntityId | null { return this.playerCampaignTarget; }

  private influenceOf(id: EntityId): Influence {
    const hg = this.house ? (this.house.player.id === id ? this.house.player : this.house.npcs.find((n) => n.id === id)) : undefined;
    return hg?.character.influence ?? { persuasiveness: 0.5, susceptibility: 0.5 };
  }

  /** The summed, character-mediated campaign push on `voter`'s vote against `target` (aware campaigns only). */
  private campaignTiltFor(target: EntityId, voter: EntityId): number {
    let sum = 0;
    for (const c of this.campaigns) {
      if (c.status !== "active" || c.goal !== "evict" || c.target !== target) continue;
      if (!c.knownTo.includes(voter)) continue; // symmetric perspective: only an aware voter is swayed
      const owner = c.owners[0]!;
      sum += campaignTilt(c.progress, this.influenceOf(owner).persuasiveness, this.influenceOf(voter).susceptibility, this.rel.edge(owner, voter).trust);
    }
    // 0086 ruling #5: the OWN-BALLOT lean — a voter's own LOW (non-promoted) target drive against this
    // nominee nudges THEIR vote only. Skipped if they've already promoted it to a campaign (counted above),
    // so a drive's vote effect is exactly one tier, never additive.
    const drv = this.drives.get(voter);
    if (drv && !this.campaigns.some((c) => c.status === "active" && c.owners[0] === voter && c.target === target)) {
      sum += ownBallotLean(drv, target);
    }
    return sum;
  }

  private threatReadsOf(owner: EntityId): Array<{ toward: EntityId; threat: number }> {
    return this.livingIds().filter((id) => id !== owner)
      .map((id) => ({ toward: id, threat: this.rel.edge(owner, id).threat }))
      .sort((a, b) => b.threat - a.threat);
  }

  private allyReadsOf(owner: EntityId): Array<{ toward: EntityId; affinity: number }> {
    return this.livingIds().filter((id) => id !== owner)
      .map((id) => ({ toward: id, affinity: this.rel.edge(owner, id).affinity }))
      .sort((a, b) => b.affinity - a.affinity);
  }

  private campaignActors(): CampaignActor[] {
    return this.livingIds().filter((id) => id !== PLAYER).map((id) => ({
      id, persuasiveness: this.influenceOf(id).persuasiveness,
      threats: this.threatReadsOf(id), allies: this.allyReadsOf(id),
    }));
  }

  /**
   * Advance the live campaign layer one tick (0085 B2) — driven by the orchestrator's per-turn off-screen
   * tick, ONLY when enabled. Prune dead owners, re-plan against the board, form up to the cap, then advance
   * each active campaign one move. Uses a DEDICATED rng (never the shared society/vote stream), and its only
   * effect on the seeded vote is the bounded `campaignTiltFor` provider — it never mutates the relationship
   * edges. No-op (and zero draws) when disabled ⇒ the calibration spine is byte-identical.
   */
  campaignTick(): void {
    if (!this.campaignsEnabled || !this.house) return;
    this.campaignTickCount += 1;
    const rng = new SeededRandom(hashSeed(`${this.gameSeed ?? 0}:campaigns:${this.campaignTickCount}`));
    const beat = this.beatSeqNow();
    const living = new Set(this.livingIds());
    const nominees = new Set(this.ceremony.nominees);
    // Prune campaigns whose owner is gone; re-plan the rest against the live board.
    this.campaigns = this.campaigns
      .filter((c) => living.has(c.owners[0]!))
      .map((c) => c.status === "active"
        ? replan(c, {
            active: living,
            ownerEndangered: nominees.has(c.owners[0]!),
            threats: this.threatReadsOf(c.owners[0]!),
            // The target WON the veto ⇒ safe this week ⇒ an evict campaign re-aims (0085 C).
            targetSafe: this.ceremony.vetoHolder === c.target,
          })
        : c);
    const activeCount = (): number => this.campaigns.filter((c) => c.status === "active").length;
    // Form up to the cap (one active campaign per owner).
    if (activeCount() < CAMPAIGN.maxConcurrent) {
      for (const f of formCampaigns(this.campaignActors(), { rng, beat })) {
        if (activeCount() >= CAMPAIGN.maxConcurrent) break;
        if (!this.campaigns.some((c) => c.status === "active" && c.owners[0] === f.owners[0])) this.campaigns.push(f);
      }
    }
    // Advance each active campaign one move (progress + knownTo diffusion), then drop the resolved.
    this.campaigns = this.campaigns
      .map((c) => c.status === "active" ? advanceCampaign(c, { rng, beat, alliesOf: (id) => this.allyReadsOf(id).map((a) => a.toward) }) : c)
      .filter((c) => c.status === "active");
    // 0086: derive EVERY active houseguest's drive this tick (sticky from the prior tick) — the whole house
    // is motivated; only the loudest are campaigns above, the quiet `target` ones add the own-ballot lean.
    const nextDrives = new Map<EntityId, Drive>();
    for (const a of this.campaignActors()) {
      nextDrives.set(a.id, deriveDrive(a, {
        nominated: nominees.has(a.id),
        aggression: ARCHETYPE_AGGRESSION[this.archetypeOf(a.id)] ?? 0.5,
        emotional: this.soulObj(a.id)?.emotionalState ?? 0.5,
      }, this.drives.get(a.id)));
    }
    this.drives = nextDrives;
    // 0107 Phase B: NPCs name alliances off-screen + pitch the player (gated by campaignsEnabled ⇒ the
    // passive calibration harness forms none ⇒ the cement provider stays 0 ⇒ juryReach byte-identical).
    this.formNpcAlliances(rng);
  }

  /**
   * 0107 Phase B — NPCs autonomously NAME alliances off-screen. A `build`-drive (0086) founder over real
   * mutual bonds (the `npcAllyFloor`, higher than the player's pitch floor) names an alliance with their
   * strongest-bonded allies, then PITCHES the player if they're bonded enough (revealing it so the player
   * can accept via `joinAlliance`). Bounded: at most ONE new alliance per tick, one foundership per NPC,
   * deduped by member set. Uses the dedicated campaign rng (seeded). Gated by `campaignTick`'s flag.
   */
  private formNpcAlliances(rng: SeededRandom): void {
    const beat = this.beatSeqNow();
    const npcs = this.livingIds().filter((id) => id !== PLAYER);
    const bondOf = (a: EntityId, b: EntityId): number => (this.rel.edge(a, b).trust + this.rel.edge(a, b).affinity) / 2;
    const mutual = (a: EntityId, b: EntityId): number => Math.min(bondOf(a, b), bondOf(b, a));
    // A founder: a build-drive NPC who hasn't already founded an active alliance.
    const founders = npcs
      .filter((id) => this.drives.get(id)?.motivation === "build" && !this.alliances.all().some((a) => a.founder === id))
      .sort();
    const npcFloor = { ...ALLIANCE, joinBondFloor: ALLIANCE.npcAllyFloor };
    for (const founder of founders) {
      const proposed = npcs
        .filter((m) => m !== founder)
        .sort((a, b) => mutual(founder, b) - mutual(founder, a) || a.localeCompare(b))
        .slice(0, ALLIANCE.maxNpcSize - 1);
      const willing = willingMembers(founder, proposed, (m) => mutual(founder, m), npcFloor);
      if (willing.length < 2) continue; // nobody bonded enough — no alliance this tick
      if (this.alliances.all().some((a) => sameMembers(a.members, willing))) continue; // dedup
      const name = pickAllianceName(rng, new Set(this.alliances.all().map((a) => a.name)));
      const a = this.alliances.add(name, founder, willing, beat);
      // Pitch the player: a founder bonded enough reveals the alliance so the player can accept it.
      if (mutual(founder, PLAYER) >= ALLIANCE.pitchPlayerFloor) this.alliances.reveal(a.id, PLAYER);
      this.persist();
      return; // one new alliance per tick (bounded)
    }
  }

  /**
   * 0100 — advance the sequestered JURY HOUSE one bounded stretch: the last-nine evictees keep living
   * (hidden juror↔juror scenes) and a grievance one juror carried out DIFFUSES to others, hardening the
   * room's read of the responsible houseguest before the finale. Called once per off-screen tick by the
   * orchestrator, AFTER all main-house society/gossip work, passing the live `events`/`knowledge`.
   *
   * SELF-GATED (the `campaignTick` discipline): a no-op (ZERO draws, no grudge) unless the layer is
   * enabled AND a jury already exists — so with the flag off the seeded `juryReach`/UAT spine is
   * byte-identical. Runs on a DEDICATED, isolated rng (forked off the game seed + the jury-house tick
   * counter, NEVER the orchestrator's shared society/competition/vote stream), so even ON it never
   * re-phases the main house's seeded outcomes; only the hidden finale lean changes.
   *
   * Vault Wall (mandate #2): records ONLY hidden events (witness set = the two jurors, EXCLUDES the
   * player — the player is not in the jury house) and folds the grudge into the SEPARATE, saturated
   * `live.juryGrudge` map the finale reads — never a player- or admin-visible number, never a live edge.
   */
  juryHouseTick(events: EventStore, knowledge: KnowledgeService): void {
    if (!this.juryHouseEnabled || !this.house || !this.live) return;
    // The jury is exactly the last-nine evictees (0014/0045). The jury house models the NPC jurors only —
    // the player forms their OWN read (ADR 0003 / 0086 ruling #3), so a player-juror is excluded from the
    // grudge computation (they still EXPERIENCE the jury house as in-character life around them).
    const evicted = this.live.evictionOrder ?? [];
    const jurors = evicted.slice(-9).filter((id) => id !== this.house!.player.id);
    if (jurors.length < 2) return; // sequester hasn't produced a society yet (pre-jury / first juror only)
    // Whom a grudge can matter against: the still-in-the-game houseguests (the potential finalists),
    // INCLUDING the player — jury management cuts both ways (audit A5), so a juror the player blindsided
    // on the way out can sour the room against the PLAYER's own finale. A grievance recorded against an
    // already-evicted houseguest can never reach the finale vote, so only the responsible houseguests
    // still standing are carried here.
    const finalists = this.livingIds();
    // DEDICATED stream — zero touch to the orchestrator's shared per-user rng (the calibration spine).
    this.juryHouseTickCount += 1;
    const rng = new SeededRandom(hashSeed(`jury-house:${this.gameSeed ?? ""}:${this.juryHouseTickCount}`));
    const result = runJuryHouseStretch({
      events,
      rng,
      knowledge,
      jurors,
      edgeOf: (a, b) => this.rel.edge(a, b),
      mannerOf: (juror, finalist) => this.live!.mannerByEvictee?.[juror]?.[finalist] ?? {},
      finalists,
    });
    // Fold the bounded grudge increments into the persisted per-(juror, finalist) accumulator: MONOTONIC
    // (grudges only deepen) and SATURATED (clamped to the cap), so a restored game resumes with the
    // accumulated bitterness intact and a grudge can never run away over a long sequester (0007/#4).
    if (result.grudges.length > 0) {
      const map = (this.live.juryGrudge ??= {});
      for (const g of result.grudges) {
        const row = (map[g.juror] ??= {});
        row[g.finalist] = Math.min(JURY_HOUSE.adjustmentCap, (row[g.finalist] ?? 0) + g.delta);
      }
    }
  }

  /** Turn the JURY-HOUSE grudge layer on/off (0100). Off by default — the calibration harness leaves it off
   *  (with it off no stretch runs ⇒ zero draws ⇒ the seeded spine is byte-identical). */
  setJuryHouseEnabled(on: boolean): void { this.juryHouseEnabled = on; }

  /** Whether the jury-house layer is live (0100) — exposed for the orchestrator's wiring symmetry/tests. */
  juryHouseEnabledNow(): boolean { return this.juryHouseEnabled; }

  private archetypeOf(id: EntityId): string {
    return this.house?.npcs.find((n) => n.id === id)?.character.archetype ?? "floater";
  }

  private statsOf(id: EntityId): Stats {
    const all = this.house ? [this.house.player, ...this.house.npcs] : [];
    return all.find((h) => h.id === id)?.character.stats ?? { physical: 0.5, mental: 0.5, social: 0.5 };
  }

  /** The houseguest's dynamic soul (player or NPC), or undefined when no game is live. */
  private soulObj(id: EntityId): Soul | undefined {
    if (!this.house) return undefined;
    if (this.house.player.id === id) return this.house.player.soul;
    return this.house.npcs.find((n) => n.id === id)?.soul;
  }

  /**
   * Fold a consequential moment into a houseguest's hidden soul (0041): evolve their emotional state
   * (bounded, mean-reverting — 0028 family) and deepen the recall-able arc (`recordToSoul`, 0024).
   * The static CHARACTER is never touched; only the SOUL drifts (0007). Hidden — never surfaced.
   * Audit E52: the swing carries ADR 0001's bounded per-moment temperature roll on a SIDE rng
   * (keyed off the game seed + the soul's own arc position — deterministic, restart-stable, and
   * the main beat stream is untouched).
   */
  private inflect(id: EntityId, event: EmotionalEvent): void {
    const soul = this.soulObj(id);
    if (!soul) return;
    const rng = new SeededRandom(hashSeed(
      `${this.gameSeed ?? this.house?.player.name ?? "season"}:arc:${id}:${event}:${soul.emotionalHistory.length}`,
    ));
    evolveEmotion(soul, event, undefined, rng);
    const note = arcNote(event, this.week);
    soul.memory.push(note);                 // persisted arc (house snapshot, monotonic — 0007/0030)
    this.soul?.recordToSoul(id, note);       // vector recall index (0024), when wired into the sandbox
  }

  /**
   * L27b — DURABLY record a recorded player-witnessed scene's summary into a houseguest's recall
   * memory. The fix this closes: `recordInteraction` (the player channel's social-scene seam) used to
   * index the summary into the SoulStore's vector index ALONE — which is DERIVED state. After a restart
   * `rebuildSoulIndex` replays only each houseguest's PERSISTED `soul.memory` mirror, so a scene's
   * semantic recall silently vanished on restart (the event record survived, but the NPC could no
   * longer RECALL the scene — a non-degradation #4 / L27b leak). Writing the SAME persisted mirror the
   * arc/confessional/deep-profile paths already use makes the scene recall-able IN FULL forever, across
   * restarts. Idempotent against the mirror: a content already present (e.g. a double restore replay) is
   * not duplicated, so the monotonic-count non-degradation guard stays exact.
   */
  recordSceneMemory(id: EntityId, content: string): void {
    const soul = this.soulObj(id);
    if (soul && !soul.memory.includes(content)) {
      soul.memory.push(content);            // persisted mirror — survives + re-indexes on restore (0030)
    }
    this.soul?.recordToSoul(id, content);    // vector recall index NOW (0024), same-session recall
  }

  /**
   * Evolve the involved souls from a just-resolved beat (the live consequence fold, 0041): a comp
   * winner is emboldened and the CONTESTED LOSERS are stung (audit E51 — `comp-loss` finally
   * fires); on an eviction the SURVIVING nominee is emboldened (`survived-vote`, the 0041 beat
   * that never fired) and the evictee's closest surviving ally is blindsided toward distress.
   * Drives the live emotional arc that then modulates later competitions + decisions.
   */
  private evolveFromBeat(ev: BeatEvent): void {
    if (!this.house) return;
    const s = this.live;
    switch (ev.beat) {
      case "hoh-competition": {
        const winner = ev.participants[0];
        if (winner) this.inflect(winner, "comp-win");
        // E51 (`comp-loss`): a loss stings where it was genuinely CONTESTED — the final-3 HOH
        // crown, where each loser just watched their endgame narrow. Losing a 13-player
        // mid-season HOH comp is background noise (folding it for the whole house weekly would
        // also drown every soul's recall in identical filler — the C12/E55 lesson).
        if (winner && s && s.active.length === 3) {
          for (const h of s.active) if (h !== winner) this.inflect(h, "comp-loss");
        }
        break;
      }
      case "nominations": {
        // B51: going on the block rattles a houseguest — distress ▲ — so they carry it INTO the veto
        // comp (their odds dip below their calm baseline). The Luck-replacement modifier, finally live.
        for (const nom of s?.nominees ?? []) this.inflect(nom, "nominated");
        break;
      }
      case "veto-competition": {
        const holder = s?.vetoHolder;
        if (holder) this.inflect(holder, "comp-win");
        // E51: the rest of the six-player field contested and lost (the participants ARE the field).
        for (const h of ev.participants) if (h !== holder) this.inflect(h, "comp-loss");
        break;
      }
      case "veto-ceremony": {
        // A replacement nominee is newly on the block — same rattle (they don't play the veto, but the
        // arc is honest). The original saved nominee's relief isn't modeled here (kept minimal).
        if (s?.replacement) this.inflect(s.replacement, "nominated");
        break;
      }
      case "eviction": {
        const evictee = ev.participants[0];
        if (!evictee) break;
        this.blindsideClosestAlly(evictee);
        // E51: the nominee who sat on the block and SURVIVED is emboldened — the 0041 arc beat.
        const survivor = s?.eviction?.nominees.find((n) => n !== evictee);
        if (survivor) this.inflect(survivor, "survived-vote");
        break;
      }
    }
  }

  /** Only a genuine ally (trust above this floor) is blindsided by an eviction — else it was expected. */
  private static readonly ALLY_TRUST_FLOOR = 0.5;

  /** The evictee's most-trusting surviving ally reads the eviction as a blindside (distress ▲, volatility ▲). */
  private blindsideClosestAlly(evictee: EntityId): void {
    const s = this.live;
    if (!s) return;
    let ally: EntityId | undefined;
    let best = GameSessionAdapter.ALLY_TRUST_FLOOR;
    for (const h of s.active) {            // s.active already excludes the just-removed evictee
      if (h === evictee) continue;
      const trust = this.rel.edge(h, evictee).trust;
      if (trust > best) { best = trust; ally = h; }
    }
    if (ally) this.inflect(ally, "blindside");
  }

  /** Deepen a houseguest's soul from an off-screen scene (0038/0041): the house lives between turns.
   *  Role-correct per audit E50: the INITIATOR of a betrayal is scheming, not wounded. */
  recordOffscreenSoul(npc: EntityId, type: InteractionType): void {
    this.inflect(npc, offscreenEmotion(type, "initiator"));
  }

  /**
   * Deepen BOTH participants of an off-screen scene, per role (audit E50): the betrayal victim's
   * soul finally moves (`betrayed`) while the betrayer schemes. The full-scene sibling of
   * `recordOffscreenSoul` — the off-screen tick should prefer this seam.
   */
  recordOffscreenScene(initiator: EntityId, partner: EntityId, type: InteractionType): void {
    this.inflect(initiator, offscreenEmotion(type, "initiator"));
    this.inflect(partner, offscreenEmotion(type, "partner"));
    // 0066 Phase-2 (Extension 2): a conflict drains BOTH ⇒ they turn in earlier tonight. Gated on the
    // dedicated social-fatigue flag (and the clock) — the tally is read by `effectiveBedDepth`; off ⇒
    // never populated ⇒ no effect on who's awake or any deficit ⇒ byte-identical.
    if (this.socialFatigueEnabled && this.timeOfDayEnabled && this.live?.timeOfDay && (type === "conflict" || type === "betrayal")) {
      this.nightConflicts.set(initiator, (this.nightConflicts.get(initiator) ?? 0) + 1);
      this.nightConflicts.set(partner, (this.nightConflicts.get(partner) ?? 0) + 1);
    }
  }

  /** The manner-scale of an eviction fold (audit E48): full shock only for a genuine grievance. */
  private static mannerScale(m: EvictionManner): number {
    if (m.betrayed) return EVICTION_MANNER_SCALE.betrayed;
    if (m.blindsided) return EVICTION_MANNER_SCALE.blindsided;
    if (m.disrespected) return EVICTION_MANNER_SCALE.disrespected;
    return EVICTION_MANNER_SCALE.respected;
  }

  /**
   * Fold the hidden relationship consequence of a resolved ceremony beat (B38/audit C1 — the 0023
   * backbone that the live loop bypassed). Engine-owned, directed, magnitudes from `CEREMONY_IMPACTS`
   * (constants only). The change lives in the hidden layer — the player feels it later as behavior,
   * never as a number (0001). Runs on every ceremony (player- AND NPC-driven).
   *
   * Audit reworks: a comp win moves only the THREAT read (E47 — the house keeps liking its
   * winner); the eviction fold scales by the evictee's RECORDED manner (E48 — a respected,
   * expected eviction is not a betrayal); and the survivors' "proven threat" read lands on THIS
   * week's HOH (E49 — the old code read `outgoingHoh` before the rollover, hitting last week's).
   */
  private foldCeremonyConsequence(ev: BeatEvent): void {
    const s = this.live;
    if (!s) return;
    const rng = this.beatRng();
    const fold = (from: EntityId, to: EntityId, act: CeremonyAct, scale = 1): void => {
      if (from === to) return;
      const impact = scale === 1 ? CEREMONY_IMPACTS[act] : scaleImpact(CEREMONY_IMPACTS[act], scale);
      this.rel.applyImpactDirected(from, to, impact, rng);
    };
    switch (ev.beat) {
      case "hoh-competition": {
        const winner = ev.participants[0]; // the new HOH reads as a threat to the whole house (E47)
        if (winner) for (const h of s.active) fold(h, winner, "comp-won");
        break;
      }
      case "veto-competition": {
        const winner = s.vetoHolder;
        if (winner) for (const h of s.active) fold(h, winner, "comp-won");
        break;
      }
      case "nominations": {
        if (s.hoh && s.nominees) for (const nom of s.nominees) fold(nom, s.hoh, "nominated");
        break;
      }
      case "veto-ceremony": {
        if (s.saved && s.vetoHolder) fold(s.saved, s.vetoHolder, "veto-saved"); // gratitude bond + E54 evidence
        if (s.replacement && s.hoh) fold(s.replacement, s.hoh, "replaced");     // betrayal-shock if trusted
        break;
      }
      case "eviction": {
        const evictee = ev.participants[0];
        if (!evictee) break;
        // The evictee resents everyone responsible for sending them out (HOH + the voters who voted
        // to evict) — the SAME set the jury manner read captured — scaled by HOW it landed (E48):
        // a betrayal burns; a clean, expected move from a known rival leaves a fraction.
        const manner = s.mannerByEvictee?.[evictee] ?? {};
        for (const r of Object.keys(manner) as EntityId[]) {
          fold(evictee, r, "evicted", GameSessionAdapter.mannerScale(manner[r]!));
        }
        // The survivors read THIS week's HOH as a proven threat — they just ran the week (E49;
        // `rollWeek` has not run yet at this beat, so `s.hoh` is the reign that ends tonight).
        if (s.hoh) for (const h of s.active) fold(h, s.hoh, "comp-won");
        break;
      }
      case "self-eviction": {
        // 0061 §4.4: the present house's souls fold the player's VOLUNTARY walk-out — the house's
        // read of the LEAVER moves (threat▼ as a rival removes itself, a slight warmth/reliability
        // dip for quitting on them). The leaver is gone, so only the house→leaver direction folds.
        // `applySelfEviction` already removed the player, so `s.active` is exactly the present house.
        const leaver = ev.participants[0];
        if (leaver) for (const h of s.active) fold(h, leaver, "self-evicted");
        break;
      }
    }
  }

  /** A deterministic per-(week,beat) RNG so a given moment resolves the same way (and across restart). */
  private beatRng(): SeededRandom {
    // B60/audit E12: key off the GAME's seed (persisted), not the player's display name — two
    // same-named games get distinct streams; a restored game keeps its own. Legacy saves (no seed)
    // fall back to the old name key so their in-flight moments still resolve identically.
    const name = this.house?.player.name ?? "season";
    const root = this.gameSeed ?? name;
    // A double-eviction night (0025/B53) repeats the week's beats in its compressed second cycle —
    // disambiguate so the second HOH comp / eviction don't replay the first cycle's rolls.
    const cycle = this.live?.twist?.phase === "running" ? ":2" : "";
    return new SeededRandom(hashSeed(`${root}:${this.live?.week}:${this.live?.beat}${cycle}`));
  }

  advanceGame(req: { expectedBeatSeq?: number; idempotencyKey?: string } = {}): AdvanceView {
    // 0065 Part B — an at-most-once replay returns the ORIGINAL view (its beatSeq included) WITHOUT
    // advancing again; it WINS even if beatSeq has since moved (the cache is the authority on the
    // already-applied result). Checked before the CAS guard so a retry of a now-stale key still
    // returns the cached success rather than a spurious stale-beat conflict.
    if (req.idempotencyKey !== undefined) {
      const cached = this.idempotencyCache.get(req.idempotencyKey);
      if (cached) return cached;
    }
    // 0065 Part A — refuse a write computed against a superseded board BEFORE any mutation.
    this.guardBeatSeq(req.expectedBeatSeq);
    if (!this.house || !this.live) {
      const v = this.advanceView(null);
      return req.idempotencyKey !== undefined ? this.rememberIdempotent(req.idempotencyKey, v) : v;
    }
    // One persisted commit per beat (E3): interior persists (a deal broken mid-tally) defer to a
    // single hook call AFTER all state mutation — a refused commit throws instead of narrating.
    const view = this.inOneCommit(() => {
      let ev: BeatEvent | null = null;
      if (!this.live!.pending && !this.live!.finished) {
        ev = advanceBeat(this.live!, this.ctx(), this.beatRng());
        // ADR 0006 (opt-in): the in-game clock moves by PLAY — one phase per SUBSTANTIVE advance, cycling
        // toward late-night and wrapping to a new morning (banking a late night the player never ended).
        // The diegetic bound + sleep cost ride this; dormant (byte-identical) unless the clock is enabled.
        //
        // #537: the clock advances by SUBSTANTIVE PLAY — once per resolved ceremony/eviction/finale
        // beat — never on a staged competition's per-round PRESENTATION (the `comp-round` PAUSES, which
        // emit no event, and the inert `comp-elimination` reveal beats: no rng, no fold, no soul
        // inflection — see `advanceCompetition`/`stagedTrajectoryNeutral`). Advancing on each of those
        // cycled most of a day inside ONE competition (the HOH crowned at late-night the morning it
        // began). The clock still INITIALIZES on the first advance (so the HUD/rest cue are live from
        // turn one) even before the first substantive beat lands.
        //
        // 0066 Phase-2 (PR #715): the graded sleep economy — chronotype bedtimes + continuous night
        // depth + the night-end fatigue/conflict bookkeeping — rides this SAME substantive-play gate, so
        // it never over-advances on inert staged-comp beats either. On the bare init advance `advanceClock`
        // only initializes (returns early), so the bookkeeping below is a harmless no-op there: rest
        // deficit is 0 (no night ran) and the conflict tally is still empty.
        if (this.timeOfDayEnabled && (this.live!.timeOfDay === undefined || (ev !== null && !isInertBeat(ev.beat)))) {
          const wasRetired = this.live!.playerRetired ?? false;
          advanceClock(this.live!);
          // A genuine night-end is the 8am-wake WRAP (the house ran to the bitter end) — NOT the morning
          // after a turnIn (that night already accrued). Detect: a fresh morning (back at the wake hour) we
          // did NOT reach via retirement.
          if (!wasRetired && this.live!.timeOfDay === DAY_START && (this.live!.nightDepth ?? WAKE_HOUR) === WAKE_HOUR) this.accrueNightFatigue();
          this.rollNightConflicts();
        }
        this.commit(ev);
      }
      // Surface the just-resolved beat (it is player-witnessed) so the finale reveal/result beats
      // and every ceremony beat are visible in the view, not only recorded to the event store.
      return this.advanceView(ev);
    });
    // 0065 Part B — cache the committed result under its key, so a retry replays it verbatim.
    return req.idempotencyKey !== undefined ? this.rememberIdempotent(req.idempotencyKey, view) : view;
  }

  submitDecision(req: SubmitDecisionReq): AdvanceView {
    // 0065 Part B — replay an already-resolved decision verbatim (wins even if beatSeq moved).
    if (req.idempotencyKey !== undefined) {
      const cached = this.idempotencyCache.get(req.idempotencyKey);
      if (cached) return cached;
    }
    // 0065 Part A — refuse a decision computed against a superseded board BEFORE any mutation.
    this.guardBeatSeq(req.expectedBeatSeq);
    if (!this.house || !this.live) {
      const v = this.advanceView(null);
      return req.idempotencyKey !== undefined ? this.rememberIdempotent(req.idempotencyKey, v) : v;
    }
    // 0065 Part B — every resolved/no-op path below caches its committed view under the key, so a
    // retry replays it verbatim (and never re-applies the decision).
    const remember = (v: AdvanceView): AdvanceView =>
      req.idempotencyKey !== undefined ? this.rememberIdempotent(req.idempotencyKey, v) : v;
    // 0061 — self-eviction is the sanctioned CONFIRMED quit. It rides the SAME `submitDecision`
    // seam but resolves through its own dedicated path (NOT the ceremony-pending machinery): the
    // confirmation must already be raised (the OOC step-1 gate), AND `confirmed` must be true.
    // Anything else (a missing confirmation, confirmed:false/absent) is a safe no-op — the player
    // stays ACTIVE (the anti-accident handshake; never a fabricated exit, §4.2).
    if (req.kind === "self-evict") return remember(this.resolveSelfEviction(req.confirmed === true));
    // No-op unless there's a matching pending decision to resolve (idempotent + robust
    // to malformed calls — the boundary must never throw an unhandled error). `comp-intent` and
    // `comp-round` are interchangeable aliases for the staged per-round approach (0006 staged-rounds).
    const compApproach = (k: string): boolean => k === "comp-intent" || k === "comp-round";
    const pendingKind = this.live.pending?.kind;
    const kindMatches = !!pendingKind && (pendingKind === req.kind || (compApproach(pendingKind) && compApproach(req.kind)));
    if (!kindMatches) return remember(this.advanceView(null));
    // (E42) Eviction-vote reconciliation moved to `commit`: the staged eviction's `voteOf` carries
    // EVERY voter — player and NPC alike — so the ledger now sees all binding votes in one place.
    return remember(this.inOneCommit(() => {
      // The beat-deterministic rng lets the Houseguest's-Choice resume run the veto comp reproducibly (B45).
      const ev = applyDecision(this.live!, this.toDecisionInput(req), this.ctx(), this.beatRng());
      this.commit(ev);
      return this.advanceView(ev);
    }));
  }

  /**
   * The player's bedtime lever (ADR 0006 §Principle 6): the player CHOOSES to turn in for the night.
   * Ends their night where it stands (an early night ⇒ rested for tomorrow; outlasting the house into
   * late-night ⇒ running on empty) and rolls the house to the next morning. Never auto-called — only
   * the player's own action fires it. A no-op when the clock isn't running, the game is over, or the
   * player has left. Durable (0030): the new morning + banked rest survive a reload.
   */
  turnIn(): AdvanceView {
    if (!this.house || !this.live) return this.advanceView(null);
    if (!this.timeOfDayEnabled) return this.advanceView(null); // dormant unless the clock is running
    if (this.live.finished || playerHasLeft(this.live, PLAYER)) return this.advanceView(null);
    return this.inOneCommit(() => {
      playerTurnIn(this.live!, PLAYER);
      this.accrueNightFatigue(); // the player chose bed — a genuine night-end; accrue before clearing conflicts
      this.rollNightConflicts();
      this.persist();
      return this.advanceView(null);
    });
  }

  /**
   * Self-eviction step 1 (0061 §4.2) — an OOC intent-to-leave raises the confirmation pending and
   * changes NO game state (the house never hears it; the L36/L39a gate holds for the bare line). It
   * does NOT evict — only a confirmed `submitDecision({ kind: "self-evict", confirmed: true })` does.
   */
  requestSelfEviction(): AdvanceView {
    if (!this.house || !this.live) return this.advanceView(null);
    if (this.live.finished || playerHasLeft(this.live, PLAYER)) return this.advanceView(null);
    return this.inOneCommit(() => {
      requestSelfEvict(this.live!, this.ctx());
      this.persist(); // durable: a raised confirmation survives a reload (0030)
      return this.advanceView(null);
    });
  }

  /** Self-eviction cancel (0061 §4.2) — clear the confirmation; the player plays on, ACTIVE, unchanged. */
  cancelSelfEviction(): AdvanceView {
    if (!this.house || !this.live) return this.advanceView(null);
    return this.inOneCommit(() => {
      cancelSelfEvict(this.live!);
      this.persist();
      return this.advanceView(null);
    });
  }

  /**
   * Self-eviction step 2 (0061 §4.1) — the confirmed walk-out. A no-op unless the confirmation was
   * raised AND `confirmed` is true (the anti-accident gate; a stray/unconfirmed call never evicts).
   * Routes the exit through the SAME commit path every beat uses: `applySelfEviction` records a real
   * `self-eviction` BeatEvent (the registry records it player-witnessed + non-hidden), `commit` folds
   * its 0023 hidden impact, the player's status flips via the 0046 `evictionOrder` door, and the
   * snapshot persists. Never narrated-but-not-recorded: either this transition ran, or the player
   * is still in the house.
   */
  private resolveSelfEviction(confirmed: boolean): AdvanceView {
    const s = this.live!;
    // The gate: the OOC confirmation must be standing, the player must still be in, and the confirm
    // must be explicit. Any miss is a safe no-op (the player stays active) — never a fabricated exit.
    if (!confirmed || !s.selfEvictPending || s.finished || playerHasLeft(s, PLAYER)) {
      return this.advanceView(null);
    }
    return this.inOneCommit(() => {
      const ev = applySelfEviction(s, this.ctx());
      this.commit(ev); // record (witness = present house, non-hidden) + fold 0023 + sync + persist
      return this.advanceView(ev);
    });
  }

  /**
   * The player makes a deal with a houseguest (0039). Recorded as a player-witnessed event (their
   * knowledge); the engine reconciles it against later binding actions. Player↔NPC only — NPC↔NPC
   * deals are made off-screen and held in the Vault (never crosses this outward seam).
   */
  makeDeal(req: MakeDealReq): DealView | null {
    // 0065 Part A — refuse a deal computed against a superseded board BEFORE any mutation.
    this.guardBeatSeq(req.expectedBeatSeq);
    if (!this.house || !this.live) return null;
    const target = req.with;
    const evicted = new Set(this.live.evictionOrder);
    const isActiveOther = target !== PLAYER
      && this.house.npcs.some((n) => n.id === target) && !evicted.has(target);
    if (!isActiveOther) return null;
    const terms = (req.terms ?? "").slice(0, 200);
    const evId = this.onPlayerEvent?.(
      `${this.nameOf(PLAYER)} and ${this.nameOf(target)} make a ${req.kind} deal: ${terms}`,
      [PLAYER, target], "deal",
    );
    // `madeWeek` (E43) anchors the horizon: a safety/vote promise binds through THIS week's eviction.
    const deal = this.deals.make([PLAYER, target], req.kind, terms, evId, this.live.week);
    // 0093 — OPTIONAL leverage: a secret the player holds ABOUT the partner colors the deal's formation
    // and folds the squeeze (a wary partner resents it / a persuadable one is bound tighter). The threat
    // persists while the deal is open — it is NOT spent here (only `exposeSecret` spends it). Absent ⇒
    // no extra rng, no fold — byte-identical to 0039.
    if (req.leverage) this.applyDealLeverage(req.leverage, target, deal.id);
    // 0099 — OPTIONAL traded secret: a secret about a THIRD party handed to the partner as consideration
    // (valued to the PARTNER); colors formation, surfaces the secret to the partner, and warms/sours them.
    if (req.tradedSecret) this.applyDealTrade(req.tradedSecret, target);
    this.persist();
    return this.dealView(deal);
  }

  /**
   * 0093 — the secret-power per-moment seeded rng, keyed on (game seed, use, factId/subject, week, phase).
   * Repeated presses within a beat reach the same decision; a later beat re-rolls. No raw rng leaks the
   * outcome (anti-sycophancy). Sibling of the `confide` rng derivation.
   */
  private secretRng(use: string, key: string): SeededRandom {
    return new SeededRandom(hashSeed(`${this.gameSeed ?? 0}:secret:${use}:${key}:${this.week}:${this.phase}`));
  }

  /**
   * 0093/0099 — resolve a wielded secret descriptor to its SUBJECT + a Vault-safe severity. For a REAL
   * secret (a `factId`) it validates the player legitimately holds it (`knownTo(player)` — the bright
   * line; a non-learned/spent fact is rejected) and reads the subject + the holding NPC's PUBLIC secret
   * KIND for severity (never the sealed text). For a BLUFF it reads NOTHING from the Vault: severity is
   * the default and the subject is the claimed `subject`. Returns `null` when invalid (rejected).
   */
  private resolveWieldedSecret(
    d: { factId?: string; bluff?: boolean; subject?: EntityId },
  ): { subject: EntityId; severity: number; factId?: string; bluff: boolean } | null {
    if (d.bluff) {
      // A bluff invents a claim — no Vault read. It needs a named subject to fold against.
      if (!d.subject || !this.isActiveNpc(d.subject)) return null;
      return { subject: d.subject, severity: LEVERAGE.defaultSeverity, bluff: true };
    }
    if (!d.factId) return null;
    // The bright line: the player can only wield a fact they LEGITIMATELY HOLD. Reject anything else —
    // a suspicion, a never-learned secret, another entity's knowledge. No Vault-minting.
    const fact = (this.playerKnowledgeReader?.() ?? []).find((f) => (f.factId ?? f.id) === d.factId || f.id === d.factId);
    if (!fact) return null;
    if (this.secretUsedAs[d.factId] === "exposed") return null; // spent (public) — never re-wielded
    // The subject is the houseguest the fact is about (the knowledge `subject`, or the descriptor's hint).
    const subject = fact.subject ?? d.subject;
    if (!subject || !this.isActiveNpc(subject)) return null;
    // Severity from the subject's PUBLIC secret KIND (never the sealed text) — the 0075 gloss sibling.
    const npc = this.house?.npcs.find((n) => n.id === subject);
    const secret = npc ? this.headlineSecretOf(npc) : undefined;
    return { subject, severity: severityOf(secret?.kind), factId: d.factId, bluff: false };
  }

  /** Whether an id is an active (non-evicted) NPC in the live house. */
  private isActiveNpc(id: EntityId): boolean {
    if (!this.house || !this.live || id === PLAYER) return false;
    return this.house.npcs.some((n) => n.id === id) && !this.live.evictionOrder.includes(id);
  }

  /** 0093 — the player→partner SIGNED warmth ((trust+affinity)/2 − threat) the deal-acceptance read uses. */
  private signedWarmthTowardPlayer(npcId: EntityId): number {
    const e = this.rel.edge(npcId, PLAYER);
    return (e.trust + e.affinity) / 2 - e.threat;
  }

  /**
   * 0093 — fold the LEVERAGE of a held secret against the deal partner. Computes the bounded, seeded
   * `leverageStrength`, then the acceptance read AFTER the boost: a persuadable partner is bound a little
   * tighter (a `strategy`-grade warm fold — the pressure landed), a WARY partner (the read lands below the
   * refusal floor) RESENTS the squeeze (the `squeezeBacklash` fold sours their read of the player). A
   * BLUFF folds the same shape weighted by BELIEF (and never tells the player whether it matched a truth);
   * a believed bluff is the same press, a disbelieved one bounces. The threat persists while the deal is
   * open — the secret is NOT marked spent here. The player never sees a number (anti-sycophancy).
   */
  private applyDealLeverage(d: SecretLeverDescriptor, partner: EntityId, _dealId: string): void {
    const resolved = this.resolveWieldedSecret({ ...d, subject: partner }); // leverage is ALWAYS about the partner
    // Leverage presses the PARTNER, so the secret must be about the partner (or a bluff claiming so).
    if (!resolved || (resolved.subject !== partner)) {
      // An invalid/irrelevant leverage simply does nothing (the deal still forms) — no fold, no spend.
      return;
    }
    const rng = this.secretRng("leverage", resolved.factId ?? `bluff:${partner}`);
    if (resolved.bluff) {
      this.playerBluffCount = Math.min(this.playerBluffCount + 1, LEVERAGE.maxPlayerBluffsPerSeason + 1);
      const e = this.rel.edge(partner, PLAYER);
      // Plausibility leans on the partner's own self-threat proxy — bluffing someone is dicey; if they
      // DON'T believe it, the squeeze bounces (no fold). If they do, it presses like a real leverage.
      if (!bluffBelieved(e.trust, e.threat, rng)) return;
    }
    const npc = this.house!.npcs.find((n) => n.id === partner)!;
    const strength = leverageStrength(this.leverageSignalsFor(npc), rng);
    const { accepts } = dealAcceptance(this.signedWarmthTowardPlayer(partner), leverageDealBoost(strength), LEVERAGE.refusalFloor);
    if (accepts) {
      // The pressure landed — the PARTNER is bound a little tighter: a strategy-grade fold on the
      // partner→player edge (initiator PLAYER, toward [partner], so the PARTNER's read of the player moves).
      foldHiddenImpact(this.rel, rng, PLAYER, [PLAYER, partner], "strategy", [partner]);
    } else {
      // A wary partner calls the squeeze and RESENTS it — their hidden read of the player sours (bounded).
      this.rel.applyImpactDirected(partner, PLAYER, LEVERAGE.squeezeBacklash, rng);
    }
  }

  /** 0093 — assemble the Vault-hidden leverageStrength signals (the subject's soul + their read of the player). */
  private leverageSignalsFor(npc: { id: EntityId; soul?: { emotionalState?: number }; character: { hiddenElements?: HiddenElement[] } }): LeverageSignals {
    const e = this.rel.edge(npc.id, PLAYER);
    return {
      severity: severityOf(this.headlineSecretOf(npc)?.kind),
      subjectEmotionalState: npc.soul?.emotionalState ?? 0.5,
      subjectTrust: e.trust, subjectAffinity: e.affinity, subjectThreat: e.threat,
    };
  }

  /**
   * 0099 — fold the TRADE of a held secret to the deal partner (the recipient). Values the secret TO THE
   * RECIPIENT (their reads of the secret's SUBJECT — a rival's secret is gold to that rival's enemy,
   * worthless to their ally), resolves whether they take it, warms them toward the giver (an accepted
   * trade) or sours them (peddling a worthless secret), surfaces the secret into the recipient's
   * knowledge (a recorded `told` pathway — never a Vault read), and marks the secret `traded`/caps it.
   */
  private applyDealTrade(d: SecretLeverDescriptor, recipient: EntityId): void {
    this.resolveAndTrade(d, recipient, "deal");
  }

  /**
   * 0099 — the shared trade resolution (used by `makeDeal`'s `tradedSecret` and the `tradeSecret` lever).
   * Returns whether the recipient accepted (and the Vault-safe reason on a refusal). Validates ownership,
   * values to the recipient, folds, surfaces the secret, marks used, caps. `null` on an invalid setup.
   */
  private resolveAndTrade(
    d: SecretLeverDescriptor, recipient: EntityId, _via: "deal" | "swap",
  ): { accepted: boolean; refused?: TradeResult["refused"]; narratable?: string } | null {
    if (!this.isActiveNpc(recipient)) return { accepted: false, refused: "no-recipient" };
    if (this.tradeCount >= SECRET_TRADE.maxTradesPerSeason) return { accepted: false, refused: "capped" };
    const resolved = this.resolveWieldedSecret(d);
    if (!resolved) return { accepted: false, refused: "not-learned" };
    if (resolved.subject === recipient) return { accepted: false, refused: "not-learned" }; // can't trade a secret TO its own subject
    const rng = this.secretRng("trade", `${resolved.factId ?? `bluff:${resolved.subject}`}:${recipient}`);
    if (resolved.bluff) {
      this.playerBluffCount = Math.min(this.playerBluffCount + 1, LEVERAGE.maxPlayerBluffsPerSeason + 1);
      const re = this.rel.edge(recipient, PLAYER);
      if (!bluffBelieved(re.trust, this.rel.edge(recipient, resolved.subject).threat, rng)) {
        return { accepted: false, refused: "declined" }; // they don't buy the fabricated secret
      }
    }
    const value = tradeValue(this.tradeSignalsFor(recipient, resolved.subject, resolved.severity), rng);
    const folds = tradeOutcome(value, this.signedWarmthTowardPlayer(recipient), rng);
    if (folds.accepted) {
      if (folds.recipientFold) this.rel.applyImpactDirected(recipient, PLAYER, folds.recipientFold, rng);
      if (resolved.bluff) {
        // A BELIEVED bluff: record it so a later contradicting TRUTH about the same subject catches the
        // player out (the passive lie-catch). A real trade DELIVERS the truth, so it also CATCHES any
        // earlier bluff the player told THIS recipient about this subject.
        this.recordPlayerBluffBelief(recipient, resolved.subject);
      } else {
        this.catchPlayerBluff(recipient, resolved.subject, rng); // a real truth contradicts a prior bluff
        // The recipient now HOLDS the traded secret — a recorded `told-by:player` pathway (never a Vault read).
        const content = this.factContentFor(resolved.factId!) ?? `${this.nameOf(PLAYER)} shared a secret about ${this.nameOf(resolved.subject)}`;
        this.onSurfaceToHouseguest?.(recipient, content, resolved.subject, `told-by:${PLAYER}`, 0.8);
      }
      // Mark the REAL secret traded (monotonic — it has been spent into the economy); a bluff is not a real fact.
      if (resolved.factId && this.secretUsedAs[resolved.factId] !== "exposed") this.secretUsedAs[resolved.factId] = "traded";
      this.tradeCount++;
      return { accepted: true, narratable: "they took the trade" };
    }
    // Refused — peddling a secret they don't want reads as untrustworthy (a bounded sour on their read).
    if (folds.traderBacklash) this.rel.applyImpactDirected(recipient, PLAYER, folds.traderBacklash, rng);
    return { accepted: false, refused: "declined", narratable: "they didn't bite" };
  }

  /** 0099 — assemble the Vault-hidden tradeValue signals (the RECIPIENT's reads of the secret's subject + the player). */
  private tradeSignalsFor(recipient: EntityId, subject: EntityId, severity: number): TradeSignals {
    const toSubject = this.rel.edge(recipient, subject);
    const toPlayer = this.rel.edge(recipient, PLAYER);
    return {
      severity,
      recipientThreatOfSubject: toSubject.threat,
      recipientAffinityForSubject: toSubject.affinity,
      recipientTrustOfPlayer: toPlayer.trust,
    };
  }

  /** 0093/0099 — the player-facing CONTENT of a learned fact (so a trade surfaces the SAME content the player holds). */
  private factContentFor(factId: string): string | undefined {
    return (this.playerKnowledgeReader?.() ?? []).find((f) => (f.factId ?? f.id) === factId || f.id === factId)?.content;
  }

  /** deception — record that `npc` BELIEVED a player bluff about `subject` (the passive lie-catch ledger). */
  private recordPlayerBluffBelief(npc: EntityId, subject: EntityId): void {
    const subjects = (this.playerBluffBelief[npc] ??= []);
    if (!subjects.includes(subject)) subjects.push(subject);
  }

  /**
   * deception — the PASSIVE LIE-CATCH (owner direction): a genuine contradicting pathway about `subject`
   * has just reached `npc`. If the player earlier BLUFFED this `npc` about this `subject`, the bluff is
   * CAUGHT — the bluffer takes a betrayal-grade, recoverable hit on the npc→player edge (0026
   * `IMPACT.betrayal`), and the caught bluff is cleared (it can't re-fire). The player never sees a number.
   */
  private catchPlayerBluff(npc: EntityId, subject: EntityId, rng: SeededRandom): void {
    const subjects = this.playerBluffBelief[npc];
    if (!subjects || !subjects.includes(subject)) return;
    this.rel.applyDirected(npc, PLAYER, "betrayal", rng); // the npc realizes the player lied to them
    this.playerBluffBelief[npc] = subjects.filter((s) => s !== subject);
    recordDealBetrayal(this.live!, npc, PLAYER); // a jury-management demerit too (they remember the lie)
  }

  /**
   * 0107 — the player NAMES an alliance with a set of houseguests. Bond-GATED (anti-watering-down): a
   * proposed member joins only if their mutual bond with the player clears the floor; the unbonded
   * DECLINE, so you can't name everyone your ally. Needs ≥2 willing members or it doesn't form. Recorded
   * as the player's witnessed knowledge; the alliance then CEMENTS the bloc + banks favor (Vault-sealed
   * magnitudes — the player sees the NAME + who's in, never a number).
   */
  formAlliance(req: FormAllianceReq): AllianceView | null {
    this.guardBeatSeq(req.expectedBeatSeq);
    if (!this.house || !this.live) return null;
    const evicted = new Set(this.live.evictionOrder);
    const proposed = [...new Set(req.members)].filter(
      (id) => id !== PLAYER && this.house!.npcs.some((n) => n.id === id) && !evicted.has(id),
    );
    const bondOf = (a: EntityId, b: EntityId): number => (this.rel.edge(a, b).trust + this.rel.edge(a, b).affinity) / 2;
    const willing = willingMembers(PLAYER, proposed, (m) => Math.min(bondOf(PLAYER, m), bondOf(m, PLAYER)));
    if (willing.length < 2) return null; // nobody close enough bought in — no alliance of one
    const name = (req.name ?? "").slice(0, 60).trim() || "our alliance";
    const others = willing.filter((m) => m !== PLAYER);
    this.onPlayerEvent?.(
      `${this.nameOf(PLAYER)} forms an alliance "${name}" with ${others.map((m) => this.nameOf(m)).join(", ")}`,
      willing, "alliance",
    );
    const a = this.alliances.add(name, PLAYER, willing, this.beatSeqNow());
    this.persist();
    return this.allianceView(a);
  }

  /** 0107 — a Vault-safe view of a named alliance (the NAME + member names + whether the player founded it). */
  private allianceView(a: Alliance): AllianceView {
    return {
      id: a.id,
      name: a.name,
      members: a.members.map((m) => ({ id: m, name: this.nameOf(m) })),
      youAreFounder: a.founder === PLAYER,
    };
  }

  /** 0107 — the alliances the PLAYER is a member of (Vault-safe; never the cement/favor numbers). */
  private playerAllianceViews(): AllianceView[] {
    return this.alliances.forMember(PLAYER).map((a) => this.allianceView(a));
  }

  /**
   * 0107 Phase B — the player ACCEPTS an NPC's pitch and joins their alliance. Only a live pitch (the
   * player is `knownTo` but not a member) AND a close enough bond with the founder lets them in — a cold
   * "add me" to an alliance they were never offered is refused. Recorded as the player's knowledge.
   */
  joinAlliance(req: JoinAllianceReq): AllianceView | null {
    this.guardBeatSeq(req.expectedBeatSeq);
    if (!this.house || !this.live) return null;
    const a = this.alliances.byId(req.allianceId);
    if (!a || a.members.includes(PLAYER) || !a.knownTo.includes(PLAYER)) return null; // not an open pitch
    const bondOf = (x: EntityId, y: EntityId): number => (this.rel.edge(x, y).trust + this.rel.edge(x, y).affinity) / 2;
    if (Math.min(bondOf(PLAYER, a.founder), bondOf(a.founder, PLAYER)) < ALLIANCE.joinBondFloor) return null; // not close enough
    const joined = this.alliances.join(a.id, PLAYER)!;
    this.onPlayerEvent?.(`${this.nameOf(PLAYER)} joins the alliance "${joined.name}"`, [...joined.members], "alliance");
    this.persist();
    return this.allianceView(joined);
  }

  /**
   * 0107 Phase B — the named-alliance BETRAYAL fold: when a houseguest takes a binding ADVERSE action
   * (nominate / replace / vote-evict) against someone they share a named alliance with, that betrayal
   * cuts deeper than an unspoken one — a bounded threat ▲ / affinity ▼ on the wronged → betrayer edge, a
   * jury demerit, a witnessed reveal, and the betrayer leaves the alliance (it fractures). Gated by a
   * SHARED alliance existing ⇒ no alliances ⇒ no fold ⇒ the seeded spine is byte-identical.
   */
  private reconcileAllianceBetrayals(action: BindingAction): void {
    if (!this.live || !ALLIANCE_ADVERSE.has(action.kind)) return;
    for (const target of action.targets) {
      if (target === action.actor) continue;
      for (const al of this.alliances.shared(action.actor, target)) {
        const e = this.rel.edge(target, action.actor);
        e.threat = Math.min(1, e.threat + ALLIANCE.betrayalThreatBump);
        e.affinity = Math.max(0, e.affinity - ALLIANCE.betrayalThreatBump);
        recordDealBetrayal(this.live, target, action.actor);
        // A7/E12: mirrors the deal-break seal below — a betrayal TRIGGERED by the SEALED eviction
        // ballot must not name the betrayer to the wronged ally before the retrospective unseals it
        // (nominate/replace are public ceremonies and reveal normally; the player's OWN vote is never
        // sealed from themselves).
        if (action.kind === "vote-evict" && action.actor !== PLAYER) {
          this.onPlayerEvent?.(
            `${this.nameOf(action.actor)} turned on the alliance "${al.name}", moving against ${this.nameOf(target)}`,
            [action.actor], "betrayal", // no player witness ⇒ Vault-held until the 0048 unseal
          );
          this.onPlayerEvent?.(
            `Someone turned on the alliance "${al.name}"`,
            [target], "betrayal",
          );
        } else {
          this.onPlayerEvent?.(
            `${this.nameOf(action.actor)} turned on the alliance "${al.name}", moving against ${this.nameOf(target)}`,
            [target, action.actor], "betrayal",
          );
        }
        this.alliances.removeMember(al.id, action.actor); // the betrayer is out — the alliance fractures
      }
    }
  }

  /**
   * 0075 — the trust-gated confidence (the single authority). The model presses the ally and calls this;
   * the ENGINE decides everything (whether they open up, how much, true or a lie) and RECORDS the
   * disclosure as the player's knowledge. Vault-safe by construction: an undisclosed secret is never
   * handed to the model; a sub-`full` tier never returns the whole premise; a lie is engine-authored
   * from the public archetype (no real secret of anyone). Monotonic for a true confidence.
   */
  confide(npcId: EntityId, expectedBeatSeq?: number): ConfideResult | null {
    // 0065 Part A — refuse a confidence computed against a superseded board BEFORE any mutation.
    this.guardBeatSeq(expectedBeatSeq);
    if (!this.house || !this.live) return null;
    const npc = this.house.npcs.find((n) => n.id === npcId);
    const evicted = new Set(this.live.evictionOrder);
    if (!npc || evicted.has(npcId)) return null; // unknown / departed ⇒ no confidence path
    const secret = this.headlineSecretOf(npc);
    const none: ConfideResult = { disclosed: false, tier: "none", truthful: true };
    if (!secret) return none; // nothing sealed to share

    const signals = this.confidenceSignalsFor(npc);
    // Deterministic, seeded per (npc, beat): repeated presses inside one beat reach the same decision;
    // a later press (bond grown, a new week) re-rolls. No raw rng leaks the outcome (anti-sycophancy).
    const rng = new SeededRandom(hashSeed(`${this.gameSeed ?? 0}:confide:${npcId}:${this.week}:${this.phase}`));
    const decision = decideConfidence(signals, rng, { liesRemaining: CONFIDENCE.maxLiesPerSeason - this.lieCount });
    if (!decision.disclosed) return none;

    // Monotonic: never re-tell a TRUE secret at a LOWER tier than already reached — idempotent, no new
    // fold (the house's memory only deepens; it never thins, 0007/0030). A lie is its own track.
    const prior = this.confideState[npcId];
    if (decision.truthful && prior?.truthful
      && this.tierRank(decision.tier) <= this.tierRank(prior.tier)) {
      return { disclosed: true, tier: prior.tier, truthful: true, content: discloseTrue(secret, prior.tier) };
    }

    // 0075 — the PASSIVE LIE-CATCH (spec open-Q #4). A genuine, truthful disclosure from a houseguest who
    // PREVIOUSLY planted a lie is the contradicting truth finally reaching the player through a real
    // pathway (they bonded, and now tell the real thing). The earlier false belief flips to the truth
    // (recorded below at the higher truthful confidence), and the realization folds a BETRAYAL-grade blow
    // on the player's read of the liar — in place of the warm bond bump (you do not warmly bond on the
    // beat you catch them out). The player lever only ⇒ never on the seeded sim path ⇒ byte-identical.
    const catchingLie = decision.truthful && prior?.truthful === false;

    const content = decision.truthful ? discloseTrue(secret, decision.tier) : fabricate(rng, secret.kind);
    // Record it as the player's knowledge through the in-game `told-by` pathway (0002, E9) — so it is
    // correctly Journal-visible knowledge, never Vault content. A lie is recorded the same way (the
    // player believes it); the engine knows it is false (`confideState.truthful`).
    this.onConfide?.(npcId, content, decision.truthful ? 0.85 : 0.6);
    if (catchingLie) {
      // The player catches the earlier lie: a betrayal-grade blow on the player→liar edge (0026 IMPACT.betrayal).
      this.rel.applyDirected(PLAYER, npcId, "betrayal", rng);
    } else {
      // Fold the vulnerability bond bump (0023): opening up DEEPENS the bond toward the player.
      foldHiddenImpact(this.rel, rng, npcId, [npcId, PLAYER], CONFIDENCE.bondNature, [PLAYER]);
    }
    if (!decision.truthful) this.lieCount++;
    this.confideState[npcId] = { tier: decision.tier, truthful: decision.truthful };
    this.persist();
    return { disclosed: true, tier: decision.tier, truthful: decision.truthful, content };
  }

  /**
   * 0093 — OUT a learned secret to the house (the single engine authority). Validates the player
   * legitimately holds the `factId` (a non-learned secret is REJECTED — the Vault bright line; no
   * minting), caps per season, resolves the bounded, seeded standing hit on the subject (folded onto
   * EVERY other active houseguest's read of them — the house re-reads them as a liability) + the
   * betrayal-grade backlash on the exposer FROM the subject + the smaller house recoil + an optional
   * jury mark, RECORDS the exposure as a witnessed pathway event so the house now KNOWS it (0002 —
   * never a Vault read), and marks the secret SPENT (`usedAs: exposed` — never re-wielded). A `bluff`
   * is a separate path: a public CLAIM with no Vault read, folded on belief; the engine never tells the
   * player whether it matched a truth. No number ever crosses (anti-sycophancy). `null` pre-game.
   */
  exposeSecret(req: ExposeSecretReq): ExposeResult | null {
    this.guardBeatSeq(req.expectedBeatSeq);
    if (!this.house || !this.live) return null;
    // A real secret already exposed (public) can't be exposed again — checked BEFORE resolution (the
    // resolver rejects a spent fact as un-wieldable, which would otherwise read as `not-learned`).
    if (req.factId && this.secretUsedAs[req.factId] === "exposed") return { exposed: false, refused: "already-spent" };
    if (this.exposeCount >= LEVERAGE.maxExposesPerSeason) return { exposed: false, refused: "capped" };
    const resolved = this.resolveWieldedSecret({ factId: req.factId, bluff: req.bluff, subject: req.subject });
    if (!resolved) return { exposed: false, refused: req.bluff ? "no-subject" : "not-learned" };
    const subject = resolved.subject;
    const rng = this.secretRng("expose", resolved.factId ?? `bluff:${subject}`);
    if (resolved.bluff) {
      this.playerBluffCount = Math.min(this.playerBluffCount + 1, LEVERAGE.maxPlayerBluffsPerSeason + 1);
      // A public bluff lands by the HOUSE's average willingness to believe a claim about the subject —
      // plausibility on their collective threat read. If it bounces, the exposer just takes the recoil
      // (crying wolf), no subject hit. The engine never reveals whether it matched a real truth.
      const houseThreat = this.avgHouseThreatOf(subject);
      if (!bluffBelieved(this.avgHouseTrustOfPlayer(), houseThreat, rng)) {
        // Disbelieved — only the exposer recoil (a thin ruthlessness/credibility cost), no standing hit.
        this.foldHouseRecoilOnExposer(subject, rng);
        this.exposeCount++;
        this.persist();
        return { exposed: true, subjectImpactNarratable: "the house didn't seem to buy it" };
      }
    }
    const folds = exposeOutcome(resolved.severity, rng);
    // The standing hit: EVERY other active houseguest re-reads the subject as a liability (bounded fold).
    const evicted = new Set(this.live.evictionOrder);
    for (const other of this.house.npcs) {
      if (other.id === subject || evicted.has(other.id)) continue;
      this.rel.applyImpactDirected(other.id, subject, folds.subjectHit, rng);
      if (resolved.bluff) {
        // A believed BLUFF expose: record it against each houseguest so a later contradicting TRUTH catches it.
        this.recordPlayerBluffBelief(other.id, subject);
      } else {
        // A REAL expose DELIVERS the truth to the house — it CATCHES any earlier bluff about this subject.
        this.catchPlayerBluff(other.id, subject, rng);
      }
    }
    // The exposer takes the betrayal-grade hit FROM the subject (the deepest wound — outing IS betrayal).
    this.rel.applyImpactDirected(subject, PLAYER, folds.exposerBacklashFromSubject, rng);
    // The rest of the house recoils a little from the exposer (ruthlessness read).
    this.foldHouseRecoilOnExposer(subject, rng);
    // The jury mark (0014): the subject's eventual jurors weigh the outing against the exposer.
    if (folds.juryMark) recordDealBetrayal(this.live, subject, PLAYER);
    // Surface the exposure to the house as a WITNESSED pathway event — the house now KNOWS it (0002).
    const content = resolved.bluff ? `${this.nameOf(PLAYER)} outed something about ${this.nameOf(subject)} to the house`
      : this.factContentFor(resolved.factId!) ?? `${this.nameOf(PLAYER)} exposed a secret about ${this.nameOf(subject)}`;
    this.exposeToHouse(subject, content, resolved.bluff ? 0.6 : 0.85);
    // Mark the REAL secret SPENT (public ⇒ never re-leveraged). A bluff is not a real fact to mark.
    if (resolved.factId) this.secretUsedAs[resolved.factId] = "exposed";
    this.exposeCount++;
    this.persist();
    return { exposed: true, subjectImpactNarratable: "the house is reeling from it" };
  }

  /**
   * 0099 — TRADE a held secret to a THIRD-PARTY recipient for a one-off concession (a comp throw, a
   * secret-for-secret swap). The single engine authority — see `resolveAndTrade` for the resolution; this
   * is the public lever for a NON-deal trade (a standing deal uses `makeDeal`'s `tradedSecret`). `null`
   * pre-game / for an unknown recipient.
   */
  tradeSecret(req: TradeSecretReq): TradeResult | null {
    this.guardBeatSeq(req.expectedBeatSeq);
    if (!this.house || !this.live) return null;
    const out = this.resolveAndTrade(
      { factId: req.factId, bluff: req.bluff, subject: req.subject }, req.toNpcId, "swap",
    );
    if (!out) return { accepted: false, refused: "no-recipient" };
    this.persist();
    return out;
  }

  /** 0093 — the rest of the house recoils a little from the EXPOSER (outing reads as ruthless). */
  private foldHouseRecoilOnExposer(subject: EntityId, rng: SeededRandom): void {
    if (!this.house || !this.live) return;
    const evicted = new Set(this.live.evictionOrder);
    for (const other of this.house.npcs) {
      if (other.id === subject || evicted.has(other.id)) continue;
      this.rel.applyImpactDirected(other.id, PLAYER, LEVERAGE.exposerBacklashFromHouse, rng);
    }
  }

  /** 0093 — surface an exposed secret to EVERY other active houseguest as witnessed knowledge (0002). The
   *  player is the teller (`told-by:player`): the house learns it BECAUSE the player outed it — a recorded
   *  in-game pathway anchored on the player's own held content (E9), never a Vault read. */
  private exposeToHouse(subject: EntityId, content: string, confidence: number): void {
    if (!this.house || !this.live) return;
    const evicted = new Set(this.live.evictionOrder);
    for (const other of this.house.npcs) {
      if (other.id === subject || evicted.has(other.id)) continue;
      this.onSurfaceToHouseguest?.(other.id, content, subject, `told-by:${PLAYER}`, confidence);
    }
  }

  /** 0093 — the house's average TRUST in the player (a bluff's believability proxy). */
  private avgHouseTrustOfPlayer(): number {
    if (!this.house || !this.live) return 0;
    const evicted = new Set(this.live.evictionOrder);
    const npcs = this.house.npcs.filter((n) => !evicted.has(n.id));
    if (!npcs.length) return 0;
    return npcs.reduce((s, n) => s + this.rel.edge(n.id, PLAYER).trust, 0) / npcs.length;
  }

  /** 0093 — the house's average THREAT read of a subject (a bluff's plausibility proxy). */
  private avgHouseThreatOf(subject: EntityId): number {
    if (!this.house || !this.live) return 0.5;
    const evicted = new Set(this.live.evictionOrder);
    const npcs = this.house.npcs.filter((n) => !evicted.has(n.id) && n.id !== subject);
    if (!npcs.length) return 0.5;
    return npcs.reduce((s, n) => s + this.rel.edge(n.id, subject).threat, 0) / npcs.length;
  }

  /** 0075 — the headline sealed secret a houseguest would confide (their first hidden element). */
  private headlineSecretOf(npc: { character: { hiddenElements?: HiddenElement[] } }): HiddenElement | undefined {
    // 0091 — a TRIGGER is a volatility, not a confidable fact: it ERUPTS (a witnessed public consequence,
    // 0091), it is never TOLD (the 0075 confidence path). So a confidence is drawn from the first NON-trigger
    // hidden element — the trigger's sealed wording NEVER crosses the confidence pathway (the inverse
    // companion to 0075: in 0091 the attribute itself stays fully sealed; only its effect is seen).
    return npc.character.hiddenElements?.find((e) => e.kind !== "trigger");
  }

  /** 0075 — assemble the Vault-hidden confidence signals from the existing relationship + deal ledger. */
  private confidenceSignalsFor(npc: { id: EntityId; character: { archetype: string } }): ConfidenceSignals {
    const npcToPlayer = this.rel.edge(npc.id, PLAYER);
    const playerToNpc = this.rel.edge(PLAYER, npc.id);
    return {
      npcTrust: npcToPlayer.trust,
      npcAffinity: npcToPlayer.affinity,
      npcThreat: npcToPlayer.threat,
      playerTrust: playerToNpc.trust,
      playerAffinity: playerToNpc.affinity,
      goodwill: this.goodwillFromDeals(npc.id),
      archetype: npc.character.archetype,
    };
  }

  /**
   * 0075 — the banked-goodwill scalar ∈ [0,1] derived from the 0039 deal ledger (NOT a new authored
   * signal): kept word + an open pact build it, a broken deal subtracts. Bounded by `CONFIDENCE`.
   */
  private goodwillFromDeals(npcId: EntityId): number {
    const between = this.deals.forParty(PLAYER).filter((d) => d.parties.includes(npcId));
    let g = 0;
    for (const d of between) {
      if (d.status === "kept") g += CONFIDENCE.keptDealGoodwill;
      else if (d.status === "open") g += CONFIDENCE.openDealGoodwill;
      else if (d.status === "broken") g -= CONFIDENCE.brokenDealPenalty;
    }
    // 0107: a NAMED alliance the player shares with this houseguest banks a little good favor (bounded,
    // saturation-diluted) — the "easy favor with your allies" lever. 0 when they share none.
    g += allianceFavor(this.alliances.all(), npcId, PLAYER);
    return Math.max(0, Math.min(1, g));
  }

  /** 0075 — order the disclosure tiers for the monotonic guard (none < tease < partial < full). */
  private tierRank(tier: DisclosureTier): number {
    return { none: 0, tease: 1, partial: 2, full: 3 }[tier];
  }

  /**
   * 0075 — the Vault-SAFE `mayConfide` hint for `npcVoice` (the emergent "no cold open" path). Present
   * ONLY when the genuine disclosure motive clears the floor AND a fresh precipitating event makes the
   * moment plausible (a recent player-witnessed scene with this houseguest). Carries a `reason` word +
   * a `warmth` word — NEVER the secret, NEVER a number. Returns `undefined` otherwise (the common case).
   */
  private mayConfideFor(npc: { id: EntityId; character: { archetype: string } }): NpcVoiceView["mayConfide"] {
    if (!this.onConfide) return undefined; // no pathway wired ⇒ no emergent hint (e.g. bare unit harness)
    const signals = this.confidenceSignalsFor(npc);
    const motive = disclosureMotive(signals);
    if (disclosureTier(motive) === "none") return undefined; // below the floor ⇒ not ready
    // The motive must be carried by GENUINE closeness, not the strategic-lie pull — the hint invites a
    // real opening (a lie still routes through `confide`, but it is never advertised as readiness).
    if (!this.recentPlayerSceneWith(npc.id)) return undefined; // not earned by the scene ⇒ no cold open
    const between = this.deals.forParty(PLAYER).filter((d) => d.parties.includes(npc.id));
    const reason = between.some((d) => d.status === "kept") ? CONFIDENCE.reasons.keptWord
      : between.some((d) => d.status === "open") ? CONFIDENCE.reasons.openPact
        : CONFIDENCE.reasons.closeness;
    return { ready: true, reason, warmth: motive >= CONFIDENCE.bands.full ? "high" : "growing" };
  }

  /**
   * 0075 — was there a FRESH precipitating scene between the player and this houseguest (a favor, a
   * rattled moment, a deal just struck)? The "no cold open" anchor: a confidence reads as prompted by
   * what just happened, never a non-sequitur. Vault-free — reads only the recent player-witnessed
   * relationship history the adapter already tracks (an open/kept deal between them is the concrete
   * proxy a precipitating favor leaves behind).
   */
  private recentPlayerSceneWith(npcId: EntityId): boolean {
    return this.deals.forParty(PLAYER).some(
      (d) => d.parties.includes(npcId) && (d.status === "open" || d.status === "kept"),
    );
  }

  /** Reconcile a binding action against open player-party deals: kept/broken + the fallout (0039). */
  private reconcileDeals(action: BindingAction): void {
    if (!this.live) return;
    const { broken } = this.deals.reconcile(action, {
      rel: this.rel,
      rng: this.beatRng(),
      // 0014: the wronged party will weigh this betrayal against the breaker in their jury lean.
      juryDemerit: (wronged, breaker) => recordDealBetrayal(this.live!, wronged, breaker),
      // 0002: the wronged party learns the break as a witnessed event (a public ceremony break) —
      // UNLESS the triggering action is the SEALED eviction ballot (E12/A7). Naming the breaker there
      // would deanonymize their vote before the same terminal gate the primary eviction reveal and the
      // 0048 retrospective use: record the full attribution VAULT-SIDE (no player witness ⇒ hidden by
      // the event-visibility invariant, `validateEvent`), and give the wronged party only a Vault-safe,
      // unattributed signal now — they may suspect, never know, until the retrospective unseals it (the
      // same hidden-event sweep, `buildVaultUnseal`, already surfaces it then). The player's OWN vote is
      // never sealed from themselves, and a break from a PUBLIC action (nominate/replace) reveals as before.
      reveal: (wronged, breaker, deal, actionKind) => {
        if (actionKind === "vote-evict" && breaker !== PLAYER) {
          this.onPlayerEvent?.(
            `${this.nameOf(breaker)} broke a ${deal.kind} deal with ${this.nameOf(wronged)}`,
            [breaker], "betrayal", // no player witness ⇒ Vault-held until the 0048 unseal
          );
          return this.onPlayerEvent?.(
            `Someone broke a ${deal.kind} deal with ${this.nameOf(wronged)}`,
            [wronged], "betrayal",
          );
        }
        return this.onPlayerEvent?.(
          `${this.nameOf(breaker)} broke a ${deal.kind} deal with ${this.nameOf(wronged)}`,
          [wronged, breaker], "betrayal",
        );
      },
    });
    if (broken.length > 0) this.persist(); // deferred into the beat's ONE commit (E3)
  }

  /**
   * EVERY binding action a resolved beat represents (audit E42 — the ledger must see NPC binding
   * actions, not only the player's). An eviction beat yields one `vote-evict` per voter (player
   * and NPC alike, from the staged reveal's `voteOf`) plus the HOH's deciding vote on a tie; the
   * Final-3 eviction is the final HOH's personal vote. `alternatives` (E43) scope honoring to
   * actions where the partner was a real option.
   */
  private bindingActionsFor(ev: BeatEvent): BindingAction[] {
    const s = this.live;
    if (!s) return [];
    switch (ev.beat) {
      case "nominations":
        return s.hoh && s.nominees
          ? [{
              actor: s.hoh, kind: "nominate", targets: [...s.nominees],
              alternatives: s.active.filter((h) => h !== s.hoh),
            }]
          : [];
      case "veto-ceremony":
        return s.hoh && s.replacement ? [{ actor: s.hoh, kind: "replace", targets: [s.replacement] }] : [];
      case "eviction": {
        const e = s.eviction;
        const evictee = ev.participants[0];
        if (!e || !evictee) return [];
        const actions: BindingAction[] = Object.entries(e.voteOf).map(([voter, votedFor]) => ({
          actor: voter as EntityId, kind: "vote-evict", targets: [votedFor], alternatives: e.nominees,
        }));
        // A tied reveal means the HOH cast the deciding vote (player OR NPC) — that is binding too.
        const votes = Object.values(e.voteOf);
        const tied = votes.filter((v) => v === e.nominees[0]).length === votes.filter((v) => v === e.nominees[1]).length;
        if (tied && s.hoh) {
          actions.push({ actor: s.hoh, kind: "vote-evict", targets: [evictee], alternatives: e.nominees });
        }
        return actions;
      }
      case "final-eviction": {
        // Final 3 (0045): the final HOH personally evicts — participants = [hoh, evictee]; the
        // survivor (now in the Final 2 with them) was the alternative they spared.
        const [actor, evictee] = ev.participants;
        if (!actor || !evictee) return [];
        const survivor = s.active.find((h) => h !== actor);
        return [{
          actor, kind: "vote-evict", targets: [evictee],
          alternatives: survivor ? [evictee, survivor] : [evictee],
        }];
      }
      default:
        return [];
    }
  }

  /** Fold a resolved beat into the public projection: record the event, reconcile deals, sync, persist. */
  private commit(ev: BeatEvent | null): void {
    if (ev) this.onEvent?.({ ...ev, content: this.humanize(ev.content) });
    // 0039/E42: a binding ceremony beat may honor or break open deals — the engine adjudicates
    // EVERY binding actor's action (NPC votes and tie-breaks included), never only the player's.
    if (ev) for (const action of this.bindingActionsFor(ev)) { this.reconcileDeals(action); this.reconcileAllianceBetrayals(action); }
    // 0040/E55: at the week's dramatic beats the directly-involved houseguests privately confess
    // their REAL engine-grounded read — Vault-only (witnessed by them alone), reaching no one.
    if (ev) this.recordCeremonyConfessionals(ev);
    // E46: as the block goes up, the tightest unbound NPC pair may seal a hidden pact of their own.
    if (ev && ev.beat === "nominations") this.mintNpcDeal();
    // 0041: the season changes a houseguest — fold the beat's emotional impact into the involved souls
    // (a comp win emboldens; a blindside rattles), evolving the hidden arc that bends their later play.
    if (ev) this.evolveFromBeat(ev);
    // B38/0023: the loop's most consequential acts (noms/veto/replacement/eviction/comp wins) move the
    // HIDDEN relationship layer — the player's action changes how the house feels about them (and each
    // other). Engine-owned, magnitudes from constants, never surfaced (the Vault Wall, 0001).
    if (ev) this.foldCeremonyConsequence(ev);
    // B51/audit C5: on the WEEK ROLLOVER (the eviction's result lands → a new week begins) untended
    // relationships decay slowly toward baseline — grudges and bonds fade if not refreshed, so the house
    // doesn't pin to extremes over a season. Slow (`DECAY_RATE`), disposition-scaled, threat lingers.
    // E43: week-scoped promises whose week just passed un-broken resolve KEPT at the same boundary.
    if (ev && ev.beat === "eviction-result") {
      this.rel.decay(RELATIONSHIP_CONSTANTS.DECAY_RATE);
      this.deals.expireWeekScoped(this.live?.week ?? 0);
    }
    this.syncProjection();
    this.prunePresence(); // the just-evicted occupy no room (0049)
    this.persist();
  }

  /** The beats whose directly-involved houseguests confess (E55: noms, the veto ceremony, eviction). */
  private confessorsFor(ev: BeatEvent): { involved: EntityId[]; trigger: string } | null {
    const s = this.live;
    if (!s) return null;
    switch (ev.beat) {
      case "nominations":
        return {
          involved: [s.hoh, ...(s.nominees ?? [])].filter((id): id is EntityId => !!id),
          trigger: "the nomination ceremony",
        };
      case "veto-ceremony":
        return {
          involved: [s.vetoHolder, s.saved, s.replacement, s.hoh].filter((id): id is EntityId => !!id),
          trigger: "the veto ceremony",
        };
      case "eviction": {
        // The survivors of the vote confess: the HOH whose week it was + the nominee who stayed.
        const survivor = s.eviction?.nominees.find((n) => n !== ev.participants[0]);
        return {
          involved: [s.hoh, survivor].filter((id): id is EntityId => !!id),
          trigger: "the eviction vote",
        };
      }
      default:
        return null;
    }
  }

  /**
   * Record each involved NPC's Vault-only confessional at the week's dramatic beats (0040, extended
   * by audit E55): STRUCTURED — it names its trigger, carries the confessor's soul mood, varies its
   * phrasing by seed — and now reaches the NPC's own SOUL (audit C12: `recordConfessionalToSoul` +
   * the durable `soul.memory` mirror), so a houseguest can recall their own past confessionals.
   */
  private recordCeremonyConfessionals(ev: BeatEvent): void {
    const s = this.live;
    if (!s || !this.house || !this.onPlayerEvent) return;
    const at = this.confessorsFor(ev);
    if (!at) return;
    const everyone = [this.house.player.id, ...this.house.npcs.map((n) => n.id)];
    // 0089 — the confessor's OWN witnessed events (the just-recorded ceremony beat is already in the
    // log: `commit` records it via `onEvent` before this runs). `selectRecentForConfessional` filters
    // to `witnessedBy: npc` itself and returns only Vault-safe class-keyed gists, so a confessional
    // reacts to what THIS houseguest lived — never another's hidden read (mandate #2/#3). The seeded
    // tiebreak rng is dedicated (same `confessional:` family), never the shared society/vote stream, so
    // the calibration spine stays byte-identical (the selection draws no rng unless two events fully tie).
    const allEvents = this.record?.events() ?? [];
    const ctxFor = (npc: EntityId): ConfessionalContext => {
      const recentRng = new SeededRandom(hashSeed(`${this.gameSeed ?? ""}:confessional:${npc}:${s.week}:${ev.beat}`));
      // 0090 — the confessor's PUBLIC, byte-stable voice fingerprint, so their confessional reads in
      // THEIR voice (curt vs. expansive phrasing) instead of one uniform template. Voice is public
      // identity (no Vault, no number); a pre-0084 NPC simply has none ⇒ the templated fallback.
      const voice = this.house?.npcs.find((n) => n.id === npc)?.character.voice;
      return {
        trigger: at.trigger,
        recentEvents: selectRecentForConfessional(allEvents, npc, allEvents.length, { rng: recentRng }),
        ...(this.soulObj(npc) ? { emotionalState: this.soulObj(npc)!.emotionalState } : {}),
        ...(voice !== undefined ? { voice } : {}),
        // #845 companion — bake the DISPLAY NAME into the confessional content. Without this, a
        // confessional that targets the PLAYER would render the bare token "player" even in a named game
        // (the retrospective scrubber resolves colon-bearing ids ONLY, leaving `player` as prose). `nameOf`
        // yields the public roster name (player or NPC); it reads no Vault state.
        nameOf: (id) => this.nameOf(id),
        rng: new SeededRandom(hashSeed(`${this.gameSeed ?? ""}:confessional:${npc}:${s.week}:${ev.beat}`)),
      };
    };
    for (const conf of involvedConfessionals(at.involved, everyone, this.rel, ctxFor)) {
      // witnessSet = [the confessing NPC] → hidden=true (the player is never a witness, 0002).
      this.onPlayerEvent(conf.content, [conf.npc], "confessional");
      // C12: the confessional deepens the confessor's own recall-able soul (0024/0040) — durable
      // via the soul.memory mirror (rebuildSoulIndex replays it after a restart, 0030).
      this.soulObj(conf.npc)?.memory.push(conf.content);
      if (this.soul) recordConfessionalToSoul(this.soul, conf);
    }
  }

  /**
   * NPC↔NPC deals exist (audit E46): at the nomination ceremony, the tightest UNBOUND pair of
   * living NPCs occasionally seals a pact of their own — Vault-held (the made event's witness set
   * excludes the player ⇒ hidden, 0002), binding through the SAME ledger the votes reconcile
   * against (E42), with full break consequences (betrayal fold, jury demerit, hidden reveal).
   * Seeded + bounded by `DECISION.npcDeal`; the player learns of one only along a pathway.
   */
  private mintNpcDeal(): void {
    const s = this.live;
    if (!s || !this.house || !this.onPlayerEvent) return;
    const D = DECISION.npcDeal;
    const rng = new SeededRandom(hashSeed(`${this.gameSeed ?? ""}:npc-deal:${s.week}`));
    if (rng.next() >= D.mintProb) return;
    const npcs = s.active.filter((id) => id !== PLAYER);
    const bound = (a: EntityId, b: EntityId): boolean =>
      this.deals.open().some((d) => d.parties.includes(a) && d.parties.includes(b));
    let best: [EntityId, EntityId] | null = null;
    let bestTrust: number = D.mutualTrustMin;
    for (let i = 0; i < npcs.length; i++) {
      for (let j = i + 1; j < npcs.length; j++) {
        const a = npcs[i]!, b = npcs[j]!;
        if (bound(a, b)) continue;
        const mutual = Math.min(this.rel.edge(a, b).trust, this.rel.edge(b, a).trust);
        if (mutual >= bestTrust) { bestTrust = mutual; best = [a, b]; }
      }
    }
    if (!best) return;
    const kind = bestTrust >= D.finalTwoTrustMin ? "final-two" : "safety";
    const [a, b] = best;
    // A vague paraphrase, not hidden numbers — but still Vault-held (no player witness).
    const evId = this.onPlayerEvent(
      `${this.nameOf(a)} and ${this.nameOf(b)} quietly seal a ${kind} pact`,
      [a, b], "deal",
    );
    this.deals.make(best, kind, "a quiet pact sealed away from the cameras", evId, s.week);
  }

  /**
   * Vault-free projection of a player-party deal: parties (names) + kind + terms + status. No numbers.
   * A7/E12: a deal `sealedBallot` marks broken — via the SEALED eviction ballot, not the player's own
   * vote — projects as still "open" until the season finishes: the raw internal `d.status` ("broken")
   * would otherwise deanonymize the breaker's vote on the very next HUD poll (the player already knows
   * exactly who their deal partner is, so the status flip alone is the leak). The retrospective (0048)
   * lifts the seal the same way it unseals everything else — the underlying `d.status` itself is never
   * altered, only this outward render.
   */
  private dealView(d: Deal): DealView {
    const sealed = d.sealedBallot && !this.live?.finished;
    return {
      id: d.id,
      parties: d.parties.map((id) => ({ id, name: this.nameOf(id) })),
      kind: d.kind,
      terms: d.terms,
      status: sealed ? "open" : d.status,
    };
  }

  /** Project the live-loop state onto the public week/phase/ceremony the status panel reads. */
  private syncProjection(): void {
    const s = this.live;
    if (!s) return;
    // 0088: detect week advance — snapshot the NPC→player bond as the drift anchor
    // so "warming"/"cooling" reads relative to start-of-week.
    const weekChanged = s.week !== this.week;
    this.week = s.week;
    this.phase = s.finished ? "finale" : s.beat;
    this.ceremony = {
      hoh: s.hoh,
      nominees: (s.finalNominees ?? s.nominees ?? []).slice(),
      vetoHolder: s.vetoHolder,
      vetoUsed: s.vetoUsed,
    };
    if (weekChanged && this.house) {
      const playerId = this.house.player.id;
      const evicted = new Set(this.live?.evictionOrder ?? []);
      for (const npc of this.house.npcs) {
        if (!evicted.has(npc.id)) {
          const bond = (this.rel.edge(npc.id, playerId).trust + this.rel.edge(npc.id, playerId).affinity) / 2;
          this.readAnchors.set(npc.id, bond);
        }
      }
    }
  }

  private toDecisionInput(req: SubmitDecisionReq): DecisionInput {
    switch (req.kind) {
      case "nominations": {
        const c = req.choice ?? [];
        if (c.length !== 2) throw new Error("nominations require exactly two houseguests");
        return { kind: "nominations", choice: [c[0]!, c[1]!] };
      }
      case "veto-decision":
        return { kind: "veto-decision", use: !!req.use, ...(req.save ? { save: req.save } : {}) };
      case "comp-intent":
      case "comp-round": { // B46 / 0006 staged-rounds: the player declares compete/throw/play-safe.
        // The pending presents this as a generic options/pick decision (id = the intent value), so a
        // caller may submit it as `intent`, `vote`, OR `choice` like every other options/pick decision.
        // `singlePickId` covers `vote`/`choice`; `intent` stays first (R4-02 — `choice` was rejected).
        const intent = (req.intent ?? singlePickId(req)) as Intent | undefined;
        if (!intent || !(COMP_INTENTS as readonly string[]).includes(intent)) throw new Error("a legal competition approach is required");
        return { kind: req.kind, intent };
      }
      case "houseguests-choice": { // B45: the player picks the sixth veto player (A10: `vote` or `choice`).
        const pick = singlePickId(req);
        if (!pick) throw new Error("a Houseguest's Choice pick is required");
        return { kind: "houseguests-choice", pick };
      }
      case "replacement": { // D5-1: accept `replacement`, `vote`, OR `choice` (the generic options/pick shape).
        const replacement = req.replacement ?? singlePickId(req);
        if (!replacement) throw new Error("a replacement nominee is required");
        return { kind: "replacement", replacement };
      }
      case "eviction-vote": { // D5-1: the most-repeated decision now accepts `vote` OR `choice` (A10/R4-02 parity).
        const vote = singlePickId(req);
        if (!vote) throw new Error("an eviction vote is required");
        return { kind: "eviction-vote", vote };
      }
      case "tie-break": { // B44: the player HOH breaks a tied eviction vote (A10: `vote` or `choice`).
        const evict = singlePickId(req);
        if (!evict) throw new Error("a tie-break vote is required");
        return { kind: "tie-break", evict };
      }
      case "final-eviction": { // Final 3 (0045): the final HOH evicts (A10: `vote` or `choice`).
        const evict = singlePickId(req);
        if (!evict) throw new Error("a final-eviction target is required");
        return { kind: "final-eviction", evict };
      }
      case "goodbye-message": { // E34: the tone is surfaced as options/pick, so accept `vote` OR `choice`
        // (B6-02 — `singlePickId` is the shared parity helper; a client using the generic `choice`
        // shape was hard-looping on a rejection, like comp-intent before R4-02).
        const tone = singlePickId(req) as GoodbyeTone | undefined;
        if (!tone || !(GOODBYE_TONES as readonly string[]).includes(tone)) {
          throw new Error("a legal goodbye tone is required (warm / respectful / cold)");
        }
        return { kind: "goodbye-message", tone, ...(req.statement ? { message: req.statement } : {}) };
      }
      // --- finale (0037) ---
      case "finale-statement":
        return { kind: "finale-statement", statement: req.statement ?? "" };
      case "juror-question": // E37: scoreless free text — nothing here can sway the tally.
        return { kind: "juror-question", question: req.statement ?? "" };
      case "finale-answer": {
        if (!req.appeal || !(FINALE_APPEALS as readonly string[]).includes(req.appeal)) {
          throw new Error("a legal finale appeal is required");
        }
        return { kind: "finale-answer", appeal: req.appeal as FinaleAppeal };
      }
      case "juror-vote": { // D5-1: the player-juror's finale vote accepts `vote` OR `choice` (A10 parity).
        const vote = singlePickId(req);
        if (!vote) throw new Error("a juror vote is required");
        return { kind: "juror-vote", vote };
      }
      case "self-evict": // 0061: intercepted in `submitDecision` BEFORE this map — never reached here.
        return { kind: "self-evict", confirmed: req.confirmed === true };
    }
  }

  private named(id?: EntityId): NamedRef | null {
    return id ? { id, name: this.nameOf(id) } : null;
  }

  private pendingView(): PendingDecisionView | null {
    const p = this.live?.pending;
    // 0061: surface the OOC self-evict CONFIRMATION. A ceremony pending is a hard stop and takes
    // priority (the in-flight ceremony resolves first, §4.6 — the confirmation waits); when the loop
    // is not blocked on a ceremony decision, the raised confirmation shows on the player-level channel.
    if (!p && this.live?.selfEvictPending && this.house) {
      const by = this.named(PLAYER)!;
      return {
        kind: "self-evict", by,
        prompt: "Leaving the game is final — a real walk-out you cannot undo. Confirm to self-evict and end your season, or cancel to stay in the house.",
        options: [], pick: 0,
      };
    }
    if (!p) return null;
    const by = this.named(p.by)!;
    const refs = (ids: EntityId[]): NamedRef[] => ids.map((id) => ({ id, name: this.nameOf(id) }));
    switch (p.kind) {
      case "nominations":
        return { kind: p.kind, by, prompt: "You are Head of Household — name two houseguests for eviction.", options: refs(p.options), pick: 2 };
      case "veto-decision":
        // The 0034 legal-options contract (E36): the options ARE the legally saveable nominees.
        // At Final 4 no replacement exists, so the set is EMPTY and the prompt says why — the
        // engine never offers "use" only to silently invert it into "does not use the veto".
        return p.saveable.length === 0
          ? { kind: p.kind, by, prompt: "You hold the Power of Veto — but no replacement nominee exists at Final 4, so the veto cannot change the nominations. Confirm leaving them standing.", options: [], pick: 1 }
          : { kind: p.kind, by, prompt: "You hold the Power of Veto — use it to save a nominee, or leave the nominations.", options: refs(p.saveable), pick: 1 };
      case "comp-intent":
        // The "options" ARE the three intents (id = the intent value), so the generic decision path
        // and the front-end both pick from them; the first ("compete") is the default (B46/audit B5).
        return { kind: p.kind, by, prompt: "Declare your approach to this competition: compete, throw, or play it safe.", options: COMP_INTENTS.map((i) => ({ id: i, name: i })), pick: 1 };
      case "comp-round": {
        // 0006 staged-rounds: the player's approach for THIS elimination round, seeing who is STILL IN.
        // Only the FIRST round BINDS (the intent the single outcome roll honors); later rounds are
        // non-binding FLAVOR over an already-decided result (audit 2026-06-20) — the prompt + the
        // `binding` flag tell the surface to present those as color, not a stakes decision.
        const stillIn = refs(p.stillIn);
        const others = stillIn.filter((r) => r.id !== PLAYER).map((r) => r.name);
        const fieldLine = others.length ? ` Still in with you: ${others.join(", ")}.` : " You are the last one in.";
        const prompt = p.binding
          ? `Set your approach to this competition: compete, throw (drop out), or play it safe.${fieldLine} This locks in how you play the comp.`
          : `The field narrows — ${stillIn.length} still standing.${fieldLine} Your approach is already locked from the first round, so this is just color: say how you're pushing through, or skip ahead.`;
        return {
          kind: p.kind, by, prompt,
          options: COMP_INTENTS.map((i) => ({ id: i, name: i })),
          round: p.round, stillIn, binding: p.binding, pick: 1,
        };
      }
      case "houseguests-choice":
        return { kind: p.kind, by, prompt: "You drew Houseguest's Choice — pick the sixth houseguest to play in the veto competition.", options: refs(p.options), pick: 1 };
      case "replacement":
        return { kind: p.kind, by, prompt: `You used the veto on ${this.nameOf((p as { saved: EntityId }).saved)} — name a replacement nominee.`, options: refs(p.options), pick: 1 };
      case "eviction-vote":
        return { kind: p.kind, by, prompt: "Cast your vote to evict one of the two nominees.", options: refs(p.nominees), pick: 1 };
      case "tie-break":
        return { kind: p.kind, by, prompt: "The eviction vote is tied — as Head of Household you cast the deciding vote.", options: refs(p.nominees), pick: 1 };
      case "final-eviction":
        return { kind: p.kind, by, prompt: "You are the final Head of Household — evict one houseguest; the other sits beside you at the Final 2.", options: refs(p.options), pick: 1 };
      // --- eviction night (E34): the player's own goodbye — tone is THEIR choice, never engine-read ---
      case "goodbye-message":
        return {
          kind: p.kind, by,
          prompt: `${this.nameOf(p.evictee)} has been evicted — record your goodbye message. Choose its tone; your own words carry it.`,
          options: p.tones.map((t) => ({ id: t, name: t })),
          evictee: this.named(p.evictee)!, pick: 1,
        };
      // --- finale (0037) ---
      case "finale-statement":
        return { kind: p.kind, by, prompt: "You are a finalist — give your opening statement to the jury.", options: [], pick: 0 };
      case "finale-answer":
        return {
          kind: p.kind, by,
          prompt: `${this.nameOf(p.juror)} asks you a question — choose how you make your case.`,
          options: [], appeals: [...p.appeals], juror: this.named(p.juror)!, pick: 1,
        };
      // --- finale (E37): the player-juror's own question (scoreless free text) ---
      case "juror-question":
        return {
          kind: p.kind, by,
          prompt: `You sit on the jury — ask ${this.nameOf(p.finalist)} your question. It sways nothing by itself; their answer is theirs.`,
          options: refs([p.finalist]), finalist: this.named(p.finalist)!, pick: 0,
        };
      case "juror-vote":
        return { kind: p.kind, by, prompt: "You sit on the jury — cast your vote for the winner.", options: refs(p.finalists), pick: 1 };
      case "self-evict":
        // 0061: the self-evict confirmation never lives on `this.live.pending` (it rides
        // `selfEvictPending`, surfaced above), so this branch is unreachable — handled for
        // type-exhaustiveness only.
        return { kind: p.kind, by, prompt: "Confirm to self-evict, or cancel to stay.", options: [], pick: 0 };
    }
  }

  private advanceView(ev: BeatEvent | null): AdvanceView {
    const s = this.live;
    return {
      started: this.house !== null,
      beatSeq: this.beatSeq, // 0065 Part A — the counter AFTER this advance/decision committed
      // EVT-1 (#569): project the beat's PUBLIC participants (id + name only) alongside the prose, so
      // ceremony result identities are structured, not prose-only. Vault-free — `participants` carries
      // public houseguest ids, never hidden state.
      event: ev
        ? { beat: ev.beat, content: this.humanize(ev.content), participants: ev.participants.map((id) => this.named(id)!) }
        : null,
      pending: this.pendingView(),
      status: this.gameStatus(),
      finished: !!s?.finished,
      winner: this.named(s?.winner),
      finale: this.finaleView(),
      eviction: this.evictionView(),
    };
  }

  /**
   * Vault-free projection of an in-progress weekly eviction (0047): the two nominees, the stage, and
   * the votes REVEALED SO FAR (`revealIx`) only — never an unread vote, never a pre-reveal tally, never
   * the evictee before the last vote lands. Null unless an eviction is actively staging.
   */
  private evictionView(): EvictionView | null {
    const e: EvictionProgress | undefined = this.live?.eviction;
    if (!e || this.live?.finished) return null;
    const ref = (id: EntityId): NamedRef => ({ id, name: this.nameOf(id) });
    return {
      stage: e.stage,
      nominees: e.nominees.map(ref),
      // E12: secret ballots — the projection carries the anonymized ballots read so far, never
      // the voter; the attribution unseals only in the post-season retrospective (0048).
      votesRevealed: e.revealOrder.slice(0, e.revealIx).map((voter) => ({
        votedFor: ref(e.voteOf[voter]!),
      })),
    };
  }

  /**
   * Vault-free projection of an in-progress finale (0037): names, the current stage, the
   * juror asking, and the votes REVEALED SO FAR (`revealIx`) only. No lean, no tally, no
   * manner, and no pre-reveal winner ever crosses — a juror's vote appears only after it is
   * revealed in order. Null unless the finale is actively staging.
   */
  finaleView(): FinaleView | null {
    const f: FinaleProgress | undefined = this.live?.finale;
    if (!f || this.live?.finished) return null;
    const ref = (id: EntityId): NamedRef => ({ id, name: this.nameOf(id) });
    const q = f.script.questions[f.questionIx];
    return {
      stage: f.stage,
      finalists: f.finalists.map(ref),
      asking: f.stage === "questions" && q ? ref(q.juror) : null,
      reveals: f.script.revealOrder.slice(0, f.revealIx).map((juror) => ({
        juror: ref(juror), votedFor: ref(f.votes![juror]!),
      })),
    };
  }

  /** Replace raw entity ids in a loop event string with the houseguests' public names.
   *  Delegates to the whole-token substituter so beat prose like "the veto players are drawn"
   *  is never mangled by the player's bare-word id "player" (audit A8). */
  private humanize(content: string): string {
    const all = this.house ? [this.house.player, ...this.house.npcs] : [];
    return humanizeIds(content, all);
  }

  /**
   * The POST-SEASON retrospective scrub (0048 — the Wall's ONE sanctioned reveal). Stronger than the
   * everyday `humanize`: it also resolves ids embedded in COMPOUND machine tokens (`thread:npc:8:0`),
   * drops the bare `thread:…` identifier, and translates the thread audit slugs (`[dormant]`, `surfaces
   * via:`, …) into readable prose — so the unsealed story reads like prose, not a debug dump. Used ONLY
   * here, behind the terminal-state gate.
   */
  private retroScrub(content: string): string {
    const all = this.house ? [this.house.player, ...this.house.npcs] : [];
    return humanizeForRetrospective(content, all);
  }

  getGameState(): GameStateView {
    return this.view();
  }

  /**
   * 0065 Part E — the `beatSeq`-keyed delta state feed. Given the caller's last-seen `beatSeq`, return
   * exactly WHAT CHANGED since: the player-visible events appended, the ceremony field transitions, and
   * any finished/winner flip — plus the freshest board to re-anchor on. A pure READ (no mutation).
   *
   * O(Δ): the per-beat checkpoint ring (`beatCheckpoints`) holds the event-log length + the board AS OF
   * `sinceBeatSeq`, so the delta slices ONLY the event tail (`visibleEventsSince(eventCountThen)`) and
   * diffs the ceremony against the captured snapshot — it never re-scans the whole log. VAULT-FREE: the
   * event tail comes through the player's witness-filtered visible projection (no hidden content), and
   * the board/changes are the same ceremony-level public facts `gameStatus` exposes.
   *
   * Full-refresh signal (never a guessed partial delta): the token is ahead of the current counter,
   * negative, or older than the retained window (e.g. after a restart, which empties the ring). Empty
   * delta: `sinceBeatSeq === current` — nothing committed since.
   */
  stateDelta(sinceBeatSeq: number): StateDeltaView {
    const board = this.gameStatus();
    const current = this.beatSeq;
    const empty = (fullRefresh: boolean): StateDeltaView => ({ beatSeq: current, fullRefresh, events: [], board });

    // Nothing committed since (the FE is already up to date) — an empty, non-refresh delta.
    if (sinceBeatSeq === current) return empty(false);
    // A token ahead of the current counter, or negative/malformed ⇒ full refresh (never guess forward).
    if (sinceBeatSeq < 0 || sinceBeatSeq > current) return empty(true);
    // A token older than the retained window (or after a restart, when the ring is empty) ⇒ full refresh.
    const cp = this.beatCheckpoints.get(sinceBeatSeq);
    if (!cp) return empty(true);

    // O(Δ) event tail: only the player-visible events appended AT OR AFTER the checkpoint's event count.
    // Without the registry-wired providers (a standalone adapter) we cannot fetch a Vault-safe tail, so
    // we fall back to a full refresh rather than risk an unscrubbed/over-broad projection.
    if (!this.deltaSource) return empty(true);
    const events = this.deltaSource.visibleEventsSince(cp.eventCount);
    this.deltaScanProbe?.(events.length); // diagnostic only — a count, never content (Part E perf guard)

    // Ceremony field diffs (only the fields that actually moved appear). Compare the captured board AS OF
    // `sinceBeatSeq` against the live ceremony — the same public ceremony-level facts `gameStatus` exposes.
    const changes: NonNullable<StateDeltaView["changes"]> = {};
    if (cp.week !== this.week) changes.week = { from: cp.week, to: this.week };
    if (cp.phase !== this.phase) changes.phase = { from: cp.phase, to: this.phase };
    if (cp.hoh !== this.ceremony.hoh) changes.hoh = { from: this.card(cp.hoh), to: this.card(this.ceremony.hoh) };
    if (!sameIds(cp.nominees, this.ceremony.nominees)) {
      changes.nominees = {
        from: cp.nominees.map((id) => ({ id, name: this.nameOf(id) })),
        to: this.ceremony.nominees.map((id) => ({ id, name: this.nameOf(id) })),
      };
    }
    if (cp.vetoHolder !== this.ceremony.vetoHolder) {
      changes.vetoHolder = { from: this.card(cp.vetoHolder), to: this.card(this.ceremony.vetoHolder) };
    }
    if (cp.vetoUsed !== this.ceremony.vetoUsed) changes.vetoUsed = { from: cp.vetoUsed, to: this.ceremony.vetoUsed };

    const finishedNow = !!this.live?.finished;
    const finishedChanged = cp.finished !== finishedNow || cp.winner !== this.live?.winner;
    const hasChanges = Object.keys(changes).length > 0;
    return {
      beatSeq: current,
      fullRefresh: false,
      events,
      ...(hasChanges ? { changes } : {}),
      ...(finishedChanged ? { finishedChanged: true } : {}),
      ...(finishedNow ? { winner: this.named(this.live?.winner) } : {}),
      board,
    };
  }

  getMomentPrompt(req: MomentPromptReq): MomentPromptView {
    const view = this.view();
    const moment = req.moment ?? view.moment;
    return {
      moment,
      systemPrompt: buildSystemPrompt(
        moment, view, this.storyFacts(moment), this.worldContext(moment), this.producerVoice(moment),
        this.freshSurfacedFacts(),
      ),
    };
  }

  /**
   * The producer persona for this season — a REAL generated character (as deep as any houseguest, built
   * by the same `CharacterFactory` machinery) but OFF-CAMERA: no headshot, not one of the 16, never in
   * the roster/portraits/whereabouts. Seeded for reproducibility. The interview runs PRE-GAME (before
   * there is a season seed), so the producer's seed is established LAZILY here the first time it's needed,
   * with real entropy, then PERSISTED — so the same producer is voiced every turn of the interview and
   * survives a restart, and `createCharacter` reuses the very same seed into the season. Cached.
   */
  private producer(): Producer {
    if (this.producerSeed === null) {
      // First need (pre-game): mint a stable seed and persist it, so the SAME producer is voiced for the
      // whole interview and survives a restart. (Once a game starts, the season seed is used — see below.)
      this.producerSeed = entropySeed();
      this.producerCache = null;
      this.persist();
    }
    if (!this.producerCache) this.producerCache = producerForSeed(this.producerSeed);
    return this.producerCache;
  }

  /**
   * The producer-persona block woven into the casting-interview prompt (facts to voice, ADR 0003): the
   * model voices THIS specific, seeded producer consistently. Present ONLY on the pre-game casting beat
   * (`character-creation`); every other moment is a houseguest/host beat with no producer voice. Vault-free
   * by construction — the producer carries only PUBLIC voice flavor, never a hidden number or secret.
   */
  private producerVoice(moment: string): string | undefined {
    if (moment !== "character-creation") return undefined;
    return renderProducerVoice(this.producer());
  }

  /**
   * The Vault-free "world you all moved in with" block (feature 0062, §5/§7) woven into the moment
   * prompt — built from the FROZEN persisted snapshot, scaled by the live week (the longer the season,
   * the more dated the house, §7). `social` (and any off-screen) moment gets the off-screen framing (the
   * C32-beyond delta — NPC-to-NPC life shares the same world); every other live moment gets the player
   * framing. Pre-game / no-snapshot ⇒ "" (the §8 fail-soft path; the prompt is unchanged). Public flavor
   * by construction — it reads ONLY the public snapshot, never a hidden number.
   */
  private worldContext(_moment: string): string | undefined {
    if (!this.worldSnapshot || !this.house) return undefined;
    // #580 (NARR-11, PO ruling 2026-06-23): getMomentPrompt is the PLAYER'S narration prompt —
    // every beat here is player-facing. Social/diary-room are player-PRESENT, so they take the
    // player-channel zeitgeist framing, not the off-screen "world you moved in with" framing.
    const channel = "player";
    // 0062 HOH music perk: the player has LIVE music only when they hold it — the reigning HOH (the real-BB
    // luxury) or in the HOH room overhearing it; otherwise the music slice is frozen memory like the rest.
    const block = renderZeitgeist(this.worldSnapshot, {
      week: this.week, channel, musicAccess: this.hasMusicPerk(this.house.player.id),
    });
    return block.length > 0 ? block : undefined;
  }

  /**
   * 0062 media-fidelity (the HOH music perk): who currently has LIVE music — the one live-media exception
   * in the sealed house. The reigning HOH gets the music luxury (real BB), and anyone in the HOH room
   * overhears it. No HOH (premiere / between reigns) ⇒ nobody. Reads ONLY public state (the HOH + room
   * co-presence already cross to the player via gameStatus/whereabouts), so it leaks nothing — and it is a
   * prompt-rendering read, never a game input, so the §6 outcome-invariance holds.
   */
  private hasMusicPerk(id: EntityId): boolean {
    const hoh = this.ceremony.hoh;
    if (!hoh) return false;
    if (id === hoh) return true;
    return this.presence?.get(id) === "hoh-room";
  }

  /**
   * The Vault-free projection of the move-in zeitgeist snapshot (feature 0062) — the FROZEN shared
   * real-world flavor the cast moved in WITH, plus the off-screen-channel "world you moved in with"
   * BLOCK an NPC-to-NPC society/gossip scene is colored by (§5, the C32-beyond delta). `null` pre-game
   * or when no snapshot was captured (the §8 fail-soft skip). Public, shared flavor — never Vault, never
   * a game input (§6): it carries no secret and no number, and reading it changes no outcome.
   */
  worldSnapshotView(): WorldSnapshotView | null {
    // The §8 ABSENT tier reads as "no snapshot present" — an absent snapshot has no voiceable content,
    // so the public view is null (it round-trips as absent). `hasZeitgeist` gates present-and-non-empty.
    if (!this.house || !hasZeitgeist(this.worldSnapshot)) return null;
    const snap = this.worldSnapshot;
    return {
      capturedFor: snap.capturedFor,
      source: snap.source,
      // PUBLIC slices only — `capturedAt`/`lagDays` are operational provenance, never surfaced.
      slices: cloneSession(snap.slices),
      offscreenPrompt: renderZeitgeist(snap, { week: this.week, channel: "offscreen" }),
    };
  }

  /**
   * The FE-owned write-back seam (feature 0062, §8) — the front-end (which owns the concrete `web_search`
   * provider, like the 0051 image port) captures a REAL move-in zeitgeist at season creation and writes
   * it back here so the ENGINE persists it as the single frozen artifact (it then RECALLS it, never
   * re-searches, §9). REPLACES the deterministic `model-framed` fallback for this season (idempotent),
   * freezing it byte-stable thereafter. Outward-safe by construction: the payload is PUBLIC real-world
   * flavor (§6) — no Vault handle, no secret, no game input. A no-op before a game starts (nothing to
   * freeze onto). The slices are bounded to the budget (§11 #3); empty slices keep the fallback's value
   * so a partial capture never thins the snapshot (non-degradation).
   */
  recordWorldSnapshot(req: RecordWorldSnapshotReq): RecordWorldSnapshotResult {
    if (!this.house || !this.worldSnapshot) return { accepted: false, source: "absent" };
    const base = this.worldSnapshot;
    const cap = ZEITGEIST.itemsPerSlice;
    const merge = (key: ZeitgeistSlice): string[] => {
      const incoming = req.slices?.[key];
      // Sanitize untrusted FE text (flatten control chars that could forge a prompt line; cap length +
      // count). An empty/absent slice keeps the fallback's value (non-degradation — never thin it).
      if (!Array.isArray(incoming) || incoming.length === 0) return [...base.slices[key]];
      return incoming
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .slice(0, cap)
        .map((s) => sanitizeFlavor(s));
    };
    const moodIn = typeof req.slices?.mood === "string" ? req.slices.mood : undefined;
    this.worldSnapshot = {
      capturedFor: typeof req.capturedFor === "string" && req.capturedFor.trim() ? sanitizeFlavor(req.capturedFor, 80) : base.capturedFor,
      capturedAt: typeof req.capturedAt === "string" ? sanitizeFlavor(req.capturedAt, 80) : base.capturedAt,
      lagDays: base.lagDays,
      source: "web_search",
      slices: {
        screen: merge("screen"), music: merge("music"), sports: merge("sports"),
        news: merge("news"), internet: merge("internet"),
        mood: moodIn && moodIn.trim() ? sanitizeFlavor(moodIn) : base.slices.mood,
      },
    };
    this.backgroundPersist(); // R-BND (#628): durable, but NOT a board beat — no beatSeq bump
    return { accepted: true, source: "web_search" };
  }

  /**
   * 0070 — called by the orchestrator after every off-screen tick to register the ids of the scenes
   * that were just recorded. TRANSIENT: the registry is replaced on each tick so only the MOST RECENT
   * batch is addressable via `getOffscreenSceneSkeletons`. The event store is the durable source of
   * truth; this is a convenience index for the current-tick FE fan-out only.
   */
  notifyOffscreenTick(eventIds: string[]): void {
    this.lastTickOffscreenIds = [...eventIds];
  }

  /**
   * 0070 — the Vault-free skeletons of the off-screen scenes recorded in the most recent tick.
   * Returns only public participant ids, interaction nature, and current prose content (either the
   * deterministic template or the voiced texture if a write-back has already landed). Never returns
   * hidden attributes, relationship numbers, or soul data. Returns [] before a game starts or when
   * no off-screen tick has run yet.
   */
  getOffscreenSceneSkeletons(): import("../../ports/GameSession").OffscreenSceneSkeleton[] {
    if (!this.house || this.lastTickOffscreenIds.length === 0) return [];
    const events = this.record?.events() ?? [];
    const byId = new Map(events.map((e) => [e.id, e]));
    const result: import("../../ports/GameSession").OffscreenSceneSkeleton[] = [];
    for (const id of this.lastTickOffscreenIds) {
      const ev = byId.get(id);
      if (!ev || !ev.hidden) continue; // only hidden events are part of the off-screen texture layer
      // Apply texture override if one exists; otherwise the deterministic template content stands.
      const prose = this.textureOverrides.get(id) ?? ev.content;
      result.push({
        eventId: ev.id,
        nature: ev.type,
        participants: [...ev.witnessSet], // public participant ids (no Vault content)
        templateContent: prose,
      });
    }
    return result;
  }

  /**
   * FE-driven write-back (0070): enrich the prose `content` of an already-recorded hidden off-screen
   * event with model-voiced texture. CONTENT ONLY — it cannot create an event, alter a witness set,
   * flip the hidden flag, or carry a relationship number. Idempotent; a no-op for an unknown or
   * non-hidden event (returns `{ ok: false }`). Fail-soft: a missing driver leaves the deterministic
   * template content intact.
   */
  recordOffscreenSceneTexture(req: import("../../ports/GameSession").RecordOffscreenSceneTextureReq): import("../../ports/GameSession").RecordOffscreenSceneTextureResult {
    const { eventId, content } = req;
    if (typeof eventId !== "string" || !eventId.trim()) return { ok: false };
    const sanitized = sanitizeFlavor(content, 1000);
    if (!sanitized) return { ok: false };
    // Verify the event exists, is hidden, and was not witnessed by the player — content-only guard.
    const events = this.record?.events() ?? [];
    const ev = events.find((e) => e.id === eventId);
    if (!ev || !ev.hidden) return { ok: false };
    this.textureOverrides.set(eventId, sanitized);
    this.backgroundPersist(); // R-BND (#628): durable, but NOT a board beat — no beatSeq bump
    return { ok: true };
  }

  /** How many recorded witnessed events ground a server-initiated lifecycle beat (B62). */
  private static readonly STORY_FACT_EVENTS = 8;

  /**
   * The story-so-far facts for a server-initiated lifecycle beat (B62/audit J1+J7+J2): the most
   * recent WITNESSED events from the record — the store recalled, never the chat remembered
   * (ADR 0003) — plus the result for a finished season. Vault-free by construction: hidden
   * events never enter, and the winner/week are public ceremony facts. Other moments get none
   * (the per-turn prompt stays tight — prefer removing context to adding it).
   */
  private storyFacts(moment: string): string | undefined {
    if (moment !== "re-entry" && moment !== "post-season") return undefined;
    const recent = (this.record?.events() ?? [])
      .filter((e) => !e.hidden)
      .slice(-GameSessionAdapter.STORY_FACT_EVENTS)
      .map((e) => ({ content: this.humanize(e.content) }));
    const winner = this.live?.finished ? this.named(this.live.winner) : null;
    // Anti-confabulation (priority #3): the reunion/recap was inventing the jury margin and the
    // player's own placement (a real playtest defect — "9-2" for an 8-1 vote, "Final 5" for a Final
    // 6 exit). Hand the model the EXACT public finale facts so it voices them instead of embellishing.
    const tally = this.live?.finished ? this.finaleTally() : null;
    const playerSeason = this.live?.finished ? this.playerSeason() : null;
    return renderStoryFacts(
      recent,
      winner ? { winner: winner.name, week: this.week, ...(tally ? { tally } : {}) } : null,
      playerSeason,
    );
  }

  /** How many of the player's own surfaced facts ride along on EVERY turn (SOC-1/4). Bounded so the
   *  block stays tight, mirroring `STORY_FACT_EVENTS` — this is a per-turn addition, not a full recap. */
  private static readonly SURFACED_FACTS_WINDOW = 5;

  /**
   * SOC-1/4 — the player's own recently-surfaced KNOWLEDGE (an NPC confiding, a seeded-tie belief,
   * gossip that diffused all the way to them): computed by the `KnowledgeService` (`surfaceInformationTo`
   * / `transmitGossip`, wired in `registry.ts`) but, before this fix, NEVER handed to the narrator on an
   * ordinary turn. The provenance EVENT those calls also record (`"surfaced to player via told-by:npc:3"`,
   * `"gossip … reaches player"`) deliberately carries no real content — a shared verbatim string would trip
   * the orchestrator's vault-leak checkpoint substring sweep against another entity's hidden copy (see the
   * comment on `InMemoryKnowledgeService.surfaceInformationTo`) — so the ACTUAL fact text lives only in the
   * `KnowledgeFact.content` this reads back, via the SAME `playerKnowledgeReader` the secrets-as-power
   * levers already trust as the player's own, Vault-free knowledge (0093/0099). Excludes the Diary Room
   * (`NO_NPC_PATHWAY`) — an OOC channel with no in-game pathway to anyone, never something "the house told
   * you". Bounded to the most recent few so the block stays tight (ADR 0003 §1); `undefined` when there is
   * nothing fresh (byte-identical prompt to before this fix).
   */
  private freshSurfacedFacts(): string | undefined {
    const facts = (this.playerKnowledgeReader?.() ?? [])
      .filter((f) => f.pathway !== NO_NPC_PATHWAY)
      .slice(-GameSessionAdapter.SURFACED_FACTS_WINDOW)
      .map((f) => ({ content: this.humanize(f.content) }));
    return renderSurfacedFacts(facts);
  }

  /** The exact, public jury vote margin (anti-confabulation grounding for the recap). Counts the
   *  persisted finale ballots per finalist; null until a winner + Final 2 + ballots exist. */
  private finaleTally(): { winnerVotes: number; runnerUpVotes: number; runnerUp: string } | null {
    const votes = this.live?.finale?.votes;
    const winner = this.live?.winner;
    const finalTwo = this.live?.finalTwo;
    if (!votes || !winner || !finalTwo) return null;
    const runnerUp = finalTwo.find((id) => id !== winner);
    if (!runnerUp) return null;
    let winnerVotes = 0, runnerUpVotes = 0;
    for (const choice of Object.values(votes)) {
      if (choice === winner) winnerVotes += 1;
      else if (choice === runnerUp) runnerUpVotes += 1;
    }
    return { winnerVotes, runnerUpVotes, runnerUp: this.nameOf(runnerUp) };
  }

  /** The player's OWN public placement, stated exactly so the recap can't inflate it (Final N they
   *  went out at, the eviction week, jury seat + their finale vote). Public ceremony facts only. */
  private playerSeason(): string | null {
    if (!this.house || !this.live) return null;
    const me = this.house.player.id;
    if (this.live.winner === me) return "You WON the season.";
    if (this.live.finalTwo?.includes(me)) return "You finished as the RUNNER-UP (the Final 2).";
    const idx = this.live.evictionOrder.indexOf(me);
    if (idx < 0) return null;
    const cast = this.house.npcs.length + 1;
    const finalN = cast - idx; // houseguests remaining (incl. the player) when they were evicted
    const week = this.live.voteRecord?.find((r) => r.evictee === me)?.week;
    let s = `You were evicted${week ? ` in week ${week}` : ""}, going out at the Final ${finalN}`;
    if (this.seatOf(me) === "jury") {
      s += ", then sat on the jury";
      const vote = this.live.finale?.votes?.[me];
      if (vote) s += ` and voted for ${this.nameOf(vote)} to win`;
    }
    return s + ".";
  }

  /**
   * Report the live loop's competition — it is NOT a second resolver (B37/audit A1+A3). The weekly
   * loop (`advanceGame` → `liveSeason`) is the SOLE authority on who wins; `runCompetition` only
   * PREVIEWS the current competition beat's deterministic winner (the loop crowns the same one when
   * the beat advances — same seed). Per remediation principle #3 it validates references and ignores
   * foreign input: ids only, unknown/evicted ids refused, caller stats never read.
   */
  runCompetition(req: RunCompetitionReq): CompetitionResultView {
    const fallbackType = (COMP_TYPES.has(req.type ?? "") ? req.type : "endurance") as CompetitionType;
    if (!this.house) return { started: false, type: fallbackType, week: 0, phase: this.phase, winner: null };

    // Validated references: any caller-supplied id must be a LIVING houseguest (never evicted/unknown).
    if (req.participantIds?.length) {
      const known = new Set([this.house.player.id, ...this.house.npcs.map((n) => n.id)]);
      const evicted = new Set(this.live?.evictionOrder ?? []);
      if (req.participantIds.some((id) => !known.has(id) || evicted.has(id))) {
        return { started: true, type: fallbackType, week: this.week, phase: this.phase, winner: null };
      }
    }

    // Single authority: the field + winner come from the loop, computed from the live house's own
    // stats/souls (caller stats ignored). The evicted are never in an eligibility pool by construction.
    if (this.live) {
      const peek = peekCompetition(this.live, this.ctx(), this.beatRng());
      if (peek) {
        // The drawn library def (0042): name + format + the Vault-free narrative scaffold — the
        // narrator dresses THIS competition. Flavor only; no stat, score, or ranking crosses.
        return {
          started: true, type: peek.type, week: this.week, phase: this.phase,
          winner: this.named(peek.winner),
          name: peek.def.name, format: peek.def.format,
          narrative: {
            premise: peek.def.narrative.premise,
            beats: [...peek.def.narrative.beats],
            winReads: peek.def.narrative.winReads,
          },
        };
      }
      // Between competitions: report the most recently crowned comp from public ceremony state — no re-roll.
      const last = this.ceremony.vetoHolder ?? this.ceremony.hoh;
      return { started: true, type: fallbackType, week: this.week, phase: this.phase, winner: last ? this.named(last) : null };
    }
    return { started: true, type: fallbackType, week: this.week, phase: this.phase, winner: null };
  }

  /**
   * Where the player stands (0046). `active` until they are evicted; once evicted, `jury` if they fall
   * in the last-9 jury (they spectate the public ceremonies and vote at the finale) or `evicted` if they
   * went out pre-jury. Derived purely from the public eviction order + the (fixed) cast size — the jury
   * is the last 9 of the `cast − 2` evictions, so a player evicted at index ≥ that threshold is a juror.
   * Vault-free: nothing here reads a hidden number.
   */
  private playerStatus(): "active" | "jury" | "evicted" {
    // 0061 (owner decision #1): a CONFIRMED self-eviction is a FORFEIT — the player exits the game
    // entirely and never takes a juror's seat, even in the jury phase. So a self-evicted player
    // always reads "evicted" (terminal), overriding the phase-derived seat the eviction index would give.
    if (this.live?.selfEvicted) return "evicted";
    return this.seatOf(PLAYER);
  }

  /** Any houseguest's public seat (B61): still playing, on the last-9 jury, or out pre-jury. */
  private seatOf(id: EntityId): "active" | "jury" | "evicted" {
    const order = this.live?.evictionOrder ?? [];
    const idx = order.indexOf(id);
    if (idx < 0) return "active";
    const cast = this.house ? this.house.npcs.length + 1 : 16;
    const preJury = Math.max(0, cast - 2 - 9); // evictions before the last-9 jury forms
    return idx >= preJury ? "jury" : "evicted";
  }

  /** The Vault-free projection. Player card = authored persona (no numeric stats); NPCs = name + status only. */
  private view(): GameStateView {
    if (!this.house) {
      // Pre-game, the view carries the interview's status (0050): the engine — not the model —
      // says which building blocks are in and what the next step is.
      return {
        started: false, beatSeq: this.beatSeq, finished: false, week: 0, phase: this.phase, moment: "character-creation",
        ceremony: { hoh: null, nominees: [], veto: { holder: null, used: false, players: [] } },
        whereabouts: null,
        player: null, house: [], casting: castingStatusOf(this.intake),
      };
    }
    const p = this.house.player;
    const status = this.playerStatus();
    // Once the player is out, the moment frames their new seat (closure / the jury spectator box, 0046)
    // rather than the ceremony phase they can no longer act in. An active player keeps the phase moment.
    // 0061: a VOLUNTARY walk-out gets its own terminal framing (the season is over for them by their OWN
    // choice — no crowned winner to host a reunion around, unlike `post-season`). It trumps every seat.
    // Otherwise the finished terminal state (0048) trumps every seat: the season is over, the reunion begins.
    const moment = this.live?.selfEvicted
      ? "self-evicted"
      : this.live?.finished
      ? "post-season"
      : status === "evicted" ? "evicted" : status === "jury" ? "jury" : momentForPhase(this.phase);
    return {
      started: true,
      beatSeq: this.beatSeq, // 0065 Part A — the monotonic CAS token surfaced on every read
      finished: !!this.live?.finished, // B6-01: the over-signal the FE season lifecycle (0057) gates on
      // C8-04: the live ceremony state in the model's persistent context (the same Vault-free public
      // facts gameStatus() exposes), so the narrator voices the REAL HOH/nominees/veto, never invents.
      ceremony: {
        hoh: this.card(this.ceremony.hoh),
        nominees: this.ceremony.nominees.map((id) => ({ id, name: this.nameOf(id) })),
        veto: {
          holder: this.card(this.ceremony.vetoHolder),
          used: this.ceremony.vetoUsed,
          players: (this.live?.vetoField ?? []).map((id) => ({ id, name: this.nameOf(id) })), // R9-AGENCY-1: the drawn six
        },
      },
      // L21/L24: the player's live whereabouts (room, who's with them + tenure, adjacent rooms) so the
      // narrator voices the REAL, persistent occupancy the engine drives — never invented positions.
      whereabouts: this.whereabouts(),
      week: this.week,
      phase: this.phase,
      ...(this.timeOfDayEnabled && this.live?.timeOfDay ? { timeOfDay: this.live.timeOfDay, asleep: this.asleepNpcs() ?? [] } : {}), // ADR 0006: the public day-phase + who's turned in
      moment,
      player: {
        id: p.id,
        name: p.name,
        // Surface the player's OWN words (what they typed at OOBE) so the narrative voices them as
        // described; fall back to the canonical labels. Stats stay hidden behind the Vault either way.
        archetype: p.persona?.archetype ?? p.character.archetype,
        strategyStyle: p.persona?.strategyStyle ?? p.character.strategyStyle,
        status,
        // ADR 0006 §Principle 5: the player's OWN qualitative tiredness (their body is their knowledge) —
        // a cue, never a number, and never any NPC's sleep state. Present only once the clock is running.
        ...(this.timeOfDayEnabled && this.live?.timeOfDay ? { restStatus: restStatusFor(this.live.lastSleepPhase ?? WAKE_HOUR) } : {}),
        // The casting card (0050): the interview's payoff, re-showable all season. Tier WORDS are
        // derived from the hidden balanced stats here, engine-side — the numbers never serialize out.
        castingCard: {
          characterType: p.character.archetype,
          strategyStyle: p.character.strategyStyle,
          strengths: {
            physical: strengthTier(p.character.stats.physical),
            mental: strengthTier(p.character.stats.mental),
            social: strengthTier(p.character.stats.social),
          },
          ...(p.character.background ? { story: p.character.background } : {}),
          ...(p.motivation ? { motivation: p.motivation } : {}),
          // C6: an engine-defaulted character type is SURFACED, never a silent grant.
          ...(p.archetypeDefaulted ? { defaulted: true } : {}),
        },
      },
      house: this.house.npcs.map((n) => ({
        id: n.id, name: n.name,
        status: this.seatOf(n.id),
        // B61: the curated PUBLIC persona facets — the narrator's per-person voice anchor
        // (seed-stable, so a houseguest sounds the same in week 8 as week 1). Stats, the
        // soul, and hiddenElements are deliberately NOT selected here.
        archetype: n.character.archetype,
        strategyStyle: n.character.strategyStyle,
        background: n.character.background,
        age: n.character.age,
        presentation: n.character.presentation,
        // L28: the concrete, diverse, PERSISTED backstory facets — the narrator voices the STORED
        // vocation/hometown instead of inventing (and mirroring the player's). Public, Vault-free.
        ...(n.character.vocation !== undefined ? { vocation: n.character.vocation } : {}),
        ...(n.character.hometown !== undefined ? { hometown: n.character.hometown } : {}),
        // L28 (voice register): the STORED observable demeanor — the narrator voices THIS so the cast
        // is not a room of identical warm professionals. Public, Vault-free.
        ...(n.character.demeanor !== undefined ? { demeanor: n.character.demeanor } : {}),
        // 0058: the PUBLIC multi-sentence biography. Public, Vault-free; the HIDDEN profile
        // (secrets/goals/weakness/perception) is NEVER selected here.
        ...(n.character.biography !== undefined ? { biography: n.character.biography } : {}),
        // L29 single physical descriptor (appearance/physicalCharacteristics consistency): the STRUCTURED
        // `physicalCharacteristics` facet is the ONE source of truth narration AND portraits read; the prose
        // `appearance` rides ONLY as the pre-0058 fallback — NEVER both (independently generated, they could
        // contradict on build/skin/hair). When the facet is present it alone is shipped.
        ...(n.character.physicalCharacteristics !== undefined
          ? { physicalCharacteristics: n.character.physicalCharacteristics }
          : n.character.appearance !== undefined ? { appearance: n.character.appearance } : {}),
        // 0063: the PUBLIC diversity-identity facets — the heritage/cultural identity (an authentic facet
        // of a full character, grounding the skin tone), the gender presentation, and a PUBLICLY-OUT
        // orientation only. A PRIVATELY-held orientation is NEVER here (it's Vault-sealed, §5). Descriptive
        // only — the narrator voices them as it would any public facet, never a defining single word.
        ...(n.character.ethnicity !== undefined ? { ethnicity: n.character.ethnicity } : {}),
        ...(n.character.genderPresentation !== undefined ? { genderPresentation: n.character.genderPresentation } : {}),
        ...(n.character.outOrientation !== undefined ? { outOrientation: n.character.outOrientation } : {}),
        // #1067: PUBLIC, Vault-free provenance — `true` once the FE deep-profile authoring landed for this
        // houseguest, otherwise absent (still on the seeded floor). NOT secret content; lets the FE backfill
        // target the still-floor cards.
        ...(n.character.deepProfileAuthored === true ? { authored: true } : {}),
      })),
      // Deals the player is party to (0039) — fact + status only; NPC↔NPC deals never appear here.
      deals: this.deals.forParty(PLAYER).map((d) => this.dealView(d)),
      ...(this.alliances.forMember(PLAYER).length ? { alliances: this.playerAllianceViews() } : {}),
      // 0059/L40 — only PUBLIC (visible) showmances; sealed ties/showmances never surface here.
      ...(this.visibleShowmances().length ? { showmances: this.visibleShowmances() } : {}),
      // PREMIERE (feature #380 follow-on): the meet-everyone progress — who's met + who's still to
      // introduce + their OBSERVABLE persona — woven into the premiere moment prompt so the producer
      // never loses track. Present ONLY during the premiere (null otherwise). Vault-free public facets.
      ...(this.premiereIntros() ? { premiere: this.premiereIntros()! } : {}),
    };
  }
}
