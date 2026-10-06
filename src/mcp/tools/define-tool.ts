import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import type { Principal } from "../../auth/principal.js";
import type { NotesStore } from "../../notes/store.js";

/** What a tool handler can use. Built per request from the validated token. */
export interface ToolContext {
  principal: Principal;
  notes: NotesStore;
}

export interface ToolDefinition<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  /**
   * Scopes the token must hold to call this tool. Enforced twice: at the HTTP layer
   * (403 with an `insufficient_scope` challenge, so clients can step up) and again in the
   * handler wrapper as defense in depth. Empty means any authenticated caller.
   */
  scopes: readonly string[];
  inputSchema: Shape;
  outputSchema: z.ZodRawShape;
  annotations: ToolAnnotations;
  // Method syntax on purpose: it keeps handlers assignable to `ToolDefinition` (bivariance).
  handler(args: z.infer<z.ZodObject<Shape>>, context: ToolContext): Promise<CallToolResult>;
}

/** Identity function that infers the input shape, so `args` in the handler is fully typed. */
export function defineTool<Shape extends z.ZodRawShape>(
  tool: ToolDefinition<Shape>,
): ToolDefinition<Shape> {
  return tool;
}

/** A successful result: JSON text for any client, plus `structuredContent` for clients that read it. */
export function jsonResult<T extends Record<string, unknown>>(data: T): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

/** A tool-level failure the model can read and react to (not a protocol error). */
export function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}
