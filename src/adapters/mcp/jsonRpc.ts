/**
 * The additive MCP / JSON-RPC 2.0 transport envelope over the permissioned outward tool surface
 * (the deferral noted in `HttpMcpServer.ts`'s header: "the full MCP/JSON-RPC protocol wrapper can
 * layer on top later"). This is *another envelope over the SAME router* — every request still
 * terminates at the channel's allowlisted `listTools()` / `callTool(name, args)`, so the Vault
 * Wall and per-user isolation hold identically to the plain REST path.
 *
 * It is deliberately **pure** (no `node:http`, no engine imports): it depends only on a tiny
 * `ToolGateway` interface the transport supplies. `HttpMcpServer` owns the transport work (auth,
 * per-user routing, the anti-spray gate, body read, serialization, metrics) and hands a gateway
 * in, so the JSON-RPC path reuses the exact same guardrails the REST path uses and cannot drift.
 * Keeping it free of any engine-only import is what dependency-cruiser proves about the Vault Wall.
 * `StaleBeatError` (below) is a plain, dependency-free `src/domain/` type — not an engine/Vault
 * import — so importing it here is the same class of edge `HttpMcpServer.ts`'s REST `/call` path
 * already takes; it does not weaken the Vault-Wall proof.
 */

import { StaleBeatError } from "../../domain/errors";

/** A current MCP protocol-revision string (the negotiated version in `initialize`). */
export const MCP_PROTOCOL_VERSION = "2025-06-18";
/** Reported in `initialize` → `serverInfo`. */
export const SERVER_NAME = "orwell-engine";
export const SERVER_VERSION = "0.1.0";

/** Standard JSON-RPC 2.0 error codes (https://www.jsonrpc.org/specification#error_object). */
export const RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/** A JSON-RPC request id is a string, number, or null (a notification has no id at all). */
export type RpcId = string | number | null;

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: RpcId;
  result: unknown;
}
export interface JsonRpcErrorBody {
  jsonrpc: "2.0";
  id: RpcId;
  error: { code: number; message: string; data?: unknown };
}
export type JsonRpcResponse = JsonRpcSuccess | JsonRpcErrorBody;

/**
 * The minimal surface JSON-RPC dispatch needs — supplied by the transport, NOT imported. The
 * transport's gateway makes `listTools` the static per-channel allowlist (so `initialize` /
 * `tools/list` never mint a sandbox — the anti-spray rule) and `callTool` the per-user,
 * knownUser-gated `McpServer.callTool`.
 */
export interface ToolGateway {
  listTools(): ReadonlyArray<{ name: string; description: string }>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function ok(id: RpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}
function fail(id: RpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** Wrap a value as an MCP `content` block (the shape `tools/call` returns). */
function toolContent(value: unknown, isError: boolean): unknown {
  return { content: [{ type: "text", text: JSON.stringify(value) }], isError };
}

/** The id to put on a TRANSPORT-level error (parse/internal) for a payload we may not have dispatched. */
export function rpcIdOf(payload: unknown): RpcId {
  if (isPlainObject(payload) && Object.prototype.hasOwnProperty.call(payload, "id")) {
    const id = payload["id"];
    if (typeof id === "string" || typeof id === "number" || id === null) return id;
  }
  return null;
}

/**
 * Dispatch ONE already-parsed JSON-RPC message. Returns `null` for a valid *notification*
 * (a request with no `id`): per the spec a notification MUST NOT get a response — not even on
 * error. Never throws for an engine-side tool failure — that becomes `isError:true` content.
 */
export async function dispatchJsonRpc(gateway: ToolGateway, message: unknown): Promise<JsonRpcResponse | null> {
  if (!isPlainObject(message)) return fail(null, RPC.INVALID_REQUEST, "request must be a JSON-RPC object");

  const hasId = Object.prototype.hasOwnProperty.call(message, "id");
  const id = rpcIdOf(message);
  const isNotification = !hasId;
  const reply = (r: JsonRpcResponse): JsonRpcResponse | null => (isNotification ? null : r);

  if (message["jsonrpc"] !== "2.0") return reply(fail(id, RPC.INVALID_REQUEST, 'jsonrpc must be "2.0"'));
  const method = message["method"];
  if (typeof method !== "string") return reply(fail(id, RPC.INVALID_REQUEST, "method must be a string"));

  switch (method) {
    case "initialize":
      // The handshake: advertise the negotiated protocol version + capabilities. We serve only
      // tools, so `capabilities.tools` is the single capability.
      return reply(ok(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      }));

    case "notifications/initialized":
    case "notifications/cancelled":
      // Client post-handshake / cancellation acks — notifications (no id) → no response body.
      return null;

    case "ping":
      return reply(ok(id, {}));

    case "tools/list":
      // The static per-channel allowlist mapped to the MCP tool shape. `inputSchema` is the
      // permissive open object — the registry carries no per-tool JSON schema, and inventing one
      // could narrate Vault structure. Never mints a sandbox (the gateway's listTools is static).
      return reply(ok(id, {
        tools: gateway.listTools().map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: { type: "object" as const },
        })),
      }));

    case "tools/call": {
      const params = message["params"];
      if (!isPlainObject(params) || typeof params["name"] !== "string") {
        return reply(fail(id, RPC.INVALID_PARAMS, "tools/call requires params.name (string)"));
      }
      const name = params["name"];
      const argsRaw = params["arguments"];
      const args = isPlainObject(argsRaw) ? argsRaw : {};
      try {
        const result = await gateway.callTool(name, args);
        return reply(ok(id, toolContent(result, false)));
      } catch (e) {
        // MCP convention: a tool that RUNS but fails (forbidden tool, bad args, a turn refusal,
        // no active game) is protocol-success with `isError:true` content — so the model can read
        // the failure text. JSON-RPC errors are reserved for PROTOCOL faults (above).
        const msg = e instanceof Error ? e.message : String(e);
        // CON-6 — a stale compare-and-swap write (0065 Part A) previously flattened into the SAME
        // opaque `{error: msg}` text as every other failure, losing the machine `code`, the CURRENT
        // `beatSeq`, and the Vault-free `board` a caller needs to reconcile immediately — the exact
        // structured shape the REST `/call` 409 mapping already carries (`HttpMcpServer.ts`). Stays
        // inside the MCP `isError:true` content (never a JSON-RPC-level `error`) — a stale write is a
        // tool-level refusal, not a protocol fault, so it keeps the SAME envelope as every other tool
        // failure; only the payload now carries the extra reconcile fields a plain message could not.
        if (e instanceof StaleBeatError) {
          return reply(ok(id, toolContent({ error: msg, code: e.code, beatSeq: e.beatSeq, board: e.board }, true)));
        }
        return reply(ok(id, toolContent({ error: msg }, true)));
      }
    }

    default:
      return reply(fail(id, RPC.METHOD_NOT_FOUND, `unknown method "${method}"`));
  }
}

/**
 * Handle a parsed JSON-RPC payload that may be a single message OR a batch array. Returns the
 * response(s) to write, or `null` when there is NOTHING to write (a lone/all notification batch).
 */
export async function handleRpcPayload(
  gateway: ToolGateway,
  payload: unknown,
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(payload)) {
    if (payload.length === 0) return fail(null, RPC.INVALID_REQUEST, "an empty batch is not a valid request");
    const responses = (await Promise.all(payload.map((m) => dispatchJsonRpc(gateway, m))))
      .filter((r): r is JsonRpcResponse => r !== null);
    return responses.length > 0 ? responses : null; // all-notification batch ⇒ nothing to send
  }
  return dispatchJsonRpc(gateway, payload);
}
