import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import type { AdvanceView, PendingDecisionView } from "../../src/ports/GameSession";
import { composeRuntime } from "../../src/composition/runtime";
import { FakeClock } from "../../src/adapters/time/FakeClock";
import { PersistFailureError } from "../../src/domain/errors";
import type { UserSaveStore } from "../../src/ports/UserSaveStore";
import type { SessionSnapshot } from "../../src/engine/sessionSnapshot";

/**
 * T0-2 — "beats terminate themselves" (moonshot P1 stage 1 / #27a; `docs/audits/
 * 2026-07-21-campaign-report-and-exhaustive-backlog.md` DoR/AC/DoD). Resolving a CLOSED-SET ceremony
 * pending (`AUTO_ADVANCE_PENDING_KINDS` in `GameSessionAdapter.ts`) now auto-advances the live loop
 * ONE more deterministic step IN THE SAME committed transaction — `submitDecision` never leaves the
 * game sitting at "resolved, but nothing moved" waiting for a separate `advanceGame` call. Pendings
 * that carry the player's own expressive content (goodbye messages, the interactive finale…) keep
 * their CURRENT semantics — resolving them does NOT auto-advance.
 *
 * Games are driven through a real `composeRuntime` (not a bare `GameSessionAdapter`) because
 * `beatSeq` only bumps through the registry's commit funnel (0065 Part A) — the invariant this suite
 * exists to pin needs that funnel wired up, exactly like a live game.
 *
 * HARD rule: roles only — no fixture names asserted.
 */

/** Resolve a pending decision LEGALLY, whatever kind it is (a generic driver, no strategy asserted). */
function resolveLegally(s: GameSessionAdapter, p: PendingDecisionView): void {
  if (p.kind === "nominations") s.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
  else if (p.kind === "veto-decision") s.submitDecision({ kind: "veto-decision", use: false });
  else if (p.kind === "replacement") s.submitDecision({ kind: "replacement", replacement: p.options[0]!.id });
  else if (p.kind === "comp-intent" || p.kind === "comp-round") s.submitDecision({ kind: p.kind, intent: "compete" });
  else if (p.kind === "finale-statement") s.submitDecision({ kind: "finale-statement", statement: "x" });
  else if (p.kind === "finale-answer") s.submitDecision({ kind: "finale-answer", appeal: p.appeals![0]! });
  else if (p.kind === "juror-vote") s.submitDecision({ kind: "juror-vote", vote: p.options[0]!.id });
  else s.submitDecision({ kind: p.kind, vote: p.options[0]!.id } as never);
}

/** Drive a live game (via plain `advanceGame`, resolving every OTHER pending generically) until a
 *  pending of exactly `kind` appears for the player, or the season finishes. */
function driveToPendingKind(
  s: GameSessionAdapter, kind: PendingDecisionView["kind"], maxIterations = 1000,
): NonNullable<AdvanceView["pending"]> {
  let view: AdvanceView = s.advanceGame();
  for (let i = 0; i < maxIterations; i++) {
    if (view.pending?.kind === kind) return view.pending;
    if (view.finished) throw new Error(`game finished before reaching a '${kind}' pending`);
    if (view.pending) resolveLegally(s, view.pending);
    view = s.advanceGame();
  }
  throw new Error(`never reached a '${kind}' pending within ${maxIterations} iterations`);
}

/** A fresh started game over a real (in-memory-store) runtime, so `beatSeq` bumps through the
 *  registry's commit funnel exactly like production. */
function startedGame(seed: number) {
  const runtime = composeRuntime({ clock: new FakeClock() }); // no saveStore ⇒ in-memory only
  const user = `t0-2-${seed}-${Math.random().toString(36).slice(2)}`;
  const session = runtime.registry.sandboxFor(user).session;
  session.createCharacter({ playerName: "P", seed });
  return { runtime, user, session };
}

