import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INITIALIZE_REQUEST, startTestServer, type TestServer } from "./helpers/harness.js";

const ALLOWED = "http://localhost:6274";

describe("origin validation (DNS rebinding protection)", () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer({ allowedOrigins: [ALLOWED] });
  });
  afterAll(() => server.close());

  it("refuses an Origin outside the allowlist, even with a valid token", async () => {
    const token = await server.token();

    const response = await server.post(INITIALIZE_REQUEST, {
      token,
      headers: { origin: "https://evil.example.com" },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ jsonrpc: "2.0", error: { code: -32000 } });
  });

  it("refuses a rebinding-style origin (an attacker domain pointing at this host)", async () => {
    const response = await server.post(INITIALIZE_REQUEST, {
      token: await server.token(),
      headers: { origin: server.url.replace("127.0.0.1", "attacker.example.com") },
    });

    expect(response.status).toBe(403);
  });

  it("refuses the opaque `null` origin", async () => {
    const response = await server.post(INITIALIZE_REQUEST, {
      token: await server.token(),
      headers: { origin: "null" },
    });

    expect(response.status).toBe(403);
  });

  it("checks the origin before the token: no 401 challenge for a foreign origin", async () => {
    const response = await server.post(INITIALIZE_REQUEST, {
      headers: { origin: "https://evil.example.com" },
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toBeNull();
  });

  it("applies to the metadata document too", async () => {
    const response = await fetch(`${server.url}/.well-known/oauth-protected-resource`, {
      headers: { origin: "https://evil.example.com" },
    });

    expect(response.status).toBe(403);
  });

  it("accepts an allowlisted Origin and answers CORS", async () => {
    const response = await server.post(INITIALIZE_REQUEST, {
      token: await server.token(),
      headers: { origin: ALLOWED },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(ALLOWED);
    expect(response.headers.get("access-control-expose-headers")).toContain("WWW-Authenticate");
    expect(response.headers.get("vary")).toContain("Origin");
  });

  it("answers a CORS preflight for an allowlisted origin without requiring a token", async () => {
    const response = await fetch(server.mcpUrl, {
      method: "OPTIONS",
      headers: {
        origin: ALLOWED,
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization, content-type, mcp-protocol-version",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(ALLOWED);
    expect(response.headers.get("access-control-allow-headers")).toContain("authorization");
  });

  it("lets the browser read the 401 challenge from an allowlisted origin", async () => {
    const response = await server.post(INITIALIZE_REQUEST, { headers: { origin: ALLOWED } });

    expect(response.status).toBe(401);
    expect(response.headers.get("access-control-expose-headers")).toContain("WWW-Authenticate");
  });

  it("does not require an Origin at all (CLI and SDK clients send none)", async () => {
    const response = await server.post(INITIALIZE_REQUEST, { token: await server.token() });

    expect(response.status).toBe(200);
  });
});

describe("origin validation with an empty allowlist", () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer();
  });
  afterAll(() => server.close());

  it("refuses every browser origin by default", async () => {
    const response = await server.post(INITIALIZE_REQUEST, {
      token: await server.token(),
      headers: { origin: ALLOWED },
    });

    expect(response.status).toBe(403);
  });
});
