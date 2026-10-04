// The save pipeline — ported from office-upstream apps/pdf/src/main/save-pdf.ts
// (applySaveRequest + verifyContentEdits + finalPageIndex + applyMetadata),
// trimmed to the G2-05 scope: annot deletes, text edits/inserts, image ops,
// page rotation/deletion/reorder, metadata. Markup, drawing, ink and note
// annotations are kept separate from content streams; form authoring remains
// outside this lane. Image / signature stamps (B6) draw straight into the
// target page's content stream, so they need no annotation and are applied in
// the pdf-lib stage.
//
// Ordering contract (upstream, kept exactly):
//   1. annotDeletes first — their object numbers address the on-disk bytes and
//      later pdfium rewrites may renumber objects.
//   2. Content-stream rewrites (textEdits, textInserts, imageEdits) land before
//      pdf-lib touches the bytes.
//   3. pdf-lib stage: rotations, metadata, stamps, annotations (markup/drawing/
//      ink, then notes, then saved-note edits/resolves — note edits run after
//      the note stage so same-request replies still match parents by old
//      contents), then deletions (descending), then reorder — earlier ops all
//      address original page indices.
//   4. Read-back verification against the final bytes BEFORE the caller sees
//      them: a verify failure means the output is thrown away and the original
//      bytes are never replaced.
import { PDFDocument, PDFName, degrees } from "pdf-lib";
import type { PDFRef } from "pdf-lib";

import type {
  ImageEditFailure,
  MetadataInput,
  PageOpFailure,
  PdfEditRequest,
  PdfNewDocument,
  TextEditFailure,
  TextInsertFailure,
} from "./types.ts";
import { applyAnnotDeletes } from "./annots.ts";
import { applyImageEdits } from "./image.ts";
import { verifyImageEdits } from "./render.ts";
import { applyTextEdits, verifyTextEdits } from "./text.ts";
import { applyTextInserts } from "./text-insert.ts";
import { addMarkup } from "./markups.ts";
import { addDrawing } from "./drawings.ts";
import { applyStamp } from "./stamps.ts";
import { addNote, editNote, resolveNote } from "./notes.ts";
import { applyFormValue, flattenForms } from "./forms.ts";
import { PdfOpError } from "./op-parse.ts";
import {
  extractPagesBytes,
  insertBlankPageBytes,
  insertPdfBytes,
  mergePdfBytes,
  PdfPageOpSourceError,
  splitPdfBytes,
} from "./page-ops.ts";

export interface PdfEditSkips {
  skippedTextEdits: TextEditFailure[];
  skippedTextInserts: TextInsertFailure[];
  skippedImageEdits: ImageEditFailure[];
  /** annotDeletes that matched nothing — requested minus removed, honestly. */
  skippedAnnotDeletes: { pageIndex: number; reason: string }[];
  skippedMarkups: { pageIndex: number; reason: string }[];
  skippedDrawings: { pageIndex: number; reason: string }[];
  /** Stamps refused at draw time (page out of range, undecodable image). */
  skippedStamps: { pageIndex: number; reason: string }[];
  skippedNotes: { pageIndex: number; reason: string }[];
  skippedNoteEdits: { pageIndex: number; reason: string }[];
  skippedNoteResolves: { pageIndex: number; reason: string }[];
  /** AcroForm fields whose write was refused (unknown name, kind or value). */
  skippedFormValues: { name: string; reason: string }[];
  /** Page inserts whose anchor page is not in the output (an unusable source
      PDF is a typed refusal, not a skip). */
  skippedPageInserts: PageOpFailure[];
  /** Document producers (extract / merge / split) that produced nothing. */
  skippedNewDocuments: PageOpFailure[];
}

export interface AppliedPdfEdit {
  bytes: Uint8Array;
  skips: PdfEditSkips;
  /** Annotations actually removed (differs from requested when skips exist). */
  annotDeletesApplied: number;
  /** 1 when the interactive form was flattened, 0 when there was none. */
  formsFlattened: number;
  /** NEW documents produced by extract / merge / split. F2: the caller commits
      each one through Documents; the engine never writes them anywhere. */
  documents: PdfNewDocument[];
}

/** Original page index → index in the saved file (after deletions/reorder);
    null = the page is gone from the output */
