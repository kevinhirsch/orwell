import { describe, it, expect, vi } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { Orchestrator } from "../../src/composition/orchestrator";
import type { UserSaveStore } from "../../src/ports/UserSaveStore";
import type { SessionSnapshot } from "../../src/engine/sessionSnapshot";
import type { AdvanceView } from "../../src/ports/GameSession";
import type { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * B70 / test-audit C9 — the fail-closed paths the headline coverage masked: the orchestrator's
 * integrity ROLLBACK (what protects against persisting a degraded/leaky state) and the
 * finale-answer rejection. Roles only — no fixture names.
 */

/** A durable store that counts saves — proves a faulted advance persists NOTHING. */
class CountingStore implements UserSaveStore {
  saves = 0;
  private latest = new Map<string, SessionSnapshot>();
  saveFor(user: string, snapshot: SessionSnapshot): void {
    this.saves += 1;
    this.latest.set(user, snapshot);
  }
  hasSave(user: string): boolean { return this.latest.has(user); }
  loadLatest(user: string): SessionSnapshot | null { return this.latest.get(user) ?? null; }
}

describe("the integrity checkpoint is genuinely fail-closed (C9)", () => {
  it("a faulting advance rolls the sandbox back and persists NOTHING", () => {
    const store = new CountingStore();
    const reg = new GameSessionRegistry(store);
    const user = "fail-closed";
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // An apply step that LEAKS: it plants a secret as hidden AND echoes it player-witnessed —
      // the checkpoint must refuse the whole advance.
      const leak = "SENTINEL-C9-leak";
      const orch = new Orchestrator(reg, { now: () => 1 }, {
        seed: 1,
        apply: (sandbox) => {
          const n = sandbox.engine.events.query().length;
          sandbox.engine.events.record({ id: `c9:h:${n}`, ts: 9_400_000 + n, type: "conversation", initiator: npc(1), witnessSet: [npc(1), npc(2)], hidden: true, content: leak });
          sandbox.engine.events.record({ id: `c9:v:${n}`, ts: 9_400_001 + n, type: "house-event", initiator: PLAYER, witnessSet: [PLAYER], hidden: false, content: leak });
          return 2;
        },
      });
      reg.sandboxFor(user).session.createCharacter({ playerName: "The Player", seed: 1 });
      reg.saveUser(user);
      const savesBefore = store.saves;
      const eventsBefore = reg.sandboxFor(user).engine.events.query().length;

      const res = orch.advance(user, "offscreen-tick");
      expect(res.integrity).toBe("fault");
      expect(res.faults.map((f) => f.kind)).toContain("vault-leak");
      // Fail-closed: NOTHING persisted, and the in-memory sandbox rolled back clean.
      expect(store.saves).toBe(savesBefore);
      expect(reg.sandboxFor(user).engine.events.query().length).toBe(eventsBefore);
      const blob = JSON.stringify(reg.sandboxFor(user).engine.events.query());
      expect(blob).not.toContain(leak); // no aborted event left behind
      // The prior save is intact and loadable.
      expect(store.loadLatest(user)?.started).toBe(true);
    } finally {
      errSpy.mockRestore();
    }
  });
});

describe("finale-answer rejection (C9)", () => {
  function resolve(s: GameSessionAdapter, p: NonNullable<AdvanceView["pending"]>): void {
    if (p.kind === "nominations") s.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
    else if (p.kind === "veto-decision") s.submitDecision({ kind: "veto-decision", use: false });
    else if (p.kind === "comp-intent") s.submitDecision({ kind: "comp-intent", intent: "compete" });
    else if (p.kind === "finale-statement") s.submitDecision({ kind: "finale-statement", statement: "x" });
    else if (p.options[0]) s.submitDecision({ kind: p.kind, vote: p.options[0].id, replacement: p.options[0].id } as never);
  }

  it("an illegal appeal is refused; the pending question survives; a legal one proceeds", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const reg = new GameSessionRegistry();
      const sb = reg.sandboxFor(`finale-${seed}`);
      const s = sb.session;
      s.createCharacter({ playerName: "The Player", seed });
      for (let i = 0; i < 4000; i++) {
        // Test steering (engine-side seam): keep every hidden threat-read of the player at zero so
        // nominations/evictions pass them over and they genuinely REACH the Final 2 — the seam
        // under test is the finale-answer validation, not the player's odds.
        for (const h of s.snapshot().house!.npcs) sb.engine.relationships.edge(h.id, PLAYER).threat = 0;
        const v = s.advanceGame();
        if (v.pending?.kind === "finale-answer") {
          // Not in the engine's appeal enum ⇒ refused, with the decision still standing.
          expect(() => s.submitDecision({ kind: "finale-answer", appeal: "bribe-the-jury" })).toThrow(/legal/);
          const still = s.advanceGame().pending;
          expect(still?.kind).toBe("finale-answer");
          // The legal appeal the engine offered proceeds.
          const ok = s.submitDecision({ kind: "finale-answer", appeal: v.pending.appeals![0]! });
          expect(ok.started).toBe(true);
          return;
        }
        if (v.pending) resolve(s, v.pending);
        if (v.finished) break;
      }
    }
    throw new Error("no seed put the player in the Final 2 within the scan budget");
  });
});
