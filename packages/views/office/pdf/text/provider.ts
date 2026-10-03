import { bridgePdfOperations, PdfOpsBridgeError, type PdfOpsBridgeOptions } from "../ops-bridge";
import type {
  PdfTextEditInput,
  PdfTextEngineOperation,
  PdfTextInsertInput,
  PdfTextOperationOutcome,
  PdfTextOperationProvider,
} from "./types";

export interface PdfTextOperationSubmitter {
  /** Submit one text operation. Resolve with the engine job's outcome when the
   * host reports warnings — a skipped edit resolves, it does not reject. */
  submit(
    operations: readonly PdfTextEngineOperation[],
  ): Promise<PdfTextOperationOutcome | void> | PdfTextOperationOutcome | void;
}

function insertOperation(input: PdfTextInsertInput, options: PdfOpsBridgeOptions): PdfTextEngineOperation {
  if (!Number.isSafeInteger(input.pageIndex) || input.pageIndex < 0) {
    throw new PdfOpsBridgeError("invalid_target", "add_text_insert", "pageIndex must be a non-negative integer");
  }
  if (!Number.isFinite(input.origin[0]) || !Number.isFinite(input.origin[1])) {
    throw new PdfOpsBridgeError("invalid_target", "add_text_insert", "origin must contain finite coordinates");
  }
  if (!Number.isFinite(input.fontSize) || input.fontSize <= 0) {
    throw new PdfOpsBridgeError("invalid_target", "add_text_insert", "fontSize must be positive");
  }
  const page = options.pageOrder ? options.pageOrder[input.pageIndex] : input.pageIndex;
  if (page === undefined) {
    throw new PdfOpsBridgeError("invalid_target", "add_text_insert", "pageIndex is outside the current page order");
  }
  return { op: "addTextInsert", attributes: { ...input, pageIndex: page } };
}

export type PdfTextBridgeInput =
  | { kind: "replace"; input: PdfTextEditInput }
  | { kind: "insert"; input: PdfTextInsertInput };

/** Convert text requests to the same serialisable operation envelopes used by
 * the PDF host bridge. A replacement needs the host's object resolver — a host
 * that forgets it fails with `object_unavailable` instead of a fabricated
 * lookup that always passes. */
export async function bridgePdfTextOperation(
  request: PdfTextBridgeInput,
  options: PdfOpsBridgeOptions = {},
): Promise<PdfTextEngineOperation> {
  if (request.kind === "insert") return insertOperation(request.input, options);
  const bridged = await bridgePdfOperations(
    [{ op: "replace_text", target: { page: request.input.pageIndex + 1, objectId: request.input.objectId }, text: request.input.newText }],
    options,
  );
  const operation = bridged[0];
  if (!operation || operation.op !== "putTextEdit") throw new TypeError("text edit bridge returned an invalid operation");
  return {
    op: "putTextEdit",
    attributes: {
      ...operation.attributes,
      ...(request.input.newFont ? { newFont: request.input.newFont } : {}),
      ...(request.input.newFontSize ? { newFontSize: request.input.newFontSize } : {}),
    },
  };
}

/** Build a browser-safe text provider. Replacements use the shared bridge so
 * object lookup and displayed-page mapping remain identical to other PDF ops;
 * job warnings (a skipped edit) pass through to the caller. */
export function createPdfTextOperationProvider(
  options: PdfOpsBridgeOptions,
  submitter: PdfTextOperationSubmitter,
): PdfTextOperationProvider {
  return {
    async putTextEdit(input) {
      return submitter.submit([await bridgePdfTextOperation({ kind: "replace", input }, options)]);
    },
    async addTextInsert(input) {
      return submitter.submit([await bridgePdfTextOperation({ kind: "insert", input }, options)]);
    },
  };
}
