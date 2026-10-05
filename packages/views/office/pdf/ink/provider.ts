import type { PdfInkEngineOperation, PdfInkInput, PdfInkOperationProvider, PdfInkOperationSubmitter, PdfInkProviderOptions } from "./types";

export class PdfInkProviderError extends Error {
  readonly code = "invalid_input" as const;
  constructor(message: string) {
    super(message);
    this.name = "PdfInkProviderError";
  }
}

function pageIndex(page: number, order: readonly number[] | undefined): number {
  if (!Number.isSafeInteger(page) || page < 0) throw new PdfInkProviderError("pageIndex must be a non-negative integer");
  const mapped = order ? order[page] : page;
  if (mapped === undefined) throw new PdfInkProviderError("pageIndex is outside the current page order");
  return mapped;
}

function operation(input: PdfInkInput, options: PdfInkProviderOptions): PdfInkEngineOperation {
  if (!Number.isFinite(input.width) || input.width <= 0) throw new PdfInkProviderError("width must be positive");
  if (input.points.length < 2 || input.points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) throw new PdfInkProviderError("points require at least two finite points");
  return { op: "addDrawing", attributes: { drawing: { pageIndex: pageIndex(input.pageIndex, options.pageOrder), kind: "ink", geometry: { points: input.points.map((point) => ({ ...point })) }, color: [...input.color] as [number, number, number], width: input.width } } };
}

export function createPdfInkOperationProvider(options: PdfInkProviderOptions, submitter: PdfInkOperationSubmitter): PdfInkOperationProvider {
  return { async addInk(input) { await submitter.submit([operation(input, options)]); } };
}
