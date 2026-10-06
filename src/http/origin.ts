import type { RequestHandler } from "express";
import { JSONRPC_ERRORS, sendJsonRpcError } from "./jsonrpc.js";

const DEFAULT_ALLOWED_HEADERS = "Authorization, Content-Type, Accept, MCP-Protocol-Version";

/**
 * Origin validation against DNS rebinding (MCP transports spec, "Security Warning").
 *
 * - No `Origin` header: not a browser request (CLI, SDK, server to server). Let it through.
 * - `Origin` present and in the allowlist: let it through and answer CORS, including preflight.
 * - `Origin` present and not in the allowlist: 403 Forbidden, whatever else the request holds.
 *
 * With an empty allowlist every browser-originated request is refused, which is the safe default.
 */
export function originPolicy(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);

  return (req, res, next) => {
    const origin = req.get("origin");
    if (origin === undefined) {
      next();
      return;
    }

    if (!allowed.has(origin)) {
      sendJsonRpcError(res, 403, JSONRPC_ERRORS.serverError, "Forbidden: origin not allowed");
      return;
    }

    res.vary("Origin");
    res.set("Access-Control-Allow-Origin", origin);
    // Browser clients must be able to read the challenge to run the OAuth flow.
    res.set("Access-Control-Expose-Headers", "WWW-Authenticate, Mcp-Session-Id");

    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.set(
        "Access-Control-Allow-Headers",
        req.get("access-control-request-headers") ?? DEFAULT_ALLOWED_HEADERS,
      );
      res.set("Access-Control-Max-Age", "600");
      res.status(204).end();
      return;
    }

    next();
  };
}
