// Notes family of the DOCX session model, split out of ./model to keep that
// file inside the 500-line budget (same pattern as ./protection and ./fields).
//
// The model owns authoritative footnote/endnote lists that reach saveDocx as
// SaveOptions.footnotes/endnotes: the part is regenerated in list order, and
// numbers follow that order, so a delete renumbers the survivors. An untouched
// list never reaches SaveOptions, so a save keeps the notes part
// byte-identical (the byte-preservation rule).
import { DocxEngineError, type DocxNoteInfo, type DocxNoteKind, type DocxParsed, type DocxSaveOptions } from "./engine";
import { cloneNote, requireNote } from "./payloads";

/** Pending note edits of one session, keyed by kind. Each kind stays undefined
 * while the parse's own list is authoritative. */
export class DocxNoteEdits {
  private footnotes: DocxNoteInfo[] | undefined;
  private endnotes: DocxNoteInfo[] | undefined;

  constructor(private readonly onDirty: () => void) {}

  private requireKind(kind: DocxNoteKind, what: string): void {
    if (kind !== "footnote" && kind !== "endnote") {
      throw new DocxEngineError("bad_note_kind", what + " kind " + String(kind) + " is not footnote/endnote");
    }
  }

  private own(kind: DocxNoteKind): DocxNoteInfo[] | undefined {
    return kind === "footnote" ? this.footnotes : this.endnotes;
  }

  /** The authoritative note list of a kind: the edit's own list until one
   * replaces it, else the parse's list. */
  list(parsed: DocxParsed, kind: DocxNoteKind): DocxNoteInfo[] {
    this.requireKind(kind, "notes");
    const own = this.own(kind);
    if (own) return own.map(cloneNote);
    const source = kind === "footnote" ? parsed.footnotes : parsed.endnotes;
    return Array.isArray(source) ? source.map(cloneNote) : [];
  }

  /** Replace the authoritative list â€” upstream SaveOptions.footnotes/endnotes:
   * the save regenerates the part from it in list order, and numbers follow
   * that order, so a delete renumbers the survivors. Ids must be unique within
   * the kind. */
  set(kind: DocxNoteKind, notes: DocxNoteInfo[]): void {
    this.requireKind(kind, "set_notes");
    if (!Array.isArray(notes)) {
      throw new DocxEngineError("bad_note", "set_notes needs a note list");
    }
    const ids = new Set<string>();
    for (const note of notes) {
      requireNote(note, "set_notes");
      if (ids.has(note.id)) {
        throw new DocxEngineError("duplicate_note_id", "note id " + note.id + " appears twice");
      }
      ids.add(note.id);
    }
    const copy = notes.map(cloneNote);
    if (kind === "footnote") this.footnotes = copy;
    else this.endnotes = copy;
    this.onDirty();
  }

  /** Append one note (the caller allocates the id; the display number follows
   * list order). Blank bodies are refused: an inserted note is user text. */
  insert(parsed: DocxParsed, kind: DocxNoteKind, note: DocxNoteInfo): void {
    this.requireKind(kind, "insert_note");
    requireNote(note, "insert_note");
    if (note.text.trim().length === 0) {
      throw new DocxEngineError("empty_note_text", "insert_note note " + note.id + " needs non-blank text");
    }
    if (this.list(parsed, kind).some((entry) => entry.id === note.id)) {
      throw new DocxEngineError("duplicate_note_id", "note id " + note.id + " already exists");
    }
    this.set(kind, [...this.list(parsed, kind), note]);
  }

  /** Edit a note's text. The plain-text edit drops the measured rich runs: the
   * vendored rebuild prefers richParas over text when it has to rebuild an
   * entry (notes.ts:265), so keeping stale runs would silently revert the
   * edit. The save still first tries an in-place w:t patch, which keeps the
   * entry's inline formatting (notes.ts:329). */
  setText(parsed: DocxParsed, kind: DocxNoteKind, id: string, text: string): void {
    this.requireKind(kind, "set_note_text");
    if (typeof text !== "string" || text.trim().length === 0) {
      throw new DocxEngineError("empty_note_text", "set_note_text needs non-blank text");
    }
    const list = this.list(parsed, kind);
    const at = list.findIndex((note) => note.id === id);
    if (at < 0) throw new DocxEngineError("unknown_note", "no " + kind + " " + id + " to edit");
    const next: DocxNoteInfo = { ...list[at]!, text };
    delete next.richParas;
    list[at] = next;
    this.set(kind, list);
  }

  /** Delete a note. The survivors keep their ids and order, so the saved part
   * numbers them 1..N again (renumbering is part order, Word's own rule). */
  remove(parsed: DocxParsed, kind: DocxNoteKind, id: string): void {
    this.requireKind(kind, "delete_note");
    const list = this.list(parsed, kind);
    if (!list.some((note) => note.id === id)) {
      throw new DocxEngineError("unknown_note", "no " + kind + " " + id + " to delete");
    }
    this.set(kind, list.filter((note) => note.id !== id));
  }

  /** Only the edits the user made; a kind stays absent otherwise so an
   * untouched list never reaches SaveOptions. */
  saveOptions(): DocxSaveOptions {
    const options: DocxSaveOptions = {};
    if (this.footnotes !== undefined) options.footnotes = this.footnotes.map(cloneNote);
    if (this.endnotes !== undefined) options.endnotes = this.endnotes.map(cloneNote);
    return options;
  }

  clear(): void {
    this.footnotes = undefined;
    this.endnotes = undefined;
  }
}