function finalPageIndex(request: PdfEditRequest, p: number): number | null {
  if (request.pageOrder) {
    const i = request.pageOrder.indexOf(p);
    return i >= 0 ? i : null;
  }
  const del = request.deletedPages ?? [];
  if (del.includes(p)) return null;
  return p - del.filter((d) => d < p).length;
}

function applyMetadata(pdfDoc: PDFDocument, meta: MetadataInput): void {
  if (meta.title !== undefined) pdfDoc.setTitle(meta.title);
  if (meta.author !== undefined) pdfDoc.setAuthor(meta.author);
  if (meta.subject !== undefined) pdfDoc.setSubject(meta.subject);
  if (meta.keywords !== undefined) {
    pdfDoc.setKeywords(
      meta.keywords
        .split(/[,，;；]/)
        .map((k) => k.trim())
        .filter(Boolean),
    );
  }
  pdfDoc.setModificationDate(new Date());
}

/**
 * Read-back verification of applied content-stream edits against the final
 * bytes. Anything that fails here would have been silent data loss; the caller
 * refuses the output so the original input is kept untouched.
 */
async function verifyContentEdits(
  bytes: Uint8Array,
  request: PdfEditRequest,
  skips: PdfEditSkips,
): Promise<void> {
  const failures: { pageIndex: number; reason: string }[] = [];
  const appliedText = (request.textEdits ?? []).filter(
    (e) =>
      !skips.skippedTextEdits.some((s) => s.pageIndex === e.pageIndex && s.oldText === e.oldText),
  );
  if (appliedText.length > 0) {
    const remapped = appliedText.flatMap((e) => {
      const pageIndex = finalPageIndex(request, e.pageIndex);
      return pageIndex === null ? [] : [{ pageIndex, newText: e.newText }];
    });
    failures.push(...(await verifyTextEdits(bytes, remapped)));
  }
  const appliedInserts = (request.textInserts ?? []).filter(
    (_insert, editIndex) =>
      !skips.skippedTextInserts.some((skipped) => skipped.editIndex === editIndex),
  );
  if (appliedInserts.length > 0) {
    const remapped = appliedInserts.flatMap((insert) => {
      const pageIndex = finalPageIndex(request, insert.pageIndex);
      return pageIndex === null ? [] : [{ pageIndex, newText: insert.text }];
    });
    failures.push(...(await verifyTextEdits(bytes, remapped)));
  }
  const appliedImages = (request.imageEdits ?? []).filter(
    (e, i) => e.kind !== "deleteImage" && !skips.skippedImageEdits.some((s) => s.editIndex === i),
  );
  if (appliedImages.length > 0) {
    const remapped = appliedImages.flatMap((e) => {
      const pageIndex = finalPageIndex(request, e.pageIndex);
      return pageIndex === null || e.kind === "deleteImage" ? [] : [{ pageIndex, rect: e.rect }];
    });
    failures.push(...(await verifyImageEdits(bytes, remapped)));
  }
  if (failures.length > 0) {
    const pages = [...new Set(failures.map((f) => f.pageIndex + 1))].sort((a, b) => a - b);
    throw new PdfVerifyError(
      `save-verify-failed pages=${pages.join(",")}: ${failures[0]!.reason}; the output was not produced`,
    );
  }
}

/** Typed failure for read-back verification — the adapter maps it to a typed
    error code; callers distinguish it from a generic crash. */
export class PdfVerifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfVerifyError";
  }
}

/** Decode a base64 PDF payload. Buffer silently drops invalid characters, so
    the shape is checked first; a payload that is not valid base64 is a typed
    caller refusal, never a silent skip — dropping a requested source would
    hand back a document missing pages the caller asked for. */
function decodePdfBase64(value: string, op: string): Uint8Array {
  const compact = value.replace(/\s+/g, "");
  if (compact.length === 0 || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    throw new PdfPageOpSourceError(op, "source PDF data is not valid base64");
  }
  const bytes = Uint8Array.from(Buffer.from(compact, "base64"));
  if (bytes.length === 0) throw new PdfPageOpSourceError(op, "source PDF data is empty");
  return bytes;
}

/** One page insert to run after the pdf-lib stage. `position` is an index in
    the output document (post deletion/reorder); the plan is executed highest
    position first so an earlier insert never shifts a later one. */
