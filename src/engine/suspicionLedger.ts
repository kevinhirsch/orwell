/**
 * Feature 0097 — the suspicion ledger: the PURE core. NO I/O, NO Vault handle. It holds the player's own
 * stated hunches (their verbatim words), and it stamps a "called-it / wrong / partial" verdict on them
 * ONLY when it is handed an ALREADY-REVEALED, Vault-free fact — an in-game reveal that legitimately became
 * the player's knowledge (a committed eviction tally, a veto used/saved, a 0075 confidence, gossip that
 * terminated at the player) or the post-season 0048 unseal. The scorer READS THE REVEAL, NEVER THE VAULT:
 * this module cannot access sealed state — it is handed only `RevealedFact` (Vault-free) + the entries, so
 * it "cannot leak what it never receives." A hunch no reveal ever touches stays honestly `open` forever.
 *
 * Authority split (ADR 0005): the hunch `text` is OPEN-SET, stored LOSSLESS (never normalized/truncated);
 * the only CLOSED-SET act is the engine stamping a verdict at a reveal. The verdict may be PROPOSED by the
 * FE model (open-set interpretation of the player's words vs. the revealed fact) and COMMITTED here, or
 * derived by the deterministic floor matcher when no model is wired — either way the stamp is FROZEN once
 * recorded (determinism + anti-sycophancy: no retroactively "fixing" a wrong call).
 *
 * The 0013 Diary-Room wall (ruling R3) is an ADAPTER concern (the hunch is recorded as a player-knowledge,
 * `NO_NPC_PATHWAY` OOC event): this pure module never derives NPC knowledge and holds no NPC state.
 */
import type { EntityId } from "../domain/ids";
import { SUSPICION } from "./suspicionConstants";

/** A stable id for one ledger entry (the adapter mints it; the pure core never generates ids). */
export type EntryId = string;

/** The engine-stamped verdict of a hunch. `open` = not yet touched by any sanctioned reveal ("never confirmed"). */
export type SuspicionStatus = "open" | "called-it" | "wrong" | "partial";

/** A verdict the resolution stamps (the non-`open` states). */
export type Verdict = Exclude<SuspicionStatus, "open">;

/** An optional player-supplied self-tag that HELPS matching — never required (a free hunch resolves too). */
export type SuspicionTopic = "vote" | "alliance" | "target" | "secret" | "showmance" | "twist" | "free";

/** Where in the season a beat happened — for the timeline + "how early did I call it". */
export interface BeatRef {
  week: number;
  phase: string;
}

/**
 * One logged hunch. `text` is the player's VERBATIM words (open-set, stored lossless). `status` starts
 * `open` and is moved ONLY by `resolveAgainstReveal` at a sanctioned reveal. A resolved entry is FROZEN.
 */
export interface SuspicionEntry {
  id: EntryId;
  /** The player's verbatim hunch — open-set, stored LOSSLESS (ADR 0005). Never normalized. */
  text: string;
  /** Optional player-tagged subject(s) — a matching hint, never required. */
  about?: EntityId[];
  /** Optional self-tag — a matching hint, never required. */
  topic?: SuspicionTopic;
  /** When it was logged (week/phase) — for the timeline + earliest-correct-call. */
  loggedAt: BeatRef;
  /** Engine-stamped ONLY at a sanctioned reveal. */
  status: SuspicionStatus;
  /** When the verdict landed (a reveal beat, or the post-season unseal). Present iff resolved. */
  resolvedAt?: BeatRef;
  /** The revealed fact that resolved it (an EventRef for an in-game reveal, or an unseal ref). Present iff resolved. */
  evidence?: string;
}

/** The input to log a new hunch — the caller (adapter) supplies the id + logging beat (no rng/clock here). */
export interface LogHunchInput {
  id: EntryId;
  text: string;
  about?: EntityId[];
  topic?: SuspicionTopic;
  loggedAt: BeatRef;
}

/**
 * An ALREADY-REVEALED, Vault-free fact the ledger is scored against. Assembled by the adapter FROM a
 * sanctioned reveal — it carries ONLY the now-public description, never sealed premise/number. The scorer
 * matches a hunch against `descriptors` (+ `subjects` / `topic` scoping); it is structurally impossible for
 * a sealed value to enter here because the adapter builds it from the reveal, not the Vault.
 */
