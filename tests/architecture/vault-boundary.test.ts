import { describe, it, expect } from "vitest";
import { vaultBoundaryViolations } from "../support/architecture";

describe("Vault Wall — structural boundary (dependency graph)", () => {
  it("no outward module depends on the Vault or the engine-only vector index", async () => {
    const violations = await vaultBoundaryViolations();
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
});