interface PageInsertPlan {
  position: number;
  /** Tie-break for plans that share a position. A plan run later lands closer
      to the anchor (its insert pushes the earlier one right), so the blank
      page runs first and the inserted PDF's pages end up directly after the
      anchor, with the blank sheet following them. */
  tie: number;
  op: string;
  run: (bytes: Uint8Array) => Promise<{ bytes: Uint8Array; inserted: number }>;
}

/** Map an "insert after original page index" (-1 = front) to a position in the
    saved output, or null when the anchor page is gone from it or was never in
    the document. */
function insertAnchorPosition(request: PdfEditRequest, afterPageIndex: number, pageCount: number): number | null {
  if (afterPageIndex === -1) return 0;
  const anchor = finalPageIndex(request, afterPageIndex);
  return anchor === null || anchor >= pageCount ? null : anchor + 1;
}

/**
 * Grow the saved output with blank pages / another PDF's pages. Content
 * streams of every page that already existed are preserved: pdf-lib only
 * splices the page tree, and copied pages are deep copies of the source.
 */
async function applyPageInserts(
  bytes: Uint8Array,
  request: PdfEditRequest,
  pageCount: number,
  skipped: PageOpFailure[],
): Promise<Uint8Array> {
  const plans: PageInsertPlan[] = [];
  for (const inserted of request.insertedPdfs ?? []) {
    const position = insertAnchorPosition(request, inserted.afterPageIndex, pageCount);
    if (position === null) {
      skipped.push({ op: "insertPdfPages", index: 0, reason: "anchor page is not in the output" });
      continue;
    }
    const source = decodePdfBase64(inserted.pdf, "insertPdfPages");
    plans.push({
      position,
      tie: 1,
      op: "insertPdfPages",
      run: async (current) => {
        const result = await insertPdfBytes(current, source, position - 1, inserted.pages);
        return { bytes: result.bytes, inserted: result.count };
      },
    });
  }
  for (const blank of request.blankPages ?? []) {
    const position = insertAnchorPosition(request, blank.afterPageIndex, pageCount);
    if (position === null) {
      skipped.push({ op: "insertBlankPage", index: 0, reason: "anchor page is not in the output" });
      continue;
    }
    const size = blank.width !== undefined && blank.height !== undefined ? ([blank.width, blank.height] as [number, number]) : undefined;
    plans.push({
      position,
      tie: 0,
      op: "insertBlankPage",
      run: async (current) => ({ bytes: (await insertBlankPageBytes(current, position - 1, size)).bytes, inserted: 1 }),
    });
  }
  let out = bytes;
  // Highest position first: an insert at a higher index never shifts a lower
  // one, so every plan keeps its base-relative position while the bytes
  // accumulate.
  for (const plan of plans.sort((a, b) => b.position - a.position || a.tie - b.tie)) {
    const result = await plan.run(out);
    out = result.bytes;
    // A source whose page subset matched nothing inserts no page: report it
    // honestly rather than counting it as applied.
    if (result.inserted === 0) skipped.push({ op: plan.op, index: 0, reason: "source selected no page to insert" });
  }
  return out;
}

/** Produce the NEW documents an extract / merge / split request asks for. The
    working bytes are only read; a producer that has nothing to emit is
    reported as a skip instead of handing back an empty document. */
async function applyDocumentProducers(
  bytes: Uint8Array,
  request: PdfEditRequest,
  skipped: PageOpFailure[],
): Promise<PdfNewDocument[]> {
  const documents: PdfNewDocument[] = [];
  if (request.extractPages) {
    const name = request.extractPages.name ?? "pages";
    const result = await extractPagesBytes(bytes, request.extractPages.pages);
    if (result.pageCount === 0) {
      skipped.push({ op: "extractPages", index: 0, reason: "no selected page exists in the output" });
    } else {
      documents.push({ op: "extractPages", name, bytes: result.bytes, pageCount: result.pageCount });
    }
  }
  if (request.mergePdfs) {
    const name = request.mergePdfs.name ?? "merged";
    const others = request.mergePdfs.pdfs.map((pdf) => decodePdfBase64(pdf, "mergePdfs"));
    const result = await mergePdfBytes(bytes, others);
    documents.push({ op: "mergePdfs", name, bytes: result.bytes, pageCount: result.pageCount });
  }
  if (request.splitPdf) {
    const stem = request.splitPdf.name ?? "split";
    const result = await splitPdfBytes(bytes, request.splitPdf.chunkSize);
    result.parts.forEach((part, index) => {
      documents.push({ op: "splitPdf", name: `${stem}-${index + 1}`, bytes: part.bytes, pageCount: part.pageCount, part: index + 1 });
    });
  }
  return documents;
}

