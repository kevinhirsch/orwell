import { describe, it, expect } from "vitest";
import { HealthMetrics, FAILURE_RING_CAPACITY, errorClassOf } from "../../src/adapters/mcp/healthMetrics";
import { EngineRefusal, TurnRefusedError, PersistFailureError } from "../../src/domain/errors";

/**
 * Lane G1 — the /health failure ring. Roles only, no names: the entries are tool
 * names from the static allowlist plus sanitized error classes — never payloads.
 */
describe("HealthMetrics — the capped recent-failure ring (G1)", () => {
  it("caps the ring at FAILURE_RING_CAPACITY, dropping the oldest", () => {
    const m = new HealthMetrics(() => 1000);
    const overflow = 17;
    for (let i = 0; i < FAILURE_RING_CAPACITY + overflow; i++) {
      m.recordFailure(`tool-${i}`, "Error", i);
    }
    const snap = m.snapshot();
    expect(snap.recentFailures).toHaveLength(FAILURE_RING_CAPACITY);
    // oldest entries fell off the front; the newest survives at the tail
    expect(snap.recentFailures[0]!.tool).toBe(`tool-${overflow}`);
    expect(snap.recentFailures.at(-1)!.tool).toBe(`tool-${FAILURE_RING_CAPACITY + overflow - 1}`);
    expect(snap.toolCalls.failed).toBe(FAILURE_RING_CAPACITY + overflow); // counters keep the full tally
  });

  it("entries carry EXACTLY {ts, tool, errorClass, durationMs} — never payloads or messages", () => {
    const m = new HealthMetrics(() => 42_000);
    m.recordFailure("advanceGame", "EngineRefusal", 12.6);
    const [entry] = m.snapshot().recentFailures;
    expect(Object.keys(entry!).sort()).toEqual(["durationMs", "errorClass", "tool", "ts"]);
    expect(entry).toEqual({ ts: 42_000, tool: "advanceGame", errorClass: "EngineRefusal", durationMs: 13 });
  });

  it("the snapshot never contains an error MESSAGE, only the class (the Vault rule)", () => {
    const m = new HealthMetrics();
    const sentinel = "VAULT-SENTINEL-the-hidden-payload";
    const e = new EngineRefusal(`refused: ${sentinel}`);
    m.recordFailure("submitDecision", errorClassOf(e), 5);
    const blob = JSON.stringify(m.snapshot());
    expect(blob).not.toContain(sentinel);
    expect(blob).toContain("EngineRefusal");
  });

  it("errorClassOf maps typed engine errors to their class name and non-Errors safely", () => {
    expect(errorClassOf(new TurnRefusedError(["x"]))).toBe("TurnRefusedError");
    expect(errorClassOf(new PersistFailureError())).toBe("PersistFailureError");
    expect(errorClassOf(new EngineRefusal("x"))).toBe("EngineRefusal");
    expect(errorClassOf(new Error("x"))).toBe("Error");
    expect(errorClassOf("a thrown string")).toBe("NonError");
    expect(errorClassOf(undefined)).toBe("NonError");
  });

  it("tracks uptime and total/failed counters; successes never enter the ring", () => {
    let now = 10_000;
    const m = new HealthMetrics(() => now);
    m.recordSuccess("getGameState", 3);
    m.recordSuccess("gameStatus", 2);
    m.recordFailure("advanceGame", "Error", 7);
    now += 95_500;
    const snap = m.snapshot();
    expect(snap.uptimeSeconds).toBe(95);
    expect(snap.toolCalls).toEqual({ total: 3, failed: 1 });
    expect(snap.recentFailures).toHaveLength(1);
  });

  it("snapshot returns copies — a caller cannot mutate the ring", () => {
    const m = new HealthMetrics(() => 1);
    m.recordFailure("diaryRoom", "Error", 1);
    const snap = m.snapshot();
    snap.recentFailures[0]!.tool = "tampered";
    snap.recentFailures.push({ ts: 2, tool: "injected", errorClass: "Error", durationMs: 0 });
    const fresh = m.snapshot();
    expect(fresh.recentFailures).toHaveLength(1);
    expect(fresh.recentFailures[0]!.tool).toBe("diaryRoom");
  });
});
