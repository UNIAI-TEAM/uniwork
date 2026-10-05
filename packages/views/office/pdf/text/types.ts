import type { PdfEngineOperation, PdfObjectMetadata } from "../ops-bridge";

/** A selected text run resolved by the host's browser-safe object provider. */
export interface PdfTextSelection extends PdfObjectMetadata {
  text: string;
  fontSize: number;
}

/** Input for an in-place replacement. `objectId` is required so a missing or
 * stale selection fails at the host resolver instead of reaching the engine;
 * `pageIndex` is the zero-based displayed page position. */
export interface PdfTextEditInput {
  objectId: string;
  pageIndex: number;
  rect: [number, number, number, number];
  oldText: string;
  newText: string;
  fontSize: number;
  newFont?: string;
  newFontSize?: number;
}

/** Insert attributes shared by the input contract and the wire envelope. */
interface PdfTextInsertAttributes {
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

/** Input for an insert; `pageIndex` is the zero-based displayed page position. */
export interface PdfTextInsertInput extends PdfTextInsertAttributes {
  pageIndex: number;
}

/** Attributes for the `putTextEdit` envelope: `pageIndex` is the zero-based
 * original engine index after display-order mapping, and the selection
 * `objectId` never rides the wire. */
export type PdfTextEditEnvelope = Extract<PdfEngineOperation, { op: "putTextEdit" }>["attributes"] & {
  newFont?: string;
  newFontSize?: number;
};

/** Attributes for the `addTextInsert` envelope, addressed the same way. */
export interface PdfTextInsertEnvelope extends PdfTextInsertAttributes {
  pageIndex: number;
}

/** Serialisable engine envelopes; no DOM, no bytes. */
export type PdfTextEngineOperation =
  | { op: "putTextEdit"; attributes: PdfTextEditEnvelope }
  | { op: "addTextInsert"; attributes: PdfTextInsertEnvelope };

/** One engine job warning. A per-edit font failure resolves the submit as
 * `{ code: "edit_skipped", detail }` instead of rejecting it. */
export interface PdfTextOperationWarning {
  code: string;
  detail?: string;
}

/** Resolved result of one submitted operation; hosts that do not report job
 * warnings may resolve nothing. */
export interface PdfTextOperationOutcome {
  warnings?: readonly PdfTextOperationWarning[];
}

/** Host/provider contract for text operations. The view never imports a codec. */
export interface PdfTextOperationProvider {
  putTextEdit(input: PdfTextEditInput): Promise<PdfTextOperationOutcome | void> | PdfTextOperationOutcome | void;
  addTextInsert(input: PdfTextInsertInput): Promise<PdfTextOperationOutcome | void> | PdfTextOperationOutcome | void;
}
