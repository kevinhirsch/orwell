import { describe, it } from "vitest";
import fc from "fast-check";
import { buildSandbox } from "../support/sandbox";
import { assertNoSentinels, assertNoneAppear } from "../support/assertions";

describe("Vault Wall — property over seeds & surfaces", () => {
  it("no Vault sentinel or hidden content ever reaches any outward surface", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000 }), (seed) => {
        const sb = buildSandbox(seed);
        const blob = `${sb.allPlayerOutputs()}\n${sb.adminOutput()}`;
        assertNoSentinels(blob, sb.sentinels);
        assertNoneAppear(blob, sb.hiddenContents);
      }),
      { numRuns: 250 },
    );
  });
});
