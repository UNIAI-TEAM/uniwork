// The pdf-lib stage of the save pipeline, shared by the Node pipeline
// (serialize.ts) and the browser apply (src/browser/pdf.ts). Nothing here may
// reach a node:* module or pdfium: it is part of the browser graph.
//
// Ordering contract (upstream, kept exactly): rotations, metadata, page boxes,
// markups, drawings, stamps, notes, note edits, note resolves, form values,
// flatten, deletions (descending), reorder — all addressing original page
// indices. Blank-page inserts and N-up run afterwards on the saved bytes.
import { PDFDocument, degrees } from "pdf-lib";
import type { PDFRef } from "pdf-lib";

import type { MetadataInput, PageOpFailure, PdfEditRequest } from "./types.ts";
import { addMarkup } from "./markups.ts";
import { addDrawing } from "./drawings.ts";
import { applyStamp } from "./stamps.ts";
import { addNote, editNote, resolveNote } from "./notes.ts";
import { applyFormValue, flattenForms } from "./forms.ts";
import { PdfOpError } from "./op-parse.ts";
import { insertBlankPageBytes } from "./page-ops.ts";
import { setNUp, setPageBox } from "./page-box.ts";

interface PageSkip {
  pageIndex: number;
  reason: string;
}

/** Skips produced by the pdf-lib stage itself. */
interface PdfLibStageSkips {
  skippedMarkups: PageSkip[];
  skippedDrawings: PageSkip[];
  skippedStamps: PageSkip[];
  skippedNotes: PageSkip[];
  skippedNoteEdits: PageSkip[];
  skippedNoteResolves: PageSkip[];
  skippedFormValues: { name: string; reason: string }[];
  skippedPageBoxes: PageOpFailure[];
}

interface PdfLibStageResult {
  bytes: Uint8Array;
  skips: PdfLibStageSkips;
  /** 1 when the interactive form was flattened, 0 when there was none. */
  formsFlattened: number;
  /** Page boxes actually set. */
  pageBoxesApplied: number;
  /** Page count of the saved output (after deletions / reorder). */
  pageCount: number;
}

/** Original page index → index in the saved file (after deletions/reorder);
    null = the page is gone from the output */
export function finalPageIndex(request: PdfEditRequest, p: number): number | null {
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
 * Run the pdf-lib stage on `bytes`. The input is never mutated. A value pdf-lib
 * cannot encode while saving (WinAnsi appearance update) is a typed
 * PdfOpError("setFormValue", "value", ...), never a bare Error.
 */
export async function applyPdfLibStage(bytes: Uint8Array, request: PdfEditRequest): Promise<PdfLibStageResult> {
  const pdfDoc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = pdfDoc.getPages();
  const skippedMarkups: PageSkip[] = [];
  const skippedDrawings: PageSkip[] = [];
  const skippedStamps: PageSkip[] = [];
  const skippedNotes: PageSkip[] = [];
  const skippedNoteEdits: PageSkip[] = [];
  const skippedNoteResolves: PageSkip[] = [];
  const skippedPageBoxes: PageOpFailure[] = [];
  const skippedFormValues: { name: string; reason: string }[] = [];
  for (const r of request.rotations ?? []) {
    const page = pages[r.pageIndex];
    if (page) page.setRotation(degrees((page.getRotation().angle + r.delta) % 360));
  }
  if (request.metadata) applyMetadata(pdfDoc, request.metadata);
  // MediaBox / CropBox writes address original page indices, so they run here
  // beside the other index-addressed ops, before deletion/reorder. A typed
  // refusal (an index outside the document) is reported as a skip so the rest
  // of the batch still applies.
  let pageBoxesApplied = 0;
  for (const box of request.pageBoxes ?? []) {
    try {
      pageBoxesApplied += setPageBox(pdfDoc, box).applied;
    } catch (error) {
      if (!(error instanceof PdfOpError)) throw error;
      skippedPageBoxes.push({ op: "setPageBox", index: 0, reason: error.message });
    }
  }
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
  let out: Uint8Array;
  try {
    out = await pdfDoc.save({ useObjectStreams: false });
  } catch (error) {
    // A field the engine did not write can carry a value pdf-lib's WinAnsi
    // appearance update cannot encode; contain that as a typed refusal rather
    // than letting a bare Error escape as an engine crash.
    if (error instanceof Error && /cannot encode/i.test(error.message)) {
      throw new PdfOpError("setFormValue", "value", error.message, false);
    }
    throw error;
  }
  return {
    bytes: out,
    skips: { skippedMarkups, skippedDrawings, skippedStamps, skippedNotes, skippedNoteEdits, skippedNoteResolves, skippedFormValues, skippedPageBoxes },
    formsFlattened,
    pageBoxesApplied,
    pageCount: pdfDoc.getPageCount(),
  };
}

/** One page insert to run after the pdf-lib stage. `position` is an index in
    the output document (post deletion/reorder); the plan is executed highest
    position first so an earlier insert never shifts a later one. */
export interface PageInsertPlan {
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
export function insertAnchorPosition(request: PdfEditRequest, afterPageIndex: number, pageCount: number): number | null {
  if (afterPageIndex === -1) return 0;
  const anchor = finalPageIndex(request, afterPageIndex);
  return anchor === null || anchor >= pageCount ? null : anchor + 1;
}

/** Plans for the blank pages of a request; an unusable anchor is a skip. */
export function planBlankPageInserts(request: PdfEditRequest, pageCount: number, skipped: PageOpFailure[]): PageInsertPlan[] {
  const plans: PageInsertPlan[] = [];
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
  return plans;
}

/** Run the plans highest position first: an insert at a higher index never
    shifts a lower one, so every plan keeps its base-relative position while
    the bytes accumulate. */
export async function runPageInsertPlans(bytes: Uint8Array, plans: PageInsertPlan[], skipped: PageOpFailure[]): Promise<Uint8Array> {
  let out = bytes;
  for (const plan of [...plans].sort((a, b) => b.position - a.position || a.tie - b.tie)) {
    const result = await plan.run(out);
    out = result.bytes;
    // A source whose page subset matched nothing inserts no page: report it
    // honestly rather than counting it as applied.
    if (result.inserted === 0) skipped.push({ op: plan.op, index: 0, reason: "source selected no page to insert" });
  }
  return out;
}

/**
 * Impose the page tree into N-up sheets. Runs on the verified bytes as a
 * page-tree-only transform: it replaces every page, so it is applied after
 * content verification and after the inserts, and its page indices address the
 * output document.
 */
export async function applyNUpStage(
  bytes: Uint8Array,
  request: PdfEditRequest,
  skipped: PageOpFailure[],
): Promise<{ bytes: Uint8Array; applied: number }> {
  if (!request.nUp) return { bytes, applied: 0 };
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  try {
    const result = await setNUp(doc, request.nUp);
    return { bytes: await doc.save({ useObjectStreams: false }), applied: result.sheets > 0 ? 1 : 0 };
  } catch (error) {
    if (!(error instanceof PdfOpError)) throw error;
    skipped.push({ op: "setNUp", index: 0, reason: error.message });
    return { bytes, applied: 0 };
  }
}
