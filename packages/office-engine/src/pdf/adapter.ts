// Service-side adapter seam for the G2-05 pdf lane. The worker handlers call
// exactly three entries — probePdf (open), applyPdfEditBytes (edit) — and every
// failure leaves here as a PdfTypedError whose code is one of the worker's
// closed outcome codes; nothing below this file throws a bare Error across
// the handler boundary. The input buffer is never mutated and a failed edit
// produces no output bytes — the caller keeps the original.
import { EncryptedPDFError, PDFDocument } from "pdf-lib";

import { readPdfText } from "./extract.ts";
import { parsePdfOps, PdfOpError } from "./ops.ts";
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

const ENCRYPT_MARKER = /\/Encrypt[\s[</]/;

function sniffHeader(input: Uint8Array): void {
  // Some producers emit a BOM or junk before the header; PDFium tolerates a
  // small lead-in, so scan the first KiB rather than demanding offset 0.
  const head = input.subarray(0, Math.min(input.length, 1024));
  const marker = Buffer.from(head).indexOf(PDF_MAGIC);
  if (marker < 0) {
    throw new PdfTypedError("engine_result_invalid", "not_a_pdf");
  }
  // Encryption lives in the trailer's /Encrypt entry, which is never itself
  // encrypted — a raw byte sniff catches password/cert files that pdf-lib's
  // xref parser can only report as corrupt. This build has no password path.
  const latin = Buffer.from(input.subarray(0, Math.min(input.length, 4 << 20))).toString("latin1");
  if (ENCRYPT_MARKER.test(latin)) {
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
    annotDeletes: number;
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
      const unsupported = error.message.endsWith("unknown op for pdf") || error.message.includes("ocr is not a capability");
      throw new PdfTypedError(unsupported ? "unsupported_operation" : "engine_result_invalid", "bad_op:" + error.message);
    }
    if (error instanceof PdfVerifyError) {
      throw new PdfTypedError("engine_result_invalid", "verify_failed:" + error.message.slice(0, 200));
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
        annotDeletes: request.annotDeletes?.length ?? 0,
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