describe("T0-2 — resolving a CLOSED-SET ceremony pending auto-advances in ONE commit", () => {
  it("nominations: the veto field is already drawn immediately after submitDecision — no follow-up advanceGame needed", () => {
    const { session } = startedGame(81000);
    const pending = driveToPendingKind(session, "nominations");

    // Before the fix, resolving `nominations` left the loop sitting at "veto-competition, nothing
    // drawn yet" until a SEPARATE advanceGame() call ran the chip draw.
    expect(session.gameStatus().veto.players.length).toBe(0);
    const beatSeqBefore = session.gameStatus().beatSeq;

    const r1 = session.submitDecision({ kind: "nominations", choice: [pending.options[0]!.id, pending.options[1]!.id] });

    // The returned event is unchanged (still the nominations' OWN resolution) — the auto-advance
    // does not alter the existing single-event response contract.
    expect(r1.event?.beat).toBe("nominations");

    // THE PROOF: without a second call, the veto field is ALREADY drawn — the chip-draw ceremony
    // that used to require its own advanceGame() call already happened, inside the SAME commit.
    expect(session.gameStatus().veto.players.length).toBeGreaterThan(0);
    expect(r1.status.veto.players.length).toBeGreaterThan(0);

    // One committed transaction, one beatSeq bump — even though TWO beats (nominations + the veto
    // draw) resolved and were folded (0065 Part A: "bumped once per committed mutation").
    expect(r1.beatSeq).toBe(beatSeqBefore + 1);

    // A follow-up advanceGame() call is now a genuine settle/no-op for whatever the auto-advance
    // already produced: either a fresh pending was ALSO raised as part of the draw (Houseguest's
    // Choice) — in which case the follow-up call changes nothing further — or none was, in which
    // case the very next natural step (the staged veto comp) is what a plain call would have done
    // regardless (T0-2 only guarantees ONE extra step, not the whole chain).
    const r2 = session.advanceGame();
    if (r1.pending) {
      expect(r2.event).toBeNull();
      expect(r2.beatSeq).toBe(r1.beatSeq);
      expect(r2.pending?.kind).toBe(r1.pending.kind);
    } else {
      expect(r2.beatSeq).toBeGreaterThan(r1.beatSeq);
    }
  });

  it("veto-decision (unused): the eviction beat is already entered immediately after submitDecision", () => {
    const { session } = startedGame(81000);
    driveToPendingKind(session, "veto-decision");
    const beatSeqBefore = session.gameStatus().beatSeq;

    const r1 = session.submitDecision({ kind: "veto-decision", use: false });
    expect(r1.event?.beat).toBe("veto-ceremony");

    // One transaction, one beatSeq bump for the whole chain (veto-ceremony resolution + the follow-up
    // step into the eviction beat), same invariant as the nominations case above.
    expect(r1.beatSeq).toBe(beatSeqBefore + 1);

    // THE PROOF: the loop already moved past "veto-ceremony resolved, nothing else happened" — a
    // fresh pending (eviction-vote / tie-break) OR a real eviction-reveal event already landed, in
    // the SAME submitDecision call, without a follow-up advanceGame().
    const movedAlready = r1.pending !== null || r1.status.phase !== "veto-ceremony";
    expect(movedAlready).toBe(true);
  });

  it("does not remove the L39b/forced-tool_choice belts — they stay declared in the FE undercall inventory doc", () => {
    // T9 (owner resiliency ruling): T0-2 is an engine-side structural fix; it does not delete any FE
    // belt. This is a documentation/pointer check only (engine-side gate — the belts themselves live
    // in `frontend/`, out of this suite's reach).
    const doc = readFileSync(join(__dirname, "../../docs/design/undercall-seam-structural.md"), "utf8");
    expect(doc).toContain("L39b forced");
    expect(doc).toContain("T0-2");
  });
});

