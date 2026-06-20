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
 * Merge one update into the intake: scalars set/overwrite when provided; notes APPEND (never
 * replace). Every accepted value is hard-capped (C8): scalars to `scalarMax`, notes to `noteMax`
 * each and `notesMax` total — the durable intake can never become an unbounded payload store.
 */
export function mergeCastingUpdate(intake: CastingIntake, req: UpdateCastingReq): CastingIntake {
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
export function overwrittenScalars(intake: CastingIntake, req: UpdateCastingReq): string[] {
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
 * Keys the caller passed that are NOT casting fields (audit R4-01). A model that records under
 * `name` (the field is `playerName`), `notes`, or a typo would otherwise have its answer SILENTLY
 * dropped and casting would stall. Echoing these lets the producer re-file under the right field.
 */
export function ignoredCastingKeys(req: object): string[] {
  return Object.keys(req).filter((k) => !CASTING_FIELDS.has(k));
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
