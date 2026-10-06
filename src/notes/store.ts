import { randomUUID } from "node:crypto";

export interface Note {
  id: string;
  title: string;
  body: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

export interface NewNote {
  title: string;
  body: string;
}

export class NotesLimitError extends Error {
  override name = "NotesLimitError";
}

/**
 * Storage for notes. Every operation takes the owner (the token's `sub`) as its first
 * argument, so a caller can only ever reach its own data: tenant isolation is part of the
 * interface, not something each tool has to remember.
 *
 * Swap the in-memory implementation for a database to run more than one replica.
 */
export interface NotesStore {
  /** Newest first. */
  list(owner: string, limit: number): Promise<Note[]>;
  create(owner: string, note: NewNote): Promise<Note>;
}

export class InMemoryNotesStore implements NotesStore {
  private readonly notesByOwner = new Map<string, Note[]>();

  constructor(private readonly maxNotesPerOwner = 1_000) {}

  async list(owner: string, limit: number): Promise<Note[]> {
    const notes = this.notesByOwner.get(owner) ?? [];
    return notes.slice(-limit).reverse();
  }

  async create(owner: string, note: NewNote): Promise<Note> {
    const notes = this.notesByOwner.get(owner) ?? [];
    if (notes.length >= this.maxNotesPerOwner) {
      throw new NotesLimitError(`Note limit reached (${this.maxNotesPerOwner})`);
    }
    const created: Note = {
      id: randomUUID(),
      title: note.title,
      body: note.body,
      createdAt: new Date().toISOString(),
    };
    notes.push(created);
    this.notesByOwner.set(owner, notes);
    return created;
  }
}
