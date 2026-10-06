import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "./helpers/harness.js";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});
afterAll(() => server.close());

describe("MCP over Streamable HTTP", () => {
  it("initializes and lists tools through the SDK client", async () => {
    const client = await server.connect(await server.token());

    expect(client.getServerVersion()?.name).toBe("remote-mcp-server-template");

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(["notes_create", "notes_list", "whoami"]);
  });

  it("whoami returns the subject and scopes from the token", async () => {
    const client = await server.connect(
      await server.token({ sub: "alice", scope: "notes:read", claims: { client_id: "client-a" } }),
    );

    const result = await client.callTool({ name: "whoami", arguments: {} });

    expect(result.structuredContent).toEqual({
      sub: "alice",
      clientId: "client-a",
      scopes: ["notes:read"],
    });
  });

  it("creates and lists notes", async () => {
    const client = await server.connect(await server.token({ sub: "bob" }));

    const created = await client.callTool({
      name: "notes_create",
      arguments: { title: "Groceries", body: "milk" },
    });
    expect(created.isError).toBeFalsy();

    const listed = await client.callTool({ name: "notes_list", arguments: {} });
    expect(listed.structuredContent).toMatchObject({
      notes: [{ title: "Groceries", body: "milk" }],
    });
  });

  it("validates tool input with zod", async () => {
    const client = await server.connect(await server.token({ sub: "carol" }));

    const emptyTitle = await client.callTool({
      name: "notes_create",
      arguments: { title: "   " },
    });
    expect(emptyTitle.isError).toBe(true);

    const wrongType = await client.callTool({
      name: "notes_create",
      arguments: { title: 42 },
    });
    expect(wrongType.isError).toBe(true);

    const listed = await client.callTool({ name: "notes_list", arguments: {} });
    expect(listed.structuredContent).toEqual({ notes: [] });
  });
});

describe("tenant isolation", () => {
  it("keeps each user's notes private", async () => {
    const alice = await server.connect(await server.token({ sub: "iso-alice" }));
    const bob = await server.connect(await server.token({ sub: "iso-bob" }));

    await alice.callTool({
      name: "notes_create",
      arguments: { title: "alice secret", body: "for alice only" },
    });

    const bobSees = await bob.callTool({ name: "notes_list", arguments: {} });
    expect(bobSees.structuredContent).toEqual({ notes: [] });

    await bob.callTool({ name: "notes_create", arguments: { title: "bob note" } });

    const aliceSees = (await alice.callTool({ name: "notes_list", arguments: {} }))
      .structuredContent as { notes: { title: string }[] };
    expect(aliceSees.notes.map((note) => note.title)).toEqual(["alice secret"]);

    const bobSeesNow = (await bob.callTool({ name: "notes_list", arguments: {} }))
      .structuredContent as { notes: { title: string }[] };
    expect(bobSeesNow.notes.map((note) => note.title)).toEqual(["bob note"]);
  });

  it("returns the same notes to the same user on a new connection", async () => {
    const first = await server.connect(await server.token({ sub: "iso-dave" }));
    await first.callTool({ name: "notes_create", arguments: { title: "persisted" } });

    // A brand new client and a brand new token: stateless transport, shared store, same sub.
    const second = await server.connect(await server.token({ sub: "iso-dave" }));
    const listed = (await second.callTool({ name: "notes_list", arguments: {} }))
      .structuredContent as { notes: { title: string }[] };

    expect(listed.notes.map((note) => note.title)).toEqual(["persisted"]);
  });
});
