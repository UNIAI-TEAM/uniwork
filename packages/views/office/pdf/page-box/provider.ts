import type { useTranslation } from "react-i18next";
import type {
  PdfPageBoxEngineOperation,
  PdfPageBoxKind,
  PdfPageBoxLayout,
  PdfPageBoxOperationProvider,
  PdfPageBoxOperationSubmitter,
  PdfPageBoxPaper,
  PdfPageBoxRect,
  PdfPageBoxSetNUpInput,
  PdfPageBoxSetPageBoxInput,
} from "./types";

/** Why a page-box request was refused before it reached the host. */
type PdfPageBoxProviderErrorCode = "invalid_input" | "unsupported_layout";

export class PdfPageBoxProviderError extends Error {
  readonly code: PdfPageBoxProviderErrorCode;
  readonly operation: string;

  constructor(code: PdfPageBoxProviderErrorCode, operation: string, message: string) {
    super(message);
    this.name = "PdfPageBoxProviderError";
    this.code = code;
    this.operation = operation;
  }
}

/** The engine's N-up imposition places 2–16 pages on one sheet; anything
    outside that range has no sheet grid the renderer can lay out. */
export const MIN_NUP_PAGES_PER_SHEET = 2;
export const MAX_NUP_PAGES_PER_SHEET = 16;

const BOXES: readonly PdfPageBoxKind[] = ["media", "crop"];
const PAPERS: readonly PdfPageBoxPaper[] = ["a4", "letter"];

/** 1-based displayed page numbers, deduped in the caller's order. An empty
    selection would silently do nothing, so it is refused instead. */
function pages(value: readonly number[], operation: string): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new PdfPageBoxProviderError("invalid_input", operation, "at least one page is required");
  }
  const unique: number[] = [];
  for (const page of value) {
    if (!Number.isSafeInteger(page) || page < 1) {
      throw new PdfPageBoxProviderError("invalid_input", operation, "pages must be positive whole numbers");
    }
    if (!unique.includes(page)) unique.push(page);
  }
  return unique;
}

/** PDF points, `[left, bottom, right, top]`. A zero or inverted box would clip
    the page to nothing, so both extents must be positive. */
function rect(value: PdfPageBoxRect, operation: string): PdfPageBoxRect {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite)) {
    throw new PdfPageBoxProviderError("invalid_input", operation, "rect must be four finite points");
  }
  const [left, bottom, right, top] = value as PdfPageBoxRect;
  if (right <= left || top <= bottom) {
    throw new PdfPageBoxProviderError("invalid_input", operation, "rect must have a positive width and height");
  }
  return [left, bottom, right, top];
}

function box(value: PdfPageBoxKind, operation: string): PdfPageBoxKind {
  if (!BOXES.includes(value)) {
    throw new PdfPageBoxProviderError("invalid_input", operation, `unsupported page box: ${String(value)}`);
  }
  return value;
}

function layout(value: PdfPageBoxLayout | undefined, operation: string): PdfPageBoxLayout {
  const rows = value?.rows;
  const cols = value?.cols;
  if (typeof rows !== "number" || typeof cols !== "number" || !Number.isSafeInteger(rows) || !Number.isSafeInteger(cols) || rows < 1 || cols < 1) {
    throw new PdfPageBoxProviderError("unsupported_layout", operation, "layout needs a whole row and column count ≥ 1");
  }
  const perSheet = rows * cols;
  if (perSheet < MIN_NUP_PAGES_PER_SHEET || perSheet > MAX_NUP_PAGES_PER_SHEET) {
    throw new PdfPageBoxProviderError(
      "unsupported_layout",
      operation,
      `N-up needs between ${MIN_NUP_PAGES_PER_SHEET} and ${MAX_NUP_PAGES_PER_SHEET} pages per sheet`,
    );
  }
  return { rows, cols };
}

function paper(value: PdfPageBoxPaper | undefined, operation: string): PdfPageBoxPaper | undefined {
  if (value === undefined) return undefined;
  if (!PAPERS.includes(value)) {
    throw new PdfPageBoxProviderError("invalid_input", operation, `unsupported paper size: ${String(value)}`);
  }
  return value;
}

/** Browser-safe page-box provider. Every call validates, then submits exactly
    one typed envelope; the view never serializes and the engine is not
    imported here. */
export function createPdfPageBoxOperationProvider(submitter: PdfPageBoxOperationSubmitter): PdfPageBoxOperationProvider {
  return {
    async setPageBox(input: PdfPageBoxSetPageBoxInput) {
      const operation: PdfPageBoxEngineOperation = {
        op: "setPageBox",
        pages: pages(input.pages, "setPageBox"),
        box: box(input.box, "setPageBox"),
        rect: rect(input.rect, "setPageBox"),
      };
      await submitter.submit([operation]);
    },
    async setNUp(input: PdfPageBoxSetNUpInput) {
      const size = paper(input.paper, "setNUp");
      const operation: PdfPageBoxEngineOperation = {
        op: "setNUp",
        pages: pages(input.pages, "setNUp"),
        layout: layout(input.layout, "setNUp"),
        ...(size ? { paper: size } : {}),
      };
      await submitter.submit([operation]);
    },
  };
}

/** Keep page-box failures inside the PDF surface and localize them. */
export function pdfPageBoxErrorMessage(error: unknown, t: ReturnType<typeof useTranslation>["t"]): string {
  if (error && typeof error === "object") {
    const code = typeof (error as Record<string, unknown>).code === "string" ? ((error as Record<string, unknown>).code as string) : "";
    if (code === "unsupported_layout") return t("office.pdf.pageBox.errors.layout");
    if (code === "invalid_input") return t("office.pdf.pageBox.errors.input");
  }
  return t("office.pdf.pageBox.errors.failed");
}
