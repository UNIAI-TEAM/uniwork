// Service-side adapter seam for the G2-05 pdf lane. The worker handlers call
// exactly three entries — probePdf (open), applyPdfEditBytes (edit) — and every
// failure leaves here as a PdfTypedError whose code is one of the worker's
// closed outcome codes; nothing below this file throws a bare Error across
// the handler boundary. The input buffer is never mutated and a failed edit
// produces no output bytes — the caller keeps the original.
import { EncryptedPDFError, PDFDocument } from "pdf-lib";

import { ImageTooLargeError } from "./codec.ts";
import { readPdfText } from "./extract.ts";
import { parsePdfOps, PdfOpError } from "./ops.ts";
import { FPDF_ERR_PASSWORD, PdfOpenError } from "./pdfium.ts";
import { applyPdfEdits, PdfVerifyError } from "./serialize.ts";
import type { PdfEditRequest } from "./types.ts";

export type PdfFailureCode = "engine_result_invalid" | "unsupported_operation" | "engine_crashed";

/** Typed refusal/failure the worker maps to its outcome code 1:1. */
export class PdfTypedError extends Error {
  readonly code: PdfFailureCode;
  readonly reason: string;
  constructor(code: PdfFailureCode, reason: string) {
    super(reason);
    this.name = "PdfTypedError";
    this.code = code;
    this.reason = reason;
  }
}

const PDF_MAGIC = "%PDF-";

const ENCRYPT_KEY = /\/Encrypt\b/;
const TRAILER_DICT = /\btrailer\s*<</g;
const XREF_DICT = /\/Type\s*\/XRef/g;

/**
 * Whether the tail of the file marks the document encrypted. /Encrypt is only
 * meaningful in the trailer dictionary (or an xref-stream dict), both of which
 * live at the end beside the final startxref — so this scans only the last
 * window and only inside `trailer << … startxref` / `obj … /Type /XRef …
 * stream` spans (bounded by keywords, not `>>`, since both can nest dicts).
 * A mention inside a content stream, a comment or an embedded file proves
 * nothing and must not refuse an ordinary PDF. pdf-lib's EncryptedPDFError
 * still covers whatever this misses.
 */
const TAIL_WINDOW = 256 * 1024;

function trailerEncrypted(input: Uint8Array): boolean {
  const tail = Buffer.from(input.subarray(Math.max(0, input.length - TAIL_WINDOW))).toString("latin1");
  const lastStartXref = tail.lastIndexOf("startxref");
  if (lastStartXref < 0) return false;
  const before = tail.slice(0, lastStartXref);
  // Classic trailer: only the trailer dict sits between `trailer <<` and
  // startxref, so test the whole remainder rather than guessing dict nesting.
  let m: RegExpExecArray | null;
  let trStart = -1;
  TRAILER_DICT.lastIndex = 0;
  while ((m = TRAILER_DICT.exec(before)) !== null) trStart = m.index;
  if (trStart >= 0 && ENCRYPT_KEY.test(before.slice(trStart))) return true;
  // XRef stream: the dict carrying /Type /XRef runs from the object's `obj`
  // keyword to its `stream` keyword; /Encrypt may precede /Type in the dict.
  XREF_DICT.lastIndex = 0;
  while ((m = XREF_DICT.exec(before)) !== null) {
    const objStart = before.lastIndexOf("obj", m.index);
    const streamStart = before.indexOf("stream", m.index);
    if (objStart < 0 || streamStart < 0) continue;
    if (ENCRYPT_KEY.test(before.slice(objStart, streamStart))) return true;
  }
  return false;
}

function sniffHeader(input: Uint8Array): void {
  // Some producers emit a BOM or junk before the header; PDFium tolerates a
  // small lead-in, so scan the first KiB rather than demanding offset 0.
  const head = input.subarray(0, Math.min(input.length, 1024));
  const marker = Buffer.from(head).indexOf(PDF_MAGIC);
  if (marker < 0) {
    throw new PdfTypedError("engine_result_invalid", "not_a_pdf");
  }
  // Encryption lives in the trailer's /Encrypt entry, which is never itself
  // encrypted — a trailer sniff catches password/cert files that pdf-lib's
  // xref parser can only report as corrupt. This build has no password path.
  if (trailerEncrypted(input)) {
    throw new PdfTypedError("engine_result_invalid", "encrypted_pdf");
  }
}

/**
 * Pre-flight with pdf-lib: cheap compared to the pdfium load, and its error
 * surface carries the distinctions the adapter must report — encrypted bytes
 * (typed refusal; this build has no password path) vs. bytes that merely look
 * like a PDF but are corrupt.
 */
async function preflight(input: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(input, { updateMetadata: false });
  } catch (error) {
    if (error instanceof EncryptedPDFError) {
      throw new PdfTypedError("engine_result_invalid", "encrypted_pdf");
    }
    throw new PdfTypedError("engine_result_invalid", "corrupt_pdf");
  }
}

export interface PdfEditOutcome {
  bytes: Uint8Array;
  warnings: { code: string; detail?: string }[];
  /** what was applied vs. skipped — lands in the job report, not the output */
  report: {
    textEdits: { applied: number; skipped: number };
    textInserts: { applied: number; skipped: number };
    imageEdits: { applied: number; skipped: number };
    annotDeletes: { applied: number; skipped: number };
    markups: { applied: number; skipped: number };
    drawings: { applied: number; skipped: number };
    pageOps: { rotations: number; deletions: number; reordered: boolean; metadata: boolean };
  };
}

