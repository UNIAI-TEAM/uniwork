// Capability rows this service build reports. Honest by construction: a row is
// supported only when a handler is bound and the format lane has produced the
// evidence required for a product claim. G2-07b proves the Q7 converters; the
// XLSX open/edit/serialize loop (native recalc, save/reopen, the saved-package
// oracle) was proven against this engine path, which stays after the browser
// editor that drove it was removed (UNI-1240).

import {
  ENGINE_JOB_TRANSPORT,
  ENGINE_VERSION_TRUSTED,
  grantableOperations,
  type CapabilityEntry,
  type OfficeFormat,
} from "@uniwork/office-contracts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BOUND_OPERATIONS } from "./worker/handlers.ts";

/** Source formats whose conversion is bound, and the target each produces
    (docs/office/g1g2/q7-blocker.md closing test; G2-07b fixtures). */
const CONVERT_TARGETS: Partial<Record<OfficeFormat, "xlsx" | "docx">> = {
  xls: "xlsx",
  odt: "docx",
};

/** Source formats whose export is bound, and their targets (UNI-1013: docx ->
    pdf through the Docs web renderer, docs/office/pdf-export-decision.md;
    UNI-2004: a UniNote page -> docx, and -> pdf through the same renderer). */
const EXPORT_TARGETS: Partial<Record<OfficeFormat, string>> = {
  docx: "pdf",
  page: "docx, pdf",
};

/** Bound operations with a completed format-lane product evidence packet.
 *
 * Keep this separate from `BOUND_OPERATIONS`: a handler being present is an
 * engine fact, while `evidence_level=proven` is the product-facing contract
 * consumed by the Documents capability endpoint. Other formats remain
 * pending until their own real loop and oracle are complete.
 */
const PROVEN_BOUND_OPERATIONS: Partial<Record<OfficeFormat, ReadonlySet<string>>> = {
  xlsx: new Set(["open", "edit", "serialize"]),
};

export function isBound(operation: string, format: string): boolean {
  return BOUND_OPERATIONS.includes(operation + ":" + format);
}

/** Format-level feature rows that are not engine operations but the matrix
    still expects an honest answer for. Today only pdf's OCR refusal: upstream
    defers OCR past M1 (Q2-A) and this service deliberately binds no optical
    engine — the row is proven-unsupported, not pending. */
const FEATURE_ROWS: Partial<Record<OfficeFormat, CapabilityEntry[]>> = {
  pdf: [
    {
      operation: "ocr",
      supported: false,
      runtime: "none",
      evidence_level: "proven",
      reason:
        "OCR deferred past M1 (Q2-A): no optical engine runs inside this service and overlay annotations do not satisfy the text-edit requirement",
    },
  ],
};

/** Formats whose export reaches pdf through the Docs renderer (renderPdf). */
const PDF_VIA_DOCS: ReadonlySet<OfficeFormat> = new Set<OfficeFormat>(["docx", "page"]);

/** Why the Docs PDF renderer cannot run here, or null when it can: the
    staged `bundle/index.html` and `chromium` under UNIWORK_DOCS_PDF_ASSETS,
    and the per-slot uid sandbox renderPdf refuses to run without. */
export function docsPdfRendererMissing(dir: string | undefined, sandboxed: boolean): string | null {
  if (!dir || !existsSync(join(dir, "bundle", "index.html")) || !existsSync(join(dir, "chromium"))) return "docs_pdf_assets_missing";
  return sandboxed ? null : "sandbox_required";
}

/** follow-6: the pdf lane as its own row, so a caller can offer pdf only where
    the renderer is staged instead of learning it from the first 409. */
function exportPdfRow(missing: string | null): CapabilityEntry {
  return missing === null
    ? { operation: "export_pdf", supported: true, runtime: "internal_service", evidence_level: "pending", reason: "Docs web renderer staged (bundle + chromium) under the uid sandbox" }
    : { operation: "export_pdf", supported: false, runtime: "none", evidence_level: "pending", reason: missing };
}

function capabilityRows(format: OfficeFormat, pdfMissing: string | null): CapabilityEntry[] {
  const ops = grantableOperations
    .filter((op) => op !== "capability")
    .map((op): CapabilityEntry => {
      if (op === "convert") {
        const target = CONVERT_TARGETS[format];
        if (target && isBound(op, format)) {
          return {
            operation: op,
            supported: true,
            runtime: "internal_service",
            evidence_level: "proven",
            reason: `Q7 converter bound: ${format} -> ${target} (docs/office/g1g2/q7-blocker.md closing test; G2-07b fixture evidence)`,
          };
        }
        return {
          operation: op,
          supported: false,
          runtime: "none",
          evidence_level: "pending",
          reason: target
            ? `no ${format} -> ${target} converter is bound in this service build`
            : `no Q7 converter is bound from ${format}`,
        };
      }
      if (op === "export") {
        const target = EXPORT_TARGETS[format];
        if (target && isBound(op, format)) {
          return {
            operation: op,
            supported: true,
            runtime: "internal_service",
            evidence_level: "pending",
            reason: `${format} -> ${target}; pdf through the pinned Docs web renderer in headless Chromium (UNI-1013 prototype; needs the staged renderer assets)`,
          };
        }
        return { operation: op, supported: false, runtime: "none", evidence_level: "pending", reason: "no export is bound for this format in this service build" };
      }
      if (op === "extract_text") {
        if ((format === "docx" || format === "xlsx" || format === "pptx") && isBound(op, format)) {
          return {
            operation: op,
            supported: true,
            runtime: "internal_service",
            evidence_level: "pending",
            reason: `selective ${format} text reader bound in the engine service; product evidence packet pending`,
          };
        }
        return { operation: op, supported: false, runtime: "none", evidence_level: "pending", reason: "no text extractor is bound for this format in this service build" };
      }
      if (isBound(op, format)) {
        const proven = PROVEN_BOUND_OPERATIONS[format]?.has(op) === true;
        return {
          operation: op,
          supported: true,
          runtime: "internal_service",
          evidence_level: proven ? "proven" : "pending",
          reason: proven
            ? "real-loop evidence: gateway snapshot open, native edit/recalc, save/reopen, and preserved-part oracle"
            : "bound in the engine service; product evidence belongs to the format lane",
        };
      }
      return { operation: op, supported: false, runtime: "none", evidence_level: "pending", reason: "not bound in this service build" };
    });
  const pdf = PDF_VIA_DOCS.has(format) && isBound("export", format) ? [exportPdfRow(pdfMissing)] : [];
  return [...ops, ...pdf, ...(FEATURE_ROWS[format] ?? [])];
}

/** `pdfMissing` is docsPdfRendererMissing's answer for this process. */
export function capabilityResult(format: OfficeFormat, maxInputBytes: number, pdfMissing: string | null): Record<string, unknown> {
  return {
    job_id: "capability-" + format,
    state: "completed",
    operation: "capability",
    engine_version: ENGINE_VERSION_TRUSTED,
    job_transport: ENGINE_JOB_TRANSPORT,
    format,
    capabilities: capabilityRows(format, pdfMissing),
    limits: { max_input_bytes: maxInputBytes },
  };
}
