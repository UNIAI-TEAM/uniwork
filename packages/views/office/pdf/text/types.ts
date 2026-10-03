import type { PdfObjectMetadata } from "../ops-bridge";

/** A selected text run resolved by the host's browser-safe object provider. */
export interface PdfTextSelection extends PdfObjectMetadata {
  text: string;
  fontSize: number;
}

export interface PdfTextEditInput {
  objectId?: string;
  pageIndex: number;
  rect: [number, number, number, number];
  oldText: string;
  newText: string;
  fontSize: number;
  newFont?: string;
  newFontSize?: number;
}

export interface PdfTextInsertInput {
  pageIndex: number;
  origin: [number, number];
  text: string;
  fontSize: number;
  color: [number, number, number];
  font?: string;
  bold?: boolean;
  italic?: boolean;
  lineLeading?: number;
  rotate?: number;
}

/** Typed engine envelopes. These stay serialisable and contain no DOM or bytes. */
export type PdfTextEngineOperation =
  | { op: "putTextEdit"; attributes: PdfTextEditInput }
  | { op: "addTextInsert"; attributes: PdfTextInsertInput };

/** Host/provider contract for text operations. The view never imports a codec. */
export interface PdfTextOperationProvider {
  putTextEdit(input: PdfTextEditInput): Promise<void> | void;
  addTextInsert(input: PdfTextInsertInput): Promise<void> | void;
}

export type PdfTextOperationError = {
  code?: string;
  reason?: string;
  fields?: Record<string, unknown>;
};
