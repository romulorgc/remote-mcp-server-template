import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type ErrorRequestHandler, type Express, type RequestHandler } from "express";
import { challengeMissingCredentials } from "./auth/challenge.js";
import { createKeyResolver } from "./auth/jwks.js";
import { requireToolScopes } from "./auth/scope-guard.js";
import { JwtAccessTokenVerifier } from "./auth/verifier.js";
import type { Config } from "./config.js";
import { JSONRPC_ERRORS, sendJsonRpcError } from "./http/jsonrpc.js";
import {
  PROTECTED_RESOURCE_METADATA_PATH,
  protectedResourceMetadataHandler,
  protectedResourceMetadataUrl,
} from "./http/metadata.js";
import { originPolicy } from "./http/origin.js";
import { createLogger, errorFields, type Logger } from "./logger.js";
import { createMcpServer } from "./mcp/server.js";
import { toolScopes } from "./mcp/tools/index.js";
import { InMemoryNotesStore, type NotesStore } from "./notes/store.js";

/** The single MCP endpoint (Streamable HTTP transport). */
export const MCP_PATH = "/mcp";

const MAX_BODY_SIZE = "1mb";

export interface AppDeps {
  config: Config;
  logger?: Logger;
  /** Defaults to an in-memory store. Inject your own to persist notes. */
  notes?: NotesStore;
}

export function createApp(deps: AppDeps): Express {
  const { config } = deps;
  const logger = deps.logger ?? createLogger();
  const notes = deps.notes ?? new InMemoryNotesStore();
  const resourceMetadataUrl = protectedResourceMetadataUrl(config);

  const verifier = new JwtAccessTokenVerifier({
    issuer: config.issuer,
    audience: config.audience,
    getKey: createKeyResolver({ issuer: config.issuer, jwksUrl: config.jwksUrl }),
    logger,
  });

  // Authentication: valid signature, issuer, audience and expiry. Every 401 carries a
  // WWW-Authenticate header with `resource_metadata`, which is how clients find the
  // authorization server. No credentials at all gets the bare challenge; credentials that are
  // present but wrong are handled by the SDK's `requireBearerAuth`.
  const authenticate = [
    challengeMissingCredentials(resourceMetadataUrl),
    requireBearerAuth({ verifier, resourceMetadataUrl }),
  ];

  // Authorization: per-tool scopes, answered with 403 + insufficient_scope.
  const authorizeScopes = requireToolScopes({ toolScopes, resourceMetadataUrl });

  const app = express();
  app.disable("x-powered-by");

  app.use(requestLog(logger));
  app.use(securityHeaders);
  app.use(originPolicy(config.allowedOrigins));

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get(PROTECTED_RESOURCE_METADATA_PATH, protectedResourceMetadataHandler(config));

  // Stateless Streamable HTTP: every POST is self-contained, so any replica can serve it.
  // The transport is created per request and nothing is kept between requests.
  const handleMcp: RequestHandler = async (req, res) => {
    const server = createMcpServer({ notes });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void Promise.allSettled([transport.close(), server.close()]);
    });
    try {
      await server.connect(transport);
      // The transport reads `req.auth` and hands it to tool handlers as `extra.authInfo`.
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error("mcp request failed", errorFields(error));
      if (!res.headersSent) {
        sendJsonRpcError(res, 500, JSONRPC_ERRORS.internalError, "Internal server error");
      }
    }
  };

  app.post(
    MCP_PATH,
    noStore,
    authenticate,
    express.json({ limit: MAX_BODY_SIZE }),
    authorizeScopes,
    handleMcp,
  );

  // No sessions and no server-initiated streams in stateless mode: GET and DELETE are not offered.
  app.all(MCP_PATH, noStore, authenticate, methodNotAllowed);

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  app.use(errorHandler(logger));

  return app;
}

const methodNotAllowed: RequestHandler = (_req, res) => {
  res.set("Allow", "POST");
  sendJsonRpcError(res, 405, JSONRPC_ERRORS.serverError, "Method not allowed");
};

const noStore: RequestHandler = (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
};

const securityHeaders: RequestHandler = (_req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  next();
};

/** One JSON line per request. Method, path and status only: never headers, query or body. */
function requestLog(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.on("finish", () => {
      const sub = req.auth?.extra?.sub;
      logger.info("request", {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
        ...(typeof sub === "string" ? { sub } : {}),
      });
    });
    next();
  };
}

function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const type = (error as { type?: unknown } | null)?.type;
    if (type === "entity.parse.failed") {
      sendJsonRpcError(res, 400, JSONRPC_ERRORS.parseError, "Parse error: body is not valid JSON");
      return;
    }
    if (type === "entity.too.large") {
      sendJsonRpcError(res, 413, JSONRPC_ERRORS.invalidRequest, "Request body too large");
      return;
    }
    logger.error("unhandled error", errorFields(error));
    sendJsonRpcError(res, 500, JSONRPC_ERRORS.internalError, "Internal server error");
  };
}
