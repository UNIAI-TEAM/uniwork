// Ported from office-upstream apps/pdf/src/main/save-pdf.ts (addDrawing's note
// branch, findNoteAnnotRef, noteEdits): notes are standard Text annotations with
// /Contents, replies chain through /IRT + /RT, and saved notes are addressed by
// rect + contents (the object number is only a tie-break hint, since earlier
// pdfium stages may renumber objects). Resolve has no upstream counterpart; it
// writes the PDF review state model (/StateModel /Review, /State /Completed for
// resolved and /None otherwise), the standard contract viewers understand.
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString } from "pdf-lib";
import type { PDFPage } from "pdf-lib";
import type { NoteEditInput, NoteInput, NoteReplyTarget, NoteResolveInput } from "./types.ts";

const round = (value: number): number => Math.round(value * 100) / 100;

/** Epoch ms → PDF date string, e.g. D:20260812175959+08'00' */
function pdfDateString(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return (
    `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}` +
    `${sign}${p(Math.floor(abs / 60))}'${p(abs % 60)}'`
  );
}

const NOTE_RECT_TOL = 2;

/** Top-left anchors within tolerance — the only note identity that survives pdf.js
    resizing AP-less Text annot rects to its default icon size */
const noteRectsClose = (a: readonly number[], b: readonly number[]): boolean =>
  Math.abs(Math.min(a[0]!, a[2]!) - Math.min(b[0]!, b[2]!)) <= NOTE_RECT_TOL &&
  Math.abs(Math.max(a[1]!, a[3]!) - Math.max(b[1]!, b[3]!)) <= NOTE_RECT_TOL;

function noteContents(dict: PDFDict): string {
  const contents = dict.lookup(PDFName.of("Contents"));
  return contents instanceof PDFString || contents instanceof PDFHexString ? contents.decodeText() : "";
}

/** Locate the saved Text annotation an operation addresses. Earlier pdfium stages
    may have renumbered objects, so candidates match by rect + contents; the
    object-number hint only breaks ties between identical-looking notes. */
function findNoteAnnotRef(
  pdfDoc: PDFDocument,
  page: PDFPage,
  target: NoteReplyTarget,
): PDFRef | null {
  const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (!annots) return null;
  const matches: PDFRef[] = [];
  for (let i = 0; i < annots.size(); i++) {
    const ref = annots.get(i);
    if (!(ref instanceof PDFRef)) continue;
    const dict = pdfDoc.context.lookupMaybe(ref, PDFDict);
    if (!dict || dict.lookupMaybe(PDFName.of("Subtype"), PDFName) !== PDFName.of("Text")) continue;
    const rectArr = dict.lookupMaybe(PDFName.of("Rect"), PDFArray);
    if (!rectArr || rectArr.size() !== 4) continue;
    const rect: number[] = [];
    for (let j = 0; j < rectArr.size(); j++) {
      const value = rectArr.lookupMaybe(j, PDFNumber);
      if (value) rect.push(value.asNumber());
    }
    if (rect.length !== 4 || !noteRectsClose(rect, target.rect)) continue;
    if (noteContents(dict) !== target.contents) continue;
    if (ref.objectNumber === target.objNum) return ref;
    matches.push(ref);
  }
  return matches[0] ?? null;
}

function appendAnnotation(pdfDoc: PDFDocument, page: PDFPage, ref: PDFRef): void {
  const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (annots) annots.push(ref);
  else page.node.set(PDFName.of("Annots"), pdfDoc.context.obj([ref]));
}

/** Write one Text note. Replies whose parent cannot be resolved are skipped with
    a reason instead of being degraded to a root note — a comment that silently
    loses its thread is worse than one the caller can retry (the upstream port
    degrades instead; this lane reports). */
export function addNote(
  pdfDoc: PDFDocument,
  page: PDFPage,
  note: NoteInput,
  /** localId → registered ref of notes written earlier in this request (reply parenting) */
  noteRefs?: Map<string, PDFRef>,
): string | null {
  let parentRef: PDFRef | null = null;
  if (note.replyToLocalId !== undefined) {
    parentRef = noteRefs?.get(note.replyToLocalId) ?? null;
    if (!parentRef) return `reply parent "${note.replyToLocalId}" was not written in this request`;
  } else if (note.replyTo !== undefined) {
    parentRef = findNoteAnnotRef(pdfDoc, page, note.replyTo);
    if (!parentRef) return "reply parent note was not found in the file";
  }
  const annot = pdfDoc.context.obj({
    Type: "Annot",
    Subtype: "Text",
    Rect: [round(note.rect[0]), round(note.rect[1]), round(note.rect[2]), round(note.rect[3])],
    Name: "Comment",
    F: 4,
    P: page.ref,
  });
  annot.set(PDFName.of("Contents"), PDFHexString.fromText(note.contents));
  annot.set(PDFName.of("T"), PDFHexString.fromText(note.author || "UniWork"));
  const when = pdfDateString(note.createdMs ?? Date.now());
  annot.set(PDFName.of("CreationDate"), PDFString.of(when));
  annot.set(PDFName.of("M"), PDFString.of(when));
  if (parentRef) {
    annot.set(PDFName.of("IRT"), parentRef);
    annot.set(PDFName.of("RT"), PDFName.of("R"));
  }
  const ref = pdfDoc.context.register(annot);
  if (note.localId !== undefined) noteRefs?.set(note.localId, ref);
  appendAnnotation(pdfDoc, page, ref);
  return null;
}

/** Rewrite a saved note's /Contents in place; the object keeps its number. */
export function editNote(pdfDoc: PDFDocument, page: PDFPage, edit: NoteEditInput): string | null {
  const ref = findNoteAnnotRef(pdfDoc, page, {
    objNum: edit.objNum,
    rect: edit.rect,
    contents: edit.oldContents,
  });
  const dict = ref ? pdfDoc.context.lookupMaybe(ref, PDFDict) : null;
  if (!dict) return "note was not found in the file";
  dict.set(PDFName.of("Contents"), PDFHexString.fromText(edit.contents));
  dict.set(PDFName.of("M"), PDFString.of(pdfDateString(Date.now())));
  return null;
}

/** Write the review state (resolved / unresolved) of a saved note. */
export function resolveNote(pdfDoc: PDFDocument, page: PDFPage, input: NoteResolveInput): string | null {
  const ref = findNoteAnnotRef(pdfDoc, page, {
    objNum: input.objNum,
    rect: input.rect,
    contents: input.contents,
  });
  const dict = ref ? pdfDoc.context.lookupMaybe(ref, PDFDict) : null;
  if (!dict) return "note was not found in the file";
  dict.set(PDFName.of("StateModel"), PDFName.of("Review"));
  dict.set(PDFName.of("State"), PDFName.of(input.resolved ? "Completed" : "None"));
  return null;
}
