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

export function createHttpMcpServer(deps: HttpMcpDeps): Server {
  return createServer((req, res) => {
    const send = (code: number, body: unknown): void => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/health") return send(200, { ok: true });

    const match = url.pathname.match(/^\/(player|admin)\/(tools|call)$/);
    if (!match) return send(404, { error: "not found" });
    const server = match[1] === "player" ? deps.player : deps.admin;

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

export function startHttpMcp(deps: HttpMcpDeps, port: number): Server {
  return createHttpMcpServer(deps).listen(port);
}
