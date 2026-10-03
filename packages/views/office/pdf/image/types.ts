import type { PdfObjectMetadata, PdfOpsBridgeOptions } from "../ops-bridge";

export type PdfImageRect = [number, number, number, number];
export type PdfImageLayer = "belowText" | "aboveText";

export interface PdfImageSelection extends PdfObjectMetadata {
  page: number;
  objectId: string;
  rect: PdfImageRect;
  layer?: PdfImageLayer;
}

export interface PdfImageInsertInput {
  pageIndex: number;
  rect: PdfImageRect;
  image: Uint8Array;
  layer: PdfImageLayer;
  rotate?: 0 | 90 | 180 | 270;
}

export interface PdfImageTransformInput {
  pageIndex: number;
  oldRect: PdfImageRect;
  rect: PdfImageRect;
  layer?: PdfImageLayer;
  quarterTurns?: number;
}

export interface PdfImageReplaceInput {
  target: { page: number; objectId: string };
  image: Uint8Array;
  rect?: PdfImageRect;
  layer?: PdfImageLayer;
  quarterTurns?: number;
}

export interface PdfImageDeleteInput {
  pageIndex: number;
  oldRect: PdfImageRect;
}

export type PdfImageEditInput =
  | ({ kind: "insertImage" } & PdfImageInsertInput)
  | ({ kind: "transformImage" } & PdfImageTransformInput)
  | ({ kind: "replaceImage" } & PdfImageReplaceInput)
  | ({ kind: "deleteImage" } & PdfImageDeleteInput);

export type PdfImageEngineOperation = {
  op: "addImageEdit";
  attributes: {
    kind: PdfImageEditInput["kind"];
    pageIndex: number;
    oldRect?: PdfImageRect;
    rect: PdfImageRect;
    image?: string;
    layer?: PdfImageLayer;
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

export interface PdfImageOperationError {
  code?: string;
  reason?: string;
}