export interface PdfProbe {
  pageCount: number;
  info: { title?: string; author?: string };
  hasTextLayer: boolean;
  /** 1-based pages whose text layer is empty (scanned / image-only) */
  emptyTextPages: number[];
  features: {
    textEdit: true;
    imageEdit: true;
    pageOps: true;
    annotationDelete: true;
    drawing: true;
    ink: true;
    ocr: false;
    ocrReason: string;
  };
}

const OCR_REASON =
  "OCR is deferred past M1 (Q2-A): no optical engine runs inside this service, " +
  "and overlay annotations do not satisfy the text-edit requirement";

function typed<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((error: unknown) => {
    if (error instanceof PdfTypedError) throw error;
    if (error instanceof PdfOpError) {
      throw new PdfTypedError(error.unsupported ? "unsupported_operation" : "engine_result_invalid", "bad_op:" + error.message);
    }
    if (error instanceof PdfVerifyError) {
      throw new PdfTypedError("engine_result_invalid", "verify_failed:" + error.message.slice(0, 200));
    }
    if (error instanceof ImageTooLargeError) {
      // Fixed-size refusal string — no pixel dims come from a bigger error path.
      throw new PdfTypedError("engine_result_invalid", "image_too_large");
    }
    if (error instanceof PdfOpenError) {
      // A document pdfium could not open: a password wall is an encrypted
      // refusal, every other load failure is corruption — both typed, both
      // keep the original bytes. A heap failure is engine-side: rethrow.
      if (error.detail === "heap") throw error;
      throw new PdfTypedError(
        "engine_result_invalid",
        error.detail === FPDF_ERR_PASSWORD ? "encrypted_pdf" : "corrupt_pdf",
      );
    }
    // Anything else from pdfium/pdf-lib is an engine failure, not a caller
    // fault — but keep the raw message out of the payload (it can carry
    // filenames/heap detail) and let the job's crash path own it.
    throw error;
  });
}

/**
 * `open:pdf` — probe the bytes into a document model summary. Output is a
 * JSON document (the host's open-outcome payload), never the input bytes.
 */
export async function probePdf(input: Uint8Array): Promise<PdfProbe> {
  return typed(async () => {
    sniffHeader(input);
    const doc = await preflight(input);
    const pageCount = doc.getPageCount();
    const text = await readPdfText(input);
    const emptyTextPages = text.pages.filter((p) => !p.hasTextLayer).map((p) => p.page);
    return {
      pageCount,
      info: text.info,
      hasTextLayer: text.pages.some((p) => p.hasTextLayer),
      emptyTextPages,
      features: {
        textEdit: true,
        imageEdit: true,
        pageOps: true,
        annotationDelete: true,
        drawing: true,
        ink: true,
        ocr: false,
        ocrReason: OCR_REASON,
      },
    };
  });
}

/**
 * `edit:pdf` — parse the edits payload (already schema-validated at the
 * envelope), apply the batch, and return the verified output bytes. Throws
 * PdfTypedError for every refusal; a PdfVerifyError means the output was
 * thrown away before this call returned.
 */
export async function applyPdfEditBytes(
  input: Uint8Array,
  edits: unknown[],
): Promise<PdfEditOutcome> {
  return typed(async () => {
    sniffHeader(input);
    await preflight(input);
    const request: PdfEditRequest = parsePdfOps(edits);
    const applied = await applyPdfEdits(input, request);
    const warnings: { code: string; detail?: string }[] = [];
    const pushSkips = (kind: string, list: { pageIndex: number; reason: string }[]) => {
      for (const s of list) {
        warnings.push({ code: "edit_skipped", detail: `${kind} page=${s.pageIndex + 1}: ${s.reason}` });
      }
    };
    pushSkips("text", applied.skips.skippedTextEdits);
    pushSkips("insert", applied.skips.skippedTextInserts);
    pushSkips("image", applied.skips.skippedImageEdits);
    pushSkips("annot", applied.skips.skippedAnnotDeletes);
    pushSkips("markup", applied.skips.skippedMarkups);
    pushSkips("drawing", applied.skips.skippedDrawings);
    return {
      bytes: applied.bytes,
      warnings,
      report: {
        textEdits: {
          applied: (request.textEdits?.length ?? 0) - applied.skips.skippedTextEdits.length,
          skipped: applied.skips.skippedTextEdits.length,
        },
        textInserts: {
          applied: (request.textInserts?.length ?? 0) - applied.skips.skippedTextInserts.length,
          skipped: applied.skips.skippedTextInserts.length,
        },
        imageEdits: {
          applied: (request.imageEdits?.length ?? 0) - applied.skips.skippedImageEdits.length,
          skipped: applied.skips.skippedImageEdits.length,
        },
        annotDeletes: { applied: applied.annotDeletesApplied, skipped: applied.skips.skippedAnnotDeletes.length },
        markups: { applied: (request.markups?.length ?? 0) - applied.skips.skippedMarkups.length, skipped: applied.skips.skippedMarkups.length },
        drawings: { applied: (request.drawings?.length ?? 0) - applied.skips.skippedDrawings.length, skipped: applied.skips.skippedDrawings.length },
        pageOps: {
          rotations: request.rotations?.length ?? 0,
          deletions: request.deletedPages?.length ?? 0,
          reordered: request.pageOrder !== undefined,
          metadata: request.metadata !== undefined,
        },
      },
    };
  });
}