describe("T0-2 — the EXCLUDED pending kinds keep their CURRENT (non-auto-advancing) semantics", () => {
  it("goodbye-message: resolving the player's own goodbye does NOT auto-advance (a follow-up advanceGame is still required)", () => {
    const { session } = startedGame(81000);
    const pending = driveToPendingKind(session, "goodbye-message");
    const beatSeqBefore = session.gameStatus().beatSeq;

    const r1 = session.submitDecision({ kind: "goodbye-message", vote: pending.options[0]!.id });
    expect(r1.event?.beat).toBe("eviction-goodbye");
    // Resolving the goodbye is still exactly ONE commit on its own...
    expect(r1.beatSeq).toBe(beatSeqBefore + 1);

    // ...but UNLIKE the auto-advance-eligible kinds above, nothing further happened automatically:
    // the eviction reveal's next step (more goodbyes, the exit interview, or the result) STILL
    // requires its own separate advanceGame() call, which does REAL further work (a strictly later
    // beatSeq) — proving the goodbye-message resolution itself did not chain forward.
    const r2 = session.advanceGame();
    expect(r2.beatSeq).toBeGreaterThan(r1.beatSeq);
  });
});

describe("T0-2 — a failed persist rolls back BOTH the pending's resolution and its auto-advance", () => {
  class FlakyStore implements UserSaveStore {
    failing = false;
    private readonly saves = new Map<string, string>();
    saveFor(user: string, snapshot: SessionSnapshot): void {
      if (this.failing) throw new Error("ENOSPC: no space left on device");
      this.saves.set(user, JSON.stringify(snapshot));
    }
    hasSave(user: string): boolean { return this.saves.has(user); }
    loadLatest(user: string): SessionSnapshot | null {
      const blob = this.saves.get(user);
      return blob === undefined ? null : (JSON.parse(blob) as SessionSnapshot);
    }
  }

  const deepCapture = (snap: SessionSnapshot): SessionSnapshot =>
    JSON.parse(JSON.stringify(snap)) as SessionSnapshot;

  it("a disk failure during submitDecision(nominations) leaves NEITHER the nominations NOR the auto-advanced veto draw committed", () => {
    const store = new FlakyStore();
    const runtime = composeRuntime({ saveStore: store, clock: new FakeClock() });
    const user = "t0-2-fault";
    runtime.registry.sandboxFor(user).session.createCharacter({ playerName: "P", seed: 81000 });

    const pending = driveToPendingKind(runtime.registry.sandboxFor(user).session, "nominations");
    expect(runtime.registry.sandboxFor(user).session.gameStatus().veto.players.length).toBe(0);

    // The full pre-attempt baseline — both in-memory and durable — is what a refused commit must
    // restore EXACTLY (E3/E7: fail-closed, never a half-applied chain). A rolled-back commit REPLACES
    // the sandbox object (`registry.restore`), so every read after the throw must re-fetch
    // `sandboxFor(user)` fresh rather than reuse a pre-attempt reference (the existing #1106 tests'
    // own convention).
    const goodMemory = deepCapture(runtime.registry.snapshot(user));
    const goodDurable = store.loadLatest(user)!;

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      store.failing = true;
      expect(() =>
        runtime.registry.sandboxFor(user).session.submitDecision({
          kind: "nominations", choice: [pending.options[0]!.id, pending.options[1]!.id],
        }),
      ).toThrowError(PersistFailureError);

      // Neither half of the chained transaction survives: no nominees recorded, no veto field drawn —
      // the WHOLE in-memory sandbox rolled back to the pre-attempt baseline, and the durable save
      // (which never received the failed write) is untouched.
      expect(runtime.registry.sandboxFor(user).session.gameStatus().nominees.length).toBe(0);
      expect(runtime.registry.sandboxFor(user).session.gameStatus().veto.players.length).toBe(0);
      expect(deepCapture(runtime.registry.snapshot(user))).toEqual(goodMemory);
      expect(store.loadLatest(user)!).toEqual(goodDurable);

      // The disk recovers ⇒ the SAME decision now commits cleanly, chaining exactly as tested above.
      store.failing = false;
      const recovered = runtime.registry.sandboxFor(user).session.submitDecision({
        kind: "nominations", choice: [pending.options[0]!.id, pending.options[1]!.id],
      });
      expect(recovered.event?.beat).toBe("nominations");
      expect(runtime.registry.sandboxFor(user).session.gameStatus().veto.players.length).toBeGreaterThan(0);
    } finally {
      errSpy.mockRestore();
    }
  });
});
