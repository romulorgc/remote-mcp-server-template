import { InsufficientScopeError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { RequestHandler } from "express";
import { buildBearerChallenge, missingScopes } from "./scopes.js";

export interface ScopeGuardOptions {
  /** Tool name to the scopes it requires. */
  toolScopes: ReadonlyMap<string, readonly string[]>;
  /** URL of the Protected Resource Metadata document, repeated in the challenge. */
  resourceMetadataUrl: string;
}

/** Name of the tool a JSON-RPC message calls, if it is a `tools/call` request. */
function calledTool(message: unknown): string | undefined {
  if (typeof message !== "object" || message === null) return undefined;
  const { method, params } = message as { method?: unknown; params?: unknown };
  if (method !== "tools/call" || typeof params !== "object" || params === null) return undefined;
  const { name } = params as { name?: unknown };
  return typeof name === "string" ? name : undefined;
}

/**
 * Runtime scope enforcement for MCP authorization ("Scope Challenge Handling").
 *
 * Authentication (a valid token for this audience) is enough to connect, initialize and list
 * tools. Calling a tool that needs a scope the token lacks is answered the way the spec asks:
 *
 *   HTTP 403
 *   WWW-Authenticate: Bearer error="insufficient_scope", scope="notes:write",
 *                     resource_metadata="https://.../.well-known/oauth-protected-resource",
 *                     error_description="..."
 *
 * so the client can run a step-up authorization with the union of its old and new scopes and retry.
 * The `scope` parameter lists every scope the operation needs, in a single challenge, so one
 * round-trip is enough. A JSON-RPC batch is treated as one operation.
 *
 * Runs after the body parser and after `requireBearerAuth`.
 */
export function requireToolScopes(options: ScopeGuardOptions): RequestHandler {
  return (req, res, next) => {
    const granted = req.auth?.scopes ?? [];
    const messages: unknown[] = Array.isArray(req.body) ? req.body : [req.body];

    const required = new Set<string>();
    for (const message of messages) {
      const tool = calledTool(message);
      if (tool === undefined) continue;
      for (const scope of options.toolScopes.get(tool) ?? []) required.add(scope);
    }

    const missing = missingScopes(granted, [...required]);
    if (missing.length === 0) {
      next();
      return;
    }

    const error = new InsufficientScopeError(`Missing required scope: ${missing.join(" ")}`);
    res.set(
      "WWW-Authenticate",
      buildBearerChallenge({
        error: error.errorCode,
        scope: [...required],
        resourceMetadata: options.resourceMetadataUrl,
        errorDescription: error.message,
      }),
    );
    res.status(403).json(error.toResponseObject());
  };
}
