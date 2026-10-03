import type { PdfEditOperation } from "./types";

/** PDF user-space bounds and the source text/image metadata needed by the
 * Node engine. The browser only sees this small, serialisable seam. */
export interface PdfObjectMetadata {
  page: number;
  objectId: string;
  rect: [number, number, number, number];
  /** Text currently shown by the selected run. */
  text?: string;
  fontSize?: number;
  layer?: "belowText" | "aboveText";
}

export interface PdfAssetProvider {
  /** Resolve a provider-owned asset reference without exposing a Node codec. */
  read(assetId: string): Promise<Uint8Array>;
}

export interface PdfOpsBridgeOptions {
  /** Operations resolve target.page sequentially against the display order produced by earlier operations. Omit pageOrder only for identity-order files. */
  resolveObject?(target: { page: number; objectId: string }): Promise<PdfObjectMetadata | null> | PdfObjectMetadata | null;
  assets?: PdfAssetProvider;
  /** Current displayed order, expressed as original zero-based page indices. Required for move. */
  pageOrder?: readonly number[];
}

/** The JSON envelope accepted by office-engine's parsePdfOps. Kept local so a
 * browser bundle never imports the Node PDF implementation. */
export type PdfEngineOperation =
  | { op: "putTextEdit"; attributes: { pageIndex: number; rect: [number, number, number, number]; oldText: string; newText: string; fontSize: number } }
  | { op: "addImageEdit"; attributes: { kind: "replaceImage"; pageIndex: number; oldRect: [number, number, number, number]; rect: [number, number, number, number]; image: string; layer?: "belowText" | "aboveText" } }
  | { op: "deletePage"; attributes: { pageIndex: number } }
  | { op: "rotatePages"; attributes: { pages: number[]; dir: 90 | -90 | 180 } }
  | { op: "setPageOrder"; attributes: { order: number[] } };

export class PdfOpsBridgeError extends Error {
  readonly code: "unsupported_operation" | "object_unavailable" | "asset_provider_missing" | "asset_unavailable" | "invalid_target";
  readonly operation: string;

  constructor(code: PdfOpsBridgeError["code"], operation: string, message: string) {
    super(message);
    this.name = "PdfOpsBridgeError";
    this.code = code;
    this.operation = operation;
  }
}

function pageIndex(page: number, operation: string, order?: readonly number[]): number {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new PdfOpsBridgeError("invalid_target", operation, "page must be a positive integer");
  }
  if (!order) return page - 1;
  const original = order[page - 1];
  if (original === undefined) {
    throw new PdfOpsBridgeError("invalid_target", operation, "page is outside the current page order");
  }
  return original;
}

function objectMetadata(
  options: PdfOpsBridgeOptions,
  target: { page: number; objectId: string },
  operation: string,
): Promise<PdfObjectMetadata> {
  if (!options.resolveObject) {
    throw new PdfOpsBridgeError("object_unavailable", operation, "object resolver is required");
  }
  return Promise.resolve()
    .then(() => options.resolveObject!(target))
    .catch((error: unknown) => {
      if (error instanceof PdfOpsBridgeError) throw error;
      throw new PdfOpsBridgeError("object_unavailable", operation, "selected PDF object could not be resolved");
    })
    .then((value) => {
      if (!value || value.page !== target.page || value.objectId !== target.objectId) {
        throw new PdfOpsBridgeError("object_unavailable", operation, "selected PDF object is unavailable");
      }
      return value;
    });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  const encode = globalThis.btoa;
  if (typeof encode !== "function") throw new PdfOpsBridgeError("asset_unavailable", "replace_image", "base64 encoder is unavailable");
  return encode(binary);
}

