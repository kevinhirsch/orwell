import { GameSessionRegistry } from "../../src/composition/registry";
import type { UserSandbox } from "../../src/composition/registry";
import { Orchestrator } from "../../src/composition/orchestrator";
import { occupancyViolations } from "../../src/domain/house";
import type { Occupancy } from "../../src/domain/house";
import type { AdvanceView } from "../../src/ports/GameSession";
import type { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { PLAYER, npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";

/**
 * The ADR-0003 testability harness (B66) — REUSABLE structural assertions for the principles the
 * ADR promises ("each of these is testable structurally where possible"). Each helper returns a
 * list of VIOLATIONS (empty = the principle holds) so suites can name exactly what broke, and new
 * features can re-run the same checks instead of re-deriving them. Roles only — no fixture names.
 */

/** A standard registry-built fixture: the production object graph, one started game. */
export function adrFixture(user: string, seed: number): {
  reg: GameSessionRegistry; sb: UserSandbox; orch: Orchestrator;
} {
  const reg = new GameSessionRegistry();
  const orch = new Orchestrator(reg, { now: () => seed }, { seed, turnDriven: true });
  reg.setCommit((u) => orch.commitPlayerTurn(u));
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "The Player", seed });
  return { reg, sb, orch };
}

/** Resolve any pending decision legally (the loop's own NPC-equivalent picks). */
export function resolvePending(s: GameSessionAdapter, p: NonNullable<AdvanceView["pending"]>): void {
  if (p.kind === "nominations") s.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
  else if (p.kind === "veto-decision") s.submitDecision({ kind: "veto-decision", use: false });
  else if (p.kind === "comp-intent") s.submitDecision({ kind: "comp-intent", intent: "compete" });
  else if (p.kind === "comp-round") s.submitDecision({ kind: "comp-round", intent: "compete" }); // 0006 staged-rounds
  else if (p.kind === "finale-statement") s.submitDecision({ kind: "finale-statement", statement: "x" });
  else if (p.kind === "finale-answer") s.submitDecision({ kind: "finale-answer", appeal: p.appeals![0]! });
  else if (p.options[0]) s.submitDecision({ kind: p.kind, vote: p.options[0].id, replacement: p.options[0].id } as never);
}

/**
 * ADR 0003 §8 — presence coherence (B64): every active houseguest in exactly one room, movement
 * adjacency-only, across `ticks` off-screen ticks. Returns the named violations.
 */
export function presenceCoherenceViolations(
  fixture: { reg: GameSessionRegistry; sb: UserSandbox; orch: Orchestrator },
  user: string,
  ticks = 10,
): string[] {
  const out: string[] = [];
  let previous: Occupancy | null = null;
  for (let t = 0; t < ticks; t++) {
    const res = fixture.orch.advance(user, "offscreen-tick");
    if (res.integrity !== "ok") out.push(`tick ${t}: integrity ${res.integrity}`);
    const core = fixture.sb.session.snapshot();
    const evicted = new Set(core.live?.evictionOrder ?? []);
    const active = [core.house!.player.id, ...core.house!.npcs.map((n) => n.id)].filter((id) => !evicted.has(id));
    const occ = fixture.sb.session.occupancy();
    if (!occ) { out.push(`tick ${t}: no occupancy`); continue; }
    out.push(...occupancyViolations(active, occ, previous ?? undefined).map((v) => `tick ${t}: ${v}`));
    previous = occ;
  }
  return out;
}

/**
 * ADR 0003 §8 — knowledge-scoped speech (B65): plant a UNIQUE sentinel in every active NPC's
 * knowledge, then assert each NPC's voicing context carries exactly their own and no one else's.
 */
