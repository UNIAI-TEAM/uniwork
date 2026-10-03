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
  /** Resolve an object using its 1-based displayed page; metadata.page must echo that displayed position. */
  resolveObject?(target: { page: number; objectId: string }): Promise<PdfObjectMetadata | null> | PdfObjectMetadata | null;
  assets?: PdfAssetProvider;
  /**
   * Current displayed order, expressed as original zero-based page indices. Operations resolve target.page sequentially
   * against the display order produced by earlier operations. Omit pageOrder only for identity-order files; otherwise
   * every page-addressed operation falls back to identity mapping. Required for move and non-identity-order files.
   */
  pageOrder?: readonly number[];
}

/** The JSON envelope accepted by office-engine's parsePdfOps. Kept local so a
 * browser bundle never imports the Node PDF implementation. */
export type PdfEngineOperation =
  | { op: "putTextEdit"; attributes: { pageIndex: number; rect: [number, number, number, number]; oldText: string; newText: string; fontSize: number } }
  | { op: "addMarkup"; attributes: { markup: { pageIndex: number; type: "highlight" | "underline" | "strikeout"; color: [number, number, number]; quads: number[][] } } }
  | { op: "addDrawing"; attributes: { drawing: { pageIndex: number; kind: "rect" | "ellipse" | "line" | "arrow" | "ink"; geometry: { rect: { x: number; y: number; width: number; height: number } } | { start: { x: number; y: number }; end: { x: number; y: number } } | { points: { x: number; y: number }[] }; color: [number, number, number]; width: number; fill?: [number, number, number] } } }
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

function markupOperation(
  operation: Extract<PdfEditOperation, { op: "add_markup" }>,
  order?: readonly number[],
): PdfEngineOperation {
  const page = pageIndex(operation.target.page, operation.op, order);
  const quads = operation.target.quads.map((quad) => {
    if (quad.length !== 8 || !quad.every((value) => Number.isFinite(value))) {
      throw new PdfOpsBridgeError("invalid_target", operation.op, "markup quads require eight finite coordinates");
    }
    return [...quad];
  });
  if (quads.length === 0) throw new PdfOpsBridgeError("invalid_target", operation.op, "at least one markup quad is required");
  return { op: "addMarkup", attributes: { markup: { pageIndex: page, type: operation.type, color: operation.color, quads } } };
}

function drawingOperation(operation: Extract<PdfEditOperation, { op: "add_drawing" }>, order?: readonly number[]): PdfEngineOperation {
  if (!Number.isSafeInteger(operation.target.page) || operation.target.page < 1) throw new PdfOpsBridgeError("invalid_target", operation.op, "page must be a positive integer");
  if (!Number.isFinite(operation.width) || operation.width <= 0) throw new PdfOpsBridgeError("invalid_target", operation.op, "drawing width must be positive");
  const geometry = operation.target.geometry;
  const finitePoint = (point: { x: number; y: number }) => Number.isFinite(point.x) && Number.isFinite(point.y);
  if ("rect" in geometry) {
    if (![geometry.rect.x, geometry.rect.y, geometry.rect.width, geometry.rect.height].every(Number.isFinite) || geometry.rect.width <= 0 || geometry.rect.height <= 0) throw new PdfOpsBridgeError("invalid_target", operation.op, "drawing rect requires finite positive bounds");
  } else if ("start" in geometry) {
    if (!finitePoint(geometry.start) || !finitePoint(geometry.end)) throw new PdfOpsBridgeError("invalid_target", operation.op, "line endpoints require finite coordinates");
  } else if (geometry.points.length < 2 || geometry.points.some((point) => !finitePoint(point))) throw new PdfOpsBridgeError("invalid_target", operation.op, "ink points require at least two finite points");
  return { op: "addDrawing", attributes: { drawing: { pageIndex: pageIndex(operation.target.page, operation.op, order), kind: operation.kind, geometry: operation.target.geometry, color: [...operation.color] as [number, number, number], width: operation.width, ...(operation.fill ? { fill: [...operation.fill] as [number, number, number] } : {}) } } };
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
      case "add_markup":
        bridged.push(markupOperation(operation, order));
        break;
      case "add_drawing":
        bridged.push(drawingOperation(operation, order));
        break;
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
