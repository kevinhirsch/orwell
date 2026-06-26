import type { UpdateCastingReq, CastingStatusView } from "../ports/GameSession";

/**
 * The casting interview's incremental intake (feature 0050).
 *
 * OOBE is not one atomic call: the producer records each answer AS IT LANDS
 * (`updateCasting`), the engine accumulates the building blocks here, and the
 * captured/missing status — computed by THIS module, not the model — determines
 * the interview's next step. `createCharacter` finalizes from the intake.
 *
 * Everything here is the player's OWN authored material (Vault-free by nature);
 * the intake is part of the durable session core, so a half-done interview
 * survives a restart (0030) and the producer resumes instead of re-asking.
 */

/** The accumulated intake. Same fields as the update request; notes always present. */
export type CastingIntake = Omit<UpdateCastingReq, "interviewNotes"> & { interviewNotes: string[] };

/**
 * Intake bounds (audit C8). The interview is an UNTRUSTED, durable input surface that is
 * echoed into every pre-game system prompt — without caps it is an unbounded prompt-
 * injection/payload store. Scalars and notes are hard-capped at merge time (never at
 * read time, so persisted detail is never re-truncated — mandate #4 applies to what
 * was actually accepted).
 */
export const CASTING_LIMITS = {
  /** Max characters accepted per scalar field (name, backstory, …). */
  scalarMax: 500,
  /** Max characters accepted per interview note. */
  noteMax: 280,
  /** Max number of accumulated notes; later notes are refused once full. */
  notesMax: 40,
} as const;

/**
 * Neutralize a captured value for echoing into a SYSTEM PROMPT (audit C8): structure is
 * the attack surface, so newlines/control characters collapse to single spaces (a value
 * can never fake a new prompt line, list bullet, or section header) and the echo is
 * length-capped. The stored intake keeps the accepted value; only the ECHO is flattened.
 */
