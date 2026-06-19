/**
 * Pure id/slug humanization for PLAYER-FACING prose. No I/O — just string/regex work — so it lives
 * in the domain and is importable by BOTH the engine adapters (the NPC-voicing path) AND the outward
 * services/surfaces (the player's own reads), without either crossing the Vault-Wall arch boundary
 * (`src/domain/**` is dependency-free and importable everywhere; `src/adapters/**` is not — audit
 * R4-03 / C-01). The adapter module `src/adapters/engine/humanize.ts` now re-exports from here.
 *
 * Two transforms, both Vault-free (they only tidy machine tokens the engine interpolated into
 * otherwise-public prose — names are public roster facts, slugs are internal plumbing):
 *   - `humanizeIds`  : raw entity ids (`player` / `npc:3`) → public houseguest names.
 *   - `tidyPathwaySlugs` : neutralize internal pathway/diffusion slugs that should never appear in
 *                          player-facing text (`overheard:offscreen:alliance:1:594987875`, a gossip
 *                          drift suffix like ` · more or less#754`).
 */

/**
 * Turn raw loop-event prose (which interpolates entity ids like `player` / `npc:3`) into
 * player-facing text by substituting each id with its public name.
 *
 * Audit A8: the player's id is the bare English word `player` (`domain/ids.ts`), so a naive
 * `string.split(id).join(name)` mangles the ordinary words "player"/"players" that appear in
 * beat prose — the live repro was *"the veto Quinn Vales are drawn … the final Quinn Vale"*.
 * The cure is to replace each id only as a WHOLE TOKEN: an id is bounded by characters that
 * cannot be part of an id (id chars are word chars plus `:`), so "players" (a word char follows
 * the `player` token) is never touched, while a genuine `player` / `npc:3` reference is.
 *
 * Longest ids first so a short id can never clobber part of a longer one (e.g. `npc:1` inside
 * `npc:15`) — redundant with the token boundary, kept as defence in depth.
 */
export function humanizeIds(content: string, entities: ReadonlyArray<{ id: string; name: string }>): string {
  return makeIdHumanizer(entities)(content);
}

/**
 * Build a REUSABLE id→name substituter for a fixed roster. The matcher compiles ONCE (a single
 * alternation regex over all ids) and then applies to many strings — the hot player-projection path
 * cleans the whole growing event log per commit, so re-compiling 16 per-id regexes per event was a
 * dominant per-season cost (CPU-profiled). The output is byte-identical to the prior per-id loop:
 *
 *   - longest id first in the alternation ⇒ a short id can never match inside a longer one
 *     (`npc:1` never clobbers `npc:15`) — the same guarantee the prior longest-first sort gave;
 *   - the same `(?<![\w:]) … (?![\w:])` whole-token boundary, so the word "players" is never touched;
 *   - one left-to-right scan with non-overlapping matches reproduces the sequential `replace` result —
 *     names carry no id tokens, so an earlier substitution can never create a new match (same as before).
 */
export function makeIdHumanizer(
  entities: ReadonlyArray<{ id: string; name: string }>,
): (content: string) => string {
  if (entities.length === 0) return (content) => content;
  const byId = new Map<string, string>();
  for (const e of entities) byId.set(e.id, e.name);
  // Longest id first so the alternation prefers the longer token at any position (matches the prior sort).
  const alternation = [...entities]
    .sort((a, b) => b.id.length - a.id.length)
    .map((e) => e.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const re = new RegExp(`(?<![\\w:])(?:${alternation})(?![\\w:])`, "g");
  return (content) => content.replace(re, (m) => byId.get(m) ?? m);
}

/**
 * Neutralize internal pathway/diffusion SLUGS that must never reach player-facing prose. These are
 * machine tokens the knowledge/gossip layer interpolates into a pathway or (when a slug is built
 * into content) into the content itself — not anything the player should read raw (audit R4-03):
 *
 *  - colon-delimited pathway slugs that survived into content, e.g. `overheard:offscreen:alliance:1:594987875`
 *    — collapsed to a calm prose gloss ("something they half-overheard").
 *  - the gossip drift suffix `distort()` appends, ` · more or less#754` — dropped (it is bookkeeping
 *    for diffusion provenance, not narration).
 *
 * Pure and idempotent; runs AFTER `humanizeIds` (so any ids inside a slug are gone first).
 */
export function tidyPathwaySlugs(content: string): string {
  let out = content;
  // The gossip drift marker: " · <drift phrase>#<digits>" (from src/engine/gossip.ts `distort`).
  out = out.replace(/\s*·\s*[^·#]*#\d+/g, "");
  // A bare pathway slug that leaked into content: `overheard:…`/`offscreen:…`/`told-by:…`/`gossip:…`
  // followed by colon-joined machine tokens. Replace the whole run with a neutral gloss.
  out = out.replace(
    /\b(?:overheard|offscreen|told-by|gossip|surfaced)(?::[\w:-]+)+/gi,
    "something they half-overheard",
  );
  return out.trimEnd();
}

/** Humanize ids AND tidy pathway slugs in one pass — the player-facing content scrub. */
export function humanizeForPlayer(
  content: string,
  entities: ReadonlyArray<{ id: string; name: string }>,
): string {
  return makeForPlayerScrub(entities)(content);
}

/**
 * A REUSABLE player-facing content scrub for a fixed roster (`humanizeIds` then `tidyPathwaySlugs`).
 * Compile once, apply to many strings — the visible-state projection scrubs the whole event log per
 * read, so the id matcher must not recompile per event. Byte-identical to `humanizeForPlayer` per call.
 */
export function makeForPlayerScrub(
  entities: ReadonlyArray<{ id: string; name: string }>,
): (content: string) => string {
  const humanize = makeIdHumanizer(entities);
  return (content) => tidyPathwaySlugs(humanize(content));
}

/**
 * A player-friendly label for a knowledge PATHWAY slug (audit R4-03): the raw pathway is internal
 * plumbing — `told-by:npc:3`, `overheard:offscreen:alliance:1:594987875`, `witnessed`, … — that
 * must never appear verbatim in a player-facing log. Maps the slug's KIND to calm prose and names
 * the teller (when the pathway carries one and the roster resolves it). Pure / Vault-free.
 */
export function pathwayLabel(
  pathway: string,
  entities: ReadonlyArray<{ id: string; name: string }>,
): string {
  const told = /^told-by:(.+)$/.exec(pathway);
  if (told) {
    const teller = entities.find((e) => e.id === told[1]);
    return teller ? `told by ${teller.name}` : "told by a houseguest";
  }
  if (/^overheard\b/.test(pathway)) return "overheard";
  if (/^diary-room\b/.test(pathway)) return "diary room";
  if (/^witnessed\b/.test(pathway)) return "saw it yourself";
  if (/^(gossip|origin|surfaced)\b/.test(pathway)) return "word around the house";
  // Any other slug shape: strip embedded ids/slug noise and fall back to a generic source.
  const scrubbed = humanizeForPlayer(pathway, entities);
  return /[:#]/.test(scrubbed) || scrubbed === pathway ? "around the house" : scrubbed;
}
