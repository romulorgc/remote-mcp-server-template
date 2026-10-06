import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { createLogger } from "../../src/logger.js";
import { startTestIdp, type TestIdp, type TestIdpOptions } from "./idp.js";

export interface HarnessOptions {
  /** Leave AUTH_JWKS_URL unset so the server discovers the JWKS from the issuer. */
  discoverJwks?: boolean;
  allowedOrigins?: string[];
  /** AUTH_AUDIENCE. Defaults to the server URL. */
  audience?: string;
  idp?: TestIdpOptions;
}

export interface TokenOptions {
  sub?: string | undefined;
  scope?: string;
  audience?: string | string[];
  issuer?: string;
  expiresAt?: number;
  issuedAt?: number;
  claims?: Record<string, unknown>;
}

export interface TestServer {
  /** Origin of the server, for example http://127.0.0.1:41234. */
  url: string;
  mcpUrl: URL;
  idp: TestIdp;
  /** Every log line the server wrote. */
  logs: string[];
  /** A token this server accepts, unless overridden. Default scope is `notes:read notes:write`. */
  token(options?: TokenOptions): Promise<string>;
  /** An initialized MCP client, using the SDK's Streamable HTTP transport. */
  connect(token: string): Promise<Client>;
  /** Raw JSON-RPC POST to /mcp, for asserting on status codes and headers. */
  post(
    body: unknown,
    init?: { token?: string; headers?: Record<string, string> },
  ): Promise<Response>;
  close(): Promise<void>;
}

export const DEFAULT_SCOPE = "notes:read notes:write";

export async function startTestServer(options: HarnessOptions = {}): Promise<TestServer> {
  const idp = await startTestIdp(options.idp);
  const logs: string[] = [];

  // Bind first to learn the port: PUBLIC_URL (and so the audience) depends on it.
  const httpServer = createServer();
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;

  // The real config loader runs here, so the tests also exercise env validation.
  const config = loadConfig({
    HOST: "127.0.0.1",
    PORT: "0",
    PUBLIC_URL: url,
    AUTH_ISSUER: idp.issuer,
    AUTH_JWKS_URL: options.discoverJwks ? "" : idp.jwksUrl,
    AUTH_AUDIENCE: options.audience ?? "",
    ALLOWED_ORIGINS: (options.allowedOrigins ?? []).join(","),
  });
  const logger = createLogger((_level, line) => {
    logs.push(line);
  });
  httpServer.on("request", createApp({ config, logger }));

  const mcpUrl = new URL("/mcp", url);

  const token: TestServer["token"] = (tokenOptions = {}) => {
    const { sub, ...rest } = tokenOptions;
    return idp.sign({
      issuer: idp.issuer,
      audience: config.audience,
      scope: DEFAULT_SCOPE,
      // `sub: undefined` is meaningful (it forges a token without a subject), so only default when absent.
      sub: "sub" in tokenOptions ? sub : "user-1",
      ...rest,
    });
  };

  const clients: Client[] = [];

  return {
    url,
    mcpUrl,
    idp,
    logs,
    token,
    async connect(bearer) {
      const client = new Client({ name: "test-client", version: "0.0.0" });
      const transport = new StreamableHTTPClientTransport(mcpUrl, {
        requestInit: { headers: { authorization: `Bearer ${bearer}` } },
      });
      await client.connect(transport);
      clients.push(client);
      return client;
    },
    post(body, init = {}) {
      return fetch(mcpUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(init.token === undefined ? {} : { authorization: `Bearer ${init.token}` }),
          ...init.headers,
        },
        body: JSON.stringify(body),
      });
    },
    async close() {
      await Promise.allSettled(clients.map((client) => client.close()));
      httpServer.closeAllConnections();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await idp.close();
    },
  };
}

export const INITIALIZE_REQUEST = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "raw-test", version: "0.0.0" },
  },
} as const;

export function toolCall(name: string, args: Record<string, unknown> = {}, id = 2) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } } as const;
}
