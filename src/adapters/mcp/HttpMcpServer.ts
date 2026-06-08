import { createServer } from "node:http";
import type { Server } from "node:http";
import type { McpServer } from "./McpServer";

/**
 * A minimal HTTP transport over the permissioned `McpServer` routers — the
 * networked seam the orwell front-end calls (feature 0009 allows MCP over
 * stdio or HTTP). It is outward-facing: it depends only on `McpServer`, never on
 * the Vault. The full MCP/JSON-RPC protocol wrapper can layer on top later; this
 * is the runnable entrypoint the deploy scripts (0010) build and start.
 *
 *   GET  /health
 *   GET  /:channel/tools           -> { tools }
 *   POST /:channel/call { name, args } -> { result }   (:channel = player | admin)
 */
export interface HttpMcpDeps {
  player: McpServer;
  admin: McpServer;
}

/** Per-user routing: resolve the channel's MCP server for the asserted user (0021). */
export interface HttpMcpResolver {
  resolve(channel: "player" | "admin", user: string): McpServer;
}

/** The front-end (trusted loopback auth tier, 0021) asserts the user via this header. */
const USER_HEADER = "x-orwell-user";

function isResolver(d: HttpMcpDeps | HttpMcpResolver): d is HttpMcpResolver {
  return typeof (d as HttpMcpResolver).resolve === "function";
}

export function createHttpMcpServer(deps: HttpMcpDeps | HttpMcpResolver): Server {
  // A request's MCP server is resolved per (channel, asserted user). Single-tenant deps ignore the
  // user; the registry-backed resolver routes each call into that user's isolated sandbox.
  const pick = (channel: "player" | "admin", user: string): McpServer =>
    isResolver(deps) ? deps.resolve(channel, user) : (channel === "player" ? deps.player : deps.admin);

  return createServer((req, res) => {
    const send = (code: number, body: unknown): void => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/health") return send(200, { ok: true });

    const match = url.pathname.match(/^\/(player|admin)\/(tools|call)$/);
    if (!match) return send(404, { error: "not found" });
    const userHeader = req.headers[USER_HEADER];
    const user = (Array.isArray(userHeader) ? userHeader[0] : userHeader) || "default";
    const server = pick(match[1] as "player" | "admin", user);

    if (req.method === "GET" && match[2] === "tools") return send(200, { tools: server.listTools() });

    if (req.method === "POST" && match[2] === "call") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        void (async () => {
          try {
            const { name, args } = JSON.parse(body || "{}") as { name: string; args?: Record<string, unknown> };
            send(200, { result: await server.callTool(name, args ?? {}) });
          } catch (e) {
            send(400, { error: (e as Error).message });
          }
        })();
      });
      return;
    }
    return send(405, { error: "method not allowed" });
  });
}

export function startHttpMcp(deps: HttpMcpDeps | HttpMcpResolver, port: number): Server {
  return createHttpMcpServer(deps).listen(port);
}
