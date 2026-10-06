import { z } from "zod";
import { SCOPES } from "../../auth/scopes.js";
import { NotesLimitError } from "../../notes/store.js";
import { defineTool, errorResult, jsonResult } from "./define-tool.js";

const noteShape = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  createdAt: z.string(),
});

export const notesList = defineTool({
  name: "notes_list",
  title: "List notes",
  description: "Lists the caller's own notes, newest first. Other users' notes are never visible.",
  scopes: [SCOPES.notesRead],
  inputSchema: {
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .describe("Maximum number of notes to return"),
  },
  outputSchema: { notes: z.array(noteShape) },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  async handler({ limit }, { principal, notes }) {
    return jsonResult({ notes: await notes.list(principal.sub, limit) });
  },
});

export const notesCreate = defineTool({
  name: "notes_create",
  title: "Create note",
  description: "Creates a note owned by the caller.",
  scopes: [SCOPES.notesWrite],
  inputSchema: {
    title: z.string().trim().min(1).max(200).describe("Short title"),
    body: z.string().max(10_000).default("").describe("Note text"),
  },
  outputSchema: { note: noteShape },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  async handler({ title, body }, { principal, notes }) {
    try {
      return jsonResult({ note: await notes.create(principal.sub, { title, body }) });
    } catch (error) {
      if (error instanceof NotesLimitError) return errorResult(error.message);
      throw error;
    }
  },
});
