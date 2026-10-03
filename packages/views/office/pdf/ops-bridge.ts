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
  resolveObject?(target: { page: number; objectId: string }): Promise<PdfObjectMetadata | null> | PdfObjectMetadata | null;
  assets?: PdfAssetProvider;
  /** Current order in original, zero-based page indices. Required for move. */
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

function pageIndex(page: number, operation: string): number {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new PdfOpsBridgeError("invalid_target", operation, "page must be a positive integer");
  }
  return page - 1;
}

function objectMetadata(
  options: PdfOpsBridgeOptions,
  target: { page: number; objectId: string },
  operation: string,
): Promise<PdfObjectMetadata> {
  if (!options.resolveObject) {
    throw new PdfOpsBridgeError("object_unavailable", operation, "object resolver is required");
  }
  return Promise.resolve(options.resolveObject(target)).then((value) => {
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
      pageIndex: pageIndex(operation.target.page, operation.op),
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
): Promise<PdfEngineOperation> {
  const object = await objectMetadata(options, operation.target, operation.op);
  if (typeof object.text !== "string" || typeof object.fontSize !== "number") {
    throw new PdfOpsBridgeError("object_unavailable", operation.op, "selected text metadata is unavailable");
  }
  return {
    op: "putTextEdit",
    attributes: {
      pageIndex: pageIndex(operation.target.page, operation.op),
      rect: object.rect,
      oldText: object.text,
      newText: operation.text,
      fontSize: object.fontSize,
    },
  };
}

function reorderOperation(
  operation: Extract<PdfEditOperation, { op: "reorder_page" }>,
  options: PdfOpsBridgeOptions,
): PdfEngineOperation {
  if (!options.pageOrder) throw new PdfOpsBridgeError("invalid_target", operation.op, "page order is required");
  const from = pageIndex(operation.target.page, operation.op);
  if (!Number.isSafeInteger(operation.index) || operation.index < 0 || operation.index >= options.pageOrder.length) {
    throw new PdfOpsBridgeError("invalid_target", operation.op, "target index is outside the page order");
  }
  const order = [...options.pageOrder];
  const position = order.indexOf(from);
  if (position < 0) throw new PdfOpsBridgeError("invalid_target", operation.op, "page is not in the page order");
  order.splice(position, 1);
  order.splice(operation.index, 0, from);
  return { op: "setPageOrder", attributes: { order } };
}

/** Convert browser-facing snake_case actions to the typed engine envelope.
 * Unsupported operations fail before the provider is touched. */
export async function bridgePdfOperations(
  operations: readonly PdfEditOperation[],
  options: PdfOpsBridgeOptions = {},
): Promise<readonly PdfEngineOperation[]> {
  const bridged: PdfEngineOperation[] = [];
  for (const operation of operations) {
    switch (operation.op) {
      case "replace_text":
        bridged.push(await textOperation(operation, options));
        break;
      case "replace_image":
        bridged.push(await imageOperation(operation, options));
        break;
      case "delete_page":
        bridged.push({ op: "deletePage", attributes: { pageIndex: pageIndex(operation.target.page, operation.op) } });
        break;
      case "rotate_page": {
        const degrees = operation.degrees === 270 ? -90 : operation.degrees;
        bridged.push({ op: "rotatePages", attributes: { pages: [pageIndex(operation.target.page, operation.op)], dir: degrees } });
        break;
      }
      case "reorder_page":
        bridged.push(reorderOperation(operation, options));
        break;
      case "insert_page":
      case "extract_page":
      case "merge_pages":
        throw new PdfOpsBridgeError("unsupported_operation", operation.op, `${operation.op} is not available in this PDF engine build`);
      default:
        throw new PdfOpsBridgeError("unsupported_operation", (operation as { op: string }).op, "unknown PDF operation");
    }
  }
  return bridged;
}
