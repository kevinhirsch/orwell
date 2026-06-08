import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server, AddressInfo } from "node:net";
import { createHttpMcpServer } from "../../src/adapters/mcp/HttpMcpServer";
import { buildMcpServers } from "../../src/composition/appRoot";

let server: Server;
let base: string;

beforeAll(async () => {
  server = createHttpMcpServer(buildMcpServers());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("HTTP MCP entrypoint (runnable engine)", () => {
  it("serves a health endpoint", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("exposes the player allowlist, all readsVault:false", async () => {
    const { tools } = (await (await fetch(`${base}/player/tools`)).json()) as { tools: Array<{ readsVault: boolean }> };
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.every((t) => t.readsVault === false)).toBe(true);
  });

  it("resolves a competition over HTTP, returning an outcome-only result", async () => {
    const res = await fetch(`${base}/player/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "resolveCompetition",
        args: {
          type: "endurance",
          participants: [
            { id: "player", stats: { physical: 0.5, mental: 0.5, social: 0.5 } },
            { id: "npc:1", stats: { physical: 0.6, mental: 0.5, social: 0.5 } },
          ],
          intents: [], seed: 1,
        },
      }),
    });
    const { result } = (await res.json()) as { result: Record<string, unknown> };
    expect(Object.keys(result).sort()).toEqual(["type", "winner"]);
  });

  it("onboards over HTTP: createCharacter -> getGameState -> getMomentPrompt (the front-end path)", async () => {
    const call = async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const res = await fetch(`${base}/player/call`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, args }),
      });
      const { result } = (await res.json()) as { result: Record<string, unknown> };
      return result;
    };

    const started = await call("createCharacter", { playerName: "The Player", seed: 7 });
    expect(started["started"]).toBe(true);
    expect((started["house"] as unknown[]).length).toBe(15);

    const state = await call("getGameState", {});
    expect((state["player"] as { name: string }).name).toBe("The Player");

    const prompt = await call("getMomentPrompt", { moment: "premiere" });
    expect(typeof prompt["systemPrompt"]).toBe("string");
    expect(prompt["systemPrompt"] as string).toContain("Big Brother");
  });

  it("rejects an admin tool on the player channel", async () => {
    const res = await fetch(`${base}/player/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "inspectNonVaultState", args: {} }),
    });
    expect(res.status).toBe(400);
  });
});
