import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { Orchestrator } from "../../src/composition/orchestrator";
import { FakeClock } from "../../src/adapters/time/FakeClock";
import type { UserSandbox } from "../../src/composition/registry";
import type { StoryThread } from "../../src/engine/deepProfile";

/**
 * Feature 0101 (#1401) — the AI SHOWRUNNER's Vault-Wall BOUNDARY TEST (the sibling of
 * `producerVault.test.ts` / the 0060 no-leak sentinel). The producer notes CONSUME Vault content (they
 * orchestrate hidden threads), so they are themselves VAULT-HELD: they must never reach ANY player- OR
 * admin/God-Mode-facing projection, and unseal ONLY in the 0048 post-season retrospective (the season's
 * "production bible"). This test PROVES:
 *   (1) the layer genuinely produces notes (non-vacuous),
 *   (2) the Vault sentinel sweep over EVERY player projection AND `admin.inspect()` finds no note —
 *       pre-finale (the Wall) and, for admin, post-finale too (God Mode is never the unseal channel),
 *   (3) a note NEVER launders a thread PREMISE (a planted premise sentinel never appears in a note),
 *   (4) `seasonRetrospective()` is NULL while the season is live (the structural gate),
 *   (5) post-finale the retrospective RENDERS the notes, and the debug `producerVaultDump()` (the ONE
 *       sanctioned live unseal, admin-channel only) surfaces them.
 * HARD rule: roles only — no fixture names.
 */

/** Drive one live-loop beat + resolve any pending decision (deterministic; the 0060-test pattern). */
function stepLoop(sb: UserSandbox): boolean {
  const adv = sb.session.advanceGame();
  if (adv.pending) {
    const p = adv.pending;
    if (p.kind === "nominations") sb.session.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
    else if (p.kind === "veto-decision") sb.session.submitDecision({ kind: "veto-decision", use: false });
    else if (p.kind === "replacement") sb.session.submitDecision({ kind: "replacement", replacement: p.options[0]!.id });
    else if (p.kind === "finale-statement") sb.session.submitDecision({ kind: "finale-statement", statement: "x" });
    else if (p.kind === "finale-answer") sb.session.submitDecision({ kind: "finale-answer", appeal: p.appeals![0]! });
    else if (p.kind === "juror-vote") sb.session.submitDecision({ kind: "juror-vote", vote: p.options[0]!.id });
    else sb.session.submitDecision({ kind: p.kind, vote: p.options[0]!.id } as never);
  }
  return adv.finished;
}

/** Every player-facing projection + the God-Mode inspection, as one swept string (the 0060 leak surface). */
function liveSurfaces(sb: UserSandbox): string {
  sb.syncAdmin?.();
  const active = sb.session.getGameState().house.filter((h) => h.status === "active");
  return [
    JSON.stringify(sb.session.getGameState()),
    JSON.stringify(sb.player.getVisibleState()),
    JSON.stringify(sb.session.getMomentPrompt({})),
    active.map((h) => JSON.stringify(sb.session.npcVoice(h.id))).join(""),
    JSON.stringify(sb.admin.inspect()),          // God Mode — walled from the Vault, notes included
    JSON.stringify(sb.admin.health?.() ?? null), // Vault-free health metadata
  ].join("\n---\n");
}

const SENT = "SENTINEL-showrunner-premise";

describe("0101/#1401 — the showrunner's producer notes are VAULT-HELD (the boundary proof)", () => {
  const reg = new GameSessionRegistry();
  const user = "showrunner-vault";
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "The Player", archetype: "floater", seed: 7 });
  sb.session.setShowrunnerEnabled(true);

  // Plant a sentinel into EVERY thread premise/trigger (the 0058/0060 plant pattern): a note must never
  // carry a premise, so this sentinel must never surface in a rendered note either (defense-in-depth).
  const core0 = sb.session.snapshot();
  for (const t of (core0.storyThreads ?? []) as StoryThread[]) {
    t.premise = `${t.premise} ${SENT}`;
    t.trigger = `${t.trigger} ${SENT}`;
  }
  sb.session.restore(core0);

  // Drive a BOUNDED partial season (never to the finale) with the showrunner ON, so notes accumulate on
  // the real off-screen tick while the season stays LIVE (so the retrospective gate is genuinely closed).
  const orch = new Orchestrator(reg, new FakeClock(), { seed: 7 });
  let finished = false;
  for (let i = 0; i < 12 && !finished; i++) {
    finished = stepLoop(sb);
    if (!finished) orch.advance(user, "offscreen-tick");
  }

  it("(1) the layer genuinely composed producer notes (non-vacuous) + a monotonic count", () => {
    const core = sb.session.snapshot();
    expect((core.showrunnerNotes ?? []).length).toBeGreaterThan(0);
    expect(core.showrunnerNoteCount ?? 0).toBe((core.showrunnerNotes ?? []).length);
    expect(finished).toBe(false); // still live (the gate below is meaningful)
  });

  it("(2) NO note content reaches any player projection OR admin.inspect() while the season is live", () => {
    const surfaces = liveSurfaces(sb);
    // The exact rendered note rows (from the debug unseal) are the strongest marker — none may leak.
    const dump = sb.session.producerVaultDump();
    const noteRows = (dump?.hiddenStory ?? []).filter((r) => r.type === "Producer's note").map((r) => r.content);
    expect(noteRows.length).toBeGreaterThan(0); // the notes DO exist in the Vault layer…
    for (const row of noteRows) expect(surfaces.includes(row)).toBe(false); // …but never on a live surface
    // The producer-note render markers are unique to the unseal — they must never appear live.
    expect(surfaces).not.toContain("Producer's note");
    expect(surfaces).not.toContain("the producers");
    // Every stored rationale phrase is absent from the live surfaces too (belt to the row check above).
    for (const note of sb.session.snapshot().showrunnerNotes ?? []) {
      for (const e of note.emphases) expect(surfaces.includes(e.rationale)).toBe(false);
    }
  });

  it("(3) a note NEVER launders a thread PREMISE — the premise sentinel appears in no rendered note", () => {
    const dump = sb.session.producerVaultDump();
    const noteRows = (dump?.hiddenStory ?? []).filter((r) => r.type === "Producer's note").map((r) => r.content);
    for (const row of noteRows) expect(row.includes(SENT)).toBe(false);
    // And of course the premise sentinel never reaches a live surface at all.
    expect(liveSurfaces(sb).includes(SENT)).toBe(false);
  });

  it("(4) seasonRetrospective() is NULL while the season is live (the structural gate)", () => {
    expect(sb.session.seasonRetrospective()).toBeNull();
  });

  it("(5) post-finale the retrospective RENDERS the notes; admin.inspect() still never does", () => {
    sb.session.advanceToFinale(); // drive to a crown so the 0048 unseal opens (L38)
    const retro = sb.session.seasonRetrospective();
    expect(retro).not.toBeNull();
    const retroNotes = (retro!.hiddenStory ?? []).filter((r) => r.type === "Producer's note");
    expect(retroNotes.length).toBeGreaterThan(0); // the production bible unseals here — the great artifact
    for (const r of retroNotes) expect(r.content.includes(SENT)).toBe(false); // still no premise
    // God Mode is NEVER the unseal channel — even post-finale, admin.inspect() carries no note.
    sb.syncAdmin?.();
    const adminView = JSON.stringify(sb.admin.inspect());
    expect(adminView).not.toContain("Producer's note");
    expect(adminView).not.toContain("the producers");
  });
});
