import { describe, it, expect } from "vitest";
import type { AddressInfo } from "node:net";
import { createHttpMcpServer } from "../../src/adapters/mcp/HttpMcpServer";
import type { McpServer } from "../../src/adapters/mcp/McpServer";
import { GameSessionRegistry } from "../../src/composition/registry";
import { toolsFor } from "../../src/surfaces/tools/registry";

/**
 * Edge hardening (audit E27 / E28 / E30 / E31) — proven over the real HTTP transport with the
 * live per-user registry. Roles only: no fixture names.
 */

async function withServer(
  deps: Parameters<typeof createHttpMcpServer>[0],
  options: Parameters<typeof createHttpMcpServer>[1],
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const server = createHttpMcpServer(deps, options);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

const auth = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

describe("E27 — the player token must not grant God Mode", () => {
  const options = { token: "player-secret", adminToken: "admin-secret" };

  it("the player token on /admin/call is 401; the admin token is accepted", async () => {
    await withServer({ resolve: new GameSessionRegistry().resolver() }, options, async (base) => {
      const asPlayer = await fetch(`${base}/admin/call`, {
        method: "POST", headers: auth("player-secret"), body: JSON.stringify({ name: "sandboxHealth" }),
      });
      expect(asPlayer.status).toBe(401);

      const asAdmin = await fetch(`${base}/admin/call`, {
        method: "POST", headers: auth("admin-secret"), body: JSON.stringify({ name: "sandboxHealth" }),
      });
      expect(asAdmin.status).toBe(200);
    });
  });

  it("admin ⊇ player: either secret is accepted on the player channel; no secret is 401", async () => {
    await withServer({ resolve: new GameSessionRegistry().resolver() }, options, async (base) => {
      for (const token of ["player-secret", "admin-secret"]) {
        const res = await fetch(`${base}/player/call`, {
          method: "POST", headers: auth(token), body: JSON.stringify({ name: "gameStatus" }),
        });
        expect(res.status, `token class "${token}" on the player channel`).toBe(200);
      }
      const bare = await fetch(`${base}/player/call`, { method: "POST", body: JSON.stringify({ name: "gameStatus" }) });
      expect(bare.status).toBe(401);
      const wrong = await fetch(`${base}/admin/call`, {
        method: "POST", headers: auth("not-a-secret"), body: JSON.stringify({ name: "sandboxHealth" }),
      });
      expect(wrong.status).toBe(401);
    });
  });

  it("back-compat: with only the single shared token configured, it still opens both channels", async () => {
    await withServer({ resolve: new GameSessionRegistry().resolver() }, { token: "only-secret" }, async (base) => {
      for (const channel of ["player", "admin"]) {
        const res = await fetch(`${base}/${channel}/call`, {
          method: "POST", headers: auth("only-secret"),
          body: JSON.stringify({ name: channel === "player" ? "gameStatus" : "sandboxHealth" }),
        });
        expect(res.status).toBe(200);
      }
    });
  });
});

describe("E28 — the tool list never mints a sandbox", () => {
  it("GET /player/tools for a sprayed id serves the static allowlist and creates NO sandbox", async () => {
    const registry = new GameSessionRegistry();
    await withServer({ resolve: registry.resolver() }, {}, async (base) => {
      for (const sprayed of ["spray-1", "spray-2", "spray-3"]) {
        const res = await fetch(`${base}/player/tools`, { headers: { "x-orwell-user": sprayed } });
        expect(res.status).toBe(200);
        const { tools } = (await res.json()) as { tools: Array<{ name: string }> };
        expect(tools.map((t) => t.name).sort()).toEqual(toolsFor("player").map((t) => t.name).sort());
      }
      expect(registry.usernames(), "GET /tools resolved (minted) sandboxes for sprayed ids").toEqual([]);
    });
  });

  it("a GET-then-POST spray still hits the anti-spray gate: the id is NOT 'known' afterwards", async () => {
    const registry = new GameSessionRegistry();
    const knownUser = (u: string): boolean => registry.usernames().includes(u);
    await withServer({ resolve: registry.resolver() }, { knownUser }, async (base) => {
      await fetch(`${base}/player/tools`, { headers: { "x-orwell-user": "sprayed-id" } });
      const followUp = await fetch(`${base}/player/call`, {
        method: "POST", headers: { "x-orwell-user": "sprayed-id" }, body: JSON.stringify({ name: "gameStatus" }),
      });
      expect(followUp.status).toBe(404); // still unknown — the GET did not make them "known"
      expect(registry.usernames()).toEqual([]);
    });
  });
});

describe("E30 — a queued job answering a dead socket never crashes the process", () => {
  it("an aborted in-flight call (and a rejecting one behind it) leaves the server healthy", async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => { rejections.push(reason); };
    process.on("unhandledRejection", onRejection);
    try {
      const gate: { release?: () => void } = {};
      const slow = {
        callTool: async (name: string) => {
          if (name === "slow") await new Promise<void>((r) => { gate.release = r; });
          if (name === "boom") throw new TypeError("late failure into a dead socket");
          return {};
        },
      } as unknown as McpServer;
      await withServer({ resolve: () => slow }, {}, async (base) => {
        // Two calls queue behind each other for one user; the client tears both sockets down
        // before either answers — the answers land on DEAD sockets (the E30 crash window).
        const ac = new AbortController();
        const p1 = fetch(`${base}/player/call`, {
          method: "POST", headers: { "x-orwell-user": "u" }, body: JSON.stringify({ name: "slow" }), signal: ac.signal,
        }).catch(() => null);
        const p2 = fetch(`${base}/player/call`, {
          method: "POST", headers: { "x-orwell-user": "u" }, body: JSON.stringify({ name: "boom" }), signal: ac.signal,
        }).catch(() => null);
        await new Promise((r) => setTimeout(r, 50)); // both requests are in (slow is executing)
        ac.abort();
        gate.release?.();
        await Promise.all([p1, p2]);
        await new Promise((r) => setTimeout(r, 50)); // let the queue drain into the dead sockets

        // The process took no unhandled rejection and the server still answers.
        const health = await fetch(`${base}/health`);
        expect(health.status).toBe(200);
      });
      expect(rejections, "the per-user queue leaked an unhandled rejection").toEqual([]);
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });
});

describe("E31 — malformed tool args are deliberate 400s naming the field, never 500s", () => {
  it("the R6 live repro: a STRING witnessSet is a 400 naming witnessSet", async () => {
    await withServer({ resolve: new GameSessionRegistry().resolver() }, {}, async (base) => {
      const res = await fetch(`${base}/player/call`, {
        method: "POST",
        body: JSON.stringify({ name: "recordInteraction", args: { initiator: "player", witnessSet: "player", content: "hi" } }),
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain("witnessSet");
    });
  });

  it.each([
    ["recordInteraction", { witnessSet: ["player"], content: "x" }, "initiator"],
    ["recordInteraction", { initiator: "player", witnessSet: ["player"] }, "content"],
    ["submitDecision", {}, "kind"],
    ["submitDecision", { kind: "nominations", choice: "both" }, "choice"],
    ["npcVoice", {}, "id"],
    ["makeDeal", { with: "npc", kind: "vote" }, "terms"],
    ["surfaceInformationTo", { entity: "player", fact: {}, pathway: "told" }, "fact.content"],
    ["diaryRoom", {}, "entry"],
    ["runCompetition", { participantIds: "everyone" }, "participantIds"],
  ] as Array<[string, Record<string, unknown>, string]>)(
    "%s with bad args is a 400 naming %s",
    async (name, args, field) => {
      await withServer({ resolve: new GameSessionRegistry().resolver() }, {}, async (base) => {
        const res = await fetch(`${base}/player/call`, { method: "POST", body: JSON.stringify({ name, args }) });
        expect(res.status).toBe(400);
        expect(((await res.json()) as { error: string }).error).toContain(field);
      });
    },
  );
});
