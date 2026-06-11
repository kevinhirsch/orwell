import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { createHttpMcpServer } from "../../src/adapters/mcp/HttpMcpServer";
import type { McpServer } from "../../src/adapters/mcp/McpServer";

/**
 * Lane 8 — HTTP-edge hardening (audit E32 + E8). Roles only — no names.
 *
 *  - E32: the shared-secret compare is constant-time (timingSafeEqual over digests) — behavior
 *    pinned at the 401/200 seam, the constant-time property pinned structurally (a timing
 *    assertion would be flaky by construction).
 *  - E8: an oversize asserted user id is refused with a deliberate 400 AT THE EDGE — it must
 *    never reach the save path, where hex-doubling would blow ENAMETOOLONG as a 500.
 */

async function withServer(
  options: Parameters<typeof createHttpMcpServer>[1],
  resolved: string[],
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const stub = {
    listTools: () => [],
    callTool: async () => ({ ok: true }),
  } as unknown as McpServer;
  const server = createHttpMcpServer(
    { resolve: (_c: "player" | "admin", user: string) => { resolved.push(user); return stub; } },
    options,
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

const call = (base: string, headers: Record<string, string>) =>
  fetch(`${base}/player/call`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ name: "getGameState", args: {} }),
  });

describe("E32 — shared-secret auth (constant-time compare)", () => {
  it("right token ⇒ 200; wrong token (same and different length) ⇒ 401; missing ⇒ 401", async () => {
    const token = "correct-horse-battery";
    await withServer({ token }, [], async (base) => {
      expect((await call(base, { authorization: `Bearer ${token}` })).status).toBe(200);
      expect((await call(base, { authorization: `Bearer wrong-horse-battery!!` })).status).toBe(401);
      expect((await call(base, { authorization: `Bearer short` })).status).toBe(401); // length mismatch
      expect((await call(base, {})).status).toBe(401);
      expect((await call(base, { "x-orwell-token": token })).status).toBe(200); // header form still works
    });
  });

  it("the compare is structurally constant-time (timingSafeEqual over fixed-length digests)", () => {
    const src = readFileSync("src/adapters/mcp/HttpMcpServer.ts", "utf8");
    expect(src).toContain("timingSafeEqual");
    // The raw `!==`/`===` token compare must be gone from the auth gate.
    expect(src).not.toMatch(/presentedToken\(req\.headers\)\s*[!=]==?\s*options\.token/);
  });
});

describe("E8 — asserted-user-id cap at the edge", () => {
  it("a >64-char user id is a deliberate 400 and never resolves a sandbox", async () => {
    const resolved: string[] = [];
    await withServer({}, resolved, async (base) => {
      const res = await call(base, { "x-orwell-user": "u".repeat(65) });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain("too long");
      expect(resolved).toEqual([]); // the oversize id never reached the resolver/save path
    });
  });

  it("a 64-char user id is accepted", async () => {
    const resolved: string[] = [];
    await withServer({}, resolved, async (base) => {
      const id = "u".repeat(64);
      expect((await call(base, { "x-orwell-user": id })).status).toBe(200);
      expect(resolved).toContain(id);
    });
  });
});
