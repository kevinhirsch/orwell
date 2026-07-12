import type { EntityId } from "../domain/ids";
import { MEMORY_CALLBACK } from "./memoryCallbackConstants";

/**
 * Feature #1394 — the pure, Vault-free recall of witnessed past moments for the narrator's framing.
 *
 * THE MANDATE LINE (the whole risk): a recalled moment may reach the player ONLY if the player was
 * in its witness set (or it already reached them via an 0002 pathway). This function NEVER enforces
 * that itself — it is enforced UPSTREAM by construction: the caller (the registry wiring) feeds it
 * `VisibleStateService.getVisibleStateFor(PLAYER).visibleEvents`, the outward projection that has no
 * Vault handle at all (dependency-cruiser proves it). So the candidate pool is Vault-free before it
 * ever arrives here; this module only NARROWS it to the scene's houseguest(s) and RANKS it by
 * semantic relevance to the current cue. It cannot surface Vault content because it never receives
 * any. (The `hidden` flag is deliberately not even in `RecallCandidate` — there is nothing hidden to
 * read.) The leak test plants a Vault-only scene + a witnessed scene and proves only the witnessed
 * one can ever come back.
 *
 * Semantic ranking reuses the SAME embedding provider the soul vector index uses (fastembed at
 * runtime, the deterministic bag-of-words fallback in tests) — cosine similarity over the Vault-free
 * candidate pool. It is deliberately NOT the soul index (`SoulStore.recall`), which runs over the
 * FULL hidden soul (confessionals, hidden leanings) and is Vault content.
 */

/** The minimal Vault-free shape recall needs — structurally satisfied by a player-visible `GameEvent`
 *  (`VisibleStateService` yields exactly these fields, already witness-filtered + roster-scrubbed). */
export interface RecallCandidate {
  id: string;
  ts: number;
  content: string;
  initiator: EntityId;
  /** The scene's participants. Used ONLY to narrow to the NPC(s) in the current scene — the pool is
   *  already witness-filtered to the PLAYER upstream, so every entry here is player-visible. */
  witnessSet: readonly EntityId[];
}

export interface RecallConfig {
  k: number;
  minScore: number;
  maxCharsPerMoment: number;
  maxCharsTotal: number;
  poolCap: number;
}

export interface RecallResult {
  /** 0–K Vault-free moment strings for the narrator, most-relevant-first. Empty ⇒ no relevant history
   *  (the FE emits no framing block — the byte-identical floor). */
  moments: string[];
}

export interface RecallArgs {
  /** The player's Vault-free visible events (the mandated source — see the header). */
  events: readonly RecallCandidate[];
  /** The houseguest(s) the player is in a scene with (the FE presence seam). */
  npcIds: readonly EntityId[];
  /** The current scene cue to rank relevance against (the player's message). */
  cue: string;
  /** The shared embedder (engine-only at the call site; the same provider the soul index uses). */
  embed: (text: string) => readonly number[];
  /** Optional tunable override (tests); defaults to `MEMORY_CALLBACK`. */
  config?: Partial<RecallConfig>;
}

/** Recall the 0–K most relevant witnessed moments involving the scene's NPC(s). Vault-free by the
 *  provenance of `events` (see the module header). No cue / no NPC / no relevant history ⇒ `[]`. */
export function recallWitnessedMoments(args: RecallArgs): RecallResult {
  const cfg: RecallConfig = { ...MEMORY_CALLBACK, ...args.config };
  const cue = (args.cue ?? "").trim();
  const npcSet = new Set(args.npcIds ?? []);
  // Enrichment policy: recall ABSENCE is not a failure — no cue / no NPC ⇒ no block (byte-identical floor).
  if (cue.length === 0 || npcSet.size === 0) return { moments: [] };

  // Narrow the (already player-visible) pool to events that INVOLVE one of the scene's NPCs — the
  // player↔NPC scenes that make a genuine callback. Empty content is skipped (a bare provenance event).
  const involving = args.events.filter(
    (e) =>
      e.content.trim().length > 0 &&
      (npcSet.has(e.initiator) || e.witnessSet.some((w) => npcSet.has(w))),
  );
  if (involving.length === 0) return { moments: [] };

  // Bound the pool (most-recent-first) so per-scene embedding work is O(poolCap), never O(season).
  const pool = [...involving]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, Math.max(0, cfg.poolCap));

  const cueVec = args.embed(cue);
  const ranked = pool
    .map((e) => ({ e, score: cosine(cueVec, args.embed(e.content)) }))
    .filter((r) => Number.isFinite(r.score) && r.score >= cfg.minScore)
    // Deterministic order: score desc, then most-recent, then id — no dependence on input order.
    .sort((a, b) => b.score - a.score || b.e.ts - a.e.ts || (a.e.id < b.e.id ? -1 : 1));

  // Take up to K, clipped per-moment, then enforce the TOTAL character budget (the token cap). The
  // single most-relevant moment always survives if it fits the per-moment clip (which is ≤ the total).
  const moments: string[] = [];
  let used = 0;
  for (const { e } of ranked) {
    if (moments.length >= cfg.k) break;
    const text = clip(e.content.trim(), cfg.maxCharsPerMoment);
    if (text.length === 0) continue;
    if (moments.length >= 1 && used + text.length > cfg.maxCharsTotal) break;
    moments.push(text);
    used += text.length;
  }
  return { moments };
}

/** Cosine similarity over two vectors (equal length in practice — one embedder per call). 0 when
 *  either is a zero vector or lengths differ, so an empty/degenerate embed never scores as relevant. */
function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

/** Clip to a character budget on a word boundary where possible, with an ellipsis. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, Math.max(0, max - 1));
  const lastSpace = head.lastIndexOf(" ");
  const body = lastSpace > max * 0.6 ? head.slice(0, lastSpace) : head;
  return `${body.trimEnd()}…`;
}