export function knowledgeScopeViolations(sb: UserSandbox): string[] {
  const out: string[] = [];
  const core = sb.session.snapshot();
  const evicted = new Set(core.live?.evictionOrder ?? []);
  const active = core.house!.npcs.filter((n) => !evicted.has(n.id)).map((n) => n.id);
  const sentinelOf = new Map<EntityId, string>();
  // Sentinels carry NO entity id: the voicing projection humanizes ids into names, which would
  // rewrite an id-bearing marker and blind the check.
  for (const [ix, id] of active.entries()) {
    const s = `SENTINEL-ADR8-holder-${ix}-end`; // terminated: "-1" must never match inside "-11"
    sentinelOf.set(id, s);
    sb.engine.knowledge.seedBelief(id, { content: s, factId: `adr8:${ix}` }, "witnessed");
  }
  for (const id of active) {
    const voice = JSON.stringify(sb.session.npcVoice(id));
    if (!voice.includes(sentinelOf.get(id)!)) out.push(`${id}: missing their OWN knowledge`);
    for (const [other, s] of sentinelOf) {
      if (other !== id && voice.includes(s)) out.push(`${id}: voices ${other}'s private knowledge`);
    }
  }
  return out;
}

/**
 * ADR 0003 §8 — persona stability (B61): the public facets fed to the narrator are byte-identical
 * across `turns` advances (no drift between turns/context windows).
 */
export function personaDriftViolations(sb: UserSandbox, turns = 20): string[] {
  const facets = (): string =>
    JSON.stringify(sb.session.getGameState().house
      .filter((h) => h.status === "active")
      // L29: the physical look rides as the STRUCTURED facet (the single source of truth); the prose
      // `appearance` is the pre-0058 fallback only — fingerprint whichever the card carries.
      .map((h) => [h.id, h.archetype, h.strategyStyle, h.background, h.age, h.physicalCharacteristics ?? h.appearance, h.presentation]));
  const before = facets();
  for (let i = 0; i < turns; i++) {
    const v = sb.session.advanceGame();
    if (v.pending) resolvePending(sb.session, v.pending);
    if (v.finished) break;
  }
  // Compare only the houseguests still active now (the departed legitimately drop their vibe line).
  const stillActive = new Set(sb.session.getGameState().house.filter((h) => h.status === "active").map((h) => h.id));
  const beforeRows = (JSON.parse(before) as Array<[string, ...unknown[]]>).filter((r) => stillActive.has(r[0]));
  const afterRows = JSON.parse(facets()) as Array<[string, ...unknown[]]>;
  return JSON.stringify(beforeRows) === JSON.stringify(afterRows) ? [] : ["persona facets drifted across turns"];
}

/**
 * ADR 0003 §7 — lingering safety (B64): N consecutive mill/talk turns leave week, phase, and the
 * pending ceremony untouched, and the play-clock activity stamp treats milling as ACTIVITY.
 */
export function lingeringViolations(
  fixture: { reg: GameSessionRegistry; sb: UserSandbox; orch: Orchestrator },
  user: string,
  turns = 12,
): string[] {
  const out: string[] = [];
  const s = fixture.sb.session;
  // Reach a pending decision so "the scheduled beat" is observable.
  let pending = s.advanceGame().pending;
  for (let i = 0; i < 300 && !pending; i++) pending = s.advanceGame().pending;
  if (!pending) return ["no pending decision reached — cannot observe lingering"];
  const before = { week: s.gameStatus().week, phase: s.gameStatus().phase, kind: pending.kind };

  for (let i = 0; i < turns; i++) {
    if (!s.whereabouts()) out.push(`turn ${i}: whereabouts unavailable while milling`);
    fixture.sb.commands.recordInteraction({
      initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: `lingering chat ${i}`, kind: "bonding",
    });
    const status = s.gameStatus();
    if (status.week !== before.week) out.push(`turn ${i}: the week moved (${before.week} → ${status.week})`);
    if (status.phase !== before.phase) out.push(`turn ${i}: the phase moved (${before.phase} → ${status.phase})`);
    const nowPending = s.advanceGame().pending;
    if (nowPending?.kind !== before.kind) out.push(`turn ${i}: the pending ceremony changed`);
  }
  if (fixture.orch.idleSince(user) === Infinity) out.push("milling did not register as play-clock activity");
  return out;
}