export interface RevealedFact {
  /** A short Vault-free classifier of what surfaced ("vote" | "veto" | "confidence" | "alliance" | "unseal" | …). */
  kind: string;
  /** When the truth surfaced (becomes the entry's `resolvedAt`). */
  at: BeatRef;
  /** A stable EventRef id for the reveal (stored as `evidence`). */
  ref: string;
  /** The Vault-free, ALREADY-PUBLIC tokens describing the fact — the ONLY text the floor matcher reads. */
  descriptors: string[];
  /** Who the now-public fact is about (already-revealed) — scopes an `about`-tagged hunch. */
  subjects?: EntityId[];
  /** The topic this fact bears on (matches a hunch's `topic` hint). */
  topic?: SuspicionTopic;
}

/** A verdict the FE model proposes for one entry against a reveal — COMMITTED here (closed-set), validated. */
export interface ProposedVerdict {
  entryId: EntryId;
  verdict: Verdict;
}

/** The result of a resolution pass: the updated entries + the ids that were stamped (for the payoff beat). */
export interface ResolutionResult {
  entries: SuspicionEntry[];
  stamped: Array<{ id: EntryId; verdict: Verdict }>;
}

/** The player-facing season scorecard (0048) — counts + earliest correct call. Vault-free by construction. */
export interface SuspicionScorecard {
  total: number;
  called: number;
  wrong: number;
  partial: number;
  /** Still-`open` hunches — shown honestly as "never confirmed", never guessed. */
  open: number;
  /** The earliest LOGGED beat among `called-it` hunches ("you spotted the final-two in week 3"). */
  earliestCorrect?: BeatRef;
}

// ── Logging (append-only; the player's own words, verbatim) ───────────────────────────────────────────

/** Append a new hunch as `open`, storing `text` VERBATIM (lossless — never normalized/truncated). Pure. */
export function logHunch(entries: readonly SuspicionEntry[], input: LogHunchInput): { entries: SuspicionEntry[]; entry: SuspicionEntry } {
  const entry: SuspicionEntry = {
    id: input.id,
    text: input.text, // stored EXACTLY as given — the open-set lossless guarantee (ADR 0005)
    ...(input.about && input.about.length ? { about: [...input.about] } : {}),
    ...(input.topic ? { topic: input.topic } : {}),
    loggedAt: { ...input.loggedAt },
    status: "open",
  };
  return { entries: [...entries, entry], entry };
}

/** True iff a hunch may still be edited/withdrawn by the player (an `open` hunch is their private scratch). */
export function canEdit(entry: SuspicionEntry): boolean {
  return entry.status === "open";
}

/**
 * Edit an OPEN hunch's text (the player's private scratch space). A RESOLVED hunch is FROZEN — the verdict
 * is part of the permanent record (mandate #4 / anti-sycophancy: no retroactively "fixing" a wrong call),
 * so a resolved entry is returned UNCHANGED. Pure.
 */
export function editHunch(entries: readonly SuspicionEntry[], id: EntryId, text: string): SuspicionEntry[] {
  return entries.map((e) => (e.id === id && canEdit(e) ? { ...e, text } : e));
}

/** Withdraw an OPEN hunch (removes it). A RESOLVED hunch is FROZEN and is kept (never deleted). Pure. */
export function withdrawHunch(entries: readonly SuspicionEntry[], id: EntryId): SuspicionEntry[] {
  return entries.filter((e) => !(e.id === id && canEdit(e)));
}

// ── Resolution — stamp a verdict at a sanctioned reveal (the ONLY closed-set act; NEVER reads the Vault) ─

const clean = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ");

/** Significant tokens of a string: split, drop short + stopword tokens (the floor matcher's vocabulary). */
function significantTokens(s: string): Set<string> {
  const out = new Set<string>();
  for (const tok of clean(s).split(" ")) {
    if (tok.length >= SUSPICION.minSignificantTokenLen && !SUSPICION.stopwords.includes(tok)) out.add(tok);
  }
  return out;
}

/** Whether an entry is a legitimate CANDIDATE for a reveal — the about/topic scope gate (never content). */
function inScope(entry: SuspicionEntry, reveal: RevealedFact): boolean {
  // An `about`-tagged hunch resolves ONLY against a reveal about (at least one of) those same subjects —
  // an unrelated reveal must never touch it. A free (un-tagged) hunch is in scope for any reveal.
  if (entry.about && entry.about.length) {
    const subj = reveal.subjects ?? [];
    if (!entry.about.some((a) => subj.includes(a))) return false;
  }
  // A `topic`-tagged hunch (other than the catch-all "free") resolves only against a matching-topic reveal
  // when the reveal declares one. A reveal with no topic does not gate on topic.
  if (entry.topic && entry.topic !== "free" && reveal.topic && reveal.topic !== entry.topic) return false;
  return true;
}

