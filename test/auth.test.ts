import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INITIALIZE_REQUEST, startTestServer, type TestServer } from "./helpers/harness.js";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});
afterAll(() => server.close());

const expectedMetadataUrl = () => `${server.url}/.well-known/oauth-protected-resource`;

describe("authentication", () => {
  it("answers 401 with a resource_metadata challenge when there is no token", async () => {
    const response = await server.post(INITIALIZE_REQUEST);

    expect(response.status).toBe(401);
    const challenge = response.headers.get("www-authenticate");
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain(`resource_metadata="${expectedMetadataUrl()}"`);
  });

  it("keeps the no-credentials challenge bare, with scope guidance and no error code (RFC 6750)", async () => {
    const response = await server.post(INITIALIZE_REQUEST);

    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer scope="notes:read", resource_metadata="${expectedMetadataUrl()}"`,
    );
  });

  it("answers 401 for a malformed Authorization header", async () => {
    const response = await server.post(INITIALIZE_REQUEST, {
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("resource_metadata=");
  });

  it("accepts a valid token", async () => {
    const response = await server.post(INITIALIZE_REQUEST, { token: await server.token() });

    expect(response.status).toBe(200);
  });

  it("rejects a token issued for another audience (RFC 8707)", async () => {
    const token = await server.token({ audience: "https://some-other-api.example.com" });
    const response = await server.post(INITIALIZE_REQUEST, { token });

    expect(response.status).toBe(401);
    const challenge = response.headers.get("www-authenticate");
    expect(challenge).toContain('error="invalid_token"');
    expect(challenge).toContain("resource_metadata=");
  });

  it("accepts a token whose audience list includes this server", async () => {
    const token = await server.token({
      audience: ["https://some-other-api.example.com", server.url],
    });

    expect((await server.post(INITIALIZE_REQUEST, { token })).status).toBe(200);
  });

  it("rejects an expired token", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await server.token({ issuedAt: now - 7200, expiresAt: now - 3600 });
    const response = await server.post(INITIALIZE_REQUEST, { token });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("rejects a token from another issuer", async () => {
    const token = await server.token({ issuer: "https://evil.example.com" });

    expect((await server.post(INITIALIZE_REQUEST, { token })).status).toBe(401);
  });

  it("rejects a token signed with a key the JWKS does not publish", async () => {
    const token = await server.idp.signWithUnpublishedKey({
      issuer: server.idp.issuer,
      audience: server.url,
      sub: "user-1",
    });

    expect((await server.post(INITIALIZE_REQUEST, { token })).status).toBe(401);
  });

  it("rejects an unsecured (alg none) token", async () => {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const token = `${encode({ alg: "none", typ: "JWT" })}.${encode({
      iss: server.idp.issuer,
      aud: server.url,
      sub: "user-1",
      exp: now + 3600,
    })}.`;

    expect((await server.post(INITIALIZE_REQUEST, { token })).status).toBe(401);
  });

  it("rejects a token without a subject", async () => {
    const token = await server.token({ sub: undefined });

    expect((await server.post(INITIALIZE_REQUEST, { token })).status).toBe(401);
  });

  it("rejects something that is not a JWT", async () => {
    expect((await server.post(INITIALIZE_REQUEST, { token: "not-a-jwt" })).status).toBe(401);
  });

  it("does not offer GET or DELETE (stateless mode)", async () => {
    const token = await server.token();
    for (const method of ["GET", "DELETE"]) {
      const response = await fetch(server.mcpUrl, {
        method,
        headers: { authorization: `Bearer ${token}`, accept: "text/event-stream" },
      });
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
    }
  });

  it("reports malformed JSON as a JSON-RPC parse error", async () => {
    const response = await fetch(server.mcpUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await server.token()}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: "{not json",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: -32700 } });
  });
});

describe("logging", () => {
  it("writes JSON lines and never writes a token", async () => {
    const token = await server.token();
    await server.post(INITIALIZE_REQUEST, { token });
    await server.post(INITIALIZE_REQUEST, { token: "another.bad.token" });

    const lines = server.logs.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => line.level !== undefined && line.msg !== undefined)).toBe(true);

    const everything = server.logs.join("\n");
    expect(everything).not.toContain(token);
    expect(everything).not.toContain("another.bad.token");
    expect(everything.toLowerCase()).not.toContain("bearer");
  });
});
