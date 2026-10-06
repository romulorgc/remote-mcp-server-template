import { extractWWWAuthenticateParams } from "@modelcontextprotocol/sdk/client/auth.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, type TestServer, toolCall } from "./helpers/harness.js";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});
afterAll(() => server.close());

const metadataUrl = () => `${server.url}/.well-known/oauth-protected-resource`;

describe("insufficient scope (MCP authorization, Scope Challenge Handling)", () => {
  it("answers 403 with an insufficient_scope challenge naming the needed scope", async () => {
    const token = await server.token({ scope: "notes:read" });

    const response = await server.post(toolCall("notes_create", { title: "x" }), { token });

    expect(response.status).toBe(403);
    const challenge = response.headers.get("www-authenticate") ?? "";
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain('error="insufficient_scope"');
    expect(challenge).toContain('scope="notes:write"');
    expect(challenge).toContain(`resource_metadata="${metadataUrl()}"`);
    expect(challenge).toContain("error_description=");
    expect(await response.json()).toMatchObject({ error: "insufficient_scope" });
  });

  it("is a challenge the SDK client parses into what it needs for step-up", async () => {
    const token = await server.token({ scope: "notes:read" });

    const response = await server.post(toolCall("notes_create", { title: "x" }), { token });
    const challenge = extractWWWAuthenticateParams(response);

    expect(challenge.error).toBe("insufficient_scope");
    expect(challenge.scope).toBe("notes:write");
    expect(challenge.resourceMetadataUrl?.href).toBe(metadataUrl());
  });

  it("is not a 401: the token is valid, so the client should step up rather than start over", async () => {
    const token = await server.token({ scope: "notes:read" });

    const response = await server.post(toolCall("notes_create", { title: "x" }), { token });

    expect(response.status).not.toBe(401);
  });

  it("does not create the note when the scope is missing", async () => {
    const readOnly = await server.token({ sub: "step-up-1", scope: "notes:read" });
    await server.post(toolCall("notes_create", { title: "must not exist" }), { token: readOnly });

    const client = await server.connect(readOnly);
    const listed = await client.callTool({ name: "notes_list", arguments: {} });
    expect(listed.structuredContent).toEqual({ notes: [] });
  });

  it("surfaces as a 403 to the SDK client", async () => {
    const client = await server.connect(await server.token({ scope: "notes:read" }));

    await expect(
      client.callTool({ name: "notes_create", arguments: { title: "x" } }),
    ).rejects.toMatchObject({ code: 403 });
  });

  it("still lets a read-only token connect, list tools and call tools it is allowed to", async () => {
    const client = await server.connect(await server.token({ scope: "notes:read" }));

    expect((await client.listTools()).tools).toHaveLength(3);
    expect((await client.callTool({ name: "notes_list", arguments: {} })).isError).toBeFalsy();
    expect((await client.callTool({ name: "whoami", arguments: {} })).isError).toBeFalsy();
  });

  it("lets a token with no scopes at all call tools that need none", async () => {
    const token = await server.token({ scope: undefined });

    const allowed = await server.post(toolCall("whoami"), { token });
    expect(allowed.status).toBe(200);

    const denied = await server.post(toolCall("notes_list"), { token });
    expect(denied.status).toBe(403);
    expect(denied.headers.get("www-authenticate")).toContain('scope="notes:read"');
  });

  it("accepts a write-only token for writes", async () => {
    const token = await server.token({ scope: "notes:write" });

    expect((await server.post(toolCall("notes_create", { title: "ok" }), { token })).status).toBe(
      200,
    );
    expect((await server.post(toolCall("notes_list"), { token })).status).toBe(403);
  });

  it("honors the scope hierarchy: the umbrella scope `notes` implies read and write", async () => {
    const token = await server.token({ scope: "notes" });

    expect((await server.post(toolCall("notes_list"), { token })).status).toBe(200);
    expect((await server.post(toolCall("notes_create", { title: "ok" }), { token })).status).toBe(
      200,
    );
  });

  it("asks for every missing scope in a single challenge when a batch needs several", async () => {
    const token = await server.token({ scope: undefined });

    const response = await server.post(
      [toolCall("notes_list", {}, 1), toolCall("notes_create", { title: "x" }, 2)],
      { token },
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toContain('scope="notes:read notes:write"');
  });

  it("reads scopes from the `scp` claim as well", async () => {
    const token = await server.token({ scope: undefined, claims: { scp: ["notes:write"] } });

    expect((await server.post(toolCall("notes_create", { title: "ok" }), { token })).status).toBe(
      200,
    );
  });
});
