import type { PdfEngineOperation, PdfObjectMetadata, PdfOpsBridgeOptions } from "../ops-bridge";

export type PdfImageRect = [number, number, number, number];
export type PdfImageLayer = "belowText" | "aboveText";

/** Selected image object reported by the host. `page` is the 1-based displayed
 * page, the same convention as `PdfObjectMetadata.page`; `rect` is PDF user
 * space. The provider resolves the displayed page through `pageOrder`. */
export interface PdfImageSelection extends PdfObjectMetadata {
  page: number;
  objectId: string;
  rect: PdfImageRect;
  layer?: PdfImageLayer;
}

export interface PdfImageInsertInput {
  /** Zero-based position in the current displayed page order — not the 1-based
   * displayed page of `PdfImageSelection`/`PdfImageReplaceInput.target`. The
   * provider resolves it through `pageOrder` to the engine's original
   * zero-based page index. */
  pageIndex: number;
  rect: PdfImageRect;
  image: Uint8Array;
  layer: PdfImageLayer;
  rotate?: 0 | 90 | 180 | 270;
}

export interface PdfImageTransformInput {
  /** Zero-based position in the current displayed page order; the provider
   * resolves it through `pageOrder` like every other image input. */
  pageIndex: number;
  oldRect: PdfImageRect;
  rect: PdfImageRect;
  layer?: PdfImageLayer;
  /** Whole quarter turns; the engine rejects fractions (`int`). */
  quarterTurns?: number;
}

export interface PdfImageReplaceInput {
  /** `target.page` is the 1-based displayed page matching `resolveObject`
   * (`PdfObjectMetadata.page`), unlike the zero-based `pageIndex` of the other
   * image inputs. The provider subtracts one and resolves `pageOrder`. */
  target: { page: number; objectId: string };
  image: Uint8Array;
  rect?: PdfImageRect;
  layer?: PdfImageLayer;
  quarterTurns?: number;
}

export interface PdfImageDeleteInput {
  /** Zero-based position in the current displayed page order; the provider
   * resolves it through `pageOrder` like every other image input. */
  pageIndex: number;
  oldRect: PdfImageRect;
}

export type PdfImageEditInput =
  | ({ kind: "insertImage" } & PdfImageInsertInput)
  | ({ kind: "transformImage" } & PdfImageTransformInput)
  | ({ kind: "replaceImage" } & PdfImageReplaceInput)
  | ({ kind: "deleteImage" } & PdfImageDeleteInput);

/** The engine envelope the host accepts, JSON-serialisable. The operation tag
 * and the attributes shared with the bridge's `addImageEdit` variant are
 * derived from `PdfEngineOperation` so the two declarations cannot drift; the
 * kind-specific fields widen the bridge's replace-only shape to all four image
 * kinds. `pageIndex` is the engine's original zero-based index — `pageOrder`
 * has already been resolved. `rect` is required for every kind except
 * `deleteImage`, which reads only `oldRect`. */
type BridgeImageEnvelope = Extract<PdfEngineOperation, { op: "addImageEdit" }>;
export type PdfImageEngineOperation = Omit<BridgeImageEnvelope, "attributes"> & {
  attributes: Omit<BridgeImageEnvelope["attributes"], "kind" | "oldRect" | "rect" | "image"> & {
    kind: PdfImageEditInput["kind"];
    oldRect?: PdfImageRect;
    rect?: PdfImageRect;
    image?: string;
    rotate?: 0 | 90 | 180 | 270;
    quarterTurns?: number;
  };
};

export interface PdfImageOperationProvider {
  insertImage(input: PdfImageInsertInput): Promise<void> | void;
  transformImage(input: PdfImageTransformInput): Promise<void> | void;
  replaceImage(input: PdfImageReplaceInput): Promise<void> | void;
  deleteImage(input: PdfImageDeleteInput): Promise<void> | void;
}

export interface PdfImageOperationSubmitter {
  submit(operations: readonly PdfImageEngineOperation[]): Promise<void> | void;
}

export type PdfImageProviderOptions = Pick<PdfOpsBridgeOptions, "resolveObject" | "pageOrder">;
