import { describe, it, expect } from "vitest";
import type { AddressInfo } from "node:net";
import { createHttpMcpServer } from "../../src/adapters/mcp/HttpMcpServer";
import { GameSessionRegistry } from "../../src/composition/registry";
import { MCP_PROTOCOL_VERSION } from "../../src/adapters/mcp/jsonRpc";

/**
 * The additive MCP / JSON-RPC 2.0 envelope (`POST /:channel/rpc`) rides the SAME permissioned
 * router as the REST `/call` path, so the Vault Wall and per-user isolation hold identically.
 * HARD rule: roles only — no fixture names.
 */
async function withServer(
  deps: Parameters<typeof createHttpMcpServer>[0],
  opts: Parameters<typeof createHttpMcpServer>[1],
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const server = createHttpMcpServer(deps, opts);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

const liveResolver = (): Parameters<typeof createHttpMcpServer>[0] => ({ resolve: new GameSessionRegistry().resolver() });

const rpc = (base: string, channel: string, payload: unknown, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(`${base}/${channel}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });

// JSON-RPC bodies are dynamic by nature; read them loosely in the test.
type Json = Record<string, unknown> & { [k: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const readJson = async (res: Response): Promise<Json> => (await res.json()) as Json;

describe("MCP / JSON-RPC 2.0 envelope", () => {
  it("initialize returns the protocol version, capabilities, and serverInfo", async () => {
    await withServer(liveResolver(), {}, async (base) => {
      const res = await rpc(base, "player", { jsonrpc: "2.0", id: 1, method: "initialize" });
      expect(res.status).toBe(200);
      const j = await readJson(res);
      expect(j.jsonrpc).toBe("2.0");
      expect(j.id).toBe(1);
      expect(j.result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
      expect(j.result.capabilities.tools).toBeDefined();
      expect(j.result.serverInfo.name).toBe("orwell-engine");
    });
  });

  it("tools/list returns the channel allowlist; player and admin differ (isolation)", async () => {
    await withServer(liveResolver(), {}, async (base) => {
      const pj = await readJson(await rpc(base, "player", { jsonrpc: "2.0", id: 2, method: "tools/list" }));
      const names: string[] = pj.result.tools.map((t: { name: string }) => t.name);
      expect(names).toContain("getGameState");
      expect(names).not.toContain("inspectNonVaultState"); // admin-only — never on the player channel
      for (const t of pj.result.tools) expect(t.inputSchema).toEqual({ type: "object" }); // no invented schema

      const aj = await readJson(await rpc(base, "admin", { jsonrpc: "2.0", id: 3, method: "tools/list" }));
      const adminNames: string[] = aj.result.tools.map((t: { name: string }) => t.name);
      expect(adminNames).toContain("inspectNonVaultState");
      expect(adminNames).not.toEqual(names);
    });
  });

  it("tools/call runs a real read tool and returns MCP content", async () => {
    await withServer(liveResolver(), {}, async (base) => {
      const j = await readJson(await rpc(
        base, "player",
        { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "getGameState", arguments: {} } },
        { "x-orwell-user": "u-rpc-1" },
      ));
      expect(j.result.isError).toBe(false);
      expect(j.result.content[0].type).toBe("text");
      expect(() => JSON.parse(j.result.content[0].text)).not.toThrow(); // a real engine result
    });
  });

  it("a forbidden (off-channel) tool is isError content, not a crash or a leak", async () => {
    await withServer(liveResolver(), {}, async (base) => {
      const j = await readJson(await rpc(
        base, "player",
        { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "inspectNonVaultState", arguments: {} } },
        { "x-orwell-user": "u-rpc-2" },
      ));
      expect(j.result.isError).toBe(true);
      expect(j.result.content[0].text).toContain("not available");
    });
  });

  // CON-6 — a stale compare-and-swap write (0065 Part A) used to flatten into the SAME opaque
  // `{error: msg}` text as every other tool failure over JSON-RPC, losing the machine `code`, the
  // CURRENT `beatSeq`, and the Vault-free `board` the REST `/call` 409 mapping already carries — so a
  // JSON-RPC caller had nothing to reconcile against but a human-readable sentence.
  it("a stale expectedBeatSeq over JSON-RPC carries {code, beatSeq, board} in the isError content (CON-6)", async () => {
    await withServer(liveResolver(), {}, async (base) => {
      const user = "u-rpc-stale";
      const created = await readJson(await rpc(
        base, "player",
        { jsonrpc: "2.0", id: 20, method: "tools/call", params: { name: "createCharacter", arguments: { playerName: "P", seed: 3 } } },
        { "x-orwell-user": user },
      ));
      expect(created.result.isError).toBe(false);
      const current = (JSON.parse(created.result.content[0].text) as { beatSeq: number }).beatSeq;

      const stale = await readJson(await rpc(
        base, "player",
        { jsonrpc: "2.0", id: 21, method: "tools/call", params: { name: "advanceGame", arguments: { expectedBeatSeq: current - 1 } } },
        { "x-orwell-user": user },
      ));
      // Protocol-success envelope (never a JSON-RPC-level error — a stale write is a tool refusal, not
      // a protocol fault), but the content payload now carries the SAME structured shape REST does.
      expect(stale.error).toBeUndefined();
      expect(stale.result.isError).toBe(true);
      const body = JSON.parse(stale.result.content[0].text) as { error: string; code: string; beatSeq: number; board: unknown };
      expect(body.code).toBe("stale-beat");
      expect(body.beatSeq).toBe(current); // the CURRENT counter, so the caller can re-ground immediately
      expect(body.board).toBeTruthy(); // the Vault-free board, same as the REST mapping
      expect(body.error).toMatch(/stale/i);
    });
  });

  it("protocol faults: unknown method ⇒ -32601, parse error ⇒ -32700 (id null), bad params ⇒ -32602", async () => {
    await withServer(liveResolver(), {}, async (base) => {
      const nf = await readJson(await rpc(base, "player", { jsonrpc: "2.0", id: 6, method: "no/such" }));
      expect(nf.error.code).toBe(-32601);

      const pj = await readJson(await fetch(`${base}/player/rpc`, { method: "POST", body: "{not json" }));
      expect(pj.error.code).toBe(-32700);
      expect(pj.id).toBeNull();

      const bp = await readJson(await rpc(base, "player", { jsonrpc: "2.0", id: 7, method: "tools/call", params: {} }));
      expect(bp.error.code).toBe(-32602);
    });
  });

  it("a notification (no id) gets a 202 with no body", async () => {
    await withServer(liveResolver(), {}, async (base) => {
      const res = await rpc(base, "player", { jsonrpc: "2.0", method: "notifications/initialized" });
      expect(res.status).toBe(202);
      expect(await res.text()).toBe("");
    });
  });

  it("auth: a configured token gates rpc; the player token cannot reach the admin channel", async () => {
    await withServer(liveResolver(), { token: "p-secret", adminToken: "a-secret" }, async (base) => {
      expect((await rpc(base, "player", { jsonrpc: "2.0", id: 8, method: "initialize" })).status).toBe(401);
      expect((await rpc(base, "player", { jsonrpc: "2.0", id: 9, method: "initialize" }, { authorization: "Bearer p-secret" })).status).toBe(200);
      expect((await rpc(base, "admin", { jsonrpc: "2.0", id: 10, method: "initialize" }, { authorization: "Bearer p-secret" })).status).toBe(401);
      expect((await rpc(base, "admin", { jsonrpc: "2.0", id: 11, method: "initialize" }, { authorization: "Bearer a-secret" })).status).toBe(200);
    });
  });

  it("the existing REST /call path still works unchanged", async () => {
    await withServer(liveResolver(), {}, async (base) => {
      const res = await fetch(`${base}/player/call`, {
        method: "POST",
        headers: { "x-orwell-user": "u-rest" },
        body: JSON.stringify({ name: "getGameState", args: {} }),
      });
      expect(res.status).toBe(200);
      expect((await readJson(res)).result).toBeDefined();
    });
  });

  it("a batch returns an array of responses, omitting notifications", async () => {
    await withServer(liveResolver(), {}, async (base) => {
      const res = await rpc(base, "player", [
        { jsonrpc: "2.0", id: 1, method: "initialize" },
        { jsonrpc: "2.0", method: "notifications/initialized" }, // omitted from the response
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
      ]);
      expect(res.status).toBe(200);
      const arr = (await res.json()) as Array<{ id: number }>;
      expect(Array.isArray(arr)).toBe(true);
      expect(arr.length).toBe(2);
      expect(arr.map((r) => r.id).sort()).toEqual([1, 2]);
    });
  });
});
