import type { PdfEngineOperation, PdfOpsBridgeOptions } from "../ops-bridge";

/** The engine rotation union, derived from the ops-bridge envelope so the two
 * cannot drift apart. */
export type PdfPageRotation = Extract<PdfEngineOperation, { op: "rotatePages" }>["attributes"]["dir"];

/** The page-operation envelopes the office engine's parsePdfOps accepts. */
export type PdfPageEngineOperation = Extract<PdfEngineOperation, { op: "rotatePages" | "deletePage" | "setPageOrder" }>;

/** Rotation request. `pages` is a list of zero-based displayed positions. */
export interface PdfPageRotateInput {
  pages: readonly number[];
  dir: PdfPageRotation;
}

/** Deletion request. `pageIndexes` is a list of zero-based displayed positions,
 * submitted as one batch. */
export interface PdfPageDeleteInput {
  pageIndexes: readonly number[];
}

/** Reorder request. `order` is the complete new order as zero-based displayed
 * positions. */
export interface PdfPageOrderInput {
  order: readonly number[];
}

/** Host seam for page operations. Positions are zero-based displayed positions;
 * createPdfPageOperationProvider maps each one through the current pageOrder to
 * the original engine index that parsePdfOps expects. */
export interface PdfPageOperationProvider {
  rotatePages(input: PdfPageRotateInput): Promise<void> | void;
  deletePages(input: PdfPageDeleteInput): Promise<void> | void;
  setPageOrder(input: PdfPageOrderInput): Promise<void> | void;
}

/** One batch per user action; every entry is a serialisable engine envelope. */
export interface PdfPageOperationSubmitter {
  submit(operations: readonly PdfPageEngineOperation[]): Promise<void> | void;
}

export type PdfPageProviderOptions = Pick<PdfOpsBridgeOptions, "pageOrder">;
