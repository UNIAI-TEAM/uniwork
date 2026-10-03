import type { PdfPageDeleteInput, PdfPageEngineOperation, PdfPageOperationProvider, PdfPageOperationSubmitter, PdfPageOrderInput, PdfPageProviderOptions, PdfPageRotateInput } from "./types";

export class PdfPageProviderError extends Error {
  readonly code = "invalid_input" as const;
  constructor(message: string) {
    super(message);
    this.name = "PdfPageProviderError";
  }
}

function originalIndex(displayed: number, order: readonly number[] | undefined): number {
  if (!Number.isSafeInteger(displayed) || displayed < 0) throw new PdfPageProviderError("page position must be a non-negative integer");
  const mapped = order ? order[displayed] : displayed;
  if (mapped === undefined) throw new PdfPageProviderError("page position is outside the current page order");
  return mapped;
}

function rotationOperation(input: PdfPageRotateInput, options: PdfPageProviderOptions): PdfPageEngineOperation {
  if (input.pages.length === 0) throw new PdfPageProviderError("pages must not be empty");
  if (input.dir !== 90 && input.dir !== -90 && input.dir !== 180) throw new PdfPageProviderError("dir must be 90, -90 or 180");
  return { op: "rotatePages", attributes: { pages: input.pages.map((page) => originalIndex(page, options.pageOrder)), dir: input.dir } };
}

function deletionOperations(input: PdfPageDeleteInput, options: PdfPageProviderOptions): PdfPageEngineOperation[] {
  if (input.pageIndexes.length === 0) throw new PdfPageProviderError("pageIndexes must not be empty");
  return input.pageIndexes.map((page): PdfPageEngineOperation => ({ op: "deletePage", attributes: { pageIndex: originalIndex(page, options.pageOrder) } }));
}

function orderOperation(input: PdfPageOrderInput, options: PdfPageProviderOptions): PdfPageEngineOperation {
  if (input.order.length === 0) throw new PdfPageProviderError("order must not be empty");
  return { op: "setPageOrder", attributes: { order: input.order.map((page) => originalIndex(page, options.pageOrder)) } };
}

/** Build the browser-safe page provider the panel emits through. Displayed
 * positions are mapped through the host's current pageOrder, so a non-identity
 * order can never address the wrong original page. */
export function createPdfPageOperationProvider(options: PdfPageProviderOptions, submitter: PdfPageOperationSubmitter): PdfPageOperationProvider {
  return {
    async rotatePages(input) {
      await submitter.submit([rotationOperation(input, options)]);
    },
    async deletePages(input) {
      await submitter.submit(deletionOperations(input, options));
    },
    async setPageOrder(input) {
      await submitter.submit([orderOperation(input, options)]);
    },
  };
}
