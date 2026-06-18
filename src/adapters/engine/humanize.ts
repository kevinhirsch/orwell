/**
 * The pure `humanizeIds` helper now lives in the domain (`src/domain/humanize.ts`) so BOTH the
 * engine-adapter NPC-voicing path AND the outward player surfaces may share it without an adapter
 * import crossing the Vault-Wall arch boundary (audit R4-03 / C-01): `src/domain/**` is
 * dependency-free and importable everywhere; `src/adapters/**` is not. This module re-exports it so
 * the existing engine-side importers (`GameSessionAdapter`) are unchanged.
 */
export { humanizeIds, tidyPathwaySlugs, humanizeForPlayer } from "../../domain/humanize";
