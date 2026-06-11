/**
 * Typed error taxonomy for the engine's outward seams (audit E3/E7).
 *
 * The HTTP boundary used to classify "deliberate refusal" as `constructor === Error`, which made a
 * disk failure (Node fs errors are plain `Error`s) read as the CALLER's fault — a 400 that leaked
 * the data-dir path — and let a faulted integrity commit return 200 with a view of rolled-back
 * state. These classes give each failure mode its own identity:
 *
 * - `EngineRefusal` — a DELIBERATE engine refusal (illegal input, unavailable tool): the caller's
 *   fault, HTTP 400. Plain `Error` throws from older validation sites still classify the same way
 *   (back-compat); new refusal sites should prefer this class.
 * - `TurnRefusedError` — the fail-closed integrity checkpoint (0031) refused the commit and rolled
 *   the sandbox back. State is unchanged and NOTHING was persisted; the request itself FAILS
 *   (HTTP 409) — never 200-then-rollback (audit E3/D1). Carries only fault KINDS, never content.
 * - `PersistFailureError` — the durable save itself failed (disk full, I/O). Its own fault class,
 *   never misread as "degradation" and never fail-open (audit E7): the turn is rolled back, the
 *   message is sanitized (no paths), HTTP 500.
 *
 * Pure domain module: no I/O, importable by every layer (the outward HTTP transport included).
 */

/** A deliberate engine refusal — the caller's fault (HTTP 400). */
export class EngineRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineRefusal";
  }
}

/** The integrity checkpoint refused the commit; the sandbox was rolled back (HTTP 409). */
export class TurnRefusedError extends Error {
  constructor(public readonly kinds: readonly string[]) {
    super(`turn refused — integrity checkpoint failed (${kinds.join(", ")}); state unchanged`);
    this.name = "TurnRefusedError";
  }
}

/** The durable save failed; the turn was rolled back, nothing persisted (HTTP 500, sanitized). */
export class PersistFailureError extends Error {
  constructor() {
    super("the turn could not be saved and was rolled back — nothing was lost; try again");
    this.name = "PersistFailureError";
  }
}
