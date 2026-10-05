// Browser PDF edits: the op vocabulary the pdf-lib stage can run without Node
// (no content-stream rewrites, no Buffer-dependent producers). It parses with
// the same parsePdfOps as the Node pipeline and runs the SAME pdf-lib stage
// (src/pdf/lib-stage.ts), so a browser edit and a server edit of the same op
// produce the same document change.
import { PDFCheckBox, PDFDict, PDFDocument, PDFDropdown, PDFName, PDFOptionList, PDFRadioGroup, PDFTextField } from "pdf-lib";

import { applyNUpStage, applyPdfLibStage, planBlankPageInserts, runPageInsertPlans } from "../pdf/lib-stage.ts";
import { PdfOpError, parsePdfOps } from "../pdf/ops.ts";
import type { PageOpFailure, PdfEditRequest } from "../pdf/types.ts";

export { PdfOpError };

export interface BrowserPdfSkip {
  op: string;
  reason: string;
}

export interface BrowserPdfApplyResult {
  bytes: Uint8Array;
  skipped: BrowserPdfSkip[];
}

/** Request keys that need a content-stream rewrite or a Node-only producer. */
const UNSUPPORTED_KEYS = [
  "textEdits",
  "textInserts",
  "imageEdits",
  "annotDeletes",
  "insertedPdfs",
  "mergePdfs",
  "extractPages",
  "splitPdf",
] as const satisfies readonly (keyof PdfEditRequest)[];

export class BrowserPdfUnsupportedError extends Error {
  readonly code = "unsupported_in_browser" as const;
  readonly fields: string[];
  constructor(fields: string[]) {
    super(`pdf operations not available in the browser: ${fields.join(", ")}`);
    this.name = "BrowserPdfUnsupportedError";
    this.fields = fields;
  }
}

function pageSkips(op: string, list: { pageIndex: number; reason: string }[]): BrowserPdfSkip[] {
  return list.map((s) => ({ op, reason: `page ${s.pageIndex + 1}: ${s.reason}` }));
}

function failureSkips(list: PageOpFailure[]): BrowserPdfSkip[] {
  return list.map((s) => ({ op: s.op, reason: s.reason }));
}

/**
 * Apply an op batch to `bytes` in the browser. The input is never mutated. Ops
 * the browser cannot run are refused as a whole with BrowserPdfUnsupportedError
 * before anything is touched; malformed ops and values pdf-lib cannot encode
 * are PdfOpError.
 */
export async function applyPdfOpsInBrowser(bytes: Uint8Array, ops: readonly unknown[]): Promise<BrowserPdfApplyResult> {
  const request = parsePdfOps([...ops]);
  const unsupported = UNSUPPORTED_KEYS.filter((key) => {
    const value = request[key];
    return Array.isArray(value) ? value.length > 0 : value !== undefined;
  });
  if (unsupported.length > 0) throw new BrowserPdfUnsupportedError(unsupported);

  const stage = await applyPdfLibStage(bytes, request);
  const insertSkips: PageOpFailure[] = [];
  const plans = planBlankPageInserts(request, stage.pageCount, insertSkips);
  const withBlanks = plans.length > 0 ? await runPageInsertPlans(stage.bytes, plans, insertSkips) : stage.bytes;
  const nUpSkips: PageOpFailure[] = [];
  const nUp = await applyNUpStage(withBlanks, request, nUpSkips);

  const s = stage.skips;
  return {
    bytes: nUp.bytes,
    skipped: [
      ...pageSkips("addMarkup", s.skippedMarkups),
      ...pageSkips("addDrawing", s.skippedDrawings),
      ...pageSkips("addStamp", s.skippedStamps),
      ...pageSkips("addNote", s.skippedNotes),
      ...pageSkips("editSavedNote", s.skippedNoteEdits),
      ...pageSkips("resolveNote", s.skippedNoteResolves),
      ...s.skippedFormValues.map((f) => ({ op: "setFormValue", reason: `${f.name}: ${f.reason}` })),
      ...failureSkips(s.skippedPageBoxes),
      ...failureSkips(insertSkips),
      ...failureSkips(nUpSkips),
    ],
  };
}

export interface BrowserPdfFormField {
  name: string;
  kind: "text" | "checkbox" | "radio" | "choice";
  value?: string | boolean;
  options?: { value: string; label: string }[];
  readOnly?: boolean;
}

/** AcroForm fields of `bytes`; [] when the document has no AcroForm (getForm()
    would create an empty one, so the catalog is probed first). */
export async function readPdfFormFields(bytes: Uint8Array): Promise<BrowserPdfFormField[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  if (doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict) === undefined) return [];
  const out: BrowserPdfFormField[] = [];
  for (const field of doc.getForm().getFields()) {
    const name = field.getName();
    const readOnly = field.isReadOnly();
    if (field instanceof PDFTextField) {
      out.push({ name, kind: "text", value: field.getText() ?? "", readOnly });
    } else if (field instanceof PDFCheckBox) {
      out.push({ name, kind: "checkbox", value: field.isChecked(), readOnly });
    } else if (field instanceof PDFRadioGroup) {
      const options = field.getOptions().map((o) => ({ value: o, label: o }));
      out.push({ name, kind: "radio", value: field.getSelected() ?? "", options, readOnly });
    } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      const options = field.getOptions().map((o) => ({ value: o, label: o }));
      out.push({ name, kind: "choice", value: field.getSelected()[0] ?? "", options, readOnly });
    }
  }
  return out;
}