/** The deterministic FLOOR match: ≥ `floorMatchTokens` shared significant tokens between hunch + descriptors. */
function floorMatches(entry: SuspicionEntry, reveal: RevealedFact): boolean {
  const hunch = significantTokens(entry.text);
  const factTokens = significantTokens(reveal.descriptors.join(" "));
  let shared = 0;
  for (const t of hunch) if (factTokens.has(t)) shared++;
  return shared >= SUSPICION.floorMatchTokens;
}

function stamp(entry: SuspicionEntry, verdict: Verdict, reveal: RevealedFact): SuspicionEntry {
  return { ...entry, status: verdict, resolvedAt: { ...reveal.at }, evidence: reveal.ref };
}

/**
 * Resolve the OPEN hunches against a sanctioned reveal — the ONLY place the engine touches a verdict, and
 * it NEVER reads the Vault (it is handed `reveal`, a Vault-free already-public fact). Two paths:
 *
 *  1. MODEL-PROPOSED (leading, ADR 0005): the FE model reads the player's text vs. the revealed fact and
 *     proposes a verdict per entry; the engine COMMITS it — but ONLY on an `open` entry that is `inScope`
 *     for this reveal (the engine validates the proposal; a proposal for an out-of-scope or already-
 *     resolved entry is dropped, so a wrong model match can mis-score at worst, never resolve an unrelated
 *     hunch and never breach the Wall).
 *  2. DETERMINISTIC FLOOR (no model): a conservative keyword/about/topic match stamps `called-it` on a
 *     positive hit; ambiguous hunches stay honestly `open` (the floor cannot detect `wrong`/`partial`).
 *
 * A RESOLVED entry is FROZEN — a later reveal never re-stamps it. An unrelated reveal (no scope, no token
 * overlap, no proposal) touches nothing. Pure + deterministic: same entries + same reveal + same proposals
 * ⇒ same stamps. Introduces no rng.
 */
export function resolveAgainstReveal(
  entries: readonly SuspicionEntry[],
  reveal: RevealedFact,
  proposals?: readonly ProposedVerdict[],
): ResolutionResult {
  const stamped: Array<{ id: EntryId; verdict: Verdict }> = [];

  if (proposals && proposals.length) {
    const byId = new Map(proposals.map((p) => [p.entryId, p.verdict] as const));
    const next = entries.map((e) => {
      const verdict = byId.get(e.id);
      if (verdict && e.status === "open" && inScope(e, reveal)) {
        stamped.push({ id: e.id, verdict });
        return stamp(e, verdict, reveal);
      }
      return e;
    });
    return { entries: next, stamped };
  }

  const next = entries.map((e) => {
    if (e.status === "open" && inScope(e, reveal) && floorMatches(e, reveal)) {
      stamped.push({ id: e.id, verdict: "called-it" });
      return stamp(e, "called-it", reveal);
    }
    return e;
  });
  return { entries: next, stamped };
}

// ── The season scorecard (0048) — a Vault-free recap of the player's OWN record + already-revealed truth ─

/** Beat ordering for "earliest": earlier week first, then a coarse phase index (pre-game < weekly ladder). */
const PHASE_ORDER: Record<string, number> = {
  "pre-game": 0, casting: 0, premiere: 1,
  "hoh-competition": 2, nominations: 3, "veto-competition": 4, "veto-ceremony": 5, eviction: 6,
  finale: 7, finished: 8,
};
function beatIndex(b: BeatRef): number {
  return b.week * 100 + (PHASE_ORDER[b.phase] ?? 50);
}

/**
 * Assemble the season scorecard from the player's own entries — counts + the earliest correct call. Every
 * datum is the player's own logged record or an engine-stamped verdict; there is NO Vault read here (the
 * verdicts were stamped earlier from already-revealed facts). Vault-free by construction. Pure.
 */
export function scorecard(entries: readonly SuspicionEntry[]): SuspicionScorecard {
  let called = 0, wrong = 0, partial = 0, open = 0;
  let earliest: BeatRef | undefined;
  for (const e of entries) {
    if (e.status === "called-it") {
      called++;
      if (!earliest || beatIndex(e.loggedAt) < beatIndex(earliest)) earliest = e.loggedAt;
    } else if (e.status === "wrong") wrong++;
    else if (e.status === "partial") partial++;
    else open++;
  }
  return {
    total: entries.length,
    called, wrong, partial, open,
    ...(earliest ? { earliestCorrect: { ...earliest } } : {}),
  };
}
