import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { principalFromAuthInfo } from "../auth/principal.js";
import { missingScopes } from "../auth/scopes.js";
import { SERVER_NAME, SERVER_VERSION } from "../meta.js";
import type { NotesStore } from "../notes/store.js";
import { errorResult } from "./tools/define-tool.js";
import { tools } from "./tools/index.js";

export interface McpServerDeps {
  notes: NotesStore;
}

/**
 * Build a fresh MCP server with every tool registered.
 *
 * The HTTP layer calls this once per request (stateless mode), so nothing here may hold
 * per-connection state. Shared state, like the notes store, is injected.
 */
export function createMcpServer(deps: McpServerDeps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        annotations: tool.annotations,
      },
      async (args, extra) => {
        // The principal comes from the validated token, never from tool arguments.
        const principal = principalFromAuthInfo(extra.authInfo);

        // Defense in depth: the HTTP scope guard normally answers 403 before we get here.
        const missing = missingScopes(principal.scopes, tool.scopes);
        if (missing.length > 0) {
          return errorResult(`Insufficient scope. Missing: ${missing.join(" ")}`);
        }

        return tool.handler(args, { principal, notes: deps.notes });
      },
    );
  }

  return server;
}
