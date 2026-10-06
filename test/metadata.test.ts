import {
  discoverOAuthProtectedResourceMetadata,
  extractWWWAuthenticateParams,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INITIALIZE_REQUEST, startTestServer, type TestServer } from "./helpers/harness.js";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});
afterAll(() => server.close());

describe("protected resource metadata (RFC 9728)", () => {
  it("is public and describes this resource and its authorization server", async () => {
    // No Authorization header: clients must be able to read this before they have a token.
    const response = await fetch(`${server.url}/.well-known/oauth-protected-resource`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const metadata = (await response.json()) as Record<string, unknown>;
    expect(metadata).toMatchObject({
      resource: server.url,
      authorization_servers: [server.idp.issuer],
      scopes_supported: ["notes:read", "notes:write"],
      bearer_methods_supported: ["header"],
    });
  });

  it("uses the resource identifier without a trailing slash", async () => {
    const metadata = (await (
      await fetch(`${server.url}/.well-known/oauth-protected-resource`)
    ).json()) as { resource: string };

    expect(metadata.resource.endsWith("/")).toBe(false);
  });

  it("can be followed by the SDK client, from the 401 challenge to the parsed document", async () => {
    const unauthorized = await server.post(INITIALIZE_REQUEST);
    const { resourceMetadataUrl } = extractWWWAuthenticateParams(unauthorized);
    expect(resourceMetadataUrl?.href).toBe(`${server.url}/.well-known/oauth-protected-resource`);

    const metadata = await discoverOAuthProtectedResourceMetadata(server.mcpUrl, {
      resourceMetadataUrl: resourceMetadataUrl as URL,
    });

    expect(metadata.resource).toBe(server.url);
    expect(metadata.authorization_servers).toEqual([server.idp.issuer]);
  });

  it("serves an unauthenticated health check", async () => {
    const response = await fetch(`${server.url}/healthz`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
