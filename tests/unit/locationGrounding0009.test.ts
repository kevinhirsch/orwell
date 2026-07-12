import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import type { EntityId } from "../../src/domain/ids";
import type { WhereaboutsView } from "../../src/ports/GameSession";

/**
 * ADR 0009 / roadmap R4 (#1415) — location & movement grounding, VERIFIED under stress.
 *
 * ADR 0009 is built (D1 freeze · D2 record-move · D3 barrier + pre-emission guard · D4 dual-map).
 * R4 is the *verification* item: prove the "people make sense — one place at a time" invariant holds
 * where the narrator actually reads it — the Vault-free `whereabouts()` projection that grounds the
 * moment prompt's WHERE-YOU-ARE block AND feeds "The House" gadget (they read the SAME projection, so
 * narration↔panel parity is by construction). This suite pins the four grounding guarantees that the
 * narrator depends on and that a future change could silently break:
 *   1. Every name in the projection is the CANONICAL roster name (`nameOf`) — a name cannot drift.
 *   2. One place at a time — no houseguest appears in two visible places in a single read.
 *   3. Never an evicted/unknown houseguest — the evicted are nowhere.
 *   4. Name grounding does NOT degrade on the resume/re-entry path (F-S4-F) — the re-entry moment
 *      carries the FULL roster, identical to a live turn.
 * All held across a MOVEMENT STRESS run (many seeded ticks interleaved with recorded narrated moves).
 * HARD rule: roles only — no fixture names; names are read back from the roster, never asserted.
 */

function liveGame(seed: number) {
  const reg = new GameSessionRegistry();
  const user = `loc-r4-u${seed}`;
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "The Player", seed });
  return { reg, user, s: sb.session };
}

/** The canonical name for every houseguest — the single source of truth the projection must echo. */
function rosterNames(s: ReturnType<typeof liveGame>["s"]): Map<EntityId, string> {
  const core = s.snapshot();
  const m = new Map<EntityId, string>();
  m.set(core.house!.player.id, core.house!.player.name);
  for (const n of core.house!.npcs) m.set(n.id, n.name);
  return m;
}

/** The houseguests still in the house (the evicted are nowhere). */
function livingSet(s: ReturnType<typeof liveGame>["s"]): Set<EntityId> {
  const core = s.snapshot();
  const evicted = new Set(core.live?.evictionOrder ?? []);
  return new Set([...rosterNames(s).keys()].filter((id) => !evicted.has(id)));
}

/** Every place-claim the projection makes, as `{id,name}` refs tagged by the bucket they came from. */
function placedRefs(w: WhereaboutsView): Array<{ id: EntityId; name: string; where: string }> {
  const out: Array<{ id: EntityId; name: string; where: string }> = [];
  for (const p of w.present) out.push({ id: p.id, name: p.name, where: `room:${w.room}` });
  for (const n of w.nearby) for (const p of n.present) out.push({ id: p.id, name: p.name, where: `sightline:${n.room}` });
  for (const t of w.tracked) out.push({ id: t.id, name: t.name, where: `tracked:${t.room}` });
  if (w.houseEvent) {
    for (const p of w.houseEvent.competing ?? []) out.push({ id: p.id, name: p.name, where: "event:competing" });
    for (const p of w.houseEvent.spectating ?? []) out.push({ id: p.id, name: p.name, where: "event:spectating" });
  }
  return out;
}

/** The four grounding invariants, asserted against ONE read. Returns the named violations. */
function groundingViolations(w: WhereaboutsView, names: Map<EntityId, string>, living: Set<EntityId>): string[] {
  const out: string[] = [];
  const seen = new Map<EntityId, string>();
  for (const ref of placedRefs(w)) {
    // (1) name grounding — the projection echoes the roster name exactly (no drift).
    if (names.get(ref.id) !== ref.name) out.push(`${ref.id} named "${ref.name}" but roster says "${names.get(ref.id)}"`);
    // (3) only real, living houseguests are ever placed.
    if (!living.has(ref.id)) out.push(`${ref.id} placed at ${ref.where} but is evicted/unknown (the evicted are nowhere)`);
    // (2) one place at a time — an id may make at most ONE place-claim per read.
    const prior = seen.get(ref.id);
    if (prior !== undefined) out.push(`${ref.id} in two places at once: ${prior} AND ${ref.where}`);
    else seen.set(ref.id, ref.where);
  }
  // companions carry the same people as `present` (the L21/L24 tenure ride) — never a stray placement.
  for (const c of w.companions) {
    if (names.get(c.id) !== c.name) out.push(`companion ${c.id} named "${c.name}" but roster says "${names.get(c.id)}"`);
    if (!w.present.some((p) => p.id === c.id)) out.push(`companion ${c.id} is not in the player's room (present)`);
  }
  return out;
}

