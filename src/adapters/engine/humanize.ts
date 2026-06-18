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
  let out = content;
  for (const e of [...entities].sort((a, b) => b.id.length - a.id.length)) {
    const escaped = e.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // (?<![\w:]) / (?![\w:]) : the id must stand alone, not be a fragment of a longer token
    // (so the word "players" survives, and "npc:1" never matches inside "npc:15").
    out = out.replace(new RegExp(`(?<![\\w:])${escaped}(?![\\w:])`, "g"), e.name);
  }
  return out;
}
