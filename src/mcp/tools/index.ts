import type { ToolDefinition } from "./define-tool.js";
import { notesCreate, notesList } from "./notes.js";
import { whoami } from "./whoami.js";

/** Every tool the server exposes. Add yours here. */
export const tools: readonly ToolDefinition[] = [whoami, notesList, notesCreate];

/** Tool name to required scopes: the single source of truth for scope enforcement. */
export const toolScopes: ReadonlyMap<string, readonly string[]> = new Map(
  tools.map((tool) => [tool.name, tool.scopes]),
);