export function neutralizeForPrompt(value: string, max = 160): string {
  // eslint-disable-next-line no-control-regex
  const flat = value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

export function emptyIntake(): CastingIntake {
  return { interviewNotes: [] };
}

/**
 * The interview's coverage, in the engine's ask-order. `ask` is the producer-facing phrasing of
 * the next step; the scalar fields echo back in `known` so a resumed interview never re-asks.
 */
export const CASTING_COVERAGE: ReadonlyArray<{ field: keyof CastingIntake; ask: string }> = [
  // Casting step #1 — "what do you look like?" (the photo-first OOBE re-sequence): the producers
  // open the interview here, BEFORE any other question, so `next` on a fresh interview points at the
  // cast photo first. It is an ORDINARY scalar (it flows through merge/overwrite/capture/status like
  // every other field), but it is OPTIONAL by design — `ready` stays name-only (below), so an
  // unanswered/"skipped" photo never blocks finalization. The FE sets it to "uploaded" (a photo was
  // finalized) or "skipped" (the player declined) when the in-chat photo box closes; any non-empty
  // string marks the step handled. Vault-free: it is the player's own metadata, never secret.
  { field: "castPhoto", ask: "their cast photo — what they look like (the in-chat photo box opens for this; it's optional)" },
  { field: "playerName", ask: "their name — what the feeds should call them" },
  { field: "backstory", ask: "their life outside the house, in their words" },
  { field: "motivation", ask: "why they came to play / what they're playing for" },
  { field: "personaArchetype", ask: "how they think they'll come across (their own words)" },
  { field: "personaStrategyStyle", ask: "how they'd describe their way of playing" },
  { field: "privateStrategy", ask: "how they ACTUALLY plan to play (assure them it stays with production)" },
  { field: "interviewNotes", ask: "get-to-know material worth remembering (record notes as they land)" },
  { field: "archetype", ask: "your canonical casting-sheet mapping of who they are" },
  { field: "strategyStyle", ask: "your canonical casting-sheet mapping of how they'll play" },
];

/**
 * Common synonyms the narration model actually emits for a casting field (issue #1033 / F-1). The
 * model proposes e.g. `name` when the engine field is `playerName`; without an alias the value lands
 * under an unrecognized key and is SILENTLY DROPPED (the intake stays empty, `createCharacter` never
 * finalizes, casting wedges). Mapping the obvious synonyms to their canonical field BEFORE the merge
 * makes the engine robust to how the model phrases the call — a `name` write fills `playerName`.
 *
 * Conservative on purpose: only unambiguous synonyms map. A genuinely unknown key still falls through
 * to `ignoredCastingKeys` (echoed back so the producer re-files) rather than being mis-merged. A
 * canonical field already present in the request always wins over an alias (no silent overwrite).
 */
const CASTING_KEY_ALIASES: Readonly<Record<string, keyof UpdateCastingReq>> = {
  name: "playerName",
  playername: "playerName",
  player_name: "playerName",
  displayname: "playerName",
  display_name: "playerName",
  notes: "interviewNotes",
  note: "interviewNotes",
  interviewnote: "interviewNotes",
  interview_notes: "interviewNotes",
  bio: "backstory",
  background: "backstory",
  story: "backstory",
  why: "motivation",
  goal: "motivation",
  persona: "personaArchetype",
  strategy: "personaStrategyStyle",
  playstyle: "personaStrategyStyle",
  play_style: "personaStrategyStyle",
  secretstrategy: "privateStrategy",
  secret_strategy: "privateStrategy",
  photo: "castPhoto",
  cast_photo: "castPhoto",
} as const;

/**
 * Rewrite recognized-synonym keys onto their canonical casting field (issue #1033). A canonical key
 * already present in the request is never clobbered by an alias; `interviewNotes` aliases MERGE into
 * the notes array (notes append) rather than overwrite. Keys that are neither canonical nor a known
 * alias pass through untouched — they remain visible to `ignoredCastingKeys`. The input is treated as
 * read-only; a fresh object is returned.
 */
export function aliasCastingKeys(req: object): UpdateCastingReq {
  const src = req as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  // Canonical keys land first so an explicit canonical value always wins over an aliased one.
  for (const k of Object.keys(src)) {
    if (CASTING_FIELDS.has(k)) out[k] = src[k];
  }
  for (const k of Object.keys(src)) {
    if (CASTING_FIELDS.has(k)) continue;
    const canonical = CASTING_KEY_ALIASES[k.toLowerCase()];
    if (canonical === undefined) continue; // unknown ⇒ left for ignoredCastingKeys
    if (canonical === "interviewNotes") {
      const existing = Array.isArray(out["interviewNotes"]) ? (out["interviewNotes"] as unknown[]) : [];
      const incoming = Array.isArray(src[k]) ? (src[k] as unknown[]) : [src[k]];
      out["interviewNotes"] = [...existing, ...incoming];
    } else if (out[canonical] === undefined) {
      out[canonical] = src[k];
    }
  }
  return out as UpdateCastingReq;
}

/**
 * Merge one update into the intake: scalars set/overwrite when provided; notes APPEND (never
 * replace). Every accepted value is hard-capped (C8): scalars to `scalarMax`, notes to `noteMax`
 * each and `notesMax` total — the durable intake can never become an unbounded payload store.
 *
 * Recognized-synonym keys are aliased onto their canonical field first (issue #1033), so a model that
 * writes `name`/`notes` fills `playerName`/`interviewNotes` instead of being silently dropped.
 */
export function mergeCastingUpdate(intake: CastingIntake, rawReq: UpdateCastingReq): CastingIntake {
  const req = aliasCastingKeys(rawReq);
  const next: CastingIntake = { ...intake, interviewNotes: [...intake.interviewNotes] };
  for (const { field } of CASTING_COVERAGE) {
    if (field === "interviewNotes") continue;
    const v = req[field];
    if (typeof v === "string" && v.trim().length > 0) next[field] = v.trim().slice(0, CASTING_LIMITS.scalarMax);
  }
  for (const raw of req.interviewNotes ?? []) {
    const note = String(raw).trim().slice(0, CASTING_LIMITS.noteMax);
    if (note.length > 0 && !next.interviewNotes.includes(note) && next.interviewNotes.length < CASTING_LIMITS.notesMax) {
      next.interviewNotes.push(note);
    }
  }
  return next;
}

/**
 * Which scalar fields this update OVERWRITES (audit C8): a field already captured whose value the
 * update replaces with a DIFFERENT (post-cap, trimmed) value. A first write to an empty field is a
 * capture, not an overwrite; a re-write of the identical value is a no-op. Notes APPEND, so they
 * are never overwrites. The producer surfaces these so it can confirm, never silently clobber.
 */
export function overwrittenScalars(intake: CastingIntake, rawReq: UpdateCastingReq): string[] {
  const req = aliasCastingKeys(rawReq);
  const hits: string[] = [];
  for (const { field } of CASTING_COVERAGE) {
    if (field === "interviewNotes") continue;
    const v = req[field];
    if (typeof v !== "string" || v.trim().length === 0) continue;
    const prev = intake[field];
    const incoming = v.trim().slice(0, CASTING_LIMITS.scalarMax);
    if (typeof prev === "string" && prev.trim().length > 0 && prev !== incoming) hits.push(field);
  }
  return hits;
}

/** The recognized casting fields — exactly the `UpdateCastingReq` keys (the coverage set). */
const CASTING_FIELDS: ReadonlySet<string> = new Set<string>(CASTING_COVERAGE.map(({ field }) => field));

/**
 * Keys the caller passed that the engine did NOT merge (audit R4-01). A recognized synonym (`name`,
 * `notes`, …) is now aliased onto its canonical field (issue #1033) and is therefore NOT ignored —
 * only a genuinely unknown key (a typo, an off-schema field) is reported, so the producer learns the
 * answer didn't land and can re-file it. Echoing these is the casting-seam counterpart of the FE's
 * under-call error correction: a wrong-key write self-corrects instead of silently vanishing.
 */
export function ignoredCastingKeys(req: object): string[] {
  return Object.keys(req).filter(
    (k) => !CASTING_FIELDS.has(k) && CASTING_KEY_ALIASES[k.toLowerCase()] === undefined,
  );
}

/** True when a field has been captured (notes: at least one recorded). */
function captured(intake: CastingIntake, field: keyof CastingIntake): boolean {
  if (field === "interviewNotes") return intake.interviewNotes.length > 0;
  const v = intake[field];
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Where the interview stands. `ready` is the hard gate (a name exists); `missing`/`next` are the
 * engine-ordered coverage still to acquire — the producer follows the engine, not its own memory.
 */
export function castingStatusOf(intake: CastingIntake, overwrote: string[] = []): CastingStatusView {
  const known: Record<string, string> = {};
  const missing: string[] = [];
  let next: string | null = null;
  for (const { field, ask } of CASTING_COVERAGE) {
    if (captured(intake, field)) {
      known[field] = field === "interviewNotes"
        ? `${intake.interviewNotes.length} note${intake.interviewNotes.length === 1 ? "" : "s"}`
        : (intake[field] as string);
    } else {
      missing.push(field);
      if (next === null) next = ask;
    }
  }
  const status: CastingStatusView = {
    known,
    missing,
    next,
    ready: captured(intake, "playerName"),
    finalizable: castingFinalizable(intake),
  };
  if (overwrote.length > 0) status.overwrote = overwrote;
  return status;
}

/** True when nothing has been captured yet (a fresh interview — nothing to persist or resume). */
export function intakeIsEmpty(intake: CastingIntake): boolean {
  return CASTING_COVERAGE.every(({ field }) => !captured(intake, field));
}

/**
 * The FINALIZE floor (the mobile short-circuit fix, feature 0050): `ready` (name-only) is the floor
 * for an EXPLICIT, player-driven finalize, but it is NOT enough to FORCE-finalize from an automated
 * fallback — name+photo alone produced a "floater with no stats." `finalizable` requires that a
 * genuine interview actually happened: a name, a backstory, a motivation, AND at least one persona/
 * strategy answer. `castPhoto` is OPTIONAL and never counts toward it.
 */
export const CASTING_FINALIZE_FLOOR: ReadonlyArray<keyof CastingIntake> = [
  "playerName",
  "backstory",
  "motivation",
] as const;

/** At least one of these must be captured for the interview to be finalizable. */
const CASTING_FINALIZE_ANY_OF: ReadonlyArray<keyof CastingIntake> = [
  "personaArchetype",
  "personaStrategyStyle",
  "privateStrategy",
] as const;

/**
 * True when a genuine interview has happened — enough authored substance that a finalize mints a real
 * houseguest, not the default floater. The hard floor (name+backstory+motivation) plus at least one
 * persona/strategy answer. `castPhoto` does NOT count.
 */
export function castingFinalizable(intake: CastingIntake): boolean {
  return (
    CASTING_FINALIZE_FLOOR.every((field) => captured(intake, field)) &&
    CASTING_FINALIZE_ANY_OF.some((field) => captured(intake, field))
  );
}
