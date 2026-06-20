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
 * The post-season retrospective scrub (0048 — the Wall's ONE sanctioned reveal). The unsealed hidden
 * story may carry content the everyday player-facing scrub never has to handle: a COMPOUND machine id
 * (`thread:npc:8:0`) that hides an `npc:N` inside it (the whole-token `humanizeIds` deliberately skips
 * it — `npc:8` is not a whole token there), a bare `thread:…` identifier, and the thread machine slugs
 * (`[dormant]`, `surfaces via: gossip-diffused`, `goal-demands-move`, …). This scrub is for THAT surface
 * only: it resolves every id even inside a compound token, then drops/translates the remaining machine
 * scaffolding. Pure / Vault-free (names are public roster facts; slugs are internal plumbing). Idempotent.
 */
export function humanizeForRetrospective(
  content: string,
  entities: ReadonlyArray<{ id: string; name: string }>,
): string {
  let out = content;
  // 1) TRANSLATE the machine scaffolding (audit slugs + serializer labels) into readable prose FIRST —
  //    before any id resolution. Doing the labels first matters: a label like `day-1 read of player:`
  //    contains the bare word `player`, and resolving that id first would corrupt the label so it could
  //    never be matched. Each `…:` label becomes a natural clause; lifecycle/trigger/pathway slugs go.
  out = out
    // story-thread serialization
    .replace(/\bstory-thread\s*/g, "")
    .replace(/\[dormant\]/g, "(never surfaced)")
    .replace(/\[active\]/g, "(in play)")
    .replace(/\[surfaced\]/g, "(came out)")
    .replace(/\[resolved\]/g, "(played out)")
    .replace(/\[expired\]/g, "(passed)")
    .replace(/\bpremise:\s*/g, "")
    .replace(/\bsecret\s*—\s*/g, "secretly ")
    .replace(/\bweakness\s*—\s*/g, "a blind spot — ")
    .replace(/\btrue goal\s*—\s*/g, "their real game — ")
    .replace(/\btrigger:\s*/g, "")
    .replace(/\((?:on-block|nominated-twice|cornered-socially|house-tightens|goal-demands-move)\)/g, "")
    .replace(/\bsurfaces via:[^\n]*/g, "")
    .replace(/\b(?:gossip-diffused|told-by-confidant|overheard|witnessed)\b/g, "")
    // deep-profile serialization (`deep-profile <id> | secrets: … | true-goals: … | weakness: … |
    // day-1 read of player: …`). The `day-1 read of player:` label is translated BEFORE the `player`
    // id is resolved, and the leading `deep-profile` tag is dropped (the resolved NAME leads the line).
    .replace(/\bday-1 read of player:\s*/g, "their day-one read of you — ")
    .replace(/\bdeep-profile\s+/g, "")
    .replace(/\bsecrets:\s*/g, "secretly — ")
    .replace(/\btrue-goals:\s*/g, "their real game — ")
    .replace(/\bweakness:\s*/g, "their blind spot — ")
    .replace(/\s*\|\s*/g, "; ");
  // 2) RESOLVE every entity id to a name.
  if (entities.length > 0) {
    const byId = new Map(entities.map((e) => [e.id, e.name] as const));
    // The AGGRESSIVE (non-whole-token) passes resolve ids EMBEDDED in machine tokens. Restrict them to
    // COLON-BEARING ids (`npc:3`, a compound `thread:npc:3:0`) — those never collide with an ordinary
    // English word. A bare-word id like the player's `player` is deliberately EXCLUDED from them:
    // resolving it non-whole-token would mangle the word "players" (audit A8). The whole-token pass
    // below handles `player` safely.
    const structuredAlt = entities
      .filter((e) => e.id.includes(":"))
      .sort((a, b) => b.id.length - a.id.length)
      .map((e) => e.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");
    out = humanizeIds(out, entities); // safe whole-token pass (a clean `npc:3` / `player`; protects "players")
    if (structuredAlt) {
      // The COMPOUND machine thread identifier `thread:<npc>:<index>` is not player-readable, but it NAMES
      // a houseguest — RESOLVE the embedded id to that name and DROP the rest of the id.
      const idRe = new RegExp(`(?:${structuredAlt})`);
      out = out.replace(/\bthread:[\w:-]+/g, (tok) => {
        const m = idRe.exec(tok);
        return m ? (byId.get(m[0]) ?? "") : "";
      });
      // Any structured id still embedded in another machine token (e.g. a `deep-profile npc:3` lead).
      out = out.replace(new RegExp(`(?:${structuredAlt})`, "g"), (m) => byId.get(m) ?? m);
    }
  } else {
    // No roster to resolve against — still strip the un-player-readable bare thread identifier.
    out = out.replace(/\bthread:[\w:-]+/g, "");
  }
  // 3) The everyday pathway-slug tidy (gossip drift suffix, leaked colon-pathways), then collapse the
  //    whitespace the drops left behind.
  out = tidyPathwaySlugs(out);
  return out.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, " — ").replace(/\s+([.,])/g, "$1").trim();
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
