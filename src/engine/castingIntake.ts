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
export function castingStatusOf(intake: CastingIntake): CastingStatusView {
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
  return { known, missing, next, ready: captured(intake, "playerName") };
}

/** True when nothing has been captured yet (a fresh interview — nothing to persist or resume). */
export function intakeIsEmpty(intake: CastingIntake): boolean {
  return CASTING_COVERAGE.every(({ field }) => !captured(intake, field));
}
