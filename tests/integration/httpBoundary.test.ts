import { describe, it, expect } from "vitest";
import type { Server, AddressInfo } from "node:net";
import { createHttpMcpServer, startHttpMcp } from "../../src/adapters/mcp/HttpMcpServer";
import type { HttpMcpOptions } from "../../src/adapters/mcp/HttpMcpServer";
import { buildMcpServers } from "../../src/composition/appRoot";
import { GameSessionRegistry } from "../../src/composition/registry";

/**
 * Feature B34 / audit E1 — the engine network edge. The in-process Vault Wall + per-user isolation
 * (0021) already hold; these prove the *network* boundary is enforced: loopback bind by default, a
 * shared-secret token, multi-user identity required (no silent "default" routing), and no sandbox
 * minting for an unknown caller. HARD rule: roles only — no names.
 */

/** Start a server on an ephemeral loopback port; returns its base URL + a closer. */
async function listen(server: Server, host = "127.0.0.1"): Promise<{ base: string; close: () => Promise<void> }> {
  await new Promise<void>((resolve) => server.listen(0, host, () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    base: `http://${host}:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const post = (base: string, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("B34 — engine network boundary", () => {
  it("binds loopback (127.0.0.1) by default", async () => {
    const server = startHttpMcp(buildMcpServers(), 0); // default host
    await new Promise<void>((resolve) => server.on("listening", () => resolve()));
    const addr = server.address() as AddressInfo;
    expect(addr.address).toBe("127.0.0.1"); // never 0.0.0.0 — not reachable cross-host
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("requires the shared-secret token on tool routes when configured (401 on mismatch)", async () => {
    const { base, close } = await listen(createHttpMcpServer(buildMcpServers(), { token: "s3cret" }));
    try {
      // Health stays an open liveness probe.
      expect((await fetch(`${base}/health`)).status).toBe(200);
      // No token / wrong token ⇒ 401.
      expect((await fetch(`${base}/player/tools`)).status).toBe(401);
      expect((await fetch(`${base}/player/tools`, { headers: { "x-orwell-token": "nope" } })).status).toBe(401);
      // Correct token, either header form ⇒ allowed.
      expect((await fetch(`${base}/player/tools`, { headers: { "x-orwell-token": "s3cret" } })).status).toBe(200);
      expect((await fetch(`${base}/player/tools`, { headers: { authorization: "Bearer s3cret" } })).status).toBe(200);
    } finally {
      await close();
    }
  });

  it("rejects a missing user header in multi-user mode (400, never a shared default)", async () => {
    const reg = new GameSessionRegistry();
    const opts: HttpMcpOptions = { requireUser: true };
    const { base, close } = await listen(createHttpMcpServer({ resolve: reg.resolver() }, opts));
    try {
      const headerless = await post(base, "/player/call", { name: "createCharacter", args: { playerName: "P", seed: 1 } });
      expect(headerless.status).toBe(400);
      // With identity asserted, the same call proceeds — and no "default" sandbox was ever created.
      const withUser = await post(base, "/player/call", { name: "createCharacter", args: { playerName: "P", seed: 1 } }, { "x-orwell-user": "u1" });
      expect(withUser.status).toBe(200);
      expect(reg.usernames()).toEqual(["u1"]);
      expect(reg.usernames()).not.toContain("default");
    } finally {
      await close();
    }
  });

  it("does not mint a sandbox for an unknown user's non-createCharacter call (404)", async () => {
    const reg = new GameSessionRegistry();
    const knownUser = (u: string): boolean => reg.usernames().includes(u);
    const { base, close } = await listen(createHttpMcpServer({ resolve: reg.resolver() }, { knownUser }));
    try {
      // An anonymous id spraying advanceGame is refused without ever minting a sandbox (DoS guard).
      const ghost = await post(base, "/player/call", { name: "advanceGame", args: {} }, { "x-orwell-user": "ghost" });
      expect(ghost.status).toBe(404);
      expect(reg.userCount()).toBe(0);
      // createCharacter is the one tool that may start a fresh game; afterward the user is known.
      const start = await post(base, "/player/call", { name: "createCharacter", args: { playerName: "P", seed: 1 } }, { "x-orwell-user": "real" });
      expect(start.status).toBe(200);
      const resume = await post(base, "/player/call", { name: "advanceGame", args: {} }, { "x-orwell-user": "real" });
      expect(resume.status).toBe(200);
    } finally {
      await close();
    }
  });
});

describe("B35 — the request handler is guarded (audit E2)", () => {
  it("a sandbox-resolution failure for one user is a 500, never a process crash for the rest", async () => {
    const reg = new GameSessionRegistry();
    const inner = reg.resolver();
    // Simulate an unreadable save surfacing during resume for one user only.
    const resolver = {
      resolve: (channel: "player" | "admin", user: string) => {
        if (user === "boom") throw new Error("unreadable save");
        return inner(channel, user);
      },
    };
    const { base, close } = await listen(createHttpMcpServer(resolver));
    try {
      const boom = await post(base, "/player/call", { name: "createCharacter", args: { playerName: "P", seed: 1 } }, { "x-orwell-user": "boom" });
      expect(boom.status).toBe(500); // contained to this request
      // The process is alive and other users are unaffected.
      const ok = await post(base, "/player/call", { name: "createCharacter", args: { playerName: "P", seed: 1 } }, { "x-orwell-user": "ok" });
      expect(ok.status).toBe(200);
    } finally {
      await close();
    }
  });
});
