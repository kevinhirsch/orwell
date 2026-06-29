import type { NotorietySummary } from "../engine/notoriety";

/**
 * Feature 0104 — per-USER (account-level), season-over-season NOTORIETY persistence. Keyed by the
 * physical-world user (0021), SEPARATE from the per-season `UserSaveStore` so it survives the
 * `registry.resetUser` season cutover by construction (the dead season's saves rotate off; this does
 * not). The same physical user across all their seasons; never a cross-user read (R3) — `read(user)`
 * returns ONLY that user's own accumulated reputation, exactly as the Vault Wall + 0021 demand.
 *
 * `accumulate` is MONOTONIC in `seasonsPlayed` and merges reputation/`bestPlacement` (non-degradation,
 * mandate #4) — notoriety DEEPENS across seasons, never overwrites to a thinner state. The store holds
 * only a bounded `NotorietySummary` (open-set facts) — NO Vault record, soul, or hidden edge (R1) — so
 * it is ENGINE-ONLY but is NOT secret state behind the Vault wall (an outward Vault-free projection of
 * it, if ever wanted, is a deliberate separate surface, out of scope v1).
 */
export interface UserNotorietyStore {
  /** The user's accumulated notoriety, or null if they have none (a brand-new user / never finished a season). */
  read(user: string): NotorietySummary | null;
  /** Fold a freshly-derived summary into the user's accumulated notoriety (monotonic merge) and persist. */
  accumulate(user: string, summary: NotorietySummary): void;
}
