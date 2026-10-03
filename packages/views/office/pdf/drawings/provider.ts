import type { PdfDrawingEngineOperation, PdfDrawingInput, PdfDrawingOperationProvider, PdfDrawingOperationSubmitter, PdfDrawingProviderOptions } from "./types";

export class PdfDrawingProviderError extends Error {
  readonly code = "invalid_input" as const;
  constructor(message: string) {
    super(message);
    this.name = "PdfDrawingProviderError";
  }
}

function pageIndex(page: number, order: readonly number[] | undefined): number {
  if (!Number.isSafeInteger(page) || page < 0) throw new PdfDrawingProviderError("pageIndex must be a non-negative integer");
  const mapped = order ? order[page] : page;
  if (mapped === undefined) throw new PdfDrawingProviderError("pageIndex is outside the current page order");
  return mapped;
}

function operation(input: PdfDrawingInput, options: PdfDrawingProviderOptions): PdfDrawingEngineOperation {
  if (!Number.isFinite(input.width) || input.width <= 0) throw new PdfDrawingProviderError("width must be positive");
  return { op: "addDrawing", attributes: { drawing: { ...input, pageIndex: pageIndex(input.pageIndex, options.pageOrder), color: [...input.color] as [number, number, number], ...(input.fill ? { fill: [...input.fill] as [number, number, number] } : {}) } } };
}

export function createPdfDrawingOperationProvider(options: PdfDrawingProviderOptions, submitter: PdfDrawingOperationSubmitter): PdfDrawingOperationProvider {
  return { async addDrawing(input) { await submitter.submit([operation(input, options)]); } };
}
