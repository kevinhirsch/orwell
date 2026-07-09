import type { EntityId } from "./ids";

/**
 * A fact an entity may legitimately act on. It entered the entity's knowledge
 * either by witnessing an event or via an in-game pathway (told / overheard /
 * caught) — recorded with that pathway for traceability.
 */
export interface KnowledgeFact {
  id: string;
  content: string;
  /** How it was learned: "witnessed" | "told-by:<id>" | "overheard" | "diary-room" ... */
  pathway: string;
  sourceEventId?: string;
  subject?: EntityId;
  ts: number;

  // --- Belief metadata (present on facts that propagated as gossip) -----------
  /** Lineage id — the SAME underlying fact across every retelling/hop. */
  factId?: string;
  /** The immediate teller this entity heard it from. */
  source?: EntityId;
  /** 0..1 — certainty; decays with each hop from the origin. */
  confidence?: number;
  /** Distance (retellings) from the origin. 0 at the origin. */
  hops?: number;
  /** Accumulated drift; grows with hops (a second-hand fact may be wrong). */
  distortion?: number;
  /** The undistorted origin content, for comparison. */
  originalContent?: string;

  // --- OUTWARD-ONLY qualitative belief projection (#1239) ----------------------
  // Populated ONLY on the player-facing projection (`VisibleStateService.getVisibleStateFor`), never
  // stored and never on an internal fact: the raw `confidence`/`distortion`/`hops` numbers must NOT
  // cross to the player ("never show the player a number"), so the outward shape carries these
  // Vault-safe *words* instead (and drops the numeric fields + `originalContent` at the boundary).
  /** A coarse, decaying clarity WORD for how firmly the player holds this belief (`confidenceWord`). */
  confidenceBand?: string;
  /** Whether the belief is materially distorted (both drift + decay gates clear — `isMateriallyDistorted`). */
  distorted?: boolean;
}

export type KnowledgeState = readonly KnowledgeFact[];

/**
 * A hunch an entity holds with NO in-game pathway to back it. A suspicion is
 * never knowledge — it can never be acted on as fact — until a pathway surfaces
 * the real thing and promotes it to a `KnowledgeFact`.
 */
export interface Suspicion {
  id: string;
  content: string;
  subject?: EntityId;
  ts: number;
  /**
   * 0..1 certainty, CAPPED below knowledge-grade at the write seam (audit C2/C14): a hunch —
   * including a surfacing downgraded for failing content-lineage anchoring — is never near-certain.
   */
  confidence?: number;
}

/**
 * The serializable knowledge layer (feature B40 / audit C2): per-entity knowledge + suspicions PLUS
 * the id/ts counters, so a restart resumes the layer instead of losing it AND post-restart events
 * get fresh ids (no duplicates). Plain JSON — part of the durable `SessionSnapshot` contract (#6).
 */
export interface KnowledgeSnapshot {
  knowledge: Record<EntityId, KnowledgeFact[]>;
  suspicions: Record<EntityId, Suspicion[]>;
  seq: number;
  tick: number;
}
