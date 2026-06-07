import assert from "node:assert/strict";

/** No fixture-injected Vault sentinel may appear in an outward-facing string. */
export function assertNoSentinels(output: string, sentinels: readonly string[]): void {
  for (const s of sentinels) {
    assert.ok(!output.includes(s), `Vault sentinel leaked to an outward surface: ${s}`);
  }
}

/** No raw hidden Vault content may appear in an outward-facing string. */
export function assertNoneAppear(output: string, contents: readonly string[]): void {
  for (const c of contents) {
    assert.ok(!output.includes(c), `Hidden Vault content leaked to an outward surface: ${c}`);
  }
}