describe("ADR 0009 / R4 — whereabouts is the single grounding source (name-true · one-place · living-only)", () => {
  it("every placed houseguest is roster-named, living, and in exactly one place — across a movement-stress run", () => {
    const { s } = liveGame(31);
    const names = rosterNames(s);
    const playerId = s.snapshot().house!.player.id;
    // MOVEMENT STRESS: drive many seeded off-screen ticks (NPCs roam) AND interleave recorded narrated
    // relocations (the D2 fold), re-checking the narrator-facing projection at every step.
    for (let i = 0; i < 48; i++) {
      s.presenceTick(new SeededRandom(4000 + i));
      if (i % 4 === 0) {
        const dest = i % 8 === 0 ? "backyard" : "kitchen";
        const mover = [...s.occupancy()!.entries()].find(([id, r]) => id !== playerId && r !== dest)?.[0];
        if (mover) s.recordHouseguestMove(mover, dest); // a narrated NPC move, folded into the open set
      }
      const w = s.whereabouts()!;
      expect(groundingViolations(w, names, livingSet(s))).toEqual([]);
    }
  });

  it("a recorded narrated move into the player's room surfaces the SAME roster name to BOTH the projection and the moment-prompt (narration↔panel parity)", () => {
    const { s } = liveGame(17);
    s.movePlayer("kitchen"); // a walkable, sightline room — deterministic ground for the scene
    const core = s.snapshot();
    const mover = core.house!.npcs.map((n) => n.id).find((id) => s.occupancy()!.get(id) !== "kitchen")!;
    expect(mover).toBeDefined();
    const rosterName = core.house!.npcs.find((n) => n.id === mover)!.name;

    // D2/D3: the model narrates "they head to the kitchen"; the engine RECORDS it into the open set.
    expect(s.recordHouseguestMove(mover, "kitchen").status).toBe("moved");

    // The gadget projection now places them there, by their roster name (no drift).
    const w = s.whereabouts()!;
    expect(w.room).toBe("kitchen");
    expect(w.present.find((p) => p.id === mover)?.name).toBe(rosterName);

    // The NARRATOR reads the same fact: the WHERE-YOU-ARE block names that houseguest in this room, so
    // the prose the player reads and the panel they see agree by construction (ADR 0009's whole point).
    const prompt = s.getMomentPrompt({}).systemPrompt;
    const wa = prompt.slice(prompt.indexOf("WHERE YOU ARE"));
    const block = wa.slice(0, wa.indexOf("\n- ", 10) >= 0 ? wa.indexOf("\n- ", 10) : 900);
    expect(block).toContain("kitchen");
    expect(block).toContain(rosterName);
  });

  it("an evicted houseguest is nowhere — absent from the projection AND the occupancy — across a driven season", () => {
    const { s } = liveGame(2);
    let evicted: EntityId | null = null;
    for (let i = 0; i < 600; i++) {
      const v = s.advanceGame();
      if (v.pending) {
        const p = v.pending;
        if (p.kind === "nominations") s.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
        else if (p.kind === "veto-decision") s.submitDecision({ kind: "veto-decision", use: false });
        else if (p.kind === "comp-intent") s.submitDecision({ kind: "comp-intent", intent: "compete" });
        else if (p.kind === "finale-statement") s.submitDecision({ kind: "finale-statement", statement: "x" });
        else if (p.kind === "finale-answer") s.submitDecision({ kind: "finale-answer", appeal: p.appeals![0]! });
        else if (p.options[0]) s.submitDecision({ kind: p.kind, vote: p.options[0].id, replacement: p.options[0].id } as never);
      }
      const order = s.snapshot().live?.evictionOrder ?? [];
      if (order.length > 0) { evicted = order[0]!; break; }
      if (v.finished) break;
    }
    expect(evicted).not.toBeNull();
    // The raw open set drops the evicted immediately (the presence contract).
    expect(s.occupancy()!.has(evicted!)).toBe(false);
    // And the narrator-facing projection never names them anywhere (present/nearby/tracked/event).
    const w = s.whereabouts();
    if (w) expect(placedRefs(w).map((r) => r.id)).not.toContain(evicted);
  });
});

describe("ADR 0009 / R4 — F-S4-F: name grounding does not degrade on the resume/re-entry path", () => {
  it("the re-entry moment carries the FULL roster (every houseguest, the single-source-of-truth anchor) — identical to a live turn", () => {
    const { s } = liveGame(23);
    const names = [...rosterNames(s).values()];

    // The resume/re-entry framing (a fresh mid-season context, chat_helpers P2) and an ordinary live
    // turn both compose through buildSystemPrompt → renderGameContext, so both carry the WHOLE roster.
    const reentry = s.getMomentPrompt({ moment: "re-entry" }).systemPrompt;
    const live = s.getMomentPrompt({}).systemPrompt;

    for (const nm of names) {
      expect(reentry, `re-entry prompt is missing a houseguest — grounding thinned on resume`).toContain(nm);
      expect(live).toContain(nm);
    }
    // The anchor that makes the roster authoritative for names must be present on the resume path too.
    expect(reentry).toContain("single source of truth for who each person IS");
  });
});
