// The save pipeline — ported from office-upstream apps/pdf/src/main/save-pdf.ts
// (applySaveRequest + verifyContentEdits + finalPageIndex + applyMetadata),
// trimmed to the G2-05 scope: annot deletes, text edits/inserts, image ops,
// page rotation/deletion/reorder, metadata. Markup, drawing, ink and note
// annotations are kept separate from content streams; AcroForm field values and
// flattening are applied in the pdf-lib stage. Image / signature stamps (B6) draw straight into the
// target page's content stream, so they need no annotation and are applied in
// the pdf-lib stage.
//
// Ordering contract (upstream, kept exactly):
//   1. annotDeletes first — their object numbers address the on-disk bytes and
//      later pdfium rewrites may renumber objects.
//   2. Content-stream rewrites (textEdits, textInserts, imageEdits) land before
//      pdf-lib touches the bytes.
//   3. pdf-lib stage: rotations, metadata, stamps, annotations (markup/drawing/
//      ink, then notes, then saved-note edits/resolves, then form values + flatten
//      — note edits run after
//      the note stage so same-request replies still match parents by old
//      contents), then deletions (descending), then reorder — earlier ops all
//      address original page indices.
//   4. Read-back verification against the final bytes BEFORE the caller sees
//      them: a verify failure means the output is thrown away and the original
//      bytes are never replaced.
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
import { finalPageIndex, applyNUpStage, applyPdfLibStage, planBlankPageInserts, runPageInsertPlans, insertAnchorPosition, type PageInsertPlan } from "./lib-stage.ts";
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
  /** MediaBox / CropBox writes refused at apply time (page out of range). */
  skippedPageBoxes: PageOpFailure[];
  /** An N-up imposition refused at apply time (page out of range). */
  skippedNUp: PageOpFailure[];
}

export interface AppliedPdfEdit {
  bytes: Uint8Array;
  skips: PdfEditSkips;
  /** Annotations actually removed (differs from requested when skips exist). */
  annotDeletesApplied: number;
  /** 1 when the interactive form was flattened, 0 when there was none. */
  formsFlattened: number;
  /** Page boxes actually set (differs from requested when skips exist). */
  pageBoxesApplied: number;
  /** 1 when an N-up imposition produced sheets, 0 otherwise. */
  nUpApplied: number;
  /** NEW documents produced by extract / merge / split. F2: the caller commits
      each one through Documents; the engine never writes them anywhere. */
  documents: PdfNewDocument[];
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
  plans.push(...planBlankPageInserts(request, pageCount, skipped));
  return runPageInsertPlans(bytes, plans, skipped);
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
  const skippedPageInserts: PageOpFailure[] = [];
  const skippedNewDocuments: PageOpFailure[] = [];
  const skippedNUp: PageOpFailure[] = [];
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
  const libStage = await applyPdfLibStage(bytes, request);
  const out = libStage.bytes;
  const {
    skippedMarkups,
    skippedDrawings,
    skippedStamps,
    skippedNotes,
    skippedNoteEdits,
    skippedNoteResolves,
    skippedFormValues,
    skippedPageBoxes,
  } = libStage.skips;
  const { formsFlattened, pageBoxesApplied } = libStage;
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
    skippedPageBoxes,
    skippedNUp,
  });
  // Page-structure work runs after verification: inserts and producers only
  // touch the page tree, so a verified content edit can never be invalidated
  // by an index shift they introduce.
  let finalBytes = out;
  if ((request.blankPages?.length ?? 0) > 0 || (request.insertedPdfs?.length ?? 0) > 0) {
    finalBytes = await applyPageInserts(finalBytes, request, libStage.pageCount, skippedPageInserts);
  }
  const nUp = await applyNUpStage(finalBytes, request, skippedNUp);
  finalBytes = nUp.bytes;
  const documents = await applyDocumentProducers(finalBytes, request, skippedNewDocuments);
  return {
    bytes: finalBytes,
    skips: { skippedTextEdits, skippedTextInserts, skippedImageEdits, skippedAnnotDeletes, skippedMarkups, skippedDrawings, skippedStamps, skippedNotes, skippedNoteEdits, skippedNoteResolves, skippedFormValues, skippedPageInserts, skippedNewDocuments, skippedPageBoxes, skippedNUp },
    annotDeletesApplied,
    formsFlattened,
    pageBoxesApplied,
    nUpApplied: nUp.applied,
    documents,
  };
}
