# remote-mcp-server-template

A production-ready starting point for a **remote MCP server** in TypeScript: Streamable HTTP transport, OAuth 2.1 resource-server authorization, stateless so it scales horizontally.

[![CI](https://github.com/romulorgc/remote-mcp-server-template/actions/workflows/ci.yml/badge.svg)](https://github.com/romulorgc/remote-mcp-server-template/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Clone it, point it at your identity provider, replace the example tools with yours. Any MCP client that supports the authorization flow can connect.

## What you get

- **Streamable HTTP transport** on Express 5 with `@modelcontextprotocol/sdk` 1.32, in stateless mode (`sessionIdGenerator: undefined`). Every POST is self-contained, so any replica can answer it.
- **OAuth 2.1 resource server**, following the current MCP authorization spec:
  - Protected Resource Metadata (RFC 9728) at `/.well-known/oauth-protected-resource`.
  - `401` with `WWW-Authenticate: Bearer resource_metadata="..."`.
  - JWT validation against the issuer's JWKS with `jose`: signature, issuer, **audience = this server** (RFC 8707), expiry.
  - Per-tool scopes, answered with `403` and `insufficient_scope` so clients can step up.
  - No token passthrough: the bearer token is dropped after verification.
- **Origin validation** against DNS rebinding, with an allowlist from the environment (and CORS for allowlisted browser clients).
- **Three example tools**: `whoami`, `notes_list` (`notes:read`), `notes_create` (`notes:write`, input validated with zod), backed by an in-memory store isolated per user (`sub`).
- **Environment config validated with zod**, `/healthz`, and JSON logs that never contain a token.
- **A Vitest suite** that boots the real app on an ephemeral port and forges tokens locally. No network, no real identity provider.
- Strict TypeScript, Biome, multi-stage Dockerfile (non-root), CI, Dependabot, and an MCP Registry `server.json` template.

## Quick start

Requires Node.js 22 or newer.

```bash
git clone https://github.com/romulorgc/remote-mcp-server-template.git
cd remote-mcp-server-template
npm install
cp .env.example .env     # set AUTH_ISSUER to your identity provider
npm run dev
```

The server listens on `127.0.0.1:3000`. Without a token it tells clients where to authenticate:

```console
$ curl -i -X POST http://localhost:3000/mcp \
    -H 'content-type: application/json' \
    -H 'accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'

HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer scope="notes:read", resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"

$ curl http://localhost:3000/.well-known/oauth-protected-resource
{"resource":"http://localhost:3000","authorization_servers":["https://your-tenant.example.com/"],"scopes_supported":["notes:read","notes:write"],"bearer_methods_supported":["header"],"resource_name":"Remote MCP server template"}
```

Point an MCP client at `http://localhost:3000/mcp` (use the same host as `PUBLIC_URL`: clients check that the metadata `resource` matches the URL they connect to). To try it from a browser-based client, add that client's origin to `ALLOWED_ORIGINS`.

| Script | What it does |
| --- | --- |
| `npm run dev` | Run with `tsx watch`, loading `.env` if present |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | Biome check (lint, format, import order) |
| `npm run format` | Apply Biome fixes |
| `npm test` | Vitest |

## Connect your identity provider

This server never issues tokens. It trusts an authorization server you already run or rent: Auth0, Keycloak, Clerk, WorkOS, or any other OpenID Connect or OAuth 2.0 provider that issues JWT access tokens. The steps are the same everywhere, only the names change.

1. **Register this server as an API (a "resource").** Use `PUBLIC_URL` as its identifier, for example `https://mcp.example.com`. Providers call it an API, resource server, or audience.
2. **Define the scopes** `notes:read` and `notes:write`, plus any of your own.
3. **Make access tokens carry this server in `aud`.** The MCP client sends the RFC 8707 `resource` parameter; the provider must put that value, or a fixed audience you configure for the API, into the token. If your provider cannot use the URL as audience, set `AUTH_AUDIENCE` to the value it does use.
4. **Allow MCP clients to register.** The spec asks authorization servers to support OAuth Client ID Metadata Documents, with Dynamic Client Registration as a fallback. Enable whichever your provider offers, or pre-register the clients you care about. Clients use authorization code with PKCE.
5. **Configure this server.** Copy the `issuer` value from `https://<your-idp>/.well-known/openid-configuration` into `AUTH_ISSUER`, character for character (some providers end it with a slash, and the comparison is exact). Leave `AUTH_JWKS_URL` empty to discover the key set from the issuer, or set it to skip discovery.
6. **Check it.** Fetch a token for your user, then call `whoami` through any MCP client. It returns the `sub` and scopes the server read from the token.

Scopes are read from the `scope` claim (RFC 9068, space-separated) or `scp` (string or array). If your provider puts permissions elsewhere, change `readScopes` in `src/auth/verifier.ts`.

### Configuration

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `PUBLIC_URL` | yes | | Canonical origin of this server (scheme, host, optional port; no path). Published as the metadata `resource`. |
| `AUTH_ISSUER` | yes | | Issuer of your authorization server. https required, except localhost. |
| `AUTH_JWKS_URL` | no | discovered | JWKS endpoint. Empty means discover it from the issuer metadata (OIDC discovery, then RFC 8414). |
| `AUTH_AUDIENCE` | no | `PUBLIC_URL` | Expected `aud` of access tokens. |
| `ALLOWED_ORIGINS` | no | none | Comma-separated browser origins allowed to call the server. Empty refuses every request with an `Origin` header. |
| `HOST` | no | `127.0.0.1` | Interface to bind. The Docker image sets `0.0.0.0`. |
| `PORT` | no | `3000` | Port to listen on. |

Invalid configuration stops the process at startup with a message that names each bad variable.

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/mcp` | Bearer token | The MCP endpoint (Streamable HTTP, JSON responses) |
| `GET`, `DELETE` | `/mcp` | Bearer token | `405`: stateless mode has no sessions and no server-initiated stream |
| `GET` | `/.well-known/oauth-protected-resource` | none | Protected Resource Metadata (RFC 9728) |
| `GET` | `/healthz` | none | Liveness: `{"status":"ok"}` |

How the server answers, and why:

| Situation | Status | `WWW-Authenticate` |
| --- | --- | --- |
| No credentials | `401` | `Bearer scope="notes:read", resource_metadata="..."` |
| Bad signature, wrong issuer or audience, expired, malformed | `401` | `Bearer error="invalid_token", ..., resource_metadata="..."` |
| Valid token, tool needs a scope it lacks | `403` | `Bearer error="insufficient_scope", scope="notes:write", resource_metadata="...", error_description="..."` |
| `Origin` header not in the allowlist | `403` | none |
| Identity provider unreachable (cannot fetch keys) | `500` | none, so clients do not loop on re-authentication |

A valid token is enough to connect, call `initialize` and `tools/list`, and use tools that need no scope. A tool call that needs more is refused at the HTTP layer, before any tool code runs. The `scope` parameter lists everything that call needs, in one challenge, so a client can re-authorize with the union of its old and new scopes and retry once. A JSON-RPC batch counts as one operation. The scope check lives in `src/auth/scope-guard.ts` and reads the same tool definitions that register the tools, so the two cannot drift apart. Tool handlers check again as defense in depth.

The scope hierarchy is declared in `src/auth/scopes.ts`: the umbrella scope `notes` implies `notes:read` and `notes:write`. Empty the map if your scopes are flat.

## Add a tool

Create a file under `src/mcp/tools/`:

```ts
// src/mcp/tools/notes-search.ts
import { z } from "zod";
import { SCOPES } from "../../auth/scopes.js";
import { defineTool, jsonResult } from "./define-tool.js";

export const notesSearch = defineTool({
  name: "notes_search",
  title: "Search notes",
  description: "Finds the caller's notes whose title or body contains the query.",
  scopes: [SCOPES.notesRead],
  inputSchema: {
    query: z.string().trim().min(1).max(200).describe("Text to look for, case-insensitive"),
  },
  outputSchema: {
    notes: z.array(
      z.object({ id: z.string(), title: z.string(), body: z.string(), createdAt: z.string() }),
    ),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  async handler({ query }, { principal, notes }) {
    const needle = query.toLowerCase();
    const own = await notes.list(principal.sub, 100);
    const matches = own.filter(
      (note) =>
        note.title.toLowerCase().includes(needle) || note.body.toLowerCase().includes(needle),
    );
    return jsonResult({ notes: matches });
  },
});
```

Register it in `src/mcp/tools/index.ts`:

```ts
export const tools: readonly ToolDefinition[] = [whoami, notesList, notesCreate, notesSearch];
```

That is all. The tool appears in `tools/list`, its `scopes` are enforced by the HTTP guard, `args` is typed from `inputSchema`, and the handler receives `principal` (who is calling, from the token) and the store. Need a new scope? Add it to `SCOPES` in `src/auth/scopes.ts`; it is advertised in the metadata automatically.

Rules of thumb:

- Take the user from `principal.sub`, never from tool arguments.
- Scope your storage by owner. `NotesStore` takes the owner on every call, so isolation is part of the interface.
- Do not forward the caller's token to another service. If a tool needs to call one, use credentials of its own or an OAuth token exchange.
- Replace `InMemoryNotesStore` with a database before running more than one replica.

## Testing

```bash
npm test
```

The tests need no network and no identity provider. `test/helpers/idp.ts` plays the provider:

- it generates an ES256 key pair with `jose` and publishes the public half as a JWKS, plus an OIDC discovery document, on an ephemeral port;
- tokens are forged with `jose`'s `SignJWT`, so a test can set any `sub`, `scope`, `aud`, `iss` or `exp`, or sign with a key the JWKS does not publish;
- `test/helpers/harness.ts` runs the real configuration loader, starts the real app on port `0`, and connects with the SDK's own `Client` and `StreamableHTTPClientTransport`.

Covered: the `401` challenge, the metadata document (also followed by the SDK client), initialize and `tools/list`, wrong audience, wrong issuer, expired and unsigned tokens, foreign signing keys, `alg: none`, insufficient scope (including batches, the scope hierarchy and the `scp` claim), isolation between two users, origin policy and preflight, JWKS discovery and caching, configuration validation, and that logs never contain a token.

## Deploy with Docker

```bash
docker build -t remote-mcp-server .

docker run --rm -p 3000:3000 \
  -e PUBLIC_URL=https://mcp.example.com \
  -e AUTH_ISSUER=https://your-tenant.example.com/ \
  remote-mcp-server
```

The image is multi-stage on `node:24-alpine`, installs production dependencies from the lockfile, runs as the unprivileged `node` user, and has a health check on `/healthz`.

Put a reverse proxy or load balancer in front to terminate TLS. Serve it over https in production, and set `PUBLIC_URL` to the address clients actually use. Forward the `Authorization` header unchanged. Because the server is stateless you can run as many replicas as you need, without sticky sessions, once the notes store is shared.

## Publish to the MCP Registry

`server.example.json` is a template for the [official MCP Registry](https://github.com/modelcontextprotocol/registry), written against the `2025-12-11` `server.json` schema. It describes a remote server, so there is no package to publish first.

1. Copy it to `server.json` and replace the placeholders: `name`, `title`, `description` (100 characters at most), `version`, the repository URLs, and the `remotes[0].url` of your deployed `/mcp` endpoint.
2. The `name` must be in a namespace you can prove you own: `io.github.<your-user>/<name>` with GitHub login, or a reverse-DNS name for a domain you control.
3. Install `mcp-publisher` (see the [registry quickstart](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx)), then:

```bash
mcp-publisher validate
mcp-publisher login github
mcp-publisher publish
```

Publish after the server is deployed and reachable: clients that find it in the registry will connect to that URL and start the authorization flow described above.

## Security notes

What the template guarantees, and where each guarantee lives:

- **Tokens are bound to this server.** `aud` must match, so tokens minted for other APIs, and ID tokens, are refused (`src/auth/verifier.ts`).
- **No token passthrough.** The raw bearer token is discarded after verification. Tools see a `Principal` (`sub`, client id, scopes), never a credential they could forward.
- **Only asymmetric algorithms.** RS, PS, ES and EdDSA are accepted. `none` and HMAC algorithms are not, and keys come only from the issuer's JWKS.
- **Exact issuer match.** Discovery documents must name the issuer they were fetched for (RFC 8414 section 3.3). `exp` and `sub` are required.
- **https for identity endpoints.** Issuer, JWKS URL and the discovered `jwks_uri` must use https, except for localhost.
- **Key fetches are throttled.** Keys are cached, and an unknown `kid` triggers at most one refetch every 30 seconds, so forged tokens cannot flood your identity provider.
- **Scopes are enforced twice**, at the HTTP layer and in the handler wrapper, from a single declaration per tool.
- **Origin validation on every route.** A request with an `Origin` header outside the allowlist gets `403`. With an empty allowlist, every browser request is refused. Non-browser clients send no `Origin` and are unaffected. The server binds to `127.0.0.1` unless told otherwise.
- **Tenant isolation.** Storage is keyed by the token's `sub`, and the store API cannot be called without an owner.
- **Quiet logs.** One JSON line per request: method, path, status, duration, subject. No headers, no query string, no body, and a redaction filter on sensitive key names as a safety net.
- **Bounded inputs.** 1 MB request bodies, length limits on tool input, a per-user cap on stored notes.
- **No session surface.** There are no sessions to fixate or hijack, and no long-lived streams.

What it deliberately leaves to you:

- **Rate limiting and abuse controls.** Do this at your gateway or proxy.
- **Revocation.** Tokens are validated as JWTs, not introspected. Use short lifetimes.
- **Persistence.** The notes store is in memory and per process.
- **TLS.** Terminate it in front of the server.
- **The authorization server.** This is a resource server only. It publishes where to authenticate and checks what comes back.

### Protocol versions

The server is built on `@modelcontextprotocol/sdk` 1.32, which implements protocol revisions up to `2025-11-25` and the `initialize` handshake. The newest specification revision (`2026-07-28`) removes protocol-level sessions and that handshake. A request that declares the newer version gets a `400` listing the versions this server supports, which is what lets clients fall back. The authorization behavior here (resource metadata, challenges, audience binding, scope challenges) follows the current authorization spec and does not depend on that choice.

## Project layout

```text
src/
  index.ts            entry point: config, listen, graceful shutdown
  app.ts              Express app: middleware order, routes, stateless MCP handler
  config.ts           environment schema (zod)
  logger.ts           JSON logger with redaction
  auth/
    challenge.ts      401 for requests without credentials
    verifier.ts       JWT access token verification (jose)
    jwks.ts           JWKS resolution and issuer discovery
    scopes.ts         scopes, hierarchy, WWW-Authenticate builder
    scope-guard.ts    per-tool scope enforcement (403 insufficient_scope)
    principal.ts      the authenticated caller, as tools see it
  http/
    origin.ts         Origin allowlist and CORS
    metadata.ts       Protected Resource Metadata (RFC 9728)
    jsonrpc.ts        JSON-RPC error responses
  mcp/
    server.ts         builds an McpServer with every tool registered
    tools/            tool definitions: whoami, notes_list, notes_create
  notes/store.ts      per-user notes store (in memory)
test/                 Vitest suites and the test identity provider
```

## License

[MIT](LICENSE) © 2026 Rômulo Carvalho
