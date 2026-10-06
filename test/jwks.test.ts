import { afterAll, describe, expect, it } from "vitest";
import { discoverJwksUri, discoveryUrls } from "../src/auth/jwks.js";
import { INITIALIZE_REQUEST, startTestServer, type TestServer } from "./helpers/harness.js";
import { startTestIdp } from "./helpers/idp.js";

describe("JWKS discovery", () => {
  const servers: TestServer[] = [];
  afterAll(async () => {
    await Promise.all(servers.map((server) => server.close()));
  });

  it("derives metadata URLs for issuers with and without a path", () => {
    expect(discoveryUrls("https://idp.example.com")).toEqual([
      "https://idp.example.com/.well-known/openid-configuration",
      "https://idp.example.com/.well-known/oauth-authorization-server",
    ]);
    expect(discoveryUrls("https://idp.example.com/realms/acme")).toEqual([
      "https://idp.example.com/realms/acme/.well-known/openid-configuration",
      "https://idp.example.com/.well-known/oauth-authorization-server/realms/acme",
    ]);
    expect(discoveryUrls("https://idp.example.com/")).toEqual([
      "https://idp.example.com/.well-known/openid-configuration",
      "https://idp.example.com/.well-known/oauth-authorization-server",
    ]);
  });

  it("finds jwks_uri from the issuer when AUTH_JWKS_URL is not set", async () => {
    const server = await startTestServer({ discoverJwks: true });
    servers.push(server);

    const response = await server.post(INITIALIZE_REQUEST, { token: await server.token() });

    expect(response.status).toBe(200);
  });

  it("fetches the JWKS once and reuses it for later tokens", async () => {
    const server = await startTestServer();
    servers.push(server);

    for (let i = 0; i < 3; i += 1) {
      await server.post(INITIALIZE_REQUEST, { token: await server.token() });
    }

    expect(server.idp.jwksRequests()).toBe(1);
  });

  it("refuses discovery metadata that names a different issuer", async () => {
    const idp = await startTestIdp({ discoveryIssuer: "https://honest.example.com" });
    try {
      await expect(discoverJwksUri(idp.issuer)).rejects.toThrow(/different issuer/);
    } finally {
      await idp.close();
    }
  });

  it("answers 500, not 401, when the JWKS cannot be reached", async () => {
    // Our side is broken, not the caller's: a 401 would make clients re-authenticate in a loop.
    const server = await startTestServer({ discoverJwks: true });
    servers.push(server);
    const token = await server.token();
    await server.idp.close();

    const response = await server.post(INITIALIZE_REQUEST, { token });

    expect(response.status).toBe(500);
    expect(response.headers.get("www-authenticate")).toBeNull();
  });
});