/**
 * Apply the edit batch to the input bytes and return the verified output.
 * The input buffer is never mutated; a verify failure throws PdfVerifyError
 * and no output exists for the caller to persist.
 */
export async function applyPdfEdits(
  inputBytes: Uint8Array,
  request: PdfEditRequest,
): Promise<AppliedPdfEdit> {
  let bytes = inputBytes;
  let skippedTextEdits: TextEditFailure[] = [];
  let skippedTextInserts: TextInsertFailure[] = [];
  let skippedImageEdits: ImageEditFailure[] = [];
  let skippedAnnotDeletes: { pageIndex: number; reason: string }[] = [];
  const skippedMarkups: { pageIndex: number; reason: string }[] = [];
  const skippedDrawings: { pageIndex: number; reason: string }[] = [];
  const skippedStamps: { pageIndex: number; reason: string }[] = [];
  const skippedNotes: { pageIndex: number; reason: string }[] = [];
  const skippedNoteEdits: { pageIndex: number; reason: string }[] = [];
  const skippedNoteResolves: { pageIndex: number; reason: string }[] = [];
  const skippedPageInserts: PageOpFailure[] = [];
  const skippedNewDocuments: PageOpFailure[] = [];
  let annotDeletesApplied = 0;
  if (request.annotDeletes && request.annotDeletes.length > 0) {
    const annot = await applyAnnotDeletes(bytes, request.annotDeletes);
    bytes = annot.bytes;
    annotDeletesApplied = annot.removed;
    skippedAnnotDeletes = annot.skipped;
  }
  if (request.textEdits && request.textEdits.length > 0) {
    const applied = await applyTextEdits(bytes, request.textEdits);
    bytes = applied.bytes;
    skippedTextEdits = applied.skipped;
  }
  if (request.textInserts && request.textInserts.length > 0) {
    const applied = await applyTextInserts(bytes, request.textInserts);
    bytes = applied.bytes;
    skippedTextInserts = applied.skipped;
  }
  if (request.imageEdits && request.imageEdits.length > 0) {
    const applied = await applyImageEdits(bytes, request.imageEdits);
    bytes = applied.bytes;
    skippedImageEdits = applied.skipped;
  }
  const pdfDoc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = pdfDoc.getPages();
  for (const r of request.rotations ?? []) {
    const page = pages[r.pageIndex];
    if (page) page.setRotation(degrees((page.getRotation().angle + r.delta) % 360));
  }
  if (request.metadata) applyMetadata(pdfDoc, request.metadata);
  for (const markup of request.markups ?? []) {
    const page = pages[markup.pageIndex];
    if (!page) {
      skippedMarkups.push({ pageIndex: markup.pageIndex, reason: "page out of range" });
      continue;
    }
    addMarkup(pdfDoc, page, markup);
  }
  for (const drawing of request.drawings ?? []) {
    const page = pages[drawing.pageIndex];
    if (!page) {
      skippedDrawings.push({ pageIndex: drawing.pageIndex, reason: "page out of range" });
      continue;
    }
    addDrawing(pdfDoc, page, drawing);
  }
  for (const stamp of request.stamps ?? []) {
    try {
      await applyStamp(pdfDoc, stamp);
    } catch (error) {
      // A typed refusal (bad page, undecodable image, bad rect) is reported as
      // a skip so the rest of the batch still applies; anything else is an
      // engine failure and must reach the job's crash path.
      if (!(error instanceof PdfOpError)) throw error;
      skippedStamps.push({ pageIndex: stamp.pageIndex, reason: error.message });
    }
  }
  const noteRefs = new Map<string, PDFRef>();
  for (const note of request.notes ?? []) {
    const page = pages[note.pageIndex];
    if (!page) {
      skippedNotes.push({ pageIndex: note.pageIndex, reason: "page out of range" });
      continue;
    }
    const reason = addNote(pdfDoc, page, note, noteRefs);
    if (reason) skippedNotes.push({ pageIndex: note.pageIndex, reason });
  }
  for (const edit of request.noteEdits ?? []) {
    const page = pages[edit.pageIndex];
    if (!page) {
      skippedNoteEdits.push({ pageIndex: edit.pageIndex, reason: "page out of range" });
      continue;
    }
    const reason = editNote(pdfDoc, page, edit);
    if (reason) skippedNoteEdits.push({ pageIndex: edit.pageIndex, reason });
  }
  for (const resolve of request.noteResolves ?? []) {
    const page = pages[resolve.pageIndex];
    if (!page) {
      skippedNoteResolves.push({ pageIndex: resolve.pageIndex, reason: "page out of range" });
      continue;
    }
    const reason = resolveNote(pdfDoc, page, resolve);
    if (reason) skippedNoteResolves.push({ pageIndex: resolve.pageIndex, reason });
  }
  const skippedFormValues: { name: string; reason: string }[] = [];
  for (const formValue of request.formValues ?? []) {
    try {
      applyFormValue(pdfDoc, formValue);
    } catch (error) {
      // A typed refusal (unknown field, kind/value mismatch, unknown option) is
      // reported as a skip so the rest of the batch still applies; anything
      // else is an engine failure and must reach the job's crash path.
      if (!(error instanceof PdfOpError)) throw error;
      skippedFormValues.push({ name: formValue.name, reason: error.message });
    }
  }
  let formsFlattened = 0;
  if (request.flattenForms) formsFlattened = flattenForms(pdfDoc) ? 1 : 0;
  // Deletions go last, in descending order; earlier ops all address original
  // page indices.
  for (const idx of [...(request.deletedPages ?? [])].sort((a, b) => b - a)) {
    if (idx >= 0 && idx < pdfDoc.getPageCount() && pdfDoc.getPageCount() > 1) pdfDoc.removePage(idx);
  }
  // Reorder last: pageOrder gives the new order of surviving pages by original
  // index. pdf-lib's removePage never invalidates its page cache, so getPages()
  // here would return the stale pre-deletion list — derive survivors from the
  // pre-deletion snapshot instead.
  const order = request.pageOrder;
  if (order && order.length > 0) {
    const deletedSet = new Set(request.deletedPages ?? []);
    const target = order
      .filter((o) => !deletedSet.has(o))
      .map((o) => pages[o])
      .filter((p) => p !== undefined);
    if (target.length === pdfDoc.getPageCount()) {
      while (pdfDoc.getPageCount() > 0) pdfDoc.removePage(0);
      for (const p of target) pdfDoc.addPage(p);
    }
  }
  const out = await pdfDoc.save({ useObjectStreams: false });
  await verifyContentEdits(out, request, {
    skippedTextEdits,
    skippedTextInserts,
    skippedImageEdits,
    skippedAnnotDeletes,
    skippedMarkups,
    skippedDrawings,
    skippedStamps,
    skippedNotes,
    skippedNoteEdits,
    skippedNoteResolves,
    skippedFormValues,
    skippedPageInserts,
    skippedNewDocuments,
  });
  // Page-structure work runs after verification: inserts and producers only
  // touch the page tree, so a verified content edit can never be invalidated
  // by an index shift they introduce.
  let finalBytes = out;
  if ((request.blankPages?.length ?? 0) > 0 || (request.insertedPdfs?.length ?? 0) > 0) {
    finalBytes = await applyPageInserts(finalBytes, request, pdfDoc.getPageCount(), skippedPageInserts);
  }
  const documents = await applyDocumentProducers(finalBytes, request, skippedNewDocuments);
  return {
    bytes: finalBytes,
    skips: { skippedTextEdits, skippedTextInserts, skippedImageEdits, skippedAnnotDeletes, skippedMarkups, skippedDrawings, skippedStamps, skippedNotes, skippedNoteEdits, skippedNoteResolves, skippedFormValues, skippedPageInserts, skippedNewDocuments },
    annotDeletesApplied,
    formsFlattened,
    documents,
  };
}
