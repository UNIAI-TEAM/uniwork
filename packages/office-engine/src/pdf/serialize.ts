// The save pipeline — ported from office-upstream apps/pdf/src/main/save-pdf.ts
// (applySaveRequest + verifyContentEdits + finalPageIndex + applyMetadata),
// trimmed to the G2-05 scope: annot deletes, text edits/inserts, image ops,
// page rotation/deletion/reorder, metadata. Markup, drawing, ink and note
// annotations are kept separate from content streams; form authoring remains
// outside this lane.
//
// Ordering contract (upstream, kept exactly):
//   1. annotDeletes first — their object numbers address the on-disk bytes and
//      later pdfium rewrites may renumber objects.
//   2. Content-stream rewrites (textEdits, textInserts, imageEdits) land before
//      pdf-lib touches the bytes.
//   3. pdf-lib stage: rotations, metadata, annotations (markup/drawing/ink,
//      then notes, then saved-note edits/resolves — note edits run after the
//      note stage so same-request replies still match parents by old contents),
//      then deletions (descending), then reorder — earlier ops all address
//      original page indices.
//   4. Read-back verification against the final bytes BEFORE the caller sees
//      them: a verify failure means the output is thrown away and the original
//      bytes are never replaced.
import { PDFDocument, PDFName, degrees } from "pdf-lib";
import type { PDFRef } from "pdf-lib";

import type {
  ImageEditFailure,
  MetadataInput,
  PdfEditRequest,
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
import { addNote, editNote, resolveNote } from "./notes.ts";

export interface PdfEditSkips {
  skippedTextEdits: TextEditFailure[];
  skippedTextInserts: TextInsertFailure[];
  skippedImageEdits: ImageEditFailure[];
  /** annotDeletes that matched nothing — requested minus removed, honestly. */
  skippedAnnotDeletes: { pageIndex: number; reason: string }[];
  skippedMarkups: { pageIndex: number; reason: string }[];
  skippedDrawings: { pageIndex: number; reason: string }[];
  skippedNotes: { pageIndex: number; reason: string }[];
  skippedNoteEdits: { pageIndex: number; reason: string }[];
  skippedNoteResolves: { pageIndex: number; reason: string }[];
}

export interface AppliedPdfEdit {
  bytes: Uint8Array;
  skips: PdfEditSkips;
  /** Annotations actually removed (differs from requested when skips exist). */
  annotDeletesApplied: number;
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
  const skippedNotes: { pageIndex: number; reason: string }[] = [];
  const skippedNoteEdits: { pageIndex: number; reason: string }[] = [];
  const skippedNoteResolves: { pageIndex: number; reason: string }[] = [];
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
    skippedNotes,
    skippedNoteEdits,
    skippedNoteResolves,
  });
  return {
    bytes: out,
    skips: { skippedTextEdits, skippedTextInserts, skippedImageEdits, skippedAnnotDeletes, skippedMarkups, skippedDrawings, skippedNotes, skippedNoteEdits, skippedNoteResolves },
    annotDeletesApplied,
  };
}
