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

/**
 * Network-edge guardrails (audit E1 / B34). The in-process Vault Wall + per-user isolation (0021)
 * already hold; these close the *network* edge so the loopback-trusted contract is actually enforced:
 *
 * - `token` — when set, every tool route requires this shared secret (Authorization: Bearer … or
 *   `x-orwell-token`); a mismatch is 401. Lets the engine be safely reachable beyond loopback.
 * - `requireUser` — multi-user mode: a missing/empty `x-orwell-user` header is **rejected (400)**
 *   instead of silently routing to a shared `"default"` sandbox (cross-user bleed).
 * - `knownUser` — a non-`createCharacter` call for a user with no game is refused (404) **without
 *   minting a sandbox**, so an anonymous caller can't spray ids to exhaust memory (DoS). Only
 *   `createCharacter` may create a new sandbox.
 *
 * All three default OFF, so the single-tenant trusted-loopback deploy (and existing tests) are
 * unchanged; production turns them on via env (`main.ts`).
 */
export interface HttpMcpOptions {
  token?: string;
  requireUser?: boolean;
  knownUser?: (user: string) => boolean;
}

/** The front-end (trusted loopback auth tier, 0021) asserts the user via this header. */
const USER_HEADER = "x-orwell-user";
/** Tools that may run for a user with no existing game (i.e. may mint a fresh sandbox). */
const SANDBOX_CREATING_TOOLS: ReadonlySet<string> = new Set(["createCharacter"]);

function isResolver(d: HttpMcpDeps | HttpMcpResolver): d is HttpMcpResolver {
  return typeof (d as HttpMcpResolver).resolve === "function";
}

function headerValue(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim() : undefined;
}

/** The shared secret a request presents, via `Authorization: Bearer <token>` or `x-orwell-token`. */
function presentedToken(headers: Record<string, string | string[] | undefined>): string | undefined {
  const auth = headerValue(headers["authorization"]);
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim();
  return headerValue(headers["x-orwell-token"]);
}

export function createHttpMcpServer(deps: HttpMcpDeps | HttpMcpResolver, options: HttpMcpOptions = {}): Server {
  // A request's MCP server is resolved per (channel, asserted user). Single-tenant deps ignore the
  // user; the registry-backed resolver routes each call into that user's isolated sandbox.
  const pick = (channel: "player" | "admin", user: string): McpServer =>
    isResolver(deps) ? deps.resolve(channel, user) : (channel === "player" ? deps.player : deps.admin);

  return createServer((req, res) => {
    const send = (code: number, body: unknown): void => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    // Guard the whole request (audit E2): an unexpected throw — e.g. resolving a sandbox whose save
    // is unreadable — becomes a 500 for THIS request, never an uncaughtException that exits the
    // process and crash-loops every user. The async tool-call path adds its own structured catches.
    try {
      const url = new URL(req.url ?? "/", "http://localhost");

      // Health is an unauthenticated liveness probe — it carries no game data (deploy smoke / systemd).
      if (req.method === "GET" && url.pathname === "/health") return send(200, { ok: true });

      const match = url.pathname.match(/^\/(player|admin)\/(tools|call)$/);
      if (!match) return send(404, { error: "not found" });

      // (2) Shared-secret auth on every tool route, when a token is configured.
      if (options.token && presentedToken(req.headers) !== options.token) {
        return send(401, { error: "unauthorized" });
      }

      // (3) Identity: in multi-user mode a missing/empty user header is refused, never routed to "default".
      const rawUser = headerValue(req.headers[USER_HEADER]);
      if (options.requireUser && !rawUser) return send(400, { error: "missing user identity" });
      const user = rawUser ?? "default";
      const channel = match[1] as "player" | "admin";

      if (req.method === "GET" && match[2] === "tools") {
        return send(200, { tools: pick(channel, user).listTools() });
      }

      if (req.method === "POST" && match[2] === "call") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          void (async () => {
            let name: string, args: Record<string, unknown> | undefined;
            try {
              ({ name, args } = JSON.parse(body || "{}") as { name: string; args?: Record<string, unknown> });
            } catch {
              return send(400, { error: "invalid JSON body" });
            }
            // (4) Don't mint a sandbox for an unknown user unless they are starting a game.
            if (options.knownUser && !SANDBOX_CREATING_TOOLS.has(name) && !options.knownUser(user)) {
              return send(404, { error: "no active game for this user" });
            }
            // Resolving the sandbox can fail (e.g. an unreadable save) — that's a server error (500),
            // distinct from a bad tool/args (400). Either way the process stays up.
            let server: McpServer;
            try {
              server = pick(channel, user);
            } catch {
              return send(500, { error: "internal error" });
            }
            try {
              send(200, { result: await server.callTool(name, args ?? {}) });
            } catch (e) {
              send(400, { error: (e as Error).message });
            }
          })();
        });
        return;
      }
      return send(405, { error: "method not allowed" });
    } catch {
      return send(500, { error: "internal error" });
    }
  });
}

/**
 * Start the HTTP transport. Binds **loopback (`127.0.0.1`) by default** (audit E1): the deploy
 * contract is a trusted local front-end, so the engine must not be reachable cross-host unless the
 * operator opts in via `host` (and should pair that with `options.token`).
 */
export function startHttpMcp(
  deps: HttpMcpDeps | HttpMcpResolver,
  port: number,
  options: HttpMcpOptions = {},
  host = "127.0.0.1",
): Server {
  return createHttpMcpServer(deps, options).listen(port, host);
}
