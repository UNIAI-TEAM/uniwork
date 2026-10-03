import { bridgePdfOperations, type PdfOpsBridgeOptions } from "../ops-bridge";
import type { PdfTextEditInput, PdfTextEngineOperation, PdfTextInsertInput, PdfTextOperationProvider } from "./types";

export interface PdfTextOperationSubmitter {
  submit(operations: readonly PdfTextEngineOperation[]) : Promise<void> | void;
}

function insertOperation(input: PdfTextInsertInput, options: PdfOpsBridgeOptions): PdfTextEngineOperation {
  if (!Number.isSafeInteger(input.pageIndex) || input.pageIndex < 0) throw new TypeError("pageIndex must be a non-negative integer");
  if (!Number.isFinite(input.origin[0]) || !Number.isFinite(input.origin[1])) throw new TypeError("origin must contain finite coordinates");
  if (!Number.isFinite(input.fontSize) || input.fontSize <= 0) throw new TypeError("fontSize must be positive");
  const page = options.pageOrder ? options.pageOrder[input.pageIndex] : input.pageIndex;
  if (page === undefined) throw new TypeError("pageIndex is outside the current page order");
  return { op: "addTextInsert", attributes: { ...input, pageIndex: page } };
}

export type PdfTextBridgeInput =
  | { kind: "replace"; input: PdfTextEditInput }
  | { kind: "insert"; input: PdfTextInsertInput };

/** Convert text requests to the same serialisable operation envelopes used by
 * the PDF host bridge. */
export async function bridgePdfTextOperation(request: PdfTextBridgeInput, options: PdfOpsBridgeOptions = {}): Promise<PdfTextEngineOperation> {
  if (request.kind === "insert") return insertOperation(request.input, options);
  const objectId = request.input.objectId ?? "text-operation";
  const bridgeOptions = options.resolveObject ? options : {
    ...options,
    resolveObject: () => ({ page: request.input.pageIndex + 1, objectId, rect: request.input.rect, text: request.input.oldText, fontSize: request.input.fontSize }),
  };
  const bridged = await bridgePdfOperations(
    [{ op: "replace_text", target: { page: request.input.pageIndex + 1, objectId }, text: request.input.newText }],
    bridgeOptions,
  );
  const operation = bridged[0];
  if (!operation || operation.op !== "putTextEdit") throw new TypeError("text edit bridge returned an invalid operation");
  return { op: "putTextEdit", attributes: { ...operation.attributes, ...(request.input.newFont ? { newFont: request.input.newFont } : {}), ...(request.input.newFontSize ? { newFontSize: request.input.newFontSize } : {}) } };
}

/** Build a browser-safe text provider. Replacements use the shared bridge so
 * object lookup and displayed-page mapping remain identical to other PDF ops. */
export function createPdfTextOperationProvider(options: PdfOpsBridgeOptions, submitter: PdfTextOperationSubmitter): PdfTextOperationProvider {
  const submit = (operation: PdfTextEngineOperation): Promise<void> | void => submitter.submit([operation]);
  return {
    async putTextEdit(input) {
      await submit(await bridgePdfTextOperation({ kind: "replace", input }, options));
    },
    async addTextInsert(input) {
      await submit(await bridgePdfTextOperation({ kind: "insert", input }, options));
    },
  };
}