async function imageOperation(
  operation: Extract<PdfEditOperation, { op: "replace_image" }>,
  options: PdfOpsBridgeOptions,
  order?: readonly number[],
): Promise<PdfEngineOperation> {
  if (!options.assets) throw new PdfOpsBridgeError("asset_provider_missing", operation.op, "asset provider is required");
  const object = await objectMetadata(options, operation.target, operation.op);
  let bytes: Uint8Array;
  try {
    bytes = await options.assets.read(operation.assetId);
  } catch {
    throw new PdfOpsBridgeError("asset_unavailable", operation.op, "asset could not be read");
  }
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    throw new PdfOpsBridgeError("asset_unavailable", operation.op, "asset has no image bytes");
  }
  return {
    op: "addImageEdit",
    attributes: {
      kind: "replaceImage",
      pageIndex: pageIndex(operation.target.page, operation.op, order),
      oldRect: object.rect,
      rect: object.rect,
      image: bytesToBase64(bytes),
      ...(object.layer ? { layer: object.layer } : {}),
    },
  };
}

async function textOperation(
  operation: Extract<PdfEditOperation, { op: "replace_text" }>,
  options: PdfOpsBridgeOptions,
  order?: readonly number[],
): Promise<PdfEngineOperation> {
  const object = await objectMetadata(options, operation.target, operation.op);
  if (typeof object.text !== "string" || typeof object.fontSize !== "number") {
    throw new PdfOpsBridgeError("object_unavailable", operation.op, "selected text metadata is unavailable");
  }
  return {
    op: "putTextEdit",
    attributes: {
      pageIndex: pageIndex(operation.target.page, operation.op, order),
      rect: object.rect,
      oldText: object.text,
      newText: operation.text,
      fontSize: object.fontSize,
    },
  };
}

function reorderPage(
  operation: Extract<PdfEditOperation, { op: "reorder_page" }>,
  order: readonly number[],
): number[] {
  if (!Number.isSafeInteger(operation.index) || operation.index < 0 || operation.index > order.length - 1) {
    throw new PdfOpsBridgeError("invalid_target", operation.op, "target index is outside the page order");
  }
  const from = order[operation.target.page - 1];
  if (from === undefined) throw new PdfOpsBridgeError("invalid_target", operation.op, "page is outside the current page order");
  const next = [...order];
  next.splice(operation.target.page - 1, 1);
  next.splice(operation.index, 0, from);
  return next;
}

/** Convert browser-facing snake_case actions to the typed engine envelope.
 * Unsupported operations fail before the provider is touched. */
export async function bridgePdfOperations(
  operations: readonly PdfEditOperation[],
  options: PdfOpsBridgeOptions = {},
): Promise<readonly PdfEngineOperation[]> {
  const bridged: PdfEngineOperation[] = [];
  let order = options.pageOrder ? [...options.pageOrder] : undefined;
  let reordered = false;
  for (const operation of operations) {
    switch (operation.op) {
      case "replace_text":
        bridged.push(await textOperation(operation, options, order));
        break;
      case "replace_image":
        bridged.push(await imageOperation(operation, options, order));
        break;
      case "delete_page": {
        const original = pageIndex(operation.target.page, operation.op, order);
        bridged.push({ op: "deletePage", attributes: { pageIndex: original } });
        if (order) order = order.filter((page) => page !== original);
        break;
      }
      case "rotate_page": {
        const degrees = operation.degrees === 270 ? -90 : operation.degrees;
        bridged.push({ op: "rotatePages", attributes: { pages: [pageIndex(operation.target.page, operation.op, order)], dir: degrees } });
        break;
      }
      case "reorder_page":
        if (!order) throw new PdfOpsBridgeError("invalid_target", operation.op, "page order is required");
        order = reorderPage(operation, order);
        reordered = true;
        break;
      case "insert_page":
      case "extract_page":
      case "merge_pages":
        throw new PdfOpsBridgeError("unsupported_operation", operation.op, `${operation.op} is not available in this PDF engine build`);
      default:
        throw new PdfOpsBridgeError("unsupported_operation", (operation as { op: string }).op, "unknown PDF operation");
    }
  }
  if (reordered && order) bridged.push({ op: "setPageOrder", attributes: { order } });
  return bridged;
}
