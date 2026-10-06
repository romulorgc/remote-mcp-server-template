import { z } from "zod";
import { defineTool, jsonResult } from "./define-tool.js";

export const whoami = defineTool({
  name: "whoami",
  title: "Who am I",
  description:
    "Returns the authenticated user id (the token's sub claim) and the scopes granted to it.",
  scopes: [],
  inputSchema: {},
  outputSchema: {
    sub: z.string(),
    clientId: z.string(),
    scopes: z.array(z.string()),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  async handler(_args, { principal }) {
    return jsonResult({
      sub: principal.sub,
      clientId: principal.clientId,
      scopes: [...principal.scopes],
    });
  },
});
