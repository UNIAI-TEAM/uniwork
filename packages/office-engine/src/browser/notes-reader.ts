// Saved-note reader for the browser PDF lane. Notes are standard Text
// annotations written by src/pdf/notes.ts: /Contents holds the body, /T the
// author, /State /Completed marks a resolved thread, and replies chain to their
// parent through /IRT + /RT. The read side therefore understands the same
// identity the writer guards edits with (page + rect + contents) and returns the
// thread shape the views' PdfNoteThread contract expects — mirrored here instead
// of imported, so the engine stays host-agnostic and the web adapter maps rows
// onto the view types.
//
// Every field is read through a raw `get` + `instanceof` probe rather than
// `lookupMaybe(key, Type)`: that helper throws on a type mismatch and resolves
// /IRT to its target dict, so a foreign PDF with an unexpected annotation value
// would abort the whole read. A malformed note is skipped, never fatal.
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString } from "pdf-lib";

/** PDF user-space annotation rectangle: [x1, y1, x2, y2]. */
export type BrowserPdfNoteRect = [number, number, number, number];

/** One thread member read from the file. Structurally the views' PdfNoteRow. */
export interface BrowserPdfNoteRow {
  /** Stable row key: `${pageIndex}:${objNum}` (object numbers are file-global). */
  id: string;
  /** 1-based displayed page (display only). */
  page: number;
  /** 0-based original file index; the identity the engine matches writes on. */
  pageIndex: number;
  objNum: number;
  rect: BrowserPdfNoteRect;
  contents: string;
  author?: string;
  /** Present only when /State is /Completed; absent means not resolved. */
  resolved?: boolean;
}

export interface BrowserPdfNoteThread {
  id: string;
  root: BrowserPdfNoteRow;
  replies: BrowserPdfNoteRow[];
}

/** A Text annotation the reader could not place in a thread, with the reason. */
export interface BrowserPdfNoteSkip {
  pageIndex: number;
  objNum: number;
  reason: string;
}

export interface BrowserPdfNotesRead {
  threads: BrowserPdfNoteThread[];
  skipped: BrowserPdfNoteSkip[];
}

interface NoteRecord {
  pageIndex: number;
  objNum: number;
  rect: BrowserPdfNoteRect;
  contents: string;
  author: string;
  resolved: boolean;
  /** /IRT parent object number, or null for a root note. */
  parentObjNum: number | null;
}

const NOTE_SUBTYPE = PDFName.of("Text").asString();
const STATE_COMPLETED = PDFName.of("Completed").asString();

function nameOf(dict: PDFDict, key: string): string {
  const value = dict.get(PDFName.of(key));
  return value instanceof PDFName ? value.asString() : "";
}

function textOf(dict: PDFDict, key: string): string {
  const value = dict.get(PDFName.of(key));
  return value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : "";
}

function rectOf(dict: PDFDict): BrowserPdfNoteRect | null {
  const array = dict.get(PDFName.of("Rect"));
  if (!(array instanceof PDFArray) || array.size() !== 4) return null;
  const values: number[] = [];
  for (let i = 0; i < 4; i++) {
    const number = array.get(i);
    if (!(number instanceof PDFNumber)) return null;
    values.push(number.asNumber());
  }
  if (!values.every((value) => Number.isFinite(value))) return null;
  return [values[0]!, values[1]!, values[2]!, values[3]!];
}

/** Walk the /IRT chain to the root note. Null = the chain leaves the file or
    loops, so the note cannot be threaded and is reported as a skip. */
function resolveRoot(record: NoteRecord, byObjNum: Map<number, NoteRecord>): NoteRecord | null {
  const seen = new Set<number>();
  let current: NoteRecord | undefined = record;
  while (current && current.parentObjNum !== null) {
    if (seen.has(current.objNum)) return null;
    seen.add(current.objNum);
    current = byObjNum.get(current.parentObjNum);
  }
  return current ?? null;
}

function toRow(record: NoteRecord): BrowserPdfNoteRow {
  const row: BrowserPdfNoteRow = {
    id: `${record.pageIndex}:${record.objNum}`,
    page: record.pageIndex + 1,
    pageIndex: record.pageIndex,
    objNum: record.objNum,
    rect: record.rect,
    contents: record.contents,
  };
  if (record.author !== "") row.author = record.author;
  if (record.resolved) row.resolved = true;
  return row;
}

/**
 * Read every saved note thread from `bytes`. Text annotations are collected in
 * document order; a note whose /IRT parent is not a readable Text annotation is
 * skipped with a reason instead of being degraded to a root (same policy as the
 * writer's unresolvable-reply skip). A Text annotation without a usable /Rect is
 * skipped too: the views address notes by rect + contents, so it cannot be acted
 * on.
 */
export async function readPdfNotes(bytes: Uint8Array): Promise<BrowserPdfNotesRead> {
  const pdfDoc = await PDFDocument.load(bytes, { updateMetadata: false });
  const records: NoteRecord[] = [];
  const skipped: BrowserPdfNoteSkip[] = [];

  const pages = pdfDoc.getPages();
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const annots = pages[pageIndex]?.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const entry = annots.get(i);
      if (!(entry instanceof PDFRef)) continue;
      const resolved = pdfDoc.context.lookup(entry);
      if (!(resolved instanceof PDFDict)) continue;
      const dict = resolved;
      if (!dict || nameOf(dict, "Subtype") !== NOTE_SUBTYPE) continue;
      const rect = rectOf(dict);
      if (!rect) {
        skipped.push({ pageIndex, objNum: entry.objectNumber, reason: "note annotation has no valid /Rect" });
        continue;
      }
      const parent = dict.get(PDFName.of("IRT"));
      records.push({
        pageIndex,
        objNum: entry.objectNumber,
        rect,
        contents: textOf(dict, "Contents"),
        author: textOf(dict, "T"),
        resolved: nameOf(dict, "State") === STATE_COMPLETED,
        parentObjNum: parent instanceof PDFRef ? parent.objectNumber : null,
      });
    }
  }

  const byObjNum = new Map<number, NoteRecord>();
  for (const record of records) byObjNum.set(record.objNum, record);

  const roots: NoteRecord[] = [];
  const repliesByRoot = new Map<number, NoteRecord[]>();
  for (const record of records) {
    if (record.parentObjNum === null) {
      roots.push(record);
      continue;
    }
    const root = resolveRoot(record, byObjNum);
    if (!root) {
      skipped.push({ pageIndex: record.pageIndex, objNum: record.objNum, reason: "reply parent note was not found in the file" });
      continue;
    }
    const replies = repliesByRoot.get(root.objNum);
    if (replies) replies.push(record);
    else repliesByRoot.set(root.objNum, [record]);
  }

  const threads = roots.map((root) => {
    const row = toRow(root);
    return { id: row.id, root: row, replies: (repliesByRoot.get(root.objNum) ?? []).map(toRow) };
  });
  return { threads, skipped };
}
